import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAuth, unauthorized } from '@/lib/require-auth';
import { emailOwnerReminder, ownerReminderEmail } from '@/lib/email';
import { logEmail } from '@/lib/quotation-server';

export const runtime = 'nodejs';
export const maxDuration = 300;

// Weekly owner reminder emails (migrations 055, 063).
//   GET  — the Monday Vercel cron (see vercel.json). Needs CRON_SECRET.
//   POST — an admin's "Email now" for one owner: { ownerKey }.
// Who is due, and their link, comes from the database (owner_reminders_due),
// never from the caller. Revoked, expired, suspended and rejected owners are
// never due. Each owner is claimed before sending so two runs can't email the
// same owner twice; a failed send puts the claim back and is recorded.

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://ooh-platform-xi.vercel.app').replace(/\/$/, '');
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

type Due = { owner_key: string; owner_name: string; email: string; token: string; boards: number; stale: number; waiting: number };

/** Claims an owner for sending. Weekly: only if not reminded in 6 days. Manual: only if not in the last 2 minutes (double clicks). */
async function claim(o: Due, minGapMs: number): Promise<{ ok: boolean; previous: string | null }> {
  const { data: cur } = await db.from('owner_links').select('last_reminded_at').eq('owner_key', o.owner_key).maybeSingle();
  const previous = (cur?.last_reminded_at as string | null) ?? null;
  const cutoff = new Date(Date.now() - minGapMs).toISOString();
  let q = db.from('owner_links').update({ last_reminded_at: new Date().toISOString() }).eq('owner_key', o.owner_key);
  q = previous ? q.eq('last_reminded_at', previous).lt('last_reminded_at', cutoff) : q.is('last_reminded_at', null);
  const { data } = await q.select('owner_key');
  return { ok: (data ?? []).length === 1, previous };
}

async function send(list: Due[], minGapMs: number) {
  let sent = 0;
  const failed: string[] = [];
  const skipped: string[] = [];
  for (const o of list) {
    const subject = ownerReminderEmail({ ownerName: o.owner_name, url: '', boards: o.boards, stale: o.stale, waiting: o.waiting }).subject;
    if (!EMAIL_RE.test(o.email ?? '')) {
      skipped.push(o.owner_name);
      await logEmail(db, { kind: 'owner_reminder', recipient: o.email ?? '', subject, status: 'skipped', error: 'invalid email' });
      continue;
    }
    const c = await claim(o, minGapMs);
    if (!c.ok) { skipped.push(o.owner_name); continue; } // another run already sent it
    let ok = false;
    let err: string | null = null;
    try {
      ok = await emailOwnerReminder(o.email, { ownerName: o.owner_name, url: `${APP_URL}/o/${o.token}`, boards: o.boards, stale: o.stale, waiting: o.waiting });
      if (!ok) err = 'email provider refused';
    } catch (e) {
      err = e instanceof Error ? e.message : 'send failed';
    }
    if (ok) {
      sent++;
    } else {
      failed.push(o.owner_name);
      await db.from('owner_links').update({ last_reminded_at: c.previous }).eq('owner_key', o.owner_key);
    }
    await logEmail(db, { kind: 'owner_reminder', recipient: o.email, subject, status: ok ? 'sent' : 'failed', error: err });
    const { error: logErr } = await db.rpc('owner_reminder_result', { p_owner_key: o.owner_key, p_ok: ok, p_email: o.email, p_error: err });
    if (logErr) console.error('[owner-reminders] history', logErr.message);
    await new Promise(r => setTimeout(r, 600)); // stay under the email provider's rate limit
  }
  return { sent, failed, skipped };
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET is not set' }, { status: 500 });
  if (req.headers.get('authorization') !== `Bearer ${secret}`) return unauthorized();

  const { data, error } = await db.rpc('owner_reminders_due', { p_owner_key: null });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const result = await send((data ?? []) as Due[], 6 * 24 * 3600 * 1000);
  console.log('[owner-reminders] weekly', JSON.stringify({ due: (data ?? []).length, sent: result.sent, failed: result.failed.length, skipped: result.skipped.length }));
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
  if (!list.length) {
    return NextResponse.json({ error: 'No email can go to this owner: add an email, and check the link is active and the owner is not suspended.' }, { status: 400 });
  }
  const result = await send(list, 2 * 60 * 1000);
  if (result.skipped.length && !result.sent && !result.failed.length) {
    return NextResponse.json({ error: 'A reminder was sent to this owner a moment ago, or their email is not valid.' }, { status: 409 });
  }
  if (!result.sent) {
    return NextResponse.json({ error: 'The email could not be sent. Check SMTP_USER and SMTP_PASS (a Google app password) in Vercel.' }, { status: 502 });
  }
  return NextResponse.json(result);
}
