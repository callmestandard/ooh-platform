-- ═══════════════════════════════════════════════════════════════════
-- OOH Platform — SECURITY FIX: actually enable RLS on the priority tables
-- Run in Supabase SQL Editor (Dashboard → SQL Editor → New query)
--
-- Diagnosis: 001_rls_policies.sql already defines good policies for these
-- tables, but live testing (anonymous reads succeeding against policies
-- that have no clause that could evaluate true for an anonymous request)
-- proves ROW LEVEL SECURITY was never actually enabled on them — matches
-- old project notes describing "RLS disabled for dev" that was never
-- flipped back on. The policies have been sitting there, inert. This
-- migration turns RLS on for real and re-affirms the policies (idempotent
-- DROP+CREATE, safe to re-run), plus two real bugs found along the way:
--   1. messages_insert required sender_id = auth.uid(), but no client code
--      anywhere sets sender_id — every negotiation message insert would be
--      rejected once RLS is actually active. Fixed to check booking access
--      the same way messages_select does.
--   2. bookings had no DELETE policy at all (needed for "remove from plan"
--      and "reject replacement candidate" in the campaign plan builder).
-- Also adds one legitimate broad-read case that's part of the app's actual
-- design: any agency can browse the client directory (id/name/company only
-- in practice, though RLS is row- not column-level so the whole row is
-- reachable) to pick who to send a plan to.
-- ═══════════════════════════════════════════════════════════════════

-- ─── 0. auth_role(): make sure it's the SECURITY DEFINER version ────────────
-- Without this, calling auth_role() inside a profiles policy while profiles
-- RLS is active can hit infinite-recursion / permission issues.

CREATE OR REPLACE FUNCTION auth_role()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions, auth
AS $$
  SELECT COALESCE(
    (SELECT role FROM profiles WHERE id = auth.uid()),
    auth.jwt() ->> 'role',
    'anon'
  );
$$;

-- ─── 1. Enable RLS for real ───────────────────────────────────────────────

ALTER TABLE public.profiles           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.boards             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaigns          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bookings           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_items      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.compliance_checks  ENABLE ROW LEVEL SECURITY;

-- ─── 2. profiles ───────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "profiles_select_own" ON public.profiles;
DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
DROP POLICY IF EXISTS "profiles_insert_own" ON public.profiles;
DROP POLICY IF EXISTS "profiles_select_client_directory" ON public.profiles;

CREATE POLICY "profiles_select_own" ON public.profiles
  FOR SELECT USING (id = auth.uid() OR auth_role() = 'admin');

-- Agencies need to browse the client directory to pick who to send a plan
-- to (campaigns/[id]/page.tsx "Send to client"). Matches existing design.
CREATE POLICY "profiles_select_client_directory" ON public.profiles
  FOR SELECT USING (role = 'client' AND auth_role() = 'agency');

CREATE POLICY "profiles_update_own" ON public.profiles
  FOR UPDATE USING (id = auth.uid() OR auth_role() = 'admin');

CREATE POLICY "profiles_insert_own" ON public.profiles
  FOR INSERT WITH CHECK (id = auth.uid());

-- ─── 3. boards (already meant to be public; re-affirming, not changing) ────

DROP POLICY IF EXISTS "boards_select_public" ON public.boards;
DROP POLICY IF EXISTS "boards_insert_own"    ON public.boards;
DROP POLICY IF EXISTS "boards_update_own"    ON public.boards;
DROP POLICY IF EXISTS "boards_delete_own"    ON public.boards;

CREATE POLICY "boards_select_public" ON public.boards FOR SELECT USING (true);
CREATE POLICY "boards_insert_own"    ON public.boards FOR INSERT WITH CHECK (owner_id = auth.uid());
CREATE POLICY "boards_update_own"    ON public.boards FOR UPDATE USING (owner_id = auth.uid() OR auth_role() = 'admin');
CREATE POLICY "boards_delete_own"    ON public.boards FOR DELETE USING (owner_id = auth.uid() OR auth_role() = 'admin');
-- boards_insert_agency / boards_update_agency from 007_board_internal_asset.sql
-- are untouched — CREATE POLICY there didn't drop-and-recreate, they still exist.

