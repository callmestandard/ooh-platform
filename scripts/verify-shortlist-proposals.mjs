// Verifies multi-board requests and proposal links (052) with throwaway data:
// two buyers (B, B2), an owner (O), and four test boards.
//
//   node scripts/verify-shortlist-proposals.mjs setup   <state-file>
//   node scripts/verify-shortlist-proposals.mjs verify  <state-file>
//   node scripts/verify-shortlist-proposals.mjs cleanup <state-file>
//
// Reads Supabase keys from .env.local. Test boards use a made-up city and
// status 'unavailable'. Passwords go to the state file, never to stdout.
import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split(/\r?\n/).filter(l => /^[A-Z_]+=/.test(l)).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
);
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL, ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY, SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
const [stage, stateFile = '.shortlist-state.json'] = process.argv.slice(2);
const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });
const TAG = 'qa-shortlist';
const CITY = 'ZZ QA Shortlist City';
const COMPANY = 'QA Shortlist';

const must = ({ data, error }, what) => { if (error) throw new Error(`${what}: ${error.message}`); return data; };
const save = state => writeFileSync(stateFile, JSON.stringify(state, null, 2));

async function setup() {
  const state = { users: {}, boards: [] };
  for (const [key, role] of [['B', 'agency'], ['B2', 'agency'], ['O', 'owner']]) {
    const email = `${TAG}-${key.toLowerCase()}-${randomBytes(3).toString('hex')}@example.com`;
    const password = randomBytes(18).toString('base64url');
    const { user } = must(await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { role, full_name: `QA ${key}` } }), 'createUser');
    must(await admin.from('profiles').update({ role, company_name: `${COMPANY} ${key}` }).eq('id', user.id), 'profile');
    state.users[key] = { id: user.id, email, password };
    save(state);
  }
  for (let i = 1; i <= 4; i++) {
    const b = must(await admin.from('boards').insert({
      name: `[${TAG}] Board ${i}`, format: 'billboard', address: 'QA test - safe to delete', city: CITY, state: 'Lagos',
      status: 'unavailable', owner_id: i === 1 ? state.users.O.id : null,
    }).select('id').single(), `board ${i}`);
    state.boards.push(b.id);
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
  const [b1, b2, b3, b4] = state.boards;
  const out = [];
  const check = (name, ok, detail = '') => out.push({ result: ok ? 'PASS' : 'FAIL', check: name, detail: String(detail ?? '').slice(0, 90) });
  const anon = createClient(SUPABASE_URL, ANON, { auth: { persistSession: false } });
  const B = await as(state.users.B), B2 = await as(state.users.B2), O = await as(state.users.O);
  const start = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
  const end = new Date(Date.now() + 37 * 864e5).toISOString().slice(0, 10);
  const req = ids => ({ p_board_ids: ids, p_start: start, p_end: end, p_name: 'QA Buyer', p_company: `${COMPANY} B`, p_email: 'qa-buyer@example.com', p_phone: '08000000000', p_message: 'QA launch', p_budget: null, p_extra: '' });

  // ── Several boards in one request ──
  let r = await anon.rpc('send_board_requests', req([b1, b2]));
  check('visitor cannot send requests', !!r.error, r.error?.message ?? 'allowed');
  r = await O.rpc('send_board_requests', req([b1, b2]));
  check('owner account cannot send requests', !!r.error, r.error?.message ?? 'allowed');
  r = await B.rpc('send_board_requests', req(Array.from({ length: 16 }, () => randomUUID())));
  check('more than 15 boards is refused', !!r.error, r.error?.message ?? 'allowed');

  r = await B.rpc('send_board_requests', req([b1, b2, b3, b1]));
  const first = r.data ?? {};
  check('buyer requests 3 boards (duplicate ignored)', !r.error && first.ids?.length === 3, r.error?.message ?? JSON.stringify(first.ids));
  const rows = must(await admin.from('availability_requests').select('id, board_id, request_group, notes, stage').in('id', first.ids ?? []), 'rows');
  check('all 3 share one group', rows.length === 3 && rows.every(x => x.request_group && x.request_group === first.group), JSON.stringify(rows.map(x => x.request_group)));
  check('owners are told it is part of a set', rows.every(x => (x.notes ?? '').includes('Part of a request for 3 boards')), rows[0]?.notes);
  const recip = must(await admin.from('availability_request_recipients').select('owner_id, request_id').in('request_id', first.ids ?? []), 'recipients');
  check('board with an owner is routed to that owner', recip.length === 1 && recip[0].owner_id === state.users.O.id, JSON.stringify(recip));

  r = await B.rpc('send_board_requests', req([b1, b4]));
  check('already-open board is skipped, new one sent', !r.error && r.data?.ids?.length === 1 && r.data?.skipped?.length === 1 && r.data?.group == null, r.error?.message ?? JSON.stringify(r.data));
  r = await B2.from('availability_requests').select('id').in('id', first.ids ?? []);
  check("another buyer cannot see these requests", !r.error && r.data.length === 0, r.error?.message ?? r.data.length);

  // ── Proposals ──
  r = await B.from('proposals').insert({ created_by: state.users.B.id, title: 'QA proposal', client_name: 'QA Client', note: 'Hello', board_ids: [b1, b2], show_prices: true }).select('id, token').single();
  const prop = r.data;
  check('buyer creates a proposal', !r.error && prop?.token?.length >= 32, r.error?.message ?? prop?.token?.length);
  r = await O.from('proposals').insert({ created_by: state.users.O.id, title: 'x', board_ids: [b1] });
  check('owner cannot create a proposal', !!r.error, r.error?.message ?? 'allowed');
  r = await B2.from('proposals').insert({ created_by: state.users.B.id, title: 'x', board_ids: [b1] });
  check('cannot create a proposal as someone else', !!r.error, r.error?.message ?? 'allowed');
  r = await B2.from('proposals').select('id').eq('id', prop?.id);
  check('another buyer cannot list it', !r.error && r.data.length === 0, r.error?.message ?? r.data.length);
  r = await anon.from('proposals').select('id');
  check('visitor cannot list proposals', !!r.error || r.data.length === 0, r.error?.message ?? r.data.length);

  r = await anon.rpc('get_proposal', { p_token: prop?.token });
  check('visitor with the link sees it', !r.error && r.data?.title === 'QA proposal' && r.data?.board_ids?.length === 2, r.error?.message ?? JSON.stringify(r.data)?.slice(0, 80));
  check('shows who prepared it', r.data?.prepared_by === `${COMPANY} B`, r.data?.prepared_by);
  check('does not reveal the buyer id or email', r.data && !JSON.stringify(r.data).includes(state.users.B.id) && !JSON.stringify(r.data).includes(state.users.B.email));
  r = await anon.rpc('get_proposal', { p_token: 'wrong-token-wrong-token' });
  check('wrong link shows nothing', !r.error && r.data == null, r.error?.message ?? JSON.stringify(r.data));
  r = await anon.rpc('get_proposal', { p_token: prop?.token?.slice(0, 8) });
  check('short token prefix shows nothing', !r.error && r.data == null, JSON.stringify(r.data)?.slice(0, 40));

  await anon.rpc('record_proposal_open', { p_token: prop?.token });
  await B.rpc('record_proposal_open', { p_token: prop?.token });
  const opened = must(await admin.from('proposals').select('open_count').eq('id', prop?.id).single(), 'open_count');
  check("client's open counted, buyer's own open not", opened.open_count === 1, opened.open_count);

  r = await B2.from('proposals').delete().eq('id', prop?.id).select('id');
  check('another buyer cannot delete it', !r.error && r.data.length === 0, r.error?.message ?? r.data.length);
  r = await B.from('proposals').delete().eq('id', prop?.id).select('id');
  check('buyer can delete it', !r.error && r.data.length === 1, r.error?.message ?? r.data.length);
  r = await anon.rpc('get_proposal', { p_token: prop?.token });
  check('deleted link shows nothing', !r.error && r.data == null);

  console.table(out);
  const failed = out.filter(x => x.result === 'FAIL').length;
  console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
  process.exitCode = failed ? 1 : 0;
}

async function cleanup() {
  if (!existsSync(stateFile)) { console.log('no state file'); return; }
  const state = JSON.parse(readFileSync(stateFile, 'utf8'));
  const userIds = Object.values(state.users).map(u => u.id);
  await admin.from('availability_requests').delete().in('agency_id', userIds);
  await admin.from('notifications').delete().like('body', `%${COMPANY}%`);
  await admin.from('notifications').delete().in('recipient_user_id', userIds);
  await admin.from('boards').delete().like('name', `[${TAG}]%`);
  for (const id of userIds) await admin.auth.admin.deleteUser(id);
  rmSync(stateFile);
  console.log('cleanup done');
}

({ setup, verify, cleanup }[stage] ?? (() => { console.log('usage: setup | verify | cleanup <state-file>'); }))().catch(e => { console.error(e.message); process.exitCode = 1; });
