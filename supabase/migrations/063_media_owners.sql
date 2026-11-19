-- ═══════════════════════════════════════════════════════════════════
-- OOH Platform — media owners as real records, owner link controls,
-- traceable availability, private current rates, archive / restore
-- Run in Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- Requires 053, 055, 056, 061. Safe to re-run. Adds only; nothing is deleted.
--
-- Until now an owner was only a typed name on each board (047) or an
-- account. Now:
--   • media_owners: one record per owner company (legal name, RC number,
--     address, website, notes) with a status: unreviewed, approved,
--     rejected or suspended. Admins only.
--   • boards.media_owner_id: which owner a board belongs to. The owner key
--     used by owner links, saved contacts and replies (053) now comes from
--     this record, so renaming an owner no longer breaks their link.
--     Existing typed names become owner records; nothing is reassigned.
--     Typing an owner name on import still works (a trigger links it).
--   • owner_sales_contacts (048) gains email, role, primary and notes, so
--     each owner can have several contact people.
--   • owner links can be revoked, replaced or given an expiry date. A
--     revoked, expired, suspended or rejected owner's link stops working.
--   • owner_events: what each owner did and when (link opened, boards
--     confirmed, answers, corrections, reminders) — the response history.
--   • board_availability_log: every change of a board's availability,
--     with who made it (owner link, admin, owner account).
--   • board_owner_rates: the owner's current monthly rate per board,
--     private to admins (sent from the owner link or typed by our team).
--   • Owners can report a wrong map location from their link.
--   • admin_archive_boards: archive (status 'decommissioned', hidden from
--     buyers) and restore, keeping the status it had.
--
-- Rollback: see the end of the file.
-- ═══════════════════════════════════════════════════════════════════

-- ── 0. Helpers ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.owner_name_key(p_name TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT 'name:' || left(lower(regexp_replace(btrim(p_name), '\s+', ' ', 'g')), 200)
$$;

-- ── 1. Media owners ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.media_owners (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_key   TEXT NOT NULL UNIQUE CHECK (length(owner_key) BETWEEN 1 AND 220),
  name        TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 200),
  legal_name  TEXT CHECK (legal_name IS NULL OR length(legal_name) <= 200),
  rc_number   TEXT CHECK (rc_number IS NULL OR length(rc_number) <= 40),
  address     TEXT CHECK (address IS NULL OR length(address) <= 300),
  website     TEXT CHECK (website IS NULL OR length(website) <= 200),
  account_id  UUID,
  status      TEXT NOT NULL DEFAULT 'unreviewed' CHECK (status IN ('unreviewed', 'approved', 'rejected', 'suspended')),
  status_note TEXT CHECK (status_note IS NULL OR length(status_note) <= 500),
  status_at   TIMESTAMPTZ,
  status_by   UUID,
  notes       TEXT CHECK (notes IS NULL OR length(notes) <= 2000),
  created_by  UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS media_owners_name_uniq ON public.media_owners (lower(btrim(name)));
ALTER TABLE public.media_owners ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS media_owners_admin ON public.media_owners;
CREATE POLICY media_owners_admin ON public.media_owners FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());
REVOKE ALL ON public.media_owners FROM anon;
GRANT SELECT ON public.media_owners TO authenticated;          -- rows: admins only (policy)
REVOKE INSERT, UPDATE, DELETE ON public.media_owners FROM authenticated;  -- writes through the admin functions

ALTER TABLE public.boards ADD COLUMN IF NOT EXISTS media_owner_id UUID REFERENCES public.media_owners(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS boards_media_owner_idx ON public.boards (media_owner_id);
ALTER TABLE public.boards ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE public.boards ADD COLUMN IF NOT EXISTS archived_status TEXT;
-- 060 grants board columns one by one, so new columns need their own grant. Signed-in only.
GRANT SELECT (media_owner_id, archived_at, archived_status) ON public.boards TO authenticated;

-- Existing owners: one record per typed owner name and per owner link.
INSERT INTO public.media_owners (owner_key, name)
SELECT DISTINCT ON (lower(btrim(n.owner_name))) public.owner_name_key(n.owner_name), btrim(n.owner_name)
  FROM public.board_owner_names n
 WHERE length(btrim(n.owner_name)) >= 2
 ORDER BY lower(btrim(n.owner_name)), n.updated_at DESC NULLS LAST
ON CONFLICT DO NOTHING;
INSERT INTO public.media_owners (owner_key, name)
SELECT l.owner_key, btrim(l.owner_name) FROM public.owner_links l
 WHERE l.owner_key LIKE 'name:%' AND length(btrim(l.owner_name)) >= 2
   AND NOT EXISTS (SELECT 1 FROM public.media_owners m WHERE lower(btrim(m.name)) = lower(btrim(l.owner_name)))
ON CONFLICT DO NOTHING;
UPDATE public.boards b SET media_owner_id = m.id
  FROM public.board_owner_names n JOIN public.media_owners m ON m.owner_key = public.owner_name_key(n.owner_name)
 WHERE n.board_id = b.id AND b.media_owner_id IS NULL AND b.owner_id IS NULL;

-- The owner key of a board: its owner account, else its media owner record, else a typed name.
CREATE OR REPLACE FUNCTION public.board_owner_key(p_board_id UUID)
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    public.board_owner_account(p_board_id)::text,
    (SELECT m.owner_key FROM public.boards b JOIN public.media_owners m ON m.id = b.media_owner_id WHERE b.id = p_board_id),
    (SELECT public.owner_name_key(n.owner_name) FROM public.board_owner_names n WHERE n.board_id = p_board_id)
  );
