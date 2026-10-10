'use client';

import { supabase } from '@/lib/supabase';
import type { GeoDataset, LgaMetrics, MarketData, SegmentRules, StateMetrics } from './types';

let cache: Promise<MarketData> | null = null;

/**
 * Loads the pre-computed market metrics once per session: 774 LGA rows,
 * 37 state rows, the dataset registry and the stored segment rules. The map
 * joins these onto static boundary files in the browser, so nothing is
 * queried per polygon or per hexagon while it renders.
 */
export function fetchMarketData(): Promise<MarketData> {
  if (!cache) {
    cache = (async () => {
      const [lgas, states, datasets, rules] = await Promise.all([
        supabase.from('geo_metrics_lga').select('*').order('lga_pcode'),
        supabase.from('geo_metrics_state').select('*').order('state_name'),
        supabase.from('geo_datasets').select('*'),
        supabase.from('geo_segment_rules').select('*').eq('id', 'default').maybeSingle(),
      ]);
      const failed = [lgas, states, datasets, rules].find(r => r.error);
      if (failed?.error) throw new Error(failed.error.message);
      return {
        lgas: (lgas.data || []) as LgaMetrics[],
        states: (states.data || []) as StateMetrics[],
        datasets: Object.fromEntries(((datasets.data || []) as GeoDataset[]).map(d => [d.id, d])),
        rules: (rules.data as SegmentRules | null) ?? null,
      };
    })();
    // A failed load should be retried on the next visit, not remembered.
    cache.catch(() => { cache = null; });
  }
  return cache;
}
