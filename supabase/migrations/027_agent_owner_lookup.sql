-- ═══════════════════════════════════════════════════════════════════
-- OOH Platform — let agents look up an owner profile by email to link them
-- Run in Supabase SQL Editor (Dashboard → SQL Editor → New query)
--
-- Live-tested the owner-confirmation flow and found profiles SELECT has
-- no policy letting an 'agent' read an 'owner' row at all — only
-- profiles_select_own (own row) and profiles_select_client_directory
-- (agency reading client rows, for the client picker). The "link the
-- owner's account by email" step in Claim a Board was completely blocked.
-- Mirrors the existing client-directory policy exactly, scoped to
-- agent→owner instead of agency→client.
-- ═══════════════════════════════════════════════════════════════════

CREATE POLICY "profiles_select_owner_directory" ON public.profiles FOR SELECT USING (
  role = 'owner' AND auth_role() = 'agent'
);

-- Symmetric case: the owner's own agent-authorizations confirmation page
-- needs to show WHO is claiming to represent them (name/company/email) —
-- same directory-style precedent as the two policies above, not scoped
-- further per-claim for the same reason profiles_select_client_directory
-- isn't scoped to "only clients on a shared campaign" either.
CREATE POLICY "profiles_select_agent_directory" ON public.profiles FOR SELECT USING (
  role = 'agent' AND auth_role() = 'owner'
);
