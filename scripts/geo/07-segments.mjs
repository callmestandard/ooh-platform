/**
 * Step 7 — join every source into one row per LGA and per state, then apply
 * the segment rules.
 * Usage: node scripts/geo/07-segments.mjs
 *
 * The rules themselves live in src/lib/geo/segments.ts — the same file the
 * app's settings panel runs — so the stored default and the on-screen
 * recalculation can never drift apart. This step only joins and derives:
 *   youth_share               = pop_15_34 / pop_total
 *   pop_density_km2           = pop_total / area_km2
 *   poi_affluence_density_km2 = (banks + malls + hotels + universities) / area_km2
 *
 * A geography with no population has no share or density (null, not zero).
 *
 * Writes scripts/geo/out/metrics_lga.json, metrics_state.json, segment_rules.json.
 */

import { resolve } from 'path';
import { OUT_DIR, readJson, writeJson } from './lib.mjs';
import { computeSegments, segmentRuleText, DEFAULT_WEIGHTS, SEGMENT_PRECEDENCE } from '../../src/lib/geo/segments.ts';

const RULE_ID = 'default';
const AFFLUENCE_POI = ['bank', 'mall', 'hotel', 'university'];
const POI_KEYS = ['university', 'mall', 'market', 'bank', 'hotel', 'airport', 'bus_terminal', 'hospital'];

const geographies = readJson(resolve(OUT_DIR, 'geographies.json'));
const byKey = (rows, key) => new Map(rows.map(r => [r[key], r]));
const popLga = byKey(readJson(resolve(OUT_DIR, 'pop_lga.json')), 'lga_pcode');
const popState = byKey(readJson(resolve(OUT_DIR, 'pop_state.json')), 'state_pcode');
const poiLga = byKey(readJson(resolve(OUT_DIR, 'poi_lga.json')), 'lga_pcode');
const poiState = byKey(readJson(resolve(OUT_DIR, 'poi_state.json')), 'state_pcode');
const ntlLga = byKey(readJson(resolve(OUT_DIR, 'ntl_lga.json')), 'lga_pcode');
const ntlState = byKey(readJson(resolve(OUT_DIR, 'ntl_state.json')), 'state_pcode');
const dhs = byKey(readJson(resolve(OUT_DIR, 'dhs_wealth_state.json')).rows, 'state_pcode');

function populationColumns(pop, areaKm2) {
  const hasPeople = pop && pop.pop_total > 0;
  return {
    pop_total: pop ? pop.pop_total : null,
    pop_0_14: pop ? pop.pop_0_14 : null,
    pop_15_24: pop ? pop.pop_15_24 : null,
    pop_25_34: pop ? pop.pop_25_34 : null,
    pop_35_plus: pop ? pop.pop_35_plus : null,
    pop_15_34: pop ? pop.pop_15_34 : null,
    youth_share: hasPeople ? pop.pop_15_34 / pop.pop_total : null,
    pop_density_km2: pop ? pop.pop_total / areaKm2 : null,
    population_dataset_id: pop ? 'worldpop_agesex_2020_constrained' : null,
  };
}

function poiColumns(poi, areaKm2) {
  const columns = {};
  for (const key of POI_KEYS) columns[`poi_${key}`] = poi ? poi[key] : null;
  columns.poi_affluence_density_km2 = poi ? AFFLUENCE_POI.reduce((s, k) => s + poi[k], 0) / areaKm2 : null;
  columns.poi_dataset_id = poi ? 'osm_pois' : null;
  return columns;
}

const lgaRows = geographies.lgas.map(lga => {
  const ntl = ntlLga.get(lga.lga_pcode);
  return {
    lga_pcode: lga.lga_pcode,
    lga_name: lga.lga_name,
    state_pcode: lga.state_pcode,
    state_name: lga.state_name,
    area_km2: lga.area_km2,
    boundary_dataset_id: 'ocha_cod_ab_nga',
    ...populationColumns(popLga.get(lga.lga_pcode), lga.area_km2),
    ...poiColumns(poiLga.get(lga.lga_pcode), lga.area_km2),
    // Relative Wealth Index is excluded (non-commercial licence) — the columns stay empty.
    rwi_mean: null,
    rwi_error_mean: null,
    rwi_cell_count: null,
    rwi_dataset_id: null,
    ntl_mean: ntl ? ntl.ntl_mean : null,
    ntl_dataset_id: ntl && ntl.ntl_mean !== null ? 'ntl_npp_viirs_like_v2' : null,
  };
});

const { results, thresholds } = computeSegments(lgaRows, DEFAULT_WEIGHTS);
const ruleText = segmentRuleText(thresholds);
results.forEach((result, i) => {
  if (result.lga_pcode !== lgaRows[i].lga_pcode) throw new Error('Segment results out of order');
  Object.assign(lgaRows[i], result, { segment_rule_id: RULE_ID });
});

const stateRows = geographies.states.map(state => {
  const ntl = ntlState.get(state.state_pcode);
  const wealth = dhs.get(state.state_pcode);
  return {
    state_pcode: state.state_pcode,
    state_name: state.state_name,
    area_km2: state.area_km2,
    lga_count: state.lga_count,
    boundary_dataset_id: 'ocha_cod_ab_nga',
    ...populationColumns(popState.get(state.state_pcode), state.area_km2),
    ...poiColumns(poiState.get(state.state_pcode), state.area_km2),
    ntl_mean: ntl ? ntl.ntl_mean : null,
    ntl_dataset_id: ntl && ntl.ntl_mean !== null ? 'ntl_npp_viirs_like_v2' : null,
    dhs_q1_lowest_pct: wealth ? wealth.q1_lowest_pct : null,
    dhs_q2_second_pct: wealth ? wealth.q2_second_pct : null,
    dhs_q3_middle_pct: wealth ? wealth.q3_middle_pct : null,
    dhs_q4_fourth_pct: wealth ? wealth.q4_fourth_pct : null,
    dhs_q5_highest_pct: wealth ? wealth.q5_highest_pct : null,
    dhs_sample_unweighted: wealth ? wealth.sample_households_population_unweighted : null,
    dhs_sample_weighted: wealth ? wealth.sample_households_population_weighted : null,
    dhs_dataset_id: wealth ? 'dhs_ng_2023_24_wealth' : null,
  };
});

writeJson(resolve(OUT_DIR, 'metrics_lga.json'), lgaRows);
writeJson(resolve(OUT_DIR, 'metrics_state.json'), stateRows);
writeJson(resolve(OUT_DIR, 'segment_rules.json'), {
  id: RULE_ID,
  weights: DEFAULT_WEIGHTS,
  thresholds: { ...thresholds, precedence: SEGMENT_PRECEDENCE },
  rule_text: ruleText,
});

const count = segment => lgaRows.filter(r => r.segment === segment).length;
console.log('Segments:', { high_value: count('high_value'), youth_hub: count('youth_hub'), mass_market: count('mass_market'), unclassified: count('unclassified') });
console.log('Met a rule but shown under an earlier one:', {
  youth_hub: lgaRows.filter(r => r.is_youth_hub && r.segment !== 'youth_hub').length,
  mass_market: lgaRows.filter(r => r.is_mass_market && r.segment !== 'mass_market').length,
});
console.log('LGAs with no affluence index:', lgaRows.filter(r => r.affluence_index === null).length);
for (const [key, text] of Object.entries(ruleText)) console.log(`  ${key}: ${text}`);
