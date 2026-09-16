-- ═══════════════════════════════════════════════════════════════════
-- OOH Platform — Plan financial structure + board-swap flow (Phase 3)
-- Run in Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- Safe to re-run: uses IF NOT EXISTS / IF EXISTS throughout.
-- ═══════════════════════════════════════════════════════════════════

-- ─── 1. bookings: real media-plan financial structure ────────────────────────
-- agreed_rate stays the net monthly media cost (unchanged, still what every
-- existing query/PDF reads). These add the rest of a real plan line:
-- gross rate, the % discount negotiated off it, one-off production cost, and
-- an optional uneven monthly spend split (null = spread evenly over
-- duration_months).

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS gross_rate      NUMERIC,
  ADD COLUMN IF NOT EXISTS discount_pct    NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS production_cost NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS monthly_spend   JSONB;

COMMENT ON COLUMN public.bookings.gross_rate      IS 'Gross monthly media cost before discount (rate-card / asking-based)';
COMMENT ON COLUMN public.bookings.discount_pct    IS 'Negotiated discount %% off gross_rate — net = gross_rate * (1 - discount_pct/100), should reconcile with agreed_rate';
COMMENT ON COLUMN public.bookings.production_cost IS 'One-off print/installation cost, separate from monthly media spend';
COMMENT ON COLUMN public.bookings.monthly_spend   IS 'Optional uneven monthly split: [{"month":"2026-01","amount":123}] — null means spread agreed_rate evenly across duration_months';

-- ─── 2. bookings: board-swap ("needs replacement") flow ──────────────────────
-- replaces_booking_id links a candidate replacement line back to the
-- original plan line it's standing in for. status gets two new values:
-- 'needs_replacement' (flagged, replacement not yet chosen/approved) and
-- 'replaced' (superseded — kept for audit trail, no longer the active line).

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS replaces_booking_id UUID REFERENCES public.bookings(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_bookings_replaces ON public.bookings(replaces_booking_id) WHERE replaces_booking_id IS NOT NULL;

ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_status_check;
ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_status_check
  CHECK (status IN (
    'pending', 'negotiating', 'agreed', 'signed', 'live', 'completed', 'declined',
    'needs_replacement', 'replaced'
  ));

-- ─── 3. campaigns: plan version ───────────────────────────────────────────────
-- Increments whenever a replacement line is approved, so the plan/MPO history
-- shows which version of the plan a given MPO was issued against.

ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS plan_version INTEGER NOT NULL DEFAULT 1;
