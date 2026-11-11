// Verifies owner links (053) with throwaway data: an admin (ADM), a buyer
// (B), and two named owners with no account (QA Owner One / Two).
//
//   node scripts/verify-owner-links.mjs setup   <state-file>
//   node scripts/verify-owner-links.mjs verify  <state-file>
//   node scripts/verify-owner-links.mjs cleanup <state-file>
//
// Reads Supabase keys from .env.local. Test boards use a made-up city and
// are deleted on cleanup. Passwords go to the state file, never to stdout.
import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split(/\r?\n/).filter(l => /^[A-Z_]+=/.test(l)).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
);
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL, ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY, SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
const [stage, stateFile = '.owner-links-state.json'] = process.argv.slice(2);
const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });
const TAG = 'qa-ownerlink';
const CITY = 'ZZ QA Owner Link City';
const OWNER1 = 'QA Owner  One', OWNER2 = 'QA Owner Two';
const key = name => 'name:' + name.trim().replace(/\s+/g, ' ').toLowerCase();

const must = ({ data, error }, what) => { if (error) throw new Error(`${what}: ${error.message}`); return data; };
const save = state => writeFileSync(stateFile, JSON.stringify(state, null, 2));

async function setup() {
  const state = { users: {}, boards: {} };
  for (const [k, role] of [['ADM', 'admin'], ['B', 'agency']]) {
    const email = `${TAG}-${k.toLowerCase()}-${randomBytes(3).toString('hex')}@example.com`;
    const password = randomBytes(18).toString('base64url');
    const { user } = must(await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { role: role === 'admin' ? 'agency' : role, full_name: `QA ${k}` } }), 'createUser');
    must(await admin.from('profiles').update({ role, company_name: `QA Owner Link ${k}` }).eq('id', user.id), 'profile');
    state.users[k] = { id: user.id, email, password };
    save(state);
  }
  for (const [k, owner] of [['a1', OWNER1], ['a2', OWNER1], ['b1', OWNER2]]) {
    const b = must(await admin.from('boards').insert({ name: `[${TAG}] ${k}`, format: 'billboard', address: 'QA test - safe to delete', city: CITY, state: 'Lagos', status: 'available' }).select('id').single(), `board ${k}`);
    must(await admin.from('board_owner_names').upsert({ board_id: b.id, owner_name: owner }), 'owner name');
    state.boards[k] = b.id;
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
  const { a1, a2, b1 } = state.boards;
  const out = [];
  const check = (name, ok, detail = '') => out.push({ result: ok ? 'PASS' : 'FAIL', check: name, detail: String(detail ?? '').slice(0, 90) });
  const anon = createClient(SUPABASE_URL, ANON, { auth: { persistSession: false } });
  const adm = await as(state.users.ADM), B = await as(state.users.B);
  const start = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
  const end = new Date(Date.now() + 67 * 864e5).toISOString().slice(0, 10);
  const later = new Date(Date.now() + 90 * 864e5).toISOString().slice(0, 10);

  // ── Links ──
  let r = await B.rpc('admin_owner_link', { p_owner_key: key(OWNER1), p_owner_name: 'QA Owner One', p_new: false });
  check('buyer cannot make an owner link', !!r.error, r.error?.message ?? 'allowed');
  r = await adm.rpc('admin_owner_link', { p_owner_key: key(OWNER1), p_owner_name: 'QA Owner One', p_new: false });
  const t1 = r.data;
  check('admin makes a link', !r.error && t1?.length >= 32, r.error?.message);
  r = await adm.rpc('admin_owner_link', { p_owner_key: key(OWNER1), p_owner_name: 'QA Owner One', p_new: false });
  check('asking again gives the same link', r.data === t1);
  const t2 = (await adm.rpc('admin_owner_link', { p_owner_key: key(OWNER2), p_owner_name: OWNER2, p_new: false })).data;
  r = await anon.from('owner_links').select('token');
  check('visitor cannot list links', !!r.error || r.data.length === 0, r.error?.message ?? r.data.length);
  r = await B.from('owner_links').select('token');
  check('buyer cannot list links', !r.error && r.data.length === 0, r.error?.message ?? r.data.length);

  // ── Owner view ──
  r = await anon.rpc('owner_link_view', { p_token: t1 });
  const ids = (r.data?.boards ?? []).map(b => b.id);
  check('owner link shows only their boards', !r.error && ids.length === 2 && ids.includes(a1) && ids.includes(a2) && !ids.includes(b1), r.error?.message ?? JSON.stringify(ids));
  r = await anon.rpc('owner_link_view', { p_token: 'x'.repeat(64) });
  check('wrong link shows nothing', !r.error && r.data == null, r.error?.message);
  r = await anon.rpc('owner_link_view', { p_token: t1.slice(0, 20) });
  check('partial token shows nothing', !r.error && r.data == null);

  // ── Weekly check ──
  r = await anon.rpc('owner_link_update_boards', { p_token: t1, p_updates: [{ id: a1, status: 'booked', available_from: later }, { id: a2, status: 'available' }, { id: b1, status: 'unavailable' }] });
  check('owner confirms their boards (other owner ignored)', !r.error && r.data === 2, r.error?.message ?? r.data);
  const rows = must(await admin.from('boards').select('id, status, available_from, availability_checked_at').in('id', [a1, a2, b1]), 'boards');
  const by = Object.fromEntries(rows.map(x => [x.id, x]));
  check('booked board saved with its free date', by[a1].status === 'booked' && by[a1].available_from === later && !!by[a1].availability_checked_at, JSON.stringify(by[a1]));
  check("other owner's board untouched", by[b1].status === 'available' && !by[b1].availability_checked_at, JSON.stringify(by[b1]));
  r = await anon.rpc('owner_link_update_boards', { p_token: t1, p_updates: [{ id: a1, status: 'booked' }] });
  check('booked without a date is refused', !!r.error, r.error?.message ?? 'allowed');
  r = await anon.rpc('owner_link_update_boards', { p_token: t1, p_updates: [{ id: a1, status: 'decommissioned' }] });
  check('owner cannot remove a board', !!r.error, r.error?.message ?? 'allowed');
  r = await anon.rpc('owner_link_update_boards', { p_token: 'y'.repeat(64), p_updates: [{ id: a1, status: 'available' }] });
  check('wrong link cannot change boards', !!r.error, r.error?.message ?? 'allowed');
  must(await admin.from('boards').update({ status: 'available', available_from: null }).eq('id', a1), 'reset a1');

  // ── Requests and answers ──
  const reqArgs = id => ({ p_board_id: id, p_start: start, p_end: end, p_name: 'QA Buyer', p_company: 'QA Owner Link Buyer Co', p_email: 'qa-buyer@example.com', p_phone: '08000000000', p_message: 'QA launch', p_budget: 9_000_000, p_sites: 1, p_extra: '' });
  const q1 = must(await B.rpc('send_board_request', reqArgs(a1)), 'request a1');
  const q2 = must(await B.rpc('send_board_request', reqArgs(b1)), 'request b1');
  r = await anon.rpc('owner_link_view', { p_token: t1 });
  const reqs = r.data?.requests ?? [];
  check('owner sees the request for their board only', reqs.length === 1 && reqs[0].id === q1, JSON.stringify(reqs.map(x => x.id)));
  check('buyer company shown, email/phone/budget hidden', reqs[0]?.company === 'QA Owner Link Buyer Co' && !JSON.stringify(reqs).includes('qa-buyer@example.com') && !JSON.stringify(reqs).includes('08000000000') && !JSON.stringify(reqs).includes('9000000'), JSON.stringify(reqs[0])?.slice(0, 80));

  r = await anon.rpc('owner_link_reply', { p_token: t1, p_request_id: q2, p_available: true, p_rate: 1_000_000, p_from: start, p_to: end, p_conditions: '', p_note: '' });
  check("owner cannot answer another owner's request", !!r.error, r.error?.message ?? 'allowed');
  r = await anon.rpc('owner_link_reply', { p_token: t1, p_request_id: q1, p_available: true, p_rate: 1_200_000, p_from: start, p_to: end, p_conditions: 'Print not included', p_note: '' });
  check('owner answers their request', !r.error, r.error?.message);
  let resp = must(await admin.from('availability_responses').select('id').eq('request_id', q1), 'responses');
  check('answer does NOT reach the buyer yet', resp.length === 0, resp.length);
  r = await B.from('availability_responses').select('id').eq('request_id', q1);
  check('buyer sees no reply yet', !r.error && r.data.length === 0);

  const ov = must(await adm.rpc('admin_owner_overview'), 'overview');
  const o1 = ov.find(x => x.owner_key === key(OWNER1));
  check('overview lists the owner with 2 boards and 1 answer to check', o1?.boards === 2 && o1?.pending_replies === 1, JSON.stringify(o1)?.slice(0, 90));
  const o2 = ov.find(x => x.owner_key === key(OWNER2));
  check('overview shows a request waiting on the other owner', o2?.waiting_requests === 1, JSON.stringify(o2)?.slice(0, 90));
  r = await B.rpc('admin_owner_overview');
  check('buyer cannot see the overview', !!r.error, r.error?.message ?? 'allowed');
  r = await B.rpc('admin_send_owner_reply', { p_request_id: q1, p_rate: 1 });
  check('buyer cannot send an owner answer', !!r.error, r.error?.message ?? 'allowed');

  r = await adm.rpc('admin_send_owner_reply', { p_request_id: q1, p_rate: 1_350_000 });
  check('admin sends it on with a corrected price', !r.error, r.error?.message);
  resp = must(await B.from('availability_responses').select('quoted_rate, available, conditions').eq('request_id', q1), 'buyer reply');
  check('buyer now sees the checked price', resp.length === 1 && Number(resp[0].quoted_rate) === 1_350_000 && resp[0].conditions === 'Print not included', JSON.stringify(resp));
  r = await anon.rpc('owner_link_reply', { p_token: t1, p_request_id: q1, p_available: false, p_rate: null, p_from: null, p_to: null, p_conditions: '', p_note: '' });
  check('owner cannot change an answer already sent', !!r.error, r.error?.message ?? 'allowed');

  // ── New link replaces the old ──
  const t1b = (await adm.rpc('admin_owner_link', { p_owner_key: key(OWNER1), p_owner_name: 'QA Owner One', p_new: true })).data;
  r = await anon.rpc('owner_link_view', { p_token: t1 });
  check('old link stops working after a new one', t1b && t1b !== t1 && r.data == null);
  r = await anon.rpc('owner_link_view', { p_token: t1b });
  check('new link works', !r.error && r.data?.boards?.length === 2);
  void t2;

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
  await admin.from('owner_links').delete().in('owner_key', [key(OWNER1), key(OWNER2)]);
  await admin.from('notifications').delete().like('title', '%QA Owner%');
  await admin.from('notifications').delete().like('body', '%QA Owner Link%');
  await admin.from('notifications').delete().like('title', `%[${TAG}]%`);
  await admin.from('notifications').delete().in('recipient_user_id', userIds);
  await admin.from('boards').delete().like('name', `[${TAG}]%`);
  for (const id of userIds) await admin.auth.admin.deleteUser(id);
  rmSync(stateFile);
  console.log('cleanup done');
}

({ setup, verify, cleanup }[stage] ?? (() => { console.log('usage: setup | verify | cleanup <state-file>'); }))().catch(e => { console.error(e.message); process.exitCode = 1; });
