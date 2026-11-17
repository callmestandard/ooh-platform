// Verifies possible-duplicate handling (057) with throwaway data: an admin, a
// buyer, and three test boards that are "the same board".
//
//   node scripts/verify-board-duplicates.mjs
//
// Reads Supabase keys from .env.local. Everything it creates is deleted at the end.
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split(/\r?\n/).filter(l => /^[A-Z_]+=/.test(l)).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
);
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL;
const admin = createClient(URL_, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const must = ({ data, error }, what) => { if (error) throw new Error(`${what}: ${error.message}`); return data; };

let fail = 0;
const check = (ok, what) => { console.log(ok ? 'PASS' : 'FAIL', what); if (!ok) fail++; };

async function user(role) {
  const email = `qa-dup-${role}-${randomBytes(3).toString('hex')}@example.com`, password = randomBytes(18).toString('base64url');
  const { user: u } = must(await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { role: 'agency', full_name: `QA Dup ${role}` } }), 'create user');
  if (role === 'admin') must(await admin.from('profiles').update({ role: 'admin' }).eq('id', u.id), 'make admin');
  const c = createClient(URL_, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  must(await c.auth.signInWithPassword({ email, password }), 'sign in');
  return { id: u.id, c };
}

const made = { users: [], boards: [] };
try {
  const adm = await user('admin'); made.users.push(adm.id);
  const buyer = await user('buyer'); made.users.push(buyer.id);

  const base = { city: 'Lagos', state: 'Lagos', format: 'billboard', status: 'available', source: 'QA duplicates test' };
  const [keep, withPin, third] = must(await admin.from('boards').insert([
    { ...base, name: 'QA DUP Along Test Road', photo_urls: ['https://example.com/qa-a.jpg'] },
    { ...base, name: 'QA DUP Along Test Road FTF', address: 'Along Test Road, by QA junction', width: 12, height: 4, latitude: 6.5, longitude: 3.4, photo_urls: ['https://example.com/qa-b.jpg', 'https://example.com/qa-a.jpg'] },
    { ...base, name: 'QA DUP Test Road', photo_urls: ['https://example.com/qa-c.jpg'] },
  ]).select('id'), 'insert boards').map(b => b.id);
  made.boards.push(keep, withPin, third);
  must(await admin.from('board_owner_names').insert({ board_id: withPin, owner_name: 'QA Owner' }), 'owner name');
  must(await admin.from('board_rates').upsert({ board_id: withPin, gross_monthly_rate: 750000 }), 'rate');

  // Only admins can merge or mark pairs.
  const denied = await buyer.c.rpc('admin_merge_boards', { p_keep: keep, p_drop: [withPin] });
  check(!!denied.error, 'a buyer cannot merge boards');
  const pair = keep < third ? { board_a: keep, board_b: third } : { board_a: third, board_b: keep };
  check(!!(await buyer.c.from('board_duplicate_dismissals').insert(pair)).error, 'a buyer cannot mark "not duplicates"');
  check(!(await adm.c.from('board_duplicate_dismissals').insert(pair)).error, 'an admin can mark "not duplicates"');
  const seen = must(await buyer.c.from('board_duplicate_dismissals').select('board_a').eq('board_a', pair.board_a), 'buyer read');
  check(seen.length === 0, 'a buyer cannot see the marks');

  // Merge: the kept board takes the pin, size, address, photos, rate and owner name.
  must(await adm.c.rpc('admin_merge_boards', { p_keep: keep, p_drop: [withPin, third] }), 'merge');
  const after = must(await admin.from('boards').select('id, name, address, width, height, latitude, photo_urls').in('id', [keep, withPin, third]), 'read after');
  check(after.length === 1 && after[0].id === keep, 'the other two boards are gone');
  const k = after[0] ?? {};
  check(k.name === 'QA DUP Along Test Road', 'the kept board keeps its own name');
  check(k.latitude === 6.5 && k.width === 12 && k.address === 'Along Test Road, by QA junction', 'blank pin, size and address are filled in');
  // The test boards are created at the same moment, so the others' photos may come in either order.
  const ph = k.photo_urls ?? [];
  check(ph.length === 3 && ph[0] === 'https://example.com/qa-a.jpg' && ph.includes('https://example.com/qa-b.jpg') && ph.includes('https://example.com/qa-c.jpg'),
    `photos: its own first, then the others, no repeats (${ph.map(u => u.slice(-8)).join(', ')})`);
  const rate = must(await admin.from('board_rates').select('gross_monthly_rate').eq('board_id', keep), 'rate after');
  check(rate[0]?.gross_monthly_rate == 750000, 'the rate moved over');
  const owner = must(await admin.from('board_owner_names').select('owner_name').eq('board_id', keep), 'owner after');
  check(owner[0]?.owner_name === 'QA Owner', 'the owner name moved over');
  const marks = must(await admin.from('board_duplicate_dismissals').select('board_a').or(`board_a.eq.${third},board_b.eq.${third}`), 'marks after');
  check(marks.length === 0, 'marks on a removed board go with it');
} catch (e) {
  fail++;
  console.log('FAIL', e.message);
} finally {
  if (made.boards.length) await admin.from('boards').delete().in('id', made.boards);
  for (const id of made.users) await admin.auth.admin.deleteUser(id);
}
console.log(fail ? `${fail} failed` : 'all passed');
process.exit(fail ? 1 : 0);
