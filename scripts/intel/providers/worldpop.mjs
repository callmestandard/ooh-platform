/**
 * WorldPop provider — estimated residents around a point, from the 2020
 * constrained 100 m rasters (CC BY 4.0, University of Southampton).
 *
 * Method: a ~100 m grid cell counts toward a ring when its CENTRE lies within
 * that distance of the board. Cells are never split. These are modelled
 * residents, not people passing the board.
 */
import { existsSync } from 'fs';
import { resolve } from 'path';
import { fromFile } from 'geotiff';
import { GEO_DATA, metres } from '../lib.mjs';

export const TOTAL_DATASET_ID = 'worldpop_ppp_2020_constrained';
export const AGESEX_DATASET_ID = 'worldpop_agesex_2020_constrained';
export const RINGS = [250, 500, 1000, 2000];
/** Age bands for the 1 km ring; each WorldPop 5-year group lands in exactly one. */
export const AGE_BANDS = { '0_14': [0, 1, 5, 10], '15_24': [15, 20], '25_34': [25, 30], '35_44': [35, 40], '45_plus': [45, 50, 55, 60, 65, 70, 75, 80] };

const dir = resolve(GEO_DATA, 'worldpop');

async function open(file) {
  const path = resolve(dir, file);
  if (!existsSync(path)) throw new Error(`missing ${path} — run scripts/geo/01-download.mjs on the market-intelligence branch`);
  const tiff = await fromFile(path);
  const img = await tiff.getImage();
  const [x0, y0] = img.getOrigin();
  const [rx, ry] = img.getResolution();
  return { tiff, img, x0, y0, rx, ry, w: img.getWidth(), h: img.getHeight() };
}

/** Sum of cells per radius (metres) around a point, for one raster. */
async function ringSums(r, lat, lng, radii) {
  const maxR = Math.max(...radii);
  const dLat = maxR / 111000 + Math.abs(r.ry), dLng = maxR / (111000 * Math.cos(lat * Math.PI / 180)) + r.rx;
  const left = Math.max(0, Math.floor((lng - dLng - r.x0) / r.rx));
  const right = Math.min(r.w, Math.ceil((lng + dLng - r.x0) / r.rx));
  const top = Math.max(0, Math.floor((lat + dLat - r.y0) / r.ry));
  const bottom = Math.min(r.h, Math.ceil((lat - dLat - r.y0) / r.ry));
  const sums = radii.map(() => 0);
  if (right <= left || bottom <= top) return sums;
  const [band] = await r.img.readRasters({ window: [left, top, right, bottom] });
  const W = right - left;
  for (let y = top; y < bottom; y++) {
    const cy = r.y0 + (y + 0.5) * r.ry;
    for (let x = left; x < right; x++) {
      const v = band[(y - top) * W + (x - left)];
      if (!(v > 0)) continue; // nodata / unpopulated
      const d = metres(lat, lng, cy, r.x0 + (x + 0.5) * r.rx);
      radii.forEach((rad, i) => { if (d <= rad) sums[i] += v; });
    }
  }
  return sums;
}

/** Opens every raster once; returns compute(lat, lng). */
export async function worldpop() {
  const total = await open('nga_ppp_2020_constrained.tif');
  const age = {};
  for (const [band, groups] of Object.entries(AGE_BANDS)) {
    age[band] = [];
    for (const g of groups) for (const s of ['f', 'm']) age[band].push(await open(`nga_${s}_${g}_2020_constrained.tif`));
  }
  return async function compute(lat, lng) {
    const sums = await ringSums(total, lat, lng, RINGS);
    const age1km = {};
    for (const [band, rasters] of Object.entries(age)) {
      let s = 0;
      for (const r of rasters) s += (await ringSums(r, lat, lng, [1000]))[0];
      age1km[band] = Math.round(s);
    }
    return {
      pop_250m: Math.round(sums[0]), pop_500m: Math.round(sums[1]),
      pop_1km: Math.round(sums[2]), pop_2km: Math.round(sums[3]),
      age_1km: age1km,
    };
  };
}
