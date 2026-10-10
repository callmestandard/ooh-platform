'use client';

import { MAP_METRICS, MAP_METRIC_NAMES, METRICS, NO_DATA_COLOR, SEGMENT_COLORS, type GeoLevel, type MetricKey } from '@/lib/geo/metrics';
import {
  AFFLUENCE_COMPONENTS, DEFAULT_WEIGHTS, SEGMENT_LABELS, type AffluenceComponent, type Segment, type SegmentThresholds, type SegmentWeights,
} from '@/lib/geo/segments';
import type { GeoDataset, LgaMetrics, StateMetrics } from '@/lib/geo/types';
import { InfoButton, Section, T, numeric, plainButton } from './ui';

export type LegendClass = { color: string; label: string };
export type Legend = { title: string; unit: string; note?: string; classes: LegendClass[] };

const COMPONENT_LABELS: Record<AffluenceComponent, string> = {
  rwi: 'Relative Wealth Index',
  ntl: 'Night-time lights',
  poi_density: 'Banks, malls, hotels, universities per km²',
};

type Props = {
  level: GeoLevel;
  metric: MetricKey;
  legend: Legend;
  states: StateMetrics[];
  lgas: LgaMetrics[];
  selectedStateCode: string | null;
  selectedLgaCode: string | null;
  weights: SegmentWeights;
  thresholds: SegmentThresholds;
  ruleText: Record<string, string>;
  segmentCounts: Record<Segment, number>;
  flaggedCount: number;
  datasets: Record<string, GeoDataset>;
  onLevel: (level: GeoLevel) => void;
  onMetric: (metric: MetricKey) => void;
  onMetricInfo: (metric: MetricKey) => void;
  onWeights: (weights: SegmentWeights) => void;
  onSelectState: (code: string) => void;
  onSelectLga: (code: string) => void;
};

const selectStyle = {
  width: '100%', padding: '7px 8px', borderRadius: 6, border: `1px solid ${T.line}`, background: T.surface, color: T.ink,
  fontSize: '0.8125rem', fontFamily: 'inherit',
} as const;

