/**
 * Step 3 — population by age band per LGA, state and H3 cell.
 * Usage: node scripts/geo/03-population.mjs
 *
 * Source: WorldPop Nigeria 2020 constrained age-sex structures, 3 arc-second
 * (~100 m) grid, 36 rasters (18 age groups x 2 sexes). These are MODELLED
 * estimates, not a census count.
 *
 * Method — deterministic, no smoothing, nothing filled in:
 *   1. The 774 full-resolution LGA polygons are rasterised onto the WorldPop
 *      grid by scanline: a pixel belongs to the LGA that contains its centre.
 *   2. Every populated pixel's value is added to its LGA and to the H3
 *      resolution-9 cell that contains its centre. A pixel is never split.
 *   3. States are the sum of their LGAs. H3 resolutions 8 and 7 are the sum of
 *      their resolution-9 children.
 *   4. Populated pixels whose centre falls in no LGA polygon (coastline and
 *      border slivers) are NOT assigned to a neighbour. Their population is
 *      reported as `unassigned` in the summary and still counts in H3 cells.
 *
 * Writes to scripts/geo/out/:
 *   pop_lga.json, pop_state.json      one row per geography, unrounded
 *   pop_h3_r7.csv, _r8.csv, _r9.csv   one row per populated cell
 *   pop_summary.json                  national totals and cross-checks
 */

import { createWriteStream, existsSync } from 'fs';
import { resolve } from 'path';
import { fromFile } from 'geotiff';
import { latLngToCell, cellToParent, cellToLatLng, cellArea } from 'h3-js';
import {
  DATA_DIR, OUT_DIR, AGE_BANDS, WORLDPOP_AGE_GROUPS, WORLDPOP_SEXES,
  ageBandIndex, ensureDir, rasterisePolygons, readJson, writeJson,
} from './lib.mjs';

const H3_BASE_RES = 9;
const BLOCK_ROWS = 512; // the rasters are tiled 512 x 512
const NBANDS = AGE_BANDS.length;

// ── Open the rasters and check they share one grid ─────────────────────────

const rasters = [];
for (const sex of WORLDPOP_SEXES) {
  for (const age of WORLDPOP_AGE_GROUPS) {
    const path = resolve(DATA_DIR, `worldpop/nga_${sex}_${age}_2020_constrained.tif`);
    if (!existsSync(path)) {
      console.error(`Missing ${path} — run scripts/geo/01-download.mjs first.`);
      process.exit(1);
    }
    const image = await (await fromFile(path)).getImage();
    rasters.push({ sex, age, band: ageBandIndex(age), image, sum: 0 });
  }
}
const pppPath = resolve(DATA_DIR, 'worldpop/nga_ppp_2020_constrained.tif');
const ppp = existsSync(pppPath) ? { image: await (await fromFile(pppPath)).getImage(), sum: 0 } : null;

const ref = rasters[0].image;
const W = ref.getWidth();
const H = ref.getHeight();
const [ox, oy] = ref.getOrigin();
const [rx, ry] = ref.getResolution(); // ry is negative (north-up)
for (const { image, sex, age } of rasters) {
  const [x, y] = image.getOrigin();
  const [dx, dy] = image.getResolution();
  if (image.getWidth() !== W || image.getHeight() !== H || x !== ox || y !== oy || dx !== rx || dy !== ry) {
    console.error(`Raster ${sex}_${age} is not on the same grid as the first raster — refusing to aggregate.`);
    process.exit(1);
  }
}
console.log(`Grid ${W} x ${H}, origin ${ox}, ${oy}, resolution ${rx}`);

// ── Rasterise the LGA polygons onto the grid (scanline, pixel-centre rule) ──

const lgaFeatures = readJson(resolve(OUT_DIR, 'lga-full.geojson')).features;
const geographies = readJson(resolve(OUT_DIR, 'geographies.json'));

/** runs[row] = flat [colStart, colEndExclusive, lgaIndex + 1, ...] */
const runs = rasterisePolygons(lgaFeatures, { width: W, height: H, ox, oy, rx, ry });

// ── Aggregate ──────────────────────────────────────────────────────────────

