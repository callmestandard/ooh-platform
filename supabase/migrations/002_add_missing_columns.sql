-- ═══════════════════════════════════════════════════════════════════
-- OOH Platform — Add missing columns
-- Run this in Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- ═══════════════════════════════════════════════════════════════════

-- ─── boards: rate card storage ──────────────────────────────────────
-- Stores seasonal multipliers + duration discounts as JSONB

ALTER TABLE boards
  ADD COLUMN IF NOT EXISTS rate_card JSONB;

-- ─── profiles: agency branding fields ───────────────────────────────

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS brand_accent_color TEXT,
  ADD COLUMN IF NOT EXISTS brand_tagline       TEXT,
  ADD COLUMN IF NOT EXISTS brand_website       TEXT,
  ADD COLUMN IF NOT EXISTS brand_logo_url      TEXT,
  ADD COLUMN IF NOT EXISTS erp_vendor_code     TEXT;

-- ─── auth_role(): add SECURITY DEFINER to avoid RLS re-entry ────────
-- Without SECURITY DEFINER, auth_role() queries profiles while profiles
-- RLS is already being evaluated — adding SECURITY DEFINER lets the
-- function bypass RLS and read the role directly.

CREATE OR REPLACE FUNCTION auth_role()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions, auth
AS $$
  SELECT COALESCE(
    (SELECT role FROM profiles WHERE id = auth.uid()),
    auth.jwt() ->> 'role',
    'anon'
  );
$$;
