// Verifies migration 036: agency vendor preferences and makegood tracking,
// with throwaway accounts only — two agencies (A, B), two owners (O, O2) and
// O's marketer.
//
//   node scripts/verify-vendor-makegoods-rls.mjs setup   <state-file>
//   node scripts/verify-vendor-makegoods-rls.mjs verify  <state-file>
//   node scripts/verify-vendor-makegoods-rls.mjs cleanup <state-file>
//
// Reads Supabase keys from .env.local. Test boards use a made-up city.
// Passwords go to the state file (keep it outside the repo), never to stdout.
import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split(/\r?\n/).filter(l => /^[A-Z_]+=/.test(l)).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
);
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL, ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY, SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
const [stage, stateFile = '.vendor-makegood-state.json'] = process.argv.slice(2);
const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });
const TAG = 'qa-vm';
const CITY = 'ZZ QA Vendor City';

const must = ({ data, error }, what) => { if (error) throw new Error(`${what}: ${error.message}`); return data; };
const rows = ({ data, error }) => (error ? [] : data ?? []);
const save = state => writeFileSync(stateFile, JSON.stringify(state, null, 2));

async function setup() {
  const state = { users: {}, boards: {}, bookings: {}, campaigns: {} };
  for (const [key, role, kyc] of [['agA', 'agency', false], ['agB', 'agency', false], ['ownerO', 'owner', true], ['ownerO2', 'owner', false], ['mO', 'marketer', false]]) {
    const email = `${TAG}-${key.toLowerCase()}-${randomBytes(3).toString('hex')}@example.com`;
    const password = randomBytes(18).toString('base64url');
    const { user } = must(await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { role, full_name: `QA ${key}` } }), 'createUser');
    state.users[key] = { id: user.id, email, password, role };
    save(state);
    must(await admin.from('profiles').upsert({ id: user.id, role, full_name: `QA ${key}`, company_name: `QA ${key}`, email }), 'profile');
    if (kyc) must(await admin.from('partner_kyc').upsert({ id: user.id, cac_number: 'RC-QA-0002', tin_number: 'TIN-QA-0002' }), 'kyc');
  }
  const U = state.users;
  must(await admin.from('owner_team_members').insert({ owner_id: U.ownerO.id, member_profile_id: U.mO.id, member_name: 'QA mO', role: 'marketer' }), 'member');
  for (const [key, owner] of [['O_a', U.ownerO.id], ['O_b', U.ownerO.id], ['P_a', U.ownerO2.id]]) {
    const b = must(await admin.from('boards').insert({ name: `[${TAG}] ${key}`, format: 'billboard', address: 'QA test - safe to delete', city: CITY, state: 'Lagos', asking_rate: 300000, status: 'available', owner_id: owner, latitude: 6.5, longitude: 3.4 }).select('id').single(), 'board');
    state.boards[key] = b.id; save(state);
  }
  for (const [key, agency] of [['A', U.agA.id], ['B', U.agB.id]]) {
    const c = must(await admin.from('campaigns').insert({ agency_id: agency, name: `[${TAG}] campaign ${key}`, status: 'draft' }).select('id').single(), 'campaign');
    state.campaigns[key] = c.id; save(state);
  }
  const bk = async (key, campaign, board, extra = {}) => {
    const r = must(await admin.from('bookings').insert({ campaign_id: campaign, board_id: board, offered_rate: 280000, agreed_rate: 280000, gross_rate: 300000, status: 'agreed', start_date: '2027-01-01', end_date: '2027-03-31', duration_months: 3, ...extra }).select('id').single(), 'booking ' + key);
    state.bookings[key] = r.id; save(state);
  };
  // agency A: an existing agreed line on owner O (O will then be excluded); a line that needs replacing; its candidate replacement on owner O2
  await bk('existing', state.campaigns.A, state.boards.O_a);
  await bk('original', state.campaigns.A, state.boards.O_b, { status: 'needs_replacement' });
  await bk('replacement', state.campaigns.A, state.boards.P_a, { status: 'pending', agreed_rate: null, replaces_booking_id: state.bookings.original });
  await bk('agencyB', state.campaigns.B, state.boards.O_a);
  console.log('setup done: agencies A and B, owners O (with a marketer) and O2; 3 boards, 4 bookings');
}

