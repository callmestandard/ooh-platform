/**
 * Low-confidence flags. Each one is read straight off a stored field — there
 * is no invented confidence score. A flag says "this specific input is at
 * its floor or missing here", nothing more.
 */

import type { MetricKey } from './metrics';
import type { LgaMetrics, StateMetrics } from './types';

const POI_COLUMNS = ['poi_university', 'poi_mall', 'poi_market', 'poi_bank', 'poi_hotel', 'poi_airport', 'poi_bus_terminal', 'poi_hospital'] as const;

/** True when OpenStreetMap has no mapped place of any tracked category in the area. */
export function poiUnmapped(row: LgaMetrics | StateMetrics): boolean {
  return POI_COLUMNS.every(c => row[c] === 0);
}

/** The flag text for one figure in one LGA, or null when nothing in the data calls for one. */
export function lowConfidenceFlag(row: LgaMetrics, metric: MetricKey): string | null {
  const unmapped = poiUnmapped(row);
  if (metric.startsWith('poi_') && unmapped) {
    return 'no places of any tracked category are mapped here in OpenStreetMap, so zero may mean unmapped rather than absent.';
  }
  if (metric === 'ntl_mean' && row.ntl_mean === 0) {
    return 'night-time light reads exactly zero here, which this LGA shares with many others.';
  }
  if ((metric === 'affluence_index' || metric === 'segment') && row.affluence_index !== null) {
    if (unmapped && row.ntl_mean === 0) return 'both inputs are at their floor here (no mapped places, zero night-time light).';
    if (unmapped) return 'no places are mapped here in OpenStreetMap, so the mapped-places input is at its floor.';
  }
  return null;
}
