-- ═══════════════════════════════════════════════════════════════════
-- OOH Platform — "Ask the map" audit log
-- Run in Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- Requires 038. Safe to re-run.
--
-- One row per question: who asked, what was asked, which read-only
-- lookups ran, what was shown, and any draft answer the server threw
-- away for containing a figure that did not come from a lookup.
-- Written only by the API route with the service-role key. Admins can
-- read it; nobody else can.
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.geo_ask_log (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  question     TEXT NOT NULL,
  -- 'answered' | 'cannot_answer' | 'refused' | 'unverifiable' | 'error'
  status       TEXT NOT NULL,
  tool_calls   JSONB NOT NULL DEFAULT '[]'::jsonb,
  answer       JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Violations that caused each discarded draft to be rejected.
  rejected     JSONB NOT NULL DEFAULT '[]'::jsonb,
  attempts     INTEGER NOT NULL DEFAULT 0,
  model        TEXT NOT NULL,
  duration_ms  INTEGER,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_geo_ask_log_created ON public.geo_ask_log(created_at DESC);

ALTER TABLE public.geo_ask_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS geo_ask_log_admin_read ON public.geo_ask_log;
CREATE POLICY geo_ask_log_admin_read ON public.geo_ask_log FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));

GRANT SELECT ON public.geo_ask_log TO authenticated;
