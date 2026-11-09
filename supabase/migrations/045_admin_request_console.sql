-- 045: Admin request console (MVP step 5).
--
--   * Admins can answer a board request for the owner (e.g. after a phone
--     call to an owner who is not on the platform yet).
--   * Admins move requests through the hand-off: booking_in_progress →
--     confirmed (or cancel), with the buyer and owner told each time.
--   * Admin-only internal notes on a request (separate table).
--   * Fix: 034 let the requesting buyer UPDATE an owner's reply (needed to
--     link a booking), which also let them rewrite the quoted price before
--     accepting it. Now a buyer may only set accepted_booking_id.
--
-- Safe to re-run.

-- ── 1. Columns ───────────────────────────────────────────────────────────
ALTER TABLE public.availability_responses
  ADD COLUMN IF NOT EXISTS answered_by_admin BOOLEAN NOT NULL DEFAULT false;

-- Internal notes live in their own admin-only table, so buyers and owners
-- (who read availability_requests rows) never see them.
CREATE TABLE IF NOT EXISTS public.availability_request_admin_notes (
  request_id UUID PRIMARY KEY REFERENCES public.availability_requests(id) ON DELETE CASCADE,
  notes      TEXT,
  updated_by UUID,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.availability_request_admin_notes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "avail_admin_notes_all" ON public.availability_request_admin_notes;
CREATE POLICY "avail_admin_notes_all" ON public.availability_request_admin_notes FOR ALL
  USING (public.auth_role() = 'admin') WITH CHECK (public.auth_role() = 'admin');
GRANT SELECT, INSERT, UPDATE, DELETE ON public.availability_request_admin_notes TO authenticated;

-- ── 2. Buyers may only link a booking to an owner's reply ───────────────
CREATE OR REPLACE FUNCTION public.guard_availability_response()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR public.auth_role() = 'admin'
     OR COALESCE(current_setting('app.request_stage', true), '') = 'on'
     OR public.owner_company_of(auth.uid()) = OLD.owner_id
     OR OLD.owner_id = auth.uid() THEN
    RETURN NEW;
  END IF;
  IF NEW.available IS DISTINCT FROM OLD.available OR NEW.quoted_rate IS DISTINCT FROM OLD.quoted_rate
     OR NEW.note IS DISTINCT FROM OLD.note OR NEW.available_from IS DISTINCT FROM OLD.available_from
     OR NEW.available_to IS DISTINCT FROM OLD.available_to OR NEW.conditions IS DISTINCT FROM OLD.conditions
     OR NEW.owner_id IS DISTINCT FROM OLD.owner_id OR NEW.board_id IS DISTINCT FROM OLD.board_id
     OR NEW.request_id IS DISTINCT FROM OLD.request_id OR NEW.answered_by_admin IS DISTINCT FROM OLD.answered_by_admin THEN
    RAISE EXCEPTION 'only the owner can change their reply' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS availability_responses_guard ON public.availability_responses;
CREATE TRIGGER availability_responses_guard BEFORE UPDATE ON public.availability_responses
  FOR EACH ROW EXECUTE FUNCTION public.guard_availability_response();

-- ── 3. Admin answers for the owner ──────────────────────────────────────
-- The reply is filed under the board's owner account when there is one,
-- otherwise under the admin (answered_by_admin marks it either way).
CREATE OR REPLACE FUNCTION public.admin_answer_board_request(
  p_request_id UUID, p_available BOOLEAN, p_rate NUMERIC,
  p_from DATE, p_to DATE, p_conditions TEXT, p_note TEXT
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_req   public.availability_requests%ROWTYPE;
  v_owner UUID;
  v_id    UUID;
  v_board TEXT;
BEGIN
  IF public.auth_role() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'admins only' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_req FROM public.availability_requests WHERE id = p_request_id;
  IF NOT FOUND OR v_req.board_id IS NULL THEN
    RAISE EXCEPTION 'board request not found' USING ERRCODE = '22023';
  END IF;
  IF v_req.stage NOT IN ('requested', 'owner_responded', 'quote_received', 'unavailable') THEN
    RAISE EXCEPTION 'the reply can no longer be changed (request is %)', v_req.stage USING ERRCODE = '22023';
  END IF;
  IF p_rate IS NOT NULL AND p_rate <= 0 THEN
    RAISE EXCEPTION 'the price must be more than zero' USING ERRCODE = '22023';
  END IF;

  v_owner := COALESCE(public.board_owner_account(v_req.board_id), auth.uid());

  INSERT INTO public.availability_responses
    (request_id, owner_id, board_id, available, quoted_rate, note, available_from, available_to, conditions, answered_by_admin)
  VALUES (p_request_id, v_owner, v_req.board_id, p_available,
          CASE WHEN p_available THEN p_rate END, NULLIF(trim(p_note), ''),
          CASE WHEN p_available THEN p_from END, CASE WHEN p_available THEN p_to END,
          CASE WHEN p_available THEN NULLIF(trim(p_conditions), '') END, true)
  ON CONFLICT (request_id, board_id) DO UPDATE SET
    available = EXCLUDED.available, quoted_rate = EXCLUDED.quoted_rate, note = EXCLUDED.note,
    available_from = EXCLUDED.available_from, available_to = EXCLUDED.available_to,
    conditions = EXCLUDED.conditions, answered_by_admin = true, updated_at = NOW()
  RETURNING id INTO v_id;

  SELECT name INTO v_board FROM public.boards WHERE id = v_req.board_id;
  INSERT INTO public.notifications (recipient_role, recipient_user_id, type, title, body, link)
  VALUES ('agency', v_req.agency_id, 'availability_response',
          CASE WHEN NOT p_available THEN COALESCE(v_board, v_req.title) || ' is not available for your dates'
               WHEN p_rate IS NOT NULL THEN 'Quote received for ' || COALESCE(v_board, v_req.title)
               ELSE COALESCE(v_board, v_req.title) || ' is available' END,
          CASE WHEN p_available AND p_rate IS NOT NULL THEN '₦' || to_char(p_rate, 'FM999,999,999,990') || ' per month' END,
          '/dashboard/agency/requests');
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_answer_board_request(UUID, BOOLEAN, NUMERIC, DATE, DATE, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_answer_board_request(UUID, BOOLEAN, NUMERIC, DATE, DATE, TEXT, TEXT) TO authenticated;

-- ── 4. Admin moves a request along the hand-off ─────────────────────────
-- accepted → booking_in_progress → confirmed; cancel from any open stage.
-- Confirming also marks the deal's booking signed.
CREATE OR REPLACE FUNCTION public.admin_set_request_stage(p_request_id UUID, p_stage TEXT, p_message TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_req     public.availability_requests%ROWTYPE;
  v_booking UUID;
  v_owner   UUID;
  v_board   TEXT;
  v_title   TEXT;
BEGIN
  IF public.auth_role() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'admins only' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_req FROM public.availability_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND OR v_req.board_id IS NULL THEN
    RAISE EXCEPTION 'board request not found' USING ERRCODE = '22023';
  END IF;
  IF NOT (
       (p_stage = 'booking_in_progress' AND v_req.stage = 'accepted')
    OR (p_stage = 'confirmed' AND v_req.stage IN ('accepted', 'booking_in_progress'))
    OR (p_stage = 'cancelled' AND v_req.stage NOT IN ('confirmed', 'cancelled'))
  ) THEN
    RAISE EXCEPTION 'cannot move a request from % to %', v_req.stage, p_stage USING ERRCODE = '22023';
  END IF;

  UPDATE public.availability_requests
     SET stage = p_stage, status = CASE WHEN p_stage IN ('confirmed', 'cancelled') THEN 'closed' ELSE status END
   WHERE id = p_request_id;

  v_booking := public.board_request_booking(p_request_id);
  IF v_booking IS NOT NULL THEN
    IF p_stage = 'confirmed' THEN
      UPDATE public.bookings SET status = 'signed' WHERE id = v_booking AND status IN ('agreed', 'negotiating', 'pending');
    ELSIF p_stage = 'cancelled' THEN
      UPDATE public.bookings SET status = 'declined' WHERE id = v_booking AND status IN ('agreed', 'negotiating', 'pending');
    END IF;
  END IF;

  SELECT name INTO v_board FROM public.boards WHERE id = v_req.board_id;
  v_title := CASE p_stage
    WHEN 'booking_in_progress' THEN 'Booking in progress: '
    WHEN 'confirmed' THEN 'Booking confirmed: '
    ELSE 'Request closed by our team: ' END || COALESCE(v_board, v_req.title);

  INSERT INTO public.notifications (recipient_role, recipient_user_id, type, title, body, link)
  VALUES ('agency', v_req.agency_id, 'booking_update', v_title, NULLIF(trim(p_message), ''), '/dashboard/agency/requests');

  SELECT owner_id INTO v_owner FROM public.availability_responses
   WHERE request_id = p_request_id AND board_id = v_req.board_id AND NOT answered_by_admin;
  v_owner := COALESCE(v_owner, public.board_owner_account(v_req.board_id));
  IF v_owner IS NOT NULL AND v_booking IS NOT NULL THEN
    INSERT INTO public.notifications (recipient_role, recipient_user_id, type, title, body, link)
    VALUES ('owner', v_owner, 'booking_update', v_title, NULLIF(trim(p_message), ''), '/dashboard/owner/negotiations/' || v_booking);
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_set_request_stage(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_request_stage(UUID, TEXT, TEXT) TO authenticated;

-- ── 5. Only a buyer's own cancel says "the buyer withdrew" ──────────────
CREATE OR REPLACE FUNCTION public.close_board_request_deal()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_booking UUID;
  v_owner   UUID;
BEGIN
  IF NEW.stage = 'cancelled' AND OLD.stage IS DISTINCT FROM 'cancelled' THEN
    v_booking := public.board_request_booking(NEW.id);
    IF v_booking IS NOT NULL THEN
      UPDATE public.bookings SET status = 'declined' WHERE id = v_booking AND status IN ('pending', 'negotiating');
      IF FOUND AND auth.uid() = NEW.agency_id THEN
        SELECT owner_id INTO v_owner FROM public.availability_responses
         WHERE request_id = NEW.id AND board_id = NEW.board_id AND NOT answered_by_admin;
        IF v_owner IS NOT NULL THEN
          INSERT INTO public.notifications (recipient_role, recipient_user_id, type, title, body, link)
          VALUES ('owner', v_owner, 'offer_declined', 'The buyer withdrew their request', NEW.title,
                  '/dashboard/owner/negotiations/' || v_booking);
        END IF;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
