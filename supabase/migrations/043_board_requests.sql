-- ═══════════════════════════════════════════════════════════════════
-- OOH Platform — "Request this location": availability requests for one board
-- Run in Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- Requires 034–036 and 041. Safe to re-run.
--
-- Extends availability_requests (034) instead of adding a new request
-- system. A request with board_id set is for that one board:
--   • it goes only to that board's owner account (if it has one) — and the
--     owner can only answer for that board, not every board they have in
--     the same city;
--   • the platform admins are always notified, so a board whose owner isn't
--     on the platform yet still gets a human follow-up;
--   • it carries a stage the buyer can follow:
--       requested → owner_responded | quote_received | unavailable
--       → negotiating → accepted → booking_in_progress → confirmed
--     (or cancelled by the buyer before it is accepted).
--     The response stages are set automatically from the owner's reply.
--     Negotiating/accepted come in the next step; booking_in_progress and
--     confirmed are set by an admin.
--
-- The buyer's name, email and phone are kept in a separate table that only
-- the buyer and admins can read. The owner sees the buyer's company and the
-- request itself, so the conversation stays on the platform.
-- Broadcast requests (board_id NULL) behave exactly as before.
-- ═══════════════════════════════════════════════════════════════════

-- ── 1. Columns ───────────────────────────────────────────────────────────
ALTER TABLE public.availability_requests ADD COLUMN IF NOT EXISTS board_id           UUID REFERENCES public.boards(id) ON DELETE SET NULL;
ALTER TABLE public.availability_requests ADD COLUMN IF NOT EXISTS stage              TEXT NOT NULL DEFAULT 'requested';
ALTER TABLE public.availability_requests ADD COLUMN IF NOT EXISTS stage_updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE public.availability_requests ADD COLUMN IF NOT EXISTS sites_needed       INTEGER;
ALTER TABLE public.availability_requests ADD COLUMN IF NOT EXISTS extra_requirements TEXT;

ALTER TABLE public.availability_requests DROP CONSTRAINT IF EXISTS availability_requests_stage_check;
ALTER TABLE public.availability_requests ADD CONSTRAINT availability_requests_stage_check CHECK (stage IN (
  'requested', 'owner_responded', 'quote_received', 'unavailable',
  'negotiating', 'accepted', 'booking_in_progress', 'confirmed', 'cancelled'
));
ALTER TABLE public.availability_requests DROP CONSTRAINT IF EXISTS availability_requests_sites_needed_check;
ALTER TABLE public.availability_requests ADD CONSTRAINT availability_requests_sites_needed_check CHECK (sites_needed IS NULL OR sites_needed > 0);

CREATE INDEX IF NOT EXISTS idx_avail_requests_board ON public.availability_requests(board_id) WHERE board_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_avail_requests_stage ON public.availability_requests(stage, stage_updated_at) WHERE board_id IS NOT NULL;

