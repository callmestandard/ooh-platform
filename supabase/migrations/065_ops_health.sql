-- ═══════════════════════════════════════════════════════════════════
-- OOH Platform — system health: our own error log, scheduled-job runs, and
-- one summary of what is failing or stuck (admin page + daily alert email).
-- Run in Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- Requires 061, 063 and 064. Safe to re-run. Deletes no business data.
--
-- Found in the Phase 6 audit:
--   • Sentry is installed but has no key in production and its server setup
--     is never loaded, so server and browser errors were not recorded anywhere.
--   • Failed emails and owner-reminder failures were logged but nobody was told.
--   • Nothing showed work that had stalled (owner not answering, accepted
--     quotation not confirmed, install photo waiting for a check).
--
-- Now:
--   • app_errors: errors from the server, the browser and scheduled jobs.
--     Written only by the server; read only by our team. Kept 90 days.
--   • cron_runs: each run of a scheduled job and whether it worked.
--   • admin_ops_health(): errors, failed emails, job runs and stuck work in
--     one JSON, for /dashboard/admin/health and the daily alert email.
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.app_errors (
  id          BIGSERIAL PRIMARY KEY,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source      TEXT NOT NULL CHECK (source IN ('server', 'client', 'cron', 'api')),
  message     TEXT NOT NULL CHECK (length(message) <= 500),
  path        TEXT CHECK (length(path) <= 300),
  digest      TEXT CHECK (length(digest) <= 100),
  detail      JSONB,
  user_id     UUID
);
CREATE INDEX IF NOT EXISTS idx_app_errors_created ON public.app_errors (created_at DESC);
ALTER TABLE public.app_errors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS app_errors_admin_read ON public.app_errors;
CREATE POLICY app_errors_admin_read ON public.app_errors FOR SELECT USING (public.is_admin());
REVOKE ALL ON public.app_errors FROM anon, authenticated;
GRANT SELECT ON public.app_errors TO authenticated;

CREATE TABLE IF NOT EXISTS public.cron_runs (
  id          BIGSERIAL PRIMARY KEY,
  job         TEXT NOT NULL CHECK (length(job) <= 60),
  ran_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ok          BOOLEAN NOT NULL,
  summary     JSONB
);
CREATE INDEX IF NOT EXISTS idx_cron_runs_job ON public.cron_runs (job, ran_at DESC);
ALTER TABLE public.cron_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cron_runs_admin_read ON public.cron_runs;
CREATE POLICY cron_runs_admin_read ON public.cron_runs FOR SELECT USING (public.is_admin());
REVOKE ALL ON public.cron_runs FROM anon, authenticated;
GRANT SELECT ON public.cron_runs TO authenticated;

-- Our team or the server (service role) only.
CREATE OR REPLACE FUNCTION public.ops_allowed()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_admin() OR COALESCE(auth.role(), '') = 'service_role'
$$;

