// Verifies migration 035: private rate cards, owner teams/marketers, request
// routing, deal attribution, targets, share links and board claims — using
// throwaway accounts only.
//
//   node scripts/verify-owner-teams-rls.mjs setup   <state-file>
//   node scripts/verify-owner-teams-rls.mjs verify  <state-file> [app-url]
//   node scripts/verify-owner-teams-rls.mjs cleanup <state-file>
//
// Pass an app URL to also exercise the public share-link routes. Reads
// Supabase keys from .env.local. Test boards use a made-up city and status
// 'unavailable' except where availability matters. Passwords go to the state
// file (keep it outside the repo), never to stdout.
import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split(/\r?\n/).filter(l => /^[A-Z_]+=/.test(l)).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
);
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL, ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY, SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
const [stage, stateFile = '.owner-teams-state.json', appUrl] = process.argv.slice(2);
const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });
const TAG = 'qa-team';
const CITY = 'ZZ QA Team City';

const must = ({ data, error }, what) => { if (error) throw new Error(`${what}: ${error.message}`); return data; };
const save = state => writeFileSync(stateFile, JSON.stringify(state, null, 2));
// A read that is refused outright (no table privilege, e.g. for anonymous visitors) counts as seeing nothing.
const rows = ({ data, error }) => (error ? [] : data ?? []);

async function setup() {
  const state = { users: {}, boards: {} };
  const people = [
    ['ownerA', 'owner', true], ['ownerB', 'owner', true], ['ownerU', 'owner', false],
    ['agV', 'agency', true], ['agP', 'agency', false], ['agN', 'agency', false],
    ['mA1', 'marketer', false], ['mA2', 'marketer', false], ['mB1', 'marketer', false],
  ];
  for (const [key, role, kyc] of people) {
    const email = `${TAG}-${key.toLowerCase()}-${randomBytes(3).toString('hex')}@example.com`;
    const password = randomBytes(18).toString('base64url');
    const name = `QA ${key}`;
    const { user } = must(await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { role, full_name: name } }), 'createUser');
    state.users[key] = { id: user.id, email, password, role };
    save(state);
    must(await admin.from('profiles').upsert({ id: user.id, role, full_name: name, company_name: name, email }), 'profile ' + key);
    if (kyc) must(await admin.from('partner_kyc').upsert({ id: user.id, cac_number: 'RC-QA-0001', tin_number: 'TIN-QA-0001' }), 'kyc ' + key);
  }
  const U = state.users;
  for (const [m, o, floor] of [['mA1', 'ownerA', false], ['mA2', 'ownerA', true], ['mB1', 'ownerB', false]]) {
    must(await admin.from('owner_team_members').insert({ owner_id: U[o].id, member_profile_id: U[m].id, member_name: `QA ${m}`, role: 'marketer', can_see_floor_rates: floor }), 'member ' + m);
  }
  must(await admin.from('owner_approved_agencies').insert({ owner_id: U.ownerA.id, agency_id: U.agP.id }), 'approve');
  const boards = [
    ['A1', U.ownerA.id, U.mA1.id, null, 500000, 'available'],                      // hidden (owner default)
    ['A2', U.ownerA.id, U.mA2.id, 'approved_agencies', 600000, 'available'],
    ['A3', U.ownerA.id, null, 'all_verified_agencies', 700000, 'available'],
    ['B1', U.ownerB.id, U.mB1.id, null, 900000, 'unavailable'],
  ];
  for (const [key, owner_id, assigned_marketer_id, rate_visibility, rate, status] of boards) {
    const b = must(await admin.from('boards').insert({ name: `[${TAG}] ${key}`, format: 'billboard', address: 'QA test - safe to delete', city: CITY, state: 'Lagos', asking_rate: rate, status, owner_id, assigned_marketer_id, rate_visibility }).select('id').single(), 'board ' + key);
    state.boards[key] = b.id;
    save(state);
  }
  must(await admin.from('board_rate_floors').insert({ board_id: state.boards.A1, max_discount_pct: 20 }), 'floor');
  const campaign = must(await admin.from('campaigns').insert({ agency_id: U.agV.id, name: `[${TAG}] campaign`, status: 'draft' }).select('id').single(), 'campaign');
  state.campaignId = campaign.id;
  save(state);
  console.log('setup done: 3 owners (one unverified), 3 agencies (verified / approved by A / neither), 3 marketers, 4 boards');
}

