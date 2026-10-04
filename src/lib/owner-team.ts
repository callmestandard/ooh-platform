/**
 * Owner company teams: marketers, board assignment, rate cards, targets and
 * share links. Requires supabase/migrations/035_owner_teams_rates_sharing.sql,
 * where every permission here is enforced (RLS + triggers); these helpers
 * only perform the reads and writes.
 */

import { supabase } from './supabase';
import { authedFetch } from './api';
import type { RateVisibility } from './board-rates';

export type MyCompany = { owner_id: string; company_name: string | null; team_role: 'owner' | 'admin' | 'marketer'; can_see_floor_rates: boolean; verified: boolean };

export type TeamMember = {
  id: string;
  owner_id: string;
  member_profile_id: string;
  member_name: string | null;
  role: 'admin' | 'marketer';
  active: boolean;
  can_see_floor_rates: boolean;
  commission_rate: number | null;
  territory_cities: string[];
  invited_email: string | null;
  invited_phone: string | null;
  created_at: string;
};

export type MarketerTarget = { id: string; owner_id: string; marketer_id: string; period_start: string; period_end: string; target_value: number; target_count: number };

export type TeamBoard = {
  id: string; name: string; city: string | null; state: string | null; address: string | null; format: string | null;
  width: number | null; height: number | null; status: string; photo_urls: string[] | null;
  owner_id: string | null; assigned_marketer_id: string | null; rate_visibility: RateVisibility | null;
};

export type TeamBooking = {
  id: string; board_id: string; status: string; offered_rate: number | null; agreed_rate: number | null;
  duration_months: number | null; start_date: string | null; end_date: string | null; created_at: string;
  confirmed_at: string | null; closed_by_marketer_id: string | null;
  boards: { name: string; city: string | null; assigned_marketer_id: string | null } | null;
};

export type ShareLink = {
  id: string; token: string; owner_id: string; created_by: string; title: string | null; board_ids: string[];
  expires_at: string; revoked_at: string | null; open_count: number; last_opened_at: string | null; created_at: string;
};

export type ShareLead = { id: string; link_id: string; board_id: string; name: string; company: string | null; contact: string; message: string | null; status: 'new' | 'handled'; created_at: string; boards?: { name: string } | null };

const err = (e: { message: string } | null) => e?.message ?? null;
const CONFIRMED = ['agreed', 'signed', 'live', 'completed'];
const OPEN = ['pending', 'negotiating'];

export async function fetchMyCompany(): Promise<MyCompany | null> {
  const { data } = await supabase.rpc('my_owner_company');
  return ((data as MyCompany[] | null) ?? [])[0] ?? null;
}

// ── Team ────────────────────────────────────────────────────────────────────

export async function listTeam(ownerId: string): Promise<{ members: TeamMember[]; error: string | null }> {
  const { data, error } = await supabase.from('owner_team_members').select('*').eq('owner_id', ownerId).order('created_at');
  return { members: (data ?? []) as TeamMember[], error: err(error) };
}

export async function inviteTeamMember(input: { name: string; email: string; phone: string; role: 'admin' | 'marketer' }): Promise<{ inviteLink: string | null; error: string | null }> {
  const res = await authedFetch('/api/owner/team/invite', { method: 'POST', body: JSON.stringify(input) });
  const json = await res.json().catch(() => ({}));
  return res.ok ? { inviteLink: json.inviteLink ?? null, error: null } : { inviteLink: null, error: json.error ?? 'Could not send the invite' };
}

export async function updateTeamMember(id: string, patch: Partial<Pick<TeamMember, 'role' | 'active' | 'can_see_floor_rates' | 'commission_rate' | 'territory_cities'>>): Promise<{ error: string | null }> {
  const { error } = await supabase.from('owner_team_members').update(patch).eq('id', id);
  return { error: err(error) };
}

// ── Boards: assignment, visibility, rate card ──────────────────────────────

const BOARD_COLS = 'id, name, city, state, address, format, width, height, status, photo_urls, owner_id, assigned_marketer_id, rate_visibility';

/** Every board of the company (owner admins) — or just the caller's own (marketers). */
export async function listCompanyBoards(company: MyCompany, userId: string): Promise<TeamBoard[]> {
  const { data } = await supabase.from('boards').select(BOARD_COLS).eq('owner_id', company.owner_id).order('name');
  const boards = (data ?? []) as TeamBoard[];
  if (company.team_role !== 'marketer') return boards;
  // A marketer's boards are the ones that currently route to them (named or by territory).
  const mine: TeamBoard[] = [];
  await Promise.all(boards.map(async b => {
    const { data: assignee } = await supabase.rpc('board_assignee', { p_board_id: b.id });
    if (assignee === userId) mine.push(b);
  }));
  return mine.sort((a, b) => a.name.localeCompare(b.name));
}

