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

export function rateLabel(rate: number | null | undefined): string {
  return rate ? '₦' + Math.round(rate).toLocaleString('en-NG') : 'Contact for rate';
}
