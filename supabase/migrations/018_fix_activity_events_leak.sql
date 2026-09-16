-- ═══════════════════════════════════════════════════════════════════
-- OOH Platform — fix activity_events still being anon-readable
-- Run in Supabase SQL Editor (Dashboard → SQL Editor → New query)
--
-- Everything else in 017 verified correctly locked down (creative_uploads,
-- tracking_links, tracking_events, users all confirmed blocking anonymous
-- reads on freshly-inserted rows; notifications/board_audience_profiles are
-- open by design). activity_events alone is still fully anon-readable even
-- on a brand new row with no owner links at all — meaning some policy with
-- a name we haven't guessed is still granting it. Rather than keep guessing
-- names, this discovers and drops every existing policy on the table
-- (same DO-block idiom supabase-full-setup.sql already uses for its own
-- policy reset), then rebuilds exactly the two policies we want.
-- ═══════════════════════════════════════════════════════════════════

DO $$
DECLARE pol RECORD;
BEGIN
  FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'activity_events' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.activity_events', pol.policyname);
  END LOOP;
END $$;

ALTER TABLE public.activity_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "activity_select" ON public.activity_events FOR SELECT USING (
  actor_id = auth.uid()
  OR EXISTS (SELECT 1 FROM public.campaigns WHERE campaigns.id = activity_events.campaign_id AND campaigns.agency_id = auth.uid())
  OR EXISTS (SELECT 1 FROM public.campaigns WHERE campaigns.id = activity_events.campaign_id AND campaigns.client_id = auth.uid())
  OR (entity_type = 'board' AND auth_role() IN ('agency', 'admin'))
  OR auth_role() = 'admin'
);
CREATE POLICY "activity_insert" ON public.activity_events FOR INSERT WITH CHECK (true);
