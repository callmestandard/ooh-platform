'use client';

import { useEffect, useState } from 'react';
import { useDashboardRole } from '@/components/layout/DashboardLayout';
import { boardFormatLabel } from '@/lib/board-formats';
import {
  listOwnerRequests, fetchOwnerMatchingBoards, fetchOwnResponses, submitOwnerResponses,
  type AvailabilityRequest, type AvailabilityRecipient, type OwnerBoard,
} from '@/lib/availability-requests';

type Item = { request: AvailabilityRequest; recipient: AvailabilityRecipient };
type Answer = { available: boolean | null; rate: string; note: string; accepted: boolean };

const naira = (n: number) => '₦' + Math.round(n).toLocaleString('en-NG');
const fmtDate = (d: string) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

const input: React.CSSProperties = {
  boxSizing: 'border-box', padding: '7px 10px', borderRadius: 8,
  border: '1px solid #E2E8F0', fontSize: '0.8125rem', color: '#0F172A', background: '#fff', fontFamily: 'inherit', outline: 'none',
};
const label: React.CSSProperties = { fontSize: '0.6875rem', fontWeight: 600, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4, display: 'block' };
const card: React.CSSProperties = { background: '#fff', border: '1px solid #E2E8F0', borderRadius: 12, padding: 20 };

