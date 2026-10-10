/**
 * Step 1 — download the raw source files.
 * Usage: node scripts/geo/01-download.mjs
 *
 * Re-runnable: a file that is already on disk at the size the server reports
 * is skipped. Records the retrieval date of each source in
 * scripts/geo/data/retrieved.json so the dataset registry can cite it.
 */

import { createWriteStream, existsSync, statSync } from 'fs';
import { resolve } from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { DATA_DIR, ensureDir, readJson, writeJson, WORLDPOP_AGE_GROUPS, WORLDPOP_SEXES } from './lib.mjs';

const WORLDPOP_AGESEX_BASE = 'https://data.worldpop.org/GIS/AgeSex_structures/Global_2000_2020_Constrained/2020/NGA';

const files = [];
for (const sex of WORLDPOP_SEXES) {
  for (const age of WORLDPOP_AGE_GROUPS) {
    const name = `nga_${sex}_${age}_2020_constrained.tif`;
    files.push({ source: 'worldpop_agesex_2020_constrained', url: `${WORLDPOP_AGESEX_BASE}/${name}`, path: `worldpop/${name}` });
  }
}
// WorldPop's own constrained total — used only to cross-check that the 36 age-sex rasters sum to it.
files.push({
  source: 'worldpop_ppp_2020_constrained',
  url: 'https://data.worldpop.org/GIS/Population/Global_2000_2020_Constrained/2020/maxar_v1/NGA/nga_ppp_2020_constrained.tif',
  path: 'worldpop/nga_ppp_2020_constrained.tif',
});
// Night-time lights, year 2024 (Harvard Dataverse file 14085059 of doi:10.7910/DVN/YGIVCD). A 98 MB zip of a 12 GB raster.
files.push({
  source: 'ntl_npp_viirs_like_v2',
  url: 'https://dataverse.harvard.edu/api/access/datafile/14085059',
  path: 'ntl/2024_Version2.zip',
});
files.push({
  source: 'ocha_cod_ab_nga',
  url: 'https://data.humdata.org/dataset/81ac1d38-f603-4a98-804d-325c658599a3/resource/7e30ec96-7f29-4ee8-9f4c-77633b353cbb/download/nga_admin_boundaries.geojson.zip',
  path: 'boundaries/nga_admin_boundaries.geojson.zip',
});

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * Downloads one file, resuming a partial file with an HTTP Range request —
 * the WorldPop server drops long connections, so a dropped transfer picks up
 * where it stopped instead of starting over.
 */
async function download({ url, path }) {
  const dest = resolve(DATA_DIR, path);
  ensureDir(resolve(dest, '..'));
  let lastError;
  for (let attempt = 0; attempt < 12; attempt++) {
    try {
      const head = await fetch(url, { method: 'HEAD', redirect: 'follow' });
      const total = Number(head.headers.get('content-length'));
      const resumable = head.headers.get('accept-ranges') === 'bytes' && total > 0;
      const have = existsSync(dest) ? statSync(dest).size : 0;
      if (total && have === total) return attempt === 0 ? 'skipped' : 'downloaded';
      // A server that reports no size (Harvard Dataverse) cannot be resumed or compared: keep what is on disk.
      if (!total && have > 0 && attempt === 0) return 'skipped';

      const resume = resumable && have > 0 && have < total;
      const res = await fetch(url, resume ? { headers: { Range: `bytes=${have}-` } } : {});
      if (!res.ok || !res.body) throw new Error(`${res.status} ${res.statusText} for ${url}`);
      const append = resume && res.status === 206;
      await pipeline(Readable.fromWeb(res.body), createWriteStream(dest, { flags: append ? 'a' : 'w' }));
      if (!total || statSync(dest).size === total) return 'downloaded';
      throw new Error('transfer ended early');
    } catch (err) {
      lastError = err;
      await sleep(5000);
    }
  }
  throw new Error(`Giving up on ${path}: ${lastError?.cause?.code || lastError?.message}`);
}

const retrievedPath = resolve(DATA_DIR, 'retrieved.json');
const retrieved = existsSync(retrievedPath) ? readJson(retrievedPath) : {};
const today = new Date().toISOString().slice(0, 10);

// A few files at a time — the WorldPop server is slow per connection.
const CONCURRENCY = 6;
const queue = [...files];
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  for (let file = queue.shift(); file; file = queue.shift()) {
    const result = await download(file);
    if (result === 'downloaded' || !retrieved[file.source]) retrieved[file.source] = today;
    console.log(`${file.path.padEnd(52)} ${result}`);
    writeJson(retrievedPath, retrieved);
  }
}));
console.log('Done.');
