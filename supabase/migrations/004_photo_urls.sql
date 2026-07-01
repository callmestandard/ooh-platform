-- ═══════════════════════════════════════════════════════════════════
-- OOH Platform — Add photo_urls column to boards
-- Run in Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- Safe to re-run: uses IF NOT EXISTS / DO $$ blocks
-- ═══════════════════════════════════════════════════════════════════

-- Add photo_urls as a JSONB array on the boards table.
-- This replaces the old 'photos' column (if it ever existed) with a
-- properly-named column that matches the codebase convention.

ALTER TABLE public.boards
  ADD COLUMN IF NOT EXISTS photo_urls JSONB;

-- If a 'photos' column exists with data, migrate it across then drop it.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'boards'
      AND column_name  = 'photos'
  ) THEN
    UPDATE public.boards
    SET photo_urls = photos
    WHERE photo_urls IS NULL AND photos IS NOT NULL;

    ALTER TABLE public.boards DROP COLUMN photos;
  END IF;
END $$;

-- Allow anonymous reads of photo_urls (already covered by the boards
-- SELECT policy, but this comment is a reminder that photo URLs are public).
-- No additional policy needed — the existing boards RLS policies apply.
