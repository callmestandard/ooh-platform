'use client';

import { useState } from 'react';
import ActivityTimeline from '@/components/activity/ActivityTimeline';
import { input, ghostBtn, naira, fmtDate } from '@/components/owner/ui';
import {
  MAKEGOOD_REASON_LABELS, MAKEGOOD_REMEDY_LABELS, MAKEGOOD_STATUS_LABELS, MAKEGOOD_STATUS_STYLE,
  isOverdue, isUnappliedCredit, setMakegoodStatus, setAgencyNotes, setOwnerNotes, setCreditApplied,
  type Makegood, type MakegoodStatus,
} from '@/lib/makegoods';

type Props = {
  makegood: Makegood;
  /** Which party is looking. The database enforces the same split; this only decides which controls to draw. */
  side: 'agency' | 'owner';
  onChanged: () => void | Promise<void>;
};

const small: React.CSSProperties = { fontSize: '0.6875rem', fontWeight: 600, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '12px 0 4px', display: 'block' };

export default function MakegoodCard({ makegood: m, side, onChanged }: Props) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState(side === 'agency' ? m.notes ?? '' : m.owner_notes ?? '');
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const overdue = isOverdue(m);
  const st = MAKEGOOD_STATUS_STYLE[m.status];

  async function run(fn: () => Promise<{ error: string | null }>) {
    setError(null);
    const { error } = await fn();
    if (error) { setError(error); return; }
    setRefresh(k => k + 1);
    await onChanged();
  }

  const agencyActions: { to: MakegoodStatus; label: string }[] = ([
    { to: 'delivered', label: 'Mark delivered' },
    { to: 'partially_delivered', label: 'Partly delivered' },
    { to: 'disputed', label: 'Dispute' },
    { to: 'waived', label: 'Waive' },
    { to: 'promised', label: 'Reopen' },
  ] as const).filter(a => a.to !== m.status);
  const ownerActions: { to: MakegoodStatus; label: string }[] = ([
    { to: 'delivered', label: 'Mark delivered' },
    { to: 'partially_delivered', label: 'Partly delivered' },
  ] as const).filter(a => a.to !== m.status);

  return (
    <div data-makegood={m.id} data-status={m.status} style={{ borderTop: '1px solid #F1F5F9', padding: '14px 0' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
        <div style={{ flex: '1 1 260px', minWidth: 0 }}>
          <p style={{ fontSize: '0.875rem', fontWeight: 700, color: '#0F172A', margin: 0 }}>
            {m.bookings?.boards?.name ?? 'Board'}
            <span style={{ fontWeight: 500, color: '#64748B' }}> — {MAKEGOOD_REASON_LABELS[m.reason]}</span>
          </p>
          <p style={{ fontSize: '0.75rem', color: '#475569', margin: '3px 0 0' }}>
            Promised: <strong>{MAKEGOOD_REMEDY_LABELS[m.promised_remedy_type]}</strong>
            {m.promised_remedy_type === 'credit' && m.promised_value ? ` of ${naira(m.promised_value)}` : ''}
            {m.replacement_board?.name ? ` (${m.replacement_board.name})` : ''}
            {m.promised_detail ? ` · ${m.promised_detail}` : ''}
          </p>
          <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: '3px 0 0' }}>
            {m.bookings?.campaigns?.name ? `${m.bookings.campaigns.name} · ` : ''}promised {fmtDate(m.promised_on)}
            {m.due_by ? ` · due ${fmtDate(m.due_by)}` : ' · no due date'}
            {m.delivered_on ? ` · delivered ${fmtDate(m.delivered_on)}` : ''}
          </p>
        </div>
        {overdue && <span data-overdue style={{ fontSize: '0.6875rem', fontWeight: 700, padding: '3px 9px', borderRadius: 999, background: '#FEE2E2', color: '#991B1B' }}>Overdue</span>}
        <span style={{ fontSize: '0.6875rem', fontWeight: 700, padding: '3px 9px', borderRadius: 999, background: st.bg, color: st.color }}>{MAKEGOOD_STATUS_LABELS[m.status]}</span>
        <button style={ghostBtn} onClick={() => setOpen(o => !o)}>{open ? 'Close' : 'Details'}</button>
      </div>

      {side === 'agency' && isUnappliedCredit(m) && (
        <p data-credit-flag style={{ fontSize: '0.75rem', color: '#92400E', background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 8, padding: '8px 10px', margin: '10px 0 0' }}>
          Credit of <strong>{naira(m.promised_value)}</strong> agreed but <strong>not applied</strong>. Nothing has been changed on the rate or any invoice — apply it yourself, then tick it off below.
        </p>
      )}

      {open && (
        <div style={{ marginTop: 12, padding: 14, background: '#F8FAFC', borderRadius: 10 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {(side === 'agency' ? agencyActions : ownerActions).map(a => (
              <button key={a.to} data-action={a.to} style={{ ...ghostBtn, color: a.to === 'disputed' ? '#B91C1C' : a.to === 'delivered' ? '#15803D' : '#475569' }} onClick={() => run(() => setMakegoodStatus(m.id, a.to))}>{a.label}</button>
            ))}
            {side === 'agency' && m.promised_remedy_type === 'credit' && !!m.promised_value && (
              <button data-action="credit-applied" style={ghostBtn} onClick={() => run(() => setCreditApplied(m.id, !m.credit_applied_at))}>
                {m.credit_applied_at ? 'Credit applied ✓ — undo' : 'I have applied this credit'}
              </button>
            )}
          </div>
          {side === 'owner' && <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: '8px 0 0' }}>Only the agency can dispute or waive a makegood, or change what was promised.</p>}

          <span style={small}>{side === 'agency' ? 'Your notes' : 'Agency notes'}</span>
          {side === 'agency' ? (
            <div style={{ display: 'flex', gap: 8 }}>
              <input style={input} value={note} onChange={e => setNote(e.target.value)} aria-label="Agency notes" />
              <button style={ghostBtn} onClick={() => run(() => setAgencyNotes(m.id, note))}>Save</button>
            </div>
          ) : <p style={{ fontSize: '0.8125rem', color: '#334155', margin: 0 }}>{m.notes || '—'}</p>}

          <span style={small}>{side === 'owner' ? 'Your notes' : 'Owner notes'}</span>
          {side === 'owner' ? (
            <div style={{ display: 'flex', gap: 8 }}>
              <input style={input} value={note} onChange={e => setNote(e.target.value)} aria-label="Owner notes" />
              <button style={ghostBtn} onClick={() => run(() => setOwnerNotes(m.id, note))}>Save</button>
            </div>
          ) : <p data-owner-notes style={{ fontSize: '0.8125rem', color: '#334155', margin: 0 }}>{m.owner_notes || '—'}</p>}

          {error && <p style={{ fontSize: '0.75rem', color: '#B91C1C', margin: '10px 0 0' }}>{error}</p>}
          <div style={{ marginTop: 14 }}>
            <ActivityTimeline entityType="makegood" entityId={m.id} title="Status history" refreshKey={refresh} />
          </div>
        </div>
      )}
    </div>
  );
}
