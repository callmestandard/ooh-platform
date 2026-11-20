import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { ownerContactKey, cleanContact, cleanEmail } from '@/lib/owner-contacts';
import { requireAuth, unauthorized } from '@/lib/require-auth';
import { isCityCentrePin } from '@/lib/import-match';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

type InsertRow = {
  name: string;
  address?: string;
  city: string;
  area?: string;
  state?: string;
  illuminated?: boolean | null;
  format: string;
  width?: number | null;
  height?: number | null;
  asking_rate: number | null;
  latitude?: number | null;
  longitude?: number | null;
  notes?: string;
  // Sent by the admin "Add a board" form (one board with photos).
  photo_urls?: string[];
  face_count?: number;
  available_from?: string | null;
  contact_name?: string | null;
  contact_phone?: string | null;
  /** Saved on the owner's sales contact (admin import); boards have no email column. */
  contact_email?: string | null;
  /** Admin only: the brand on the board now and when their campaign ends (YYYY-MM-DD). */
  current_brand?: string | null;
  brand_ends_on?: string | null;
};

// Only photos uploaded to our own board-photos bucket are accepted.
const PHOTO_PREFIX = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/board-photos/`;

/** Sent by our team when importing a deck or list on someone's behalf. */
type AdminImport = {
  /** The owner account the boards belong to, or null for "no account yet" (claimable). */
  ownerId: string | null;
  /** The owner's name when they have no account yet (admin-only record). */
  ownerName?: string | null;
  /** Where the records came from, e.g. "Sule Outdoor deck, Oct 2026". */
  source: string;
  verification: 'pending' | 'verified';
};

/** A re-uploaded board that replaces the details of one already listed. */
type UpdateRow = { id: string; row: InsertRow };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  const user = await requireAuth(req);
  if (!user) return unauthorized();

  try {
    const { rows: sent, admin, updates: sentUpdates } = (await req.json()) as { rows?: InsertRow[]; admin?: AdminImport; updates?: UpdateRow[] };
    const rows = Array.isArray(sent) ? sent : [];
    const updates = Array.isArray(sentUpdates) ? sentUpdates.filter(u => u && UUID.test(String(u.id)) && u.row) : [];
    if (rows.length === 0 && updates.length === 0) {
      return NextResponse.json({ error: 'No rows provided' }, { status: 400 });
    }

    if (admin) {
      const added = rows.length ? await adminImport(user.id, rows, admin) : NextResponse.json({ inserted: 0, ids: [] });
      if (!updates.length || !added.ok) return added;
      const res = await updateBoards(user.id, updates, { admin });
      return NextResponse.json({ ...(await added.json()), ...res }, { status: res.error && !res.updated ? 500 : 200 });
    }

    // Stamp ownership from the auth session — never trust a client-sent owner_id.
    // A marketer or owner admin imports on behalf of their owner company
    // (migration 035); a marketer's rows are assigned to them.
    const { data: company } = await supabaseAdmin.rpc('owner_company_of', { p_uid: user.id });
    // Only a board owner or a member of an owner's team may import. Without
    // this, any signed-in account could create boards under its own name.
    const ownerId = company as string | null;
    if (!ownerId) {
      return NextResponse.json({ error: 'Only board owners and their teams can import boards' }, { status: 403 });
    }
    const { data: isAdmin } = ownerId === user.id ? { data: true } : await supabaseAdmin.rpc('is_owner_admin', { p_owner_id: ownerId, p_uid: user.id });
    const updated = updates.length ? await updateBoards(user.id, updates, { ownerId, ownerAdmin: !!isAdmin }) : { updated: 0 };
    if (!rows.length) return NextResponse.json({ inserted: 0, ...updated }, { status: updated.error && !updated.updated ? 500 : 200 });
    // Boards only show as "Partner verified" once our team has approved the
    // owner (migration 050). Before that, or if the check fails, they start pending.
    const { data: approval } = await supabaseAdmin.from('owner_approvals').select('owner_id').eq('owner_id', ownerId).maybeSingle();
    const approved = !!approval;

    const payload = rows.map(r => ({
      name: String(r.name).trim(),
      address: String(r.address ?? '').trim() || null,
      city: String(r.city ?? '').trim() || null,
      area: String(r.area ?? '').trim() || null,
      state: String(r.state ?? '').trim() || null,
      format: r.format,
      width: r.width ?? null,
      height: r.height ?? null,
      // moved into the private rate card by the database; null = quote on request
      asking_rate: Number(r.asking_rate) > 0 ? Number(r.asking_rate) : null,
      latitude: r.latitude ?? null,
      longitude: r.longitude ?? null,
      notes: String(r.notes ?? '').trim() || null,
      status: 'available',
      owner_id: ownerId,
      created_by: user.id,
      assigned_marketer_id: isAdmin ? null : user.id,
      face_count: 1,
      // unknown stays unknown — never default to "not illuminated"
      illuminated: typeof r.illuminated === 'boolean' ? r.illuminated : null,
      // This route runs as the service role, which the 042 trigger trusts to set this.
      verification_status: approved ? 'partner_verified' : 'pending',
      last_verified_at: approved ? new Date().toISOString() : null,
    }));

    const { data, error } = await supabaseAdmin.from('boards').insert(payload).select('id');
    if (error) {
      console.error('[import-boards]', error);
      return NextResponse.json({ inserted: 0, ...updated, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ inserted: data?.length ?? 0, ...updated });
  } catch (err) {
    console.error('[import-boards]', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}

function boardFields(r: InsertRow) {
  return {
    name: String(r.name).trim(),
    address: String(r.address ?? '').trim() || null,
    city: String(r.city ?? '').trim() || null,
    area: String(r.area ?? '').trim() || null,
    state: String(r.state ?? '').trim() || null,
    format: r.format,
    width: r.width ?? null,
    height: r.height ?? null,
    asking_rate: Number(r.asking_rate) > 0 ? Number(r.asking_rate) : null,
    latitude: r.latitude ?? null,
    longitude: r.longitude ?? null,
    notes: String(r.notes ?? '').trim() || null,
    status: 'available',
    face_count: Number.isInteger(r.face_count) && r.face_count! >= 1 && r.face_count! <= 10 ? r.face_count : 1,
    illuminated: typeof r.illuminated === 'boolean' ? r.illuminated : null,
    photo_urls: (() => {
      const ok = Array.isArray(r.photo_urls) ? r.photo_urls.filter(u => typeof u === 'string' && u.startsWith(PHOTO_PREFIX)).slice(0, 5) : [];
      return ok.length ? ok : null;
    })(),
    available_from: typeof r.available_from === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.available_from) ? r.available_from : null,
    contact_name: String(r.contact_name ?? '').trim().slice(0, 120) || null,
    contact_phone: String(r.contact_phone ?? '').trim().slice(0, 40) || null,
  };
}

// Admin import: our team loads inventory from a deck or list. The caller's
// role is checked here, not trusted from the client.
async function adminImport(uid: string, rows: InsertRow[], admin: AdminImport) {
  const { data: me } = await supabaseAdmin.from('profiles').select('role').eq('id', uid).maybeSingle();
  if ((me as { role?: string } | null)?.role !== 'admin') {
    return NextResponse.json({ error: 'Only admins can import on behalf of others' }, { status: 403 });
  }
  const source = String(admin.source ?? '').trim();
  if (!source) return NextResponse.json({ error: 'Say where these boards came from' }, { status: 400 });
  if (admin.verification !== 'pending' && admin.verification !== 'verified') {
    return NextResponse.json({ error: 'Invalid verification status' }, { status: 400 });
  }
  let ownerId: string | null = null;
  if (admin.ownerId) {
    const { data: owner } = await supabaseAdmin.from('profiles').select('id, role').eq('id', admin.ownerId).maybeSingle();
    if ((owner as { role?: string } | null)?.role !== 'owner') {
      return NextResponse.json({ error: 'That account is not a media owner' }, { status: 400 });
    }
    ownerId = admin.ownerId;
  }
  const payload = rows.map(r => ({
    ...boardFields(r),
    owner_id: ownerId,
    created_by: uid,
    assigned_marketer_id: null,
    source: source.slice(0, 200),
    verification_status: admin.verification,
    last_verified_at: admin.verification === 'verified' ? new Date().toISOString() : null,
  }));
  const { data, error } = await supabaseAdmin.from('boards').insert(payload).select('id');
  if (error) {
    console.error('[import-boards admin]', error);
    return NextResponse.json({ inserted: 0, error: error.message }, { status: 500 });
  }
  const ids = (data ?? []).map(d => d.id as string);
  // Remember who owns boards whose owner has no account yet (admins only see this).
  const ownerName = ownerId ? '' : String(admin.ownerName ?? '').trim().slice(0, 200);
  if (ownerName && ids.length) {
    const { error: nameError } = await supabaseAdmin.from('board_owner_names').upsert(
      ids.map(id => ({ board_id: id, owner_name: ownerName, updated_by: uid, updated_at: new Date().toISOString() })),
    );
    if (nameError) console.error('[import-boards admin] owner name', nameError);
  }
  // The brand on each board now (admins only, migration 049). Rows come back in insert order.
  const brands = ids.map((id, i) => {
    const brand = String(rows[i]?.current_brand ?? '').trim().slice(0, 120) || null;
    const end = String(rows[i]?.brand_ends_on ?? '').trim();
    const endsOn = /^\d{4}-\d{2}-\d{2}$/.test(end) && !Number.isNaN(Date.parse(end)) ? end : null;
    return brand || endsOn ? { board_id: id, brand, ends_on: endsOn, updated_by: uid, updated_at: new Date().toISOString() } : null;
  }).filter(Boolean);
  if (brands.length) {
    const { error: brandError } = await supabaseAdmin.from('board_current_brand').upsert(brands);
    if (brandError) console.error('[import-boards admin] current brand', brandError);
  }
  // Remember the sales contacts used, so they can be picked next time for this owner.
  const key = ownerContactKey(ownerId, ownerName);
  if (key && ids.length) {
    // One entry per name+phone, keeping the first valid email given for it.
    const byContact = new Map<string, { contact_name: string; contact_phone: string; email: string | null }>();
    for (const r of rows) {
      const c = cleanContact(r.contact_name, r.contact_phone);
      const email = cleanEmail(r.contact_email);
      if (!c.contact_name && !c.contact_phone && !email) continue;
      const k = `${c.contact_name}|${c.contact_phone}`;
      const had = byContact.get(k);
      if (!had) byContact.set(k, { ...c, email });
      else if (!had.email && email) had.email = email;
    }
    const now = new Date().toISOString();
    const all = [...byContact.values()].map(c => ({ ...c, owner_key: key, created_by: uid, last_used_at: now }));
    // Contacts without an email are saved without that column, so an email saved before is kept.
    const withEmail = all.filter(c => c.email);
    const noEmail = all.filter(c => !c.email).map(c => ({ contact_name: c.contact_name, contact_phone: c.contact_phone, owner_key: c.owner_key, created_by: c.created_by, last_used_at: c.last_used_at }));
    for (const batch of [withEmail, noEmail]) {
      if (!batch.length) continue;
      const { error: contactError } = await supabaseAdmin.from('owner_sales_contacts')
        .upsert(batch, { onConflict: 'owner_key,contact_name,contact_phone' });
      if (contactError) console.error('[import-boards admin] sales contacts', contactError);
    }
  }
  return NextResponse.json({ inserted: ids.length, ids });
}

/**
 * Re-upload: replaces the details of boards already listed. An owner's team
 * may only update their own company's boards (a marketer only the boards
 * assigned to them); our team may update any. Status, owner and verification
 * are left as they are. A pin is replaced by the new one; with no new pin, a
 * pin that was only the city centre is removed rather than kept as if real.
 */
async function updateBoards(
  uid: string,
  updates: UpdateRow[],
  who: { admin: AdminImport } | { ownerId: string; ownerAdmin: boolean },
): Promise<{ updated: number; updateFailed?: string[]; error?: string }> {
  if ('admin' in who) {
    const { data: me } = await supabaseAdmin.from('profiles').select('role').eq('id', uid).maybeSingle();
    if ((me as { role?: string } | null)?.role !== 'admin') return { updated: 0, error: 'Only admins can update boards on behalf of others' };
  }
  const ids = [...new Set(updates.map(u => u.id))];
  const { data: found, error } = await supabaseAdmin.from('boards')
    .select('id, owner_id, assigned_marketer_id, latitude, longitude, city, photo_urls').in('id', ids);
  if (error) return { updated: 0, error: error.message };
  type Found = { id: string; owner_id: string | null; assigned_marketer_id: string | null; latitude: number | null; longitude: number | null; city: string | null; photo_urls: string[] | null };
  const boards = new Map(((found ?? []) as Found[]).map(b => [b.id, b]));
  const failed: string[] = [];
  let updated = 0;
  const source = 'admin' in who ? String(who.admin.source ?? '').trim().slice(0, 200) : '';
  const ownerName = 'admin' in who && !who.admin.ownerId ? String(who.admin.ownerName ?? '').trim().slice(0, 200) : '';

  for (const { id, row } of updates) {
    const b = boards.get(id);
    const allowed = b && ('admin' in who || (b.owner_id === who.ownerId && (who.ownerAdmin || b.assigned_marketer_id === uid)));
    if (!b || !allowed) { failed.push(id); continue; }
    const f = boardFields(row);
    const newPin = f.latitude != null && f.longitude != null;
    const oldPinFake = isCityCentrePin(b.latitude, b.longitude, b.city);
    // Photos the owner added from their link stay; the old import's photo is replaced.
    const keptPhotos = (b.photo_urls ?? []).filter(u => u.includes('/board-photos/owner-link/'));
    const patch: Record<string, unknown> = {
      name: f.name, address: f.address, city: f.city, area: f.area, state: f.state, format: f.format,
      width: f.width, height: f.height,
      ...(f.asking_rate ? { asking_rate: f.asking_rate } : {}),
      ...(f.notes ? { notes: f.notes } : {}),
      ...(f.illuminated !== null ? { illuminated: f.illuminated } : {}),
      ...(row.face_count ? { face_count: f.face_count } : {}),
      ...(f.contact_name || f.contact_phone ? { contact_name: f.contact_name, contact_phone: f.contact_phone } : {}),
      ...(newPin ? { latitude: f.latitude, longitude: f.longitude } : oldPinFake ? { latitude: null, longitude: null } : {}),
      ...(f.photo_urls ? { photo_urls: [...f.photo_urls, ...keptPhotos].slice(0, 5) } : {}),
      ...(source ? { source } : {}),
    };
    const { error: upError } = await supabaseAdmin.from('boards').update(patch).eq('id', id);
    if (upError) { console.error('[import-boards update]', upError); failed.push(id); continue; }
    updated++;
    if (ownerName) {
      await supabaseAdmin.from('board_owner_names').upsert({ board_id: id, owner_name: ownerName, updated_by: uid, updated_at: new Date().toISOString() });
    }
  }
  return failed.length ? { updated, updateFailed: failed, error: `${failed.length} board${failed.length === 1 ? '' : 's'} could not be updated` } : { updated };
}
