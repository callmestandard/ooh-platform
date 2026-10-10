'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { supabase } from '@/lib/supabase';
import type { Figure, ToolResult } from '@/lib/geo/ask-core';
import { QUERYABLE_METRICS, createToolExecutor } from '@/lib/geo/ask-tools';
import { METRICS, type MetricKey } from '@/lib/geo/metrics';
import { SEGMENT_LABELS, type Segment } from '@/lib/geo/segments';
import type { GeoDataset, StateMetrics } from '@/lib/geo/types';
import { PanelHeader, T, numeric, plainButton, sectionLabel, type EvidenceTarget } from './ui';

export type QueryOutcome = { title: string; result: ToolResult };

type Kind = 'rank' | 'profile' | 'compare' | 'boards';
const KIND_LABELS: Record<Kind, string> = {
  rank: 'Rank states or LGAs',
  profile: 'Profile one state',
  compare: 'Compare states',
  boards: 'Boards in a segment',
};
const SEGMENTS: Segment[] = ['high_value', 'youth_hub', 'mass_market', 'unclassified'];
const BANDS = [['pop_15_24', 'aged 15-24'], ['pop_25_34', 'aged 25-34'], ['pop_15_34', 'aged 15-34'], ['pop_35_plus', 'aged 35 and over']] as const;

const field = {
  width: '100%', padding: '6px 8px', borderRadius: 6, border: `1px solid ${T.line}`, background: T.surface, color: T.ink,
  fontSize: '0.8125rem', fontFamily: 'inherit', marginTop: 3,
} as const;
const label = { fontSize: '0.75rem', color: T.muted, display: 'block' } as const;

/**
 * Asks the data a question without a language model: the planner picks the
 * question from fixed choices and the page runs the same read-only lookups
 * "Ask the map" uses. Nothing is interpreted or generated, so every figure
 * shown is exactly what the lookup returned.
 */
