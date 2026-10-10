-- ═══════════════════════════════════════════════════════════════════
-- OOH Platform — board catchments: modelled residents near each board
-- Run in Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- Requires 038. Safe to re-run.
--
-- For every board: how many modelled residents live within 1, 2 and 5 km,
-- split 0-14 / 15-24 / 25-34 / 35+. This is a count of RESIDENTS from a
-- population model. It is not reach, impressions or traffic — nothing in
-- this system measures who passes a board.
--
-- Method: the population is held as H3 resolution-9 cells (about 0.1 km²,
-- ~350 m across). A cell counts toward a radius when its CENTRE lies within
-- that great-circle distance of the board. Cells are never split.
--
-- Adds only new objects plus one AFTER trigger on boards that refreshes the
-- cache when a board's coordinates change. The trigger can never block a
-- board save: any failure inside it is downgraded to a warning. No existing
-- policy, rate or board column is touched. No PostGIS.
-- ═══════════════════════════════════════════════════════════════════

-- ── Compact population cells (loaded by scripts/geo/10-catchments.mjs) ──
-- 2.2 million rows, so it is kept deliberately narrow: no per-row dataset
-- column. Its single source is recorded in geo_pop_r9_source below and is
-- stamped onto every board_catchments row computed from it.
CREATE TABLE IF NOT EXISTS public.geo_pop_r9 (
  lat          REAL NOT NULL,   -- cell centre
  lng          REAL NOT NULL,
  pop_0_14     REAL NOT NULL,
  pop_15_24    REAL NOT NULL,
  pop_25_34    REAL NOT NULL,
  pop_35_plus  REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_geo_pop_r9_lat_lng ON public.geo_pop_r9(lat, lng);

CREATE TABLE IF NOT EXISTS public.geo_pop_r9_source (
  id          BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),   -- one row only
  dataset_id  TEXT NOT NULL REFERENCES public.geo_datasets(id),
  cell_count  INTEGER NOT NULL,
  loaded_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Cache: one row per board per radius ────────────────────────────
CREATE TABLE IF NOT EXISTS public.board_catchments (
  board_id     UUID NOT NULL REFERENCES public.boards(id) ON DELETE CASCADE,
  radius_km    SMALLINT NOT NULL CHECK (radius_km IN (1, 2, 5)),
  pop_0_14     DOUBLE PRECISION NOT NULL,
  pop_15_24    DOUBLE PRECISION NOT NULL,
  pop_25_34    DOUBLE PRECISION NOT NULL,
  pop_35_plus  DOUBLE PRECISION NOT NULL,
  cells        INTEGER NOT NULL,            -- populated cells that fell inside the radius
  -- The coordinates the figures were computed for, so a reader can see they match the board.
  latitude     DOUBLE PRECISION NOT NULL,
  longitude    DOUBLE PRECISION NOT NULL,
  population_dataset_id TEXT NOT NULL REFERENCES public.geo_datasets(id),
  computed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (board_id, radius_km)
);

-- ── Residents around any point ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.geo_catchment_at(p_lat DOUBLE PRECISION, p_lng DOUBLE PRECISION)
RETURNS TABLE (
  radius_km SMALLINT, pop_0_14 DOUBLE PRECISION, pop_15_24 DOUBLE PRECISION,
  pop_25_34 DOUBLE PRECISION, pop_35_plus DOUBLE PRECISION, cells INTEGER
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH nearby AS (
    -- Bounding box of the largest radius first (uses the index), exact distance after.
    SELECT c.pop_0_14, c.pop_15_24, c.pop_25_34, c.pop_35_plus,
           6371.0088 * 2 * asin(sqrt(
             power(sin(radians(c.lat - p_lat) / 2), 2) +
             cos(radians(p_lat)) * cos(radians(c.lat)) * power(sin(radians(c.lng - p_lng) / 2), 2)
           )) AS km
    FROM public.geo_pop_r9 c
    WHERE c.lat BETWEEN p_lat - 5 / 111.0 AND p_lat + 5 / 111.0
      AND c.lng BETWEEN p_lng - 5 / (111.0 * cos(radians(p_lat))) AND p_lng + 5 / (111.0 * cos(radians(p_lat)))
  )
  SELECT r.km::SMALLINT,
         COALESCE(SUM(n.pop_0_14), 0)::DOUBLE PRECISION,
         COALESCE(SUM(n.pop_15_24), 0)::DOUBLE PRECISION,
         COALESCE(SUM(n.pop_25_34), 0)::DOUBLE PRECISION,
         COALESCE(SUM(n.pop_35_plus), 0)::DOUBLE PRECISION,
         COUNT(n.km)::INTEGER
  FROM (VALUES (1), (2), (5)) AS r(km)
  LEFT JOIN nearby n ON n.km <= r.km
  GROUP BY r.km
  ORDER BY r.km;
$$;

-- ── Refresh one board ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.refresh_board_catchment(p_board UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_lat DOUBLE PRECISION;
  v_lng DOUBLE PRECISION;
  v_dataset TEXT;
BEGIN
  SELECT latitude, longitude INTO v_lat, v_lng FROM public.boards WHERE id = p_board;
  IF v_lat IS NULL OR v_lng IS NULL THEN
    DELETE FROM public.board_catchments WHERE board_id = p_board;
    RETURN;
  END IF;

  -- No population loaded: write nothing. A stored zero must always mean
  -- "no modelled residents here", never "the data was missing".
  SELECT dataset_id INTO v_dataset FROM public.geo_pop_r9_source WHERE cell_count > 0;
  IF v_dataset IS NULL THEN
    DELETE FROM public.board_catchments WHERE board_id = p_board;
    RETURN;
  END IF;

  INSERT INTO public.board_catchments
    (board_id, radius_km, pop_0_14, pop_15_24, pop_25_34, pop_35_plus, cells, latitude, longitude, population_dataset_id, computed_at)
  SELECT p_board, c.radius_km, c.pop_0_14, c.pop_15_24, c.pop_25_34, c.pop_35_plus, c.cells, v_lat, v_lng, v_dataset, now()
  FROM public.geo_catchment_at(v_lat, v_lng) c
  ON CONFLICT (board_id, radius_km) DO UPDATE SET
    pop_0_14 = EXCLUDED.pop_0_14, pop_15_24 = EXCLUDED.pop_15_24, pop_25_34 = EXCLUDED.pop_25_34,
    pop_35_plus = EXCLUDED.pop_35_plus, cells = EXCLUDED.cells, latitude = EXCLUDED.latitude,
    longitude = EXCLUDED.longitude, population_dataset_id = EXCLUDED.population_dataset_id, computed_at = EXCLUDED.computed_at;
END;
$$;

-- ── Refresh every board (after the population is loaded or reloaded) ─
CREATE OR REPLACE FUNCTION public.refresh_all_board_catchments()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_board UUID;
  v_count INTEGER := 0;
BEGIN
  FOR v_board IN SELECT id FROM public.boards LOOP
    PERFORM public.refresh_board_catchment(v_board);
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

-- ── Empty the cell table before a reload ───────────────────────────
CREATE OR REPLACE FUNCTION public.geo_pop_r9_reset()
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  TRUNCATE public.geo_pop_r9;
  DELETE FROM public.geo_pop_r9_source WHERE id;
END;
$$;

-- ── Recompute when a board's coordinates change ────────────────────
CREATE OR REPLACE FUNCTION public.boards_refresh_catchment()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  BEGIN
    PERFORM public.refresh_board_catchment(NEW.id);
  EXCEPTION WHEN OTHERS THEN
    -- Never let the cache stop a board from being saved.
    RAISE WARNING 'board catchment refresh failed for %: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_boards_catchment_insert ON public.boards;
CREATE TRIGGER trg_boards_catchment_insert
  AFTER INSERT ON public.boards
  FOR EACH ROW EXECUTE FUNCTION public.boards_refresh_catchment();

DROP TRIGGER IF EXISTS trg_boards_catchment_move ON public.boards;
CREATE TRIGGER trg_boards_catchment_move
  AFTER UPDATE OF latitude, longitude ON public.boards
  FOR EACH ROW
  WHEN (NEW.latitude IS DISTINCT FROM OLD.latitude OR NEW.longitude IS DISTINCT FROM OLD.longitude)
  EXECUTE FUNCTION public.boards_refresh_catchment();

-- ── Access ─────────────────────────────────────────────────────────
ALTER TABLE public.geo_pop_r9        ENABLE ROW LEVEL SECURITY;   -- no policy: read only through geo_catchment_at
ALTER TABLE public.geo_pop_r9_source ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.board_catchments  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS geo_pop_r9_source_read ON public.geo_pop_r9_source;
CREATE POLICY geo_pop_r9_source_read ON public.geo_pop_r9_source FOR SELECT TO authenticated USING (true);

-- A catchment row is visible exactly when the board itself is visible to the
-- reader: the subquery runs under the reader's own boards policies.
DROP POLICY IF EXISTS board_catchments_read ON public.board_catchments;
CREATE POLICY board_catchments_read ON public.board_catchments FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.boards b WHERE b.id = board_catchments.board_id));

GRANT SELECT ON public.board_catchments, public.geo_pop_r9_source TO authenticated;

REVOKE ALL ON FUNCTION public.geo_catchment_at(DOUBLE PRECISION, DOUBLE PRECISION) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.refresh_board_catchment(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.refresh_all_board_catchments() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.geo_pop_r9_reset() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.boards_refresh_catchment() FROM PUBLIC;
-- Supabase also grants EXECUTE on new functions to anon and authenticated by default.
REVOKE ALL ON FUNCTION public.geo_catchment_at(DOUBLE PRECISION, DOUBLE PRECISION) FROM anon;
REVOKE ALL ON FUNCTION public.refresh_board_catchment(UUID) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.refresh_all_board_catchments() FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.geo_pop_r9_reset() FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.boards_refresh_catchment() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.geo_catchment_at(DOUBLE PRECISION, DOUBLE PRECISION) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.refresh_board_catchment(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.refresh_all_board_catchments() TO service_role;
GRANT EXECUTE ON FUNCTION public.geo_pop_r9_reset() TO service_role;
