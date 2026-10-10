'use client';

import { useState, type FormEvent } from 'react';
import { authedFetch } from '@/lib/api';
import type { AskResult, Figure } from '@/lib/geo/ask-core';
import type { GeoDataset } from '@/lib/geo/types';
import { PanelHeader, T, numeric, plainButton, sectionLabel, type EvidenceTarget } from './ui';

export type AskOutcome = { question: string; result: AskResult & { logged?: boolean } };

const STATUS_TITLE: Record<AskResult['status'], string> = {
  answered: 'Answer',
  cannot_answer: 'The data cannot answer this',
  refused: 'The data cannot answer this',
  unverifiable: 'No verifiable answer',
  error: 'Something went wrong',
};

/** The single question box. Submits to /api/geo/ask and hands the outcome to the parent. */
export function AskBox({ onOutcome }: { onOutcome: (outcome: AskOutcome) => void }) {
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const q = question.trim();
    if (!q || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await authedFetch('/api/geo/ask', { method: 'POST', body: JSON.stringify({ question: q }) });
      const body = await res.json();
      if (!res.ok) setError(body.error || 'The question could not be sent.');
      else onOutcome({ question: q, result: body });
    } catch {
      setError('The question could not be sent. Check your connection.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ background: T.surface, border: `1px solid ${T.line}`, borderRadius: 8, padding: 6, boxShadow: '0 2px 8px rgba(15,23,42,0.08)' }}>
      <div style={{ display: 'flex', gap: 6 }}>
        <label htmlFor="mi-ask" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>Ask a question about the market data</label>
        <input
          id="mi-ask"
          value={question}
          onChange={e => setQuestion(e.target.value)}
          maxLength={500}
          placeholder="Ask the map, e.g. Which Lagos LGAs have the most residents aged 15-34?"
          style={{ flex: 1, minWidth: 0, border: 'none', outline: 'none', padding: '6px 8px', fontSize: '0.8125rem', fontFamily: 'inherit', color: T.ink, background: 'transparent' }}
        />
        <button type="submit" disabled={busy || !question.trim()} style={{ ...plainButton, background: T.accent, color: '#fff', borderColor: T.accent, fontWeight: 600, opacity: busy || !question.trim() ? 0.6 : 1 }}>
          {busy ? 'Looking up…' : 'Ask'}
        </button>
      </div>
      {error && <p role="alert" style={{ fontSize: '0.75rem', color: T.caution, margin: '6px 8px 2px' }}>{error}</p>}
    </form>
  );
}

function FigureChip({ figure, onClick }: { figure: Figure; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Source and method"
      style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6, textAlign: 'left', padding: '4px 8px', borderRadius: 6, border: `1px solid ${T.line}`, background: T.wash, cursor: 'pointer', fontFamily: 'inherit', maxWidth: '100%' }}
    >
      <span style={{ ...numeric, fontSize: '0.8125rem', fontWeight: 600, color: T.accent }}>{figure.display}</span>
      <span style={{ fontSize: '0.6875rem', color: T.muted, overflow: 'hidden', textOverflow: 'ellipsis' }}>{figure.label} · {figure.geography}</span>
    </button>
  );
}

type Props = {
  outcome: AskOutcome;
  datasets: Record<string, GeoDataset>;
  onEvidence: (target: EvidenceTarget) => void;
  onClose: () => void;
};

/** The answer: each statement with the figures it rests on as chips that open the evidence drawer. */
export default function AskPanel({ outcome, datasets, onEvidence, onClose }: Props) {
  const { question, result } = outcome;
  const notAnswered = result.status !== 'answered';

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: T.surface }}>
      <PanelHeader title={STATUS_TITLE[result.status]} subtitle={question} onClose={onClose} closeLabel="Close answer" />
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {notAnswered && (
          <div style={{ padding: '14px 16px', borderBottom: `1px solid ${T.hairline}` }}>
            <p style={{ fontSize: '0.875rem', color: T.ink, margin: 0, lineHeight: 1.5 }}>{result.reason}</p>
            {result.suggestion && (
              <>
                <h3 style={{ ...sectionLabel, margin: '14px 0 4px' }}>What the data can say</h3>
                <p style={{ fontSize: '0.8125rem', color: T.body, margin: 0, lineHeight: 1.5 }}>{result.suggestion}</p>
              </>
            )}
          </div>
        )}

        {result.statements.map((statement, i) => (
          <div key={i} style={{ padding: '14px 16px', borderBottom: `1px solid ${T.hairline}` }}>
            <p style={{ ...numeric, fontSize: '0.875rem', color: T.ink, margin: 0, lineHeight: 1.5 }}>{statement.text}</p>
            {statement.figures.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                {statement.figures.map((figure, j) => (
                  <FigureChip
                    key={j}
                    figure={figure}
                    onClick={() => onEvidence({ metric: figure.metric, display: figure.display, geography: figure.geography, row: null, label: figure.label, unit: figure.unit, datasetIds: [figure.dataset_id] })}
                  />
                ))}
              </div>
            )}
          </div>
        ))}

        {result.sources.length > 0 && (
          <div style={{ padding: '14px 16px', borderBottom: `1px solid ${T.hairline}` }}>
            <h3 style={{ ...sectionLabel, marginBottom: 6 }}>Data used</h3>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 4 }}>
              {result.sources.map(source => (
                <li key={source.dataset_id} style={{ fontSize: '0.8125rem', color: T.body }}>
                  {datasets[source.dataset_id]?.name ?? 'Affluence index and segment rules'}
                  <span style={{ ...numeric, color: T.muted }}> · reference: {source.reference_year}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div style={{ padding: '12px 16px', fontSize: '0.6875rem', color: T.muted, lineHeight: 1.5 }}>
          <p style={{ margin: 0 }}>
            {result.status === 'refused'
              ? 'This was decided by a fixed rule, without a language model.'
              : 'A language model chose the lookups and wrote the sentences. Every figure comes from the computed tables and was checked against them by the server before being shown.'}
          </p>
          {result.rejected.length > 0 && result.status === 'answered' && (
            <p style={{ margin: '4px 0 0' }}>
              <span style={numeric}>{result.rejected.length}</span> earlier draft{result.rejected.length !== 1 ? 's were' : ' was'} discarded by that check.
            </p>
          )}
          <p style={{ margin: '4px 0 0' }}>{result.logged === false ? 'This question could not be written to the audit log.' : 'This question and its lookups are recorded for audit.'}</p>
        </div>
      </div>
    </div>
  );
}
