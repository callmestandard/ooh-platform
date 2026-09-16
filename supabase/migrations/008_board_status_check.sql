-- ═══════════════════════════════════════════════════════════════════
-- OOH Platform — Fix boards.status CHECK constraint (Phase 1 follow-up)
-- Run in Supabase SQL Editor (Dashboard → SQL Editor → New query)
--
-- 007_board_internal_asset.sql assumed boards.status had no CHECK
-- constraint (PostgREST's schema introspection doesn't surface CHECK
-- constraints, so this wasn't visible via the REST API). Live testing
-- after running 007 found a real constraint — "boards_status_check" —
-- still limited to ('available','booked','maintenance'), so setting a
-- board to 'unavailable' or 'decommissioned' fails with:
--   error 23514: new row for relation "boards" violates check
--   constraint "boards_status_check"
-- This migration widens it to the Phase 1 vocabulary.
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE public.boards DROP CONSTRAINT IF EXISTS boards_status_check;
ALTER TABLE public.boards
  ADD CONSTRAINT boards_status_check
  CHECK (status IN ('available', 'booked', 'unavailable', 'decommissioned'));
