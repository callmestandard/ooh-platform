-- ═══════════════════════════════════════════════════════════════════
-- OOH Platform — extend RLS to the remaining tables
-- Run in Supabase SQL Editor (Dashboard → SQL Editor → New query)
--
-- Same fix shape as 012/013: enable RLS for real and drop the legacy
-- "<table>_all" USING (true) catch-alls from supabase-full-setup.sql that
-- would otherwise silently override any restrictive policy underneath.
--
-- Two deliberate exceptions, both confirmed by tracing real code paths:
--   - activity_events / notifications INSERT stay fully open (WITH CHECK
--     true). The anonymous POE upload page (poe/[token]/page.tsx) — a field
--     rep with no account — calls logActivity() and createNotification()
--     directly with the plain anon-key client after submitting proof of
--     posting. Locking these down would silently break that real flow.
--   - notifications SELECT/UPDATE keep an explicit anon/demo fallback that
--     migration 005 already documented on purpose ("Anon/demo: any
--     notification — role filtering happens client-side") — re-affirmed
--     as-is, not tightened, since it's existing intentional design.
--
-- tracking_links / tracking_events / users have zero legitimate client-side
-- (anon-key) access anywhere in the app — traced every call site; the QR
-- redirect (t/[code]/route.ts), /api/tracking, and the campaign page's
-- attribution tab all go through the service-role key. Locked down with no
-- permissive policy at all beyond admin.
-- ═══════════════════════════════════════════════════════════════════

-- 005_notifications_user_id.sql was never actually applied to this
-- database — recipient_user_id doesn't exist yet, which means every
-- createNotification()/NotificationBell query referencing it has been
-- silently failing this whole time. Adding it now, as a prerequisite for
-- the policies below (and to actually fix per-user notification targeting).
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS recipient_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_notifications_user_id
  ON public.notifications (recipient_user_id) WHERE recipient_user_id IS NOT NULL;

ALTER TABLE public.activity_events         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.creative_uploads        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.board_audience_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tracking_links          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tracking_events         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users                   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "activity_all"          ON public.activity_events;
DROP POLICY IF EXISTS "notifications_all"     ON public.notifications;
DROP POLICY IF EXISTS "creative_uploads_all"  ON public.creative_uploads;
DROP POLICY IF EXISTS "audience_profiles_all" ON public.board_audience_profiles;
DROP POLICY IF EXISTS "tracking_links_all"    ON public.tracking_links;
DROP POLICY IF EXISTS "tracking_events_all"   ON public.tracking_events;
DROP POLICY IF EXISTS "users_all"             ON public.users;

-- ─── activity_events ─────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "activity_select" ON public.activity_events;
DROP POLICY IF EXISTS "activity_insert" ON public.activity_events;

CREATE POLICY "activity_select" ON public.activity_events FOR SELECT USING (
  actor_id = auth.uid()
  OR EXISTS (SELECT 1 FROM public.campaigns WHERE campaigns.id = activity_events.campaign_id AND campaigns.agency_id = auth.uid())
  OR EXISTS (SELECT 1 FROM public.campaigns WHERE campaigns.id = activity_events.campaign_id AND campaigns.client_id = auth.uid())
  OR (entity_type = 'board' AND auth_role() IN ('agency', 'admin'))
  OR auth_role() = 'admin'
);
CREATE POLICY "activity_insert" ON public.activity_events FOR INSERT WITH CHECK (true);

-- ─── notifications ───────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "notifications_select" ON public.notifications;
DROP POLICY IF EXISTS "Users can read relevant notifications" ON public.notifications;
DROP POLICY IF EXISTS "notifications_update" ON public.notifications;
DROP POLICY IF EXISTS "notifications_insert" ON public.notifications;

CREATE POLICY "notifications_select" ON public.notifications FOR SELECT USING (
  (auth.uid() IS NOT NULL AND (
    recipient_user_id = auth.uid()
    OR (recipient_user_id IS NULL AND recipient_role = auth_role())
  ))
  OR auth.uid() IS NULL
);
CREATE POLICY "notifications_update" ON public.notifications FOR UPDATE USING (
  (auth.uid() IS NOT NULL AND (
    recipient_user_id = auth.uid()
    OR (recipient_user_id IS NULL AND recipient_role = auth_role())
  ))
  OR auth.uid() IS NULL
);
CREATE POLICY "notifications_insert" ON public.notifications FOR INSERT WITH CHECK (true);

-- ─── creative_uploads ─────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "creatives_select" ON public.creative_uploads;
DROP POLICY IF EXISTS "creatives_insert" ON public.creative_uploads;
DROP POLICY IF EXISTS "creatives_update" ON public.creative_uploads;

CREATE POLICY "creatives_select" ON public.creative_uploads FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.bookings b JOIN public.campaigns c ON c.id = b.campaign_id WHERE b.id = creative_uploads.booking_id AND c.agency_id = auth.uid())
  OR EXISTS (SELECT 1 FROM public.bookings b JOIN public.boards bo ON bo.id = b.board_id WHERE b.id = creative_uploads.booking_id AND bo.owner_id = auth.uid())
  OR auth_role() = 'admin'
);
CREATE POLICY "creatives_insert" ON public.creative_uploads FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.bookings b JOIN public.campaigns c ON c.id = b.campaign_id WHERE b.id = booking_id AND c.agency_id = auth.uid())
  OR auth_role() = 'admin'
);
CREATE POLICY "creatives_update" ON public.creative_uploads FOR UPDATE USING (
  EXISTS (SELECT 1 FROM public.bookings b JOIN public.campaigns c ON c.id = b.campaign_id WHERE b.id = creative_uploads.booking_id AND c.agency_id = auth.uid())
  OR EXISTS (SELECT 1 FROM public.bookings b JOIN public.boards bo ON bo.id = b.board_id WHERE b.id = creative_uploads.booking_id AND bo.owner_id = auth.uid())
  OR auth_role() = 'admin'
);

-- ─── board_audience_profiles (intentionally public read — audience data ──────
-- shown to any agency during planning; matches boards' own public policy) ────

DROP POLICY IF EXISTS "audience_profiles_select" ON public.board_audience_profiles;
DROP POLICY IF EXISTS "audience_profiles_upsert" ON public.board_audience_profiles;
DROP POLICY IF EXISTS "audience_profiles_update" ON public.board_audience_profiles;

CREATE POLICY "audience_profiles_select" ON public.board_audience_profiles FOR SELECT USING (true);
CREATE POLICY "audience_profiles_upsert" ON public.board_audience_profiles FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.boards WHERE boards.id = board_id AND boards.owner_id = auth.uid())
  OR auth_role() IN ('agency', 'admin')
);
CREATE POLICY "audience_profiles_update" ON public.board_audience_profiles FOR UPDATE USING (
  EXISTS (SELECT 1 FROM public.boards WHERE boards.id = board_audience_profiles.board_id AND boards.owner_id = auth.uid())
  OR auth_role() IN ('agency', 'admin')
);

-- ─── tracking_links / tracking_events / users — no client-side access exists ──

DROP POLICY IF EXISTS "tracking_links_admin"  ON public.tracking_links;
DROP POLICY IF EXISTS "tracking_events_admin" ON public.tracking_events;
DROP POLICY IF EXISTS "users_admin"           ON public.users;

CREATE POLICY "tracking_links_admin"  ON public.tracking_links  FOR SELECT USING (auth_role() = 'admin');
CREATE POLICY "tracking_events_admin" ON public.tracking_events FOR SELECT USING (auth_role() = 'admin');
CREATE POLICY "users_admin"           ON public.users           FOR SELECT USING (auth_role() = 'admin');
