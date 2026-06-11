import { supabase } from './supabase';

export type MarketRate = {
  avg: number;
  min: number;
  max: number;
  median: number;
  count: number;
};

export type CorridorRate = {
  corridor: string;
  avg: number;
  count: number;
};

export type RateTrendPoint = {
  month: string; // "YYYY-MM"
  avg: number;
  count: number;
};

const CLOSED_STATUSES = ['agreed', 'signed', 'live', 'complete'];

export async function getMarketRate(format: string, city: string): Promise<MarketRate | null> {
  const { data, error } = await supabase
    .from('bookings')
    .select('agreed_rate, boards!inner(format, city)')
    .not('agreed_rate', 'is', null)
    .in('status', CLOSED_STATUSES)
    .eq('boards.format', format)
    .eq('boards.city', city);

  if (error || !data || data.length === 0) return null;

  const rows = data as unknown as { agreed_rate: number }[];
  const rates = rows
    .map(r => r.agreed_rate)
    .filter(r => r > 0)
    .sort((a, b) => a - b);

  if (rates.length === 0) return null;

  const sum = rates.reduce((a: number, b: number) => a + b, 0);
  const mid = Math.floor(rates.length / 2);
  const median = rates.length % 2 === 0
    ? (rates[mid - 1] + rates[mid]) / 2
    : rates[mid];

  return {
    avg: Math.round(sum / rates.length),
    min: rates[0],
    max: rates[rates.length - 1],
    median: Math.round(median),
    count: rates.length,
  };
}

export async function getRateByCorridor(city: string): Promise<CorridorRate[]> {
  const { data, error } = await supabase
    .from('bookings')
    .select('agreed_rate, boards!inner(city, format)')
    .not('agreed_rate', 'is', null)
    .in('status', CLOSED_STATUSES)
    .eq('boards.city', city);

  if (error || !data || data.length === 0) return [];

  const groups: Record<string, number[]> = {};
  for (const row of data as unknown as { agreed_rate: number; boards: { format: string } }[]) {
    const key = row.boards?.format || 'unknown';
    if (!groups[key]) groups[key] = [];
    groups[key].push(row.agreed_rate);
  }

  return Object.entries(groups)
    .map(([corridor, rates]) => ({
      corridor,
      avg: Math.round(rates.reduce((a, b) => a + b, 0) / rates.length),
      count: rates.length,
    }))
    .sort((a, b) => b.avg - a.avg);
}

export async function getRateTrend(format: string, city: string, months = 12): Promise<RateTrendPoint[]> {
  const since = new Date();
  since.setMonth(since.getMonth() - months);

  const { data, error } = await supabase
    .from('bookings')
    .select('agreed_rate, created_at, boards!inner(format, city)')
    .not('agreed_rate', 'is', null)
    .in('status', CLOSED_STATUSES)
    .eq('boards.format', format)
    .eq('boards.city', city)
    .gte('created_at', since.toISOString())
    .order('created_at', { ascending: true });

  if (error || !data || data.length === 0) return [];

  const buckets: Record<string, number[]> = {};
  for (const row of data as unknown as { agreed_rate: number; created_at: string }[]) {
    const d = new Date(row.created_at);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    if (!buckets[key]) buckets[key] = [];
    buckets[key].push(row.agreed_rate);
  }

  return Object.entries(buckets).map(([month, rates]) => ({
    month,
    avg: Math.round(rates.reduce((a, b) => a + b, 0) / rates.length),
    count: rates.length,
  }));
}

export async function getPlatformStats(): Promise<{
  totalDeals: number;
  uniqueCities: number;
  uniqueFormats: number;
  uniqueAgencies: number;
}> {
  const { data } = await supabase
    .from('bookings')
    .select('boards!inner(format, city), campaigns!inner(agency_id)')
    .not('agreed_rate', 'is', null)
    .in('status', CLOSED_STATUSES);

  if (!data?.length) return { totalDeals: 0, uniqueCities: 0, uniqueFormats: 0, uniqueAgencies: 0 };

  const rows = data as unknown as { boards: { format: string; city: string }; campaigns: { agency_id: string | null } }[];
  return {
    totalDeals: rows.length,
    uniqueCities: new Set(rows.map(r => r.boards?.city).filter(Boolean)).size,
    uniqueFormats: new Set(rows.map(r => r.boards?.format).filter(Boolean)).size,
    uniqueAgencies: new Set(rows.map(r => r.campaigns?.agency_id).filter(Boolean)).size,
  };
}

