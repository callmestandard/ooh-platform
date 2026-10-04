-- ═══════════════════════════════════════════════════════════════════
-- OOH Platform — one-to-many availability requests
-- Run in Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- Requires 030_print_tasks.sql (board_owner_match / board_has_verified_owner).
-- Safe to re-run: IF NOT EXISTS / CREATE OR REPLACE / DROP POLICY IF EXISTS.
--
-- An agency sends ONE structured request (cities, formats, dates, budget)
-- and every board owner with a platform account and a matching board gets
-- it. Each owner answers once, per board: available or not, plus an
-- optional quoted monthly rate and note.
--
-- Isolation rules, all enforced here rather than in the UI:
--   • A request is visible only to the agency that sent it and to the
--     owners it was sent to.
--   • An owner sees ONLY their own recipient row and their own responses —
--     never who else was asked or what anyone else quoted.
--   • A quote is visible only to the owner who gave it and the requesting
--     agency. No other agency, client or owner can read it.
--   • Owners can only answer for boards they own, on requests they
--     received, while the request is open.
--
-- Cross-table checks go through SECURITY DEFINER helpers: a subquery inside
-- a policy runs under the caller's own RLS, which is exactly what broke the
-- owner path in 030 (fixed in 032).
-- ═══════════════════════════════════════════════════════════════════

-- ── 1. Tables ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.availability_requests (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  agency_name TEXT,
  title       TEXT NOT NULL,
  cities      TEXT[] NOT NULL CHECK (array_length(cities, 1) >= 1),
  -- boards.format values; empty = any format
  formats     TEXT[] NOT NULL DEFAULT '{}',
  start_date  DATE NOT NULL,
  end_date    DATE NOT NULL CHECK (end_date >= start_date),
  budget      NUMERIC,
  notes       TEXT,
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.availability_request_recipients (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id   UUID NOT NULL REFERENCES public.availability_requests(id) ON DELETE CASCADE,
  owner_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- denormalized: agencies have no SELECT on owner profiles
  owner_name   TEXT,
  board_count  INTEGER NOT NULL DEFAULT 0,
  responded_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (request_id, owner_id)
);

CREATE TABLE IF NOT EXISTS public.availability_responses (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id          UUID NOT NULL REFERENCES public.availability_requests(id) ON DELETE CASCADE,
  owner_id            UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  board_id            UUID NOT NULL REFERENCES public.boards(id) ON DELETE CASCADE,
  available           BOOLEAN NOT NULL,
  quoted_rate         NUMERIC CHECK (quoted_rate IS NULL OR quoted_rate > 0),
  note                TEXT,
  -- set by the agency when it turns this response into a booking
  accepted_booking_id UUID REFERENCES public.bookings(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (request_id, board_id)
);

CREATE INDEX IF NOT EXISTS idx_avail_requests_agency    ON public.availability_requests(agency_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_avail_recipients_owner   ON public.availability_request_recipients(owner_id);
CREATE INDEX IF NOT EXISTS idx_avail_recipients_request ON public.availability_request_recipients(request_id);
CREATE INDEX IF NOT EXISTS idx_avail_responses_request  ON public.availability_responses(request_id);

-- ── 2. Helpers (SECURITY DEFINER — see header) ───────────────────────────

CREATE OR REPLACE FUNCTION public.availability_request_agency(p_request_id UUID)
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT agency_id FROM public.availability_requests WHERE id = p_request_id;
$$;

CREATE OR REPLACE FUNCTION public.availability_request_is_open(p_request_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT status = 'open' FROM public.availability_requests WHERE id = p_request_id), false);
$$;

CREATE OR REPLACE FUNCTION public.is_availability_recipient(p_request_id UUID, p_uid UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.availability_request_recipients r
    WHERE r.request_id = p_request_id AND r.owner_id = p_uid
  );
$$;

-- The account that answers for a board: the direct owner, else the owner who
-- confirmed an agent's authorization (boards.owner_id stays NULL in that path).
CREATE OR REPLACE FUNCTION public.board_owner_account(p_board_id UUID)
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT b.owner_id FROM public.boards b WHERE b.id = p_board_id),
    (SELECT a.owner_id FROM public.board_authorizations a
      WHERE a.board_id = p_board_id AND a.status = 'active' AND a.owner_verified = true AND a.owner_id IS NOT NULL
      LIMIT 1)
  );
$$;

-- Does this board match the request's cities + formats?
CREATE OR REPLACE FUNCTION public.board_matches_availability_request(p_board_id UUID, p_request_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.boards b, public.availability_requests r
    WHERE b.id = p_board_id AND r.id = p_request_id
      AND b.status <> 'decommissioned'
      AND lower(trim(b.city)) IN (SELECT lower(trim(c)) FROM unnest(r.cities) c)
      AND (cardinality(r.formats) = 0 OR b.format = ANY (r.formats))
  );
$$;

-- ── 3. Send: create the request and fan it out, atomically ───────────────

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
  WHERE m.owner_id IS NOT NULL AND m.owner_id <> v_uid;

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