async function as(u) {
  const c = createClient(SUPABASE_URL, ANON, { auth: { persistSession: false } });
  must(await c.auth.signInWithPassword({ email: u.email, password: u.password }), 'signIn');
  return c;
}

async function verify() {
  const state = JSON.parse(readFileSync(stateFile, 'utf8'));
  const U = state.users, B = state.boards, BK = state.bookings;
  const out = [];
  const check = (name, expect, ok, detail) => out.push({ result: ok ? 'PASS' : 'FAIL', check: `${name} [expect ${expect}]`, detail });
  const describe = r => r.error ? `rejected: ${r.error.message}` : `${Array.isArray(r.data) ? r.data.length + ' row(s)' : JSON.stringify(r.data)}`;
  const one = r => !r.error && (r.data ?? []).length === 1;
  const section = t => out.push({ result: '', check: `\n── ${t} ──`, detail: '' });

  const c = {};
  for (const k of Object.keys(U)) c[k] = await as(U[k]);
  const anon = createClient(SUPABASE_URL, ANON, { auth: { persistSession: false } });
  const allBoards = [B.O_a, B.O_b, B.P_a];
  // what a discovery screen does: load boards, then drop the ones this agency excluded
  const discovery = async cl => {
    const boards = must(await cl.from('boards').select('id').in('id', allBoards), 'boards');
    const prefs = rows(await cl.rpc('agency_board_preferences'));
    const excluded = new Set(prefs.filter(p => p.preference === 'excluded').map(p => p.board_id));
    return boards.filter(b => !excluded.has(b.id)).map(b => Object.keys(B).find(k => B[k] === b.id)).sort().join(',');
  };

  section('Vendor preferences: setting and replacing');
  const set = (cl, agency, owner, preference) => cl.from('agency_vendor_preferences').upsert({ agency_id: agency, owner_id: owner, preference }, { onConflict: 'agency_id,owner_id' }).select('id, preference');
  check('agency A marks owner O as direct', 'allow', one(await set(c.agA, U.agA.id, U.ownerO.id, 'direct')), '');
  const repl = await set(c.agA, U.agA.id, U.ownerO.id, 'excluded');
  const count = must(await admin.from('agency_vendor_preferences').select('preference').eq('agency_id', U.agA.id).eq('owner_id', U.ownerO.id), 'count');
  check('setting excluded REPLACES direct (one row per agency + owner)', 'allow', one(repl) && count.length === 1 && count[0].preference === 'excluded', `${count.length} row, now "${count[0]?.preference}"`);
  check('agency A marks owner O2 as preferred', 'allow', one(await set(c.agA, U.agA.id, U.ownerO2.id, 'preferred')), '');
  const bad = await c.agA.from('agency_vendor_preferences').upsert({ agency_id: U.agA.id, owner_id: U.ownerO2.id, preference: 'blacklisted' }, { onConflict: 'agency_id,owner_id' }).select('id');
  check('an invalid preference value', 'deny', !one(bad), describe(bad));

  section('Who can read agency A\'s preferences');
  const read = async cl => rows(await cl.from('agency_vendor_preferences').select('id')).length;
  check('agency A reads its own 2 preferences', 'allow', (await read(c.agA)) === 2, `${await read(c.agA)} row(s)`);
  for (const [k, label] of [['agB', 'agency B'], ['ownerO', 'the EXCLUDED owner O'], ['ownerO2', 'owner O2'], ['mO', 'owner O\'s marketer']]) {
    check(`${label} reads the preferences table`, 'deny', (await read(c[k])) === 0, `${await read(c[k])} row(s)`);
    const viaRpc = rows(await c[k].rpc('agency_board_preferences')).length;
    check(`${label} calls the board-preferences function`, 'deny', viaRpc === 0, `${viaRpc} row(s)`);
  }
  check('anonymous visitor reads the preferences table', 'deny', (await read(anon)) === 0, `${await read(anon)} row(s)`);
  const direct = rows(await c.ownerO.from('agency_vendor_preferences').select('*').eq('owner_id', U.ownerO.id));
  check('owner O looks for any preference naming itself', 'deny', direct.length === 0, `${direct.length} row(s)`);
  const partnersO = rows(await c.ownerO.rpc('agency_media_partners'));
  check('owner O calls the media-partners function', 'deny', partnersO.length === 0, `${partnersO.length} row(s)`);
  const partnersB = rows(await c.agB.rpc('agency_media_partners')).filter(p => [U.ownerO.id, U.ownerO2.id].includes(p.owner_id));
  check('agency B\'s media-partner list shows the owners with NO preference of A\'s', 'deny', partnersB.length === 2 && partnersB.every(p => p.preference === null), partnersB.map(p => `${p.owner_name}: ${p.preference ?? 'none'}`).join('; '));
  const partnersA = rows(await c.agA.rpc('agency_media_partners')).filter(p => [U.ownerO.id, U.ownerO2.id].includes(p.owner_id));
  check('agency A\'s media-partner list shows its own preferences', 'allow', partnersA.find(p => p.owner_id === U.ownerO.id)?.preference === 'excluded' && partnersA.find(p => p.owner_id === U.ownerO2.id)?.preference === 'preferred', partnersA.map(p => `${p.owner_name}: ${p.preference}`).join('; '));

  section('Writing someone else\'s preferences');
  const forge = await set(c.agB, U.agA.id, U.ownerO2.id, 'excluded');
  check('agency B writes a preference as agency A', 'deny', !one(forge), describe(forge));
  const bEdit = await c.agB.from('agency_vendor_preferences').update({ preference: 'preferred' }).eq('agency_id', U.agA.id).select('id');
  check('agency B changes agency A\'s preferences', 'deny', !one(bEdit) && (bEdit.data ?? []).length === 0, describe(bEdit));
  const bDel = await c.agB.from('agency_vendor_preferences').delete().eq('agency_id', U.agA.id).select('id');
  check('agency B deletes agency A\'s preferences', 'deny', (bDel.data ?? []).length === 0, describe(bDel));
  const oDel = await c.ownerO.from('agency_vendor_preferences').delete().eq('owner_id', U.ownerO.id).select('id');
  check('owner O deletes the exclusion against itself', 'deny', (oDel.data ?? []).length === 0, describe(oDel));
  const oSet = await c.ownerO.from('agency_vendor_preferences').insert({ agency_id: U.ownerO.id, owner_id: U.ownerO2.id, preference: 'excluded' }).select('id');
  check('an owner creates a preference', 'deny', !one(oSet), describe(oSet));
  check('after all that, agency A still has exactly its 2 preferences', 'allow', (await read(c.agA)) === 2, `${await read(c.agA)} row(s)`);

  section('Discovery: excluded owner hidden for A only');
  check('agency A\'s discovery list leaves out owner O\'s boards', 'deny', (await discovery(c.agA)) === 'P_a', `A sees: ${await discovery(c.agA)}`);
  check('agency B\'s discovery list still shows all three boards', 'allow', (await discovery(c.agB)) === 'O_a,O_b,P_a', `B sees: ${await discovery(c.agB)}`);
  const marked = rows(await c.agA.rpc('agency_board_preferences'));
  check('owner O2\'s board is marked preferred for A', 'allow', marked.find(p => p.board_id === B.P_a)?.preference === 'preferred', `${marked.length} marked board(s)`);
  const args = t => ({ p_title: `[${TAG}] ${t}`, p_cities: [CITY], p_formats: ['billboard'], p_start: '2027-01-01', p_end: '2027-03-31', p_budget: null, p_notes: null });
  const reqA = must(await c.agA.rpc('send_availability_request', args('request A')), 'reqA');
  const reqB = must(await c.agB.rpc('send_availability_request', args('request B')), 'reqB');
  const recip = async id => must(await admin.from('availability_request_recipients').select('owner_id').eq('request_id', id), 'recip').map(r => r.owner_id === U.ownerO.id ? 'O' : 'O2').sort().join(',');
  check('agency A\'s availability request skips the excluded owner', 'deny', (await recip(reqA)) === 'O2', `sent to: ${await recip(reqA)}`);
  check('agency B\'s availability request still reaches owner O', 'allow', (await recip(reqB)) === 'O,O2', `sent to: ${await recip(reqB)}`);

  section('Exclusion never breaks existing work');
  const stillThere = must(await c.agA.from('bookings').select('id, status, boards(name)').eq('id', BK.existing), 'existing');
  check('agency A still sees its booked line on the excluded owner\'s board', 'allow', stillThere.length === 1 && !!stillThere[0].boards, stillThere[0]?.boards?.name ?? '');
  const edit = await c.agA.from('bookings').update({ notes: `[${TAG}] still editable` }).eq('id', BK.existing).select('id');
  check('agency A can still update that line', 'allow', one(edit), describe(edit));
  const msg = await c.agA.from('messages').insert({ booking_id: BK.existing, sender_role: 'agency', content: `[${TAG}] hello`, message_type: 'message' }).select('id');
  check('agency A can still message the excluded owner on that booking', 'allow', one(msg), describe(msg));
  const byLink = must(await c.agA.from('boards').select('id, name').eq('id', B.O_a), 'by link');
  check('agency A can still open the excluded owner\'s board by direct link', 'allow', byLink.length === 1, byLink[0]?.name ?? '');
  const ownerSees = must(await c.ownerO.from('bookings').select('id').eq('id', BK.existing), 'owner sees');
  check('owner O still sees agency A\'s booking as normal', 'allow', ownerSees.length === 1, `${ownerSees.length} row(s)`);
  const undo = await c.agA.from('agency_vendor_preferences').delete().eq('owner_id', U.ownerO.id).select('id');
  check('agency A undoes the exclusion', 'allow', one(undo), describe(undo));
  check('owner O\'s boards are back in agency A\'s discovery list', 'allow', (await discovery(c.agA)) === 'O_a,O_b,P_a', `A sees: ${await discovery(c.agA)}`);

  section('Makegood from an approved swap');
  must(await c.agA.from('bookings').update({ status: 'replaced' }).eq('id', BK.original), 'swap 1');
  must(await c.agA.from('bookings').update({ status: 'agreed', agreed_rate: 280000 }).eq('id', BK.replacement), 'swap 2');
  const before = JSON.stringify(must(await admin.from('bookings').select('id, offered_rate, agreed_rate, gross_rate, discount_pct, production_cost, status, mpo_number').in('id', [BK.existing, BK.original, BK.replacement]).order('id'), 'before'));
  const invBefore = must(await admin.from('invoices').select('id').eq('campaign_id', state.campaigns.A), 'inv before').length;
  const mk = (cl, input) => cl.from('makegoods').insert(input).select('*');
  const m1r = await mk(c.agA, { booking_id: BK.original, reason: 'board_unavailable', promised_remedy_type: 'replacement_board', promised_detail: 'O_b replaced by P_a', replacement_board_id: B.P_a, replacement_booking_id: BK.replacement });
  const m1 = m1r.data?.[0];
  check('agency A records a makegood from the swap, linked to the swap record', 'allow', one(m1r) && m1.replacement_booking_id === BK.replacement && m1.replacement_board_id === B.P_a && m1.status === 'promised', one(m1r) ? `status ${m1.status}; promised by ${m1.promised_by_owner_id === U.ownerO.id ? 'owner O (set by the server)' : 'WRONG owner'}` : describe(m1r));
  const spoofOwner = await mk(c.agA, { booking_id: BK.existing, reason: 'other', promised_remedy_type: 'other', promised_by_owner_id: U.ownerO2.id, owner_notes: 'planted', credit_applied_at: new Date().toISOString() });
  const sp = spoofOwner.data?.[0];
  check('agency A plants an owner note / wrong owner on a new makegood', 'deny', !!sp && sp.promised_by_owner_id === U.ownerO.id && sp.owner_notes === null && sp.credit_applied_at === null, sp ? `owner ${sp.promised_by_owner_id === U.ownerO.id ? 'corrected to O' : 'WRONG'}, owner_notes ${sp.owner_notes}, credit_applied ${sp.credit_applied_at}` : describe(spoofOwner));
  if (sp) await admin.from('makegoods').delete().eq('id', sp.id);
  for (const [k, label] of [['agB', 'agency B'], ['ownerO', 'owner O'], ['mO', 'owner O\'s marketer']]) {
    const r = await mk(c[k], { booking_id: BK.original, reason: 'other', promised_remedy_type: 'other' });
    check(`${label} records a makegood on agency A's booking`, 'deny', !one(r), describe(r));
  }

  section('Who can see a makegood');
  const sees = async cl => rows(await cl.from('makegoods').select('id').eq('id', m1.id)).length;
  check('agency A sees it', 'allow', (await sees(c.agA)) === 1, '');
  check('owner O (whose board it is) sees it', 'allow', (await sees(c.ownerO)) === 1, '');
  check('owner O\'s marketer, not assigned to that board, sees it', 'deny', (await sees(c.mO)) === 0, `${await sees(c.mO)} row(s)`);
  must(await c.ownerO.from('boards').update({ assigned_marketer_id: U.mO.id }).eq('id', B.O_b), 'assign');
  check('the marketer sees it once the board is assigned to them', 'allow', (await sees(c.mO)) === 1, '');
  for (const [k, label] of [['agB', 'agency B'], ['ownerO2', 'the other owner']]) check(`${label} sees it`, 'deny', (await sees(c[k])) === 0, `${await sees(c[k])} row(s)`);
  check('anonymous visitor sees it', 'deny', (await sees(anon)) === 0, '');
  const notifO = must(await admin.from('notifications').select('id').eq('type', 'makegood').eq('recipient_user_id', U.ownerO.id), 'notifO');
  check('owner O was notified when it was recorded', 'allow', notifO.length >= 1, `${notifO.length} notification(s)`);

  section('What the owner side may change');
  const upd = (cl, id, patch) => cl.from('makegoods').update(patch).eq('id', id).select('*');
  for (const [patch, label] of [[{ promised_value: 1 }, 'changes the promised value'], [{ promised_detail: 'nothing' }, 'rewrites what was promised'], [{ due_by: '2030-01-01' }, 'moves the due date'], [{ notes: 'edited by owner' }, 'edits the agency\'s notes'], [{ status: 'disputed' }, 'marks it disputed'], [{ status: 'waived' }, 'waives it'], [{ credit_applied_at: new Date().toISOString() }, 'marks a credit as applied']]) {
    const r = await upd(c.ownerO, m1.id, patch);
    check(`owner O ${label}`, 'deny', !one(r), describe(r));
  }
  const oNote = await upd(c.ownerO, m1.id, { owner_notes: 'Replacement site is live' });
  check('owner O adds its own note', 'allow', one(oNote) && oNote.data[0].owner_notes === 'Replacement site is live', describe(oNote));
  const aEditsOwner = await upd(c.agA, m1.id, { owner_notes: 'rewritten by agency' });
  check('agency A edits the owner\'s note', 'deny', !one(aEditsOwner), describe(aEditsOwner));
  const aNote = await upd(c.agA, m1.id, { notes: 'Agreed on the phone' });
  check('agency A writes its own note', 'allow', one(aNote), describe(aNote));
  const delivered = await upd(c.mO, m1.id, { status: 'delivered' });
  check('the assigned marketer marks it delivered', 'allow', one(delivered) && delivered.data[0].status === 'delivered' && !!delivered.data[0].delivered_on && delivered.data[0].updated_by_side === 'owner', one(delivered) ? `status delivered, delivered_on ${delivered.data[0].delivered_on}, recorded as changed by the ${delivered.data[0].updated_by_side}` : describe(delivered));
  const notifA = must(await admin.from('notifications').select('body').eq('type', 'makegood').eq('recipient_user_id', U.agA.id), 'notifA');
  check('agency A was notified of the owner\'s status change', 'allow', notifA.some(n => /delivered/.test(n.body ?? '')), `${notifA.length} notification(s)`);
  const move = await upd(c.agA, m1.id, { booking_id: BK.existing });
  check('moving a makegood to a different booking', 'deny', !one(move), describe(move));
  const del = await c.agA.from('makegoods').delete().eq('id', m1.id).select('id');
  check('deleting a makegood', 'deny', (del.data ?? []).length === 0, describe(del));

  section('A second makegood: a credit, overdue, then disputed');
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const m2r = await mk(c.agA, { booking_id: BK.existing, reason: 'late_posting', promised_remedy_type: 'credit', promised_value: 150000, promised_detail: 'Posted 2 weeks late', due_by: yesterday });
  const m2 = m2r.data?.[0];
  check('agency A records a ₦150,000 credit due yesterday', 'allow', one(m2r) && Number(m2.promised_value) === 150000, describe(m2r));
  const today = new Date().toISOString().slice(0, 10);
  const overdue = must(await c.agA.from('makegoods').select('id').in('status', ['promised', 'partially_delivered', 'disputed']).lt('due_by', today).eq('campaign_id', state.campaigns.A), 'overdue');
  check('it shows as overdue (unresolved and past due) — the plan-line badge condition', 'allow', overdue.length === 1 && overdue[0].id === m2.id, `${overdue.length} overdue`);
  const disputed = await upd(c.agA, m2.id, { status: 'disputed' });
  check('agency A disputes it', 'allow', one(disputed) && disputed.data[0].status === 'disputed', describe(disputed));
  const ownerView = rows(await c.ownerO.from('makegoods').select('status').eq('id', m2.id));
  check('owner O sees it as disputed', 'allow', ownerView[0]?.status === 'disputed', ownerView[0]?.status ?? 'not visible');

  section('Status history');
  const history = async (cl, id) => rows(await cl.from('activity_events').select('action, summary, actor_role').eq('entity_type', 'makegood').eq('entity_id', id).order('created_at'));
  const h1 = await history(c.agA, m1.id);
  check('agency A reads the first makegood\'s history: created, then delivered by the owner', 'allow', h1.some(e => e.action === 'makegood.created') && h1.some(e => e.action === 'makegood.status_changed' && e.actor_role === 'owner' && /delivered/.test(e.summary)), h1.map(e => `${e.action.replace('makegood.', '')} (${e.actor_role})`).join(' → '));
  const h2 = await history(c.agA, m2.id);
  check('the second makegood\'s history: created, then disputed by the agency', 'allow', h2.some(e => e.action === 'makegood.created') && h2.some(e => /disputed/.test(e.summary) && e.actor_role === 'agency'), h2.map(e => `${e.action.replace('makegood.', '')} (${e.actor_role})`).join(' → '));
  check('owner O reads the same history', 'allow', (await history(c.ownerO, m1.id)).length === h1.length, `${(await history(c.ownerO, m1.id)).length} event(s)`);
  check('agency B reads that history', 'deny', (await history(c.agB, m1.id)).length === 0, `${(await history(c.agB, m1.id)).length} event(s)`);
  check('the other owner reads that history', 'deny', (await history(c.ownerO2, m1.id)).length === 0, `${(await history(c.ownerO2, m1.id)).length} event(s)`);

  section('A credit is a record only');
  const unapplied = must(await c.agA.from('makegoods').select('id, promised_value').eq('promised_remedy_type', 'credit').is('credit_applied_at', null).neq('status', 'waived').eq('campaign_id', state.campaigns.A), 'unapplied');
  check('the credit is listed as a separate, not-yet-applied item', 'allow', unapplied.length === 1 && Number(unapplied[0].promised_value) === 150000, `${unapplied.length} item, ₦${unapplied[0]?.promised_value}`);
  const applied = await upd(c.agA, m2.id, { credit_applied_at: new Date().toISOString() });
  check('agency A ticks the credit off as applied by hand', 'allow', one(applied) && !!applied.data[0].credit_applied_at, describe(applied));
  const after = JSON.stringify(must(await admin.from('bookings').select('id, offered_rate, agreed_rate, gross_rate, discount_pct, production_cost, status, mpo_number').in('id', [BK.existing, BK.original, BK.replacement]).order('id'), 'after'));
  check('no booking rate, discount, production cost, status or MPO changed', 'allow', before === after, before === after ? 'rates on all 3 plan lines identical before and after' : 'CHANGED');
  const invAfter = must(await admin.from('invoices').select('id').eq('campaign_id', state.campaigns.A), 'inv after').length;
  check('no invoice was created or altered', 'allow', invBefore === invAfter, `${invBefore} before, ${invAfter} after`);

  state.makegoods = [m1.id, m2.id];
  state.requests = [reqA, reqB];
  save(state);
  for (const r of out) console.log(r.result ? `${r.result.padEnd(6)}${r.check}${r.detail ? '  ->  ' + r.detail : ''}` : r.check);
  const fails = out.filter(r => r.result === 'FAIL').length;
  console.log(`\n${out.filter(r => r.result === 'PASS').length} passed, ${fails} failed`);
  process.exitCode = fails ? 1 : 0;
}

