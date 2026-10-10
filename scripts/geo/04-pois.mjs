/**
 * Step 4 — OpenStreetMap points of interest per LGA, state and H3 cell.
 * Usage: node scripts/geo/04-pois.mjs            (re-uses a saved extract if present)
 *        node scripts/geo/04-pois.mjs --refresh  (queries Overpass again)
 *
 * Source: OpenStreetMap via the Overpass API, one national query per run.
 * The raw extract is saved to scripts/geo/data/osm/pois.json together with
 * the OSM data timestamp Overpass reports, so the counts can be reproduced
 * and the extraction date shown in the UI.
 *
 * Counts are LOWER BOUNDS: OSM completeness varies a lot between Nigerian
 * cities, and a place that nobody has mapped is simply absent.
 *
 * Method: nodes, ways and relations matching the tags below; ways and
 * relations are reduced to their centre point. A point is counted in the LGA
 * polygon and the H3 cell that contain it. To keep the lower-bound reading
 * honest, two elements of the same category with the same name inside the
 * same H3 resolution-8 cell (~0.7 km²) are counted once — the usual cause is
 * one place mapped as both a node and a building outline.
 */

import { existsSync } from 'fs';
import { resolve } from 'path';
import { latLngToCell, cellToParent } from 'h3-js';
import { DATA_DIR, OUT_DIR, ensureDir, readJson, writeJson } from './lib.mjs';

/** category → Overpass tag filters. This table is the definition of each category. */
export const POI_CATEGORIES = {
  university:   ['["amenity"~"^(university|college)$"]'],
  mall:         ['["shop"="mall"]'],
  market:       ['["amenity"="marketplace"]'],
  bank:         ['["amenity"="bank"]'],
  hotel:        ['["tourism"="hotel"]'],
  airport:      ['["aeroway"="aerodrome"]'],
  bus_terminal: ['["amenity"="bus_station"]'],
  hospital:     ['["amenity"="hospital"]'],
};
const CATEGORY_KEYS = Object.keys(POI_CATEGORIES);

const MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.openstreetmap.fr/api/interpreter',
];

function categoryOf(tags) {
  if (tags.amenity === 'university' || tags.amenity === 'college') return 'university';
  if (tags.shop === 'mall') return 'mall';
  if (tags.amenity === 'marketplace') return 'market';
  if (tags.amenity === 'bank') return 'bank';
  if (tags.tourism === 'hotel') return 'hotel';
  if (tags.aeroway === 'aerodrome') return 'airport';
  if (tags.amenity === 'bus_station') return 'bus_terminal';
  if (tags.amenity === 'hospital') return 'hospital';
  return null;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** One national query for one category, retried across the mirrors. Throws rather than return a partial result. */
async function fetchCategory(category) {
  const filters = POI_CATEGORIES[category].map(f => `  nwr${f}(area.ng);`).join('\n');
  const query = `[out:json][timeout:300];\narea["ISO3166-1"="NG"]["admin_level"="2"]->.ng;\n(\n${filters}\n);\nout center tags;`;
  for (let attempt = 0; attempt < 4; attempt++) {
    for (const mirror of MIRRORS) {
      try {
        const res = await fetch(mirror, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'OOH-Platform-geo-pipeline/1.0' },
          body: `data=${encodeURIComponent(query)}`,
          signal: AbortSignal.timeout(330000),
        });
        if (!res.ok) { console.log(`  ${category}: ${res.status} from ${new URL(mirror).host}`); continue; }
        const text = await res.text();
        if (!text.startsWith('{')) { console.log(`  ${category}: non-JSON response from ${new URL(mirror).host}`); continue; }
        const json = JSON.parse(text);
        // Overpass reports a server-side timeout or memory limit in `remark` with a 200 status.
        if (json.remark) { console.log(`  ${category}: ${json.remark.slice(0, 80)}`); continue; }
        console.log(`  ${category}: ${json.elements.length} elements from ${new URL(mirror).host}`);
        return { query, mirror, osm_base_timestamp: json.osm3s?.timestamp_osm_base || null, elements: json.elements };
      } catch (err) {
        console.log(`  ${category}: ${err.message} (${new URL(mirror).host})`);
      }
    }
    await sleep(30000);
  }
  throw new Error(`Every Overpass mirror failed for "${category}" — no POI extract written.`);
}

async function fetchExtract() {
  const extract = { retrieved_at: new Date().toISOString(), osm_base_timestamp: null, queries: {}, elements: [] };
  for (const category of CATEGORY_KEYS) {
    const result = await fetchCategory(category);
    extract.queries[category] = { query: result.query, mirror: result.mirror, osm_base_timestamp: result.osm_base_timestamp };
    extract.elements.push(...result.elements);
    // The extract is only as fresh as its oldest category.
    if (result.osm_base_timestamp && (!extract.osm_base_timestamp || result.osm_base_timestamp < extract.osm_base_timestamp)) {
      extract.osm_base_timestamp = result.osm_base_timestamp;
    }
    await sleep(5000);
  }
  return extract;
}