export async function updateBoardTeamFields(boardId: string, patch: { assigned_marketer_id?: string | null; rate_visibility?: RateVisibility | null }): Promise<{ error: string | null }> {
  const { error } = await supabase.from('boards').update(patch).eq('id', boardId);
  return { error: err(error) };
}

export type RateCard = { gross_monthly_rate: number | null; gross_annual_rate: number | null; production_cost: number | null; max_discount_pct: number | null };

export async function fetchRateCards(boardIds: string[]): Promise<Record<string, RateCard>> {
  if (boardIds.length === 0) return {};
  const [rates, floors] = await Promise.all([
    supabase.from('board_rates').select('board_id, gross_monthly_rate, gross_annual_rate, production_cost').in('board_id', boardIds),
    supabase.from('board_rate_floors').select('board_id, max_discount_pct').in('board_id', boardIds),
  ]);
  const out: Record<string, RateCard> = {};
  ((rates.data ?? []) as { board_id: string; gross_monthly_rate: number | null; gross_annual_rate: number | null; production_cost: number | null }[])
    .forEach(r => { out[r.board_id] = { gross_monthly_rate: r.gross_monthly_rate, gross_annual_rate: r.gross_annual_rate, production_cost: r.production_cost, max_discount_pct: null }; });
  ((floors.data ?? []) as { board_id: string; max_discount_pct: number }[])
    .forEach(f => { out[f.board_id] = { ...(out[f.board_id] ?? { gross_monthly_rate: null, gross_annual_rate: null, production_cost: null }), max_discount_pct: f.max_discount_pct }; });
  return out;
}

export async function saveRateCard(boardId: string, card: RateCard): Promise<{ error: string | null }> {
  const { data: { session } } = await supabase.auth.getSession();
  const rate = await supabase.from('board_rates').upsert({
    board_id: boardId, gross_monthly_rate: card.gross_monthly_rate, gross_annual_rate: card.gross_annual_rate,
    production_cost: card.production_cost, updated_by: session?.user.id ?? null, updated_at: new Date().toISOString(),
  });
  if (rate.error) return { error: rate.error.message };
  const floor = card.max_discount_pct == null
    ? await supabase.from('board_rate_floors').delete().eq('board_id', boardId)
    : await supabase.from('board_rate_floors').upsert({ board_id: boardId, max_discount_pct: card.max_discount_pct, updated_at: new Date().toISOString() });
  return { error: err(floor.error) };
}

export type BookedRange = { id: string; board_id: string; start_date: string; end_date: string; note: string | null };

export async function listBookedRanges(boardIds: string[]): Promise<BookedRange[]> {
  if (boardIds.length === 0) return [];
  const { data } = await supabase.from('board_booked_ranges').select('id, board_id, start_date, end_date, note').in('board_id', boardIds).order('start_date');
  return (data ?? []) as BookedRange[];
}
export async function addBookedRange(boardId: string, start: string, end: string, note: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from('board_booked_ranges').insert({ board_id: boardId, start_date: start, end_date: end, note: note.trim() || null });
  return { error: err(error) };
}
export async function removeBookedRange(id: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from('board_booked_ranges').delete().eq('id', id);
  return { error: err(error) };
}

// ── Approved agencies / default visibility ─────────────────────────────────

export async function setDefaultRateVisibility(ownerId: string, v: RateVisibility): Promise<{ error: string | null }> {
  const { error } = await supabase.from('profiles').update({ default_rate_visibility: v }).eq('id', ownerId);
  return { error: err(error) };
}
export async function listApprovedAgencies(ownerId: string): Promise<{ agency_id: string; name: string }[]> {
  const res = await authedFetch(`/api/owner/approved-agencies?owner=${ownerId}`);
  return res.ok ? (await res.json()).agencies ?? [] : [];
}
export async function approveAgencyByEmail(email: string): Promise<{ error: string | null }> {
  const res = await authedFetch('/api/owner/approved-agencies', { method: 'POST', body: JSON.stringify({ email }) });
  return res.ok ? { error: null } : { error: (await res.json().catch(() => ({}))).error ?? 'Could not approve that agency' };
}
export async function removeApprovedAgency(ownerId: string, agencyId: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from('owner_approved_agencies').delete().eq('owner_id', ownerId).eq('agency_id', agencyId);
  return { error: err(error) };
}

