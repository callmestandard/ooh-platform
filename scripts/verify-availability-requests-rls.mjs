// Verifies availability requests (034) and proposal open-tracking (033) with
// throwaway accounts: the requesting agency (A), an unrelated agency (X) and
// two board owners (O1, O2).
//
//   node scripts/verify-availability-requests-rls.mjs setup   <state-file>
//   node scripts/verify-availability-requests-rls.mjs verify  <state-file> [app-url]
//   node scripts/verify-availability-requests-rls.mjs cleanup <state-file>
//
// Pass an app URL (e.g. http://localhost:3000) to also exercise the
// /api/report/[id]/view route. Reads Supabase keys from .env.local. Test
// boards use a made-up city and status 'unavailable'. Generated passwords go
// to the state file (keep it outside the repo), never to stdout.
import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split(/\r?\n/).filter(l => /^[A-Z_]+=/.test(l)).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
);
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL, ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY, SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
const [stage, stateFile = '.avail-rls-state.json', appUrl] = process.argv.slice(2);
const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });
const TAG = 'qa-avail';
const CITY = 'ZZ QA Avail City';

const must = ({ data, error }, what) => { if (error) throw new Error(`${what}: ${error.message}`); return data; };
const save = state => writeFileSync(stateFile, JSON.stringify(state, null, 2));

async function setup() {
  const state = { users: {}, boards: {} };
  for (const [key, role] of [['A', 'agency'], ['X', 'agency'], ['O1', 'owner'], ['O2', 'owner']]) {
    const email = `${TAG}-${key.toLowerCase()}-${randomBytes(3).toString('hex')}@example.com`;
    const password = randomBytes(18).toString('base64url');
    const name = `QA Avail ${role} ${key}`;
    const { user } = must(await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { role, full_name: name } }), 'createUser');
    state.users[key] = { id: user.id, email, password, role };
    save(state);
    must(await admin.from('profiles').upsert({ id: user.id, role, full_name: name, company_name: name }), 'profile');
  }
  const { A, O1, O2 } = state.users;
  const boards = [
    ['o1Billboard', 'billboard', CITY, O1.id],          // matches
    ['o1Unipole', 'unipole', CITY, O1.id],              // wrong format
    ['o1ElsewhereBillboard', 'billboard', 'ZZ QA Other City', O1.id], // wrong city
    ['o2Billboard', 'billboard', CITY, O2.id],          // matches
    ['unownedBillboard', 'billboard', CITY, null],      // matches, nobody to ask
  ];
  for (const [key, format, city, owner_id] of boards) {
    const b = must(await admin.from('boards').insert({ name: `[${TAG}] ${key}`, format, address: 'QA test - safe to delete', city, state: 'Lagos', asking_rate: 300000, status: 'unavailable', owner_id, contact_phone: '0800 000 0000' }).select('id').single(), 'board');
    state.boards[key] = b.id;
    save(state);
  }
  const campaign = must(await admin.from('campaigns').insert({ agency_id: A.id, name: `[${TAG}] campaign`, status: 'draft' }).select('id').single(), 'campaign');
  state.campaignId = campaign.id;
  save(state);
  console.log('setup done: agency A, outside agency X, owners O1 and O2; 5 boards, 1 campaign');
}

async function as(u) {
  const c = createClient(SUPABASE_URL, ANON, { auth: { persistSession: false } });
  const { session } = must(await c.auth.signInWithPassword({ email: u.email, password: u.password }), 'signIn');
  c.qaToken = session.access_token;
  return c;
}