export function QueryBuilder({ states, onOutcome }: { states: StateMetrics[]; onOutcome: (outcome: QueryOutcome) => void }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<Kind>('rank');
  const [geography, setGeography] = useState<'lga' | 'state'>('lga');
  const [metric, setMetric] = useState<MetricKey>('pop_15_34');
  const [state, setState] = useState('');
  const [segment, setSegment] = useState<Segment | ''>('');
  const [sort, setSort] = useState<'desc' | 'asc'>('desc');
  const [limit, setLimit] = useState(5);
  const [compare, setCompare] = useState<string[]>(['', '', '']);
  const [band, setBand] = useState<(typeof BANDS)[number][0]>('pop_15_34');
  const [radius, setRadius] = useState(2);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Lookups run in the browser as the signed-in user, so row-level security applies as usual.
  const execute = useMemo(() => createToolExecutor({ supabase, origin: typeof window === 'undefined' ? '' : window.location.origin }), []);
  const metrics = QUERYABLE_METRICS.filter(m => geography === 'lga' || m !== 'affluence_index');
  const picked = compare.filter(Boolean);

  const valid =
    kind === 'rank' ? true
    : kind === 'profile' ? !!state
    : kind === 'compare' ? picked.length >= 2 && new Set(picked).size === picked.length
    : !!segment;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    let title: string;
    let result: ToolResult;
    if (kind === 'rank') {
      const where = geography === 'lga'
        ? `LGAs${state ? ` in ${state}` : ''}${segment ? ` in segment "${SEGMENT_LABELS[segment]}"` : ''}`
        : 'States';
      title = `${where} by ${METRICS[metric].label}, ${sort === 'desc' ? 'highest' : 'lowest'} ${limit}`;
      result = await execute('query_metrics', {
        geography, metric, sort, limit,
        ...(geography === 'lga' && state ? { state } : {}),
        ...(geography === 'lga' && segment ? { segment } : {}),
      });
    } else if (kind === 'profile') {
      title = `Profile of ${state}`;
      result = await execute('get_state_profile', { state });
    } else if (kind === 'compare') {
      title = `${picked.join(', ')} compared`;
      result = await execute('compare_states', { states: picked });
    } else {
      title = `Boards in "${SEGMENT_LABELS[segment as Segment]}" LGAs${state ? ` in ${state}` : ''}, by residents ${BANDS.find(b => b[0] === band)![1]} within ${radius} km`;
      result = await execute('list_boards_in_segment', { segment, age_band: band, radius_km: radius, limit, ...(state ? { state } : {}) });
    }
    setBusy(false);
    if (result.error) { setError(result.error); return; }
    onOutcome({ title, result });
    setOpen(false);
  }

  const stateSelect = (value: string, onChange: (v: string) => void, placeholder: string, id?: string) => (
    <select id={id} value={value} onChange={e => onChange(e.target.value)} style={field}>
      <option value="">{placeholder}</option>
      {states.map(s => <option key={s.state_pcode} value={s.state_name}>{s.state_name}</option>)}
    </select>
  );

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} style={{ ...plainButton, fontWeight: 600, boxShadow: '0 2px 8px rgba(15,23,42,0.08)' }}>
        Query the data
      </button>
    );
  }

  return (
    <form onSubmit={submit} aria-label="Query the data" style={{ width: 320, maxWidth: '100%', background: T.surface, border: `1px solid ${T.line}`, borderRadius: 8, padding: 12, boxShadow: '0 2px 8px rgba(15,23,42,0.08)', display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ fontSize: '0.875rem', fontWeight: 600, color: T.ink, margin: 0, letterSpacing: 0 }}>Query the data</h2>
        <button type="button" onClick={() => setOpen(false)} style={{ ...plainButton, padding: '2px 8px', fontSize: '0.75rem' }}>Close</button>
      </div>

      <label style={label}>
        Question
        <select value={kind} onChange={e => { setKind(e.target.value as Kind); setError(null); }} style={field}>
          {(Object.keys(KIND_LABELS) as Kind[]).map(k => <option key={k} value={k}>{KIND_LABELS[k]}</option>)}
        </select>
      </label>

      {kind === 'rank' && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <label style={label}>
              Areas
              <select value={geography} onChange={e => { const g = e.target.value as 'lga' | 'state'; setGeography(g); if (g === 'state' && metric === 'affluence_index') setMetric('pop_15_34'); }} style={field}>
                <option value="lga">LGAs</option>
                <option value="state">States</option>
              </select>
            </label>
            <label style={label}>
              Order
              <select value={sort} onChange={e => setSort(e.target.value as 'desc' | 'asc')} style={field}>
                <option value="desc">Highest first</option>
                <option value="asc">Lowest first</option>
              </select>
            </label>
          </div>
          <label style={label}>
            By
            <select value={metric} onChange={e => setMetric(e.target.value as MetricKey)} style={field}>
              {metrics.map(m => <option key={m} value={m}>{METRICS[m].label}</option>)}
            </select>
          </label>
          {geography === 'lga' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <label style={label}>Within state{stateSelect(state, setState, 'Any state')}</label>
              <label style={label}>
                Segment
                <select value={segment} onChange={e => setSegment(e.target.value as Segment | '')} style={field}>
                  <option value="">Any segment</option>
                  {SEGMENTS.map(s => <option key={s} value={s}>{SEGMENT_LABELS[s]}</option>)}
                </select>
              </label>
            </div>
          )}
        </>
      )}

      {kind === 'profile' && <label style={label}>State{stateSelect(state, setState, 'Select a state')}</label>}

      {kind === 'compare' && (
        <div style={{ display: 'grid', gap: 6 }}>
          {compare.map((value, i) => (
            <label key={i} style={label}>
              {i === 2 ? 'Third state (optional)' : `State ${i + 1}`}
              {stateSelect(value, v => setCompare(prev => prev.map((p, j) => (j === i ? v : p))), i === 2 ? 'None' : 'Select a state')}
            </label>
          ))}
          {new Set(picked).size !== picked.length && <p style={{ fontSize: '0.75rem', color: T.caution, margin: 0 }}>Pick different states.</p>}
        </div>
      )}

      {kind === 'boards' && (
        <>
          <label style={label}>
            Segment
            <select value={segment} onChange={e => setSegment(e.target.value as Segment | '')} style={field}>
              <option value="">Select a segment</option>
              {SEGMENTS.map(s => <option key={s} value={s}>{SEGMENT_LABELS[s]}</option>)}
            </select>
          </label>
          <label style={label}>Within state{stateSelect(state, setState, 'Any state')}</label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <label style={label}>
              Residents
              <select value={band} onChange={e => setBand(e.target.value as typeof band)} style={field}>
                {BANDS.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
              </select>
            </label>
            <label style={label}>
              Within
              <select value={radius} onChange={e => setRadius(Number(e.target.value))} style={field}>
                {[1, 2, 5].map(r => <option key={r} value={r}>{r} km</option>)}
              </select>
            </label>
          </div>
        </>
      )}

      {(kind === 'rank' || kind === 'boards') && (
        <label style={label}>
          How many
          <select value={limit} onChange={e => setLimit(Number(e.target.value))} style={field}>
            {[3, 5, 10, 20].map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
      )}

      {error && <p role="alert" style={{ fontSize: '0.75rem', color: T.caution, margin: 0 }}>{error}</p>}
      <button type="submit" disabled={!valid || busy} style={{ ...plainButton, background: T.accent, color: '#fff', borderColor: T.accent, fontWeight: 600, opacity: !valid || busy ? 0.6 : 1 }}>
        {busy ? 'Looking up…' : 'Show figures'}
      </button>
      <p style={{ fontSize: '0.6875rem', color: T.muted, margin: 0, lineHeight: 1.45 }}>No AI is involved: this reads the computed tables directly.</p>
    </form>
  );
}