const lgaTotals = new Float64Array(lgaFeatures.length * NBANDS);
const unassigned = new Float64Array(NBANDS);
let unassignedPixels = 0;
let populatedPixels = 0;

// H3 resolution-9 accumulators, grown as cells appear.
const cellIndex = new Map();
const cellIds = [];
let cellTotals = new Float64Array(1 << 20);
function cellSlot(lat, lng) {
  const id = latLngToCell(lat, lng, H3_BASE_RES);
  let slot = cellIndex.get(id);
  if (slot === undefined) {
    slot = cellIds.length;
    cellIndex.set(id, slot);
    cellIds.push(id);
    if ((slot + 1) * NBANDS > cellTotals.length) {
      const grown = new Float64Array(cellTotals.length * 2);
      grown.set(cellTotals);
      cellTotals = grown;
    }
  }
  return slot;
}

function isValue(v, nodata) {
  return v === v && v !== nodata && v > 0;
}

const rowLga = new Uint16Array(W);
const started = Date.now();
for (let r0 = 0; r0 < H; r0 += BLOCK_ROWS) {
  const r1 = Math.min(H, r0 + BLOCK_ROWS);
  const rows = r1 - r0;
  const window = [0, r0, W, r1];
  const bands = Array.from({ length: NBANDS }, () => new Float64Array(W * rows));

  for (const raster of rasters) {
    const nodata = raster.image.getGDALNoData();
    const [values] = await raster.image.readRasters({ window });
    const target = bands[raster.band];
    let sum = 0;
    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      if (isValue(v, nodata)) { target[i] += v; sum += v; }
    }
    raster.sum += sum;
  }
  for (let r = r0; r < r1; r++) {
    rowLga.fill(0);
    const rowRuns = runs[r];
    for (let j = 0; j < rowRuns.length; j += 3) rowLga.fill(rowRuns[j + 2], rowRuns[j], rowRuns[j + 1]);
    const lat = oy + (r + 0.5) * ry;
    const base = (r - r0) * W;
    for (let c = 0; c < W; c++) {
      const i = base + c;
      const b0 = bands[0][i], b1 = bands[1][i], b2 = bands[2][i], b3 = bands[3][i];
      if (b0 + b1 + b2 + b3 <= 0) continue;
      populatedPixels++;
      const lga = rowLga[c];
      if (lga) {
        const o = (lga - 1) * NBANDS;
        lgaTotals[o] += b0; lgaTotals[o + 1] += b1; lgaTotals[o + 2] += b2; lgaTotals[o + 3] += b3;
      } else {
        unassigned[0] += b0; unassigned[1] += b1; unassigned[2] += b2; unassigned[3] += b3;
        unassignedPixels++;
      }
      const o = cellSlot(lat, ox + (c + 0.5) * rx) * NBANDS;
      cellTotals[o] += b0; cellTotals[o + 1] += b1; cellTotals[o + 2] += b2; cellTotals[o + 3] += b3;
    }
  }
  console.log(`rows ${r1}/${H}  populated pixels ${populatedPixels.toLocaleString()}  h3 cells ${cellIds.length.toLocaleString()}  ${Math.round((Date.now() - started) / 1000)}s`);
}

// WorldPop's own total raster is only a cross-check on the national sum. It is published on
// a slightly different grid from the age-sex rasters, so it is summed on its own.
if (ppp) {
  const nodata = ppp.image.getGDALNoData();
  const height = ppp.image.getHeight();
  for (let r0 = 0; r0 < height; r0 += BLOCK_ROWS) {
    const [values] = await ppp.image.readRasters({ window: [0, r0, ppp.image.getWidth(), Math.min(height, r0 + BLOCK_ROWS)] });
    for (let i = 0; i < values.length; i++) if (isValue(values[i], nodata)) ppp.sum += values[i];
  }
}

// ── Write outputs ──────────────────────────────────────────────────────────

function bandRow(values, offset) {
  const row = {};
  let total = 0;
  AGE_BANDS.forEach((band, b) => { row[band] = values[offset + b]; total += values[offset + b]; });
  row.pop_total = total;
  row.pop_15_34 = row.pop_15_24 + row.pop_25_34;
  return row;
}