-- ── 2. Buyer contact details (buyer + admins only) ───────────────────────
CREATE TABLE IF NOT EXISTS public.availability_request_contacts (
  request_id UUID PRIMARY KEY REFERENCES public.availability_requests(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  company    TEXT NOT NULL,
  email      TEXT NOT NULL,
  phone      TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.availability_request_contacts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "avail_contacts_select" ON public.availability_request_contacts;
-- Written only by send_board_request(); never readable by the owner.
CREATE POLICY "avail_contacts_select" ON public.availability_request_contacts FOR SELECT USING (
  public.availability_request_agency(request_id) = auth.uid() OR public.auth_role() = 'admin'
);
GRANT SELECT ON public.availability_request_contacts TO authenticated;

-- ── 3. A board request matches only its own board ────────────────────────
CREATE OR REPLACE FUNCTION public.board_matches_availability_request(p_board_id UUID, p_request_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.boards b, public.availability_requests r
    WHERE b.id = p_board_id AND r.id = p_request_id
      AND b.status <> 'decommissioned'
      AND (r.board_id IS NULL OR r.board_id = b.id)
      AND lower(trim(b.city)) IN (SELECT lower(trim(c)) FROM unnest(r.cities) c)
      AND (cardinality(r.formats) = 0 OR b.format = ANY (r.formats))
  );
$$;

-- ── 4. Send ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.send_board_request(
  p_board_id UUID, p_start DATE, p_end DATE,
  p_name TEXT, p_company TEXT, p_email TEXT, p_phone TEXT, p_message TEXT,
  p_budget NUMERIC, p_sites INTEGER, p_extra TEXT
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid     UUID := auth.uid();
  v_board   public.boards%ROWTYPE;
  v_owner   UUID;
  v_owner_name TEXT;
  v_request UUID;
  v_company TEXT := NULLIF(trim(COALESCE(p_company, '')), '');
BEGIN
  IF v_uid IS NULL OR public.auth_role() <> 'agency' THEN
    RAISE EXCEPTION 'Sign in with a buyer account to request a location';
  END IF;
  IF NULLIF(trim(COALESCE(p_name, '')), '') IS NULL OR v_company IS NULL
     OR NULLIF(trim(COALESCE(p_email, '')), '') IS NULL OR NULLIF(trim(COALESCE(p_phone, '')), '') IS NULL
     OR NULLIF(trim(COALESCE(p_message, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Name, company, email, phone and a message are required';
  END IF;
  IF trim(p_email) !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION 'Enter a valid email address';
  END IF;
  IF p_start IS NULL OR p_end IS NULL THEN RAISE EXCEPTION 'Campaign start and end dates are required'; END IF;
  IF p_end < p_start THEN RAISE EXCEPTION 'The end date must be on or after the start date'; END IF;
  IF p_start < CURRENT_DATE THEN RAISE EXCEPTION 'The start date cannot be in the past'; END IF;
  IF p_budget IS NOT NULL AND p_budget <= 0 THEN RAISE EXCEPTION 'Budget must be a positive amount'; END IF;
  IF p_sites IS NOT NULL AND p_sites <= 0 THEN RAISE EXCEPTION 'Number of sites must be at least 1'; END IF;

  SELECT * INTO v_board FROM public.boards WHERE id = p_board_id;
  IF NOT FOUND OR v_board.status = 'decommissioned' THEN RAISE EXCEPTION 'This board is no longer listed'; END IF;

  -- One open request per buyer per board, and a daily cap against spam.
  IF EXISTS (SELECT 1 FROM public.availability_requests
             WHERE agency_id = v_uid AND board_id = p_board_id
               AND stage NOT IN ('unavailable', 'confirmed', 'cancelled')) THEN
    RAISE EXCEPTION 'You already have an open request for this board — see My Requests';
  END IF;
  IF (SELECT COUNT(*) FROM public.availability_requests
      WHERE agency_id = v_uid AND board_id IS NOT NULL AND created_at > NOW() - INTERVAL '1 day') >= 25 THEN
    RAISE EXCEPTION 'You have sent a lot of requests today — please try again tomorrow';
  END IF;

  INSERT INTO public.availability_requests (
    agency_id, agency_name, title, cities, formats, start_date, end_date, budget, notes,
    board_id, stage, sites_needed, extra_requirements
  ) VALUES (
    v_uid, v_company, v_board.name, ARRAY[v_board.city], ARRAY[v_board.format], p_start, p_end, p_budget,
    trim(p_message), p_board_id, 'requested', p_sites, NULLIF(trim(COALESCE(p_extra, '')), '')
  ) RETURNING id INTO v_request;

  INSERT INTO public.availability_request_contacts (request_id, name, company, email, phone)
  VALUES (v_request, trim(p_name), v_company, lower(trim(p_email)), trim(p_phone));

  -- Route to the owner account, if the board has one. (The 035 trigger on
  -- recipients also notifies the marketer the board is assigned to.)
  v_owner := public.board_owner_account(p_board_id);
  IF v_owner IS NOT NULL AND v_owner <> v_uid THEN
    SELECT COALESCE(company_name, full_name, 'Board owner') INTO v_owner_name FROM public.profiles WHERE id = v_owner;
    INSERT INTO public.availability_request_recipients (request_id, owner_id, owner_name, board_count)
    VALUES (v_request, v_owner, v_owner_name, 1);
    INSERT INTO public.notifications (recipient_role, recipient_user_id, type, title, body, link)
    VALUES ('owner', v_owner, 'availability_request',
            'New availability request for ' || v_board.name,
            v_company || ' · ' || to_char(p_start, 'DD Mon YYYY') || ' → ' || to_char(p_end, 'DD Mon YYYY'),
            '/dashboard/owner/availability-requests');
  END IF;

  -- Every admin sees every request (untargeted admin notifications, 041).
  INSERT INTO public.notifications (recipient_role, recipient_user_id, type, title, body, link)
  VALUES ('admin', NULL, 'availability_request',
          'New request: ' || v_board.name,
          v_company || CASE WHEN v_owner IS NULL THEN ' · owner not on the platform — needs a call' ELSE ' · sent to the owner' END,
          '/dashboard/admin');

  RETURN v_request;
END;
$$;
GRANT EXECUTE ON FUNCTION public.send_board_request(UUID, DATE, DATE, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, INTEGER, TEXT) TO authenticated;

-- ── 5. Stage follows the owner's reply ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.board_request_stage_from_response()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_next TEXT := CASE WHEN NOT NEW.available THEN 'unavailable'
                      WHEN NEW.quoted_rate IS NOT NULL THEN 'quote_received'
                      ELSE 'owner_responded' END;
BEGIN
  PERFORM set_config('app.request_stage', 'on', true);
  UPDATE public.availability_requests
     SET stage = v_next
   WHERE id = NEW.request_id AND board_id IS NOT NULL
     AND stage IN ('requested', 'owner_responded', 'quote_received', 'unavailable')
     AND stage <> v_next;
  PERFORM set_config('app.request_stage', 'off', true);
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS availability_responses_set_stage ON public.availability_responses;
CREATE TRIGGER availability_responses_set_stage
  AFTER INSERT OR UPDATE OF available, quoted_rate ON public.availability_responses
  FOR EACH ROW EXECUTE FUNCTION public.board_request_stage_from_response();

-- ── 6. Guard: what the buyer may change on their own request ─────────────
-- avail_requests_update (034) lets the requesting agency update its row.
-- For board requests the buyer may only cancel — never move the stage
-- forward, re-point the board, or edit the request after sending.
CREATE OR REPLACE FUNCTION public.guard_availability_request()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.stage IS DISTINCT FROM OLD.stage THEN
    NEW.stage_updated_at := NOW();
  END IF;

  IF auth.uid() IS NULL OR public.auth_role() = 'admin'
     OR COALESCE(current_setting('app.request_stage', true), '') = 'on' THEN
    RETURN NEW;
  END IF;

  IF NEW.agency_id IS DISTINCT FROM OLD.agency_id OR NEW.board_id IS DISTINCT FROM OLD.board_id THEN
    RAISE EXCEPTION 'a request cannot be moved to another buyer or board' USING ERRCODE = '42501';
  END IF;

  IF OLD.board_id IS NOT NULL THEN
    IF NEW.title IS DISTINCT FROM OLD.title OR NEW.cities IS DISTINCT FROM OLD.cities OR NEW.formats IS DISTINCT FROM OLD.formats
       OR NEW.start_date IS DISTINCT FROM OLD.start_date OR NEW.end_date IS DISTINCT FROM OLD.end_date
       OR NEW.budget IS DISTINCT FROM OLD.budget OR NEW.notes IS DISTINCT FROM OLD.notes
       OR NEW.sites_needed IS DISTINCT FROM OLD.sites_needed OR NEW.extra_requirements IS DISTINCT FROM OLD.extra_requirements THEN
      RAISE EXCEPTION 'a sent request cannot be edited — cancel it and send a new one' USING ERRCODE = '42501';
    END IF;
    IF NEW.stage IS DISTINCT FROM OLD.stage THEN
      IF NEW.stage <> 'cancelled' OR OLD.stage NOT IN ('requested', 'owner_responded', 'quote_received', 'unavailable') THEN
        RAISE EXCEPTION 'you can cancel a request before it is accepted; other stages are set by the owner or our team' USING ERRCODE = '42501';
      END IF;
      NEW.status := 'closed';
    ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION 'cancel the request instead of closing it' USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS availability_requests_guard ON public.availability_requests;
CREATE TRIGGER availability_requests_guard
  BEFORE UPDATE ON public.availability_requests
  FOR EACH ROW EXECUTE FUNCTION public.guard_availability_request();

-- ── 7. Admins can update requests (to move them to booking_in_progress /
-- confirmed). 034 only let the requesting agency update its own rows, so an
-- admin's update silently matched nothing.
DROP POLICY IF EXISTS "avail_requests_update_admin" ON public.availability_requests;
CREATE POLICY "avail_requests_update_admin" ON public.availability_requests FOR UPDATE
  USING (public.auth_role() = 'admin') WITH CHECK (public.auth_role() = 'admin');
