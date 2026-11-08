// Verifies "Request this location" (043) with throwaway accounts: two buyers
// (A, X), an owner with two boards in the same city (O), an admin (ADM), and
// one board with no owner account.
//
//   node scripts/verify-board-requests.mjs setup   <state-file>
//   node scripts/verify-board-requests.mjs verify  <state-file>
//   node scripts/verify-board-requests.mjs cleanup <state-file>
//
// Reads Supabase keys from .env.local. Test boards use a made-up city and
// status 'unavailable'. Generated passwords go to the state file (keep it
// outside the repo), never to stdout.
import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split(/\r?\n/).filter(l => /^[A-Z_]+=/.test(l)).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
);
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL, ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY, SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
const [stage, stateFile = '.board-requests-state.json'] = process.argv.slice(2);
const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });
const TAG = 'qa-breq';
const CITY = 'ZZ QA Breq City';

const must = ({ data, error }, what) => { if (error) throw new Error(`${what}: ${error.message}`); return data; };
const save = state => writeFileSync(stateFile, JSON.stringify(state, null, 2));
const inDays = n => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

async function setup() {
  const state = { users: {}, boards: {} };
  for (const [key, role] of [['A', 'agency'], ['X', 'agency'], ['O', 'owner'], ['ADM', 'admin']]) {
    const email = `${TAG}-${key.toLowerCase()}-${randomBytes(3).toString('hex')}@example.com`;
    const password = randomBytes(18).toString('base64url');
    const { user } = must(await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { role: role === 'admin' ? 'agency' : role, full_name: `QA Breq ${key}` } }), 'createUser');
    must(await admin.from('profiles').update({ role, company_name: `QA Breq ${key} Ltd` }).eq('id', user.id), 'profile');
    state.users[key] = { id: user.id, email, password, role };
    save(state);
  }
  for (const [key, owner] of [['own', state.users.O.id], ['ownTwin', state.users.O.id], ['unowned', null]]) {
    const b = must(await admin.from('boards').insert({ name: `[${TAG}] ${key}`, format: 'billboard', address: 'QA test - safe to delete', city: CITY, state: 'Lagos', status: 'unavailable', owner_id: owner }).select('id').single(), 'board');
    state.boards[key] = b.id;
    save(state);
  }
  console.log('setup done: buyers A and X, owner O (2 boards), admin ADM, 1 unowned board');
}

async function as(u) {
  const c = createClient(SUPABASE_URL, ANON, { auth: { persistSession: false } });
  must(await c.auth.signInWithPassword({ email: u.email, password: u.password }), 'signIn');
  return c;
}

