/**
 * OpenStreetMap places provider (free, ODbL — credit "© OpenStreetMap contributors").
 *
 * Reads the national extract made by osm_extract.py from Geofabrik's daily
 * Nigeria file (the public Overpass servers ask automated jobs not to use
 * them), then keeps only places within a box of about 5 km around each pinned
 * board. Counts are LOWER BOUNDS — a place nobody has mapped is simply absent.
 */
import { existsSync } from 'fs';
import { resolve } from 'path';
import { OUT, metres, readJson } from '../lib.mjs';

export const DATASET_ID = 'osm_places';
export const NATIONAL = resolve(OUT, 'osm_places_national.json');

/**
 * category → OSM tags. Documentation of what osm_extract.py category_of()
 * applies; the same keys are used by the database and the UI.
 */
export const CATEGORIES = {
  bank:          'amenity=bank',
  mall:          'shop=mall',
  market:        'amenity=marketplace',
  supermarket:   'shop=supermarket',
  restaurant:    'amenity=restaurant|fast_food|cafe',
  hotel:         'tourism=hotel',
  office:        'office=*',
  fuel:          'amenity=fuel',
  school:        'amenity=school',
  university:    'amenity=university|college',
  health:        'amenity=hospital|clinic',
  transport:     'amenity=bus_station, railway=station, aeroway=aerodrome',
  entertainment: 'amenity=cinema|theatre|nightclub, leisure=stadium',
};

/** Boxes of ±pad degrees (~5.5 km) around each board, merged until none overlap. */
export function boxesAround(boards, pad = 0.05) {
  const boxes = boards.map(b => [b.latitude - pad, b.longitude - pad, b.latitude + pad, b.longitude + pad]);
  for (let merged = true; merged;) {
    merged = false;
    outer: for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const [a, b] = [boxes[i], boxes[j]];
      if (a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3]) {
        boxes[i] = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
        boxes.splice(j, 1); merged = true; break outer;
      }
    }
  }
  return boxes;
}

/**
 * Places near the boards from the national extract.
 * Returns { places: [{id, category, name, lat, lng}], osm_base, boxes }.
 */
export function placesNear(boards) {
  if (!existsSync(NATIONAL)) {
    throw new Error(`missing ${NATIONAL}
  1. download https://download.geofabrik.de/africa/nigeria-latest.osm.pbf to scripts/geo/data/osm-pbf/
  2. python -I scripts/intel/providers/osm_extract.py scripts/geo/data/osm-pbf/nigeria-latest.osm.pbf ${NATIONAL}`);
  }
  const national = readJson(NATIONAL);
  const boxes = boxesAround(boards);
  const near = national.places.filter(p => p.category in CATEGORIES
    && boxes.some(([s, w, n, e]) => p.lat >= s && p.lat <= n && p.lng >= w && p.lng <= e));

  // One place mapped twice (a point and a building outline): same category
  // and name within 150 m counts once. Unnamed places are never merged.
  const kept = [];
  const byKey = new Map();
  for (const p of near) {
    if (!p.name) { kept.push(p); continue; }
    const key = `${p.category}|${p.name.toLowerCase()}`;
    const twins = byKey.get(key) || [];
    if (twins.some(t => metres(t.lat, t.lng, p.lat, p.lng) < 150)) continue;
    twins.push(p); byKey.set(key, twins); kept.push(p);
  }
  return { places: kept, osm_base: national.osm_timestamp || null, boxes };
}
