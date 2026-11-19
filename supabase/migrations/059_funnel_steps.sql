-- ═══════════════════════════════════════════════════════════════════
-- OOH Platform — more funnel steps (requires 054). Safe to re-run.
-- Run in Supabase SQL Editor (Dashboard → SQL Editor → New query)
--
-- New anonymous events: site_visit (any page, once a day), search
-- (searched or filtered the marketplace), signup (created a buyer account
-- from the request form) and request_sent. Same privacy rules as 054:
-- a random browser id, no name, email or IP; admins are not counted.
--
-- funnel_window gains: visited, searched, sent (browsers that sent a
-- request) and quoted (requests that got a price from the owner).
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE public.funnel_events DROP CONSTRAINT IF EXISTS funnel_events_event_check;
ALTER TABLE public.funnel_events ADD CONSTRAINT funnel_events_event_check
  CHECK (event IN ('site_visit', 'search', 'board_view', 'shortlist_add', 'request_open', 'signup', 'request_sent'));

CREATE OR REPLACE FUNCTION public.track_event(p_event TEXT, p_visitor TEXT, p_board UUID DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND public.auth_role() = 'admin' THEN RETURN; END IF;
  IF p_event NOT IN ('site_visit', 'search', 'board_view', 'shortlist_add', 'request_open', 'signup', 'request_sent')
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
           (SELECT ar.quoted_rate FROM public.availability_responses ar
             WHERE ar.request_id = r.id AND ar.available ORDER BY ar.updated_at DESC LIMIT 1) AS rate
      FROM public.availability_requests r
     WHERE r.board_id IS NOT NULL AND r.created_at >= p_from AND r.created_at < p_to
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
    'quoted',          (SELECT COUNT(*) FROM rq WHERE rate IS NOT NULL),
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
