// Verifies budget-estimator isolation between two throwaway test agencies.
//
//   node scripts/verify-estimator-rls.mjs setup   <state-file>   create agencies A and B with known deals
//   node scripts/verify-estimator-rls.mjs verify  <state-file>   sign in as each and try to cross the boundary
//   node scripts/verify-estimator-rls.mjs cleanup <state-file>   delete everything setup created
//
// Reads NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY
// from .env.local. Test boards use a made-up city and status 'unavailable' so
// they never appear in the marketplace or city pages. Generated passwords are
// written to the state file (keep it outside the repo), never printed.
import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split(/\r?\n/).filter(l => /^[A-Z_]+=/.test(l)).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
);
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL, ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY, SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
const [stage, stateFile = '.estimator-rls-state.json'] = process.argv.slice(2);
const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });
const CITY = 'ZZ QA Estimator City';
const TAG = 'qa-estimator';

const must = ({ data, error }, what) => { if (error) throw new Error(`${what}: ${error.message}`); return data; };

async function setup() {
  const state = { agencies: {}, boards: [] };
  const plan = {
    // A: 4 digital deals (enough) + 2 unipole deals (below the 3-deal minimum)
    A: [['digital', 400000], ['digital', 500000], ['digital', 600000], ['digital', 800000], ['unipole', 900000], ['unipole', 1100000]],
    // B: 5 digital deals at a wildly different rate — would visibly skew A if it leaked
    B: [['digital', 5000000], ['digital', 5000000], ['digital', 5000000], ['digital', 5000000], ['digital', 5000000]],
  };
  for (const key of ['A', 'B']) {
    const email = `${TAG}-${key.toLowerCase()}-${randomBytes(3).toString('hex')}@example.com`;
    const password = randomBytes(18).toString('base64url');
    const { user } = must(await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { role: 'agency', full_name: `QA Estimator Agency ${key}` } }), 'createUser');
    state.agencies[key] = { id: user.id, email, password, bookingIds: [] };
    writeFileSync(stateFile, JSON.stringify(state, null, 2));
    must(await admin.from('profiles').upsert({ id: user.id, role: 'agency', full_name: `QA Estimator Agency ${key}`, company_name: `QA Estimator Agency ${key}` }), 'profile');
    const campaign = must(await admin.from('campaigns').insert({ agency_id: user.id, name: `[${TAG}] Agency ${key} history`, status: 'draft' }).select('id').single(), 'campaign');
    state.agencies[key].campaignId = campaign.id;
    for (const [format, rate] of plan[key]) {
      const board = must(await admin.from('boards').insert({ name: `[${TAG}] ${key} ${format} ${rate}`, format, address: 'QA test - safe to delete', city: CITY, state: 'Lagos', asking_rate: rate, status: 'unavailable' }).select('id').single(), 'board');
      state.boards.push(board.id);
      const booking = must(await admin.from('bookings').insert({ campaign_id: campaign.id, board_id: board.id, offered_rate: rate, agreed_rate: rate, status: 'agreed', duration_months: 1 }).select('id').single(), 'booking');
      state.agencies[key].bookingIds.push(booking.id);
      writeFileSync(stateFile, JSON.stringify(state, null, 2));
    }
  }
  console.log(`setup done: agencies A (${plan.A.length} deals) and B (${plan.B.length} deals) in "${CITY}"`);
}

async function asAgency(a) {
  const c = createClient(SUPABASE_URL, ANON, { auth: { persistSession: false } });
  must(await c.auth.signInWithPassword({ email: a.email, password: a.password }), 'signIn');
  return c;
}

