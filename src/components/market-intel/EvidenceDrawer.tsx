'use client';

import { useEffect, useRef } from 'react';
import { METRICS, metricDatasets } from '@/lib/geo/metrics';
import { AFFLUENCE_COMPONENTS, type SegmentThresholds } from '@/lib/geo/segments';
import type { GeoDataset } from '@/lib/geo/types';
import { PanelHeader, T, numeric, sectionLabel, type EvidenceTarget } from './ui';

const NATURE_LABELS: Record<GeoDataset['data_nature'], string> = {
  modelled: 'Modelled estimate, not a count',
  survey_estimate: 'Survey estimate with sampling error',
  crowdsourced: 'Volunteer-mapped; counts are lower bounds',
  remote_sensing: 'Satellite measurement',
  administrative: 'Administrative record',
};

type Props = {
  target: EvidenceTarget;
  datasets: Record<string, GeoDataset>;
  /** Rule text and thresholds for the weights currently applied — shown for the affluence index and segments. */
  ruleText: Record<string, string>;
  thresholds: SegmentThresholds;
  onClose: () => void;
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '104px 1fr', gap: 10, padding: '5px 0', fontSize: '0.8125rem' }}>
      <dt style={{ color: T.muted }}>{label}</dt>
      <dd style={{ color: T.body, margin: 0, minWidth: 0, overflowWrap: 'anywhere' }}>{children}</dd>
    </div>
  );
}

function DatasetBlock({ dataset }: { dataset: GeoDataset }) {
  return (
    <div style={{ padding: '14px 16px', borderBottom: `1px solid ${T.hairline}` }}>
      <p style={{ fontSize: '0.875rem', fontWeight: 600, color: T.ink, margin: '0 0 2px' }}>{dataset.name}</p>
      <p style={{ fontSize: '0.75rem', color: T.caution, margin: '0 0 8px' }}>{NATURE_LABELS[dataset.data_nature]}</p>
      <dl style={{ margin: 0 }}>
        <Row label="Publisher">{dataset.publisher}</Row>
        <Row label="Version">{dataset.version}</Row>
        <Row label="Reference year"><span style={numeric}>{dataset.reference_year}</span></Row>
        <Row label="Resolution">{dataset.resolution}</Row>
        <Row label="Method">{dataset.method_summary}</Row>
        <Row label="Licence">
          {dataset.licence_url
            ? <a href={dataset.licence_url} target="_blank" rel="noopener noreferrer" style={{ color: T.accent }}>{dataset.licence}</a>
            : dataset.licence}
        </Row>
        <Row label="Limitation">{dataset.known_limitations}</Row>
        <Row label="Retrieved"><span style={numeric}>{dataset.retrieved_on || 'Not recorded'}</span></Row>
        <Row label="Source"><a href={dataset.url} target="_blank" rel="noopener noreferrer" style={{ color: T.accent }}>{new URL(dataset.url).hostname}</a></Row>
      </dl>
    </div>
  );
}

export default function EvidenceDrawer({ target, datasets, ruleText, thresholds, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const def = METRICS[target.metric];
  const sources = target.row ? metricDatasets(target.row, target.metric, datasets) : [];
  const isComposite = target.metric === 'affluence_index' || target.metric === 'segment';
  const excluded = Object.values(datasets).filter(d => d.status === 'excluded');
  const unusedComponents = AFFLUENCE_COMPONENTS.filter(c => !thresholds.components_used.includes(c));

  // Move focus into the drawer when it opens, and close on Escape.
  useEffect(() => {
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, target]);

  return (
    <div ref={ref} tabIndex={-1} role="dialog" aria-label={`Evidence for ${def.label}`} style={{ height: '100%', display: 'flex', flexDirection: 'column', background: T.surface, outline: 'none' }}>
      <PanelHeader title="Evidence" subtitle="Where this figure comes from" onClose={onClose} closeLabel="Close evidence" />
      <div style={{ flex: 1, overflowY: 'auto' }}>
        <div style={{ padding: '14px 16px', borderBottom: `1px solid ${T.hairline}` }}>
          <p style={{ fontSize: '0.75rem', color: T.muted, margin: 0 }}>{target.geography}</p>
          <p style={{ fontSize: '0.875rem', color: T.ink, margin: '2px 0 6px' }}>{def.label}</p>
          <p style={{ ...numeric, fontSize: '1.375rem', fontWeight: 600, color: T.ink, margin: 0 }}>
            {target.display}
            {def.unit && target.display !== 'No data' && <span style={{ fontSize: '0.75rem', fontWeight: 400, color: T.muted, marginLeft: 6 }}>{def.unit}</span>}
          </p>
          {target.notes?.map(note => (
            <p key={note} style={{ fontSize: '0.8125rem', color: T.body, margin: '8px 0 0' }}>{note}</p>
          ))}
        </div>

        <div style={{ padding: '14px 16px', borderBottom: `1px solid ${T.hairline}` }}>
          <h3 style={{ ...sectionLabel, marginBottom: 6 }}>How it is calculated</h3>
          <p style={{ fontSize: '0.8125rem', color: T.body, margin: 0 }}>{def.method}</p>
          {isComposite && (
            <div style={{ marginTop: 10, fontSize: '0.8125rem', color: T.body, display: 'grid', gap: 6 }}>
              <p style={{ margin: 0 }}>{ruleText.affluence_index}</p>
              {target.metric === 'segment' && (
                <>
                  <p style={{ margin: 0 }}><strong style={{ fontWeight: 600 }}>High value:</strong> {ruleText.high_value}</p>
                  <p style={{ margin: 0 }}><strong style={{ fontWeight: 600 }}>Youth hub:</strong> {ruleText.youth_hub}</p>
                  <p style={{ margin: 0 }}><strong style={{ fontWeight: 600 }}>Mass market:</strong> {ruleText.mass_market}</p>
                  <p style={{ margin: 0 }}>{ruleText.precedence}</p>
                </>
              )}
              {unusedComponents.includes('rwi') && excluded.some(d => d.id === 'meta_rwi') && (
                <p style={{ margin: 0, color: T.caution }}>
                  No household wealth input: the Relative Wealth Index is not used because its licence ({datasets.meta_rwi.licence}) forbids commercial use.
                  This index reflects lit activity and mapped commercial places, not household income.
                </p>
              )}
            </div>
          )}
        </div>

        <div style={{ padding: '10px 16px 0' }}>
          <h3 style={sectionLabel}>{sources.length > 1 ? 'Sources' : 'Source'}</h3>
        </div>
        {sources.length === 0 && (
          <p style={{ fontSize: '0.8125rem', color: T.muted, padding: '8px 16px 14px', margin: 0 }}>
            No dataset is recorded for this figure in this place, so no value is shown.
          </p>
        )}
        {sources.map(dataset => <DatasetBlock key={dataset.id} dataset={dataset} />)}
      </div>
    </div>
  );
}
