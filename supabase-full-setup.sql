-- ============================================================
-- OOH PLATFORM — COMPLETE DATABASE SETUP
-- ============================================================
-- Run this ONCE on a fresh Supabase project.
-- Then run supabase-demo-seed.sql to populate demo data.
-- Safe to re-run — all statements use IF NOT EXISTS.
--
-- Storage buckets to create manually in Supabase Dashboard → Storage:
--   • board-photos       (public)
--   • compliance-photos  (public)
--   • creatives          (public)
--   • agency-logos       (public)
-- ============================================================


-- ── 1. Profile auto-creation trigger ──────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.profiles (id, role, full_name, company_name)
  VALUES (
    new.id,
    COALESCE(new.raw_user_meta_data->>'role', 'agency'),
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'company_name'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();


-- ── 2. Core tables ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.profiles (
  id               UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role             TEXT NOT NULL DEFAULT 'agency' CHECK (role IN ('agency','client','owner','admin')),
  full_name        TEXT,
  company_name     TEXT,
  -- White-label branding (agency only)
  brand_logo_url    TEXT,
  brand_accent_color TEXT DEFAULT '#1B4F8A',
  brand_tagline     TEXT,
  brand_website     TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.boards (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  name           TEXT NOT NULL,
  format         TEXT NOT NULL CHECK (format IN ('billboard','unipole','gantry','bridge_panel','wall_drape','digital')),
  address        TEXT,
  city           TEXT NOT NULL,
  state          TEXT,
  width          NUMERIC,
  height         NUMERIC,
  print_width_mm NUMERIC,
  print_height_mm NUMERIC,
  face_count     INTEGER DEFAULT 1,
  illuminated    BOOLEAN DEFAULT false,
  asking_rate    NUMERIC NOT NULL DEFAULT 0,
  latitude       NUMERIC,
  longitude      NUMERIC,
  status         TEXT DEFAULT 'available' CHECK (status IN ('available','booked','maintenance')),
  available_from DATE,
  contact_phone  TEXT,
  photo_urls     TEXT[],
  notes          TEXT,
  rate_card      JSONB,         -- owner's seasonal multipliers and duration discounts
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.campaigns (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  client_id       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  name            TEXT NOT NULL,
  client_name     TEXT,
  status          TEXT DEFAULT 'draft' CHECK (status IN ('draft','active','completed','cancelled','pending')),
  start_date      DATE,
  end_date        DATE,
  total_budget    NUMERIC DEFAULT 0,
  plan_notes      TEXT,
  objective       TEXT,
  target_cities   TEXT,
  approved_at     TIMESTAMPTZ,
  approved_by     UUID,
  -- ARCON compliance
  arcon_status      TEXT DEFAULT 'not_submitted' CHECK (arcon_status IN ('not_submitted','pending','approved','rejected','expired')),
  arcon_ref         TEXT,
  arcon_submitted_at TIMESTAMPTZ,
  arcon_approved_at  TIMESTAMPTZ,
  arcon_expiry_date  DATE,
  arcon_notes        TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.bookings (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id      UUID REFERENCES public.campaigns(id) ON DELETE CASCADE,
  board_id         UUID REFERENCES public.boards(id) ON DELETE SET NULL,
  offered_rate     NUMERIC,
  agreed_rate      NUMERIC,
  status           TEXT DEFAULT 'pending' CHECK (status IN ('pending','negotiating','agreed','signed','live','completed','declined')),
  start_date       DATE,
  end_date         DATE,
  duration_months  INTEGER DEFAULT 1,
  creative_type    TEXT DEFAULT 'static' CHECK (creative_type IN ('static','led','digital')),
  print_required   BOOLEAN DEFAULT false,
  mpo_number       TEXT,
  mpo_issued_at    TIMESTAMPTZ,
  mpo_agency_name  TEXT,
  contract_url     TEXT,
  poe_token        TEXT,
  notes            TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);


-- ── 3. Messaging & compliance ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.messages (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id   UUID REFERENCES public.bookings(id) ON DELETE CASCADE,
  sender_role  TEXT NOT NULL CHECK (sender_role IN ('agency','owner')),
  sender_id    UUID,
  sender_name  TEXT,
  message_type TEXT DEFAULT 'message' CHECK (message_type IN ('offer','counter_offer','message','acceptance','decline')),
  content      TEXT NOT NULL,
  offered_rate NUMERIC,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.compliance_checks (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id     UUID REFERENCES public.bookings(id) ON DELETE CASCADE,
  status         TEXT DEFAULT 'submitted' CHECK (status IN ('submitted','verified','flagged')),
  photo_url      TEXT,
  latitude       NUMERIC,
  longitude      NUMERIC,
  submitted_by   TEXT,
  notes          TEXT,
  submitted_at   TIMESTAMPTZ DEFAULT NOW(),
  -- AI verification
  ai_verdict     TEXT CHECK (ai_verdict IN ('verified','review','flagged')),
  ai_confidence  NUMERIC(3,2),
  ai_notes       TEXT,
  ai_verified_at TIMESTAMPTZ,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.creative_uploads (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id   UUID REFERENCES public.bookings(id) ON DELETE CASCADE,
  campaign_id  UUID REFERENCES public.campaigns(id) ON DELETE CASCADE,
  file_url     TEXT NOT NULL,
  file_name    TEXT,
  file_size    BIGINT,
  status       TEXT DEFAULT 'pending' CHECK (status IN ('pending','approved','changes_requested')),
  notes        TEXT,
  reviewed_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);


-- ── 4. Invoicing ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.invoices (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number        TEXT NOT NULL,
  invoice_type          TEXT NOT NULL DEFAULT 'client' CHECK (invoice_type IN ('media_partner','client')),
  campaign_id           UUID REFERENCES public.campaigns(id) ON DELETE SET NULL,
  compiled_invoice_id   UUID REFERENCES public.invoices(id) ON DELETE SET NULL,
  owner_id              UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  agency_id             UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  client_name           TEXT NOT NULL,
  client_email          TEXT,
  client_invoice_number TEXT,
  status                TEXT DEFAULT 'draft' CHECK (status IN ('draft','sent','acknowledged','paid','overdue','cancelled')),
  subtotal              NUMERIC NOT NULL DEFAULT 0,
  tax_rate              NUMERIC DEFAULT 0,
  tax_amount            NUMERIC DEFAULT 0,
  total_amount          NUMERIC NOT NULL DEFAULT 0,
  due_date              DATE,
  paid_at               TIMESTAMPTZ,
  payment_ref           TEXT,
  payment_url           TEXT,
  notes                 TEXT,
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.invoice_items (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id   UUID NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  booking_id   UUID REFERENCES public.bookings(id) ON DELETE SET NULL,
  description  TEXT NOT NULL,
  board_name   TEXT,
  board_format TEXT,
  location     TEXT,
  start_date   DATE,
  end_date     DATE,
  quantity     NUMERIC NOT NULL DEFAULT 1,
  unit_price   NUMERIC NOT NULL DEFAULT 0,
  total        NUMERIC NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);


-- ── 5. Notifications ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.notifications (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_role TEXT NOT NULL CHECK (recipient_role IN ('agency','client','owner','admin')),
  type           TEXT NOT NULL,
  title          TEXT NOT NULL,
  body           TEXT,
  link           TEXT,
  read           BOOLEAN DEFAULT false,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);


-- ── 6. Attribution tracking ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.tracking_links (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id  UUID REFERENCES public.bookings(id) ON DELETE CASCADE,
  campaign_id UUID REFERENCES public.campaigns(id) ON DELETE CASCADE,
  short_code  TEXT UNIQUE NOT NULL,
  target_url  TEXT NOT NULL,
  label       TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.tracking_events (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tracking_link_id UUID REFERENCES public.tracking_links(id) ON DELETE CASCADE,
  scanned_at       TIMESTAMPTZ DEFAULT NOW(),
  device_type      TEXT,
  user_agent       TEXT
);


-- ── 7. Audience intelligence cache ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.board_audience_profiles (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id          UUID REFERENCES public.boards(id) ON DELETE CASCADE,
  area_type         TEXT,
  area_icon         TEXT,
  area_description  TEXT,
  commercial_score  NUMERIC,
  footfall_score    NUMERIC,
  youth_score       NUMERIC,
  premium_score     NUMERIC,
  daily_impressions NUMERIC,
  top_pois          JSONB,
  verticals         TEXT[],
  total_pois        INTEGER,
  ai_insight        TEXT,
  data_source       TEXT DEFAULT 'estimated',
  enriched_at       TIMESTAMPTZ DEFAULT NOW()
);


-- ── 8. Indexes ─────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_boards_owner_id         ON public.boards(owner_id);
CREATE INDEX IF NOT EXISTS idx_boards_city             ON public.boards(city);
CREATE INDEX IF NOT EXISTS idx_boards_status           ON public.boards(status);
CREATE INDEX IF NOT EXISTS idx_campaigns_agency_id     ON public.campaigns(agency_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_status        ON public.campaigns(status);
CREATE INDEX IF NOT EXISTS idx_bookings_campaign_id    ON public.bookings(campaign_id);
CREATE INDEX IF NOT EXISTS idx_bookings_board_id       ON public.bookings(board_id);
CREATE INDEX IF NOT EXISTS idx_bookings_status         ON public.bookings(status);
CREATE INDEX IF NOT EXISTS idx_messages_booking_id     ON public.messages(booking_id);
CREATE INDEX IF NOT EXISTS idx_compliance_booking_id   ON public.compliance_checks(booking_id);
CREATE INDEX IF NOT EXISTS idx_invoices_campaign_id    ON public.invoices(campaign_id);
CREATE INDEX IF NOT EXISTS idx_invoices_agency_id      ON public.invoices(agency_id);
CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice   ON public.invoice_items(invoice_id);
CREATE INDEX IF NOT EXISTS idx_notifications_role      ON public.notifications(recipient_role);
CREATE INDEX IF NOT EXISTS idx_notifications_read      ON public.notifications(read);
CREATE INDEX IF NOT EXISTS idx_notifications_created   ON public.notifications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tracking_links_code     ON public.tracking_links(short_code);
CREATE INDEX IF NOT EXISTS idx_tracking_links_booking  ON public.tracking_links(booking_id);
CREATE INDEX IF NOT EXISTS idx_tracking_links_campaign ON public.tracking_links(campaign_id);
CREATE INDEX IF NOT EXISTS idx_tracking_events_link    ON public.tracking_events(tracking_link_id);
CREATE INDEX IF NOT EXISTS idx_tracking_events_time    ON public.tracking_events(scanned_at);


-- ── 9. Row Level Security ──────────────────────────────────────────────────────
-- Access control is enforced at the application layer.
-- RLS policies here are permissive to allow the anon/service key patterns used.

ALTER TABLE public.profiles           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.boards             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaigns          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bookings           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.compliance_checks  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.creative_uploads   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_items      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tracking_links     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tracking_events    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.board_audience_profiles ENABLE ROW LEVEL SECURITY;

-- Drop and recreate all policies so this file is idempotent
DO $$
DECLARE
  tbl TEXT;
  pol TEXT;
BEGIN
  FOR tbl, pol IN
    SELECT tablename, policyname FROM pg_policies WHERE schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol, tbl);
  END LOOP;
END $$;

-- Permissive policies (application enforces role-based access)
CREATE POLICY "profiles_all"          ON public.profiles           FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "boards_all"            ON public.boards             FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "campaigns_all"         ON public.campaigns          FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "bookings_all"          ON public.bookings           FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "messages_all"          ON public.messages           FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "compliance_all"        ON public.compliance_checks  FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "creative_uploads_all"  ON public.creative_uploads   FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "invoices_all"          ON public.invoices           FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "invoice_items_all"     ON public.invoice_items      FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "notifications_all"     ON public.notifications      FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "tracking_links_all"    ON public.tracking_links     FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "tracking_events_all"   ON public.tracking_events    FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "audience_profiles_all" ON public.board_audience_profiles FOR ALL USING (true) WITH CHECK (true);