async function verify() {
  const state = JSON.parse(readFileSync(stateFile, 'utf8'));
  const { A, X, O1, O2 } = state.users;
  const B = state.boards;
  const out = [];
  const check = (name, expect, ok, detail) => out.push({ result: ok ? 'PASS' : 'FAIL', check: `${name} [expect ${expect}]`, detail });
  const describe = r => r.error ? `rejected: ${r.error.message}` : `${Array.isArray(r.data) ? r.data.length + ' row(s)' : JSON.stringify(r.data)}`;
  const one = r => !r.error && (r.data ?? []).length === 1;

  const a = await as(A), x = await as(X), o1 = await as(O1), o2 = await as(O2);
  const anon = createClient(SUPABASE_URL, ANON, { auth: { persistSession: false } });
  const args = { p_title: `[${TAG}] request`, p_cities: [CITY.toLowerCase()], p_formats: ['billboard'], p_start: '2027-01-01', p_end: '2027-03-31', p_budget: 5000000, p_notes: 'QA' };

  // ── Sending ──
  const ownerSend = await o1.rpc('send_availability_request', args);
  check('owner O1 sends an availability request', 'deny', !!ownerSend.error, describe(ownerSend));
  const anonSend = await anon.rpc('send_availability_request', args);
  check('anonymous visitor sends an availability request', 'deny', !!anonSend.error, describe(anonSend));
  const directReq = await a.from('availability_requests').insert({ agency_id: A.id, title: 'direct', cities: [CITY], start_date: '2027-01-01', end_date: '2027-01-02' }).select('id');
  check('A inserts a request row directly, bypassing the send function', 'deny', !!directReq.error, describe(directReq));

  const sent = await a.rpc('send_availability_request', args);
  check('A sends a request (billboards in the test city)', 'allow', !sent.error && !!sent.data, sent.error ? describe(sent) : 'request created');
  const reqId = sent.data;
  state.requestId = reqId;
  save(state);

  const recips = must(await admin.from('availability_request_recipients').select('owner_id, board_count').eq('request_id', reqId), 'recips');
  const byOwner = Object.fromEntries(recips.map(r => [r.owner_id, r.board_count]));
  check('fan-out reached exactly O1 (1 matching board) and O2 (1 matching board)', 'allow', recips.length === 2 && byOwner[O1.id] === 1 && byOwner[O2.id] === 1, `${recips.length} recipients, board counts ${JSON.stringify(Object.values(byOwner))}`);
  const notifs = must(await admin.from('notifications').select('recipient_user_id').eq('type', 'availability_request').in('recipient_user_id', [O1.id, O2.id]), 'notifs');
  check('each recipient owner got a notification', 'allow', notifs.length === 2, `${notifs.length} notifications`);

  const forgedRecip = await a.from('availability_request_recipients').insert({ request_id: reqId, owner_id: X.id }).select('id');
  check('A adds an arbitrary recipient directly', 'deny', !!forgedRecip.error, describe(forgedRecip));

  // ── Who can see the request and its recipients ──
  const seeReq = async cl => must(await cl.from('availability_requests').select('id').eq('id', reqId), 'req').length;
  check('A reads its request', 'allow', (await seeReq(a)) === 1, `${await seeReq(a)} row(s)`);
  check('O1 (recipient) reads the request', 'allow', (await seeReq(o1)) === 1, `${await seeReq(o1)} row(s)`);
  check('X (unrelated agency) reads the request', 'deny', (await seeReq(x)) === 0, `${await seeReq(x)} row(s)`);
  check('anonymous visitor reads the request', 'deny', (await seeReq(anon)) === 0, `${await seeReq(anon)} row(s)`);
  const seeRecips = async cl => must(await cl.from('availability_request_recipients').select('owner_id').eq('request_id', reqId), 'recips').map(r => r.owner_id);
  check('A sees both recipients', 'allow', (await seeRecips(a)).length === 2, `${(await seeRecips(a)).length} row(s)`);
  const o1Recips = await seeRecips(o1);
  check('O1 sees only its own recipient row, not that O2 was asked', 'deny', o1Recips.length === 1 && o1Recips[0] === O1.id, `${o1Recips.length} row(s)`);
  check('X sees no recipients', 'deny', (await seeRecips(x)).length === 0, `${(await seeRecips(x)).length} row(s)`);

  // ── Boards with nobody to ask ──
  const unreachedA = await a.rpc('availability_request_unreached_boards', { p_request_id: reqId });
  check('A is told which matching board has no owner account', 'allow', !unreachedA.error && unreachedA.data.length === 1 && unreachedA.data[0].board_id === B.unownedBillboard, describe(unreachedA));
  const unreachedX = await x.rpc('availability_request_unreached_boards', { p_request_id: reqId });
  check('X asks for the unreached boards of A\'s request', 'deny', !unreachedX.error && unreachedX.data.length === 0, describe(unreachedX));

  // ── Responding ──
  const respond = (cl, ownerId, boardId, extra = {}) => cl.from('availability_responses').insert({ request_id: reqId, owner_id: ownerId, board_id: boardId, available: true, quoted_rate: 250000, ...extra }).select('*');
  const r1 = await respond(o1, O1.id, B.o1Billboard, { accepted_booking_id: null, note: 'O1 quote' });
  check('O1 answers for its own matching board', 'allow', one(r1), describe(r1));
  const r1other = await respond(o1, O1.id, B.o2Billboard);
  check('O1 answers for O2\'s board', 'deny', !one(r1other), describe(r1other));
  const r1wrongFormat = await respond(o1, O1.id, B.o1Unipole);
  check('O1 answers for its own board that does not match the request (wrong format)', 'deny', !one(r1wrongFormat), describe(r1wrongFormat));
  const r1wrongCity = await respond(o1, O1.id, B.o1ElsewhereBillboard);
  check('O1 answers for its own board in another city', 'deny', !one(r1wrongCity), describe(r1wrongCity));
  const forged = await respond(o1, O2.id, B.o2Billboard);
  check('O1 answers in O2\'s name', 'deny', !one(forged), describe(forged));
  const xResp = await respond(x, X.id, B.o2Billboard);
  check('X (not a recipient) answers', 'deny', !one(xResp), describe(xResp));
  const aResp = await respond(a, A.id, B.o2Billboard);
  check('A answers its own request on an owner\'s behalf', 'deny', !one(aResp), describe(aResp));
  const r2 = await respond(o2, O2.id, B.o2Billboard, { quoted_rate: 410000, note: 'O2 quote' });
  check('O2 answers for its own matching board', 'allow', one(r2), describe(r2));

  // ── Who can see the quotes ──
  const quotes = async cl => must(await cl.from('availability_responses').select('owner_id, quoted_rate').eq('request_id', reqId), 'quotes');
  const aQuotes = await quotes(a);
  check('A reads both quotes', 'allow', aQuotes.length === 2, `${aQuotes.length} row(s), rates ${aQuotes.map(q => q.quoted_rate).sort().join(', ')}`);
  const o1Quotes = await quotes(o1);
  check('O1 reads only its own quote, not O2\'s', 'deny', o1Quotes.length === 1 && o1Quotes[0].owner_id === O1.id, `${o1Quotes.length} row(s)`);
  const o2Quotes = await quotes(o2);
  check('O2 reads only its own quote, not O1\'s', 'deny', o2Quotes.length === 1 && o2Quotes[0].owner_id === O2.id, `${o2Quotes.length} row(s)`);
  check('X reads any quote', 'deny', (await quotes(x)).length === 0, `${(await quotes(x)).length} row(s)`);
  check('anonymous visitor reads any quote', 'deny', (await quotes(anon)).length === 0, `${(await quotes(anon)).length} row(s)`);
  const responded = must(await admin.from('availability_request_recipients').select('responded_at').eq('request_id', reqId), 'responded');
  check('both recipients are marked as replied', 'allow', responded.every(r => r.responded_at), `${responded.filter(r => r.responded_at).length} of ${responded.length}`);

  // ── Tampering ──
  const o1Id = r1.data?.[0]?.id, o2Id = r2.data?.[0]?.id;
  const aEdits = await a.from('availability_responses').update({ quoted_rate: 1 }).eq('id', o1Id).select('id');
  check('A changes an owner\'s quoted rate', 'deny', !one(aEdits), describe(aEdits));
  const o1Edits2 = await o1.from('availability_responses').update({ quoted_rate: 1 }).eq('id', o2Id).select('id');
  check('O1 changes O2\'s quote', 'deny', !one(o1Edits2), describe(o1Edits2));
  const xEdits = await x.from('availability_responses').update({ quoted_rate: 1 }).eq('id', o1Id).select('id');
  check('X changes a quote', 'deny', !one(xEdits), describe(xEdits));
  const o1Own = await o1.from('availability_responses').update({ quoted_rate: 260000 }).eq('id', o1Id).select('quoted_rate');
  check('O1 revises its own quote', 'allow', one(o1Own) && Number(o1Own.data[0].quoted_rate) === 260000, describe(o1Own));

  // ── Accepting: becomes a booking on A's campaign ──
  const booking = await a.from('bookings').insert({ campaign_id: state.campaignId, board_id: B.o1Billboard, offered_rate: 260000, status: 'pending', start_date: '2027-01-01', end_date: '2027-03-31', duration_months: 3 }).select('id');
  check('A creates a pending booking from O1\'s reply', 'allow', one(booking), describe(booking));
  const bookingId = booking.data?.[0]?.id;
  const selfAccept = await o2.from('availability_responses').update({ accepted_booking_id: bookingId }).eq('id', o2Id).select('id');
  check('O2 marks its own reply as accepted', 'deny', !one(selfAccept), describe(selfAccept));
  const accept = await a.from('availability_responses').update({ accepted_booking_id: bookingId }).eq('id', o1Id).select('accepted_booking_id');
  check('A links O1\'s reply to the booking', 'allow', one(accept) && accept.data[0].accepted_booking_id === bookingId, describe(accept));
  const ownerSeesBooking = must(await o1.from('bookings').select('id').eq('id', bookingId), 'owner booking');
  check('O1 sees the resulting booking in its normal bookings', 'allow', ownerSeesBooking.length === 1, `${ownerSeesBooking.length} row(s)`);

  // ── Closing ──
  const xClose = await x.from('availability_requests').update({ status: 'closed' }).eq('id', reqId).select('id');
  check('X closes A\'s request', 'deny', !one(xClose), describe(xClose));
  const o1Close = await o1.from('availability_requests').update({ status: 'closed' }).eq('id', reqId).select('id');
  check('O1 closes the request', 'deny', !one(o1Close), describe(o1Close));
  const close = await a.from('availability_requests').update({ status: 'closed' }).eq('id', reqId).select('id');
  check('A closes its request', 'allow', one(close), describe(close));
  const late = await o2.from('availability_responses').update({ quoted_rate: 999999 }).eq('id', o2Id).select('id');
  check('O2 revises its quote after the request is closed', 'deny', !one(late), describe(late));

  // ── Proposal open-tracking (033) ──
  const viewRow = { campaign_id: state.campaignId, viewer_kind: 'anonymous', device: 'desktop' };
  const anonForge = await anon.from('proposal_views').insert(viewRow).select('id');
  check('anonymous visitor forges a report open directly in the table', 'deny', !!anonForge.error, describe(anonForge));
  const aForge = await a.from('proposal_views').insert(viewRow).select('id');
  check('A forges a report open directly in the table', 'deny', !!aForge.error, describe(aForge));

  const views = async cl => must(await cl.from('proposal_views').select('id, viewer_kind').eq('campaign_id', state.campaignId), 'views');
  if (appUrl) {
    const post = async token => (await fetch(`${appUrl}/api/report/${state.campaignId}/view`, { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {} })).json();
    const own = await post(a.qaToken);
    check('route: the agency opening its own report is not counted', 'deny', own.counted === false && own.reason === 'own', JSON.stringify(own));
    const first = await post(null);
    check('route: an anonymous open is counted', 'allow', first.counted === true, JSON.stringify(first));
    const again = await post(null);
    check('route: a refresh within 30 minutes is not counted again', 'deny', again.counted === false && again.reason === 'recent', JSON.stringify(again));
    const other = await post(o1.qaToken);
    check('route: a different signed-in viewer is counted', 'allow', other.counted === true, JSON.stringify(other));
    const missing = await fetch(`${appUrl}/api/report/00000000-0000-0000-0000-000000000000/view`, { method: 'POST' });
    check('route: an unknown campaign id', 'deny', missing.status === 404, `HTTP ${missing.status}`);
    const seen = await views(a);
    check('A sees the 2 counted opens on its campaign', 'allow', seen.length === 2, `${seen.length} row(s): ${seen.map(v => v.viewer_kind).join(', ')}`);
  } else {
    must(await admin.from('proposal_views').insert(viewRow), 'seed view');
    check('A sees opens on its own campaign', 'allow', (await views(a)).length === 1, `${(await views(a)).length} row(s)`);
    out.push({ result: 'SKIP', check: 'route checks', detail: 'no app URL given' });
  }
  check('X reads opens of A\'s campaign', 'deny', (await views(x)).length === 0, `${(await views(x)).length} row(s)`);
  check('O1 reads opens of A\'s campaign', 'deny', (await views(o1)).length === 0, `${(await views(o1)).length} row(s)`);
  check('anonymous visitor reads opens', 'deny', (await views(anon)).length === 0, `${(await views(anon)).length} row(s)`);

  for (const r of out) console.log(`${r.result.padEnd(6)}${r.check}  ->  ${r.detail}`);
  const fails = out.filter(r => r.result === 'FAIL').length;
  console.log(`\n${out.filter(r => r.result === 'PASS').length} passed, ${fails} failed`);
  process.exitCode = fails ? 1 : 0;
}

async function cleanup() {
  if (!existsSync(stateFile)) { console.log('nothing to clean'); return; }
  const state = JSON.parse(readFileSync(stateFile, 'utf8'));
  const userIds = Object.values(state.users).map(u => u.id);
  await admin.from('availability_requests').delete().in('agency_id', userIds);
  await admin.from('notifications').delete().in('recipient_user_id', userIds);
  if (state.campaignId) {
    await admin.from('proposal_views').delete().eq('campaign_id', state.campaignId);
    must(await admin.from('bookings').delete().eq('campaign_id', state.campaignId), 'del bookings');
    must(await admin.from('campaigns').delete().eq('id', state.campaignId), 'del campaign');
  }
  const boardIds = Object.values(state.boards);
  if (boardIds.length) must(await admin.from('boards').delete().in('id', boardIds), 'del boards');
  for (const id of userIds) {
    await admin.from('profiles').delete().eq('id', id);
    must(await admin.auth.admin.deleteUser(id), 'del user');
  }
  rmSync(stateFile);
  console.log('cleanup done: test users, boards, campaign, requests, replies, notifications and opens removed');
}

await ({ setup, verify, cleanup }[stage] ?? (() => { console.log('usage: setup | verify | cleanup  <state-file> [app-url]'); }))();
