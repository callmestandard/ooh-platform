// Verifies the admin request console (045) with throwaway accounts: buyer A,
// owner O (one board), a second owner C who claims a board, an admin ADM,
// and two boards with no owner account.
//
//   node scripts/verify-admin-requests.mjs setup   <state-file>
//   node scripts/verify-admin-requests.mjs verify  <state-file>
//   node scripts/verify-admin-requests.mjs cleanup <state-file>
//
// Reads Supabase keys from .env.local. Generated passwords go to the state
// file (keep it outside the repo), never to stdout.
import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split(/\r?\n/).filter(l => /^[A-Z_]+=/.test(l)).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
);
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL, ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY, SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
const [stage, stateFile = '.admin-requests-state.json'] = process.argv.slice(2);
const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });
const TAG = 'qa-adm';
const CITY = 'ZZ QA Adm City';

const must = ({ data, error }, what) => { if (error) throw new Error(`${what}: ${error.message}`); return data; };
const save = state => writeFileSync(stateFile, JSON.stringify(state, null, 2));
const inDays = n => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

async function setup() {
  const state = { users: {}, boards: {} };
  for (const [key, role] of [['A', 'agency'], ['O', 'owner'], ['C', 'owner'], ['ADM', 'admin']]) {
    const email = `${TAG}-${key.toLowerCase()}-${randomBytes(3).toString('hex')}@example.com`;
    const password = randomBytes(18).toString('base64url');
    const { user } = must(await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { role: role === 'admin' ? 'agency' : role, full_name: `QA Adm ${key}` } }), 'createUser');
    must(await admin.from('profiles').update({ role, company_name: `QA Adm ${key} Ltd` }).eq('id', user.id), 'profile');
    state.users[key] = { id: user.id, email, password, role };
    save(state);
  }
  for (const [key, owner] of [['owned', state.users.O.id], ['unowned', null], ['claimable', null]]) {
    const b = must(await admin.from('boards').insert({ name: `[${TAG}] ${key}`, format: 'billboard', address: 'QA test - safe to delete', city: CITY, state: 'Lagos', status: 'unavailable', owner_id: owner, contact_phone: owner ? null : '08000000001' }).select('id').single(), 'board');
    state.boards[key] = b.id;
    save(state);
  }
  console.log('setup done: buyer A, owners O and C, admin ADM, 3 boards');
}

async function as(u) {
  const c = createClient(SUPABASE_URL, ANON, { auth: { persistSession: false } });
  must(await c.auth.signInWithPassword({ email: u.email, password: u.password }), 'signIn');
  return c;
}

