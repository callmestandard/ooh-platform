-- 044: From a board request's quote to an agreed deal (MVP step 4).
--
-- When the buyer answers an owner's quote ("Accept" or "Negotiate"), the
-- request gets a negotiation thread: a booking on a hidden per-request
-- campaign, so the existing negotiation pages and messages are reused as-is.
-- When that booking becomes agreed, the request moves to 'accepted' and
-- admins are alerted to complete the booking by hand.
--
-- Also:
--   * owners can give the period they can offer and any conditions with a quote;
--   * owners can look up the buyer on a booking for their board (before, the
--     owner's negotiation page could not read the campaign, so every
--     notification it sent to the buyer was silently dropped);
--   * a buyer may withdraw while negotiating; the thread is then closed.
--
-- Safe to re-run.

-- ── 1. Quote details ────────────────────────────────────────────────────
ALTER TABLE public.availability_responses
  ADD COLUMN IF NOT EXISTS available_from DATE,
  ADD COLUMN IF NOT EXISTS available_to   DATE,
  ADD COLUMN IF NOT EXISTS conditions     TEXT;

DO $$ BEGIN
  ALTER TABLE public.availability_responses
    ADD CONSTRAINT availability_responses_period_check
    CHECK (available_from IS NULL OR available_to IS NULL OR available_from <= available_to);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 2. Hidden per-request campaign ──────────────────────────────────────
-- A campaign with request_id set exists only to hold one request's booking.
-- Campaign lists skip it (request_id IS NULL).
ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS request_id UUID REFERENCES public.availability_requests(id) ON DELETE CASCADE;
CREATE UNIQUE INDEX IF NOT EXISTS campaigns_request_id_key ON public.campaigns(request_id) WHERE request_id IS NOT NULL;

-- Booking that belongs to a request, if any.
CREATE OR REPLACE FUNCTION public.board_request_booking(p_request_id UUID)
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT b.id FROM public.bookings b JOIN public.campaigns c ON c.id = b.campaign_id
   WHERE c.request_id = p_request_id
   ORDER BY b.created_at LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.board_request_booking(UUID) FROM PUBLIC, anon;

