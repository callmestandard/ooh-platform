-- ═══════════════════════════════════════════════════════════════════
-- OOH Platform — fix campaigns.status CHECK constraint (missing 'submitted')
-- Run in Supabase SQL Editor (Dashboard → SQL Editor → New query)
--
-- Same drift pattern as 016 (which added 'pending'): the agency campaigns
-- list (src/app/dashboard/agency/campaigns/page.tsx) has always had a
-- dedicated "Submitted" filter tab, and the self-serve campaign-builder
-- (src/app/api/campaign-builder/submit/route.ts) has always inserted new
-- campaigns with status='submitted' — but the live CHECK constraint never
-- allowed that value, so every self-serve submission has failed outright
-- (500 error) and the "Submitted" tab has always shown 0. 'submitted' is
-- distinct from 'pending': 'pending' means an agency-built plan is awaiting
-- the client's approval; 'submitted' means a self-serve plan is awaiting
-- board owners' responses. Restores it to match the app's intended design.
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE public.campaigns DROP CONSTRAINT IF EXISTS campaigns_status_check;
ALTER TABLE public.campaigns
  ADD CONSTRAINT campaigns_status_check
  CHECK (status IN ('draft', 'active', 'completed', 'cancelled', 'pending', 'submitted'));
