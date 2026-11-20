-- 066: found in Phase 7 QA (2026-11-20).
-- 1. An install link could be made for a booking the buyer had accepted but our
--    team had not yet confirmed. The admin screen already hid the button; now the
--    database refuses too. Same rule as "confirmed" in booking_progress_json (064).
-- 2. The end-to-end test used quotation number Q-2026-0001 and was then deleted.
--    If no quotation exists, restart the numbering so the first real one is 0001.

CREATE OR REPLACE FUNCTION public.admin_poe_link(p_booking_id UUID, p_new BOOLEAN DEFAULT false)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_token TEXT;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admins only' USING ERRCODE = '42501'; END IF;
  SELECT poe_token INTO v_token FROM public.bookings WHERE id = p_booking_id
     AND (status IN ('signed', 'live') OR (status = 'agreed' AND confirmed_at IS NOT NULL));
  IF NOT FOUND THEN RAISE EXCEPTION 'Confirm the booking first' USING ERRCODE = '22023'; END IF;
  IF v_token IS NULL OR length(v_token) < 32 OR p_new THEN
    v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
    UPDATE public.bookings SET poe_token = v_token WHERE id = p_booking_id;
  END IF;
  RETURN v_token;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_poe_link(UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_poe_link(UUID, BOOLEAN) TO authenticated;

DO $$
BEGIN
  IF to_regclass('public.quotation_ref_seq') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.quotations) THEN
    PERFORM setval('public.quotation_ref_seq', 1, false);
  END IF;
END $$;
