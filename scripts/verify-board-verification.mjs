// Verifies board verification (042) with throwaway accounts: an owner (O), a
// second owner who claims a board (C), an agency (A) and an admin (ADM).
//
//   node scripts/verify-board-verification.mjs setup   <state-file>
//   node scripts/verify-board-verification.mjs verify  <state-file> [app-url]
//   node scripts/verify-board-verification.mjs cleanup <state-file>
//
// Pass an app URL (e.g. http://localhost:3000) to also check that an agency
// is refused by /api/import-boards. Reads Supabase keys from .env.local. Test
// boards use a made-up city and status 'unavailable'. Generated passwords go
// to the state file (keep it outside the repo), never to stdout.
import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split(/\r?\n/).filter(l => /^[A-Z_]+=/.test(l)).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
);
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL, ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY, SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
const [stage, stateFile = '.verification-state.json', appUrl] = process.argv.slice(2);
const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });
const TAG = 'qa-verif';
const CITY = 'ZZ QA Verif City';

const must = ({ data, error }, what) => { if (error) throw new Error(`${what}: ${error.message}`); return data; };
const save = state => writeFileSync(stateFile, JSON.stringify(state, null, 2));

async function setup() {
  const state = { users: {}, boards: [] };
  for (const [key, role] of [['O', 'owner'], ['C', 'owner'], ['A', 'agency'], ['ADM', 'admin']]) {
    const email = `${TAG}-${key.toLowerCase()}-${randomBytes(3).toString('hex')}@example.com`;
    const password = randomBytes(18).toString('base64url');
    const { user } = must(await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { role: role === 'admin' ? 'agency' : role, full_name: `QA Verif ${key}` } }), 'createUser');
    must(await admin.from('profiles').update({ role, company_name: `QA Verif ${key}` }).eq('id', user.id), 'profile');
    state.users[key] = { id: user.id, email, password, role };
    save(state);
  }
  console.log('setup done: owners O and C, agency A, admin ADM');
}

async function as(u) {
  const c = createClient(SUPABASE_URL, ANON, { auth: { persistSession: false } });
  const { session } = must(await c.auth.signInWithPassword({ email: u.email, password: u.password }), 'signIn');
  c.qaToken = session.access_token;
  return c;
}

async function verify() {
  const state = JSON.parse(readFileSync(stateFile, 'utf8'));
  const { O, C, A, ADM } = state.users;
  const out = [];
  const check = (name, ok, detail = '') => out.push({ result: ok ? 'PASS' : 'FAIL', check: name, detail: String(detail).slice(0, 90) });
  const track = id => { if (id) { state.boards.push(id); save(state); } };
  const base = key => ({ name: `[${TAG}] ${key}`, format: 'billboard', address: 'QA test - safe to delete', city: CITY, state: 'Lagos', status: 'unavailable' });
  const read = async id => must(await admin.from('boards').select('verification_status, last_verified_at, source, illuminated, owner_id').eq('id', id).single(), 'read board');

  const o = await as(O), c = await as(C), a = await as(A), adm = await as(ADM);
  const anon = createClient(SUPABASE_URL, ANON, { auth: { persistSession: false } });

  // ── Owner adds their own board ──
  let r = await o.from('boards').insert({ ...base('owner-own'), owner_id: O.id, verification_status: 'verified', source: 'self-claimed', last_verified_at: '2020-01-01' }).select('id').single();
  check('owner can add a board', !r.error, r.error?.message);
  const ownBoard = r.data?.id; track(ownBoard);
  if (ownBoard) {
    const b = await read(ownBoard);
    check('owner\'s own board starts partner verified', b.verification_status === 'partner_verified', b.verification_status);
    check('owner cannot set source or backdate', b.source === null && b.last_verified_at && !b.last_verified_at.startsWith('2020'), `${b.source} ${b.last_verified_at}`);
    check('unknown illumination stays unknown', b.illuminated === null, b.illuminated);

    must(await admin.from('boards').update({ last_verified_at: '2021-06-01T00:00:00Z' }).eq('id', ownBoard), 'age board');
    r = await o.from('boards').update({ verification_status: 'pending', name: `[${TAG}] owner-own renamed` }).eq('id', ownBoard);
    const after = await read(ownBoard);
    check('owner cannot change verification status', !r.error && after.verification_status === 'partner_verified', r.error?.message ?? after.verification_status);
    check('owner editing re-confirms last verified date', after.last_verified_at && !after.last_verified_at.startsWith('2021'), after.last_verified_at);
  }

  // ── Agency adds a board (no owner on the platform) ──
  r = await a.from('boards').insert({ ...base('agency-registered'), owner_id: null, verification_status: 'partner_verified' }).select('id').single();
  const agencyBoard = r.data?.id; track(agencyBoard);
  if (r.error) check('agency board insert', false, r.error.message);
  else check('agency-added board starts pending', (await read(agencyBoard)).verification_status === 'pending');

  // ── Admin verifies ──
  const unowned = must(await admin.from('boards').insert({ ...base('deck-import'), owner_id: null, source: 'QA deck' }).select('id').single(), 'seed unowned').id;
  track(unowned);
  check('seeded deck board starts pending', (await read(unowned)).verification_status === 'pending');
  r = await adm.from('boards').update({ verification_status: 'verified' }).eq('id', unowned).select('verification_status, last_verified_at').single();
  check('admin can mark a board verified, date stamped', !r.error && r.data?.verification_status === 'verified' && !!r.data?.last_verified_at, r.error?.message ?? JSON.stringify(r.data));
  r = await o.from('boards').update({ verification_status: 'pending' }).eq('id', unowned).select('id');
  check('another owner cannot touch it', (await read(unowned)).verification_status === 'verified', r.error?.message ?? `${(r.data ?? []).length} updated`);

  // ── Claim approval makes it partner verified ──
  const claimable = must(await admin.from('boards').insert({ ...base('claimable'), owner_id: null }).select('id').single(), 'seed claimable').id;
  track(claimable);
  r = await c.from('board_claims').insert({ board_id: claimable }).select('id').single();
  check('owner can claim an unowned board', !r.error, r.error?.message);
  if (r.data) {
    const d = await adm.rpc('decide_board_claim', { p_claim_id: r.data.id, p_approve: true });
    const b = await read(claimable);
    check('approved claim → partner verified', !d.error && b.owner_id === C.id && b.verification_status === 'partner_verified' && !!b.last_verified_at, d.error?.message ?? b.verification_status);
  }

  // ── Public can read the status ──
  r = await anon.from('boards').select('id, verification_status, last_verified_at, area').eq('id', unowned).maybeSingle();
  check('logged-out visitor can read verification status', !r.error && r.data?.verification_status === 'verified', r.error?.message ?? JSON.stringify(r.data));

  // ── Importer refuses agencies ──
  if (appUrl) {
    const res = await fetch(`${appUrl}/api/import-boards`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${a.qaToken}` },
      body: JSON.stringify({ rows: [{ ...base('agency-import'), asking_rate: null }] }),
    });
    check('agency cannot use the board importer', res.status === 403, `HTTP ${res.status}`);
  }

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

({ setup, verify, cleanup }[stage] ?? (() => { console.log('usage: setup | verify | cleanup <state-file> [app-url]'); }))().catch(e => { console.error(e.message); process.exitCode = 1; });
