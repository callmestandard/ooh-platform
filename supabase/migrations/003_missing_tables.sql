-- ═══════════════════════════════════════════════════════════════════
-- OOH Platform — Create missing tables
-- Run in Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- Safe to re-run: all statements use IF NOT EXISTS / OR REPLACE.
-- ═══════════════════════════════════════════════════════════════════


-- ─── 1. notifications ────────────────────────────────────────────────────────
-- Role-based notification inbox. recipient_role is the demo role string
-- ('agency' | 'owner' | 'client') so notifications fan out to a whole role
-- rather than a specific user UUID (demo-friendly, no auth required).

CREATE TABLE IF NOT EXISTS public.notifications (
  id             uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  recipient_role text        NOT NULL
                             CHECK (recipient_role IN ('agency', 'client', 'owner', 'admin')),
  type           text        NOT NULL,
  title          text        NOT NULL,
  body           text,
  link           text,
  read           boolean     NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notifications_select" ON public.notifications;
DROP POLICY IF EXISTS "notifications_update" ON public.notifications;
DROP POLICY IF EXISTS "notifications_insert" ON public.notifications;

-- Any authenticated user can read/insert; update gated to matching role.
-- (The role is stored as plain text, not tied to auth.uid(), so we use
--  the auth_role() helper defined in migration 001.)
CREATE POLICY "notifications_select"
  ON public.notifications FOR SELECT
  USING (recipient_role = auth_role() OR auth_role() = 'admin');

CREATE POLICY "notifications_update"
  ON public.notifications FOR UPDATE
  USING (recipient_role = auth_role());

CREATE POLICY "notifications_insert"
  ON public.notifications FOR INSERT
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_notifications_recipient
  ON public.notifications (recipient_role, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_unread
  ON public.notifications (recipient_role, read)
  WHERE read = false;


-- ─── 2. creative_uploads ─────────────────────────────────────────────────────
-- Stores creative artwork files uploaded by agencies for a booking.
-- Files themselves live in the Supabase "creatives" storage bucket;
-- this table holds the metadata + approval workflow state.

CREATE TABLE IF NOT EXISTS public.creative_uploads (
  id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  booking_id  uuid        NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  file_url    text        NOT NULL,
  file_name   text        NOT NULL,
  file_size   bigint,
  mime_type   text,
  status      text        NOT NULL DEFAULT 'uploaded'
                          CHECK (status IN ('uploaded', 'approved', 'changes_requested', 'printing', 'live')),
  notes       text,
  uploaded_by text        NOT NULL DEFAULT 'agency',
  reviewed_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.creative_uploads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "creatives_select" ON public.creative_uploads;
DROP POLICY IF EXISTS "creatives_insert" ON public.creative_uploads;
DROP POLICY IF EXISTS "creatives_update" ON public.creative_uploads;

-- Agencies see creatives for their own campaign bookings.
-- Board owners see creatives for bookings on their boards.
CREATE POLICY "creatives_select"
  ON public.creative_uploads FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.bookings b
      JOIN public.campaigns c ON c.id = b.campaign_id
      WHERE b.id = creative_uploads.booking_id AND c.agency_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.bookings b
      JOIN public.boards bo ON bo.id = b.board_id
      WHERE b.id = creative_uploads.booking_id AND bo.owner_id = auth.uid()
    )
    OR auth_role() = 'admin'
  );

CREATE POLICY "creatives_insert"
  ON public.creative_uploads FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.bookings b
      JOIN public.campaigns c ON c.id = b.campaign_id
      WHERE b.id = booking_id AND c.agency_id = auth.uid()
    )
    OR auth_role() = 'admin'
  );

CREATE POLICY "creatives_update"
  ON public.creative_uploads FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.bookings b
      JOIN public.campaigns c ON c.id = b.campaign_id
      WHERE b.id = creative_uploads.booking_id AND c.agency_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.bookings b
      JOIN public.boards bo ON bo.id = b.board_id
      WHERE b.id = creative_uploads.booking_id AND bo.owner_id = auth.uid()
    )
    OR auth_role() = 'admin'
  );

