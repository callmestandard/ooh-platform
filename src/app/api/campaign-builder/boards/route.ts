import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';

const STATIC_FORMATS = ['billboard', 'unipole', 'gantry', 'bridge_panel', 'wall_drape'];
const DIGITAL_FORMATS = ['digital', 'led'];

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const citiesParam  = searchParams.get('cities');
  const creativeType = searchParams.get('creativeType') || 'static';

  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );

  const formats = creativeType === 'digital' ? DIGITAL_FORMATS : STATIC_FORMATS;
  const cities  = citiesParam ? citiesParam.split(',').map(c => c.trim()).filter(Boolean) : [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q: any = db
    .from('boards')
    .select('id, name, address, city, state, format, asking_rate, width, height, illuminated, face_count, latitude, longitude, owner_id, photo_urls')
    .eq('status', 'available')
    .not('latitude', 'is', null)
    .not('longitude', 'is', null)
    .in('format', formats);

  if (cities.length > 0) q = q.in('city', cities);

  q = q.order('asking_rate', { ascending: true }).limit(200);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ boards: data || [] });
}
