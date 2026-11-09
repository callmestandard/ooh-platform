// Checks that /api/notify/email and /api/invoices/media-partner only act for
// the right people, using throwaway accounts that are deleted at the end:
// agency A (owns the campaign), client CL, owner O (owns the board), another
// owner O2 and an unrelated agency X.
//
//   node scripts/verify-email-route-guards.mjs http://localhost:3000
//
// Test addresses use example.com, so no real email reaches anyone.
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split(/\r?\n/).filter(l => /^[A-Z_]+=/.test(l)).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
);
const BASE = process.argv[2] ?? 'http://localhost:3000';
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const must = ({ data, error }, what) => { if (error) throw new Error(`${what}: ${error.message}`); return data; };
const results = [];
const check = (name, ok, detail = '') => results.push({ result: ok ? 'PASS' : 'FAIL', check: name, detail: String(detail ?? '').slice(0, 80) });
const users = {}, tokens = {};
let boardId, campaignId, bookingId;
const invoiceIds = [];

async function call(who, path, method, body) {
  const res = await fetch(`${BASE}${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens[who]}` }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (json?.id && path.includes('media-partner') && method === 'POST') invoiceIds.push(json.id);
  return { status: res.status, body: json };
}

try {
  for (const [key, role] of [['A', 'agency'], ['CL', 'client'], ['O', 'owner'], ['O2', 'owner'], ['X', 'agency']]) {
    const email = `qa-guard-${key.toLowerCase()}-${randomBytes(3).toString('hex')}@example.com`;
    const password = randomBytes(18).toString('base64url');
    const { user } = must(await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { role, full_name: `QA Guard ${key}` } }), 'createUser');
    must(await admin.from('profiles').update({ role, company_name: `QA Guard ${key} Ltd` }).eq('id', user.id), 'profile');
    users[key] = user.id;
    const c = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
    tokens[key] = must(await c.auth.signInWithPassword({ email, password }), 'signIn').session.access_token;
  }
  boardId = must(await admin.from('boards').insert({ name: '[qa-guard] board', format: 'billboard', address: 'QA test - safe to delete', city: 'ZZ QA Guard City', state: 'Lagos', status: 'unavailable', owner_id: users.O }).select('id').single(), 'board').id;
  campaignId = must(await admin.from('campaigns').insert({ name: '[qa-guard] campaign', agency_id: users.A, client_id: users.CL, status: 'draft' }).select('id').single(), 'campaign').id;
  bookingId = must(await admin.from('bookings').insert({ campaign_id: campaignId, board_id: boardId, offered_rate: 1000000, status: 'negotiating', start_date: '2030-01-01', end_date: '2030-03-31' }).select('id').single(), 'booking').id;

  // ── /api/notify/email ──
  let r = await call('X', '/api/notify/email', 'POST', { type: 'booking_request', bookingId });
  check('email: stranger cannot send a booking request email', r.status === 403, r.status);
  r = await call('A', '/api/notify/email', 'POST', { type: 'booking_request', bookingId });
  check('email: campaign agency can', r.status === 200 && r.body.sent === true, JSON.stringify(r.body));
  r = await call('O2', '/api/notify/email', 'POST', { type: 'booking_counter_offer', bookingId });
  check('email: another owner cannot answer for this board', r.status === 403, r.status);
  r = await call('O', '/api/notify/email', 'POST', { type: 'booking_counter_offer', bookingId });
  check('email: board owner can send a counter-offer email', r.status === 200 && r.body.sent === true, JSON.stringify(r.body));
  r = await call('O', '/api/notify/email', 'POST', { type: 'booking_accepted', bookingId });
  check('email: "accepted" refused while booking is not agreed', r.status === 200 && r.body.sent === false, JSON.stringify(r.body));
  r = await call('X', '/api/notify/email', 'POST', { type: 'plan_sent_for_approval', campaignId });
  check('email: stranger cannot send a plan email', r.status === 403, r.status);
  r = await call('A', '/api/notify/email', 'POST', { type: 'plan_sent_for_approval', campaignId });
  check('email: campaign agency can send the plan email', r.status === 200, JSON.stringify(r.body));
  r = await call('A', '/api/notify/email', 'POST', { type: 'plan_approved', campaignId, boardCount: 1 });
  check('email: only the client can send "plan approved"', r.status === 403, r.status);
  r = await call('CL', '/api/notify/email', 'POST', { type: 'plan_approved', campaignId, boardCount: 1 });
  check('email: client can', r.status === 200, JSON.stringify(r.body));
  r = await call('A', '/api/notify/email', 'POST', { type: 'plan_sent_for_approval', clientId: users.X, agencyId: users.A, campaignName: '<b>spam</b>' });
  check('email: old-style free-form body is refused', r.status === 403, r.status);

  // ── /api/invoices/media-partner ──
  must(await admin.from('bookings').update({ status: 'agreed', agreed_rate: 900000 }).eq('id', bookingId), 'agree');
  r = await call('X', '/api/invoices/media-partner', 'POST', { booking_id: bookingId, agency_name: 'QA', owner_id: users.O });
  check('invoice: an agency cannot raise an owner invoice', r.status === 403, r.status);
  r = await call('O2', '/api/invoices/media-partner', 'POST', { booking_id: bookingId, agency_name: 'QA' });
  check('invoice: another owner cannot invoice this booking', r.status === 403, r.status);
  r = await call('O2', '/api/invoices/media-partner', 'POST', { campaign_id: campaignId, agency_name: 'QA' });
  check('invoice: another owner cannot invoice the campaign', r.status === 403, r.status);
  r = await call('O', '/api/invoices/media-partner', 'POST', { booking_id: bookingId, agency_name: 'QA Guard A Ltd', owner_id: users.O2 });
  const inv = r.body;
  check('invoice: board owner can, stamped as themselves', r.status === 201 && inv.owner_id === users.O && Number(inv.total_amount) === 900000, `${r.status} owner=${inv.owner_id === users.O}`);
  r = await call('O2', '/api/invoices/media-partner', 'PATCH', { id: inv.id, status: 'paid' });
  check('invoice: another owner cannot mark it paid', r.status === 403, r.status);
  r = await call('A', '/api/invoices/media-partner', 'PATCH', { id: inv.id, status: 'paid' });
  check('invoice: the agency cannot mark it paid via this route', r.status === 403, r.status);
  r = await call('O', '/api/invoices/media-partner', 'PATCH', { id: inv.id, agency_id: users.X, status: 'sent' });
  check('invoice: cannot be readdressed to another agency', r.status === 400, r.status);
  r = await call('O', '/api/invoices/media-partner', 'PATCH', { id: inv.id, notes: 'qa' });
  check('invoice: owner can update their own invoice', r.status === 200, r.status);
} catch (e) {
  check('script ran', false, e.message);
} finally {
  for (const id of invoiceIds) { await admin.from('invoice_items').delete().eq('invoice_id', id); await admin.from('invoices').delete().eq('id', id); }
  await admin.from('activity_events').delete().in('entity_id', [...invoiceIds, bookingId, campaignId].filter(Boolean));
  if (bookingId) await admin.from('bookings').delete().eq('id', bookingId);
  if (campaignId) await admin.from('campaigns').delete().eq('id', campaignId);
  if (boardId) await admin.from('boards').delete().eq('id', boardId);
  for (const id of Object.values(users)) await admin.auth.admin.deleteUser(id);
  console.table(results);
  const failed = results.filter(r => r.result === 'FAIL').length;
  console.log(`${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
}
