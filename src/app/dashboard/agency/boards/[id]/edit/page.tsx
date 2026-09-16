'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { RoleGuard } from '@/components/layout/RoleGuard';
import { supabase } from '@/lib/supabase';
import ActivityTimeline from '@/components/activity/ActivityTimeline';
import BoardForm, { type BoardRecord } from '../../BoardForm';

type DealEntry = {
  booking_id: string;
  agreed_rate: number | null;
  offered_rate: number | null;
  status: string;
  created_at: string;
  campaign_name: string | null;
  counterCount: number;
};

function formatNaira(n?: number | null) {
  if (!n) return '—';
  return '₦' + Number(n).toLocaleString('en-NG');
}

function EditBoardContent() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [board, setBoard] = useState<BoardRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [dealHistory, setDealHistory] = useState<DealEntry[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!id) return;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase.from('boards').select('*').eq('id', id).single();
      if (error || !data) { setNotFound(true); setLoading(false); return; }
      setBoard(data as BoardRecord);

      // Negotiation history for this board, across every campaign it's ever
      // been shortlisted on — this is what makes the next negotiation start
      // from "here's what happened last time" instead of a blank slate.
      const { data: bookings } = await supabase
        .from('bookings')
        .select('id, agreed_rate, offered_rate, status, created_at, campaigns(name)')
        .eq('board_id', id)
        .order('created_at', { ascending: false })
        .limit(20);

      const rows = (bookings || []) as unknown as {
        id: string; agreed_rate: number | null; offered_rate: number | null;
        status: string; created_at: string; campaigns: { name: string } | null;
      }[];

      let counters: Record<string, number> = {};
      if (rows.length > 0) {
        const { data: msgs } = await supabase
          .from('messages')
          .select('booking_id, message_type')
          .in('booking_id', rows.map(r => r.id))
          .eq('message_type', 'counter_offer');
        counters = (msgs || []).reduce((acc: Record<string, number>, m: { booking_id: string }) => {
          acc[m.booking_id] = (acc[m.booking_id] || 0) + 1;
          return acc;
        }, {});
      }

      setDealHistory(rows.map(r => ({
        booking_id: r.id,
        agreed_rate: r.agreed_rate,
        offered_rate: r.offered_rate,
        status: r.status,
        created_at: r.created_at,
        campaign_name: r.campaigns?.name ?? null,
        counterCount: counters[r.id] || 0,
      })));
      setLoading(false);
    })();
  }, [id]);

  if (loading) {
    return <div style={{ padding: '3rem', textAlign: 'center', color: '#94A3B8' }}>Loading board…</div>;
  }
  if (notFound || !board) {
    return <div style={{ padding: '3rem', textAlign: 'center', color: '#94A3B8' }}>Board not found</div>;
  }

  const lastDeal = dealHistory.find(d => d.agreed_rate != null);

  return (
    <div style={{ display: 'flex', gap: 32, alignItems: 'flex-start', flexWrap: 'wrap' }}>
      <div style={{ flex: '1 1 480px', minWidth: 320 }}>
        <div style={{ marginBottom: '1.5rem' }}>
          <button
            onClick={() => router.push('/dashboard/agency/boards')}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8', padding: 0, fontFamily: 'inherit', fontSize: '0.8125rem', marginBottom: 8, display: 'block' }}
          >
            ← Boards
          </button>
          <h1 style={{ fontSize: '1.375rem', fontWeight: 700, color: '#0F172A', letterSpacing: '-0.025em', margin: '0 0 4px' }}>
            {board.name}
          </h1>
          <p style={{ fontSize: '0.8125rem', color: '#94A3B8', margin: 0 }}>
            Edit inventory details, update status, and review activity.
          </p>
        </div>
        <BoardForm
          board={board}
          onSaved={() => { setRefreshKey(k => k + 1); router.refresh(); }}
          onCancel={() => router.push('/dashboard/agency/boards')}
        />
      </div>

      <div style={{ width: 300, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {lastDeal && (
          <div style={{ background: '#F0FDF4', border: '1px solid #A7F3D0', borderRadius: 12, padding: '14px 16px' }}>
            <p style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#059669', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 6px' }}>
              Last negotiated rate
            </p>
            <p style={{ fontSize: '1.25rem', fontWeight: 800, color: '#065F46', margin: '0 0 4px', fontFamily: "'DM Mono', monospace" }}>
              {formatNaira(lastDeal.agreed_rate)}<span style={{ fontSize: '0.75rem', fontWeight: 500 }}>/mo</span>
            </p>
            <p style={{ fontSize: '0.75rem', color: '#065F46', margin: 0 }}>
              {lastDeal.campaign_name || 'Campaign'} · {new Date(lastDeal.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
            </p>
          </div>
        )}

        <div style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 12, padding: '14px 16px' }}>
          <p style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em', margin: 0 }}>
            Asking rate
          </p>
          <p style={{ fontSize: '1.25rem', fontWeight: 800, color: '#0F172A', margin: '4px 0 0', fontFamily: "'DM Mono', monospace" }}>
            {formatNaira(board.asking_rate)}<span style={{ fontSize: '0.75rem', fontWeight: 500, color: '#94A3B8' }}>/mo</span>
          </p>
        </div>

        {dealHistory.length > 0 && (
          <div style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 12, padding: '14px 16px' }}>
            <p style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 10px' }}>
              Negotiation history ({dealHistory.length})
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              {dealHistory.map((d, i) => (
                <button
                  key={d.booking_id}
                  onClick={() => router.push(`/dashboard/agency/negotiations/${d.booking_id}`)}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                    padding: '10px 0', borderBottom: i < dealHistory.length - 1 ? '1px solid #F1F5F9' : 'none',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                    <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#0F172A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {d.campaign_name || 'Campaign'}
                    </span>
                    <span style={{ fontSize: '0.8125rem', fontWeight: 700, color: d.agreed_rate ? '#059669' : '#94A3B8', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
                      {formatNaira(d.agreed_rate ?? d.offered_rate)}
                    </span>
                  </div>
                  <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: '2px 0 0' }}>
                    {new Date(d.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                    {d.counterCount > 0 && ` · ${d.counterCount} counter-offer${d.counterCount > 1 ? 's' : ''}`}
                    {' · '}{d.status}
                  </p>
                </button>
              ))}
            </div>
          </div>
        )}

        <ActivityTimeline entityType="board" entityId={board.id} title="Status & edit history" refreshKey={refreshKey} />
      </div>
    </div>
  );
}

export default function EditBoardPage() {
  return (
    <RoleGuard role="agency">
      <EditBoardContent />
    </RoleGuard>
  );
}