async function verify() {
  const state = JSON.parse(readFileSync(stateFile, 'utf8'));
  const { A, O, C, ADM } = state.users;
  const B = state.boards;
  const out = [];
  const check = (name, ok, detail = '') => out.push({ result: ok ? 'PASS' : 'FAIL', check: name, detail: String(detail ?? '').slice(0, 90) });
  const reqRow = async id => must(await admin.from('availability_requests').select('stage, status').eq('id', id).single(), 'request read');
  const bookingStatus = async id => must(await admin.from('bookings').select('status').eq('id', id).single(), 'booking read').status;

  const a = await as(A), o = await as(O), c = await as(C), adm = await as(ADM);
  const request = async board => must(await a.rpc('send_board_request', {
    p_board_id: board, p_start: inDays(30), p_end: inDays(120), p_name: 'QA Buyer', p_company: 'QA Adm A Ltd',
    p_email: 'qa-adm-buyer@example.com', p_phone: '08000000000', p_message: `[${TAG}] test`, p_budget: null, p_sites: 1, p_extra: null,
  }), 'send_board_request');
  const answerArgs = (id, extra = {}) => ({ p_request_id: id, p_available: true, p_rate: 2500000, p_from: null, p_to: null, p_conditions: 'flighting extra', p_note: 'spoke to owner', ...extra });

  // ── Buyer can't rewrite the owner's quote ──
  const rOwned = await request(B.owned);
  must(await o.from('availability_responses').insert({ request_id: rOwned, owner_id: O.id, board_id: B.owned, available: true, quoted_rate: 4000000 }), 'owner reply');
  let r = await a.from('availability_responses').update({ quoted_rate: 1 }).eq('request_id', rOwned);
  const rate = must(await admin.from('availability_responses').select('quoted_rate').eq('request_id', rOwned).single(), 'rate').quoted_rate;
  check('buyer cannot rewrite the owner\'s price', !!r.error && Number(rate) === 4000000, r.error?.message ?? `rate now ${rate}`);
  r = await o.from('availability_responses').update({ quoted_rate: 3800000 }).eq('request_id', rOwned);
  check('owner can still edit their own reply', !r.error, r.error?.message);

  // ── Admin-only functions ──
  const rUn = await request(B.unowned);
  r = await a.rpc('admin_answer_board_request', answerArgs(rUn));
  check('a buyer cannot answer as the owner', !!r.error, r.error?.message ?? 'answered');
  r = await o.rpc('admin_answer_board_request', answerArgs(rUn));
  check('an owner cannot use the admin answer', !!r.error, r.error?.message ?? 'answered');
  r = await a.rpc('admin_set_request_stage', { p_request_id: rOwned, p_stage: 'confirmed', p_message: null });
  check('a buyer cannot move stages via the admin function', !!r.error, r.error?.message ?? 'moved');

  // ── Admin answers for an owner who isn't on the platform ──
  r = await adm.rpc('admin_answer_board_request', answerArgs(rUn));
  check('admin can answer for an owner not on the platform', !r.error, r.error?.message);
  check('stage → quote_received', (await reqRow(rUn)).stage === 'quote_received');
  const seen = (await a.from('availability_responses').select('quoted_rate, conditions, answered_by_admin').eq('request_id', rUn)).data ?? [];
  check('buyer sees the reply, marked as entered by our team', seen.length === 1 && Number(seen[0].quoted_rate) === 2500000 && seen[0].answered_by_admin === true, JSON.stringify(seen));
  const bn = must(await admin.from('notifications').select('title').eq('recipient_user_id', A.id).like('title', `Quote received for [${TAG}] unowned%`), 'buyer note');
  check('buyer is notified of the quote', bn.length === 1, `${bn.length}`);
  r = await adm.rpc('admin_answer_board_request', answerArgs(rUn, { p_rate: -5 }));
  check('admin answer rejects a negative price', !!r.error, r.error?.message ?? 'answered');

  // ── Negotiation where our team speaks for the owner ──
  const bUn = must(await a.rpc('answer_board_quote', { p_request_id: rUn, p_accept: false }), 'negotiate');
  r = await adm.rpc('admin_answer_board_request', answerArgs(rUn, { p_rate: 100 }));
  check('admin cannot change the reply once negotiating', !!r.error, r.error?.message ?? 'answered');
  r = await adm.from('messages').insert({ booking_id: bUn, sender_role: 'owner', message_type: 'counter_offer', content: 'QA counter', offered_rate: 2300000 });
  const r2 = await adm.from('bookings').update({ status: 'negotiating', offered_rate: 2300000 }).eq('id', bUn);
  check('admin can counter in the thread for the owner', !r.error && !r2.error, r.error?.message ?? r2.error?.message);
  r = await a.rpc('answer_board_quote', { p_request_id: rUn, p_accept: true });
  check('buyer accepts → accepted', !r.error && (await reqRow(rUn)).stage === 'accepted', r.error?.message);

  // ── Hand-off stages ──
  r = await adm.rpc('admin_set_request_stage', { p_request_id: rUn, p_stage: 'booking_in_progress', p_message: 'Invoice sent' });
  check('admin: accepted → booking in progress', !r.error && (await reqRow(rUn)).stage === 'booking_in_progress', r.error?.message);
  const ip = must(await admin.from('notifications').select('body').eq('recipient_user_id', A.id).like('title', 'Booking in progress%'), 'in-progress note');
  check('buyer is told, with the team\'s message', ip.some(n => n.body === 'Invoice sent'), JSON.stringify(ip));
  r = await adm.rpc('admin_set_request_stage', { p_request_id: rUn, p_stage: 'confirmed', p_message: null });
  const conf = await reqRow(rUn);
  check('admin: → confirmed, request closed', !r.error && conf.stage === 'confirmed' && conf.status === 'closed', r.error?.message ?? JSON.stringify(conf));
  check('confirming marks the booking signed', (await bookingStatus(bUn)) === 'signed');
  r = await adm.rpc('admin_set_request_stage', { p_request_id: rUn, p_stage: 'booking_in_progress', p_message: null });
  check('a confirmed request cannot go backwards', !!r.error, r.error?.message ?? 'moved');
  r = await adm.rpc('admin_set_request_stage', { p_request_id: rOwned, p_stage: 'booking_in_progress', p_message: null });
  check('cannot start a booking before the deal is accepted', !!r.error, r.error?.message ?? 'moved');

  // ── Admin closes a live negotiation on an owned board ──
  const bOwned = must(await a.rpc('answer_board_quote', { p_request_id: rOwned, p_accept: false }), 'negotiate owned');
  r = await adm.rpc('admin_set_request_stage', { p_request_id: rOwned, p_stage: 'cancelled', p_message: 'Board sold elsewhere' });
  check('admin can close a request; the thread closes', !r.error && (await reqRow(rOwned)).stage === 'cancelled' && (await bookingStatus(bOwned)) === 'declined', r.error?.message);
  const on = must(await admin.from('notifications').select('title').eq('recipient_user_id', O.id).eq('link', `/dashboard/owner/negotiations/${bOwned}`), 'owner notes');
  check('owner hears it was closed by our team, not "buyer withdrew"', on.some(n => /closed by our team/.test(n.title)) && !on.some(n => /withdrew/.test(n.title)), on.map(n => n.title).join(' | '));

  // ── Internal notes ──
  r = await adm.from('availability_request_admin_notes').upsert({ request_id: rOwned, notes: 'called owner twice' });
  check('admin can save internal notes', !r.error, r.error?.message);
  check('buyer and owner cannot read internal notes',
    ((await a.from('availability_request_admin_notes').select('notes').eq('request_id', rOwned)).data ?? []).length === 0
    && ((await o.from('availability_request_admin_notes').select('notes').eq('request_id', rOwned)).data ?? []).length === 0);
  r = await a.from('availability_request_admin_notes').insert({ request_id: rUn, notes: 'buyer note' });
  check('buyer cannot write internal notes', !!r.error, r.error?.message ?? 'inserted');
  const reqStar = await a.from('availability_requests').select('*').eq('id', rOwned);
  check('buyer can still read their request with select *', !reqStar.error && (reqStar.data ?? []).length === 1, reqStar.error?.message);

  // ── Board claims ──
  r = await c.from('board_claims').insert({ board_id: B.claimable });
  check('owner can claim an unowned board', !r.error, r.error?.message);
  const claim = must(await admin.from('board_claims').select('id').eq('board_id', B.claimable).single(), 'claim');
  r = await c.rpc('decide_board_claim', { p_claim_id: claim.id, p_approve: true });
  check('claimant cannot approve their own claim', !!r.error, r.error?.message ?? 'approved');
  r = await adm.rpc('decide_board_claim', { p_claim_id: claim.id, p_approve: true });
  const claimed = must(await admin.from('boards').select('owner_id, verification_status').eq('id', B.claimable).single(), 'claimed board');
  check('admin approval hands the board over, partner verified', !r.error && claimed.owner_id === C.id && claimed.verification_status === 'partner_verified', r.error?.message ?? JSON.stringify(claimed));

  console.table(out);
  const failed = out.filter(x => x.result === 'FAIL').length;
  console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
  process.exitCode = failed ? 1 : 0;
}

async function cleanup() {
  if (!existsSync(stateFile)) { console.log('no state file'); return; }
  const state = JSON.parse(readFileSync(stateFile, 'utf8'));
  const ids = Object.values(state.users).map(u => u.id);
  await admin.from('notifications').delete().like('title', `%[${TAG}]%`);
  await admin.from('notifications').delete().in('recipient_user_id', ids);
  await admin.from('campaigns').delete().in('agency_id', ids);
  await admin.from('availability_requests').delete().in('agency_id', ids);
  await admin.from('board_claims').delete().in('claimant_id', ids);
  await admin.from('boards').delete().like('name', `[${TAG}]%`);
  for (const u of Object.values(state.users)) await admin.auth.admin.deleteUser(u.id);
  rmSync(stateFile);
  console.log('cleanup done');
}

({ setup, verify, cleanup }[stage] ?? (() => { console.log('usage: setup | verify | cleanup <state-file>'); }))().catch(e => { console.error(e.message); process.exitCode = 1; });
