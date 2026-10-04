import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { rateLimit, rateLimitResponse } from '@/lib/rate-limit';

export const runtime = 'nodejs';

// "Request this board" on a share link: records the enquiry against the
// link and notifies whoever the board is currently assigned to (falling back
// to the owner). Only boards that are on this link can be requested.
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (!rateLimit(`share-request:${ip}`, 8, 60 * 60_000)) return rateLimitResponse();
  if (!/^[0-9a-f]{64}$/.test(token)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const admin = getSupabaseAdmin();
  if (!admin) return NextResponse.json({ error: 'Not available' }, { status: 500 });

  const body = await req.json().catch(() => ({}));
  const clean = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);
  const name = clean(body.name, 120), contact = clean(body.contact, 160), company = clean(body.company, 160), message = clean(body.message, 1000);
  const boardId = clean(body.boardId, 64);
  if (!name || !contact) return NextResponse.json({ error: 'Your name and a phone number or email are required' }, { status: 400 });

  const { data: link } = await admin.from('board_share_links').select('id, board_ids, owner_id, expires_at, revoked_at').eq('token', token).maybeSingle();
  if (!link) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (link.revoked_at || new Date(link.expires_at).getTime() < Date.now()) return NextResponse.json({ error: 'This link has expired or been withdrawn' }, { status: 410 });
  if (!(link.board_ids as string[]).includes(boardId)) return NextResponse.json({ error: 'That board is not on this link' }, { status: 400 });

  const [{ data: assignee }, { data: board }] = await Promise.all([
    admin.rpc('board_assignee', { p_board_id: boardId }),
    admin.from('boards').select('name').eq('id', boardId).maybeSingle(),
  ]);
  const { error } = await admin.from('share_link_requests').insert({
    link_id: link.id, board_id: boardId, owner_id: link.owner_id, assignee_id: assignee ?? link.owner_id,
    name, company: company || null, contact, message: message || null,
  });
  if (error) return NextResponse.json({ error: 'Could not send your request' }, { status: 500 });

  const toOwner = !assignee || assignee === link.owner_id;
  await admin.from('notifications').insert({
    recipient_role: toOwner ? 'owner' : 'marketer', recipient_user_id: assignee ?? link.owner_id, type: 'new_booking',
    title: 'New enquiry from a share link', body: `${name}${company ? ' (' + company + ')' : ''} asked about ${board?.name ?? 'a board'}`,
    link: '/dashboard/marketer/share-links',
  });
  return NextResponse.json({ ok: true });
}
