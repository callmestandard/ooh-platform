-- ═══════════════════════════════════════════════════════════════════
-- OOH Platform — diagnostic-only helper: see what's really in pg_policies
-- Run in Supabase SQL Editor (Dashboard → SQL Editor → New query)
--
-- Three attempts (018, 020, 022) to make activity_events allow an anon
-- INSERT have all failed identically on re-test, including a purely
-- additive permissive policy that should be OR'd in regardless of
-- anything else — the only way that fails is a RESTRICTIVE policy
-- somewhere also targeting INSERT. Rather than keep asking for SQL
-- Editor results to be relayed by hand (unreliable so far), this exposes
-- a small read-only function that can be called directly over the REST
-- API (POST /rest/v1/rpc/debug_policies) — so the actual policy list can
-- be read directly, in one shot, with no copy-paste in between.
--
-- Purely diagnostic: SELECT-only, SECURITY DEFINER just to read the
-- catalog, does not modify anything, safe to leave in place afterward.
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.debug_policies(tbl text)
RETURNS TABLE(policyname text, permissive text, cmd text, roles name[], qual text, with_check text)
SECURITY DEFINER
SET search_path = public, pg_catalog
LANGUAGE sql
AS $$
  SELECT policyname, permissive, cmd, roles, qual, with_check
  FROM pg_policies
  WHERE tablename = tbl;
$$;

GRANT EXECUTE ON FUNCTION public.debug_policies(text) TO anon, authenticated;
