-- ═══════════════════════════════════════════════════════════════════
-- OOH Platform — Agent/Reseller model
-- Run in Supabase SQL Editor (Dashboard → SQL Editor → New query)
--
-- Adds an honest lane for people who broker boards on an owner's behalf
-- and take a markup, instead of forcing them to impersonate the owner.
-- Three new tables (board_authorizations, listings, booking_payouts),
-- widened profiles/notifications role CHECKs to add 'agent', and two
-- trigger functions that do the actual fraud-prevention work at the DB
-- level (not just app-layer validation):
--   1. authorization conflict detection — a second agent claiming a board
--      another agent already actively claims gets flagged 'disputed' on
--      BOTH rows, never silently allowed or silently rejected.
--   2. floor-rate enforcement — a listing's sell_price can never be saved
--      below its authorization's floor_rate, regardless of caller.
-- ═══════════════════════════════════════════════════════════════════

-- ── 0. Widen role vocabulary for the new Agent role ──────────────────────────

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('agency','client','owner','admin','agent'));

ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_recipient_role_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_recipient_role_check
  CHECK (recipient_role IN ('agency','client','owner','admin','agent'));

-- ── 1. board_authorizations ───────────────────────────────────────────────────
-- "agent X is allowed to sell board Y, at or above floor_rate Z"

CREATE TABLE IF NOT EXISTS public.board_authorizations (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id       UUID NOT NULL REFERENCES public.boards(id) ON DELETE CASCADE,
  agent_id       UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  floor_rate     NUMERIC NOT NULL CHECK (floor_rate >= 0),
  -- true only when the real owner is a KYC'd platform user who granted this
  -- themselves; false when the agent self-declared it on behalf of an
  -- owner who isn't on the platform (yet) — this is what the trust badge
  -- on every listing derived from this authorization is built on.
  owner_verified BOOLEAN NOT NULL DEFAULT false,
  owner_id       UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked','disputed')),
  dispute_notes  TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by     UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  CHECK (owner_verified = false OR owner_id IS NOT NULL)
);

