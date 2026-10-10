/**
 * Market-intelligence segment rules — the ONE definition, used both by the
 * offline pipeline (scripts/geo/06-segments.mjs, which stores the default
 * result in the database) and by the map's settings panel (which re-runs it
 * in the browser when a planner changes the weights).
 *
 * Everything here is plain arithmetic over the per-LGA source metrics. No
 * figure is estimated, smoothed or filled in: a missing input stays missing.
 *
 * Keep this file dependency-free and free of TypeScript-only runtime syntax
 * (enums, parameter properties) so Node can import it directly.
 */

export type AffluenceComponent = 'rwi' | 'ntl' | 'poi_density';
export type SegmentWeights = Record<AffluenceComponent, number>;

export const AFFLUENCE_COMPONENTS: AffluenceComponent[] = ['rwi', 'ntl', 'poi_density'];
export const DEFAULT_WEIGHTS: SegmentWeights = { rwi: 1, ntl: 1, poi_density: 1 };

/** An affluence index built from fewer inputs than this is not shown at all. */
export const MIN_AFFLUENCE_COMPONENTS = 2;

export const TOP_QUINTILE_PCTILE = 80;
export const TOP_TERCILE_PCTILE = 100 * 2 / 3;

export type Segment = 'high_value' | 'youth_hub' | 'mass_market' | 'unclassified';

export const SEGMENT_LABELS: Record<Segment, string> = {
  high_value: 'High value',
  youth_hub: 'Youth hub',
  mass_market: 'Mass market',
  unclassified: 'Unclassified',
};

/** Order in which the rules are tested; an LGA takes the first one it meets. */
export const SEGMENT_PRECEDENCE: Segment[] = ['high_value', 'youth_hub', 'mass_market'];

export type SegmentInput = {
  lga_pcode: string;
  pop_15_34: number | null;
  youth_share: number | null;
  pop_density_km2: number | null;
  rwi_mean: number | null;
  ntl_mean: number | null;
  poi_affluence_density_km2: number | null;
};

export type SegmentResult = {
  lga_pcode: string;
  youth_count_pctile: number | null;
  youth_share_pctile: number | null;
  density_pctile: number | null;
  rwi_pctile: number | null;
  ntl_pctile: number | null;
  poi_density_pctile: number | null;
  affluence_index: number | null;
  affluence_pctile: number | null;
  is_high_value: boolean;
  is_youth_hub: boolean;
  is_mass_market: boolean;
  segment: Segment;
};

export type SegmentThresholds = {
  lga_count: number;
  /** Components that have data nationally and a weight above zero. */
  components_used: AffluenceComponent[];
  /** Weights after dropping unused components and rescaling to sum to 1. */
  effective_weights: Partial<SegmentWeights>;
  affluence_available: boolean;
  /** Lowest affluence index among LGAs in the top quintile. */
  affluence_top_quintile_min: number | null;
  affluence_median: number | null;
  /** Lowest 15-34 population among LGAs in the top quintile. */
  youth_count_top_quintile_min: number | null;
  youth_share_median: number | null;
  /** Lowest density (people per km²) among LGAs in the top tercile. */
  density_top_tercile_min: number | null;
};

/**
 * Percentile rank within the list: the share of non-missing values that are
 * strictly lower, plus half of those that are equal (itself included), x 100.
 * Ties therefore share one rank, and a missing value has no rank.
 */
export function percentileRanks(values: (number | null)[]): (number | null)[] {
  const present = values.filter((v): v is number => v !== null && Number.isFinite(v)).sort((a, b) => a - b);
  const n = present.length;
  if (n === 0) return values.map(() => null);
  const lowerBound = (v: number) => {
    let lo = 0, hi = n;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (present[mid] < v) lo = mid + 1; else hi = mid; }
    return lo;
  };
  const upperBound = (v: number) => {
    let lo = 0, hi = n;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (present[mid] <= v) lo = mid + 1; else hi = mid; }
    return lo;
  };
  return values.map(v => {
    if (v === null || !Number.isFinite(v)) return null;
    const below = lowerBound(v);
    const equal = upperBound(v) - below;
    return 100 * (below + 0.5 * equal) / n;
  });
}

export function median(values: (number | null)[]): number | null {
  const present = values.filter((v): v is number => v !== null && Number.isFinite(v)).sort((a, b) => a - b);
  const n = present.length;
  if (n === 0) return null;
  return n % 2 ? present[(n - 1) / 2] : (present[n / 2 - 1] + present[n / 2]) / 2;
}

function minWhere(values: (number | null)[], keep: boolean[]): number | null {
  let min: number | null = null;
  values.forEach((v, i) => { if (keep[i] && v !== null && (min === null || v < min)) min = v; });
  return min;
}

