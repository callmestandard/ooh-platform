-- ═══════════════════════════════════════════════════════════════════
-- OOH Platform — lock down roles, suspension and notifications
-- Run in Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- Safe to re-run: CREATE OR REPLACE / DROP ... IF EXISTS.
--
-- Fixes four holes found in the MVP audit:
--
-- 1. Sign-up trusted the browser's role. handle_new_user() copied
--    raw_user_meta_data->>'role' straight into profiles, so a direct
--    auth.signUp() call with { role: 'admin' } created an admin.
--    Now only self-service roles are accepted; anything else becomes 'agency'.
--
-- 2. Users could edit their own role. "profiles_update_own" allows a user
--    to update their own row with no column limits, so
--    update profiles set role = 'admin' where id = auth.uid() worked.
--    A trigger now rejects role / is_suspended changes unless the caller is
--    an admin. Service-role and SQL Editor calls (auth.uid() IS NULL) are
--    unaffected — that is how admins and invited marketers are created.
--
-- 3. Logged-out visitors could read and edit every notification.
--    notifications_select / _update ended in "OR auth.uid() IS NULL", which
--    matches every request made with the public anon key.
--
-- 4. Role-wide notifications leaked deals. A notification with no
--    recipient_user_id was shown to every user of that role, so
--    "Owner accepted — Board X at ₦4.5M" reached every agency. Untargeted
--    notifications are now visible to admins only; everyone else sees only
--    notifications addressed to them. Inserts must come from a signed-in
--    user and may only link inside the app.
-- ═══════════════════════════════════════════════════════════════════

-- ── 1. Sign-up: accept only self-service roles ───────────────────────────
-- Same body as 011, with the role whitelisted.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, auth
AS $$
DECLARE
  v_role TEXT := NEW.raw_user_meta_data->>'role';
BEGIN
  IF v_role IS NULL OR v_role NOT IN ('agency', 'owner', 'client', 'agent') THEN
    v_role := 'agency';
  END IF;

  INSERT INTO public.profiles (id, role, full_name, company_name, email)
  VALUES (
    NEW.id,
    v_role,
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'company_name',
    NEW.email
  )
  ON CONFLICT (id) DO NOTHING;

  IF NEW.raw_user_meta_data->>'cac_number' IS NOT NULL OR NEW.raw_user_meta_data->>'tin_number' IS NOT NULL THEN
    INSERT INTO public.partner_kyc (id, cac_number, tin_number)
    VALUES (NEW.id, NEW.raw_user_meta_data->>'cac_number', NEW.raw_user_meta_data->>'tin_number')
    ON CONFLICT (id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

-- ── 2. Profiles: only an admin may change role or suspension ─────────────
-- is_suspended is read through to_jsonb so this works whether or not the
-- legacy suspension column has been added.
CREATE OR REPLACE FUNCTION public.guard_profile_privileged_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Service role / SQL Editor: trusted.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- A user creating their own missing profile row cannot pick a privileged role.
    IF NEW.role IS NOT NULL AND NEW.role NOT IN ('agency', 'owner', 'client', 'agent') THEN
      NEW.role := 'agency';
    END IF;
    NEW := jsonb_populate_record(NEW, jsonb_build_object('is_suspended', false));
    RETURN NEW;
  END IF;

  -- UPDATE. auth_role() reads the stored (pre-update) row, so a user cannot
  -- make themselves admin and pass this check in the same statement.
  IF public.auth_role() = 'admin' THEN
    RETURN NEW;
  END IF;

  IF NEW.role IS DISTINCT FROM OLD.role THEN
    RAISE EXCEPTION 'only an admin can change an account role' USING ERRCODE = '42501';
  END IF;

  IF (to_jsonb(NEW) -> 'is_suspended') IS DISTINCT FROM (to_jsonb(OLD) -> 'is_suspended') THEN
    RAISE EXCEPTION 'only an admin can suspend or unsuspend an account' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_guard_privileged_columns ON public.profiles;
CREATE TRIGGER profiles_guard_privileged_columns
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_profile_privileged_columns();

-- ── 3 & 4. Notifications ─────────────────────────────────────────────────
-- Drop EVERY existing policy on notifications, not just the known names.
-- Permissive policies are OR'd together, so one leftover is enough to undo
-- this fix — the live database still had "Users can read relevant
-- notifications" (same leaky "OR auth.uid() IS NULL" rule), re-created by a
-- legacy setup script after 017 dropped it.
DO $$
DECLARE p RECORD;
BEGIN
  FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'notifications' LOOP
    EXECUTE format('DROP POLICY %I ON public.notifications', p.policyname);
  END LOOP;
END $$;

CREATE POLICY "notifications_select" ON public.notifications FOR SELECT USING (
  auth.uid() IS NOT NULL AND (
    recipient_user_id = auth.uid()
    OR (recipient_user_id IS NULL AND recipient_role = 'admin' AND public.auth_role() = 'admin')
  )
);

-- Marking as read.
CREATE POLICY "notifications_update" ON public.notifications FOR UPDATE USING (
  auth.uid() IS NOT NULL AND (
    recipient_user_id = auth.uid()
    OR (recipient_user_id IS NULL AND recipient_role = 'admin' AND public.auth_role() = 'admin')
  )
);

-- Any signed-in user may notify another (negotiation counterparties need
-- this), but links must stay inside the app so a notification can't be used
-- to send someone to an outside site. Server routes use the service role and
-- are not affected.
CREATE POLICY "notifications_insert" ON public.notifications FOR INSERT WITH CHECK (
  auth.uid() IS NOT NULL
  AND (link IS NULL OR (link LIKE '/%' AND link NOT LIKE '//%'))
);
