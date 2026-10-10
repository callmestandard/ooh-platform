/**
 * Step 10 — load the resolution-9 population cells and compute every board's catchment.
 * Usage: node scripts/geo/10-catchments.mjs            (load cells, refresh boards, verify)
 *        node scripts/geo/10-catchments.mjs --verify   (only compare the database with the local file)
 *
 * Requires migration 039 and step 3's scripts/geo/out/pop_h3_r9.csv.
 *
 * Loads 2.2 million narrow rows into geo_pop_r9 (emptied first), records the
 * source dataset, then asks the database to recompute board_catchments for
 * every board. From then on the trigger added in 039 keeps a board's row
 * current whenever its coordinates change.
 *
 * Verification: for a few fixed points the catchment is computed twice —
 * here, straight from the CSV, and in the database by geo_catchment_at — and
 * the two must agree. The cells are stored as 4-byte floats, so agreement is
 * to about 6 significant figures, not bit-for-bit.
 */

import { createReadStream, existsSync } from 'fs';
import { resolve } from 'path';
import { createInterface } from 'readline';
import { createClient } from '@supabase/supabase-js';
import { OUT_DIR, loadEnv } from './lib.mjs';

loadEnv();
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const DATASET_ID = 'worldpop_agesex_2020_constrained';
const BATCH = 5000;
const RADII = [1, 2, 5];
const CHECK_POINTS = [
  { name: 'Ikeja, Lagos', lat: 6.6018, lng: 3.3515 },
  { name: 'Kano city', lat: 12.0022, lng: 8.5919 },
  { name: 'Wuse, Abuja', lat: 9.0765, lng: 7.4892 },
  { name: 'Port Harcourt', lat: 4.8156, lng: 7.0498 },
  { name: 'Open country, Niger State', lat: 9.9, lng: 5.2 },
];

const csvPath = resolve(OUT_DIR, 'pop_h3_r9.csv');
if (!existsSync(csvPath)) { console.error(`Missing ${csvPath} — run scripts/geo/03-population.mjs first.`); process.exit(1); }

function fail(step, error) {
  if (/does not exist|schema cache|PGRST20/i.test(`${error.code} ${error.message}`)) {
    console.error(`${step}: a table or function is missing — run supabase/migrations/039_board_catchments.sql first.`);
  } else {
    console.error(`${step}: ${error.message}`);
  }
  process.exit(1);
}

const km = (lat1, lng1, lat2, lng2) => {
  const rad = Math.PI / 180;
  const a = Math.sin((lat2 - lat1) * rad / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin((lng2 - lng1) * rad / 2) ** 2;
  return 6371.0088 * 2 * Math.asin(Math.sqrt(a));
};

const verifyOnly = process.argv.includes('--verify');
const local = CHECK_POINTS.map(() => RADII.map(() => ({ pop_15_24: 0, pop_25_34: 0, pop_35_plus: 0, cells: 0 })));

if (!verifyOnly) {
  // Empty both tables with filtered deletes (Supabase rejects a DELETE that has no WHERE clause).
  const cleared = await supabase.from('geo_pop_r9').delete().gte('lat', -90);
  if (cleared.error) fail('reset', cleared.error);
  const source = await supabase.from('geo_pop_r9_source').delete().eq('id', true);
  if (source.error) fail('reset', source.error);
}

let batch = [];
let total = 0;
const flush = async () => {
  if (!verifyOnly) {
    const { error } = await supabase.from('geo_pop_r9').insert(batch);
    if (error) fail('insert', error);
  }
  total += batch.length;
  batch = [];
  if (total % 250000 === 0) console.log(`  ${total.toLocaleString()} cells`);
};

let header = null;
for await (const line of createInterface({ input: createReadStream(csvPath) })) {
  const parts = line.split(',');
  if (!header) { header = parts; continue; }
  const row = Object.fromEntries(header.map((h, i) => [h, i === 0 ? parts[i] : Number(parts[i])]));
  batch.push({ lat: row.lat, lng: row.lng, pop_0_14: row.pop_0_14, pop_15_24: row.pop_15_24, pop_25_34: row.pop_25_34, pop_35_plus: row.pop_35_plus });
  CHECK_POINTS.forEach((p, i) => {
    if (Math.abs(row.lat - p.lat) > 0.06) return;
    const d = km(p.lat, p.lng, row.lat, row.lng);
    RADII.forEach((r, j) => {
      if (d > r) return;
      const acc = local[i][j];
      acc.pop_15_24 += row.pop_15_24; acc.pop_25_34 += row.pop_25_34; acc.pop_35_plus += row.pop_35_plus; acc.cells++;
    });
  });
  if (batch.length === BATCH) await flush();
}
if (batch.length) await flush();

if (!verifyOnly) {
  const { error } = await supabase.from('geo_pop_r9_source').insert({ dataset_id: DATASET_ID, cell_count: total });
  if (error) fail('source', error);
  console.log(`geo_pop_r9: ${total.toLocaleString()} cells loaded`);
  const { data: refreshed, error: refreshError } = await supabase.rpc('refresh_all_board_catchments');
  if (refreshError) fail('refresh', refreshError);
  console.log(`board_catchments: recomputed for ${refreshed} boards`);
}

// ── Database against the local file ────────────────────────────────────────
let worst = 0;
for (let i = 0; i < CHECK_POINTS.length; i++) {
  const p = CHECK_POINTS[i];
  const { data, error } = await supabase.rpc('geo_catchment_at', { p_lat: p.lat, p_lng: p.lng });
  if (error) fail('verify', error);
  for (let j = 0; j < RADII.length; j++) {
    const db = data.find(r => r.radius_km === RADII[j]);
    const mine = local[i][j];
    const dbAdults = db.pop_15_24 + db.pop_25_34 + db.pop_35_plus;
    const myAdults = mine.pop_15_24 + mine.pop_25_34 + mine.pop_35_plus;
    const diff = myAdults === 0 ? Math.abs(dbAdults) : Math.abs(dbAdults - myAdults) / myAdults;
    if (diff > worst) worst = diff;
    console.log(`${p.name.padEnd(28)} ${RADII[j]} km  15-24 ${Math.round(db.pop_15_24).toLocaleString().padStart(9)}  25-34 ${Math.round(db.pop_25_34).toLocaleString().padStart(9)}  35+ ${Math.round(db.pop_35_plus).toLocaleString().padStart(9)}  cells ${String(db.cells).padStart(4)} (file: ${mine.cells})  diff ${(diff * 100).toFixed(4)}%`);
  }
}
console.log(`Largest difference between database and file: ${(worst * 100).toFixed(4)}%`);
if (worst > 0.001) { console.error('Database and file disagree by more than 0.1% — investigate before relying on the catchments.'); process.exit(1); }