-- ── 3. Buyer answers the quote ──────────────────────────────────────────
-- p_accept = true  → deal agreed at the quoted rate (stage → accepted via §5)
-- p_accept = false → negotiation thread opened (stage → negotiating)
-- Returns the booking id (the negotiation page to open).
CREATE OR REPLACE FUNCTION public.answer_board_quote(p_request_id UUID, p_accept BOOLEAN)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid      UUID := auth.uid();
  v_req      public.availability_requests%ROWTYPE;
  v_resp     public.availability_responses%ROWTYPE;
  v_board    public.boards%ROWTYPE;
  v_company  TEXT;
  v_campaign UUID;
  v_booking  UUID;
  v_status   TEXT;
  v_rate     NUMERIC;
  v_months   INTEGER;
  v_quote    TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'sign in first' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_req FROM public.availability_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND OR v_req.agency_id IS DISTINCT FROM v_uid OR v_req.board_id IS NULL THEN
    RAISE EXCEPTION 'request not found' USING ERRCODE = '42501';
  END IF;
  IF v_req.stage NOT IN ('owner_responded', 'quote_received', 'negotiating') THEN
    RAISE EXCEPTION 'this request cannot be answered at its current stage (%)', v_req.stage USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_resp FROM public.availability_responses
   WHERE request_id = p_request_id AND board_id = v_req.board_id;
  IF NOT FOUND OR NOT v_resp.available THEN
    RAISE EXCEPTION 'the owner has not said this board is available' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_board FROM public.boards WHERE id = v_req.board_id;

  v_booking := public.board_request_booking(p_request_id);

  IF v_booking IS NULL THEN
    IF p_accept AND v_resp.quoted_rate IS NULL THEN
      RAISE EXCEPTION 'there is no price to accept yet — choose Negotiate to ask for one' USING ERRCODE = '22023';
    END IF;

    SELECT company INTO v_company FROM public.availability_request_contacts WHERE request_id = p_request_id;
    v_months := GREATEST(1, ROUND((v_req.end_date - v_req.start_date) / 30.0)::INTEGER);

    INSERT INTO public.campaigns (agency_id, name, client_name, status, start_date, end_date, total_budget, request_id)
    VALUES (v_uid, 'Request · ' || COALESCE(v_board.name, v_req.title), v_company, 'pending',
            v_req.start_date, v_req.end_date, COALESCE(v_req.budget, 0), p_request_id)
    RETURNING id INTO v_campaign;

    INSERT INTO public.bookings (campaign_id, board_id, offered_rate, status, start_date, end_date, duration_months, notes)
    VALUES (v_campaign, v_req.board_id, v_resp.quoted_rate, 'negotiating', v_req.start_date, v_req.end_date, v_months,
            'From request for ' || COALESCE(v_board.name, v_req.title))
    RETURNING id INTO v_booking;

    -- Open the thread with the owner's quote, so both sides see what is on the table.
    v_quote := CASE WHEN v_resp.quoted_rate IS NOT NULL
                    THEN 'Quote: ₦' || to_char(v_resp.quoted_rate, 'FM999,999,999,990') || ' per month'
                    ELSE 'Available for your dates — price to be agreed' END
            || CASE WHEN v_resp.available_from IS NOT NULL OR v_resp.available_to IS NOT NULL
                    THEN ' · available ' || COALESCE(to_char(v_resp.available_from, 'DD Mon YYYY'), 'now')
                         || ' to ' || COALESCE(to_char(v_resp.available_to, 'DD Mon YYYY'), 'open') ELSE '' END
            || CASE WHEN v_resp.conditions IS NOT NULL THEN E'\nConditions: ' || v_resp.conditions ELSE '' END
            || CASE WHEN v_resp.note IS NOT NULL THEN E'\n' || v_resp.note ELSE '' END;
    -- sender_id is left empty, as the app does (its FK points at a legacy users table).
    INSERT INTO public.messages (booking_id, sender_role, message_type, content, offered_rate)
    VALUES (v_booking, 'owner', 'offer', v_quote, v_resp.quoted_rate);

    PERFORM set_config('app.request_stage', 'on', true);
    UPDATE public.availability_responses SET accepted_booking_id = v_booking WHERE id = v_resp.id;
    UPDATE public.availability_requests SET stage = 'negotiating' WHERE id = p_request_id;
    PERFORM set_config('app.request_stage', 'off', true);

    IF NOT p_accept THEN
      INSERT INTO public.notifications (recipient_role, recipient_user_id, type, title, body, link)
      VALUES ('owner', v_resp.owner_id, 'message', 'A buyer wants to discuss your quote',
              COALESCE(v_board.name, v_req.title), '/dashboard/owner/negotiations/' || v_booking);
    END IF;
  END IF;

  IF p_accept THEN
    SELECT status, offered_rate INTO v_status, v_rate FROM public.bookings WHERE id = v_booking;
    IF v_status <> 'negotiating' AND v_status <> 'pending' THEN
      RAISE EXCEPTION 'this deal is already %', v_status USING ERRCODE = '22023';
    END IF;
    IF v_rate IS NULL THEN
      RAISE EXCEPTION 'there is no price to accept yet' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.messages (booking_id, sender_role, message_type, content, offered_rate)
    VALUES (v_booking, 'agency', 'accepted',
            'Quote accepted at ₦' || to_char(v_rate, 'FM999,999,999,990') || ' per month.', v_rate);
    UPDATE public.bookings SET status = 'agreed', agreed_rate = v_rate WHERE id = v_booking;
    INSERT INTO public.notifications (recipient_role, recipient_user_id, type, title, body, link)
    VALUES ('owner', v_resp.owner_id, 'offer_accepted', 'Your quote was accepted',
            COALESCE(v_board.name, v_req.title) || ' — our team will be in touch to complete the booking',
            '/dashboard/owner/negotiations/' || v_booking);
  END IF;

  RETURN v_booking;
