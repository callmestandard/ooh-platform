-- ═══════════════════════════════════════════════════════════════════
-- One-time cleanup — remove all demo/seed data, keep demo login accounts
-- Run in Supabase SQL Editor (Dashboard → SQL Editor → New query)
--
-- Clears every content table (boards, campaigns, bookings, messages,
-- compliance checks, invoices, activity log, notifications, creative
-- uploads, tracking, partner KYC) so the platform starts genuinely empty
-- and ready for real data — per the decision to keep the demo@... login
-- accounts intact (so the "Login as Agency/Client/Owner" buttons keep
-- working) but wipe every board/campaign/booking attached to them, plus
-- delete the one junk test signup ("234e234" / "3123e").
--
-- This is a one-time data cleanup, not a schema change — not numbered
-- alongside the real migrations in supabase/migrations/.
-- ═══════════════════════════════════════════════════════════════════

DELETE FROM public.compliance_checks;
DELETE FROM public.invoice_items;
DELETE FROM public.invoices;
DELETE FROM public.messages;
DELETE FROM public.creative_uploads;
DELETE FROM public.board_audience_profiles;
DELETE FROM public.tracking_events;
DELETE FROM public.tracking_links;
DELETE FROM public.activity_events;
DELETE FROM public.notifications;
DELETE FROM public.bookings;
DELETE FROM public.campaigns;
DELETE FROM public.boards;
DELETE FROM public.partner_kyc;

-- Remove the one obvious junk test signup ("234e234" / "3123e") and every
-- leftover disposable test-fixture account this session's verification
-- scripts created under the ooh-platform-test.local domain (most were
-- cleaned up automatically; a few survived scripts that errored early).
-- Deleting from auth.users cascades to public.profiles via the existing
-- foreign key / trigger, same as using the Dashboard's Auth → Users →
-- Delete action on each of these.
DELETE FROM auth.users WHERE id = 'e3a2d417-f15e-49ad-b699-a9b998474272';
DELETE FROM auth.users WHERE email LIKE '%@ooh-platform-test.local';
