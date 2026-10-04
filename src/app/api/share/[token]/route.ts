import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { rateLimit, rateLimitResponse } from '@/lib/rate-limit';

export const runtime = 'nodejs';

// Serves ONE quick-share availability link (/s/[token]) to anyone holding
// its token. Uses the service role, so it is deliberately narrow: it looks
// the link up by token only, returns nothing for revoked/expired links, and
// selects a fixed set of non-sensitive fields for exactly the boards on the
// link. A rate is included only when the owner has set that board to the
// most open visibility ("all verified agencies"); a share link is read by
// people who are not signed in, so anything stricter shows "Contact for rate".
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (!rateLimit(`share:${ip}`, 60, 60_000)) return rateLimitResponse();
  if (!/^[0-9a-f]{64}$/.test(token)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const admin = getSupabaseAdmin();
  if (!admin) return NextResponse.json({ error: 'Not available' }, { status: 500 });

  const { data: link } = await admin.from('board_share_links')
    .select('id, title, board_ids, owner_id, expires_at, revoked_at, open_count').eq('token', token).maybeSingle();
  if (!link) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (link.revoked_at || new Date(link.expires_at).getTime() < Date.now()) {
    return NextResponse.json({ error: 'This link has expired or been withdrawn' }, { status: 410 });
  }

  const ids = link.board_ids as string[];
  const [{ data: boards }, { data: ranges }, { data: bookings }, { data: company }] = await Promise.all([
    admin.from('boards').select('id, name, address, city, state, format, width, height, illuminated, face_count, photo_urls, status').in('id', ids),
    admin.from('board_booked_ranges').select('board_id, start_date, end_date').in('board_id', ids),
    admin.from('bookings').select('board_id, start_date, end_date').in('board_id', ids).in('status', ['agreed', 'signed', 'live']),
    admin.from('profiles').select('company_name, full_name').eq('id', link.owner_id).maybeSingle(),
  ]);

  const today = new Date().toISOString().slice(0, 10);
  const out = await Promise.all((boards ?? []).map(async b => {
    const { data: visibility } = await admin.rpc('board_effective_rate_visibility', { p_board_id: b.id });
    let rate: number | null = null;
    if (visibility === 'all_verified_agencies') {
      const { data: r } = await admin.from('board_rates').select('gross_monthly_rate').eq('board_id', b.id).maybeSingle();
      rate = r?.gross_monthly_rate ?? null;
    }
    const booked = [...(ranges ?? []), ...(bookings ?? [])]
      .filter(r => r.board_id === b.id && r.start_date && r.end_date && r.end_date >= today)
      .map(r => ({ start: r.start_date as string, end: r.end_date as string }))
      .sort((x, y) => x.start.localeCompare(y.start));
    return {
      id: b.id, name: b.name, address: b.address, city: b.city, state: b.state, format: b.format,
      width: b.width, height: b.height, illuminated: b.illuminated, face_count: b.face_count,
      photo: Array.isArray(b.photo_urls) ? (b.photo_urls[0] as string | undefined) ?? null : null,
      available: b.status === 'available', booked, rate,
    };
  }));

  // One open per visitor per link per 30 minutes.
  if (rateLimit(`share-open:${link.id}:${ip}`, 1, 30 * 60_000)) {
    await admin.from('board_share_links').update({ open_count: (link.open_count ?? 0) + 1, last_opened_at: new Date().toISOString() }).eq('id', link.id);
  }

  return NextResponse.json({
    title: link.title, company: company?.company_name || company?.full_name || null, expires_at: link.expires_at,
    boards: ids.map(id => out.find(b => b.id === id)).filter(Boolean),
  });
}
