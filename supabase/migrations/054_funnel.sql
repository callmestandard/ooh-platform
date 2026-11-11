-- ═══════════════════════════════════════════════════════════════════
-- OOH Platform — funnel numbers for the admin overview
-- Run in Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- Requires 043, 045, 052, 053. Safe to re-run.
--
-- 1. funnel_events: three anonymous browser actions the database can't
--    otherwise see: viewing a board, saving one to the shortlist, and
--    starting a request. A visitor is a random id kept in the browser (no
--    name, email or IP). Each visitor counts once per event, board and day.
--    Our own team (admins) is not counted.
-- 2. admin_funnel(p_days): the numbers for the last p_days and for the
--    same length of time before it, plus 12 weeks of requests.
-- ═══════════════════════════════════════════════════════════════════

-- ── 1. Events ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.funnel_events (
  id         BIGSERIAL PRIMARY KEY,
  event      TEXT NOT NULL CHECK (event IN ('board_view', 'shortlist_add', 'request_open')),
  visitor    TEXT NOT NULL CHECK (visitor ~ '^[A-Za-z0-9_-]{12,64}$'),
  board_id   UUID REFERENCES public.boards(id) ON DELETE SET NULL,
  user_id    UUID,
  day        DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS funnel_events_once_a_day
  ON public.funnel_events (event, visitor, COALESCE(board_id, '00000000-0000-0000-0000-000000000000'::uuid), day);
CREATE INDEX IF NOT EXISTS funnel_events_day ON public.funnel_events (day, event);

ALTER TABLE public.funnel_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS funnel_events_admin_read ON public.funnel_events;
CREATE POLICY funnel_events_admin_read ON public.funnel_events FOR SELECT USING (public.auth_role() = 'admin');
REVOKE ALL ON public.funnel_events FROM anon;
GRANT SELECT ON public.funnel_events TO authenticated;

CREATE OR REPLACE FUNCTION public.track_event(p_event TEXT, p_visitor TEXT, p_board UUID DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND public.auth_role() = 'admin' THEN RETURN; END IF;
  IF p_event NOT IN ('board_view', 'shortlist_add', 'request_open')
     OR p_visitor IS NULL OR p_visitor !~ '^[A-Za-z0-9_-]{12,64}$' THEN
    RETURN;
  END IF;
  INSERT INTO public.funnel_events (event, visitor, board_id, user_id)
  SELECT p_event, p_visitor, b.id, auth.uid()
    FROM (SELECT (SELECT id FROM public.boards WHERE id = p_board) AS id) b
  ON CONFLICT DO NOTHING;
END;
$$;
REVOKE ALL ON FUNCTION public.track_event(TEXT, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.track_event(TEXT, TEXT, UUID) TO anon, authenticated;

-- ── 2. Numbers ───────────────────────────────────────────────────────────
-- One window [p_from, p_to). Request outcomes are counted for requests
-- SENT in the window, so the steps are the same group of requests.
CREATE OR REPLACE FUNCTION public.funnel_window(p_from TIMESTAMPTZ, p_to TIMESTAMPTZ)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH ev AS (
    SELECT event, visitor FROM public.funnel_events WHERE created_at >= p_from AND created_at < p_to
  ), rq AS (
    SELECT r.id, r.agency_id, r.stage, r.created_at,
           (SELECT MIN(x.t) FROM (
              SELECT ar.created_at AS t FROM public.availability_responses ar WHERE ar.request_id = r.id
              UNION ALL
              SELECT ol.created_at FROM public.owner_link_replies ol WHERE ol.request_id = r.id) x) AS answered_at,
           (SELECT ar.quoted_rate FROM public.availability_responses ar WHERE ar.request_id = r.id ORDER BY ar.updated_at DESC LIMIT 1) AS rate
      FROM public.availability_requests r
     WHERE r.board_id IS NOT NULL AND r.created_at >= p_from AND r.created_at < p_to
  )
  SELECT jsonb_build_object(
    'visitors',        (SELECT COUNT(DISTINCT visitor) FROM ev),
    'viewed',          (SELECT COUNT(DISTINCT visitor) FROM ev WHERE event = 'board_view'),
    'saved',           (SELECT COUNT(DISTINCT visitor) FROM ev WHERE event = 'shortlist_add'),
    'started',         (SELECT COUNT(DISTINCT visitor) FROM ev WHERE event = 'request_open'),
    'signups',         (SELECT COUNT(*) FROM public.profiles WHERE role = 'agency' AND created_at >= p_from AND created_at < p_to),
    'buyers',          (SELECT COUNT(DISTINCT agency_id) FROM rq),
    'requests',        (SELECT COUNT(*) FROM rq),
    'answered',        (SELECT COUNT(*) FROM rq WHERE answered_at IS NOT NULL),
    'accepted',        (SELECT COUNT(*) FROM rq WHERE stage IN ('accepted', 'booking_in_progress', 'confirmed')),
    'confirmed',       (SELECT COUNT(*) FROM rq WHERE stage = 'confirmed'),
    'confirmed_value', (SELECT COALESCE(SUM(rate), 0) FROM rq WHERE stage = 'confirmed'),
    'median_answer_hours', (SELECT ROUND((percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM answered_at - created_at) / 3600))::numeric, 1)
                              FROM rq WHERE answered_at IS NOT NULL),
    'proposals',       (SELECT COUNT(*) FROM public.proposals WHERE created_at >= p_from AND created_at < p_to),
    'proposals_opened',(SELECT COUNT(*) FROM public.proposals WHERE created_at >= p_from AND created_at < p_to AND open_count > 0)
  );
$$;
REVOKE ALL ON FUNCTION public.funnel_window(TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_funnel(p_days INTEGER DEFAULT 30)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_days INTEGER := LEAST(GREATEST(COALESCE(p_days, 30), 1), 365);
  v_now  TIMESTAMPTZ := NOW();
BEGIN
  IF public.auth_role() IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'admins only' USING ERRCODE = '42501'; END IF;
  RETURN jsonb_build_object(
    'days', v_days,
    'now',  public.funnel_window(v_now - make_interval(days => v_days), v_now + INTERVAL '1 second'),
    'prev', public.funnel_window(v_now - make_interval(days => 2 * v_days), v_now - make_interval(days => v_days)),
    -- Right now, not per window.
    'supply', jsonb_build_object(
      'boards',          (SELECT COUNT(*) FROM public.boards WHERE status <> 'decommissioned'),
      'confirmed_7d',    (SELECT COUNT(*) FROM public.boards WHERE status <> 'decommissioned' AND availability_checked_at > v_now - INTERVAL '7 days'),
      'owners_active_7d',(SELECT COUNT(*) FROM public.owner_links WHERE last_saved_at > v_now - INTERVAL '7 days'),
      'owners_linked',   (SELECT COUNT(*) FROM public.owner_links),
      'waiting_48h',     (SELECT COUNT(*) FROM public.availability_requests r
                           WHERE r.board_id IS NOT NULL AND r.stage = 'requested' AND r.created_at < v_now - INTERVAL '48 hours'
                             AND NOT EXISTS (SELECT 1 FROM public.owner_link_replies x WHERE x.request_id = r.id)),
      'to_check',        (SELECT COUNT(*) FROM public.owner_link_replies WHERE status = 'pending')
    ),
    'weeks', (SELECT jsonb_agg(jsonb_build_object('week', w.wk, 'requests', w.n) ORDER BY w.wk)
                FROM (SELECT gs::date AS wk,
                             (SELECT COUNT(*) FROM public.availability_requests r
                               WHERE r.board_id IS NOT NULL AND r.created_at >= gs AND r.created_at < gs + INTERVAL '7 days') AS n
                        FROM generate_series(date_trunc('week', v_now) - INTERVAL '11 weeks', date_trunc('week', v_now), INTERVAL '1 week') gs) w)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_funnel(INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_funnel(INTEGER) TO authenticated;
