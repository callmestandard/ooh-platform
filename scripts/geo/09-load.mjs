/**
 * Step 9 — load the computed outputs into Supabase.
 * Usage: node scripts/geo/09-load.mjs [--h3=7,8,9]
 *
 * Requires migration 038 to have been run, and .env.local with
 * NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
 *
 * Writes geo_datasets, geo_segment_rules, geo_metrics_lga, geo_metrics_state
 * and geo_metrics_h3 (resolution 7 unless --h3 says otherwise). Re-runnable: rows are
 * upserted by primary key. Values are loaded exactly as computed — nothing
 * is rounded here.
 */

import { createReadStream, existsSync } from 'fs';
import { resolve } from 'path';
import { createInterface } from 'readline';
import { createClient } from '@supabase/supabase-js';
import { DATA_DIR, OUT_DIR, loadEnv, readJson } from './lib.mjs';
import { DATASETS } from './datasets.mjs';

loadEnv();
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}
const supabase = createClient(url, key, { auth: { persistSession: false } });

const BATCH = 1000;
// Resolution 7 (155,000 cells) by default. Resolutions 8 (687,000) and 9 (2.2 million) are
// computed too but are large tables: load them with --h3=7,8,9 once Phase B needs them.
const h3Arg = process.argv.find(a => a.startsWith('--h3='));
const H3_RESOLUTIONS = h3Arg ? h3Arg.slice(5).split(',').map(Number) : [7];
const POI_KEYS = ['university', 'mall', 'market', 'bank', 'hotel', 'airport', 'bus_terminal', 'hospital'];

async function upsert(table, rows, onConflict) {
  for (let i = 0; i < rows.length; i += BATCH) {
    const { error } = await supabase.from(table).upsert(rows.slice(i, i + BATCH), { onConflict });
    if (error) {
      if (error.code === 'PGRST205' || /does not exist|schema cache/i.test(error.message)) {
        console.error(`Table ${table} is missing — run supabase/migrations/038_geo_market_intelligence.sql first.`);
      } else {
        console.error(`${table}: ${error.message}`);
      }
      process.exit(1);
    }
  }
  console.log(`${table.padEnd(20)} ${rows.length.toLocaleString()} rows`);
}

// ── Datasets, with the date each was actually fetched ──────────────────────
const retrieved = readJson(resolve(DATA_DIR, 'retrieved.json'));
const day = iso => (iso ? iso.slice(0, 10) : null);
const retrievedOn = {
  worldpop_agesex_2020_constrained: retrieved.worldpop_agesex_2020_constrained,
  ocha_cod_ab_nga: retrieved.ocha_cod_ab_nga,
  ntl_npp_viirs_like_v2: retrieved.ntl_npp_viirs_like_v2,
  osm_pois: day(readJson(resolve(OUT_DIR, 'poi_summary.json')).retrieved_at),
  dhs_ng_2023_24_wealth: day(readJson(resolve(OUT_DIR, 'dhs_wealth_state.json')).retrieved_at),
};
const now = new Date().toISOString();
await upsert('geo_datasets', DATASETS.map(d => ({ ...d, retrieved_on: retrievedOn[d.id] || null, updated_at: now })), 'id');

// ── Segment rules, then LGA and state metrics ──────────────────────────────
const rules = readJson(resolve(OUT_DIR, 'segment_rules.json'));
await upsert('geo_segment_rules', [{ ...rules, computed_at: now }], 'id');
await upsert('geo_metrics_lga', readJson(resolve(OUT_DIR, 'metrics_lga.json')).map(r => ({ ...r, computed_at: now })), 'lga_pcode');
await upsert('geo_metrics_state', readJson(resolve(OUT_DIR, 'metrics_state.json')).map(r => ({ ...r, computed_at: now })), 'state_pcode');

// ── H3 cells ───────────────────────────────────────────────────────────────
async function* readCsv(path) {
  let header = null;
  for await (const line of createInterface({ input: createReadStream(path) })) {
    const parts = line.split(',');
    if (!header) { header = parts; continue; }
    yield Object.fromEntries(header.map((h, i) => [h, i === 0 ? parts[i] : Number(parts[i])]));
  }
}

for (const res of H3_RESOLUTIONS) {
  const csvPath = resolve(OUT_DIR, `pop_h3_r${res}.csv`);
  if (!existsSync(csvPath)) { console.error(`Missing ${csvPath}`); process.exit(1); }
  const poi = new Map(readJson(resolve(OUT_DIR, `poi_h3_r${res}.json`)).map(r => [r.h3, r]));

  let batch = [];
  let total = 0;
  const flush = async () => {
    const { error } = await supabase.from('geo_metrics_h3').upsert(batch, { onConflict: 'h3' });
    if (error) { console.error(`geo_metrics_h3: ${error.message}`); process.exit(1); }
    total += batch.length;
    batch = [];
  };
  for await (const row of readCsv(csvPath)) {
    // A populated cell with no mapped POI stores zero counts; the POI table only lists cells that have one.
    const counts = poi.get(row.h3);
    const cell = {
      h3: row.h3,
      resolution: res,
      lat: row.lat,
      lng: row.lng,
      area_km2: row.area_km2,
      pop_total: row.pop_0_14 + row.pop_15_24 + row.pop_25_34 + row.pop_35_plus,
      pop_0_14: row.pop_0_14,
      pop_15_24: row.pop_15_24,
      pop_25_34: row.pop_25_34,
      pop_35_plus: row.pop_35_plus,
      population_dataset_id: 'worldpop_agesex_2020_constrained',
      poi_dataset_id: 'osm_pois',
    };
    for (const k of POI_KEYS) cell[`poi_${k}`] = counts ? counts[k] : 0;
    batch.push(cell);
    if (batch.length === BATCH) await flush();
  }
  if (batch.length) await flush();
  console.log(`geo_metrics_h3 r${res}    ${total.toLocaleString()} rows`);
}


console.log('Done.');