END;
$$;
REVOKE ALL ON FUNCTION public.answer_board_quote(UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.answer_board_quote(UUID, BOOLEAN) TO authenticated;

-- ── 4. Owner: who is the buyer on a booking for my board ────────────────
CREATE OR REPLACE FUNCTION public.booking_buyer(p_booking_id UUID)
RETURNS TABLE (buyer_id UUID, buyer_name TEXT, request_id UUID)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.agency_id, COALESCE(p.company_name, p.full_name), c.request_id
    FROM public.bookings b
    JOIN public.campaigns c ON c.id = b.campaign_id
    LEFT JOIN public.profiles p ON p.id = c.agency_id
   WHERE b.id = p_booking_id
     AND (c.agency_id = auth.uid()
          OR public.board_team_match(b.board_id, auth.uid())
          OR EXISTS (SELECT 1 FROM public.boards bo WHERE bo.id = b.board_id AND bo.owner_id = auth.uid())
          OR public.auth_role() = 'admin');
$$;
REVOKE ALL ON FUNCTION public.booking_buyer(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.booking_buyer(UUID) TO authenticated;

-- ── 5. Request stage follows the deal ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.board_request_stage_from_booking()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_req   public.availability_requests%ROWTYPE;
  v_board TEXT;
  v_next  TEXT;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;

  SELECT r.* INTO v_req FROM public.availability_requests r
    JOIN public.campaigns c ON c.request_id = r.id
   WHERE c.id = NEW.campaign_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  v_next := CASE
    WHEN NEW.status IN ('agreed', 'signed') THEN 'accepted'
    WHEN NEW.status = 'declined' AND auth.uid() = v_req.agency_id THEN 'cancelled'
    WHEN NEW.status = 'declined' THEN 'unavailable'
    ELSE NULL END;
  IF v_next IS NULL OR v_req.stage NOT IN ('owner_responded', 'quote_received', 'negotiating') THEN
    RETURN NEW;
  END IF;

  PERFORM set_config('app.request_stage', 'on', true);
  UPDATE public.availability_requests
     SET stage = v_next, status = CASE WHEN v_next IN ('cancelled', 'unavailable') THEN 'closed' ELSE status END
   WHERE id = v_req.id;
  PERFORM set_config('app.request_stage', 'off', true);

  IF v_next = 'accepted' THEN
    SELECT name INTO v_board FROM public.boards WHERE id = NEW.board_id;
    -- Untargeted admin notification (041: visible to admins only).
    INSERT INTO public.notifications (recipient_role, type, title, body, link)
    VALUES ('admin', 'booking_request', 'Deal agreed — complete the booking: ' || COALESCE(v_board, v_req.title),
            COALESCE(v_req.agency_name, 'A buyer') || ' agreed ₦' || to_char(COALESCE(NEW.agreed_rate, NEW.offered_rate), 'FM999,999,999,990')
              || ' per month, ' || to_char(v_req.start_date, 'DD Mon YYYY') || ' to ' || to_char(v_req.end_date, 'DD Mon YYYY'),
            '/dashboard/admin');
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS bookings_board_request_stage ON public.bookings;
CREATE TRIGGER bookings_board_request_stage AFTER UPDATE OF status ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.board_request_stage_from_booking();

-- ── 6. Buyer may withdraw while negotiating; the thread closes ──────────
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
      IF NEW.stage <> 'cancelled' OR OLD.stage NOT IN ('requested', 'owner_responded', 'quote_received', 'unavailable', 'negotiating') THEN
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
      IF FOUND THEN
        SELECT owner_id INTO v_owner FROM public.availability_responses WHERE request_id = NEW.id AND board_id = NEW.board_id;
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
DROP TRIGGER IF EXISTS availability_requests_close_deal ON public.availability_requests;
CREATE TRIGGER availability_requests_close_deal AFTER UPDATE OF stage ON public.availability_requests
  FOR EACH ROW EXECUTE FUNCTION public.close_board_request_deal();
