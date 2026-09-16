-- ═══════════════════════════════════════════════════════════════════
-- OOH Platform — Boards as a persistent internal asset (Phase 1)
-- Run in Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- Safe to re-run: uses IF NOT EXISTS / IF EXISTS / OR REPLACE throughout.
-- ═══════════════════════════════════════════════════════════════════

-- ─── 1. boards: media-partner + orientation fields ───────────────────────────
-- partner_name covers boards entered by an agency on behalf of a media
-- partner who has no registered account (owner_id stays null in that case).

ALTER TABLE public.boards
  ADD COLUMN IF NOT EXISTS partner_name TEXT,
  ADD COLUMN IF NOT EXISTS orientation  TEXT;

COMMENT ON COLUMN public.boards.partner_name IS 'Media partner/owner display name — used when the board has no registered owner_id account';
COMMENT ON COLUMN public.boards.orientation  IS 'portrait | landscape | square';

-- ─── 2. boards: consolidate status vocabulary ────────────────────────────────
-- Target vocabulary: available | booked | unavailable | decommissioned.
-- No CHECK constraint exists on boards.status today, so this is a pure data
-- backfill — 'maintenance' (the old ad-hoc value used in the UI) becomes
-- 'unavailable'.

UPDATE public.boards SET status = 'unavailable' WHERE status = 'maintenance';

-- ─── 3. boards: let agency users manage internally-added inventory ──────────
-- Existing boards_insert_own / boards_update_own require owner_id = auth.uid(),
-- which blocks an agency user from creating/editing a board on behalf of an
-- unregistered partner (owner_id null). These are additive policies —
-- Postgres OR's multiple permissive policies together, so owner self-service
-- is untouched.

DROP POLICY IF EXISTS "boards_insert_agency" ON public.boards;
DROP POLICY IF EXISTS "boards_update_agency" ON public.boards;

CREATE POLICY "boards_insert_agency" ON public.boards
  FOR INSERT WITH CHECK (auth_role() IN ('agency', 'admin'));

CREATE POLICY "boards_update_agency" ON public.boards
  FOR UPDATE USING (auth_role() IN ('agency', 'admin'));

-- ─── 4. activity_events: allow 'board' as an entity type ─────────────────────
-- Reuses the existing append-only activity log (+ ActivityTimeline component)
-- for board status-change history instead of a new table.

ALTER TABLE public.activity_events DROP CONSTRAINT IF EXISTS activity_events_entity_type_check;
ALTER TABLE public.activity_events
  ADD CONSTRAINT activity_events_entity_type_check
  CHECK (entity_type IN ('campaign', 'booking', 'invoice', 'compliance_check', 'board'));

-- Board activity has no campaign_id, so the existing activity_select policy
-- (actor-only or campaign-matched) would hide it from teammates who didn't
-- make the change. Add a role-based clause for entity_type = 'board'.

DROP POLICY IF EXISTS "activity_select" ON public.activity_events;

CREATE POLICY "activity_select"
  ON public.activity_events FOR SELECT
  USING (
    actor_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.campaigns
      WHERE campaigns.id = activity_events.campaign_id
        AND campaigns.agency_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.campaigns
      WHERE campaigns.id = activity_events.campaign_id
        AND campaigns.client_id = auth.uid()
    )
    OR (entity_type = 'board' AND auth_role() IN ('agency', 'admin'))
    OR auth_role() = 'admin'
  );
