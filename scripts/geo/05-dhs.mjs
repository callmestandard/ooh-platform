/**
 * Step 5 — DHS wealth quintile distribution per state.
 * Usage: node scripts/geo/05-dhs.mjs            (re-uses a saved response if present)
 *        node scripts/geo/05-dhs.mjs --refresh
 *
 * Source: The DHS Program Indicator Data API (the published STATcompiler
 * figures), survey NG2024DHS = Nigeria DHS 2023-24. No microdata is used.
 * Indicators HC_WIXQ_P_LOW … _HGH: percent of the de jure household
 * population in each NATIONAL wealth quintile, by state.
 *
 * These are survey estimates with sampling error. The API publishes the
 * weighted and unweighted denominators but no confidence intervals for these
 * indicators, so the sample size is stored and shown and no interval is
 * invented. State level only — the survey is not representative below that.
 */

import { existsSync } from 'fs';
import { resolve } from 'path';
import { DATA_DIR, OUT_DIR, ensureDir, readJson, writeJson } from './lib.mjs';

const SURVEY_ID = 'NG2024DHS';
const INDICATORS = {
  HC_WIXQ_P_LOW: 'q1_lowest_pct',
  HC_WIXQ_P_2ND: 'q2_second_pct',
  HC_WIXQ_P_MID: 'q3_middle_pct',
  HC_WIXQ_P_4TH: 'q4_fourth_pct',
  HC_WIXQ_P_HGH: 'q5_highest_pct',
};
const URL = `https://api.dhsprogram.com/rest/dhs/data?surveyIds=${SURVEY_ID}&indicatorIds=${Object.keys(INDICATORS).join(',')}&breakdown=subnational&f=json&perpage=1000`;

const rawPath = resolve(ensureDir(resolve(DATA_DIR, 'dhs')), 'wealth_quintiles_subnational.json');
let raw;
if (existsSync(rawPath) && !process.argv.includes('--refresh')) {
  raw = readJson(rawPath);
} else {
  const res = await fetch(URL);
  if (!res.ok) throw new Error(`DHS API ${res.status} ${res.statusText}`);
  raw = { retrieved_at: new Date().toISOString(), url: URL, response: await res.json() };
  writeJson(rawPath, raw);
}

const geographies = readJson(resolve(OUT_DIR, 'geographies.json'));
const normalise = s => s.toLowerCase().replace(/[^a-z]/g, '');
const stateByName = new Map(geographies.states.map(s => [normalise(s.state_name), s]));
// The DHS label for the capital differs from the boundary dataset's name.
stateByName.set(normalise('FCT Abuja'), geographies.states.find(s => normalise(s.state_name) === normalise('Federal Capital Territory')));

// LevelRank 2 = states ("..Benue"); LevelRank 1 = the six geopolitical zones, which are not used.
const byState = new Map();
for (const row of raw.response.Data) {
  if (row.LevelRank !== 2 || !INDICATORS[row.IndicatorId]) continue;
  const label = row.CharacteristicLabel.replace(/^\.+/, '').trim();
  const state = stateByName.get(normalise(label));
  if (!state) throw new Error(`DHS state "${label}" does not match any boundary state — refusing to guess.`);
  const entry = byState.get(state.state_pcode) || {
    state_pcode: state.state_pcode,
    dhs_label: label,
    survey_id: row.SurveyId,
    sample_households_population_unweighted: row.DenominatorUnweighted,
    sample_households_population_weighted: row.DenominatorWeighted,
  };
  entry[INDICATORS[row.IndicatorId]] = row.Value;
  byState.set(state.state_pcode, entry);
}

const rows = [...byState.values()].sort((a, b) => a.state_pcode.localeCompare(b.state_pcode));
const complete = rows.filter(r => Object.values(INDICATORS).every(k => typeof r[k] === 'number'));
if (rows.length !== 37 || complete.length !== 37) {
  throw new Error(`Expected 5 quintiles for 37 states, got ${complete.length} complete of ${rows.length}.`);
}

writeJson(resolve(OUT_DIR, 'dhs_wealth_state.json'), { dataset: 'dhs_ng_2023_24_wealth', retrieved_at: raw.retrieved_at, rows });

console.log(`DHS ${SURVEY_ID}: ${rows.length} states, retrieved ${raw.retrieved_at}`);
const sums = rows.map(r => Object.values(INDICATORS).reduce((s, k) => s + r[k], 0));
console.log(`Quintile shares sum to ${Math.min(...sums).toFixed(1)}–${Math.max(...sums).toFixed(1)} per state (published to 1 decimal).`);
const smallest = [...rows].sort((a, b) => a.sample_households_population_unweighted - b.sample_households_population_unweighted)[0];
console.log(`Smallest unweighted sample: ${smallest.dhs_label} (${smallest.sample_households_population_unweighted}).`);
