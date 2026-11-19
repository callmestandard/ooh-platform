-- OOH Platform — keep owner contacts and rate cards private
--
-- Until now anyone (signed out or a buyer) could read every board's
-- contact_name, contact_phone and rate_card straight from the API.
-- That let buyers skip the platform and published owners' personal
-- numbers.
--
-- After this migration:
--   • anon and signed-in users can no longer SELECT those three columns.
--     Writes are unchanged (owners and admins still save them).
--   • board_private_fields(ids) returns them only to an admin, the board
--     owner's team, or whoever created the board.
--   • availability_request_unreached_boards no longer hands a buyer the
--     owner's contact (admins still see it).
--
-- Undo: see the ROLLBACK block at the end.

BEGIN;

-- 1. Column-level SELECT: everything except the private columns.
REVOKE SELECT ON public.boards FROM anon, authenticated;
DO $$
DECLARE cols TEXT;
BEGIN
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position) INTO cols
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'boards'
    AND column_name NOT IN ('contact_name', 'contact_phone', 'rate_card');
  EXECUTE format('GRANT SELECT (%s) ON public.boards TO anon, authenticated', cols);
END $$;

-- 2. Private fields for the people allowed to see them.
CREATE OR REPLACE FUNCTION public.board_private_fields(p_ids UUID[])
RETURNS TABLE (id UUID, contact_name TEXT, contact_phone TEXT, rate_card JSONB)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT b.id, b.contact_name, b.contact_phone, b.rate_card::jsonb
  FROM public.boards b
  WHERE b.id = ANY(p_ids)
    AND auth.uid() IS NOT NULL
    AND (
      public.auth_role() = 'admin'
      OR public.is_owner_member(b.owner_id, auth.uid())
      OR b.created_by = auth.uid()
    );
$$;
REVOKE ALL ON FUNCTION public.board_private_fields(UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.board_private_fields(UUID[]) TO authenticated;

-- 3. Buyers' "boards we couldn't reach" list: no owner contacts for buyers.
CREATE OR REPLACE FUNCTION public.availability_request_unreached_boards(p_request_id UUID)
RETURNS TABLE (board_id UUID, name TEXT, city TEXT, format TEXT, contact_name TEXT, contact_phone TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT b.id, b.name, b.city, b.format,
         CASE WHEN public.auth_role() = 'admin' THEN b.contact_name END,
         CASE WHEN public.auth_role() = 'admin' THEN b.contact_phone END
  FROM public.boards b
  WHERE public.availability_request_agency(p_request_id) = auth.uid()
    AND public.board_matches_availability_request(b.id, p_request_id)
    AND public.board_owner_account(b.id) IS NULL
  ORDER BY b.city, b.name;
$$;
GRANT EXECUTE ON FUNCTION public.availability_request_unreached_boards(UUID) TO authenticated;

COMMIT;

-- ROLLBACK (run by hand only if needed):
-- GRANT SELECT ON public.boards TO anon, authenticated;
-- DROP FUNCTION IF EXISTS public.board_private_fields(UUID[]);
