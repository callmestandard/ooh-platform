-- 058: Fix for 057. Merging a board that had a "not duplicates" mark failed
-- (the mark would have pointed at the kept board twice). The marks on removed
-- boards are now dropped first. Run in the Supabase SQL Editor, then:
--   node scripts/verify-board-duplicates.mjs

CREATE OR REPLACE FUNCTION public.admin_merge_boards(p_keep UUID, p_drop UUID[])
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_drop  UUID[];
  v_d     UUID;
  v_fk    RECORD;
  v_row   RECORD;
  v_one   BOOLEAN;
BEGIN
  IF public.auth_role() IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'admins only' USING ERRCODE = '42501'; END IF;

  SELECT array_agg(DISTINCT d) INTO v_drop FROM unnest(p_drop) d WHERE d IS NOT NULL AND d <> p_keep;
  IF v_drop IS NULL THEN RAISE EXCEPTION 'Nothing to merge' USING ERRCODE = '22023'; END IF;
  PERFORM 1 FROM public.boards WHERE id = p_keep FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Board to keep not found' USING ERRCODE = '22023'; END IF;
  IF (SELECT count(*) FROM public.boards WHERE id = ANY(v_drop)) <> cardinality(v_drop) THEN
    RAISE EXCEPTION 'A board to merge was not found' USING ERRCODE = '22023';
  END IF;

  -- Details: keep the kept board's, fill blanks from the others (newest first).
  UPDATE public.boards k SET
    address     = COALESCE(NULLIF(k.address, ''), d.address),
    area        = COALESCE(NULLIF(k.area, ''), d.area),
    state       = COALESCE(NULLIF(k.state, ''), d.state),
    width       = COALESCE(k.width, d.width),
    height      = COALESCE(k.height, d.height),
    illuminated = COALESCE(k.illuminated, d.illuminated),
    owner_id    = COALESCE(k.owner_id, d.owner_id),
    latitude    = CASE WHEN k.latitude IS NULL OR k.longitude IS NULL THEN d.latitude ELSE k.latitude END,
    longitude   = CASE WHEN k.latitude IS NULL OR k.longitude IS NULL THEN d.longitude ELSE k.longitude END
  FROM (
    SELECT
      (array_agg(address ORDER BY created_at DESC) FILTER (WHERE NULLIF(address, '') IS NOT NULL))[1] AS address,
      (array_agg(area ORDER BY created_at DESC) FILTER (WHERE NULLIF(area, '') IS NOT NULL))[1] AS area,
      (array_agg(state ORDER BY created_at DESC) FILTER (WHERE NULLIF(state, '') IS NOT NULL))[1] AS state,
      (array_agg(width ORDER BY created_at DESC) FILTER (WHERE width IS NOT NULL AND height IS NOT NULL))[1] AS width,
      (array_agg(height ORDER BY created_at DESC) FILTER (WHERE width IS NOT NULL AND height IS NOT NULL))[1] AS height,
      (array_agg(illuminated ORDER BY created_at DESC) FILTER (WHERE illuminated IS NOT NULL))[1] AS illuminated,
      (array_agg(owner_id ORDER BY created_at DESC) FILTER (WHERE owner_id IS NOT NULL))[1] AS owner_id,
      (array_agg(latitude ORDER BY created_at DESC) FILTER (WHERE latitude IS NOT NULL AND longitude IS NOT NULL))[1] AS latitude,
      (array_agg(longitude ORDER BY created_at DESC) FILTER (WHERE latitude IS NOT NULL AND longitude IS NOT NULL))[1] AS longitude
    FROM public.boards WHERE id = ANY(v_drop)
  ) d
  WHERE k.id = p_keep;

  -- Photos: the kept board's first, then any the others have that it doesn't.
  UPDATE public.boards k SET photo_urls = (
    SELECT array_agg(u ORDER BY o) FROM (
      SELECT u, min(o) AS o FROM (
        SELECT u, ord AS o FROM unnest(COALESCE(k.photo_urls, '{}')) WITH ORDINALITY x(u, ord)
        UNION ALL
        SELECT u, 1000000 + row_number() OVER (ORDER BY b.created_at DESC, ord)
          FROM public.boards b, unnest(COALESCE(b.photo_urls, '{}')) WITH ORDINALITY y(u, ord)
         WHERE b.id = ANY(v_drop)
      ) all_photos GROUP BY u
    ) uniq
  )
  WHERE k.id = p_keep;

  -- "Not duplicates" marks on a removed board mean nothing any more.
  DELETE FROM public.board_duplicate_dismissals WHERE board_a = ANY(v_drop) OR board_b = ANY(v_drop);

  -- Every table with a single-column link to boards: move the rows over.
  FOR v_fk IN
    SELECT c.conrelid::regclass AS tbl, a.attname AS col, a.attnum AS num
      FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
     WHERE c.contype = 'f' AND c.confrelid = 'public.boards'::regclass AND cardinality(c.conkey) = 1
  LOOP
    SELECT EXISTS (
      SELECT 1 FROM pg_constraint u
       WHERE u.conrelid = v_fk.tbl AND u.contype IN ('p', 'u') AND u.conkey = ARRAY[v_fk.num]
    ) INTO v_one;

    IF v_one THEN
      -- One row per board (rate, owner name, brand…): the kept board's row wins;
      -- if it has none, it takes the first dropped board's.
      FOREACH v_d IN ARRAY v_drop LOOP
        EXECUTE format('UPDATE %s SET %I = $1 WHERE %I = $2 AND NOT EXISTS (SELECT 1 FROM %s WHERE %I = $1)',
                       v_fk.tbl, v_fk.col, v_fk.col, v_fk.tbl, v_fk.col) USING p_keep, v_d;
      END LOOP;
      EXECUTE format('DELETE FROM %s WHERE %I = ANY($1)', v_fk.tbl, v_fk.col) USING v_drop;
    ELSE
      BEGIN
        EXECUTE format('UPDATE %s SET %I = $1 WHERE %I = ANY($2)', v_fk.tbl, v_fk.col, v_fk.col) USING p_keep, v_drop;
      EXCEPTION WHEN unique_violation THEN
        -- Some rows would clash with one the kept board already has (e.g. the
        -- same claim twice): move the rest one by one, drop the clashing ones.
        FOR v_row IN EXECUTE format('SELECT ctid AS t FROM %s WHERE %I = ANY($1)', v_fk.tbl, v_fk.col) USING v_drop LOOP
          BEGIN
            EXECUTE format('UPDATE %s SET %I = $1 WHERE ctid = $2', v_fk.tbl, v_fk.col) USING p_keep, v_row.t;
          EXCEPTION WHEN unique_violation THEN
            EXECUTE format('DELETE FROM %s WHERE ctid = $1', v_fk.tbl) USING v_row.t;
          END;
        END LOOP;
      END;
    END IF;
  END LOOP;

  -- Lists of boards (share links, proposals): swap the ids, keep the order, no repeats.
  IF to_regclass('public.board_share_links') IS NOT NULL THEN
    UPDATE public.board_share_links s SET board_ids = (
      SELECT array_agg(x ORDER BY o) FROM (
        SELECT CASE WHEN v = ANY(v_drop) THEN p_keep ELSE v END AS x, min(ord) AS o
          FROM unnest(s.board_ids) WITH ORDINALITY z(v, ord) GROUP BY 1
      ) q
    ) WHERE s.board_ids && v_drop;
  END IF;
  IF to_regclass('public.proposals') IS NOT NULL THEN
    UPDATE public.proposals p SET board_ids = (
      SELECT array_agg(x ORDER BY o) FROM (
        SELECT CASE WHEN v = ANY(v_drop) THEN p_keep ELSE v END AS x, min(ord) AS o
          FROM unnest(p.board_ids) WITH ORDINALITY z(v, ord) GROUP BY 1
      ) q
    ) WHERE p.board_ids && v_drop;
  END IF;

  DELETE FROM public.boards WHERE id = ANY(v_drop);

  BEGIN
    INSERT INTO public.activity_events (entity_type, entity_id, actor_id, actor_role, action, summary)
    SELECT 'board', p_keep, auth.uid(), 'admin', 'board.merged',
           'Merged ' || cardinality(v_drop) || ' duplicate board' || CASE WHEN cardinality(v_drop) = 1 THEN '' ELSE 's' END || ' into ' || name
      FROM public.boards WHERE id = p_keep;
  EXCEPTION WHEN OTHERS THEN NULL;  -- the log is a nice-to-have; never undo a merge over it
  END;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_merge_boards(UUID, UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_merge_boards(UUID, UUID[]) TO authenticated;
