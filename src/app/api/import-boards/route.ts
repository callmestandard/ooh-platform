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
};

export async function POST(req: NextRequest) {
  const user = await requireAuth(req);
  if (!user) return unauthorized();

  try {
    const { rows } = (await req.json()) as { rows: InsertRow[] };
    if (!Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json({ error: 'No rows provided' }, { status: 400 });
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
