-- OOH Platform — quotations: our own selling price, kept apart from the owner's rate
--
-- Before this, the owner's price went to the buyer unchanged and became the
-- booking value. Now:
--
--   owner's price (private)  →  quotation (our selling price)  →  booking
--
--   • request_owner_prices   the owner's net monthly rate per request/board,
--                            admins only. Any rate written to
--                            availability_responses (which buyers can read)
--                            is moved here and blanked.
--   • quotations / quotation_lines
--                            admin-built quote: board lines priced from the
--                            owner's net rate by % markup, fixed markup,
--                            manual price or commission; printing,
--                            installation, production, fees, discount; VAT;
--                            validity; terms. Admins only — buyers read
--                            through my_quotations(), which never returns
--                            owner rates, costs or margins.
--   • quotation_events       every status change, with who and when.
--   • booking_financials     per booking: owner cost, selling price,
--                            platform revenue. Admins only.
--   • commercial_settings    editable defaults (validity, VAT, terms).
--   • email_log              every email we try to send, sent or failed.
--
-- Rollback: see the end of the file.

BEGIN;

-- ── 0. Helpers ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.lagos_today()
RETURNS DATE LANGUAGE sql STABLE AS $$ SELECT (NOW() AT TIME ZONE 'Africa/Lagos')::date $$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid() IS NOT NULL AND public.auth_role() = 'admin'
$$;

