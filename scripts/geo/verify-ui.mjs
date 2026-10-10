/**
 * Renders the Market Intel page in a real browser against the pipeline's
 * LOCAL outputs, so the map can be checked before (or without) loading the
 * database. Requests for the geo_* tables are answered from scripts/geo/out/;
 * everything else (basemap, boundary files, hexagon tiles) is real.
 *
 * Usage: start the app (`npm run dev`), then
 *   node scripts/geo/verify-ui.mjs [baseUrl] [outDir]
 *
 * Writes screenshots to outDir and prints load and pan timings for a laptop
 * profile and an EMULATED mid-range phone (390 px viewport, 4x CPU slowdown).
 * The phone numbers are an emulation on this machine, not a device test.
 */

import { mkdirSync } from 'fs';
import { resolve } from 'path';
import { chromium } from 'playwright';
import { DATA_DIR, OUT_DIR, readJson } from './lib.mjs';
import { DATASETS } from './datasets.mjs';

const baseUrl = process.argv[2] || 'http://localhost:3000';
const shotDir = resolve(process.argv[3] || 'scripts/geo/out/screenshots');
mkdirSync(shotDir, { recursive: true });

const retrieved = readJson(resolve(DATA_DIR, 'retrieved.json'));
const tables = {
  geo_metrics_lga: readJson(resolve(OUT_DIR, 'metrics_lga.json')),
  geo_metrics_state: readJson(resolve(OUT_DIR, 'metrics_state.json')).sort((a, b) => a.state_name.localeCompare(b.state_name)),
  geo_datasets: DATASETS.map(d => ({ ...d, retrieved_on: retrieved[d.id] || new Date().toISOString().slice(0, 10) })),
  geo_segment_rules: readJson(resolve(OUT_DIR, 'segment_rules.json')),
};

