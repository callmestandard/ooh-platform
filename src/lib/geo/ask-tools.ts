/**
 * "Ask the map" — the read-only tools the model may call. Server only.
 *
 * Each tool reads the pre-computed tables through a Supabase client that
 * carries the asking user's own token, so row-level security decides what
 * they can see (boards in particular). Tools return figures only: a value,
 * the server-formatted display text, the geography and the dataset id.
 * Nothing is computed here beyond selecting, sorting and counting rows.
 */

import type Anthropic from '@anthropic-ai/sdk';
import type { SupabaseClient } from '@supabase/supabase-js';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import type { Figure, ToolResult } from './ask-core';
import { METRICS, formatMetric, type MetricKey } from './metrics';
import { SEGMENT_LABELS, type Segment } from './segments';
import type { GeoDataset, LgaMetrics, SegmentRules, StateMetrics } from './types';

export const SEGMENT_RULES_ID = 'segment_rules:default';

const QUERYABLE: MetricKey[] = [
  'pop_total', 'pop_15_24', 'pop_25_34', 'pop_15_34', 'pop_35_plus', 'youth_share', 'pop_density_km2',
  'ntl_mean', 'poi_affluence_density_km2', 'poi_university', 'poi_mall', 'poi_market', 'poi_bank', 'poi_hotel',
  'poi_airport', 'poi_bus_terminal', 'poi_hospital', 'affluence_index',
];
const SEGMENTS: Segment[] = ['high_value', 'youth_hub', 'mass_market', 'unclassified'];
const AGE_BANDS = ['pop_15_24', 'pop_25_34', 'pop_15_34', 'pop_35_plus'] as const;
const BAND_TEXT: Record<(typeof AGE_BANDS)[number], string> = {
  pop_15_24: 'aged 15-24', pop_25_34: 'aged 25-34', pop_15_34: 'aged 15-34', pop_35_plus: 'aged 35 and over',
};
const DHS_FIFTHS = [
  ['dhs_q1_lowest_pct', 'lowest'], ['dhs_q2_second_pct', 'second'], ['dhs_q3_middle_pct', 'middle'],
  ['dhs_q4_fourth_pct', 'fourth'], ['dhs_q5_highest_pct', 'highest'],
] as const;

const str = { type: 'string' } as const;

export const ASK_TOOLS: Anthropic.Tool[] = [
  {
    name: 'query_metrics',
    description: 'Rank or list states or LGAs by one metric, optionally filtered. Returns one figure per area. Use this for "which/where/top/most/least" questions. affluence_index and segment filters apply to LGAs only.',
    input_schema: {
      type: 'object', additionalProperties: false, required: ['geography', 'metric'],
      properties: {
        geography: { type: 'string', enum: ['state', 'lga'] },
        metric: { type: 'string', enum: QUERYABLE, description: 'pop_* are modelled residents; youth_share is the share aged 15-34; poi_* are mapped places (lower bounds); ntl_mean is night-time light.' },
        state: { ...str, description: 'Limit LGAs to this state (name as in Nigeria, e.g. "Lagos", "Federal Capital Territory").' },
        segment: { type: 'string', enum: SEGMENTS, description: 'Limit LGAs to this segment.' },
        sort: { type: 'string', enum: ['desc', 'asc'], description: 'desc = highest first (default).' },
        limit: { type: 'integer', description: '1 to 20; default 5.' },
      },
    },
  },
  {
    name: 'get_state_profile',
    description: 'Everything held for one state: modelled residents and age bands, density, DHS household wealth fifths with sample size, counts of LGAs in each segment, and the top 5 LGAs by residents aged 15-34 and by affluence index.',
    input_schema: { type: 'object', additionalProperties: false, required: ['state'], properties: { state: str } },
  },
  {
    name: 'compare_states',
    description: 'The same headline figures for two or three states side by side: residents, residents aged 15-34, share aged 15-34, density and DHS wealth fifths.',
    input_schema: { type: 'object', additionalProperties: false, required: ['states'], properties: { states: { type: 'array', items: str, minItems: 2, maxItems: 3 } } },
  },
  {
    name: 'get_dataset_info',
    description: `Provenance of a dataset: publisher, version, reference year, resolution, licence, method and known limitations. Use "${SEGMENT_RULES_ID}" for the exact segment rules and thresholds.`,
    input_schema: { type: 'object', additionalProperties: false, required: ['dataset_id'], properties: { dataset_id: str } },
  },
  {
    name: 'list_boards_in_segment',
    description: 'Boards on this platform that the user can see, located in LGAs of a given segment, ordered by modelled residents living within a radius. This is residents nearby, not people who see the board.',
    input_schema: {
      type: 'object', additionalProperties: false, required: ['segment'],
      properties: {
        segment: { type: 'string', enum: SEGMENTS },
        state: str,
        age_band: { type: 'string', enum: [...AGE_BANDS], description: 'Default pop_15_34.' },
        radius_km: { type: 'integer', enum: [1, 2, 5], description: 'Default 2.' },
        limit: { type: 'integer', description: '1 to 20; default 10.' },
      },
    },
  },
];

