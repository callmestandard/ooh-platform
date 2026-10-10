'use client';

import { lowConfidenceFlag } from '@/lib/geo/flags';
import { METRICS, SEGMENT_COLORS, formatMetric, type MetricKey } from '@/lib/geo/metrics';
import { SEGMENT_LABELS, type Segment } from '@/lib/geo/segments';
import type { GeoDataset, LgaMetrics } from '@/lib/geo/types';
import { Figure, LowConfidence, PanelHeader, Section, T, numeric, plainButton, type EvidenceTarget } from './ui';

type Props = {
  lga: LgaMetrics;
  ruleText: Record<string, string>;
  datasets: Record<string, GeoDataset>;
  onEvidence: (target: EvidenceTarget) => void;
  onOpenState: (code: string) => void;
  onClose: () => void;
};

const POI_FIGURES: MetricKey[] = ['poi_bank', 'poi_mall', 'poi_hotel', 'poi_university', 'poi_market', 'poi_hospital', 'poi_bus_terminal', 'poi_airport'];

function rank(pctile: number | null): string | undefined {
  if (pctile === null) return undefined;
  return `Ranks above ${pctile.toLocaleString('en-NG', { maximumFractionDigits: 0 })}% of LGAs`;
}

export default function LgaDetail({ lga, ruleText, datasets, onEvidence, onOpenState, onClose }: Props) {
  const geography = `${lga.lga_name}, ${lga.state_name}`;
  const segment: Segment = lga.segment ?? 'unclassified';
  const rwi = datasets.meta_rwi;

  const figure = (metric: MetricKey, sub?: string, shortLabel?: string) => {
    const value = lga[metric as keyof LgaMetrics] as number | null;
    const display = formatMetric(metric, value);
    return (
      <Figure
        label={shortLabel || METRICS[metric].label}
        value={value === null ? null : display}
        sub={sub}
        flag={lowConfidenceFlag(lga, metric)}
        onInfo={() => onEvidence({ metric, display, geography, row: lga })}
      />
    );
  };

  const alsoMeets = ([
    ['youth_hub', lga.is_youth_hub],
    ['mass_market', lga.is_mass_market],
  ] as [Segment, boolean | null][]).filter(([s, met]) => met && s !== segment).map(([s]) => SEGMENT_LABELS[s]);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: T.surface }}>
      <PanelHeader title={lga.lga_name} subtitle={`${lga.state_name} State · ${Math.round(lga.area_km2).toLocaleString('en-NG')} km²`} onClose={onClose} closeLabel="Close LGA details" />
      <div style={{ flex: 1, overflowY: 'auto' }}>
        <Section title="Segment">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span aria-hidden style={{ width: 12, height: 12, background: SEGMENT_COLORS[segment], opacity: 0.85 }} />
            <span style={{ fontSize: '0.9375rem', fontWeight: 600, color: T.ink }}>{SEGMENT_LABELS[segment]}</span>
            <button type="button" onClick={() => onEvidence({ metric: 'segment', display: SEGMENT_LABELS[segment], geography, row: lga })} style={{ ...plainButton, padding: '2px 8px', fontSize: '0.75rem', marginLeft: 'auto' }}>
              Rules and sources
            </button>
          </div>
          <p style={{ fontSize: '0.8125rem', color: T.body, margin: '8px 0 0', lineHeight: 1.45 }}>{ruleText[segment]}</p>
          {alsoMeets.length > 0 && (
            <p style={{ fontSize: '0.75rem', color: T.muted, margin: '6px 0 0' }}>Also meets the rule for: {alsoMeets.join(', ')}. {ruleText.precedence}</p>
          )}
          {lowConfidenceFlag(lga, 'segment') && <LowConfidence text={lowConfidenceFlag(lga, 'segment')!} />}
        </Section>

        <Section title="Population">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            {figure('pop_total')}
            {figure('pop_density_km2', rank(lga.density_pctile))}
            {figure('pop_15_34', rank(lga.youth_count_pctile))}
            {figure('youth_share', rank(lga.youth_share_pctile))}
            {figure('pop_15_24')}
            {figure('pop_25_34')}
          </div>
        </Section>

        <Section title="Affluence index and its parts">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            {figure('affluence_index', rank(lga.affluence_pctile))}
            <div />
            {figure('ntl_mean', rank(lga.ntl_pctile))}
            {figure('poi_affluence_density_km2', rank(lga.poi_density_pctile), 'Banks, malls, hotels, universities per km² (mapped)')}
          </div>
          <div style={{ marginTop: 12 }}>
            <span style={{ fontSize: '0.75rem', color: T.muted }}>Relative Wealth Index</span>
            <div style={{ fontSize: '0.875rem', color: T.faint, fontWeight: 600, marginTop: 2 }}>No data</div>
            <p style={{ fontSize: '0.75rem', color: T.muted, margin: '2px 0 0', lineHeight: 1.45 }}>
              Not used{rwi ? `: licence is ${rwi.licence}` : ''}. The index has no household wealth input.
            </p>
          </div>
        </Section>

        <Section title="Mapped places (lower bounds)">
          <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: '1fr auto auto', columnGap: 10, rowGap: 6, alignItems: 'center', fontSize: '0.8125rem' }}>
            {POI_FIGURES.map(metric => {
              const value = lga[metric as keyof LgaMetrics] as number | null;
              const display = formatMetric(metric, value);
              return (
                <div key={metric} style={{ display: 'contents' }}>
                  <dt style={{ color: T.body }}>{METRICS[metric].label}</dt>
                  <dd style={{ ...numeric, margin: 0, color: T.ink, fontWeight: 600, textAlign: 'right' }}>{display}</dd>
                  <dd style={{ margin: 0 }}>
                    <button
                      type="button"
                      aria-label={`Source and method: ${METRICS[metric].label}`}
                      onClick={() => onEvidence({ metric, display, geography, row: lga })}
                      style={{ ...plainButton, padding: '0 6px', fontSize: '0.6875rem', color: T.muted }}
                    >
                      Source
                    </button>
                  </dd>
                </div>
              );
            })}
          </dl>
          {lowConfidenceFlag(lga, 'poi_bank') && <LowConfidence text={lowConfidenceFlag(lga, 'poi_bank')!} />}
        </Section>

        <div style={{ padding: '14px 16px' }}>
          <button type="button" onClick={() => onOpenState(lga.state_pcode)} style={plainButton}>Open {lga.state_name} State profile</button>
        </div>
      </div>
    </div>
  );
}
