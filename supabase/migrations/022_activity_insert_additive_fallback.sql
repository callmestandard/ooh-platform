-- ═══════════════════════════════════════════════════════════════════
-- OOH Platform — additive fallback for activity_events anon INSERT
-- Run in Supabase SQL Editor (Dashboard → SQL Editor → New query)
--
-- Migrations 018 and 020 both define "activity_insert" as a DROP-then-
-- CREATE POLICY ... WITH CHECK (true) inside a discovery DO block, and
-- both were confirmed run, yet a live anon INSERT still gets rejected with
-- the standard RLS-violation error every time it's re-tested. Root cause
-- unconfirmed (possibly a RESTRICTIVE policy created outside these
-- migrations, or something about the DO block not committing as expected
-- in this environment) — rather than keep guessing, this takes a
-- different, lower-risk approach: it doesn't touch or drop anything.
--
-- Multiple PERMISSIVE policies on the same command are OR'd together in
-- Postgres RLS, so adding one more wide-open permissive INSERT policy,
-- under a fresh name that can't collide with whatever already exists,
-- grants the access regardless of whatever is or isn't working with the
-- existing "activity_insert" policy. This can only widen access, never
-- narrow it, so it's safe to run even without knowing the current state —
-- the one thing it can't fix is a RESTRICTIVE policy, which would need a
-- real diagnostic to find.
-- ═══════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "activity_insert_v2" ON public.activity_events;
CREATE POLICY "activity_insert_v2" ON public.activity_events FOR INSERT WITH CHECK (true);