-- ─── 4. campaigns ───────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "campaigns_select" ON public.campaigns;
DROP POLICY IF EXISTS "campaigns_insert" ON public.campaigns;
DROP POLICY IF EXISTS "campaigns_update" ON public.campaigns;
DROP POLICY IF EXISTS "campaigns_delete" ON public.campaigns;

CREATE POLICY "campaigns_select" ON public.campaigns FOR SELECT USING (
  agency_id = auth.uid() OR client_id = auth.uid() OR auth_role() = 'admin'
);
CREATE POLICY "campaigns_insert" ON public.campaigns FOR INSERT WITH CHECK (
  agency_id = auth.uid() OR client_id = auth.uid()
);
CREATE POLICY "campaigns_update" ON public.campaigns FOR UPDATE USING (
  agency_id = auth.uid() OR auth_role() = 'admin'
);
CREATE POLICY "campaigns_delete" ON public.campaigns FOR DELETE USING (
  agency_id = auth.uid() OR auth_role() = 'admin'
);

-- ─── 5. bookings ─────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "bookings_select" ON public.bookings;
DROP POLICY IF EXISTS "bookings_insert" ON public.bookings;
DROP POLICY IF EXISTS "bookings_update" ON public.bookings;
DROP POLICY IF EXISTS "bookings_delete" ON public.bookings;

CREATE POLICY "bookings_select" ON public.bookings FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.campaigns WHERE campaigns.id = bookings.campaign_id AND campaigns.agency_id = auth.uid())
  OR EXISTS (SELECT 1 FROM public.boards WHERE boards.id = bookings.board_id AND boards.owner_id = auth.uid())
  OR EXISTS (SELECT 1 FROM public.campaigns WHERE campaigns.id = bookings.campaign_id AND campaigns.client_id = auth.uid())
  OR auth_role() = 'admin'
);
CREATE POLICY "bookings_insert" ON public.bookings FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.campaigns WHERE campaigns.id = campaign_id AND campaigns.agency_id = auth.uid())
);
CREATE POLICY "bookings_update" ON public.bookings FOR UPDATE USING (
  EXISTS (SELECT 1 FROM public.campaigns WHERE campaigns.id = bookings.campaign_id AND campaigns.agency_id = auth.uid())
  OR EXISTS (SELECT 1 FROM public.boards WHERE boards.id = bookings.board_id AND boards.owner_id = auth.uid())
  OR EXISTS (SELECT 1 FROM public.campaigns WHERE campaigns.id = bookings.campaign_id AND campaigns.client_id = auth.uid())
  OR auth_role() = 'admin'
);
CREATE POLICY "bookings_delete" ON public.bookings FOR DELETE USING (
  EXISTS (SELECT 1 FROM public.campaigns WHERE campaigns.id = bookings.campaign_id AND campaigns.agency_id = auth.uid())
  OR auth_role() = 'admin'
);

-- ─── 6. messages ─────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "messages_select" ON public.messages;
DROP POLICY IF EXISTS "messages_insert" ON public.messages;

CREATE POLICY "messages_select" ON public.messages FOR SELECT USING (
  sender_id = auth.uid()
  OR EXISTS (SELECT 1 FROM public.bookings b JOIN public.campaigns c ON c.id = b.campaign_id WHERE b.id = messages.booking_id AND c.agency_id = auth.uid())
  OR EXISTS (SELECT 1 FROM public.bookings b JOIN public.boards bo ON bo.id = b.board_id WHERE b.id = messages.booking_id AND bo.owner_id = auth.uid())
  OR auth_role() = 'admin'
);
-- Fixed: was `sender_id = auth.uid()` only, but the app never sets sender_id
-- on insert. Now matches the same booking-access check as messages_select.
CREATE POLICY "messages_insert" ON public.messages FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.bookings b JOIN public.campaigns c ON c.id = b.campaign_id WHERE b.id = messages.booking_id AND c.agency_id = auth.uid())
  OR EXISTS (SELECT 1 FROM public.bookings b JOIN public.boards bo ON bo.id = b.board_id WHERE b.id = messages.booking_id AND bo.owner_id = auth.uid())
  OR auth_role() = 'admin'
);

