import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { ownerContactKey, cleanContact } from '@/lib/owner-contacts';
import { requireAuth, unauthorized } from '@/lib/require-auth';

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

export async function POST(req: NextRequest) {
  const user = await requireAuth(req);
  if (!user) return unauthorized();

  try {
    const { rows, admin } = (await req.json()) as { rows: InsertRow[]; admin?: AdminImport };
    if (!Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json({ error: 'No rows provided' }, { status: 400 });
    }

    if (admin) return adminImport(user.id, rows, admin);

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
      return NextResponse.json({ inserted: 0, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ inserted: data?.length ?? 0 });
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
    const seen = new Set<string>();
    const contacts = rows.map(r => cleanContact(r.contact_name, r.contact_phone))
      .filter(c => (c.contact_name || c.contact_phone) && !seen.has(`${c.contact_name}|${c.contact_phone}`) && seen.add(`${c.contact_name}|${c.contact_phone}`))
      .map(c => ({ ...c, owner_key: key, created_by: uid, last_used_at: new Date().toISOString() }));
    if (contacts.length) {
      const { error: contactError } = await supabaseAdmin.from('owner_sales_contacts')
        .upsert(contacts, { onConflict: 'owner_key,contact_name,contact_phone' });
      if (contactError) console.error('[import-boards admin] sales contacts', contactError);
    }
  }
  return NextResponse.json({ inserted: ids.length, ids });
}
