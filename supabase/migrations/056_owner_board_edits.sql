-- ═══════════════════════════════════════════════════════════════════
-- OOH Platform — owners correct their boards from their link
-- Run in Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- Requires 053. Safe to re-run.
--
-- On their private link (/o/[token]) an owner can open a board, see its
-- photo and details, and send a correction: a better photo, or the right
-- name, area, address, size or lighting. Like their answers to buyers,
-- a correction does NOT change the listing straight away. It waits in
-- owner_board_edits until our team applies or dismisses it on Needs
-- Checking, so nobody holding a link can change what buyers see unchecked.
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.owner_board_edits (
  board_id    UUID PRIMARY KEY REFERENCES public.boards(id) ON DELETE CASCADE,
  owner_key   TEXT NOT NULL,
  changes     JSONB NOT NULL DEFAULT '{}'::jsonb,   -- only the fields that differ: name, area, address, width, height, illuminated
  photo_url   TEXT CHECK (photo_url IS NULL OR length(photo_url) <= 600),
  note        TEXT CHECK (note IS NULL OR length(note) <= 500),
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'applied', 'dismissed')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_by UUID,
  reviewed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_owner_board_edits_status ON public.owner_board_edits(status, updated_at);

-- Admins only. Owners reach their rows through the token functions below.
ALTER TABLE public.owner_board_edits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS owner_board_edits_admin ON public.owner_board_edits;
CREATE POLICY owner_board_edits_admin ON public.owner_board_edits FOR ALL
  USING (public.auth_role() = 'admin') WITH CHECK (public.auth_role() = 'admin');
REVOKE ALL ON public.owner_board_edits FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.owner_board_edits TO authenticated;

-- Does this link own this board? Used by the photo upload route (server only).
CREATE OR REPLACE FUNCTION public.owner_link_owns(p_token TEXT, p_board_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(public.owner_link_key(p_token) = public.board_owner_key(p_board_id), false)
     AND EXISTS (SELECT 1 FROM public.boards WHERE id = p_board_id AND status <> 'decommissioned');
$$;
REVOKE ALL ON FUNCTION public.owner_link_owns(TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.owner_link_owns(TEXT, UUID) TO service_role;

-- The owner page: now also each board's details, all photos and any
-- correction that is waiting. Buyer email/phone and budget stay hidden.
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
        'checked_at', m.availability_checked_at,
        'address', m.address, 'width', m.width, 'height', m.height, 'illuminated', m.illuminated,
        'photos', COALESCE(to_jsonb(m.photo_urls), '[]'::jsonb),
        'edit', (SELECT jsonb_build_object('changes', e.changes, 'photo_url', e.photo_url, 'note', e.note,
                                           'status', e.status, 'updated_at', e.updated_at)
                   FROM public.owner_board_edits e
                  WHERE e.board_id = m.id AND (e.status = 'pending' OR e.updated_at > NOW() - INTERVAL '14 days'))
        ) ORDER BY m.city, m.name) FROM mine m), '[]'::jsonb),
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
REVOKE ALL ON FUNCTION public.owner_link_view(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.owner_link_view(TEXT) TO anon, authenticated;

-- The owner sends a correction. p_changes may hold name, area, address,
-- width, height, illuminated; only values that differ from the listing are
-- kept. p_photo_url must be a photo uploaded for this board through the
-- upload route. Sending again replaces the waiting correction.
CREATE OR REPLACE FUNCTION public.owner_link_suggest_edit(
  p_token TEXT, p_board_id UUID, p_changes JSONB, p_photo_url TEXT, p_note TEXT
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_key   TEXT := public.owner_link_key(p_token);
  v_b     public.boards%ROWTYPE;
  v_in    JSONB := COALESCE(p_changes, '{}'::jsonb);
  v_out   JSONB := '{}'::jsonb;
  v_txt   TEXT;
  v_num   NUMERIC;
  v_k     TEXT;
  v_photo TEXT := NULLIF(trim(COALESCE(p_photo_url, '')), '');
  v_note  TEXT := left(NULLIF(trim(COALESCE(p_note, '')), ''), 500);
  v_owner TEXT;
BEGIN
  IF v_key IS NULL THEN RAISE EXCEPTION 'This link is not valid any more' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_b FROM public.boards WHERE id = p_board_id AND status <> 'decommissioned';
  IF NOT FOUND OR public.board_owner_key(p_board_id) IS DISTINCT FROM v_key THEN
    RAISE EXCEPTION 'Board not found' USING ERRCODE = '22023';
  END IF;

  IF v_in ? 'name' THEN
    v_txt := regexp_replace(btrim(v_in->>'name'), '\s+', ' ', 'g');
    IF length(v_txt) < 2 OR length(v_txt) > 200 THEN RAISE EXCEPTION 'The board name is too short or too long' USING ERRCODE = '22023'; END IF;
    IF v_txt IS DISTINCT FROM v_b.name THEN v_out := v_out || jsonb_build_object('name', v_txt); END IF;
  END IF;
  IF v_in ? 'area' THEN
    v_txt := left(regexp_replace(btrim(COALESCE(v_in->>'area', '')), '\s+', ' ', 'g'), 120);
    IF v_txt IS DISTINCT FROM COALESCE(v_b.area, '') THEN v_out := v_out || jsonb_build_object('area', v_txt); END IF;
  END IF;
  IF v_in ? 'address' THEN
    v_txt := left(regexp_replace(btrim(COALESCE(v_in->>'address', '')), '\s+', ' ', 'g'), 300);
    IF v_txt <> '' AND v_txt IS DISTINCT FROM COALESCE(v_b.address, '') THEN v_out := v_out || jsonb_build_object('address', v_txt); END IF;
  END IF;
  FOREACH v_k IN ARRAY ARRAY['width', 'height'] LOOP
    IF v_in ? v_k AND NULLIF(btrim(v_in->>v_k), '') IS NOT NULL THEN
      BEGIN
        v_num := round((v_in->>v_k)::numeric, 2);
      EXCEPTION WHEN others THEN
        RAISE EXCEPTION 'The size must be a number in metres' USING ERRCODE = '22023';
      END;
      IF v_num <= 0 OR v_num > 200 THEN RAISE EXCEPTION 'The size must be between 0 and 200 metres' USING ERRCODE = '22023'; END IF;
      IF v_num IS DISTINCT FROM (CASE WHEN v_k = 'width' THEN v_b.width ELSE v_b.height END)::numeric THEN
        v_out := v_out || jsonb_build_object(v_k, v_num);
      END IF;
    END IF;
  END LOOP;
  IF v_in ? 'illuminated' AND jsonb_typeof(v_in->'illuminated') = 'boolean' THEN
    IF (v_in->>'illuminated')::boolean IS DISTINCT FROM v_b.illuminated THEN
      v_out := v_out || jsonb_build_object('illuminated', (v_in->>'illuminated')::boolean);
    END IF;
  END IF;

  IF v_photo IS NOT NULL AND v_photo NOT LIKE 'https://%/storage/v1/object/public/board-photos/owner-link/' || p_board_id::text || '/%' THEN
    RAISE EXCEPTION 'That photo could not be used. Please add it again.' USING ERRCODE = '22023';
  END IF;

  IF v_out = '{}'::jsonb AND v_photo IS NULL AND v_note IS NULL THEN
    RAISE EXCEPTION 'Nothing was changed' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.owner_board_edits (board_id, owner_key, changes, photo_url, note)
  VALUES (p_board_id, v_key, v_out, v_photo, v_note)
  ON CONFLICT (board_id) DO UPDATE SET
    owner_key = EXCLUDED.owner_key, changes = EXCLUDED.changes, photo_url = EXCLUDED.photo_url, note = EXCLUDED.note,
    status = 'pending', updated_at = NOW(), reviewed_by = NULL, reviewed_at = NULL;

  UPDATE public.owner_links SET last_saved_at = NOW() WHERE owner_key = v_key;

  SELECT owner_name INTO v_owner FROM public.owner_links WHERE owner_key = v_key;
  INSERT INTO public.notifications (recipient_role, recipient_user_id, type, title, body, link)
  VALUES ('admin', NULL, 'availability_response',
          COALESCE(v_owner, 'An owner') || ' sent a correction for ' || v_b.name,
          'Check it and apply it so buyers see the right details',
          '/dashboard/admin/needs-checking');
END;
$$;
REVOKE ALL ON FUNCTION public.owner_link_suggest_edit(TEXT, UUID, JSONB, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.owner_link_suggest_edit(TEXT, UUID, JSONB, TEXT, TEXT) TO anon, authenticated;

-- Team side: the corrections waiting, with what the listing says now.
CREATE OR REPLACE FUNCTION public.admin_owner_board_edits()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.auth_role() IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'admins only' USING ERRCODE = '42501'; END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'board_id', e.board_id, 'owner_key', e.owner_key,
      'owner_name', (SELECT l.owner_name FROM public.owner_links l WHERE l.owner_key = e.owner_key),
      'changes', e.changes, 'photo_url', e.photo_url, 'note', e.note, 'updated_at', e.updated_at,
      'now', jsonb_build_object('name', b.name, 'area', b.area, 'city', b.city, 'address', b.address, 'width', b.width,
                                'height', b.height, 'illuminated', b.illuminated, 'photo', b.photo_urls[1])
    ) ORDER BY e.updated_at)
    FROM public.owner_board_edits e JOIN public.boards b ON b.id = e.board_id
    WHERE e.status = 'pending'), '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_owner_board_edits() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_owner_board_edits() TO authenticated;