async function open(browser, { name, viewport, cpuSlowdown, isMobile }) {
  const context = await browser.newContext({ viewport, isMobile, hasTouch: isMobile, deviceScaleFactor: isMobile ? 2 : 1 });
  await context.addInitScript(() => {
    localStorage.setItem('ooh_platform_role', 'agency');
    localStorage.setItem('ooh_onboarding_agency_done', '1'); // skip the first-run welcome modal
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.route('**/rest/v1/geo_*', route => {
    const table = new URL(route.request().url()).pathname.split('/').pop();
    const body = tables[table];
    if (!body) return route.fulfill({ status: 404, body: '{}' });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  if (cpuSlowdown) {
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpuSlowdown });
  }

  const started = Date.now();
  await page.goto(`${baseUrl}/dashboard/agency/market-intelligence`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.mapboxgl-canvas', { timeout: 120000 });
  // "Painted" = the choropleth source has loaded and the map has gone idle.
  await page.waitForFunction(() => document.querySelector('.mapboxgl-canvas') && !document.querySelector('.mapboxgl-map.mapboxgl-loading'), null, { timeout: 120000 });
  await page.waitForTimeout(4000);
  const loadMs = Date.now() - started - 4000;
  return { name, page, context, errors, loadMs };
}

/** Drags the map back and forth for ~3 s and reports the frame rate the page achieved. */
async function panFps(page) {
  const box = await page.locator('.mapboxgl-canvas').boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.evaluate(() => {
    window.__frames = [];
    const tick = t => { window.__frames.push(t); window.__raf = requestAnimationFrame(tick); };
    window.__raf = requestAnimationFrame(tick);
  });
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let i = 0; i < 90; i++) {
    await page.mouse.move(cx + Math.sin(i / 14) * box.width * 0.3, cy + Math.cos(i / 9) * box.height * 0.2);
    await page.waitForTimeout(33);
  }
  await page.mouse.up();
  return page.evaluate(() => {
    cancelAnimationFrame(window.__raf);
    const f = window.__frames;
    const gaps = f.slice(1).map((t, i) => t - f[i]).sort((a, b) => a - b);
    const seconds = (f[f.length - 1] - f[0]) / 1000;
    return {
      fps: Math.round((f.length - 1) / seconds),
      p95FrameMs: Math.round(gaps[Math.floor(gaps.length * 0.95)]),
      worstFrameMs: Math.round(gaps[gaps.length - 1]),
    };
  });
}

// Use the real GPU: headless Chromium otherwise falls back to software WebGL, which says
// nothing about how the map performs for a user.
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const profiles = [
  { name: 'laptop', viewport: { width: 1440, height: 900 } },
  { name: 'phone-emulated', viewport: { width: 390, height: 844 }, cpuSlowdown: 4, isMobile: true },
];

for (const profile of profiles) {
  const session = await open(browser, profile);
  const { page } = session;
  const renderer = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const info = gl && gl.getExtension('WEBGL_debug_renderer_info');
    return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : 'unknown';
  });
  console.log(`${profile.name}: WebGL renderer ${renderer}`);
  await page.screenshot({ path: resolve(shotDir, `${profile.name}-national.png`) });
  const fps = profile.isMobile ? null : await panFps(page);
  console.log(`${profile.name}: first usable map in ${session.loadMs} ms${fps ? `; pan at national zoom ${fps.fps} fps, 95th-percentile frame ${fps.p95FrameMs} ms, worst ${fps.worstFrameMs} ms` : ''}`);

  if (!profile.isMobile) {
    // Segment layer, then a state profile with a comparison, then an evidence drawer.
    await page.getByLabel('Segment', { exact: true }).check();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: resolve(shotDir, 'laptop-segments.png') });

    await page.locator('aside[aria-label="Layers"] select').first().selectOption({ label: 'Lagos' });
    await page.waitForTimeout(2500);
    await page.getByLabel('Add a state to compare').selectOption({ label: 'Kano' });
    await page.waitForTimeout(800);
    await page.screenshot({ path: resolve(shotDir, 'laptop-compare.png') });

    await page.getByRole('button', { name: /Source and method: Residents aged 15-34 \(modelled\), Lagos/ }).click();
    await page.waitForTimeout(600);
    await page.screenshot({ path: resolve(shotDir, 'laptop-evidence.png') });
    await page.keyboard.press('Escape');

    // City zoom: the hexagon layer.
    await page.getByLabel('Population density', { exact: true }).check();
    await page.getByRole('button', { name: 'Close state profile' }).click();
    const box = await page.locator('.mapboxgl-canvas').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    for (let i = 0; i < 12; i++) { await page.mouse.wheel(0, -400); await page.waitForTimeout(250); }
    await page.waitForTimeout(5000);
    await page.screenshot({ path: resolve(shotDir, 'laptop-hexagons.png') });
    const hexFps = await panFps(page);
    console.log(`laptop: pan at city zoom (hexagons) ${hexFps.fps} fps, 95th-percentile frame ${hexFps.p95FrameMs} ms`);
  } else {
    // Touch devices cannot be mouse-dragged; measure a programmatic fling instead.
    const fps = await page.evaluate(async () => {
      const frames = [];
      let raf;
      const tick = t => { frames.push(t); raf = requestAnimationFrame(tick); };
      raf = requestAnimationFrame(tick);
      const canvas = document.querySelector('.mapboxgl-canvas');
      const rect = canvas.getBoundingClientRect();
      const touch = (type, x, y) => {
        const t = new Touch({ identifier: 1, target: canvas, clientX: x, clientY: y });
        canvas.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true, touches: type === 'touchend' ? [] : [t], changedTouches: [t], targetTouches: type === 'touchend' ? [] : [t] }));
      };
      const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
      touch('touchstart', cx, cy);
      for (let i = 0; i < 90; i++) {
        touch('touchmove', cx + Math.sin(i / 14) * rect.width * 0.3, cy + Math.cos(i / 9) * rect.height * 0.2);
        await new Promise(r => setTimeout(r, 33));
      }
      touch('touchend', cx, cy);
      cancelAnimationFrame(raf);
      const gaps = frames.slice(1).map((t, i) => t - frames[i]).sort((a, b) => a - b);
      return { fps: Math.round((frames.length - 1) / ((frames[frames.length - 1] - frames[0]) / 1000)), p95FrameMs: Math.round(gaps[Math.floor(gaps.length * 0.95)]) };
    });
    console.log(`phone-emulated: touch pan at national zoom ${fps.fps} fps, 95th-percentile frame ${fps.p95FrameMs} ms (4x CPU slowdown)`);
    await page.getByRole('button', { name: 'Layers and legend' }).click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: resolve(shotDir, 'phone-layers.png') });
  }

  if (session.errors.length) console.log(`  ${profile.name} console errors:\n   - ${[...new Set(session.errors)].slice(0, 8).join('\n   - ')}`);
  await session.context.close();
}
await browser.close();
console.log(`Screenshots in ${shotDir}`);
