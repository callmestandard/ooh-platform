-- ═══════════════════════════════════════════════════════════════════
-- OOH Platform — fix print_tasks policies (follow-up to 030_print_tasks.sql)
-- Run in Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- Safe to re-run: CREATE OR REPLACE / DROP POLICY IF EXISTS throughout.
--
-- Found by scripts/verify-print-tasks-rls.mjs:
--
-- 1. A verified board owner could not read or update ANY print task, even
--    as the responsible party. The 030 policies resolved access with
--    `bookings JOIN campaigns`, but a subquery inside a policy still runs
--    under the caller's RLS, and owners have no SELECT on campaigns — so
--    the join returned nothing and the owner branch could never match.
--    Fixed by resolving the booking's parties in a SECURITY DEFINER helper.
--
-- 2. The campaign's agency could not reassign responsibility. Reassigning
--    agency -> client failed the implicit WITH CHECK (the new row no longer
--    matched the "agency is responsible" branch), and a task already held
--    by the client or a verified owner could not be updated by the agency
--    at all. Fixed by letting the campaign's agency UPDATE the row, while
--    the trigger restricts a non-responsible agency to changing ONLY
--    responsible_party — it still cannot touch status, notes or photo.
-- ═══════════════════════════════════════════════════════════════════

-- ── 0. Helper: the caller's relationship to a booking, bypassing RLS ──────

CREATE OR REPLACE FUNCTION public.print_task_access(p_booking_id UUID, p_uid UUID)
RETURNS TABLE (is_agency BOOLEAN, is_client BOOLEAN, is_owner BOOLEAN, has_verified_owner BOOLEAN)
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COALESCE(c.agency_id = p_uid, false),
    COALESCE(c.client_id = p_uid, false),
    public.board_owner_match(bk.board_id, p_uid),
    public.board_has_verified_owner(bk.board_id)
  FROM public.bookings bk
  LEFT JOIN public.campaigns c ON c.id = bk.campaign_id
  WHERE bk.id = p_booking_id;
$$;

-- May this user advance status / edit notes / photo for a task with this party?
CREATE OR REPLACE FUNCTION public.print_task_can_advance(p_booking_id UUID, p_party TEXT, p_uid UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((
    SELECT (p_party = 'agency' AND a.is_agency)
        OR (p_party = 'client' AND a.is_client)
        OR (p_party = 'board_owner' AND a.is_owner)
        OR (p_party = 'board_owner' AND NOT a.has_verified_owner AND a.is_agency)
    FROM public.print_task_access(p_booking_id, p_uid) a
  ), false);
$$;

-- ── 1. Guard trigger ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.guard_print_task_transitions()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_board_id UUID;
  v_is_agency BOOLEAN := false;
  -- No JWT user = service role / SQL editor: trusted, skip the permission checks.
  v_trusted BOOLEAN := auth.uid() IS NULL OR auth_role() = 'admin';
BEGIN
  SELECT board_id INTO v_board_id FROM public.bookings WHERE id = NEW.booking_id;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.booking_id IS DISTINCT FROM OLD.booking_id OR NEW.campaign_id IS DISTINCT FROM OLD.campaign_id THEN
      RAISE EXCEPTION 'a print task cannot be moved to a different booking or campaign';
    END IF;

    IF NEW.status IS DISTINCT FROM OLD.status
       AND public.print_status_rank(NEW.status) < public.print_status_rank(OLD.status)
       AND auth_role() <> 'admin' THEN
      RAISE EXCEPTION 'print task status cannot move backward from % to % (admin override required)', OLD.status, NEW.status;
    END IF;

    IF NOT v_trusted THEN
      SELECT a.is_agency INTO v_is_agency FROM public.print_task_access(OLD.booking_id, auth.uid()) a;

      IF NEW.responsible_party IS DISTINCT FROM OLD.responsible_party AND NOT COALESCE(v_is_agency, false) THEN
        RAISE EXCEPTION 'only the campaign''s agency or admin can reassign a print task''s responsible party';
      END IF;

      -- Progress fields belong to whoever is responsible. The campaign's
      -- agency can reach this row to reassign it, but may not edit progress
      -- on a task it isn't responsible for.
      IF (NEW.status IS DISTINCT FROM OLD.status
          OR NEW.notes IS DISTINCT FROM OLD.notes
          OR NEW.photo_url IS DISTINCT FROM OLD.photo_url)
         AND NOT public.print_task_can_advance(OLD.booking_id, OLD.responsible_party, auth.uid()) THEN
        RAISE EXCEPTION 'only the responsible party (%) can update this print task''s progress', OLD.responsible_party;
      END IF;
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

-- ── 2. Policies ──────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "print_tasks_select" ON public.print_tasks;
DROP POLICY IF EXISTS "print_tasks_insert" ON public.print_tasks;
DROP POLICY IF EXISTS "print_tasks_update" ON public.print_tasks;

-- Read: every party connected to the booking, plus admin.
CREATE POLICY "print_tasks_select" ON public.print_tasks FOR SELECT USING (
  auth_role() = 'admin'
  OR EXISTS (
    SELECT 1 FROM public.print_task_access(print_tasks.booking_id, auth.uid()) a
    WHERE a.is_agency OR a.is_client OR a.is_owner
  )
);

-- Create: the campaign's own agency (or admin).
CREATE POLICY "print_tasks_insert" ON public.print_tasks FOR INSERT WITH CHECK (
  auth_role() = 'admin'
  OR EXISTS (SELECT 1 FROM public.print_task_access(booking_id, auth.uid()) a WHERE a.is_agency)
);

-- Update: the responsible party (progress) or the campaign's agency
-- (reassignment only — the guard trigger blocks it from editing progress on
-- a task it isn't responsible for). WITH CHECK is the same test on the new
-- row, so a reassignment by the agency is not rejected for no longer
-- matching the old party.
CREATE POLICY "print_tasks_update" ON public.print_tasks FOR UPDATE
  USING (
    auth_role() = 'admin'
    OR public.print_task_can_advance(print_tasks.booking_id, print_tasks.responsible_party, auth.uid())
    OR EXISTS (SELECT 1 FROM public.print_task_access(print_tasks.booking_id, auth.uid()) a WHERE a.is_agency)
  )
  WITH CHECK (
    auth_role() = 'admin'
    OR public.print_task_can_advance(booking_id, responsible_party, auth.uid())
    OR EXISTS (SELECT 1 FROM public.print_task_access(booking_id, auth.uid()) a WHERE a.is_agency)
  );

-- print_tasks_delete (admin only) is unchanged from 030.
