-- ═══════════════════════════════════════════════════════════════════
-- OOH Platform — print progress tracking per booking/plan line
-- Run in Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- Safe to re-run: uses IF NOT EXISTS / IF EXISTS throughout.
--
-- Tracks whether the printed creative for a board is ready — status only,
-- never printing/vendor/payment logic. One row per booking (1:1), with
-- status history reusing the existing activity_events audit log (same
-- pattern as board/compliance/invoice history) rather than inventing a
-- second mechanism.
--
-- Permission model: only the profile(s) matching `responsible_party` on
-- that specific booking's campaign/board can advance status — enforced at
-- the RLS + trigger level (not just hidden in the UI), same standard as
-- the agent-listing floor-rate enforcement in 024_agent_reseller_model.sql.
-- When responsible_party='board_owner' and the board has no verified owner
-- account yet (per the agent/owner-verification model from 024, 026, 027),
-- the campaign's own agency may act on the owner's behalf — recorded
-- honestly via updated_on_behalf_of_owner, computed server-side, never
-- trusted from the client.
-- ═══════════════════════════════════════════════════════════════════

-- ── 0. Helpers: resolve "verified owner" the same way the trust badge does ──
-- A board has a verified owner account when either the real owner signed up
-- and owns the board row directly (boards.owner_id), or an agent's claim on
-- it has been confirmed by the named owner (board_authorizations.owner_id,
-- owner_verified = true) — boards.owner_id stays NULL in that second path
-- (see 026_agent_board_insert.sql), so both paths must be checked.

CREATE OR REPLACE FUNCTION public.board_has_verified_owner(p_board_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.boards b WHERE b.id = p_board_id AND b.owner_id IS NOT NULL)
      OR EXISTS (
        SELECT 1 FROM public.board_authorizations a
        WHERE a.board_id = p_board_id AND a.status = 'active' AND a.owner_verified = true
      );
$$;

CREATE OR REPLACE FUNCTION public.board_owner_match(p_board_id UUID, p_uid UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.boards b WHERE b.id = p_board_id AND b.owner_id = p_uid)
      OR EXISTS (
        SELECT 1 FROM public.board_authorizations a
        WHERE a.board_id = p_board_id AND a.status = 'active' AND a.owner_verified = true AND a.owner_id = p_uid
      );
$$;

CREATE OR REPLACE FUNCTION public.print_status_rank(p_status TEXT)
RETURNS INT
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE p_status
    WHEN 'not_started'        THEN 0
    WHEN 'in_production'      THEN 1
    WHEN 'printed'            THEN 2
    WHEN 'delivered_to_site'  THEN 3
    WHEN 'installed'          THEN 4
    ELSE -1
  END;
$$;

-- ── 1. print_tasks ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.print_tasks (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id                 UUID NOT NULL UNIQUE REFERENCES public.bookings(id) ON DELETE CASCADE,
  campaign_id                UUID REFERENCES public.campaigns(id) ON DELETE SET NULL,
  -- who is responsible for getting this board's creative printed — required,
  -- no silent default, set explicitly when the plan line is created/confirmed.
  responsible_party          TEXT NOT NULL CHECK (responsible_party IN ('agency', 'client', 'board_owner')),
  status                     TEXT NOT NULL DEFAULT 'not_started'
                              CHECK (status IN ('not_started', 'in_production', 'printed', 'delivered_to_site', 'installed')),
  notes                      TEXT,
  photo_url                  TEXT,
  -- denormalized display fields (same convention as activity_events.actor_name)
  -- so every connected party can see who last updated it without needing a
  -- cross-role profiles read they may not have RLS access to.
  updated_by                 UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_by_name            TEXT,
  updated_by_role            TEXT,
  -- true only when the campaign's agency updated a board_owner task because
  -- the owner isn't a verified platform user yet — computed server-side in
  -- the trigger below, never trusted from client input.
  updated_on_behalf_of_owner BOOLEAN NOT NULL DEFAULT false,
  created_by                 UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS print_tasks_campaign_idx ON public.print_tasks(campaign_id);
CREATE INDEX IF NOT EXISTS print_tasks_status_idx   ON public.print_tasks(status);

COMMENT ON TABLE public.print_tasks IS
  'Status tracker for a board''s printed creative — not_started -> in_production -> printed -> delivered_to_site -> installed. Platform never prints anything; this is visibility only.';

-- ── 2. Guard trigger: forward-only status, agency/admin-only reassignment,
--      server-computed audit fields ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.guard_print_task_transitions()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_board_id UUID;
BEGIN
  SELECT board_id INTO v_board_id FROM public.bookings WHERE id = NEW.booking_id;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.status IS DISTINCT FROM OLD.status
       AND public.print_status_rank(NEW.status) < public.print_status_rank(OLD.status)
       AND auth_role() <> 'admin' THEN
      RAISE EXCEPTION 'print task status cannot move backward from % to % (admin override required)', OLD.status, NEW.status;
    END IF;

    IF NEW.responsible_party IS DISTINCT FROM OLD.responsible_party
       AND auth_role() NOT IN ('agency', 'admin') THEN
      RAISE EXCEPTION 'only the campaign''s agency or admin can reassign a print task''s responsible party';
    END IF;
  END IF;

  -- Never trust who-made-this-change from client input.
  NEW.updated_by := auth.uid();
  NEW.updated_at := NOW();
  NEW.updated_on_behalf_of_owner :=
    NEW.responsible_party = 'board_owner'
    AND NOT public.board_has_verified_owner(v_board_id)
    AND auth_role() = 'agency';

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS print_tasks_guard_transitions ON public.print_tasks;
CREATE TRIGGER print_tasks_guard_transitions
  BEFORE INSERT OR UPDATE ON public.print_tasks
  FOR EACH ROW EXECUTE FUNCTION public.guard_print_task_transitions();

-- ── 3. RLS ───────────────────────────────────────────────────────────────

ALTER TABLE public.print_tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "print_tasks_select" ON public.print_tasks;
DROP POLICY IF EXISTS "print_tasks_insert" ON public.print_tasks;
DROP POLICY IF EXISTS "print_tasks_update" ON public.print_tasks;
DROP POLICY IF EXISTS "print_tasks_delete" ON public.print_tasks;

-- Read: every party connected to the booking — the campaign's agency and
-- client, and the board's (verified) owner — plus admin. Read-only for
-- whichever two of the three aren't the responsible_party; enforced below.
CREATE POLICY "print_tasks_select" ON public.print_tasks FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.bookings bk
    JOIN public.campaigns c ON c.id = bk.campaign_id
    WHERE bk.id = print_tasks.booking_id AND (
      c.agency_id = auth.uid()
      OR c.client_id = auth.uid()
      OR public.board_owner_match(bk.board_id, auth.uid())
      OR auth_role() = 'admin'
    )
  )
);

