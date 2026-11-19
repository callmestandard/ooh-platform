-- ═══════════════════════════════════════════════════════════════════
-- OOH Platform — board intelligence: what is around each board.
-- Run in Supabase SQL Editor (Dashboard → SQL Editor → New query).
-- Requires 038/039 (geo_datasets, geo_pop_r9, geo_catchment_at) and 061
-- (is_admin). Additive only: new tables, functions and one trigger.
-- No existing board, owner, price or request data is changed. Safe to re-run.
--
-- board_intelligence  one cached row per pinned board. Filled by the offline
--                     pipeline (scripts/intel/build.mjs, 100 m WorldPop +
--                     OpenStreetMap) and kept current in the database when a
--                     board is pinned or moved.
-- geo_places          OpenStreetMap places near boards (13 categories).
-- map_usage_events    anonymous counts of map features used (layers, filters,
--                     intelligence opened), once per visitor/feature/day.
--
-- Every figure carries its dataset id (geo_datasets: publisher, year,
-- licence, method, limitations). NULL always means "not available", never 0.
-- Population figures are modelled RESIDENTS, not traffic or impressions.
-- ═══════════════════════════════════════════════════════════════════

-- Sources must be readable wherever a figure is shown, including signed out.
DROP POLICY IF EXISTS geo_datasets_public_read ON public.geo_datasets;
CREATE POLICY geo_datasets_public_read ON public.geo_datasets FOR SELECT TO anon USING (true);
GRANT SELECT ON public.geo_datasets TO anon;

