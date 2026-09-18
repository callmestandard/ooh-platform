-- ═══════════════════════════════════════════════════════════════════
-- OOH Platform — fix the admin Users tab: profiles.created_at never existed
-- Run in Supabase SQL Editor (Dashboard → SQL Editor → New query)
--
-- src/app/dashboard/admin/page.tsx has always selected
-- profiles.created_at, but that column has never existed on this table —
-- confirmed live: `column profiles.created_at does not exist`. Since the
-- admin page's fetchAll() runs all its queries through Promise.all and
-- only checks bRes.error explicitly, this query has been failing
-- silently every time — profRes.data stays null, so setProfiles() never
-- runs, and the Users tab has always shown stale/empty data.
--
-- Real fix, not a column removed from the query: add the column and
-- backfill it from each user's actual signup date in auth.users (which
-- this migration can join directly with elevated SQL Editor privileges,
-- even though the app's runtime API key can never see auth.users).
-- Future signups get it automatically via the DEFAULT — no change needed
-- to handle_new_user().
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

UPDATE public.profiles p
SET created_at = u.created_at
FROM auth.users u
WHERE p.id = u.id;