-- Selling price per month for one board line.
--   markup_percent  owner rate × (1 + value%)
--   markup_fixed    owner rate + value
--   manual          value (the price we choose)
--   commission      owner rate (the buyer pays the owner's price; we keep value% of it)
CREATE OR REPLACE FUNCTION public.quote_sell_monthly(p_net NUMERIC, p_mode TEXT, p_value NUMERIC)
RETURNS NUMERIC LANGUAGE sql IMMUTABLE AS $$
  SELECT ROUND(CASE p_mode
    WHEN 'markup_percent' THEN p_net * (1 + COALESCE(p_value, 0) / 100)
    WHEN 'markup_fixed'   THEN p_net + COALESCE(p_value, 0)
    WHEN 'manual'         THEN p_value
    WHEN 'commission'     THEN p_net
  END, 2)
$$;

-- What we pay the owner per month for one board line.
CREATE OR REPLACE FUNCTION public.quote_cost_monthly(p_net NUMERIC, p_mode TEXT, p_value NUMERIC)
RETURNS NUMERIC LANGUAGE sql IMMUTABLE AS $$
  SELECT ROUND(CASE WHEN p_mode = 'commission' THEN p_net * (1 - COALESCE(p_value, 0) / 100) ELSE p_net END, 2)
$$;

-- ── 1. Tables ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.commercial_settings (
  id                 SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  validity_days      INTEGER NOT NULL DEFAULT 7 CHECK (validity_days BETWEEN 1 AND 90),
  vat_rate           NUMERIC(5,2) NOT NULL DEFAULT 7.5 CHECK (vat_rate BETWEEN 0 AND 100),
  payment_terms      TEXT NOT NULL DEFAULT '',
  cancellation_terms TEXT NOT NULL DEFAULT '',
  special_conditions TEXT NOT NULL DEFAULT '',
  -- false until the business owner has reviewed and approved these defaults
  approved           BOOLEAN NOT NULL DEFAULT false,
  updated_by         UUID,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO public.commercial_settings (id, payment_terms, cancellation_terms, special_conditions)
VALUES (1,
  'DRAFT – to be confirmed by OOH Platform. Payment terms are agreed in writing before the booking is confirmed.',
  'DRAFT – to be confirmed by OOH Platform. Cancellation terms are agreed in writing before the booking is confirmed.',
  'Availability is confirmed by the media owner. Nothing is booked until OOH Platform confirms the booking in writing.')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.request_owner_prices (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id        UUID NOT NULL REFERENCES public.availability_requests(id) ON DELETE CASCADE,
  board_id          UUID REFERENCES public.boards(id) ON DELETE SET NULL,
  owner_net_monthly NUMERIC(14,2) NOT NULL CHECK (owner_net_monthly > 0),
  source            TEXT NOT NULL DEFAULT 'admin' CHECK (source IN ('admin', 'owner_account', 'owner_link', 'migrated')),
  recorded_by       UUID,
  recorded_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS request_owner_prices_request_idx ON public.request_owner_prices (request_id, recorded_at DESC);

CREATE SEQUENCE IF NOT EXISTS public.quotation_ref_seq;

CREATE TABLE IF NOT EXISTS public.quotations (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ref                TEXT NOT NULL UNIQUE,
  request_id         UUID REFERENCES public.availability_requests(id) ON DELETE SET NULL,
  request_ids        UUID[] NOT NULL DEFAULT '{}',
  agency_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status             TEXT NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft', 'sent', 'accepted', 'declined', 'withdrawn', 'superseded')),
  title              TEXT,
  issued_on          DATE,
  valid_until        DATE,
  vat_rate           NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (vat_rate BETWEEN 0 AND 100),
  payment_terms      TEXT,
  cancellation_terms TEXT,
  special_conditions TEXT,
  buyer_note         TEXT,
  subtotal           NUMERIC(14,2) NOT NULL DEFAULT 0,
  discount_total     NUMERIC(14,2) NOT NULL DEFAULT 0,
  vat_amount         NUMERIC(14,2) NOT NULL DEFAULT 0,
  total              NUMERIC(14,2) NOT NULL DEFAULT 0,
  owner_cost_total   NUMERIC(14,2) NOT NULL DEFAULT 0,
  platform_revenue   NUMERIC(14,2) NOT NULL DEFAULT 0,
  revised_from       UUID REFERENCES public.quotations(id) ON DELETE SET NULL,
  campaign_id        UUID REFERENCES public.campaigns(id) ON DELETE SET NULL,
  payment_status     TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid', 'part_paid', 'paid', 'refunded')),
  amount_paid        NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),
  is_test            BOOLEAN NOT NULL DEFAULT false,
  created_by         UUID,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at            TIMESTAMPTZ,
  accepted_at        TIMESTAMPTZ,
  accepted_by        UUID,
  declined_at        TIMESTAMPTZ,
  decline_reason     TEXT,
  withdrawn_at       TIMESTAMPTZ,
  withdraw_reason    TEXT,
  booking_confirmed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS quotations_agency_idx ON public.quotations (agency_id, created_at DESC);
CREATE INDEX IF NOT EXISTS quotations_request_ids_idx ON public.quotations USING GIN (request_ids);

CREATE TABLE IF NOT EXISTS public.quotation_lines (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quotation_id      UUID NOT NULL REFERENCES public.quotations(id) ON DELETE CASCADE,
  position          INTEGER NOT NULL DEFAULT 0,
  kind              TEXT NOT NULL CHECK (kind IN ('board', 'printing', 'installation', 'production', 'fee', 'discount')),
  board_id          UUID REFERENCES public.boards(id) ON DELETE SET NULL,
  request_id        UUID REFERENCES public.availability_requests(id) ON DELETE SET NULL,
  description       TEXT NOT NULL CHECK (length(description) BETWEEN 1 AND 300),
  start_date        DATE,
  end_date          DATE,
  months            NUMERIC(6,2) NOT NULL DEFAULT 1 CHECK (months > 0 AND months <= 120),
  owner_net_monthly NUMERIC(14,2) CHECK (owner_net_monthly >= 0),
  pricing_mode      TEXT CHECK (pricing_mode IN ('markup_percent', 'markup_fixed', 'manual', 'commission')),
  pricing_value     NUMERIC(14,4),
  sell_monthly      NUMERIC(14,2),
  amount            NUMERIC(14,2) CHECK (amount >= 0),
  cost              NUMERIC(14,2) CHECK (cost >= 0),
  line_total        NUMERIC(14,2) NOT NULL DEFAULT 0,
  line_cost         NUMERIC(14,2) NOT NULL DEFAULT 0,
  CHECK (kind <> 'board' OR (owner_net_monthly IS NOT NULL AND pricing_mode IS NOT NULL)),
  CHECK (kind = 'board' OR amount IS NOT NULL),
  CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date)
);
CREATE INDEX IF NOT EXISTS quotation_lines_q_idx ON public.quotation_lines (quotation_id, position);

CREATE TABLE IF NOT EXISTS public.quotation_events (
  id           BIGSERIAL PRIMARY KEY,
  quotation_id UUID NOT NULL REFERENCES public.quotations(id) ON DELETE CASCADE,
  event        TEXT NOT NULL,
  note         TEXT,
  actor        UUID,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS quotation_events_q_idx ON public.quotation_events (quotation_id, created_at);

ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS quotation_id UUID REFERENCES public.quotations(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.booking_financials (
  booking_id        UUID PRIMARY KEY REFERENCES public.bookings(id) ON DELETE CASCADE,
  quotation_id      UUID REFERENCES public.quotations(id) ON DELETE SET NULL,
  months            NUMERIC(6,2) NOT NULL,
  owner_net_monthly NUMERIC(14,2) NOT NULL,
  pricing_mode      TEXT NOT NULL,
  pricing_value     NUMERIC(14,4),
  sell_monthly      NUMERIC(14,2) NOT NULL,
  owner_cost_total  NUMERIC(14,2) NOT NULL,
  sell_total        NUMERIC(14,2) NOT NULL,
  platform_revenue  NUMERIC(14,2) NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.email_log (
  id           BIGSERIAL PRIMARY KEY,
  kind         TEXT NOT NULL,
  recipient    TEXT NOT NULL,
  subject      TEXT,
  request_id   UUID,
  quotation_id UUID,
  booking_id   UUID,
  status       TEXT NOT NULL CHECK (status IN ('sent', 'failed', 'skipped')),
  error        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS email_log_created_idx ON public.email_log (created_at DESC);
CREATE INDEX IF NOT EXISTS email_log_quote_idx ON public.email_log (quotation_id, kind);

-- ── 2. Admin-only access ─────────────────────────────────────────────────
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['commercial_settings', 'request_owner_prices', 'quotations', 'quotation_lines',
                           'quotation_events', 'booking_financials', 'email_log'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_admin', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin())', t || '_admin', t);
  END LOOP;
END $$;
-- Financial rows only change through the functions below.
REVOKE INSERT, UPDATE, DELETE ON public.booking_financials, public.quotation_events, public.email_log FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.quotations, public.quotation_lines FROM authenticated;
GRANT UPDATE (payment_status, amount_paid) ON public.quotations TO authenticated;

-- ── 3. Owner rates never reach the buyer-readable responses table ───────
CREATE OR REPLACE FUNCTION public.privatise_response_rate()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.quoted_rate IS NOT NULL THEN
    IF NEW.quoted_rate > 0 THEN
      INSERT INTO public.request_owner_prices (request_id, board_id, owner_net_monthly, source, recorded_by)
      VALUES (NEW.request_id, NEW.board_id, NEW.quoted_rate,
              CASE WHEN NEW.answered_by_admin THEN 'admin' ELSE 'owner_account' END, auth.uid());
    END IF;
    NEW.quoted_rate := NULL;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS availability_responses_privatise_rate ON public.availability_responses;
CREATE TRIGGER availability_responses_privatise_rate
  BEFORE INSERT OR UPDATE OF quoted_rate ON public.availability_responses
  FOR EACH ROW EXECUTE FUNCTION public.privatise_response_rate();

-- Move rates already sitting in responses (one test row today).
INSERT INTO public.request_owner_prices (request_id, board_id, owner_net_monthly, source, recorded_at)
SELECT request_id, board_id, quoted_rate, 'migrated', updated_at
  FROM public.availability_responses WHERE quoted_rate IS NOT NULL AND quoted_rate > 0;
ALTER TABLE public.availability_responses DISABLE TRIGGER availability_responses_set_stage;
UPDATE public.availability_responses SET quoted_rate = NULL WHERE quoted_rate IS NOT NULL;
ALTER TABLE public.availability_responses ENABLE TRIGGER availability_responses_set_stage;
-- Their price is now hidden, so a request showing "price ready" waits for our quotation instead.
SELECT set_config('app.request_stage', 'on', true);
UPDATE public.availability_requests r SET stage = 'owner_responded'
 WHERE r.stage = 'quote_received'
   AND NOT EXISTS (SELECT 1 FROM public.quotations q WHERE r.id = ANY(q.request_ids) AND q.status = 'sent');
SELECT set_config('app.request_stage', 'off', true);

-- Admin records the owner's answer (same signature as 045). The price goes to
-- request_owner_prices; the buyer is told only whether the board is free.
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
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admins only' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_req FROM public.availability_requests WHERE id = p_request_id;
  IF NOT FOUND OR v_req.board_id IS NULL THEN
    RAISE EXCEPTION 'board request not found' USING ERRCODE = '22023';
  END IF;
  IF v_req.stage NOT IN ('requested', 'owner_responded', 'quote_received', 'unavailable') THEN
    RAISE EXCEPTION 'the reply can no longer be changed (request is %)', v_req.stage USING ERRCODE = '22023';
  END IF;
  IF p_rate IS NOT NULL AND p_rate <= 0 THEN
    RAISE EXCEPTION 'the owner''s price must be more than zero' USING ERRCODE = '22023';
  END IF;

  v_owner := COALESCE(public.board_owner_account(v_req.board_id), auth.uid());
  INSERT INTO public.availability_responses
    (request_id, owner_id, board_id, available, quoted_rate, note, available_from, available_to, conditions, answered_by_admin)
  VALUES (p_request_id, v_owner, v_req.board_id, p_available, NULL, NULLIF(trim(p_note), ''),
          CASE WHEN p_available THEN p_from END, CASE WHEN p_available THEN p_to END,
          CASE WHEN p_available THEN NULLIF(trim(p_conditions), '') END, true)
  ON CONFLICT (request_id, board_id) DO UPDATE SET
    available = EXCLUDED.available, note = EXCLUDED.note,
    available_from = EXCLUDED.available_from, available_to = EXCLUDED.available_to,
    conditions = EXCLUDED.conditions, answered_by_admin = true, updated_at = NOW()
  RETURNING id INTO v_id;

  IF p_available AND p_rate IS NOT NULL THEN
    INSERT INTO public.request_owner_prices (request_id, board_id, owner_net_monthly, source, recorded_by)
    VALUES (p_request_id, v_req.board_id, p_rate, 'admin', auth.uid());
  END IF;

  SELECT name INTO v_board FROM public.boards WHERE id = v_req.board_id;
  INSERT INTO public.notifications (recipient_role, recipient_user_id, type, title, body, link)
  VALUES ('agency', v_req.agency_id, 'availability_response',
          CASE WHEN NOT p_available THEN COALESCE(v_board, v_req.title) || ' is not available for your dates'
               ELSE COALESCE(v_board, v_req.title) || ' is available' END,
          CASE WHEN p_available THEN 'We are preparing your quotation.' END,
          '/dashboard/agency/requests');
  RETURN v_id;
END;
$$;

-- Owners may read the prices recorded for their own boards.
DROP POLICY IF EXISTS request_owner_prices_owner_read ON public.request_owner_prices;
CREATE POLICY request_owner_prices_owner_read ON public.request_owner_prices FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.boards b WHERE b.id = board_id AND public.is_owner_member(b.owner_id, auth.uid())));

-- A new price for a request that already has a sent quotation does not
-- move the request back; the quotation stays the buyer's price.
CREATE OR REPLACE FUNCTION public.board_request_stage_from_response()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_next TEXT := CASE WHEN NOT NEW.available THEN 'unavailable' ELSE 'owner_responded' END;
BEGIN
  PERFORM set_config('app.request_stage', 'on', true);
  UPDATE public.availability_requests
     SET stage = v_next
   WHERE id = NEW.request_id AND board_id IS NOT NULL
     AND stage IN ('requested', 'owner_responded', 'quote_received', 'unavailable')
     AND stage <> v_next
     AND NOT (stage = 'quote_received' AND NEW.available);
  PERFORM set_config('app.request_stage', 'off', true);
  RETURN NEW;
END;
$$;

-- An owner's answer from their private link: record it, keep the price private.
CREATE OR REPLACE FUNCTION public.admin_send_owner_reply(p_request_id UUID, p_rate NUMERIC)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_x  public.owner_link_replies%ROWTYPE;
  v_id UUID;
  v_rate NUMERIC;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admins only' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_x FROM public.owner_link_replies WHERE request_id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No owner answer for this request' USING ERRCODE = '22023'; END IF;
  IF v_x.status = 'sent' THEN RAISE EXCEPTION 'Already recorded' USING ERRCODE = '22023'; END IF;
  v_rate := CASE WHEN v_x.available THEN COALESCE(p_rate, v_x.quoted_rate) END;
  IF v_rate IS NOT NULL AND v_rate <= 0 THEN RAISE EXCEPTION 'the owner''s price must be more than zero' USING ERRCODE = '22023'; END IF;
  v_id := public.admin_answer_board_request(
    p_request_id, v_x.available, NULL, v_x.available_from, v_x.available_to, v_x.conditions, v_x.note);
  IF v_rate IS NOT NULL AND v_rate > 0 THEN
    INSERT INTO public.request_owner_prices (request_id, board_id, owner_net_monthly, source, recorded_by)
    SELECT p_request_id, r.board_id, v_rate, 'owner_link', auth.uid() FROM public.availability_requests r WHERE r.id = p_request_id;
  END IF;
  UPDATE public.owner_link_replies
     SET status = 'sent', reviewed_by = auth.uid(), reviewed_at = NOW(), quoted_rate = v_rate
   WHERE request_id = p_request_id;
  RETURN v_id;
END;
$$;

-- ── 4. Totals ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.quotation_recalc(p_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_sub NUMERIC; v_disc NUMERIC; v_cost NUMERIC; v_vat NUMERIC; v_rate NUMERIC;
BEGIN
  UPDATE public.quotation_lines SET
    sell_monthly = CASE WHEN kind = 'board' THEN public.quote_sell_monthly(owner_net_monthly, pricing_mode, pricing_value) END,
    line_total = CASE
      WHEN kind = 'board'    THEN ROUND(public.quote_sell_monthly(owner_net_monthly, pricing_mode, pricing_value) * months, 2)
      WHEN kind = 'discount' THEN -amount
      ELSE amount END,
    line_cost = CASE
      WHEN kind = 'board' THEN ROUND(public.quote_cost_monthly(owner_net_monthly, pricing_mode, pricing_value) * months, 2)
      WHEN kind = 'discount' THEN 0
      ELSE COALESCE(cost, 0) END
  WHERE quotation_id = p_id;

  SELECT COALESCE(SUM(line_total) FILTER (WHERE kind <> 'discount'), 0),
         COALESCE(SUM(-line_total) FILTER (WHERE kind = 'discount'), 0),
         COALESCE(SUM(line_cost), 0)
    INTO v_sub, v_disc, v_cost
    FROM public.quotation_lines WHERE quotation_id = p_id;
  SELECT vat_rate INTO v_rate FROM public.quotations WHERE id = p_id;
  v_vat := ROUND((v_sub - v_disc) * v_rate / 100, 2);
  UPDATE public.quotations SET
    subtotal = v_sub, discount_total = v_disc, vat_amount = v_vat,
    total = v_sub - v_disc + v_vat, owner_cost_total = v_cost,
    platform_revenue = v_sub - v_disc - v_cost, updated_at = NOW()
  WHERE id = p_id;
END;
$$;
REVOKE ALL ON FUNCTION public.quotation_recalc(UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.quotation_log(p_id UUID, p_event TEXT, p_note TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.quotation_events (quotation_id, event, note, actor) VALUES (p_id, p_event, NULLIF(trim(p_note), ''), auth.uid());
$$;
REVOKE ALL ON FUNCTION public.quotation_log(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;

-- ── 5. Admin: build, send, extend, revise, withdraw, confirm ────────────
-- p = { id?, request_id, request_ids[], title, valid_until, vat_rate,
--       payment_terms, cancellation_terms, special_conditions, buyer_note,
--       lines: [{ kind, board_id, request_id, description, start_date,
--                 end_date, months, owner_net_monthly, pricing_mode,
--                 pricing_value, amount, cost }] }
CREATE OR REPLACE FUNCTION public.admin_save_quotation(p JSONB)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id      UUID := NULLIF(p->>'id', '')::uuid;
  v_req     UUID := NULLIF(p->>'request_id', '')::uuid;
  v_agency  UUID;
  v_reqs    UUID[];
  v_status  TEXT;
  v_line    JSONB;
  v_pos     INTEGER := 0;
  v_boards  INTEGER := 0;
  v_mode    TEXT;
  v_val     NUMERIC;
  v_set     public.commercial_settings%ROWTYPE;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admins only' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_set FROM public.commercial_settings WHERE id = 1;

  SELECT agency_id INTO v_agency FROM public.availability_requests WHERE id = v_req;
  IF v_agency IS NULL THEN RAISE EXCEPTION 'request not found' USING ERRCODE = '22023'; END IF;
  SELECT COALESCE(array_agg(DISTINCT x), '{}') INTO v_reqs
    FROM (SELECT v_req AS x UNION SELECT (jsonb_array_elements_text(COALESCE(p->'request_ids', '[]'::jsonb)))::uuid) s;
  IF EXISTS (SELECT 1 FROM public.availability_requests WHERE id = ANY(v_reqs) AND agency_id IS DISTINCT FROM v_agency) THEN
    RAISE EXCEPTION 'every request on a quotation must be from the same buyer' USING ERRCODE = '22023';
  END IF;

  IF v_id IS NULL THEN
    INSERT INTO public.quotations (ref, request_id, request_ids, agency_id, vat_rate, payment_terms, cancellation_terms,
                                   special_conditions, valid_until, created_by)
    VALUES ('Q-' || to_char(public.lagos_today(), 'YYYY') || '-' || lpad(nextval('public.quotation_ref_seq')::text, 4, '0'),
            v_req, v_reqs, v_agency, v_set.vat_rate, v_set.payment_terms, v_set.cancellation_terms, v_set.special_conditions,
            public.lagos_today() + v_set.validity_days, auth.uid())
    RETURNING id INTO v_id;
    PERFORM public.quotation_log(v_id, 'created');
  ELSE
    SELECT status INTO v_status FROM public.quotations WHERE id = v_id FOR UPDATE;
    IF v_status IS DISTINCT FROM 'draft' THEN
      RAISE EXCEPTION 'only a draft can be edited; make a revision instead' USING ERRCODE = '22023';
    END IF;
  END IF;

  UPDATE public.quotations SET
    request_id = v_req, request_ids = v_reqs, agency_id = v_agency,
    title = NULLIF(trim(p->>'title'), ''),
    valid_until = COALESCE(NULLIF(p->>'valid_until', '')::date, valid_until),
    vat_rate = COALESCE(NULLIF(p->>'vat_rate', '')::numeric, vat_rate),
    payment_terms = COALESCE(p->>'payment_terms', payment_terms),
    cancellation_terms = COALESCE(p->>'cancellation_terms', cancellation_terms),
    special_conditions = COALESCE(p->>'special_conditions', special_conditions),
    buyer_note = NULLIF(trim(p->>'buyer_note'), ''),
    is_test = COALESCE((p->>'is_test')::boolean, is_test)
  WHERE id = v_id;

  DELETE FROM public.quotation_lines WHERE quotation_id = v_id;
  FOR v_line IN SELECT * FROM jsonb_array_elements(COALESCE(p->'lines', '[]'::jsonb)) LOOP
    v_pos := v_pos + 1;
    v_mode := NULLIF(v_line->>'pricing_mode', '');
    v_val  := NULLIF(v_line->>'pricing_value', '')::numeric;
    IF v_line->>'kind' = 'board' THEN
      v_boards := v_boards + 1;
      IF v_mode = 'manual' AND (v_val IS NULL OR v_val <= 0) THEN
        RAISE EXCEPTION 'line %: enter the selling price', v_pos USING ERRCODE = '22023';
      END IF;
      IF v_mode = 'commission' AND (v_val IS NULL OR v_val < 0 OR v_val >= 100) THEN
        RAISE EXCEPTION 'line %: commission must be between 0 and 100%%', v_pos USING ERRCODE = '22023';
      END IF;
      IF v_mode = 'markup_percent' AND v_val IS NOT NULL AND v_val < -100 THEN
        RAISE EXCEPTION 'line %: markup is too low', v_pos USING ERRCODE = '22023';
      END IF;
    END IF;
    INSERT INTO public.quotation_lines (quotation_id, position, kind, board_id, request_id, description, start_date, end_date,
                                        months, owner_net_monthly, pricing_mode, pricing_value, amount, cost)
    VALUES (v_id, v_pos, v_line->>'kind', NULLIF(v_line->>'board_id', '')::uuid, NULLIF(v_line->>'request_id', '')::uuid,
            trim(v_line->>'description'), NULLIF(v_line->>'start_date', '')::date, NULLIF(v_line->>'end_date', '')::date,
            COALESCE(NULLIF(v_line->>'months', '')::numeric, 1), NULLIF(v_line->>'owner_net_monthly', '')::numeric,
            v_mode, v_val, NULLIF(v_line->>'amount', '')::numeric, NULLIF(v_line->>'cost', '')::numeric);
  END LOOP;
  IF v_boards = 0 THEN RAISE EXCEPTION 'add at least one board' USING ERRCODE = '22023'; END IF;

  PERFORM public.quotation_recalc(v_id);
  PERFORM public.quotation_log(v_id, 'saved');
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_send_quotation(p_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_q public.quotations%ROWTYPE;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admins only' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_q FROM public.quotations WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'quotation not found' USING ERRCODE = '22023'; END IF;
  IF v_q.status <> 'draft' THEN RAISE EXCEPTION 'this quotation was already %', v_q.status USING ERRCODE = '22023'; END IF;
  IF v_q.total <= 0 THEN RAISE EXCEPTION 'the quotation total must be more than zero' USING ERRCODE = '22023'; END IF;
  IF v_q.valid_until IS NULL OR v_q.valid_until < public.lagos_today() THEN
    RAISE EXCEPTION 'set a valid-until date from today onwards' USING ERRCODE = '22023';
  END IF;

  UPDATE public.quotations SET status = 'sent', issued_on = public.lagos_today(), sent_at = NOW(), updated_at = NOW()
   WHERE id = p_id;
  -- A revision replaces the quotation it came from.
  IF v_q.revised_from IS NOT NULL THEN
    UPDATE public.quotations SET status = 'superseded', updated_at = NOW()
     WHERE id = v_q.revised_from AND status IN ('sent', 'declined');
    PERFORM public.quotation_log(v_q.revised_from, 'superseded', 'Replaced by ' || v_q.ref);
  END IF;

  PERFORM set_config('app.request_stage', 'on', true);
  UPDATE public.availability_requests SET stage = 'quote_received'
   WHERE id = ANY(v_q.request_ids) AND stage IN ('requested', 'owner_responded', 'quote_received', 'negotiating');
  PERFORM set_config('app.request_stage', 'off', true);

  INSERT INTO public.notifications (recipient_role, recipient_user_id, type, title, body, link)
  VALUES ('agency', v_q.agency_id, 'availability_response', 'Your quotation is ready: ' || v_q.ref,
          '₦' || to_char(v_q.total, 'FM999,999,999,990') || ' · valid until ' || to_char(v_q.valid_until, 'DD Mon YYYY'),
          '/dashboard/agency/requests');
  PERFORM public.quotation_log(p_id, 'sent');
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_extend_quotation(p_id UUID, p_valid_until DATE, p_note TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_q public.quotations%ROWTYPE;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admins only' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_q FROM public.quotations WHERE id = p_id FOR UPDATE;
  IF v_q.status NOT IN ('sent', 'draft') THEN RAISE EXCEPTION 'only an open quotation can be extended' USING ERRCODE = '22023'; END IF;
  IF p_valid_until IS NULL OR p_valid_until < public.lagos_today() THEN
    RAISE EXCEPTION 'choose a date from today onwards' USING ERRCODE = '22023';
  END IF;
  UPDATE public.quotations SET valid_until = p_valid_until, updated_at = NOW() WHERE id = p_id;
  PERFORM public.quotation_log(p_id, 'extended',
    'Valid until ' || to_char(p_valid_until, 'DD Mon YYYY') || COALESCE(' · ' || NULLIF(trim(p_note), ''), ''));
END;
$$;

-- Copy a quotation into a new draft. The old one stays until the new one is sent.
CREATE OR REPLACE FUNCTION public.admin_revise_quotation(p_id UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_q public.quotations%ROWTYPE; v_new UUID;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admins only' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_q FROM public.quotations WHERE id = p_id;
  IF v_q.status NOT IN ('sent', 'declined', 'withdrawn') THEN
    RAISE EXCEPTION 'only a sent, declined or withdrawn quotation can be revised' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.quotations (ref, request_id, request_ids, agency_id, title, valid_until, vat_rate, payment_terms,
                                 cancellation_terms, special_conditions, buyer_note, revised_from, is_test, created_by)
  VALUES (v_q.ref || '-R' || (SELECT COUNT(*) + 1 FROM public.quotations WHERE ref LIKE v_q.ref || '-R%'),
          v_q.request_id, v_q.request_ids, v_q.agency_id, v_q.title,
          GREATEST(v_q.valid_until, public.lagos_today() + (SELECT validity_days FROM public.commercial_settings WHERE id = 1)),
          v_q.vat_rate, v_q.payment_terms, v_q.cancellation_terms, v_q.special_conditions, v_q.buyer_note, v_q.id, v_q.is_test, auth.uid())
  RETURNING id INTO v_new;
  INSERT INTO public.quotation_lines (quotation_id, position, kind, board_id, request_id, description, start_date, end_date,
                                      months, owner_net_monthly, pricing_mode, pricing_value, amount, cost)
  SELECT v_new, position, kind, board_id, request_id, description, start_date, end_date,
         months, owner_net_monthly, pricing_mode, pricing_value, amount, cost
    FROM public.quotation_lines WHERE quotation_id = p_id;
  PERFORM public.quotation_recalc(v_new);
  PERFORM public.quotation_log(v_new, 'created', 'Revision of ' || v_q.ref);
  RETURN v_new;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_withdraw_quotation(p_id UUID, p_reason TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_q public.quotations%ROWTYPE;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admins only' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_q FROM public.quotations WHERE id = p_id FOR UPDATE;
  IF v_q.status NOT IN ('draft', 'sent') THEN RAISE EXCEPTION 'this quotation is already %', v_q.status USING ERRCODE = '22023'; END IF;
  UPDATE public.quotations SET status = 'withdrawn', withdrawn_at = NOW(), withdraw_reason = NULLIF(trim(p_reason), ''), updated_at = NOW()
   WHERE id = p_id;
  IF v_q.status = 'sent' THEN
    INSERT INTO public.notifications (recipient_role, recipient_user_id, type, title, body, link)
    VALUES ('agency', v_q.agency_id, 'booking_update', 'Quotation withdrawn: ' || v_q.ref, NULLIF(trim(p_reason), ''), '/dashboard/agency/requests');
  END IF;
  PERFORM public.quotation_log(p_id, 'withdrawn', p_reason);
END;
$$;

-- Confirm the booking(s) from an accepted quotation.
CREATE OR REPLACE FUNCTION public.admin_confirm_quotation_booking(p_id UUID, p_message TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_q public.quotations%ROWTYPE; v_r UUID;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admins only' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_q FROM public.quotations WHERE id = p_id FOR UPDATE;
  IF v_q.status <> 'accepted' THEN RAISE EXCEPTION 'only an accepted quotation can be confirmed' USING ERRCODE = '22023'; END IF;
  IF v_q.booking_confirmed_at IS NOT NULL THEN RAISE EXCEPTION 'already confirmed' USING ERRCODE = '22023'; END IF;
  FOREACH v_r IN ARRAY v_q.request_ids LOOP
    IF EXISTS (SELECT 1 FROM public.availability_requests WHERE id = v_r AND stage IN ('accepted', 'booking_in_progress')) THEN
      PERFORM public.admin_set_request_stage(v_r, 'confirmed', p_message);
    END IF;
  END LOOP;
  UPDATE public.bookings SET status = 'signed', confirmed_at = COALESCE(confirmed_at, NOW())
   WHERE quotation_id = p_id AND status IN ('agreed', 'pending', 'negotiating', 'signed');
  UPDATE public.campaigns SET status = 'active' WHERE id = v_q.campaign_id AND status = 'pending';
  UPDATE public.quotations SET booking_confirmed_at = NOW(), updated_at = NOW() WHERE id = p_id;
  PERFORM public.quotation_log(p_id, 'booking_confirmed', p_message);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_quotation_payment(p_id UUID, p_status TEXT, p_amount NUMERIC)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admins only' USING ERRCODE = '42501'; END IF;
  UPDATE public.quotations SET payment_status = p_status, amount_paid = COALESCE(p_amount, 0), updated_at = NOW() WHERE id = p_id;
  PERFORM public.quotation_log(p_id, 'payment', p_status || ' · ₦' || to_char(COALESCE(p_amount, 0), 'FM999,999,999,990'));
END;
$$;

DO $$
DECLARE f TEXT;
BEGIN
  FOREACH f IN ARRAY ARRAY['admin_save_quotation(jsonb)', 'admin_send_quotation(uuid)', 'admin_extend_quotation(uuid, date, text)',
                           'admin_revise_quotation(uuid)', 'admin_withdraw_quotation(uuid, text)',
                           'admin_confirm_quotation_booking(uuid, text)', 'admin_set_quotation_payment(uuid, text, numeric)'] LOOP
    EXECUTE 'REVOKE ALL ON FUNCTION public.' || f || ' FROM PUBLIC, anon';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.' || f || ' TO authenticated';
  END LOOP;
END $$;

-- ── 6. Buyer: read and answer their quotations ──────────────────────────
-- Only buyer-facing fields. Never owner rates, costs, margins or pricing modes.
CREATE OR REPLACE FUNCTION public.my_quotations()
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', q.id, 'ref', q.ref, 'status', q.status, 'request_ids', q.request_ids, 'title', q.title,
    'issued_on', q.issued_on, 'valid_until', q.valid_until,
    'expired', q.status = 'sent' AND q.valid_until < public.lagos_today(),
    'vat_rate', q.vat_rate, 'subtotal', q.subtotal, 'discount_total', q.discount_total,
    'vat_amount', q.vat_amount, 'total', q.total,
    'payment_terms', q.payment_terms, 'cancellation_terms', q.cancellation_terms,
    'special_conditions', q.special_conditions, 'buyer_note', q.buyer_note,
    'sent_at', q.sent_at, 'accepted_at', q.accepted_at, 'declined_at', q.declined_at, 'decline_reason', q.decline_reason,
    'withdrawn_at', q.withdrawn_at, 'booking_confirmed_at', q.booking_confirmed_at,
    'lines', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                'kind', l.kind, 'board_id', l.board_id, 'description', l.description,
                'start_date', l.start_date, 'end_date', l.end_date, 'months', l.months,
                'unit_monthly', l.sell_monthly, 'line_total', l.line_total) ORDER BY l.position), '[]'::jsonb)
              FROM public.quotation_lines l WHERE l.quotation_id = q.id)
  ) ORDER BY q.created_at DESC), '[]'::jsonb)
  FROM public.quotations q
  WHERE q.agency_id = auth.uid() AND q.status <> 'draft';
$$;
REVOKE ALL ON FUNCTION public.my_quotations() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_quotations() TO authenticated;

-- p_action: 'accept' | 'decline' | 'clarify'
CREATE OR REPLACE FUNCTION public.buyer_respond_quotation(p_id UUID, p_action TEXT, p_note TEXT DEFAULT NULL)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid      UUID := auth.uid();
  v_q        public.quotations%ROWTYPE;
  v_l        public.quotation_lines%ROWTYPE;
  v_campaign UUID;
  v_booking  UUID;
  v_company  TEXT;
  v_start    DATE;
  v_end      DATE;
  v_req      public.availability_requests%ROWTYPE;
  v_owner    UUID;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'sign in first' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_q FROM public.quotations WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR v_q.agency_id IS DISTINCT FROM v_uid OR v_q.status = 'draft' THEN
    RAISE EXCEPTION 'quotation not found' USING ERRCODE = '42501';
  END IF;
  IF v_q.status <> 'sent' THEN RAISE EXCEPTION 'this quotation is %', v_q.status USING ERRCODE = '22023'; END IF;

  IF p_action = 'clarify' THEN
    IF NULLIF(trim(p_note), '') IS NULL THEN RAISE EXCEPTION 'write your question first' USING ERRCODE = '22023'; END IF;
    PERFORM public.quotation_log(p_id, 'clarification', left(p_note, 2000));
    INSERT INTO public.notifications (recipient_role, recipient_user_id, type, title, body, link)
    VALUES ('admin', NULL, 'message', 'Question about ' || v_q.ref, left(p_note, 300), '/dashboard/admin/quotations');
    RETURN NULL;
  END IF;

  IF p_action = 'decline' THEN
    UPDATE public.quotations SET status = 'declined', declined_at = NOW(), decline_reason = NULLIF(left(trim(p_note), 1000), ''), updated_at = NOW()
     WHERE id = p_id;
    PERFORM public.quotation_log(p_id, 'declined', p_note);
    INSERT INTO public.notifications (recipient_role, recipient_user_id, type, title, body, link)
    VALUES ('admin', NULL, 'offer_declined', 'Quotation declined: ' || v_q.ref, NULLIF(left(trim(p_note), 300), ''), '/dashboard/admin/quotations');
    RETURN NULL;
  END IF;

  IF p_action <> 'accept' THEN RAISE EXCEPTION 'unknown action' USING ERRCODE = '22023'; END IF;
  IF v_q.valid_until < public.lagos_today() THEN
    RAISE EXCEPTION 'this quotation expired on %. Ask us for an updated one.', to_char(v_q.valid_until, 'DD Mon YYYY') USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.availability_requests WHERE id = ANY(v_q.request_ids) AND stage IN ('cancelled', 'unavailable', 'confirmed')) THEN
    RAISE EXCEPTION 'a request on this quotation was closed. Ask us for an updated quotation.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_req FROM public.availability_requests WHERE id = v_q.request_id;
  SELECT company INTO v_company FROM public.availability_request_contacts WHERE request_id = v_q.request_id;
  SELECT MIN(COALESCE(l.start_date, r.start_date)), MAX(COALESCE(l.end_date, r.end_date)) INTO v_start, v_end
    FROM public.quotation_lines l LEFT JOIN public.availability_requests r ON r.id = COALESCE(l.request_id, v_q.request_id)
   WHERE l.quotation_id = p_id AND l.kind = 'board';

  INSERT INTO public.campaigns (agency_id, name, client_name, status, start_date, end_date, total_budget, request_id, payment_terms)
  VALUES (v_uid, COALESCE(v_q.title, 'Quotation ' || v_q.ref), COALESCE(v_company, v_req.agency_name), 'pending',
          v_start, v_end, v_q.total, v_q.request_id, left(v_q.payment_terms, 500))
  RETURNING id INTO v_campaign;

  FOR v_l IN SELECT * FROM public.quotation_lines WHERE quotation_id = p_id AND kind = 'board' ORDER BY position LOOP
    INSERT INTO public.bookings (campaign_id, board_id, offered_rate, agreed_rate, gross_rate, status, start_date, end_date,
                                 duration_months, notes, quotation_id)
    -- Owners can read bookings on their boards, so no price goes on the
    -- booking row: the buyer's price lives on the quotation, the owner's in
    -- request_owner_prices, both in booking_financials (admins).
    VALUES (v_campaign, v_l.board_id, NULL, NULL, NULL, 'agreed',
            COALESCE(v_l.start_date, v_start), COALESCE(v_l.end_date, v_end), GREATEST(1, CEIL(v_l.months))::int,
            'Quotation ' || v_q.ref || ' · ' || v_l.description, p_id)
    RETURNING id INTO v_booking;
    INSERT INTO public.booking_financials (booking_id, quotation_id, months, owner_net_monthly, pricing_mode, pricing_value,
                                           sell_monthly, owner_cost_total, sell_total, platform_revenue)
    VALUES (v_booking, p_id, v_l.months, v_l.owner_net_monthly, v_l.pricing_mode, v_l.pricing_value,
            v_l.sell_monthly, v_l.line_cost, v_l.line_total, v_l.line_total - v_l.line_cost);

    -- Link the booking to the board's request (for the request screens).
    IF v_l.request_id IS NOT NULL THEN
      UPDATE public.availability_responses SET accepted_booking_id = v_booking
       WHERE request_id = v_l.request_id AND board_id = v_l.board_id;
      IF NOT FOUND THEN
        v_owner := COALESCE(public.board_owner_account(v_l.board_id), v_q.created_by);
        IF v_owner IS NOT NULL THEN
          INSERT INTO public.availability_responses (request_id, owner_id, board_id, available, answered_by_admin, accepted_booking_id)
          VALUES (v_l.request_id, v_owner, v_l.board_id, true, true, v_booking)
          ON CONFLICT (request_id, board_id) DO UPDATE SET accepted_booking_id = EXCLUDED.accepted_booking_id;
        END IF;
      END IF;
    END IF;
  END LOOP;

  PERFORM set_config('app.request_stage', 'on', true);
  UPDATE public.availability_requests SET stage = 'accepted'
   WHERE id = ANY(v_q.request_ids) AND stage IN ('requested', 'owner_responded', 'quote_received', 'negotiating');
  PERFORM set_config('app.request_stage', 'off', true);

  UPDATE public.quotations SET status = 'accepted', accepted_at = NOW(), accepted_by = v_uid, campaign_id = v_campaign, updated_at = NOW()
   WHERE id = p_id;
  PERFORM public.quotation_log(p_id, 'accepted');
  INSERT INTO public.notifications (recipient_role, recipient_user_id, type, title, body, link)
  VALUES ('admin', NULL, 'offer_accepted', 'Quotation accepted: ' || v_q.ref,
          '₦' || to_char(v_q.total, 'FM999,999,999,990') || ' · confirm the booking with the owner', '/dashboard/admin/quotations');
  RETURN v_campaign;
END;
$$;
REVOKE ALL ON FUNCTION public.buyer_respond_quotation(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.buyer_respond_quotation(UUID, TEXT, TEXT) TO authenticated;

-- Bookings made from a quotation change only through the functions above
-- (an owner team may otherwise update bookings on its boards).
CREATE OR REPLACE FUNCTION public.guard_quotation_booking()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.quotation_id IS NULL OR public.is_admin() OR auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF NEW.status IS DISTINCT FROM OLD.status OR NEW.offered_rate IS DISTINCT FROM OLD.offered_rate
     OR NEW.agreed_rate IS DISTINCT FROM OLD.agreed_rate OR NEW.gross_rate IS DISTINCT FROM OLD.gross_rate
     OR NEW.start_date IS DISTINCT FROM OLD.start_date OR NEW.end_date IS DISTINCT FROM OLD.end_date
     OR NEW.board_id IS DISTINCT FROM OLD.board_id OR NEW.campaign_id IS DISTINCT FROM OLD.campaign_id
     OR NEW.quotation_id IS DISTINCT FROM OLD.quotation_id THEN
    RAISE EXCEPTION 'this booking comes from an accepted quotation; only OOH Platform can change it' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS bookings_guard_quotation ON public.bookings;
CREATE TRIGGER bookings_guard_quotation BEFORE UPDATE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.guard_quotation_booking();

-- A request's booking: also found through a multi-board quotation.
CREATE OR REPLACE FUNCTION public.board_request_booking(p_request_id UUID)
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM (
    SELECT b.id, 0 AS pri, b.created_at FROM public.bookings b
      JOIN public.quotation_lines l ON l.quotation_id = b.quotation_id AND l.board_id = b.board_id
     WHERE l.request_id = p_request_id
    UNION ALL
    SELECT b.id, 1, b.created_at FROM public.bookings b JOIN public.campaigns c ON c.id = b.campaign_id
     WHERE c.request_id = p_request_id
  ) x ORDER BY pri, created_at LIMIT 1;
$$;

-- ── 7. Funnel: quotations sent/accepted and confirmed value come from quotations ─
CREATE OR REPLACE FUNCTION public.funnel_window(p_from TIMESTAMPTZ, p_to TIMESTAMPTZ)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH ev AS (
    SELECT event, visitor FROM public.funnel_events WHERE created_at >= p_from AND created_at < p_to
  ), rq AS (
    SELECT r.id, r.agency_id, r.stage, r.created_at,
           (SELECT MIN(x.t) FROM (
              SELECT ar.created_at AS t FROM public.availability_responses ar WHERE ar.request_id = r.id
              UNION ALL
              SELECT ol.created_at FROM public.owner_link_replies ol WHERE ol.request_id = r.id) x) AS answered_at
      FROM public.availability_requests r
     WHERE r.board_id IS NOT NULL AND r.created_at >= p_from AND r.created_at < p_to
  ), qt AS (
    SELECT * FROM public.quotations WHERE NOT is_test
  )
  SELECT jsonb_build_object(
    'visitors',        (SELECT COUNT(DISTINCT visitor) FROM ev),
    'visited',         (SELECT COUNT(DISTINCT visitor) FROM ev WHERE event = 'site_visit'),
    'searched',        (SELECT COUNT(DISTINCT visitor) FROM ev WHERE event = 'search'),
    'viewed',          (SELECT COUNT(DISTINCT visitor) FROM ev WHERE event = 'board_view'),
    'saved',           (SELECT COUNT(DISTINCT visitor) FROM ev WHERE event = 'shortlist_add'),
    'started',         (SELECT COUNT(DISTINCT visitor) FROM ev WHERE event = 'request_open'),
    'sent',            (SELECT COUNT(DISTINCT visitor) FROM ev WHERE event = 'request_sent'),
    'signups',         (SELECT COUNT(*) FROM public.profiles WHERE role = 'agency' AND created_at >= p_from AND created_at < p_to),
    'buyers',          (SELECT COUNT(DISTINCT agency_id) FROM rq),
    'requests',        (SELECT COUNT(*) FROM rq),
    'answered',        (SELECT COUNT(*) FROM rq WHERE answered_at IS NOT NULL),
    'quoted',          (SELECT COUNT(*) FROM rq WHERE EXISTS (SELECT 1 FROM qt WHERE rq.id = ANY(qt.request_ids) AND qt.sent_at IS NOT NULL)),
    'accepted',        (SELECT COUNT(*) FROM rq WHERE EXISTS (SELECT 1 FROM qt WHERE rq.id = ANY(qt.request_ids) AND qt.accepted_at IS NOT NULL)),
    'confirmed',       (SELECT COUNT(*) FROM rq WHERE stage = 'confirmed'),
    -- value excludes VAT; one quotation counted once even if it covers several requests
    'confirmed_value', (SELECT COALESCE(SUM(total - vat_amount), 0) FROM qt
                         WHERE booking_confirmed_at IS NOT NULL AND request_ids && (SELECT array_agg(id) FROM rq)),
    'revenue',         (SELECT COALESCE(SUM(platform_revenue), 0) FROM qt
                         WHERE booking_confirmed_at IS NOT NULL AND request_ids && (SELECT array_agg(id) FROM rq)),
    'median_answer_hours', (SELECT ROUND((percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM answered_at - created_at) / 3600))::numeric, 1)
                              FROM rq WHERE answered_at IS NOT NULL),
    'proposals',       (SELECT COUNT(*) FROM public.proposals WHERE created_at >= p_from AND created_at < p_to),
    'proposals_opened',(SELECT COUNT(*) FROM public.proposals WHERE created_at >= p_from AND created_at < p_to AND open_count > 0)
  );
$$;
REVOKE ALL ON FUNCTION public.funnel_window(TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;

COMMIT;

-- ROLLBACK (by hand, only if needed — drops all quotation data):
-- DROP TRIGGER IF EXISTS availability_responses_privatise_rate ON public.availability_responses;
-- DROP TRIGGER IF EXISTS bookings_guard_quotation ON public.bookings;
-- ALTER TABLE public.bookings DROP COLUMN IF EXISTS quotation_id;
-- DROP TABLE IF EXISTS public.booking_financials, public.quotation_events, public.quotation_lines,
--   public.quotations, public.request_owner_prices, public.commercial_settings, public.email_log;
-- then re-run the functions from 043 (board_request_stage_from_response), 044 (board_request_booking),
-- 045 (admin_answer_board_request), 053 (admin_send_owner_reply) and 059 (funnel_window).
-- Owner prices moved out of availability_responses stay in request_owner_prices until restored by hand.
