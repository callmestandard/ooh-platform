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
  notes: string | null;
  created_at: string;
  boards: {
    id: string;
    name: string;
    address: string;
    city: string;
    state: string;
    format: string;
    asking_rate: number;
    photos: string[];
  };
  campaigns: {
    id: string;
    name: string;
  };
};

const STATUS: Record<string, { label: string; dot: string; bg: string; color: string }> = {
  pending:     { label: 'Pending',     dot: '#F59E0B', bg: '#FFFBEB', color: '#92400E' },
  negotiating: { label: 'Negotiating', dot: '#3B82F6', bg: '#EFF6FF', color: '#1D4ED8' },
  agreed:      { label: 'Agreed',      dot: '#10B981', bg: '#ECFDF5', color: '#065F46' },
  signed:      { label: 'Signed',      dot: '#8B5CF6', bg: '#F5F3FF', color: '#4C1D95' },
  live:        { label: 'Live',        dot: '#10B981', bg: '#ECFDF5', color: '#065F46' },
  completed:   { label: 'Completed',   dot: '#6B7280', bg: '#F9FAFB', color: '#374151' },
  declined:    { label: 'Declined',    dot: '#EF4444', bg: '#FEF2F2', color: '#991B1B' },
};

const FORMAT_LABELS: Record<string, string> = {
  billboard: 'Billboard', unipole: 'Unipole', gantry: 'Gantry',
  bridge_panel: 'Bridge Panel', wall_drape: 'Wall Drape',
};

function formatNaira(amount?: number | null) {
  if (!amount) return '—';
  return '₦' + Number(amount).toLocaleString('en-NG');
}

