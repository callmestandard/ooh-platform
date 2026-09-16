-- ═══════════════════════════════════════════════════════════════════
-- OOH Platform — close the "resubmit to silently win a dispute" loophole
-- Run in Supabase SQL Editor (Dashboard → SQL Editor → New query)
--
-- Live-tested 024's conflict trigger and found a real gap: once two
-- agents' claims are both flipped to 'disputed', NEITHER is 'active' any
-- more — so a third claim (even a fresh resubmission by one of the
-- original agents) finds nothing active to conflict with and becomes the
-- sole active claim completely unopposed, with no admin ever touching it.
-- That silently resolves the dispute in favor of whoever resubmits, which
-- defeats "always surface for manual admin review."
--
-- Fix: a board with ANY existing disputed authorization is frozen — no
-- new claim on it can become active until admin resolves the standing
-- dispute (via the existing admin conflict-review screen, which reactivates
-- the legitimate one and revokes the rest). This applies regardless of
-- which agent is submitting, including the original disputants.
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.flag_board_authorization_conflicts()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  conflicting RECORD;
  has_standing_dispute BOOLEAN;
BEGIN
  IF NEW.status = 'active' THEN
    -- A board already under dispute stays frozen until admin resolves it —
    -- checked first so a resubmission can't quietly become the sole active
    -- claim just because the other disputed rows aren't 'active' either.
    SELECT EXISTS (
      SELECT 1 FROM public.board_authorizations
      WHERE board_id = NEW.board_id AND status = 'disputed' AND id <> NEW.id
    ) INTO has_standing_dispute;

    IF has_standing_dispute THEN
      NEW.status := 'disputed';
      NEW.dispute_notes := COALESCE(NEW.dispute_notes, '') ||
        format(E'\n[auto] Board %s already has a standing, unresolved dispute as of %s — this claim is frozen until admin resolves it.', NEW.board_id, NOW());
      RETURN NEW;
    END IF;

    FOR conflicting IN
      SELECT id FROM public.board_authorizations
      WHERE board_id = NEW.board_id
        AND agent_id <> NEW.agent_id
        AND status = 'active'
        AND id <> NEW.id
    LOOP
      UPDATE public.board_authorizations
        SET status = 'disputed',
            dispute_notes = COALESCE(dispute_notes, '') ||
              format(E'\n[auto] Conflicts with authorization %s (agent %s) as of %s', NEW.id, NEW.agent_id, NOW())
        WHERE id = conflicting.id;
      NEW.status := 'disputed';
      NEW.dispute_notes := COALESCE(NEW.dispute_notes, '') ||
        format(E'\n[auto] Conflicts with existing authorization %s as of %s', conflicting.id, NOW());
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- Trigger definition (024) already points at this function by name — no
-- need to re-create the trigger itself, CREATE OR REPLACE is enough.
