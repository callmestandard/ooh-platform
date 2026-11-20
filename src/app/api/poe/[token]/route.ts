import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { rateLimit, rateLimitResponse } from '@/lib/rate-limit';

export const runtime = 'nodejs';

// The install link (/poe/[token]) opened by an installer with no account.
// Server only: the token is checked in the database (poe_view), which also
// refuses links for unconfirmed bookings or bookings that ended over 30 days ago.
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
  if (!rateLimit(`poe-view:${ip}`, 30)) return rateLimitResponse();
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ status: 'error' }, { status: 503 });

  const { data: view, error } = await db.rpc('poe_view', { p_token: token });
  if (error || !view) return NextResponse.json({ status: 'invalid' });

  // Approved artwork, so the installer can check what goes up. Links last an hour.
  const artwork = await Promise.all(
    ((view.artwork ?? []) as { id: string; file_name: string; path: string; mime_type: string | null }[]).map(async a => {
      const { data } = await db.storage.from('creatives').createSignedUrl(a.path, 3600);
      return { id: a.id, file_name: a.file_name, mime_type: a.mime_type, url: data?.signedUrl ?? null };
    }),
  );
  const { booking_id: _omit, ...rest } = view;
  return NextResponse.json({ status: 'ok', view: { ...rest, artwork } });
}
