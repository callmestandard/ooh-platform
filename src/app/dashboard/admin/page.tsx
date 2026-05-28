'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { RoleGuard } from '@/components/layout/RoleGuard';
import { supabase } from '@/lib/supabase';
import { formatNaira, formatDate } from '@/lib/utils';

// ── Types ──────────────────────────────────────────────────────────────────

type Board = {
  id: string;
  name: string;
  address: string | null;
  city: string;
  state: string | null;
  format: string;
  asking_rate: number;
  status: 'available' | 'booked' | 'maintenance';
  illuminated: boolean;
  face_count: number;
  created_at: string;
};

type Booking = {
  id: string;
  status: string;
  offered_rate: number;
  agreed_rate: number | null;
  start_date: string;
  end_date: string;
  duration_months: number | null;
  created_at: string;
  boards: { name: string; city: string; format: string } | null;
  campaigns: { name: string; client_name: string | null } | null;
};

type Campaign = {
  id: string;
  name: string;
  client_name: string | null;
  status: string;
  total_budget: number | null;
  start_date: string;
  end_date: string;
  created_at: string;
};

type ComplianceCheck = {
  id: string;
  booking_id: string;
  status: 'submitted' | 'verified' | 'flagged';
  submitted_at: string;
  notes: string | null;
};

// ── Helpers ────────────────────────────────────────────────────────────────

function timeAgo(d: string) {
  const secs = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (secs < 60) return 'Just now';
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  if (secs < 604800) return `${Math.floor(secs / 86400)}d ago`;
  return formatDate(d);
}

const FORMAT_LABELS: Record<string, string> = {
  billboard: 'Billboard', unipole: 'Unipole', gantry: 'Gantry',
  bridge_panel: 'Bridge Panel', wall_drape: 'Wall Drape',
};

const BOOKING_STATUS_CONFIG: Record<string, { bg: string; color: string; dot: string }> = {
  pending:     { bg: '#FFFBEB', color: '#92400E', dot: '#F59E0B' },
  negotiating: { bg: '#EFF6FF', color: '#1E3A8A', dot: '#3B82F6' },
  agreed:      { bg: '#F5F3FF', color: '#3730A3', dot: '#8B5CF6' },
  signed:      { bg: '#F5F3FF', color: '#3730A3', dot: '#8B5CF6' },
  live:        { bg: '#ECFDF5', color: '#065F46', dot: '#10B981' },
  completed:   { bg: '#EFF6FF', color: '#1E3A8A', dot: '#3B82F6' },
  declined:    { bg: '#FEF2F2', color: '#7F1D1D', dot: '#EF4444' },
};

function StatusPill({ status, label }: { status: string; label?: string }) {
  const cfg = BOOKING_STATUS_CONFIG[status] || { bg: '#F1F5F9', color: '#475569', dot: '#94A3B8' };
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: cfg.bg, color: cfg.color, padding: '3px 9px', borderRadius: 999, fontSize: '0.6875rem', fontWeight: 600, whiteSpace: 'nowrap' }}>
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: cfg.dot }} />
      {label || status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

// ── Stat card ─────────────────────────────────────────────────────────────

function KPICard({ label, value, sub, bar, icon }: { label: string; value: string; sub?: string; bar: string; icon: string }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: 12, padding: '18px 20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <p style={{ fontSize: '0.6875rem', fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.07em', margin: 0 }}>{label}</p>
        <span style={{ fontSize: '1.125rem' }}>{icon}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ display: 'block', width: 3, height: 28, background: bar, borderRadius: 2, flexShrink: 0 }} />
        <span style={{ fontSize: '1.875rem', fontWeight: 700, color: '#0F172A', letterSpacing: '-0.03em', fontFamily: 'monospace' }}>{value}</span>
      </div>
      {sub && <p style={{ fontSize: '0.6875rem', color: '#CBD5E1', margin: '5px 0 0' }}>{sub}</p>}
    </div>
  );
}

// ── Main content ───────────────────────────────────────────────────────────

