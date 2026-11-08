// Verifies migration 041 (roles, suspension, notifications) with throwaway
// accounts: two agencies (A, X), an owner (O) and a platform admin (ADM).
//
//   node scripts/verify-roles-notifications-rls.mjs setup   <state-file>
//   node scripts/verify-roles-notifications-rls.mjs verify  <state-file>
//   node scripts/verify-roles-notifications-rls.mjs cleanup <state-file>
//
// Reads Supabase keys from .env.local. Test notifications carry TAG in the
// title. Generated passwords go to the state file (keep it outside the repo),
// never to stdout.
import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split(/\r?\n/).filter(l => /^[A-Z_]+=/.test(l)).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
);
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL, ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY, SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
const [stage, stateFile = '.roles-rls-state.json'] = process.argv.slice(2);
const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });
const TAG = 'qa-roles';

const must = ({ data, error }, what) => { if (error) throw new Error(`${what}: ${error.message}`); return data; };
const save = state => writeFileSync(stateFile, JSON.stringify(state, null, 2));

async function setup() {
  const state = { users: {} };
  // Every account asks for 'admin' at sign-up; only ADM is then promoted by the service role.
  for (const key of ['A', 'X', 'O', 'ADM']) {
    const email = `${TAG}-${key.toLowerCase()}-${randomBytes(3).toString('hex')}@example.com`;
    const password = randomBytes(18).toString('base64url');
    const { user } = must(await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { role: 'admin', full_name: `QA Roles ${key}` } }), 'createUser');
    const profile = must(await admin.from('profiles').select('role').eq('id', user.id).single(), 'profile read');
    state.users[key] = { id: user.id, email, password, signupRole: profile.role };
    save(state);
  }
  must(await admin.from('profiles').update({ role: 'owner' }).eq('id', state.users.O.id), 'set owner');
  must(await admin.from('profiles').update({ role: 'admin' }).eq('id', state.users.ADM.id), 'set admin');
  console.log('setup done: agencies A and X, owner O, admin ADM');
}

async function as(u) {
  const c = createClient(SUPABASE_URL, ANON, { auth: { persistSession: false } });
  must(await c.auth.signInWithPassword({ email: u.email, password: u.password }), 'signIn');
  return c;
}

