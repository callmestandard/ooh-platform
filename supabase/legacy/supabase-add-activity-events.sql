-- Immutable activity / audit log for campaigns, bookings, invoices, compliance.
-- Run once in the Supabase SQL Editor (after core tables exist).

CREATE TABLE IF NOT EXISTS public.activity_events (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type  TEXT NOT NULL CHECK (entity_type IN (
    'campaign', 'booking', 'invoice', 'compliance_check'
  )),
  entity_id    UUID NOT NULL,
  campaign_id  UUID REFERENCES public.campaigns(id) ON DELETE SET NULL,
  actor_id     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_role   TEXT,
  actor_name   TEXT,
  action       TEXT NOT NULL,
  summary      TEXT NOT NULL,
  changes      JSONB,
  metadata     JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_activity_entity
  ON public.activity_events (entity_type, entity_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_activity_campaign
  ON public.activity_events (campaign_id, created_at DESC)
  WHERE campaign_id IS NOT NULL;

COMMENT ON TABLE public.activity_events IS
  'Append-only audit log: who did what, when, on campaigns/bookings/invoices/compliance.';

ALTER TABLE public.activity_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "activity_events_read" ON public.activity_events;
DROP POLICY IF EXISTS "activity_events_insert" ON public.activity_events;

-- Demo / single-tenant: authenticated users can read and append (matches notifications pattern).
CREATE POLICY "activity_events_read"
  ON public.activity_events FOR SELECT
  USING (true);

CREATE POLICY "activity_events_insert"
  ON public.activity_events FOR INSERT
  WITH CHECK (true);

-- No UPDATE or DELETE policies — append-only by convention.
