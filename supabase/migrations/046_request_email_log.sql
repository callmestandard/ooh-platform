-- ═══════════════════════════════════════════════════════════════════
-- OOH Platform — email log for board requests
-- Run in Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- Requires 043. Safe to re-run.
--
-- Three emails go out for a board request:
--   received  — new request: the board's owner, the buyer (confirmation)
--               and our admins
--   replied   — the owner (or our team) answered: the buyer
--   accepted  — a deal was agreed: the buyer, the owner and our admins
--
-- /api/notify/request decides what is due from the request's real state
-- and claims a row here before sending, so each email is sent once even
-- if the app calls the endpoint many times. No policies: only the service
-- role (the API route) can read or write this table.
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.request_email_log (
  request_id UUID NOT NULL REFERENCES public.availability_requests(id) ON DELETE CASCADE,
  event      TEXT NOT NULL CHECK (event IN ('received', 'replied', 'accepted')),
  -- true when the event was too old to email (e.g. before this went live)
  skipped    BOOLEAN NOT NULL DEFAULT false,
  sent_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (request_id, event)
);

ALTER TABLE public.request_email_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.request_email_log FROM anon, authenticated;