$$;
REVOKE ALL ON FUNCTION public.board_owner_key(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.board_owner_key(UUID) TO authenticated;

-- Typing an owner name (import, post a board) links the board to that owner's record, creating it if new.
CREATE OR REPLACE FUNCTION public.board_owner_name_sync()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE public.boards SET media_owner_id = NULL WHERE id = OLD.board_id AND media_owner_id IS NOT NULL;
    RETURN OLD;
  END IF;
  IF length(btrim(COALESCE(NEW.owner_name, ''))) < 2 THEN RETURN NEW; END IF;
  SELECT id INTO v_id FROM public.media_owners
   WHERE lower(btrim(name)) = lower(btrim(NEW.owner_name)) OR owner_key = public.owner_name_key(NEW.owner_name)
   ORDER BY (lower(btrim(name)) = lower(btrim(NEW.owner_name))) DESC LIMIT 1;
  IF v_id IS NULL THEN
    INSERT INTO public.media_owners (owner_key, name, created_by)
    VALUES (public.owner_name_key(NEW.owner_name), btrim(NEW.owner_name), auth.uid())
    ON CONFLICT DO NOTHING RETURNING id INTO v_id;
    IF v_id IS NULL THEN
      SELECT id INTO v_id FROM public.media_owners WHERE owner_key = public.owner_name_key(NEW.owner_name);
    END IF;
  END IF;
  UPDATE public.boards SET media_owner_id = v_id WHERE id = NEW.board_id AND media_owner_id IS DISTINCT FROM v_id;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS board_owner_names_sync ON public.board_owner_names;
CREATE TRIGGER board_owner_names_sync AFTER INSERT OR UPDATE OF owner_name OR DELETE ON public.board_owner_names
  FOR EACH ROW EXECUTE FUNCTION public.board_owner_name_sync();

-- ── 2. Contacts (048 table, more fields) ─────────────────────────────────
ALTER TABLE public.owner_sales_contacts ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE public.owner_sales_contacts ADD COLUMN IF NOT EXISTS role TEXT;
ALTER TABLE public.owner_sales_contacts ADD COLUMN IF NOT EXISTS is_primary BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.owner_sales_contacts ADD COLUMN IF NOT EXISTS notes TEXT;
-- A contact may be email-only now: replace 048's "name or phone" rule.
DO $$
DECLARE c TEXT;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint
            WHERE conrelid = 'public.owner_sales_contacts'::regclass AND contype = 'c'
              AND pg_get_constraintdef(oid) LIKE '%contact_name <> ''''::text) OR (contact_phone <> ''''::text%'
              AND pg_get_constraintdef(oid) NOT LIKE '%email%'
  LOOP
    EXECUTE format('ALTER TABLE public.owner_sales_contacts DROP CONSTRAINT %I', c);
  END LOOP;
END $$;
ALTER TABLE public.owner_sales_contacts DROP CONSTRAINT IF EXISTS owner_sales_contacts_someone_check;
ALTER TABLE public.owner_sales_contacts ADD CONSTRAINT owner_sales_contacts_someone_check
  CHECK (contact_name <> '' OR contact_phone <> '' OR email IS NOT NULL);
ALTER TABLE public.owner_sales_contacts DROP CONSTRAINT IF EXISTS owner_sales_contacts_email_check;
ALTER TABLE public.owner_sales_contacts ADD CONSTRAINT owner_sales_contacts_email_check
  CHECK (email IS NULL OR (length(email) <= 200 AND email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'));
ALTER TABLE public.owner_sales_contacts DROP CONSTRAINT IF EXISTS owner_sales_contacts_extra_check;
ALTER TABLE public.owner_sales_contacts ADD CONSTRAINT owner_sales_contacts_extra_check
  CHECK ((role IS NULL OR length(role) <= 80) AND (notes IS NULL OR length(notes) <= 500));

-- ── 3. Owner link controls ───────────────────────────────────────────────
ALTER TABLE public.owner_links ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;
ALTER TABLE public.owner_links ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

-- The only way a token becomes an owner: live link, owner not suspended or rejected.
CREATE OR REPLACE FUNCTION public.owner_link_key(p_token TEXT)
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT l.owner_key FROM public.owner_links l
   WHERE l.token = p_token AND length(p_token) >= 32
     AND l.revoked_at IS NULL AND (l.expires_at IS NULL OR l.expires_at > NOW())
     AND NOT EXISTS (SELECT 1 FROM public.media_owners m WHERE m.owner_key = l.owner_key AND m.status IN ('suspended', 'rejected'));
$$;
REVOKE ALL ON FUNCTION public.owner_link_key(TEXT) FROM PUBLIC, anon, authenticated;

-- Same as 053, and a new link starts fresh: no revoke, no expiry.
CREATE OR REPLACE FUNCTION public.admin_owner_link(p_owner_key TEXT, p_owner_name TEXT, p_new BOOLEAN DEFAULT false)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_token TEXT;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admins only' USING ERRCODE = '42501'; END IF;
  IF COALESCE(trim(p_owner_key), '') = '' THEN RAISE EXCEPTION 'Set the board owner first' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.owner_links (owner_key, owner_name, created_by)
  VALUES (p_owner_key, left(COALESCE(NULLIF(trim(p_owner_name), ''), 'Board owner'), 200), auth.uid())
  ON CONFLICT (owner_key) DO UPDATE SET
    owner_name = EXCLUDED.owner_name,
    token = CASE WHEN p_new THEN replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '') ELSE public.owner_links.token END,
    created_by = CASE WHEN p_new THEN auth.uid() ELSE public.owner_links.created_by END,
    created_at = CASE WHEN p_new THEN NOW() ELSE public.owner_links.created_at END,
    revoked_at = CASE WHEN p_new THEN NULL ELSE public.owner_links.revoked_at END,
    expires_at = CASE WHEN p_new THEN NULL ELSE public.owner_links.expires_at END
  RETURNING token INTO v_token;
  RETURN v_token;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_revoke_owner_link(p_owner_key TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admins only' USING ERRCODE = '42501'; END IF;
  UPDATE public.owner_links SET revoked_at = NOW() WHERE owner_key = p_owner_key AND revoked_at IS NULL;
END;
$$;

-- p_expires NULL = no expiry. Must be in the future.
CREATE OR REPLACE FUNCTION public.admin_set_owner_link_expiry(p_owner_key TEXT, p_expires DATE)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admins only' USING ERRCODE = '42501'; END IF;
  IF p_expires IS NOT NULL AND p_expires <= public.lagos_today() THEN
    RAISE EXCEPTION 'Pick a date after today' USING ERRCODE = '22023';
  END IF;
  UPDATE public.owner_links
     SET expires_at = CASE WHEN p_expires IS NULL THEN NULL ELSE (p_expires::timestamp + INTERVAL '1 day') AT TIME ZONE 'Africa/Lagos' END
   WHERE owner_key = p_owner_key;
  IF NOT FOUND THEN RAISE EXCEPTION 'This owner has no link yet' USING ERRCODE = '22023'; END IF;
END;
$$;

-- ── 4. Response history ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.owner_events (
  id         BIGSERIAL PRIMARY KEY,
  owner_key  TEXT NOT NULL,
  event      TEXT NOT NULL CHECK (event IN ('link_created', 'link_replaced', 'link_revoked', 'link_expiry', 'opened',
                                            'availability', 'replied', 'reply_sent', 'reply_dismissed',
                                            'correction', 'correction_applied', 'correction_dismissed',
                                            'location_report', 'rate', 'reminder_sent', 'reminder_failed', 'status')),
  board_id   UUID,
  detail     JSONB NOT NULL DEFAULT '{}'::jsonb,
  actor      UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS owner_events_key_idx ON public.owner_events (owner_key, created_at DESC);
ALTER TABLE public.owner_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS owner_events_admin_read ON public.owner_events;
CREATE POLICY owner_events_admin_read ON public.owner_events FOR SELECT USING (public.is_admin());
REVOKE ALL ON public.owner_events FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.owner_events FROM authenticated;
GRANT SELECT ON public.owner_events TO authenticated;

CREATE OR REPLACE FUNCTION public.owner_event(p_key TEXT, p_event TEXT, p_board UUID DEFAULT NULL, p_detail JSONB DEFAULT '{}'::jsonb)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.owner_events (owner_key, event, board_id, detail, actor)
  SELECT p_key, p_event, p_board, COALESCE(p_detail, '{}'::jsonb), auth.uid() WHERE p_key IS NOT NULL;
$$;
REVOKE ALL ON FUNCTION public.owner_event(TEXT, TEXT, UUID, JSONB) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.owner_links_log()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN PERFORM public.owner_event(NEW.owner_key, 'link_created'); RETURN NEW; END IF;
  IF NEW.token IS DISTINCT FROM OLD.token THEN PERFORM public.owner_event(NEW.owner_key, 'link_replaced'); END IF;
  IF NEW.revoked_at IS NOT NULL AND OLD.revoked_at IS NULL THEN PERFORM public.owner_event(NEW.owner_key, 'link_revoked'); END IF;
  IF NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN
    PERFORM public.owner_event(NEW.owner_key, 'link_expiry', NULL, jsonb_build_object('expires_at', NEW.expires_at));
  END IF;
  -- An open counts once an hour, so reloading the page doesn't flood the history.
  IF NEW.last_opened_at IS DISTINCT FROM OLD.last_opened_at
     AND (OLD.last_opened_at IS NULL OR NEW.last_opened_at > OLD.last_opened_at + INTERVAL '1 hour') THEN
    PERFORM public.owner_event(NEW.owner_key, 'opened');
  END IF;
  -- Reminders are logged by the server job once it knows the email went (owner_reminder_result).
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS owner_links_log ON public.owner_links;
CREATE TRIGGER owner_links_log AFTER INSERT OR UPDATE ON public.owner_links FOR EACH ROW EXECUTE FUNCTION public.owner_links_log();

CREATE OR REPLACE FUNCTION public.owner_link_replies_log()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'pending' AND (TG_OP = 'INSERT' OR NEW.updated_at IS DISTINCT FROM OLD.updated_at) THEN
    PERFORM public.owner_event(NEW.owner_key, 'replied',
      (SELECT board_id FROM public.availability_requests WHERE id = NEW.request_id),
      jsonb_build_object('request_id', NEW.request_id, 'available', NEW.available));
  ELSIF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('sent', 'dismissed') THEN
    PERFORM public.owner_event(NEW.owner_key, CASE WHEN NEW.status = 'sent' THEN 'reply_sent' ELSE 'reply_dismissed' END,
      NULL, jsonb_build_object('request_id', NEW.request_id));
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS owner_link_replies_log ON public.owner_link_replies;
CREATE TRIGGER owner_link_replies_log AFTER INSERT OR UPDATE ON public.owner_link_replies FOR EACH ROW EXECUTE FUNCTION public.owner_link_replies_log();

CREATE OR REPLACE FUNCTION public.owner_board_edits_log()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'pending' AND (TG_OP = 'INSERT' OR NEW.updated_at IS DISTINCT FROM OLD.updated_at) THEN
    PERFORM public.owner_event(NEW.owner_key, 'correction', NEW.board_id,
      jsonb_build_object('changes', NEW.changes, 'photo', NEW.photo_url IS NOT NULL));
  ELSIF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('applied', 'dismissed') THEN
    PERFORM public.owner_event(NEW.owner_key, CASE WHEN NEW.status = 'applied' THEN 'correction_applied' ELSE 'correction_dismissed' END, NEW.board_id);
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS owner_board_edits_log ON public.owner_board_edits;
CREATE TRIGGER owner_board_edits_log AFTER INSERT OR UPDATE ON public.owner_board_edits FOR EACH ROW EXECUTE FUNCTION public.owner_board_edits_log();

-- ── 5. Availability history ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.board_availability_log (
  id             BIGSERIAL PRIMARY KEY,
  board_id       UUID NOT NULL REFERENCES public.boards(id) ON DELETE CASCADE,
  old_status     TEXT,
  new_status     TEXT,
  available_from DATE,
  source         TEXT NOT NULL CHECK (source IN ('owner_link', 'admin', 'owner', 'system')),
  owner_key      TEXT,
  actor          UUID,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS board_availability_log_board_idx ON public.board_availability_log (board_id, created_at DESC);
ALTER TABLE public.board_availability_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS board_availability_log_admin_read ON public.board_availability_log;
CREATE POLICY board_availability_log_admin_read ON public.board_availability_log FOR SELECT USING (public.is_admin());
REVOKE ALL ON public.board_availability_log FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.board_availability_log FROM authenticated;
GRANT SELECT ON public.board_availability_log TO authenticated;

CREATE OR REPLACE FUNCTION public.boards_availability_log()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_src TEXT := NULLIF(current_setting('ooh.actor', true), '');
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status AND NEW.available_from IS NOT DISTINCT FROM OLD.available_from
     AND NEW.availability_checked_at IS NOT DISTINCT FROM OLD.availability_checked_at THEN
    RETURN NEW;
  END IF;
  IF v_src IS NULL THEN
    v_src := CASE WHEN auth.uid() IS NULL THEN 'system' WHEN public.is_admin() THEN 'admin' ELSE 'owner' END;
  END IF;
  INSERT INTO public.board_availability_log (board_id, old_status, new_status, available_from, source, owner_key, actor)
  VALUES (NEW.id, OLD.status, NEW.status, NEW.available_from, v_src, public.board_owner_key(NEW.id), auth.uid());
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS boards_availability_log ON public.boards;
CREATE TRIGGER boards_availability_log AFTER UPDATE OF status, available_from, availability_checked_at ON public.boards
  FOR EACH ROW EXECUTE FUNCTION public.boards_availability_log();

-- ── 6. Private current rates ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.board_owner_rates (
  board_id     UUID PRIMARY KEY REFERENCES public.boards(id) ON DELETE CASCADE,
  rate_monthly NUMERIC(14,2) NOT NULL CHECK (rate_monthly > 0 AND rate_monthly < 1e11),
  source       TEXT NOT NULL CHECK (source IN ('owner_link', 'admin')),
  owner_key    TEXT,
  note         TEXT CHECK (note IS NULL OR length(note) <= 300),
  updated_by   UUID,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.board_owner_rates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS board_owner_rates_admin ON public.board_owner_rates;
CREATE POLICY board_owner_rates_admin ON public.board_owner_rates FOR SELECT USING (public.is_admin());
REVOKE ALL ON public.board_owner_rates FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.board_owner_rates FROM authenticated;
GRANT SELECT ON public.board_owner_rates TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_set_board_rate(p_board_id UUID, p_rate NUMERIC, p_note TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admins only' USING ERRCODE = '42501'; END IF;
  IF p_rate IS NULL THEN DELETE FROM public.board_owner_rates WHERE board_id = p_board_id; RETURN; END IF;
  IF p_rate <= 0 THEN RAISE EXCEPTION 'The rate must be more than zero' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.board_owner_rates (board_id, rate_monthly, source, owner_key, note, updated_by)
  VALUES (p_board_id, round(p_rate, 2), 'admin', public.board_owner_key(p_board_id), left(NULLIF(trim(p_note), ''), 300), auth.uid())
  ON CONFLICT (board_id) DO UPDATE SET rate_monthly = EXCLUDED.rate_monthly, source = 'admin', owner_key = EXCLUDED.owner_key,
    note = EXCLUDED.note, updated_by = auth.uid(), updated_at = NOW();
END;
$$;

-- The weekly check (053), now traceable and with an optional current rate per board:
-- p_updates = [{id, status: available|booked|unavailable, available_from, rate?}]
CREATE OR REPLACE FUNCTION public.owner_link_update_boards(p_token TEXT, p_updates JSONB)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_key   TEXT := public.owner_link_key(p_token);
  v_item  JSONB;
  v_id    UUID;
  v_stat  TEXT;
  v_from  DATE;
  v_rate  NUMERIC;
  v_n     INTEGER := 0;
BEGIN
  IF v_key IS NULL THEN RAISE EXCEPTION 'This link is not valid any more' USING ERRCODE = '42501'; END IF;
  IF jsonb_typeof(p_updates) <> 'array' OR jsonb_array_length(p_updates) > 500 THEN
    RAISE EXCEPTION 'Nothing to save' USING ERRCODE = '22023';
  END IF;
  PERFORM set_config('ooh.actor', 'owner_link', true);
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_updates) LOOP
    v_id   := (v_item->>'id')::uuid;
    v_stat := v_item->>'status';
    v_from := NULLIF(v_item->>'available_from', '')::date;
    IF v_stat NOT IN ('available', 'booked', 'unavailable') THEN
      RAISE EXCEPTION 'Unknown status' USING ERRCODE = '22023';
    END IF;
    IF v_stat = 'booked' AND v_from IS NULL THEN
      RAISE EXCEPTION 'Add the date a booked board is free again' USING ERRCODE = '22023';
    END IF;
    BEGIN
      v_rate := NULLIF(btrim(COALESCE(v_item->>'rate', '')), '')::numeric;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'The monthly rate must be a number' USING ERRCODE = '22023';
    END;
    IF v_rate IS NOT NULL AND (v_rate <= 0 OR v_rate >= 1e11) THEN
      RAISE EXCEPTION 'The monthly rate must be more than zero' USING ERRCODE = '22023';
    END IF;
    -- Only this owner's boards, and never a removed board.
    UPDATE public.boards
       SET status = v_stat,
           available_from = CASE WHEN v_stat = 'booked' THEN v_from ELSE NULL END,
           availability_checked_at = NOW()
     WHERE id = v_id AND status <> 'decommissioned' AND public.board_owner_key(id) = v_key;
    IF FOUND THEN
      v_n := v_n + 1;
      PERFORM public.owner_event(v_key, 'availability', v_id, jsonb_build_object('status', v_stat, 'available_from', v_from));
      IF v_rate IS NOT NULL THEN
        INSERT INTO public.board_owner_rates (board_id, rate_monthly, source, owner_key)
        VALUES (v_id, round(v_rate, 2), 'owner_link', v_key)
        ON CONFLICT (board_id) DO UPDATE SET rate_monthly = EXCLUDED.rate_monthly, source = 'owner_link',
          owner_key = EXCLUDED.owner_key, note = NULL, updated_by = NULL, updated_at = NOW();
        PERFORM public.owner_event(v_key, 'rate', v_id);   -- the amount stays in board_owner_rates only
      END IF;
    END IF;
  END LOOP;
  UPDATE public.owner_links SET last_saved_at = NOW() WHERE owner_key = v_key;
  RETURN v_n;
END;
$$;

-- ── 7. Owners report a wrong map location ────────────────────────────────
ALTER TABLE public.owner_board_edits ADD COLUMN IF NOT EXISTS location_note TEXT CHECK (location_note IS NULL OR length(location_note) <= 500);
ALTER TABLE public.owner_board_edits ADD COLUMN IF NOT EXISTS location_lat DOUBLE PRECISION CHECK (location_lat IS NULL OR location_lat BETWEEN 4 AND 14);
ALTER TABLE public.owner_board_edits ADD COLUMN IF NOT EXISTS location_lng DOUBLE PRECISION CHECK (location_lng IS NULL OR location_lng BETWEEN 2.6 AND 14.8);

CREATE OR REPLACE FUNCTION public.owner_link_report_location(p_token TEXT, p_board_id UUID, p_note TEXT, p_lat DOUBLE PRECISION, p_lng DOUBLE PRECISION)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_key  TEXT := public.owner_link_key(p_token);
  v_note TEXT := left(NULLIF(trim(COALESCE(p_note, '')), ''), 500);
  v_name TEXT;
BEGIN
  IF v_key IS NULL THEN RAISE EXCEPTION 'This link is not valid any more' USING ERRCODE = '42501'; END IF;
  SELECT name INTO v_name FROM public.boards WHERE id = p_board_id AND status <> 'decommissioned';
  IF NOT FOUND OR public.board_owner_key(p_board_id) IS DISTINCT FROM v_key THEN
    RAISE EXCEPTION 'Board not found' USING ERRCODE = '22023';
  END IF;
  IF (p_lat IS NULL) <> (p_lng IS NULL) THEN RAISE EXCEPTION 'Send both latitude and longitude' USING ERRCODE = '22023'; END IF;
  IF p_lat IS NOT NULL AND (p_lat NOT BETWEEN 4 AND 14 OR p_lng NOT BETWEEN 2.6 AND 14.8) THEN
    RAISE EXCEPTION 'That point is not in Nigeria' USING ERRCODE = '22023';
  END IF;
  IF v_note IS NULL AND p_lat IS NULL THEN RAISE EXCEPTION 'Say where the board really is' USING ERRCODE = '22023'; END IF;

  INSERT INTO public.owner_board_edits (board_id, owner_key, location_note, location_lat, location_lng)
  VALUES (p_board_id, v_key, v_note, p_lat, p_lng)
  ON CONFLICT (board_id) DO UPDATE SET
    owner_key = EXCLUDED.owner_key, location_note = EXCLUDED.location_note,
    location_lat = EXCLUDED.location_lat, location_lng = EXCLUDED.location_lng,
    -- keep any other correction still waiting; start fresh if the last one was decided
    changes   = CASE WHEN public.owner_board_edits.status = 'pending' THEN public.owner_board_edits.changes ELSE '{}'::jsonb END,
    photo_url = CASE WHEN public.owner_board_edits.status = 'pending' THEN public.owner_board_edits.photo_url END,
    note      = CASE WHEN public.owner_board_edits.status = 'pending' THEN public.owner_board_edits.note END,
    status = 'pending', updated_at = NOW(), reviewed_by = NULL, reviewed_at = NULL;
  PERFORM public.owner_event(v_key, 'location_report', p_board_id, jsonb_build_object('note', v_note, 'lat', p_lat, 'lng', p_lng));
  UPDATE public.owner_links SET last_saved_at = NOW() WHERE owner_key = v_key;
  INSERT INTO public.notifications (recipient_role, recipient_user_id, type, title, body, link)
  VALUES ('admin', NULL, 'availability_response', 'An owner says ' || COALESCE(v_name, 'a board') || ' is in the wrong place',
          'Check the location and move the pin', '/dashboard/admin/needs-checking');
END;
$$;
REVOKE ALL ON FUNCTION public.owner_link_report_location(TEXT, UUID, TEXT, DOUBLE PRECISION, DOUBLE PRECISION) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.owner_link_report_location(TEXT, UUID, TEXT, DOUBLE PRECISION, DOUBLE PRECISION) TO anon, authenticated;

-- 056, plus the reported map point (applied only if the admin applies the correction).
CREATE OR REPLACE FUNCTION public.admin_decide_owner_board_edit(p_board_id UUID, p_apply BOOLEAN)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_e public.owner_board_edits%ROWTYPE;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admins only' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_e FROM public.owner_board_edits WHERE board_id = p_board_id AND status = 'pending' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No correction is waiting for this board' USING ERRCODE = '22023'; END IF;

  IF p_apply THEN
    UPDATE public.boards b SET
      name        = COALESCE(v_e.changes->>'name', b.name),
      area        = CASE WHEN v_e.changes ? 'area' THEN NULLIF(v_e.changes->>'area', '') ELSE b.area END,
      address     = COALESCE(v_e.changes->>'address', b.address),
      width       = COALESCE((v_e.changes->>'width')::numeric, b.width),
      height      = COALESCE((v_e.changes->>'height')::numeric, b.height),
      illuminated = COALESCE((v_e.changes->>'illuminated')::boolean, b.illuminated),
      photo_urls  = CASE WHEN v_e.photo_url IS NULL THEN b.photo_urls
                         ELSE array_prepend(v_e.photo_url, array_remove(COALESCE(b.photo_urls, '{}'), v_e.photo_url)) END,
      latitude    = COALESCE(v_e.location_lat, b.latitude),
      longitude   = COALESCE(v_e.location_lng, b.longitude)
    WHERE b.id = p_board_id;
  END IF;

  UPDATE public.owner_board_edits
     SET status = CASE WHEN p_apply THEN 'applied' ELSE 'dismissed' END, reviewed_by = auth.uid(), reviewed_at = NOW(), updated_at = NOW()
   WHERE board_id = p_board_id;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_decide_owner_board_edit(UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_decide_owner_board_edit(UUID, BOOLEAN) TO authenticated;

-- Needs checking list (056) with the location report.
CREATE OR REPLACE FUNCTION public.admin_owner_board_edits()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admins only' USING ERRCODE = '42501'; END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'board_id', e.board_id, 'owner_key', e.owner_key,
      'owner_name', (SELECT l.owner_name FROM public.owner_links l WHERE l.owner_key = e.owner_key),
      'changes', e.changes, 'photo_url', e.photo_url, 'note', e.note, 'updated_at', e.updated_at,
      'location_note', e.location_note, 'location_lat', e.location_lat, 'location_lng', e.location_lng,
      'now', jsonb_build_object('name', b.name, 'area', b.area, 'city', b.city, 'address', b.address, 'width', b.width,
        'height', b.height, 'illuminated', b.illuminated, 'photo', b.photo_urls[1],
        'latitude', b.latitude, 'longitude', b.longitude))
      ORDER BY e.updated_at)
    FROM public.owner_board_edits e JOIN public.boards b ON b.id = e.board_id
   WHERE e.status = 'pending'), '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_owner_board_edits() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_owner_board_edits() TO authenticated;

-- ── 8. Admin: owners ─────────────────────────────────────────────────────
-- Create (p_id NULL) or edit an owner. p = {name, legal_name, rc_number, address, website, notes}
CREATE OR REPLACE FUNCTION public.admin_save_media_owner(p_id UUID, p JSONB)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_name TEXT := regexp_replace(btrim(COALESCE(p->>'name', '')), '\s+', ' ', 'g');
  v_id   UUID;
  v_key  TEXT;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admins only' USING ERRCODE = '42501'; END IF;
  IF length(v_name) < 2 OR length(v_name) > 200 THEN RAISE EXCEPTION 'Type the owner''s name' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM public.media_owners WHERE lower(btrim(name)) = lower(v_name) AND id IS DISTINCT FROM p_id) THEN
    RAISE EXCEPTION 'An owner with this name already exists' USING ERRCODE = '23505';
  END IF;
  IF p_id IS NULL THEN
    v_key := public.owner_name_key(v_name);
    IF EXISTS (SELECT 1 FROM public.media_owners WHERE owner_key = v_key) THEN v_key := 'mo:' || gen_random_uuid()::text; END IF;
    INSERT INTO public.media_owners (owner_key, name, created_by) VALUES (v_key, v_name, auth.uid()) RETURNING id INTO v_id;
  ELSE
    v_id := p_id;
    IF NOT EXISTS (SELECT 1 FROM public.media_owners WHERE id = v_id) THEN RAISE EXCEPTION 'Owner not found' USING ERRCODE = '22023'; END IF;
  END IF;
  UPDATE public.media_owners SET
    name       = v_name,
    legal_name = left(NULLIF(btrim(COALESCE(p->>'legal_name', '')), ''), 200),
    rc_number  = left(NULLIF(btrim(COALESCE(p->>'rc_number', '')), ''), 40),
    address    = left(NULLIF(btrim(COALESCE(p->>'address', '')), ''), 300),
    website    = left(NULLIF(btrim(COALESCE(p->>'website', '')), ''), 200),
    notes      = left(NULLIF(btrim(COALESCE(p->>'notes', '')), ''), 2000),
    updated_at = NOW()
  WHERE id = v_id RETURNING owner_key INTO v_key;
  -- Keep the name shown elsewhere in step (boards keep their owner: the record id doesn't change).
  UPDATE public.board_owner_names n SET owner_name = v_name
    FROM public.boards b WHERE b.id = n.board_id AND b.media_owner_id = v_id AND n.owner_name IS DISTINCT FROM v_name;
  UPDATE public.owner_links SET owner_name = v_name WHERE owner_key = v_key AND owner_name IS DISTINCT FROM v_name;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_media_owner_status(p_id UUID, p_status TEXT, p_note TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_key TEXT;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admins only' USING ERRCODE = '42501'; END IF;
  IF p_status NOT IN ('unreviewed', 'approved', 'rejected', 'suspended') THEN RAISE EXCEPTION 'Unknown status' USING ERRCODE = '22023'; END IF;
  UPDATE public.media_owners SET status = p_status, status_note = left(NULLIF(trim(p_note), ''), 500),
         status_at = NOW(), status_by = auth.uid(), updated_at = NOW()
   WHERE id = p_id RETURNING owner_key INTO v_key;
  IF v_key IS NULL THEN RAISE EXCEPTION 'Owner not found' USING ERRCODE = '22023'; END IF;
  PERFORM public.owner_event(v_key, 'status', NULL, jsonb_build_object('status', p_status, 'note', left(NULLIF(trim(p_note), ''), 500)));
END;
$$;

-- Give boards to an owner (or p_owner_id NULL: owner not known). Returns how many changed.
CREATE OR REPLACE FUNCTION public.admin_assign_owner(p_board_ids UUID[], p_owner_id UUID)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_name TEXT; v_n INTEGER;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admins only' USING ERRCODE = '42501'; END IF;
  IF p_board_ids IS NULL OR cardinality(p_board_ids) = 0 OR cardinality(p_board_ids) > 1000 THEN
    RAISE EXCEPTION 'Pick between 1 and 1000 boards' USING ERRCODE = '22023';
  END IF;
  IF p_owner_id IS NULL THEN
    DELETE FROM public.board_owner_names WHERE board_id = ANY (p_board_ids);
    UPDATE public.boards SET media_owner_id = NULL WHERE id = ANY (p_board_ids) AND media_owner_id IS NOT NULL;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RETURN v_n;
  END IF;
  SELECT name INTO v_name FROM public.media_owners WHERE id = p_owner_id;
  IF v_name IS NULL THEN RAISE EXCEPTION 'Owner not found' USING ERRCODE = '22023'; END IF;
  UPDATE public.boards SET media_owner_id = p_owner_id WHERE id = ANY (p_board_ids) AND media_owner_id IS DISTINCT FROM p_owner_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO public.board_owner_names (board_id, owner_name, updated_by, updated_at)
  SELECT b.id, v_name, auth.uid(), NOW() FROM public.boards b WHERE b.id = ANY (p_board_ids)
  ON CONFLICT (board_id) DO UPDATE SET owner_name = EXCLUDED.owner_name, updated_by = EXCLUDED.updated_by, updated_at = NOW();
  RETURN v_n;
END;
$$;

-- Fold a duplicate owner into another: boards, contacts, link, history and rates move over.
CREATE OR REPLACE FUNCTION public.admin_merge_media_owners(p_keep UUID, p_drop UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE k public.media_owners%ROWTYPE; d public.media_owners%ROWTYPE;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admins only' USING ERRCODE = '42501'; END IF;
  IF p_keep = p_drop THEN RAISE EXCEPTION 'Pick two different owners' USING ERRCODE = '22023'; END IF;
  SELECT * INTO k FROM public.media_owners WHERE id = p_keep FOR UPDATE;
  SELECT * INTO d FROM public.media_owners WHERE id = p_drop FOR UPDATE;
  IF k.id IS NULL OR d.id IS NULL THEN RAISE EXCEPTION 'Owner not found' USING ERRCODE = '22023'; END IF;

  UPDATE public.boards SET media_owner_id = k.id WHERE media_owner_id = d.id;
  UPDATE public.board_owner_names n SET owner_name = k.name FROM public.boards b WHERE b.id = n.board_id AND b.media_owner_id = k.id;
  UPDATE public.owner_sales_contacts SET owner_key = k.owner_key WHERE owner_key = d.owner_key;
  UPDATE public.owner_link_replies   SET owner_key = k.owner_key WHERE owner_key = d.owner_key;
  UPDATE public.owner_board_edits    SET owner_key = k.owner_key WHERE owner_key = d.owner_key;
  UPDATE public.owner_events         SET owner_key = k.owner_key WHERE owner_key = d.owner_key;
  UPDATE public.board_owner_rates    SET owner_key = k.owner_key WHERE owner_key = d.owner_key;
  IF EXISTS (SELECT 1 FROM public.owner_links WHERE owner_key = k.owner_key) THEN
    UPDATE public.owner_links SET revoked_at = COALESCE(revoked_at, NOW()) WHERE owner_key = d.owner_key;
    DELETE FROM public.owner_links WHERE owner_key = d.owner_key;
  ELSE
    UPDATE public.owner_links SET owner_key = k.owner_key, owner_name = k.name WHERE owner_key = d.owner_key;
  END IF;
  UPDATE public.media_owners SET
    legal_name = COALESCE(k.legal_name, d.legal_name), rc_number = COALESCE(k.rc_number, d.rc_number),
    address = COALESCE(k.address, d.address), website = COALESCE(k.website, d.website),
    account_id = COALESCE(k.account_id, d.account_id),
    notes = NULLIF(concat_ws(E'\n', k.notes, d.notes), ''), updated_at = NOW()
   WHERE id = k.id;
  DELETE FROM public.media_owners WHERE id = d.id;
  PERFORM public.owner_event(k.owner_key, 'status', NULL, jsonb_build_object('merged', d.name));
END;
$$;

-- Add, edit (p_id) or delete (p_delete) one contact person of an owner.
CREATE OR REPLACE FUNCTION public.admin_save_owner_contact(p_owner_id UUID, p_id UUID, p JSONB, p_delete BOOLEAN DEFAULT false)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_key   TEXT;
  v_id    UUID := p_id;
  v_email TEXT := lower(NULLIF(btrim(COALESCE(p->>'email', '')), ''));
  v_phone TEXT := NULLIF(btrim(COALESCE(p->>'phone', '')), '');
  v_name  TEXT := NULLIF(btrim(COALESCE(p->>'name', '')), '');
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admins only' USING ERRCODE = '42501'; END IF;
  SELECT owner_key INTO v_key FROM public.media_owners WHERE id = p_owner_id;
  IF v_key IS NULL THEN RAISE EXCEPTION 'Owner not found' USING ERRCODE = '22023'; END IF;
  IF p_delete THEN DELETE FROM public.owner_sales_contacts WHERE id = p_id AND owner_key = v_key; RETURN p_id; END IF;
  IF v_name IS NULL AND v_phone IS NULL AND v_email IS NULL THEN RAISE EXCEPTION 'Add a name, phone or email' USING ERRCODE = '22023'; END IF;
  IF v_email IS NOT NULL AND v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN RAISE EXCEPTION 'That email address doesn''t look right' USING ERRCODE = '22023'; END IF;
  IF v_phone IS NOT NULL AND length(regexp_replace(v_phone, '\D', '', 'g')) NOT BETWEEN 7 AND 15 THEN
    RAISE EXCEPTION 'That phone number doesn''t look right' USING ERRCODE = '22023';
  END IF;
  IF COALESCE((p->>'is_primary')::boolean, false) THEN
    UPDATE public.owner_sales_contacts SET is_primary = false WHERE owner_key = v_key AND id IS DISTINCT FROM p_id;
  END IF;
  IF v_id IS NULL THEN
    INSERT INTO public.owner_sales_contacts (owner_key, contact_name, contact_phone, email, role, is_primary, notes, created_by)
    VALUES (v_key, COALESCE(v_name, ''), COALESCE(v_phone, ''), v_email, left(NULLIF(btrim(COALESCE(p->>'role', '')), ''), 80),
            COALESCE((p->>'is_primary')::boolean, false), left(NULLIF(btrim(COALESCE(p->>'notes', '')), ''), 500), auth.uid())
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.owner_sales_contacts SET contact_name = COALESCE(v_name, ''), contact_phone = COALESCE(v_phone, ''), email = v_email,
           role = left(NULLIF(btrim(COALESCE(p->>'role', '')), ''), 80), is_primary = COALESCE((p->>'is_primary')::boolean, false),
           notes = left(NULLIF(btrim(COALESCE(p->>'notes', '')), ''), 500), last_used_at = NOW()
     WHERE id = v_id AND owner_key = v_key;
    IF NOT FOUND THEN RAISE EXCEPTION 'Contact not found' USING ERRCODE = '22023'; END IF;
  END IF;
  RETURN v_id;
END;
$$;

-- One row per owner for the Owners page.
CREATE OR REPLACE FUNCTION public.admin_media_owners()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admins only' USING ERRCODE = '42501'; END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(row_to_json(x)::jsonb ORDER BY x.boards DESC, x.name)
    FROM (
      SELECT m.id, m.owner_key, m.name, m.legal_name, m.rc_number, m.address, m.website, m.notes,
             m.status, m.status_note, m.status_at, m.account_id, m.created_at,
             (SELECT COUNT(*) FROM public.boards b WHERE b.media_owner_id = m.id AND b.status <> 'decommissioned')::int AS boards,
             (SELECT COUNT(*) FROM public.boards b WHERE b.media_owner_id = m.id AND b.status <> 'decommissioned'
                 AND (b.availability_checked_at IS NULL OR b.availability_checked_at < NOW() - INTERVAL '7 days'))::int AS stale,
             (SELECT COUNT(*) FROM public.boards b WHERE b.media_owner_id = m.id AND b.status <> 'decommissioned'
                 AND NOT EXISTS (SELECT 1 FROM public.board_owner_rates r WHERE r.board_id = b.id AND r.updated_at > NOW() - INTERVAL '90 days'))::int AS unpriced,
             (SELECT COUNT(*) FROM public.boards b WHERE b.media_owner_id = m.id AND b.contact_phone IS NOT NULL AND btrim(b.contact_phone) <> '')::int AS boards_with_phone,
             COALESCE((SELECT jsonb_agg(jsonb_build_object('id', c.id, 'name', c.contact_name, 'phone', c.contact_phone, 'email', c.email,
                       'role', c.role, 'is_primary', c.is_primary, 'notes', c.notes) ORDER BY c.is_primary DESC, c.last_used_at DESC)
                       FROM public.owner_sales_contacts c WHERE c.owner_key = m.owner_key), '[]'::jsonb) AS contacts,
             l.token IS NOT NULL AS has_link,
             CASE WHEN l.token IS NULL THEN 'none' WHEN l.revoked_at IS NOT NULL THEN 'revoked'
                  WHEN l.expires_at IS NOT NULL AND l.expires_at <= NOW() THEN 'expired' ELSE 'active' END AS link_state,
             l.expires_at, l.email AS reminder_email, l.last_opened_at, l.last_saved_at, l.last_reminded_at,
             (SELECT MAX(e.created_at) FROM public.owner_events e WHERE e.owner_key = m.owner_key
                 AND e.event IN ('availability', 'replied', 'correction', 'location_report', 'rate')) AS last_response_at,
             (SELECT COUNT(*) FROM public.availability_requests r JOIN public.boards b ON b.id = r.board_id
               WHERE b.media_owner_id = m.id AND r.stage = 'requested'
                 AND NOT EXISTS (SELECT 1 FROM public.owner_link_replies x WHERE x.request_id = r.id))::int AS waiting_requests,
             (SELECT MIN(r.created_at) FROM public.availability_requests r JOIN public.boards b ON b.id = r.board_id
               WHERE b.media_owner_id = m.id AND r.stage = 'requested'
                 AND NOT EXISTS (SELECT 1 FROM public.owner_link_replies x WHERE x.request_id = r.id)) AS oldest_waiting_at
        FROM public.media_owners m
        LEFT JOIN public.owner_links l ON l.owner_key = m.owner_key
    ) x), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_owner_history(p_owner_id UUID, p_limit INTEGER DEFAULT 100)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_key TEXT;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admins only' USING ERRCODE = '42501'; END IF;
  SELECT owner_key INTO v_key FROM public.media_owners WHERE id = p_owner_id;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object('event', e.event, 'at', e.created_at, 'board', b.name, 'detail', e.detail) ORDER BY e.created_at DESC)
      FROM (SELECT * FROM public.owner_events WHERE owner_key = v_key ORDER BY created_at DESC LIMIT LEAST(GREATEST(p_limit, 1), 500)) e
      LEFT JOIN public.boards b ON b.id = e.board_id), '[]'::jsonb);
END;
$$;

-- ── 9. Archive / restore ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_archive_boards(p_board_ids UUID[], p_archive BOOLEAN)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_n INTEGER;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admins only' USING ERRCODE = '42501'; END IF;
  IF p_board_ids IS NULL OR cardinality(p_board_ids) = 0 OR cardinality(p_board_ids) > 1000 THEN
    RAISE EXCEPTION 'Pick between 1 and 1000 boards' USING ERRCODE = '22023';
  END IF;
  IF p_archive THEN
    UPDATE public.boards SET archived_status = status, status = 'decommissioned', archived_at = NOW()
     WHERE id = ANY (p_board_ids) AND status <> 'decommissioned';
  ELSE
    UPDATE public.boards SET status = COALESCE(NULLIF(archived_status, 'decommissioned'), 'available'), archived_status = NULL, archived_at = NULL
     WHERE id = ANY (p_board_ids) AND status = 'decommissioned';
  END IF;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

-- ── 10. Reminders: never to a revoked, expired, suspended or rejected owner ──
CREATE OR REPLACE FUNCTION public.owner_reminders_due(p_owner_key TEXT DEFAULT NULL)
RETURNS TABLE (owner_key TEXT, owner_name TEXT, email TEXT, token TEXT, boards INTEGER, stale INTEGER, waiting INTEGER)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
BEGIN
  RETURN QUERY
  WITH l AS (
    SELECT * FROM public.owner_links ol
     WHERE ol.email IS NOT NULL AND (p_owner_key IS NULL OR ol.owner_key = p_owner_key)
       AND ol.revoked_at IS NULL AND (ol.expires_at IS NULL OR ol.expires_at > NOW())
       AND NOT EXISTS (SELECT 1 FROM public.media_owners m WHERE m.owner_key = ol.owner_key AND m.status IN ('suspended', 'rejected'))
  ), b AS (
    SELECT bo.id, bo.availability_checked_at AS checked, public.board_owner_key(bo.id) AS k
      FROM public.boards bo WHERE bo.status <> 'decommissioned'
  ), c AS (
    SELECT l.owner_key AS k, l.owner_name AS n, l.email AS e, l.token AS t, l.last_reminded_at AS r,
           (SELECT COUNT(*)::int FROM b WHERE b.k = l.owner_key) AS nb,
           (SELECT COUNT(*)::int FROM b WHERE b.k = l.owner_key AND (b.checked IS NULL OR b.checked < NOW() - INTERVAL '7 days')) AS ns,
           (SELECT COUNT(*)::int FROM public.availability_requests r
             WHERE r.stage = 'requested' AND r.board_id IN (SELECT b.id FROM b WHERE b.k = l.owner_key)
               AND NOT EXISTS (SELECT 1 FROM public.owner_link_replies x WHERE x.request_id = r.id)) AS nw
      FROM l
  )
  SELECT c.k, c.n, c.e, c.t, c.nb, c.ns, c.nw FROM c
   WHERE c.nb > 0
     AND (p_owner_key IS NOT NULL
          OR ((c.ns > 0 OR c.nw > 0) AND (c.r IS NULL OR c.r < NOW() - INTERVAL '6 days')));
END;
$$;
REVOKE ALL ON FUNCTION public.owner_reminders_due(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.owner_reminders_due(TEXT) TO service_role;

-- The server job records each reminder once it knows whether the email went (service role only).
DROP FUNCTION IF EXISTS public.owner_reminder_failed(TEXT, TEXT);
CREATE OR REPLACE FUNCTION public.owner_reminder_result(p_owner_key TEXT, p_ok BOOLEAN, p_email TEXT, p_error TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.owner_events (owner_key, event, detail)
  VALUES (p_owner_key, CASE WHEN p_ok THEN 'reminder_sent' ELSE 'reminder_failed' END,
          jsonb_strip_nulls(jsonb_build_object('email', left(p_email, 200), 'error', left(p_error, 300))));
$$;
REVOKE ALL ON FUNCTION public.owner_reminder_result(TEXT, BOOLEAN, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.owner_reminder_result(TEXT, BOOLEAN, TEXT, TEXT) TO service_role;

-- ── 11. Who may call what ────────────────────────────────────────────────
DO $$
DECLARE f TEXT;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.admin_revoke_owner_link(TEXT)', 'public.admin_set_owner_link_expiry(TEXT, DATE)',
    'public.admin_owner_link(TEXT, TEXT, BOOLEAN)', 'public.admin_set_board_rate(UUID, NUMERIC, TEXT)',
    'public.admin_save_media_owner(UUID, JSONB)', 'public.admin_set_media_owner_status(UUID, TEXT, TEXT)',
    'public.admin_assign_owner(UUID[], UUID)', 'public.admin_merge_media_owners(UUID, UUID)',
    'public.admin_save_owner_contact(UUID, UUID, JSONB, BOOLEAN)', 'public.admin_media_owners()',
    'public.admin_owner_history(UUID, INTEGER)', 'public.admin_archive_boards(UUID[], BOOLEAN)'
  ] LOOP
    EXECUTE 'REVOKE ALL ON FUNCTION ' || f || ' FROM PUBLIC, anon';
    EXECUTE 'GRANT EXECUTE ON FUNCTION ' || f || ' TO authenticated';
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.owner_link_update_boards(TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.owner_link_update_boards(TEXT, JSONB) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.owner_name_key(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_name_key(TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.board_owner_name_sync() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.owner_links_log() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.owner_link_replies_log() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.owner_board_edits_log() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.boards_availability_log() FROM PUBLIC, anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════
-- Rollback (run by hand if needed; boards keep their typed owner names):
--   DROP TRIGGER IF EXISTS boards_availability_log ON public.boards;
--   DROP TRIGGER IF EXISTS board_owner_names_sync ON public.board_owner_names;
--   DROP TRIGGER IF EXISTS owner_links_log ON public.owner_links;
--   DROP TRIGGER IF EXISTS owner_link_replies_log ON public.owner_link_replies;
--   DROP TRIGGER IF EXISTS owner_board_edits_log ON public.owner_board_edits;
--   Re-run 053, 055 and 056 to restore their functions, then:
--   ALTER TABLE public.boards DROP COLUMN media_owner_id, DROP COLUMN archived_at, DROP COLUMN archived_status;
--   DROP TABLE public.board_owner_rates, public.board_availability_log, public.owner_events, public.media_owners;
-- ═══════════════════════════════════════════════════════════════════
