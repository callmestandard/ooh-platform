-- ═══════════════════════════════════════════════════════════════════
-- OOH Platform — fix compliance_checks INSERT (currently rejects everyone)
-- Run in Supabase SQL Editor (Dashboard → SQL Editor → New query)
--
-- 012's compliance_insert (WITH CHECK (true)) isn't taking effect — even an
-- authenticated agency user gets rejected with "new row violates row-level
-- security policy", which shouldn't be possible for an unconditional-true
-- policy. Re-creating it standalone, explicitly targeting every role, to
-- rule out whatever happened in the larger batched migration.
-- ═══════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "compliance_insert" ON public.compliance_checks;

CREATE POLICY "compliance_insert" ON public.compliance_checks
  FOR INSERT
  TO public
  WITH CHECK (true);

SELECT policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'compliance_checks';
