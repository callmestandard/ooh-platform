-- ═══════════════════════════════════════════════════════════════════
-- OOH Platform — let the public trust badge actually be readable publicly
-- Run in Supabase SQL Editor (Dashboard → SQL Editor → New query)
--
-- Live-tested the public /boards/[id] share page (intentionally
-- ungated — see RequirePlatformAuth history) and found that although
-- listings itself is fully public (listings_select USING(true), same as
-- boards), the nested board_authorizations(owner_verified) embed PostgREST
-- needs to compute the trust badge silently returns null for an anon
-- request — board_authorizations_select only covers the claiming agent,
-- the named owner, agency, and admin, nobody else. The practical effect:
-- computeTrustBadge() falls back to "Owner Unverified" for EVERY anonymous
-- visitor regardless of the true state, since it can't tell the difference
-- between "genuinely unverified" and "can't see the row" — the opposite of
-- what a public trust badge needs to be honest.
--
-- Scoped to status = 'active' only — disputed/revoked claims stay
-- restricted to the parties already covered (agent/owner/agency/admin),
-- matching that floor_rate and dispute history aren't meant to be
-- broadcast, only the resolved owner_verified flag on a live claim.
-- ═══════════════════════════════════════════════════════════════════

CREATE POLICY "board_authorizations_select_public_active" ON public.board_authorizations FOR SELECT USING (
  status = 'active'
);
