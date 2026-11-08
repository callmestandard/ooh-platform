/**
 * One-to-many availability requests: an agency sends one structured request
 * to every owner with a matching board; each owner answers once per board.
 *
 * Requires: supabase/migrations/034_availability_requests.sql — all the
 * isolation rules (who sees which request, recipient and quote) live there
 * in RLS; these helpers just perform the reads and writes.
 */

import { supabase } from './supabase';
import { createNotification } from './notifications';
import { attachVisibleRates, attachRatesToBookings } from './board-rates';

export type AvailabilityRequest = {
  id: string;
  agency_id: string;
  agency_name: string | null;
  title: string;
  cities: string[];
  formats: string[];
  start_date: string;
  end_date: string;
  budget: number | null;
  notes: string | null;
  status: 'open' | 'closed';
  created_at: string;
  /** Set for "Request this location" (043): the request is for this one board. */
  board_id?: string | null;
  stage?: RequestStage;
  stage_updated_at?: string;
  sites_needed?: number | null;
  extra_requirements?: string | null;
};

export type RequestStage =
  | 'requested' | 'owner_responded' | 'quote_received' | 'unavailable'
  | 'negotiating' | 'accepted' | 'booking_in_progress' | 'confirmed' | 'cancelled';

/** Buyer-facing labels for each stage. */
export const STAGE_META: Record<RequestStage, { label: string; help: string; bg: string; color: string }> = {
  requested:           { label: 'Requested',           help: 'Sent. Waiting for the media owner to reply.',                           bg: '#FEF3C7', color: '#92400E' },
  owner_responded:     { label: 'Owner responded',     help: 'The owner says it is available. A price will follow.',                 bg: '#DBEAFE', color: '#1E40AF' },
  quote_received:      { label: 'Quote received',      help: 'The owner sent a price for your dates.',                               bg: '#DBEAFE', color: '#1E40AF' },
  unavailable:         { label: 'Unavailable',         help: "The owner can't offer this board for your dates.",                   bg: '#F1F5F9', color: '#475569' },
  negotiating:         { label: 'Negotiating',         help: 'You and the owner are agreeing the terms in a conversation.',                              bg: '#EDE9FE', color: '#5B21B6' },
  accepted:            { label: 'Accepted',            help: 'Request accepted. Our team will contact you to complete the booking.', bg: '#D1FAE5', color: '#065F46' },
  booking_in_progress: { label: 'Booking in progress', help: 'Our team is completing the booking with you and the owner.',            bg: '#D1FAE5', color: '#065F46' },
  confirmed:           { label: 'Confirmed',           help: 'Booking confirmed.',                                                    bg: '#065F46', color: '#FFFFFF' },
  cancelled:           { label: 'Cancelled',           help: 'You cancelled this request.',                                           bg: '#F1F5F9', color: '#64748B' },
};

/** The main path a request moves along, for the progress bar. */
export const STAGE_PATH: RequestStage[] = ['requested', 'quote_received', 'negotiating', 'accepted', 'booking_in_progress', 'confirmed'];

export const CANCELLABLE_STAGES: RequestStage[] = ['requested', 'owner_responded', 'quote_received', 'unavailable', 'negotiating'];

/** Stages where the buyer can answer the owner's reply (044). */
export const ANSWERABLE_STAGES: RequestStage[] = ['owner_responded', 'quote_received'];

export type AvailabilityRecipient = {
  id: string;
  request_id: string;
  owner_id: string;
  owner_name: string | null;
  board_count: number;
  responded_at: string | null;
};

export type AvailabilityResponse = {
  id: string;
  request_id: string;
  owner_id: string;
  board_id: string;
  available: boolean;
  quoted_rate: number | null;
  note: string | null;
  /** Period the owner can offer and any conditions (044). */
  available_from?: string | null;
  available_to?: string | null;
  conditions?: string | null;
  accepted_booking_id: string | null;
  updated_at: string;
  boards?: { name: string; city: string | null; format: string | null; address: string | null; asking_rate: number | null } | null;
};

