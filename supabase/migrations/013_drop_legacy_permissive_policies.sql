-- ═══════════════════════════════════════════════════════════════════
-- OOH Platform — SECURITY FIX: drop the legacy wide-open catch-all policies
-- Run in Supabase SQL Editor (Dashboard → SQL Editor → New query)
--
-- Root cause of 012 appearing to do nothing: supabase-full-setup.sql (run
-- earlier in this project's life) created policies named "<table>_all" —
-- e.g. `CREATE POLICY "campaigns_all" ON campaigns FOR ALL USING (true)
-- WITH CHECK (true)`. Postgres OR's multiple permissive policies on the
-- same command together, so even though 012's "campaigns_select" etc.
-- policies are correct, "campaigns_all" (USING true) was still there
-- alongside them, letting everything through regardless. 012's DROP POLICY
-- statements only targeted its own policy names, not these — this
-- migration drops the "_all" ones by their actual name.
-- ═══════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "profiles_all"           ON public.profiles;
DROP POLICY IF EXISTS "boards_all"             ON public.boards;
DROP POLICY IF EXISTS "campaigns_all"          ON public.campaigns;
DROP POLICY IF EXISTS "bookings_all"           ON public.bookings;
DROP POLICY IF EXISTS "messages_all"           ON public.messages;
DROP POLICY IF EXISTS "compliance_all"         ON public.compliance_checks;
DROP POLICY IF EXISTS "invoices_all"           ON public.invoices;
DROP POLICY IF EXISTS "invoice_items_all"      ON public.invoice_items;

-- Sanity check: list every policy still on these 8 tables afterward, so we
-- can see in the SQL Editor's result grid exactly what's left — should be
-- only the named policies from 007/012, nothing called "*_all".
SELECT schemaname, tablename, policyname, cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('profiles','boards','campaigns','bookings','messages','compliance_checks','invoices','invoice_items')
ORDER BY tablename, policyname;
