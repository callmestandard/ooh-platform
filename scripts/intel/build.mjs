/**
 * Board intelligence pipeline.
 *
 *   node scripts/intel/build.mjs --dry-run         compute everything, write only scripts/intel/out
 *   node scripts/intel/build.mjs                   compute and load into Supabase (service role, this machine only)
 *   places come from scripts/intel/out/osm_places_national.json (see providers/osm_extract.py)
 *   node scripts/intel/build.mjs --layer           also rebuild public/intel/population.json
 *
 * Flow: providers (WorldPop rasters, OpenStreetMap) → normalise → per-board
 * figures → board_intelligence + geo_places. The website only reads the
 * prepared rows; nothing calls an outside data API when a page opens.
 */
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { OUT, ROOT, db, ensureDir, metres, pinnedBoards, readJson, writeJson } from './lib.mjs';
import { worldpop, TOTAL_DATASET_ID } from './providers/worldpop.mjs';
import { placesNear, DATASET_ID as PLACES_DATASET_ID } from './providers/osm.mjs';
import { trafficFor, CONNECTED as TRAFFIC_CONNECTED } from './providers/traffic.mjs';

const args = new Set(process.argv.slice(2));
const DRY = args.has('--dry-run');
const client = db();
ensureDir(OUT);

// ── 1. Boards ─────────────────────────────────────────────────────
const boards = await pinnedBoards(client);
console.log(`${boards.length} pinned boards`);

// ── 2. Places ─────────────────────────────────────────────────────
const r = placesNear(boards);
const extract = { retrieved_at: r.osm_base ?? new Date().toISOString(), osm_base: r.osm_base, boxes: r.boxes, places: r.places };
writeJson(resolve(OUT, 'places.json'), extract);
console.log(`places: ${r.places.length} within ~5 km of boards (OSM data as of ${r.osm_base})`);
const places = extract.places;

function countNear(lat, lng, radius) {
  const dLat = radius / 111000, dLng = radius / (111000 * Math.cos(lat * Math.PI / 180));
  const out = {};
  for (const p of places) {
    if (Math.abs(p.lat - lat) > dLat || Math.abs(p.lng - lng) > dLng) continue;
    if (metres(lat, lng, p.lat, p.lng) <= radius) out[p.category] = (out[p.category] || 0) + 1;
  }
  return out;
}

// ── 3. Per-board figures ──────────────────────────────────────────
const pop = await worldpop();
const now = new Date().toISOString();
const rows = [];
for (const b of boards) {
  const p = await pop(b.latitude, b.longitude);
  const t = TRAFFIC_CONNECTED ? await trafficFor(b.latitude, b.longitude) : null;
  rows.push({
    board_id: b.id, latitude: b.latitude, longitude: b.longitude,
    pop_250m: p.pop_250m, pop_500m: p.pop_500m, pop_1km: p.pop_1km, pop_2km: p.pop_2km, age_1km: p.age_1km,
    population_method: 'raster_100m', population_dataset_id: TOTAL_DATASET_ID, population_at: now,
    places_500m: countNear(b.latitude, b.longitude, 500), places_1km: countNear(b.latitude, b.longitude, 1000),
    places_dataset_id: PLACES_DATASET_ID, places_at: extract.retrieved_at,
    road_class: t?.road_class ?? null, traffic_level: t?.traffic_level ?? null, traffic_dataset_id: t?.dataset_id ?? null,
    computed_at: now,
  });
}
writeJson(resolve(OUT, 'board_intelligence.json'), rows);

const sum = (o) => Object.values(o || {}).reduce((a, b) => a + b, 0);
const byCat = {};
for (const p of places) byCat[p.category] = (byCat[p.category] || 0) + 1;
console.log('places by category:', byCat);
console.log('boards with 0 places within 1 km:', rows.filter(r => sum(r.places_1km) === 0).length);
console.log('residents within 1 km — min/median/max:', (() => {
  const v = rows.map(r => r.pop_1km).sort((a, b) => a - b);
  return [v[0], v[Math.floor(v.length / 2)], v[v.length - 1]];
})());

