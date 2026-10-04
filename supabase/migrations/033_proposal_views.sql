-- ═══════════════════════════════════════════════════════════════════
-- OOH Platform — proposal open-tracking
-- Run in Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- Safe to re-run: uses IF NOT EXISTS / DROP POLICY IF EXISTS throughout.
--
-- Records each time the shared report link (/report/[id]) is opened, so the
-- agency can see whether — and when — a client looked at the plan it sent.
--
-- Rows are written ONLY by the server route (service role) at
-- /api/report/[id]/view; there is no insert policy, so nobody can forge
-- "opens" from the browser. Deliberately minimal: a timestamp, the device
-- class and who it was in broad terms — no IP address, no user agent.
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.proposal_views (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  -- 'client' = signed in as the campaign's client; 'anonymous' = opened
  -- without a session (the usual case for a shared link); 'other' = some
  -- other signed-in account. The agency's own opens are never recorded.
  viewer_kind TEXT NOT NULL DEFAULT 'anonymous' CHECK (viewer_kind IN ('client', 'anonymous', 'other')),
  device      TEXT CHECK (device IN ('mobile', 'tablet', 'desktop')),
  viewed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_proposal_views_campaign ON public.proposal_views(campaign_id, viewed_at DESC);

ALTER TABLE public.proposal_views ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "proposal_views_select" ON public.proposal_views;

-- Only the agency that owns the campaign (or admin) can see its opens.
CREATE POLICY "proposal_views_select" ON public.proposal_views FOR SELECT USING (
  auth_role() = 'admin'
  OR EXISTS (SELECT 1 FROM public.campaigns c WHERE c.id = proposal_views.campaign_id AND c.agency_id = auth.uid())
);

GRANT SELECT ON public.proposal_views TO authenticated;
