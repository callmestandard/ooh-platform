-- ═══════════════════════════════════════════════════════════════════
-- OOH Platform — private artwork and proof photos; booking → artwork →
-- install → proof approved, with nothing shown as live until our team
-- has approved a real photo.
-- Run in Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- Requires 061 (quotations) and 063. Safe to re-run. Deletes no rows or files.
--
-- Found in the Phase 5 audit:
--   • compliance-photos and creatives were public buckets: anyone with a
--     link could open a buyer's artwork or a proof photo, and anyone (even
--     signed out) could upload into compliance-photos.
--   • anyone could insert a proof record for any booking (compliance_insert
--     WITH CHECK (true)); buyers could edit their own proof records.
--   • the install link marked a booking "live" the moment any photo was
--     sent, before anyone looked at it.
--
-- Now:
--   • Both buckets are private, with size and file-type limits. A signed-in
--     person can open (via a short-lived link) or upload a file only in a
--     booking folder they belong to: our team, the buyer, or the board's
--     owner account. Buyers see a proof photo only after we approve it.
--   • Proofs are recorded only by the server (install link) or our team.
--     Only our team approves or rejects them; approving one makes the
--     booking live and tells the buyer.
--   • Install links (bookings.poe_token) are long random tokens, work only
--     while the booking is confirmed or live (until 30 days after it ends),
--     and are limited to 10 photos a day.
--   • Artwork: the buyer (or our team) uploads it; only our team approves it
--     or asks for changes.
--
-- Rollback: see the end of the file.
-- ═══════════════════════════════════════════════════════════════════

-- ── 1. Who may see or add a booking's files ─────────────────────────────
-- Files live in a booking folder: creatives/<booking>/…, compliance-photos/poe/<booking>/…, compliance-photos/print/<booking>/…
CREATE OR REPLACE FUNCTION public.booking_from_path(p_name TEXT)
RETURNS UUID LANGUAGE sql IMMUTABLE AS $$
  SELECT (regexp_match(p_name, '([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})'))[1]::uuid
$$;

-- 'buyer' (campaign's agency or client), 'owner' (board's owner account), 'admin', or NULL.
CREATE OR REPLACE FUNCTION public.booking_party(p_booking UUID)
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN auth.uid() IS NULL OR p_booking IS NULL THEN NULL
    WHEN public.is_admin() THEN 'admin'
    WHEN EXISTS (SELECT 1 FROM public.bookings b JOIN public.campaigns c ON c.id = b.campaign_id
                  WHERE b.id = p_booking AND (c.agency_id = auth.uid() OR c.client_id = auth.uid())) THEN 'buyer'
    WHEN EXISTS (SELECT 1 FROM public.bookings b WHERE b.id = p_booking AND public.board_owner_account(b.board_id) = auth.uid()) THEN 'owner'
  END
$$;

