// Verifies funnel tracking and numbers (054) with throwaway data: an admin
// (ADM), a buyer (B) and one test board. Counts are checked as the change
// before vs after, since the funnel is platform-wide.
//
//   node scripts/verify-funnel.mjs setup   <state-file>
//   node scripts/verify-funnel.mjs verify  <state-file>
//   node scripts/verify-funnel.mjs cleanup <state-file>
//
// Reads Supabase keys from .env.local. Test events use visitor ids starting
// "qafunnel" and are deleted on cleanup, with the test board and accounts.
import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split(/\r?\n/).filter(l => /^[A-Z_]+=/.test(l)).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
);
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL, ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY, SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
const [stage, stateFile = '.funnel-state.json'] = process.argv.slice(2);
const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });
const TAG = 'qa-funnel';

const must = ({ data, error }, what) => { if (error) throw new Error(`${what}: ${error.message}`); return data; };
const save = state => writeFileSync(stateFile, JSON.stringify(state, null, 2));

async function setup() {
  const state = { users: {} };
  for (const [k, role] of [['ADM', 'admin'], ['B', 'agency']]) {
    const email = `${TAG}-${k.toLowerCase()}-${randomBytes(3).toString('hex')}@example.com`;
    const password = randomBytes(18).toString('base64url');
    const { user } = must(await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { role: role === 'admin' ? 'agency' : role, full_name: `QA ${k}` } }), 'createUser');
    must(await admin.from('profiles').update({ role, company_name: `QA Funnel ${k}` }).eq('id', user.id), 'profile');
    state.users[k] = { id: user.id, email, password };
    save(state);
  }
  const b = must(await admin.from('boards').insert({ name: `[${TAG}] board`, format: 'billboard', address: 'QA test - safe to delete', city: 'ZZ QA Funnel City', state: 'Lagos', status: 'unavailable' }).select('id').single(), 'board');
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
  const v1 = 'qafunnel' + randomBytes(8).toString('hex'), v2 = 'qafunnel' + randomBytes(8).toString('hex'), vAdm = 'qafunnel' + randomBytes(8).toString('hex');
  const funnel = async () => must(await adm.rpc('admin_funnel', { p_days: 7 }), 'admin_funnel');

  const before = await funnel();
  check('admin can read the funnel', before?.now && before?.prev && Array.isArray(before?.weeks) && before.weeks.length === 12, JSON.stringify(Object.keys(before ?? {})));

  let r = await anon.rpc('track_event', { p_event: 'board_view', p_visitor: v1, p_board: state.board });
  check('visitor can record a board view', !r.error, r.error?.message);
  await anon.rpc('track_event', { p_event: 'board_view', p_visitor: v1, p_board: state.board });
  await anon.rpc('track_event', { p_event: 'board_view', p_visitor: v2, p_board: state.board });
  await anon.rpc('track_event', { p_event: 'shortlist_add', p_visitor: v1, p_board: state.board });
  await B.rpc('track_event', { p_event: 'request_open', p_visitor: v1, p_board: state.board });
  await adm.rpc('track_event', { p_event: 'board_view', p_visitor: vAdm, p_board: state.board });
  r = await anon.rpc('track_event', { p_event: 'hack', p_visitor: v1, p_board: null });
  check('unknown event is ignored quietly', !r.error, r.error?.message);
  r = await anon.rpc('track_event', { p_event: 'board_view', p_visitor: "x'; drop", p_board: null });
  check('bad visitor id is ignored quietly', !r.error, r.error?.message);

  const rows = must(await admin.from('funnel_events').select('event, visitor').like('visitor', 'qafunnel%'), 'rows');
  check('same view twice in a day counts once', rows.filter(x => x.visitor === v1 && x.event === 'board_view').length === 1, rows.length);
  check("our team's own views are not counted", !rows.some(x => x.visitor === vAdm));
  check('unknown events never stored', !rows.some(x => x.event === 'hack'));

  r = await anon.from('funnel_events').select('id').limit(1);
  check('visitor cannot read events', !!r.error || r.data.length === 0, r.error?.message ?? r.data.length);
  r = await B.from('funnel_events').select('id').limit(1);
  check('buyer cannot read events', !r.error && r.data.length === 0, r.error?.message ?? r.data.length);
  r = await B.rpc('admin_funnel', { p_days: 7 });
  check('buyer cannot read the funnel', !!r.error, r.error?.message ?? 'allowed');
  r = await anon.rpc('funnel_window', { p_from: new Date(0).toISOString(), p_to: new Date().toISOString() });
  check('visitor cannot call the inner counter', !!r.error, r.error?.message ?? 'allowed');

  const start = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10), end = new Date(Date.now() + 37 * 864e5).toISOString().slice(0, 10);
  must(await B.rpc('send_board_request', { p_board_id: state.board, p_start: start, p_end: end, p_name: 'QA', p_company: 'QA Funnel Co', p_email: 'qa@example.com', p_phone: '08000000000', p_message: 'QA', p_budget: null, p_sites: 1, p_extra: '' }), 'request');

  const after = await funnel();
  const d = k => after.now[k] - before.now[k];
  check('viewed +2 (two visitors)', d('viewed') === 2, d('viewed'));
  check('saved +1', d('saved') === 1, d('saved'));
  check('started a request +1', d('started') === 1, d('started'));
  check('requests +1 and buyers +1', d('requests') === 1 && d('buyers') === 1, `${d('requests')} / ${d('buyers')}`);
  const wk = after.weeks.at(-1).requests - before.weeks.at(-1).requests;
  check("this week's bar +1", wk === 1, wk);

  console.table(out);
  const failed = out.filter(x => x.result === 'FAIL').length;
  console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
  process.exitCode = failed ? 1 : 0;
}

async function cleanup() {
  if (!existsSync(stateFile)) { console.log('no state file'); return; }
  const state = JSON.parse(readFileSync(stateFile, 'utf8'));
  const userIds = Object.values(state.users).map(u => u.id);
  await admin.from('funnel_events').delete().like('visitor', 'qafunnel%');
  await admin.from('availability_requests').delete().in('agency_id', userIds);
  await admin.from('notifications').delete().like('title', `%[${TAG}]%`);
  await admin.from('notifications').delete().like('body', '%QA Funnel%');
  await admin.from('notifications').delete().in('recipient_user_id', userIds);
  await admin.from('boards').delete().like('name', `[${TAG}]%`);
  for (const id of userIds) await admin.auth.admin.deleteUser(id);
  rmSync(stateFile);
  console.log('cleanup done');
}

({ setup, verify, cleanup }[stage] ?? (() => { console.log('usage: setup | verify | cleanup <state-file>'); }))().catch(e => { console.error(e.message); process.exitCode = 1; });
