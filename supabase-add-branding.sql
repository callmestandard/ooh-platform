-- Agency branding fields on profiles
-- Persists white-label settings: logo, accent colour, tagline, website.
-- Run once in the Supabase SQL Editor.
-- ALSO create a public storage bucket called "agency-logos" in Supabase Dashboard → Storage.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS brand_logo_url    TEXT,
  ADD COLUMN IF NOT EXISTS brand_accent_color TEXT DEFAULT '#1B4F8A',
  ADD COLUMN IF NOT EXISTS brand_tagline      TEXT,
  ADD COLUMN IF NOT EXISTS brand_website      TEXT;

COMMENT ON COLUMN public.profiles.brand_logo_url     IS 'Public URL of the agency logo — shown on client-facing reports';
COMMENT ON COLUMN public.profiles.brand_accent_color IS 'Hex colour used in report headers and exports';
COMMENT ON COLUMN public.profiles.brand_tagline      IS 'Short agency tagline shown on reports and POE decks';
COMMENT ON COLUMN public.profiles.brand_website      IS 'Agency website shown on reports';
