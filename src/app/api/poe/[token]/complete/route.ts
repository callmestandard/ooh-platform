import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { rateLimit, rateLimitResponse } from '@/lib/rate-limit';

export const runtime = 'nodejs';

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

// Records an install photo that was uploaded with a slot from /upload.
// It waits for our team to check it: the booking is NOT marked live here.
// The database (poe_submit) checks the token, the folder, the daily cap,
// works out the distance from the board's pin, and tells our team.
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
  if (!rateLimit(`poe-complete:${ip}`, 12)) return rateLimitResponse();
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: 'Not available right now' }, { status: 503 });

  const body = await req.json().catch(() => ({}));
  const path = typeof body.path === 'string' ? body.path : '';

  const { data: bookingId } = await db.rpc('poe_link_booking', { p_token: token });
  if (!bookingId) return NextResponse.json({ error: 'This link is not valid any more' }, { status: 404 });
  if (!path.startsWith(`poe/${bookingId}/`)) return NextResponse.json({ error: 'Photo missing' }, { status: 400 });

  // The photo must really be in storage before we record it.
  const name = path.slice(`poe/${bookingId}/`.length);
  const { data: found } = await db.storage.from('compliance-photos').list(`poe/${bookingId}`, { search: name, limit: 5 });
  if (!found?.some(f => f.name === name)) return NextResponse.json({ error: 'The photo did not finish uploading. Try again.' }, { status: 400 });

  let lat = num(body.latitude), lng = num(body.longitude);
  if (lat == null || lng == null || Math.abs(lat) > 90 || Math.abs(lng) > 180) { lat = null; lng = null; }

  const { data, error } = await db.rpc('poe_submit', {
    p_token: token, p_path: path, p_lat: lat, p_lng: lng,
    p_name: typeof body.submitterName === 'string' ? body.submitterName : '',
    p_notes: typeof body.notes === 'string' ? body.notes : null,
    p_device: typeof body.deviceInfo === 'string' ? body.deviceInfo.slice(0, 300) : null,
  });
  if (error) {
    const status = error.code === '42501' ? 404 : error.code === '54000' ? 429 : 400;
    return NextResponse.json({ error: error.message }, { status });
  }
  return NextResponse.json({ ok: true, distance_m: data?.distance_m ?? null });
}