export default function LayerPanel({
  level, metric, legend, states, lgas, selectedStateCode, selectedLgaCode, weights, thresholds, ruleText, segmentCounts, flaggedCount, datasets,
  onLevel, onMetric, onMetricInfo, onWeights, onSelectState, onSelectLga,
}: Props) {
  const lgaOptions = selectedStateCode ? lgas.filter(l => l.state_pcode === selectedStateCode) : [];
  const weightsChanged = AFFLUENCE_COMPONENTS.some(c => weights[c] !== DEFAULT_WEIGHTS[c]);
  const usesAffluence = level === 'lga' && (metric === 'affluence_index' || metric === 'segment');
  const active = Object.values(datasets).filter(d => d.status === 'active');
  const populationYear = datasets.worldpop_agesex_2020_constrained?.reference_year;

  return (
    <div style={{ height: '100%', overflowY: 'auto', background: T.surface }}>
      <div style={{ padding: '14px 16px', borderBottom: `1px solid ${T.line}` }}>
        <h1 style={{ fontSize: '0.9375rem', fontWeight: 600, color: T.ink, margin: 0, letterSpacing: 0 }}>Market intelligence</h1>
        <p style={{ fontSize: '0.75rem', color: T.muted, margin: '4px 0 0', lineHeight: 1.45 }}>
          Population figures are modelled estimates{populationYear ? ` for ${populationYear}` : ''}, not census counts.
          Every figure has an <span style={{ fontFamily: 'Georgia, serif', fontStyle: 'italic' }}>i</span> control showing its source and limits.
        </p>
      </div>

      <Section title="Geography">
        <div role="radiogroup" aria-label="Geography level" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          {(['state', 'lga'] as GeoLevel[]).map(l => (
            <button
              key={l}
              type="button"
              role="radio"
              aria-checked={level === l}
              onClick={() => onLevel(l)}
              style={{ ...plainButton, fontWeight: level === l ? 600 : 400, color: level === l ? T.accent : T.body, borderColor: level === l ? T.accent : T.line, background: level === l ? T.accentWash : T.surface }}
            >
              {l === 'state' ? 'States' : 'LGAs'}
            </button>
          ))}
        </div>
      </Section>

      <Section title="Colour by">
        <div role="radiogroup" aria-label="Metric shown on the map" style={{ display: 'grid', gap: 2 }}>
          {MAP_METRICS[level].map(key => (
            <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <label style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, padding: '6px 4px', fontSize: '0.8125rem', color: metric === key ? T.ink : T.body, fontWeight: metric === key ? 600 : 400, cursor: 'pointer' }}>
                <input type="radio" name="mi-metric" checked={metric === key} onChange={() => onMetric(key)} style={{ accentColor: T.accent, margin: 0 }} />
                {MAP_METRIC_NAMES[key]}
              </label>
              <InfoButton label={METRICS[key].label} onClick={() => onMetricInfo(key)} />
            </div>
          ))}
        </div>
        {level === 'state' && (
          <p style={{ fontSize: '0.75rem', color: T.muted, margin: '8px 0 0' }}>Affluence index and segments are defined for LGAs only.</p>
        )}
      </Section>

      <Section title="Legend">
        <p style={{ fontSize: '0.8125rem', color: T.ink, margin: '0 0 2px' }}>{legend.title}</p>
        {legend.unit && <p style={{ fontSize: '0.75rem', color: T.muted, margin: '0 0 8px' }}>{legend.unit}</p>}
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 4 }}>
          {legend.classes.map(c => (
            <li key={c.label} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.8125rem', color: T.body }}>
              <span aria-hidden style={{ width: 18, height: 12, background: c.color, opacity: 0.85, border: `1px solid ${T.line}`, flexShrink: 0 }} />
              <span style={numeric}>{c.label}</span>
            </li>
          ))}
          <li style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.8125rem', color: T.body }}>
            <span aria-hidden style={{ width: 18, height: 12, background: NO_DATA_COLOR, border: `1px solid ${T.line}`, flexShrink: 0 }} />
            No data
          </li>
        </ul>
        {legend.note && <p style={{ fontSize: '0.75rem', color: T.muted, margin: '8px 0 0', lineHeight: 1.45 }}>{legend.note}</p>}
        {usesAffluence && flaggedCount > 0 && (
          <p style={{ fontSize: '0.75rem', color: T.caution, margin: '8px 0 0', lineHeight: 1.45 }}>
            <span aria-hidden style={{ display: 'inline-block', width: 18, borderTop: `1px dashed ${T.caution}`, verticalAlign: 'middle', marginRight: 6 }} />
            Dashed outline: low confidence. <span style={numeric}>{flaggedCount}</span> LGAs have no places mapped in OpenStreetMap in any category, so the mapped-places part of the index is at its floor there.
          </p>
        )}
        <p style={{ fontSize: '0.75rem', color: T.muted, margin: '8px 0 0' }}>
          <span aria-hidden style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: T.ink, border: '1.5px solid #fff', boxShadow: `0 0 0 1px ${T.line}`, marginRight: 6 }} />
          Boards on this platform
        </p>
      </Section>

      {level === 'lga' && (
        <Section title="Segment rules">
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 10 }}>
            {(['high_value', 'youth_hub', 'mass_market', 'unclassified'] as Segment[]).map(s => (
              <li key={s} style={{ fontSize: '0.8125rem', color: T.body, lineHeight: 1.45 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span aria-hidden style={{ width: 12, height: 12, background: SEGMENT_COLORS[s], opacity: 0.85, flexShrink: 0 }} />
                  <strong style={{ fontWeight: 600, color: T.ink }}>{SEGMENT_LABELS[s]}</strong>
                  <span style={{ ...numeric, color: T.muted, marginLeft: 'auto' }}>{segmentCounts[s]} LGAs</span>
                </div>
                <p style={{ margin: '3px 0 0 20px', fontSize: '0.75rem', color: T.muted }}>{ruleText[s]}</p>
              </li>
            ))}
          </ul>
          <p style={{ fontSize: '0.75rem', color: T.muted, margin: '10px 0 0', lineHeight: 1.45 }}>{ruleText.precedence}</p>
        </Section>
      )}

      {level === 'lga' && (
        <Section
          title="Affluence index weights"
          aside={weightsChanged ? <button type="button" onClick={() => onWeights(DEFAULT_WEIGHTS)} style={{ ...plainButton, padding: '2px 8px', fontSize: '0.75rem' }}>Reset to equal</button> : undefined}
        >
          <p style={{ fontSize: '0.75rem', color: T.muted, margin: '0 0 10px', lineHeight: 1.45 }}>{ruleText.affluence_index}</p>
          <div style={{ display: 'grid', gap: 10 }}>
            {AFFLUENCE_COMPONENTS.map(c => {
              const available = c !== 'rwi' || lgas.some(l => l.rwi_mean !== null);
              const share = thresholds.effective_weights[c];
              return (
                <div key={c}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: '0.8125rem', color: available ? T.body : T.faint }}>
                    <label htmlFor={`mi-weight-${c}`}>{COMPONENT_LABELS[c]}</label>
                    <span style={numeric}>{available ? `${Math.round((share ?? 0) * 100)}%` : 'No data'}</span>
                  </div>
                  {available ? (
                    <input
                      id={`mi-weight-${c}`}
                      type="range" min={0} max={4} step={1}
                      value={weights[c]}
                      onChange={e => onWeights({ ...weights, [c]: Number(e.target.value) })}
                      style={{ width: '100%', accentColor: T.accent, margin: '4px 0 0' }}
                    />
                  ) : (
                    <p style={{ fontSize: '0.75rem', color: T.muted, margin: '2px 0 0', lineHeight: 1.45 }}>
                      Not used: licence is {datasets.meta_rwi?.licence || 'non-commercial'}.
                    </p>
                  )}
                </div>
              );
            })}
          </div>
          {!thresholds.affluence_available && (
            <p style={{ fontSize: '0.75rem', color: T.caution, margin: '10px 0 0' }}>
              With fewer than two components weighted, no affluence index is shown.
            </p>
          )}
          {weightsChanged && (
            <p style={{ fontSize: '0.75rem', color: T.muted, margin: '10px 0 0' }}>
              Custom weights apply to this session only. The stored default is equal weights.
            </p>
          )}
        </Section>
      )}

      <Section title="Go to">
        <div style={{ display: 'grid', gap: 8 }}>
          <label style={{ fontSize: '0.75rem', color: T.muted }}>
            State
            <select value={selectedStateCode ?? ''} onChange={e => e.target.value && onSelectState(e.target.value)} style={{ ...selectStyle, marginTop: 3 }}>
              <option value="">Select a state</option>
              {states.map(s => <option key={s.state_pcode} value={s.state_pcode}>{s.state_name}</option>)}
            </select>
          </label>
          <label style={{ fontSize: '0.75rem', color: T.muted }}>
            LGA
            <select value={selectedLgaCode ?? ''} disabled={!selectedStateCode} onChange={e => e.target.value && onSelectLga(e.target.value)} style={{ ...selectStyle, marginTop: 3, opacity: selectedStateCode ? 1 : 0.6 }}>
              <option value="">{selectedStateCode ? 'Select an LGA' : 'Select a state first'}</option>
              {lgaOptions.map(l => <option key={l.lga_pcode} value={l.lga_pcode}>{l.lga_name}</option>)}
            </select>
          </label>
        </div>
      </Section>

      <Section title="Data sources">
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
          {active.map(d => (
            <li key={d.id} style={{ fontSize: '0.6875rem', color: T.muted, lineHeight: 1.45 }}>{d.attribution}</li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