async function verify() {
  const state = JSON.parse(readFileSync(stateFile, 'utf8'));
  const { A, X, O, ADM } = state.users;
  const B = state.boards;
  const out = [];
  const check = (name, ok, detail = '') => out.push({ result: ok ? 'PASS' : 'FAIL', check: name, detail: String(detail ?? '').slice(0, 90) });
  const stageOf = async id => must(await admin.from('availability_requests').select('stage, status').eq('id', id).single(), 'stage read');

  const a = await as(A), x = await as(X), o = await as(O), adm = await as(ADM);
  const anon = createClient(SUPABASE_URL, ANON, { auth: { persistSession: false } });
  const args = (board, extra = {}) => ({
    p_board_id: board, p_start: inDays(30), p_end: inDays(120),
    p_name: 'QA Buyer', p_company: 'QA Breq A Ltd', p_email: 'qa-buyer@example.com', p_phone: '08000000000',
    p_message: `[${TAG}] need this for a launch`, p_budget: 4000000, p_sites: 1, p_extra: 'printing included', ...extra,
  });

  // ── Who can send ──
  let r = await anon.rpc('send_board_request', args(B.own));
  check('logged-out visitor cannot send a request', !!r.error, r.error?.message ?? 'sent');
  r = await o.rpc('send_board_request', args(B.own));
  check('owner account cannot send a request', !!r.error, r.error?.message ?? 'sent');
  r = await a.rpc('send_board_request', args(B.own, { p_phone: '' }));
  check('missing phone rejected', !!r.error, r.error?.message ?? 'sent');
  r = await a.rpc('send_board_request', args(B.own, { p_start: inDays(-3) }));
  check('start date in the past rejected', !!r.error, r.error?.message ?? 'sent');

  r = await a.rpc('send_board_request', args(B.own));
  check('buyer can request a board', !r.error && !!r.data, r.error?.message);
  const reqOwn = r.data;
  r = await a.rpc('send_board_request', args(B.own));
  check('second open request for the same board rejected', !!r.error, r.error?.message ?? 'sent');

  // ── Routing ──
  const recips = must(await admin.from('availability_request_recipients').select('owner_id, board_count').eq('request_id', reqOwn), 'recipients');
  check('request goes to the board owner only', recips.length === 1 && recips[0].owner_id === O.id && recips[0].board_count === 1, JSON.stringify(recips));
  const ownerNote = must(await admin.from('notifications').select('id').eq('recipient_user_id', O.id).like('title', `%[${TAG}] own%`), 'owner notifications');
  check('owner is notified', ownerNote.length === 1, `${ownerNote.length}`);
  const admNotes = must(await adm.from('notifications').select('title, body').like('title', `%[${TAG}] own%`), 'admin notifications');
  check('admins are notified', admNotes.length >= 1, admNotes.map(n => n.body).join(' | '));

  // ── Who can see what ──
  check('owner can see the request', ((await o.from('availability_requests').select('id').eq('id', reqOwn)).data ?? []).length === 1);
  check('owner cannot see the buyer\'s email/phone', ((await o.from('availability_request_contacts').select('email').eq('request_id', reqOwn)).data ?? []).length === 0);
  const aContact = (await a.from('availability_request_contacts').select('email, phone').eq('request_id', reqOwn)).data ?? [];
  check('buyer can see own contact details', aContact.length === 1 && aContact[0].email === 'qa-buyer@example.com', JSON.stringify(aContact));
  check('admin can see contact details', ((await adm.from('availability_request_contacts').select('email').eq('request_id', reqOwn)).data ?? []).length === 1);
  check('another buyer sees neither request nor contacts',
    ((await x.from('availability_requests').select('id').eq('id', reqOwn)).data ?? []).length === 0
    && ((await x.from('availability_request_contacts').select('email').eq('request_id', reqOwn)).data ?? []).length === 0);

  // ── Owner reply drives the stage ──
  r = await o.from('availability_responses').insert({ request_id: reqOwn, owner_id: O.id, board_id: B.ownTwin, available: true, quoted_rate: 3000000 });
  check('owner cannot answer for a different board in the same city', !!r.error, r.error?.message ?? 'inserted');
  r = await o.from('availability_responses').insert({ request_id: reqOwn, owner_id: O.id, board_id: B.own, available: true, quoted_rate: 4500000, note: 'QA quote' });
  check('owner can quote for the requested board', !r.error, r.error?.message);
  check('stage → quote_received', (await stageOf(reqOwn)).stage === 'quote_received');
  const seen = (await a.from('availability_responses').select('quoted_rate').eq('request_id', reqOwn)).data ?? [];
  check('buyer sees the quote', seen.length === 1 && Number(seen[0].quoted_rate) === 4500000, JSON.stringify(seen));

  // ── Buyer can't skip stages or edit ──
  r = await a.from('availability_requests').update({ stage: 'confirmed' }).eq('id', reqOwn);
  check('buyer cannot mark a request confirmed', !!r.error && (await stageOf(reqOwn)).stage === 'quote_received', r.error?.message ?? 'updated');
  r = await a.from('availability_requests').update({ end_date: inDays(400) }).eq('id', reqOwn);
  check('buyer cannot edit a sent request', !!r.error, r.error?.message ?? 'updated');
  r = await adm.from('availability_requests').update({ stage: 'booking_in_progress' }).eq('id', reqOwn);
  check('admin can move a request to booking in progress', !r.error && (await stageOf(reqOwn)).stage === 'booking_in_progress', r.error?.message);
  r = await o.from('availability_responses').update({ available: false }).eq('request_id', reqOwn).eq('board_id', B.own);
  check('a later owner edit does not drag an advanced request backwards', (await stageOf(reqOwn)).stage === 'booking_in_progress', r.error?.message ?? (await stageOf(reqOwn)).stage);

  // ── Board with no owner account ──
  r = await a.rpc('send_board_request', args(B.unowned));
  const reqUnowned = r.data;
  check('buyer can request an unowned board', !r.error && !!reqUnowned, r.error?.message);
  const noRecips = must(await admin.from('availability_request_recipients').select('id').eq('request_id', reqUnowned), 'recipients 2');
  check('unowned board: nobody but admins is notified', noRecips.length === 0, `${noRecips.length} recipients`);
  const callNote = must(await adm.from('notifications').select('body').like('title', `%[${TAG}] unowned%`), 'admin call note');
  check('admin is told the owner needs a call', callNote.some(n => /needs a call/.test(n.body ?? '')), callNote.map(n => n.body).join(' | '));

  r = await a.from('availability_requests').update({ stage: 'cancelled' }).eq('id', reqUnowned);
  const cancelled = await stageOf(reqUnowned);
  check('buyer can cancel; request closes', !r.error && cancelled.stage === 'cancelled' && cancelled.status === 'closed', r.error?.message ?? JSON.stringify(cancelled));
  r = await a.from('availability_requests').update({ stage: 'requested' }).eq('id', reqUnowned);
  check('buyer cannot reopen a cancelled request', !!r.error, r.error?.message ?? 'updated');

  // ── Broadcast requests still behave as before ──
  r = await a.rpc('send_availability_request', { p_title: `[${TAG}] broadcast`, p_cities: [CITY], p_formats: ['billboard'], p_start: inDays(30), p_end: inDays(60), p_budget: null, p_notes: null });
  const bc = r.data ? must(await admin.from('availability_request_recipients').select('owner_id, board_count').eq('request_id', r.data), 'broadcast recips') : [];
  check('city-wide request still reaches both of the owner\'s boards', !r.error && bc.length === 1 && bc[0].board_count === 2, r.error?.message ?? JSON.stringify(bc));

  console.table(out);
  const failed = out.filter(c => c.result === 'FAIL').length;
  console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
  process.exitCode = failed ? 1 : 0;
}

async function cleanup() {
  if (!existsSync(stateFile)) { console.log('no state file'); return; }
  const state = JSON.parse(readFileSync(stateFile, 'utf8'));
  await admin.from('notifications').delete().like('title', `%[${TAG}]%`);
  await admin.from('availability_requests').delete().in('agency_id', Object.values(state.users).map(u => u.id));
  await admin.from('boards').delete().like('name', `[${TAG}]%`);
  for (const u of Object.values(state.users)) await admin.auth.admin.deleteUser(u.id);
  rmSync(stateFile);
  console.log('cleanup done');
}

({ setup, verify, cleanup }[stage] ?? (() => { console.log('usage: setup | verify | cleanup <state-file>'); }))().catch(e => { console.error(e.message); process.exitCode = 1; });