async function verify() {
  const state = JSON.parse(readFileSync(stateFile, 'utf8'));
  const { A, B } = state.agencies;
  const out = [];
  const check = (name, pass, detail) => { out.push({ check: name, result: pass ? 'PASS' : 'FAIL', detail }); };

  const tableExists = !(await admin.from('budget_estimates').select('id').limit(1)).error;
  const pairs = [[A, B, 'A', 'B'], [B, A, 'B', 'A']];

  for (const [me, other, meKey, otherKey] of pairs) {
    const c = await asAgency(me);

    // 1. The estimator query itself (same as fetchOwnDeals in src/lib/budget-estimator.ts)
    const own = must(await c.from('bookings').select('id, agreed_rate, campaigns!inner(agency_id), boards!inner(format, city)').eq('campaigns.agency_id', me.id).not('agreed_rate', 'is', null).in('status', ['agreed', 'signed', 'live', 'completed', 'complete']), 'own deals');
    const ownIds = own.map(r => r.id).sort();
    check(`${meKey}: estimator query returns exactly its own deals`, JSON.stringify(ownIds) === JSON.stringify([...me.bookingIds].sort()), `${own.length} rows, rates ${own.map(r => r.agreed_rate).sort((x, y) => x - y).join(', ')}`);

    // 2. Unfiltered read of every booking in the test city — RLS alone must hide the other agency
    const all = must(await c.from('bookings').select('id, agreed_rate, boards!inner(city)').eq('boards.city', CITY), 'all bookings');
    check(`${meKey}: unfiltered bookings read shows none of ${otherKey}`, !all.some(r => other.bookingIds.includes(r.id)), `${all.length} rows visible`);

    // 3. Direct read of the other agency bookings by id
    const direct = must(await c.from('bookings').select('id, agreed_rate').in('id', other.bookingIds), 'direct');
    check(`${meKey}: direct read of ${otherKey} booking ids`, direct.length === 0, `${direct.length} rows returned`);

    // 4. Pretend to be the other agency in the estimator filter
    const spoof = must(await c.from('bookings').select('id, campaigns!inner(agency_id)').eq('campaigns.agency_id', other.id), 'spoof');
    check(`${meKey}: estimator query with ${otherKey} agency id`, spoof.length === 0, `${spoof.length} rows returned`);

    // 5. Read the other agency campaign
    const camp = must(await c.from('campaigns').select('id').eq('id', other.campaignId), 'campaign');
    check(`${meKey}: read ${otherKey} campaign`, camp.length === 0, `${camp.length} rows returned`);

    // 6. Try to plant a deal on the other agency campaign (would influence their estimate)
    const plant = await c.from('bookings').insert({ campaign_id: other.campaignId, board_id: state.boards[0], agreed_rate: 1, offered_rate: 1, status: 'agreed' }).select('id');
    check(`${meKey}: insert a booking into ${otherKey} campaign`, !!plant.error || (plant.data ?? []).length === 0, plant.error ? `rejected: ${plant.error.message}` : 'no row created');

    // 7. Try to change one of the other agency agreed rates
    const tamper = await c.from('bookings').update({ agreed_rate: 1 }).eq('id', other.bookingIds[0]).select('id');
    check(`${meKey}: update ${otherKey} agreed_rate`, !!tamper.error || (tamper.data ?? []).length === 0, tamper.error ? `rejected: ${tamper.error.message}` : '0 rows updated');

    if (tableExists) {
      const line = [{ city: CITY, formatKey: 'digital', boards: 1, source: 'manual' }];
      const mine = await c.from('budget_estimates').insert({ agency_id: me.id, brief_label: `[${TAG}] ${meKey} brief`, duration_months: 1, lines: line, low_total: 1, high_total: 2 }).select('id');
      check(`${meKey}: save own estimate`, !mine.error && mine.data.length === 1, mine.error?.message ?? 'saved');
      const forged = await c.from('budget_estimates').insert({ agency_id: other.id, brief_label: `[${TAG}] forged`, duration_months: 1, lines: line, low_total: 1, high_total: 2 }).select('id');
      check(`${meKey}: save an estimate as ${otherKey}`, !!forged.error, forged.error ? `rejected: ${forged.error.message}` : 'ROW CREATED');
      const cross = await c.from('budget_estimates').insert({ agency_id: me.id, campaign_id: other.campaignId, duration_months: 1, lines: line, low_total: 1, high_total: 2 }).select('id');
      check(`${meKey}: save an estimate against ${otherKey} campaign`, !!cross.error, cross.error ? `rejected: ${cross.error.message}` : 'ROW CREATED');
    }
  }

  if (tableExists) {
    // After both have saved one: each must see only its own.
    for (const [me, other, meKey, otherKey] of pairs) {
      const c = await asAgency(me);
      const seen = must(await c.from('budget_estimates').select('id, agency_id'), 'estimates');
      check(`${meKey}: saved estimates visible are all its own`, seen.length >= 1 && seen.every(r => r.agency_id === me.id), `${seen.length} visible, ${seen.filter(r => r.agency_id === other.id).length} belonging to ${otherKey}`);
    }
  } else {
    out.push({ check: 'budget_estimates table', result: 'SKIPPED', detail: 'migration 031_budget_estimates.sql not applied yet' });
  }

  // Confirm the tamper attempts changed nothing (read back with the service role).
  const after = must(await admin.from('bookings').select('id, agreed_rate').in('id', [...A.bookingIds, ...B.bookingIds]), 'after');
  const extra = must(await admin.from('bookings').select('id').in('campaign_id', [A.campaignId, B.campaignId]), 'extra');
  check('no rate was altered and no booking was planted', after.every(r => Number(r.agreed_rate) > 1) && extra.length === A.bookingIds.length + B.bookingIds.length, `${extra.length} bookings, min rate ${Math.min(...after.map(r => Number(r.agreed_rate)))}`);

  for (const o of out) console.log(`${o.result.padEnd(8)}${o.check}  ->  ${o.detail}`);
  process.exitCode = out.some(o => o.result === 'FAIL') ? 1 : 0;
}

async function cleanup() {
  if (!existsSync(stateFile)) { console.log('nothing to clean'); return; }
  const state = JSON.parse(readFileSync(stateFile, 'utf8'));
  for (const a of Object.values(state.agencies)) {
    await admin.from('budget_estimates').delete().eq('agency_id', a.id);
    if (a.campaignId) {
      must(await admin.from('bookings').delete().eq('campaign_id', a.campaignId), 'del bookings');
      must(await admin.from('campaigns').delete().eq('id', a.campaignId), 'del campaign');
    }
  }
  if (state.boards.length) must(await admin.from('boards').delete().in('id', state.boards), 'del boards');
  for (const a of Object.values(state.agencies)) {
    await admin.from('profiles').delete().eq('id', a.id);
    must(await admin.auth.admin.deleteUser(a.id), 'del user');
  }
  rmSync(stateFile);
  console.log('cleanup done: test agencies, campaigns, bookings, boards and estimates removed');
}

await ({ setup, verify, cleanup }[stage] ?? (() => { console.log('usage: setup | verify | cleanup  <state-file>'); }))();
