-- User suspension flag for admin control panel.
-- Run once in the Supabase SQL Editor.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_suspended BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.profiles.is_suspended IS
  'Set by admin to block user access. Checked in dashboard layout on session load.';

-- Allow authenticated users to read suspension status (needed for self-check)
-- Admins update via the anon key; RLS already allows profile reads.
