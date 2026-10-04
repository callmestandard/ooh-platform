-- ═══════════════════════════════════════════════════════════════════
-- OOH Platform — owner side: teams & marketers, private rate cards,
-- request routing, deal attribution, targets, share links, import mappings
-- Run in Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- Requires 030 (board_owner_match), 032, 034 (board_owner_account).
-- Safe to re-run: IF NOT EXISTS / CREATE OR REPLACE / DROP POLICY IF EXISTS.
--
-- Design notes
-- • A "marketer" is an employee of ONE owner company with their own login
--   (profiles.role = 'marketer'). They never act as agents and never set a
--   markup — independent resellers stay on the agent model (024).
-- • Rates are private by default. Postgres RLS is row-level, and boards is
--   world-readable, so the rate cannot live on the boards row: it moves to
--   board_rates (and the owner's floor to board_rate_floors), each with its
--   own RLS. boards.asking_rate / boards.rate_card are kept as write-only
--   inboxes — whatever an authorised writer puts there is moved across and
--   the public columns are blanked by a trigger — so existing forms keep
--   working and no query on boards can ever return a rate.
-- • Cross-table checks go through SECURITY DEFINER helpers (a subquery in
--   a policy runs under the caller's own RLS — the bug fixed in 032).
-- ═══════════════════════════════════════════════════════════════════

-- ── 0. Roles ─────────────────────────────────────────────────────────────

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('agency','client','owner','admin','agent','marketer'));

ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_recipient_role_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_recipient_role_check
  CHECK (recipient_role IN ('agency','client','owner','admin','agent','marketer'));

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS default_rate_visibility TEXT NOT NULL DEFAULT 'hidden'
    CHECK (default_rate_visibility IN ('hidden','approved_agencies','all_verified_agencies'));

-- ── 1. Team ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.owner_team_members (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id            UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- one person belongs to at most one owner company
  member_profile_id   UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  member_name         TEXT,
  role                TEXT NOT NULL DEFAULT 'marketer' CHECK (role IN ('admin','marketer')),
  active              BOOLEAN NOT NULL DEFAULT true,
  can_see_floor_rates BOOLEAN NOT NULL DEFAULT false,
  -- recorded for the owner's own reference only; nothing is ever paid out
  commission_rate     NUMERIC CHECK (commission_rate IS NULL OR (commission_rate >= 0 AND commission_rate <= 100)),
  -- cities this marketer covers; used when a board has no named marketer
  territory_cities    TEXT[] NOT NULL DEFAULT '{}',
  invited_email       TEXT,
  invited_phone       TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (member_profile_id <> owner_id)
);
CREATE INDEX IF NOT EXISTS idx_owner_team_owner ON public.owner_team_members(owner_id);

-- "Verified owner company" / "verified agency": the account has filed both
-- its CAC and TIN numbers (partner_kyc) and is not suspended. There is no
-- separate approval flag in the schema today.
CREATE OR REPLACE FUNCTION public.is_verified_company(p_uid UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.partner_kyc k JOIN public.profiles p ON p.id = k.id
    WHERE k.id = p_uid
      AND COALESCE(trim(k.cac_number), '') <> '' AND COALESCE(trim(k.tin_number), '') <> ''
      AND COALESCE(p.is_suspended, false) = false
  );
$$;

-- The owner company a user acts for: themselves if they are an owner,
-- otherwise the company they are an ACTIVE team member of.
CREATE OR REPLACE FUNCTION public.owner_company_of(p_uid UUID)
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT p.id FROM public.profiles p WHERE p.id = p_uid AND p.role = 'owner'),
    (SELECT m.owner_id FROM public.owner_team_members m WHERE m.member_profile_id = p_uid AND m.active)
  );
$$;

