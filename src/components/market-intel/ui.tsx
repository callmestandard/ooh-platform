'use client';

import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import type { MetricKey } from '@/lib/geo/metrics';
import type { LgaMetrics, StateMetrics } from '@/lib/geo/types';

/** What the evidence drawer is asked to explain: one figure, for one place. */
export type EvidenceTarget = {
  /** A catalogue metric, or the metric name a lookup returned (answers from Ask the map). */
  metric: MetricKey | (string & {});
  /** The value exactly as it is printed on screen. */
  display: string;
  geography: string;
  row: LgaMetrics | StateMetrics | null;
  /** For figures that do not come from a row on screen: their own label, unit and dataset ids. */
  label?: string;
  unit?: string;
  datasetIds?: string[];
  /** Extra sourced context for this figure (e.g. a sample size), each already worded. */
  notes?: string[];
};

export const T = {
  ink: '#0F172A',
  body: '#334155',
  muted: '#64748B',
  faint: '#94A3B8',
  line: '#E2E8F0',
  hairline: '#F1F5F9',
  surface: '#FFFFFF',
  wash: '#F8FAFC',
  accent: '#1B4F8A',
  accentWash: '#EFF6FF',
  caution: '#92400E',
  cautionWash: '#FFFBEB',
  cautionLine: '#FDE68A',
} as const;

export const numeric: CSSProperties = { fontVariantNumeric: 'tabular-nums', fontFeatureSettings: '"tnum"' };

export const sectionLabel: CSSProperties = {
  fontSize: '0.6875rem', fontWeight: 600, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.06em', margin: 0,
};

export function useIsNarrow(maxWidth = 860): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const query = window.matchMedia(`(max-width: ${maxWidth}px)`);
    const update = () => setNarrow(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, [maxWidth]);
  return narrow;
}

/** The "i" control beside a figure. Opens the evidence drawer for it. */
export function InfoButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Source and method: ${label}`}
      title="Source and method"
      style={{
        width: 18, height: 18, flexShrink: 0, padding: 0, borderRadius: '50%', border: `1px solid ${T.line}`, background: T.surface,
        color: T.muted, fontSize: '0.6875rem', fontWeight: 600, fontFamily: 'Georgia, serif', fontStyle: 'italic', lineHeight: 1,
        cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      i
    </button>
  );
}

/** A labelled figure with its info control. `value` of null renders "No data". */
export function Figure({ label, value, sub, onInfo, flag }: { label: string; value: string | null; sub?: string; onInfo?: () => void; flag?: string | null }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: '0.75rem', color: T.muted }}>{label}</span>
        {onInfo && <InfoButton label={label} onClick={onInfo} />}
      </div>
      <div style={{ ...numeric, fontSize: '1.0625rem', fontWeight: 600, color: value === null ? T.faint : T.ink, marginTop: 2 }}>
        {value ?? 'No data'}
      </div>
      {sub && <div style={{ ...numeric, fontSize: '0.75rem', color: T.muted, marginTop: 1 }}>{sub}</div>}
      {flag && <LowConfidence text={flag} />}
    </div>
  );
}

export function LowConfidence({ text }: { text: string }) {
  return (
    <div style={{ marginTop: 4, display: 'inline-block', fontSize: '0.6875rem', color: T.caution, background: T.cautionWash, border: `1px solid ${T.cautionLine}`, borderRadius: 4, padding: '2px 6px', lineHeight: 1.35 }}>
      Low confidence: {text}
    </div>
  );
}

export function PanelHeader({ title, subtitle, onClose, closeLabel }: { title: string; subtitle?: string; onClose?: () => void; closeLabel?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, padding: '14px 16px', borderBottom: `1px solid ${T.line}` }}>
      <div style={{ minWidth: 0 }}>
        <h2 style={{ fontSize: '0.9375rem', fontWeight: 600, color: T.ink, margin: 0, letterSpacing: 0 }}>{title}</h2>
        {subtitle && <p style={{ fontSize: '0.75rem', color: T.muted, margin: '2px 0 0' }}>{subtitle}</p>}
      </div>
      {onClose && (
        <button type="button" onClick={onClose} aria-label={closeLabel || 'Close'} style={{ ...plainButton, padding: '2px 8px', fontSize: '0.8125rem' }}>
          Close
        </button>
      )}
    </div>
  );
}

export const plainButton: CSSProperties = {
  border: `1px solid ${T.line}`, background: T.surface, color: T.body, borderRadius: 6, padding: '6px 10px',
  fontSize: '0.8125rem', fontFamily: 'inherit', cursor: 'pointer',
};

export function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section style={{ padding: '14px 16px', borderBottom: `1px solid ${T.hairline}` }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
        <h3 style={sectionLabel}>{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}