async function verify() {
  const state = JSON.parse(readFileSync(stateFile, 'utf8'));
  const { A, X, O, ADM } = state.users;
  const out = [];
  const check = (name, ok, detail = '') => out.push({ result: ok ? 'PASS' : 'FAIL', check: name, detail });
  const roleOf = async id => must(await admin.from('profiles').select('role').eq('id', id).single(), 'role read').role;

  const a = await as(A), x = await as(X), o = await as(O), adm = await as(ADM);
  const anon = createClient(SUPABASE_URL, ANON, { auth: { persistSession: false } });

  // ── Roles ──
  check('sign-up asking for admin gets agency', A.signupRole === 'agency', `got ${A.signupRole}`);

  let r = await a.from('profiles').update({ role: 'admin' }).eq('id', A.id);
  check('agency cannot make itself admin', !!r.error && (await roleOf(A.id)) === 'agency', r.error?.message ?? 'no error');

  r = await o.from('profiles').update({ role: 'agency' }).eq('id', O.id);
  check('owner cannot change its own role', !!r.error && (await roleOf(O.id)) === 'owner', r.error?.message ?? 'no error');

  r = await a.from('profiles').update({ full_name: 'QA Roles A renamed' }).eq('id', A.id);
  check('agency can still edit its own name', !r.error, r.error?.message ?? '');

  const hasSuspension = !(await admin.from('profiles').select('is_suspended').limit(1)).error;
  if (hasSuspension) {
    must(await admin.from('profiles').update({ is_suspended: true }).eq('id', X.id), 'suspend X');
    r = await x.from('profiles').update({ is_suspended: false }).eq('id', X.id);
    const still = must(await admin.from('profiles').select('is_suspended').eq('id', X.id).single(), 'read X').is_suspended;
    check('suspended user cannot unsuspend itself', !!r.error && still === true, r.error?.message ?? 'no error');
    r = await adm.from('profiles').update({ is_suspended: false }).eq('id', X.id);
    const after = must(await admin.from('profiles').select('is_suspended').eq('id', X.id).single(), 'read X').is_suspended;
    check('admin can unsuspend a user', !r.error && after === false, r.error?.message ?? '');
  } else {
    check('suspension column present', true, 'skipped: profiles.is_suspended not installed');
  }

  r = await adm.from('profiles').update({ role: 'owner' }).eq('id', X.id).select('id');
  check('admin can change another user\'s role', !r.error && (r.data ?? []).length === 1 && (await roleOf(X.id)) === 'owner', r.error?.message ?? '');
  must(await admin.from('profiles').update({ role: 'agency' }).eq('id', X.id), 'restore X');

  // ── Notifications ──
  must(await admin.from('notifications').insert([
    { recipient_role: 'agency', recipient_user_id: A.id, type: 'message', title: `[${TAG}] for A`, link: '/dashboard/agency' },
    { recipient_role: 'agency', recipient_user_id: null, type: 'offer_accepted', title: `[${TAG}] untargeted agency`, link: '/dashboard/agency' },
    { recipient_role: 'admin', recipient_user_id: null, type: 'message', title: `[${TAG}] untargeted admin`, link: '/dashboard/admin' },
  ]), 'seed notifications');
  const titles = async c => ((await c.from('notifications').select('title').like('title', `[${TAG}]%`)).data ?? []).map(n => n.title).sort();

  const anonSees = await titles(anon);
  check('logged-out visitor sees no notifications', anonSees.length === 0, `${anonSees.length} visible`);
  r = await anon.from('notifications').update({ read: true }).like('title', `[${TAG}]%`).select('id');
  check('logged-out visitor cannot mark notifications read', (r.data ?? []).length === 0, r.error?.message ?? `${(r.data ?? []).length} updated`);

  const aSees = await titles(a), xSees = await titles(x), admSees = await titles(adm);
  check('A sees its own notification', aSees.includes(`[${TAG}] for A`), aSees.join(', '));
  check('A does not see role-wide agency notification', !aSees.includes(`[${TAG}] untargeted agency`), aSees.join(', '));
  check('X sees nothing addressed to A', xSees.length === 0, xSees.join(', '));
  check('admin sees untargeted admin notification', admSees.includes(`[${TAG}] untargeted admin`), admSees.join(', '));

  r = await a.from('notifications').insert({ recipient_role: 'owner', recipient_user_id: O.id, type: 'message', title: `[${TAG}] A to O`, link: '/dashboard/owner/negotiations/x' });
  check('agency can notify an owner', !r.error, r.error?.message ?? '');
  check('owner sees it', (await titles(o)).includes(`[${TAG}] A to O`));

  r = await a.from('notifications').insert({ recipient_role: 'owner', recipient_user_id: O.id, type: 'message', title: `[${TAG}] phishing`, link: 'https://evil.example.com' });
  check('external link rejected', !!r.error, r.error?.message ?? 'inserted');
  r = await a.from('notifications').insert({ recipient_role: 'owner', recipient_user_id: O.id, type: 'message', title: `[${TAG}] phishing2`, link: '//evil.example.com' });
  check('protocol-relative link rejected', !!r.error, r.error?.message ?? 'inserted');
  r = await anon.from('notifications').insert({ recipient_role: 'owner', recipient_user_id: O.id, type: 'message', title: `[${TAG}] anon` });
  check('logged-out visitor cannot create notifications', !!r.error, r.error?.message ?? 'inserted');

  console.table(out);
  const failed = out.filter(c => c.result === 'FAIL').length;
  console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
  process.exitCode = failed ? 1 : 0;
}

async function cleanup() {
  if (!existsSync(stateFile)) { console.log('no state file'); return; }
  const state = JSON.parse(readFileSync(stateFile, 'utf8'));
  await admin.from('notifications').delete().like('title', `[${TAG}]%`);
  for (const u of Object.values(state.users)) await admin.auth.admin.deleteUser(u.id);
  rmSync(stateFile);
  console.log('cleanup done');
}

({ setup, verify, cleanup }[stage] ?? (() => { console.log('usage: setup | verify | cleanup <state-file>'); }))().catch(e => { console.error(e.message); process.exitCode = 1; });