CREATE OR REPLACE FUNCTION public.admin_ops_health()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_now TIMESTAMPTZ := NOW();
BEGIN
  IF NOT public.ops_allowed() THEN RAISE EXCEPTION 'admins only' USING ERRCODE = '42501'; END IF;
  RETURN jsonb_build_object(
    'at', v_now,
    'errors', jsonb_build_object(
      'day',  (SELECT COUNT(*) FROM public.app_errors WHERE created_at > v_now - INTERVAL '1 day'),
      'week', (SELECT COUNT(*) FROM public.app_errors WHERE created_at > v_now - INTERVAL '7 days'),
      'top',  COALESCE((SELECT jsonb_agg(t ORDER BY t.last_at DESC) FROM (
                SELECT source, left(message, 200) AS message, MAX(path) AS path, COUNT(*) AS n, MAX(created_at) AS last_at, MIN(created_at) AS first_at
                  FROM public.app_errors WHERE created_at > v_now - INTERVAL '7 days'
                 GROUP BY source, left(message, 200) ORDER BY MAX(created_at) DESC LIMIT 15) t), '[]'::jsonb)),
    'emails', jsonb_build_object(
      'sent_week',   (SELECT COUNT(*) FROM public.email_log WHERE status = 'sent'   AND created_at > v_now - INTERVAL '7 days'),
      'failed_day',  (SELECT COUNT(*) FROM public.email_log WHERE status = 'failed' AND created_at > v_now - INTERVAL '1 day'),
      'failed_week', (SELECT COUNT(*) FROM public.email_log WHERE status = 'failed' AND created_at > v_now - INTERVAL '7 days'),
      'skipped_week',(SELECT COUNT(*) FROM public.email_log WHERE status = 'skipped' AND created_at > v_now - INTERVAL '7 days'),
      'recent_failed', COALESCE((SELECT jsonb_agg(e ORDER BY e.created_at DESC) FROM (
                SELECT kind, recipient, left(COALESCE(error, ''), 200) AS error, created_at FROM public.email_log
                 WHERE status IN ('failed', 'skipped') AND created_at > v_now - INTERVAL '7 days' ORDER BY created_at DESC LIMIT 10) e), '[]'::jsonb),
      'reminders_failed_week', (SELECT COUNT(*) FROM public.owner_events WHERE event = 'reminder_failed' AND created_at > v_now - INTERVAL '7 days')),
    'jobs', COALESCE((SELECT jsonb_object_agg(j.job, jsonb_build_object('ran_at', j.ran_at, 'ok', j.ok, 'summary', j.summary))
                FROM (SELECT DISTINCT ON (job) job, ran_at, ok, summary FROM public.cron_runs ORDER BY job, ran_at DESC) j), '{}'::jsonb),
    'stuck', jsonb_build_array(
      jsonb_build_object('key', 'owner_silent', 'label', 'Requests with no owner answer after 48 hours', 'link', '/dashboard/admin/requests',
        'n', (SELECT COUNT(*) FROM public.availability_requests r
               WHERE r.board_id IS NOT NULL AND r.stage = 'requested' AND r.created_at < v_now - INTERVAL '48 hours'
                 AND NOT EXISTS (SELECT 1 FROM public.owner_link_replies x WHERE x.request_id = r.id))),
      jsonb_build_object('key', 'owner_replies', 'label', 'Owner replies waiting for a check', 'link', '/dashboard/admin/needs-checking',
        'n', (SELECT COUNT(*) FROM public.owner_link_replies WHERE status = 'pending')),
      jsonb_build_object('key', 'owner_edits', 'label', 'Owner board changes waiting for a check', 'link', '/dashboard/admin/needs-checking',
        'n', (SELECT COUNT(*) FROM public.owner_board_edits WHERE status = 'pending')),
      jsonb_build_object('key', 'quote_expiring', 'label', 'Quotations expiring within 2 days, not answered', 'link', '/dashboard/admin/quotations',
        'n', (SELECT COUNT(*) FROM public.quotations WHERE status = 'sent' AND NOT is_test
               AND valid_until BETWEEN public.lagos_today() AND public.lagos_today() + 2)),
      jsonb_build_object('key', 'quote_unconfirmed', 'label', 'Accepted quotations not confirmed after 2 days', 'link', '/dashboard/admin/quotations',
        'n', (SELECT COUNT(*) FROM public.quotations WHERE status = 'accepted' AND NOT is_test AND booking_confirmed_at IS NULL
               AND accepted_at < v_now - INTERVAL '2 days')),
      jsonb_build_object('key', 'artwork', 'label', 'Artwork waiting over a day for a check', 'link', '/dashboard/admin/campaigns',
        'n', (SELECT COUNT(*) FROM public.creative_uploads WHERE status = 'uploaded' AND created_at < v_now - INTERVAL '1 day')),
      jsonb_build_object('key', 'proof_waiting', 'label', 'Install photos waiting over a day for a check', 'link', '/dashboard/admin/campaigns',
        'n', (SELECT COUNT(*) FROM public.compliance_checks WHERE status = 'submitted' AND submitted_at < v_now - INTERVAL '1 day')),
      jsonb_build_object('key', 'proof_overdue', 'label', 'Bookings started with no approved install photo', 'link', '/dashboard/admin/campaigns',
        'n', (SELECT COUNT(*) FROM public.bookings b
               WHERE b.status = 'signed' AND b.start_date < public.lagos_today()
                 AND NOT EXISTS (SELECT 1 FROM public.compliance_checks k WHERE k.booking_id = b.id AND k.status = 'verified')))
    )
  );
END;
$$;

-- Scheduled jobs record each run (server only).
CREATE OR REPLACE FUNCTION public.log_cron_run(p_job TEXT, p_ok BOOLEAN, p_summary JSONB DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.cron_runs (job, ok, summary) VALUES (left(p_job, 60), p_ok, p_summary);
  DELETE FROM public.cron_runs WHERE ran_at < NOW() - INTERVAL '180 days';
END;
$$;

-- Old errors are cleared after 90 days (called by the daily job).
CREATE OR REPLACE FUNCTION public.prune_app_errors()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n INTEGER;
BEGIN
  DELETE FROM public.app_errors WHERE created_at < NOW() - INTERVAL '90 days';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION public.ops_allowed() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ops_allowed() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_ops_health() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_ops_health() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.log_cron_run(TEXT, BOOLEAN, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.log_cron_run(TEXT, BOOLEAN, JSONB) TO service_role;
REVOKE ALL ON FUNCTION public.prune_app_errors() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prune_app_errors() TO service_role;
GRANT ALL ON public.app_errors, public.cron_runs TO service_role;
GRANT USAGE ON SEQUENCE public.app_errors_id_seq, public.cron_runs_id_seq TO service_role;
