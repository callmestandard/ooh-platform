/**
 * Step 6 — night-time lights per LGA and state.
 * Usage: node scripts/geo/06-nightlights.mjs          (deletes the 12 GB extracted raster when done)
 *        node scripts/geo/06-nightlights.mjs --keep   (leaves it in place for another run)
 *
 * Source: "The global NPP-VIIRS-like nighttime light data (Version 2)",
 * Chen, Yu et al., Harvard Dataverse doi:10.7910/DVN/YGIVCD, year 2024,
 * ~500 m grid, CC0. Used instead of the EOG VIIRS annual composite, which
 * needs a login to download. From 2013 on this product is built from the
 * NPP-VIIRS composites themselves.
 *
 * Method: the LGA polygons are rasterised onto the light grid (pixel-centre
 * rule) and the mean radiance of every pixel in the LGA is taken — dark
 * pixels count as 0, they are not skipped. A state is the pixel-weighted
 * mean of its LGAs. An LGA containing no pixel centre gets no value.
 *
 * This is an indicator of lit economic activity, not of income.
 */

import { createReadStream, createWriteStream, existsSync, statSync, unlinkSync } from 'fs';
import { resolve } from 'path';
import { Unzip, UnzipInflate } from 'fflate';
import { fromFile } from 'geotiff';
import { DATA_DIR, OUT_DIR, rasterisePolygons, readJson, writeJson } from './lib.mjs';

const YEAR = 2024;
const zipPath = resolve(DATA_DIR, `ntl/${YEAR}_Version2.zip`);
const tifName = `nppviirs_like_V2_${YEAR}.tif`;
const tifPath = resolve(DATA_DIR, `ntl/${tifName}`);

/** Streams the one raster out of the zip — it is 12 GB uncompressed, far too big to inflate in memory. */
async function extract() {
  await new Promise((done, fail) => {
    const out = createWriteStream(tifPath);
    let pending = Promise.resolve();
    const unzip = new Unzip(file => {
      if (file.name !== tifName) return;
      file.ondata = (err, chunk, final) => {
        if (err) return fail(err);
        // Respect back-pressure so the inflated data does not pile up in memory.
        pending = pending.then(() => new Promise(next => { if (out.write(chunk)) next(); else out.once('drain', next); }));
        if (final) pending.then(() => out.end(done));
      };
      file.start();
    });
    unzip.register(UnzipInflate);
    const input = createReadStream(zipPath, { highWaterMark: 1 << 20 });
    input.on('data', chunk => {
      unzip.push(chunk, false);
      input.pause();
      pending.then(() => input.resume());
    });
    input.on('end', () => unzip.push(new Uint8Array(0), true));
    input.on('error', fail);
  });
}

if (!existsSync(tifPath)) {
  if (!existsSync(zipPath)) {
    console.error(`Missing ${zipPath} — run scripts/geo/01-download.mjs first.`);
    process.exit(1);
  }
  console.log('Extracting the raster (about 12 GB on disk) …');
  await extract();
}
console.log(`Raster: ${(statSync(tifPath).size / 1e9).toFixed(2)} GB`);

const image = await (await fromFile(tifPath)).getImage();
const [gx, gy] = image.getOrigin();
const [rx, ry] = image.getResolution();
const nodata = image.getGDALNoData();

const lgaFeatures = readJson(resolve(OUT_DIR, 'lga-full.geojson')).features;
const geographies = readJson(resolve(OUT_DIR, 'geographies.json'));

// The window of the global grid that covers Nigeria.
let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
for (const f of lgaFeatures) {
  const polygons = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  for (const rings of polygons) for (const [x, y] of rings[0]) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
}
const c0 = Math.floor((minX - gx) / rx);
const c1 = Math.ceil((maxX - gx) / rx);
const r0 = Math.floor((maxY - gy) / ry);
const r1 = Math.ceil((minY - gy) / ry);
const width = c1 - c0;
const height = r1 - r0;
const [values] = await image.readRasters({ window: [c0, r0, c1, r1] });

const runs = rasterisePolygons(lgaFeatures, { width, height, ox: gx + c0 * rx, oy: gy + r0 * ry, rx, ry });
const sums = new Float64Array(lgaFeatures.length);
const counts = new Int32Array(lgaFeatures.length);
for (let r = 0; r < height; r++) {
  const rowRuns = runs[r];
  for (let j = 0; j < rowRuns.length; j += 3) {
    const lga = rowRuns[j + 2] - 1;
    for (let c = rowRuns[j]; c < rowRuns[j + 1]; c++) {
      const v = values[r * width + c];
      if (v !== v || v === nodata || v < 0) continue;
      sums[lga] += v;
      counts[lga]++;
    }
  }
}

const lgaRows = geographies.lgas.map((lga, i) => ({
  lga_pcode: lga.lga_pcode,
  ntl_mean: counts[i] ? sums[i] / counts[i] : null,
  ntl_pixels: counts[i],
}));
const stateRows = geographies.states.map(state => {
  let sum = 0, count = 0;
  geographies.lgas.forEach((lga, i) => { if (lga.state_pcode === state.state_pcode) { sum += sums[i]; count += counts[i]; } });
  return { state_pcode: state.state_pcode, ntl_mean: count ? sum / count : null, ntl_pixels: count };
});

writeJson(resolve(OUT_DIR, 'ntl_lga.json'), lgaRows);
writeJson(resolve(OUT_DIR, 'ntl_state.json'), stateRows);
writeJson(resolve(OUT_DIR, 'ntl_summary.json'), {
  dataset: 'ntl_npp_viirs_like_v2',
  year: YEAR,
  grid_resolution_degrees: rx,
  window: { c0, r0, width, height },
  lgas_without_pixels: lgaRows.filter(r => r.ntl_mean === null).map(r => r.lga_pcode),
  lgas_fully_dark: lgaRows.filter(r => r.ntl_mean === 0).length,
});

const ranked = lgaRows.filter(r => r.ntl_mean !== null).sort((a, b) => b.ntl_mean - a.ntl_mean);
const name = pcode => { const l = geographies.lgas.find(x => x.lga_pcode === pcode); return `${l.lga_name}, ${l.state_name}`; };
console.log(`LGAs with a value: ${ranked.length}/774; fully dark (mean 0): ${lgaRows.filter(r => r.ntl_mean === 0).length}`);
console.log('Brightest 5:', ranked.slice(0, 5).map(r => `${name(r.lga_pcode)} ${r.ntl_mean.toFixed(1)}`).join(' | '));

if (!process.argv.includes('--keep')) {
  unlinkSync(tifPath);
  console.log('Removed the extracted raster (re-run extracts it again from the zip).');
}
