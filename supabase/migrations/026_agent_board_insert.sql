-- ═══════════════════════════════════════════════════════════════════
-- OOH Platform — let agents create a board that doesn't exist on the
-- platform yet (the "it doesn't exist yet" path in Claim a Board)
-- Run in Supabase SQL Editor (Dashboard → SQL Editor → New query)
--
-- Live-tested the full agent walkthrough and hit a real gap: boards RLS
-- only has boards_insert_own (owner_id = auth.uid()) and
-- boards_insert_agency (auth_role() IN ('agency','admin')) — an 'agent'
-- session gets a flat RLS rejection trying to insert a board at all, which
-- is exactly what /dashboard/agent's "it doesn't exist yet" claim flow
-- needs to do when the true owner isn't on the platform yet.
-- ═══════════════════════════════════════════════════════════════════

CREATE POLICY "boards_insert_agent" ON public.boards FOR INSERT WITH CHECK (
  auth_role() = 'agent' AND owner_id IS NULL
);
