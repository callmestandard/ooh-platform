// Verifies owner board corrections (056) with throwaway data: an admin (ADM),
// a buyer (B) and two named owners, each with one test board.
//
//   node scripts/verify-owner-board-edits.mjs setup   <state-file>
//   node scripts/verify-owner-board-edits.mjs verify  <state-file>
//   node scripts/verify-owner-board-edits.mjs cleanup <state-file>
//
// Reads Supabase keys from .env.local. `verify` also uploads one tiny test
// photo through the app at BASE (default https://ooh-platform-xi.vercel.app,
// or pass a 4th argument); cleanup deletes it with the boards and accounts.
import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split(/\r?\n/).filter(l => /^[A-Z_]+=/.test(l)).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
);
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL, ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY, SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
const [stage, stateFile = '.owner-board-edits-state.json', BASE = 'https://ooh-platform-xi.vercel.app'] = process.argv.slice(2);
const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });
const TAG = 'qa-edit';
const OWNERS = ['QA Edit Owner One', 'QA Edit Owner Two'];
const keyOf = name => 'name:' + name.toLowerCase();
// A 1x1 PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

const must = ({ data, error }, what) => { if (error) throw new Error(`${what}: ${error.message}`); return data; };
const save = state => writeFileSync(stateFile, JSON.stringify(state, null, 2));

