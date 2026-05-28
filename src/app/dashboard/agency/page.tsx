'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { formatNaira, formatDateShort as formatDate } from '@/lib/utils';

type Campaign = {
  id: string;
  name: string;
  client_name: string;
  status: string;
  start_date: string;
  end_date: string;
  total_budget: number;
};

type Booking = {
  id: string;
  status: string;
  offered_rate: number;
  boards: { name: string; city: string };
  campaigns: { name: string };
};

function StatCard({ label, value, bar, sub }: { label: string; value: string; bar: string; sub?: string }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: '12px', padding: '18px 20px' }}>
      <p style={{ fontSize: '0.6875rem', fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.07em', margin: '0 0 8px' }}>{label}</p>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <span style={{ display: 'block', width: 3, height: 28, background: bar, borderRadius: 2, flexShrink: 0 }} />
        <span style={{ fontSize: '1.875rem', fontWeight: 700, color: '#0F172A', letterSpacing: '-0.03em', fontFamily: 'monospace' }}>{value}</span>
      </div>
      {sub && <p style={{ fontSize: '0.6875rem', color: '#CBD5E1', margin: '4px 0 0' }}>{sub}</p>}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string; dot: string; label: string }> = {
    live:        { bg: '#ECFDF5', color: '#065F46', dot: '#10B981', label: 'Live' },
    active:      { bg: '#ECFDF5', color: '#065F46', dot: '#10B981', label: 'Active' },
    pending:     { bg: '#FFFBEB', color: '#92400E', dot: '#F59E0B', label: 'Pending' },
    negotiating: { bg: '#EFF6FF', color: '#1E3A8A', dot: '#3B82F6', label: 'Negotiating' },
    agreed:      { bg: '#F5F3FF', color: '#3730A3', dot: '#8B5CF6', label: 'Agreed' },
    attention:   { bg: '#FFFBEB', color: '#92400E', dot: '#F59E0B', label: 'Attention' },
    draft:       { bg: '#F8FAFC', color: '#475569', dot: '#94A3B8', label: 'Draft' },
    declined:    { bg: '#FEF2F2', color: '#7F1D1D', dot: '#EF4444', label: 'Declined' },
  };
  const cfg = map[status.toLowerCase()] || map.draft;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: cfg.bg, color: cfg.color, padding: '3px 9px', borderRadius: '999px', fontSize: '0.6875rem', fontWeight: 600 }}>
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: cfg.dot }} />
      {cfg.label}
    </span>
  );
}

