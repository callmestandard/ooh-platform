-- ═══════════════════════════════════════════════════════════════════
-- OOH Platform — saved budget estimates (agency-private)
-- Run in Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- Safe to re-run: uses IF NOT EXISTS / DROP POLICY IF EXISTS throughout.
--
-- The internal budget estimator computes a low–high cost range from an
-- agency's OWN past negotiated rates (bookings.agreed_rate on its own
-- campaigns — already isolated by the bookings_select policy in
-- 012_enable_rls_priority_tables.sql). This table only stores the saved
-- result so it can be attached to a brief or a campaign draft.
--
-- Isolation: a row is visible and writable ONLY to the agency that created
-- it. There is deliberately no admin, client or owner policy — the saved
-- lines are derived from that agency's negotiated rates and must not be
-- readable by anyone else, including the board owners it negotiated with.
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.budget_estimates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id       UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Optional: the campaign draft this estimate was saved against.
  campaign_id     UUID REFERENCES public.campaigns(id) ON DELETE SET NULL,
  -- Optional: free-text name of the brief when there is no campaign yet.
  brief_label     TEXT,
  duration_months INTEGER NOT NULL CHECK (duration_months > 0),
  -- [{city, formatKey, boards, source, dealCount, rateLow, rateHigh, totalLow, totalHigh, ...}]
  lines           JSONB NOT NULL,
  low_total       NUMERIC NOT NULL,
  high_total      NUMERIC NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT budget_estimates_target CHECK (campaign_id IS NOT NULL OR brief_label IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_budget_estimates_agency   ON public.budget_estimates(agency_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_budget_estimates_campaign ON public.budget_estimates(campaign_id) WHERE campaign_id IS NOT NULL;

ALTER TABLE public.budget_estimates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "budget_estimates_select" ON public.budget_estimates;
DROP POLICY IF EXISTS "budget_estimates_insert" ON public.budget_estimates;
DROP POLICY IF EXISTS "budget_estimates_update" ON public.budget_estimates;
DROP POLICY IF EXISTS "budget_estimates_delete" ON public.budget_estimates;

CREATE POLICY "budget_estimates_select" ON public.budget_estimates FOR SELECT USING (
  agency_id = auth.uid()
);

-- Can only save as yourself, only as an agency, and only against one of your
-- own campaigns (so an estimate can't be planted on another agency's draft).
CREATE POLICY "budget_estimates_insert" ON public.budget_estimates FOR INSERT WITH CHECK (
  agency_id = auth.uid()
  AND auth_role() = 'agency'
  AND (
    campaign_id IS NULL
    OR EXISTS (SELECT 1 FROM public.campaigns c WHERE c.id = campaign_id AND c.agency_id = auth.uid())
  )
);

CREATE POLICY "budget_estimates_update" ON public.budget_estimates FOR UPDATE
  USING (agency_id = auth.uid())
  WITH CHECK (
    agency_id = auth.uid()
    AND (
      campaign_id IS NULL
      OR EXISTS (SELECT 1 FROM public.campaigns c WHERE c.id = campaign_id AND c.agency_id = auth.uid())
    )
  );

CREATE POLICY "budget_estimates_delete" ON public.budget_estimates FOR DELETE USING (
  agency_id = auth.uid()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.budget_estimates TO authenticated;