function AdminContent() {
  const [boards, setBoards] = useState<Board[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [compliance, setCompliance] = useState<ComplianceCheck[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'overview' | 'inventory' | 'bookings' | 'users' | 'compliance' | 'revenue'>('overview');
  const searchParams = useSearchParams();

  useEffect(() => {
    const tab = searchParams.get('tab') as typeof activeTab | null;
    if (tab && ['inventory', 'bookings', 'users', 'compliance', 'revenue'].includes(tab)) {
      setActiveTab(tab);
    }
  }, [searchParams]);

  useEffect(() => { fetchAll(); }, []);

  async function fetchAll() {
    const [bRes, bookRes, campRes, compRes] = await Promise.all([
      supabase.from('boards').select('*').order('created_at', { ascending: false }),
      supabase.from('bookings').select('*, boards(name, city, format), campaigns(name, client_name)').order('created_at', { ascending: false }),
      supabase.from('campaigns').select('*').order('created_at', { ascending: false }),
      supabase.from('compliance_checks').select('*').order('submitted_at', { ascending: false }),
    ]);
    if (bRes.data) setBoards(bRes.data as Board[]);
    if (bookRes.data) setBookings(bookRes.data as unknown as Booking[]);
    if (campRes.data) setCampaigns(campRes.data as Campaign[]);
    if (compRes.data) setCompliance(compRes.data as ComplianceCheck[]);
    setLoading(false);
  }

  // ── Derived KPIs ───────────────────────────────────────────────────────
  const totalGMV = bookings
    .filter(b => b.agreed_rate && ['agreed', 'signed', 'live', 'completed'].includes(b.status))
    .reduce((s, b) => s + (b.agreed_rate || 0) * (b.duration_months || 1), 0);
  const platformCommission = Math.round(totalGMV * 0.12);

  const liveBookings = bookings.filter(b => ['live', 'agreed', 'signed'].includes(b.status));
  const pendingBookings = bookings.filter(b => ['pending', 'negotiating'].includes(b.status));
  const flaggedCompliance = compliance.filter(c => c.status === 'flagged');

  const bookedBoards = boards.filter(b => b.status === 'booked').length;
  const occupancy = boards.length > 0 ? Math.round((bookedBoards / boards.length) * 100) : 0;

  const bookingByStatus: Record<string, number> = {};
  bookings.forEach(b => { bookingByStatus[b.status] = (bookingByStatus[b.status] || 0) + 1; });

  // ── Demo users data (representative until real auth users table) ──────
  const demoUsers = [
    { name: 'Alex Okonkwo', role: 'agency', company: 'MediaPro Lagos', status: 'active', campaigns: campaigns.length, lastActive: '2h ago' },
    { name: 'MTN Nigeria',  role: 'client', company: 'MTN Nigeria',    status: 'active', campaigns: campaigns.filter(c => c.status === 'active').length, lastActive: '1d ago' },
    { name: 'Alhaji Sule',  role: 'owner',  company: 'Sule Outdoor',   status: 'active', campaigns: boards.length, lastActive: '3h ago' },
    { name: 'Bola Adeyemi', role: 'owner',  company: 'Adeyemi Signs',  status: 'active', campaigns: 0, lastActive: '5d ago' },
    { name: 'Kemi Ade',     role: 'agency', company: 'Ade Media',      status: 'inactive', campaigns: 0, lastActive: '12d ago' },
  ];

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '50vh' }}>
        <div style={{ width: 28, height: 28, border: '2px solid #E2E8F0', borderTopColor: '#DC2626', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return (
    <div style={{ fontFamily: "'Inter', -apple-system, sans-serif" }}>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeUp { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:translateY(0); } }
        .fade { animation: fadeUp 0.25s ease forwards; opacity: 0; }
        .row-hover:hover { background: #F5F8FF !important; }
      `}</style>

      {/* ── Page header ── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1.75rem' }}>
        <div>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 999, padding: '4px 12px', marginBottom: 8 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#DC2626' }} />
            <span style={{ fontSize: '0.6875rem', fontWeight: 600, color: '#991B1B', letterSpacing: '0.05em' }}>ADMIN CONTROL ROOM</span>
          </div>
          <h1 style={{ fontSize: '1.375rem', fontWeight: 700, color: '#0F172A', letterSpacing: '-0.025em', margin: '0 0 4px' }}>
            Platform Overview
          </h1>
          <p style={{ fontSize: '0.8125rem', color: '#94A3B8', margin: 0 }}>
            Real-time view of all activity across OOH Platform
          </p>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: 10, padding: '10px 16px' }}>
            <p style={{ fontSize: '0.6875rem', fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.07em', margin: '0 0 2px' }}>Platform commission (12%)</p>
            <p style={{ fontSize: '1.375rem', fontWeight: 800, color: '#DC2626', letterSpacing: '-0.03em', margin: 0, fontFamily: 'monospace' }}>{formatNaira(platformCommission)}</p>
          </div>
        </div>
      </div>

      {/* ── KPI cards ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: '1.75rem' }}>
        <KPICard label="Total Boards" value={String(boards.length)} bar="#7C3AED" sub={`${occupancy}% occupancy rate`} icon="🏗️" />
        <KPICard label="Campaigns" value={String(campaigns.length)} bar="#1B4F8A" sub={`${campaigns.filter(c => c.status === 'active').length} active`} icon="📋" />
        <KPICard label="All Bookings" value={String(bookings.length)} bar="#F59E0B" sub={`${liveBookings.length} live · ${pendingBookings.length} pending`} icon="📌" />
        <KPICard label="Total GMV" value={formatNaira(totalGMV)} bar="#10B981" sub="Gross merchandise value" icon="💰" />
        <KPICard label="Compliance Flags" value={String(flaggedCompliance.length)} bar={flaggedCompliance.length > 0 ? '#EF4444' : '#10B981'} sub={`${compliance.filter(c => c.status === 'verified').length} verified`} icon="🚩" />
      </div>

      {/* ── Alerts banner ── */}
      {(pendingBookings.length > 0 || flaggedCompliance.length > 0) && (
        <div style={{ display: 'flex', gap: 10, marginBottom: '1.25rem', flexWrap: 'wrap' }}>
          {pendingBookings.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 10, padding: '10px 16px', flex: 1 }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#D97706" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#92400E' }}>
                {pendingBookings.length} booking{pendingBookings.length !== 1 ? 's' : ''} in negotiation — monitoring
              </span>
            </div>
          )}
          {flaggedCompliance.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 10, padding: '10px 16px', flex: 1 }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#DC2626" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
              <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#991B1B' }}>
                {flaggedCompliance.length} compliance flag{flaggedCompliance.length !== 1 ? 's' : ''} need review
              </span>
              <button onClick={() => setActiveTab('compliance')} style={{ marginLeft: 'auto', fontSize: '0.75rem', fontWeight: 600, color: '#DC2626', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
                Review →
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Tabs ── */}
      <div style={{ display: 'flex', gap: 4, background: '#F1F5F9', padding: 4, borderRadius: 10, width: 'fit-content', marginBottom: '1.25rem' }}>
        {[
          { key: 'overview',   label: 'Overview' },
          { key: 'inventory',  label: `Inventory (${boards.length})` },
          { key: 'bookings',   label: `Bookings (${bookings.length})` },
          { key: 'users',      label: `Users (${demoUsers.length})` },
          { key: 'compliance', label: `Compliance (${compliance.length})`, badge: flaggedCompliance.length },
          { key: 'revenue',    label: 'Revenue' },
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key as typeof activeTab)}
            style={{
              padding: '6px 14px', borderRadius: 7, border: 'none',
              background: activeTab === tab.key ? '#fff' : 'transparent',
              color: activeTab === tab.key ? '#0F172A' : '#64748B',
              fontSize: '0.8125rem', fontWeight: activeTab === tab.key ? 600 : 400,
              cursor: 'pointer', fontFamily: 'inherit',
              boxShadow: activeTab === tab.key ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
              display: 'flex', alignItems: 'center', gap: 6,
            }}
          >
            {tab.label}
            {'badge' in tab && tab.badge ? (
              <span style={{ background: '#FEF2F2', color: '#DC2626', borderRadius: 999, padding: '0 5px', fontSize: '0.625rem', fontWeight: 700 }}>
                {tab.badge}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      {/* ═══════════════════════════════════════════════════════════════════
          TAB: OVERVIEW
      ═══════════════════════════════════════════════════════════════════ */}
      {activeTab === 'overview' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>

          {/* Booking status breakdown */}
          <div style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ padding: '14px 20px', borderBottom: '1px solid #F1F5F9' }}>
              <h2 style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#0F172A', margin: '0 0 2px' }}>Bookings by status</h2>
              <p style={{ fontSize: '0.75rem', color: '#94A3B8', margin: 0 }}>Platform-wide booking health</p>
            </div>
            <div style={{ padding: '16px 20px' }}>
              {Object.entries(BOOKING_STATUS_CONFIG).map(([status, cfg]) => {
                const count = bookingByStatus[status] || 0;
                const pct = bookings.length > 0 ? Math.round((count / bookings.length) * 100) : 0;
                return (
                  <div key={status} style={{ marginBottom: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ fontSize: '0.8125rem', color: '#374151', fontWeight: 500, textTransform: 'capitalize' }}>{status}</span>
                      <span style={{ fontSize: '0.8125rem', fontWeight: 700, color: '#0F172A', fontFamily: 'monospace' }}>{count}</span>
                    </div>
                    <div style={{ height: 6, background: '#F1F5F9', borderRadius: 999, overflow: 'hidden' }}>
                      <div style={{ height: '100%', borderRadius: 999, background: cfg.dot, width: `${pct}%`, transition: 'width 0.6s ease' }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Board inventory breakdown */}
          <div style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ padding: '14px 20px', borderBottom: '1px solid #F1F5F9' }}>
              <h2 style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#0F172A', margin: '0 0 2px' }}>Board inventory health</h2>
              <p style={{ fontSize: '0.75rem', color: '#94A3B8', margin: 0 }}>Current availability across all boards</p>
            </div>
            <div style={{ padding: '16px 20px' }}>
              {[
                { label: 'Available', count: boards.filter(b => b.status === 'available').length, color: '#10B981' },
                { label: 'Booked', count: boards.filter(b => b.status === 'booked').length, color: '#3B82F6' },
                { label: 'Maintenance', count: boards.filter(b => b.status === 'maintenance').length, color: '#F59E0B' },
              ].map(({ label, count, color }) => {
                const pct = boards.length > 0 ? Math.round((count / boards.length) * 100) : 0;
                return (
                  <div key={label} style={{ marginBottom: 16 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                      <span style={{ fontSize: '0.8125rem', color: '#374151', fontWeight: 500 }}>{label}</span>
                      <span style={{ fontSize: '0.8125rem', fontWeight: 700, color: '#0F172A', fontFamily: 'monospace' }}>{count} <span style={{ color: '#94A3B8', fontWeight: 400 }}>({pct}%)</span></span>
                    </div>
                    <div style={{ height: 8, background: '#F1F5F9', borderRadius: 999, overflow: 'hidden' }}>
                      <div style={{ height: '100%', borderRadius: 999, background: color, width: `${pct}%`, transition: 'width 0.6s ease' }} />
                    </div>
                  </div>
                );
              })}

              {/* Format breakdown */}
              <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid #F1F5F9' }}>
                <p style={{ fontSize: '0.6875rem', fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.07em', margin: '0 0 10px' }}>By format</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {Object.entries(FORMAT_LABELS).map(([key, label]) => {
                    const count = boards.filter(b => b.format === key).length;
                    if (!count) return null;
                    return (
                      <span key={key} style={{ background: '#F1F5F9', borderRadius: 6, padding: '4px 10px', fontSize: '0.75rem', fontWeight: 600, color: '#374151' }}>
                        {label} <span style={{ color: '#94A3B8' }}>{count}</span>
                      </span>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* Recent bookings */}
          <div style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ padding: '14px 20px', borderBottom: '1px solid #F1F5F9', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h2 style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#0F172A', margin: '0 0 2px' }}>Recent bookings</h2>
                <p style={{ fontSize: '0.75rem', color: '#94A3B8', margin: 0 }}>Latest activity on the platform</p>
              </div>
              <button onClick={() => setActiveTab('bookings')} style={{ fontSize: '0.75rem', fontWeight: 600, color: '#1B4F8A', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
                View all →
              </button>
            </div>
            <div>
              {bookings.slice(0, 6).map((b, i) => (
                <div key={b.id} className="row-hover fade" style={{ padding: '11px 20px', borderBottom: i < 5 ? '1px solid #F8FAFC' : 'none', display: 'flex', alignItems: 'center', gap: 12, background: '#fff', animationDelay: `${i * 0.04}s` }}>
                  <div style={{ width: 32, height: 32, borderRadius: 8, background: BOOKING_STATUS_CONFIG[b.status]?.bg || '#F1F5F9', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: BOOKING_STATUS_CONFIG[b.status]?.dot || '#94A3B8' }} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#0F172A', margin: '0 0 2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {b.boards?.name || '—'}
                    </p>
                    <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: 0 }}>{b.campaigns?.name || '—'}</p>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <p style={{ fontSize: '0.8125rem', fontWeight: 700, color: '#0F172A', margin: '0 0 2px', fontFamily: 'monospace' }}>{formatNaira(b.agreed_rate || b.offered_rate)}</p>
                    <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: 0 }}>{timeAgo(b.created_at)}</p>
                  </div>
                </div>
              ))}
              {bookings.length === 0 && (
                <div style={{ padding: '3rem', textAlign: 'center' }}>
                  <p style={{ fontSize: '0.875rem', color: '#94A3B8', margin: 0 }}>No bookings yet</p>
                </div>
              )}
            </div>
          </div>

          {/* Recent campaigns */}
          <div style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ padding: '14px 20px', borderBottom: '1px solid #F1F5F9' }}>
              <h2 style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#0F172A', margin: '0 0 2px' }}>Active campaigns</h2>
              <p style={{ fontSize: '0.75rem', color: '#94A3B8', margin: 0 }}>Live campaigns on the platform</p>
            </div>
            <div>
              {campaigns.filter(c => c.status === 'active').slice(0, 5).map((c, i) => {
                const daysLeft = Math.ceil((new Date(c.end_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
                return (
                  <div key={c.id} className="row-hover fade" style={{ padding: '12px 20px', borderBottom: '1px solid #F8FAFC', display: 'flex', alignItems: 'center', gap: 12, background: '#fff', animationDelay: `${i * 0.04}s` }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#0F172A', margin: '0 0 2px' }}>{c.name}</p>
                      <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: 0 }}>{c.client_name || '—'}</p>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      {c.total_budget && (
                        <p style={{ fontSize: '0.8125rem', fontWeight: 700, color: '#1B4F8A', margin: '0 0 2px', fontFamily: 'monospace' }}>{formatNaira(c.total_budget)}</p>
                      )}
                      <p style={{ fontSize: '0.6875rem', color: daysLeft > 14 ? '#94A3B8' : daysLeft > 0 ? '#D97706' : '#EF4444', margin: 0, fontWeight: 600 }}>
                        {daysLeft > 0 ? `${daysLeft}d left` : 'Ended'}
                      </p>
                    </div>
                  </div>
                );
              })}
              {campaigns.filter(c => c.status === 'active').length === 0 && (
                <div style={{ padding: '3rem', textAlign: 'center' }}>
                  <p style={{ fontSize: '0.875rem', color: '#94A3B8', margin: 0 }}>No active campaigns</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════
          TAB: INVENTORY
      ═══════════════════════════════════════════════════════════════════ */}
      {activeTab === 'inventory' && (
        <div style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ padding: '14px 20px', borderBottom: '1px solid #F1F5F9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <h2 style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#0F172A', margin: '0 0 2px' }}>All boards ({boards.length})</h2>
              <p style={{ fontSize: '0.75rem', color: '#94A3B8', margin: 0 }}>Full platform inventory</p>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              {['all', 'available', 'booked', 'maintenance'].map(s => (
                <button
                  key={s}
                  style={{ padding: '5px 12px', borderRadius: 6, border: '1px solid #E2E8F0', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer', background: '#fff', color: '#475569', fontFamily: 'inherit' }}
                >
                  {s.charAt(0).toUpperCase() + s.slice(1)}
                </button>
              ))}
            </div>
          </div>
          {boards.length === 0 ? (
            <div style={{ padding: '4rem', textAlign: 'center' }}>
              <p style={{ fontSize: '0.875rem', color: '#94A3B8', margin: 0 }}>No boards in the platform yet</p>
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#F8FAFC' }}>
                  {['Board', 'Location', 'Format', 'Rate', 'Status', 'Listed', 'Actions'].map(h => (
                    <th key={h} style={{ padding: '10px 16px', fontSize: '0.6875rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.07em', textAlign: 'left', borderBottom: '1px solid #F1F5F9', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {boards.map((board, i) => (
                  <tr key={board.id} className="row-hover fade" style={{ borderBottom: i < boards.length - 1 ? '1px solid #F8FAFC' : 'none', background: '#fff', animationDelay: `${i * 0.03}s` }}>
                    <td style={{ padding: '12px 16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ width: 36, height: 36, borderRadius: 8, background: '#F5F3FF', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          <span style={{ fontSize: '1rem' }}>🏗</span>
                        </div>
                        <div>
                          <p style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0F172A', margin: '0 0 2px' }}>{board.name}</p>
                          {board.address && <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: 0, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{board.address}</p>}
                        </div>
                      </div>
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: '0.8125rem', color: '#475569', whiteSpace: 'nowrap' }}>
                      {[board.city, board.state].filter(Boolean).join(', ') || '—'}
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <span style={{ fontSize: '0.6875rem', fontWeight: 600, color: '#475569', background: '#F1F5F9', padding: '2px 7px', borderRadius: 4, whiteSpace: 'nowrap' }}>
                        {FORMAT_LABELS[board.format] || board.format}
                      </span>
                    </td>
                    <td style={{ padding: '12px 16px', fontFamily: 'monospace', fontSize: '0.875rem', fontWeight: 700, color: '#0F172A', whiteSpace: 'nowrap' }}>
                      {formatNaira(board.asking_rate)}<span style={{ fontSize: '0.6875rem', fontWeight: 400, color: '#94A3B8' }}>/mo</span>
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: 5,
                        background: board.status === 'available' ? '#ECFDF5' : board.status === 'booked' ? '#EFF6FF' : '#FFFBEB',
                        color: board.status === 'available' ? '#065F46' : board.status === 'booked' ? '#1E3A8A' : '#92400E',
                        padding: '3px 9px', borderRadius: 999, fontSize: '0.6875rem', fontWeight: 600,
                      }}>
                        <span style={{ width: 5, height: 5, borderRadius: '50%', background: board.status === 'available' ? '#10B981' : board.status === 'booked' ? '#3B82F6' : '#F59E0B' }} />
                        {board.status.charAt(0).toUpperCase() + board.status.slice(1)}
                      </span>
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: '0.75rem', color: '#94A3B8', whiteSpace: 'nowrap' }}>
                      {timeAgo(board.created_at)}
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button style={{ background: '#ECFDF5', color: '#065F46', border: 'none', cursor: 'pointer', padding: '4px 10px', borderRadius: 6, fontSize: '0.6875rem', fontWeight: 600, fontFamily: 'inherit' }}>
                          Approve
                        </button>
                        <button style={{ background: '#FEF2F2', color: '#991B1B', border: 'none', cursor: 'pointer', padding: '4px 10px', borderRadius: 6, fontSize: '0.6875rem', fontWeight: 600, fontFamily: 'inherit' }}>
                          Suspend
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {boards.length > 0 && (
            <div style={{ padding: '10px 16px', borderTop: '1px solid #F1F5F9', background: '#FAFBFC', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '0.75rem', color: '#94A3B8' }}>
                {boards.length} board{boards.length !== 1 ? 's' : ''} · {boards.filter(b => b.status === 'available').length} available · {bookedBoards} booked
              </span>
              <span style={{ fontSize: '0.75rem', color: '#94A3B8' }}>
                {occupancy}% occupancy rate
              </span>
            </div>
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════
          TAB: BOOKINGS
      ═══════════════════════════════════════════════════════════════════ */}
      {activeTab === 'bookings' && (
        <div style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ padding: '14px 20px', borderBottom: '1px solid #F1F5F9' }}>
            <h2 style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#0F172A', margin: '0 0 2px' }}>All bookings ({bookings.length})</h2>
            <p style={{ fontSize: '0.75rem', color: '#94A3B8', margin: 0 }}>Every booking across the platform</p>
          </div>
          {bookings.length === 0 ? (
            <div style={{ padding: '4rem', textAlign: 'center' }}>
              <p style={{ fontSize: '0.875rem', color: '#94A3B8', margin: 0 }}>No bookings yet</p>
            </div>
          ) : (
            <>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#F8FAFC' }}>
                    {['Board', 'Campaign / Client', 'Offered rate', 'Agreed rate', 'Dates', 'Status', 'Created'].map(h => (
                      <th key={h} style={{ padding: '10px 16px', fontSize: '0.6875rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.07em', textAlign: 'left', borderBottom: '1px solid #F1F5F9', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {bookings.map((b, i) => (
                    <tr key={b.id} className="row-hover fade" style={{ borderBottom: i < bookings.length - 1 ? '1px solid #F8FAFC' : 'none', background: '#fff', animationDelay: `${i * 0.03}s` }}>
                      <td style={{ padding: '12px 16px' }}>
                        <p style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0F172A', margin: '0 0 2px' }}>{b.boards?.name || '—'}</p>
                        <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: 0 }}>{b.boards?.city || ''}</p>
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        <p style={{ fontSize: '0.8125rem', fontWeight: 500, color: '#0F172A', margin: '0 0 2px' }}>{b.campaigns?.name || '—'}</p>
                        <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: 0 }}>{b.campaigns?.client_name || '—'}</p>
                      </td>
                      <td style={{ padding: '12px 16px', fontFamily: 'monospace', fontSize: '0.8125rem', color: '#475569', whiteSpace: 'nowrap' }}>
                        {formatNaira(b.offered_rate)}<span style={{ fontSize: '0.6875rem', color: '#94A3B8' }}>/mo</span>
                      </td>
                      <td style={{ padding: '12px 16px', fontFamily: 'monospace', fontSize: '0.875rem', fontWeight: 700, color: b.agreed_rate ? '#10B981' : '#CBD5E1', whiteSpace: 'nowrap' }}>
                        {b.agreed_rate ? <>{formatNaira(b.agreed_rate)}<span style={{ fontSize: '0.6875rem', fontWeight: 400, color: '#94A3B8' }}>/mo</span></> : '—'}
                      </td>
                      <td style={{ padding: '12px 16px', fontSize: '0.75rem', color: '#475569', whiteSpace: 'nowrap' }}>
                        {b.start_date && b.end_date ? `${formatDate(b.start_date)} → ${formatDate(b.end_date)}` : '—'}
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        <StatusPill status={b.status} />
                      </td>
                      <td style={{ padding: '12px 16px', fontSize: '0.75rem', color: '#94A3B8', whiteSpace: 'nowrap' }}>
                        {timeAgo(b.created_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {/* Footer totals */}
              <div style={{ padding: '12px 20px', background: '#F8FAFC', borderTop: '2px solid #E8EDF2', display: 'flex', gap: 32 }}>
                <div>
                  <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: '0 0 2px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Total GMV</p>
                  <p style={{ fontSize: '1rem', fontWeight: 800, color: '#10B981', fontFamily: 'monospace', margin: 0 }}>{formatNaira(totalGMV)}</p>
                </div>
                <div>
                  <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: '0 0 2px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Platform commission (12%)</p>
                  <p style={{ fontSize: '1rem', fontWeight: 800, color: '#DC2626', fontFamily: 'monospace', margin: 0 }}>{formatNaira(platformCommission)}</p>
                </div>
                <div>
                  <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: '0 0 2px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Live bookings</p>
                  <p style={{ fontSize: '1rem', fontWeight: 800, color: '#1B4F8A', fontFamily: 'monospace', margin: 0 }}>{liveBookings.length}</p>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════
          TAB: USERS
      ═══════════════════════════════════════════════════════════════════ */}
      {activeTab === 'users' && (
        <div style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ padding: '14px 20px', borderBottom: '1px solid #F1F5F9', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h2 style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#0F172A', margin: '0 0 2px' }}>Platform users</h2>
              <p style={{ fontSize: '0.75rem', color: '#94A3B8', margin: 0 }}>All registered agencies, clients, and board owners</p>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              {[
                { label: 'All', count: demoUsers.length },
                { label: 'Agencies', count: demoUsers.filter(u => u.role === 'agency').length },
                { label: 'Owners', count: demoUsers.filter(u => u.role === 'owner').length },
                { label: 'Clients', count: demoUsers.filter(u => u.role === 'client').length },
              ].map(({ label, count }) => (
                <span key={label} style={{ padding: '4px 10px', borderRadius: 6, background: '#F1F5F9', fontSize: '0.75rem', fontWeight: 600, color: '#475569' }}>
                  {label} <span style={{ color: '#94A3B8' }}>({count})</span>
                </span>
              ))}
            </div>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#F8FAFC' }}>
                {['User', 'Role', 'Activity count', 'Last active', 'Status', 'Actions'].map(h => (
                  <th key={h} style={{ padding: '10px 16px', fontSize: '0.6875rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.07em', textAlign: 'left', borderBottom: '1px solid #F1F5F9', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {demoUsers.map((user, i) => {
                const roleColors: Record<string, { bg: string; color: string }> = {
                  agency: { bg: '#EFF6FF', color: '#1E3A8A' },
                  client: { bg: '#ECFDF5', color: '#065F46' },
                  owner:  { bg: '#F5F3FF', color: '#3730A3' },
                };
                const rc = roleColors[user.role] || roleColors.agency;
                return (
                  <tr key={i} className="row-hover fade" style={{ borderBottom: i < demoUsers.length - 1 ? '1px solid #F8FAFC' : 'none', background: '#fff', animationDelay: `${i * 0.05}s` }}>
                    <td style={{ padding: '12px 16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ width: 34, height: 34, borderRadius: '50%', background: rc.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', fontWeight: 700, color: rc.color, flexShrink: 0 }}>
                          {user.name.split(' ').map(n => n[0]).join('').slice(0, 2)}
                        </div>
                        <div>
                          <p style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0F172A', margin: '0 0 2px' }}>{user.name}</p>
                          <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: 0 }}>{user.company}</p>
                        </div>
                      </div>
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: rc.bg, color: rc.color, padding: '3px 9px', borderRadius: 999, fontSize: '0.6875rem', fontWeight: 600 }}>
                        {user.role.charAt(0).toUpperCase() + user.role.slice(1)}
                      </span>
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: '0.875rem', fontWeight: 700, color: '#0F172A', fontFamily: 'monospace' }}>
                      {user.campaigns} <span style={{ fontSize: '0.75rem', fontWeight: 400, color: '#94A3B8' }}>{user.role === 'owner' ? 'boards' : 'campaigns'}</span>
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: '0.8125rem', color: '#475569' }}>{user.lastActive}</td>
                    <td style={{ padding: '12px 16px' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: user.status === 'active' ? '#ECFDF5' : '#F1F5F9', color: user.status === 'active' ? '#065F46' : '#475569', padding: '3px 9px', borderRadius: 999, fontSize: '0.6875rem', fontWeight: 600 }}>
                        <span style={{ width: 5, height: 5, borderRadius: '50%', background: user.status === 'active' ? '#10B981' : '#94A3B8' }} />
                        {user.status.charAt(0).toUpperCase() + user.status.slice(1)}
                      </span>
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button style={{ background: '#F1F5F9', color: '#475569', border: 'none', cursor: 'pointer', padding: '4px 10px', borderRadius: 6, fontSize: '0.6875rem', fontWeight: 600, fontFamily: 'inherit' }}>View</button>
                        <button style={{ background: user.status === 'active' ? '#FEF2F2' : '#ECFDF5', color: user.status === 'active' ? '#991B1B' : '#065F46', border: 'none', cursor: 'pointer', padding: '4px 10px', borderRadius: 6, fontSize: '0.6875rem', fontWeight: 600, fontFamily: 'inherit' }}>
                          {user.status === 'active' ? 'Suspend' : 'Activate'}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div style={{ padding: '10px 16px', borderTop: '1px solid #F1F5F9', background: '#FAFBFC', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '0.75rem', color: '#94A3B8' }}>
              {demoUsers.length} user{demoUsers.length !== 1 ? 's' : ''} · {demoUsers.filter(u => u.status === 'active').length} active
            </span>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════
          TAB: COMPLIANCE FLAGS
      ═══════════════════════════════════════════════════════════════════ */}
      {activeTab === 'compliance' && (
        <div>
          {/* Summary pills */}
          <div style={{ display: 'flex', gap: 10, marginBottom: '1.25rem' }}>
            {[
              { label: 'Total checks', count: compliance.length, bg: '#F1F5F9', color: '#0F172A' },
              { label: 'Verified', count: compliance.filter(c => c.status === 'verified').length, bg: '#ECFDF5', color: '#065F46' },
              { label: 'Pending review', count: compliance.filter(c => c.status === 'submitted').length, bg: '#FFFBEB', color: '#92400E' },
              { label: 'Flagged', count: compliance.filter(c => c.status === 'flagged').length, bg: '#FEF2F2', color: '#991B1B' },
            ].map(pill => (
              <div key={pill.label} style={{ background: pill.bg, borderRadius: 10, padding: '10px 16px', flex: 1, textAlign: 'center' }}>
                <p style={{ fontSize: '1.25rem', fontWeight: 800, color: pill.color, fontFamily: 'monospace', margin: '0 0 2px' }}>{pill.count}</p>
                <p style={{ fontSize: '0.6875rem', fontWeight: 600, color: pill.color, opacity: 0.7, margin: 0 }}>{pill.label}</p>
              </div>
            ))}
          </div>

          <div style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ padding: '14px 20px', borderBottom: '1px solid #F1F5F9' }}>
              <h2 style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#0F172A', margin: '0 0 2px' }}>Compliance checks ({compliance.length})</h2>
              <p style={{ fontSize: '0.75rem', color: '#94A3B8', margin: 0 }}>Proof of posting submissions — flagged items require your attention</p>
            </div>
            {compliance.length === 0 ? (
              <div style={{ padding: '4rem', textAlign: 'center' }}>
                <p style={{ fontSize: '0.875rem', color: '#94A3B8', margin: 0 }}>No compliance checks yet</p>
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#F8FAFC' }}>
                    {['Booking ID', 'Status', 'Submitted', 'Notes', 'Actions'].map(h => (
                      <th key={h} style={{ padding: '10px 16px', fontSize: '0.6875rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.07em', textAlign: 'left', borderBottom: '1px solid #F1F5F9', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {compliance.sort((a, b) => (a.status === 'flagged' ? -1 : b.status === 'flagged' ? 1 : 0)).map((check, i) => (
                    <tr key={check.id} className="row-hover fade" style={{ borderBottom: i < compliance.length - 1 ? '1px solid #F8FAFC' : 'none', background: check.status === 'flagged' ? '#FFF7F7' : '#fff', animationDelay: `${i * 0.03}s` }}>
                      <td style={{ padding: '12px 16px', fontSize: '0.8125rem', fontFamily: 'monospace', color: '#475569' }}>
                        {check.booking_id.slice(0, 8)}...
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', gap: 5,
                          background: check.status === 'verified' ? '#ECFDF5' : check.status === 'flagged' ? '#FEF2F2' : '#FFFBEB',
                          color: check.status === 'verified' ? '#065F46' : check.status === 'flagged' ? '#991B1B' : '#92400E',
                          padding: '3px 9px', borderRadius: 999, fontSize: '0.6875rem', fontWeight: 600,
                        }}>
                          <span style={{ width: 5, height: 5, borderRadius: '50%', background: check.status === 'verified' ? '#10B981' : check.status === 'flagged' ? '#EF4444' : '#F59E0B' }} />
                          {check.status === 'submitted' ? 'Pending review' : check.status.charAt(0).toUpperCase() + check.status.slice(1)}
                        </span>
                      </td>
                      <td style={{ padding: '12px 16px', fontSize: '0.8125rem', color: '#475569', whiteSpace: 'nowrap' }}>
                        {formatDate(check.submitted_at)}
                      </td>
                      <td style={{ padding: '12px 16px', fontSize: '0.8125rem', color: check.notes ? '#0F172A' : '#94A3B8', maxWidth: 240 }}>
                        {check.notes || 'No notes'}
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        <div style={{ display: 'flex', gap: 4 }}>
                          {check.status !== 'verified' && (
                            <button style={{ background: '#ECFDF5', color: '#065F46', border: 'none', cursor: 'pointer', padding: '4px 10px', borderRadius: 6, fontSize: '0.6875rem', fontWeight: 600, fontFamily: 'inherit' }}>
                              Verify
                            </button>
                          )}
                          {check.status !== 'flagged' && (
                            <button style={{ background: '#FEF2F2', color: '#991B1B', border: 'none', cursor: 'pointer', padding: '4px 10px', borderRadius: 6, fontSize: '0.6875rem', fontWeight: 600, fontFamily: 'inherit' }}>
                              Flag
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════
          TAB: REVENUE
      ═══════════════════════════════════════════════════════════════════ */}
      {activeTab === 'revenue' && (
        <div>
          {/* Revenue KPIs */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: '1.5rem' }}>
            <div style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: 12, padding: '20px' }}>
              <p style={{ fontSize: '0.6875rem', fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.07em', margin: '0 0 8px' }}>Gross Merchandise Value</p>
              <p style={{ fontSize: '2rem', fontWeight: 800, color: '#10B981', letterSpacing: '-0.03em', margin: '0 0 4px', fontFamily: 'monospace' }}>{formatNaira(totalGMV)}</p>
              <p style={{ fontSize: '0.6875rem', color: '#CBD5E1', margin: 0 }}>Total value of all agreed bookings</p>
            </div>
            <div style={{ background: '#0F172A', border: '1px solid #1E293B', borderRadius: 12, padding: '20px' }}>
              <p style={{ fontSize: '0.6875rem', fontWeight: 600, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.07em', margin: '0 0 8px' }}>Platform Revenue (12%)</p>
              <p style={{ fontSize: '2rem', fontWeight: 800, color: '#F59E0B', letterSpacing: '-0.03em', margin: '0 0 4px', fontFamily: 'monospace' }}>{formatNaira(platformCommission)}</p>
              <p style={{ fontSize: '0.6875rem', color: 'rgba(255,255,255,0.25)', margin: 0 }}>Your commission from all agreed deals</p>
            </div>
            <div style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: 12, padding: '20px' }}>
              <p style={{ fontSize: '0.6875rem', fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.07em', margin: '0 0 8px' }}>Owner Payouts (88%)</p>
              <p style={{ fontSize: '2rem', fontWeight: 800, color: '#7C3AED', letterSpacing: '-0.03em', margin: '0 0 4px', fontFamily: 'monospace' }}>{formatNaira(totalGMV - platformCommission)}</p>
              <p style={{ fontSize: '0.6875rem', color: '#CBD5E1', margin: 0 }}>Owed to board owners</p>
            </div>
          </div>

          {/* Revenue per booking */}
          <div style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ padding: '14px 20px', borderBottom: '1px solid #F1F5F9' }}>
              <h2 style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#0F172A', margin: '0 0 2px' }}>Revenue breakdown by deal</h2>
              <p style={{ fontSize: '0.75rem', color: '#94A3B8', margin: 0 }}>Commission earned per agreed booking</p>
            </div>
            {bookings.filter(b => b.agreed_rate).length === 0 ? (
              <div style={{ padding: '3rem', textAlign: 'center' }}>
                <p style={{ fontSize: '0.875rem', color: '#94A3B8', margin: 0 }}>No agreed deals yet</p>
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#F8FAFC' }}>
                    {['Deal', 'Board', 'Monthly rate', 'Duration', 'GMV', 'Commission (12%)', 'Status'].map(h => (
                      <th key={h} style={{ padding: '10px 16px', fontSize: '0.6875rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.07em', textAlign: 'left', borderBottom: '1px solid #F1F5F9', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {bookings.filter(b => b.agreed_rate).map((b, i) => {
                    const gmv = (b.agreed_rate || 0) * (b.duration_months || 1);
                    const comm = Math.round(gmv * 0.12);
                    return (
                      <tr key={b.id} className="row-hover fade" style={{ borderBottom: '1px solid #F8FAFC', background: '#fff', animationDelay: `${i * 0.04}s` }}>
                        <td style={{ padding: '12px 16px', fontSize: '0.8125rem', fontWeight: 500, color: '#475569' }}>
                          {b.campaigns?.name || '—'}
                        </td>
                        <td style={{ padding: '12px 16px' }}>
                          <p style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0F172A', margin: '0 0 2px' }}>{b.boards?.name || '—'}</p>
                          <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: 0 }}>{b.boards?.city || ''}</p>
                        </td>
                        <td style={{ padding: '12px 16px', fontFamily: 'monospace', fontSize: '0.875rem', fontWeight: 700, color: '#0F172A', whiteSpace: 'nowrap' }}>
                          {formatNaira(b.agreed_rate)}<span style={{ fontSize: '0.6875rem', fontWeight: 400, color: '#94A3B8' }}>/mo</span>
                        </td>
                        <td style={{ padding: '12px 16px', fontSize: '0.8125rem', color: '#475569' }}>
                          {b.duration_months ? `${b.duration_months} mo` : '—'}
                        </td>
                        <td style={{ padding: '12px 16px', fontFamily: 'monospace', fontSize: '0.875rem', fontWeight: 700, color: '#10B981', whiteSpace: 'nowrap' }}>
                          {formatNaira(gmv)}
                        </td>
                        <td style={{ padding: '12px 16px', fontFamily: 'monospace', fontSize: '0.875rem', fontWeight: 800, color: '#F59E0B', whiteSpace: 'nowrap' }}>
                          {formatNaira(comm)}
                        </td>
                        <td style={{ padding: '12px 16px' }}>
                          <StatusPill status={b.status} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr style={{ background: '#F8FAFC', borderTop: '2px solid #E8EDF2' }}>
                    <td colSpan={4} style={{ padding: '12px 16px', fontSize: '0.8125rem', fontWeight: 700, color: '#0F172A' }}>Platform totals</td>
                    <td style={{ padding: '12px 16px', fontFamily: 'monospace', fontSize: '0.9375rem', fontWeight: 800, color: '#10B981' }}>{formatNaira(totalGMV)}</td>
                    <td style={{ padding: '12px 16px', fontFamily: 'monospace', fontSize: '0.9375rem', fontWeight: 800, color: '#F59E0B' }}>{formatNaira(platformCommission)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Page export ────────────────────────────────────────────────────────────

export default function AdminDashboardPage() {
  return (
    <RoleGuard role="admin">
      <AdminContent />
    </RoleGuard>
  );
}
