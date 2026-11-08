// Verifies quote → negotiation → accepted for board requests (044) with
// throwaway accounts: buyers A and X, an owner O with four boards, an admin.
//
//   node scripts/verify-board-request-deals.mjs setup   <state-file>
//   node scripts/verify-board-request-deals.mjs verify  <state-file>
//   node scripts/verify-board-request-deals.mjs cleanup <state-file>
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
const [stage, stateFile = '.board-deals-state.json'] = process.argv.slice(2);
const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });
const TAG = 'qa-deal';
const CITY = 'ZZ QA Deal City';

const must = ({ data, error }, what) => { if (error) throw new Error(`${what}: ${error.message}`); return data; };
const save = state => writeFileSync(stateFile, JSON.stringify(state, null, 2));
const inDays = n => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

async function setup() {
  const state = { users: {}, boards: {} };
  for (const [key, role] of [['A', 'agency'], ['X', 'agency'], ['O', 'owner'], ['ADM', 'admin']]) {
    const email = `${TAG}-${key.toLowerCase()}-${randomBytes(3).toString('hex')}@example.com`;
    const password = randomBytes(18).toString('base64url');
    const { user } = must(await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { role: role === 'admin' ? 'agency' : role, full_name: `QA Deal ${key}` } }), 'createUser');
    must(await admin.from('profiles').update({ role, company_name: `QA Deal ${key} Ltd` }).eq('id', user.id), 'profile');
    state.users[key] = { id: user.id, email, password, role };
    save(state);
  }
  for (const key of ['negotiate', 'direct', 'noprice', 'declined']) {
    const b = must(await admin.from('boards').insert({ name: `[${TAG}] ${key}`, format: 'billboard', address: 'QA test - safe to delete', city: CITY, state: 'Lagos', status: 'unavailable', owner_id: state.users.O.id }).select('id').single(), 'board');
    state.boards[key] = b.id;
    save(state);
  }
  console.log('setup done: buyers A and X, owner O (4 boards), admin ADM');
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
  const reqRow = async id => must(await admin.from('availability_requests').select('stage, status').eq('id', id).single(), 'request read');
  const bookingRow = async id => must(await admin.from('bookings').select('status, offered_rate, agreed_rate, campaign_id').eq('id', id).single(), 'booking read');

  const a = await as(A), x = await as(X), o = await as(O), adm = await as(ADM);
  const request = async board => must(await a.rpc('send_board_request', {
    p_board_id: board, p_start: inDays(30), p_end: inDays(120), p_name: 'QA Buyer', p_company: 'QA Deal A Ltd',
    p_email: 'qa-deal-buyer@example.com', p_phone: '08000000000', p_message: `[${TAG}] test`, p_budget: null, p_sites: 1, p_extra: null,
  }), 'send_board_request');
  const reply = (req, board, fields) => o.from('availability_responses').insert({ request_id: req, owner_id: O.id, board_id: board, ...fields });

  // ── Quote details ──
  const rNeg = await request(B.negotiate);
  let r = await a.rpc('answer_board_quote', { p_request_id: rNeg, p_accept: false });
  check('buyer cannot answer before the owner replies', !!r.error, r.error?.message ?? 'answered');
  r = await reply(rNeg, B.negotiate, { available: true, quoted_rate: 5000000, available_from: inDays(60), available_to: inDays(30) });
  check('owner period with from after to is rejected', !!r.error, r.error?.message ?? 'inserted');
  r = await reply(rNeg, B.negotiate, { available: true, quoted_rate: 5000000, available_from: inDays(35), available_to: inDays(120), conditions: 'printing not included', note: 'QA quote' });
  check('owner can quote with a period and conditions', !r.error, r.error?.message);
  const seen = (await a.from('availability_responses').select('available_from, conditions').eq('request_id', rNeg)).data ?? [];
  check('buyer sees the period and conditions', seen.length === 1 && seen[0].conditions === 'printing not included' && !!seen[0].available_from, JSON.stringify(seen));

  // ── Negotiate ──
  r = await x.rpc('answer_board_quote', { p_request_id: rNeg, p_accept: false });
  check('another buyer cannot answer the quote', !!r.error, r.error?.message ?? 'answered');
  r = await o.rpc('answer_board_quote', { p_request_id: rNeg, p_accept: true });
  check('the owner cannot accept on the buyer\'s behalf', !!r.error, r.error?.message ?? 'answered');

  r = await a.rpc('answer_board_quote', { p_request_id: rNeg, p_accept: false });
  const bNeg = r.data;
  check('buyer can choose Negotiate', !r.error && !!bNeg, r.error?.message);
  check('stage → negotiating', (await reqRow(rNeg)).stage === 'negotiating');
  const bk = await bookingRow(bNeg);
  check('booking opened at the quoted rate', bk.status === 'negotiating' && Number(bk.offered_rate) === 5000000, JSON.stringify(bk));
  const camp = must(await admin.from('campaigns').select('agency_id, request_id').eq('id', bk.campaign_id).single(), 'campaign');
  check('booking sits on a hidden campaign tied to the request', camp.agency_id === A.id && camp.request_id === rNeg, JSON.stringify(camp));
  const visible = (await a.from('campaigns').select('id').eq('agency_id', A.id).is('request_id', null)).data ?? [];
  check('campaign lists (request_id IS NULL) skip it', !visible.some(c => c.id === bk.campaign_id), `${visible.length} listed`);
  const opening = (await a.from('messages').select('sender_role, message_type, content').eq('booking_id', bNeg)).data ?? [];
  check('thread opens with the owner\'s quote and conditions', opening.length === 1 && opening[0].sender_role === 'owner' && /Conditions: printing not included/.test(opening[0].content), opening[0]?.content);
  const linked = must(await admin.from('availability_responses').select('accepted_booking_id').eq('request_id', rNeg).single(), 'response');
  check('owner reply is linked to the booking', linked.accepted_booking_id === bNeg);
  const ownerPing = must(await admin.from('notifications').select('title').eq('recipient_user_id', O.id).eq('link', `/dashboard/owner/negotiations/${bNeg}`), 'owner ping');
  check('owner is told the buyer wants to discuss', ownerPing.some(n => /discuss/.test(n.title)), ownerPing.map(n => n.title).join(' | '));
  r = await a.rpc('answer_board_quote', { p_request_id: rNeg, p_accept: false });
  check('pressing Negotiate again reopens the same thread', r.data === bNeg, r.error?.message ?? r.data);

  // ── Who sees the deal ──
  check('owner sees the booking and the thread',
    ((await o.from('bookings').select('id').eq('id', bNeg)).data ?? []).length === 1
    && ((await o.from('messages').select('id').eq('booking_id', bNeg)).data ?? []).length >= 1);
  const who = (await o.rpc('booking_buyer', { p_booking_id: bNeg })).data ?? [];
  check('owner can look up the buyer on the deal', who.length === 1 && who[0].buyer_id === A.id && who[0].request_id === rNeg, JSON.stringify(who));
  check('another buyer sees neither the deal nor its buyer',
    ((await x.from('bookings').select('id').eq('id', bNeg)).data ?? []).length === 0
    && ((await x.from('messages').select('id').eq('booking_id', bNeg)).data ?? []).length === 0
    && ((await x.rpc('booking_buyer', { p_booking_id: bNeg })).data ?? []).length === 0);

  // ── Owner counters, buyer accepts ──
  must(await o.from('messages').insert({ booking_id: bNeg, sender_role: 'owner', message_type: 'counter_offer', content: 'QA counter', offered_rate: 4500000 }), 'owner counter msg');
  must(await o.from('bookings').update({ offered_rate: 4500000, status: 'negotiating' }).eq('id', bNeg), 'owner counter');
  r = await a.rpc('answer_board_quote', { p_request_id: rNeg, p_accept: true });
  const after = await bookingRow(bNeg);
  check('buyer accepts the latest offer', !r.error && after.status === 'agreed' && Number(after.agreed_rate) === 4500000, r.error?.message ?? JSON.stringify(after));
  check('stage → accepted', (await reqRow(rNeg)).stage === 'accepted');
  const admNote = (await adm.from('notifications').select('title, body').like('title', `%[${TAG}] negotiate%`)).data ?? [];
  check('admins are alerted to complete the booking', admNote.some(n => /Deal agreed/.test(n.title) && /4,500,000/.test(n.body ?? '')), admNote.map(n => n.title).join(' | '));
  check('the alert is not visible to the buyer', ((await a.from('notifications').select('id').like('title', `%Deal agreed%[${TAG}]%`)).data ?? []).length === 0);
  r = await a.from('availability_requests').update({ stage: 'cancelled' }).eq('id', rNeg);
  check('buyer cannot cancel after accepting', !!r.error && (await reqRow(rNeg)).stage === 'accepted', r.error?.message ?? 'cancelled');
  r = await a.rpc('answer_board_quote', { p_request_id: rNeg, p_accept: true });
  check('accepting twice is refused', !!r.error, r.error?.message ?? 'accepted again');

  // ── Accept straight away ──
  const rDir = await request(B.direct);
  must(await reply(rDir, B.direct, { available: true, quoted_rate: 3000000 }), 'direct reply');
  r = await a.rpc('answer_board_quote', { p_request_id: rDir, p_accept: true });
  const dir = r.data ? await bookingRow(r.data) : null;
  check('buyer can accept a quote straight away', !r.error && dir?.status === 'agreed' && Number(dir?.agreed_rate) === 3000000 && (await reqRow(rDir)).stage === 'accepted', r.error?.message ?? JSON.stringify(dir));

  // ── No price yet → negotiate, then withdraw ──
  const rNo = await request(B.noprice);
  must(await reply(rNo, B.noprice, { available: true, quoted_rate: null }), 'no-price reply');
  r = await a.rpc('answer_board_quote', { p_request_id: rNo, p_accept: true });
  check('cannot accept when there is no price', !!r.error, r.error?.message ?? 'accepted');
  r = await a.rpc('answer_board_quote', { p_request_id: rNo, p_accept: false });
  const bNo = r.data;
  check('can ask the owner for a price', !r.error && !!bNo, r.error?.message);
  r = await a.from('availability_requests').update({ stage: 'cancelled' }).eq('id', rNo);
  const wd = await reqRow(rNo);
  check('buyer can withdraw while negotiating', !r.error && wd.stage === 'cancelled' && wd.status === 'closed', r.error?.message ?? JSON.stringify(wd));
  check('withdrawing closes the thread', (await bookingRow(bNo)).status === 'declined');
  const wdNote = must(await admin.from('notifications').select('title').eq('recipient_user_id', O.id).eq('link', `/dashboard/owner/negotiations/${bNo}`), 'withdraw note');
  check('owner is told the buyer withdrew', wdNote.some(n => /withdrew/.test(n.title)), wdNote.map(n => n.title).join(' | '));

  // ── Owner declines in the thread ──
  const rDec = await request(B.declined);
  must(await reply(rDec, B.declined, { available: true, quoted_rate: 2000000 }), 'decline reply');
  const bDec = must(await a.rpc('answer_board_quote', { p_request_id: rDec, p_accept: false }), 'negotiate');
  must(await o.from('bookings').update({ status: 'declined' }).eq('id', bDec), 'owner decline');
  const dec = await reqRow(rDec);
  check('owner declining marks the request unavailable', dec.stage === 'unavailable' && dec.status === 'closed', JSON.stringify(dec));

  console.table(out);
  const failed = out.filter(c => c.result === 'FAIL').length;
  console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
  process.exitCode = failed ? 1 : 0;
}

async function cleanup() {
  if (!existsSync(stateFile)) { console.log('no state file'); return; }
  const state = JSON.parse(readFileSync(stateFile, 'utf8'));
  const ids = Object.values(state.users).map(u => u.id);
  await admin.from('notifications').delete().like('title', `%[${TAG}]%`);
  await admin.from('notifications').delete().like('body', `%[${TAG}]%`);
  await admin.from('notifications').delete().in('recipient_user_id', ids);
  await admin.from('campaigns').delete().in('agency_id', ids);
  await admin.from('availability_requests').delete().in('agency_id', ids);
  await admin.from('boards').delete().like('name', `[${TAG}]%`);
  for (const u of Object.values(state.users)) await admin.auth.admin.deleteUser(u.id);
  rmSync(stateFile);
  console.log('cleanup done');
}

({ setup, verify, cleanup }[stage] ?? (() => { console.log('usage: setup | verify | cleanup <state-file>'); }))().catch(e => { console.error(e.message); process.exitCode = 1; });
