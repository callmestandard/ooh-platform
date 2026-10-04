// Verifies the print-tracking permission model (030_print_tasks.sql) with
// throwaway accounts: the campaign's agency (A), an unrelated agency (X),
// the campaign's client (C) and a verified board owner (O).
//
//   node scripts/verify-print-tasks-rls.mjs setup   <state-file>
//   node scripts/verify-print-tasks-rls.mjs verify  <state-file>
//   node scripts/verify-print-tasks-rls.mjs cleanup <state-file>
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
const [stage, stateFile = '.print-rls-state.json'] = process.argv.slice(2);
const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });
const TAG = 'qa-print';
const CITY = 'ZZ QA Print City';

const must = ({ data, error }, what) => { if (error) throw new Error(`${what}: ${error.message}`); return data; };
const save = state => writeFileSync(stateFile, JSON.stringify(state, null, 2));

async function setup() {
  const state = { users: {}, boards: {}, bookings: {} };
  for (const [key, role] of [['A', 'agency'], ['X', 'agency'], ['C', 'client'], ['O', 'owner']]) {
    const email = `${TAG}-${key.toLowerCase()}-${randomBytes(3).toString('hex')}@example.com`;
    const password = randomBytes(18).toString('base64url');
    const name = `QA Print ${role} ${key}`;
    const { user } = must(await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { role, full_name: name } }), 'createUser');
    state.users[key] = { id: user.id, email, password, role };
    save(state);
    must(await admin.from('profiles').upsert({ id: user.id, role, full_name: name, company_name: name }), 'profile');
  }
  const { A, C, O } = state.users;
  // owned: O is the verified owner. unowned: no owner account at all.
  for (const [key, owner_id] of [['owned', O.id], ['unowned', null]]) {
    const b = must(await admin.from('boards').insert({ name: `[${TAG}] ${key} board`, format: 'billboard', address: 'QA test - safe to delete', city: CITY, state: 'Lagos', asking_rate: 100000, status: 'unavailable', owner_id }).select('id').single(), 'board');
    state.boards[key] = b.id;
    save(state);
  }
  const campaign = must(await admin.from('campaigns').insert({ agency_id: A.id, client_id: C.id, name: `[${TAG}] campaign`, status: 'draft' }).select('id').single(), 'campaign');
  state.campaignId = campaign.id;
  save(state);
  // One booking per scenario (print_tasks is 1:1 with bookings).
  for (const [key, board] of [['agencyTask', 'owned'], ['clientTask', 'owned'], ['ownerTask', 'owned'], ['unverifiedOwnerTask', 'unowned'], ['reassignTask', 'owned'], ['outsiderTarget', 'owned']]) {
    const bk = must(await admin.from('bookings').insert({ campaign_id: campaign.id, board_id: state.boards[board], offered_rate: 100000, agreed_rate: 100000, status: 'agreed', duration_months: 1, print_required: true }).select('id').single(), 'booking');
    state.bookings[key] = bk.id;
    save(state);
  }
  console.log('setup done: agency A, outside agency X, client C, verified owner O; 2 boards, 6 bookings');
}

async function as(u) {
  const c = createClient(SUPABASE_URL, ANON, { auth: { persistSession: false } });
  must(await c.auth.signInWithPassword({ email: u.email, password: u.password }), 'signIn');
  return c;
}