CREATE INDEX IF NOT EXISTS idx_creative_uploads_booking
  ON public.creative_uploads (booking_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_creative_uploads_status
  ON public.creative_uploads (status);


-- ─── 3. board_audience_profiles ──────────────────────────────────────────────
-- Cached location-intelligence data per board.
-- Written by /api/boards/[id]/enrich (Overpass API + optional Anthropic AI).
-- One row per board (upserted on board_id).

CREATE TABLE IF NOT EXISTS public.board_audience_profiles (
  id                  uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  board_id            uuid        NOT NULL UNIQUE REFERENCES public.boards(id) ON DELETE CASCADE,
  area_type           text,
  area_icon           text,
  area_description    text,
  commercial_score    numeric(5,2),
  footfall_score      numeric(5,2),
  youth_score         numeric(5,2),
  premium_score       numeric(5,2),
  daily_impressions   integer,
  total_pois          integer,
  top_pois            jsonb,       -- [{label, icon, count}]
  verticals           jsonb,       -- string[]
  ai_insight          text,
  data_source         text        CHECK (data_source IN ('live', 'estimated')),
  enriched_at         timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.board_audience_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "audience_profiles_select" ON public.board_audience_profiles;
DROP POLICY IF EXISTS "audience_profiles_upsert" ON public.board_audience_profiles;

-- Public read (used in campaign planner + audience page).
-- Write gated to board owners and admins.
CREATE POLICY "audience_profiles_select"
  ON public.board_audience_profiles FOR SELECT
  USING (true);

CREATE POLICY "audience_profiles_upsert"
  ON public.board_audience_profiles FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.boards WHERE id = board_id AND owner_id = auth.uid()
    )
    OR auth_role() IN ('agency', 'admin')
  );

CREATE POLICY "audience_profiles_update"
  ON public.board_audience_profiles FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.boards WHERE id = board_audience_profiles.board_id AND owner_id = auth.uid()
    )
    OR auth_role() IN ('agency', 'admin')
  );

CREATE INDEX IF NOT EXISTS idx_audience_profiles_board
  ON public.board_audience_profiles (board_id);


-- ─── 4. activity_events ──────────────────────────────────────────────────────
-- Append-only audit / activity timeline.
-- Written by lib/activity-log.ts; rendered in ActivityTimeline component.

CREATE TABLE IF NOT EXISTS public.activity_events (
  id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  entity_type text        NOT NULL
                          CHECK (entity_type IN ('campaign', 'booking', 'invoice', 'compliance_check')),
  entity_id   text        NOT NULL,
  campaign_id uuid        REFERENCES public.campaigns(id) ON DELETE SET NULL,
  actor_id    uuid,
  actor_role  text,
  actor_name  text,
  action      text        NOT NULL,
  summary     text        NOT NULL,
  changes     jsonb,
  metadata    jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.activity_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "activity_select" ON public.activity_events;
DROP POLICY IF EXISTS "activity_insert" ON public.activity_events;

-- Agencies see activity on their own campaigns.
-- Clients see activity on campaigns where they are the client.
CREATE POLICY "activity_select"
  ON public.activity_events FOR SELECT
  USING (
    actor_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.campaigns
      WHERE campaigns.id = activity_events.campaign_id
        AND campaigns.agency_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.campaigns
      WHERE campaigns.id = activity_events.campaign_id
        AND campaigns.client_id = auth.uid()
    )
    OR auth_role() = 'admin'
  );

CREATE POLICY "activity_insert"
  ON public.activity_events FOR INSERT
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_activity_entity
  ON public.activity_events (entity_type, entity_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_activity_campaign_id
  ON public.activity_events (campaign_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_activity_actor
  ON public.activity_events (actor_id);


-- ─── 5. profiles ─────────────────────────────────────────────────────────────
-- One row per auth.users entry. Stores the user's platform role and display
-- info. Created automatically by the trigger below on every sign-up.
-- The auth_role() helper (migration 001) reads from this table for RLS.

CREATE TABLE IF NOT EXISTS public.profiles (
  id           uuid        REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  role         text        NOT NULL DEFAULT 'agency'
                           CHECK (role IN ('agency', 'client', 'owner', 'admin')),
  full_name    text,
  company_name text,
  email        text,
  is_suspended boolean     NOT NULL DEFAULT false,
  avatar_url   text,
  brand_accent_color text,
  brand_tagline      text,
  brand_website      text,
  brand_logo_url     text,
  erp_vendor_code    text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles_select_own" ON public.profiles;
DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
DROP POLICY IF EXISTS "profiles_insert_own" ON public.profiles;

CREATE POLICY "profiles_select_own"
  ON public.profiles FOR SELECT
  USING (id = auth.uid() OR auth_role() = 'admin');

CREATE POLICY "profiles_update_own"
  ON public.profiles FOR UPDATE
  USING (id = auth.uid());

CREATE POLICY "profiles_insert_own"
  ON public.profiles FOR INSERT
  WITH CHECK (id = auth.uid());

-- Trigger: auto-create a profile row whenever a new auth user is created.
-- Reads role, full_name, company_name from the user's raw_user_meta_data
-- (set during sign-up via supabase.auth.signUp({ options: { data: {...} } })).

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, auth
AS $$
BEGIN
  INSERT INTO public.profiles (id, role, full_name, company_name, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'role', 'agency'),
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'company_name',
    NEW.email
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();
