-- ═══════════════════════════════════════════════════════════════════
-- OOH Platform — Add phone and city to profiles
-- Safe to re-run
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS city  text;
