-- Add rate_card column to boards
-- Stores owner's seasonal multipliers and duration discounts as JSONB.
-- Run once in Supabase SQL Editor (existing databases only — included in supabase-full-setup.sql).

ALTER TABLE public.boards
  ADD COLUMN IF NOT EXISTS rate_card JSONB;

COMMENT ON COLUMN public.boards.rate_card IS 'Owner rate card settings: { baseRate, seasons: [{id, multiplier}], durations: [{months, discount}] }';
