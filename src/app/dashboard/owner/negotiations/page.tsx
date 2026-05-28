'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

type Booking = {
  id: string;
  offered_rate: number;
  agreed_rate: number | null;
  status: string;
  start_date: string;
  end_date: string;
  created_at: string;
  boards: {
    id: string;
    name: string;
    city: string;
    format: string;
    asking_rate: number;
  };
  campaigns: {
    id: string;
    name: string;
    client_name: string;
  };
};

const STATUS_CONFIG: Record<string, { label: string; dot: string; bg: string; text: string }> = {
  pending:     { label: 'New request', dot: '#F59E0B', bg: '#FFFBEB', text: '#92400E' },
  negotiating: { label: 'Negotiating', dot: '#3B82F6', bg: '#EFF6FF', text: '#1E3A8A' },
  agreed:      { label: 'Agreed',      dot: '#10B981', bg: '#ECFDF5', text: '#064E3B' },
  signed:      { label: 'Signed',      dot: '#8B5CF6', bg: '#F5F3FF', text: '#3730A3' },
  live:        { label: 'Live',        dot: '#10B981', bg: '#ECFDF5', text: '#064E3B' },
  declined:    { label: 'Declined',    dot: '#EF4444', bg: '#FEF2F2', text: '#7F1D1D' },
};

const FORMAT_LABELS: Record<string, string> = {
  billboard: 'Billboard', unipole: 'Unipole', gantry: 'Gantry',
  bridge_panel: 'Bridge Panel', wall_drape: 'Wall Drape',
};