type Context = {
  supabase: SupabaseClient;
  /** Site origin, to read the static LGA boundary file. */
  origin: string;
};

type Loaded = { lgas: LgaMetrics[]; states: StateMetrics[]; datasets: Record<string, GeoDataset>; rules: SegmentRules | null };

let lgaGeoCache: Promise<GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon>> | null = null;

export function createToolExecutor(context: Context) {
  let loaded: Promise<Loaded> | null = null;

  const load = () => {
    if (!loaded) {
      loaded = (async () => {
        const [lgas, states, datasets, rules] = await Promise.all([
          context.supabase.from('geo_metrics_lga').select('*'),
          context.supabase.from('geo_metrics_state').select('*'),
          context.supabase.from('geo_datasets').select('*'),
          context.supabase.from('geo_segment_rules').select('*').eq('id', 'default').maybeSingle(),
        ]);
        const failed = [lgas, states, datasets, rules].find(r => r.error);
        if (failed?.error) throw new Error(failed.error.message);
        return {
          lgas: (lgas.data || []) as LgaMetrics[],
          states: (states.data || []) as StateMetrics[],
          datasets: Object.fromEntries(((datasets.data || []) as GeoDataset[]).map(d => [d.id, d])),
          rules: (rules.data as SegmentRules | null) ?? null,
        };
      })();
    }
    return loaded;
  };

  const DATASET_COLUMN: Partial<Record<MetricKey, 'population_dataset_id' | 'poi_dataset_id' | 'ntl_dataset_id'>> = {};
  for (const key of QUERYABLE) {
    const column = METRICS[key].datasetColumn;
    if (column && column !== 'dhs_dataset_id') DATASET_COLUMN[key] = column;
  }

  /** A figure for one metric on one row, or null when the value or its source is missing (never a zero in its place). */
  function figure(data: Loaded, row: LgaMetrics | StateMetrics, key: MetricKey, geography: string): Figure | null {
    const value = (row as unknown as Record<string, number | null>)[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    const datasetId = key === 'affluence_index' ? SEGMENT_RULES_ID : (row as unknown as Record<string, string | null>)[DATASET_COLUMN[key] as string];
    if (!datasetId) return null;
    return {
      metric: key,
      label: METRICS[key].label,
      geography,
      value,
      display: formatMetric(key, value),
      unit: METRICS[key].unit,
      dataset_id: datasetId,
      reference_year: datasetId === SEGMENT_RULES_ID ? rulesYear(data) : data.datasets[datasetId]?.reference_year ?? 'not recorded',
    };
  }

  /** The affluence index and segments combine several datasets; their "year" is the list of those. */
  function rulesYear(data: Loaded): string {
    return ['worldpop_agesex_2020_constrained', 'ntl_npp_viirs_like_v2', 'osm_pois']
      .map(id => data.datasets[id]).filter(Boolean)
      .map(d => `${d.publisher.split(',')[0]} ${d.id === 'osm_pois' ? d.retrieved_on ?? '' : d.reference_year}`.trim()).join('; ');
  }

  const lgaName = (l: LgaMetrics) => `${l.lga_name} LGA, ${l.state_name}`;
  const stateName = (s: StateMetrics) => (/territory/i.test(s.state_name) ? s.state_name : `${s.state_name} State`);
  const findState = (data: Loaded, name: string) => {
    const wanted = name.toLowerCase().replace(/\bstate\b/g, '').replace(/[^a-z]/g, '');
    const alias = wanted === 'fct' || wanted === 'abuja' || wanted === 'fctabuja' ? 'federalcapitalterritory' : wanted;
    return data.states.find(s => s.state_name.toLowerCase().replace(/[^a-z]/g, '') === alias) ?? null;
  };
  const clamp = (n: unknown, fallback: number) => Math.min(20, Math.max(1, Number.isFinite(Number(n)) ? Math.round(Number(n)) : fallback));

  function stateFigures(data: Loaded, s: StateMetrics): Figure[] {
    const figures: Figure[] = [];
    for (const key of ['pop_total', 'pop_15_24', 'pop_25_34', 'pop_15_34', 'pop_35_plus', 'youth_share', 'pop_density_km2'] as MetricKey[]) {
      const f = figure(data, s, key, stateName(s));
      if (f) figures.push(f);
    }
    if (s.dhs_dataset_id) {
      const year = data.datasets[s.dhs_dataset_id]?.reference_year ?? 'not recorded';
      for (const [column, name] of DHS_FIFTHS) {
        const value = s[column];
        if (typeof value !== 'number') continue;
        figures.push({ metric: column, label: `Household population in the ${name} national wealth fifth (survey estimate)`, geography: stateName(s), value, display: formatMetric('dhs_wealth', value), unit: METRICS.dhs_wealth.unit, dataset_id: s.dhs_dataset_id, reference_year: year });
      }
      if (typeof s.dhs_sample_unweighted === 'number') {
        figures.push({ metric: 'dhs_sample_unweighted', label: 'DHS sample: people in surveyed households (unweighted)', geography: stateName(s), value: s.dhs_sample_unweighted, display: s.dhs_sample_unweighted.toLocaleString('en-NG'), unit: 'people', dataset_id: s.dhs_dataset_id, reference_year: year });
      }
    }
    return figures;
  }

  async function queryMetrics(input: Record<string, unknown>): Promise<ToolResult> {
    const data = await load();
    const key = input.metric as MetricKey;
    if (!QUERYABLE.includes(key)) return { figures: [], error: `Unknown metric "${String(input.metric)}".` };
    const notes: string[] = [];
    let rows: (LgaMetrics | StateMetrics)[];
    if (input.geography === 'state') {
      if (key === 'affluence_index' || input.segment) return { figures: [], error: 'The affluence index and segments are defined for LGAs only. Query geography "lga".' };
      rows = data.states;
    } else {
      let lgas = data.lgas;
      if (typeof input.state === 'string') {
        const state = findState(data, input.state);
        if (!state) return { figures: [], error: `No state named "${input.state}".` };
        lgas = lgas.filter(l => l.state_pcode === state.state_pcode);
      }
      if (typeof input.segment === 'string') {
        lgas = lgas.filter(l => l.segment === input.segment);
        notes.push(`Segment "${SEGMENT_LABELS[input.segment as Segment]}": ${data.rules?.rule_text[input.segment as Segment] ?? 'rule not recorded'}`);
      }
      rows = lgas;
    }
    const withValue = rows
      .map(row => ({ row, f: figure(data, row, key, 'lga_pcode' in row ? lgaName(row) : stateName(row)) }))
      .filter((x): x is { row: LgaMetrics | StateMetrics; f: Figure } => x.f !== null);
    const direction = input.sort === 'asc' ? 1 : -1;
    withValue.sort((a, b) => direction * (a.f.value - b.f.value));
    const top = withValue.slice(0, clamp(input.limit, 5));
    notes.push(`${withValue.length} areas matched; showing ${top.length}, ${direction === 1 ? 'lowest' : 'highest'} first.`);
    if (key.startsWith('poi_')) notes.push('Mapped-place counts are lower bounds: unmapped places are not counted.');
    for (const { row } of top) if ('segment' in row && row.segment) notes.push(`${lgaName(row)} is in segment "${SEGMENT_LABELS[row.segment]}".`);
    return { figures: top.map(x => x.f), notes };
  }

  async function stateProfile(input: Record<string, unknown>): Promise<ToolResult> {
    const data = await load();
    const state = findState(data, String(input.state ?? ''));
    if (!state) return { figures: [], error: `No state named "${String(input.state)}".` };
    const figures = stateFigures(data, state);
    const lgas = data.lgas.filter(l => l.state_pcode === state.state_pcode);
    const notes: string[] = [`${state.state_name} has ${state.lga_count} LGAs.`];
    for (const segment of SEGMENTS) {
      const inSegment = lgas.filter(l => (l.segment ?? 'unclassified') === segment);
      figures.push({ metric: `lga_count_${segment}`, label: `LGAs in segment "${SEGMENT_LABELS[segment]}"`, geography: stateName(state), value: inSegment.length, display: String(inSegment.length), unit: 'LGAs', dataset_id: SEGMENT_RULES_ID, reference_year: rulesYear(data) });
      if (segment !== 'unclassified' && inSegment.length > 0) notes.push(`${SEGMENT_LABELS[segment]} LGAs: ${inSegment.map(l => l.lga_name).join(', ')}. Rule: ${data.rules?.rule_text[segment] ?? 'not recorded'}`);
    }
    for (const key of ['pop_15_34', 'affluence_index'] as MetricKey[]) {
      const top = lgas.map(l => figure(data, l, key, lgaName(l))).filter((f): f is Figure => f !== null).sort((a, b) => b.value - a.value).slice(0, 5);
      figures.push(...top);
    }
    notes.push('DHS wealth fifths are survey estimates; the source publishes sample sizes but no confidence intervals.');
    return { figures, notes };
  }

  async function compareStates(input: Record<string, unknown>): Promise<ToolResult> {
    const data = await load();
    const names = Array.isArray(input.states) ? input.states.map(String) : [];
    if (names.length < 2 || names.length > 3) return { figures: [], error: 'Give two or three states.' };
    const figures: Figure[] = [];
    for (const name of names) {
      const state = findState(data, name);
      if (!state) return { figures: [], error: `No state named "${name}".` };
      figures.push(...stateFigures(data, state));
    }
    return { figures, notes: ['Figures are listed per state; no difference or ratio between states is provided.'] };
  }

  async function datasetInfo(input: Record<string, unknown>): Promise<ToolResult> {
    const data = await load();
    const id = String(input.dataset_id ?? '');
    if (id === SEGMENT_RULES_ID) {
      if (!data.rules) return { figures: [], error: 'Segment rules are not loaded.' };
      return { figures: [], notes: Object.entries(data.rules.rule_text).map(([k, text]) => `${k}: ${text}`) };
    }
    const d = data.datasets[id];
    if (!d) return { figures: [], error: `No dataset "${id}". Known: ${Object.keys(data.datasets).join(', ')}, ${SEGMENT_RULES_ID}.` };
    return {
      figures: [],
      notes: [
        `Name: ${d.name}`, `Publisher: ${d.publisher}`, `Version: ${d.version}`, `Reference year: ${d.reference_year}`, `Resolution: ${d.resolution}`,
        `Licence: ${d.licence}`, `Method: ${d.method_summary}`, `Known limitations: ${d.known_limitations}`, `Retrieved: ${d.retrieved_on ?? 'not recorded'}`,
        `Status: ${d.status}`,
      ],
    };
  }

  async function boardsInSegment(input: Record<string, unknown>): Promise<ToolResult> {
    const data = await load();
    const segment = input.segment as Segment;
    if (!SEGMENTS.includes(segment)) return { figures: [], error: `Unknown segment "${String(input.segment)}".` };
    const band = (AGE_BANDS as readonly string[]).includes(String(input.age_band)) ? (input.age_band as (typeof AGE_BANDS)[number]) : 'pop_15_34';
    const radius = [1, 2, 5].includes(Number(input.radius_km)) ? Number(input.radius_km) : 2;
    const stateFilter = typeof input.state === 'string' ? findState(data, input.state) : null;
    if (typeof input.state === 'string' && !stateFilter) return { figures: [], error: `No state named "${input.state}".` };

    const { data: boards, error } = await context.supabase.from('boards').select('id, name, latitude, longitude').not('latitude', 'is', null).not('longitude', 'is', null).limit(5000);
    if (error) return { figures: [], error: error.message };
    if (!lgaGeoCache) {
      lgaGeoCache = fetch(`${context.origin}/geo/ng-lga.geojson`).then(r => { if (!r.ok) throw new Error(`LGA boundaries: ${r.status}`); return r.json(); });
      lgaGeoCache.catch(() => { lgaGeoCache = null; });
    }
    const geo = await lgaGeoCache;
    const lgaByCode = new Map(data.lgas.map(l => [l.lga_pcode, l]));

    const inSegment: { id: string; name: string; lga: LgaMetrics }[] = [];
    for (const b of (boards || []) as { id: string; name: string; latitude: number; longitude: number }[]) {
      const feature = geo.features.find(f => booleanPointInPolygon([b.longitude, b.latitude], f));
      const lga = feature ? lgaByCode.get(feature.properties?.lga_pcode) : undefined;
      if (!lga || (lga.segment ?? 'unclassified') !== segment) continue;
      if (stateFilter && lga.state_pcode !== stateFilter.state_pcode) continue;
      inSegment.push({ id: b.id, name: b.name, lga });
    }
    const notes = [
      `${inSegment.length} visible boards are in "${SEGMENT_LABELS[segment]}" LGAs${stateFilter ? ` in ${stateFilter.state_name}` : ''}. Rule: ${data.rules?.rule_text[segment] ?? 'not recorded'}`,
      'Figures are modelled residents living within the radius of each board, not people who see it.',
    ];
    if (inSegment.length === 0) return { figures: [], notes };

    const { data: catchments, error: catchmentError } = await context.supabase
      .from('board_catchments').select('board_id, pop_15_24, pop_25_34, pop_35_plus, population_dataset_id')
      .eq('radius_km', radius).in('board_id', inSegment.slice(0, 300).map(b => b.id));
    if (catchmentError) return { figures: [], error: catchmentError.message };
    const byBoard = new Map((catchments || []).map(c => [c.board_id as string, c]));

    const figures: Figure[] = [];
    let missing = 0;
    for (const b of inSegment) {
      const c = byBoard.get(b.id);
      if (!c) { missing++; continue; }
      const value = band === 'pop_15_34' ? c.pop_15_24 + c.pop_25_34 : c[band];
      figures.push({
        metric: `catchment_${band}_${radius}km`,
        label: `Residents ${BAND_TEXT[band]} within ${radius} km (modelled)`,
        geography: `Board "${b.name}" (${b.lga.lga_name} LGA, ${b.lga.state_name})`,
        value,
        display: Math.round(value).toLocaleString('en-NG'),
        unit: 'residents',
        dataset_id: c.population_dataset_id,
        reference_year: data.datasets[c.population_dataset_id]?.reference_year ?? 'not recorded',
      });
    }
    if (missing > 0) notes.push(`${missing} of these boards have no computed catchment and are left out.`);
    figures.sort((a, b) => b.value - a.value);
    return { figures: figures.slice(0, clamp(input.limit, 10)), notes };
  }

  return async function executeTool(name: string, input: unknown): Promise<ToolResult> {
    const args = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
    try {
      switch (name) {
        case 'query_metrics': return await queryMetrics(args);
        case 'get_state_profile': return await stateProfile(args);
        case 'compare_states': return await compareStates(args);
        case 'get_dataset_info': return await datasetInfo(args);
        case 'list_boards_in_segment': return await boardsInSegment(args);
        default: return { figures: [], error: `Unknown tool "${name}".` };
      }
    } catch (err) {
      return { figures: [], error: err instanceof Error ? err.message : 'The lookup failed.' };
    }
  };
}
