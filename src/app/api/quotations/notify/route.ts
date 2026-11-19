import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, unauthorized } from '@/lib/require-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { loadQuotation, isAdmin, adminEmails, logEmail } from '@/lib/quotation-server';
import { quotationPdf } from '@/lib/quotation-pdf';
import { rateLimit, rateLimitResponse } from '@/lib/rate-limit';
import {
  sendEmail, emailConfigured, quotationSentEmail, quotationWithdrawnEmail, bookingConfirmedEmail, quotationAnsweredEmail,
} from '@/lib/email';

export const runtime = 'nodejs';

// Quotation emails (061). The app calls this after a quotation action with
// the quotation id and what happened. The server checks the quotation's real
// state before sending, so a caller cannot send an email for something that
// did not happen. Every attempt is written to email_log.
//
//   sent / resend / withdrawn / confirmed   admins; email the buyer
//   accepted / declined / clarify           the buyer; email our team

type Event = 'sent' | 'resend' | 'withdrawn' | 'confirmed' | 'accepted' | 'declined' | 'clarify';
const ADMIN_EVENTS: Event[] = ['sent', 'resend', 'withdrawn', 'confirmed'];
const BUYER_EVENTS: Event[] = ['accepted', 'declined', 'clarify'];
const NEEDS_STATUS: Record<Event, string[]> = {
  sent: ['sent'], resend: ['sent'], withdrawn: ['withdrawn'], confirmed: ['accepted'],
  accepted: ['accepted'], declined: ['declined'], clarify: ['sent'],
};

export async function POST(req: NextRequest) {
  const user = await requireAuth(req);
  if (!user) return unauthorized();
  if (!rateLimit(`qnotify:${user.id}`, 20, 60_000)) return rateLimitResponse();
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: 'Server not configured' }, { status: 500 });

  const { id, event } = (await req.json().catch(() => ({}))) as { id?: string; event?: Event };
  if (!id || !event || !(event in NEEDS_STATUS) || !/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: 'id and event required' }, { status: 400 });
  }

  const q = await loadQuotation(db, id);
  if (!q) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const admin = await isAdmin(db, user);
  if (ADMIN_EVENTS.includes(event) && !admin) return NextResponse.json({ error: 'Admins only' }, { status: 403 });
  if (BUYER_EVENTS.includes(event) && q.agencyId !== user.id) return NextResponse.json({ error: 'Not your quotation' }, { status: 403 });
  if (!NEEDS_STATUS[event].includes(q.status)) return NextResponse.json({ error: `Quotation is ${q.status}` }, { status: 409 });
  if (event === 'confirmed') {
    const { data: c } = await db.from('quotations').select('booking_confirmed_at').eq('id', q.id).maybeSingle();
    if (!c?.booking_confirmed_at) return NextResponse.json({ error: 'Booking not confirmed yet' }, { status: 409 });
  }

  const kind = `quotation_${event === 'resend' ? 'sent' : event}`;
  // One email per event, except an explicit resend (and each new question).
  if (event !== 'resend' && event !== 'clarify') {
    const { count } = await db.from('email_log').select('id', { count: 'exact', head: true })
      .eq('quotation_id', q.id).eq('kind', kind).eq('status', 'sent');
    if (count) return NextResponse.json({ sent: 0, failed: 0, already: true });
  }

  const results: { to: string; ok: boolean }[] = [];
  const send = async (to: string | null, subject: string, html: string, withPdf = false) => {
    if (!to) return;
    if (!emailConfigured()) {
      await logEmail(db, { kind, recipient: to, subject, status: 'skipped', error: 'email not configured', quotation_id: q.id, request_id: q.requestId });
      results.push({ to, ok: false });
      return;
    }
    const attachments = withPdf ? [{ filename: `${q.ref}.pdf`, content: await quotationPdf(q.pdf), contentType: 'application/pdf' }] : undefined;
    const ok = await sendEmail(to, subject, html, attachments);
    await logEmail(db, { kind, recipient: to, subject, status: ok ? 'sent' : 'failed', error: ok ? null : 'SMTP send failed (see server logs)', quotation_id: q.id, request_id: q.requestId });
    results.push({ to, ok });
  };

  if (event === 'sent' || event === 'resend') {
    const m = quotationSentEmail(q.email, q.revised);
    await send(q.buyerEmail, m.subject, m.html, true);
  } else if (event === 'withdrawn') {
    const m = quotationWithdrawnEmail(q.email, q.withdrawReason);
    await send(q.buyerEmail, m.subject, m.html);
  } else if (event === 'confirmed') {
    const m = bookingConfirmedEmail(q.email);
    await send(q.buyerEmail, m.subject, m.html);
  } else {
    // The note comes from the database (what the buyer actually saved), not from the caller.
    let note: string | null = null;
    if (event === 'declined') note = q.declineReason;
    if (event === 'clarify') {
      const { data: ev } = await db.from('quotation_events').select('note, created_at').eq('quotation_id', q.id).eq('event', 'clarification')
        .order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (!ev || Date.now() - new Date(ev.created_at).getTime() > 10 * 60_000) return NextResponse.json({ sent: 0, failed: 0 });
      note = ev.note;
    }
    const m = quotationAnsweredEmail(q.email, event as 'accepted' | 'declined' | 'clarify', note);
    for (const a of await adminEmails(db)) await send(a, m.subject, m.html);
  }

  return NextResponse.json({ sent: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok).length });
}