function formatNaira(n?: number | null) {
  if (!n) return '—';
  if (n >= 1_000_000) return '₦' + (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return '₦' + (n / 1_000).toFixed(0) + 'K';
  return '₦' + n.toLocaleString('en-NG');
}

function formatDate(d?: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' });
}

const FILTERS = ['all', 'pending', 'negotiating', 'agreed', 'declined'];

export default function OwnerNegotiationsPage() {
  const router = useRouter();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [activeFilter, setActiveFilter] = useState('all');
  const [loading, setLoading] = useState(true);

  useEffect(() => { fetchBookings(); }, []);

  async function fetchBookings() {
    const { data } = await supabase
      .from('bookings')
      .select('*, boards(id, name, city, format, asking_rate), campaigns(id, name, client_name)')
      .not('status', 'eq', 'declined')
      .order('created_at', { ascending: false });
    setBookings((data as Booking[]) || []);
    setLoading(false);
  }

  const filtered = activeFilter === 'all'
    ? bookings
    : bookings.filter(b => b.status === activeFilter);

  const pendingCount = bookings.filter(b => b.status === 'pending').length;

  return (
    <div style={{ fontFamily: "'Inter', -apple-system, sans-serif" }}>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeUp { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:translateY(0); } }
        .nego-row:hover { background: #F5F8FF !important; }
        .nego-row:hover .row-arrow { opacity: 1 !important; }
      `}</style>

      {/* Header */}
      <div style={{ marginBottom: '1.75rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
          <h1 style={{ fontSize: '1.375rem', fontWeight: 700, color: '#0F172A', letterSpacing: '-0.025em', margin: 0 }}>
            Negotiations
          </h1>
          {pendingCount > 0 && (
            <span style={{
              background: '#FEF2F2', color: '#7F1D1D', border: '1px solid #FECACA',
              borderRadius: '999px', padding: '2px 10px',
              fontSize: '0.75rem', fontWeight: 700,
            }}>
              {pendingCount} new
            </span>
          )}
        </div>
        <p style={{ fontSize: '0.8125rem', color: '#94A3B8', margin: 0 }}>
          Booking requests and active deals for your boards
        </p>
      </div>

      {/* Stats row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: '1.5rem' }}>
        {[
          { label: 'Total requests', value: bookings.length,                                               accent: '#0F172A' },
          { label: 'Awaiting action', value: bookings.filter(b => b.status === 'pending').length,          accent: '#D97706' },
          { label: 'Negotiating',     value: bookings.filter(b => b.status === 'negotiating').length,      accent: '#2563EB' },
          { label: 'Deals closed',    value: bookings.filter(b => ['agreed','signed','live'].includes(b.status)).length, accent: '#059669' },
        ].map(({ label, value, accent }) => (
          <div key={label} style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: '10px', padding: '14px 16px' }}>
            <p style={{ fontSize: '0.625rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.07em', margin: '0 0 6px' }}>{label}</p>
            <span style={{ fontSize: '1.625rem', fontWeight: 700, color: accent, fontFamily: 'monospace', letterSpacing: '-0.02em' }}>{value}</span>
          </div>
        ))}
      </div>

      {/* Filter pills */}
      <div style={{ display: 'flex', gap: 6, marginBottom: '1.25rem', flexWrap: 'wrap' }}>
        {FILTERS.map(f => {
          const count = f === 'all' ? bookings.length : bookings.filter(b => b.status === f).length;
          const isActive = activeFilter === f;
          return (
            <button
              key={f}
              onClick={() => setActiveFilter(f)}
              style={{
                display: 'flex', alignItems: 'center', gap: 5,
                padding: '6px 14px', borderRadius: '999px', border: 'none',
                background: isActive ? '#1B4F8A' : '#F1F5F9',
                color: isActive ? '#fff' : '#64748B',
                fontSize: '0.8125rem', fontWeight: 500,
                cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.15s',
              }}
            >
              <span style={{ textTransform: 'capitalize' }}>{f === 'pending' ? 'New requests' : f === 'all' ? 'All' : f}</span>
              <span style={{
                background: isActive ? 'rgba(255,255,255,0.25)' : '#E2E8F0',
                color: isActive ? '#fff' : '#94A3B8',
                borderRadius: '999px', padding: '0 6px',
                fontSize: '0.6875rem', fontWeight: 600,
              }}>{count}</span>
            </button>
          );
        })}
      </div>

      {/* List */}
      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '5rem 0' }}>
          <div style={{ width: 28, height: 28, border: '2px solid #E2E8F0', borderTopColor: '#1B4F8A', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '5rem 2rem', color: '#94A3B8' }}>
          <div style={{ fontSize: '2rem', marginBottom: 8 }}>📋</div>
          <p style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#64748B', margin: '0 0 4px' }}>No negotiations yet</p>
          <p style={{ fontSize: '0.8125rem', margin: 0 }}>Booking requests from agencies will appear here</p>
        </div>
      ) : (
        <div style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: '12px', overflow: 'hidden' }}>
          {/* Table header */}
          <div style={{
            display: 'grid', gridTemplateColumns: '2fr 1fr 1.2fr 1fr 80px',
            padding: '10px 20px', background: '#F8FAFC',
            borderBottom: '1px solid #F1F5F9',
          }}>
            {['Board', 'Agency / Client', 'Offered rate', 'Status', ''].map(h => (
              <span key={h} style={{ fontSize: '0.625rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{h}</span>
            ))}
          </div>

          {filtered.map((booking, i) => {
            const cfg = STATUS_CONFIG[booking.status] || STATUS_CONFIG.pending;
            const isPending = booking.status === 'pending';

            return (
              <div
                key={booking.id}
                className="nego-row"
                onClick={() => router.push(`/dashboard/owner/negotiations/${booking.id}`)}
                style={{
                  display: 'grid', gridTemplateColumns: '2fr 1fr 1.2fr 1fr 80px',
                  padding: '14px 20px', cursor: 'pointer', alignItems: 'center',
                  borderBottom: i < filtered.length - 1 ? '1px solid #F8FAFC' : 'none',
                  borderLeft: isPending ? '3px solid #F59E0B' : '3px solid transparent',
                  transition: 'background 0.1s',
                  animation: 'fadeUp 0.2s ease forwards',
                  animationDelay: `${i * 0.04}s`, opacity: 0,
                }}
              >
                {/* Board */}
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                    <span style={{ fontSize: '0.6875rem', fontWeight: 600, color: '#475569', background: '#F1F5F9', padding: '1px 6px', borderRadius: 3 }}>
                      {FORMAT_LABELS[booking.boards?.format] || booking.boards?.format || '—'}
                    </span>
                    {isPending && (
                      <span style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#92400E', background: '#FFFBEB', padding: '1px 6px', borderRadius: 3 }}>
                        NEW
                      </span>
                    )}
                  </div>
                  <p style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0F172A', margin: '0 0 2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {booking.boards?.name || '—'}
                  </p>
                  <p style={{ fontSize: '0.75rem', color: '#94A3B8', margin: 0 }}>
                    {booking.boards?.city || '—'} · {formatDate(booking.start_date)} → {formatDate(booking.end_date)}
                  </p>
                </div>

                {/* Agency / campaign */}
                <div>
                  <p style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#0F172A', margin: '0 0 2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {booking.campaigns?.client_name || '—'}
                  </p>
                  <p style={{ fontSize: '0.75rem', color: '#94A3B8', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {booking.campaigns?.name || '—'}
                  </p>
                </div>

                {/* Rate */}
                <div>
                  <p style={{ fontSize: '0.9375rem', fontWeight: 700, color: booking.agreed_rate ? '#10B981' : '#0F172A', margin: '0 0 2px', fontFamily: 'monospace' }}>
                    {formatNaira(booking.agreed_rate || booking.offered_rate)}
                    {booking.agreed_rate && <span style={{ fontSize: '0.625rem', color: '#10B981', marginLeft: 4, fontFamily: 'inherit', fontWeight: 600 }}>agreed</span>}
                  </p>
                  <p style={{ fontSize: '0.75rem', color: '#94A3B8', margin: 0 }}>
                    asking {formatNaira(booking.boards?.asking_rate)}
                  </p>
                </div>

                {/* Status */}
                <div>
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5,
                    background: cfg.bg, color: cfg.text,
                    padding: '4px 10px', borderRadius: '999px',
                    fontSize: '0.6875rem', fontWeight: 600,
                  }}>
                    <span style={{ width: 5, height: 5, borderRadius: '50%', background: cfg.dot }} />
                    {cfg.label}
                  </span>
                </div>

                {/* Arrow */}
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <span className="row-arrow" style={{ opacity: 0, color: '#1B4F8A', transition: 'opacity 0.15s', fontSize: '1rem' }}>→</span>
                </div>
              </div>
            );
          })}
          <div style={{ padding: '10px 20px', borderTop: '1px solid #F1F5F9', background: '#FAFBFC', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '0.75rem', color: '#94A3B8' }}>
              Showing {filtered.length} of {bookings.length} deal{bookings.length !== 1 ? 's' : ''}
            </span>
            <span style={{ fontSize: '0.75rem', color: '#94A3B8' }}>
              {pendingCount > 0 ? `${pendingCount} awaiting action` : 'All caught up'}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
