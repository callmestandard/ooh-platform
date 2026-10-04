-- ═══════════════════════════════════════════════════════════════════
-- OOH Platform — agency vendor preferences + makegood tracking
-- Run in Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- Requires 030/032 (board_owner_match), 034 (board_owner_account,
-- availability requests), 035 (owner teams: board_team_match, is_owner_admin).
-- Safe to re-run: IF NOT EXISTS / CREATE OR REPLACE / DROP POLICY IF EXISTS.
--
-- 1. Vendor preferences are an agency's PRIVATE view of the media owners it
--    works with: preferred / direct / excluded. They change only what that
--    agency sees when discovering and shortlisting boards. Nobody else —
--    not another agency, not the owner, not a platform admin, not the public
--    — can read them, so an owner can never tell it was excluded or by whom.
--    Exclusion never touches bookings: an existing plan line from an
--    excluded owner keeps working exactly as before.
--
-- 2. Makegoods record what an owner promised when a board fell through or
--    under-delivered (a replacement, extra weeks, a credit) and whether it
--    was delivered. They are a RECORD only: nothing here changes a
--    negotiated rate, an invoice or an MPO. A credit is an amount on the
--    makegood, flagged for the agency to apply by hand.
--
-- Status values are TEXT + CHECK constraints, the same convention every
-- other table in this schema uses, rather than Postgres ENUM types.
-- ═══════════════════════════════════════════════════════════════════

-- ══ PART 1: VENDOR PREFERENCES ══════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.agency_vendor_preferences (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id  UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  owner_id   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  preference TEXT NOT NULL CHECK (preference IN ('preferred', 'direct', 'excluded')),
  notes      TEXT,
  created_by UUID DEFAULT auth.uid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- one preference per agency per owner; setting a new one replaces the old
  UNIQUE (agency_id, owner_id)
);
CREATE INDEX IF NOT EXISTS idx_vendor_prefs_agency ON public.agency_vendor_preferences(agency_id);

CREATE OR REPLACE FUNCTION public.touch_vendor_preference()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS vendor_preferences_touch ON public.agency_vendor_preferences;
CREATE TRIGGER vendor_preferences_touch BEFORE UPDATE ON public.agency_vendor_preferences
  FOR EACH ROW EXECUTE FUNCTION public.touch_vendor_preference();

ALTER TABLE public.agency_vendor_preferences ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "vendor_prefs_own" ON public.agency_vendor_preferences;
-- The owning agency, and nobody else. Deliberately no admin, owner or public
-- policy: with RLS on and no other policy, every other reader gets nothing.
CREATE POLICY "vendor_prefs_own" ON public.agency_vendor_preferences FOR ALL
  USING (agency_id = auth.uid() AND auth_role() = 'agency')
  WITH CHECK (agency_id = auth.uid() AND auth_role() = 'agency');

GRANT SELECT, INSERT, UPDATE, DELETE ON public.agency_vendor_preferences TO authenticated;

