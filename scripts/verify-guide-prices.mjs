// Verifies public guide prices (051) with throwaway data: an admin (ADM), an
// owner whose rates are hidden (O), and boards with known rates.
//
//   node scripts/verify-guide-prices.mjs setup   <state-file>
//   node scripts/verify-guide-prices.mjs verify  <state-file>
//   node scripts/verify-guide-prices.mjs cleanup <state-file>
//
// Reads Supabase keys from .env.local. Test boards use a made-up city and
// status 'unavailable'. Passwords go to the state file, never to stdout.
import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split(/\r?\n/).filter(l => /^[A-Z_]+=/.test(l)).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
);
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL, ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY, SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
const [stage, stateFile = '.guide-price-state.json'] = process.argv.slice(2);
const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });
const TAG = 'qa-guide';
const CITY = 'ZZ QA Guide City';

const must = ({ data, error }, what) => { if (error) throw new Error(`${what}: ${error.message}`); return data; };
const save = state => writeFileSync(stateFile, JSON.stringify(state, null, 2));

async function setup() {
  const state = { users: {}, boards: {} };
  for (const [key, role] of [['O', 'owner'], ['ADM', 'admin']]) {
    const email = `${TAG}-${key.toLowerCase()}-${randomBytes(3).toString('hex')}@example.com`;
    const password = randomBytes(18).toString('base64url');
    const { user } = must(await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { role: role === 'admin' ? 'agency' : role, full_name: `QA Guide ${key}` } }), 'createUser');
    must(await admin.from('profiles').update({ role, company_name: `QA Guide ${key}` }).eq('id', user.id), 'profile');
    state.users[key] = { id: user.id, email, password };
    save(state);
  }
  const base = key => ({ name: `[${TAG}] ${key}`, format: 'billboard', address: 'QA test - safe to delete', city: CITY, state: 'Lagos', status: 'unavailable' });
  // unowned (imported by our team), owned by an owner with hidden rates, and one with no rate
  for (const [key, owner] of [['unowned', null], ['owned', state.users.O.id], ['norate', null]]) {
    const b = must(await admin.from('boards').insert({ ...base(key), owner_id: owner }).select('id').single(), `board ${key}`);
    state.boards[key] = b.id;
    if (key !== 'norate') must(await admin.from('board_rates').upsert({ board_id: b.id, gross_monthly_rate: 1_500_000 }), `rate ${key}`);
    save(state);
  }
  console.log('setup done');
}

async function as(u) {
  const c = createClient(SUPABASE_URL, ANON, { auth: { persistSession: false } });
  must(await c.auth.signInWithPassword({ email: u.email, password: u.password }), 'signIn');
  return c;
}

async function verify() {
  const state = JSON.parse(readFileSync(stateFile, 'utf8'));
  const { unowned, owned, norate } = state.boards;
  const out = [];
  const check = (name, ok, detail = '') => out.push({ result: ok ? 'PASS' : 'FAIL', check: name, detail: String(detail).slice(0, 90) });
  const anon = createClient(SUPABASE_URL, ANON, { auth: { persistSession: false } });
  const adm = await as(state.users.ADM), o = await as(state.users.O);
  const guide = async (c, ids) => {
    const { data, error } = await c.rpc('board_guide_prices', { p_board_ids: ids });
    if (error) throw new Error(error.message);
    return Object.fromEntries((data ?? []).map(r => [r.board_id, r]));
  };

  let g = await guide(anon, [unowned, owned, norate]);
  check('visitor sees a range on an imported board', !!g[unowned], JSON.stringify(g[unowned]));
  check('range is rounded, not the exact rate', g[unowned] && Number(g[unowned].low) === 1_300_000 && Number(g[unowned].high) === 1_700_000, JSON.stringify(g[unowned]));
  check('owner with hidden rates: no range', !g[owned], JSON.stringify(g[owned]));
  check('board with no rate: no range', !g[norate]);

  let r = await anon.from('board_rates').select('gross_monthly_rate').eq('board_id', unowned);
  check('visitor still cannot read the exact rate', !r.error && r.data.length === 0, r.error?.message ?? JSON.stringify(r.data));

  r = await o.from('board_guide_price_hidden').insert({ board_id: unowned });
  check('non-admin cannot hide a guide price', !!r.error, r.error?.message ?? 'allowed');
  r = await anon.from('board_guide_price_hidden').select('board_id');
  check('visitor cannot list hidden boards', !r.error ? r.data.length === 0 : true, r.error?.message ?? r.data.length);

  r = await adm.from('board_guide_price_hidden').insert({ board_id: unowned });
  check('admin can hide a guide price', !r.error, r.error?.message);
  g = await guide(anon, [unowned]);
  check('hidden board shows no range', !g[unowned]);
  r = await adm.from('board_guide_price_hidden').delete().eq('board_id', unowned);
  g = await guide(anon, [unowned]);
  check('admin can show it again', !r.error && !!g[unowned], r.error?.message);

  must(await admin.from('profiles').update({ default_rate_visibility: 'all_verified_agencies' }).eq('id', state.users.O.id), 'owner opens rates');
  g = await guide(anon, [owned]);
  check('owner who opens rates gets a range', !!g[owned], JSON.stringify(g[owned]));

  console.table(out);
  const failed = out.filter(x => x.result === 'FAIL').length;
  console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
  process.exitCode = failed ? 1 : 0;
}

async function cleanup() {
  if (!existsSync(stateFile)) { console.log('no state file'); return; }
  const state = JSON.parse(readFileSync(stateFile, 'utf8'));
  await admin.from('boards').delete().like('name', `[${TAG}]%`);
  for (const u of Object.values(state.users)) await admin.auth.admin.deleteUser(u.id);
  rmSync(stateFile);
  console.log('cleanup done');
}

({ setup, verify, cleanup }[stage] ?? (() => { console.log('usage: setup | verify | cleanup <state-file>'); }))().catch(e => { console.error(e.message); process.exitCode = 1; });
