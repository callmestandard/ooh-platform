-- ═══════════════════════════════════════════════════════════════════
-- OOH Platform — request several boards at once, and proposal links
-- Run in Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- Requires 043 (send_board_request). Safe to re-run.
--
-- 1. availability_requests.request_group ties together requests a buyer
--    sent in one go from their shortlist. Each board is still its own
--    request (each owner quotes their own board), so every rule in
--    send_board_request still applies per board.
-- 2. send_board_requests(...) sends one request per board in a single
--    transaction. Boards the buyer already has an open request for are
--    skipped, not failed.
-- 3. proposals: a buyer's shortlist saved under a secret link to send to
--    their client. Anyone with the link can view it (get_proposal); only
--    the buyer (and admins) can list or delete their proposals.
-- ═══════════════════════════════════════════════════════════════════

-- ── 1. Group column ──────────────────────────────────────────────────────
ALTER TABLE public.availability_requests ADD COLUMN IF NOT EXISTS request_group UUID;
CREATE INDEX IF NOT EXISTS idx_availability_requests_group ON public.availability_requests(request_group) WHERE request_group IS NOT NULL;

-- ── 2. Several boards in one go ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.send_board_requests(
  p_board_ids UUID[], p_start DATE, p_end DATE,
  p_name TEXT, p_company TEXT, p_email TEXT, p_phone TEXT, p_message TEXT,
  p_budget NUMERIC, p_extra TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid     UUID := auth.uid();
  v_ids     UUID[] := ARRAY[]::UUID[];
  v_skipped TEXT[] := ARRAY[]::TEXT[];
  v_group   UUID := gen_random_uuid();
  v_board   UUID;
  v_count   INTEGER;
  v_message TEXT;
BEGIN
  IF v_uid IS NULL OR public.auth_role() <> 'agency' THEN
    RAISE EXCEPTION 'Sign in with a buyer account to request boards';
  END IF;
  SELECT COUNT(DISTINCT x) INTO v_count FROM unnest(p_board_ids) x;
  IF v_count = 0 THEN RAISE EXCEPTION 'Choose at least one board'; END IF;
  IF v_count > 15 THEN RAISE EXCEPTION 'Request up to 15 boards at a time'; END IF;

  -- Owners see each board's request on its own, so say it's part of a set.
  v_message := trim(COALESCE(p_message, ''));
  IF v_count > 1 AND v_message <> '' THEN
    v_message := v_message || E'\n\n(Part of a request for ' || v_count || ' boards.)';
  END IF;

  FOR v_board IN SELECT DISTINCT x FROM unnest(p_board_ids) x LOOP
    IF EXISTS (SELECT 1 FROM public.availability_requests
               WHERE agency_id = v_uid AND board_id = v_board
                 AND stage NOT IN ('unavailable', 'confirmed', 'cancelled')) THEN
      v_skipped := v_skipped || COALESCE((SELECT name FROM public.boards WHERE id = v_board), 'a board');
      CONTINUE;
    END IF;
    -- Budget is for the whole campaign; it goes on every request as context.
    v_ids := v_ids || public.send_board_request(v_board, p_start, p_end, p_name, p_company, p_email, p_phone,
                                                v_message, p_budget, v_count, p_extra);
  END LOOP;

  IF array_length(v_ids, 1) > 1 THEN
    PERFORM set_config('app.request_stage', 'on', true);
    UPDATE public.availability_requests SET request_group = v_group WHERE id = ANY (v_ids);
    PERFORM set_config('app.request_stage', 'off', true);
  END IF;

  RETURN jsonb_build_object('ids', to_jsonb(v_ids), 'skipped', to_jsonb(v_skipped),
                            'group', CASE WHEN array_length(v_ids, 1) > 1 THEN v_group END);
END;
$$;

REVOKE ALL ON FUNCTION public.send_board_requests(UUID[], DATE, DATE, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.send_board_requests(UUID[], DATE, DATE, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT) TO authenticated;

-- ── 3. Proposals ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.proposals (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token          TEXT NOT NULL UNIQUE DEFAULT replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  created_by     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title          TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  client_name    TEXT CHECK (client_name IS NULL OR length(client_name) <= 120),
  note           TEXT CHECK (note IS NULL OR length(note) <= 1000),
  board_ids      UUID[] NOT NULL CHECK (cardinality(board_ids) BETWEEN 1 AND 30),
  show_prices    BOOLEAN NOT NULL DEFAULT true,
  open_count     INTEGER NOT NULL DEFAULT 0,
  last_opened_at TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_proposals_created_by ON public.proposals(created_by, created_at DESC);

ALTER TABLE public.proposals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS proposals_select ON public.proposals;
CREATE POLICY proposals_select ON public.proposals FOR SELECT
  USING (created_by = auth.uid() OR public.auth_role() = 'admin');
DROP POLICY IF EXISTS proposals_insert ON public.proposals;
CREATE POLICY proposals_insert ON public.proposals FOR INSERT
  WITH CHECK (created_by = auth.uid() AND public.auth_role() IN ('agency', 'admin'));
DROP POLICY IF EXISTS proposals_delete ON public.proposals;
CREATE POLICY proposals_delete ON public.proposals FOR DELETE
  USING (created_by = auth.uid() OR public.auth_role() = 'admin');

GRANT SELECT, INSERT, DELETE ON public.proposals TO authenticated;

-- Anyone holding the link sees the proposal (no buyer email or ids).
CREATE OR REPLACE FUNCTION public.get_proposal(p_token TEXT)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'title', p.title, 'client_name', p.client_name, 'note', p.note,
    'board_ids', to_jsonb(p.board_ids), 'show_prices', p.show_prices, 'created_at', p.created_at,
    'prepared_by', COALESCE(NULLIF(trim(pr.company_name), ''), NULLIF(trim(pr.full_name), ''), 'Your media planner'))
  FROM public.proposals p JOIN public.profiles pr ON pr.id = p.created_by
  WHERE p.token = p_token AND length(p_token) >= 16;
$$;

CREATE OR REPLACE FUNCTION public.record_proposal_open(p_token TEXT)
RETURNS VOID LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.proposals SET open_count = open_count + 1, last_opened_at = NOW()
   WHERE token = p_token AND length(p_token) >= 16
     AND created_by IS DISTINCT FROM auth.uid();
$$;

REVOKE ALL ON FUNCTION public.get_proposal(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_proposal_open(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_proposal(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_proposal_open(TEXT) TO anon, authenticated;