async function cleanup() {
  if (!existsSync(stateFile)) { console.log('nothing to clean'); return; }
  const state = JSON.parse(readFileSync(stateFile, 'utf8'));
  const userIds = Object.values(state.users).map(u => u.id);
  const boardIds = Object.values(state.boards);
  const bookingIds = Object.values(state.bookings);
  const mg = bookingIds.length ? rows(await admin.from('makegoods').select('id').in('booking_id', bookingIds)).map(m => m.id) : [];
  if (mg.length) await admin.from('activity_events').delete().eq('entity_type', 'makegood').in('entity_id', mg);
  await admin.from('activity_events').delete().in('actor_id', userIds);
  await admin.from('notifications').delete().in('recipient_user_id', userIds);
  await admin.from('availability_requests').delete().in('agency_id', userIds);
  await admin.from('campaigns').delete().in('agency_id', userIds); // bookings, messages and makegoods cascade
  if (boardIds.length) must(await admin.from('boards').delete().in('id', boardIds), 'del boards');
  for (const id of userIds) {
    await admin.from('partner_kyc').delete().eq('id', id);
    await admin.from('profiles').delete().eq('id', id);
    must(await admin.auth.admin.deleteUser(id), 'del user');
  }
  rmSync(stateFile);
  console.log('cleanup done: test agencies, owners, marketer, boards, campaigns, bookings, preferences, makegoods, history and notifications removed');
}

await ({ setup, verify, cleanup }[stage] ?? (() => { console.log('usage: setup | verify | cleanup  <state-file>'); }))();
