'use client';

// Asks how a board was verified before an admin marks it Verified (067).
// Rendered on <body>, like the pin editor, so dashboard layers can't cover it.
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { VERIFY_METHODS, type VerificationMethod } from '@/lib/board-verification';

export type VerifyAnswer = { method: VerificationMethod; note: string };

export default function VerifyMethodDialog({ names, onDone }: {
  /** Boards being verified; more than one when a bulk action or drag asks. */
  names: string[];
  onDone: (answer: VerifyAnswer | null) => void;
}) {
  const [method, setMethod] = useState<VerificationMethod | null>(null);
  const [note, setNote] = useState('');
  const needsNote = method === 'other' && !note.trim();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onDone(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onDone]);

  const btn: React.CSSProperties = { padding: '8px 14px', borderRadius: 8, border: '1px solid #E2E8F0', background: '#fff', color: '#334155', fontSize: '0.8125rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' };
  const title = names.length === 1 ? names[0] : `${names.length} boards`;

  return createPortal((
    <div role="dialog" aria-modal="true" aria-label="How was it verified?" onClick={() => onDone(null)} data-verify-method
      style={{ position: 'fixed', inset: 0, zIndex: 900, background: 'rgba(15,23,42,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: '#fff', borderRadius: 16, width: 'min(460px, 100%)', maxHeight: 'calc(100vh - 32px)', overflow: 'auto', boxShadow: '0 24px 64px rgba(0,0,0,0.3)', fontFamily: "'Inter', sans-serif" }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #F1F5F9' }}>
          <p style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: '#0F172A' }}>How was it verified?</p>
          <p style={{ margin: '2px 0 0', fontSize: '0.75rem', color: '#64748B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</p>
        </div>
        <div style={{ padding: '14px 20px 0', display: 'grid', gap: 8 }}>
          {VERIFY_METHODS.map(m => (
            <label key={m.value} htmlFor={`vm-${m.value}`}
              style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '10px 12px', borderRadius: 10, cursor: 'pointer',
                border: `1px solid ${method === m.value ? '#1B4F8A' : '#E2E8F0'}`, background: method === m.value ? '#EFF6FF' : '#fff' }}>
              <input id={`vm-${m.value}`} type="radio" name="verify-method" checked={method === m.value} onChange={() => setMethod(m.value)} style={{ marginTop: 3 }} />
              <span>
                <span style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, color: '#0F172A' }}>{m.label}</span>
                <span style={{ display: 'block', fontSize: '0.75rem', color: '#64748B' }}>{m.help}</span>
              </span>
            </label>
          ))}
          <label htmlFor="verify-note" style={{ fontSize: '0.75rem', fontWeight: 600, color: '#334155', marginTop: 4 }}>Note {method === 'other' ? '' : '(optional)'}</label>
          <input id="verify-note" value={note} maxLength={300} onChange={e => setNote(e.target.value)}
            placeholder="e.g. Visited 18 Nov, facing Ikorodu Road"
            style={{ padding: '9px 11px', borderRadius: 8, border: '1px solid #E2E8F0', fontSize: '0.8125rem', fontFamily: 'inherit', color: '#0F172A' }} />
          <p style={{ margin: 0, fontSize: '0.75rem', color: '#64748B' }}>If the pin is later moved more than 50 m, the board goes back to pending.</p>
        </div>
        <div style={{ padding: '16px 20px 18px', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button type="button" style={btn} onClick={() => onDone(null)}>Cancel</button>
          <button type="button" data-confirm-verify disabled={!method || needsNote} onClick={() => method && onDone({ method, note: note.trim() })}
            style={{ ...btn, background: '#1B4F8A', borderColor: '#1B4F8A', color: '#fff', opacity: !method || needsNote ? 0.5 : 1, cursor: !method || needsNote ? 'default' : 'pointer' }}>
            Mark verified
          </button>
        </div>
      </div>
    </div>
  ), document.body);
}
