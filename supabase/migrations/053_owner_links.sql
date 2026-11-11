-- ═══════════════════════════════════════════════════════════════════
-- OOH Platform — owner links (no login) and the "Needs checking" list
-- Run in Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- Requires 043, 045, 047, 048. Safe to re-run.
--
-- Most media owners are not on the platform. Our team sends each owner a
-- private link (WhatsApp). On it, without logging in, the owner:
--   * confirms each week which of their boards are free, booked (until
--     when) or off; and
--   * answers buyer requests for their boards (available? price? dates?).
-- Owner answers do NOT go straight to the buyer. They wait in
-- owner_link_replies until our team checks them and sends them on
-- (admin_send_owner_reply), so the team can correct a price first.
--
-- An owner is identified by the same key as owner_sales_contacts (048):
-- their account id, or 'name:' + the tidied owner name (047).
-- ═══════════════════════════════════════════════════════════════════

-- ── 1. When a board's availability was last confirmed ───────────────────
ALTER TABLE public.boards ADD COLUMN IF NOT EXISTS availability_checked_at TIMESTAMPTZ;

-- ── 2. Which owner a board belongs to ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.board_owner_key(p_board_id UUID)
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    public.board_owner_account(p_board_id)::text,
    (SELECT 'name:' || left(lower(regexp_replace(btrim(n.owner_name), '\s+', ' ', 'g')), 200)
       FROM public.board_owner_names n WHERE n.board_id = p_board_id)
  );
$$;
REVOKE ALL ON FUNCTION public.board_owner_key(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.board_owner_key(UUID) TO authenticated;

-- ── 3. Tables ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.owner_links (
  owner_key      TEXT PRIMARY KEY CHECK (length(owner_key) BETWEEN 1 AND 220),
  owner_name     TEXT NOT NULL CHECK (length(owner_name) BETWEEN 1 AND 200),
  token          TEXT NOT NULL UNIQUE DEFAULT replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  created_by     UUID NOT NULL REFERENCES auth.users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  open_count     INTEGER NOT NULL DEFAULT 0,
  last_opened_at TIMESTAMPTZ,
  last_saved_at  TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.owner_link_replies (
  request_id     UUID PRIMARY KEY REFERENCES public.availability_requests(id) ON DELETE CASCADE,
  owner_key      TEXT NOT NULL,
  available      BOOLEAN NOT NULL,
  quoted_rate    NUMERIC CHECK (quoted_rate IS NULL OR quoted_rate > 0),
  available_from DATE,
  available_to   DATE,
  conditions     TEXT CHECK (conditions IS NULL OR length(conditions) <= 500),
  note           TEXT CHECK (note IS NULL OR length(note) <= 1000),
  status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'dismissed')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_by    UUID,
  reviewed_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_owner_link_replies_status ON public.owner_link_replies(status, updated_at DESC);

-- Admins only. Owners reach their rows through the token functions below.
ALTER TABLE public.owner_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.owner_link_replies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS owner_links_admin ON public.owner_links;
CREATE POLICY owner_links_admin ON public.owner_links FOR ALL
  USING (public.auth_role() = 'admin') WITH CHECK (public.auth_role() = 'admin');
DROP POLICY IF EXISTS owner_link_replies_admin ON public.owner_link_replies;
CREATE POLICY owner_link_replies_admin ON public.owner_link_replies FOR ALL
  USING (public.auth_role() = 'admin') WITH CHECK (public.auth_role() = 'admin');
REVOKE ALL ON public.owner_links, public.owner_link_replies FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.owner_links, public.owner_link_replies TO authenticated;

-- ── 4. Owner side (anyone holding the link) ─────────────────────────────
CREATE OR REPLACE FUNCTION public.owner_link_key(p_token TEXT)
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT owner_key FROM public.owner_links WHERE token = p_token AND length(p_token) >= 32;
$$;
REVOKE ALL ON FUNCTION public.owner_link_key(TEXT) FROM PUBLIC, anon, authenticated;

-- Everything the owner page shows. Buyer email/phone and budget stay hidden.
CREATE OR REPLACE FUNCTION public.owner_link_view(p_token TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_key  TEXT := public.owner_link_key(p_token);
  v_out  JSONB;
BEGIN
  IF v_key IS NULL THEN RETURN NULL; END IF;
  UPDATE public.owner_links SET open_count = open_count + 1, last_opened_at = NOW() WHERE owner_key = v_key;

  WITH mine AS (
    SELECT b.* FROM public.boards b
     WHERE b.status <> 'decommissioned' AND public.board_owner_key(b.id) = v_key
  )
  SELECT jsonb_build_object(
    'owner_name', (SELECT owner_name FROM public.owner_links WHERE owner_key = v_key),
    'boards', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', m.id, 'name', m.name, 'area', m.area, 'city', m.city, 'format', m.format,
        'photo', m.photo_urls[1], 'status', m.status, 'available_from', m.available_from,
        'checked_at', m.availability_checked_at) ORDER BY m.city, m.name) FROM mine m), '[]'::jsonb),
    'requests', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', r.id, 'board_id', r.board_id, 'board_name', m.name, 'photo', m.photo_urls[1],
        'start_date', r.start_date, 'end_date', r.end_date,
        'company', COALESCE(NULLIF(c.company, ''), r.agency_name, 'A buyer'),
        'message', r.notes, 'extra', r.extra_requirements, 'created_at', r.created_at,
        'reply', CASE WHEN x.request_id IS NULL THEN NULL ELSE jsonb_build_object(
          'available', x.available, 'quoted_rate', x.quoted_rate, 'available_from', x.available_from,
          'available_to', x.available_to, 'conditions', x.conditions, 'note', x.note, 'status', x.status) END)
        ORDER BY r.created_at DESC)
      FROM public.availability_requests r
      JOIN mine m ON m.id = r.board_id
      LEFT JOIN public.availability_request_contacts c ON c.request_id = r.id
      LEFT JOIN public.owner_link_replies x ON x.request_id = r.id
      WHERE r.stage IN ('requested', 'owner_responded', 'quote_received', 'unavailable')
        AND r.created_at > NOW() - INTERVAL '60 days'), '[]'::jsonb)
  ) INTO v_out;
  RETURN v_out;
