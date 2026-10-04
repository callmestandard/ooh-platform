/**
 * Internal budget estimator — agency-private. Estimates what a campaign would
 * cost from the signed-in agency's OWN past negotiated rates
 * (bookings.agreed_rate on its own campaigns), never anyone else's.
 *
 * Isolation is enforced twice: the bookings RLS policy only returns rows on
 * campaigns the caller can see, and the query below additionally pins
 * campaigns.agency_id to the caller — so an owner, client or admin account
 * (which RLS lets see other bookings) still can't feed foreign deals in.
 */

import { supabase } from './supabase';
import { formatGroup } from './board-formats';

/** Below this many matching deals no number is shown — the user enters their own rate assumption. */
export const MIN_DEALS = 3;

/** Bookings whose agreed_rate is a concluded negotiation ('complete' is a legacy spelling of 'completed'). */
const CLOSED_STATUSES = ['agreed', 'signed', 'live', 'completed', 'complete'];

export type OwnDeal = { rate: number; city: string; format: string };

export type RateBasis = {
  dealCount: number;
  /** 25th / 50th / 75th percentile of the matching agreed monthly rates, and the extremes. */
  low: number;
  median: number;
  high: number;
  min: number;
  max: number;
};

export type EstimateLineInput = {
  city: string;
  formatKey: string;
  boards: number;
  /** Used only when there isn't enough history for this city + format. */
  manualRate?: number | null;
};

export type EstimateLineResult = EstimateLineInput & {
  source: 'history' | 'manual' | 'none';
  dealCount: number;
  basis: RateBasis | null;
  /** Per-board monthly rate range used. */
  rateLow: number | null;
  rateHigh: number | null;
  /** rate × boards × months. */
  totalLow: number | null;
  totalHigh: number | null;
};

/** Every concluded deal on the signed-in agency's own campaigns. */
export async function fetchOwnDeals(): Promise<{ deals: OwnDeal[]; error: string | null }> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { deals: [], error: 'Not signed in' };

  const { data, error } = await supabase
    .from('bookings')
    .select('agreed_rate, status, campaigns!inner(agency_id), boards!inner(format, city)')
    .eq('campaigns.agency_id', session.user.id)
    .not('agreed_rate', 'is', null)
    .in('status', CLOSED_STATUSES);

  if (error) return { deals: [], error: error.message };

  const rows = (data ?? []) as unknown as { agreed_rate: number; boards: { format: string | null; city: string | null } }[];
  return {
    error: null,
    deals: rows
      .filter(r => Number(r.agreed_rate) > 0 && r.boards?.city && r.boards?.format)
      .map(r => ({ rate: Number(r.agreed_rate), city: r.boards.city!.trim(), format: r.boards.format! })),
  };
}

function percentile(sorted: number[], p: number): number {
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/** Rates for one city + format group; null when there are fewer than MIN_DEALS. */
export function rateBasis(deals: OwnDeal[], city: string, formatKey: string): { dealCount: number; basis: RateBasis | null } {
  const formats: string[] = formatGroup(formatKey)?.formats ?? [formatKey];
  const wanted = city.trim().toLowerCase();
  const rates = deals
    .filter(d => d.city.toLowerCase() === wanted && formats.includes(d.format))
    .map(d => d.rate)
    .sort((a, b) => a - b);

  if (rates.length < MIN_DEALS) return { dealCount: rates.length, basis: null };
  return {
    dealCount: rates.length,
    basis: {
      dealCount: rates.length,
      low: Math.round(percentile(rates, 0.25)),
      median: Math.round(percentile(rates, 0.5)),
      high: Math.round(percentile(rates, 0.75)),
      min: rates[0],
      max: rates[rates.length - 1],
    },
  };
}

export function estimateLine(deals: OwnDeal[], line: EstimateLineInput, months: number): EstimateLineResult {
  const { dealCount, basis } = rateBasis(deals, line.city, line.formatKey);
  const qty = Math.max(0, Math.floor(line.boards)) * Math.max(0, months);

  if (basis) {
    return { ...line, source: 'history', dealCount, basis, rateLow: basis.low, rateHigh: basis.high, totalLow: basis.low * qty, totalHigh: basis.high * qty };
  }
  const manual = Number(line.manualRate);
  if (manual > 0) {
    return { ...line, source: 'manual', dealCount, basis: null, rateLow: manual, rateHigh: manual, totalLow: manual * qty, totalHigh: manual * qty };
  }
  return { ...line, source: 'none', dealCount, basis: null, rateLow: null, rateHigh: null, totalLow: null, totalHigh: null };
}

export function estimateTotals(lines: EstimateLineResult[]) {
  const priced = lines.filter(l => l.source !== 'none');
  return {
    low: priced.reduce((s, l) => s + (l.totalLow ?? 0), 0),
    high: priced.reduce((s, l) => s + (l.totalHigh ?? 0), 0),
    unpricedLines: lines.length - priced.length,
    manualLines: lines.filter(l => l.source === 'manual').length,
  };
}

/** Distinct cities the agency has concluded deals in — the estimator's city suggestions. */
export function dealCities(deals: OwnDeal[]): string[] {
  const seen = new Map<string, string>();
  deals.forEach(d => { if (!seen.has(d.city.toLowerCase())) seen.set(d.city.toLowerCase(), d.city); });
  return [...seen.values()].sort();
}

// ── Saved estimates ─────────────────────────────────────────────────────────

export type SavedEstimate = {
  id: string;
  campaign_id: string | null;
  brief_label: string | null;
  duration_months: number;
  lines: EstimateLineResult[];
  low_total: number;
  high_total: number;
  created_at: string;
  campaigns?: { name: string } | null;
};

export async function saveEstimate(input: {
  campaignId: string | null;
  briefLabel: string | null;
  months: number;
  lines: EstimateLineResult[];
  low: number;
  high: number;
}): Promise<{ error: string | null }> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { error: 'Not signed in' };
  const { error } = await supabase.from('budget_estimates').insert({
    agency_id: session.user.id,
    campaign_id: input.campaignId,
    brief_label: input.briefLabel,
    duration_months: input.months,
    lines: input.lines,
    low_total: input.low,
    high_total: input.high,
  });
  return { error: error?.message ?? null };
}

export async function listSavedEstimates(): Promise<{ estimates: SavedEstimate[]; error: string | null }> {
  const { data, error } = await supabase
    .from('budget_estimates')
    .select('id, campaign_id, brief_label, duration_months, lines, low_total, high_total, created_at, campaigns(name)')
    .order('created_at', { ascending: false })
    .limit(20);
  return { estimates: (data ?? []) as unknown as SavedEstimate[], error: error?.message ?? null };
}

export async function deleteSavedEstimate(id: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from('budget_estimates').delete().eq('id', id);
  return { error: error?.message ?? null };
}
