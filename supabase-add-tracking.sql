-- Attribution tracking tables
-- tracking_links: one short URL per booking
-- tracking_events: every scan/click logged here
-- Run once in the Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS public.tracking_links (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id   UUID REFERENCES public.bookings(id) ON DELETE CASCADE,
  campaign_id  UUID REFERENCES public.campaigns(id) ON DELETE CASCADE,
  short_code   TEXT UNIQUE NOT NULL,
  target_url   TEXT NOT NULL,
  label        TEXT,          -- human label e.g. "Lekki Expressway — MTN Fastlink"
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.tracking_events (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tracking_link_id UUID REFERENCES public.tracking_links(id) ON DELETE CASCADE,
  scanned_at       TIMESTAMPTZ DEFAULT NOW(),
  device_type      TEXT,   -- 'mobile' | 'desktop' | 'tablet'
  user_agent       TEXT
);

CREATE INDEX IF NOT EXISTS idx_tracking_links_short_code  ON public.tracking_links(short_code);
CREATE INDEX IF NOT EXISTS idx_tracking_links_booking_id  ON public.tracking_links(booking_id);
CREATE INDEX IF NOT EXISTS idx_tracking_links_campaign_id ON public.tracking_links(campaign_id);
CREATE INDEX IF NOT EXISTS idx_tracking_events_link_id    ON public.tracking_events(tracking_link_id);
CREATE INDEX IF NOT EXISTS idx_tracking_events_scanned_at ON public.tracking_events(scanned_at);

-- Allow anon reads on tracking_links (needed for the public redirect route)
ALTER TABLE public.tracking_links  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tracking_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tracking_links_anon_read"     ON public.tracking_links;
DROP POLICY IF EXISTS "tracking_links_auth_all"      ON public.tracking_links;
DROP POLICY IF EXISTS "tracking_events_service_insert" ON public.tracking_events;
DROP POLICY IF EXISTS "tracking_events_auth_read"    ON public.tracking_events;

CREATE POLICY "tracking_links_anon_read"
  ON public.tracking_links FOR SELECT USING (true);

CREATE POLICY "tracking_events_service_insert"
  ON public.tracking_events FOR INSERT WITH CHECK (true);

CREATE POLICY "tracking_links_auth_all"
  ON public.tracking_links FOR ALL USING (true);

CREATE POLICY "tracking_events_auth_read"
  ON public.tracking_events FOR SELECT USING (true);
