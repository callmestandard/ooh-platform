/**
 * Step 2 — administrative boundaries.
 * Usage: node scripts/geo/02-boundaries.mjs
 *
 * Source: OCHA COD-AB Nigeria (HDX `cod-ab-nga`), admin 2 = 774 LGAs,
 * admin 1 = 36 states + FCT.
 *
 * Writes:
 *   scripts/geo/out/lga-full.geojson   full-resolution LGA polygons — the geometry every
 *                                      aggregation step assigns pixels and points with
 *   scripts/geo/out/geographies.json   pcode, name, parent state and area for each LGA and state
 *   public/geo/ng-lga.geojson          simplified LGA polygons for the map
 *   public/geo/ng-state.geojson        state polygons dissolved from the simplified LGAs, so
 *                                      state and LGA borders coincide exactly on screen
 *
 * Areas are computed here from the full-resolution polygons (spherical
 * formula), not taken from the source's area_sqkm column, so every density
 * in the pipeline uses the same geometry the population was aggregated with.
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { unzipSync } from 'fflate';
import mapshaper from 'mapshaper';
import { DATA_DIR, OUT_DIR, ROOT, ensureDir, geometryAreaKm2, writeJson } from './lib.mjs';

const zipPath = resolve(DATA_DIR, 'boundaries/nga_admin_boundaries.geojson.zip');
if (!existsSync(zipPath)) {
  console.error('Missing boundaries zip — run scripts/geo/01-download.mjs first.');
  process.exit(1);
}

const entries = unzipSync(new Uint8Array(readFileSync(zipPath)), { filter: f => f.name === 'nga_admin2.geojson' });
const admin2 = JSON.parse(Buffer.from(entries['nga_admin2.geojson']).toString('utf-8'));

const lgas = [];
const states = new Map();
const features = admin2.features.map(f => {
  const p = f.properties;
  const areaKm2 = geometryAreaKm2(f.geometry);
  lgas.push({ lga_pcode: p.adm2_pcode, lga_name: p.adm2_name, state_pcode: p.adm1_pcode, state_name: p.adm1_name, area_km2: areaKm2 });
  const state = states.get(p.adm1_pcode) || { state_pcode: p.adm1_pcode, state_name: p.adm1_name, area_km2: 0, lga_count: 0 };
  state.area_km2 += areaKm2;
  state.lga_count += 1;
  states.set(p.adm1_pcode, state);
  return {
    type: 'Feature',
    properties: { lga_pcode: p.adm2_pcode, lga_name: p.adm2_name, state_pcode: p.adm1_pcode, state_name: p.adm1_name },
    geometry: f.geometry,
  };
});

if (lgas.length !== 774 || states.size !== 37) {
  console.error(`Expected 774 LGAs and 37 states, got ${lgas.length} and ${states.size}.`);
  process.exit(1);
}
if (new Set(lgas.map(l => l.lga_pcode)).size !== lgas.length) {
  console.error('LGA pcodes are not unique.');
  process.exit(1);
}

ensureDir(OUT_DIR);
const fullPath = resolve(OUT_DIR, 'lga-full.geojson');
writeFileSync(fullPath, JSON.stringify({ type: 'FeatureCollection', features }));
writeJson(resolve(OUT_DIR, 'geographies.json'), {
  source: 'ocha_cod_ab_nga',
  lgas,
  states: [...states.values()].sort((a, b) => a.state_pcode.localeCompare(b.state_pcode)),
});

// Simplify for the browser. Visvalingam, topology-aware (shared borders stay
// shared), no LGA dropped; coordinates rounded to ~10 m.
const publicDir = ensureDir(resolve(ROOT, 'public/geo'));
await mapshaper.runCommands(
  `-i "${fullPath}" name=lga -simplify 30% weighted keep-shapes -clean ` +
  `-o "${resolve(publicDir, 'ng-lga.geojson')}" precision=0.0001 ` +
  `-dissolve state_pcode copy-fields=state_name name=state ` +
  `-o "${resolve(publicDir, 'ng-state.geojson')}" precision=0.0001`,
);

const totalArea = lgas.reduce((s, l) => s + l.area_km2, 0);
console.log(`LGAs: ${lgas.length}, states: ${states.size}, total area: ${Math.round(totalArea).toLocaleString()} km²`);
for (const name of ['ng-lga.geojson', 'ng-state.geojson']) {
  const fc = JSON.parse(readFileSync(resolve(publicDir, name), 'utf-8'));
  console.log(`public/geo/${name}: ${fc.features.length} features, ${(readFileSync(resolve(publicDir, name)).length / 1024).toFixed(0)} KB`);
}
