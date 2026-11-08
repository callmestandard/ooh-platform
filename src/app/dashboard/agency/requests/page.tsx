'use client';

import { useEffect, useState } from 'react';
import { useDashboardRole } from '@/components/layout/DashboardLayout';
import { boardFormatLabel } from '@/lib/board-formats';
import {
  listMyBoardRequests, cancelBoardRequest, STAGE_META, STAGE_PATH, CANCELLABLE_STAGES,
  type BoardRequest, type RequestStage,
} from '@/lib/availability-requests';

const naira = (n: number) => '₦' + Math.round(n).toLocaleString('en-NG');
const fmtDate = (d: string) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const card: React.CSSProperties = { background: '#fff', border: '1px solid #E2E8F0', borderRadius: 12 };

type Filter = 'active' | 'all';
const DONE: RequestStage[] = ['confirmed', 'cancelled', 'unavailable'];

function StagePill({ stage }: { stage: RequestStage }) {
  const m = STAGE_META[stage];
  return (
    <span data-stage={stage} style={{ fontSize: '0.6875rem', fontWeight: 700, padding: '3px 9px', borderRadius: 999, background: m.bg, color: m.color, whiteSpace: 'nowrap' }}>
      {m.label}
    </span>
  );
}

/** Where the request sits on the main path; side stages map onto the nearest step. */
function Progress({ stage }: { stage: RequestStage }) {
  if (stage === 'cancelled' || stage === 'unavailable') return null;
  const at = STAGE_PATH.indexOf(stage === 'owner_responded' ? 'quote_received' : stage);
  return (
    <div aria-label={`Progress: ${STAGE_META[stage].label}`} style={{ display: 'flex', gap: 4, margin: '12px 0 4px' }}>
      {STAGE_PATH.map((s, i) => (
        <div key={s} style={{ flex: 1, minWidth: 0 }}>
          <div style={{ height: 4, borderRadius: 2, background: i <= at ? '#1B4F8A' : '#E2E8F0' }} />
          <p style={{ fontSize: '0.625rem', color: i <= at ? '#1B4F8A' : '#94A3B8', fontWeight: i === at ? 700 : 500, margin: '4px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {STAGE_META[s].label}
          </p>
        </div>
      ))}
    </div>
  );
}

export default function MyRequestsPage() {
  const role = useDashboardRole();
  const [requests, setRequests] = useState<BoardRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('active');
  const [busy, setBusy] = useState<string | null>(null);

  async function refresh() {
    const { requests, error } = await listMyBoardRequests();
    setRequests(requests);
    setError(error);
    setLoading(false);
  }

  useEffect(() => {
    if (role !== 'agency') return;
    (async () => { await refresh(); })();
  }, [role]);

  async function cancel(r: BoardRequest) {
    setBusy(r.id);
    const { error } = await cancelBoardRequest(r.id);
    setBusy(null);
    if (error) { setError('Could not cancel — ' + error); return; }
    await refresh();
  }

  if (role !== 'agency') {
    return <div style={{ padding: 32, color: '#64748B', fontSize: '0.875rem' }}>Requests are sent from buyer accounts.</div>;
  }

  const shown = filter === 'active' ? requests.filter(r => !DONE.includes(r.stage)) : requests;
  const activeCount = requests.filter(r => !DONE.includes(r.stage)).length;

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '8px 0 48px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
        <div>
          <h1 style={{ fontSize: '1.375rem', fontWeight: 800, color: '#0F172A', margin: '0 0 4px', letterSpacing: '-0.02em' }}>My requests</h1>
          <p style={{ fontSize: '0.875rem', color: '#64748B', margin: 0, maxWidth: 600 }}>
            Locations you&rsquo;ve asked about. Owners reply with availability and a price; our team helps you complete the booking.
          </p>
        </div>
        <a href="/marketplace" style={{ padding: '9px 16px', borderRadius: 9, background: '#1B4F8A', color: '#fff', fontSize: '0.8125rem', fontWeight: 700, textDecoration: 'none', whiteSpace: 'nowrap' }}>
          Find more locations
        </a>
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
        {([['active', `Active (${activeCount})`], ['all', `All (${requests.length})`]] as const).map(([k, text]) => (
          <button key={k} onClick={() => setFilter(k)} style={{
            padding: '6px 12px', borderRadius: 8, fontSize: '0.75rem', fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer',
            border: '1px solid ' + (filter === k ? '#1B4F8A' : '#E2E8F0'), background: filter === k ? '#EFF6FF' : '#fff', color: filter === k ? '#1B4F8A' : '#475569',
          }}>{text}</button>
        ))}
      </div>

      {error && <div style={{ ...card, padding: 14, borderColor: '#FECACA', background: '#FEF2F2', color: '#B91C1C', fontSize: '0.8125rem', marginBottom: 14 }}>{error}</div>}

      {loading ? (
        <div style={{ ...card, padding: 24, color: '#94A3B8', fontSize: '0.875rem' }}>Loading…</div>
      ) : shown.length === 0 ? (
        <div style={{ ...card, padding: '40px 24px', textAlign: 'center' }}>
          <p style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#0F172A', margin: '0 0 6px' }}>
            {requests.length === 0 ? 'No requests yet' : 'No active requests'}
          </p>
          <p style={{ fontSize: '0.8125rem', color: '#64748B', margin: '0 0 16px' }}>
            Open any board in the marketplace and press <strong>Request this location</strong>.
          </p>
          <a href="/marketplace" style={{ color: '#1B4F8A', fontWeight: 700, fontSize: '0.875rem', textDecoration: 'none' }}>Browse locations →</a>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {shown.map(r => {
            const resp = r.responses?.[0];
            const photo = r.board?.photo_urls?.[0];
            const ownerReached = (r.recipients?.length ?? 0) > 0;
            return (
              <div key={r.id} data-request={r.id} style={{ ...card, padding: 16 }}>
                <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
                  <a href={r.board_id ? `/boards/${r.board_id}` : '#'} style={{ flexShrink: 0, width: 72, height: 56, borderRadius: 8, overflow: 'hidden', background: '#0F172A', display: 'block' }}>
                    {photo && <img src={photo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />}
                  </a>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <a href={r.board_id ? `/boards/${r.board_id}` : '#'} style={{ fontSize: '0.9375rem', fontWeight: 700, color: '#0F172A', textDecoration: 'none' }}>
                        {r.board?.name ?? r.title}
                      </a>
                      <StagePill stage={r.stage} />
                    </div>
                    <p style={{ fontSize: '0.75rem', color: '#64748B', margin: '3px 0 0' }}>
                      {[r.board?.area, r.board?.city].filter(Boolean).join(', ')}{r.board?.format ? ` · ${boardFormatLabel(r.board.format)}` : ''} · {fmtDate(r.start_date)} → {fmtDate(r.end_date)}
                    </p>
                  </div>
                </div>

                <Progress stage={r.stage} />

                <div style={{ background: '#F8FAFC', borderRadius: 10, padding: '10px 12px', marginTop: 10 }}>
                  <p style={{ fontSize: '0.8125rem', color: '#334155', margin: 0, lineHeight: 1.5 }}>
                    {STAGE_META[r.stage].help}
                    {r.stage === 'requested' && !ownerReached && ' Our team is contacting the owner for you.'}
                  </p>
                  {resp && (
                    <p data-owner-reply style={{ fontSize: '0.8125rem', color: '#0F172A', margin: '6px 0 0' }}>
                      <strong>Owner&rsquo;s reply:</strong>{' '}
                      {resp.available ? 'Available' : 'Not available'}
                      {resp.available && resp.quoted_rate ? <> · <strong>{naira(resp.quoted_rate)}</strong> per month</> : null}
                      {resp.note ? <> · &ldquo;{resp.note}&rdquo;</> : null}
                    </p>
                  )}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
                  <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: 0 }}>
                    Sent {fmtDate(r.created_at)}{r.budget ? ` · budget ${naira(r.budget)}` : ''}{r.sites_needed ? ` · ${r.sites_needed} site${r.sites_needed > 1 ? 's' : ''}` : ''}
                  </p>
                  {CANCELLABLE_STAGES.includes(r.stage) && r.stage !== 'unavailable' && (
                    <button onClick={() => cancel(r)} disabled={busy === r.id} style={{ padding: '5px 12px', borderRadius: 8, border: '1px solid #E2E8F0', background: '#fff', color: '#64748B', fontSize: '0.75rem', fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer' }}>
                      {busy === r.id ? 'Cancelling…' : 'Cancel request'}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