END;
$$;

-- The weekly check: p_updates = [{id, status: available|booked|unavailable, available_from}]
CREATE OR REPLACE FUNCTION public.owner_link_update_boards(p_token TEXT, p_updates JSONB)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_key   TEXT := public.owner_link_key(p_token);
  v_item  JSONB;
  v_id    UUID;
  v_stat  TEXT;
  v_from  DATE;
  v_n     INTEGER := 0;
BEGIN
  IF v_key IS NULL THEN RAISE EXCEPTION 'This link is not valid any more' USING ERRCODE = '42501'; END IF;
  IF jsonb_typeof(p_updates) <> 'array' OR jsonb_array_length(p_updates) > 500 THEN
    RAISE EXCEPTION 'Nothing to save' USING ERRCODE = '22023';
  END IF;
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_updates) LOOP
    v_id   := (v_item->>'id')::uuid;
    v_stat := v_item->>'status';
    v_from := NULLIF(v_item->>'available_from', '')::date;
    IF v_stat NOT IN ('available', 'booked', 'unavailable') THEN
      RAISE EXCEPTION 'Unknown status' USING ERRCODE = '22023';
    END IF;
    IF v_stat = 'booked' AND v_from IS NULL THEN
      RAISE EXCEPTION 'Add the date a booked board is free again' USING ERRCODE = '22023';
    END IF;
    -- Only this owner's boards, and never a removed board.
    UPDATE public.boards
       SET status = v_stat,
           available_from = CASE WHEN v_stat = 'booked' THEN v_from ELSE NULL END,
           availability_checked_at = NOW()
     WHERE id = v_id AND status <> 'decommissioned' AND public.board_owner_key(id) = v_key;
    IF FOUND THEN v_n := v_n + 1; END IF;
  END LOOP;
  UPDATE public.owner_links SET last_saved_at = NOW() WHERE owner_key = v_key;
  RETURN v_n;