export default function AgencyDashboardPage() {
  const router = useRouter();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [boardCount, setBoardCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => { fetchData(); }, []);

  async function fetchData() {
    const [campRes, bookRes, boardRes] = await Promise.all([
      supabase.from('campaigns').select('*').order('created_at', { ascending: false }),
      supabase.from('bookings').select('*, boards(name, city), campaigns(name)').order('created_at', { ascending: false }).limit(5),
      supabase.from('boards').select('id', { count: 'exact', head: true }),
    ]);
    if (campRes.data) setCampaigns(campRes.data as Campaign[]);
    if (bookRes.data) setBookings(bookRes.data as unknown as Booking[]);
    if (boardRes.count !== null) setBoardCount(boardRes.count);
    setLoading(false);
  }

  const activeCampaigns = campaigns.filter(c => c.status === 'active').length;
  const totalBudget = campaigns.reduce((s, c) => s + (c.total_budget || 0), 0);
  const pendingNegotiations = bookings.filter(b => b.status === 'pending').length;

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '50vh' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ width: 32, height: 32, border: '2px solid #E2E8F0', borderTopColor: '#1B4F8A', borderRadius: '50%', animation: 'spin 0.7s linear infinite', margin: '0 auto 12px' }} />
          <p style={{ fontSize: '0.8125rem', color: '#94A3B8', margin: 0 }}>Loading dashboard...</p>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      </div>
    );
  }

  return (
    <div style={{ fontFamily: "'Inter', -apple-system, sans-serif" }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } } @keyframes fadeUp { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:translateY(0); } } .fade { animation: fadeUp 0.25s ease forwards; }`}</style>

      {/* Welcome strip */}
      <div style={{
        background: '#fff', border: '1px solid #E8EDF2', borderRadius: 16,
        padding: '18px 24px', marginBottom: '1.75rem',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
      }}>
        {/* Left: avatar + greeting */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{
            width: 46, height: 46, borderRadius: 13, flexShrink: 0,
            background: 'linear-gradient(135deg, #1B4F8A 0%, #0EA5E9 100%)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
              <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
            </svg>
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
              <h1 style={{ fontSize: '1.0625rem', fontWeight: 700, color: '#0F172A', margin: 0, letterSpacing: '-0.02em' }}>
                Agency Workspace
              </h1>
              <span style={{ fontSize: '0.625rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#1B4F8A', background: '#EFF6FF', padding: '2px 8px', borderRadius: 999 }}>
                Dashboard
              </span>
            </div>
            <p style={{ fontSize: '0.8125rem', color: '#94A3B8', margin: 0 }}>
              {new Date().toLocaleDateString('en-NG', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            </p>
          </div>
        </div>

        {/* Right: stats + action */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
            <div style={{ textAlign: 'center' }}>
              <p style={{ fontSize: '1.5rem', fontWeight: 800, color: '#1B4F8A', fontFamily: 'monospace', margin: '0 0 2px', letterSpacing: '-0.03em' }}>{activeCampaigns}</p>
              <p style={{ fontSize: '0.625rem', fontWeight: 600, color: '#94A3B8', margin: 0, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Active</p>
            </div>
            <div style={{ width: 1, height: 36, background: '#F1F5F9' }} />
            <div style={{ textAlign: 'center' }}>
              <p style={{ fontSize: '1.5rem', fontWeight: 800, color: '#10B981', fontFamily: 'monospace', margin: '0 0 2px', letterSpacing: '-0.03em' }}>{boardCount}</p>
              <p style={{ fontSize: '0.625rem', fontWeight: 600, color: '#94A3B8', margin: 0, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Boards</p>
            </div>
            <div style={{ width: 1, height: 36, background: '#F1F5F9' }} />
            <div style={{ textAlign: 'center' }}>
              <p style={{ fontSize: '1.5rem', fontWeight: 800, fontFamily: 'monospace', margin: '0 0 2px', letterSpacing: '-0.03em', color: pendingNegotiations > 0 ? '#F59E0B' : '#94A3B8' }}>{pendingNegotiations}</p>
              <p style={{ fontSize: '0.625rem', fontWeight: 600, color: '#94A3B8', margin: 0, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Pending</p>
            </div>
          </div>
          <div style={{ width: 1, height: 36, background: '#F1F5F9' }} />
          <button
            onClick={() => router.push('/dashboard/agency/campaigns')}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              background: '#1B4F8A', color: '#fff', border: 'none',
              padding: '9px 16px', borderRadius: 9,
              fontSize: '0.8125rem', fontWeight: 600, cursor: 'pointer',
              fontFamily: 'inherit', whiteSpace: 'nowrap',
            }}
          >
            <span style={{ fontSize: '1rem', lineHeight: 1 }}>+</span> New campaign
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="resp-grid-4" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '1.75rem' }}>
        <StatCard label="Active campaigns" value={String(activeCampaigns)} bar="#1B4F8A" sub={`${campaigns.length} total`} />
        <StatCard label="Boards in inventory" value={String(boardCount)} bar="#10B981" sub="Across Nigeria" />
        <StatCard label="Pending negotiations" value={String(pendingNegotiations)} bar="#F59E0B" sub="Awaiting response" />
        <StatCard label="Total budget" value={formatNaira(totalBudget)} bar="#8B5CF6" sub="All campaigns" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: '16px' }}>
        {/* Campaigns table */}
        <div className="table-scroll" style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: '12px', overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid #F1F5F9' }}>
            <div>
              <h2 style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#0F172A', margin: '0 0 2px' }}>Campaigns</h2>
              <p style={{ fontSize: '0.75rem', color: '#94A3B8', margin: 0 }}>All active client campaigns</p>
            </div>
            <button
              onClick={() => router.push('/dashboard/agency/campaigns')}
              style={{ fontSize: '0.75rem', color: '#1B4F8A', fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}
            >
              View all →
            </button>
          </div>

          {campaigns.length === 0 ? (
            <div style={{ padding: '3rem', textAlign: 'center' }}>
              <p style={{ fontSize: '0.875rem', color: '#94A3B8', margin: 0 }}>No campaigns yet</p>
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#F8FAFC' }}>
                  {['Campaign', 'Client', 'Budget', 'Dates', 'Status'].map(h => (
                    <th key={h} style={{ padding: '10px 16px', fontSize: '0.6875rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.07em', textAlign: 'left', borderBottom: '1px solid #F1F5F9', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {campaigns.slice(0, 6).map((c, i) => (
                  <tr key={c.id} className="fade" style={{ borderBottom: i < Math.min(campaigns.length, 6) - 1 ? '1px solid #F8FAFC' : 'none', animationDelay: `${i * 0.05}s`, cursor: 'pointer' }}
                    onClick={() => router.push('/dashboard/agency/campaigns')}
                    onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = '#F5F8FF'}
                    onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
                  >
                    <td style={{ padding: '12px 16px' }}>
                      <p style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#0F172A', margin: 0 }}>{c.name}</p>
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: '0.8125rem', color: '#475569' }}>{c.client_name || '—'}</td>
                    <td style={{ padding: '12px 16px', fontSize: '0.8125rem', fontWeight: 600, color: '#0F172A', fontFamily: 'monospace' }}>{formatNaira(c.total_budget)}</td>
                    <td style={{ padding: '12px 16px', fontSize: '0.75rem', color: '#94A3B8', whiteSpace: 'nowrap' }}>
                      {formatDate(c.start_date)} → {formatDate(c.end_date)}
                    </td>
                    <td style={{ padding: '12px 16px' }}><StatusPill status={c.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Right column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {/* Recent negotiations */}
          <div style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: '12px', overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: '1px solid #F1F5F9' }}>
              <h2 style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0F172A', margin: 0 }}>Recent bookings</h2>
              <button
                onClick={() => router.push('/dashboard/agency/negotiations')}
                style={{ fontSize: '0.75rem', color: '#1B4F8A', fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}
              >
                View all →
              </button>
            </div>
            {bookings.length === 0 ? (
              <div style={{ padding: '2rem', textAlign: 'center' }}>
                <p style={{ fontSize: '0.8125rem', color: '#94A3B8', margin: 0 }}>No bookings yet</p>
                <button
                  onClick={() => router.push('/dashboard/agency/boards-map')}
                  style={{ marginTop: '8px', fontSize: '0.75rem', color: '#1B4F8A', fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}
                >
                  Go to Boards Map →
                </button>
              </div>
            ) : bookings.map((b, i) => (
              <div
                key={b.id}
                onClick={() => router.push('/dashboard/agency/negotiations')}
                style={{
                  padding: '12px 16px', borderBottom: i < bookings.length - 1 ? '1px solid #F8FAFC' : 'none',
                  cursor: 'pointer', transition: 'background 0.1s',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px',
                }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = '#F5F8FF'}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
              >
                <div style={{ minWidth: 0 }}>
                  <p style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#0F172A', margin: '0 0 2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {b.boards?.name || 'Unknown board'}
                  </p>
                  <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: 0 }}>{b.campaigns?.name || '—'}</p>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <StatusPill status={b.status} />
                  <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: '3px 0 0', fontFamily: 'monospace' }}>
                    ₦{Number(b.offered_rate).toLocaleString('en-NG')}
                  </p>
                </div>
              </div>
            ))}
          </div>

          {/* Quick actions */}
          <div style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: '12px', padding: '14px 16px' }}>
            <h2 style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0F172A', margin: '0 0 12px' }}>Quick actions</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {[
                { label: 'Browse boards map', sub: 'Find & book locations', path: '/dashboard/agency/boards-map', color: '#1B4F8A' },
                { label: 'Upload compliance proof', sub: 'Submit proof of posting', path: '/dashboard/agency/compliance', color: '#10B981' },
                { label: 'View reports', sub: 'Performance analytics', path: '/dashboard/agency/reports', color: '#8B5CF6' },
              ].map(({ label, sub, path, color }) => (
                <button
                  key={path}
                  onClick={() => router.push(path)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '10px',
                    padding: '10px 12px', background: '#F8FAFC',
                    border: '1px solid #F1F5F9', borderRadius: '8px',
                    cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
                    transition: 'all 0.15s',
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = color; (e.currentTarget as HTMLElement).style.background = '#fff'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = '#F1F5F9'; (e.currentTarget as HTMLElement).style.background = '#F8FAFC'; }}
                >
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
                  <div>
                    <p style={{ fontSize: '0.8125rem', fontWeight: 500, color: '#0F172A', margin: 0 }}>{label}</p>
                    <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: 0 }}>{sub}</p>
                  </div>
                  <svg style={{ marginLeft: 'auto', color: '#CBD5E1' }} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 18 15 12 9 6"/>
                  </svg>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}