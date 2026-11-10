import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAuth, unauthorized } from '@/lib/require-auth';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

/**
 * Admin: permanently delete a board, its admin records (rate, owner name,
 * current brand — these cascade) and its stored photos. Boards with bookings
 * or buyer requests are refused: deleting would strip those records of their
 * board, so the admin marks the board Unavailable instead.
 */
export async function POST(req: NextRequest) {
  const user = await requireAuth(req);
  if (!user) return unauthorized();

  const { data: profile } = await supabaseAdmin.from('profiles').select('role').eq('id', user.id).single();
  if (profile?.role !== 'admin') return NextResponse.json({ error: 'Only admins can delete boards' }, { status: 403 });

  const { boardId } = (await req.json().catch(() => ({}))) as { boardId?: string };
  if (!boardId || !/^[0-9a-f-]{36}$/i.test(boardId)) return NextResponse.json({ error: 'Missing board' }, { status: 400 });

  const { data: board } = await supabaseAdmin.from('boards').select('id, name, photo_urls').eq('id', boardId).single();
  if (!board) return NextResponse.json({ error: 'Board not found' }, { status: 404 });

  const [{ count: bookings }, { count: requests }] = await Promise.all([
    supabaseAdmin.from('bookings').select('id', { count: 'exact', head: true }).eq('board_id', boardId),
    supabaseAdmin.from('availability_requests').select('id', { count: 'exact', head: true }).eq('board_id', boardId),
  ]);
  if ((bookings ?? 0) > 0 || (requests ?? 0) > 0) {
    return NextResponse.json({
      error: `This board has ${bookings ? `${bookings} booking${bookings === 1 ? '' : 's'}` : ''}${bookings && requests ? ' and ' : ''}${requests ? `${requests} buyer request${requests === 1 ? '' : 's'}` : ''}, so it can't be deleted. Mark it Unavailable instead.`,
      bookings, requests,
    }, { status: 409 });
  }

  const { error } = await supabaseAdmin.from('boards').delete().eq('id', boardId);
  if (error) return NextResponse.json({ error: 'Could not delete the board' }, { status: 500 });

  // Photos go too (only files in our own board-photos bucket).
  const paths = ((board.photo_urls as string[] | null) ?? [])
    .map(u => u.split('/storage/v1/object/public/board-photos/')[1])
    .filter((p): p is string => !!p && !p.includes('..'));
  if (paths.length) await supabaseAdmin.storage.from('board-photos').remove(paths);

  await supabaseAdmin.from('activity_events').insert({
    entity_type: 'board', entity_id: boardId, actor_id: user.id, actor_role: 'admin',
    action: 'board.deleted', summary: `Board deleted: ${board.name}`,
  }).then(() => undefined, () => undefined);

  return NextResponse.json({ ok: true });
}
