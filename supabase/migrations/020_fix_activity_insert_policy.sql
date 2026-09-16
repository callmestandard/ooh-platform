-- ═══════════════════════════════════════════════════════════════════
-- OOH Platform — re-fix activity_events INSERT policy
-- Run in Supabase SQL Editor (Dashboard → SQL Editor → New query)
--
-- Live-tested during a POE pre-flight check: both an anonymous request and
-- an authenticated-but-unrelated user got 403 "new row violates row-level
-- security policy" on activity_events INSERT, even though migration 018
-- was confirmed run and its file defines "activity_insert" as
-- WITH CHECK (true) (no role restriction, so it should cover anon and
-- authenticated alike). Only the service-role key succeeded, meaning RLS
-- is being enforced with no matching permissive INSERT policy currently
-- live — drift from what 018 was supposed to leave in place, cause
-- unconfirmed. This directly breaks logActivity() calls made client-side
-- from public pages (POE upload, share-report) and from authenticated
-- users acting on campaigns they don't own an agency/client relationship
-- to yet (e.g. before a campaign is created). Re-applies the same
-- drop-by-discovery-then-recreate idiom as 018, which is safe to re-run.
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
