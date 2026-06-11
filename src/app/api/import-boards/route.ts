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
  state?: string;
  format: string;
  width?: number | null;
  height?: number | null;
  asking_rate: number;
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

    // Stamp owner_id from auth session — never trust client-sent owner_id
    const payload = rows.map(r => ({
      name: String(r.name).trim(),
      address: String(r.address ?? '').trim() || null,
      city: String(r.city ?? '').trim() || null,
      state: String(r.state ?? '').trim() || null,
      format: r.format,
      width: r.width ?? null,
      height: r.height ?? null,
      asking_rate: r.asking_rate,
      latitude: r.latitude ?? null,
      longitude: r.longitude ?? null,
      notes: String(r.notes ?? '').trim() || null,
      status: 'available',
      owner_id: user.id,
      face_count: 1,
      illuminated: false,
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