-- Matching boards nobody on the platform can answer for (no owner account) —
-- returned to the requesting agency only, so it knows who still needs a call.
CREATE OR REPLACE FUNCTION public.availability_request_unreached_boards(p_request_id UUID)
RETURNS TABLE (board_id UUID, name TEXT, city TEXT, format TEXT, contact_name TEXT, contact_phone TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT b.id, b.name, b.city, b.format, b.contact_name, b.contact_phone
  FROM public.boards b
  WHERE public.availability_request_agency(p_request_id) = auth.uid()
    AND public.board_matches_availability_request(b.id, p_request_id)
    AND public.board_owner_account(b.id) IS NULL
  ORDER BY b.city, b.name;
$$;

-- ── 4. Response guard ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.guard_availability_response()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_is_agency BOOLEAN := v_uid IS NOT NULL AND public.availability_request_agency(NEW.request_id) = v_uid;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.request_id IS DISTINCT FROM OLD.request_id OR NEW.board_id IS DISTINCT FROM OLD.board_id OR NEW.owner_id IS DISTINCT FROM OLD.owner_id THEN
      RAISE EXCEPTION 'an availability response cannot be moved to another request, board or owner';
    END IF;
  END IF;

  IF v_uid IS NOT NULL AND auth_role() <> 'admin' THEN
    IF v_is_agency THEN
      -- The requesting agency may only record which booking a response became.
      IF TG_OP = 'INSERT'
         OR NEW.available IS DISTINCT FROM OLD.available
         OR NEW.quoted_rate IS DISTINCT FROM OLD.quoted_rate
         OR NEW.note IS DISTINCT FROM OLD.note THEN
        RAISE EXCEPTION 'only the board owner can set availability, rate and note';
      END IF;
    ELSE
      -- The owner may not mark their own response as accepted.
      IF TG_OP = 'INSERT' THEN
        NEW.accepted_booking_id := NULL;
      ELSIF NEW.accepted_booking_id IS DISTINCT FROM OLD.accepted_booking_id THEN
        RAISE EXCEPTION 'only the requesting agency can accept a response';
      END IF;
      IF NOT public.availability_request_is_open(NEW.request_id) THEN
        RAISE EXCEPTION 'this availability request is closed';
      END IF;
    END IF;
  END IF;

  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS availability_responses_guard ON public.availability_responses;
CREATE TRIGGER availability_responses_guard
  BEFORE INSERT OR UPDATE ON public.availability_responses
  FOR EACH ROW EXECUTE FUNCTION public.guard_availability_response();

CREATE OR REPLACE FUNCTION public.mark_availability_recipient_responded()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.availability_request_recipients
     SET responded_at = COALESCE(responded_at, NOW())
   WHERE request_id = NEW.request_id AND owner_id = NEW.owner_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS availability_responses_mark_responded ON public.availability_responses;
CREATE TRIGGER availability_responses_mark_responded
  AFTER INSERT ON public.availability_responses
  FOR EACH ROW EXECUTE FUNCTION public.mark_availability_recipient_responded();

-- ── 5. RLS ───────────────────────────────────────────────────────────────

ALTER TABLE public.availability_requests           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.availability_request_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.availability_responses          ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "avail_requests_select"   ON public.availability_requests;
DROP POLICY IF EXISTS "avail_requests_update"   ON public.availability_requests;
DROP POLICY IF EXISTS "avail_requests_delete"   ON public.availability_requests;
DROP POLICY IF EXISTS "avail_recipients_select" ON public.availability_request_recipients;
DROP POLICY IF EXISTS "avail_responses_select"  ON public.availability_responses;
DROP POLICY IF EXISTS "avail_responses_insert"  ON public.availability_responses;
DROP POLICY IF EXISTS "avail_responses_update"  ON public.availability_responses;
DROP POLICY IF EXISTS "avail_responses_delete"  ON public.availability_responses;

-- Requests: the sender and its recipients. Created only via
-- send_availability_request() (no INSERT policy on purpose).
CREATE POLICY "avail_requests_select" ON public.availability_requests FOR SELECT USING (
  agency_id = auth.uid()
  OR public.is_availability_recipient(id, auth.uid())
  OR auth_role() = 'admin'
);
CREATE POLICY "avail_requests_update" ON public.availability_requests FOR UPDATE
  USING (agency_id = auth.uid()) WITH CHECK (agency_id = auth.uid());
CREATE POLICY "avail_requests_delete" ON public.availability_requests FOR DELETE
  USING (agency_id = auth.uid() OR auth_role() = 'admin');

-- Recipients: the sender sees all of its request's recipients; an owner
-- sees only its own row. Written only by the send function and the trigger.
CREATE POLICY "avail_recipients_select" ON public.availability_request_recipients FOR SELECT USING (
  owner_id = auth.uid()
  OR public.availability_request_agency(request_id) = auth.uid()
  OR auth_role() = 'admin'
);

-- Responses: the owner who gave it and the requesting agency. Nobody else.
CREATE POLICY "avail_responses_select" ON public.availability_responses FOR SELECT USING (
  owner_id = auth.uid()
  OR public.availability_request_agency(request_id) = auth.uid()
  OR auth_role() = 'admin'
);
CREATE POLICY "avail_responses_insert" ON public.availability_responses FOR INSERT WITH CHECK (
  owner_id = auth.uid()
  AND public.is_availability_recipient(request_id, auth.uid())
  AND public.board_owner_match(board_id, auth.uid())
  AND public.board_matches_availability_request(board_id, request_id)
);
CREATE POLICY "avail_responses_update" ON public.availability_responses FOR UPDATE
  USING (owner_id = auth.uid() OR public.availability_request_agency(request_id) = auth.uid())
  WITH CHECK (owner_id = auth.uid() OR public.availability_request_agency(request_id) = auth.uid());
CREATE POLICY "avail_responses_delete" ON public.availability_responses FOR DELETE
  USING (owner_id = auth.uid() AND accepted_booking_id IS NULL);

GRANT SELECT, UPDATE, DELETE ON public.availability_requests TO authenticated;
GRANT SELECT ON public.availability_request_recipients TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.availability_responses TO authenticated;
GRANT EXECUTE ON FUNCTION public.send_availability_request(TEXT, TEXT[], TEXT[], DATE, DATE, NUMERIC, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.availability_request_unreached_boards(UUID) TO authenticated;