async function verify() {
  const state = JSON.parse(readFileSync(stateFile, 'utf8'));
  const { A, X, C, O } = state.users;
  const bk = state.bookings;
  const out = [];
  // expect: 'allow' | 'deny'
  const check = (name, expect, ok, detail) => out.push({ result: ok ? 'PASS' : 'FAIL', check: `${name} [expect ${expect}]`, detail });

  const a = await as(A), x = await as(X), c = await as(C), o = await as(O);
  const who = { A: a, X: x, C: c, O: o };

  const create = (cl, bookingId, party) => cl.from('print_tasks').insert({ booking_id: bookingId, campaign_id: state.campaignId, responsible_party: party, status: 'not_started' }).select('*');
  const update = (cl, id, patch) => cl.from('print_tasks').update(patch).eq('id', id).select('*');
  const allowed = r => !r.error && (r.data ?? []).length === 1;
  const describe = r => r.error ? `rejected: ${r.error.message}` : `${(r.data ?? []).length} row(s)`;

  // ── Create ──
  for (const k of ['X', 'C', 'O']) {
    const r = await create(who[k], bk.outsiderTarget, 'agency');
    check(`${k} creates a print task on A's booking`, 'deny', !allowed(r), describe(r));
  }
  const tasks = {};
  for (const [key, party] of [['agencyTask', 'agency'], ['clientTask', 'client'], ['ownerTask', 'board_owner'], ['unverifiedOwnerTask', 'board_owner'], ['reassignTask', 'agency']]) {
    const r = await create(a, bk[key], party);
    check(`A creates ${key} (${party})`, 'allow', allowed(r), describe(r));
    tasks[key] = r.data?.[0]?.id;
  }
  state.tasks = tasks;
  save(state);

  // ── Read ──
  const visible = async cl => must(await cl.from('print_tasks').select('id').in('id', Object.values(tasks)), 'read').length;
  check('A reads all 5 tasks', 'allow', (await visible(a)) === 5, `${await visible(a)} visible`);
  check('C (client of the campaign) reads all 5 tasks', 'allow', (await visible(c)) === 5, `${await visible(c)} visible`);
  const oSeen = must(await o.from('print_tasks').select('id').in('id', Object.values(tasks)), 'read').map(r => r.id);
  check('O reads the 4 tasks on its own board, not the one on the unowned board', 'allow', oSeen.length === 4 && !oSeen.includes(tasks.unverifiedOwnerTask), `${oSeen.length} visible`);
  check('X (unrelated agency) reads any task', 'deny', (await visible(x)) === 0, `${await visible(x)} visible`);

  // ── Update: only the responsible party ──
  const matrix = [
    ['agencyTask', 'agency', { A: true, C: false, O: false, X: false }],
    ['clientTask', 'client', { C: true, A: false, O: false, X: false }],
    ['ownerTask', 'board_owner (verified owner O)', { O: true, A: false, C: false, X: false }],
    ['unverifiedOwnerTask', 'board_owner (no owner account)', { A: true, C: false, O: false, X: false }],
  ];
  for (const [key, label, perms] of matrix) {
    // denied parties first, so the task is still at not_started when the allowed one advances it
    for (const k of Object.keys(perms).filter(k => !perms[k])) {
      const r = await update(who[k], tasks[key], { status: 'in_production' });
      check(`${k} advances ${label} task`, 'deny', !allowed(r), describe(r));
    }
    for (const k of Object.keys(perms).filter(k => perms[k])) {
      const r = await update(who[k], tasks[key], { status: 'in_production' });
      check(`${k} advances ${label} task`, 'allow', allowed(r) && r.data[0].status === 'in_production', describe(r));
    }
  }

  // ── Forward-only ──
  const back = await update(a, tasks.agencyTask, { status: 'not_started' });
  check('A moves its own task backward (in_production -> not_started)', 'deny', !allowed(back), describe(back));

  // ── Server-computed audit fields can't be spoofed ──
  const spoof = await update(a, tasks.unverifiedOwnerTask, { status: 'printed', updated_on_behalf_of_owner: false, updated_by: O.id });
  const s = spoof.data?.[0];
  check('A updates unowned-board task claiming it was the owner', 'allow', allowed(spoof) && s.updated_on_behalf_of_owner === true && s.updated_by === A.id, s ? `stored on_behalf_of_owner=${s.updated_on_behalf_of_owner}, updated_by is ${s.updated_by === A.id ? 'A' : 'NOT A'}` : describe(spoof));
  const spoof2 = await update(o, tasks.ownerTask, { status: 'printed', updated_on_behalf_of_owner: true });
  const s2 = spoof2.data?.[0];
  check('O updates its own task with on_behalf_of_owner=true', 'allow', allowed(spoof2) && s2.updated_on_behalf_of_owner === false, s2 ? `stored on_behalf_of_owner=${s2.updated_on_behalf_of_owner}` : describe(spoof2));

  // ── Reassignment ──
  const cReassign = await update(c, tasks.clientTask, { responsible_party: 'agency' });
  check('C reassigns its own task to someone else', 'deny', !allowed(cReassign), describe(cReassign));
  const oReassign = await update(o, tasks.ownerTask, { responsible_party: 'agency' });
  check('O reassigns its own task to someone else', 'deny', !allowed(oReassign), describe(oReassign));
  const r1 = await update(a, tasks.reassignTask, { responsible_party: 'client' });
  check('A reassigns agency task to client', 'allow', allowed(r1) && r1.data[0].responsible_party === 'client', describe(r1));
  const r2 = await update(a, tasks.clientTask, { responsible_party: 'agency' });
  check('A takes a client task back to agency', 'allow', allowed(r2) && r2.data[0].responsible_party === 'agency', describe(r2));
  const r3 = await update(a, tasks.ownerTask, { responsible_party: 'agency' });
  check('A reassigns a verified-owner task to agency', 'allow', allowed(r3) && r3.data[0].responsible_party === 'agency', describe(r3));

  // ── Delete ──
  for (const k of ['A', 'C', 'O', 'X']) {
    const r = await who[k].from('print_tasks').delete().eq('id', tasks.agencyTask).select('id');
    check(`${k} deletes a print task`, 'deny', !!r.error || (r.data ?? []).length === 0, describe(r));
  }

  // ── History (activity_events) ──
  const ev = await a.from('activity_events').insert({ entity_type: 'print_task', entity_id: tasks.ownerTask, campaign_id: state.campaignId, actor_id: A.id, actor_role: 'agency', actor_name: 'QA', action: 'print_task.status_changed', summary: `[${TAG}] history row` }).select('id');
  check('A logs print history', 'allow', allowed(ev), describe(ev));
  const hist = async cl => must(await cl.from('activity_events').select('id').eq('entity_type', 'print_task').eq('entity_id', tasks.ownerTask), 'history').length;
  check('O reads history of the task on its board', 'allow', (await hist(o)) === 1, `${await hist(o)} rows`);
  check('C reads history of the task on its campaign', 'allow', (await hist(c)) === 1, `${await hist(c)} rows`);
  check('X reads that history', 'deny', (await hist(x)) === 0, `${await hist(x)} rows`);

  for (const r of out) console.log(`${r.result.padEnd(6)}${r.check}  ->  ${r.detail}`);
  const fails = out.filter(r => r.result === 'FAIL').length;
  console.log(`\n${out.length - fails} passed, ${fails} failed`);
  process.exitCode = fails ? 1 : 0;
}

async function cleanup() {
  if (!existsSync(stateFile)) { console.log('nothing to clean'); return; }
  const state = JSON.parse(readFileSync(stateFile, 'utf8'));
  if (state.campaignId) {
    await admin.from('activity_events').delete().eq('campaign_id', state.campaignId);
    await admin.from('print_tasks').delete().eq('campaign_id', state.campaignId);
    must(await admin.from('bookings').delete().eq('campaign_id', state.campaignId), 'del bookings');
    must(await admin.from('campaigns').delete().eq('id', state.campaignId), 'del campaign');
  }
  const boardIds = Object.values(state.boards);
  if (boardIds.length) must(await admin.from('boards').delete().in('id', boardIds), 'del boards');
  for (const u of Object.values(state.users)) {
    await admin.from('activity_events').delete().eq('actor_id', u.id);
    await admin.from('profiles').delete().eq('id', u.id);
    must(await admin.auth.admin.deleteUser(u.id), 'del user');
  }
  rmSync(stateFile);
  console.log('cleanup done: test users, campaign, bookings, boards, print tasks and history removed');
}

await ({ setup, verify, cleanup }[stage] ?? (() => { console.log('usage: setup | verify | cleanup  <state-file>'); }))();
