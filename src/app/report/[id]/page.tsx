'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';

// ── Types ──────────────────────────────────────────────────────────────────

type Campaign = {
  id: string;
  name: string;
  client_name: string | null;
  status: string;
  start_date: string;
  end_date: string;
  total_budget: number;
  objective: string | null;
  target_cities: string | null;
  plan_notes: string | null;
};

type Booking = {
  id: string;
  status: string;
  offered_rate: number;
  agreed_rate: number | null;
  start_date: string;
  end_date: string;
  duration_months: number | null;
  boards: {
    name: string;
    address: string | null;
    city: string;
    state: string | null;
    format: string;
    illuminated: boolean;
    face_count: number;
    width: number | null;
    height: number | null;
  } | null;
};

type ComplianceCheck = {
  id: string;
  booking_id: string;
  status: 'submitted' | 'verified' | 'flagged';
  submitted_at: string;
  photo_url: string | null;
  notes: string | null;
  submitted_by: string | null;
};

// ── Helpers ────────────────────────────────────────────────────────────────

function formatNaira(n: number) {
  if (n >= 1_000_000) return `₦${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `₦${(n / 1_000).toFixed(0)}K`;
  return `₦${n.toLocaleString()}`;
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' });
}

const FORMAT_LABELS: Record<string, string> = {
  billboard: 'Billboard', unipole: 'Unipole', gantry: 'Gantry',
  bridge_panel: 'Bridge Panel', wall_drape: 'Wall Drape', digital: 'Digital',
};

const OBJECTIVE_LABELS: Record<string, string> = {
  brand_awareness: 'Brand Awareness',
  product_launch: 'Product Launch',
  sales_promotion: 'Sales Promotion',
  event_promotion: 'Event Promotion',
  brand_reminder: 'Brand Reminder',
  market_expansion: 'Market Expansion',
};

const FORMAT_DAILY_IMPRESSIONS: Record<string, number> = {
  billboard: 15000, unipole: 20000, gantry: 25000,
  bridge_panel: 18000, wall_drape: 12000, digital: 30000,
};

function getDuration(start: string, end: string) {
  const days = Math.ceil((new Date(end).getTime() - new Date(start).getTime()) / 86400000);
  if (days < 7) return `${days} day${days !== 1 ? 's' : ''}`;
  const weeks = Math.round(days / 7);
  if (weeks < 5) return `${weeks} week${weeks !== 1 ? 's' : ''}`;
  const months = Math.round(days / 30);
  return `${months} month${months !== 1 ? 's' : ''}`;
}

// ── Sub-components ─────────────────────────────────────────────────────────

function KPICard({ label, value, sub, color }: { label: string; value: string; sub?: string; color: string }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: 14, padding: '20px 22px', pageBreakInside: 'avoid' }}>
      <p style={{ fontSize: '0.625rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 10px' }}>{label}</p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
        <span style={{ display: 'block', width: 3, height: 30, background: color, borderRadius: 2, flexShrink: 0 }} />
        <span style={{ fontSize: '2rem', fontWeight: 800, color: '#0F172A', letterSpacing: '-0.04em', fontFamily: 'monospace', lineHeight: 1 }}>{value}</span>
      </div>
      {sub && <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: '0 0 0 13px' }}>{sub}</p>}
    </div>
  );
}

function ComplianceBadge({ status }: { status: 'submitted' | 'verified' | 'flagged' | 'none' }) {
  const map = {
    verified: { bg: '#ECFDF5', color: '#065F46', dot: '#10B981', label: 'Verified' },
    submitted: { bg: '#FFFBEB', color: '#92400E', dot: '#F59E0B', label: 'Pending review' },
    flagged:   { bg: '#FEF2F2', color: '#7F1D1D', dot: '#EF4444', label: 'Flagged' },
    none:      { bg: '#F1F5F9', color: '#64748B', dot: '#CBD5E1', label: 'No POE' },
  };
  const cfg = map[status];
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: cfg.bg, color: cfg.color, padding: '3px 9px', borderRadius: 999, fontSize: '0.6875rem', fontWeight: 600, whiteSpace: 'nowrap' }}>
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: cfg.dot }} />
      {cfg.label}
    </span>
  );
}

function BookingStatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string; label: string }> = {
    live:        { bg: '#ECFDF5', color: '#065F46', label: 'Live' },
    agreed:      { bg: '#F5F3FF', color: '#3730A3', label: 'Agreed' },
    signed:      { bg: '#F5F3FF', color: '#3730A3', label: 'Signed' },
    completed:   { bg: '#EFF6FF', color: '#1E3A8A', label: 'Completed' },
    pending:     { bg: '#FFFBEB', color: '#92400E', label: 'Pending' },
    negotiating: { bg: '#EFF6FF', color: '#1E3A8A', label: 'Negotiating' },
    declined:    { bg: '#FEF2F2', color: '#7F1D1D', label: 'Declined' },
  };
  const cfg = map[status] || map.pending;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: cfg.bg, color: cfg.color, padding: '2px 8px', borderRadius: 999, fontSize: '0.6875rem', fontWeight: 600, whiteSpace: 'nowrap' }}>
      {cfg.label}
    </span>
  );
}

// ── Main ───────────────────────────────────────────────────────────────────

export default function CampaignReportPage() {
  const { id } = useParams();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [compliance, setCompliance] = useState<ComplianceCheck[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (id) fetchReport();
  }, [id]);

  async function fetchReport() {
    const { data: camp } = await supabase
      .from('campaigns')
      .select('id, name, client_name, status, start_date, end_date, total_budget, objective, target_cities, plan_notes')
      .eq('id', id)
      .single();

    if (!camp) { setNotFound(true); setLoading(false); return; }
    setCampaign(camp as Campaign);

    const { data: bookData } = await supabase
      .from('bookings')
      .select('id, status, offered_rate, agreed_rate, start_date, end_date, duration_months, boards(name, address, city, state, format, illuminated, face_count, width, height)')
      .eq('campaign_id', id as string)
      .order('created_at');

    const bks = (bookData as unknown as Booking[]) || [];
    setBookings(bks);

    if (bks.length > 0) {
      const { data: compData } = await supabase
        .from('compliance_checks')
        .select('*')
        .in('booking_id', bks.map(b => b.id));
      setCompliance((compData as ComplianceCheck[]) || []);
    }

    setLoading(false);
  }

  function copyLink() {
    navigator.clipboard.writeText(window.location.href).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  // ── Derived stats ──────────────────────────────────────────────────────

  const complianceMap: Record<string, ComplianceCheck> = {};
  compliance.forEach(c => { if (!complianceMap[c.booking_id]) complianceMap[c.booking_id] = c; });

  const activeBookings = bookings.filter(b => !['declined'].includes(b.status));
  const verifiedCount = compliance.filter(c => c.status === 'verified').length;
  const compRate = activeBookings.length > 0 ? Math.round((verifiedCount / activeBookings.length) * 100) : 0;
  const photosAvailable = compliance.filter(c => c.photo_url);

  const totalSpend = bookings
    .filter(b => ['agreed', 'signed', 'live', 'completed'].includes(b.status))
    .reduce((s, b) => s + (b.agreed_rate || b.offered_rate) * (b.duration_months || 1), 0);

  const estDailyImpressions = activeBookings.reduce((sum, b) => {
    return sum + (FORMAT_DAILY_IMPRESSIONS[b.boards?.format || ''] || 12000);
  }, 0);

  const campaignDays = campaign
    ? Math.ceil((new Date(campaign.end_date).getTime() - new Date(campaign.start_date).getTime()) / 86400000)
    : 0;

  const budgetUtil = campaign?.total_budget
    ? Math.min(100, Math.round((totalSpend / campaign.total_budget) * 100))
    : 0;

  // ── Loading / not found ────────────────────────────────────────────────

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#F8FAFC', fontFamily: "'Inter', sans-serif" }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ width: 32, height: 32, border: '3px solid #E2E8F0', borderTopColor: '#1B4F8A', borderRadius: '50%', animation: 'spin 0.7s linear infinite', margin: '0 auto 16px' }} />
          <p style={{ color: '#94A3B8', fontSize: '0.875rem' }}>Loading report…</p>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      </div>
    );
  }

  if (notFound || !campaign) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#F8FAFC', fontFamily: "'Inter', sans-serif" }}>
        <div style={{ textAlign: 'center', maxWidth: 360 }}>
          <div style={{ width: 56, height: 56, background: '#FEF2F2', borderRadius: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#EF4444" strokeWidth="1.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          </div>
          <p style={{ fontSize: '1rem', fontWeight: 700, color: '#0F172A', margin: '0 0 6px' }}>Report not found</p>
          <p style={{ fontSize: '0.875rem', color: '#94A3B8', margin: 0 }}>This campaign report link may be invalid or the campaign has been removed.</p>
        </div>
      </div>
    );
  }

  const generatedOn = new Date().toLocaleDateString('en-NG', { day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <div style={{ background: '#F4F6FA', minHeight: '100vh', fontFamily: "'Inter', -apple-system, sans-serif" }}>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: #fff !important; }
          .report-page { box-shadow: none !important; padding: 0 !important; }
        }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        .fade { animation: fadeUp 0.3s ease forwards; }
      `}</style>

      {/* ── Toolbar (no-print) ── */}
      <div className="no-print" style={{
        position: 'sticky', top: 0, zIndex: 50,
        background: '#0F172A', borderBottom: '1px solid rgba(255,255,255,0.06)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 24px', gap: 12,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <OOHLogo />
          <span style={{ width: 1, height: 20, background: 'rgba(255,255,255,0.12)' }} />
          <span style={{ fontSize: '0.8125rem', color: 'rgba(255,255,255,0.5)', fontWeight: 500 }}>Campaign Report</span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={copyLink}
            style={{ display: 'flex', alignItems: 'center', gap: 6, background: copied ? '#10B981' : 'rgba(255,255,255,0.08)', color: '#fff', border: '1px solid rgba(255,255,255,0.12)', padding: '7px 14px', borderRadius: 8, fontSize: '0.8125rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', transition: 'background 0.2s' }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              {copied
                ? <><polyline points="20 6 9 17 4 12"/></>
                : <><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></>
              }
            </svg>
            {copied ? 'Copied!' : 'Copy link'}
          </button>
          <button
            onClick={() => window.print()}
            style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#1B4F8A', color: '#fff', border: 'none', padding: '7px 14px', borderRadius: 8, fontSize: '0.8125rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>
            </svg>
            Print / Save PDF
          </button>
        </div>
      </div>

      {/* ── Report body ── */}
      <div className="report-page" style={{ maxWidth: 900, margin: '0 auto', padding: '32px 20px 64px' }}>

        {/* ── Cover section ── */}
        <div className="fade" style={{
          background: 'linear-gradient(135deg, #0F172A 0%, #1B4F8A 100%)',
          borderRadius: 20, padding: '40px 44px', marginBottom: 24, position: 'relative', overflow: 'hidden',
        }}>
          {/* Decorative circles */}
          <div style={{ position: 'absolute', right: -60, top: -60, width: 280, height: 280, borderRadius: '50%', background: 'rgba(255,255,255,0.03)' }} />
          <div style={{ position: 'absolute', right: 40, bottom: -80, width: 200, height: 200, borderRadius: '50%', background: 'rgba(255,255,255,0.03)' }} />

          <div style={{ position: 'relative' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 28 }}>
              <OOHLogo white />
              <span style={{ width: 1, height: 18, background: 'rgba(255,255,255,0.2)' }} />
              <span style={{ fontSize: '0.6875rem', fontWeight: 600, color: 'rgba(255,255,255,0.45)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                Campaign Performance Report
              </span>
            </div>

            <h1 style={{ fontSize: '2rem', fontWeight: 800, color: '#fff', margin: '0 0 8px', letterSpacing: '-0.03em', lineHeight: 1.2 }}>
              {campaign.name}
            </h1>
            <p style={{ fontSize: '1rem', color: 'rgba(255,255,255,0.6)', margin: '0 0 24px', fontWeight: 500 }}>
              {campaign.client_name || 'Campaign'} · {campaign.objective ? OBJECTIVE_LABELS[campaign.objective] || campaign.objective : ''}
            </p>

            <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap' }}>
              {[
                { label: 'Campaign period', value: `${formatDate(campaign.start_date)} – ${formatDate(campaign.end_date)}` },
                { label: 'Duration', value: getDuration(campaign.start_date, campaign.end_date) },
                { label: 'Report generated', value: generatedOn },
                ...(campaign.target_cities ? [{ label: 'Markets', value: campaign.target_cities }] : []),
              ].map(item => (
                <div key={item.label}>
                  <p style={{ fontSize: '0.625rem', fontWeight: 700, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.1em', margin: '0 0 4px' }}>{item.label}</p>
                  <p style={{ fontSize: '0.875rem', fontWeight: 600, color: 'rgba(255,255,255,0.85)', margin: 0 }}>{item.value}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── KPI Grid ── */}
        <div className="fade" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
          <KPICard label="Boards in plan" value={String(activeBookings.length)} sub={`${bookings.filter(b => b.status === 'live').length} currently live`} color="#1B4F8A" />
          <KPICard
            label="Compliance rate"
            value={`${compRate}%`}
            sub={`${verifiedCount} of ${activeBookings.length} verified`}
            color={compRate >= 90 ? '#10B981' : compRate >= 70 ? '#F59E0B' : '#EF4444'}
          />
          <KPICard
            label="Est. daily reach"
            value={estDailyImpressions >= 1000 ? `${(estDailyImpressions / 1000).toFixed(0)}K` : String(estDailyImpressions)}
            sub={`~${((estDailyImpressions * campaignDays) / 1_000_000).toFixed(1)}M campaign total`}
            color="#7C3AED"
          />
          <KPICard
            label="Budget utilised"
            value={`${budgetUtil}%`}
            sub={campaign.total_budget > 0 ? `${formatNaira(totalSpend)} of ${formatNaira(campaign.total_budget)}` : '—'}
            color="#F59E0B"
          />
        </div>

        {/* ── Compliance progress ── */}
        {activeBookings.length > 0 && (
          <div className="fade" style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: 14, padding: '20px 24px', marginBottom: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <div>
                <p style={{ fontSize: '0.875rem', fontWeight: 700, color: '#0F172A', margin: '0 0 2px' }}>Proof of Posting Compliance</p>
                <p style={{ fontSize: '0.75rem', color: '#94A3B8', margin: 0 }}>Verified POE submissions vs. total boards in campaign</p>
              </div>
              <span style={{ fontSize: '1.5rem', fontWeight: 800, color: compRate >= 90 ? '#10B981' : compRate >= 70 ? '#F59E0B' : '#EF4444', fontFamily: 'monospace' }}>{compRate}%</span>
            </div>
            <div style={{ height: 10, background: '#F1F5F9', borderRadius: 999, overflow: 'hidden', marginBottom: 8 }}>
              <div style={{ height: '100%', borderRadius: 999, width: `${compRate}%`, background: compRate >= 90 ? '#10B981' : compRate >= 70 ? '#F59E0B' : '#EF4444', transition: 'width 1s ease' }} />
            </div>
            <div style={{ display: 'flex', gap: 20 }}>
              {[
                { label: 'Verified', count: compliance.filter(c => c.status === 'verified').length, color: '#10B981' },
                { label: 'Pending review', count: compliance.filter(c => c.status === 'submitted').length, color: '#F59E0B' },
                { label: 'Flagged', count: compliance.filter(c => c.status === 'flagged').length, color: '#EF4444' },
                { label: 'No POE submitted', count: activeBookings.filter(b => !complianceMap[b.id]).length, color: '#CBD5E1' },
              ].map(item => item.count > 0 ? (
                <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: item.color, flexShrink: 0 }} />
                  <span style={{ fontSize: '0.75rem', color: '#475569', fontWeight: 500 }}>{item.label}: <strong style={{ color: '#0F172A' }}>{item.count}</strong></span>
                </div>
              ) : null)}
            </div>
          </div>
        )}

        {/* ── Board inventory table ── */}
        <div className="fade" style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: 14, overflow: 'hidden', marginBottom: 20 }}>
          <div style={{ padding: '16px 24px', borderBottom: '1px solid #F1F5F9', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <p style={{ fontSize: '0.9375rem', fontWeight: 700, color: '#0F172A', margin: '0 0 2px' }}>Board Inventory</p>
              <p style={{ fontSize: '0.75rem', color: '#94A3B8', margin: 0 }}>{activeBookings.length} site{activeBookings.length !== 1 ? 's' : ''} across {[...new Set(bookings.map(b => b.boards?.city).filter(Boolean))].length} market{[...new Set(bookings.map(b => b.boards?.city).filter(Boolean))].length !== 1 ? 's' : ''}</p>
            </div>
            <div style={{ display: 'flex', gap: 12 }}>
              {[
                { label: 'Live', count: bookings.filter(b => b.status === 'live').length, color: '#10B981' },
                { label: 'Agreed', count: bookings.filter(b => ['agreed','signed'].includes(b.status)).length, color: '#8B5CF6' },
                { label: 'Pending', count: bookings.filter(b => ['pending','negotiating'].includes(b.status)).length, color: '#F59E0B' },
              ].filter(s => s.count > 0).map(s => (
                <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: s.color }} />
                  <span style={{ fontSize: '0.6875rem', color: '#64748B', fontWeight: 600 }}>{s.count} {s.label}</span>
                </div>
              ))}
            </div>
          </div>

          {bookings.length === 0 ? (
            <div style={{ padding: '3rem', textAlign: 'center' }}>
              <p style={{ color: '#94A3B8', fontSize: '0.875rem', margin: 0 }}>No boards in this campaign</p>
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#F8FAFC' }}>
                    {['#', 'Board / Location', 'Format', 'Status', 'Rate', 'Compliance'].map(h => (
                      <th key={h} style={{ padding: '10px 16px', fontSize: '0.625rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.08em', textAlign: 'left', borderBottom: '1px solid #F1F5F9', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {bookings.map((b, i) => {
                    const check = complianceMap[b.id];
                    const rate = b.agreed_rate || b.offered_rate;
                    return (
                      <tr key={b.id} style={{ borderBottom: i < bookings.length - 1 ? '1px solid #F8FAFC' : 'none' }}>
                        <td style={{ padding: '12px 16px', fontSize: '0.75rem', color: '#CBD5E1', fontFamily: 'monospace', fontWeight: 600 }}>{String(i + 1).padStart(2, '0')}</td>
                        <td style={{ padding: '12px 16px' }}>
                          <p style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0F172A', margin: '0 0 2px' }}>{b.boards?.name || '—'}</p>
                          {b.boards?.address && <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: '0 0 2px', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.boards.address}</p>}
                          <p style={{ fontSize: '0.6875rem', color: '#64748B', margin: 0, fontWeight: 500 }}>
                            {[b.boards?.city, b.boards?.state].filter(Boolean).join(', ')}
                            {b.boards?.illuminated ? ' · Illuminated' : ''}
                          </p>
                        </td>
                        <td style={{ padding: '12px 16px' }}>
                          <span style={{ fontSize: '0.6875rem', fontWeight: 600, color: '#475569', background: '#F1F5F9', padding: '2px 8px', borderRadius: 4, whiteSpace: 'nowrap' }}>
                            {FORMAT_LABELS[b.boards?.format || ''] || b.boards?.format || '—'}
                          </span>
                        </td>
                        <td style={{ padding: '12px 16px' }}>
                          <BookingStatusBadge status={b.status} />
                        </td>
                        <td style={{ padding: '12px 16px', fontSize: '0.8125rem', fontWeight: 700, color: '#0F172A', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
                          {rate ? `${formatNaira(rate)}/mo` : '—'}
                        </td>
                        <td style={{ padding: '12px 16px' }}>
                          <ComplianceBadge status={check ? check.status : 'none'} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ── POE Photo Gallery ── */}
        {photosAvailable.length > 0 && (
          <div className="fade" style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: 14, overflow: 'hidden', marginBottom: 20 }}>
            <div style={{ padding: '16px 24px', borderBottom: '1px solid #F1F5F9' }}>
              <p style={{ fontSize: '0.9375rem', fontWeight: 700, color: '#0F172A', margin: '0 0 2px' }}>Proof of Posting Photos</p>
              <p style={{ fontSize: '0.75rem', color: '#94A3B8', margin: 0 }}>{photosAvailable.length} verified posting{photosAvailable.length !== 1 ? 's' : ''} with photographic evidence</p>
            </div>
            <div style={{ padding: '20px 24px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
                {photosAvailable.map(check => {
                  const booking = bookings.find(b => b.id === check.booking_id);
                  return (
                    <div key={check.id} style={{ borderRadius: 10, overflow: 'hidden', border: '1px solid #E8EDF2' }}>
                      <div style={{ position: 'relative', aspectRatio: '4/3', background: '#F1F5F9' }}>
                        <img
                          src={check.photo_url!}
                          alt={booking?.boards?.name || 'Board'}
                          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                          onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                        />
                        <span style={{
                          position: 'absolute', top: 8, right: 8,
                          background: check.status === 'verified' ? '#10B981' : check.status === 'flagged' ? '#EF4444' : '#F59E0B',
                          color: '#fff', fontSize: '0.5625rem', fontWeight: 800, padding: '2px 7px', borderRadius: 999, textTransform: 'uppercase', letterSpacing: '0.05em',
                        }}>
                          {check.status}
                        </span>
                      </div>
                      <div style={{ padding: '10px 12px' }}>
                        <p style={{ fontSize: '0.75rem', fontWeight: 600, color: '#0F172A', margin: '0 0 2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {booking?.boards?.name || 'Board'}
                        </p>
                        <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: 0 }}>
                          {booking?.boards?.city} · {new Date(check.submitted_at).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' })}
                        </p>
                        {check.submitted_by && (
                          <p style={{ fontSize: '0.625rem', color: '#CBD5E1', margin: '2px 0 0' }}>{check.submitted_by}</p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* ── Campaign notes ── */}
        {campaign.plan_notes && (
          <div className="fade" style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: 14, padding: '20px 24px', marginBottom: 20 }}>
            <p style={{ fontSize: '0.875rem', fontWeight: 700, color: '#0F172A', margin: '0 0 10px' }}>Campaign Brief</p>
            <p style={{ fontSize: '0.875rem', color: '#475569', margin: 0, lineHeight: 1.7 }}>{campaign.plan_notes}</p>
          </div>
        )}

        {/* ── Footer ── */}
        <div style={{ textAlign: 'center', padding: '20px 0 0', borderTop: '1px solid #E8EDF2', marginTop: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 6 }}>
            <OOHLogo dark />
          </div>
          <p style={{ fontSize: '0.6875rem', color: '#CBD5E1', margin: '0 0 2px' }}>
            This report was generated by OOH Platform — Nigeria's Out-of-Home Advertising Operating System
          </p>
          <p style={{ fontSize: '0.625rem', color: '#E2E8F0', margin: 0 }}>
            Report for {campaign.client_name || campaign.name} · Generated {generatedOn}
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Logo ───────────────────────────────────────────────────────────────────

function OOHLogo({ white, dark }: { white?: boolean; dark?: boolean }) {
  const text = white ? '#fff' : dark ? '#0F172A' : '#F8FAFC';
  const sub = white ? 'rgba(255,255,255,0.4)' : dark ? '#94A3B8' : 'rgba(255,255,255,0.35)';
  return (
    <svg width="110" height="26" viewBox="0 0 160 36" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="2" width="28" height="18" rx="2" fill="#1B4F8A"/>
      <rect x="3" y="5" width="22" height="12" rx="1.5" fill={dark ? '#E8EDF2' : '#0F172A'}/>
      <rect x="10" y="20" width="2.5" height="6" fill="#1B4F8A"/>
      <rect x="15.5" y="20" width="2.5" height="6" fill="#1B4F8A"/>
      <rect x="34" y="6" width="24" height="16" rx="2" fill="#1B4F8A"/>
      <rect x="37" y="9" width="18" height="10" rx="1.5" fill={dark ? '#E8EDF2' : '#0F172A'}/>
      <rect x="42" y="22" width="2.5" height="6" fill="#1B4F8A"/>
      <rect x="47.5" y="22" width="2.5" height="6" fill="#1B4F8A"/>
      <rect x="64" y="2" width="4" height="28" rx="2" fill="#1B4F8A"/>
      <rect x="80" y="2" width="4" height="28" rx="2" fill="#1B4F8A"/>
      <rect x="64" y="13" width="20" height="4" rx="1" fill="#1B4F8A"/>
      <circle cx="88" cy="4" r="3" fill="#F59E0B"/>
      <text x="98" y="20" fontFamily="Georgia, serif" fontSize="18" fontWeight="700" fill={text} letterSpacing="-0.5">OOH</text>
      <text x="99" y="30" fontFamily="Arial, sans-serif" fontSize="6.5" fontWeight="400" fill={sub} letterSpacing="3">PLATFORM</text>
    </svg>
  );
}
