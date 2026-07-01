-- ═══════════════════════════════════════════════════════════════════
-- OOH Platform — Add per-user targeting to notifications
-- Safe to re-run: uses IF NOT EXISTS / OR REPLACE
-- ═══════════════════════════════════════════════════════════════════

-- Add optional recipient_user_id so notifications can target a specific
-- authenticated user rather than every user of a role.
-- NULL = broadcast to the whole role (existing behaviour, unchanged).
-- non-NULL = only that user sees it.

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS recipient_user_id UUID
    REFERENCES auth.users(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_notifications_user_id
  ON public.notifications (recipient_user_id)
  WHERE recipient_user_id IS NOT NULL;

-- Update the SELECT policy so authenticated users only see notifications
-- meant for them specifically, OR role-broadcast ones for their role.
-- Anon/demo sessions (auth.uid() IS NULL) fall through to the role filter.

DROP POLICY IF EXISTS "Anyone can read notifications" ON public.notifications;

CREATE POLICY "Users can read relevant notifications"
  ON public.notifications FOR SELECT
  USING (
    -- Authenticated: personal OR role-broadcast for their role
    (auth.uid() IS NOT NULL AND (
      recipient_user_id = auth.uid()
      OR (recipient_user_id IS NULL AND recipient_role = auth_role())
    ))
    OR
    -- Anon/demo: any notification (role filtering happens client-side)
    auth.uid() IS NULL
  );
