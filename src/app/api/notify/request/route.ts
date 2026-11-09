import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAuth, unauthorized } from '@/lib/require-auth';
import {
  emailRequestToOwner, emailRequestConfirmation, emailRequestToAdmin,
  emailOwnerReplied, emailDealAgreed, type RequestEmailInfo,
} from '@/lib/email';

export const runtime = 'nodejs';

// Board-request emails (migration 046). The app calls this after any action
// on a request — sending it, answering it, agreeing a deal — with only the
// request (or booking) id. Who gets what is decided here from the database,
// never from the caller, and request_email_log makes each email go out once.

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

type Event = 'received' | 'replied' | 'accepted';

const REPLIED_STAGES = ['owner_responded', 'quote_received', 'unavailable', 'negotiating', 'accepted', 'booking_in_progress', 'confirmed'];
const ACCEPTED_STAGES = ['accepted', 'booking_in_progress', 'confirmed'];
// Events older than this are logged as skipped rather than emailed (e.g.
// requests from before this went live).
const MAX_AGE_MS = 2 * 24 * 60 * 60 * 1000;

async function emailOf(uid: string | null | undefined): Promise<string | null> {
  if (!uid) return null;
  const { data } = await db.auth.admin.getUserById(uid);
  return data?.user?.email ?? null;
}

/** Claim an event; true only for the first caller. */
async function claim(requestId: string, event: Event, skipped: boolean): Promise<boolean> {
  const { data, error } = await db.from('request_email_log')
    .upsert({ request_id: requestId, event, skipped }, { onConflict: 'request_id,event', ignoreDuplicates: true })
    .select('event');
  if (error) { console.error('[notify/request] claim', error.message); return false; }
  return (data?.length ?? 0) > 0;
}

const fresh = (iso: string | null | undefined) => !!iso && Date.now() - new Date(iso).getTime() < MAX_AGE_MS;

export async function POST(req: NextRequest) {
  const user = await requireAuth(req);
  if (!user) return unauthorized();

  const { requestId: rid, bookingId } = (await req.json().catch(() => ({}))) as { requestId?: string; bookingId?: string };
  let requestId = rid ?? null;
  if (!requestId && bookingId) {
    const { data: b } = await db.from('bookings').select('campaign_id').eq('id', bookingId).maybeSingle();
    if (b?.campaign_id) {
      const { data: c } = await db.from('campaigns').select('request_id').eq('id', b.campaign_id).maybeSingle();
      requestId = (c?.request_id as string | null) ?? null;
    }
    // A booking outside the request flow: nothing to send.
    if (!requestId) return NextResponse.json({ sent: [] });
  }
  if (!requestId) return NextResponse.json({ error: 'requestId or bookingId required' }, { status: 400 });

  const { data: r } = await db.from('availability_requests')
    .select('id, agency_id, agency_name, board_id, stage, stage_updated_at, start_date, end_date, created_at')
    .eq('id', requestId).maybeSingle();
  if (!r || !r.board_id) return NextResponse.json({ sent: [] });

  const [{ data: board }, { data: recipient }, { data: contact }, { data: me }] = await Promise.all([
    db.from('boards').select('name, area, city, owner_id').eq('id', r.board_id).maybeSingle(),
    db.from('availability_request_recipients').select('owner_id, owner_name').eq('request_id', r.id).maybeSingle(),
    db.from('availability_request_contacts').select('company, email').eq('request_id', r.id).maybeSingle(),
    db.from('profiles').select('role').eq('id', user.id).maybeSingle(),
  ]);
  const ownerId: string | null = recipient?.owner_id ?? board?.owner_id ?? null;

  // Only someone on the request may trigger its emails.
  const isAdmin = me?.role === 'admin';
  let allowed = isAdmin || user.id === r.agency_id;
  if (!allowed && ownerId) {
    const { data: member } = await db.rpc('is_owner_member', { p_owner_id: ownerId, p_uid: user.id });
    allowed = !!member;
  }
  if (!allowed) return NextResponse.json({ error: 'Not your request' }, { status: 403 });

  let ownerName = recipient?.owner_name ?? null;
  if (!ownerName && ownerId) {
    const { data: op } = await db.from('profiles').select('company_name, full_name').eq('id', ownerId).maybeSingle();
    ownerName = op?.company_name ?? op?.full_name ?? null;
  }
  const info: RequestEmailInfo = {
    boardName: board?.name ?? 'your board',
    location: [board?.area, board?.city].filter(Boolean).join(', '),
    startDate: r.start_date,
    endDate: r.end_date,
    buyerCompany: contact?.company ?? r.agency_name ?? 'A buyer',
    ownerName: ownerName ?? 'No owner account yet',
  };
  const buyerEmail = (await emailOf(r.agency_id)) ?? contact?.email ?? null;
  const ownerEmail = await emailOf(ownerId);
  const adminEmails = async () => {
    const { data } = await db.from('profiles').select('id').eq('role', 'admin');
    return (await Promise.all((data ?? []).map(a => emailOf(a.id)))).filter((e): e is string => !!e);
  };

  const sent: Event[] = [];

  // 1. Request received
  if (r.stage !== 'cancelled') {
    const ok = fresh(r.created_at);
    if (await claim(r.id, 'received', !ok) && ok) {
      if (ownerEmail) await emailRequestToOwner(ownerEmail, info);
      if (buyerEmail) await emailRequestConfirmation(buyerEmail, info, !!ownerEmail);
      for (const a of await adminEmails()) await emailRequestToAdmin(a, info, !!ownerEmail);
      sent.push('received');
    }
  }

  // 2. Owner (or our team) replied
  if (REPLIED_STAGES.includes(r.stage)) {
    const { data: resp } = await db.from('availability_responses')
      .select('available, quoted_rate, available_from, available_to, conditions, note, updated_at')
      .eq('request_id', r.id).order('updated_at', { ascending: false }).limit(1).maybeSingle();
    if (resp) {
      const ok = fresh(resp.updated_at);
      if (await claim(r.id, 'replied', !ok) && ok && buyerEmail) {
        await emailOwnerReplied(buyerEmail, info, {
          available: resp.available, rate: resp.quoted_rate, from: resp.available_from, to: resp.available_to,
          conditions: resp.conditions, note: resp.note,
        });
        sent.push('replied');
      }
    }
  }

  // 3. Deal agreed
  if (ACCEPTED_STAGES.includes(r.stage)) {
    const ok = fresh(r.stage_updated_at);
    if (await claim(r.id, 'accepted', !ok) && ok) {
      const { data: resp } = await db.from('availability_responses').select('accepted_booking_id').eq('request_id', r.id).not('accepted_booking_id', 'is', null).limit(1).maybeSingle();
      let rate: number | null = null;
      if (resp?.accepted_booking_id) {
        const { data: bk } = await db.from('bookings').select('agreed_rate, offered_rate').eq('id', resp.accepted_booking_id).maybeSingle();
        rate = bk?.agreed_rate ?? bk?.offered_rate ?? null;
      }
      if (buyerEmail) await emailDealAgreed(buyerEmail, info, 'buyer', rate);
      if (ownerEmail) await emailDealAgreed(ownerEmail, info, 'owner', rate);
      for (const a of await adminEmails()) await emailDealAgreed(a, info, 'admin', rate);
      sent.push('accepted');
    }
  }

  return NextResponse.json({ sent });
}