-- Create: the campaign's own agency sets up the tracker when the plan line
-- is created/confirmed (or admin) — matches who manages the plan elsewhere.
CREATE POLICY "print_tasks_insert" ON public.print_tasks FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.bookings bk
    JOIN public.campaigns c ON c.id = bk.campaign_id
    WHERE bk.id = booking_id AND (c.agency_id = auth.uid() OR auth_role() = 'admin')
  )
);

-- Update (advance status / notes / photo): only the matching responsible
-- party for THIS booking's campaign/board — never any agency/client/owner
-- at large. The board_owner-unverified fallback lets the campaign's agency
-- act "on behalf of" an owner who isn't a platform user yet.
CREATE POLICY "print_tasks_update" ON public.print_tasks FOR UPDATE USING (
  EXISTS (
    SELECT 1 FROM public.bookings bk
    JOIN public.campaigns c ON c.id = bk.campaign_id
    WHERE bk.id = print_tasks.booking_id AND (
      (print_tasks.responsible_party = 'agency' AND c.agency_id = auth.uid())
      OR (print_tasks.responsible_party = 'client' AND c.client_id = auth.uid())
      OR (print_tasks.responsible_party = 'board_owner' AND public.board_owner_match(bk.board_id, auth.uid()))
      OR (print_tasks.responsible_party = 'board_owner'
          AND NOT public.board_has_verified_owner(bk.board_id)
          AND c.agency_id = auth.uid())
      OR auth_role() = 'admin'
    )
  )
);

CREATE POLICY "print_tasks_delete" ON public.print_tasks FOR DELETE USING (
  auth_role() = 'admin'
);

-- ── 4. Reuse activity_events for status history (not a second mechanism) ──

ALTER TABLE public.activity_events DROP CONSTRAINT IF EXISTS activity_events_entity_type_check;
ALTER TABLE public.activity_events
  ADD CONSTRAINT activity_events_entity_type_check
  CHECK (entity_type IN ('campaign', 'booking', 'invoice', 'compliance_check', 'board', 'print_task'));

DROP POLICY IF EXISTS "activity_select" ON public.activity_events;
CREATE POLICY "activity_select" ON public.activity_events FOR SELECT USING (
  actor_id = auth.uid()
  OR EXISTS (SELECT 1 FROM public.campaigns WHERE campaigns.id = activity_events.campaign_id AND campaigns.agency_id = auth.uid())
  OR EXISTS (SELECT 1 FROM public.campaigns WHERE campaigns.id = activity_events.campaign_id AND campaigns.client_id = auth.uid())
  OR (entity_type = 'board' AND auth_role() IN ('agency', 'admin'))
  OR (entity_type = 'print_task' AND EXISTS (
        SELECT 1 FROM public.print_tasks pt
        JOIN public.bookings bk ON bk.id = pt.booking_id
        WHERE pt.id = activity_events.entity_id AND public.board_owner_match(bk.board_id, auth.uid())
      ))
  OR auth_role() = 'admin'
);
-- activity_insert / activity_insert_v2 (WITH CHECK true) already cover inserts.