const extractPath = resolve(ensureDir(resolve(DATA_DIR, 'osm')), 'pois.json');
let extract;
if (existsSync(extractPath) && !process.argv.includes('--refresh')) {
  extract = readJson(extractPath);
  console.log(`Using saved extract (OSM data as of ${extract.osm_base_timestamp}).`);
} else {
  extract = await fetchExtract();
  writeJson(extractPath, extract);
}

// ── Point-in-polygon against the full-resolution LGAs ──────────────────────

const lgaFeatures = readJson(resolve(OUT_DIR, 'lga-full.geojson')).features;
const geographies = readJson(resolve(OUT_DIR, 'geographies.json'));

const lgaShapes = lgaFeatures.map(f => {
  const polygons = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const rings of polygons) for (const [x, y] of rings[0]) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  return { polygons, minX, minY, maxX, maxY };
});

function inRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < xi + (y - yi) * (xj - xi) / (yj - yi)) inside = !inside;
  }
  return inside;
}

function lgaIndexOf(lng, lat) {
  for (let i = 0; i < lgaShapes.length; i++) {
    const s = lgaShapes[i];
    if (lng < s.minX || lng > s.maxX || lat < s.minY || lat > s.maxY) continue;
    for (const rings of s.polygons) {
      if (!inRing(lng, lat, rings[0])) continue;
      if (rings.slice(1).some(hole => inRing(lng, lat, hole))) continue;
      return i;
    }
  }
  return -1;
}

// ── Count ──────────────────────────────────────────────────────────────────

const emptyCounts = () => Object.fromEntries(CATEGORY_KEYS.map(k => [k, 0]));
const lgaCounts = lgaFeatures.map(() => emptyCounts());
const h3Counts = { 9: new Map(), 8: new Map(), 7: new Map() };
const seen = new Set();
const totals = emptyCounts();
const outside = emptyCounts();
let duplicates = 0;
let noCoordinates = 0;

for (const el of extract.elements) {
  const category = categoryOf(el.tags || {});
  if (!category) continue;
  const lat = el.lat ?? el.center?.lat;
  const lng = el.lon ?? el.center?.lon;
  if (typeof lat !== 'number' || typeof lng !== 'number') { noCoordinates++; continue; }

  const cell9 = latLngToCell(lat, lng, 9);
  const cell8 = cellToParent(cell9, 8);
  const name = (el.tags.name || '').trim().toLowerCase();
  if (name) {
    const key = `${category}|${name}|${cell8}`;
    if (seen.has(key)) { duplicates++; continue; }
    seen.add(key);
  }

  const lga = lgaIndexOf(lng, lat);
  if (lga < 0) { outside[category]++; continue; }
  totals[category]++;
  lgaCounts[lga][category]++;
  for (const [res, cell] of [[9, cell9], [8, cell8], [7, cellToParent(cell9, 7)]]) {
    let counts = h3Counts[res].get(cell);
    if (!counts) h3Counts[res].set(cell, counts = emptyCounts());
    counts[category]++;
  }
}

const lgaRows = geographies.lgas.map((lga, i) => ({ lga_pcode: lga.lga_pcode, ...lgaCounts[i] }));
const stateRows = geographies.states.map(state => {
  const counts = emptyCounts();
  geographies.lgas.forEach((lga, i) => {
    if (lga.state_pcode === state.state_pcode) for (const k of CATEGORY_KEYS) counts[k] += lgaCounts[i][k];
  });
  return { state_pcode: state.state_pcode, ...counts };
});

writeJson(resolve(OUT_DIR, 'poi_lga.json'), lgaRows);
writeJson(resolve(OUT_DIR, 'poi_state.json'), stateRows);
for (const res of [9, 8, 7]) {
  writeJson(resolve(OUT_DIR, `poi_h3_r${res}.json`), [...h3Counts[res]].map(([h3, counts]) => ({ h3, ...counts })));
}
writeJson(resolve(OUT_DIR, 'poi_summary.json'), {
  dataset: 'osm_pois',
  retrieved_at: extract.retrieved_at,
  osm_base_timestamp: extract.osm_base_timestamp,
  elements_returned: extract.elements.length,
  counted: totals,
  outside_lga_polygons: outside,
  duplicates_merged: duplicates,
  without_coordinates: noCoordinates,
  lgas_with_no_poi: lgaRows.filter(r => CATEGORY_KEYS.every(k => r[k] === 0)).length,
  categories: POI_CATEGORIES,
});

console.log(`OSM data as of ${extract.osm_base_timestamp}; ${extract.elements.length} elements returned`);
console.log('Counted per category:', totals);
console.log('Outside every LGA polygon (not counted):', outside);
console.log(`Same-name duplicates merged: ${duplicates}; LGAs with no POI in any category: ${lgaRows.filter(r => CATEGORY_KEYS.every(k => r[k] === 0)).length}`);
