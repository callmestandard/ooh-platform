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
};

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
    .order('created_at', { ascending: false });
  return { requests: (data ?? []) as (AvailabilityRequest & { recipients: AvailabilityRecipient[] })[], error: err(error) };
}

export async function fetchRequestResponses(requestId: string): Promise<{ responses: AvailabilityResponse[]; unreached: UnreachedBoard[]; error: string | null }> {
  const [res, unreached] = await Promise.all([
    supabase.from('availability_responses').select('*, boards(name, city, format, address, asking_rate)').eq('request_id', requestId),
    supabase.rpc('availability_request_unreached_boards', { p_request_id: requestId }),
  ]);
  return {
    responses: (res.data ?? []) as unknown as AvailabilityResponse[],
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

// ── Owner ───────────────────────────────────────────────────────────────────

export async function listOwnerRequests(): Promise<{
  items: { request: AvailabilityRequest; recipient: AvailabilityRecipient }[];
  error: string | null;
}> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { items: [], error: 'Not signed in' };
  const { data, error } = await supabase
    .from('availability_request_recipients')
    .select('*, request:availability_requests(*)')
    .eq('owner_id', session.user.id)
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
  const uid = session.user.id;
  const [direct, viaAuth] = await Promise.all([
    supabase.from('boards').select('id, name, city, format, address, asking_rate, status').eq('owner_id', uid),
    supabase.from('board_authorizations').select('boards(id, name, city, format, address, asking_rate, status)').eq('owner_id', uid).eq('status', 'active').eq('owner_verified', true),
  ]);
  const all = new Map<string, OwnerBoard>();
  ((direct.data ?? []) as OwnerBoard[]).forEach(b => all.set(b.id, b));
  ((viaAuth.data ?? []) as unknown as { boards: OwnerBoard | null }[]).forEach(a => { if (a.boards) all.set(a.boards.id, a.boards); });

  const cities = request.cities.map(c => c.trim().toLowerCase());
  return [...all.values()].filter(b =>
    b.status !== 'decommissioned'
    && !!b.city && cities.includes(b.city.trim().toLowerCase())
    && (request.formats.length === 0 || (!!b.format && request.formats.includes(b.format))),
  );
}

export async function fetchOwnResponses(requestId: string): Promise<AvailabilityResponse[]> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return [];
  const { data } = await supabase.from('availability_responses').select('*').eq('request_id', requestId).eq('owner_id', session.user.id);
  return (data ?? []) as AvailabilityResponse[];
}

export async function submitOwnerResponses(
  request: AvailabilityRequest,
  answers: { boardId: string; available: boolean; quotedRate: number | null; note: string }[],
): Promise<{ error: string | null }> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { error: 'Not signed in' };
  const { error } = await supabase.from('availability_responses').upsert(
    answers.map(a => ({
      request_id: request.id,
      owner_id: session.user.id,
      board_id: a.boardId,
      available: a.available,
      quoted_rate: a.available ? a.quotedRate : null,
      note: a.note.trim() || null,
    })),
    { onConflict: 'request_id,board_id' },
  );
  if (error) return { error: error.message };

  await createNotification({
    recipientRole: 'agency',
    recipientUserId: request.agency_id,
    type: 'availability_response',
    title: 'An owner answered your availability request',
    body: `${request.title} — ${answers.filter(a => a.available).length} of ${answers.length} boards available`,
    link: '/dashboard/agency/availability-requests',
  });
  return { error: null };
}