CREATE OR REPLACE FUNCTION public.is_owner_admin(p_owner_id UUID, p_uid UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p_owner_id IS NOT NULL AND p_uid IS NOT NULL AND (
    p_owner_id = p_uid
    OR EXISTS (SELECT 1 FROM public.owner_team_members m
               WHERE m.owner_id = p_owner_id AND m.member_profile_id = p_uid AND m.active AND m.role = 'admin')
  );
$$;

CREATE OR REPLACE FUNCTION public.is_owner_member(p_owner_id UUID, p_uid UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p_owner_id IS NOT NULL AND p_uid IS NOT NULL AND (
    p_owner_id = p_uid
    OR EXISTS (SELECT 1 FROM public.owner_team_members m
               WHERE m.owner_id = p_owner_id AND m.member_profile_id = p_uid AND m.active)
  );
$$;

-- The signed-in user's own company and standing in it (marketers cannot read
-- the owner's profile row, so the name comes from here).
CREATE OR REPLACE FUNCTION public.my_owner_company()
RETURNS TABLE (owner_id UUID, company_name TEXT, team_role TEXT, can_see_floor_rates BOOLEAN, verified BOOLEAN)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id, COALESCE(p.company_name, p.full_name),
         CASE WHEN p.id = auth.uid() THEN 'owner' ELSE m.role END,
         p.id = auth.uid() OR COALESCE(m.role = 'admin', false) OR COALESCE(m.can_see_floor_rates, false),
         public.is_verified_company(p.id)
  FROM public.profiles p
  LEFT JOIN public.owner_team_members m ON m.owner_id = p.id AND m.member_profile_id = auth.uid() AND m.active
  WHERE p.id = public.owner_company_of(auth.uid());
$$;

-- Team rows may only be created for a verified owner company, and a member
-- can never be moved to a different company.
CREATE OR REPLACE FUNCTION public.guard_owner_team_member()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = NEW.owner_id AND role = 'owner') THEN
      RAISE EXCEPTION 'team members can only be added to an owner account';
    END IF;
    IF NOT public.is_verified_company(NEW.owner_id) THEN
      RAISE EXCEPTION 'the owner company must have its CAC and TIN on file before adding team members';
    END IF;
  ELSIF NEW.owner_id IS DISTINCT FROM OLD.owner_id OR NEW.member_profile_id IS DISTINCT FROM OLD.member_profile_id THEN
    RAISE EXCEPTION 'a team member cannot be moved to another company or person';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS owner_team_members_guard ON public.owner_team_members;
CREATE TRIGGER owner_team_members_guard BEFORE INSERT OR UPDATE ON public.owner_team_members
  FOR EACH ROW EXECUTE FUNCTION public.guard_owner_team_member();

ALTER TABLE public.owner_team_members ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "owner_team_select" ON public.owner_team_members;
DROP POLICY IF EXISTS "owner_team_update" ON public.owner_team_members;
DROP POLICY IF EXISTS "owner_team_delete" ON public.owner_team_members;
-- A member sees their own row; owner admins see the whole team. Rows are
-- created only by the invite route (service role), so there is no INSERT policy.
CREATE POLICY "owner_team_select" ON public.owner_team_members FOR SELECT USING (
  member_profile_id = auth.uid() OR public.is_owner_admin(owner_id, auth.uid()) OR auth_role() = 'admin'
);
CREATE POLICY "owner_team_update" ON public.owner_team_members FOR UPDATE
  USING (public.is_owner_admin(owner_id, auth.uid())) WITH CHECK (public.is_owner_admin(owner_id, auth.uid()));
CREATE POLICY "owner_team_delete" ON public.owner_team_members FOR DELETE
  USING (public.is_owner_admin(owner_id, auth.uid()));

-- ── 2. Boards: who created it, who sells it, who may see its rate ───────

ALTER TABLE public.boards
  ADD COLUMN IF NOT EXISTS created_by            UUID DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_marketer_id  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  -- NULL = follow the owner's profiles.default_rate_visibility
  ADD COLUMN IF NOT EXISTS rate_visibility       TEXT CHECK (rate_visibility IN ('hidden','approved_agencies','all_verified_agencies'));

-- The person requests for a board go to: the named marketer if still an
-- active member; else an active marketer whose territory covers the board's
-- city; else the owner account. A deactivated marketer therefore loses the
-- board immediately and nothing is orphaned.
CREATE OR REPLACE FUNCTION public.board_assignee(p_board_id UUID)
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH b AS (
    SELECT id, city, assigned_marketer_id, public.board_owner_account(id) AS owner_id
    FROM public.boards WHERE id = p_board_id
  )
  SELECT COALESCE(
    (SELECT m.member_profile_id FROM public.owner_team_members m, b
      WHERE m.member_profile_id = b.assigned_marketer_id AND m.owner_id = b.owner_id AND m.active),
    (SELECT m.member_profile_id FROM public.owner_team_members m, b
      WHERE m.owner_id = b.owner_id AND m.active AND m.role = 'marketer' AND b.city IS NOT NULL
        AND lower(trim(b.city)) IN (SELECT lower(trim(c)) FROM unnest(m.territory_cities) c)
      ORDER BY m.created_at LIMIT 1),
    (SELECT owner_id FROM b)
  );
$$;

-- May this user handle requests / deals for this board? The owner account,
-- any owner admin, or the board's current assignee.
CREATE OR REPLACE FUNCTION public.board_team_match(p_board_id UUID, p_uid UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p_uid IS NOT NULL AND (
    public.is_owner_admin(public.board_owner_account(p_board_id), p_uid)
    OR public.board_assignee(p_board_id) = p_uid
  );
$$;

-- Boards a team may write: owner admins manage every board of the company;
-- a marketer may add boards for the company and edit the ones assigned to them.
DROP POLICY IF EXISTS "boards_insert_team" ON public.boards;
DROP POLICY IF EXISTS "boards_update_team" ON public.boards;
DROP POLICY IF EXISTS "boards_delete_team" ON public.boards;
CREATE POLICY "boards_insert_team" ON public.boards FOR INSERT WITH CHECK (
  owner_id IS NOT NULL AND public.is_owner_member(owner_id, auth.uid())
);
CREATE POLICY "boards_update_team" ON public.boards FOR UPDATE
  USING (public.is_owner_admin(owner_id, auth.uid()) OR (public.is_owner_member(owner_id, auth.uid()) AND assigned_marketer_id = auth.uid()))
  WITH CHECK (public.is_owner_member(owner_id, auth.uid()));
CREATE POLICY "boards_delete_team" ON public.boards FOR DELETE
  USING (public.is_owner_admin(owner_id, auth.uid()));

CREATE OR REPLACE FUNCTION public.guard_board_team_fields()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL OR auth_role() = 'admin' THEN RETURN NEW; END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.created_by := v_uid;
    -- a marketer adding a board on site keeps it; nobody else may pre-assign
    IF NEW.owner_id IS NOT NULL AND NOT public.is_owner_admin(NEW.owner_id, v_uid) THEN
      NEW.assigned_marketer_id := CASE WHEN public.is_owner_member(NEW.owner_id, v_uid) THEN v_uid ELSE NULL END;
      NEW.rate_visibility := NULL;
    END IF;
    RETURN NEW;
  END IF;

  NEW.created_by := OLD.created_by;
  -- Ownership changes only by the current owner company's admins, or by
  -- decide_board_claim() (which sets the app.board_claim flag for its own update).
  IF NEW.owner_id IS DISTINCT FROM OLD.owner_id
     AND NOT public.is_owner_admin(OLD.owner_id, v_uid)
     AND COALESCE(current_setting('app.board_claim', true), '') <> 'on' THEN
    RAISE EXCEPTION 'a board''s owner can only be changed by the owner, an admin, or an approved claim';
  END IF;
  IF NOT public.is_owner_admin(OLD.owner_id, v_uid) THEN
    IF NEW.assigned_marketer_id IS DISTINCT FROM OLD.assigned_marketer_id THEN
      RAISE EXCEPTION 'only the owner or an owner admin can assign a board to a marketer';
    END IF;
    IF NEW.rate_visibility IS DISTINCT FROM OLD.rate_visibility THEN
      RAISE EXCEPTION 'only the owner or an owner admin can change who may see a board''s rate';
    END IF;
  END IF;
  IF NEW.assigned_marketer_id IS NOT NULL
     AND NOT public.is_owner_member(COALESCE(NEW.owner_id, public.board_owner_account(NEW.id)), NEW.assigned_marketer_id) THEN
    RAISE EXCEPTION 'a board can only be assigned to an active member of its owner company';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS boards_guard_team_fields ON public.boards;
CREATE TRIGGER boards_guard_team_fields BEFORE INSERT OR UPDATE ON public.boards
  FOR EACH ROW EXECUTE FUNCTION public.guard_board_team_fields();

-- ── 3. Rate cards (private) ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.board_rates (
  board_id           UUID PRIMARY KEY REFERENCES public.boards(id) ON DELETE CASCADE,
  gross_monthly_rate NUMERIC CHECK (gross_monthly_rate IS NULL OR gross_monthly_rate >= 0),
  gross_annual_rate  NUMERIC CHECK (gross_annual_rate IS NULL OR gross_annual_rate >= 0),
  -- production (print/install) is charged separately from rental
  production_cost    NUMERIC CHECK (production_cost IS NULL OR production_cost >= 0),
  -- the pre-existing boards.rate_card JSONB (seasonal multipliers, duration discounts)
  seasonal           JSONB,
  updated_by         UUID,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The owner's floor, kept in its own table because a marketer may see the
-- gross rate without being allowed to see how far the owner will go.
CREATE TABLE IF NOT EXISTS public.board_rate_floors (
  board_id         UUID PRIMARY KEY REFERENCES public.boards(id) ON DELETE CASCADE,
  max_discount_pct NUMERIC NOT NULL CHECK (max_discount_pct >= 0 AND max_discount_pct <= 100),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.owner_approved_agencies (
  owner_id   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  agency_id  UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (owner_id, agency_id)
);

-- Date ranges an owner has blocked by hand (deals done off-platform).
-- Platform bookings are read from bookings; this is only the manual part.
CREATE TABLE IF NOT EXISTS public.board_booked_ranges (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id   UUID NOT NULL REFERENCES public.boards(id) ON DELETE CASCADE,
  start_date DATE NOT NULL,
  end_date   DATE NOT NULL CHECK (end_date >= start_date),
  note       TEXT,
  created_by UUID DEFAULT auth.uid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_board_booked_ranges_board ON public.board_booked_ranges(board_id);

CREATE OR REPLACE FUNCTION public.board_effective_rate_visibility(p_board_id UUID)
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    b.rate_visibility,
    (SELECT p.default_rate_visibility FROM public.profiles p WHERE p.id = public.board_owner_account(b.id)),
    'hidden')
  FROM public.boards b WHERE b.id = p_board_id;
$$;

-- Who manages a board's rate card: the owner company's admins; or, while a
-- board has no owner account at all, whoever registered it (agency-assisted
-- entry / an agent's listing).
CREATE OR REPLACE FUNCTION public.can_manage_board_rate(p_board_id UUID, p_uid UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p_uid IS NOT NULL AND (
    public.is_owner_admin(public.board_owner_account(p_board_id), p_uid)
    OR (public.board_owner_account(p_board_id) IS NULL
        AND EXISTS (SELECT 1 FROM public.boards b WHERE b.id = p_board_id AND b.created_by = p_uid))
  );
$$;

CREATE OR REPLACE FUNCTION public.can_see_board_rate(p_board_id UUID, p_uid UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p_uid IS NOT NULL AND (
    public.can_manage_board_rate(p_board_id, p_uid)
    -- the owner's own sales team needs the gross rate to sell
    OR public.is_owner_member(public.board_owner_account(p_board_id), p_uid)
    OR (
      EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_uid AND p.role = 'agency')
      AND CASE public.board_effective_rate_visibility(p_board_id)
        WHEN 'all_verified_agencies' THEN public.is_verified_company(p_uid)
        WHEN 'approved_agencies' THEN EXISTS (
          SELECT 1 FROM public.owner_approved_agencies a
          WHERE a.owner_id = public.board_owner_account(p_board_id) AND a.agency_id = p_uid)
        ELSE false
      END
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.can_see_board_floor(p_board_id UUID, p_uid UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p_uid IS NOT NULL AND (
    public.can_manage_board_rate(p_board_id, p_uid)
    OR EXISTS (
      SELECT 1 FROM public.owner_team_members m
      WHERE m.owner_id = public.board_owner_account(p_board_id)
        AND m.member_profile_id = p_uid AND m.active AND m.can_see_floor_rates)
  );
$$;

ALTER TABLE public.board_rates             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.board_rate_floors       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.owner_approved_agencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.board_booked_ranges     ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "board_rates_select" ON public.board_rates;
DROP POLICY IF EXISTS "board_rates_write"  ON public.board_rates;
CREATE POLICY "board_rates_select" ON public.board_rates FOR SELECT USING (
  public.can_see_board_rate(board_id, auth.uid()) OR auth_role() = 'admin'
);
CREATE POLICY "board_rates_write" ON public.board_rates FOR ALL
  USING (public.can_manage_board_rate(board_id, auth.uid()) OR auth_role() = 'admin')
  WITH CHECK (public.can_manage_board_rate(board_id, auth.uid()) OR auth_role() = 'admin');

DROP POLICY IF EXISTS "board_rate_floors_select" ON public.board_rate_floors;
DROP POLICY IF EXISTS "board_rate_floors_write"  ON public.board_rate_floors;
CREATE POLICY "board_rate_floors_select" ON public.board_rate_floors FOR SELECT USING (
  public.can_see_board_floor(board_id, auth.uid()) OR auth_role() = 'admin'
);
CREATE POLICY "board_rate_floors_write" ON public.board_rate_floors FOR ALL
  USING (public.can_manage_board_rate(board_id, auth.uid()) OR auth_role() = 'admin')
  WITH CHECK (public.can_manage_board_rate(board_id, auth.uid()) OR auth_role() = 'admin');

DROP POLICY IF EXISTS "approved_agencies_select" ON public.owner_approved_agencies;
DROP POLICY IF EXISTS "approved_agencies_write"  ON public.owner_approved_agencies;
CREATE POLICY "approved_agencies_select" ON public.owner_approved_agencies FOR SELECT USING (
  agency_id = auth.uid() OR public.is_owner_admin(owner_id, auth.uid()) OR auth_role() = 'admin'
);
CREATE POLICY "approved_agencies_write" ON public.owner_approved_agencies FOR ALL
  USING (public.is_owner_admin(owner_id, auth.uid())) WITH CHECK (public.is_owner_admin(owner_id, auth.uid()));

-- Booked ranges are availability, not price — any signed-in user may read them.
DROP POLICY IF EXISTS "booked_ranges_select" ON public.board_booked_ranges;
DROP POLICY IF EXISTS "booked_ranges_write"  ON public.board_booked_ranges;
CREATE POLICY "booked_ranges_select" ON public.board_booked_ranges FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "booked_ranges_write" ON public.board_booked_ranges FOR ALL
  USING (public.board_team_match(board_id, auth.uid()) OR public.can_manage_board_rate(board_id, auth.uid()))
  WITH CHECK (public.board_team_match(board_id, auth.uid()) OR public.can_manage_board_rate(board_id, auth.uid()));

-- Move anything written to boards.asking_rate / rate_card into the private
-- tables and blank the public columns. Writers who may not manage the rate
-- (e.g. another agency editing the board) have their value discarded.
CREATE OR REPLACE FUNCTION public.move_board_rate_to_private()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_allowed BOOLEAN;
BEGIN
  IF NEW.asking_rate IS NULL AND NEW.rate_card IS NULL THEN RETURN NULL; END IF;

  v_allowed := v_uid IS NULL OR auth_role() = 'admin' OR public.can_manage_board_rate(NEW.id, v_uid)
               -- a marketer adding a board on site may record its rate once
               OR (TG_OP = 'INSERT' AND public.is_owner_member(NEW.owner_id, v_uid));
  IF v_allowed THEN
    INSERT INTO public.board_rates (board_id, gross_monthly_rate, seasonal, updated_by)
    VALUES (NEW.id, NEW.asking_rate, NEW.rate_card, v_uid)
    ON CONFLICT (board_id) DO UPDATE SET
      gross_monthly_rate = COALESCE(EXCLUDED.gross_monthly_rate, public.board_rates.gross_monthly_rate),
      seasonal           = COALESCE(EXCLUDED.seasonal, public.board_rates.seasonal),
      updated_by         = EXCLUDED.updated_by,
      updated_at         = NOW();
  END IF;

  UPDATE public.boards SET asking_rate = NULL, rate_card = NULL WHERE id = NEW.id;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS boards_move_rate_to_private ON public.boards;
CREATE TRIGGER boards_move_rate_to_private AFTER INSERT OR UPDATE OF asking_rate, rate_card ON public.boards
  FOR EACH ROW EXECUTE FUNCTION public.move_board_rate_to_private();

-- Carry over any rates already sitting on boards (the trigger does the move).
UPDATE public.boards SET asking_rate = asking_rate WHERE asking_rate IS NOT NULL OR rate_card IS NOT NULL;

-- ── 4. Bookings: routing, attribution ────────────────────────────────────

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS closed_by_marketer_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS confirmed_at          TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_bookings_closed_by ON public.bookings(closed_by_marketer_id) WHERE closed_by_marketer_id IS NOT NULL;

-- Additional (permissive) policies: the owner's team reaches the bookings
-- and negotiation messages of boards it handles. Existing policies are untouched.
DROP POLICY IF EXISTS "bookings_select_owner_team" ON public.bookings;
DROP POLICY IF EXISTS "bookings_update_owner_team" ON public.bookings;
CREATE POLICY "bookings_select_owner_team" ON public.bookings FOR SELECT USING (public.board_team_match(board_id, auth.uid()));
CREATE POLICY "bookings_update_owner_team" ON public.bookings FOR UPDATE
  USING (public.board_team_match(board_id, auth.uid())) WITH CHECK (public.board_team_match(board_id, auth.uid()));

-- A marketer keeps sight of deals they closed even if the board is later reassigned.
DROP POLICY IF EXISTS "bookings_select_closed_by" ON public.bookings;
CREATE POLICY "bookings_select_closed_by" ON public.bookings FOR SELECT USING (closed_by_marketer_id = auth.uid());

CREATE OR REPLACE FUNCTION public.booking_team_match(p_booking_id UUID, p_uid UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.bookings b WHERE b.id = p_booking_id AND public.board_team_match(b.board_id, p_uid));
$$;
DROP POLICY IF EXISTS "messages_select_owner_team" ON public.messages;
DROP POLICY IF EXISTS "messages_insert_owner_team" ON public.messages;
CREATE POLICY "messages_select_owner_team" ON public.messages FOR SELECT USING (public.booking_team_match(booking_id, auth.uid()));
CREATE POLICY "messages_insert_owner_team" ON public.messages FOR INSERT WITH CHECK (public.booking_team_match(booking_id, auth.uid()));

-- Credit for a deal goes to the marketer who confirmed it, or — when the
-- owner or the agency did — to the board's assigned marketer. Set once, at
-- the moment the booking first becomes agreed/signed, and never from client input.
CREATE OR REPLACE FUNCTION public.attribute_booking_to_marketer()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_owner UUID;
  v_assignee UUID;
  v_was_confirmed BOOLEAN := TG_OP = 'UPDATE' AND OLD.status IN ('agreed','signed','live','completed');
BEGIN
  IF TG_OP = 'UPDATE' AND auth.uid() IS NOT NULL AND auth_role() <> 'admin' THEN
    NEW.closed_by_marketer_id := OLD.closed_by_marketer_id;
    NEW.confirmed_at := OLD.confirmed_at;
  ELSIF TG_OP = 'INSERT' AND auth.uid() IS NOT NULL AND auth_role() <> 'admin' THEN
    NEW.closed_by_marketer_id := NULL;
    NEW.confirmed_at := NULL;
  END IF;

  IF NEW.status IN ('agreed','signed','live','completed') AND NOT v_was_confirmed AND NEW.confirmed_at IS NULL THEN
    NEW.confirmed_at := NOW();
    v_owner := public.board_owner_account(NEW.board_id);
    v_assignee := public.board_assignee(NEW.board_id);
    IF v_uid IS NOT NULL AND EXISTS (SELECT 1 FROM public.owner_team_members m
          WHERE m.owner_id = v_owner AND m.member_profile_id = v_uid AND m.active AND m.role = 'marketer') THEN
      NEW.closed_by_marketer_id := v_uid;
    ELSIF v_assignee IS NOT NULL AND v_assignee <> v_owner AND EXISTS (SELECT 1 FROM public.owner_team_members m
          WHERE m.owner_id = v_owner AND m.member_profile_id = v_assignee AND m.active AND m.role = 'marketer') THEN
      NEW.closed_by_marketer_id := v_assignee;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS bookings_attribute_marketer ON public.bookings;
CREATE TRIGGER bookings_attribute_marketer BEFORE INSERT OR UPDATE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.attribute_booking_to_marketer();

-- Tell the right person when an agency sends a booking request for a board.
CREATE OR REPLACE FUNCTION public.notify_booking_assignee()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_owner UUID := public.board_owner_account(NEW.board_id);
  v_assignee UUID := public.board_assignee(NEW.board_id);
  v_board TEXT;
BEGIN
  IF v_assignee IS NULL OR v_assignee = v_owner THEN RETURN NEW; END IF; -- owner-handled boards keep the existing notifications
  SELECT name INTO v_board FROM public.boards WHERE id = NEW.board_id;
  INSERT INTO public.notifications (recipient_role, recipient_user_id, type, title, body, link)
  VALUES ('marketer', v_assignee, 'new_booking', 'New booking request', COALESCE(v_board, 'A board') || ' — assigned to you', '/dashboard/marketer');
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS bookings_notify_assignee ON public.bookings;
CREATE TRIGGER bookings_notify_assignee AFTER INSERT ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.notify_booking_assignee();

-- ── 5. Availability requests (034): route to the team ────────────────────
-- Recipient rows stay keyed by the owner COMPANY. An owner admin sees and
-- answers everything; a marketer sees the request if any matching board is
-- theirs, and answers only for their own boards.

CREATE OR REPLACE FUNCTION public.is_availability_recipient(p_request_id UUID, p_uid UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.availability_request_recipients r
    WHERE r.request_id = p_request_id AND (
      r.owner_id = p_uid
      OR public.is_owner_admin(r.owner_id, p_uid)
      OR (public.is_owner_member(r.owner_id, p_uid) AND EXISTS (
            SELECT 1 FROM public.boards b
            WHERE public.board_owner_account(b.id) = r.owner_id
              AND public.board_matches_availability_request(b.id, p_request_id)
              AND public.board_assignee(b.id) = p_uid))
    )
  );
$$;

DROP POLICY IF EXISTS "avail_recipients_select" ON public.availability_request_recipients;
CREATE POLICY "avail_recipients_select" ON public.availability_request_recipients FOR SELECT USING (
  owner_id = auth.uid()
  OR (public.is_owner_member(owner_id, auth.uid()) AND public.is_availability_recipient(request_id, auth.uid()))
  OR public.availability_request_agency(request_id) = auth.uid()
  OR auth_role() = 'admin'
);

DROP POLICY IF EXISTS "avail_responses_select" ON public.availability_responses;
DROP POLICY IF EXISTS "avail_responses_insert" ON public.availability_responses;
DROP POLICY IF EXISTS "avail_responses_update" ON public.availability_responses;
DROP POLICY IF EXISTS "avail_responses_delete" ON public.availability_responses;
CREATE POLICY "avail_responses_select" ON public.availability_responses FOR SELECT USING (
  owner_id = auth.uid()
  OR (owner_id = public.owner_company_of(auth.uid()) AND public.board_team_match(board_id, auth.uid()))
  OR public.availability_request_agency(request_id) = auth.uid()
  OR auth_role() = 'admin'
);
-- owner_id is always the owner COMPANY, whoever on the team answers.
CREATE POLICY "avail_responses_insert" ON public.availability_responses FOR INSERT WITH CHECK (
  owner_id = public.owner_company_of(auth.uid())
  AND public.board_owner_account(board_id) = owner_id
  AND public.board_team_match(board_id, auth.uid())
  AND public.is_availability_recipient(request_id, auth.uid())
  AND public.board_matches_availability_request(board_id, request_id)
);
CREATE POLICY "avail_responses_update" ON public.availability_responses FOR UPDATE
  USING ((owner_id = public.owner_company_of(auth.uid()) AND public.board_team_match(board_id, auth.uid()))
         OR public.availability_request_agency(request_id) = auth.uid())
  WITH CHECK ((owner_id = public.owner_company_of(auth.uid()) AND public.board_team_match(board_id, auth.uid()))
         OR public.availability_request_agency(request_id) = auth.uid());
CREATE POLICY "avail_responses_delete" ON public.availability_responses FOR DELETE
  USING (owner_id = public.owner_company_of(auth.uid()) AND public.board_team_match(board_id, auth.uid()) AND accepted_booking_id IS NULL);

-- Also notify each marketer who has a matching board when a request is sent.
CREATE OR REPLACE FUNCTION public.notify_availability_assignees()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.notifications (recipient_role, recipient_user_id, type, title, body, link)
  SELECT DISTINCT 'marketer', public.board_assignee(b.id), 'availability_request',
         'Availability request for your boards', r.title, '/dashboard/owner/availability-requests'
  FROM public.availability_requests r, public.boards b
  WHERE r.id = NEW.request_id
    AND public.board_owner_account(b.id) = NEW.owner_id
    AND public.board_matches_availability_request(b.id, NEW.request_id)
    AND public.board_assignee(b.id) <> NEW.owner_id;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS avail_recipients_notify_assignees ON public.availability_request_recipients;
CREATE TRIGGER avail_recipients_notify_assignees AFTER INSERT ON public.availability_request_recipients
  FOR EACH ROW EXECUTE FUNCTION public.notify_availability_assignees();

-- ── 6. Targets ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.marketer_targets (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  marketer_id  UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  period_start DATE NOT NULL,
  period_end   DATE NOT NULL CHECK (period_end >= period_start),
  target_value NUMERIC NOT NULL DEFAULT 0 CHECK (target_value >= 0),
  target_count INTEGER NOT NULL DEFAULT 0 CHECK (target_count >= 0),
  created_by   UUID DEFAULT auth.uid(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (marketer_id, period_start, period_end)
);
ALTER TABLE public.marketer_targets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "marketer_targets_select" ON public.marketer_targets;
DROP POLICY IF EXISTS "marketer_targets_write"  ON public.marketer_targets;
CREATE POLICY "marketer_targets_select" ON public.marketer_targets FOR SELECT USING (
  marketer_id = auth.uid() OR public.is_owner_admin(owner_id, auth.uid()) OR auth_role() = 'admin'
);
CREATE POLICY "marketer_targets_write" ON public.marketer_targets FOR ALL
  USING (public.is_owner_admin(owner_id, auth.uid()))
  WITH CHECK (public.is_owner_admin(owner_id, auth.uid()) AND public.is_owner_member(owner_id, marketer_id));

-- ── 7. Quick-share availability links ────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.board_share_links (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 32 random bytes, hex — generated server-side, never guessable
  token          TEXT NOT NULL UNIQUE DEFAULT encode(extensions.gen_random_bytes(32), 'hex'),
  owner_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_by     UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  title          TEXT,
  board_ids      UUID[] NOT NULL CHECK (cardinality(board_ids) BETWEEN 1 AND 50),
  expires_at     TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '7 days',
  revoked_at     TIMESTAMPTZ,
  open_count     INTEGER NOT NULL DEFAULT 0,
  last_opened_at TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- A link may only contain boards its creator handles.
CREATE OR REPLACE FUNCTION public.guard_board_share_link()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_bad INT;
BEGIN
  IF v_uid IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.created_by := v_uid;
    NEW.owner_id := public.owner_company_of(v_uid);
    NEW.open_count := 0; NEW.last_opened_at := NULL; NEW.revoked_at := NULL;
    NEW.token := encode(extensions.gen_random_bytes(32), 'hex');
    IF NEW.owner_id IS NULL THEN RAISE EXCEPTION 'only an owner or an owner''s team member can create a share link'; END IF;
  ELSE
    IF NEW.token IS DISTINCT FROM OLD.token OR NEW.owner_id IS DISTINCT FROM OLD.owner_id OR NEW.created_by IS DISTINCT FROM OLD.created_by
       OR NEW.open_count IS DISTINCT FROM OLD.open_count OR NEW.last_opened_at IS DISTINCT FROM OLD.last_opened_at THEN
      RAISE EXCEPTION 'only the title, boards, expiry and revocation of a share link can be changed';
    END IF;
  END IF;
  SELECT COUNT(*) INTO v_bad FROM unnest(NEW.board_ids) bid
   WHERE public.board_owner_account(bid) IS DISTINCT FROM NEW.owner_id OR NOT public.board_team_match(bid, v_uid);
  IF v_bad > 0 THEN RAISE EXCEPTION 'a share link can only include boards you handle'; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS board_share_links_guard ON public.board_share_links;
CREATE TRIGGER board_share_links_guard BEFORE INSERT OR UPDATE ON public.board_share_links
  FOR EACH ROW EXECUTE FUNCTION public.guard_board_share_link();

-- Leads from the "Request this board" button on a share link. Written only
-- by the public route (service role).
CREATE TABLE IF NOT EXISTS public.share_link_requests (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  link_id     UUID NOT NULL REFERENCES public.board_share_links(id) ON DELETE CASCADE,
  board_id    UUID NOT NULL REFERENCES public.boards(id) ON DELETE CASCADE,
  owner_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  assignee_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  name        TEXT NOT NULL,
  company     TEXT,
  contact     TEXT NOT NULL,
  message     TEXT,
  status      TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','handled')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.board_share_links   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.share_link_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "share_links_select" ON public.board_share_links;
DROP POLICY IF EXISTS "share_links_insert" ON public.board_share_links;
DROP POLICY IF EXISTS "share_links_update" ON public.board_share_links;
DROP POLICY IF EXISTS "share_links_delete" ON public.board_share_links;
CREATE POLICY "share_links_select" ON public.board_share_links FOR SELECT USING (
  created_by = auth.uid() OR public.is_owner_admin(owner_id, auth.uid()) OR auth_role() = 'admin'
);
CREATE POLICY "share_links_insert" ON public.board_share_links FOR INSERT WITH CHECK (public.owner_company_of(auth.uid()) IS NOT NULL);
CREATE POLICY "share_links_update" ON public.board_share_links FOR UPDATE
  USING (created_by = auth.uid() OR public.is_owner_admin(owner_id, auth.uid()))
  WITH CHECK (created_by = auth.uid() OR public.is_owner_admin(owner_id, auth.uid()));
CREATE POLICY "share_links_delete" ON public.board_share_links FOR DELETE
  USING (created_by = auth.uid() OR public.is_owner_admin(owner_id, auth.uid()));

DROP POLICY IF EXISTS "share_requests_select" ON public.share_link_requests;
DROP POLICY IF EXISTS "share_requests_update" ON public.share_link_requests;
CREATE POLICY "share_requests_select" ON public.share_link_requests FOR SELECT USING (
  public.is_owner_admin(owner_id, auth.uid())
  OR (public.is_owner_member(owner_id, auth.uid()) AND public.board_assignee(board_id) = auth.uid())
  OR auth_role() = 'admin'
);
CREATE POLICY "share_requests_update" ON public.share_link_requests FOR UPDATE
  USING (public.is_owner_admin(owner_id, auth.uid()) OR (public.is_owner_member(owner_id, auth.uid()) AND public.board_assignee(board_id) = auth.uid()))
  WITH CHECK (public.is_owner_admin(owner_id, auth.uid()) OR (public.is_owner_member(owner_id, auth.uid()) AND public.board_assignee(board_id) = auth.uid()));

-- ── 8. Import: remembered column mapping per owner ───────────────────────

CREATE TABLE IF NOT EXISTS public.owner_import_mappings (
  owner_id   UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  -- { "<their column header>": "<platform field>" }
  mapping    JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.owner_import_mappings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "import_mappings_all" ON public.owner_import_mappings;
CREATE POLICY "import_mappings_all" ON public.owner_import_mappings FOR ALL
  USING (public.is_owner_member(owner_id, auth.uid())) WITH CHECK (public.is_owner_member(owner_id, auth.uid()));

-- ── 9. Claims: an owner taking over boards an agency registered for them ─

CREATE TABLE IF NOT EXISTS public.board_claims (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id    UUID NOT NULL REFERENCES public.boards(id) ON DELETE CASCADE,
  claimant_id UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  decided_by  UUID,
  decided_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (board_id, claimant_id)
);
ALTER TABLE public.board_claims ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "board_claims_select" ON public.board_claims;
DROP POLICY IF EXISTS "board_claims_insert" ON public.board_claims;
CREATE POLICY "board_claims_select" ON public.board_claims FOR SELECT USING (
  claimant_id = auth.uid()
  OR EXISTS (SELECT 1 FROM public.boards b WHERE b.id = board_claims.board_id AND b.created_by = auth.uid())
  OR auth_role() = 'admin'
);
-- Only a real owner account, only for a board nobody owns yet.
CREATE POLICY "board_claims_insert" ON public.board_claims FOR INSERT WITH CHECK (
  claimant_id = auth.uid() AND auth_role() = 'owner' AND status = 'pending'
  AND public.board_owner_account(board_id) IS NULL
);

-- Approve/reject: the account that registered the board, or a platform admin.
-- Approval hands the board (and its rate card, via board_owner_account) to the claimant.
CREATE OR REPLACE FUNCTION public.decide_board_claim(p_claim_id UUID, p_approve BOOLEAN)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_claim public.board_claims%ROWTYPE;
  v_uid UUID := auth.uid();
BEGIN
  SELECT * INTO v_claim FROM public.board_claims WHERE id = p_claim_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'claim not found'; END IF;
  IF v_claim.status <> 'pending' THEN RAISE EXCEPTION 'this claim has already been decided'; END IF;
  IF NOT (auth_role() = 'admin' OR EXISTS (SELECT 1 FROM public.boards b WHERE b.id = v_claim.board_id AND b.created_by = v_uid)) THEN
    RAISE EXCEPTION 'only the account that registered this board, or an admin, can decide a claim on it';
  END IF;
  IF p_approve THEN
    IF public.board_owner_account(v_claim.board_id) IS NOT NULL THEN RAISE EXCEPTION 'this board already has an owner'; END IF;
    PERFORM set_config('app.board_claim', 'on', true);
    UPDATE public.boards SET owner_id = v_claim.claimant_id WHERE id = v_claim.board_id;
    PERFORM set_config('app.board_claim', 'off', true);
    UPDATE public.board_claims SET status = 'rejected', decided_by = v_uid, decided_at = NOW()
     WHERE board_id = v_claim.board_id AND id <> p_claim_id AND status = 'pending';
  END IF;
  UPDATE public.board_claims SET status = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END, decided_by = v_uid, decided_at = NOW()
   WHERE id = p_claim_id;
END;
$$;

-- ── 10. Grants ───────────────────────────────────────────────────────────

GRANT SELECT, UPDATE, DELETE ON public.owner_team_members TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.board_rates, public.board_rate_floors, public.owner_approved_agencies,
  public.board_booked_ranges, public.marketer_targets, public.board_share_links, public.owner_import_mappings TO authenticated;
GRANT SELECT, UPDATE ON public.share_link_requests TO authenticated;
GRANT SELECT, INSERT ON public.board_claims TO authenticated;
GRANT EXECUTE ON FUNCTION public.decide_board_claim(UUID, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.board_assignee(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.owner_company_of(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_owner_company() TO authenticated;
