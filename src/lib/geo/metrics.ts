/**
 * The metric catalogue for the market-intelligence map: for every figure the
 * UI can show, its label, unit, how it is derived, and which dataset column
 * on the row names its source. The evidence drawer is built from this plus
 * the `geo_datasets` row — so a number cannot be rendered without both.
 */

import type { GeoDataset, LgaMetrics, StateMetrics } from './types';

export type GeoLevel = 'state' | 'lga';

export type MetricKey =
  | 'pop_total' | 'pop_15_24' | 'pop_25_34' | 'pop_15_34' | 'pop_35_plus' | 'youth_share' | 'pop_density_km2'
  | 'ntl_mean' | 'poi_affluence_density_km2'
  | 'poi_university' | 'poi_mall' | 'poi_market' | 'poi_bank' | 'poi_hotel' | 'poi_airport' | 'poi_bus_terminal' | 'poi_hospital'
  | 'affluence_index' | 'segment'
  | 'dhs_wealth';

type DatasetColumn = 'population_dataset_id' | 'poi_dataset_id' | 'ntl_dataset_id' | 'dhs_dataset_id';

export type MetricDef = {
  key: MetricKey;
  label: string;
  /** Printed after the value and in legends. */
  unit: string;
  /** One or two sentences on how the figure is produced from its source. */
  method: string;
  /** Row column holding the dataset id. Composites name their inputs in `composedOf` instead. */
  datasetColumn?: DatasetColumn;
  composedOf?: DatasetColumn[];
  format: (value: number) => string;
};

