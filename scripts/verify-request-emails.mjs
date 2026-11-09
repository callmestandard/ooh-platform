// Verifies the board-request emails (046) end to end against a running app,
// with throwaway accounts that are deleted at the end: buyer A, owner O with
// one board, an unrelated buyer X, and one board with no owner account.
//
//   node scripts/verify-request-emails.mjs http://localhost:3000
//
// Test addresses use example.com, so no real email reaches anyone. The checks
// read request_email_log and the endpoint's answer to see what would be sent.
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split(/\r?\n/).filter(l => /^[A-Z_]+=/.test(l)).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
);
const BASE = process.argv[2] ?? 'http://localhost:3000';
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const TAG = 'qa-mail';
const must = ({ data, error }, what) => { if (error) throw new Error(`${what}: ${error.message}`); return data; };
const inDays = n => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const results = [];
const check = (name, ok, detail = '') => results.push({ result: ok ? 'PASS' : 'FAIL', check: name, detail: String(detail ?? '').slice(0, 90) });

const users = {}, boards = {};
async function as(u) {
  const c = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { session } = must(await c.auth.signInWithPassword({ email: u.email, password: u.password }), 'signIn');
  return { c, token: session.access_token };
}
async function notify(who, body) {
  const res = await fetch(`${BASE}/api/notify/request`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${who.token}` }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const logOf = async id => (must(await admin.from('request_email_log').select('event, skipped').eq('request_id', id), 'log')).map(r => r.event + (r.skipped ? '(skipped)' : '')).sort().join(',');

try {
  const { error: tableErr } = await admin.from('request_email_log').select('event').limit(1);
  if (tableErr) throw new Error(`request_email_log missing — run migration 046 first (${tableErr.message})`);

  for (const [key, role] of [['A', 'agency'], ['O', 'owner'], ['X', 'agency']]) {
    const email = `${TAG}-${key.toLowerCase()}-${randomBytes(3).toString('hex')}@example.com`;
    const password = randomBytes(18).toString('base64url');
    const { user } = must(await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { role, full_name: `QA Mail ${key}` } }), 'createUser');
    must(await admin.from('profiles').update({ role, company_name: `QA Mail ${key} Ltd` }).eq('id', user.id), 'profile');
    users[key] = { id: user.id, email, password };
  }
  for (const [key, owner] of [['owned', users.O.id], ['unowned', null], ['unowned2', null]]) {
    boards[key] = must(await admin.from('boards').insert({ name: `[${TAG}] ${key}`, format: 'billboard', address: 'QA test - safe to delete', city: 'ZZ QA Mail City', state: 'Lagos', status: 'unavailable', owner_id: owner }).select('id').single(), 'board').id;
  }
  const A = await as(users.A), O = await as(users.O), X = await as(users.X);
  const request = async board => must(await A.c.rpc('send_board_request', {
    p_board_id: board, p_start: inDays(30), p_end: inDays(120), p_name: 'QA Buyer', p_company: 'QA Mail A Ltd',
    p_email: users.A.email, p_phone: '08000000000', p_message: `[${TAG}] test`, p_budget: null, p_sites: 1, p_extra: null,
  }), 'send_board_request');

  // ── Request received ──
  const r1 = await request(boards.owned);
  let n = await notify(A, { requestId: r1 });
  check('new request → "received" emails', n.status === 200 && n.body.sent?.join() === 'received', JSON.stringify(n));
  n = await notify(A, { requestId: r1 });
  check('calling again sends nothing (once only)', n.status === 200 && n.body.sent?.length === 0, JSON.stringify(n));
  n = await notify(X, { requestId: r1 });
  check('an unrelated user is refused', n.status === 403, JSON.stringify(n));
  n = await fetch(`${BASE}/api/notify/request`, { method: 'POST', body: JSON.stringify({ requestId: r1 }) }).then(r => r.status);
  check('signed-out caller is refused', n === 401, n);

  // ── Owner replied ──
  must(await O.c.from('availability_responses').insert({ request_id: r1, owner_id: users.O.id, board_id: boards.owned, available: true, quoted_rate: 3000000, conditions: 'Printing not included' }), 'owner reply');
  n = await notify(O, { requestId: r1 });
  check('owner reply → "replied" email (owner may trigger)', n.status === 200 && n.body.sent?.join() === 'replied', JSON.stringify(n));

  // ── Buyer accepts the quote ──
  const bookingId = must(await A.c.rpc('answer_board_quote', { p_request_id: r1, p_accept: true }), 'accept');
  n = await notify(A, { bookingId });
  check('deal agreed → "accepted" emails (found via booking)', n.status === 200 && n.body.sent?.join() === 'accepted', JSON.stringify(n));
  check('log has all three, none skipped', (await logOf(r1)) === 'accepted,received,replied', await logOf(r1));

  // ── Old request: logged as skipped, not emailed ──
  const r2 = await request(boards.unowned);
  must(await admin.from('availability_requests').update({ created_at: new Date(Date.now() - 5 * 86_400_000).toISOString() }).eq('id', r2), 'age request');
  n = await notify(A, { requestId: r2 });
  check('a stale request is not emailed', n.status === 200 && n.body.sent?.length === 0 && (await logOf(r2)) === 'received(skipped)', JSON.stringify(n) + ' ' + await logOf(r2));

  // ── Unowned board: new request emails buyer + admins only ──
  const r3 = await request(boards.unowned2);
  n = await notify(A, { requestId: r3 });
  check('request for an unowned board → "received"', n.status === 200 && n.body.sent?.join() === 'received', JSON.stringify(n));

  // ── A booking outside the request flow ──
  n = await notify(A, { bookingId: '00000000-0000-0000-0000-000000000000' });
  check('unknown booking → nothing, no error', n.status === 200 && n.body.sent?.length === 0, JSON.stringify(n));
} catch (e) {
  check('script ran', false, e.message);
} finally {
  // Requests cascade from the buyer's auth user; campaigns/bookings from the request flow too.
  for (const id of Object.values(boards)) {
    const bks = (await admin.from('bookings').select('id, campaign_id').eq('board_id', id)).data ?? [];
    for (const b of bks) { await admin.from('messages').delete().eq('booking_id', b.id); await admin.from('bookings').delete().eq('id', b.id); if (b.campaign_id) await admin.from('campaigns').delete().eq('id', b.campaign_id); }
  }
  for (const u of Object.values(users)) await admin.auth.admin.deleteUser(u.id);
  for (const id of Object.values(boards)) await admin.from('boards').delete().eq('id', id);
  console.table(results);
  const failed = results.filter(r => r.result === 'FAIL').length;
  console.log(`${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
}
