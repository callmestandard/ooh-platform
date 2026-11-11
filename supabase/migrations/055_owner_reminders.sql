-- ═══════════════════════════════════════════════════════════════════
-- OOH Platform — weekly owner reminder emails
-- Run in Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- Requires 053. Safe to re-run.
--
-- Each owner can have an email address on their owner link. Every Monday
-- a scheduled job (/api/owner-reminders, Vercel cron) emails owners who
-- have boards to confirm or requests waiting, with their private link.
-- Owners who are up to date, or were emailed in the last 6 days, are
-- skipped. Clearing the email stops the reminders.
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE public.owner_links ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE public.owner_links ADD COLUMN IF NOT EXISTS last_reminded_at TIMESTAMPTZ;
ALTER TABLE public.owner_links DROP CONSTRAINT IF EXISTS owner_links_email_check;
ALTER TABLE public.owner_links ADD CONSTRAINT owner_links_email_check
  CHECK (email IS NULL OR (length(email) <= 200 AND email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'));

-- Set or clear an owner's reminder email (makes their link if needed).
CREATE OR REPLACE FUNCTION public.admin_set_owner_email(p_owner_key TEXT, p_owner_name TEXT, p_email TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_email TEXT := lower(NULLIF(trim(p_email), ''));
BEGIN
  IF public.auth_role() IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'admins only' USING ERRCODE = '42501'; END IF;
  IF v_email IS NOT NULL AND v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION 'That email address doesn''t look right' USING ERRCODE = '22023';
  END IF;
  PERFORM public.admin_owner_link(p_owner_key, p_owner_name, false);
  UPDATE public.owner_links SET email = v_email WHERE owner_key = p_owner_key;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_set_owner_email(TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_owner_email(TEXT, TEXT, TEXT) TO authenticated;

-- Who to email now. p_owner_key forces one owner ("Email now"); otherwise
-- every owner with an email, something to do, and no email in 6 days.
-- Server only (service role).
CREATE OR REPLACE FUNCTION public.owner_reminders_due(p_owner_key TEXT DEFAULT NULL)
RETURNS TABLE (owner_key TEXT, owner_name TEXT, email TEXT, token TEXT, boards INTEGER, stale INTEGER, waiting INTEGER)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
BEGIN
  RETURN QUERY
  WITH l AS (
    SELECT * FROM public.owner_links ol
     WHERE ol.email IS NOT NULL AND (p_owner_key IS NULL OR ol.owner_key = p_owner_key)
  ), b AS (
    SELECT bo.id, bo.availability_checked_at AS checked, public.board_owner_key(bo.id) AS k
      FROM public.boards bo WHERE bo.status <> 'decommissioned'
  ), c AS (
    SELECT l.owner_key AS k, l.owner_name AS n, l.email AS e, l.token AS t, l.last_reminded_at AS r,
           (SELECT COUNT(*)::int FROM b WHERE b.k = l.owner_key) AS nb,
           (SELECT COUNT(*)::int FROM b WHERE b.k = l.owner_key AND (b.checked IS NULL OR b.checked < NOW() - INTERVAL '7 days')) AS ns,
           (SELECT COUNT(*)::int FROM public.availability_requests r
             WHERE r.stage = 'requested' AND r.board_id IN (SELECT b.id FROM b WHERE b.k = l.owner_key)
               AND NOT EXISTS (SELECT 1 FROM public.owner_link_replies x WHERE x.request_id = r.id)) AS nw
      FROM l
  )
  SELECT c.k, c.n, c.e, c.t, c.nb, c.ns, c.nw FROM c
   WHERE c.nb > 0
     AND (p_owner_key IS NOT NULL
          OR ((c.ns > 0 OR c.nw > 0) AND (c.r IS NULL OR c.r < NOW() - INTERVAL '6 days')));
END;
$$;
REVOKE ALL ON FUNCTION public.owner_reminders_due(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.owner_reminders_due(TEXT) TO service_role;

-- Needs checking page: same as 053, plus the email and when it last went.
DROP FUNCTION IF EXISTS public.admin_owner_overview();
CREATE OR REPLACE FUNCTION public.admin_owner_overview()
RETURNS TABLE (
  owner_key TEXT, owner_name TEXT, boards INTEGER, stale INTEGER, never_checked INTEGER,
  oldest_check TIMESTAMPTZ, waiting_requests INTEGER, pending_replies INTEGER,
  token TEXT, last_opened_at TIMESTAMPTZ, last_saved_at TIMESTAMPTZ,
  contact_name TEXT, contact_phone TEXT, email TEXT, last_reminded_at TIMESTAMPTZ
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
BEGIN
  IF public.auth_role() IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'admins only' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
  WITH b AS (
    SELECT bo.id, bo.availability_checked_at AS checked, bo.contact_name AS cname, bo.contact_phone AS cphone,
           public.board_owner_key(bo.id) AS k, n.owner_name AS typed_name
      FROM public.boards bo LEFT JOIN public.board_owner_names n ON n.board_id = bo.id
     WHERE bo.status <> 'decommissioned'
  ), g AS (
    SELECT b.k,
           COUNT(*)::int AS boards,
           COUNT(*) FILTER (WHERE b.checked IS NULL OR b.checked < NOW() - INTERVAL '7 days')::int AS stale,
           COUNT(*) FILTER (WHERE b.checked IS NULL)::int AS never_checked,
           MIN(b.checked) AS oldest_check,
           MAX(b.typed_name) AS typed_name,
           (array_agg(b.cname ORDER BY b.cname IS NULL, b.cname))[1] AS cname,
           (array_agg(b.cphone ORDER BY b.cphone IS NULL OR b.cphone = '', b.cphone))[1] AS cphone
      FROM b GROUP BY b.k
  )
  SELECT g.k,
         COALESCE(l.owner_name,
                  CASE WHEN g.k IS NULL THEN NULL
                       WHEN g.k LIKE 'name:%' THEN g.typed_name
                       ELSE (SELECT COALESCE(NULLIF(trim(p.company_name), ''), p.full_name) FROM public.profiles p WHERE p.id::text = g.k) END),
         g.boards, g.stale, g.never_checked, g.oldest_check,
         (SELECT COUNT(*)::int FROM public.availability_requests r
           WHERE r.stage = 'requested' AND r.board_id IN (SELECT b.id FROM b WHERE b.k IS NOT DISTINCT FROM g.k)
             AND NOT EXISTS (SELECT 1 FROM public.owner_link_replies x WHERE x.request_id = r.id)),
         (SELECT COUNT(*)::int FROM public.owner_link_replies x WHERE x.status = 'pending' AND x.owner_key = g.k),
         l.token, l.last_opened_at, l.last_saved_at,
         COALESCE(sc.contact_name, g.cname), COALESCE(NULLIF(sc.contact_phone, ''), g.cphone),
         l.email, l.last_reminded_at
    FROM g
    LEFT JOIN public.owner_links l ON l.owner_key = g.k
    LEFT JOIN LATERAL (
      SELECT s.contact_name, s.contact_phone FROM public.owner_sales_contacts s
       WHERE s.owner_key = g.k AND s.contact_phone <> ''
       ORDER BY s.last_used_at DESC LIMIT 1
    ) sc ON true
   ORDER BY g.k IS NULL, g.stale DESC, g.boards DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_owner_overview() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_owner_overview() TO authenticated;
