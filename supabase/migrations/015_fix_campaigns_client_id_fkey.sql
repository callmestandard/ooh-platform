-- ═══════════════════════════════════════════════════════════════════
-- OOH Platform — fix campaigns.client_id pointing at the wrong table
-- Run in Supabase SQL Editor (Dashboard → SQL Editor → New query)
--
-- campaigns_client_id_fkey currently references public.users(id) — a
-- legacy, empty table from before the app moved to Supabase Auth +
-- profiles. Every other user-reference column (campaigns.agency_id,
-- boards.owner_id, invoices.agency_id/owner_id, bookings.created_by) was
-- tested and correctly references auth.users; client_id is the sole
-- exception, and it's why every real campaign in the database has
-- client_id = null — "Send to client" (campaigns/[id]/page.tsx,
-- sendToClient()) has never been able to actually complete, since every
-- real client only exists in auth.users/profiles, never in public.users.
-- This matches the table's own original design intent in
-- supabase-full-setup.sql ("client_id UUID REFERENCES auth.users(id)").
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE public.campaigns DROP CONSTRAINT IF EXISTS campaigns_client_id_fkey;

ALTER TABLE public.campaigns
  ADD CONSTRAINT campaigns_client_id_fkey
  FOREIGN KEY (client_id) REFERENCES auth.users(id) ON DELETE SET NULL;