ensureDir(OUT_DIR);
const lgaRows = geographies.lgas.map((lga, i) => {
  if (lga.lga_pcode !== lgaFeatures[i].properties.lga_pcode) throw new Error('LGA order mismatch between geographies.json and lga-full.geojson');
  return { lga_pcode: lga.lga_pcode, ...bandRow(lgaTotals, i * NBANDS) };
});
writeJson(resolve(OUT_DIR, 'pop_lga.json'), lgaRows);

const stateRows = geographies.states.map(state => {
  const sums = new Float64Array(NBANDS);
  geographies.lgas.forEach((lga, i) => {
    if (lga.state_pcode === state.state_pcode) for (let b = 0; b < NBANDS; b++) sums[b] += lgaTotals[i * NBANDS + b];
  });
  return { state_pcode: state.state_pcode, ...bandRow(sums, 0) };
});
writeJson(resolve(OUT_DIR, 'pop_state.json'), stateRows);

async function writeCells(res, ids, totals) {
  const out = createWriteStream(resolve(OUT_DIR, `pop_h3_r${res}.csv`));
  out.write(`h3,lat,lng,area_km2,${AGE_BANDS.join(',')}\n`);
  ids.forEach((id, slot) => {
    const [lat, lng] = cellToLatLng(id);
    const o = slot * NBANDS;
    out.write(`${id},${lat.toFixed(6)},${lng.toFixed(6)},${cellArea(id, 'km2').toFixed(6)},${totals[o]},${totals[o + 1]},${totals[o + 2]},${totals[o + 3]}\n`);
  });
  await new Promise(done => out.end(done));
  return ids.length;
}

function rollUp(res, ids, totals) {
  const index = new Map();
  const parentIds = [];
  const parentTotals = [];
  ids.forEach((id, slot) => {
    const parent = cellToParent(id, res);
    let p = index.get(parent);
    if (p === undefined) { p = parentIds.length; index.set(parent, p); parentIds.push(parent); for (let b = 0; b < NBANDS; b++) parentTotals.push(0); }
    for (let b = 0; b < NBANDS; b++) parentTotals[p * NBANDS + b] += totals[slot * NBANDS + b];
  });
  return [parentIds, parentTotals];
}

const cellCounts = { [H3_BASE_RES]: await writeCells(H3_BASE_RES, cellIds, cellTotals) };
let [ids, totals] = [cellIds, cellTotals];
for (const res of [8, 7]) {
  [ids, totals] = rollUp(res, ids, totals);
  cellCounts[res] = await writeCells(res, ids, totals);
}

const national = bandRow(stateRows.reduce((acc, s) => { AGE_BANDS.forEach((band, b) => { acc[b] += s[band]; }); return acc; }, new Float64Array(NBANDS)), 0);
const unassignedRow = bandRow(unassigned, 0);
const rasterSum = rasters.reduce((s, r) => s + r.sum, 0);
const summary = {
  dataset: 'worldpop_agesex_2020_constrained',
  computed_at: new Date().toISOString(),
  grid: { width: W, height: H, origin: [ox, oy], resolution: rx },
  populated_pixels: populatedPixels,
  sum_of_36_age_sex_rasters: rasterSum,
  worldpop_ppp_constrained_total: ppp ? ppp.sum : null,
  assigned_to_lgas: national,
  unassigned: { ...unassignedRow, pixels: unassignedPixels, share_of_total: unassignedRow.pop_total / rasterSum },
  h3_cells: cellCounts,
  per_raster_sum: Object.fromEntries(rasters.map(r => [`${r.sex}_${r.age}`, r.sum])),
};
writeJson(resolve(OUT_DIR, 'pop_summary.json'), summary);

console.log('\nSum of 36 age-sex rasters :', Math.round(rasterSum).toLocaleString());
if (ppp) console.log('WorldPop ppp total raster  :', Math.round(ppp.sum).toLocaleString());
console.log('Assigned to LGAs           :', Math.round(national.pop_total).toLocaleString());
console.log('Unassigned (no LGA polygon):', Math.round(unassignedRow.pop_total).toLocaleString(), `(${(summary.unassigned.share_of_total * 100).toFixed(3)}%, ${unassignedPixels} pixels)`);
console.log('H3 cells                   :', cellCounts);