type ResultProps = {
  outcome: QueryOutcome;
  datasets: Record<string, GeoDataset>;
  onEvidence: (target: EvidenceTarget) => void;
  onClose: () => void;
};

/** The figures a query returned, grouped by place, each opening the evidence drawer. */
export default function QueryResult({ outcome, datasets, onEvidence, onClose }: ResultProps) {
  const { title, result } = outcome;
  const groups = useMemo(() => {
    const byPlace = new Map<string, Figure[]>();
    for (const f of result.figures) byPlace.set(f.geography, [...(byPlace.get(f.geography) || []), f]);
    return [...byPlace];
  }, [result]);
  const sources = useMemo(() => [...new Map(result.figures.map(f => [f.dataset_id, f.reference_year]))], [result]);
  // One metric for every place (a ranking) reads best as a single numbered list.
  const ranking = groups.length > 1 && groups.every(([, figures]) => figures.length === 1) && new Set(result.figures.map(f => f.metric)).size === 1;

  const chip = (f: Figure) => (
    <button
      type="button"
      onClick={() => onEvidence({ metric: f.metric, display: f.display, geography: f.geography, row: null, label: f.label, unit: f.unit, datasetIds: [f.dataset_id] })}
      title="Source and method"
      style={{ ...numeric, padding: '2px 8px', borderRadius: 6, border: `1px solid ${T.line}`, background: T.wash, color: T.accent, fontSize: '0.8125rem', fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer', whiteSpace: 'nowrap' }}
    >
      {f.display}
    </button>
  );

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: T.surface }}>
      <PanelHeader title="Query result" subtitle={title} onClose={onClose} closeLabel="Close query result" />
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {result.figures.length === 0 && (
          <p style={{ fontSize: '0.875rem', color: T.body, margin: 0, padding: '14px 16px' }}>No figures match this query.</p>
        )}

        {ranking ? (
          <div style={{ padding: '14px 16px', borderBottom: `1px solid ${T.hairline}` }}>
            <h3 style={{ ...sectionLabel, marginBottom: 8 }}>{result.figures[0].label}</h3>
            <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
              {result.figures.map((f, i) => (
                <li key={f.geography} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.8125rem', color: T.body }}>
                  <span style={{ ...numeric, color: T.faint, width: 18, textAlign: 'right' }}>{i + 1}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>{f.geography}</span>
                  {chip(f)}
                </li>
              ))}
            </ol>
          </div>
        ) : groups.map(([place, figures]) => (
          <div key={place} style={{ padding: '14px 16px', borderBottom: `1px solid ${T.hairline}` }}>
            <h3 style={{ fontSize: '0.875rem', fontWeight: 600, color: T.ink, margin: '0 0 8px', letterSpacing: 0 }}>{place}</h3>
            <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: '1fr auto', columnGap: 10, rowGap: 6, alignItems: 'center', fontSize: '0.8125rem' }}>
              {figures.map(f => (
                <div key={f.metric} style={{ display: 'contents' }}>
                  <dt style={{ color: T.body }}>{f.label}</dt>
                  <dd style={{ margin: 0, textAlign: 'right' }}>{chip(f)}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}

        {result.notes && result.notes.length > 0 && (
          <div style={{ padding: '14px 16px', borderBottom: `1px solid ${T.hairline}` }}>
            <h3 style={{ ...sectionLabel, marginBottom: 6 }}>Notes</h3>
            <ul style={{ margin: 0, paddingLeft: 16, display: 'grid', gap: 4 }}>
              {result.notes.map(note => <li key={note} style={{ ...numeric, fontSize: '0.8125rem', color: T.body, lineHeight: 1.45 }}>{note}</li>)}
            </ul>
          </div>
        )}

        {sources.length > 0 && (
          <div style={{ padding: '14px 16px', borderBottom: `1px solid ${T.hairline}` }}>
            <h3 style={{ ...sectionLabel, marginBottom: 6 }}>Data used</h3>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 4 }}>
              {sources.map(([id, year]) => (
                <li key={id} style={{ fontSize: '0.8125rem', color: T.body }}>
                  {datasets[id]?.name ?? 'Affluence index and segment rules'}
                  <span style={{ ...numeric, color: T.muted }}> · reference: {year}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <p style={{ padding: '12px 16px', fontSize: '0.6875rem', color: T.muted, lineHeight: 1.5, margin: 0 }}>
          Read directly from the computed tables. No language model was used. Select any figure for its source and limits.
        </p>
      </div>
    </div>
  );
}
