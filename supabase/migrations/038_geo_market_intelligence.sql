-- ═══════════════════════════════════════════════════════════════════
-- OOH Platform — market intelligence: sourced demographic metrics
-- Run in Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- Safe to re-run (IF NOT EXISTS / DROP POLICY IF EXISTS).
--
-- Adds the tables the offline pipeline in scripts/geo/ writes to. Nothing
-- here touches boards, rates, bookings or any existing policy.
--
-- The rule these tables enforce: every figure comes from a named dataset.
-- Each group of metric columns carries a NOT NULL-when-populated reference
-- to geo_datasets, so a number can never be shown without its source,
-- version, reference year, licence and known limitation.
--
-- No PostGIS: metrics are keyed by administrative code or H3 index, and the
-- polygons are served as static files (public/geo/). Rows are written only
-- by the pipeline with the service-role key; signed-in users can read.
-- ═══════════════════════════════════════════════════════════════════

-- ── Dataset registry ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.geo_datasets (
  id                 TEXT PRIMARY KEY,
  name               TEXT NOT NULL,
  publisher          TEXT NOT NULL,
  version            TEXT NOT NULL,
  reference_year     TEXT NOT NULL,
  resolution         TEXT NOT NULL,
  licence            TEXT NOT NULL,
  licence_url        TEXT,
  url                TEXT NOT NULL,
  retrieved_on       DATE,
  method_summary     TEXT NOT NULL,
  known_limitations  TEXT NOT NULL,
  -- The exact credit line the licence requires; shown on the map.
  attribution        TEXT NOT NULL,
  -- 'modelled' | 'survey_estimate' | 'crowdsourced' | 'remote_sensing' | 'administrative'
  data_nature        TEXT NOT NULL,
  -- 'active'   = loaded and shown
  -- 'excluded' = evaluated and deliberately not used (see known_limitations)
  status             TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'excluded')),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Segment rules (thresholds and rule text exactly as computed) ───
