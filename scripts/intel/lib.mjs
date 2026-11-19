/**
 * Shared helpers for the board-intelligence pipeline (scripts/intel/*).
 * Run from the repo root. Raw data lives in scripts/geo/data (gitignored),
 * outputs in scripts/intel/out (gitignored).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';

export const ROOT = process.cwd();
export const GEO_DATA = resolve(ROOT, 'scripts/geo/data');
export const OUT = resolve(ROOT, 'scripts/intel/out');

export function ensureDir(dir) { if (!existsSync(dir)) mkdirSync(dir, { recursive: true }); return dir; }
export const readJson = p => JSON.parse(readFileSync(p, 'utf-8'));
export function writeJson(p, v) { ensureDir(dirname(p)); writeFileSync(p, JSON.stringify(v, null, 1)); }

/** Read .env.local without dotenv. */
export function loadEnv() {
  try {
    for (const line of readFileSync(resolve(ROOT, '.env.local'), 'utf-8').split(/\r?\n/)) {
      const i = line.indexOf('=');
      if (i > 0 && !line.startsWith('#')) process.env[line.slice(0, i).trim()] ??= line.slice(i + 1).trim().replace(/^"|"$/g, '');
    }
  } catch { /* rely on the real environment */ }
}

/** Great-circle distance in metres. */
export function metres(lat1, lng1, lat2, lng2) {
  const R = 6371008.8, r = Math.PI / 180;
  const a = Math.sin((lat2 - lat1) * r / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin((lng2 - lng1) * r / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Minimal service-role REST client. The key never leaves this machine. */
export function db() {
  loadEnv();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing');
  const H = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  async function call(path, opt = {}) {
    for (let i = 0; i < 5; i++) {
      try {
        const res = await fetch(`${url}/rest/v1/${path}`, { ...opt, headers: { ...H, ...(opt.headers || {}) } });
        const text = await res.text();
        if (!res.ok) throw Object.assign(new Error(`${res.status} ${text.slice(0, 300)}`), { fatal: res.status < 500 });
        return text ? JSON.parse(text) : null;
      } catch (e) { if (e.fatal || i === 4) throw e; await sleep(1500 * (i + 1)); }
    }
  }
  return {
    get: path => call(path),
    rpc: (fn, body) => call(`rpc/${fn}`, { method: 'POST', body: JSON.stringify(body ?? {}) }),
    upsert: (table, rows, onConflict) => call(`${table}${onConflict ? `?on_conflict=${onConflict}` : ''}`, {
      method: 'POST', body: JSON.stringify(rows), headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    }),
  };
}

/** Every board with a map pin. */
export async function pinnedBoards(client) {
  const rows = await client.get('boards?select=id,name,state,city,latitude,longitude&latitude=not.is.null&longitude=not.is.null&limit=10000');
  return rows.filter(b => Number.isFinite(b.latitude) && Number.isFinite(b.longitude));
}