async function setup() {
  const state = { users: {}, boards: [], tokens: [] };
  for (const [k, role] of [['ADM', 'admin'], ['B', 'agency']]) {
    const email = `${TAG}-${k.toLowerCase()}-${randomBytes(3).toString('hex')}@example.com`;
    const password = randomBytes(18).toString('base64url');
    const { user } = must(await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { role: role === 'admin' ? 'agency' : role, full_name: `QA ${k}` } }), 'createUser');
    must(await admin.from('profiles').update({ role }).eq('id', user.id), 'profile');
    state.users[k] = { id: user.id, email, password };
    save(state);
  }
  for (const owner of OWNERS) {
    const b = must(await admin.from('boards').insert({ name: `[${TAG}] board of ${owner}`, format: 'billboard', address: 'QA test - safe to delete', city: 'ZZ QA Edit City', state: 'Lagos', status: 'unavailable', width: 10, height: 5 }).select('id').single(), 'board');
    must(await admin.from('board_owner_names').upsert({ board_id: b.id, owner_name: owner }), 'owner name');
    const link = must(await admin.from('owner_links').upsert({ owner_key: keyOf(owner), owner_name: owner, created_by: state.users.ADM.id }).select('token').single(), 'link');
    state.boards.push(b.id); state.tokens.push(link.token);
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
  const out = [];
  const check = (name, ok, detail = '') => out.push({ result: ok ? 'PASS' : 'FAIL', check: name, detail: String(detail ?? '').slice(0, 90) });
  const anon = createClient(SUPABASE_URL, ANON, { auth: { persistSession: false } });
  const adm = await as(state.users.ADM), B = await as(state.users.B);
  const [b1, b2] = state.boards, [t1, t2] = state.tokens;
  const suggest = (token, board, changes, photo = null, note = null) => anon.rpc('owner_link_suggest_edit', { p_token: token, p_board_id: board, p_changes: changes, p_photo_url: photo, p_note: note });
  const board = async id => must(await admin.from('boards').select('name, area, address, width, height, illuminated, photo_urls').eq('id', id).single(), 'board');
  const before = await board(b1);

  let r = await anon.rpc('owner_link_view', { p_token: t1 });
  const mine = r.data?.boards?.find(x => x.id === b1);
  check('owner page shows size, address and photos', !r.error && mine && Number(mine.width) === 10 && 'address' in mine && Array.isArray(mine.photos) && mine.edit == null, r.error?.message ?? JSON.stringify(mine)?.slice(0, 80));
  check("owner page doesn't show another owner's board", !r.data?.boards?.some(x => x.id === b2));

  r = await suggest('0'.repeat(40), b1, { name: 'Hacked' });
  check('a made-up link is refused', !!r.error, r.error?.message ?? 'allowed');
  r = await suggest(t2, b1, { name: 'Hacked' });
  check("an owner can't correct another owner's board", !!r.error, r.error?.message ?? 'allowed');
  r = await suggest(t1, b1, { name: before.name, width: 10 });
  check('sending no real change is refused', !!r.error, r.error?.message ?? 'allowed');
  r = await suggest(t1, b1, { width: 900 });
  check('an impossible size is refused', !!r.error, r.error?.message ?? 'allowed');
  r = await suggest(t1, b1, {}, 'https://evil.example.com/x.jpg');
  check('a photo from somewhere else is refused', !!r.error, r.error?.message ?? 'allowed');

  // Photo upload through the app
  const upload = async (token, boardId) => {
    const body = new FormData();
    body.append('token', token); body.append('boardId', boardId);
    body.append('file', new File([PNG], 'p.png', { type: 'image/png' }));
    const res = await fetch(`${BASE}/api/owner-link/photo`, { method: 'POST', body });
    return { status: res.status, json: await res.json().catch(() => ({})) };
  };
  let up = await upload(t2, b1);
  check("photo upload with another owner's link is refused", up.status === 403, up.status);
  up = await upload(t1, b1);
  const photo = up.json.url;
  check('owner uploads a photo for their board', up.status === 200 && String(photo).includes(`/board-photos/owner-link/${b1}/`), `${up.status} ${JSON.stringify(up.json).slice(0, 60)}`);

  r = await suggest(t1, b1, { name: `[${TAG}] corrected name`, area: 'QA Area', width: '12.5', height: 5, illuminated: true, role: 'admin', status: 'available' }, photo, 'Pin is across the road');
  check('owner sends a correction', !r.error, r.error?.message);
  const row = must(await admin.from('owner_board_edits').select('changes, photo_url, note, status').eq('board_id', b1).single(), 'edit row');
  check('only real, allowed changes are kept', row.status === 'pending' && row.changes.name && row.changes.width === 12.5 && row.changes.illuminated === true && !('height' in row.changes) && !('role' in row.changes) && !('status' in row.changes), JSON.stringify(row.changes));
  const still = await board(b1);
  check('the listing is unchanged until the team applies it', still.name === before.name && Number(still.width) === 10, still.name);

  r = await anon.rpc('owner_link_view', { p_token: t1 });
  check('owner sees their correction is waiting', r.data?.boards?.find(x => x.id === b1)?.edit?.status === 'pending');

  r = await anon.from('owner_board_edits').select('board_id').limit(1);
  check('visitor cannot read corrections', !!r.error || r.data.length === 0, r.error?.message ?? r.data.length);
  r = await B.from('owner_board_edits').select('board_id').limit(1);
  check('buyer cannot read corrections', !r.error && r.data.length === 0, r.error?.message ?? r.data.length);
  r = await B.rpc('admin_owner_board_edits');
  check('buyer cannot list corrections', !!r.error, r.error?.message ?? 'allowed');
  r = await B.rpc('admin_decide_owner_board_edit', { p_board_id: b1, p_apply: true });
  check('buyer cannot apply a correction', !!r.error, r.error?.message ?? 'allowed');
  r = await anon.rpc('owner_link_owns', { p_token: t1, p_board_id: b1 });
  check('the ownership check is server only', !!r.error, r.error?.message ?? 'allowed');

  r = await adm.rpc('admin_owner_board_edits');
  const listed = r.data?.find(x => x.board_id === b1);
  check('admin sees the correction with the current listing', !r.error && listed?.now?.name === before.name && listed?.changes?.name, r.error?.message ?? JSON.stringify(listed)?.slice(0, 80));

  r = await adm.rpc('admin_decide_owner_board_edit', { p_board_id: b1, p_apply: true });
  check('admin applies it', !r.error, r.error?.message);
  const after = await board(b1);
  check('the listing now has the new details', after.name === `[${TAG}] corrected name` && after.area === 'QA Area' && Number(after.width) === 12.5 && Number(after.height) === 5 && after.illuminated === true, JSON.stringify(after).slice(0, 80));
  check('the new photo is the main photo', photo && after.photo_urls?.[0] === photo, after.photo_urls?.[0]);
  r = await adm.rpc('admin_decide_owner_board_edit', { p_board_id: b1, p_apply: true });
  check('a correction cannot be applied twice', !!r.error, r.error?.message ?? 'allowed');

  must(await suggest(t2, b2, { name: `[${TAG}] should not stick` }), 'second suggestion');
  r = await adm.rpc('admin_decide_owner_board_edit', { p_board_id: b2, p_apply: false });
  const other = await board(b2);
  check('a dismissed correction changes nothing', !r.error && !other.name.includes('should not stick'), r.error?.message ?? other.name);

  console.table(out);
  const failed = out.filter(x => x.result === 'FAIL').length;
  console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
  process.exitCode = failed ? 1 : 0;
}

async function cleanup() {
  if (!existsSync(stateFile)) { console.log('no state file'); return; }
  const state = JSON.parse(readFileSync(stateFile, 'utf8'));
  for (const id of state.boards ?? []) {
    const { data: files } = await admin.storage.from('board-photos').list(`owner-link/${id}`);
    if (files?.length) await admin.storage.from('board-photos').remove(files.map(f => `owner-link/${id}/${f.name}`));
  }
  await admin.from('notifications').delete().like('title', `%[${TAG}]%`);
  await admin.from('owner_links').delete().in('owner_key', OWNERS.map(keyOf));
  await admin.from('boards').delete().like('name', `[${TAG}]%`);
  for (const u of Object.values(state.users)) await admin.auth.admin.deleteUser(u.id);
  rmSync(stateFile);
  console.log('cleanup done');
}

({ setup, verify, cleanup }[stage] ?? (() => { console.log('usage: setup | verify | cleanup <state-file> [base-url]'); }))().catch(e => { console.error(e.message); process.exitCode = 1; });