-- Hard rule: the same agent can't hold two active authorizations on the
-- same board (duplicate/redundant claims by one party).
CREATE UNIQUE INDEX IF NOT EXISTS board_authorizations_one_active_per_agent
  ON public.board_authorizations (board_id, agent_id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS board_authorizations_board_idx ON public.board_authorizations(board_id);
CREATE INDEX IF NOT EXISTS board_authorizations_agent_idx ON public.board_authorizations(agent_id);
CREATE INDEX IF NOT EXISTS board_authorizations_status_idx ON public.board_authorizations(status);

-- Soft rule: a DIFFERENT agent claiming a board that already has an active
-- claim is never silently allowed (double-listing/fraud risk) and never
-- silently rejected (would hide a real dispute that needs a human to
-- settle who's telling the truth) — both the new and the pre-existing
-- active row flip to 'disputed' for the admin conflict-review screen.
CREATE OR REPLACE FUNCTION public.flag_board_authorization_conflicts()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  conflicting RECORD;
BEGIN
  IF NEW.status = 'active' THEN
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

DROP TRIGGER IF EXISTS board_authorizations_conflict_check ON public.board_authorizations;
CREATE TRIGGER board_authorizations_conflict_check
  BEFORE INSERT OR UPDATE OF status, agent_id, board_id ON public.board_authorizations
  FOR EACH ROW EXECUTE FUNCTION public.flag_board_authorization_conflicts();

-- owner_verified is the entire trust badge system — an agent asserting it
-- themselves would defeat the whole point. It can only ever go from false
-- to true when the actor IS the named owner_id, or is admin; an agent can
-- never set it on creation (forced false below regardless of what they
-- send) or flip it later, no matter what the general UPDATE policy allows.
CREATE OR REPLACE FUNCTION public.guard_owner_verified_transition()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.owner_verified := false;
    RETURN NEW;
  END IF;
  IF NEW.owner_verified IS DISTINCT FROM OLD.owner_verified THEN
    IF NOT (auth_role() = 'admin' OR auth.uid() = NEW.owner_id) THEN
      RAISE EXCEPTION 'only the named owner (or admin) can change owner_verified on authorization %', NEW.id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS board_authorizations_guard_owner_verified ON public.board_authorizations;
CREATE TRIGGER board_authorizations_guard_owner_verified
  BEFORE INSERT OR UPDATE OF owner_verified ON public.board_authorizations
  FOR EACH ROW EXECUTE FUNCTION public.guard_owner_verified_transition();

-- ── 2. listings ────────────────────────────────────────────────────────────
-- The sellable instance of a board: either the verified owner selling
-- directly (agent_id NULL) or an authorized agent reselling with a markup.

CREATE TABLE IF NOT EXISTS public.listings (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id          UUID NOT NULL REFERENCES public.boards(id) ON DELETE CASCADE,
  agent_id          UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  sell_price        NUMERIC NOT NULL CHECK (sell_price >= 0),
  authorization_id  UUID REFERENCES public.board_authorizations(id) ON DELETE RESTRICT,
  status            TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by        UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  -- an agent-run listing must point at the authorization that grants it;
  -- a direct-owner listing has neither
  CHECK ((agent_id IS NULL AND authorization_id IS NULL) OR (agent_id IS NOT NULL AND authorization_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS listings_board_idx ON public.listings(board_id);
CREATE INDEX IF NOT EXISTS listings_agent_idx ON public.listings(agent_id);

-- Server-side floor-rate enforcement — cannot be bypassed by any client,
-- API route, or future code path, since it lives on the write itself.
CREATE OR REPLACE FUNCTION public.enforce_listing_floor_rate()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  auth_row public.board_authorizations%ROWTYPE;
BEGIN
  IF NEW.authorization_id IS NOT NULL THEN
    SELECT * INTO auth_row FROM public.board_authorizations WHERE id = NEW.authorization_id;
    IF auth_row.id IS NULL THEN
      RAISE EXCEPTION 'listing % references a non-existent authorization %', NEW.id, NEW.authorization_id;
    END IF;
    IF auth_row.status <> 'active' THEN
      RAISE EXCEPTION 'authorization % is not active (status=%) — cannot list against it', NEW.authorization_id, auth_row.status;
    END IF;
    IF NEW.agent_id <> auth_row.agent_id THEN
      RAISE EXCEPTION 'listing agent % does not match authorization agent %', NEW.agent_id, auth_row.agent_id;
    END IF;
    IF NEW.board_id <> auth_row.board_id THEN
      RAISE EXCEPTION 'listing board % does not match authorization board %', NEW.board_id, auth_row.board_id;
    END IF;
    IF NEW.sell_price < auth_row.floor_rate THEN
      RAISE EXCEPTION 'sell_price % is below the authorized floor_rate % for board %', NEW.sell_price, auth_row.floor_rate, NEW.board_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS listings_floor_rate_check ON public.listings;
CREATE TRIGGER listings_floor_rate_check
  BEFORE INSERT OR UPDATE OF sell_price, authorization_id, agent_id, board_id ON public.listings
  FOR EACH ROW EXECUTE FUNCTION public.enforce_listing_floor_rate();

-- ── 3. bookings gains an optional link to the listing it came from ───────────
-- Nullable and additive — the existing direct "add board to plan" flow is
-- completely untouched and keeps producing bookings with listing_id NULL.

ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS listing_id UUID REFERENCES public.listings(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS bookings_listing_idx ON public.bookings(listing_id);

-- ── 4. booking_payouts ────────────────────────────────────────────────────────
-- The owner/agent/platform ledger breakdown for a booking made against an
-- agent's listing. One row per booking; recomputed whenever the booking's
-- rate is set or changes. Owner is protected up to floor_rate whenever the
-- actual collected rate supports it; the agent's margin is whatever's left
-- above that (their negotiated discount to close a deal comes out of their
-- own margin, never the owner's guaranteed floor).

CREATE TABLE IF NOT EXISTS public.booking_payouts (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id            UUID NOT NULL UNIQUE REFERENCES public.bookings(id) ON DELETE CASCADE,
  listing_id            UUID NOT NULL REFERENCES public.listings(id) ON DELETE RESTRICT,
  agent_id              UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  owner_id              UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  effective_rate        NUMERIC NOT NULL,
  floor_rate            NUMERIC NOT NULL,
  owner_payout_amount   NUMERIC NOT NULL,
  agent_payout_amount   NUMERIC NOT NULL,
  -- no server-side payout-detail verification exists yet on this platform
  -- (see migration notes / report) — 'pending_verification' is the honest
  -- default until the owner is a verified platform user; ledger only,
  -- no automated payout execution in this pass.
  owner_payout_status   TEXT NOT NULL DEFAULT 'pending_verification' CHECK (owner_payout_status IN ('pending_verification','ready','paid')),
  agent_payout_status   TEXT NOT NULL DEFAULT 'ready' CHECK (agent_payout_status IN ('ready','paid')),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION public.compute_booking_payout_split()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  l public.listings%ROWTYPE;
  a public.board_authorizations%ROWTYPE;
  rate NUMERIC;
  owner_amt NUMERIC;
  agent_amt NUMERIC;
  owner_status TEXT;
BEGIN
  IF NEW.listing_id IS NULL THEN
    DELETE FROM public.booking_payouts WHERE booking_id = NEW.id;
    RETURN NEW;
  END IF;

  SELECT * INTO l FROM public.listings WHERE id = NEW.listing_id;
  IF l.id IS NULL OR l.agent_id IS NULL THEN
    -- listing not found, or a direct-owner listing with no agent — no split to record
    DELETE FROM public.booking_payouts WHERE booking_id = NEW.id;
    RETURN NEW;
  END IF;
  SELECT * INTO a FROM public.board_authorizations WHERE id = l.authorization_id;

  rate := COALESCE(NEW.agreed_rate, NEW.offered_rate, l.sell_price);
  owner_amt := LEAST(rate, a.floor_rate);
  agent_amt := GREATEST(rate - a.floor_rate, 0);
  owner_status := CASE WHEN a.owner_verified THEN 'ready' ELSE 'pending_verification' END;

  INSERT INTO public.booking_payouts (booking_id, listing_id, agent_id, owner_id, effective_rate, floor_rate, owner_payout_amount, agent_payout_amount, owner_payout_status, updated_at)
  VALUES (NEW.id, l.id, l.agent_id, a.owner_id, rate, a.floor_rate, owner_amt, agent_amt, owner_status, NOW())
  ON CONFLICT (booking_id) DO UPDATE SET
    listing_id = EXCLUDED.listing_id,
    agent_id = EXCLUDED.agent_id,
    owner_id = EXCLUDED.owner_id,
    effective_rate = EXCLUDED.effective_rate,
    floor_rate = EXCLUDED.floor_rate,
    owner_payout_amount = EXCLUDED.owner_payout_amount,
    agent_payout_amount = EXCLUDED.agent_payout_amount,
    owner_payout_status = EXCLUDED.owner_payout_status,
    updated_at = NOW();

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS bookings_compute_payout_split ON public.bookings;
CREATE TRIGGER bookings_compute_payout_split
  AFTER INSERT OR UPDATE OF listing_id, agreed_rate, offered_rate ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.compute_booking_payout_split();

-- ── 5. RLS ─────────────────────────────────────────────────────────────────

ALTER TABLE public.board_authorizations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "board_authorizations_select" ON public.board_authorizations;
DROP POLICY IF EXISTS "board_authorizations_insert" ON public.board_authorizations;
DROP POLICY IF EXISTS "board_authorizations_update" ON public.board_authorizations;

-- Readable by: the claiming agent, the verified owner it names, any agency
-- (so trust badges can be shown/derived in the shortlist), and admin.
CREATE POLICY "board_authorizations_select" ON public.board_authorizations FOR SELECT USING (
  agent_id = auth.uid() OR owner_id = auth.uid() OR auth_role() IN ('agency','admin')
);
CREATE POLICY "board_authorizations_insert" ON public.board_authorizations FOR INSERT WITH CHECK (
  agent_id = auth.uid() AND auth_role() = 'agent'
);
-- Row-level access for UPDATE: admin, the claiming agent (their own claim),
-- or the named owner (to confirm/deny it). Which *columns* each of those
-- may actually change is enforced separately by the owner_verified guard
-- trigger above — this just grants reaching the row at all.
CREATE POLICY "board_authorizations_update" ON public.board_authorizations FOR UPDATE USING (
  auth_role() = 'admin' OR agent_id = auth.uid() OR owner_id = auth.uid()
);

ALTER TABLE public.listings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "listings_select" ON public.listings;
DROP POLICY IF EXISTS "listings_insert" ON public.listings;
DROP POLICY IF EXISTS "listings_update" ON public.listings;

-- Listings power the shortlist/marketplace — readable broadly like boards.
CREATE POLICY "listings_select" ON public.listings FOR SELECT USING (true);
CREATE POLICY "listings_insert" ON public.listings FOR INSERT WITH CHECK (
  (agent_id = auth.uid() AND auth_role() = 'agent')
  OR (agent_id IS NULL AND EXISTS (SELECT 1 FROM public.boards WHERE boards.id = board_id AND boards.owner_id = auth.uid()))
  OR auth_role() = 'admin'
);
CREATE POLICY "listings_update" ON public.listings FOR UPDATE USING (
  agent_id = auth.uid() OR auth_role() = 'admin'
  OR (agent_id IS NULL AND EXISTS (SELECT 1 FROM public.boards WHERE boards.id = board_id AND boards.owner_id = auth.uid()))
);

ALTER TABLE public.booking_payouts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "booking_payouts_select" ON public.booking_payouts;

-- Finance breakdown must be visible to every party it names, plus the
-- booking's own agency — never opaque, per the whole point of this feature.
CREATE POLICY "booking_payouts_select" ON public.booking_payouts FOR SELECT USING (
  agent_id = auth.uid() OR owner_id = auth.uid() OR auth_role() = 'admin'
  OR EXISTS (
    SELECT 1 FROM public.bookings b JOIN public.campaigns c ON c.id = b.campaign_id
    WHERE b.id = booking_payouts.booking_id AND c.agency_id = auth.uid()
  )
);
-- Writes only ever happen via the compute_booking_payout_split() trigger,
-- which runs as the table owner and so bypasses RLS — no direct-write
-- policy is granted to any client role.