const whole = (v: number) => Math.round(v).toLocaleString('en-NG');
const decimals = (digits: number) => (v: number) => v.toLocaleString('en-NG', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const percent = (v: number) => `${(v * 100).toLocaleString('en-NG', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
const density = (v: number) => (v >= 100 ? whole(v) : decimals(1)(v));

const POI_METHOD = 'Count of places with this tag in OpenStreetMap whose location falls inside the area. A lower bound: unmapped places are not counted.';

export const METRICS: Record<MetricKey, MetricDef> = {
  pop_total: {
    key: 'pop_total', label: 'Residents (modelled)', unit: 'people', datasetColumn: 'population_dataset_id', format: whole,
    method: 'Sum of all age and sex groups over the 100 m grid cells whose centre falls inside the area.',
  },
  pop_15_24: {
    key: 'pop_15_24', label: 'Residents aged 15-24 (modelled)', unit: 'people', datasetColumn: 'population_dataset_id', format: whole,
    method: 'Sum of the 15-19 and 20-24 age groups, both sexes, over the grid cells inside the area.',
  },
  pop_25_34: {
    key: 'pop_25_34', label: 'Residents aged 25-34 (modelled)', unit: 'people', datasetColumn: 'population_dataset_id', format: whole,
    method: 'Sum of the 25-29 and 30-34 age groups, both sexes, over the grid cells inside the area.',
  },
  pop_15_34: {
    key: 'pop_15_34', label: 'Residents aged 15-34 (modelled)', unit: 'people', datasetColumn: 'population_dataset_id', format: whole,
    method: 'Sum of the four 5-year age groups from 15-19 to 30-34, both sexes, over the grid cells inside the area.',
  },
  pop_35_plus: {
    key: 'pop_35_plus', label: 'Residents aged 35 and over (modelled)', unit: 'people', datasetColumn: 'population_dataset_id', format: whole,
    method: 'Sum of every age group from 35-39 upward, both sexes, over the grid cells inside the area.',
  },
  youth_share: {
    key: 'youth_share', label: 'Share of residents aged 15-34 (modelled)', unit: '% of residents', datasetColumn: 'population_dataset_id', format: percent,
    method: 'Residents aged 15-34 divided by all residents of the area.',
  },
  pop_density_km2: {
    key: 'pop_density_km2', label: 'Residents per km² (modelled)', unit: 'people per km²', datasetColumn: 'population_dataset_id', format: density,
    method: 'All residents of the area divided by its land area in km², computed from the boundary polygon.',
  },
  ntl_mean: {
    key: 'ntl_mean', label: 'Night-time light, mean', unit: 'nW/cm²/sr', datasetColumn: 'ntl_dataset_id', format: decimals(2),
    method: 'Mean brightness of every ~500 m grid cell inside the area; dark cells count as zero.',
  },
  poi_affluence_density_km2: {
    key: 'poi_affluence_density_km2', label: 'Banks, malls, hotels and universities per km² (mapped)', unit: 'places per km²', datasetColumn: 'poi_dataset_id', format: decimals(3),
    method: 'Mapped banks, malls, hotels and universities/colleges in the area, added together and divided by its area in km². A lower bound.',
  },
  poi_university:   { key: 'poi_university',   label: 'Universities and colleges (mapped)', unit: 'places', datasetColumn: 'poi_dataset_id', format: whole, method: POI_METHOD },
  poi_mall:         { key: 'poi_mall',         label: 'Malls (mapped)',                     unit: 'places', datasetColumn: 'poi_dataset_id', format: whole, method: POI_METHOD },
  poi_market:       { key: 'poi_market',       label: 'Markets (mapped)',                   unit: 'places', datasetColumn: 'poi_dataset_id', format: whole, method: POI_METHOD },
  poi_bank:         { key: 'poi_bank',         label: 'Banks (mapped)',                     unit: 'places', datasetColumn: 'poi_dataset_id', format: whole, method: POI_METHOD },
  poi_hotel:        { key: 'poi_hotel',        label: 'Hotels (mapped)',                    unit: 'places', datasetColumn: 'poi_dataset_id', format: whole, method: POI_METHOD },
  poi_airport:      { key: 'poi_airport',      label: 'Airports and airfields (mapped)',    unit: 'places', datasetColumn: 'poi_dataset_id', format: whole, method: POI_METHOD },
  poi_bus_terminal: { key: 'poi_bus_terminal', label: 'Bus terminals (mapped)',             unit: 'places', datasetColumn: 'poi_dataset_id', format: whole, method: POI_METHOD },
  poi_hospital:     { key: 'poi_hospital',     label: 'Hospitals (mapped)',                 unit: 'places', datasetColumn: 'poi_dataset_id', format: whole, method: POI_METHOD },
  affluence_index: {
    key: 'affluence_index', label: 'Affluence index', unit: 'index, 0-100', composedOf: ['ntl_dataset_id', 'poi_dataset_id'], format: decimals(1),
    method: 'A rank-based composite, not an income figure. The exact rule and weights are shown below.',
  },
  segment: {
    key: 'segment', label: 'Segment', unit: '', composedOf: ['population_dataset_id', 'ntl_dataset_id', 'poi_dataset_id'], format: whole,
    method: 'Assigned by fixed rules over the population and affluence figures. The exact rules and thresholds are shown below.',
  },
  dhs_wealth: {
    key: 'dhs_wealth', label: 'Household population by national wealth fifth (survey estimate)', unit: '% of household population', datasetColumn: 'dhs_dataset_id',
    format: v => `${decimals(1)(v)}%`,
    method: 'Share of the state\'s household population that falls in each fifth of the national household wealth ranking.',
  },
};

/** Metrics that can colour the map, per geography level. */
export const MAP_METRICS: Record<GeoLevel, MetricKey[]> = {
  state: ['pop_15_34', 'youth_share', 'pop_density_km2'],
  lga: ['pop_15_34', 'youth_share', 'pop_density_km2', 'affluence_index', 'segment'],
};

export const MAP_METRIC_NAMES: Partial<Record<MetricKey, string>> = {
  pop_15_34: 'Youth count',
  youth_share: 'Youth share',
  pop_density_km2: 'Population density',
  affluence_index: 'Affluence index',
  segment: 'Segment',
};

export function metricValue(row: LgaMetrics | StateMetrics, key: MetricKey): number | null {
  if (key === 'segment' || key === 'dhs_wealth') return null;
  const value = (row as unknown as Record<string, number | null | undefined>)[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function formatMetric(key: MetricKey, value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'No data';
  return METRICS[key].format(value);
}

/** The datasets behind a metric on a given row — one for a direct figure, several for a composite. */
export function metricDatasets(row: LgaMetrics | StateMetrics, key: MetricKey, datasets: Record<string, GeoDataset>): GeoDataset[] {
  const def = METRICS[key];
  const columns = def.datasetColumn ? [def.datasetColumn] : def.composedOf || [];
  const ids = columns.map(c => (row as unknown as Record<string, string | null | undefined>)[c]).filter((id): id is string => !!id);
  return ids.map(id => datasets[id]).filter(Boolean);
}

// ── Classification for the choropleth ──────────────────────────────────────

/** Single-hue sequential palette (ColorBrewer Blues, 5 classes) — colour-blind safe. */
export const SEQUENTIAL_COLORS = ['#EFF3FF', '#BDD7E7', '#6BAED6', '#3182BD', '#08519C'];
export const NO_DATA_COLOR = '#E5E7EB';

/** Three muted, colour-blind-safe hues (Paul Tol "muted") plus grey for unclassified. */
export const SEGMENT_COLORS = {
  high_value: '#332288',
  youth_hub: '#DDCC77',
  mass_market: '#44AA99',
  unclassified: '#C8CCD2',
} as const;

/**
 * Five quantile classes: breaks[i] is the lowest value of class i + 1, so
 * class 0 is [min, breaks[0]), class 4 is [breaks[3], max]. Tied values are
 * never split across classes, which can leave fewer than five when many
 * areas share a value (e.g. zero).
 */
export function quantileBreaks(values: (number | null)[], classes = 5): number[] {
  const sorted = values.filter((v): v is number => v !== null && Number.isFinite(v)).sort((a, b) => a - b);
  if (sorted.length === 0) return [];
  const breaks: number[] = [];
  for (let i = 1; i < classes; i++) {
    const b = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * i / classes))];
    if (b > sorted[0] && (breaks.length === 0 || b > breaks[breaks.length - 1])) breaks.push(b);
  }
  return breaks;
}

export function classIndex(value: number, breaks: number[]): number {
  let i = 0;
  while (i < breaks.length && value >= breaks[i]) i++;
  return i;
}

/** Spread the classes over the palette so two classes still read light-to-dark. */
export function classColors(classCount: number): string[] {
  if (classCount >= SEQUENTIAL_COLORS.length) return SEQUENTIAL_COLORS;
  if (classCount <= 1) return [SEQUENTIAL_COLORS[2]];
  return Array.from({ length: classCount }, (_, i) => SEQUENTIAL_COLORS[Math.round(i * (SEQUENTIAL_COLORS.length - 1) / (classCount - 1))]);
}