export type UnreachedBoard = { board_id: string; name: string; city: string | null; format: string | null; contact_name: string | null; contact_phone: string | null };

export type OwnerBoard = { id: string; name: string; city: string | null; format: string | null; address: string | null; asking_rate: number | null; status: string };

const err = (e: { message: string } | null) => e?.message ?? null;

// ── Agency ──────────────────────────────────────────────────────────────────

export async function sendAvailabilityRequest(input: {
  title: string; cities: string[]; formats: string[]; startDate: string; endDate: string; budget: number | null; notes: string;
}): Promise<{ id: string | null; error: string | null }> {
  const { data, error } = await supabase.rpc('send_availability_request', {
    p_title: input.title,
    p_cities: input.cities,
    p_formats: input.formats,
    p_start: input.startDate,
    p_end: input.endDate,
    p_budget: input.budget,
    p_notes: input.notes,
  });
  return { id: (data as string) ?? null, error: err(error) };
}

export async function listAgencyRequests(): Promise<{ requests: (AvailabilityRequest & { recipients: AvailabilityRecipient[] })[]; error: string | null }> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { requests: [], error: 'Not signed in' };
  const { data, error } = await supabase
    .from('availability_requests')
    .select('*, recipients:availability_request_recipients(*)')
    .eq('agency_id', session.user.id)
    .is('board_id', null)
    .order('created_at', { ascending: false });
  return { requests: (data ?? []) as (AvailabilityRequest & { recipients: AvailabilityRecipient[] })[], error: err(error) };
}

export async function fetchRequestResponses(requestId: string): Promise<{ responses: AvailabilityResponse[]; unreached: UnreachedBoard[]; error: string | null }> {
  const [res, unreached] = await Promise.all([
    supabase.from('availability_responses').select('*, boards(name, city, format, address, asking_rate)').eq('request_id', requestId),
    supabase.rpc('availability_request_unreached_boards', { p_request_id: requestId }),
  ]);
  return {
    responses: await attachRatesToBookings((res.data ?? []) as unknown as AvailabilityResponse[]),
    unreached: (unreached.data ?? []) as UnreachedBoard[],
    error: err(res.error) ?? err(unreached.error),
  };
}

export async function setRequestStatus(requestId: string, status: 'open' | 'closed'): Promise<{ error: string | null }> {
  const { error } = await supabase.from('availability_requests').update({ status }).eq('id', requestId);
  return { error: err(error) };
}

function monthsBetween(start: string, end: string) {
  const days = (new Date(end).getTime() - new Date(start).getTime()) / 86_400_000 + 1;
  return Math.max(1, Math.round(days / 30));
}

/**
 * Turn accepted responses into bookings on one of the agency's campaigns —
 * they enter the normal negotiation flow as pending offers, opening at the
 * owner's quoted rate (or the board's asking rate when no rate was quoted).
 */
export async function acceptResponses(
  request: AvailabilityRequest,
  responses: AvailabilityResponse[],
  campaignId: string,
): Promise<{ created: number; error: string | null }> {
  let created = 0;
  for (const r of responses) {
    const rate = r.quoted_rate ?? r.boards?.asking_rate ?? null;
    const { data: booking, error } = await supabase.from('bookings').insert({
      campaign_id: campaignId,
      board_id: r.board_id,
      offered_rate: rate,
      status: 'pending',
      start_date: request.start_date,
      end_date: request.end_date,
      duration_months: monthsBetween(request.start_date, request.end_date),
      is_in_plan: true,
      notes: `From availability request "${request.title}"${r.quoted_rate ? ' — owner quoted this rate' : ''}`,
    }).select('id').single();
    if (error || !booking) return { created, error: err(error) ?? 'Could not create booking' };

    const link = await supabase.from('availability_responses').update({ accepted_booking_id: booking.id }).eq('id', r.id);
    if (link.error) return { created, error: link.error.message };
    created++;

    await createNotification({
      recipientRole: 'owner',
      recipientUserId: r.owner_id,
      type: 'new_booking',
      title: 'Booking request from your availability response',
      body: `${r.boards?.name ?? 'Your board'} — ${request.title}`,
      link: '/dashboard/owner?tab=bookings',
    });
  }
  return { created, error: null };
}