export function computeSegments(
  lgas: SegmentInput[],
  weights: SegmentWeights = DEFAULT_WEIGHTS,
): { results: SegmentResult[]; thresholds: SegmentThresholds } {
  const youthCountPct = percentileRanks(lgas.map(l => l.pop_15_34));
  const youthSharePct = percentileRanks(lgas.map(l => l.youth_share));
  const densityPct = percentileRanks(lgas.map(l => l.pop_density_km2));
  const componentPct: Record<AffluenceComponent, (number | null)[]> = {
    rwi: percentileRanks(lgas.map(l => l.rwi_mean)),
    ntl: percentileRanks(lgas.map(l => l.ntl_mean)),
    poi_density: percentileRanks(lgas.map(l => l.poi_affluence_density_km2)),
  };

  // A component with no data anywhere (e.g. a dataset that could not be
  // licensed) or a zero weight is left out, and the rest are rescaled.
  const used = AFFLUENCE_COMPONENTS.filter(c => weights[c] > 0 && componentPct[c].some(v => v !== null));
  const weightSum = used.reduce((s, c) => s + weights[c], 0);
  const affluenceAvailable = used.length >= MIN_AFFLUENCE_COMPONENTS && weightSum > 0;
  const effectiveWeights: Partial<SegmentWeights> = {};
  for (const c of used) effectiveWeights[c] = weights[c] / weightSum;

  // An LGA missing any used component has no index — it is not averaged over what is left.
  const affluence = lgas.map((_, i) => {
    if (!affluenceAvailable) return null;
    let sum = 0;
    for (const c of used) {
      const p = componentPct[c][i];
      if (p === null) return null;
      sum += p * (effectiveWeights[c] as number);
    }
    return sum;
  });
  const affluencePct = percentileRanks(affluence);
  const affluenceMedian = median(affluence);
  const youthShareMedian = median(lgas.map(l => l.youth_share));

  const isHighValue = lgas.map((_, i) => affluencePct[i] !== null && (affluencePct[i] as number) >= TOP_QUINTILE_PCTILE);
  const isYouthHub = lgas.map((l, i) =>
    youthCountPct[i] !== null && (youthCountPct[i] as number) >= TOP_QUINTILE_PCTILE &&
    l.youth_share !== null && youthShareMedian !== null && l.youth_share > youthShareMedian);
  const isMassMarket = lgas.map((_, i) =>
    densityPct[i] !== null && (densityPct[i] as number) >= TOP_TERCILE_PCTILE &&
    affluence[i] !== null && affluenceMedian !== null && (affluence[i] as number) <= affluenceMedian);

  const results: SegmentResult[] = lgas.map((l, i) => ({
    lga_pcode: l.lga_pcode,
    youth_count_pctile: youthCountPct[i],
    youth_share_pctile: youthSharePct[i],
    density_pctile: densityPct[i],
    rwi_pctile: componentPct.rwi[i],
    ntl_pctile: componentPct.ntl[i],
    poi_density_pctile: componentPct.poi_density[i],
    affluence_index: affluence[i],
    affluence_pctile: affluencePct[i],
    is_high_value: isHighValue[i],
    is_youth_hub: isYouthHub[i],
    is_mass_market: isMassMarket[i],
    segment: isHighValue[i] ? 'high_value' : isYouthHub[i] ? 'youth_hub' : isMassMarket[i] ? 'mass_market' : 'unclassified',
  }));

  const thresholds: SegmentThresholds = {
    lga_count: lgas.length,
    components_used: used,
    effective_weights: effectiveWeights,
    affluence_available: affluenceAvailable,
    affluence_top_quintile_min: minWhere(affluence, isHighValue),
    affluence_median: affluenceMedian,
    youth_count_top_quintile_min: minWhere(lgas.map(l => l.pop_15_34), youthCountPct.map(p => p !== null && p >= TOP_QUINTILE_PCTILE)),
    youth_share_median: youthShareMedian,
    density_top_tercile_min: minWhere(lgas.map(l => l.pop_density_km2), densityPct.map(p => p !== null && p >= TOP_TERCILE_PCTILE)),
  };

  return { results, thresholds };
}

const COMPONENT_NAMES: Record<AffluenceComponent, string> = {
  rwi: 'Relative Wealth Index',
  ntl: 'night-time lights',
  poi_density: 'density of banks, malls, hotels and universities',
};

function fmt(value: number | null, digits = 0): string {
  return value === null ? 'no data' : value.toLocaleString('en-NG', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** The rule for each segment in plain words, with the thresholds this run produced. Stored in the database and shown in the UI. */
export function segmentRuleText(t: SegmentThresholds): Record<Segment | 'affluence_index' | 'precedence', string> {
  const parts = t.components_used.map(c => `${COMPONENT_NAMES[c]} (${fmt((t.effective_weights[c] ?? 0) * 100)}%)`);
  const affluence = t.affluence_available
    ? `Affluence index = weighted average of each LGA's national percentile rank on: ${parts.join(', ')}. It is a rank-based composite from 0 to 100, not an income figure.`
    : `Affluence index is not available: it needs at least ${MIN_AFFLUENCE_COMPONENTS} components with data and only ${t.components_used.length} ${t.components_used.length === 1 ? 'is' : 'are'} present.`;
  return {
    affluence_index: affluence,
    high_value: t.affluence_available
      ? `Affluence index in the top fifth of the ${fmt(t.lga_count)} LGAs (index of ${fmt(t.affluence_top_quintile_min, 1)} or higher).`
      : 'Cannot be evaluated without an affluence index.',
    youth_hub: `Population aged 15-34 in the top fifth of LGAs (${fmt(t.youth_count_top_quintile_min)} or more) and the 15-34 share of population above the median LGA (${fmt(t.youth_share_median === null ? null : t.youth_share_median * 100, 1)}%).`,
    mass_market: t.affluence_available
      ? `Population density in the top third of LGAs (${fmt(t.density_top_tercile_min)} people per km² or more) and affluence index at or below the median LGA (${fmt(t.affluence_median, 1)}).`
      : 'Cannot be evaluated without an affluence index.',
    unclassified: 'Meets none of the three rules.',
    precedence: 'An LGA that meets more than one rule is shown under the first it meets, in this order: High value, Youth hub, Mass market.',
  };
}