CREATE TABLE IF NOT EXISTS public.geo_segment_rules (
  id           TEXT PRIMARY KEY,
  weights      JSONB NOT NULL,
  thresholds   JSONB NOT NULL,
  rule_text    JSONB NOT NULL,
  computed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── LGA metrics (774 rows) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.geo_metrics_lga (
  lga_pcode    TEXT PRIMARY KEY,
  lga_name     TEXT NOT NULL,
  state_pcode  TEXT NOT NULL,
  state_name   TEXT NOT NULL,
  area_km2     DOUBLE PRECISION NOT NULL,
  boundary_dataset_id TEXT NOT NULL REFERENCES public.geo_datasets(id),

  -- Population (modelled). Unrounded sums of grid cells.
  pop_total        DOUBLE PRECISION,
  pop_0_14         DOUBLE PRECISION,
  pop_15_24        DOUBLE PRECISION,
  pop_25_34        DOUBLE PRECISION,
  pop_35_plus      DOUBLE PRECISION,
  pop_15_34        DOUBLE PRECISION,
  youth_share      DOUBLE PRECISION,   -- pop_15_34 / pop_total
  pop_density_km2  DOUBLE PRECISION,   -- pop_total / area_km2
  population_dataset_id TEXT REFERENCES public.geo_datasets(id),

  -- OpenStreetMap points of interest (lower bounds).
  poi_university    INTEGER,
  poi_mall          INTEGER,
  poi_market        INTEGER,
  poi_bank          INTEGER,
  poi_hotel         INTEGER,
  poi_airport       INTEGER,
  poi_bus_terminal  INTEGER,
  poi_hospital      INTEGER,
  -- (banks + malls + hotels + universities) / area_km2
  poi_affluence_density_km2 DOUBLE PRECISION,
  poi_dataset_id TEXT REFERENCES public.geo_datasets(id),

  -- Relative Wealth Index. Left NULL while the dataset is excluded.
  rwi_mean        DOUBLE PRECISION,
  rwi_error_mean  DOUBLE PRECISION,
  rwi_cell_count  INTEGER,
  rwi_dataset_id  TEXT REFERENCES public.geo_datasets(id),

  -- Night-time lights, mean radiance over the LGA.
  ntl_mean        DOUBLE PRECISION,
  ntl_dataset_id  TEXT REFERENCES public.geo_datasets(id),

  -- Derived by the rules in geo_segment_rules (default weights).
  youth_count_pctile  DOUBLE PRECISION,
  youth_share_pctile  DOUBLE PRECISION,
  density_pctile      DOUBLE PRECISION,
  rwi_pctile          DOUBLE PRECISION,
  ntl_pctile          DOUBLE PRECISION,
  poi_density_pctile  DOUBLE PRECISION,
  affluence_index     DOUBLE PRECISION,
  affluence_pctile    DOUBLE PRECISION,
  is_high_value       BOOLEAN,
  is_youth_hub        BOOLEAN,
  is_mass_market      BOOLEAN,
  segment             TEXT CHECK (segment IN ('high_value', 'youth_hub', 'mass_market', 'unclassified')),
  segment_rule_id     TEXT REFERENCES public.geo_segment_rules(id),

  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- No unsourced numbers: a column group with a value must name its dataset.
  CONSTRAINT geo_lga_population_sourced CHECK (pop_total IS NULL OR population_dataset_id IS NOT NULL),
  CONSTRAINT geo_lga_poi_sourced        CHECK (poi_bank IS NULL OR poi_dataset_id IS NOT NULL),
  CONSTRAINT geo_lga_rwi_sourced        CHECK (rwi_mean IS NULL OR rwi_dataset_id IS NOT NULL),
  CONSTRAINT geo_lga_ntl_sourced        CHECK (ntl_mean IS NULL OR ntl_dataset_id IS NOT NULL),
  CONSTRAINT geo_lga_segment_sourced    CHECK (segment IS NULL OR segment_rule_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_geo_metrics_lga_state ON public.geo_metrics_lga(state_pcode);

-- ── State metrics (36 states + FCT) ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.geo_metrics_state (
  state_pcode  TEXT PRIMARY KEY,
  state_name   TEXT NOT NULL,
  area_km2     DOUBLE PRECISION NOT NULL,
  lga_count    INTEGER NOT NULL,
  boundary_dataset_id TEXT NOT NULL REFERENCES public.geo_datasets(id),

  pop_total        DOUBLE PRECISION,
  pop_0_14         DOUBLE PRECISION,
  pop_15_24        DOUBLE PRECISION,
  pop_25_34        DOUBLE PRECISION,
  pop_35_plus      DOUBLE PRECISION,
  pop_15_34        DOUBLE PRECISION,
  youth_share      DOUBLE PRECISION,
  pop_density_km2  DOUBLE PRECISION,
  population_dataset_id TEXT REFERENCES public.geo_datasets(id),

  poi_university    INTEGER,
  poi_mall          INTEGER,
  poi_market        INTEGER,
  poi_bank          INTEGER,
  poi_hotel         INTEGER,
  poi_airport       INTEGER,
  poi_bus_terminal  INTEGER,
  poi_hospital      INTEGER,
  poi_affluence_density_km2 DOUBLE PRECISION,
  poi_dataset_id TEXT REFERENCES public.geo_datasets(id),

  ntl_mean        DOUBLE PRECISION,
  ntl_dataset_id  TEXT REFERENCES public.geo_datasets(id),

  -- DHS wealth quintiles: percent of the household population in each
  -- NATIONAL quintile. Survey estimates; state level only.
  dhs_q1_lowest_pct   DOUBLE PRECISION,
  dhs_q2_second_pct   DOUBLE PRECISION,
  dhs_q3_middle_pct   DOUBLE PRECISION,
  dhs_q4_fourth_pct   DOUBLE PRECISION,
  dhs_q5_highest_pct  DOUBLE PRECISION,
  dhs_sample_unweighted  INTEGER,
  dhs_sample_weighted    INTEGER,
  dhs_dataset_id TEXT REFERENCES public.geo_datasets(id),

  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT geo_state_population_sourced CHECK (pop_total IS NULL OR population_dataset_id IS NOT NULL),
  CONSTRAINT geo_state_poi_sourced        CHECK (poi_bank IS NULL OR poi_dataset_id IS NOT NULL),
  CONSTRAINT geo_state_ntl_sourced        CHECK (ntl_mean IS NULL OR ntl_dataset_id IS NOT NULL),
  CONSTRAINT geo_state_dhs_sourced        CHECK (dhs_q1_lowest_pct IS NULL OR dhs_dataset_id IS NOT NULL)
);

-- ── H3 cell metrics ────────────────────────────────────────────────
-- Resolution 7 and 8 back the hexagon map layers (which render from
-- pre-built vector tiles, never from this table). Resolution 9 is the
-- base the board catchments are summed from.
CREATE TABLE IF NOT EXISTS public.geo_metrics_h3 (
  h3          TEXT PRIMARY KEY,
  resolution  SMALLINT NOT NULL,
  lat         DOUBLE PRECISION NOT NULL,   -- cell centre
  lng         DOUBLE PRECISION NOT NULL,
  area_km2    DOUBLE PRECISION NOT NULL,

  pop_total        DOUBLE PRECISION NOT NULL,
  pop_0_14         DOUBLE PRECISION NOT NULL,
  pop_15_24        DOUBLE PRECISION NOT NULL,
  pop_25_34        DOUBLE PRECISION NOT NULL,
  pop_35_plus      DOUBLE PRECISION NOT NULL,
  population_dataset_id TEXT NOT NULL REFERENCES public.geo_datasets(id),

  poi_university    INTEGER,
  poi_mall          INTEGER,
  poi_market        INTEGER,
  poi_bank          INTEGER,
  poi_hotel         INTEGER,
  poi_airport       INTEGER,
  poi_bus_terminal  INTEGER,
  poi_hospital      INTEGER,
  poi_dataset_id TEXT REFERENCES public.geo_datasets(id),

  CONSTRAINT geo_h3_poi_sourced CHECK (poi_bank IS NULL OR poi_dataset_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_geo_metrics_h3_res_lat_lng ON public.geo_metrics_h3(resolution, lat, lng);

-- ── Row-level security: read-only for signed-in users ──────────────
ALTER TABLE public.geo_datasets      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.geo_segment_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.geo_metrics_lga   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.geo_metrics_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.geo_metrics_h3    ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS geo_datasets_read      ON public.geo_datasets;
DROP POLICY IF EXISTS geo_segment_rules_read ON public.geo_segment_rules;
DROP POLICY IF EXISTS geo_metrics_lga_read   ON public.geo_metrics_lga;
DROP POLICY IF EXISTS geo_metrics_state_read ON public.geo_metrics_state;
DROP POLICY IF EXISTS geo_metrics_h3_read    ON public.geo_metrics_h3;

CREATE POLICY geo_datasets_read      ON public.geo_datasets      FOR SELECT TO authenticated USING (true);
CREATE POLICY geo_segment_rules_read ON public.geo_segment_rules FOR SELECT TO authenticated USING (true);
CREATE POLICY geo_metrics_lga_read   ON public.geo_metrics_lga   FOR SELECT TO authenticated USING (true);
CREATE POLICY geo_metrics_state_read ON public.geo_metrics_state FOR SELECT TO authenticated USING (true);
CREATE POLICY geo_metrics_h3_read    ON public.geo_metrics_h3    FOR SELECT TO authenticated USING (true);

GRANT SELECT ON public.geo_datasets, public.geo_segment_rules, public.geo_metrics_lga,
                public.geo_metrics_state, public.geo_metrics_h3 TO authenticated;