-- ─── 7. invoices / invoice_items ─────────────────────────────────────────────

DROP POLICY IF EXISTS "invoices_select" ON public.invoices;
DROP POLICY IF EXISTS "invoices_insert" ON public.invoices;
DROP POLICY IF EXISTS "invoices_update" ON public.invoices;

CREATE POLICY "invoices_select" ON public.invoices FOR SELECT USING (
  agency_id = auth.uid()
  OR owner_id = auth.uid()
  OR EXISTS (SELECT 1 FROM public.campaigns WHERE campaigns.id = invoices.campaign_id AND campaigns.client_id = auth.uid())
  OR auth_role() = 'admin'
);
CREATE POLICY "invoices_insert" ON public.invoices FOR INSERT WITH CHECK (
  agency_id = auth.uid() OR owner_id = auth.uid()
);
CREATE POLICY "invoices_update" ON public.invoices FOR UPDATE USING (
  agency_id = auth.uid() OR owner_id = auth.uid() OR auth_role() = 'admin'
);

DROP POLICY IF EXISTS "invoice_items_select" ON public.invoice_items;
DROP POLICY IF EXISTS "invoice_items_insert" ON public.invoice_items;

CREATE POLICY "invoice_items_select" ON public.invoice_items FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.invoices
    WHERE invoices.id = invoice_items.invoice_id
    AND (invoices.agency_id = auth.uid() OR invoices.owner_id = auth.uid() OR auth_role() = 'admin')
  )
);
CREATE POLICY "invoice_items_insert" ON public.invoice_items FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.invoices
    WHERE invoices.id = invoice_id
    AND (invoices.agency_id = auth.uid() OR invoices.owner_id = auth.uid())
  )
);

-- ─── 8. compliance_checks ─────────────────────────────────────────────────────

DROP POLICY IF EXISTS "compliance_select" ON public.compliance_checks;
DROP POLICY IF EXISTS "compliance_insert" ON public.compliance_checks;
DROP POLICY IF EXISTS "compliance_update" ON public.compliance_checks;

CREATE POLICY "compliance_select" ON public.compliance_checks FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.bookings b JOIN public.campaigns c ON c.id = b.campaign_id WHERE b.id = compliance_checks.booking_id AND c.agency_id = auth.uid())
  OR EXISTS (SELECT 1 FROM public.bookings b JOIN public.campaigns c ON c.id = b.campaign_id WHERE b.id = compliance_checks.booking_id AND c.client_id = auth.uid())
  OR EXISTS (SELECT 1 FROM public.bookings b JOIN public.boards bo ON bo.id = b.board_id WHERE b.id = compliance_checks.booking_id AND bo.owner_id = auth.uid())
  OR auth_role() = 'admin'
);
-- Field agents submit POE via the service-role /poe/[token] endpoint (bypasses
-- RLS entirely), so this stays permissive for INSERT — matches 001's original intent.
CREATE POLICY "compliance_insert" ON public.compliance_checks FOR INSERT WITH CHECK (true);
CREATE POLICY "compliance_update" ON public.compliance_checks FOR UPDATE USING (
  EXISTS (SELECT 1 FROM public.bookings b JOIN public.campaigns c ON c.id = b.campaign_id WHERE b.id = compliance_checks.booking_id AND c.agency_id = auth.uid())
  OR auth_role() = 'admin'
);