// ── Targets and performance ────────────────────────────────────────────────

export async function listTargets(ownerId: string): Promise<MarketerTarget[]> {
  const { data } = await supabase.from('marketer_targets').select('*').eq('owner_id', ownerId).order('period_start', { ascending: false });
  return (data ?? []) as MarketerTarget[];
}
export async function listMyTargets(): Promise<MarketerTarget[]> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return [];
  const { data } = await supabase.from('marketer_targets').select('*').eq('marketer_id', session.user.id).order('period_start', { ascending: false });
  return (data ?? []) as MarketerTarget[];
}
export async function saveTarget(t: Omit<MarketerTarget, 'id'>): Promise<{ error: string | null }> {
  const { error } = await supabase.from('marketer_targets').upsert(t, { onConflict: 'marketer_id,period_start,period_end' });
  return { error: err(error) };
}

const BOOKING_COLS = 'id, board_id, status, offered_rate, agreed_rate, duration_months, start_date, end_date, created_at, confirmed_at, closed_by_marketer_id, boards!inner(name, city, owner_id, assigned_marketer_id)';

/** Bookings on the company's boards that the caller may see (RLS narrows a marketer to their own). */
export async function listTeamBookings(ownerId: string): Promise<TeamBooking[]> {
  const { data } = await supabase.from('bookings').select(BOOKING_COLS).eq('boards.owner_id', ownerId).order('created_at', { ascending: false }).limit(500);
  return (data ?? []) as unknown as TeamBooking[];
}

export const dealValue = (b: TeamBooking) => (b.agreed_rate ?? 0) * Math.max(1, b.duration_months ?? 1);
export const isConfirmed = (b: TeamBooking) => CONFIRMED.includes(b.status);
export const isOpen = (b: TeamBooking) => OPEN.includes(b.status);

/** Deals a marketer closed inside a period: count and total contract value. */
export function progressFor(bookings: TeamBooking[], marketerId: string, start: string, end: string) {
  const from = new Date(start + 'T00:00:00').getTime();
  const to = new Date(end + 'T23:59:59').getTime();
  const closed = bookings.filter(b => b.closed_by_marketer_id === marketerId && b.confirmed_at
    && new Date(b.confirmed_at).getTime() >= from && new Date(b.confirmed_at).getTime() <= to);
  return { count: closed.length, value: closed.reduce((s, b) => s + dealValue(b), 0), deals: closed };
}

/** Monday–Sunday of the current week, or the calendar month, as YYYY-MM-DD. */
export function currentPeriod(kind: 'week' | 'month', now = new Date()): { start: string; end: string } {
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  if (kind === 'month') return { start: iso(new Date(now.getFullYear(), now.getMonth(), 1)), end: iso(new Date(now.getFullYear(), now.getMonth() + 1, 0)) };
  const monday = new Date(now); monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6);
  return { start: iso(monday), end: iso(sunday) };
}

// ── Share links ────────────────────────────────────────────────────────────

export async function listShareLinks(): Promise<ShareLink[]> {
  const { data } = await supabase.from('board_share_links').select('*').order('created_at', { ascending: false });
  return (data ?? []) as ShareLink[];
}
export async function createShareLink(input: { title: string; boardIds: string[]; days: number }): Promise<{ link: ShareLink | null; error: string | null }> {
  const { data, error } = await supabase.from('board_share_links').insert({
    title: input.title.trim() || null, board_ids: input.boardIds,
    expires_at: new Date(Date.now() + input.days * 86_400_000).toISOString(),
  }).select('*').single();
  return { link: (data as ShareLink) ?? null, error: err(error) };
}
export async function revokeShareLink(id: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from('board_share_links').update({ revoked_at: new Date().toISOString() }).eq('id', id);
  return { error: err(error) };
}
export async function listShareLeads(): Promise<ShareLead[]> {
  const { data } = await supabase.from('share_link_requests').select('*, boards(name)').order('created_at', { ascending: false }).limit(100);
  return (data ?? []) as unknown as ShareLead[];
}
export async function markLeadHandled(id: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from('share_link_requests').update({ status: 'handled' }).eq('id', id);
  return { error: err(error) };
}
export const shareUrl = (token: string) => `${typeof window !== 'undefined' ? window.location.origin : ''}/s/${token}`;
