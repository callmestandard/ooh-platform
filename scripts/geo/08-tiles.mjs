/**
 * Step 8 — vector tiles for the H3 hexagon layers.
 * Usage: node scripts/geo/08-tiles.mjs
 *
 * The map never queries per-cell data at render time: the hexagons and their
 * values are baked into static Mapbox Vector Tiles under
 * public/geo/h3/{z}/{x}/{y}.pbf, cut here with geojson-vt (tippecanoe is not
 * available on Windows; the output format is the same).
 *
 *   zoom 8  H3 resolution 7 (about 5 km² per cell) — the map switches to hexagons at
 *           zoom 8 and over-zooms these tiles when zoomed in further
 *
 * Resolution 8 (about 0.7 km²) is computed by step 3 but not tiled by default: its
 * 687,000 cells come to roughly 70 MB of tiles per zoom level, too much to ship as
 * static files. Add it to LEVELS if the tiles move to object storage or a tileset.
 *
 * Each hexagon carries, from the population step, to 1 decimal place:
 *   pop   residents          y    residents aged 15-34
 *   d     residents per km²  yd   residents aged 15-34 per km²
 *
 * Also writes public/geo/h3-meta.json: the five-class quantile breakpoints
 * per resolution (the legend shows these exact numbers), cell counts and the
 * tile zoom ranges.
 */

import { createReadStream, existsSync, rmSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { createInterface } from 'readline';
import geojsonvt from 'geojson-vt';
import vtpbf from 'vt-pbf';
import { cellToBoundary } from 'h3-js';
import { OUT_DIR, ROOT, ensureDir, writeJson } from './lib.mjs';

const LEVELS = [
  { res: 7, minZoom: 8, maxZoom: 8 },
];
const CLASSES = 5;

async function readCells(res) {
  const path = resolve(OUT_DIR, `pop_h3_r${res}.csv`);
  if (!existsSync(path)) {
    console.error(`Missing ${path} — run scripts/geo/03-population.mjs first.`);
    process.exit(1);
  }
  const cells = [];
  let header = null;
  for await (const line of createInterface({ input: createReadStream(path) })) {
    const parts = line.split(',');
    if (!header) { header = parts; continue; }
    const row = Object.fromEntries(header.map((h, i) => [h, i === 0 ? parts[i] : Number(parts[i])]));
    const total = row.pop_0_14 + row.pop_15_24 + row.pop_25_34 + row.pop_35_plus;
    const youth = row.pop_15_24 + row.pop_25_34;
    cells.push({ h3: row.h3, pop: total, y: youth, d: total / row.area_km2, yd: youth / row.area_km2 });
  }
  return cells;
}

/** Upper bounds of the first four of five equal-count classes. */
function quantileBreaks(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return Array.from({ length: CLASSES - 1 }, (_, i) => sorted[Math.floor(sorted.length * (i + 1) / CLASSES)]);
}

const round1 = v => Math.round(v * 10) / 10;

const tileRoot = resolve(ROOT, 'public/geo/h3');
rmSync(tileRoot, { recursive: true, force: true });
const meta = { tiles: '/geo/h3/{z}/{x}/{y}.pbf', source_layer: 'h3', dataset: 'worldpop_agesex_2020_constrained', levels: [] };
let fileCount = 0;
let byteCount = 0;
let largest = 0;

for (const level of LEVELS) {
  const cells = await readCells(level.res);
  const features = cells.map(c => ({
    type: 'Feature',
    properties: { pop: round1(c.pop), y: round1(c.y), d: round1(c.d), yd: round1(c.yd) },
    geometry: { type: 'Polygon', coordinates: [cellToBoundary(c.h3, true)] },
  }));
  const index = new geojsonvt({ type: 'FeatureCollection', features }, {
    maxZoom: level.maxZoom, indexMaxZoom: level.maxZoom, indexMaxPoints: 0, tolerance: 0, extent: 4096, buffer: 64,
  });
  for (const { z, x, y } of index.tileCoords) {
    if (z < level.minZoom) continue;
    const tile = index.getTile(z, x, y);
    if (!tile || !tile.features.length) continue;
    const buffer = Buffer.from(vtpbf.fromGeojsonVt({ h3: tile }, { version: 2 }));
    writeFileSync(resolve(ensureDir(resolve(tileRoot, String(z), String(x))), `${y}.pbf`), buffer);
    fileCount++;
    byteCount += buffer.length;
    if (buffer.length > largest) largest = buffer.length;
  }
  meta.levels.push({
    resolution: level.res,
    min_zoom: level.minZoom,
    max_zoom: level.maxZoom,
    cells: cells.length,
    breaks: {
      d: quantileBreaks(cells.map(c => c.d)).map(round1),
      yd: quantileBreaks(cells.map(c => c.yd)).map(round1),
    },
  });
  console.log(`H3 r${level.res}: ${cells.length.toLocaleString()} cells, zoom ${level.minZoom}-${level.maxZoom}`);
}

writeJson(resolve(ROOT, 'public/geo/h3-meta.json'), meta);
console.log(`Tiles: ${fileCount} files, ${(byteCount / 1e6).toFixed(1)} MB total, largest ${(largest / 1024).toFixed(0)} KB`);
