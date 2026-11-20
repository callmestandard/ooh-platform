import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { rateLimit, rateLimitResponse } from '@/lib/rate-limit';

export const runtime = 'nodejs';

const TYPES: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heif',
};
const MAX_BYTES = 10 * 1024 * 1024;

// A one-time upload slot for one install photo, in this booking's folder only.
// The browser uploads straight to storage with it (no size limit from our server),
// then calls /complete with the path.
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
  if (!rateLimit(`poe-upload:${ip}`, 12)) return rateLimitResponse();
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: 'Uploads are not available right now' }, { status: 503 });

  const { type, size } = await req.json().catch(() => ({}));
  const ext = TYPES[String(type || '').toLowerCase()];
  if (!ext) return NextResponse.json({ error: 'Send a photo (JPG, PNG, WebP or HEIC)' }, { status: 400 });
  if (typeof size === 'number' && size > MAX_BYTES) return NextResponse.json({ error: 'That photo is over 10 MB. Take it again at a lower size.' }, { status: 400 });

  const { data: bookingId } = await db.rpc('poe_link_booking', { p_token: token });
  if (!bookingId) return NextResponse.json({ error: 'This link is not valid any more' }, { status: 404 });

  const path = `poe/${bookingId}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
  const { data, error } = await db.storage.from('compliance-photos').createSignedUploadUrl(path);
  if (error || !data) return NextResponse.json({ error: 'Could not start the upload. Try again.' }, { status: 500 });
  return NextResponse.json({ path: data.path, token: data.token });
}
