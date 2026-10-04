/**
 * Board rates are private by default (migration 035). They no longer live on
 * the boards row — boards.asking_rate is always NULL once the migration is
 * applied — so a page that wants to show a rate asks for it here. RLS on
 * board_rates returns a row only to viewers the owner's rate_visibility
 * setting allows, so "no row" simply means "not for you": show
 * "Contact for rate".
 */

import { supabase } from './supabase';

export type RateVisibility = 'hidden' | 'approved_agencies' | 'all_verified_agencies';

export const RATE_VISIBILITY_LABELS: Record<RateVisibility, string> = {
  hidden: 'Hidden — quote on request',
  approved_agencies: 'Agencies I approve',
  all_verified_agencies: 'All verified agencies',
};

export type BoardRate = {
  board_id: string;
  gross_monthly_rate: number | null;
  gross_annual_rate: number | null;
  production_cost: number | null;
  seasonal: unknown;
};

/** Rates the signed-in viewer is allowed to see, keyed by board id. */
export async function fetchVisibleRates(boardIds: string[]): Promise<Record<string, BoardRate>> {
  const ids = [...new Set(boardIds.filter(Boolean))];
  if (ids.length === 0) return {};
  const out: Record<string, BoardRate> = {};
  // chunked: a long id list would overflow the request URL
  for (let i = 0; i < ids.length; i += 150) {
    const { data, error } = await supabase
      .from('board_rates')
      .select('board_id, gross_monthly_rate, gross_annual_rate, production_cost, seasonal')
      .in('board_id', ids.slice(i, i + 150));
    if (error) return out; // table not there yet (migration pending) — leave boards as they are
    (data as BoardRate[]).forEach(r => { out[r.board_id] = r; });
  }
  return out;
}

/**
 * Fill `asking_rate` (and `rate_card`) on board rows from the rates this
 * viewer may see. Boards whose rate is hidden from the viewer keep a null
 * asking_rate.
 */
export async function attachVisibleRates<T extends { id: string; asking_rate?: number | null }>(boards: T[] | null | undefined): Promise<T[]> {
  const rows = boards ?? [];
  const rates = await fetchVisibleRates(rows.map(b => b.id));
  return rows.map(b => {
    const r = rates[b.id];
    return r ? ({ ...b, asking_rate: r.gross_monthly_rate ?? b.asking_rate ?? null, rate_card: r.seasonal ?? (b as { rate_card?: unknown }).rate_card ?? null } as T) : b;
  });
}

/**
 * Same as attachVisibleRates, for rows that carry their board nested under
 * `boards` (bookings, authorizations): fills boards.asking_rate where the
 * viewer is allowed to see it.
 */
export async function attachRatesToBookings<T extends { board_id?: string | null; boards?: { id?: string; asking_rate?: number | null } | null }>(rows: T[] | null | undefined): Promise<T[]> {
  const list = rows ?? [];
  const idOf = (r: T) => r.boards?.id ?? r.board_id ?? null;
  const rates = await fetchVisibleRates(list.map(idOf).filter((x): x is string => !!x));
  return list.map(r => {
    const id = idOf(r);
    const rate = id ? rates[id] : undefined;
    return rate && r.boards ? ({ ...r, boards: { ...r.boards, asking_rate: rate.gross_monthly_rate ?? r.boards.asking_rate ?? null } } as T) : r;
  });
}

/**
 * The signed-in agency's OWN most recent agreed rate per board (from its own
 * bookings). A rate an agency negotiated is its to keep and print, even when
 * the owner's asking rate is hidden from it.
 */
export async function fetchOwnAgreedRates(boardIds: string[]): Promise<Record<string, number>> {
  const ids = [...new Set(boardIds.filter(Boolean))];
  const { data: { session } } = await supabase.auth.getSession();
  if (!session || ids.length === 0) return {};
  const { data } = await supabase
    .from('bookings')
    .select('board_id, agreed_rate, created_at, campaigns!inner(agency_id)')
    .eq('campaigns.agency_id', session.user.id)
    .in('board_id', ids)
    .not('agreed_rate', 'is', null)
    .in('status', ['agreed', 'signed', 'live', 'completed'])
    .order('created_at', { ascending: false });
  const out: Record<string, number> = {};
  ((data ?? []) as unknown as { board_id: string; agreed_rate: number }[]).forEach(r => {
    if (out[r.board_id] === undefined && Number(r.agreed_rate) > 0) out[r.board_id] = Number(r.agreed_rate);
  });
  return out;
}

export function rateLabel(rate: number | null | undefined): string {
  return rate ? '₦' + Math.round(rate).toLocaleString('en-NG') : 'Contact for rate';
}
