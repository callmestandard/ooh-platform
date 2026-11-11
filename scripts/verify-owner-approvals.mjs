// Verifies owner approval (050) with throwaway accounts: an owner (O), a
// second owner (P), an agency (A) and an admin (ADM).
//
//   node scripts/verify-owner-approvals.mjs setup   <state-file>
//   node scripts/verify-owner-approvals.mjs verify  <state-file> [app-url]
//   node scripts/verify-owner-approvals.mjs cleanup <state-file>
//
// Pass an app URL (e.g. http://localhost:3000) to also check /api/import-boards.
// Reads Supabase keys from .env.local. Test boards use a made-up city and
// status 'unavailable'. Passwords go to the state file (keep it outside the
// repo), never to stdout.
import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split(/\r?\n/).filter(l => /^[A-Z_]+=/.test(l)).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
);
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL, ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY, SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
const [stage, stateFile = '.owner-approval-state.json', appUrl] = process.argv.slice(2);
const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });
const TAG = 'qa-approve';
const CITY = 'ZZ QA Approve City';

const must = ({ data, error }, what) => { if (error) throw new Error(`${what}: ${error.message}`); return data; };
const save = state => writeFileSync(stateFile, JSON.stringify(state, null, 2));

async function setup() {
  const state = { users: {} };
  for (const [key, role] of [['O', 'owner'], ['P', 'owner'], ['A', 'agency'], ['ADM', 'admin']]) {
    const email = `${TAG}-${key.toLowerCase()}-${randomBytes(3).toString('hex')}@example.com`;
    const password = randomBytes(18).toString('base64url');
    const { user } = must(await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { role: role === 'admin' ? 'agency' : role, full_name: `QA Approve ${key}` } }), 'createUser');
    must(await admin.from('profiles').update({ role, company_name: `QA Approve ${key}` }).eq('id', user.id), 'profile');
    state.users[key] = { id: user.id, email, password, role };
    save(state);
  }
  console.log('setup done: owners O and P, agency A, admin ADM');
}

async function as(u) {
  const c = createClient(SUPABASE_URL, ANON, { auth: { persistSession: false } });
  const { session } = must(await c.auth.signInWithPassword({ email: u.email, password: u.password }), 'signIn');
  c.qaToken = session.access_token;
  return c;
}

async function verify() {
  const state = JSON.parse(readFileSync(stateFile, 'utf8'));
  const { O, P, A, ADM } = state.users;
  const out = [];
  const check = (name, ok, detail = '') => out.push({ result: ok ? 'PASS' : 'FAIL', check: name, detail: String(detail).slice(0, 90) });
  const base = key => ({ name: `[${TAG}] ${key}`, format: 'billboard', address: 'QA test - safe to delete', city: CITY, state: 'Lagos', status: 'unavailable' });
  const status = async id => (must(await admin.from('boards').select('verification_status').eq('id', id).single(), 'read')).verification_status;

  const o = await as(O), p = await as(P), a = await as(A), adm = await as(ADM);

  // ── Unapproved owner ──
  let r = await o.from('boards').insert({ ...base('o-before'), owner_id: O.id }).select('id').single();
  check('unapproved owner can still add a board', !r.error, r.error?.message);
  const before = r.data?.id;
  if (before) check('unapproved owner\'s board starts pending', await status(before) === 'pending', await status(before));

  if (appUrl) {
    const res = await fetch(`${appUrl}/api/import-boards`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${o.qaToken}` },
      body: JSON.stringify({ rows: [{ ...base('o-import-before'), asking_rate: null }] }),
    });
    check('importer accepts the unapproved owner', res.ok, `HTTP ${res.status}`);
    const { data } = await admin.from('boards').select('verification_status').eq('name', `[${TAG}] o-import-before`).maybeSingle();
    check('unapproved owner\'s import starts pending', data?.verification_status === 'pending', data?.verification_status);
  }

  // ── Nobody but an admin can approve ──
  r = await o.rpc('set_owner_approval', { p_owner: O.id, p_approved: true });
  check('owner cannot approve themselves', !!r.error, r.error?.message ?? 'allowed');
  r = await a.rpc('set_owner_approval', { p_owner: O.id, p_approved: true });
  check('agency cannot approve an owner', !!r.error, r.error?.message ?? 'allowed');
  r = await o.from('owner_approvals').insert({ owner_id: O.id });
  check('owner cannot write the approvals table', !!r.error, r.error?.message ?? 'allowed');
  r = await adm.rpc('set_owner_approval', { p_owner: A.id, p_approved: true });
  check('admin cannot approve a non-owner account', !!r.error, r.error?.message ?? 'allowed');

  // ── Admin approves O ──
  r = await adm.rpc('set_owner_approval', { p_owner: O.id, p_approved: true });
  check('admin can approve an owner', !r.error, r.error?.message);
  if (before) check('approval upgrades their pending boards', await status(before) === 'partner_verified', await status(before));

  r = await o.from('boards').insert({ ...base('o-after'), owner_id: O.id }).select('id').single();
  const after = r.data?.id;
  if (after) check('approved owner\'s new board is partner verified', await status(after) === 'partner_verified', await status(after));
  else check('approved owner can add a board', false, r.error?.message);

  if (appUrl) {
    const res = await fetch(`${appUrl}/api/import-boards`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${o.qaToken}` },
      body: JSON.stringify({ rows: [{ ...base('o-import-after'), asking_rate: null }] }),
    });
    const { data } = await admin.from('boards').select('verification_status').eq('name', `[${TAG}] o-import-after`).maybeSingle();
    check('approved owner\'s import is partner verified', res.ok && data?.verification_status === 'partner_verified', `HTTP ${res.status} ${data?.verification_status}`);
  }

  // ── Who can see approvals ──
  r = await o.from('owner_approvals').select('owner_id').eq('owner_id', O.id);
  check('owner can see their own approval', !r.error && r.data?.length === 1, r.error?.message ?? r.data?.length);
  r = await p.from('owner_approvals').select('owner_id');
  check('another owner cannot see it', !r.error && r.data?.length === 0, r.error?.message ?? r.data?.length);

  // ── Unapproved owner P still pending; removing O's approval reverts ──
  r = await p.from('boards').insert({ ...base('p-board'), owner_id: P.id }).select('id').single();
  if (r.data?.id) check('other unapproved owner still pending', await status(r.data.id) === 'pending', await status(r.data.id));

  r = await adm.rpc('set_owner_approval', { p_owner: O.id, p_approved: false });
  check('admin can remove an approval', !r.error, r.error?.message);
  if (after) check('removing approval returns boards to pending', await status(after) === 'pending', await status(after));

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
