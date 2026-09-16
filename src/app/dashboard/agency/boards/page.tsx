'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { RoleGuard } from '@/components/layout/RoleGuard';
import { supabase } from '@/lib/supabase';

type BoardRow = {
  id: string;
  name: string;
  city: string;
  state: string | null;
  format: string;
  asking_rate: number;
  status: string;
  partner_name: string | null;
  owner_id: string | null;
};

const STATUS_CFG: Record<string, { label: string; bg: string; color: string; dot: string }> = {
  available:      { label: 'Available',      bg: '#ECFDF5', color: '#065F46', dot: '#10B981' },
  booked:         { label: 'Booked',         bg: '#EFF6FF', color: '#1D4ED8', dot: '#3B82F6' },
  unavailable:    { label: 'Unavailable',    bg: '#FFFBEB', color: '#92400E', dot: '#F59E0B' },
  decommissioned: { label: 'Decommissioned', bg: '#F1F5F9', color: '#475569', dot: '#94A3B8' },
};

const FORMAT_LABELS: Record<string, string> = {
  billboard: 'Billboard', unipole: 'Unipole', gantry: 'Gantry',
  bridge_panel: 'Bridge Panel', wall_drape: 'Wall Drape', digital: 'Digital / LED',
};

function formatNaira(n?: number | null) {
  if (!n) return '—';
  return '₦' + Number(n).toLocaleString('en-NG');
}

function BoardsListContent() {
  const router = useRouter();
  const [boards, setBoards] = useState<BoardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');

  useEffect(() => {
    supabase
      .from('boards')
      .select('id, name, city, state, format, asking_rate, status, partner_name, owner_id')
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (error) console.error('[agency/boards] fetch failed:', error.message);
        setBoards((data as BoardRow[]) || []);
        setLoading(false);
      });
  }, []);

  const filtered = statusFilter === 'all' ? boards : boards.filter(b => b.status === statusFilter);
  const counts = {
    all: boards.length,
    available: boards.filter(b => b.status === 'available').length,
    booked: boards.filter(b => b.status === 'booked').length,
    unavailable: boards.filter(b => b.status === 'unavailable').length,
    decommissioned: boards.filter(b => b.status === 'decommissioned').length,
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1.5rem', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: '1.375rem', fontWeight: 700, color: '#0F172A', letterSpacing: '-0.025em', margin: '0 0 4px' }}>
            Board inventory
          </h1>
          <p style={{ fontSize: '0.8125rem', color: '#94A3B8', margin: 0 }}>
            Boards sourced and managed directly by your agency.
          </p>
        </div>
        <button
          onClick={() => router.push('/dashboard/agency/boards/new')}
          style={{ background: '#1B4F8A', color: '#fff', border: 'none', padding: '10px 18px', borderRadius: 10, fontSize: '0.8125rem', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}
        >
          + Add board
        </button>
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
        {(['all', 'available', 'booked', 'unavailable', 'decommissioned'] as const).map(s => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            style={{
              padding: '6px 14px', borderRadius: 999, fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
              border: `1px solid ${statusFilter === s ? '#1B4F8A' : '#E2E8F0'}`,
              background: statusFilter === s ? '#1B4F8A' : '#fff',
              color: statusFilter === s ? '#fff' : '#64748B',
            }}
          >
            {s === 'all' ? 'All' : STATUS_CFG[s].label} ({counts[s]})
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ padding: '3rem', textAlign: 'center', color: '#94A3B8' }}>Loading boards…</div>
      ) : filtered.length === 0 ? (
        <div style={{ padding: '3rem', textAlign: 'center', color: '#94A3B8', background: '#fff', border: '1px solid #E2E8F0', borderRadius: 12 }}>
          No boards match this filter.
        </div>
      ) : (
        <div style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 12, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#F8FAFC' }}>
                {['Board', 'Partner', 'Location', 'Format', 'Rate', 'Status', ''].map(h => (
                  <th key={h} style={{ padding: '10px 16px', fontSize: '0.6875rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em', textAlign: 'left', borderBottom: '1px solid #F1F5F9' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((b, i) => {
                const cfg = STATUS_CFG[b.status] || STATUS_CFG.available;
                return (
                  <tr key={b.id} style={{ borderBottom: i < filtered.length - 1 ? '1px solid #F8FAFC' : 'none' }}>
                    <td style={{ padding: '12px 16px', fontSize: '0.875rem', fontWeight: 600, color: '#0F172A' }}>{b.name}</td>
                    <td style={{ padding: '12px 16px', fontSize: '0.8125rem', color: '#64748B' }}>{b.partner_name || (b.owner_id ? 'Registered owner' : '—')}</td>
                    <td style={{ padding: '12px 16px', fontSize: '0.8125rem', color: '#64748B', whiteSpace: 'nowrap' }}>{[b.city, b.state].filter(Boolean).join(', ') || '—'}</td>
                    <td style={{ padding: '12px 16px', fontSize: '0.75rem', color: '#475569' }}>{FORMAT_LABELS[b.format] || b.format}</td>
                    <td style={{ padding: '12px 16px', fontSize: '0.875rem', fontWeight: 700, color: '#0F172A', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{formatNaira(b.asking_rate)}</td>
                    <td style={{ padding: '12px 16px' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: cfg.bg, color: cfg.color, padding: '3px 9px', borderRadius: 999, fontSize: '0.6875rem', fontWeight: 600 }}>
                        <span style={{ width: 5, height: 5, borderRadius: '50%', background: cfg.dot }} />
                        {cfg.label}
                      </span>
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                      <button
                        onClick={() => router.push(`/dashboard/agency/boards/${b.id}/edit`)}
                        style={{ background: '#F1F5F9', border: 'none', cursor: 'pointer', padding: '5px 12px', borderRadius: 6, fontSize: '0.75rem', fontWeight: 600, color: '#475569', fontFamily: 'inherit' }}
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function BoardsListPage() {
  return (
    <RoleGuard role="agency">
      <BoardsListContent />
    </RoleGuard>
  );
}
