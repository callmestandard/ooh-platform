-- ═══════════════════════════════════════════════════════════════════
-- OOH Platform — board verification, source and area
-- Run in Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- Requires 035 (is_owner_member). Safe to re-run.
--
-- The marketplace showed every board as "Verified Owner" with nothing in
-- the database to back it. Each board now carries:
--
--   verification_status  pending          — sourced from a deck or other
--                                            material; owner hasn't confirmed
--                        verified         — owner confirmed it to the platform
--                                            team (set by an admin)
--                        partner_verified — the owner is on the platform and
--                                            manages the board themselves
--   last_verified_at     when the status was last confirmed
--   source               where the record came from, e.g. "Sule Outdoor deck, Oct 2026"
--   area                 neighbourhood within the city, e.g. "Ikeja", "Lekki Phase 1"
--
-- Who can set what (enforced by the trigger below, not the UI):
--   • Only an admin (or the service role) can set verification_status,
--     last_verified_at and source directly.
--   • A board an owner adds for their own company starts partner_verified.
--     Anything else (agency, agent, an owner_id belonging to someone else)
--     starts pending.
--   • When an unowned board gains an owner (approved claim), it becomes
--     partner_verified. If it loses its owner, it drops back to pending.
--   • When the owner's team edits a partner_verified board, last_verified_at
--     moves to now — the owner has just confirmed the details.
--
-- Also: boards.illuminated loses its DEFAULT false. A board whose lighting
-- isn't known is now stored as NULL and shown as "Information unavailable"
-- instead of "No".
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE public.boards ADD COLUMN IF NOT EXISTS verification_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE public.boards ADD COLUMN IF NOT EXISTS last_verified_at    TIMESTAMPTZ;
ALTER TABLE public.boards ADD COLUMN IF NOT EXISTS source              TEXT;
ALTER TABLE public.boards ADD COLUMN IF NOT EXISTS area                TEXT;

ALTER TABLE public.boards DROP CONSTRAINT IF EXISTS boards_verification_status_check;
ALTER TABLE public.boards ADD CONSTRAINT boards_verification_status_check
  CHECK (verification_status IN ('pending', 'verified', 'partner_verified'));

ALTER TABLE public.boards ALTER COLUMN illuminated DROP DEFAULT;

CREATE INDEX IF NOT EXISTS idx_boards_verification_status ON public.boards(verification_status);

-- ── Guard ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.guard_board_verification()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid     UUID    := auth.uid();
  v_trusted BOOLEAN := v_uid IS NULL OR public.auth_role() = 'admin';
  v_team    BOOLEAN := NEW.owner_id IS NOT NULL AND COALESCE(public.is_owner_member(NEW.owner_id, v_uid), false);
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT v_trusted THEN
      NEW.source := NULL;
      IF v_team THEN
        NEW.verification_status := 'partner_verified';
        NEW.last_verified_at    := NOW();
      ELSE
        NEW.verification_status := 'pending';
        NEW.last_verified_at    := NULL;
      END IF;
    ELSIF NEW.verification_status <> 'pending' AND NEW.last_verified_at IS NULL THEN
      NEW.last_verified_at := NOW();
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE
  IF NOT v_trusted THEN
    NEW.verification_status := OLD.verification_status;
    NEW.last_verified_at    := OLD.last_verified_at;
    NEW.source              := OLD.source;
  ELSIF NEW.verification_status IS DISTINCT FROM OLD.verification_status
        AND NEW.last_verified_at IS NOT DISTINCT FROM OLD.last_verified_at
        AND NEW.verification_status <> 'pending' THEN
    -- An admin changed the status without giving a date: it was confirmed now.
    NEW.last_verified_at := NOW();
  END IF;

  -- Ownership changes (claim approval runs as an admin, so this sits outside
  -- the trusted check). An explicit status change in the same update wins.
  IF NEW.verification_status IS NOT DISTINCT FROM OLD.verification_status THEN
    IF OLD.owner_id IS NULL AND NEW.owner_id IS NOT NULL THEN
      NEW.verification_status := 'partner_verified';
      NEW.last_verified_at    := NOW();
    ELSIF OLD.owner_id IS NOT NULL AND NEW.owner_id IS NULL AND OLD.verification_status = 'partner_verified' THEN
      NEW.verification_status := 'pending';
    END IF;
  END IF;

  -- The owner's own team editing a board they manage re-confirms it.
  IF v_team AND NEW.verification_status = 'partner_verified' THEN
    NEW.last_verified_at := NOW();
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS boards_guard_verification ON public.boards;
CREATE TRIGGER boards_guard_verification BEFORE INSERT OR UPDATE ON public.boards
  FOR EACH ROW EXECUTE FUNCTION public.guard_board_verification();

-- ── Backfill ─────────────────────────────────────────────────────────────
-- Boards that already have an owner account are owner-managed. Runs as the
-- SQL Editor (trusted), so the trigger keeps these values.
UPDATE public.boards
   SET verification_status = 'partner_verified',
       last_verified_at    = COALESCE(last_verified_at, created_at, NOW())
 WHERE owner_id IS NOT NULL AND verification_status = 'pending';
