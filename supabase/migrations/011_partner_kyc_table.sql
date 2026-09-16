-- ═══════════════════════════════════════════════════════════════════
-- OOH Platform — SECURITY FIX: move CAC/TIN off the public profiles table
-- Run in Supabase SQL Editor (Dashboard → SQL Editor → New query)
--
-- 010_owner_kyc_and_sales_contact.sql put cac_number/tin_number directly on
-- public.profiles, assuming the existing profiles_select_own RLS policy
-- (id = auth.uid() OR admin) would keep them private. Live testing found
-- that assumption wrong: public.profiles is actually readable by ANYONE,
-- including fully unauthenticated requests (confirmed via the anon key with
-- no session at all) — a broader policy is live than what the 001 migration
-- file describes, presumably to support features like the client picker in
-- the campaign planner. Whatever the reason, sensitive KYC data should
-- never have been stored on that table. This migration moves it to its own
-- table with its own strict RLS, independent of whatever profiles' policy
-- does.
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.partner_kyc (
  id          UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  cac_number  TEXT,
  tin_number  TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Carry over any data already written under 010 before this fix landed.
INSERT INTO public.partner_kyc (id, cac_number, tin_number)
SELECT id, cac_number, tin_number FROM public.profiles
WHERE cac_number IS NOT NULL OR tin_number IS NOT NULL
ON CONFLICT (id) DO UPDATE SET cac_number = EXCLUDED.cac_number, tin_number = EXCLUDED.tin_number;

ALTER TABLE public.profiles DROP COLUMN IF EXISTS cac_number;
ALTER TABLE public.profiles DROP COLUMN IF EXISTS tin_number;

ALTER TABLE public.partner_kyc ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "partner_kyc_select_own" ON public.partner_kyc;
DROP POLICY IF EXISTS "partner_kyc_upsert_own" ON public.partner_kyc;
DROP POLICY IF EXISTS "partner_kyc_update_own" ON public.partner_kyc;

CREATE POLICY "partner_kyc_select_own" ON public.partner_kyc
  FOR SELECT USING (id = auth.uid() OR auth_role() = 'admin');

CREATE POLICY "partner_kyc_upsert_own" ON public.partner_kyc
  FOR INSERT WITH CHECK (id = auth.uid());

CREATE POLICY "partner_kyc_update_own" ON public.partner_kyc
  FOR UPDATE USING (id = auth.uid() OR auth_role() = 'admin');

-- handle_new_user(): write CAC/TIN into partner_kyc instead of profiles.

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

  IF NEW.raw_user_meta_data->>'cac_number' IS NOT NULL OR NEW.raw_user_meta_data->>'tin_number' IS NOT NULL THEN
    INSERT INTO public.partner_kyc (id, cac_number, tin_number)
    VALUES (NEW.id, NEW.raw_user_meta_data->>'cac_number', NEW.raw_user_meta_data->>'tin_number')
    ON CONFLICT (id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;