export default function OwnerAvailabilityRequestsPage() {
  const role = useDashboardRole();
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [boards, setBoards] = useState<OwnerBoard[]>([]);
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function refresh() {
    const { items, error } = await listOwnerRequests();
    setItems(items);
    setError(error);
    setLoading(false);
  }

  useEffect(() => {
    if (role !== 'owner') return;
    (async () => { await refresh(); })();
  }, [role]);

  async function openRequest(item: Item) {
    setOpenId(item.request.id);
    setDetailLoading(true);
    setNotice(null);
    const [matching, existing] = await Promise.all([fetchOwnerMatchingBoards(item.request), fetchOwnResponses(item.request.id)]);
    const next: Record<string, Answer> = {};
    matching.forEach(b => {
      const e = existing.find(x => x.board_id === b.id);
      next[b.id] = e
        ? { available: e.available, rate: e.quoted_rate ? String(e.quoted_rate) : '', note: e.note ?? '', accepted: !!e.accepted_booking_id }
        : { available: null, rate: '', note: '', accepted: false };
    });
    setBoards(matching);
    setAnswers(next);
    setDetailLoading(false);
  }

  const set = (id: string, patch: Partial<Answer>) => setAnswers(prev => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  const answered = boards.filter(b => answers[b.id]?.available !== null);

  async function handleSubmit(item: Item) {
    setSaving(true);
    setError(null);
    const { error } = await submitOwnerResponses(item.request, answered.map(b => ({
      boardId: b.id, available: answers[b.id].available!, quotedRate: Number(answers[b.id].rate) > 0 ? Number(answers[b.id].rate) : null, note: answers[b.id].note,
    })));
    setSaving(false);
    if (error) { setError('Could not send your reply — ' + error); return; }
    setNotice('Reply sent to the agency.');
    await refresh();
  }

  if (role !== 'owner') {
    return <div style={{ padding: 32, color: '#64748B', fontSize: '0.875rem' }}>Availability requests are answered from board owner accounts.</div>;
  }

  return (
    <div style={{ maxWidth: 940, margin: '0 auto', padding: '8px 0 48px', fontFamily: 'inherit' }}>
      <h1 style={{ fontSize: '1.375rem', fontWeight: 800, color: '#0F172A', margin: '0 0 4px', letterSpacing: '-0.02em' }}>Availability requests</h1>
      <p style={{ fontSize: '0.875rem', color: '#64748B', margin: '0 0 20px', maxWidth: 660 }}>
        Agencies asking whether your boards are free for specific dates. Answer once per board. Your rate and reply are seen only by the agency that asked.
      </p>

      {error && <div style={{ ...card, borderColor: '#FECACA', background: '#FEF2F2', color: '#B91C1C', fontSize: '0.8125rem', marginBottom: 16 }}>{error}</div>}

      <div style={card}>
        {loading ? (
          <p style={{ fontSize: '0.8125rem', color: '#94A3B8', margin: 0 }}>Loading…</p>
        ) : items.length === 0 ? (
          <p style={{ fontSize: '0.8125rem', color: '#94A3B8', margin: 0 }}>No availability requests yet.</p>
        ) : items.map(item => {
          const r = item.request;
          const isOpen = openId === r.id;
          const closed = r.status === 'closed';
          return (
            <div key={r.id} data-request={r.id} style={{ borderTop: '1px solid #F1F5F9', padding: '12px 0' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: '0.875rem', fontWeight: 700, color: '#0F172A', margin: 0 }}>{r.title}</p>
                  <p style={{ fontSize: '0.75rem', color: '#64748B', margin: '2px 0 0' }}>
                    {r.agency_name ?? 'An agency'} · {r.cities.join(', ')} · {r.formats.length ? [...new Set(r.formats.map(boardFormatLabel))].join(', ') : 'Any format'} · {fmtDate(r.start_date)} → {fmtDate(r.end_date)}
                    {r.budget ? ` · budget ${naira(r.budget)}` : ''}
                  </p>
                </div>
                <span style={{ fontSize: '0.6875rem', fontWeight: 700, padding: '3px 9px', borderRadius: 999, flexShrink: 0, background: closed ? '#F1F5F9' : item.recipient.responded_at ? '#D1FAE5' : '#FEF3C7', color: closed ? '#64748B' : item.recipient.responded_at ? '#065F46' : '#92400E' }}>
                  {closed ? 'Closed' : item.recipient.responded_at ? 'Replied' : 'Awaiting your reply'}
                </span>
                <button onClick={() => (isOpen ? setOpenId(null) : openRequest(item))} style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid #E2E8F0', background: '#fff', color: '#7C3AED', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600, fontFamily: 'inherit' }}>
                  {isOpen ? 'Hide' : item.recipient.responded_at ? 'View / edit reply' : 'Reply'}
                </button>
              </div>

              {isOpen && (
                <div style={{ marginTop: 12, padding: 14, background: '#F8FAFC', borderRadius: 10 }}>
                  {r.notes && <p style={{ fontSize: '0.8125rem', color: '#334155', margin: '0 0 12px' }}><strong>Note from the agency:</strong> {r.notes}</p>}
                  {detailLoading ? <p style={{ fontSize: '0.8125rem', color: '#94A3B8', margin: 0 }}>Loading your boards…</p> : boards.length === 0 ? (
                    <p style={{ fontSize: '0.8125rem', color: '#64748B', margin: 0 }}>None of your boards match this request any more.</p>
                  ) : (
                    <>
                      <span style={label}>Your matching boards</span>
                      {boards.map(b => {
                        const a = answers[b.id];
                        const locked = closed || a.accepted;
                        return (
                          <div key={b.id} data-board={b.id} style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 8, padding: '10px 12px', marginBottom: 8 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                              <div style={{ flex: 1, minWidth: 180 }}>
                                <p style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#0F172A', margin: 0 }}>{b.name}</p>
                                <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: '2px 0 0' }}>{b.city} · {boardFormatLabel(b.format)}{b.asking_rate ? ` · your asking rate ${naira(b.asking_rate)}/mo` : ''}</p>
                              </div>
                              {([[true, 'Available'], [false, 'Not available']] as const).map(([val, text]) => (
                                <button key={text} disabled={locked} onClick={() => set(b.id, { available: val })}
                                  style={{ padding: '6px 12px', borderRadius: 8, border: 'none', fontSize: '0.75rem', fontWeight: 600, fontFamily: 'inherit', cursor: locked ? 'not-allowed' : 'pointer',
                                    background: a.available === val ? (val ? '#10B981' : '#EF4444') : '#F1F5F9', color: a.available === val ? '#fff' : '#475569' }}>
                                  {text}
                                </button>
                              ))}
                            </div>
                            {a.available !== null && (
                              <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                                {a.available && (
                                  <input type="number" min={0} disabled={locked} value={a.rate} onChange={e => set(b.id, { rate: e.target.value })} placeholder="Your rate, ₦ per month (optional)" style={{ ...input, width: 240 }} aria-label="Quoted rate per month" />
                                )}
                                <input disabled={locked} value={a.note} onChange={e => set(b.id, { note: e.target.value })} placeholder="Note (optional)" style={{ ...input, flex: 1, minWidth: 180 }} aria-label="Note" />
                              </div>
                            )}
                            {a.accepted && <p style={{ fontSize: '0.6875rem', color: '#065F46', margin: '6px 0 0', fontWeight: 600 }}>The agency has turned this into a booking request — see Bookings.</p>}
                          </div>
                        );
                      })}
                      {notice && <p data-notice style={{ fontSize: '0.75rem', color: '#15803D', margin: '4px 0 8px' }}>{notice}</p>}
                      {!closed && (
                        <button onClick={() => handleSubmit(item)} disabled={answered.length === 0 || saving}
                          style={{ padding: '8px 18px', borderRadius: 8, border: 'none', fontSize: '0.8125rem', fontWeight: 600, fontFamily: 'inherit', background: answered.length ? '#7C3AED' : '#F1F5F9', color: answered.length ? '#fff' : '#94A3B8', cursor: answered.length ? 'pointer' : 'not-allowed' }}>
                          {saving ? 'Sending…' : `Send reply for ${answered.length} board${answered.length !== 1 ? 's' : ''}`}
                        </button>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