// ── Buyer: "Request this location" (043) ────────────────────────────────────

export type BoardRequestInput = {
  boardId: string; startDate: string; endDate: string;
  name: string; company: string; email: string; phone: string; message: string;
  budget: number | null; sites: number | null; extra: string;
};

export async function sendBoardRequest(input: BoardRequestInput): Promise<{ id: string | null; error: string | null }> {
  const { data, error } = await supabase.rpc('send_board_request', {
    p_board_id: input.boardId,
    p_start: input.startDate,
    p_end: input.endDate,
    p_name: input.name,
    p_company: input.company,
    p_email: input.email,
    p_phone: input.phone,
    p_message: input.message,
    p_budget: input.budget,
    p_sites: input.sites,
    p_extra: input.extra,
  });
  return { id: (data as string) ?? null, error: err(error) };
}

export type BoardRequest = AvailabilityRequest & {
  board_id: string | null;
  stage: RequestStage;
  stage_updated_at: string;
  board: { id: string; name: string; city: string | null; area: string | null; format: string | null; photo_urls: string[] | null } | null;
  responses: Pick<AvailabilityResponse, 'id' | 'available' | 'quoted_rate' | 'note' | 'available_from' | 'available_to' | 'conditions' | 'accepted_booking_id' | 'updated_at'>[];
  recipients: Pick<AvailabilityRecipient, 'id' | 'responded_at'>[];
};

export async function listMyBoardRequests(): Promise<{ requests: BoardRequest[]; error: string | null }> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { requests: [], error: 'Not signed in' };
  const { data, error } = await supabase
    .from('availability_requests')
    .select('*, board:boards(id, name, city, area, format, photo_urls), responses:availability_responses(id, available, quoted_rate, note, available_from, available_to, conditions, accepted_booking_id, updated_at), recipients:availability_request_recipients(id, responded_at)')
    .eq('agency_id', session.user.id)
    .not('board_id', 'is', null)
    .order('created_at', { ascending: false });
  return { requests: (data ?? []) as unknown as BoardRequest[], error: err(error) };
}

export async function cancelBoardRequest(requestId: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from('availability_requests').update({ stage: 'cancelled' }).eq('id', requestId);
  return { error: err(error) };
}

/**
 * Buyer answers the owner's quote (044): accept it as is, or open a
 * negotiation thread. Either way returns the booking that holds the deal.
 */
export async function answerBoardQuote(requestId: string, accept: boolean): Promise<{ bookingId: string | null; error: string | null }> {
  const { data, error } = await supabase.rpc('answer_board_quote', { p_request_id: requestId, p_accept: accept });
  return { bookingId: (data as string) ?? null, error: err(error) };
}

// ── Owner ───────────────────────────────────────────────────────────────────

/**
 * Requests and replies are keyed by the owner COMPANY (migration 035), so a
 * marketer answers as their company. Falls back to the user's own id for an
 * owner account, or if 035 isn't applied yet.
 */
async function ownerCompanyId(userId: string): Promise<string> {
  const { data } = await supabase.rpc('owner_company_of', { p_uid: userId });
  return (data as string | null) ?? userId;
}

export async function listOwnerRequests(): Promise<{
  items: { request: AvailabilityRequest; recipient: AvailabilityRecipient }[];
  error: string | null;
}> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { items: [], error: 'Not signed in' };
  const { data, error } = await supabase
    .from('availability_request_recipients')
    .select('*, request:availability_requests(*)')
    .eq('owner_id', await ownerCompanyId(session.user.id))
    .order('created_at', { ascending: false });
  const rows = (data ?? []) as unknown as (AvailabilityRecipient & { request: AvailabilityRequest | null })[];
  return {
    items: rows.filter(r => r.request).map(({ request, ...recipient }) => ({ request: request!, recipient })),
    error: err(error),
  };
}

