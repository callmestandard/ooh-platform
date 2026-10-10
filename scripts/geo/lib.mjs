/**
 * Shared helpers for the market-intelligence geo pipeline (scripts/geo/*).
 * Run every script from the repo root: `node scripts/geo/<step>.mjs`.
 *
 * Raw downloads go to scripts/geo/data/ and computed outputs to
 * scripts/geo/out/ — both gitignored, both fully reproducible from the steps.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';

export const ROOT = process.cwd();
export const DATA_DIR = resolve(ROOT, 'scripts/geo/data');
export const OUT_DIR = resolve(ROOT, 'scripts/geo/out');

export function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

export function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf-8'));
}

export function writeJson(path, value) {
  ensureDir(dirname(path));
  writeFileSync(path, JSON.stringify(value));
}

/** Load .env.local manually (same approach as scripts/enrich-boards.mjs — no dotenv dependency). */
export function loadEnv() {
  try {
    const env = readFileSync(resolve(ROOT, '.env.local'), 'utf-8');
    for (const line of env.split(/\r?\n/)) {
      const [k, ...v] = line.split('=');
      if (k && !k.startsWith('#') && v.length) process.env[k.trim()] = v.join('=').trim().replace(/^"|"$/g, '');
    }
  } catch { /* .env.local not found — rely on real env */ }
}

/** 5-year WorldPop age-group lower bounds (0 = under 1, 1 = 1–4, then 5-year groups up to 80+). */
export const WORLDPOP_AGE_GROUPS = [0, 1, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80];
export const WORLDPOP_SEXES = ['f', 'm'];

/**
 * The age bands every geography is aggregated into. Each WorldPop 5-year
 * group lands in exactly one band, so the bands sum to the total.
 */
export const AGE_BANDS = ['pop_0_14', 'pop_15_24', 'pop_25_34', 'pop_35_plus'];
export function ageBandIndex(ageGroup) {
  if (ageGroup < 15) return 0;
  if (ageGroup < 25) return 1;
  if (ageGroup < 35) return 2;
  return 3;
}

/** Spherical polygon-ring area in km² (authalic sphere radius; same formula as @turf/area). */
const EARTH_RADIUS_KM = 6371.0088;
function ringAreaKm2(ring) {
  let total = 0;
  const n = ring.length;
  if (n < 4) return 0;
  const rad = Math.PI / 180;
  for (let i = 0; i < n - 1; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[i + 1];
    total += (x2 - x1) * rad * (2 + Math.sin(y1 * rad) + Math.sin(y2 * rad));
  }
  return Math.abs(total * EARTH_RADIUS_KM * EARTH_RADIUS_KM / 2);
}

/** Area in km² of a GeoJSON Polygon or MultiPolygon geometry (outer rings minus holes). */
export function geometryAreaKm2(geometry) {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  let area = 0;
  for (const rings of polygons) {
    rings.forEach((ring, i) => { area += (i === 0 ? 1 : -1) * ringAreaKm2(ring); });
  }
  return area;
}

/**
 * Scanline-rasterises polygon features onto a north-up lat/lng grid.
 * A pixel belongs to the feature that contains its centre, so a pixel is
 * never counted in two features that share a border.
 *
 * grid = { width, height, ox, oy, rx, ry } with (ox, oy) the top-left corner
 * and ry negative. Returns runs[row] = flat [colStart, colEndExclusive,
 * featureIndex + 1, ...].
 */
export function rasterisePolygons(features, { width, height, ox, oy, rx, ry }) {
  const runs = Array.from({ length: height }, () => []);
  features.forEach((feature, featureIndex) => {
    const polygons = feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates;
    const crossings = new Map();
    for (const rings of polygons) {
      for (const ring of rings) {
        for (let i = 0; i < ring.length - 1; i++) {
          const [x1, y1] = ring[i];
          const [x2, y2] = ring[i + 1];
          if (y1 === y2) continue;
          const yMin = Math.min(y1, y2);
          const yMax = Math.max(y1, y2);
          // Rows whose centre latitude lies in [yMin, yMax).
          const rFirst = Math.max(0, Math.floor((yMax - oy) / ry - 0.5) + 1);
          const rLast = Math.min(height - 1, Math.floor((yMin - oy) / ry - 0.5));
          for (let r = rFirst; r <= rLast; r++) {
            const lat = oy + (r + 0.5) * ry;
            const x = x1 + (lat - y1) * (x2 - x1) / (y2 - y1);
            let list = crossings.get(r);
            if (!list) crossings.set(r, list = []);
            list.push(x);
          }
        }
      }
    }
    for (const [r, xs] of crossings) {
      xs.sort((a, b) => a - b);
      for (let j = 0; j + 1 < xs.length; j += 2) {
        // Columns whose centre longitude lies in [xs[j], xs[j+1]).
        const c0 = Math.max(0, Math.ceil((xs[j] - ox) / rx - 0.5));
        const c1 = Math.min(width, Math.ceil((xs[j + 1] - ox) / rx - 0.5));
        if (c1 > c0) runs[r].push(c0, c1, featureIndex + 1);
      }
    }
  });
  return runs;
}
