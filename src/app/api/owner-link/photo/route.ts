import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

export const runtime = 'nodejs';

// An owner adds a new photo for one of their boards from their private
// link (migration 056). No login: the link's token is the proof, checked
// against the board in the database. The photo is only stored here; it
// reaches the listing when our team applies the owner's correction.

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const MAX_BYTES = 4 * 1024 * 1024;
const MAX_PER_BOARD = 20;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  let form: FormData;
  try { form = await req.formData(); } catch { return NextResponse.json({ error: 'Send the photo again' }, { status: 400 }); }

  const token = String(form.get('token') ?? '');
  const boardId = String(form.get('boardId') ?? '');
  const file = form.get('file');
  if (token.length < 32 || !UUID.test(boardId) || !(file instanceof File)) {
    return NextResponse.json({ error: 'Missing photo' }, { status: 400 });
  }
  const ext = TYPES[file.type];
  if (!ext) return NextResponse.json({ error: 'Use a JPG, PNG or WebP photo' }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'That photo is too large' }, { status: 413 });

  const { data: owns, error } = await db.rpc('owner_link_owns', { p_token: token, p_board_id: boardId });
  if (error) return NextResponse.json({ error: 'Photos are not switched on yet' }, { status: 500 });
  if (!owns) return NextResponse.json({ error: 'This link is not valid any more' }, { status: 403 });

  // A link holder can't fill the storage: a small cap per board.
  const folder = `owner-link/${boardId}`;
  const { data: existing } = await db.storage.from('board-photos').list(folder, { limit: MAX_PER_BOARD + 1 });
  if ((existing?.length ?? 0) >= MAX_PER_BOARD) {
    return NextResponse.json({ error: 'Too many photos were added for this board. Message our team.' }, { status: 429 });
  }

  const path = `${folder}/${randomUUID()}.${ext}`;
  const up = await db.storage.from('board-photos').upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type, cacheControl: '3600', upsert: false });
  if (up.error) return NextResponse.json({ error: 'The photo could not be saved. Try again.' }, { status: 500 });

  return NextResponse.json({ url: db.storage.from('board-photos').getPublicUrl(path).data.publicUrl });
}