/** The signed-in owner's boards that match a request's cities + formats. */
export async function fetchOwnerMatchingBoards(request: AvailabilityRequest): Promise<OwnerBoard[]> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return [];
  const uid = await ownerCompanyId(session.user.id);
  const [direct, viaAuth] = await Promise.all([
    supabase.from('boards').select('id, name, city, format, address, asking_rate, status').eq('owner_id', uid),
    supabase.from('board_authorizations').select('boards(id, name, city, format, address, asking_rate, status)').eq('owner_id', uid).eq('status', 'active').eq('owner_verified', true),
  ]);
  const all = new Map<string, OwnerBoard>();
  ((direct.data ?? []) as OwnerBoard[]).forEach(b => all.set(b.id, b));
  ((viaAuth.data ?? []) as unknown as { boards: OwnerBoard | null }[]).forEach(a => { if (a.boards) all.set(a.boards.id, a.boards); });

  // A marketer answers only for boards that currently route to them; the
  // owner and owner admins answer for all of the company's boards.
  if (uid !== session.user.id) {
    const { data: mine } = await supabase.rpc('my_owner_company');
    if ((mine as { team_role: string }[] | null)?.[0]?.team_role === 'marketer') {
      await Promise.all([...all.keys()].map(async id => {
        const { data: assignee } = await supabase.rpc('board_assignee', { p_board_id: id });
        if (assignee !== session.user.id) all.delete(id);
      }));
    }
  }

  const cities = request.cities.map(c => c.trim().toLowerCase());
  return (await attachVisibleRates([...all.values()])).filter(b =>
    b.status !== 'decommissioned'
    && (!request.board_id || b.id === request.board_id)
    && !!b.city && cities.includes(b.city.trim().toLowerCase())
    && (request.formats.length === 0 || (!!b.format && request.formats.includes(b.format))),
  );
}

export async function fetchOwnResponses(requestId: string): Promise<AvailabilityResponse[]> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return [];
  const { data } = await supabase.from('availability_responses').select('*').eq('request_id', requestId).eq('owner_id', await ownerCompanyId(session.user.id));
  return (data ?? []) as AvailabilityResponse[];
}

export async function submitOwnerResponses(
  request: AvailabilityRequest,
  answers: { boardId: string; available: boolean; quotedRate: number | null; note: string; availableFrom?: string; availableTo?: string; conditions?: string }[],
): Promise<{ error: string | null }> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { error: 'Not signed in' };
  const ownerId = await ownerCompanyId(session.user.id);
  const { error } = await supabase.from('availability_responses').upsert(
    answers.map(a => ({
      request_id: request.id,
      owner_id: ownerId,
      board_id: a.boardId,
      available: a.available,
      quoted_rate: a.available ? a.quotedRate : null,
      note: a.note.trim() || null,
      available_from: a.available ? a.availableFrom || null : null,
      available_to: a.available ? a.availableTo || null : null,
      conditions: a.available ? a.conditions?.trim() || null : null,
    })),
    { onConflict: 'request_id,board_id' },
  );
  if (error) return { error: error.message };

  if (request.board_id) {
    const a = answers[0];
    await createNotification({
      recipientRole: 'agency',
      recipientUserId: request.agency_id,
      type: 'availability_response',
      title: !a?.available ? `${request.title} is not available for your dates`
        : a.quotedRate ? `Quote received for ${request.title}` : `${request.title} is available`,
      body: a?.available && a.quotedRate ? `₦${Math.round(a.quotedRate).toLocaleString('en-NG')} per month` : (a?.note || undefined),
      link: '/dashboard/agency/requests',
    });
  } else {
    await createNotification({
      recipientRole: 'agency',
      recipientUserId: request.agency_id,
      type: 'availability_response',
      title: 'An owner answered your availability request',
      body: `${request.title} — ${answers.filter(a => a.available).length} of ${answers.length} boards available`,
      link: '/dashboard/agency/availability-requests',
    });
  }
  return { error: null };
}