-- Apply a correction to the listing (the new photo becomes the main photo
-- and the old ones are kept after it), or dismiss it.
CREATE OR REPLACE FUNCTION public.admin_decide_owner_board_edit(p_board_id UUID, p_apply BOOLEAN)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_e public.owner_board_edits%ROWTYPE;
BEGIN
  IF public.auth_role() IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'admins only' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_e FROM public.owner_board_edits WHERE board_id = p_board_id AND status = 'pending' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No correction is waiting for this board' USING ERRCODE = '22023'; END IF;

  IF p_apply THEN
    UPDATE public.boards b SET
      name        = COALESCE(v_e.changes->>'name', b.name),
      area        = CASE WHEN v_e.changes ? 'area' THEN NULLIF(v_e.changes->>'area', '') ELSE b.area END,
      address     = COALESCE(v_e.changes->>'address', b.address),
      width       = COALESCE((v_e.changes->>'width')::numeric, b.width),
      height      = COALESCE((v_e.changes->>'height')::numeric, b.height),
      illuminated = COALESCE((v_e.changes->>'illuminated')::boolean, b.illuminated),
      photo_urls  = CASE WHEN v_e.photo_url IS NULL THEN b.photo_urls
                         ELSE array_prepend(v_e.photo_url, array_remove(COALESCE(b.photo_urls, '{}'), v_e.photo_url)) END
    WHERE b.id = p_board_id;
  END IF;

  UPDATE public.owner_board_edits
     SET status = CASE WHEN p_apply THEN 'applied' ELSE 'dismissed' END, reviewed_by = auth.uid(), reviewed_at = NOW(), updated_at = NOW()
   WHERE board_id = p_board_id;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_decide_owner_board_edit(UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_decide_owner_board_edit(UUID, BOOLEAN) TO authenticated;

