// Google Street View links that land on the board, not just near it.
//
// A plain "panorama nearest these coordinates" link drops you at the pin
// facing a random direction. Owners usually pin a board on (or beside) the
// road it faces, so we read that road from Mapbox's street data, stand about
// 30 m along it, and turn the camera toward the pin: roughly how a driver
// approaching the board sees it. Google is only ever a plain link-out (no
// Google API or key); the road lookup is one Mapbox vector tile per board.

import { MAPBOX_TOKEN } from '@/components/map/ooh-map-shared';

export type StreetViewLinks = {
  /** View from the road, facing the board. */
  url: string;
  /** The same, from the other direction along the road (null if the road ends). */
  otherUrl: string | null;
  /** Name of the road the view stands on, when Mapbox knows it. */
  road: string | null;
  /**
   * The board's name mentions a road, but no road of that name is near the
   * pin: the pin is probably in the wrong place. null when the name gives no road.
   */
  roadMismatch: boolean | null;
};

// Words that say "this is a road" but don't tell roads apart.
const ROAD_WORDS = new Set(['road', 'rd', 'street', 'st', 'avenue', 'ave', 'expressway', 'expy', 'express', 'way', 'bridge',
  'close', 'crescent', 'cr', 'cres', 'drive', 'dr', 'highway', 'hwy', 'lane', 'ln', 'boulevard', 'blvd', 'flyover', 'ring', 'link', 'bypass']);
const FILLER = new Set(['along', 'by', 'opposite', 'opp', 'beside', 'the', 'at', 'of', 'and', 'near', 'before', 'after', 'on', 'old', 'new',
  'int', 'intl', 'international', 'l']);
// Map labels shorten these; board names usually spell them out.
const EXPAND: Record<string, string> = { e: 'east', w: 'west', n: 'north', s: 'south', ph: 'port' };

