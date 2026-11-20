// Your own copy of the database: every table, saved as JSON in backups/<date>/.
// Read-only: it never changes anything in Supabase.
//
//   node scripts/backup.mjs          save every table
//   node scripts/backup.mjs --dry    only count rows, save nothing
//   node scripts/backup.mjs --all    also the large map grids (geo_pop_r9, geo_metrics_h3)
//
// Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local.
// backups/ is never committed (see .gitignore). It holds customer and owner
// details: keep it somewhere safe (encrypted drive or private cloud folder).
// Storage files (photos, artwork) are listed in storage.json, not downloaded.
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadEnv } from './intel/lib.mjs';

loadEnv();
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL, KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !KEY) { console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY'); process.exit(1); }
const DRY = process.argv.includes('--dry');
const ALL = process.argv.includes('--all');
// Population/area grids (2.4M rows) rebuilt from the raw data in scripts/geo; add --all to include them.
const SKIP = new Set(['geo_pop_r9', 'geo_metrics_h3']);
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };
const PAGE = 1000;

async function tables() {
  const r = await fetch(`${URL_}/rest/v1/`, { headers: { ...H, Accept: 'application/openapi+json' } });
  if (!r.ok) throw new Error(`Could not list tables: ${r.status}`);
  const spec = await r.json();
  return Object.keys(spec.definitions ?? spec.components?.schemas ?? {}).sort();
}

async function count(t) {
  const r = await fetch(`${URL_}/rest/v1/${encodeURIComponent(t)}?select=*`, { method: 'HEAD', headers: { ...H, Prefer: 'count=exact', Range: '0-0' } });
  const m = (r.headers.get('content-range') || '').match(/\/(\d+)$/);
  return r.ok || r.status === 206 ? (m ? Number(m[1]) : 0) : null;
}

async function rows(t) {
  const out = [];
  for (let from = 0; ; from += PAGE) {
    const r = await fetch(`${URL_}/rest/v1/${encodeURIComponent(t)}?select=*`, { headers: { ...H, Range: `${from}-${from + PAGE - 1}`, 'Range-Unit': 'items' } });
    if (!r.ok && r.status !== 206) throw new Error(`${t}: ${r.status} ${(await r.text()).slice(0, 120)}`);
    const page = await r.json();
    out.push(...page);
    if (page.length < PAGE) return out;
  }
}

async function storageManifest() {
  const buckets = await (await fetch(`${URL_}/storage/v1/bucket`, { headers: H })).json();
  const out = {};
  async function walk(b, prefix) {
    for (let offset = 0; ; offset += 1000) {
      const r = await fetch(`${URL_}/storage/v1/object/list/${b}`, { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ prefix, limit: 1000, offset }) });
      const list = await r.json();
      if (!Array.isArray(list)) return;
      for (const f of list) {
        if (f.id) out[b].push({ path: prefix + f.name, size: f.metadata?.size ?? null, updated_at: f.updated_at });
        else await walk(b, prefix + f.name + '/');
      }
      if (list.length < 1000) return;
    }
  }
  for (const b of buckets) { out[b.id] = []; await walk(b.id, ''); }
  return { buckets: buckets.map(b => ({ id: b.id, public: b.public })), files: out };
}

const list = await tables();
const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
const dir = resolve(process.cwd(), 'backups', stamp);
if (!DRY) mkdirSync(dir, { recursive: true });
const summary = { created_at: new Date().toISOString(), project: new URL(URL_).host.split('.')[0], tables: {} };
let total = 0, failed = 0;
for (const t of list) {
  try {
    if (SKIP.has(t) && !ALL) { summary.tables[t] = 'skipped (rebuild from scripts/geo)'; continue; }
    if (DRY) { const n = await count(t); summary.tables[t] = n; total += n ?? 0; continue; }
    const data = await rows(t);
    writeFileSync(resolve(dir, `${t}.json`), JSON.stringify(data));
    summary.tables[t] = data.length; total += data.length;
  } catch (e) {
    summary.tables[t] = `error: ${e.message}`; failed++;
  }
}
if (!DRY) {
  writeFileSync(resolve(dir, 'storage.json'), JSON.stringify(await storageManifest(), null, 1));
  writeFileSync(resolve(dir, '_summary.json'), JSON.stringify(summary, null, 1));
}
console.log(`${DRY ? 'Dry run' : 'Backup'}: ${list.length} tables (${ALL ? 0 : SKIP.size} map grids skipped), ${total} rows${failed ? `, ${failed} failed` : ''}${DRY ? '' : ` → ${dir}`}`);
if (failed) { for (const [t, v] of Object.entries(summary.tables)) if (typeof v === 'string') console.log('  ', t, v); process.exit(1); }