export type NegotiationSpread = {
  format: string;
  city: string;
  avg_offered: number;
  avg_agreed: number;
  spread_pct: number; // negative = agreed below offered
  count: number;
};

export async function getNegotiationSpreads(): Promise<NegotiationSpread[]> {
  const { data } = await supabase
    .from('bookings')
    .select('offered_rate, agreed_rate, boards!inner(format, city)')
    .not('agreed_rate', 'is', null)
    .not('offered_rate', 'is', null)
    .in('status', CLOSED_STATUSES);

  if (!data?.length) return [];

  const groups: Record<string, { offered: number[]; agreed: number[] }> = {};
  for (const row of data as unknown as { offered_rate: number; agreed_rate: number; boards: { format: string; city: string } }[]) {
    const key = `${row.boards?.format}||${row.boards?.city}`;
    if (!groups[key]) groups[key] = { offered: [], agreed: [] };
    if (row.offered_rate > 0 && row.agreed_rate > 0) {
      groups[key].offered.push(row.offered_rate);
      groups[key].agreed.push(row.agreed_rate);
    }
  }

  return Object.entries(groups)
    .filter(([, g]) => g.offered.length >= 2)
    .map(([key, g]) => {
      const [format, city] = key.split('||');
      const avg_offered = Math.round(g.offered.reduce((a, b) => a + b, 0) / g.offered.length);
      const avg_agreed  = Math.round(g.agreed.reduce((a, b) => a + b, 0) / g.agreed.length);
      const spread_pct  = Math.round(((avg_agreed - avg_offered) / avg_offered) * 100);
      return { format, city, avg_offered, avg_agreed, spread_pct, count: g.offered.length };
    })
    .sort((a, b) => a.spread_pct - b.spread_pct);
}

// Single query returning trend data for all format+city combos — avoids N+1 when rendering a full trend dashboard.
export async function getAllRateTrends(months = 12): Promise<
  Record<string, RateTrendPoint[]>
> {
  const since = new Date();
  since.setMonth(since.getMonth() - months);

  const { data, error } = await supabase
    .from('bookings')
    .select('agreed_rate, created_at, boards!inner(format, city)')
    .not('agreed_rate', 'is', null)
    .in('status', CLOSED_STATUSES)
    .gte('created_at', since.toISOString())
    .order('created_at', { ascending: true });

  if (error || !data || data.length === 0) return {};

  const groups: Record<string, Record<string, number[]>> = {};
  for (const row of data as unknown as { agreed_rate: number; created_at: string; boards: { format: string; city: string } }[]) {
    const key = `${row.boards?.format}||${row.boards?.city}`;
    const d = new Date(row.created_at);
    const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    if (!groups[key]) groups[key] = {};
    if (!groups[key][month]) groups[key][month] = [];
    groups[key][month].push(row.agreed_rate);
  }

  const result: Record<string, RateTrendPoint[]> = {};
  for (const [key, monthMap] of Object.entries(groups)) {
    result[key] = Object.entries(monthMap).map(([month, rates]) => ({
      month,
      avg: Math.round(rates.reduce((a, b) => a + b, 0) / rates.length),
      count: rates.length,
    }));
  }
  return result;
}

export async function getAllMarketRates(): Promise<
  { format: string; city: string; avg: number; min: number; max: number; median: number; count: number }[]
> {
  const { data, error } = await supabase
    .from('bookings')
    .select('agreed_rate, boards!inner(format, city)')
    .not('agreed_rate', 'is', null)
    .in('status', CLOSED_STATUSES);

  if (error || !data || data.length === 0) return [];

  const groups: Record<string, number[]> = {};
  for (const row of data as unknown as { agreed_rate: number; boards: { format: string; city: string } }[]) {
    const key = `${row.boards?.format}||${row.boards?.city}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(row.agreed_rate);
  }

  return Object.entries(groups)
    .map(([key, rates]) => {
      const [format, city] = key.split('||');
      const sorted = [...rates].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      const median = sorted.length % 2 === 0
        ? (sorted[mid - 1] + sorted[mid]) / 2
        : sorted[mid];
      return {
        format,
        city,
        avg: Math.round(rates.reduce((a, b) => a + b, 0) / rates.length),
        min: sorted[0],
        max: sorted[sorted.length - 1],
        median: Math.round(median),
        count: rates.length,
      };
    })
    .sort((a, b) => b.avg - a.avg);
}