async function as(u) {
  const c = createClient(SUPABASE_URL, ANON, { auth: { persistSession: false } });
  must(await c.auth.signInWithPassword({ email: u.email, password: u.password }), 'signIn');
  return c;
}

async function verify() {
  const state = JSON.parse(readFileSync(stateFile, 'utf8'));
  const U = state.users, B = state.boards;
  const out = [];
  const check = (name, expect, ok, detail) => out.push({ result: ok ? 'PASS' : 'FAIL', check: `${name} [expect ${expect}]`, detail });
  const describe = r => r.error ? `rejected: ${r.error.message}` : `${Array.isArray(r.data) ? r.data.length + ' row(s)' : JSON.stringify(r.data)}`;
  const one = r => !r.error && (r.data ?? []).length === 1;
  const section = t => out.push({ result: '', check: `\n── ${t} ──`, detail: '' });

  const c = {};
  for (const k of Object.keys(U)) c[k] = await as(U[k]);
  const anon = createClient(SUPABASE_URL, ANON, { auth: { persistSession: false } });
  const aBoards = [B.A1, B.A2, B.A3];
  const ratesSeen = async cl => rows(await cl.from('board_rates').select('board_id, gross_monthly_rate').in('board_id', [...aBoards, B.B1])).map(r => Object.keys(B).find(k => B[k] === r.board_id)).sort().join(',');
  const floorsSeen = async cl => rows(await cl.from('board_rate_floors').select('board_id').in('board_id', aBoards)).length;

  section('Rates never sit on the public boards row');
  const pub = must(await anon.from('boards').select('id, asking_rate, rate_card').in('id', [...aBoards, B.B1]), 'public boards');
  check('anonymous read of boards returns no rate', 'deny', pub.length === 4 && pub.every(b => b.asking_rate === null && b.rate_card === null), `${pub.length} boards, ${pub.filter(b => b.asking_rate !== null).length} with a rate`);
  const moved = must(await admin.from('board_rates').select('board_id, gross_monthly_rate').in('board_id', aBoards), 'moved');
  check('rates entered on boards were moved to the private table', 'allow', moved.length === 3, moved.map(r => r.gross_monthly_rate).sort().join(', '));

  section('Rate visibility');
  for (const [k, expected, label] of [
    ['agN', '', 'agency with no approval and no KYC'],
    ['agP', 'A2', 'agency approved by owner A (sees only the approved-agencies board)'],
    ['agV', 'A3', 'verified agency (sees only the all-verified board)'],
    ['ownerB', 'B1', 'a different owner (sees only its own)'],
    ['mB1', 'B1', 'a different owner\'s marketer (sees only that company)'],
    ['ownerA', 'A1,A2,A3', 'owner A'],
    ['mA1', 'A1,A2,A3', 'owner A marketer (gross rates of own company)'],
  ]) {
    const seen = await ratesSeen(c[k]);
    check(`${label} reads rates`, expected ? 'only ' + expected : 'deny', seen === expected, `sees: ${seen || 'none'}`);
  }
  check('anonymous visitor reads rates', 'deny', (await ratesSeen(anon)) === '', `sees: ${(await ratesSeen(anon)) || 'none'}`);
  check('hidden rate A1 as unapproved agency', 'deny', !(await ratesSeen(c.agN)).includes('A1') && !(await ratesSeen(c.agV)).includes('A1') && !(await ratesSeen(c.agP)).includes('A1'), 'A1 visible to no agency');

  section('Floor rates');
  check('marketer WITHOUT floor access reads the floor', 'deny', (await floorsSeen(c.mA1)) === 0, `${await floorsSeen(c.mA1)} row(s)`);
  check('marketer WITH floor access reads the floor', 'allow', (await floorsSeen(c.mA2)) === 1, `${await floorsSeen(c.mA2)} row(s)`);
  check('owner A reads the floor', 'allow', (await floorsSeen(c.ownerA)) === 1, `${await floorsSeen(c.ownerA)} row(s)`);
  for (const k of ['agV', 'agP', 'agN', 'ownerB', 'mB1']) check(`${k} reads owner A's floor`, 'deny', (await floorsSeen(c[k])) === 0, `${await floorsSeen(c[k])} row(s)`);
  check('anonymous visitor reads the floor', 'deny', (await floorsSeen(anon)) === 0, `${await floorsSeen(anon)} row(s)`);

  section('Tampering with rates and settings');
  await c.agN.from('boards').update({ asking_rate: 1 }).eq('id', B.A1);
  const afterAgency = must(await admin.from('board_rates').select('gross_monthly_rate').eq('board_id', B.A1).single(), 'after');
  const boardAfter = must(await admin.from('boards').select('asking_rate').eq('id', B.A1).single(), 'board after');
  check('an agency overwrites owner A\'s rate through the boards row', 'deny', Number(afterAgency.gross_monthly_rate) === 500000 && boardAfter.asking_rate === null, `private rate still ${afterAgency.gross_monthly_rate}, public column ${boardAfter.asking_rate}`);
  const agWrite = await c.agN.from('board_rates').upsert({ board_id: B.A1, gross_monthly_rate: 1 }).select('board_id');
  check('an agency writes the private rate table directly', 'deny', !one(agWrite), describe(agWrite));
  const mWrite = await c.mA1.from('board_rates').update({ gross_monthly_rate: 1 }).eq('board_id', B.A1).select('board_id');
  check('a marketer changes a rate', 'deny', !one(mWrite), describe(mWrite));
  const mVis = await c.mA1.from('boards').update({ rate_visibility: 'all_verified_agencies' }).eq('id', B.A1).select('id');
  check('a marketer opens up rate visibility on their board', 'deny', !one(mVis), describe(mVis));
  const mAssign = await c.mA1.from('boards').update({ assigned_marketer_id: U.mA1.id }).eq('id', B.A3).select('id');
  check('a marketer assigns an unassigned board to themselves', 'deny', !one(mAssign), describe(mAssign));
  const agSteal = await c.agN.from('boards').update({ owner_id: U.ownerB.id }).eq('id', B.A1).select('id');
  check('an agency moves owner A\'s board to another owner', 'deny', !one(agSteal), describe(agSteal));
  const oVis = await c.ownerA.from('boards').update({ rate_visibility: 'hidden' }).eq('id', B.A1).select('id');
  check('owner A changes rate visibility on its own board', 'allow', one(oVis), describe(oVis));

  section('Team isolation between two owner companies');
  const team = async cl => must(await cl.from('owner_team_members').select('member_profile_id, owner_id'), 'team');
  check('owner A sees its 2 marketers', 'allow', (await team(c.ownerA)).length === 2, `${(await team(c.ownerA)).length} row(s)`);
  const bTeam = await team(c.ownerB);
  check('owner B sees only its own marketer, none of A\'s', 'deny', bTeam.length === 1 && bTeam[0].owner_id === U.ownerB.id, `${bTeam.length} row(s)`);
  const m1Team = await team(c.mA1);
  check('a marketer sees only their own team row', 'deny', m1Team.length === 1 && m1Team[0].member_profile_id === U.mA1.id, `${m1Team.length} row(s)`);
  check('an agency sees no team rows', 'deny', (await team(c.agV)).length === 0, `${(await team(c.agV)).length} row(s)`);
  const selfPromote = await c.mA1.from('owner_team_members').update({ can_see_floor_rates: true, role: 'admin' }).eq('member_profile_id', U.mA1.id).select('id');
  check('a marketer grants themselves floor access / admin', 'deny', !one(selfPromote), describe(selfPromote));
  const crossEdit = await c.ownerB.from('owner_team_members').update({ active: false }).eq('member_profile_id', U.mA1.id).select('id');
  check('owner B deactivates owner A\'s marketer', 'deny', !one(crossEdit), describe(crossEdit));
  const unverified = await admin.from('owner_team_members').insert({ owner_id: U.ownerU.id, member_profile_id: U.agN.id, role: 'marketer' }).select('id');
  check('adding a team member to an owner with no CAC/TIN on file', 'deny', !!unverified.error, describe(unverified));

  section('Targets');
  const week = { period_start: '2027-01-04', period_end: '2027-01-10' };
  const t1 = await c.ownerA.from('marketer_targets').insert({ owner_id: U.ownerA.id, marketer_id: U.mA1.id, ...week, target_value: 2000000, target_count: 3 }).select('id');
  check('owner A sets a weekly target for its marketer', 'allow', one(t1), describe(t1));
  const tCross = await c.ownerA.from('marketer_targets').insert({ owner_id: U.ownerA.id, marketer_id: U.mB1.id, ...week, target_value: 1, target_count: 1 }).select('id');
  check('owner A sets a target for owner B\'s marketer', 'deny', !one(tCross), describe(tCross));
  const tSelf = await c.mA1.from('marketer_targets').insert({ owner_id: U.ownerA.id, marketer_id: U.mA1.id, period_start: '2027-02-01', period_end: '2027-02-07', target_value: 1, target_count: 1 }).select('id');
  check('a marketer sets their own target', 'deny', !one(tSelf), describe(tSelf));
  const targets = async cl => must(await cl.from('marketer_targets').select('id'), 'targets').length;
  check('marketer mA1 reads their own target', 'allow', (await targets(c.mA1)) === 1, `${await targets(c.mA1)} row(s)`);
  check('another marketer in the same company reads it', 'deny', (await targets(c.mA2)) === 0, `${await targets(c.mA2)} row(s)`);
  check('owner B reads owner A\'s targets', 'deny', (await targets(c.ownerB)) === 0, `${await targets(c.ownerB)} row(s)`);
  check('owner B\'s marketer reads owner A\'s targets', 'deny', (await targets(c.mB1)) === 0, `${await targets(c.mB1)} row(s)`);

  section('Request routing');
  const assignee = async id => must(await admin.rpc('board_assignee', { p_board_id: id }), 'assignee');
  check('board A1 routes to its named marketer', 'allow', (await assignee(B.A1)) === U.mA1.id, 'mA1');
  check('unassigned board A3 routes to the owner', 'allow', (await assignee(B.A3)) === U.ownerA.id, 'ownerA');
  const mk = (boardId) => c.agV.from('bookings').insert({ campaign_id: state.campaignId, board_id: boardId, offered_rate: 450000, status: 'pending', start_date: '2027-01-01', end_date: '2027-03-31', duration_months: 3 }).select('id');
  const bk1 = await mk(B.A1), bk3 = await mk(B.A3);
  check('agency sends booking requests for A1 and A3', 'allow', one(bk1) && one(bk3), describe(bk1));
  const bk1Id = bk1.data?.[0]?.id, bk3Id = bk3.data?.[0]?.id;
  const notif = must(await admin.from('notifications').select('id').eq('recipient_user_id', U.mA1.id).eq('type', 'new_booking'), 'notif');
  check('the request for A1 notified its marketer', 'allow', notif.length === 1, `${notif.length} notification(s)`);
  const sees = async (cl, id) => must(await cl.from('bookings').select('id').eq('id', id), 'sees').length === 1;
  check('assigned marketer mA1 sees the A1 request', 'allow', await sees(c.mA1, bk1Id), '');
  check('owner A (admin) sees the A1 request', 'allow', await sees(c.ownerA, bk1Id), '');
  check('the other marketer mA2 sees the A1 request', 'deny', !(await sees(c.mA2, bk1Id)), '');
  check('mA1 sees the request for unassigned board A3', 'deny', !(await sees(c.mA1, bk3Id)), '');
  check('owner B sees owner A\'s request', 'deny', !(await sees(c.ownerB, bk1Id)), '');
  check('owner B\'s marketer sees owner A\'s request', 'deny', !(await sees(c.mB1, bk1Id)), '');
  const msgOk = await c.mA1.from('messages').insert({ booking_id: bk1Id, sender_role: 'owner', sender_id: U.mA1.id, content: `[${TAG}] counter`, message_type: 'message' }).select('id');
  check('assigned marketer replies in the negotiation thread', 'allow', one(msgOk), describe(msgOk));
  const msgNo = await c.mA2.from('messages').insert({ booking_id: bk1Id, sender_role: 'owner', sender_id: U.mA2.id, content: 'x', message_type: 'message' }).select('id');
  check('the other marketer replies in that thread', 'deny', !one(msgNo), describe(msgNo));

  section('Deal attribution');
  const spoof = await c.agV.from('bookings').update({ closed_by_marketer_id: U.mB1.id }).eq('id', bk1Id).select('closed_by_marketer_id');
  check('an agency sets closed_by_marketer_id itself', 'deny', spoof.data?.[0]?.closed_by_marketer_id == null, `stored: ${spoof.data?.[0]?.closed_by_marketer_id ?? 'null'}`);
  const close1 = await c.mA1.from('bookings').update({ status: 'agreed', agreed_rate: 450000 }).eq('id', bk1Id).select('closed_by_marketer_id, confirmed_at');
  check('marketer confirms the A1 deal and is credited', 'allow', one(close1) && close1.data[0].closed_by_marketer_id === U.mA1.id && !!close1.data[0].confirmed_at, close1.data?.[0]?.closed_by_marketer_id === U.mA1.id ? 'credited to mA1, confirmed_at set' : describe(close1));
  const close3 = await c.ownerA.from('bookings').update({ status: 'agreed', agreed_rate: 450000 }).eq('id', bk3Id).select('closed_by_marketer_id, confirmed_at');
  check('owner confirms a deal on an unassigned board: no marketer credited', 'allow', one(close3) && close3.data[0].closed_by_marketer_id === null && !!close3.data[0].confirmed_at, `credited to: ${close3.data?.[0]?.closed_by_marketer_id ?? 'nobody'}`);
  const bk2 = await mk(B.A2);
  const close2 = await c.ownerA.from('bookings').update({ status: 'agreed', agreed_rate: 450000 }).eq('id', bk2.data?.[0]?.id).select('closed_by_marketer_id');
  check('owner confirms a deal on a board assigned to mA2: mA2 is credited', 'allow', close2.data?.[0]?.closed_by_marketer_id === U.mA2.id, `credited to: ${close2.data?.[0]?.closed_by_marketer_id === U.mA2.id ? 'mA2' : close2.data?.[0]?.closed_by_marketer_id ?? 'nobody'}`);
  const reattr = await c.mA2.from('bookings').update({ closed_by_marketer_id: U.mA2.id }).eq('id', bk1Id).select('id');
  check('another marketer takes the credit for mA1\'s deal', 'deny', !one(reattr), describe(reattr));
  const credited = must(await admin.from('bookings').select('agreed_rate, duration_months').eq('closed_by_marketer_id', U.mA1.id), 'credited');
  check('target progress for mA1 = 1 deal worth 1,350,000', 'allow', credited.length === 1 && credited[0].agreed_rate * credited[0].duration_months === 1350000, `${credited.length} deal(s), value ${credited.reduce((s, b) => s + b.agreed_rate * b.duration_months, 0)}`);

  section('Deactivating a marketer');
  const off = await c.ownerA.from('owner_team_members').update({ active: false }).eq('member_profile_id', U.mA1.id).select('id');
  check('owner A deactivates mA1', 'allow', one(off), describe(off));
  check('board A1 now routes to the owner — nothing is orphaned', 'allow', (await assignee(B.A1)) === U.ownerA.id, 'ownerA');
  const bk1b = await mk(B.A1);
  check('deactivated marketer sees a NEW request on their old board', 'deny', !(await sees(c.mA1, bk1b.data?.[0]?.id)), '');
  check('owner A sees that new request', 'allow', await sees(c.ownerA, bk1b.data?.[0]?.id), '');
  check('deactivated marketer still sees the deal they closed', 'allow', await sees(c.mA1, bk1Id), '');
  check('deactivated marketer reads company rates', 'deny', (await ratesSeen(c.mA1)) === '', `sees: ${(await ratesSeen(c.mA1)) || 'none'}`);
  must(await admin.from('owner_team_members').update({ active: true }).eq('member_profile_id', U.mA1.id), 'reactivate');

  section('Share links');
  const mine = await c.mA1.from('board_share_links').insert({ board_ids: [B.A1], title: `[${TAG}] link` }).select('*');
  check('marketer creates a link for their own board', 'allow', one(mine) && /^[0-9a-f]{64}$/.test(mine.data[0].token), one(mine) ? `token is ${mine.data[0].token.length} hex chars` : describe(mine));
  const notMine = await c.mA1.from('board_share_links').insert({ board_ids: [B.A2] }).select('id');
  check('marketer creates a link for a colleague\'s board', 'deny', !one(notMine), describe(notMine));
  const otherCo = await c.mA1.from('board_share_links').insert({ board_ids: [B.B1] }).select('id');
  check('marketer creates a link for another owner\'s board', 'deny', !one(otherCo), describe(otherCo));
  const agLink = await c.agV.from('board_share_links').insert({ board_ids: [B.A3] }).select('id');
  check('an agency creates a share link', 'deny', !one(agLink), describe(agLink));
  const forge = await c.mA1.from('board_share_links').update({ open_count: 999 }).eq('id', mine.data?.[0]?.id).select('id');
  check('marketer inflates their own open count', 'deny', !one(forge), describe(forge));
  const ownerLink = await c.ownerA.from('board_share_links').insert({ board_ids: [B.A2, B.A3], title: `[${TAG}] owner link` }).select('*');
  check('owner creates a link across the company\'s boards', 'allow', one(ownerLink), describe(ownerLink));
  const links = async cl => rows(await cl.from('board_share_links').select('id')).length;
  check('owner A sees both links', 'allow', (await links(c.ownerA)) === 2, `${await links(c.ownerA)} row(s)`);
  check('marketer sees only their own link', 'deny', (await links(c.mA1)) === 1, `${await links(c.mA1)} row(s)`);
  for (const k of ['ownerB', 'mB1', 'agV']) check(`${k} sees owner A's links`, 'deny', (await links(c[k])) === 0, `${await links(c[k])} row(s)`);
  check('anonymous visitor lists share links', 'deny', (await links(anon)) === 0, `${await links(anon)} row(s)`);

  if (appUrl) {
    const get = async token => { const r = await fetch(`${appUrl}/api/share/${token}`); return { status: r.status, body: await r.json().catch(() => ({})) }; };
    const tok = mine.data[0].token, ownerTok = ownerLink.data[0].token;
    const v1 = await get(tok);
    check('route: link opens and lists exactly its 1 board', 'allow', v1.status === 200 && v1.body.boards?.length === 1 && v1.body.boards[0].id === B.A1, `HTTP ${v1.status}, ${v1.body.boards?.length} board(s)`);
    check('route: HIDDEN rate on a share link', 'deny', v1.body.boards?.[0]?.rate === null, `rate: ${v1.body.boards?.[0]?.rate ?? 'Contact for rate'}`);
    const leaked = JSON.stringify(v1.body);
    check('route: response carries no rate, floor or owner id', 'deny', !/500000|max_discount|owner_id|assigned_marketer/.test(leaked), 'none found');
    const v2 = await get(ownerTok);
    const r2 = Object.fromEntries((v2.body.boards ?? []).map(b => [b.id, b.rate]));
    check('route: approved-agencies board shows no rate; all-verified board shows its rate', 'allow', r2[B.A2] === null && Number(r2[B.A3]) === 700000, `A2: ${r2[B.A2] ?? 'Contact for rate'}, A3: ${r2[B.A3]}`);
    const opened = must(await admin.from('board_share_links').select('open_count, last_opened_at').eq('id', mine.data[0].id).single(), 'opened');
    check('route: the open was counted', 'allow', opened.open_count === 1 && !!opened.last_opened_at, `open_count ${opened.open_count}`);
    const req = await fetch(`${appUrl}/api/share/${tok}/request`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ boardId: B.A1, name: 'QA Buyer', contact: '0800 000 0000', company: 'QA Brand' }) });
    check('route: "Request this board" is accepted', 'allow', req.status === 200, `HTTP ${req.status}`);
    const wrong = await fetch(`${appUrl}/api/share/${tok}/request`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ boardId: B.A3, name: 'QA Buyer', contact: 'x' }) });
    check('route: requesting a board that is not on the link', 'deny', wrong.status === 400, `HTTP ${wrong.status}`);
    const leads = async cl => must(await cl.from('share_link_requests').select('id, assignee_id'), 'leads');
    const lead = await leads(c.mA1);
    check('the enquiry reached the board\'s marketer', 'allow', lead.length === 1 && lead[0].assignee_id === U.mA1.id, `${lead.length} lead(s)`);
    check('owner A sees the enquiry too', 'allow', (await leads(c.ownerA)).length === 1, `${(await leads(c.ownerA)).length} lead(s)`);
    check('the other marketer sees it', 'deny', (await leads(c.mA2)).length === 0, `${(await leads(c.mA2)).length} lead(s)`);
    check('owner B sees it', 'deny', (await leads(c.ownerB)).length === 0, `${(await leads(c.ownerB)).length} lead(s)`);
    const rev = await c.mA1.from('board_share_links').update({ revoked_at: new Date().toISOString() }).eq('id', mine.data[0].id).select('id');
    check('marketer revokes their link', 'allow', one(rev), describe(rev));
    check('route: a revoked link no longer opens', 'deny', (await get(tok)).status === 410, `HTTP ${(await get(tok)).status}`);
    must(await admin.from('board_share_links').update({ expires_at: '2020-01-01T00:00:00Z' }).eq('id', ownerLink.data[0].id), 'expire');
    check('route: an expired link no longer opens', 'deny', (await get(ownerTok)).status === 410, `HTTP ${(await get(ownerTok)).status}`);
    check('route: a guessed token', 'deny', (await get('0'.repeat(64))).status === 404, `HTTP ${(await get('0'.repeat(64))).status}`);
  } else {
    out.push({ result: 'SKIP', check: 'public share-link route checks', detail: 'no app URL given' });
  }

  section('Agency-registered board, later claimed by the real owner');
  const agBoard = await c.agN.from('boards').insert({ name: `[${TAG}] agency-registered`, format: 'billboard', address: 'QA test - safe to delete', city: CITY, state: 'Lagos', asking_rate: 300000, status: 'unavailable', partner_name: 'QA ownerB' }).select('id');
  check('agency registers a board for an owner who is not on the platform', 'allow', one(agBoard), describe(agBoard));
  const agBoardId = agBoard.data?.[0]?.id;
  if (agBoardId) { state.boards.agencyRegistered = agBoardId; save(state); }
  const own = async cl => must(await cl.from('board_rates').select('gross_monthly_rate').eq('board_id', agBoardId), 'own rate').length;
  check('the registering agency sees the rate it entered', 'allow', (await own(c.agN)) === 1, `${await own(c.agN)} row(s)`);
  check('another agency sees that rate', 'deny', (await own(c.agV)) === 0, `${await own(c.agV)} row(s)`);
  const claim = await c.ownerB.from('board_claims').insert({ board_id: agBoardId }).select('id');
  check('owner B claims the board', 'allow', one(claim), describe(claim));
  const agClaim = await c.agV.from('board_claims').insert({ board_id: agBoardId }).select('id');
  check('an agency files an ownership claim', 'deny', !one(agClaim), describe(agClaim));
  const selfApprove = await c.ownerB.rpc('decide_board_claim', { p_claim_id: claim.data?.[0]?.id, p_approve: true });
  check('owner B approves its own claim', 'deny', !!selfApprove.error, describe(selfApprove));
  const grab = await c.ownerB.from('boards').update({ owner_id: U.ownerB.id }).eq('id', agBoardId).select('id');
  check('owner B takes the board without approval', 'deny', !one(grab), describe(grab));
  const approve = await c.agN.rpc('decide_board_claim', { p_claim_id: claim.data?.[0]?.id, p_approve: true });
  const nowOwner = must(await admin.from('boards').select('owner_id').eq('id', agBoardId).single(), 'owner');
  check('the registering agency confirms the claim; owner B now owns the board', 'allow', !approve.error && nowOwner.owner_id === U.ownerB.id, approve.error ? describe(approve) : 'owner_id = ownerB');
  check('owner B now manages the rate', 'allow', (await own(c.ownerB)) === 1, `${await own(c.ownerB)} row(s)`);
  check('the agency no longer sees the rate (owner default is hidden)', 'deny', (await own(c.agN)) === 0, `${await own(c.agN)} row(s)`);

  for (const r of out) console.log(r.result ? `${r.result.padEnd(6)}${r.check}${r.detail ? '  ->  ' + r.detail : ''}` : r.check);
  const fails = out.filter(r => r.result === 'FAIL').length;
  console.log(`\n${out.filter(r => r.result === 'PASS').length} passed, ${fails} failed`);
  process.exitCode = fails ? 1 : 0;
}

async function cleanup() {
  if (!existsSync(stateFile)) { console.log('nothing to clean'); return; }
  const state = JSON.parse(readFileSync(stateFile, 'utf8'));
  const userIds = Object.values(state.users).map(u => u.id);
  await admin.from('notifications').delete().in('recipient_user_id', userIds);
  if (state.campaignId) {
    await admin.from('bookings').delete().eq('campaign_id', state.campaignId);
    await admin.from('campaigns').delete().eq('id', state.campaignId);
  }
  await admin.from('board_share_links').delete().in('owner_id', userIds);
  const boardIds = Object.values(state.boards);
  if (boardIds.length) must(await admin.from('boards').delete().in('id', boardIds), 'del boards');
  await admin.from('boards').delete().in('created_by', userIds);
  for (const id of userIds) {
    await admin.from('partner_kyc').delete().eq('id', id);
    await admin.from('profiles').delete().eq('id', id);
    must(await admin.auth.admin.deleteUser(id), 'del user');
  }
  rmSync(stateFile);
  console.log('cleanup done: test owners, agencies, marketers, boards, bookings, links and notifications removed');
}

await ({ setup, verify, cleanup }[stage] ?? (() => { console.log('usage: setup | verify | cleanup  <state-file> [app-url]'); }))();