-- ── Places ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.geo_places (
  id          TEXT PRIMARY KEY,                -- OSM type letter + id, e.g. n317739747
  category    TEXT NOT NULL CHECK (category IN ('bank','mall','market','supermarket','restaurant','hotel','office',
                                                'fuel','school','university','health','transport','entertainment')),
  name        TEXT,
  lat         DOUBLE PRECISION NOT NULL,
  lng         DOUBLE PRECISION NOT NULL,
  dataset_id  TEXT NOT NULL REFERENCES public.geo_datasets(id),
  loaded_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS geo_places_lat_lng ON public.geo_places (lat, lng);
ALTER TABLE public.geo_places ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS geo_places_read ON public.geo_places;
CREATE POLICY geo_places_read ON public.geo_places FOR SELECT USING (true);
REVOKE INSERT, UPDATE, DELETE ON public.geo_places FROM anon, authenticated;

-- ── Intelligence per board ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.board_intelligence (
  board_id              UUID PRIMARY KEY REFERENCES public.boards(id) ON DELETE CASCADE,
  latitude              DOUBLE PRECISION NOT NULL,   -- the pin these figures were computed for
  longitude             DOUBLE PRECISION NOT NULL,
  -- Estimated residents (WorldPop). 250 m / 500 m only from the 100 m grid.
  pop_250m              INTEGER,
  pop_500m              INTEGER,
  pop_1km               INTEGER,
  pop_2km               INTEGER,
  age_1km               JSONB,                       -- band → residents, e.g. {"15_24": 18215}
  population_method     TEXT CHECK (population_method IN ('raster_100m', 'h3_r9')),
  population_dataset_id TEXT REFERENCES public.geo_datasets(id),
  population_at         TIMESTAMPTZ,
  -- Mapped places (OpenStreetMap), category → count. Lower bounds.
  places_500m           JSONB,
  places_1km            JSONB,
  places_dataset_id     TEXT REFERENCES public.geo_datasets(id),
  places_at             TIMESTAMPTZ,
  -- Not connected yet: kept so a provider can fill them without a schema change.
  buildings_500m        INTEGER,
  buildings_1km         INTEGER,
  buildings_dataset_id  TEXT REFERENCES public.geo_datasets(id),
  road_class            TEXT,
  traffic_level         TEXT CHECK (traffic_level IS NULL OR traffic_level IN ('low', 'medium', 'high', 'very_high')),
  traffic_dataset_id    TEXT REFERENCES public.geo_datasets(id),
  computed_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.board_intelligence ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS board_intelligence_read ON public.board_intelligence;
CREATE POLICY board_intelligence_read ON public.board_intelligence FOR SELECT USING (true);  -- boards are public
REVOKE INSERT, UPDATE, DELETE ON public.board_intelligence FROM anon, authenticated;
GRANT SELECT ON public.board_intelligence TO anon, authenticated;

-- ── Place counts around a point ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.intel_places_near(p_lat DOUBLE PRECISION, p_lng DOUBLE PRECISION, p_radius_m INTEGER)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(jsonb_object_agg(category, n), '{}'::jsonb) FROM (
    SELECT category, COUNT(*) AS n FROM public.geo_places
     WHERE lat BETWEEN p_lat - p_radius_m / 111000.0 AND p_lat + p_radius_m / 111000.0
       AND lng BETWEEN p_lng - p_radius_m / (111000.0 * cos(radians(p_lat))) AND p_lng + p_radius_m / (111000.0 * cos(radians(p_lat)))
       AND 6371008.8 * 2 * asin(sqrt(power(sin(radians(lat - p_lat) / 2), 2)
             + cos(radians(p_lat)) * cos(radians(lat)) * power(sin(radians(lng - p_lng) / 2), 2))) <= p_radius_m
     GROUP BY category
  ) c;
$$;
REVOKE ALL ON FUNCTION public.intel_places_near(DOUBLE PRECISION, DOUBLE PRECISION, INTEGER) FROM PUBLIC, anon, authenticated;

-- ── Refresh one board inside the database ──────────────────────────
-- Places are recounted from geo_places. Population is kept while the pin is
-- unchanged (within 15 m). When the pin moved, the 100 m figures no longer
-- apply: 250 m / 500 m become NULL (not available) and 1 km / 2 km are taken
-- from the 350 m hexagon grid until the offline pipeline runs again.
CREATE OR REPLACE FUNCTION public.refresh_board_intelligence(p_board UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_lat DOUBLE PRECISION; v_lng DOUBLE PRECISION;
  e public.board_intelligence%ROWTYPE;
  v_moved BOOLEAN;
  v_places BOOLEAN := EXISTS (SELECT 1 FROM public.geo_places);
  v_pop_ds TEXT;
  c1 RECORD; c2 RECORD;
BEGIN
  SELECT latitude, longitude INTO v_lat, v_lng FROM public.boards WHERE id = p_board;
  IF v_lat IS NULL OR v_lng IS NULL THEN
    DELETE FROM public.board_intelligence WHERE board_id = p_board;
    RETURN;
  END IF;

  SELECT * INTO e FROM public.board_intelligence WHERE board_id = p_board;
  v_moved := e.board_id IS NULL OR 6371008.8 * 2 * asin(sqrt(power(sin(radians(e.latitude - v_lat) / 2), 2)
               + cos(radians(v_lat)) * cos(radians(e.latitude)) * power(sin(radians(e.longitude - v_lng) / 2), 2))) > 15;

  IF v_moved THEN
    e.board_id := p_board;
    e.pop_250m := NULL; e.pop_500m := NULL; e.pop_1km := NULL; e.pop_2km := NULL;
    e.age_1km := NULL; e.population_method := NULL; e.population_dataset_id := NULL; e.population_at := NULL;
    e.buildings_500m := NULL; e.buildings_1km := NULL; e.buildings_dataset_id := NULL;
    e.road_class := NULL; e.traffic_level := NULL; e.traffic_dataset_id := NULL;
    SELECT dataset_id INTO v_pop_ds FROM public.geo_pop_r9_source WHERE cell_count > 0;
    IF v_pop_ds IS NOT NULL THEN
      SELECT * INTO c1 FROM public.geo_catchment_at(v_lat, v_lng) WHERE radius_km = 1;
      SELECT * INTO c2 FROM public.geo_catchment_at(v_lat, v_lng) WHERE radius_km = 2;
      e.pop_1km := round(c1.pop_0_14 + c1.pop_15_24 + c1.pop_25_34 + c1.pop_35_plus);
      e.pop_2km := round(c2.pop_0_14 + c2.pop_15_24 + c2.pop_25_34 + c2.pop_35_plus);
      e.age_1km := jsonb_build_object('0_14', round(c1.pop_0_14), '15_24', round(c1.pop_15_24),
                                      '25_34', round(c1.pop_25_34), '35_plus', round(c1.pop_35_plus));
      e.population_method := 'h3_r9'; e.population_dataset_id := v_pop_ds; e.population_at := now();
    END IF;
  END IF;

  IF v_places THEN
    e.places_500m := public.intel_places_near(v_lat, v_lng, 500);
    e.places_1km := public.intel_places_near(v_lat, v_lng, 1000);
    e.places_dataset_id := (SELECT dataset_id FROM public.geo_places LIMIT 1);
    e.places_at := now();
  END IF;

  INSERT INTO public.board_intelligence AS t (board_id, latitude, longitude, pop_250m, pop_500m, pop_1km, pop_2km, age_1km,
    population_method, population_dataset_id, population_at, places_500m, places_1km, places_dataset_id, places_at,
    buildings_500m, buildings_1km, buildings_dataset_id, road_class, traffic_level, traffic_dataset_id, computed_at)
  VALUES (p_board, v_lat, v_lng, e.pop_250m, e.pop_500m, e.pop_1km, e.pop_2km, e.age_1km,
    e.population_method, e.population_dataset_id, e.population_at, e.places_500m, e.places_1km, e.places_dataset_id, e.places_at,
    e.buildings_500m, e.buildings_1km, e.buildings_dataset_id, e.road_class, e.traffic_level, e.traffic_dataset_id, now())
  ON CONFLICT (board_id) DO UPDATE SET
    latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
    pop_250m = EXCLUDED.pop_250m, pop_500m = EXCLUDED.pop_500m, pop_1km = EXCLUDED.pop_1km, pop_2km = EXCLUDED.pop_2km,
    age_1km = EXCLUDED.age_1km, population_method = EXCLUDED.population_method,
    population_dataset_id = EXCLUDED.population_dataset_id, population_at = EXCLUDED.population_at,
    places_500m = EXCLUDED.places_500m, places_1km = EXCLUDED.places_1km,
    places_dataset_id = EXCLUDED.places_dataset_id, places_at = EXCLUDED.places_at,
    buildings_500m = EXCLUDED.buildings_500m, buildings_1km = EXCLUDED.buildings_1km, buildings_dataset_id = EXCLUDED.buildings_dataset_id,
    road_class = EXCLUDED.road_class, traffic_level = EXCLUDED.traffic_level, traffic_dataset_id = EXCLUDED.traffic_dataset_id,
    computed_at = now();
END;
$$;
REVOKE ALL ON FUNCTION public.refresh_board_intelligence(UUID) FROM PUBLIC, anon, authenticated;

-- Admin: refresh chosen boards, one city, or everything (both NULL).
CREATE OR REPLACE FUNCTION public.admin_refresh_intelligence(p_board_ids UUID[] DEFAULT NULL, p_city TEXT DEFAULT NULL)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id UUID; v_n INTEGER := 0;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admins only' USING ERRCODE = '42501'; END IF;
  FOR v_id IN
    SELECT id FROM public.boards
     WHERE (p_board_ids IS NULL OR id = ANY (p_board_ids))
       AND (p_city IS NULL OR lower(city) = lower(p_city))
  LOOP
    PERFORM public.refresh_board_intelligence(v_id);
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_refresh_intelligence(UUID[], TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_refresh_intelligence(UUID[], TEXT) TO authenticated;

-- Keep a board's row current when it is pinned or moved. Never blocks a save.
CREATE OR REPLACE FUNCTION public.boards_refresh_intelligence()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  BEGIN
    PERFORM public.refresh_board_intelligence(NEW.id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'board intelligence refresh failed for %: %', NEW.id, SQLERRM;
  END;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS boards_refresh_intelligence_ins ON public.boards;
CREATE TRIGGER boards_refresh_intelligence_ins AFTER INSERT ON public.boards
  FOR EACH ROW WHEN (NEW.latitude IS NOT NULL AND NEW.longitude IS NOT NULL)
  EXECUTE FUNCTION public.boards_refresh_intelligence();
DROP TRIGGER IF EXISTS boards_refresh_intelligence_upd ON public.boards;
CREATE TRIGGER boards_refresh_intelligence_upd AFTER UPDATE OF latitude, longitude ON public.boards
  FOR EACH ROW WHEN (OLD.latitude IS DISTINCT FROM NEW.latitude OR OLD.longitude IS DISTINCT FROM NEW.longitude)
  EXECUTE FUNCTION public.boards_refresh_intelligence();

-- ── Places in the visible map area (the Places layer) ──────────────
-- Bounded: the box may be at most ~0.25° a side and returns at most 600 places.
CREATE OR REPLACE FUNCTION public.places_in_view(p_w DOUBLE PRECISION, p_s DOUBLE PRECISION, p_e DOUBLE PRECISION, p_n DOUBLE PRECISION, p_categories TEXT[] DEFAULT NULL)
RETURNS TABLE (id TEXT, category TEXT, name TEXT, lat DOUBLE PRECISION, lng DOUBLE PRECISION)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id, p.category, p.name, p.lat, p.lng FROM public.geo_places p
   WHERE p_e - p_w <= 0.25 AND p_n - p_s <= 0.25
     AND p.lat BETWEEN p_s AND p_n AND p.lng BETWEEN p_w AND p_e
     AND (p_categories IS NULL OR p.category = ANY (p_categories))
   LIMIT 600;
$$;
REVOKE ALL ON FUNCTION public.places_in_view(DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, TEXT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.places_in_view(DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, TEXT[]) TO anon, authenticated;

-- ── Which map features people use ─────────────────────────────────
CREATE TABLE IF NOT EXISTS public.map_usage_events (
  id        BIGSERIAL PRIMARY KEY,
  event     TEXT NOT NULL CHECK (event IN ('map_view', 'board_click', 'map_search', 'filter', 'layer', 'intel_open',
                                            'intel_detail', 'compare', 'pricing_click')),
  detail    TEXT NOT NULL DEFAULT '' CHECK (detail ~ '^[a-z0-9_]{0,40}$'),
  visitor   TEXT NOT NULL,
  board_id  UUID REFERENCES public.boards(id) ON DELETE SET NULL,
  day       DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS map_usage_events_once_a_day
  ON public.map_usage_events (event, detail, visitor, COALESCE(board_id, '00000000-0000-0000-0000-000000000000'::uuid), day);
ALTER TABLE public.map_usage_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS map_usage_events_admin_read ON public.map_usage_events;
CREATE POLICY map_usage_events_admin_read ON public.map_usage_events FOR SELECT USING (public.is_admin());
REVOKE ALL ON public.map_usage_events FROM anon, authenticated;  -- read only through admin_map_usage()

CREATE OR REPLACE FUNCTION public.track_map_event(p_event TEXT, p_detail TEXT, p_visitor TEXT, p_board UUID DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND public.is_admin() THEN RETURN; END IF;
  IF p_event NOT IN ('map_view', 'board_click', 'map_search', 'filter', 'layer', 'intel_open', 'intel_detail', 'compare', 'pricing_click')
     OR coalesce(p_detail, '') !~ '^[a-z0-9_]{0,40}$'
     OR p_visitor IS NULL OR p_visitor !~ '^[A-Za-z0-9_-]{12,64}$' THEN
    RETURN;
  END IF;
  INSERT INTO public.map_usage_events (event, detail, visitor, board_id)
  SELECT p_event, coalesce(p_detail, ''), p_visitor, (SELECT id FROM public.boards WHERE id = p_board)
  ON CONFLICT DO NOTHING;
END;
$$;
REVOKE ALL ON FUNCTION public.track_map_event(TEXT, TEXT, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.track_map_event(TEXT, TEXT, TEXT, UUID) TO anon, authenticated;

-- Admin summary: distinct visitors per feature over the last p_days.
CREATE OR REPLACE FUNCTION public.admin_map_usage(p_days INTEGER DEFAULT 30)
RETURNS TABLE (event TEXT, detail TEXT, visitors BIGINT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admins only' USING ERRCODE = '42501'; END IF;
  RETURN QUERY SELECT m.event, m.detail, COUNT(DISTINCT m.visitor)
    FROM public.map_usage_events m WHERE m.day > CURRENT_DATE - p_days
   GROUP BY m.event, m.detail ORDER BY 3 DESC;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_map_usage(INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_map_usage(INTEGER) TO authenticated;

-- ROLLBACK (only if needed; drops the new objects, touches nothing else):
-- DROP TRIGGER IF EXISTS boards_refresh_intelligence_ins ON public.boards;
-- DROP TRIGGER IF EXISTS boards_refresh_intelligence_upd ON public.boards;
-- DROP FUNCTION IF EXISTS public.boards_refresh_intelligence(), public.admin_refresh_intelligence(UUID[], TEXT),
--   public.refresh_board_intelligence(UUID), public.intel_places_near(DOUBLE PRECISION, DOUBLE PRECISION, INTEGER),
--   public.places_in_view(DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, TEXT[]),
--   public.track_map_event(TEXT, TEXT, TEXT, UUID), public.admin_map_usage(INTEGER);
-- DROP TABLE IF EXISTS public.map_usage_events, public.board_intelligence, public.geo_places;
-- DROP POLICY IF EXISTS geo_datasets_public_read ON public.geo_datasets;
