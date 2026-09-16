-- ═══════════════════════════════════════════════════════════════════
-- OOH Platform — fix campaigns.status CHECK constraint (missing 'pending')
-- Run in Supabase SQL Editor (Dashboard → SQL Editor → New query)
--
-- Same drift pattern as boards_status_check and bookings_status_check
-- found earlier: the live constraint only allows
-- ('draft','active','completed','cancelled') — missing 'pending', which is
-- exactly the status sendToClient() sets (campaigns/[id]/page.tsx) when an
-- agency sends a plan to a client for approval. Combined with the client_id
-- FK bug (015), this means "Send to client" has been doubly broken: even
-- after 015, this constraint alone still rejects the update. Restores
-- 'pending' to match the table's original design in supabase-full-setup.sql.
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE public.campaigns DROP CONSTRAINT IF EXISTS campaigns_status_check;
ALTER TABLE public.campaigns
  ADD CONSTRAINT campaigns_status_check
  CHECK (status IN ('draft', 'active', 'completed', 'cancelled', 'pending'));
