import type { Segment, SegmentThresholds, SegmentWeights } from './segments';

/** A row of `geo_datasets` — the provenance shown in the evidence drawer. */
export type GeoDataset = {
  id: string;
  name: string;
  publisher: string;
  version: string;
  reference_year: string;
  resolution: string;
  licence: string;
  licence_url: string | null;
  url: string;
  retrieved_on: string | null;
  method_summary: string;
  known_limitations: string;
  attribution: string;
  data_nature: 'modelled' | 'survey_estimate' | 'crowdsourced' | 'remote_sensing' | 'administrative';
  status: 'active' | 'excluded';
};

type PopulationColumns = {
  pop_total: number | null;
  pop_0_14: number | null;
  pop_15_24: number | null;
  pop_25_34: number | null;
  pop_35_plus: number | null;
  pop_15_34: number | null;
  youth_share: number | null;
  pop_density_km2: number | null;
  population_dataset_id: string | null;
};

type PoiColumns = {
  poi_university: number | null;
  poi_mall: number | null;
  poi_market: number | null;
  poi_bank: number | null;
  poi_hotel: number | null;
  poi_airport: number | null;
  poi_bus_terminal: number | null;
  poi_hospital: number | null;
  poi_affluence_density_km2: number | null;
  poi_dataset_id: string | null;
};

export type LgaMetrics = PopulationColumns & PoiColumns & {
  lga_pcode: string;
  lga_name: string;
  state_pcode: string;
  state_name: string;
  area_km2: number;
  boundary_dataset_id: string;
  rwi_mean: number | null;
  rwi_error_mean: number | null;
  rwi_dataset_id: string | null;
  ntl_mean: number | null;
  ntl_dataset_id: string | null;
  youth_count_pctile: number | null;
  youth_share_pctile: number | null;
  density_pctile: number | null;
  rwi_pctile: number | null;
  ntl_pctile: number | null;
  poi_density_pctile: number | null;
  affluence_index: number | null;
  affluence_pctile: number | null;
  is_high_value: boolean | null;
  is_youth_hub: boolean | null;
  is_mass_market: boolean | null;
  segment: Segment | null;
  segment_rule_id: string | null;
};

export type StateMetrics = PopulationColumns & PoiColumns & {
  state_pcode: string;
  state_name: string;
  area_km2: number;
  lga_count: number;
  boundary_dataset_id: string;
  ntl_mean: number | null;
  ntl_dataset_id: string | null;
  dhs_q1_lowest_pct: number | null;
  dhs_q2_second_pct: number | null;
  dhs_q3_middle_pct: number | null;
  dhs_q4_fourth_pct: number | null;
  dhs_q5_highest_pct: number | null;
  dhs_sample_unweighted: number | null;
  dhs_sample_weighted: number | null;
  dhs_dataset_id: string | null;
};

export type SegmentRules = {
  id: string;
  weights: SegmentWeights;
  thresholds: SegmentThresholds;
  rule_text: Record<string, string>;
  computed_at: string;
};

/** public/geo/h3-meta.json, written by scripts/geo/08-tiles.mjs. */
export type H3Meta = {
  tiles: string;
  source_layer: string;
  dataset: string;
  levels: { resolution: number; min_zoom: number; max_zoom: number; cells: number; breaks: { d: number[]; yd: number[] } }[];
};

export type MarketData = {
  lgas: LgaMetrics[];
  states: StateMetrics[];
  datasets: Record<string, GeoDataset>;
  rules: SegmentRules | null;
};