END;
$$;

-- The owner's answer to a buyer request. Waits for our team to check it.
CREATE OR REPLACE FUNCTION public.owner_link_reply(
  p_token TEXT, p_request_id UUID, p_available BOOLEAN, p_rate NUMERIC,
  p_from DATE, p_to DATE, p_conditions TEXT, p_note TEXT
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_key   TEXT := public.owner_link_key(p_token);
  v_req   public.availability_requests%ROWTYPE;
  v_owner TEXT;
  v_board TEXT;
BEGIN
  IF v_key IS NULL THEN RAISE EXCEPTION 'This link is not valid any more' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_req FROM public.availability_requests WHERE id = p_request_id;
  IF NOT FOUND OR v_req.board_id IS NULL OR public.board_owner_key(v_req.board_id) IS DISTINCT FROM v_key THEN
    RAISE EXCEPTION 'Request not found' USING ERRCODE = '22023';
  END IF;
  IF v_req.stage NOT IN ('requested', 'owner_responded', 'quote_received', 'unavailable') THEN
    RAISE EXCEPTION 'This request is already being booked. Call our team to change anything.' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.owner_link_replies WHERE request_id = p_request_id AND status = 'sent') THEN
    RAISE EXCEPTION 'Your answer was already sent to the buyer. Call our team to change it.' USING ERRCODE = '22023';
  END IF;
  IF p_available IS NULL THEN RAISE EXCEPTION 'Say if the board is available' USING ERRCODE = '22023'; END IF;
  IF p_rate IS NOT NULL AND p_rate <= 0 THEN RAISE EXCEPTION 'The price must be more than zero' USING ERRCODE = '22023'; END IF;
  IF p_from IS NOT NULL AND p_to IS NOT NULL AND p_to < p_from THEN
    RAISE EXCEPTION 'The end date is before the start date' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.owner_link_replies (request_id, owner_key, available, quoted_rate, available_from, available_to, conditions, note)
  VALUES (p_request_id, v_key, p_available,
          CASE WHEN p_available THEN p_rate END,
          CASE WHEN p_available THEN p_from END, CASE WHEN p_available THEN p_to END,
          CASE WHEN p_available THEN left(NULLIF(trim(p_conditions), ''), 500) END,
          left(NULLIF(trim(p_note), ''), 1000))
  ON CONFLICT (request_id) DO UPDATE SET
    available = EXCLUDED.available, quoted_rate = EXCLUDED.quoted_rate,
    available_from = EXCLUDED.available_from, available_to = EXCLUDED.available_to,
    conditions = EXCLUDED.conditions, note = EXCLUDED.note,
    status = 'pending', updated_at = NOW(), reviewed_by = NULL, reviewed_at = NULL;

  UPDATE public.owner_links SET last_saved_at = NOW() WHERE owner_key = v_key;

  SELECT owner_name INTO v_owner FROM public.owner_links WHERE owner_key = v_key;
  SELECT name INTO v_board FROM public.boards WHERE id = v_req.board_id;
  INSERT INTO public.notifications (recipient_role, recipient_user_id, type, title, body, link)
  VALUES ('admin', NULL, 'availability_response',
          v_owner || ' answered a request for ' || COALESCE(v_board, 'a board'),
          CASE WHEN p_available THEN 'Available' || COALESCE(' · ₦' || to_char(p_rate, 'FM999,999,999,990') || '/month', '')
               ELSE 'Not available' END || ' · check it and send it to the buyer',
          '/dashboard/admin/needs-checking');