// ── 4. Population layer for the map (static, cached by the browser) ─
if (args.has('--layer') || !existsSync(resolve(ROOT, 'public/intel/population.json'))) {
  const csv = readFileSync(resolve(ROOT, 'scripts/geo/out/pop_h3_r8.csv'), 'utf-8').split('\n');
  const flat = [];
  for (const line of csv.slice(1)) {
    const [, lat, lng, area, a, b2, c, d] = line.split(',');
    if (!lat) continue;
    const n = (+a) + (+b2) + (+c) + (+d);
    const density = n / +area;
    if (density < 500) continue; // under 500 residents per km²: left blank to keep the file small
    flat.push(Math.round(+lng * 1e4), Math.round(+lat * 1e4), Math.round(density));
  }
  ensureDir(resolve(ROOT, 'public/intel'));
  writeFileSync(resolve(ROOT, 'public/intel/population.json'), JSON.stringify({
    source: 'worldpop_agesex_2020_constrained', unit: 'residents per km²', cell: 'H3 resolution 8 (~0.7 km²)',
    format: '[lng×1e4, lat×1e4, density, …]', min_density: 500, data: flat,
  }));
  console.log(`population layer: ${flat.length / 3} cells`);
}

if (DRY) { console.log('dry run — nothing written to the database'); process.exit(0); }

// ── 5. Load ───────────────────────────────────────────────────────
const [agesex] = await client.get('geo_datasets?select=*&id=eq.worldpop_agesex_2020_constrained');
await client.upsert('geo_datasets', [
  {
    ...agesex, id: TOTAL_DATASET_ID, updated_at: now,
    name: 'WorldPop population counts, Nigeria 2020 (constrained, 100 m)',
    url: 'https://hub.worldpop.org/geodata/summary?id=49707',
    resolution: '3 arc-second grid (about 100 m); summed in rings of 250 m, 500 m, 1 km and 2 km around each board',
    method_summary: 'WorldPop spreads projected population totals across 100 m grid cells with a statistical model, placing people only where buildings were mapped. We add up every cell whose centre lies within the ring around the board; cells are never split and nothing is smoothed. The age split uses the matching WorldPop age and sex grids.',
  },
  {
    id: PLACES_DATASET_ID, name: 'OpenStreetMap places near boards', publisher: 'OpenStreetMap contributors',
    version: `Geofabrik Nigeria extract, OSM data as of ${extract.osm_base ?? 'unknown'}`,
    reference_year: (extract.osm_base ?? extract.retrieved_at).slice(0, 4),
    resolution: 'Individual mapped places within about 5 km of each board',
    licence: 'ODbL 1.0', licence_url: 'https://opendatacommons.org/licenses/odbl/1-0/', url: 'https://www.openstreetmap.org/copyright',
    retrieved_on: extract.retrieved_at.slice(0, 10),
    method_summary: 'Places tagged as banks, malls, markets, supermarkets, restaurants/fast food/cafés, hotels, offices, fuel stations, schools, universities/colleges, hospitals/clinics, transport stations and entertainment venues are fetched around every board. A place counts toward a ring when it lies within that distance of the board. The same named place mapped twice within 150 m counts once.',
    known_limitations: 'Counts are lower bounds. OpenStreetMap is volunteer-mapped and its completeness varies between Nigerian cities, so a low count can mean few places or few mappers. Zero means "none mapped", not "none exist".',
    attribution: '© OpenStreetMap contributors, ODbL', data_nature: 'crowdsourced', status: 'active', updated_at: now,
  },
], 'id');

const del = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/geo_places?dataset_id=eq.${PLACES_DATASET_ID}`, {
  method: 'DELETE', headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` },
});
if (!del.ok) throw new Error(`clearing old places failed: ${del.status}`);
for (let i = 0; i < places.length; i += 1000) {
  await client.upsert('geo_places', places.slice(i, i + 1000).map(p => ({ ...p, dataset_id: PLACES_DATASET_ID })), 'id');
}
console.log(`loaded ${places.length} places`);
for (let i = 0; i < rows.length; i += 200) await client.upsert('board_intelligence', rows.slice(i, i + 200), 'board_id');
console.log(`loaded intelligence for ${rows.length} boards`);
