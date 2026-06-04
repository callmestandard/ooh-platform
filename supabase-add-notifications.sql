-- Notifications table for OOH Platform
-- Run this BEFORE the demo seed.
-- Safe to re-run — uses IF NOT EXISTS throughout.

CREATE TABLE IF NOT EXISTS public.notifications (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_role TEXT NOT NULL CHECK (recipient_role IN ('agency', 'client', 'owner', 'admin')),
  type           TEXT NOT NULL,
  title          TEXT NOT NULL,
  body           TEXT,
  link           TEXT,
  read           BOOLEAN DEFAULT false,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

-- Add body/link columns if table already existed without them
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS body       TEXT;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS link       TEXT;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS recipient_role TEXT;

CREATE INDEX IF NOT EXISTS idx_notifications_role       ON public.notifications(recipient_role);
CREATE INDEX IF NOT EXISTS idx_notifications_read       ON public.notifications(read);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON public.notifications(created_at DESC);

-- RLS
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notifications_select" ON public.notifications;
DROP POLICY IF EXISTS "notifications_insert" ON public.notifications;
DROP POLICY IF EXISTS "notifications_update" ON public.notifications;

CREATE POLICY "notifications_select" ON public.notifications FOR SELECT USING (true);
CREATE POLICY "notifications_insert" ON public.notifications FOR INSERT WITH CHECK (true);
CREATE POLICY "notifications_update" ON public.notifications FOR UPDATE USING (true);
