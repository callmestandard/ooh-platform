import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAuth, unauthorized } from '@/lib/require-auth';
import { emailOwnerReminder } from '@/lib/email';

export const runtime = 'nodejs';
export const maxDuration = 300;

// Weekly owner reminder emails (migration 055).
//   GET  — the Monday Vercel cron (see vercel.json). Needs CRON_SECRET.
//   POST — an admin's "Email now" for one owner: { ownerKey }.
// Who is due, and their link, comes from the database (owner_reminders_due),
// never from the caller.

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://ooh-platform-xi.vercel.app').replace(/\/$/, '');

type Due = { owner_key: string; owner_name: string; email: string; token: string; boards: number; stale: number; waiting: number };

async function send(list: Due[]) {
  let sent = 0;
  const failed: string[] = [];
  for (const o of list) {
    const ok = await emailOwnerReminder(o.email, { ownerName: o.owner_name, url: `${APP_URL}/o/${o.token}`, boards: o.boards, stale: o.stale, waiting: o.waiting });
    if (ok) {
      sent++;
      await db.from('owner_links').update({ last_reminded_at: new Date().toISOString() }).eq('owner_key', o.owner_key);
    } else {
      failed.push(o.owner_name);
    }
    await new Promise(r => setTimeout(r, 600)); // stay under the email provider's rate limit
  }
  return { sent, failed };
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET is not set' }, { status: 500 });
  if (req.headers.get('authorization') !== `Bearer ${secret}`) return unauthorized();

  const { data, error } = await db.rpc('owner_reminders_due', { p_owner_key: null });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const result = await send((data ?? []) as Due[]);
  console.log('[owner-reminders] weekly', JSON.stringify({ due: (data ?? []).length, ...result }));
  return NextResponse.json({ due: (data ?? []).length, ...result });
}

export async function POST(req: NextRequest) {
  const user = await requireAuth(req);
  if (!user) return unauthorized();
  const { data: me } = await db.from('profiles').select('role').eq('id', user.id).maybeSingle();
  if (me?.role !== 'admin') return NextResponse.json({ error: 'Admins only' }, { status: 403 });

  const { ownerKey } = await req.json().catch(() => ({}));
  if (typeof ownerKey !== 'string' || !ownerKey) return NextResponse.json({ error: 'Missing owner' }, { status: 400 });

  const { data, error } = await db.rpc('owner_reminders_due', { p_owner_key: ownerKey });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const list = (data ?? []) as Due[];
  if (!list.length) return NextResponse.json({ error: 'Add an email for this owner first' }, { status: 400 });
  const result = await send(list);
  if (!result.sent) {
    return NextResponse.json({ error: 'The email could not be sent. Check that the sending address is on a domain verified in Resend.' }, { status: 502 });
  }
  return NextResponse.json(result);
}
