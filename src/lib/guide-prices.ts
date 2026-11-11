/**
 * Public guide prices (migration 051): a rounded monthly range per board,
 * e.g. "₦1.3M–1.7M". Exact rates stay private (board-rates.ts); the database
 * only ever returns the rounded low/high. A board without a range shows
 * "Request quote".
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from './supabase';

export type GuidePrice = { low: number; high: number };

/** Guide ranges for these boards, keyed by board id. Empty if the migration isn't run yet. */
export async function fetchGuidePrices(boardIds: string[], client: SupabaseClient = supabase): Promise<Record<string, GuidePrice>> {
  const ids = [...new Set(boardIds.filter(Boolean))];
  const out: Record<string, GuidePrice> = {};
  for (let i = 0; i < ids.length; i += 500) {
    const { data, error } = await client.rpc('board_guide_prices', { p_board_ids: ids.slice(i, i + 500) });
    if (error) return out;
    ((data ?? []) as { board_id: string; low: number; high: number }[]).forEach(r => {
      if (Number(r.low) > 0 && Number(r.high) > 0) out[r.board_id] = { low: Number(r.low), high: Number(r.high) };
    });
  }
  return out;
}

/** Adds `guide` (or null) to each board. */
export async function attachGuidePrices<T extends { id: string }>(boards: T[] | null | undefined, client: SupabaseClient = supabase): Promise<(T & { guide: GuidePrice | null })[]> {
  const rows = boards ?? [];
  const guides = await fetchGuidePrices(rows.map(b => b.id), client);
  return rows.map(b => ({ ...b, guide: guides[b.id] ?? null }));
}

/** ₦850K, ₦1.3M, ₦12M — short and without trailing ".0". */
export function compactNaira(n: number): string {
  if (n >= 1_000_000) return `₦${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1).replace(/\.0$/, '')}M`;
  if (n >= 1_000) return `₦${Math.round(n / 1_000)}K`;
  return `₦${Math.round(n).toLocaleString('en-NG')}`;
}

/** "₦1.3M–1.7M" (the second figure drops the ₦). */
export function guideText(g: GuidePrice): string {
  return `${compactNaira(g.low)}–${compactNaira(g.high).slice(1)}`;
}

export const GUIDE_NOTE = 'Guide price. The owner confirms the final price when you request it.';
