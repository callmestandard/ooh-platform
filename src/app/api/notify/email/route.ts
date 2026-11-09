import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAuth, unauthorized } from '@/lib/require-auth';
import {
  emailPlanSentForApproval,
  emailPlanApproved,
  emailNewBookingRequest,
  emailBookingAccepted,
  emailBookingDeclined,
  emailBookingCounterOffer,
  escapeHtml,
} from '@/lib/email';

export const runtime = 'nodejs';

// Campaign and booking emails. The caller sends only the event type and a
// campaign or booking id. Recipients, names and amounts are read from the
// database here, and the caller must be the person the event belongs to, so
// this route can't be used to email arbitrary people or text.

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function getUserEmail(userId: string | null | undefined): Promise<string | null> {
  if (!userId) return null;
  try {
    const { data: { user } } = await db.auth.admin.getUserById(userId);
    return user?.email ?? null;
  } catch {
    return null;
  }
}

async function getProfileName(userId: string | null | undefined): Promise<string> {
  if (!userId) return 'Unknown';
  const { data } = await db.from('profiles').select('full_name, company_name').eq('id', userId).maybeSingle();
  return escapeHtml(data?.company_name ?? data?.full_name ?? 'Unknown');
}

type Campaign = { id: string; name: string | null; agency_id: string | null; client_id: string | null; request_id?: string | null };

async function loadCampaign(id: unknown): Promise<Campaign | null> {
  if (typeof id !== 'string') return null;
  const { data } = await db.from('campaigns').select('id, name, agency_id, client_id, request_id').eq('id', id).maybeSingle();
  return (data as Campaign | null) ?? null;
}

async function loadBooking(id: unknown) {
  if (typeof id !== 'string') return null;
  const { data } = await db.from('bookings')
    .select('id, status, offered_rate, agreed_rate, campaign_id, board_id, boards(name, owner_id)')
    .eq('id', id).maybeSingle();
  if (!data) return null;
  const board = (Array.isArray(data.boards) ? data.boards[0] : data.boards) as { name: string | null; owner_id: string | null } | null;
  const campaign = await loadCampaign(data.campaign_id);
  return { ...data, board, campaign };
}

async function isOwnerSide(ownerId: string | null | undefined, uid: string): Promise<boolean> {
  if (!ownerId) return false;
  if (ownerId === uid) return true;
  const { data } = await db.rpc('is_owner_member', { p_owner_id: ownerId, p_uid: uid });
  return !!data;
}

const forbidden = () => NextResponse.json({ error: 'Not allowed' }, { status: 403 });

export async function POST(req: NextRequest) {
  const user = await requireAuth(req);
  if (!user) return unauthorized();

  const body = (await req.json().catch(() => ({}))) as { type?: string; campaignId?: unknown; bookingId?: unknown; boardCount?: unknown };

  try {
    switch (body.type) {

      case 'plan_sent_for_approval': {
        // The agency sent its plan to the campaign's client. body: { campaignId }
        const c = await loadCampaign(body.campaignId);
        if (!c || c.agency_id !== user.id || !c.client_id) return forbidden();
        const { count } = await db.from('bookings').select('id', { count: 'exact', head: true }).eq('campaign_id', c.id);
        const to = await getUserEmail(c.client_id);
        if (to) {
          await emailPlanSentForApproval({
            to, clientName: await getProfileName(c.client_id), agencyName: await getProfileName(c.agency_id),
            campaignName: escapeHtml(c.name ?? 'Campaign'), boardCount: count ?? 0,
          });
        }
        break;
      }

      case 'plan_approved': {
        // The client approved the plan. body: { campaignId, boardCount }
        const c = await loadCampaign(body.campaignId);
        if (!c || c.client_id !== user.id || !c.agency_id) return forbidden();
        const to = await getUserEmail(c.agency_id);
        const n = Number(body.boardCount);
        if (to) {
          await emailPlanApproved({
            to, agencyName: await getProfileName(c.agency_id), clientName: await getProfileName(c.client_id),
            campaignName: escapeHtml(c.name ?? 'Campaign'), boardCount: Number.isFinite(n) && n >= 0 && n < 10_000 ? Math.floor(n) : 0, campaignId: c.id,
          });
        }
        break;
      }

      case 'booking_request': {
        // The agency offered on a board. body: { bookingId }
        const b = await loadBooking(body.bookingId);
        if (!b || b.campaign?.agency_id !== user.id) return forbidden();
        const ownerId = b.board?.owner_id;
        const to = await getUserEmail(ownerId);
        if (to) {
          await emailNewBookingRequest({
            to, ownerName: await getProfileName(ownerId), boardName: escapeHtml(b.board?.name ?? 'your board'),
            agencyName: await getProfileName(b.campaign?.agency_id), campaignName: escapeHtml(b.campaign?.name ?? 'New campaign'),
            rate: b.offered_rate ?? null, bookingId: b.id,
          });
        }
        break;
      }

      case 'booking_accepted':
      case 'booking_declined':
      case 'booking_counter_offer': {
        // The owner's side answered an offer. body: { bookingId }
        const b = await loadBooking(body.bookingId);
        const ownerId = b?.board?.owner_id;
        if (!b || !(await isOwnerSide(ownerId, user.id))) return forbidden();
        // The email must match what actually happened to the booking.
        const expected = { booking_accepted: ['agreed', 'signed', 'live'], booking_declined: ['declined'], booking_counter_offer: ['negotiating'] }[body.type];
        if (!expected.includes(b.status)) return NextResponse.json({ sent: false, reason: 'status does not match' });
        // Request-flow deals get their own "deal agreed" email (/api/notify/request).
        if (body.type === 'booking_accepted' && b.campaign?.request_id) return NextResponse.json({ sent: false, reason: 'request flow' });
        const agencyId = b.campaign?.agency_id;
        const to = await getUserEmail(agencyId);
        if (!to) break;
        const common = { to, agencyName: await getProfileName(agencyId), ownerName: await getProfileName(ownerId), boardName: escapeHtml(b.board?.name ?? 'a board'), bookingId: b.id };
        if (body.type === 'booking_accepted') await emailBookingAccepted({ ...common, agreedRate: b.agreed_rate ?? b.offered_rate ?? 0 });
        else if (body.type === 'booking_declined') await emailBookingDeclined(common);
        else await emailBookingCounterOffer({ ...common, counterRate: b.offered_rate ?? 0 });
        break;
      }

      default:
        return NextResponse.json({ error: 'Unknown type' }, { status: 400 });
    }

    return NextResponse.json({ sent: true });
  } catch (err: unknown) {
    console.error('[notify/email]', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