-- The media owners an agency can set a preference for: every owner account
-- with at least one board, with THIS agency's own preference (if any).
-- Agencies cannot read owner profiles directly, hence a definer function —
-- it returns only a display name and a board count, and only the caller's
-- own preferences.
CREATE OR REPLACE FUNCTION public.agency_media_partners()
RETURNS TABLE (owner_id UUID, owner_name TEXT, board_count INT, preference TEXT, notes TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT o.owner_id, COALESCE(p.company_name, p.full_name, 'Media owner'), o.n, v.preference, v.notes
  FROM (
    SELECT public.board_owner_account(b.id) AS owner_id, COUNT(*)::INT AS n
    FROM public.boards b
    WHERE b.status <> 'decommissioned'
    GROUP BY 1
  ) o
  JOIN public.profiles p ON p.id = o.owner_id
  LEFT JOIN public.agency_vendor_preferences v ON v.owner_id = o.owner_id AND v.agency_id = auth.uid()
  WHERE o.owner_id IS NOT NULL AND auth_role() = 'agency'
  ORDER BY 2;
$$;

-- For the caller's own preferences only: which boards belong to an owner it
-- has marked, so listings can flag preferred/direct boards and leave out
-- excluded ones. Returns nothing for anyone who is not an agency.
CREATE OR REPLACE FUNCTION public.agency_board_preferences()
RETURNS TABLE (board_id UUID, owner_id UUID, preference TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT b.id, v.owner_id, v.preference
  FROM public.agency_vendor_preferences v
  JOIN public.boards b ON public.board_owner_account(b.id) = v.owner_id
  WHERE v.agency_id = auth.uid() AND auth_role() = 'agency';
$$;

GRANT EXECUTE ON FUNCTION public.agency_media_partners() TO authenticated;
GRANT EXECUTE ON FUNCTION public.agency_board_preferences() TO authenticated;
GRANT EXECUTE ON FUNCTION public.board_owner_account(UUID) TO authenticated;

-- Availability requests are discovery too: an agency's request no longer
-- goes to an owner it has excluded. The owner simply receives nothing, so
-- it cannot tell. (Body otherwise unchanged from 034.)
CREATE OR REPLACE FUNCTION public.send_availability_request(
  p_title TEXT, p_cities TEXT[], p_formats TEXT[], p_start DATE, p_end DATE, p_budget NUMERIC, p_notes TEXT
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_name TEXT;
  v_request UUID;
BEGIN
  IF v_uid IS NULL OR auth_role() <> 'agency' THEN
    RAISE EXCEPTION 'only an agency account can send an availability request';
  END IF;
  IF p_title IS NULL OR trim(p_title) = '' THEN RAISE EXCEPTION 'a title is required'; END IF;
  IF p_cities IS NULL OR cardinality(p_cities) = 0 THEN RAISE EXCEPTION 'at least one city is required'; END IF;

  SELECT COALESCE(company_name, full_name) INTO v_name FROM public.profiles WHERE id = v_uid;

  INSERT INTO public.availability_requests (agency_id, agency_name, title, cities, formats, start_date, end_date, budget, notes)
  VALUES (v_uid, v_name, trim(p_title), p_cities, COALESCE(p_formats, '{}'), p_start, p_end, p_budget, NULLIF(trim(COALESCE(p_notes, '')), ''))
  RETURNING id INTO v_request;

  INSERT INTO public.availability_request_recipients (request_id, owner_id, owner_name, board_count)
  SELECT v_request, m.owner_id, COALESCE(p.company_name, p.full_name, 'Board owner'), m.n
  FROM (
    SELECT public.board_owner_account(b.id) AS owner_id, COUNT(*)::INT AS n
    FROM public.boards b
    WHERE public.board_matches_availability_request(b.id, v_request)
    GROUP BY 1
  ) m
  LEFT JOIN public.profiles p ON p.id = m.owner_id
  WHERE m.owner_id IS NOT NULL AND m.owner_id <> v_uid
    AND NOT EXISTS (
      SELECT 1 FROM public.agency_vendor_preferences x
      WHERE x.agency_id = v_uid AND x.owner_id = m.owner_id AND x.preference = 'excluded');

  INSERT INTO public.notifications (recipient_role, recipient_user_id, type, title, body, link)
  SELECT 'owner', r.owner_id, 'availability_request',
         'Availability request from ' || COALESCE(v_name, 'an agency'),
         trim(p_title) || ' — ' || r.board_count || ' of your boards match',
         '/dashboard/owner/availability-requests'
  FROM public.availability_request_recipients r
  WHERE r.request_id = v_request;

  RETURN v_request;
END;
$$;

-- ══ PART 2: MAKEGOODS ═══════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.makegoods (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- the plan line that fell through or under-delivered
  booking_id             UUID NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  campaign_id            UUID REFERENCES public.campaigns(id) ON DELETE SET NULL,
  reason                 TEXT NOT NULL CHECK (reason IN ('board_unavailable', 'late_posting', 'wrong_or_damaged_creative', 'poor_condition', 'other')),
  promised_by_owner_id   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  promised_remedy_type   TEXT NOT NULL CHECK (promised_remedy_type IN ('replacement_board', 'extension', 'credit', 'other')),
  promised_detail        TEXT,
  -- for a credit: the amount. Recorded only — never applied to a rate or invoice here.
  promised_value         NUMERIC CHECK (promised_value IS NULL OR promised_value >= 0),
  promised_on            DATE NOT NULL DEFAULT CURRENT_DATE,
  due_by                 DATE,
  status                 TEXT NOT NULL DEFAULT 'promised' CHECK (status IN ('promised', 'delivered', 'partially_delivered', 'disputed', 'waived')),
  delivered_on           DATE,
  -- the agency's notes; only the agency may write them
  notes                  TEXT,
  -- the owner side's notes; only the owner company may write them
  owner_notes            TEXT,
  -- where the remedy is a replacement site
  replacement_board_id   UUID REFERENCES public.boards(id) ON DELETE SET NULL,
  -- the board-swap record this came from: the replacement plan line
  -- (bookings.replaces_booking_id = booking_id), keeping swap and makegood linked
  replacement_booking_id UUID REFERENCES public.bookings(id) ON DELETE SET NULL,
  -- set by the agency when it has applied a credit by hand elsewhere
  credit_applied_at      TIMESTAMPTZ,
  created_by             UUID,
  updated_by             UUID,
  updated_by_name        TEXT,
  updated_by_side        TEXT CHECK (updated_by_side IN ('agency', 'owner', 'admin')),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_makegoods_booking  ON public.makegoods(booking_id);
CREATE INDEX IF NOT EXISTS idx_makegoods_campaign ON public.makegoods(campaign_id);
CREATE INDEX IF NOT EXISTS idx_makegoods_owner    ON public.makegoods(promised_by_owner_id);

-- Who is the caller to this booking? (definer: owners cannot read campaigns)
CREATE OR REPLACE FUNCTION public.makegood_side(p_booking_id UUID, p_uid UUID)
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN p_uid IS NULL THEN NULL
    WHEN EXISTS (SELECT 1 FROM public.bookings bk JOIN public.campaigns c ON c.id = bk.campaign_id
                 WHERE bk.id = p_booking_id AND c.agency_id = p_uid) THEN 'agency'
    WHEN EXISTS (SELECT 1 FROM public.bookings bk
                 WHERE bk.id = p_booking_id AND public.board_team_match(bk.board_id, p_uid)) THEN 'owner'
    ELSE NULL
  END;
$$;

-- Guard: who may change what, and a guaranteed history row for every change.
CREATE OR REPLACE FUNCTION public.guard_makegood()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_side TEXT;
  v_board UUID;
  v_campaign UUID;
BEGIN
  SELECT bk.board_id, bk.campaign_id INTO v_board, v_campaign FROM public.bookings bk WHERE bk.id = NEW.booking_id;

  -- service role / SQL editor: trusted
  IF v_uid IS NULL THEN
    IF TG_OP = 'INSERT' THEN
      NEW.campaign_id := COALESCE(NEW.campaign_id, v_campaign);
      NEW.promised_by_owner_id := COALESCE(NEW.promised_by_owner_id, public.board_owner_account(v_board));
    END IF;
    NEW.updated_at := NOW();
    RETURN NEW;
  END IF;

  v_side := CASE WHEN auth_role() = 'admin' THEN 'admin' ELSE public.makegood_side(NEW.booking_id, v_uid) END;
  IF v_side IS NULL THEN RAISE EXCEPTION 'you are not a party to this booking'; END IF;

  IF TG_OP = 'INSERT' THEN
    IF v_side NOT IN ('agency', 'admin') THEN
      RAISE EXCEPTION 'only the agency that owns the booking can record a makegood';
    END IF;
    NEW.campaign_id := v_campaign;
    NEW.promised_by_owner_id := public.board_owner_account(v_board);
    NEW.created_by := v_uid;
    NEW.owner_notes := NULL;
    NEW.credit_applied_at := NULL;
  ELSE
    IF NEW.booking_id IS DISTINCT FROM OLD.booking_id THEN
      RAISE EXCEPTION 'a makegood cannot be moved to another booking';
    END IF;
    NEW.campaign_id := OLD.campaign_id;
    NEW.promised_by_owner_id := OLD.promised_by_owner_id;
    NEW.created_by := OLD.created_by;
    NEW.created_at := OLD.created_at;

    IF v_side = 'owner' THEN
      -- The owner side may mark it delivered (fully or partly) and write its
      -- own note. Everything else — the promise itself, the agency's notes,
      -- disputing or waiving — is not theirs to change.
      IF NEW.reason IS DISTINCT FROM OLD.reason OR NEW.promised_remedy_type IS DISTINCT FROM OLD.promised_remedy_type
         OR NEW.promised_detail IS DISTINCT FROM OLD.promised_detail OR NEW.promised_value IS DISTINCT FROM OLD.promised_value
         OR NEW.promised_on IS DISTINCT FROM OLD.promised_on OR NEW.due_by IS DISTINCT FROM OLD.due_by
         OR NEW.replacement_board_id IS DISTINCT FROM OLD.replacement_board_id
         OR NEW.replacement_booking_id IS DISTINCT FROM OLD.replacement_booking_id
         OR NEW.credit_applied_at IS DISTINCT FROM OLD.credit_applied_at THEN
        RAISE EXCEPTION 'only the agency can change what was promised';
      END IF;
      IF NEW.notes IS DISTINCT FROM OLD.notes THEN
        RAISE EXCEPTION 'the agency''s notes can only be edited by the agency';
      END IF;
      IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status NOT IN ('delivered', 'partially_delivered') THEN
        RAISE EXCEPTION 'the owner can mark a makegood delivered or partially delivered; only the agency can dispute or waive it';
      END IF;
    ELSIF v_side = 'agency' THEN
      IF NEW.owner_notes IS DISTINCT FROM OLD.owner_notes THEN
        RAISE EXCEPTION 'the owner''s notes can only be edited by the owner';
      END IF;
    END IF;
  END IF;

  IF NEW.status IN ('delivered', 'partially_delivered') AND NEW.delivered_on IS NULL THEN
    NEW.delivered_on := CURRENT_DATE;
  END IF;

  NEW.updated_by := v_uid;
  NEW.updated_by_side := v_side;
  SELECT COALESCE(company_name, full_name) INTO NEW.updated_by_name FROM public.profiles WHERE id = v_uid;
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS makegoods_guard ON public.makegoods;
CREATE TRIGGER makegoods_guard BEFORE INSERT OR UPDATE ON public.makegoods
  FOR EACH ROW EXECUTE FUNCTION public.guard_makegood();

-- History + notifications, written by the database so a status change by
-- either side is always on record and always reaches the other side.
CREATE OR REPLACE FUNCTION public.log_makegood_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_board TEXT;
  v_board_id UUID;
  v_agency UUID;
  v_summary TEXT;
  v_assignee UUID;
BEGIN
  SELECT b.name, b.id, c.agency_id INTO v_board, v_board_id, v_agency
  FROM public.bookings bk
  LEFT JOIN public.boards b ON b.id = bk.board_id
  LEFT JOIN public.campaigns c ON c.id = bk.campaign_id
  WHERE bk.id = NEW.booking_id;

  IF TG_OP = 'INSERT' THEN
    v_summary := 'Makegood recorded for ' || COALESCE(v_board, 'a board') || ' — ' || replace(NEW.promised_remedy_type, '_', ' ') || ' promised';
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    v_summary := 'Makegood for ' || COALESCE(v_board, 'a board') || ' marked ' || replace(NEW.status, '_', ' ')
                 || ' by the ' || COALESCE(NEW.updated_by_side, 'system');
  ELSIF NEW.owner_notes IS DISTINCT FROM OLD.owner_notes THEN
    v_summary := 'Owner added a note on the makegood for ' || COALESCE(v_board, 'a board');
  ELSIF NEW.credit_applied_at IS DISTINCT FROM OLD.credit_applied_at THEN
    v_summary := 'Makegood credit for ' || COALESCE(v_board, 'a board') || CASE WHEN NEW.credit_applied_at IS NULL THEN ' marked not applied' ELSE ' marked as applied by the agency' END;
  ELSE
    v_summary := 'Makegood for ' || COALESCE(v_board, 'a board') || ' updated by the ' || COALESCE(NEW.updated_by_side, 'system');
  END IF;

  INSERT INTO public.activity_events (entity_type, entity_id, campaign_id, actor_id, actor_role, actor_name, action, summary, changes)
  -- entity_id is UUID in the live schema (the 003 file declares TEXT); a UUID value assigns to either
  VALUES ('makegood', NEW.id, NEW.campaign_id, NEW.updated_by, NEW.updated_by_side, NEW.updated_by_name,
          CASE WHEN TG_OP = 'INSERT' THEN 'makegood.created' WHEN NEW.status IS DISTINCT FROM OLD.status THEN 'makegood.status_changed' ELSE 'makegood.updated' END,
          v_summary,
          CASE WHEN TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status
               THEN jsonb_build_object('status', jsonb_build_object('from', OLD.status, 'to', NEW.status)) ELSE NULL END);

  -- tell the other side
  IF TG_OP = 'INSERT' OR NEW.updated_by_side = 'agency' THEN
    IF TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status THEN
      v_assignee := public.board_assignee(v_board_id);
      IF v_assignee IS NOT NULL THEN
        INSERT INTO public.notifications (recipient_role, recipient_user_id, type, title, body, link)
        VALUES (CASE WHEN v_assignee = NEW.promised_by_owner_id THEN 'owner' ELSE 'marketer' END, v_assignee, 'makegood',
                CASE WHEN TG_OP = 'INSERT' THEN 'A makegood was recorded against your board' ELSE 'Makegood ' || replace(NEW.status, '_', ' ') END,
                v_summary, '/dashboard/owner/makegoods');
      END IF;
    END IF;
  ELSIF NEW.updated_by_side = 'owner' AND v_agency IS NOT NULL THEN
    INSERT INTO public.notifications (recipient_role, recipient_user_id, type, title, body, link)
    VALUES ('agency', v_agency, 'makegood', 'Makegood updated by the owner', v_summary, '/dashboard/agency/makegoods');
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS makegoods_log ON public.makegoods;
CREATE TRIGGER makegoods_log AFTER INSERT OR UPDATE ON public.makegoods
  FOR EACH ROW EXECUTE FUNCTION public.log_makegood_change();

ALTER TABLE public.makegoods ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "makegoods_select" ON public.makegoods;
DROP POLICY IF EXISTS "makegoods_insert" ON public.makegoods;
DROP POLICY IF EXISTS "makegoods_update" ON public.makegoods;
DROP POLICY IF EXISTS "makegoods_delete" ON public.makegoods;
-- Both parties to the booking (agency; the owner company's admins and the
-- board's assigned marketer), and platform admin.
CREATE POLICY "makegoods_select" ON public.makegoods FOR SELECT USING (
  public.makegood_side(booking_id, auth.uid()) IS NOT NULL OR auth_role() = 'admin'
);
CREATE POLICY "makegoods_insert" ON public.makegoods FOR INSERT WITH CHECK (
  public.makegood_side(booking_id, auth.uid()) = 'agency' OR auth_role() = 'admin'
);
-- Either party may update the row; the guard trigger decides which columns.
CREATE POLICY "makegoods_update" ON public.makegoods FOR UPDATE
  USING (public.makegood_side(booking_id, auth.uid()) IS NOT NULL OR auth_role() = 'admin')
  WITH CHECK (public.makegood_side(booking_id, auth.uid()) IS NOT NULL OR auth_role() = 'admin');
-- A makegood is a record: it is closed (delivered / waived), not deleted.
CREATE POLICY "makegoods_delete" ON public.makegoods FOR DELETE USING (auth_role() = 'admin');

GRANT SELECT, INSERT, UPDATE ON public.makegoods TO authenticated;

-- History lives in activity_events, as for bookings, invoices and print tasks.
ALTER TABLE public.activity_events DROP CONSTRAINT IF EXISTS activity_events_entity_type_check;
ALTER TABLE public.activity_events
  ADD CONSTRAINT activity_events_entity_type_check
  CHECK (entity_type IN ('campaign', 'booking', 'invoice', 'compliance_check', 'board', 'print_task', 'makegood'));

CREATE OR REPLACE FUNCTION public.makegood_event_visible(p_entity_id TEXT, p_uid UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.makegoods m
    WHERE m.id::TEXT = p_entity_id AND public.makegood_side(m.booking_id, p_uid) IS NOT NULL
  );
$$;

DROP POLICY IF EXISTS "activity_select_makegood" ON public.activity_events;
-- additional permissive policy: both parties read a makegood's history
CREATE POLICY "activity_select_makegood" ON public.activity_events FOR SELECT USING (
  entity_type = 'makegood' AND public.makegood_event_visible(entity_id::TEXT, auth.uid())
);
