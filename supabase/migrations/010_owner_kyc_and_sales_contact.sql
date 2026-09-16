-- ═══════════════════════════════════════════════════════════════════
-- OOH Platform — Media partner KYC + sales contact (negotiation flow)
-- Run in Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- Safe to re-run.
-- ═══════════════════════════════════════════════════════════════════

-- ─── 1. profiles: media-partner business registration (KYC) ─────────────────
-- Required at signup for role='owner'. Stays private (existing
-- profiles_select_own RLS already restricts reads to the owner + admin —
-- no change needed, and that's correct: agencies should never see a
-- partner's CAC/TIN, only their public contact info on the board itself).

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS cac_number TEXT,
  ADD COLUMN IF NOT EXISTS tin_number TEXT,
  ADD COLUMN IF NOT EXISTS sales_contact_name TEXT;

COMMENT ON COLUMN public.profiles.cac_number IS 'Corporate Affairs Commission registration number — required for role=owner at signup';
COMMENT ON COLUMN public.profiles.tin_number IS 'Tax Identification Number — required for role=owner at signup';
COMMENT ON COLUMN public.profiles.sales_contact_name IS 'Name of the person agencies should contact to negotiate — phone reuses profiles.phone; defaults onto boards.contact_name/contact_phone when a board is posted';

-- ─── 2. boards: sales contact name alongside the existing contact_phone ──────
-- contact_phone already exists and is already public (boards_select_public).
-- contact_name lets the negotiation UI say "Contact Chidi →" instead of a
-- bare number — auto-filled from the owner's sales_contact_name when they
-- post a board, editable per board.

ALTER TABLE public.boards
  ADD COLUMN IF NOT EXISTS contact_name TEXT;

-- ─── 3. handle_new_user(): capture CAC/TIN passed at signup ─────────────────
-- Mirrors the existing full_name/company_name pattern — supabase.auth.signUp's
-- options.data becomes raw_user_meta_data, read here regardless of whether
-- email confirmation delays session creation.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, auth
AS $$
BEGIN
  INSERT INTO public.profiles (id, role, full_name, company_name, email, cac_number, tin_number)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'role', 'agency'),
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'company_name',
    NEW.email,
    NEW.raw_user_meta_data->>'cac_number',
    NEW.raw_user_meta_data->>'tin_number'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;
