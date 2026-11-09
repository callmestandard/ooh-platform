import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
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
};

// Only photos uploaded to our own board-photos bucket are accepted.
const PHOTO_PREFIX = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/board-photos/`;

/** Sent by our team when importing a deck or list on someone's behalf. */
type AdminImport = {
  /** The owner account the boards belong to, or null for "no account yet" (claimable). */
  ownerId: string | null;
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
      // The owner's own team is importing its own boards (this route runs as
      // the service role, which the 042 trigger trusts to set this).
      verification_status: 'partner_verified',
      last_verified_at: new Date().toISOString(),
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
  return NextResponse.json({ inserted: data?.length ?? 0, ids: (data ?? []).map(d => d.id) });
}
