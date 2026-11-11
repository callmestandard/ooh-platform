-- ═══════════════════════════════════════════════════════════════════
-- OOH Platform — owner approval before boards show as "Partner verified"
-- Run in Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- Requires 042 (guard_board_verification). Safe to re-run.
--
-- Until now any account that signed up as a media owner (CAC optional)
-- could post or import boards and have them show as "Partner verified"
-- straight away. Now:
--   • owner_approvals lists owner companies our team has checked.
--   • A board an owner's team adds starts 'partner_verified' only if that
--     owner is approved; otherwise it starts 'pending'.
--   • set_owner_approval(owner, true) (admins only) approves the owner and
--     moves their pending boards to 'partner_verified'; false reverses it.
--   • Claim approval (an admin giving an unowned board to an owner) still
--     makes the board partner_verified: the admin checked that claim.
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.owner_approvals (
  owner_id    UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  approved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL
);

ALTER TABLE public.owner_approvals ENABLE ROW LEVEL SECURITY;

-- Admins see all; an owner's team sees its own row. No write policies:
-- changes go through set_owner_approval() only.
DROP POLICY IF EXISTS owner_approvals_select ON public.owner_approvals;
CREATE POLICY owner_approvals_select ON public.owner_approvals FOR SELECT USING (
  public.auth_role() = 'admin'
  OR COALESCE(public.is_owner_member(owner_id, auth.uid()), false)
);

GRANT SELECT ON public.owner_approvals TO authenticated;

CREATE OR REPLACE FUNCTION public.owner_is_approved(p_owner UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.owner_approvals WHERE owner_id = p_owner);
$$;

-- ── Guard (042, with the approval check on insert) ───────────────────────
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
      IF v_team AND public.owner_is_approved(NEW.owner_id) THEN
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
    NEW.last_verified_at := NOW();
  END IF;

  IF NEW.verification_status IS NOT DISTINCT FROM OLD.verification_status THEN
    IF OLD.owner_id IS NULL AND NEW.owner_id IS NOT NULL THEN
      NEW.verification_status := 'partner_verified';
      NEW.last_verified_at    := NOW();
    ELSIF OLD.owner_id IS NOT NULL AND NEW.owner_id IS NULL AND OLD.verification_status = 'partner_verified' THEN
      NEW.verification_status := 'pending';
    END IF;
  END IF;

  IF v_team AND NEW.verification_status = 'partner_verified' THEN
    NEW.last_verified_at := NOW();
  END IF;

  RETURN NEW;
END;
$$;

-- ── Approve / un-approve (admins only) ───────────────────────────────────
-- Returns how many boards changed verification.
CREATE OR REPLACE FUNCTION public.set_owner_approval(p_owner UUID, p_approved BOOLEAN)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_count INTEGER;
BEGIN
  IF public.auth_role() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Only an admin can approve owners' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_owner AND role = 'owner') THEN
    RAISE EXCEPTION 'That account is not a media owner';
  END IF;

  IF p_approved THEN
    INSERT INTO public.owner_approvals (owner_id, approved_by) VALUES (p_owner, auth.uid())
      ON CONFLICT (owner_id) DO NOTHING;
    UPDATE public.boards SET verification_status = 'partner_verified', last_verified_at = NOW()
     WHERE owner_id = p_owner AND verification_status = 'pending';
  ELSE
    DELETE FROM public.owner_approvals WHERE owner_id = p_owner;
    UPDATE public.boards SET verification_status = 'pending', last_verified_at = NULL
     WHERE owner_id = p_owner AND verification_status = 'partner_verified';
  END IF;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.set_owner_approval(UUID, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_owner_approval(UUID, BOOLEAN) TO authenticated;

-- ── Backfill ─────────────────────────────────────────────────────────────
-- Owners whose boards are already partner verified keep that status.
INSERT INTO public.owner_approvals (owner_id)
SELECT DISTINCT b.owner_id FROM public.boards b
  JOIN public.profiles p ON p.id = b.owner_id AND p.role = 'owner'
 WHERE b.verification_status = 'partner_verified'
ON CONFLICT (owner_id) DO NOTHING;