function formatDate(dateStr?: string | null) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' });
}

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins  = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days  = Math.floor(diff / 86400000);
  if (mins  < 1)  return 'just now';
  if (mins  < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

const FILTERS = ['all', 'pending', 'negotiating', 'agreed', 'live', 'declined'] as const;

export default function NegotiationsPage() {
  const router = useRouter();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [filtered, setFiltered] = useState<Booking[]>([]);
  const [activeFilter, setActiveFilter] = useState<string>('all');
  const [loading, setLoading] = useState(true);

  useEffect(() => { fetchBookings(); }, []);
  useEffect(() => {
    setFiltered(activeFilter === 'all' ? bookings : bookings.filter(b => b.status === activeFilter));
  }, [bookings, activeFilter]);

  async function fetchBookings() {
    const { data, error } = await supabase
      .from('bookings')
      .select(`*, boards (id, name, address, city, state, format, asking_rate, photos), campaigns (id, name)`)
      .order('created_at', { ascending: false });
    if (error) console.error(error);
    else setBookings((data as Booking[]) || []);
    setLoading(false);
  }

  const stats = {
    total:       bookings.length,
    pending:     bookings.filter(b => b.status === 'pending').length,
    negotiating: bookings.filter(b => b.status === 'negotiating').length,
    closed:      bookings.filter(b => ['agreed', 'signed', 'live'].includes(b.status)).length,
  };

  return (
    <div style={{ fontFamily: "'DM Sans','Inter',sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=DM+Mono:wght@400;500&display=swap');
        .nego-row { transition: background 0.12s ease, box-shadow 0.12s ease; cursor: pointer; }
        .nego-row:hover { background: #F5F8FF !important; }
        .nego-row:hover .open-arrow { opacity: 1 !important; transform: translateX(0) !important; }
        .open-arrow { opacity: 0; transform: translateX(-4px); transition: all 0.15s ease; }
        .filter-btn { transition: all 0.12s ease; cursor: pointer; border: none; }
        .stat-card { transition: transform 0.15s ease, box-shadow 0.15s ease; }
        .stat-card:hover { transform: translateY(-2px); box-shadow: 0 8px 24px rgba(0,0,0,0.07) !important; }
        @keyframes fadeUp { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }
        .fade-up { animation: fadeUp 0.28s ease forwards; }
      `}</style>

      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1.75rem' }}>
        <div>
          <h1 style={{ fontSize: '1.375rem', fontWeight: 700, color: '#0F172A', margin: 0, letterSpacing: '-0.025em' }}>
            Negotiations
          </h1>
          <p style={{ fontSize: '0.8125rem', color: '#94A3B8', margin: '4px 0 0', fontWeight: 400 }}>
            {bookings.length} deal{bookings.length !== 1 ? 's' : ''} · {new Set(bookings.map(b => b.campaigns?.id).filter(Boolean)).size} campaign{new Set(bookings.map(b => b.campaigns?.id).filter(Boolean)).size !== 1 ? 's' : ''}
          </p>
        </div>
        <button
          onClick={() => router.push('/dashboard/agency/boards-map')}
          style={{
            display: 'flex', alignItems: 'center', gap: '7px',
            background: '#1B4F8A', color: '#fff', border: 'none',
            padding: '10px 18px', borderRadius: '10px', fontSize: '0.8125rem',
            fontWeight: 600, cursor: 'pointer', letterSpacing: '0.01em', fontFamily: 'inherit',
            transition: 'background 0.15s',
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = '#163f6e'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = '#1B4F8A'; }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          New request
        </button>
      </div>

      {/* ── Stats ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '1.5rem' }}>
        {[
          { label: 'Total', value: stats.total, icon: '📋', accent: '#0F172A', sub: 'All deals' },
          { label: 'Awaiting', value: stats.pending, icon: '⏳', accent: '#D97706', sub: 'Need follow-up' },
          { label: 'Active', value: stats.negotiating, icon: '💬', accent: '#2563EB', sub: 'In negotiation' },
          { label: 'Closed', value: stats.closed, icon: '🏆', accent: '#059669', sub: 'Agreed or live' },
        ].map(({ label, value, icon, accent, sub }, i) => (
          <div
            key={label}
            className="stat-card fade-up"
            style={{
              background: '#fff', border: '1px solid #E2E8F0',
              borderRadius: '14px', padding: '1.125rem 1.25rem',
              animationDelay: `${i * 0.06}s`
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 8 }}>
              <p style={{ fontSize: '0.6875rem', color: '#94A3B8', fontWeight: 600, margin: 0, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</p>
              <span style={{ fontSize: '0.875rem' }}>{icon}</span>
            </div>
            <p style={{ fontSize: '2rem', fontWeight: 700, color: accent, margin: '0 0 2px', letterSpacing: '-0.04em', fontFamily: "'DM Mono', monospace", lineHeight: 1 }}>{value}</p>
            <p style={{ fontSize: '0.6875rem', color: '#CBD5E1', margin: 0 }}>{sub}</p>
          </div>
        ))}
      </div>

      {/* ── Filter pills ── */}
      <div style={{ display: 'flex', gap: '6px', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
        {FILTERS.map(f => {
          const count = f === 'all' ? bookings.length : bookings.filter(b => b.status === f).length;
          const isActive = activeFilter === f;
          const s = f !== 'all' ? STATUS[f] : null;
          return (
            <button
              key={f}
              className="filter-btn"
              onClick={() => setActiveFilter(f)}
              style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                padding: '6px 14px', borderRadius: '999px',
                background: isActive ? '#1B4F8A' : '#F1F5F9',
                color: isActive ? '#fff' : '#64748B',
                fontSize: '0.8125rem', fontWeight: 500,
                fontFamily: 'inherit',
              }}
            >
              {s && !isActive && <span style={{ width: 6, height: 6, borderRadius: '50%', background: s.dot }} />}
              <span style={{ textTransform: 'capitalize' }}>{f === 'all' ? 'All deals' : f}</span>
              <span style={{
                background: isActive ? 'rgba(255,255,255,0.2)' : '#E2E8F0',
                color: isActive ? '#fff' : '#94A3B8',
                borderRadius: '999px', padding: '1px 7px',
                fontSize: '0.6875rem', fontWeight: 700,
              }}>{count}</span>
            </button>
          );
        })}
      </div>

      {/* ── List ── */}
      {loading ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '5rem 0' }}>
          <div style={{ width: 32, height: 32, border: '2px solid #1B4F8A', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '5rem 0' }}>
          <div style={{ width: 56, height: 56, borderRadius: '16px', background: '#F1F5F9', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', fontSize: '1.5rem' }}>📋</div>
          <p style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#334155', margin: '0 0 6px' }}>No negotiations yet</p>
          <p style={{ fontSize: '0.8125rem', color: '#94A3B8', margin: '0 0 20px' }}>
            {activeFilter === 'all' ? 'Browse boards and send your first booking request' : `No ${activeFilter} deals right now`}
          </p>
          {activeFilter === 'all' && (
            <button
              onClick={() => router.push('/dashboard/agency/boards-map')}
              style={{
                background: '#1B4F8A', color: '#fff', border: 'none',
                padding: '10px 20px', borderRadius: '10px', fontSize: '0.8125rem',
                fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit'
              }}
            >
              Explore boards
            </button>
          )}
        </div>
      ) : (
        <div style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: '16px', overflow: 'hidden' }}>
          {filtered.map((booking, i) => {
            const cfg = STATUS[booking.status] || STATUS.pending;
            const photo = booking.boards?.photos?.[0];
            const savingsPct = booking.agreed_rate && booking.boards?.asking_rate
              ? Math.round(((booking.boards.asking_rate - booking.agreed_rate) / booking.boards.asking_rate) * 100)
              : null;

            return (
              <div
                key={booking.id}
                className="nego-row fade-up"
                onClick={() => router.push(`/dashboard/agency/negotiations/${booking.id}`)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '16px',
                  padding: '14px 20px',
                  borderBottom: i < filtered.length - 1 ? '1px solid #F1F5F9' : 'none',
                  animationDelay: `${i * 0.04}s`
                }}
              >
                {/* Board thumbnail */}
                <div style={{
                  width: 52, height: 52, borderRadius: '10px', flexShrink: 0,
                  overflow: 'hidden', background: '#F1F5F9', border: '1px solid #E2E8F0',
                  position: 'relative'
                }}>
                  {photo ? (
                    <img src={photo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <div style={{ width: '100%', height: '100%', background: 'linear-gradient(135deg,#1e293b,#334155)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="1.5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14" />
                      </svg>
                    </div>
                  )}
                </div>

                {/* Board + campaign */}
                <div style={{ flex: '2', minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '3px' }}>
                    <p style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0F172A', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {booking.boards?.name || 'Unknown board'}
                    </p>
                    <span style={{
                      fontSize: '0.625rem', fontWeight: 600, color: '#64748B',
                      background: '#F1F5F9', padding: '2px 7px', borderRadius: '4px',
                      flexShrink: 0, textTransform: 'uppercase', letterSpacing: '0.04em'
                    }}>
                      {FORMAT_LABELS[booking.boards?.format] || booking.boards?.format}
                    </span>
                  </div>
                  <p style={{ fontSize: '0.75rem', color: '#94A3B8', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {booking.campaigns?.name} · {[booking.boards?.city, booking.boards?.state].filter(Boolean).join(', ')}
                  </p>
                </div>

                {/* Rate */}
                <div style={{ flex: '1', minWidth: 0 }}>
                  <p style={{ fontSize: '0.9375rem', fontWeight: 700, color: '#0F172A', margin: '0 0 2px', fontFamily: "'DM Mono', monospace", letterSpacing: '-0.02em' }}>
                    {formatNaira(booking.agreed_rate || booking.offered_rate)}
                  </p>
                  <p style={{ fontSize: '0.6875rem', color: savingsPct ? '#059669' : '#94A3B8', margin: 0, fontWeight: savingsPct ? 600 : 400 }}>
                    {savingsPct ? `↓ ${savingsPct}% saved` : `asking ${formatNaira(booking.boards?.asking_rate)}`}
                  </p>
                </div>

                {/* Dates */}
                <div style={{ flex: '1', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <p style={{ fontSize: '0.8125rem', color: '#475569', margin: 0, fontWeight: 500 }}>
                    {formatDate(booking.start_date)} → {formatDate(booking.end_date)}
                  </p>
                  <p style={{ fontSize: '0.6875rem', color: '#CBD5E1', margin: 0 }}>
                    {timeAgo(booking.created_at)}
                  </p>
                </div>

                {/* Status */}
                <div style={{ flexShrink: 0 }}>
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: '5px',
                    background: cfg.bg, color: cfg.color,
                    padding: '5px 11px', borderRadius: '999px',
                    fontSize: '0.75rem', fontWeight: 600
                  }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: cfg.dot, flexShrink: 0 }} />
                    {cfg.label}
                  </span>
                </div>

                {/* Arrow */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0, color: '#1B4F8A' }}>
                  <span style={{ fontSize: '0.6875rem', color: '#CBD5E1', fontWeight: 500 }}>Open</span>
                  <span className="open-arrow" style={{ fontSize: '1rem' }}>→</span>
                </div>
              </div>
            );
          })}
          <div style={{ padding: '10px 16px', borderTop: '1px solid #F1F5F9', background: '#FAFBFC', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '0.75rem', color: '#94A3B8' }}>
              Showing {filtered.length} of {bookings.length} deal{bookings.length !== 1 ? 's' : ''}
            </span>
            <button onClick={() => router.push('/dashboard/agency/boards-map')} style={{ fontSize: '0.75rem', fontWeight: 600, color: '#1B4F8A', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', padding: '2px 0' }}>
              + New request
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