END;
$$;

REVOKE ALL ON FUNCTION public.owner_link_view(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.owner_link_update_boards(TEXT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.owner_link_reply(TEXT, UUID, BOOLEAN, NUMERIC, DATE, DATE, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.owner_link_view(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.owner_link_update_boards(TEXT, JSONB) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.owner_link_reply(TEXT, UUID, BOOLEAN, NUMERIC, DATE, DATE, TEXT, TEXT) TO anon, authenticated;

-- ── 5. Team side ─────────────────────────────────────────────────────────
-- Get (or make) an owner's link. p_new = true replaces the old link, which
-- then stops working.
CREATE OR REPLACE FUNCTION public.admin_owner_link(p_owner_key TEXT, p_owner_name TEXT, p_new BOOLEAN DEFAULT false)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_token TEXT;
BEGIN
  IF public.auth_role() IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'admins only' USING ERRCODE = '42501'; END IF;
  IF COALESCE(trim(p_owner_key), '') = '' THEN RAISE EXCEPTION 'Set the board owner first' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.owner_links (owner_key, owner_name, created_by)
  VALUES (p_owner_key, left(COALESCE(NULLIF(trim(p_owner_name), ''), 'Board owner'), 200), auth.uid())
  ON CONFLICT (owner_key) DO UPDATE SET
    owner_name = EXCLUDED.owner_name,
    token = CASE WHEN p_new THEN replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '') ELSE public.owner_links.token END,
    created_by = CASE WHEN p_new THEN auth.uid() ELSE public.owner_links.created_by END,
    created_at = CASE WHEN p_new THEN NOW() ELSE public.owner_links.created_at END
  RETURNING token INTO v_token;
  RETURN v_token;
END;
$$;

-- One row per owner for the "Needs checking" page.
CREATE OR REPLACE FUNCTION public.admin_owner_overview()
RETURNS TABLE (
  owner_key TEXT, owner_name TEXT, boards INTEGER, stale INTEGER, never_checked INTEGER,
  oldest_check TIMESTAMPTZ, waiting_requests INTEGER, pending_replies INTEGER,
  token TEXT, last_opened_at TIMESTAMPTZ, last_saved_at TIMESTAMPTZ,
  contact_name TEXT, contact_phone TEXT
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
         COALESCE(sc.contact_name, g.cname), COALESCE(NULLIF(sc.contact_phone, ''), g.cphone)
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

-- Send an owner's checked answer to the buyer (optionally with a corrected
-- price), through the same path as an answer typed by our team (045).
CREATE OR REPLACE FUNCTION public.admin_send_owner_reply(p_request_id UUID, p_rate NUMERIC)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_x  public.owner_link_replies%ROWTYPE;
  v_id UUID;
BEGIN
  IF public.auth_role() IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'admins only' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_x FROM public.owner_link_replies WHERE request_id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No owner answer for this request' USING ERRCODE = '22023'; END IF;
  IF v_x.status = 'sent' THEN RAISE EXCEPTION 'Already sent to the buyer' USING ERRCODE = '22023'; END IF;
  v_id := public.admin_answer_board_request(
    p_request_id, v_x.available, CASE WHEN v_x.available THEN COALESCE(p_rate, v_x.quoted_rate) END,
    v_x.available_from, v_x.available_to, v_x.conditions, v_x.note);
  UPDATE public.owner_link_replies
     SET status = 'sent', reviewed_by = auth.uid(), reviewed_at = NOW(),
         quoted_rate = CASE WHEN v_x.available THEN COALESCE(p_rate, v_x.quoted_rate) END
   WHERE request_id = p_request_id;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_owner_link(TEXT, TEXT, BOOLEAN) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_owner_overview() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_send_owner_reply(UUID, NUMERIC) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_owner_link(TEXT, TEXT, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_owner_overview() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_send_owner_reply(UUID, NUMERIC) TO authenticated;