CREATE OR REPLACE FUNCTION public.can_view_booking_file(p_bucket TEXT, p_name TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_party TEXT := public.booking_party(public.booking_from_path(p_name));
BEGIN
  IF v_party IS NULL THEN RETURN false; END IF;
  IF v_party IN ('admin', 'owner') THEN RETURN true; END IF;
  -- buyer
  IF p_bucket = 'creatives' OR p_name LIKE 'print/%' THEN RETURN true; END IF;
  RETURN EXISTS (SELECT 1 FROM public.compliance_checks c
                  WHERE c.status = 'verified' AND (c.photo_path = p_name OR c.photo_url LIKE '%/' || p_name));
END;
$$;

CREATE OR REPLACE FUNCTION public.can_upload_booking_file(p_bucket TEXT, p_name TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_b UUID := public.booking_from_path(p_name);
  v_party TEXT := public.booking_party(v_b);
BEGIN
  IF v_party IS NULL THEN RETURN false; END IF;
  IF v_party = 'admin' THEN RETURN true; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.bookings WHERE id = v_b AND status IN ('agreed', 'signed', 'live')) THEN RETURN false; END IF;
  IF p_bucket = 'creatives' THEN RETURN v_party = 'buyer' AND p_name LIKE v_b::text || '/%'; END IF;
  -- Proof photos come through the install link (server) or our team; owner accounts may add print photos.
  RETURN p_bucket = 'compliance-photos' AND v_party = 'owner' AND p_name LIKE 'print/' || v_b::text || '/%';
END;
$$;
REVOKE ALL ON FUNCTION public.booking_party(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_view_booking_file(TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_upload_booking_file(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.booking_party(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_view_booking_file(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_upload_booking_file(TEXT, TEXT) TO authenticated;

-- ── 2. Proof and artwork records ─────────────────────────────────────────
ALTER TABLE public.compliance_checks ADD COLUMN IF NOT EXISTS photo_path TEXT;
ALTER TABLE public.compliance_checks ADD COLUMN IF NOT EXISTS distance_m NUMERIC;
ALTER TABLE public.compliance_checks ADD COLUMN IF NOT EXISTS source TEXT;
ALTER TABLE public.compliance_checks ADD COLUMN IF NOT EXISTS reviewed_by UUID;
ALTER TABLE public.compliance_checks ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;
ALTER TABLE public.compliance_checks ADD COLUMN IF NOT EXISTS review_note TEXT;
ALTER TABLE public.compliance_checks ENABLE ROW LEVEL SECURITY;
-- Proofs are added by the server (install link) or through admin_record_proof; never straight from a browser.
DROP POLICY IF EXISTS "compliance_insert" ON public.compliance_checks;
DROP POLICY IF EXISTS "compliance_update" ON public.compliance_checks;
CREATE POLICY "compliance_update" ON public.compliance_checks FOR UPDATE USING (public.is_admin()) WITH CHECK (public.is_admin());

ALTER TABLE public.creative_uploads ADD COLUMN IF NOT EXISTS file_path TEXT;
ALTER TABLE public.creative_uploads ADD COLUMN IF NOT EXISTS reviewed_by UUID;
ALTER TABLE public.creative_uploads ADD COLUMN IF NOT EXISTS review_note TEXT;
ALTER TABLE public.creative_uploads ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "creatives_insert" ON public.creative_uploads;
CREATE POLICY "creatives_insert" ON public.creative_uploads FOR INSERT WITH CHECK (
  public.is_admin()
  OR (status = 'uploaded' AND public.booking_party(booking_id) = 'buyer'
      AND EXISTS (SELECT 1 FROM public.bookings b WHERE b.id = booking_id AND b.status IN ('agreed', 'signed', 'live')))
);
-- Only our team approves artwork or asks for changes.
DROP POLICY IF EXISTS "creatives_update" ON public.creative_uploads;
CREATE POLICY "creatives_update" ON public.creative_uploads FOR UPDATE USING (public.is_admin()) WITH CHECK (public.is_admin());

-- A file recorded on a booking must sit in that booking's folder.
CREATE OR REPLACE FUNCTION public.booking_file_path_check()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_path TEXT := to_jsonb(NEW) ->> CASE WHEN TG_TABLE_NAME = 'creative_uploads' THEN 'file_path' ELSE 'photo_path' END;
BEGIN
  IF v_path IS NOT NULL AND public.booking_from_path(v_path) IS DISTINCT FROM NEW.booking_id THEN
    RAISE EXCEPTION 'That file belongs to another booking' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS creative_uploads_path_check ON public.creative_uploads;
CREATE TRIGGER creative_uploads_path_check BEFORE INSERT OR UPDATE OF file_path, booking_id ON public.creative_uploads
  FOR EACH ROW EXECUTE FUNCTION public.booking_file_path_check();
DROP TRIGGER IF EXISTS compliance_checks_path_check ON public.compliance_checks;
CREATE TRIGGER compliance_checks_path_check BEFORE INSERT OR UPDATE OF photo_path, booking_id ON public.compliance_checks
  FOR EACH ROW EXECUTE FUNCTION public.booking_file_path_check();

-- ── 3. Install links ─────────────────────────────────────────────────────
-- A new or replaced install link for a booking. Admins only.
CREATE OR REPLACE FUNCTION public.admin_poe_link(p_booking_id UUID, p_new BOOLEAN DEFAULT false)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_token TEXT;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admins only' USING ERRCODE = '42501'; END IF;
  SELECT poe_token INTO v_token FROM public.bookings WHERE id = p_booking_id
     AND status IN ('agreed', 'signed', 'live');
  IF NOT FOUND THEN RAISE EXCEPTION 'Confirm the booking first' USING ERRCODE = '22023'; END IF;
  IF v_token IS NULL OR length(v_token) < 32 OR p_new THEN
    v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
    UPDATE public.bookings SET poe_token = v_token WHERE id = p_booking_id;
  END IF;
  RETURN v_token;
END;
$$;

-- Only our team (or the server) sets install-link tokens.
CREATE OR REPLACE FUNCTION public.guard_poe_token()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR public.is_admin() THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN NEW.poe_token := NULL;
  ELSIF NEW.poe_token IS DISTINCT FROM OLD.poe_token THEN
    RAISE EXCEPTION 'Only OOH Platform can make install links' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS bookings_guard_poe_token ON public.bookings;
CREATE TRIGGER bookings_guard_poe_token BEFORE INSERT OR UPDATE OF poe_token ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.guard_poe_token();

-- The booking an install link opens, if it still works.
CREATE OR REPLACE FUNCTION public.poe_link_booking(p_token TEXT)
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM public.bookings
   WHERE poe_token = p_token AND length(p_token) >= 32
     AND status IN ('agreed', 'signed', 'live')
     AND (end_date IS NULL OR end_date >= public.lagos_today() - 30)
$$;
REVOKE ALL ON FUNCTION public.poe_link_booking(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.poe_link_booking(TEXT) TO service_role;

-- What the install page shows (server only): the board, the dates and the approved artwork to put up.
CREATE OR REPLACE FUNCTION public.poe_view(p_token TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_b UUID := public.poe_link_booking(p_token);
BEGIN
  IF v_b IS NULL THEN RETURN NULL; END IF;
  RETURN (
    SELECT jsonb_build_object(
      'booking_id', b.id, 'status', b.status, 'start_date', b.start_date, 'end_date', b.end_date,
      'campaign', c.name,
      'board', jsonb_build_object('name', bo.name, 'address', bo.address, 'area', bo.area, 'city', bo.city, 'format', bo.format,
                                  'width', bo.width, 'height', bo.height, 'latitude', bo.latitude, 'longitude', bo.longitude),
      'artwork', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', u.id, 'file_name', u.file_name, 'path', u.file_path, 'mime_type', u.mime_type) ORDER BY u.created_at DESC)
                            FROM public.creative_uploads u WHERE u.booking_id = b.id AND u.status = 'approved' AND u.file_path IS NOT NULL), '[]'::jsonb),
      'proofs', COALESCE((SELECT jsonb_agg(jsonb_build_object('status', k.status, 'submitted_at', k.submitted_at, 'review_note', CASE WHEN k.status = 'flagged' THEN k.review_note END) ORDER BY k.submitted_at DESC)
                            FROM public.compliance_checks k WHERE k.booking_id = b.id), '[]'::jsonb)
    )
    FROM public.bookings b JOIN public.boards bo ON bo.id = b.board_id LEFT JOIN public.campaigns c ON c.id = b.campaign_id
   WHERE b.id = v_b);
END;
$$;
REVOKE ALL ON FUNCTION public.poe_view(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.poe_view(TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.metres_between(lat1 DOUBLE PRECISION, lng1 DOUBLE PRECISION, lat2 DOUBLE PRECISION, lng2 DOUBLE PRECISION)
RETURNS DOUBLE PRECISION LANGUAGE sql IMMUTABLE AS $$
  SELECT 6371000 * 2 * asin(sqrt(power(sin(radians(lat2 - lat1) / 2), 2)
         + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)))
$$;

-- A proof from the install link (server only, after it stored the photo). It waits for our team.
CREATE OR REPLACE FUNCTION public.poe_submit(p_token TEXT, p_path TEXT, p_lat DOUBLE PRECISION, p_lng DOUBLE PRECISION,
                                             p_name TEXT, p_notes TEXT, p_device TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_b    UUID := public.poe_link_booking(p_token);
  v_id   UUID;
  v_dist DOUBLE PRECISION;
  v_name TEXT := left(NULLIF(btrim(COALESCE(p_name, '')), ''), 120);
  v_board TEXT;
BEGIN
  IF v_b IS NULL THEN RAISE EXCEPTION 'This link is not valid any more' USING ERRCODE = '42501'; END IF;
  IF v_name IS NULL THEN RAISE EXCEPTION 'Add your name' USING ERRCODE = '22023'; END IF;
  IF p_path IS NULL OR p_path NOT LIKE 'poe/' || v_b::text || '/%' THEN RAISE EXCEPTION 'Photo missing' USING ERRCODE = '22023'; END IF;
  IF (SELECT COUNT(*) FROM public.compliance_checks WHERE booking_id = v_b AND submitted_at > NOW() - INTERVAL '1 day') >= 10 THEN
    RAISE EXCEPTION 'Too many photos today. Message our team if something is wrong.' USING ERRCODE = '54000';
  END IF;
  SELECT CASE WHEN p_lat IS NOT NULL AND p_lng IS NOT NULL AND bo.latitude IS NOT NULL AND bo.longitude IS NOT NULL
              THEN public.metres_between(p_lat, p_lng, bo.latitude, bo.longitude) END, bo.name
    INTO v_dist, v_board
    FROM public.bookings b JOIN public.boards bo ON bo.id = b.board_id WHERE b.id = v_b;
  INSERT INTO public.compliance_checks (booking_id, photo_path, latitude, longitude, distance_m, submitted_at, submitted_by, submitted_name,
                                        status, notes, device_info, source)
  VALUES (v_b, p_path, p_lat, p_lng, round(v_dist::numeric), NOW(), v_name, v_name, 'submitted',
          left(NULLIF(btrim(COALESCE(p_notes, '')), ''), 1000), left(p_device, 300), 'install_link')
  RETURNING id INTO v_id;
  INSERT INTO public.notifications (recipient_role, recipient_user_id, type, title, body, link)
  VALUES ('admin', NULL, 'poe_submitted', 'Install photo for ' || COALESCE(v_board, 'a board'),
          CASE WHEN v_dist IS NULL THEN 'No GPS to compare with the pin. Check the photo.'
               ELSE 'Taken about ' || round(v_dist)::text || ' m from the pin. Check and approve it.' END,
          '/dashboard/admin/campaigns');
  RETURN jsonb_build_object('id', v_id, 'distance_m', round(v_dist::numeric));
END;
$$;
REVOKE ALL ON FUNCTION public.poe_submit(TEXT, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.poe_submit(TEXT, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, TEXT, TEXT, TEXT) TO service_role;

-- ── 4. Our team: proofs and artwork ──────────────────────────────────────
-- A proof photo our team received another way (e.g. on WhatsApp) and uploaded to poe/<booking>/. It still needs approving.
CREATE OR REPLACE FUNCTION public.admin_record_proof(p_booking_id UUID, p_path TEXT, p_note TEXT DEFAULT NULL)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id UUID;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admins only' USING ERRCODE = '42501'; END IF;
  IF p_path IS NULL OR p_path NOT LIKE 'poe/' || p_booking_id::text || '/%' THEN RAISE EXCEPTION 'Photo missing' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.compliance_checks (booking_id, photo_path, submitted_at, submitted_by, submitted_name, status, notes, source)
  VALUES (p_booking_id, p_path, NOW(), 'OOH Platform team', 'OOH Platform team', 'submitted', left(NULLIF(btrim(COALESCE(p_note, '')), ''), 1000), 'admin')
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- Approve (booking goes live, buyer is told) or reject (a reason is required) a proof.
CREATE OR REPLACE FUNCTION public.admin_review_proof(p_check_id UUID, p_approve BOOLEAN, p_note TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_c public.compliance_checks%ROWTYPE;
  v_buyer UUID; v_board TEXT; v_campaign TEXT;
  v_note TEXT := left(NULLIF(btrim(COALESCE(p_note, '')), ''), 500);
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admins only' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_c FROM public.compliance_checks WHERE id = p_check_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Proof not found' USING ERRCODE = '22023'; END IF;
  IF v_c.photo_path IS NULL AND v_c.photo_url IS NULL THEN RAISE EXCEPTION 'A proof needs a photo' USING ERRCODE = '22023'; END IF;
  IF NOT p_approve AND v_note IS NULL THEN RAISE EXCEPTION 'Say what is wrong, so the installer can fix it' USING ERRCODE = '22023'; END IF;
  UPDATE public.compliance_checks
     SET status = CASE WHEN p_approve THEN 'verified' ELSE 'flagged' END, reviewed_by = auth.uid(), reviewed_at = NOW(), review_note = v_note
   WHERE id = p_check_id;
  IF p_approve THEN
    UPDATE public.bookings SET status = 'live' WHERE id = v_c.booking_id AND status IN ('agreed', 'signed');
    SELECT c.agency_id, bo.name, c.name INTO v_buyer, v_board, v_campaign
      FROM public.bookings b JOIN public.boards bo ON bo.id = b.board_id LEFT JOIN public.campaigns c ON c.id = b.campaign_id
     WHERE b.id = v_c.booking_id;
    IF v_buyer IS NOT NULL THEN
      INSERT INTO public.notifications (recipient_role, recipient_user_id, type, title, body, link)
      VALUES ('agency', v_buyer, 'poe_verified', 'Your ad is up on ' || COALESCE(v_board, 'the board'),
              'We checked the install photo' || COALESCE(' for ' || v_campaign, '') || '. See it in My requests.', '/dashboard/agency/requests');
    END IF;
  END IF;
END;
$$;

-- Approve artwork, or ask for changes (a reason is required). The buyer is told either way.
CREATE OR REPLACE FUNCTION public.admin_review_artwork(p_id UUID, p_approve BOOLEAN, p_note TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_u public.creative_uploads%ROWTYPE;
  v_buyer UUID; v_board TEXT;
  v_note TEXT := left(NULLIF(btrim(COALESCE(p_note, '')), ''), 500);
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admins only' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_u FROM public.creative_uploads WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Artwork not found' USING ERRCODE = '22023'; END IF;
  IF NOT p_approve AND v_note IS NULL THEN RAISE EXCEPTION 'Say what needs changing' USING ERRCODE = '22023'; END IF;
  UPDATE public.creative_uploads SET status = CASE WHEN p_approve THEN 'approved' ELSE 'changes_requested' END,
         reviewed_by = auth.uid(), reviewed_at = NOW(), review_note = v_note, notes = COALESCE(v_note, notes)
   WHERE id = p_id;
  SELECT c.agency_id, bo.name INTO v_buyer, v_board
    FROM public.bookings b JOIN public.boards bo ON bo.id = b.board_id LEFT JOIN public.campaigns c ON c.id = b.campaign_id
   WHERE b.id = v_u.booking_id;
  IF v_buyer IS NOT NULL THEN
    INSERT INTO public.notifications (recipient_role, recipient_user_id, type, title, body, link)
    VALUES ('agency', v_buyer, 'message',
            CASE WHEN p_approve THEN 'Artwork approved for ' ELSE 'Changes needed to your artwork for ' END || COALESCE(v_board, 'your board'),
            COALESCE(v_note, 'We will now arrange printing and installation.'), '/dashboard/agency/requests');
  END IF;
END;
$$;

-- ── 5. Lists ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.booking_progress_json(p_b UUID, p_for_admin BOOLEAN)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'id', b.id, 'status', b.status, 'start_date', b.start_date, 'end_date', b.end_date, 'quotation_id', b.quotation_id,
    'confirmed', b.status IN ('signed', 'live', 'completed') OR b.confirmed_at IS NOT NULL,
    'campaign', jsonb_build_object('id', c.id, 'name', c.name, 'client_name', c.client_name),
    'board', jsonb_build_object('id', bo.id, 'name', bo.name, 'area', bo.area, 'city', bo.city, 'photo', bo.photo_urls[1]),
    'artwork', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', u.id, 'file_name', u.file_name, 'path', u.file_path, 'url', CASE WHEN u.file_path IS NULL THEN u.file_url END,
                         'mime_type', u.mime_type, 'file_size', u.file_size, 'status', u.status, 'review_note', u.review_note, 'created_at', u.created_at) ORDER BY u.created_at DESC)
                         FROM public.creative_uploads u WHERE u.booking_id = b.id), '[]'::jsonb),
    'proofs', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', k.id, 'status', k.status, 'submitted_at', k.submitted_at, 'reviewed_at', k.reviewed_at,
                         'path', CASE WHEN p_for_admin OR k.status = 'verified' THEN k.photo_path END,
                         'url', CASE WHEN k.photo_path IS NULL AND (p_for_admin OR k.status = 'verified') THEN k.photo_url END,
                         'distance_m', CASE WHEN p_for_admin THEN k.distance_m END, 'submitted_by', CASE WHEN p_for_admin THEN k.submitted_name END,
                         'notes', CASE WHEN p_for_admin THEN k.notes END, 'review_note', CASE WHEN p_for_admin THEN k.review_note END,
                         'source', CASE WHEN p_for_admin THEN k.source END) ORDER BY k.submitted_at DESC)
                         FROM public.compliance_checks k WHERE k.booking_id = b.id), '[]'::jsonb)
  ) || CASE WHEN p_for_admin THEN jsonb_build_object(
    'has_install_link', b.poe_token IS NOT NULL AND length(b.poe_token) >= 32,
    'quotation_ref', (SELECT q.ref FROM public.quotations q WHERE q.id = b.quotation_id),
    'owner', (SELECT jsonb_build_object('id', m.id, 'name', m.name,
                 'phone', (SELECT s.contact_phone FROM public.owner_sales_contacts s WHERE s.owner_key = m.owner_key AND s.contact_phone <> '' ORDER BY s.is_primary DESC, s.last_used_at DESC LIMIT 1))
              FROM public.media_owners m WHERE m.id = bo.media_owner_id),
    'board_phone', bo.contact_phone,
    'pinned', bo.latitude IS NOT NULL) ELSE '{}'::jsonb END
  FROM public.bookings b JOIN public.boards bo ON bo.id = b.board_id LEFT JOIN public.campaigns c ON c.id = b.campaign_id
  WHERE b.id = p_b
$$;
REVOKE ALL ON FUNCTION public.booking_progress_json(UUID, BOOLEAN) FROM PUBLIC, anon, authenticated;

-- Our team: every booking that came from a quotation, or is confirmed or live.
CREATE OR REPLACE FUNCTION public.admin_campaign_bookings()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admins only' USING ERRCODE = '42501'; END IF;
  RETURN COALESCE((SELECT jsonb_agg(public.booking_progress_json(b.id, true) ORDER BY b.start_date NULLS LAST, b.created_at)
                     FROM public.bookings b
                    WHERE b.status IN ('agreed', 'signed', 'live', 'completed') AND (b.quotation_id IS NOT NULL OR b.status <> 'agreed')), '[]'::jsonb);
END;
$$;

-- A buyer: their bookings, with only approved proof photos.
CREATE OR REPLACE FUNCTION public.my_campaign_bookings()
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(jsonb_agg(public.booking_progress_json(b.id, false) ORDER BY b.start_date NULLS LAST), '[]'::jsonb)
    FROM public.bookings b JOIN public.campaigns c ON c.id = b.campaign_id
   WHERE auth.uid() IS NOT NULL AND (c.agency_id = auth.uid() OR c.client_id = auth.uid())
     AND b.status IN ('agreed', 'signed', 'live', 'completed')
$$;

-- ── 6. Storage: private buckets, booking-folder rules ────────────────────
UPDATE storage.buckets SET public = false, file_size_limit = 10485760,
       allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
 WHERE id = 'compliance-photos';
UPDATE storage.buckets SET public = false, file_size_limit = 52428800,
       allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/tiff', 'application/pdf', 'application/zip', 'video/mp4',
                                  'application/postscript', 'application/illustrator', 'image/vnd.adobe.photoshop']
 WHERE id = 'creatives';

-- Reading (and so making short-lived links): booking-folder rule for these two buckets; others unchanged from 021.
DROP POLICY IF EXISTS "restrict_list_to_service_role" ON storage.objects;
CREATE POLICY "restrict_list_to_service_role" ON storage.objects AS RESTRICTIVE FOR SELECT USING (
  bucket_id NOT IN ('compliance-photos', 'creatives', 'board-photos', 'agency-logos', 'avatars')
  OR auth.role() = 'service_role'
  OR (bucket_id IN ('compliance-photos', 'creatives') AND auth.role() = 'authenticated' AND public.can_view_booking_file(bucket_id, name))
);
DROP POLICY IF EXISTS "booking_files_read" ON storage.objects;
CREATE POLICY "booking_files_read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id IN ('compliance-photos', 'creatives') AND public.can_view_booking_file(bucket_id, name));

-- Adding: board photos signed in (as 021); booking files only into a folder you belong to.
DROP POLICY IF EXISTS "restrict_insert_to_authenticated" ON storage.objects;
CREATE POLICY "restrict_insert_to_authenticated" ON storage.objects AS RESTRICTIVE FOR INSERT WITH CHECK (
  bucket_id NOT IN ('creatives', 'board-photos', 'compliance-photos')
  OR auth.role() = 'service_role'
  OR (bucket_id = 'board-photos' AND auth.role() = 'authenticated')
  OR (bucket_id IN ('creatives', 'compliance-photos') AND auth.role() = 'authenticated' AND public.can_upload_booking_file(bucket_id, name))
);
DROP POLICY IF EXISTS "booking_files_insert" ON storage.objects;
CREATE POLICY "booking_files_insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id IN ('compliance-photos', 'creatives') AND public.can_upload_booking_file(bucket_id, name));

-- Changing or deleting booking files: our team (or the server) only.
DROP POLICY IF EXISTS "booking_files_no_update" ON storage.objects;
CREATE POLICY "booking_files_no_update" ON storage.objects AS RESTRICTIVE FOR UPDATE USING (
  bucket_id NOT IN ('compliance-photos', 'creatives') OR auth.role() = 'service_role' OR public.is_admin()
);
DROP POLICY IF EXISTS "booking_files_no_delete" ON storage.objects;
CREATE POLICY "booking_files_no_delete" ON storage.objects AS RESTRICTIVE FOR DELETE USING (
  bucket_id NOT IN ('compliance-photos', 'creatives') OR auth.role() = 'service_role' OR public.is_admin()
);

-- ── 7. Who may call what ─────────────────────────────────────────────────
DO $$
DECLARE f TEXT;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.admin_poe_link(UUID, BOOLEAN)', 'public.admin_record_proof(UUID, TEXT, TEXT)',
    'public.admin_review_proof(UUID, BOOLEAN, TEXT)', 'public.admin_review_artwork(UUID, BOOLEAN, TEXT)',
    'public.admin_campaign_bookings()', 'public.my_campaign_bookings()'
  ] LOOP
    EXECUTE 'REVOKE ALL ON FUNCTION ' || f || ' FROM PUBLIC, anon';
    EXECUTE 'GRANT EXECUTE ON FUNCTION ' || f || ' TO authenticated';
  END LOOP;
END $$;

-- ═══════════════════════════════════════════════════════════════════
-- Rollback (by hand). Re-opening the buckets makes every file public again:
--   UPDATE storage.buckets SET public = true WHERE id IN ('compliance-photos', 'creatives');
--   DROP POLICY IF EXISTS "booking_files_read" ON storage.objects;
--   DROP POLICY IF EXISTS "booking_files_insert" ON storage.objects;
--   DROP POLICY IF EXISTS "booking_files_no_update" ON storage.objects;
--   DROP POLICY IF EXISTS "booking_files_no_delete" ON storage.objects;
--   Re-run 021 for the two restrictive policies.
-- ═══════════════════════════════════════════════════════════════════
