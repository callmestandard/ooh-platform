// Verifies weekly owner reminders (055) with throwaway data: an admin (ADM),
// a buyer (B) and one named owner with a test board. No email is sent.
//
//   node scripts/verify-owner-reminders.mjs setup   <state-file>
//   node scripts/verify-owner-reminders.mjs verify  <state-file>
//   node scripts/verify-owner-reminders.mjs cleanup <state-file>
import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split(/\r?\n/).filter(l => /^[A-Z_]+=/.test(l)).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
);
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL, ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY, SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
const [stage, stateFile = '.owner-reminders-state.json'] = process.argv.slice(2);
const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });
const TAG = 'qa-reminder';
const OWNER = 'QA Reminder Owner';
const KEY = 'name:' + OWNER.toLowerCase();

const must = ({ data, error }, what) => { if (error) throw new Error(`${what}: ${error.message}`); return data; };
const save = state => writeFileSync(stateFile, JSON.stringify(state, null, 2));

async function setup() {
  const state = { users: {} };
  for (const [k, role] of [['ADM', 'admin'], ['B', 'agency']]) {
    const email = `${TAG}-${k.toLowerCase()}-${randomBytes(3).toString('hex')}@example.com`;
    const password = randomBytes(18).toString('base64url');
    const { user } = must(await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { role: role === 'admin' ? 'agency' : role, full_name: `QA ${k}` } }), 'createUser');
    must(await admin.from('profiles').update({ role }).eq('id', user.id), 'profile');
    state.users[k] = { id: user.id, email, password };
    save(state);
  }
  const b = must(await admin.from('boards').insert({ name: `[${TAG}] board`, format: 'billboard', address: 'QA test - safe to delete', city: 'ZZ QA Reminder City', state: 'Lagos', status: 'available' }).select('id').single(), 'board');
  must(await admin.from('board_owner_names').upsert({ board_id: b.id, owner_name: OWNER }), 'owner name');
  state.board = b.id;
  save(state);
  console.log('setup done');
}

async function as(u) {
  const c = createClient(SUPABASE_URL, ANON, { auth: { persistSession: false } });
  must(await c.auth.signInWithPassword({ email: u.email, password: u.password }), 'signIn');
  return c;
}

async function verify() {
  const state = JSON.parse(readFileSync(stateFile, 'utf8'));
  const out = [];
  const check = (name, ok, detail = '') => out.push({ result: ok ? 'PASS' : 'FAIL', check: name, detail: String(detail ?? '').slice(0, 90) });
  const anon = createClient(SUPABASE_URL, ANON, { auth: { persistSession: false } });
  const adm = await as(state.users.ADM), B = await as(state.users.B);
  const due = async () => must(await admin.rpc('owner_reminders_due', { p_owner_key: null }), 'due').filter(x => x.owner_key === KEY);

  let r = await B.rpc('admin_set_owner_email', { p_owner_key: KEY, p_owner_name: OWNER, p_email: 'x@example.com' });
  check('buyer cannot set an owner email', !!r.error, r.error?.message ?? 'allowed');
  r = await adm.rpc('admin_set_owner_email', { p_owner_key: KEY, p_owner_name: OWNER, p_email: 'not an email' });
  check('bad email is refused', !!r.error, r.error?.message ?? 'allowed');
  r = await adm.rpc('admin_set_owner_email', { p_owner_key: KEY, p_owner_name: OWNER, p_email: '  Owner@Example.com ' });
  check('admin sets an email', !r.error, r.error?.message);
  const link = must(await admin.from('owner_links').select('email, token').eq('owner_key', KEY).single(), 'link');
  check('email tidied and a link made', link.email === 'owner@example.com' && link.token?.length >= 32, JSON.stringify(link).slice(0, 80));

  r = await anon.rpc('owner_reminders_due', { p_owner_key: null });
  check('visitor cannot list who is due', !!r.error, r.error?.message ?? 'allowed');
  r = await adm.rpc('owner_reminders_due', { p_owner_key: null });
  check('even admins call it only through the server', !!r.error, r.error?.message ?? 'allowed');

  let d = await due();
  check('owner with an unconfirmed board is due', d.length === 1 && d[0].stale === 1 && d[0].email === 'owner@example.com', JSON.stringify(d));

  must(await admin.from('owner_links').update({ last_reminded_at: new Date().toISOString() }).eq('owner_key', KEY), 'mark sent');
  d = await due();
  check('not emailed twice in a week', d.length === 0, d.length);
  const forced = must(await admin.rpc('owner_reminders_due', { p_owner_key: KEY }), 'forced');
  check('"Email now" still works for that owner', forced.length === 1, forced.length);

  must(await admin.from('owner_links').update({ last_reminded_at: null }).eq('owner_key', KEY), 'reset');
  must(await admin.from('boards').update({ availability_checked_at: new Date().toISOString() }).eq('id', state.board), 'confirm');
  d = await due();
  check('owner who is up to date is skipped', d.length === 0, d.length);

  must(await admin.from('boards').update({ availability_checked_at: null }).eq('id', state.board), 'unconfirm');
  r = await adm.rpc('admin_set_owner_email', { p_owner_key: KEY, p_owner_name: OWNER, p_email: '' });
  d = await due();
  check('clearing the email stops reminders', !r.error && d.length === 0, r.error?.message ?? d.length);

  const ov = must(await adm.rpc('admin_owner_overview'), 'overview');
  const row = ov.find(x => x.owner_key === KEY);
  check('overview still works and shows the email column', row && 'email' in row && 'last_reminded_at' in row, JSON.stringify(row)?.slice(0, 80));

  console.table(out);
  const failed = out.filter(x => x.result === 'FAIL').length;
  console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
  process.exitCode = failed ? 1 : 0;
}

async function cleanup() {
  if (!existsSync(stateFile)) { console.log('no state file'); return; }
  const state = JSON.parse(readFileSync(stateFile, 'utf8'));
  await admin.from('owner_links').delete().eq('owner_key', KEY);
  await admin.from('boards').delete().like('name', `[${TAG}]%`);
  for (const u of Object.values(state.users)) await admin.auth.admin.deleteUser(u.id);
  rmSync(stateFile);
  console.log('cleanup done');
}

({ setup, verify, cleanup }[stage] ?? (() => { console.log('usage: setup | verify | cleanup <state-file>'); }))().catch(e => { console.error(e.message); process.exitCode = 1; });