function words(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean).map(w => EXPAND[w] ?? w);
}
/** The distinctive words of a road name: "Lagos-Abeokuta Expressway" → ["lagos", "abeokuta"]. */
function roadCore(name: string) {
  return words(name).filter(w => !ROAD_WORDS.has(w) && !FILLER.has(w));
}
/** Same word allowing one typo in longer words ("Ikwere" / "Ikwerre"). */
function sameWord(a: string, b: string) {
  if (a === b) return true;
  if (Math.min(a.length, b.length) < 5 || Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}
/** Does the board's text name this road? Most of the road's distinctive words must appear. */
function namesRoad(hintWords: string[], road: string) {
  const core = roadCore(road);
  if (!core.length || core.join('').length < 3) return false;
  const hits = core.filter(w => hintWords.some(h => sameWord(w, h)));
  return hits.length >= Math.ceil(core.length / 2) && hits.some(w => w.length >= 3);
}

const Z = 16;               // street tiles carry full road detail at this zoom
const BACK_M = 30;          // how far along the road to stand
const MAX_ROAD_M = 120;     // further than this, there is no road to stand on
const DRIVABLE: Record<string, number> = {
  // extra "distance" in metres, so a main road beats a lane right beside it
  motorway: 0, motorway_link: 6, trunk: 0, trunk_link: 6, primary: 0, primary_link: 6,
  secondary: 0, secondary_link: 6, tertiary: 2, tertiary_link: 6, street: 6, street_limited: 10, service: 25,
};

/** Google's documented Maps URL for the panorama nearest a point. */
export function plainStreetViewUrl(lat: number, lng: number, heading?: number) {
  const h = heading == null ? '' : `&heading=${Math.round(heading)}&pitch=5`;
  return `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat.toFixed(6)},${lng.toFixed(6)}${h}`;
}

/**
 * Google Maps with a red pin on the exact point. Always lands in the right
 * place; when Google has Street View there, its side panel offers it.
 * (Google's Street View coverage in Nigeria is thin, so this is the safe default.)
 */
export function pinMapUrl(lat: number, lng: number) {
  return placeSearchUrl(`${lat.toFixed(6)},${lng.toFixed(6)}`);
}

/** Google Maps search for a place by name, for pins too rough to stand on. */
export function placeSearchUrl(query: string) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

type XY = [number, number]; // metres east, north of the board

function tileOf(lat: number, lng: number) {
  const n = 2 ** Z, r = (lat * Math.PI) / 180;
  return { x: ((lng + 180) / 360) * n, y: ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n };
}

function bearing(from: XY, to: XY) {
  return ((Math.atan2(to[0] - from[0], to[1] - from[1]) * 180) / Math.PI + 360) % 360;
}

/** Walk `metres` along a polyline from point index i + t (t in 0..1 of segment i), in direction dir. */
function walk(line: XY[], i: number, t: number, dir: 1 | -1, metres: number): { p: XY; walked: number } {
  const lerp = (a: XY, b: XY, k: number): XY => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
  let p = lerp(line[i], line[i + 1], t);
  let left = metres;
  let next = dir === 1 ? i + 1 : i;
  while (left > 0 && next >= 0 && next < line.length) {
    const q = line[next];
    const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (d >= left) return { p: lerp(p, q, left / d), walked: metres };
    left -= d; p = q; next += dir;
  }
  return { p, walked: metres - left };
}

const cache = new Map<string, Promise<StreetViewLinks | null>>();

/**
 * Street View links facing the board at (lat, lng), or null when no road
 * is near or the street data can't be read (callers fall back to the plain
 * link). Results are cached per point.
 */
export function streetViewFor(lat: number, lng: number, hint = ''): Promise<StreetViewLinks | null> {
  const key = `${lat.toFixed(6)},${lng.toFixed(6)}|${hint}`;
  let hit = cache.get(key);
  if (!hit) {
    hit = find(lat, lng, hint).catch(() => null);
    cache.set(key, hit);
  }
  return hit;
}

/**
 * `hint` is the board's name and area. When it names a road ("Along Oba
 * Akran Road…") and that road is near the pin, the view stands on it even
 * if a side street is a few metres closer.
 */
async function find(lat: number, lng: number, hint: string): Promise<StreetViewLinks | null> {
  const hintWords = words(hint);
  const hintNamesARoad = hintWords.some(w => ROAD_WORDS.has(w));
  let sawNamedRoad = false;
  if (!MAPBOX_TOKEN) return null;
  const [{ VectorTile }, { default: Pbf }] = await Promise.all([import('@mapbox/vector-tile'), import('pbf')]);

  // Local flat metres around the board: plenty accurate over a few hundred metres.
  const mPerLat = 111_320, mPerLng = 111_320 * Math.cos((lat * Math.PI) / 180);
  const toXY = (g: number[]): XY => [(g[0] - lng) * mPerLng, (g[1] - lat) * mPerLat];
  const toLL = (p: XY) => ({ lat: lat + p[1] / mPerLat, lng: lng + p[0] / mPerLng });

  // The board's tile, plus its neighbour when the board sits near an edge.
  const { x, y } = tileOf(lat, lng);
  const tx = Math.floor(x), ty = Math.floor(y);
  const xs = [tx], ys = [ty];
  if (x - tx < 0.2) xs.push(tx - 1); else if (x - tx > 0.8) xs.push(tx + 1);
  if (y - ty < 0.2) ys.push(ty - 1); else if (y - ty > 0.8) ys.push(ty + 1);

  let best: { line: XY[]; i: number; t: number; score: number; name: string | null } | null = null;
  await Promise.all(xs.flatMap(cx => ys.map(async cy => {
    const res = await fetch(`https://api.mapbox.com/v4/mapbox.mapbox-streets-v8/${Z}/${cx}/${cy}.vector.pbf?access_token=${encodeURIComponent(MAPBOX_TOKEN)}`);
    if (!res.ok) return;
    const layer = new VectorTile(new Pbf(new Uint8Array(await res.arrayBuffer()))).layers.road;
    if (!layer) return;
    for (let f = 0; f < layer.length; f++) {
      const feature = layer.feature(f);
      const penalty = DRIVABLE[String(feature.properties.class)];
      if (penalty == null) continue;
      const geom = feature.toGeoJSON(cx, cy, Z).geometry;
      const lines = geom.type === 'LineString' ? [geom.coordinates] : geom.type === 'MultiLineString' ? geom.coordinates : [];
      for (const coords of lines) {
        const line = (coords as number[][]).map(toXY);
        for (let i = 0; i < line.length - 1; i++) {
          const [ax, ay] = line[i], [bx, by] = line[i + 1];
          const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
          const t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
          const d = Math.hypot(ax + dx * t, ay + dy * t);
          if (d > MAX_ROAD_M) continue;
          const raw = feature.properties.name;
          const name = typeof raw === 'string' ? raw : null;
          const named = !!name && namesRoad(hintWords, name);
          if (named) sawNamedRoad = true;
          const score = d + penalty - (named ? 60 : 0);
          if (!best || score < best.score) best = { line, i, t, score, name };
        }
      }
    }
  })));
  if (!best) return null;

  const { line, i, t, name } = best as { line: XY[]; i: number; t: number; name: string | null };
  const views = ([1, -1] as const)
    .map(dir => walk(line, i, t, dir, BACK_M))
    .filter(v => v.walked >= 12) // too close to the road's end to step back
    .sort((a, b) => b.walked - a.walked)
    .map(v => {
      const ll = toLL(v.p);
      return plainStreetViewUrl(ll.lat, ll.lng, bearing(v.p, [0, 0]));
    });
  if (!views.length) return null;
  return { url: views[0], otherUrl: views[1] ?? null, road: name, roadMismatch: hintNamesARoad ? !sawNamedRoad : null };
}
