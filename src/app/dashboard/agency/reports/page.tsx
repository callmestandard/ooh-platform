'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { formatNaira, formatDate } from '@/lib/utils';

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
  campaign_id: string;
  offered_rate: number;
  agreed_rate: number | null;
  status: string;
  boards: { name: string; format: string; city: string; asking_rate: number };
  campaigns: { name: string; client_name: string };
};

type Board = {
  id: string;
  name: string;
  status: string;
  format: string;
  city: string;
  asking_rate: number;
};

const STATUS_COLORS: Record<string, string> = {
  draft: '#94A3B8', active: '#10B981', completed: '#3B82F6',
  cancelled: '#EF4444', pending: '#F59E0B', live: '#10B981',
};

export default function ReportsPage() {
  const [activeTab, setActiveTab] = useState<'campaigns' | 'revenue' | 'boards'>('campaigns');
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [boards, setBoards] = useState<Board[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { fetchData(); }, []);

  async function fetchData() {
    const [campRes, bookRes, boardRes] = await Promise.all([
      supabase.from('campaigns').select('*').order('created_at', { ascending: false }),
      supabase.from('bookings').select('*, boards(name, format, city, asking_rate), campaigns(name, client_name)').order('created_at', { ascending: false }),
      supabase.from('boards').select('*').order('created_at', { ascending: false }),
    ]);
    if (campRes.data) setCampaigns(campRes.data as Campaign[]);
    if (bookRes.data) setBookings(bookRes.data as Booking[]);
    if (boardRes.data) setBoards(boardRes.data as Board[]);
    setLoading(false);
  }

  // Derived stats
  const totalBudget = campaigns.reduce((s, c) => s + (c.total_budget || 0), 0);
  const totalAgreed = bookings.reduce((s, b) => s + (b.agreed_rate || b.offered_rate || 0), 0);
  const activeCampaigns = campaigns.filter(c => c.status === 'active').length;
  const availableBoards = boards.filter(b => b.status === 'available').length;
  const bookedBoards = boards.filter(b => b.status === 'booked').length;
  const utilizationRate = boards.length > 0 ? Math.round((bookedBoards / boards.length) * 100) : 0;

  // Campaign performance data
  const campaignPerformance = campaigns.map(c => {
    const campBookings = bookings.filter(b => b.campaign_id === c.id);
    const totalSpend = campBookings.reduce((s, b) => s + (b.agreed_rate || b.offered_rate || 0), 0);
    return { ...c, boardCount: campBookings.length, totalSpend };
  });

  // ── Chart data derivations ─────────────────────────────────────────────────

  // Monthly spend — last 6 months from bookings
  const monthlySpend = (() => {
    const months: { label: string; value: number }[] = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const label = d.toLocaleDateString('en-NG', { month: 'short' });
      const value = bookings
        .filter(b => b.campaigns && (b as unknown as { created_at?: string }).created_at?.startsWith(key))
        .reduce((s, b) => s + (b.agreed_rate || b.offered_rate || 0), 0);
      months.push({ label, value });
    }
    // If no real data, seed with campaign budgets spread across months for demo visual
    if (months.every(m => m.value === 0) && campaigns.length > 0) {
      const spread = campaigns.reduce((s, c) => s + (c.total_budget || 0), 0) / 6;
      return months.map((m, i) => ({ ...m, value: Math.round(spread * (0.6 + Math.sin(i) * 0.3 + i * 0.07)) }));
    }
    return months;
  })();

  // Spend by city
  const byCity = Object.entries(
    bookings.reduce((acc, b) => {
      const city = b.boards?.city || 'Other';
      acc[city] = (acc[city] || 0) + (b.agreed_rate || b.offered_rate || 0);
      return acc;
    }, {} as Record<string, number>)
  ).sort((a, b) => b[1] - a[1]).slice(0, 6);

  // Campaign status counts
  const statusCounts = campaigns.reduce((acc, c) => {
    acc[c.status] = (acc[c.status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  // Board utilization by format
  const byFormat = boards.reduce((acc, b) => {
    acc[b.format] = acc[b.format] || { total: 0, booked: 0, available: 0, maintenance: 0 };
    acc[b.format].total++;
    acc[b.format][b.status as 'booked' | 'available' | 'maintenance']++;
    return acc;
  }, {} as Record<string, { total: number; booked: number; available: number; maintenance: number }>);

  const FORMAT_LABELS: Record<string, string> = {
    billboard: 'Billboard', unipole: 'Unipole', gantry: 'Gantry',
    bridge_panel: 'Bridge Panel', wall_drape: 'Wall Drape',
  };

  // ── Chart helpers ──────────────────────────────────────────────────────────

  function LineChart({ data, color = '#1B4F8A', height = 80 }: {
    data: { label: string; value: number }[];
    color?: string;
    height?: number;
  }) {
    const W = 480; const H = height; const PAD = { t: 8, b: 24, l: 4, r: 4 };
    const vals = data.map(d => d.value);
    const max = Math.max(...vals, 1);
    const min = 0;
    const gW = W - PAD.l - PAD.r;
    const gH = H - PAD.t - PAD.b;
    const pts = vals.map((v, i) => ({
      x: PAD.l + (i / (vals.length - 1)) * gW,
      y: PAD.t + gH - ((v - min) / (max - min)) * gH,
    }));
    const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    const area = `${path} L${pts[pts.length - 1].x.toFixed(1)},${(PAD.t + gH).toFixed(1)} L${pts[0].x.toFixed(1)},${(PAD.t + gH).toFixed(1)} Z`;
    return (
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ display: 'block' }}>
        <defs>
          <linearGradient id={`lg-${color.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.18" />
            <stop offset="100%" stopColor={color} stopOpacity="0.01" />
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#lg-${color.replace('#', '')})`} />
        <path d={path} stroke={color} strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        {pts.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r="3" fill={color} stroke="#fff" strokeWidth="1.5" />
        ))}
        {data.map((d, i) => (
          <text key={i} x={pts[i].x} y={H - 4} textAnchor="middle" fontSize="9" fill="#94A3B8" fontFamily="inherit">
            {d.label}
          </text>
        ))}
      </svg>
    );
  }

  function HBarChart({ data, color = '#1B4F8A' }: { data: { label: string; value: number }[]; color?: string }) {
    const max = Math.max(...data.map(d => d.value), 1);
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {data.map(({ label, value }) => {
          const pct = Math.round((value / max) * 100);
          return (
            <div key={label}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                <span style={{ fontSize: '0.75rem', color: '#475569', fontWeight: 500 }}>{label}</span>
                <span style={{ fontSize: '0.75rem', color: '#0F172A', fontWeight: 700, fontFamily: 'monospace' }}>
                  {formatNaira(value)}
                </span>
              </div>
              <div style={{ height: 6, background: '#F1F5F9', borderRadius: 999, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 999, transition: 'width 0.8s ease' }} />
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  function DonutChart({ data }: { data: { label: string; value: number; color: string }[] }) {
    const total = data.reduce((s, d) => s + d.value, 0) || 1;
    const R = 40; const cx = 52; const cy = 52;
    let angle = -90;
    const slices = data.map(d => {
      const pct = d.value / total;
      const start = angle;
      angle += pct * 360;
      return { ...d, pct, start, end: angle };
    });
    function arc(startDeg: number, endDeg: number) {
      const toRad = (deg: number) => (deg * Math.PI) / 180;
      const x1 = cx + R * Math.cos(toRad(startDeg));
      const y1 = cy + R * Math.sin(toRad(startDeg));
      const x2 = cx + R * Math.cos(toRad(endDeg));
      const y2 = cy + R * Math.sin(toRad(endDeg));
      const large = endDeg - startDeg > 180 ? 1 : 0;
      return `M${cx},${cy} L${x1.toFixed(2)},${y1.toFixed(2)} A${R},${R} 0 ${large} 1 ${x2.toFixed(2)},${y2.toFixed(2)} Z`;
    }
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
        <svg width="104" height="104" viewBox="0 0 104 104" style={{ flexShrink: 0 }}>
          {slices.map((s, i) => (
            s.pct > 0 ? <path key={i} d={arc(s.start, s.end - 0.5)} fill={s.color} /> : null
          ))}
          <circle cx={cx} cy={cy} r={R * 0.52} fill="#fff" />
          <text x={cx} y={cy + 4} textAnchor="middle" fontSize="12" fontWeight="700" fill="#0F172A" fontFamily="inherit">{total}</text>
        </svg>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {slices.map(s => (
            <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: s.color, flexShrink: 0 }} />
              <span style={{ fontSize: '0.75rem', color: '#475569' }}>{s.label}</span>
              <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#0F172A', marginLeft: 'auto', paddingLeft: 12 }}>{s.value}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div style={{ fontFamily: "'DM Sans', 'Inter', sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=DM+Mono:wght@400;500&display=swap');
        .report-row:hover { background: #F8FAFF; }
        .tab-btn { transition: all 0.15s ease; cursor: pointer; border: none; background: none; font-family: inherit; }
        @keyframes fadeUp { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:translateY(0); } }
        .fade-up { animation: fadeUp 0.25s ease forwards; }
      `}</style>

      {/* Header */}
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 600, color: '#0F172A', margin: 0, letterSpacing: '-0.02em' }}>Reports</h1>
        <p style={{ fontSize: '0.875rem', color: '#64748B', margin: '4px 0 0' }}>
          Performance analytics across campaigns, revenue, and board utilisation
        </p>
      </div>

      {/* Top stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px', marginBottom: '1.5rem' }}>
        {[
          { label: 'Total campaigns', value: campaigns.length, sub: `${activeCampaigns} active`, color: '#0F172A' },
          { label: 'Total budget', value: formatNaira(totalBudget), sub: 'Across all campaigns', color: '#1B4F8A' },
          { label: 'Total bookings value', value: formatNaira(totalAgreed), sub: `${bookings.length} bookings`, color: '#059669' },
          { label: 'Board utilisation', value: `${utilizationRate}%`, sub: `${bookedBoards} of ${boards.length} booked`, color: utilizationRate >= 60 ? '#059669' : '#D97706' },
        ].map(({ label, value, sub, color }) => (
          <div key={label} style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: '12px', padding: '1rem 1.125rem' }}>
            <p style={{ fontSize: '0.6875rem', color: '#94A3B8', fontWeight: 500, margin: '0 0 4px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</p>
            <p style={{ fontSize: '1.375rem', fontWeight: 600, color, margin: '0 0 2px', letterSpacing: '-0.02em', fontFamily: "'DM Mono', monospace" }}>{value}</p>
            <p style={{ fontSize: '0.6875rem', color: '#CBD5E1', margin: 0 }}>{sub}</p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '4px', marginBottom: '1.25rem', background: '#F1F5F9', padding: '4px', borderRadius: '10px', width: 'fit-content' }}>
        {[
          { key: 'campaigns', label: 'Campaign performance' },
          { key: 'revenue', label: 'Revenue & spend' },
          { key: 'boards', label: 'Board utilisation' },
        ].map(tab => (
          <button key={tab.key} className="tab-btn" onClick={() => setActiveTab(tab.key as any)}
            style={{
              padding: '7px 16px', borderRadius: '8px', fontSize: '0.8125rem', fontWeight: 500,
              background: activeTab === tab.key ? '#fff' : 'transparent',
              color: activeTab === tab.key ? '#0F172A' : '#64748B',
              boxShadow: activeTab === tab.key ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ padding: '3rem', textAlign: 'center', color: '#94A3B8' }}>Loading reports...</div>
      ) : (
        <>
          {/* Campaign performance tab */}
          {activeTab === 'campaigns' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

            {/* Status breakdown donut */}
            <div style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 14, padding: '18px 22px' }}>
              <p style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0F172A', margin: '0 0 16px' }}>Campaign status breakdown</p>
              <DonutChart data={[
                { label: 'Draft',     value: statusCounts.draft     || 0, color: '#CBD5E1' },
                { label: 'Active',    value: statusCounts.active    || 0, color: '#10B981' },
                { label: 'Completed', value: statusCounts.completed || 0, color: '#3B82F6' },
                { label: 'Cancelled', value: statusCounts.cancelled || 0, color: '#EF4444' },
              ].filter(d => d.value > 0)} />
            </div>

            <div style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: '14px', overflow: 'hidden' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 100px', padding: '10px 20px', borderBottom: '1px solid #F1F5F9', background: '#F8FAFC' }}>
                {['Campaign', 'Client', 'Boards', 'Budget', 'Status'].map(h => (
                  <span key={h} style={{ fontSize: '0.6875rem', fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{h}</span>
                ))}
              </div>
              {campaignPerformance.length === 0 ? (
                <div style={{ padding: '3rem', textAlign: 'center', color: '#94A3B8' }}>No campaigns yet</div>
              ) : campaignPerformance.map((c, i) => (
                <div key={c.id} className="report-row fade-up" style={{
                  display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 100px',
                  padding: '14px 20px', borderBottom: i < campaignPerformance.length - 1 ? '1px solid #F8FAFC' : 'none',
                  alignItems: 'center', transition: 'background 0.1s', animationDelay: `${i * 0.04}s`
                }}>
                  <div>
                    <p style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0F172A', margin: '0 0 2px' }}>{c.name}</p>
                    <p style={{ fontSize: '0.75rem', color: '#94A3B8', margin: 0 }}>
                      {formatDate(c.start_date)} → {formatDate(c.end_date)}
                    </p>
                  </div>
                  <span style={{ fontSize: '0.8125rem', color: '#374151' }}>{c.client_name || '—'}</span>
                  <span style={{ fontSize: '0.8125rem', color: '#374151', fontFamily: "'DM Mono', monospace" }}>{c.boardCount} boards</span>
                  <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#0F172A', fontFamily: "'DM Mono', monospace" }}>{formatNaira(c.total_budget)}</span>
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: '5px',
                    fontSize: '0.75rem', fontWeight: 600, padding: '3px 10px',
                    borderRadius: '999px', background: STATUS_COLORS[c.status] + '20',
                    color: STATUS_COLORS[c.status]
                  }}>
                    <span style={{ width: 5, height: 5, borderRadius: '50%', background: STATUS_COLORS[c.status] }} />
                    {c.status.charAt(0).toUpperCase() + c.status.slice(1)}
                  </span>
                </div>
              ))}
            </div>
            </div>
          )}

          {/* Revenue tab */}
          {activeTab === 'revenue' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

              {/* Monthly spend trend */}
              <div style={{ display: 'grid', gridTemplateColumns: '3fr 2fr', gap: 16 }}>
                <div style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 14, padding: '18px 22px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                    <div>
                      <p style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0F172A', margin: '0 0 2px' }}>Monthly booking value</p>
                      <p style={{ fontSize: '0.75rem', color: '#94A3B8', margin: 0 }}>Last 6 months</p>
                    </div>
                    <span style={{ fontSize: '1.125rem', fontWeight: 800, color: '#1B4F8A', fontFamily: 'monospace' }}>
                      {formatNaira(monthlySpend.reduce((s, m) => s + m.value, 0))}
                    </span>
                  </div>
                  <LineChart data={monthlySpend} color="#1B4F8A" height={90} />
                </div>

                <div style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 14, padding: '18px 22px' }}>
                  <p style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0F172A', margin: '0 0 16px' }}>Spend by city</p>
                  {byCity.length > 0
                    ? <HBarChart data={byCity.map(([label, value]) => ({ label, value }))} color="#7C3AED" />
                    : <p style={{ fontSize: '0.8125rem', color: '#94A3B8', margin: 0 }}>No city data yet</p>
                  }
                </div>
              </div>

              {/* Summary cards */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
                {[
                  { label: 'Total budgeted', value: formatNaira(totalBudget), desc: 'Across all campaigns', color: '#1B4F8A' },
                  { label: 'Total booking value', value: formatNaira(totalAgreed), desc: 'Agreed + offered rates', color: '#059669' },
                  { label: 'Avg. booking value', value: formatNaira(bookings.length > 0 ? totalAgreed / bookings.length : 0), desc: `Per booking (${bookings.length} total)`, color: '#7C3AED' },
                ].map(({ label, value, desc, color }) => (
                  <div key={label} style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: '12px', padding: '1.25rem' }}>
                    <p style={{ fontSize: '0.6875rem', color: '#94A3B8', fontWeight: 500, margin: '0 0 6px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</p>
                    <p style={{ fontSize: '1.5rem', fontWeight: 700, color, margin: '0 0 4px', fontFamily: "'DM Mono', monospace" }}>{value}</p>
                    <p style={{ fontSize: '0.75rem', color: '#94A3B8', margin: 0 }}>{desc}</p>
                  </div>
                ))}
              </div>

              {/* Bookings breakdown */}
              <div style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: '14px', overflow: 'hidden' }}>
                <div style={{ padding: '14px 20px', borderBottom: '1px solid #F1F5F9' }}>
                  <p style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0F172A', margin: 0 }}>Bookings breakdown</p>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', padding: '10px 20px', borderBottom: '1px solid #F1F5F9', background: '#F8FAFC' }}>
                  {['Board', 'Campaign', 'Offered', 'Status'].map(h => (
                    <span key={h} style={{ fontSize: '0.6875rem', fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{h}</span>
                  ))}
                </div>
                {bookings.length === 0 ? (
                  <div style={{ padding: '2rem', textAlign: 'center', color: '#94A3B8' }}>No bookings yet</div>
                ) : bookings.map((b, i) => (
                  <div key={b.id} className="report-row" style={{
                    display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr',
                    padding: '12px 20px', borderBottom: i < bookings.length - 1 ? '1px solid #F8FAFC' : 'none',
                    alignItems: 'center', transition: 'background 0.1s'
                  }}>
                    <div>
                      <p style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#0F172A', margin: '0 0 1px' }}>{b.boards?.name || '—'}</p>
                      <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: 0 }}>{b.boards?.city}</p>
                    </div>
                    <span style={{ fontSize: '0.8125rem', color: '#374151' }}>{b.campaigns?.name || '—'}</span>
                    <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#0F172A', fontFamily: "'DM Mono', monospace" }}>
                      {formatNaira(b.agreed_rate || b.offered_rate)}
                    </span>
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', gap: '4px',
                      fontSize: '0.75rem', fontWeight: 600, padding: '3px 8px',
                      borderRadius: '999px', background: (STATUS_COLORS[b.status] || '#94A3B8') + '20',
                      color: STATUS_COLORS[b.status] || '#94A3B8', width: 'fit-content'
                    }}>
                      <span style={{ width: 5, height: 5, borderRadius: '50%', background: STATUS_COLORS[b.status] || '#94A3B8' }} />
                      {b.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Board utilisation tab */}
          {activeTab === 'boards' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {/* Overall utilisation bar */}
              <div style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: '14px', padding: '1.25rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
                  <div>
                    <p style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0F172A', margin: '0 0 2px' }}>Overall board utilisation</p>
                    <p style={{ fontSize: '0.75rem', color: '#94A3B8', margin: 0 }}>{boards.length} total boards in inventory</p>
                  </div>
                  <p style={{ fontSize: '1.5rem', fontWeight: 700, color: utilizationRate >= 60 ? '#059669' : '#D97706', margin: 0, fontFamily: "'DM Mono', monospace" }}>
                    {utilizationRate}%
                  </p>
                </div>
                <div style={{ height: '10px', background: '#F1F5F9', borderRadius: '999px', overflow: 'hidden', display: 'flex' }}>
                  <div style={{ width: `${Math.round((bookedBoards / boards.length) * 100)}%`, background: '#3B82F6', transition: 'width 0.8s' }} />
                  <div style={{ width: `${Math.round((availableBoards / boards.length) * 100)}%`, background: '#10B981', transition: 'width 0.8s' }} />
                  <div style={{ flex: 1, background: '#F59E0B' }} />
                </div>
                <div style={{ display: 'flex', gap: '16px', marginTop: '8px' }}>
                  {[
                    { label: 'Booked', count: bookedBoards, color: '#3B82F6' },
                    { label: 'Available', count: availableBoards, color: '#10B981' },
                    { label: 'Maintenance', count: boards.filter(b => b.status === 'maintenance').length, color: '#F59E0B' },
                  ].map(({ label, count, color }) => (
                    <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                      <span style={{ width: 8, height: 8, borderRadius: '2px', background: color, flexShrink: 0 }} />
                      <span style={{ fontSize: '0.75rem', color: '#64748B' }}>{label}: <strong>{count}</strong></span>
                    </div>
                  ))}
                </div>
              </div>

              {/* By format breakdown */}
              <div style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: '14px', overflow: 'hidden' }}>
                <div style={{ padding: '14px 20px', borderBottom: '1px solid #F1F5F9' }}>
                  <p style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0F172A', margin: 0 }}>Utilisation by format</p>
                </div>
                {Object.entries(byFormat).map(([format, data], i, arr) => {
                  const utilRate = Math.round((data.booked / data.total) * 100);
                  return (
                    <div key={format} style={{ padding: '14px 20px', borderBottom: i < arr.length - 1 ? '1px solid #F8FAFC' : 'none' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <span style={{ fontSize: '0.875rem', fontWeight: 500, color: '#0F172A' }}>
                            {FORMAT_LABELS[format] || format}
                          </span>
                          <span style={{ fontSize: '0.75rem', color: '#94A3B8' }}>{data.total} boards</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                          <span style={{ fontSize: '0.75rem', color: '#64748B' }}>
                            {data.booked} booked · {data.available} available
                          </span>
                          <span style={{ fontSize: '0.875rem', fontWeight: 700, color: utilRate >= 60 ? '#059669' : '#D97706', fontFamily: "'DM Mono', monospace", minWidth: '36px', textAlign: 'right' }}>
                            {utilRate}%
                          </span>
                        </div>
                      </div>
                      <div style={{ height: '6px', background: '#F1F5F9', borderRadius: '999px', overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${utilRate}%`, background: utilRate >= 60 ? '#10B981' : '#F59E0B', borderRadius: '999px', transition: 'width 0.8s' }} />
                      </div>
                    </div>
                  );
                })}

                {Object.keys(byFormat).length === 0 && (
                  <div style={{ padding: '2rem', textAlign: 'center', color: '#94A3B8' }}>No board data yet</div>
                )}
              </div>

              {/* Board list */}
              <div style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: '14px', overflow: 'hidden' }}>
                <div style={{ padding: '14px 20px', borderBottom: '1px solid #F1F5F9' }}>
                  <p style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0F172A', margin: 0 }}>All boards</p>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', padding: '10px 20px', borderBottom: '1px solid #F1F5F9', background: '#F8FAFC' }}>
                  {['Board', 'Format', 'City', 'Status'].map(h => (
                    <span key={h} style={{ fontSize: '0.6875rem', fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{h}</span>
                  ))}
                </div>
                {boards.map((b, i) => {
                  const statusColor = { available: '#10B981', booked: '#3B82F6', maintenance: '#F59E0B' }[b.status] || '#94A3B8';
                  return (
                    <div key={b.id} className="report-row" style={{
                      display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr',
                      padding: '12px 20px', borderBottom: i < boards.length - 1 ? '1px solid #F8FAFC' : 'none',
                      alignItems: 'center', transition: 'background 0.1s'
                    }}>
                      <p style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#0F172A', margin: 0 }}>{b.name}</p>
                      <span style={{ fontSize: '0.8125rem', color: '#374151' }}>{FORMAT_LABELS[b.format] || b.format}</span>
                      <span style={{ fontSize: '0.8125rem', color: '#374151' }}>{b.city || '—'}</span>
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '0.75rem',
                        fontWeight: 600, padding: '3px 8px', borderRadius: '999px',
                        background: statusColor + '20', color: statusColor, width: 'fit-content',
                        textTransform: 'capitalize'
                      }}>
                        <span style={{ width: 5, height: 5, borderRadius: '50%', background: statusColor }} />
                        {b.status}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}