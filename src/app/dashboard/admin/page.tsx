'use client';

import { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { RoleGuard } from '@/components/layout/RoleGuard';
import { supabase } from '@/lib/supabase';
import { formatNaira, formatDate } from '@/lib/utils';
import type { ActivityEvent } from '@/lib/activity-log';

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
  owner_id: string | null;
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
  agency_id: string | null;
  created_at: string;
};

type ComplianceCheck = {
  id: string;
  booking_id: string;
  status: 'submitted' | 'verified' | 'flagged';
  submitted_at: string;
  photo_url: string | null;
  notes: string | null;
};

type Profile = {
  id: string;
  full_name: string | null;
  email: string | null;
  role: string;
  company_name: string | null;
  created_at: string;
  is_suspended?: boolean;
};

type AdminSettings = {
  commissionRate: number;
  platformName: string;
  maintenanceMode: boolean;
  alertEmail: string;
};

const DEFAULT_SETTINGS: AdminSettings = {
  commissionRate: 12,
  platformName: 'OOH Platform',
  maintenanceMode: false,
  alertEmail: '',
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

// ── Small components ───────────────────────────────────────────────────────

function StatusPill({ status, label }: { status: string; label?: string }) {
  const cfg = BOOKING_STATUS_CONFIG[status] || { bg: '#F1F5F9', color: '#475569', dot: '#94A3B8' };
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: cfg.bg, color: cfg.color, padding: '3px 9px', borderRadius: 999, fontSize: '0.6875rem', fontWeight: 600, whiteSpace: 'nowrap' }}>
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: cfg.dot }} />
      {label || status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

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

// Mini bar chart using divs
function BarChart({ data, color = '#1B4F8A', height = 80 }: { data: { label: string; value: number }[]; color?: string; height?: number }) {
  const max = Math.max(...data.map(d => d.value), 1);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height }}>
      {data.map((d, i) => (
        <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
          <div
            style={{
              width: '100%', borderRadius: '4px 4px 0 0',
              background: color,
              height: `${Math.max(4, Math.round((d.value / max) * (height - 20)))}px`,
              opacity: d.value === 0 ? 0.15 : 0.9,
              transition: 'height 0.5s ease',
            }}
            title={`${d.label}: ${d.value}`}
          />
          <span style={{ fontSize: '0.5625rem', color: '#94A3B8', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', maxWidth: '100%', textAlign: 'center' }}>{d.label}</span>
        </div>
      ))}
    </div>
  );
}

// ── Main content ───────────────────────────────────────────────────────────

type AdminTab = 'overview' | 'inventory' | 'bookings' | 'users' | 'compliance' | 'revenue' | 'analytics' | 'settings';

function AdminContent() {
  const [boards, setBoards] = useState<Board[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [compliance, setCompliance] = useState<ComplianceCheck[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [activityEvents, setActivityEvents] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [togglingUser, setTogglingUser] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<AdminTab>('overview');

  // inventory filter
  const [invFilter, setInvFilter] = useState<'all' | 'available' | 'booked' | 'maintenance'>('all');
  // bookings filter
  const [bookFilter, setBookFilter] = useState<string>('all');
  // user role filter
  const [userRoleFilter, setUserRoleFilter] = useState<'all' | 'agency' | 'client' | 'owner'>('all');
  // toast
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  // platform settings
  const [settings, setSettings] = useState<AdminSettings>(DEFAULT_SETTINGS);
  const [settingsSaved, setSettingsSaved] = useState(false);

  const searchParams = useSearchParams();

  useEffect(() => {
    const tab = searchParams.get('tab') as AdminTab | null;
    const valid: AdminTab[] = ['overview','inventory','bookings','users','compliance','revenue','analytics','settings'];
    if (tab && valid.includes(tab)) setActiveTab(tab);
  }, [searchParams]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem('ooh_admin_settings');
      if (raw) setSettings(JSON.parse(raw) as AdminSettings);
    } catch {}
  }, []);

  const showToast = useCallback((msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  useEffect(() => { fetchAll(); }, []);

  async function fetchAll() {
    try {
      const [bRes, bookRes, campRes, compRes, profRes, actRes] = await Promise.all([
        supabase.from('boards').select('id, name, address, city, state, format, asking_rate, status, illuminated, face_count, owner_id, created_at').order('created_at', { ascending: false }).limit(200),
        supabase.from('bookings').select('id, status, offered_rate, agreed_rate, start_date, end_date, duration_months, created_at, boards(name, city, format), campaigns(name, client_name)').order('created_at', { ascending: false }).limit(200),
        supabase.from('campaigns').select('id, name, client_name, status, total_budget, start_date, end_date, agency_id, created_at').order('created_at', { ascending: false }).limit(100),
        supabase.from('compliance_checks').select('id, booking_id, status, submitted_at, photo_url, notes').order('submitted_at', { ascending: false }).limit(100),
        supabase.from('profiles').select('id, role, full_name, company_name, created_at').order('created_at', { ascending: false }).limit(200),
        supabase.from('activity_events').select('id, entity_type, entity_id, campaign_id, actor_id, actor_role, actor_name, action, summary, created_at').order('created_at', { ascending: false }).limit(50),
      ]);
      if (bRes.error) throw bRes.error;
      if (bRes.data) setBoards(bRes.data as Board[]);
      if (bookRes.data) setBookings(bookRes.data as unknown as Booking[]);
      if (campRes.data) setCampaigns(campRes.data as Campaign[]);
      if (compRes.data) setCompliance(compRes.data as ComplianceCheck[]);
      if (profRes.data && profRes.data.length > 0) setProfiles(profRes.data as Profile[]);
      if (actRes.data) setActivityEvents(actRes.data as ActivityEvent[]);
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : 'Failed to load admin data');
    } finally {
      setLoading(false);
    }
  }

  async function toggleUserSuspension(profileId: string, currentlySuspended: boolean) {
    setTogglingUser(profileId);
    const { error } = await supabase
      .from('profiles')
      .update({ is_suspended: !currentlySuspended })
      .eq('id', profileId);
    if (error) {
      showToast('Failed to update user', 'error');
    } else {
      setProfiles(prev => prev.map(p => p.id === profileId ? { ...p, is_suspended: !currentlySuspended } : p));
      showToast(!currentlySuspended ? 'User suspended' : 'User reactivated');
    }
    setTogglingUser(null);
  }

  async function verifyCompliance(id: string) {
    const { error } = await supabase.from('compliance_checks').update({ status: 'verified' }).eq('id', id);
    if (error) { showToast('Failed to verify', 'error'); return; }
    setCompliance(prev => prev.map(c => c.id === id ? { ...c, status: 'verified' } : c));
    showToast('Marked as verified');
  }

  async function flagCompliance(id: string) {
    const { error } = await supabase.from('compliance_checks').update({ status: 'flagged' }).eq('id', id);
    if (error) { showToast('Failed to flag', 'error'); return; }
    setCompliance(prev => prev.map(c => c.id === id ? { ...c, status: 'flagged' } : c));
    showToast('Flagged for review');
  }

  async function toggleBoardStatus(board: Board) {
    const next = board.status === 'available' ? 'maintenance' : 'available';
    const { error } = await supabase.from('boards').update({ status: next }).eq('id', board.id);
    if (!error) {
      setBoards(prev => prev.map(b => b.id === board.id ? { ...b, status: next as Board['status'] } : b));
      showToast(`${board.name} → ${next}`);
    }
  }

  function saveSettings() {
    localStorage.setItem('ooh_admin_settings', JSON.stringify(settings));
    setSettingsSaved(true);
    setTimeout(() => setSettingsSaved(false), 2000);
    showToast('Settings saved');
  }

  // ── Derived KPIs ───────────────────────────────────────────────────────
  const commRate = settings.commissionRate / 100;
  const totalGMV = bookings
    .filter(b => b.agreed_rate && ['agreed', 'signed', 'live', 'completed'].includes(b.status))
    .reduce((s, b) => s + (b.agreed_rate || 0) * (b.duration_months || 1), 0);
  const platformCommission = Math.round(totalGMV * commRate);

  const liveBookings = bookings.filter(b => ['live', 'agreed', 'signed'].includes(b.status));
  const pendingBookings = bookings.filter(b => ['pending', 'negotiating'].includes(b.status));
  const flaggedCompliance = compliance.filter(c => c.status === 'flagged');

  const bookedBoards = boards.filter(b => b.status === 'booked').length;
  const occupancy = boards.length > 0 ? Math.round((bookedBoards / boards.length) * 100) : 0;

  const bookingByStatus: Record<string, number> = {};
  bookings.forEach(b => { bookingByStatus[b.status] = (bookingByStatus[b.status] || 0) + 1; });

  // Users: real profiles + demo fallback
  const displayUsers: { id: string; name: string; role: string; company: string; status: string; count: number; lastActive: string; email: string; is_suspended: boolean }[] =
    profiles.length > 0
      ? profiles.map(p => ({
          id: p.id,
          name: p.full_name || p.email || 'Unknown',
          role: p.role,
          company: p.company_name || '—',
          status: p.is_suspended ? 'suspended' : 'active',
          count: p.role === 'owner' ? boards.filter(b => b.owner_id === p.id).length : campaigns.filter(c => c.agency_id === p.id).length,
          lastActive: timeAgo(p.created_at),
          email: p.email || '—',
          is_suspended: !!p.is_suspended,
        }))
      : [
          { id: 'demo-1', name: 'Alex Okonkwo',  role: 'agency', company: 'MediaPro Lagos',    status: 'active',    count: campaigns.length, lastActive: '2h ago',  email: 'alex@mediapro.ng',    is_suspended: false },
          { id: 'demo-2', name: 'MTN Nigeria',   role: 'client', company: 'MTN Nigeria',        status: 'active',    count: campaigns.filter(c => c.status === 'active').length, lastActive: '1d ago', email: 'marketing@mtn.ng', is_suspended: false },
          { id: 'demo-3', name: 'Alhaji Sule',   role: 'owner',  company: 'Sule Outdoor',       status: 'active',    count: boards.length,    lastActive: '3h ago',  email: 'sule@outdoor.ng',     is_suspended: false },
          { id: 'demo-4', name: 'Bola Adeyemi',  role: 'owner',  company: 'Adeyemi Signs',      status: 'active',    count: 0,                lastActive: '5d ago',  email: 'bola@adeyemi.ng',     is_suspended: false },
          { id: 'demo-5', name: 'Kemi Ade',      role: 'agency', company: 'Ade Media',          status: 'suspended', count: 0,                lastActive: '12d ago', email: 'kemi@ademedia.ng',    is_suspended: true  },
        ];

  const filteredUsers = userRoleFilter === 'all' ? displayUsers : displayUsers.filter(u => u.role === userRoleFilter);

  // ── Analytics derivations ──────────────────────────────────────────────

  // Monthly booking volume (last 6 months)
  const monthlyBookings = (() => {
    const now = new Date();
    return Array.from({ length: 6 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
      const label = d.toLocaleDateString('en-NG', { month: 'short' });
      const value = bookings.filter(b => {
        const bd = new Date(b.created_at);
        return bd.getFullYear() === d.getFullYear() && bd.getMonth() === d.getMonth();
      }).length;
      return { label, value };
    });
  })();

  // Monthly GMV (last 6 months)
  const monthlyGMV = (() => {
    const now = new Date();
    return Array.from({ length: 6 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
      const label = d.toLocaleDateString('en-NG', { month: 'short' });
      const value = bookings
        .filter(b => {
          const bd = new Date(b.created_at);
          return bd.getFullYear() === d.getFullYear() && bd.getMonth() === d.getMonth() && b.agreed_rate;
        })
        .reduce((s, b) => s + (b.agreed_rate || 0) * (b.duration_months || 1), 0);
      return { label, value: Math.round(value / 1000) }; // in ₦K
    });
  })();

  // Top cities by board count
  const cityBreakdown = (() => {
    const map: Record<string, number> = {};
    boards.forEach(b => { if (b.city) map[b.city] = (map[b.city] || 0) + 1; });
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([label, value]) => ({ label, value }));
  })();

  // Format breakdown
  const formatBreakdown = Object.entries(FORMAT_LABELS).map(([key, label]) => ({
    label: label.split(' ')[0],
    value: boards.filter(b => b.format === key).length,
  })).filter(d => d.value > 0);

  // Revenue by city
  const revenueByCity = (() => {
    const map: Record<string, number> = {};
    bookings.filter(b => b.agreed_rate).forEach(b => {
      const city = b.boards?.city || 'Unknown';
      map[city] = (map[city] || 0) + (b.agreed_rate || 0) * (b.duration_months || 1);
    });
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([label, value]) => ({ label, value: Math.round(value / 1000) }));
  })();

  const ACTION_DOT: Record<string, string> = {
    'invoice.paid': '#10B981', 'invoice.compiled': '#8B5CF6', 'invoice.created': '#3B82F6',
    'booking.requested': '#F59E0B', 'booking.mpo_raised': '#7C3AED', 'booking.status_changed': '#64748B',
    'booking.approved_by_client': '#10B981', 'booking.declined_by_client': '#EF4444',
    'compliance.submitted': '#F59E0B', 'compliance.verified': '#10B981', 'compliance.flagged': '#EF4444',
    'campaign.sent_for_approval': '#1B4F8A', 'campaign.status_changed': '#64748B',
    'invoice.erp_exported': '#7C3AED',
  };

  // Activity feed: real audit events if available, fall back to raw table derivation
  const activityFeed = activityEvents.length > 0
    ? activityEvents.slice(0, 12).map(ev => ({
        title: ev.summary,
        sub: [ev.actor_name || ev.actor_role || 'System', ev.entity_type].filter(Boolean).join(' · '),
        time: ev.created_at,
        dot: ACTION_DOT[ev.action] || '#94A3B8',
      }))
    : [
        ...bookings.slice(0, 6).map(b => ({
          title: `Booking — ${b.boards?.name || 'Board'}`,
          sub: `${b.campaigns?.name || 'Unknown campaign'} · ${b.status}`,
          time: b.created_at,
          dot: BOOKING_STATUS_CONFIG[b.status]?.dot || '#94A3B8',
        })),
        ...campaigns.slice(0, 4).map(c => ({
          title: `Campaign — ${c.name}`,
          sub: `${c.client_name || 'Unknown client'} · ${c.status}`,
          time: c.created_at,
          dot: '#1B4F8A',
        })),
        ...compliance.slice(0, 4).map(c => ({
          title: `POE ${c.status === 'flagged' ? 'flagged' : c.status === 'verified' ? 'verified' : 'submitted'}`,
          sub: `Booking ${c.booking_id.slice(0, 8)}…`,
          time: c.submitted_at,
          dot: c.status === 'flagged' ? '#EF4444' : c.status === 'verified' ? '#10B981' : '#F59E0B',
        })),
      ].sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime()).slice(0, 12);

  // Filtered inventory
  const filteredBoards = invFilter === 'all' ? boards : boards.filter(b => b.status === invFilter);
  // Filtered bookings
  const filteredBookings = bookFilter === 'all' ? bookings : bookings.filter(b => b.status === bookFilter);

  if (fetchError) return (
    <div style={{ padding: '3rem', textAlign: 'center' }}>
      <p style={{ color: '#EF4444', fontWeight: 600, marginBottom: 12 }}>Failed to load admin data</p>
      <p style={{ color: '#64748B', fontSize: '0.875rem', marginBottom: 16 }}>{fetchError}</p>
      <button onClick={() => { setFetchError(null); setLoading(true); fetchAll(); }} style={{ padding: '8px 20px', background: '#DC2626', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: '0.875rem' }}>Retry</button>
    </div>
  );

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
        .row-hover:hover { background: #FFF8F8 !important; }
        .admin-filter-btn { padding: 5px 12px; border-radius: 6px; border: 1px solid #E2E8F0; font-size: 0.75rem; font-weight: 600; cursor: pointer; font-family: inherit; transition: all 0.15s; }
        .admin-filter-btn.active { background: #DC2626; color: #fff; border-color: #DC2626; }
        .admin-filter-btn:not(.active) { background: #fff; color: #475569; }
        .admin-filter-btn:not(.active):hover { background: #F8FAFC; }
      `}</style>

      {/* Toast */}
      {toast && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 9999, background: toast.type === 'error' ? '#7F1D1D' : '#0F172A', color: '#fff', padding: '11px 18px', borderRadius: 10, fontSize: '0.875rem', fontWeight: 600, boxShadow: '0 8px 24px rgba(0,0,0,0.2)', animation: 'fadeUp 0.2s ease forwards' }}>
          {toast.msg}
        </div>
      )}

      {/* ── Welcome strip ── */}
      <div className="welcome-strip" style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: 16, padding: '18px 24px', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 46, height: 46, borderRadius: 13, flexShrink: 0, background: 'linear-gradient(135deg, #DC2626 0%, #EF4444 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
            </svg>
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
              <h1 style={{ fontSize: '1.0625rem', fontWeight: 700, color: '#0F172A', margin: 0, letterSpacing: '-0.02em' }}>Admin Control Room</h1>
              <span style={{ fontSize: '0.625rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#DC2626', background: '#FEF2F2', padding: '2px 8px', borderRadius: 999 }}>
                Superadmin
              </span>
            </div>
            <p style={{ fontSize: '0.8125rem', color: '#94A3B8', margin: 0 }}>
              {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            </p>
          </div>
        </div>
        <div className="welcome-stats" style={{ display: 'flex', alignItems: 'center', gap: 24, flexShrink: 0 }}>
          <div style={{ textAlign: 'center' }}>
            <p style={{ fontSize: '1.5rem', fontWeight: 800, color: '#10B981', fontFamily: 'monospace', margin: '0 0 2px', letterSpacing: '-0.03em' }}>{formatNaira(platformCommission)}</p>
            <p style={{ fontSize: '0.625rem', fontWeight: 600, color: '#94A3B8', margin: 0, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Platform revenue</p>
          </div>
          <div style={{ width: 1, height: 36, background: '#F1F5F9' }} />
          <div style={{ textAlign: 'center' }}>
            <p style={{ fontSize: '1.5rem', fontWeight: 800, color: '#1B4F8A', fontFamily: 'monospace', margin: '0 0 2px', letterSpacing: '-0.03em' }}>{boards.length}</p>
            <p style={{ fontSize: '0.625rem', fontWeight: 600, color: '#94A3B8', margin: 0, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Boards listed</p>
          </div>
          <div style={{ width: 1, height: 36, background: '#F1F5F9' }} />
          <div style={{ textAlign: 'center' }}>
            <p style={{ fontSize: '1.5rem', fontWeight: 800, color: '#7C3AED', fontFamily: 'monospace', margin: '0 0 2px', letterSpacing: '-0.03em' }}>{displayUsers.length}</p>
            <p style={{ fontSize: '0.625rem', fontWeight: 600, color: '#94A3B8', margin: 0, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Platform users</p>
          </div>
          {flaggedCompliance.length > 0 && (
            <>
              <div style={{ width: 1, height: 36, background: '#F1F5F9' }} />
              <button onClick={() => setActiveTab('compliance')} style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#FEF2F2', color: '#DC2626', border: '1px solid #FECACA', padding: '7px 14px', borderRadius: 9, fontSize: '0.8125rem', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                ⚑ {flaggedCompliance.length} flag{flaggedCompliance.length !== 1 ? 's' : ''}
              </button>
            </>
          )}
        </div>
      </div>

      {/* ── KPI cards ── */}
      <div className="resp-grid-5" style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: '1.75rem' }}>
        <KPICard label="Total Boards"      value={String(boards.length)}         bar="#7C3AED" sub={`${occupancy}% occupancy`}                              icon="🏗️" />
        <KPICard label="Campaigns"         value={String(campaigns.length)}       bar="#1B4F8A" sub={`${campaigns.filter(c => c.status === 'active').length} active`} icon="📋" />
        <KPICard label="All Bookings"      value={String(bookings.length)}        bar="#F59E0B" sub={`${liveBookings.length} live · ${pendingBookings.length} pending`} icon="📌" />
        <KPICard label="Total GMV"         value={formatNaira(totalGMV)}          bar="#10B981" sub="Gross merchandise value"                                icon="💰" />
        <KPICard label="Compliance Flags"  value={String(flaggedCompliance.length)} bar={flaggedCompliance.length > 0 ? '#EF4444' : '#10B981'} sub={`${compliance.filter(c => c.status === 'verified').length} verified`} icon="🚩" />
      </div>

      {/* ── Alerts ── */}
      {(pendingBookings.length > 0 || flaggedCompliance.length > 0) && (
        <div style={{ display: 'flex', gap: 10, marginBottom: '1.25rem', flexWrap: 'wrap' }}>
          {pendingBookings.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 10, padding: '10px 16px', flex: 1 }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#D97706" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#92400E' }}>{pendingBookings.length} booking{pendingBookings.length !== 1 ? 's' : ''} in negotiation</span>
              <button onClick={() => setActiveTab('bookings')} style={{ marginLeft: 'auto', fontSize: '0.75rem', fontWeight: 600, color: '#D97706', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>View →</button>
            </div>
          )}
          {flaggedCompliance.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 10, padding: '10px 16px', flex: 1 }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#DC2626" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
              <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#991B1B' }}>{flaggedCompliance.length} compliance flag{flaggedCompliance.length !== 1 ? 's' : ''} need review</span>
              <button onClick={() => setActiveTab('compliance')} style={{ marginLeft: 'auto', fontSize: '0.75rem', fontWeight: 600, color: '#DC2626', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>Review →</button>
            </div>
          )}
        </div>
      )}

      {/* ── Tabs ── */}
      <div className="resp-tabs" style={{ display: 'flex', gap: 4, background: '#F1F5F9', padding: 4, borderRadius: 10, width: 'fit-content', marginBottom: '1.25rem' }}>
        {([
          { key: 'overview',   label: 'Overview' },
          { key: 'inventory',  label: `Inventory (${boards.length})` },
          { key: 'bookings',   label: `Bookings (${bookings.length})` },
          { key: 'users',      label: `Users (${displayUsers.length})` },
          { key: 'compliance', label: `Compliance`, badge: flaggedCompliance.length },
          { key: 'revenue',    label: 'Revenue' },
          { key: 'analytics',  label: 'Analytics' },
          { key: 'settings',   label: 'Settings' },
        ] as { key: AdminTab; label: string; badge?: number }[]).map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              padding: '6px 14px', borderRadius: 7, border: 'none',
              background: activeTab === tab.key ? '#fff' : 'transparent',
              color: activeTab === tab.key ? '#0F172A' : '#64748B',
              fontSize: '0.8125rem', fontWeight: activeTab === tab.key ? 600 : 400,
              cursor: 'pointer', fontFamily: 'inherit',
              boxShadow: activeTab === tab.key ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
              display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap',
            }}
          >
            {tab.label}
            {tab.badge ? (
              <span style={{ background: '#FEF2F2', color: '#DC2626', borderRadius: 999, padding: '0 5px', fontSize: '0.625rem', fontWeight: 700 }}>{tab.badge}</span>
            ) : null}
          </button>
        ))}
      </div>

      {/* ═══ TAB: OVERVIEW ═══ */}
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

          {/* Activity feed */}
          <div style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ padding: '14px 20px', borderBottom: '1px solid #F1F5F9', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h2 style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#0F172A', margin: '0 0 2px' }}>Platform activity</h2>
                <p style={{ fontSize: '0.75rem', color: '#94A3B8', margin: 0 }}>Real-time events across all users</p>
              </div>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#10B981', boxShadow: '0 0 0 3px rgba(16,185,129,0.2)' }} />
            </div>
            <div style={{ maxHeight: 340, overflowY: 'auto' }}>
              {activityFeed.length === 0 ? (
                <div style={{ padding: '3rem', textAlign: 'center' }}>
                  <p style={{ fontSize: '0.875rem', color: '#94A3B8', margin: 0 }}>No activity yet</p>
                </div>
              ) : activityFeed.map((item, i) => (
                <div key={i} className="row-hover fade" style={{ padding: '11px 20px', borderBottom: i < activityFeed.length - 1 ? '1px solid #F8FAFC' : 'none', display: 'flex', alignItems: 'center', gap: 12, background: '#fff', animationDelay: `${i * 0.03}s` }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: item.dot, flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#0F172A', margin: '0 0 1px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.title}</p>
                    <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: 0 }}>{item.sub}</p>
                  </div>
                  <span style={{ fontSize: '0.6875rem', color: '#94A3B8', flexShrink: 0 }}>{timeAgo(item.time)}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Board inventory health */}
          <div style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ padding: '14px 20px', borderBottom: '1px solid #F1F5F9' }}>
              <h2 style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#0F172A', margin: '0 0 2px' }}>Board inventory health</h2>
              <p style={{ fontSize: '0.75rem', color: '#94A3B8', margin: 0 }}>Availability across all boards</p>
            </div>
            <div style={{ padding: '16px 20px' }}>
              {[
                { label: 'Available',   count: boards.filter(b => b.status === 'available').length,   color: '#10B981' },
                { label: 'Booked',      count: boards.filter(b => b.status === 'booked').length,      color: '#3B82F6' },
                { label: 'Maintenance', count: boards.filter(b => b.status === 'maintenance').length, color: '#F59E0B' },
              ].map(({ label, count, color }) => {
                const pct = boards.length > 0 ? Math.round((count / boards.length) * 100) : 0;
                return (
                  <div key={label} style={{ marginBottom: 16 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                      <span style={{ fontSize: '0.8125rem', color: '#374151', fontWeight: 500 }}>{label}</span>
                      <span style={{ fontSize: '0.8125rem', fontWeight: 700, color: '#0F172A', fontFamily: 'monospace' }}>
                        {count} <span style={{ color: '#94A3B8', fontWeight: 400 }}>({pct}%)</span>
                      </span>
                    </div>
                    <div style={{ height: 8, background: '#F1F5F9', borderRadius: 999, overflow: 'hidden' }}>
                      <div style={{ height: '100%', borderRadius: 999, background: color, width: `${pct}%`, transition: 'width 0.6s ease' }} />
                    </div>
                  </div>
                );
              })}
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

          {/* Active campaigns */}
          <div style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ padding: '14px 20px', borderBottom: '1px solid #F1F5F9', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h2 style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#0F172A', margin: '0 0 2px' }}>Active campaigns</h2>
                <p style={{ fontSize: '0.75rem', color: '#94A3B8', margin: 0 }}>Live campaigns on the platform</p>
              </div>
              <button onClick={() => setActiveTab('bookings')} style={{ fontSize: '0.75rem', fontWeight: 600, color: '#1B4F8A', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>View all →</button>
            </div>
            <div>
              {campaigns.filter(c => c.status === 'active').slice(0, 5).map((c, i) => {
                const daysLeft = Math.ceil((new Date(c.end_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
                return (
                  <div key={c.id} className="row-hover fade" style={{ padding: '12px 20px', borderBottom: '1px solid #F8FAFC', display: 'flex', alignItems: 'center', gap: 12, background: '#fff', animationDelay: `${i * 0.04}s` }}>
                    <div style={{ width: 32, height: 32, borderRadius: 8, background: '#EFF6FF', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.875rem', flexShrink: 0 }}>📋</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#0F172A', margin: '0 0 2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name}</p>
                      <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: 0 }}>{c.client_name || '—'}</p>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      {c.total_budget && <p style={{ fontSize: '0.8125rem', fontWeight: 700, color: '#1B4F8A', margin: '0 0 2px', fontFamily: 'monospace' }}>{formatNaira(c.total_budget)}</p>}
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

      {/* ═══ TAB: INVENTORY ═══ */}
      {activeTab === 'inventory' && (
        <div className="table-scroll" style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ padding: '14px 20px', borderBottom: '1px solid #F1F5F9', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <h2 style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#0F172A', margin: '0 0 2px' }}>
                All boards ({filteredBoards.length}{invFilter !== 'all' ? ` · ${invFilter}` : ''})
              </h2>
              <p style={{ fontSize: '0.75rem', color: '#94A3B8', margin: 0 }}>Full platform inventory</p>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              {(['all', 'available', 'booked', 'maintenance'] as const).map(s => (
                <button
                  key={s}
                  className={`admin-filter-btn${invFilter === s ? ' active' : ''}`}
                  onClick={() => setInvFilter(s)}
                >
                  {s.charAt(0).toUpperCase() + s.slice(1)}
                  {s !== 'all' && <span style={{ marginLeft: 4, opacity: 0.7 }}>({boards.filter(b => b.status === s).length})</span>}
                </button>
              ))}
            </div>
          </div>
          {filteredBoards.length === 0 ? (
            <div style={{ padding: '4rem', textAlign: 'center' }}>
              <p style={{ fontSize: '0.875rem', color: '#94A3B8', margin: 0 }}>No boards match this filter</p>
            </div>
          ) : (
            <>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#F8FAFC' }}>
                    {['Board', 'Location', 'Format', 'Rate', 'Status', 'Listed', 'Actions'].map(h => (
                      <th key={h} style={{ padding: '10px 16px', fontSize: '0.6875rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.07em', textAlign: 'left', borderBottom: '1px solid #F1F5F9', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredBoards.map((board, i) => (
                    <tr key={board.id} className="row-hover fade" style={{ borderBottom: i < filteredBoards.length - 1 ? '1px solid #F8FAFC' : 'none', background: '#fff', animationDelay: `${i * 0.03}s` }}>
                      <td style={{ padding: '12px 16px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div style={{ width: 34, height: 34, borderRadius: 8, background: '#F5F3FF', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: '0.9375rem' }}>🏗</div>
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
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: board.status === 'available' ? '#ECFDF5' : board.status === 'booked' ? '#EFF6FF' : '#FFFBEB', color: board.status === 'available' ? '#065F46' : board.status === 'booked' ? '#1E3A8A' : '#92400E', padding: '3px 9px', borderRadius: 999, fontSize: '0.6875rem', fontWeight: 600 }}>
                          <span style={{ width: 5, height: 5, borderRadius: '50%', background: board.status === 'available' ? '#10B981' : board.status === 'booked' ? '#3B82F6' : '#F59E0B' }} />
                          {board.status.charAt(0).toUpperCase() + board.status.slice(1)}
                        </span>
                      </td>
                      <td style={{ padding: '12px 16px', fontSize: '0.75rem', color: '#94A3B8', whiteSpace: 'nowrap' }}>
                        {timeAgo(board.created_at)}
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        {board.status !== 'booked' && (
                          <button
                            onClick={() => toggleBoardStatus(board)}
                            style={{ background: board.status === 'available' ? '#FFFBEB' : '#ECFDF5', color: board.status === 'available' ? '#92400E' : '#065F46', border: 'none', cursor: 'pointer', padding: '4px 10px', borderRadius: 6, fontSize: '0.6875rem', fontWeight: 600, fontFamily: 'inherit' }}
                          >
                            {board.status === 'available' ? 'Maintenance' : 'Available'}
                          </button>
                        )}
                        {board.status === 'booked' && (
                          <span style={{ fontSize: '0.6875rem', color: '#94A3B8' }}>Booked</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ padding: '10px 16px', borderTop: '1px solid #F1F5F9', background: '#FAFBFC', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '0.75rem', color: '#94A3B8' }}>
                  {boards.length} total · {boards.filter(b => b.status === 'available').length} available · {bookedBoards} booked
                </span>
                <span style={{ fontSize: '0.75rem', color: '#94A3B8' }}>{occupancy}% occupancy</span>
              </div>
            </>
          )}
        </div>
      )}

      {/* ═══ TAB: BOOKINGS ═══ */}
      {activeTab === 'bookings' && (
        <div className="table-scroll" style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ padding: '14px 20px', borderBottom: '1px solid #F1F5F9', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <h2 style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#0F172A', margin: '0 0 2px' }}>All bookings ({filteredBookings.length})</h2>
              <p style={{ fontSize: '0.75rem', color: '#94A3B8', margin: 0 }}>Every booking across the platform</p>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {['all', 'pending', 'negotiating', 'agreed', 'live', 'completed', 'declined'].map(s => (
                <button
                  key={s}
                  className={`admin-filter-btn${bookFilter === s ? ' active' : ''}`}
                  onClick={() => setBookFilter(s)}
                >
                  {s.charAt(0).toUpperCase() + s.slice(1)}
                  {s !== 'all' && <span style={{ marginLeft: 4, opacity: 0.7 }}>({(bookingByStatus[s] || 0)})</span>}
                </button>
              ))}
            </div>
          </div>
          {filteredBookings.length === 0 ? (
            <div style={{ padding: '4rem', textAlign: 'center' }}>
              <p style={{ fontSize: '0.875rem', color: '#94A3B8', margin: 0 }}>No bookings match this filter</p>
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
                  {filteredBookings.map((b, i) => (
                    <tr key={b.id} className="row-hover fade" style={{ borderBottom: i < filteredBookings.length - 1 ? '1px solid #F8FAFC' : 'none', background: '#fff', animationDelay: `${i * 0.03}s` }}>
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
                      <td style={{ padding: '12px 16px' }}><StatusPill status={b.status} /></td>
                      <td style={{ padding: '12px 16px', fontSize: '0.75rem', color: '#94A3B8', whiteSpace: 'nowrap' }}>{timeAgo(b.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ padding: '12px 20px', background: '#F8FAFC', borderTop: '2px solid #E8EDF2', display: 'flex', gap: 32, flexWrap: 'wrap' }}>
                <div>
                  <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: '0 0 2px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Total GMV</p>
                  <p style={{ fontSize: '1rem', fontWeight: 800, color: '#10B981', fontFamily: 'monospace', margin: 0 }}>{formatNaira(totalGMV)}</p>
                </div>
                <div>
                  <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: '0 0 2px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Platform commission ({settings.commissionRate}%)</p>
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

      {/* ═══ TAB: USERS ═══ */}
      {activeTab === 'users' && (
        <div className="table-scroll" style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ padding: '14px 20px', borderBottom: '1px solid #F1F5F9', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <h2 style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#0F172A', margin: '0 0 2px' }}>Platform users ({filteredUsers.length})</h2>
              <p style={{ fontSize: '0.75rem', color: '#94A3B8', margin: 0 }}>
                {profiles.length > 0 ? 'Live data from Supabase profiles' : 'Demo data — connect Supabase to see real users'}
              </p>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              {(['all', 'agency', 'client', 'owner'] as const).map(r => (
                <button
                  key={r}
                  className={`admin-filter-btn${userRoleFilter === r ? ' active' : ''}`}
                  onClick={() => setUserRoleFilter(r)}
                >
                  {r.charAt(0).toUpperCase() + r.slice(1)}
                  <span style={{ marginLeft: 4, opacity: 0.7 }}>({r === 'all' ? displayUsers.length : displayUsers.filter(u => u.role === r).length})</span>
                </button>
              ))}
            </div>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#F8FAFC' }}>
                {['User', 'Role', 'Email', 'Activity', 'Last active', 'Status', 'Actions'].map(h => (
                  <th key={h} style={{ padding: '10px 16px', fontSize: '0.6875rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.07em', textAlign: 'left', borderBottom: '1px solid #F1F5F9', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredUsers.map((user, i) => {
                const roleColors: Record<string, { bg: string; color: string }> = {
                  agency: { bg: '#EFF6FF', color: '#1E3A8A' },
                  client: { bg: '#ECFDF5', color: '#065F46' },
                  owner:  { bg: '#F5F3FF', color: '#3730A3' },
                  admin:  { bg: '#FEF2F2', color: '#991B1B' },
                };
                const rc = roleColors[user.role] || roleColors.agency;
                return (
                  <tr key={i} className="row-hover fade" style={{ borderBottom: i < filteredUsers.length - 1 ? '1px solid #F8FAFC' : 'none', background: '#fff', animationDelay: `${i * 0.05}s` }}>
                    <td style={{ padding: '12px 16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ width: 34, height: 34, borderRadius: '50%', background: rc.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', fontWeight: 700, color: rc.color, flexShrink: 0 }}>
                          {user.name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()}
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
                    <td style={{ padding: '12px 16px', fontSize: '0.75rem', color: '#475569' }}>{user.email}</td>
                    <td style={{ padding: '12px 16px', fontSize: '0.875rem', fontWeight: 700, color: '#0F172A', fontFamily: 'monospace' }}>
                      {user.count} <span style={{ fontSize: '0.75rem', fontWeight: 400, color: '#94A3B8' }}>{user.role === 'owner' ? 'boards' : 'campaigns'}</span>
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: '0.8125rem', color: '#475569' }}>{user.lastActive}</td>
                    <td style={{ padding: '12px 16px' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: user.is_suspended ? '#FEF2F2' : '#ECFDF5', color: user.is_suspended ? '#991B1B' : '#065F46', padding: '3px 9px', borderRadius: 999, fontSize: '0.6875rem', fontWeight: 600 }}>
                        <span style={{ width: 5, height: 5, borderRadius: '50%', background: user.is_suspended ? '#EF4444' : '#10B981' }} />
                        {user.is_suspended ? 'Suspended' : 'Active'}
                      </span>
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <div style={{ display: 'flex', gap: 4 }}>
                        {!user.id.startsWith('demo-') && (
                          <button
                            onClick={() => toggleUserSuspension(user.id, user.is_suspended)}
                            disabled={togglingUser === user.id}
                            style={{ background: user.is_suspended ? '#ECFDF5' : '#FEF2F2', color: user.is_suspended ? '#065F46' : '#991B1B', border: 'none', cursor: togglingUser === user.id ? 'not-allowed' : 'pointer', padding: '4px 10px', borderRadius: 6, fontSize: '0.6875rem', fontWeight: 600, fontFamily: 'inherit', opacity: togglingUser === user.id ? 0.6 : 1 }}
                          >
                            {togglingUser === user.id ? '…' : user.is_suspended ? 'Activate' : 'Suspend'}
                          </button>
                        )}
                        {user.id.startsWith('demo-') && (
                          <span style={{ fontSize: '0.6875rem', color: '#CBD5E1' }}>Demo user</span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div style={{ padding: '10px 16px', borderTop: '1px solid #F1F5F9', background: '#FAFBFC', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '0.75rem', color: '#94A3B8' }}>
              {displayUsers.length} user{displayUsers.length !== 1 ? 's' : ''} · {displayUsers.filter(u => u.status === 'active').length} active
            </span>
            {profiles.length === 0 && (
              <span style={{ fontSize: '0.75rem', color: '#F59E0B', fontWeight: 600 }}>⚠ Showing demo data</span>
            )}
          </div>
        </div>
      )}

      {/* ═══ TAB: COMPLIANCE ═══ */}
      {activeTab === 'compliance' && (
        <div>
          <div className="resp-grid-4" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: '1.25rem' }}>
            {[
              { label: 'Total checks',   count: compliance.length,                                          bg: '#F1F5F9', color: '#0F172A' },
              { label: 'Verified',       count: compliance.filter(c => c.status === 'verified').length,    bg: '#ECFDF5', color: '#065F46' },
              { label: 'Pending review', count: compliance.filter(c => c.status === 'submitted').length,   bg: '#FFFBEB', color: '#92400E' },
              { label: 'Flagged',        count: compliance.filter(c => c.status === 'flagged').length,     bg: '#FEF2F2', color: '#991B1B' },
            ].map(pill => (
              <div key={pill.label} style={{ background: pill.bg, borderRadius: 12, padding: '16px 18px' }}>
                <p style={{ fontSize: '1.75rem', fontWeight: 800, color: pill.color, fontFamily: 'monospace', margin: '0 0 4px' }}>{pill.count}</p>
                <p style={{ fontSize: '0.6875rem', fontWeight: 600, color: pill.color, opacity: 0.8, margin: 0 }}>{pill.label}</p>
              </div>
            ))}
          </div>

          <div className="table-scroll" style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ padding: '14px 20px', borderBottom: '1px solid #F1F5F9' }}>
              <h2 style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#0F172A', margin: '0 0 2px' }}>Compliance checks ({compliance.length})</h2>
              <p style={{ fontSize: '0.75rem', color: '#94A3B8', margin: 0 }}>Flagged items sorted to the top — click Verify or Flag to update status</p>
            </div>
            {compliance.length === 0 ? (
              <div style={{ padding: '4rem', textAlign: 'center' }}>
                <p style={{ fontSize: '0.875rem', color: '#94A3B8', margin: 0 }}>No compliance checks yet</p>
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#F8FAFC' }}>
                    {['Booking ID', 'Status', 'Submitted', 'Photo', 'Notes', 'Actions'].map(h => (
                      <th key={h} style={{ padding: '10px 16px', fontSize: '0.6875rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.07em', textAlign: 'left', borderBottom: '1px solid #F1F5F9', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[...compliance].sort((a, b) => (a.status === 'flagged' ? -1 : b.status === 'flagged' ? 1 : 0)).map((check, i) => (
                    <tr key={check.id} className="row-hover fade" style={{ borderBottom: i < compliance.length - 1 ? '1px solid #F8FAFC' : 'none', background: check.status === 'flagged' ? '#FFF7F7' : '#fff', animationDelay: `${i * 0.03}s` }}>
                      <td style={{ padding: '12px 16px', fontSize: '0.8125rem', fontFamily: 'monospace', color: '#475569' }}>
                        {check.booking_id.slice(0, 8)}…
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: check.status === 'verified' ? '#ECFDF5' : check.status === 'flagged' ? '#FEF2F2' : '#FFFBEB', color: check.status === 'verified' ? '#065F46' : check.status === 'flagged' ? '#991B1B' : '#92400E', padding: '3px 9px', borderRadius: 999, fontSize: '0.6875rem', fontWeight: 600 }}>
                          <span style={{ width: 5, height: 5, borderRadius: '50%', background: check.status === 'verified' ? '#10B981' : check.status === 'flagged' ? '#EF4444' : '#F59E0B' }} />
                          {check.status === 'submitted' ? 'Pending review' : check.status.charAt(0).toUpperCase() + check.status.slice(1)}
                        </span>
                      </td>
                      <td style={{ padding: '12px 16px', fontSize: '0.8125rem', color: '#475569', whiteSpace: 'nowrap' }}>
                        {formatDate(check.submitted_at)}
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        {check.photo_url ? (
                          <a href={check.photo_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#1B4F8A', textDecoration: 'none', background: '#EFF6FF', padding: '3px 8px', borderRadius: 5 }}>
                            View photo →
                          </a>
                        ) : (
                          <span style={{ fontSize: '0.6875rem', color: '#CBD5E1' }}>—</span>
                        )}
                      </td>
                      <td style={{ padding: '12px 16px', fontSize: '0.8125rem', color: check.notes ? '#0F172A' : '#94A3B8', maxWidth: 200 }}>
                        <span style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                          {check.notes || 'No notes'}
                        </span>
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        <div style={{ display: 'flex', gap: 4 }}>
                          {check.status !== 'verified' && (
                            <button onClick={() => verifyCompliance(check.id)} style={{ background: '#ECFDF5', color: '#065F46', border: 'none', cursor: 'pointer', padding: '4px 10px', borderRadius: 6, fontSize: '0.6875rem', fontWeight: 600, fontFamily: 'inherit' }}>
                              Verify
                            </button>
                          )}
                          {check.status !== 'flagged' && (
                            <button onClick={() => flagCompliance(check.id)} style={{ background: '#FEF2F2', color: '#991B1B', border: 'none', cursor: 'pointer', padding: '4px 10px', borderRadius: 6, fontSize: '0.6875rem', fontWeight: 600, fontFamily: 'inherit' }}>
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

      {/* ═══ TAB: REVENUE ═══ */}
      {activeTab === 'revenue' && (
        <div>
          <div className="resp-grid-3" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: '1.5rem' }}>
            <div style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: 12, padding: '20px' }}>
              <p style={{ fontSize: '0.6875rem', fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.07em', margin: '0 0 8px' }}>Gross Merchandise Value</p>
              <p style={{ fontSize: '2rem', fontWeight: 800, color: '#10B981', letterSpacing: '-0.03em', margin: '0 0 4px', fontFamily: 'monospace' }}>{formatNaira(totalGMV)}</p>
              <p style={{ fontSize: '0.6875rem', color: '#CBD5E1', margin: 0 }}>Total value of all agreed bookings</p>
            </div>
            <div style={{ background: '#0F172A', border: '1px solid #1E293B', borderRadius: 12, padding: '20px' }}>
              <p style={{ fontSize: '0.6875rem', fontWeight: 600, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.07em', margin: '0 0 8px' }}>Platform Revenue ({settings.commissionRate}%)</p>
              <p style={{ fontSize: '2rem', fontWeight: 800, color: '#F59E0B', letterSpacing: '-0.03em', margin: '0 0 4px', fontFamily: 'monospace' }}>{formatNaira(platformCommission)}</p>
              <p style={{ fontSize: '0.6875rem', color: 'rgba(255,255,255,0.25)', margin: 0 }}>Your commission from all agreed deals</p>
            </div>
            <div style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: 12, padding: '20px' }}>
              <p style={{ fontSize: '0.6875rem', fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.07em', margin: '0 0 8px' }}>Owner Payouts ({100 - settings.commissionRate}%)</p>
              <p style={{ fontSize: '2rem', fontWeight: 800, color: '#7C3AED', letterSpacing: '-0.03em', margin: '0 0 4px', fontFamily: 'monospace' }}>{formatNaira(totalGMV - platformCommission)}</p>
              <p style={{ fontSize: '0.6875rem', color: '#CBD5E1', margin: 0 }}>Owed to board owners</p>
            </div>
          </div>

          {/* Revenue per booking */}
          <div className="table-scroll" style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: 12, overflow: 'hidden' }}>
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
                    {['Deal', 'Board', 'Monthly rate', 'Duration', 'GMV', `Commission (${settings.commissionRate}%)`, 'Status'].map(h => (
                      <th key={h} style={{ padding: '10px 16px', fontSize: '0.6875rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.07em', textAlign: 'left', borderBottom: '1px solid #F1F5F9', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {bookings.filter(b => b.agreed_rate).map((b, i) => {
                    const gmv = (b.agreed_rate || 0) * (b.duration_months || 1);
                    const comm = Math.round(gmv * commRate);
                    return (
                      <tr key={b.id} className="row-hover fade" style={{ borderBottom: '1px solid #F8FAFC', background: '#fff', animationDelay: `${i * 0.04}s` }}>
                        <td style={{ padding: '12px 16px', fontSize: '0.8125rem', fontWeight: 500, color: '#475569' }}>{b.campaigns?.name || '—'}</td>
                        <td style={{ padding: '12px 16px' }}>
                          <p style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0F172A', margin: '0 0 2px' }}>{b.boards?.name || '—'}</p>
                          <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: 0 }}>{b.boards?.city || ''}</p>
                        </td>
                        <td style={{ padding: '12px 16px', fontFamily: 'monospace', fontSize: '0.875rem', fontWeight: 700, color: '#0F172A', whiteSpace: 'nowrap' }}>
                          {formatNaira(b.agreed_rate)}<span style={{ fontSize: '0.6875rem', fontWeight: 400, color: '#94A3B8' }}>/mo</span>
                        </td>
                        <td style={{ padding: '12px 16px', fontSize: '0.8125rem', color: '#475569' }}>{b.duration_months ? `${b.duration_months} mo` : '—'}</td>
                        <td style={{ padding: '12px 16px', fontFamily: 'monospace', fontSize: '0.875rem', fontWeight: 700, color: '#10B981', whiteSpace: 'nowrap' }}>{formatNaira(gmv)}</td>
                        <td style={{ padding: '12px 16px', fontFamily: 'monospace', fontSize: '0.875rem', fontWeight: 800, color: '#F59E0B', whiteSpace: 'nowrap' }}>{formatNaira(comm)}</td>
                        <td style={{ padding: '12px 16px' }}><StatusPill status={b.status} /></td>
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

      {/* ═══ TAB: ANALYTICS ═══ */}
      {activeTab === 'analytics' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Charts row */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            {/* Monthly booking volume */}
            <div style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: 12, padding: '18px 20px' }}>
              <div style={{ marginBottom: 16 }}>
                <h2 style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#0F172A', margin: '0 0 2px' }}>Monthly booking volume</h2>
                <p style={{ fontSize: '0.75rem', color: '#94A3B8', margin: 0 }}>Number of new bookings per month (last 6 months)</p>
              </div>
              <BarChart data={monthlyBookings} color="#1B4F8A" height={100} />
            </div>

            {/* Monthly GMV */}
            <div style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: 12, padding: '18px 20px' }}>
              <div style={{ marginBottom: 16 }}>
                <h2 style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#0F172A', margin: '0 0 2px' }}>Monthly GMV (₦K)</h2>
                <p style={{ fontSize: '0.75rem', color: '#94A3B8', margin: 0 }}>Agreed deal value per month (last 6 months)</p>
              </div>
              <BarChart data={monthlyGMV} color="#10B981" height={100} />
            </div>
          </div>

          {/* City + Format breakdowns */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            {/* City breakdown */}
            <div style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: 12, padding: '18px 20px' }}>
              <div style={{ marginBottom: 16 }}>
                <h2 style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#0F172A', margin: '0 0 2px' }}>Boards by city</h2>
                <p style={{ fontSize: '0.75rem', color: '#94A3B8', margin: 0 }}>Top 8 cities by inventory count</p>
              </div>
              {cityBreakdown.length === 0 ? (
                <p style={{ fontSize: '0.8125rem', color: '#94A3B8', margin: 0 }}>No boards yet</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {cityBreakdown.map(({ label, value }) => {
                    const pct = boards.length > 0 ? Math.round((value / boards.length) * 100) : 0;
                    return (
                      <div key={label}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                          <span style={{ fontSize: '0.8125rem', color: '#374151', fontWeight: 500 }}>{label}</span>
                          <span style={{ fontSize: '0.8125rem', fontWeight: 700, color: '#0F172A', fontFamily: 'monospace' }}>
                            {value} <span style={{ color: '#94A3B8', fontWeight: 400 }}>({pct}%)</span>
                          </span>
                        </div>
                        <div style={{ height: 6, background: '#F1F5F9', borderRadius: 999, overflow: 'hidden' }}>
                          <div style={{ height: '100%', borderRadius: 999, background: '#7C3AED', width: `${pct}%`, transition: 'width 0.6s ease' }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Format breakdown + Revenue by city */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: 12, padding: '18px 20px' }}>
                <div style={{ marginBottom: 14 }}>
                  <h2 style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#0F172A', margin: '0 0 2px' }}>Inventory by format</h2>
                  <p style={{ fontSize: '0.75rem', color: '#94A3B8', margin: 0 }}>Board count per format type</p>
                </div>
                <BarChart data={formatBreakdown} color="#F59E0B" height={80} />
              </div>

              <div style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: 12, padding: '18px 20px' }}>
                <div style={{ marginBottom: 14 }}>
                  <h2 style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#0F172A', margin: '0 0 2px' }}>Revenue by city (₦K)</h2>
                  <p style={{ fontSize: '0.75rem', color: '#94A3B8', margin: 0 }}>Top 6 cities by agreed GMV</p>
                </div>
                {revenueByCity.length === 0 ? (
                  <p style={{ fontSize: '0.8125rem', color: '#94A3B8', margin: 0 }}>No agreed deals yet</p>
                ) : (
                  <BarChart data={revenueByCity} color="#10B981" height={80} />
                )}
              </div>
            </div>
          </div>

          {/* Platform health summary */}
          <div style={{ background: '#0F172A', borderRadius: 12, padding: '20px 24px' }}>
            <p style={{ fontSize: '0.875rem', fontWeight: 700, color: '#F8FAFC', margin: '0 0 16px' }}>Platform health summary</p>
            <div className="resp-grid-4" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
              {[
                { label: 'Avg booking rate', value: bookings.length > 0 ? formatNaira(Math.round(bookings.reduce((s, b) => s + b.offered_rate, 0) / bookings.length)) + '/mo' : '—', color: '#F8FAFC' },
                { label: 'Conversion rate', value: bookings.length > 0 ? `${Math.round((bookings.filter(b => ['agreed','signed','live','completed'].includes(b.status)).length / bookings.length) * 100)}%` : '—', color: '#10B981' },
                { label: 'Compliance rate', value: compliance.length > 0 ? `${Math.round((compliance.filter(c => c.status === 'verified').length / compliance.length) * 100)}%` : '—', color: '#F59E0B' },
                { label: 'Active campaigns', value: String(campaigns.filter(c => c.status === 'active').length), color: '#C4B5FD' },
              ].map(item => (
                <div key={item.label} style={{ background: 'rgba(255,255,255,0.05)', borderRadius: 10, padding: '14px 16px' }}>
                  <p style={{ fontSize: '0.6875rem', color: 'rgba(255,255,255,0.35)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', margin: '0 0 6px' }}>{item.label}</p>
                  <p style={{ fontSize: '1.5rem', fontWeight: 800, color: item.color, fontFamily: 'monospace', margin: 0, letterSpacing: '-0.03em' }}>{item.value}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ═══ TAB: SETTINGS ═══ */}
      {activeTab === 'settings' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'start' }}>

          {/* Commission settings */}
          <div style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: 12, padding: '20px 24px' }}>
            <h2 style={{ fontSize: '1rem', fontWeight: 700, color: '#0F172A', margin: '0 0 4px' }}>Platform commission</h2>
            <p style={{ fontSize: '0.8125rem', color: '#94A3B8', margin: '0 0 20px' }}>Rate applied to all agreed bookings. Changes take effect on new calculations.</p>

            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#374151', marginBottom: 6 }}>Commission rate (%)</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <input
                  type="range" min={5} max={30} step={1}
                  value={settings.commissionRate}
                  onChange={e => setSettings(s => ({ ...s, commissionRate: parseInt(e.target.value) }))}
                  style={{ flex: 1, accentColor: '#DC2626' }}
                />
                <span style={{ minWidth: 48, textAlign: 'center', fontSize: '1.25rem', fontWeight: 800, color: '#DC2626', fontFamily: 'monospace' }}>
                  {settings.commissionRate}%
                </span>
              </div>
              <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: '6px 0 0' }}>
                At {settings.commissionRate}%, platform earns {formatNaira(platformCommission)} on current GMV of {formatNaira(totalGMV)}
              </p>
            </div>

            <div style={{ background: '#F8FAFC', borderRadius: 10, padding: '14px 16px', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
              {[
                { label: 'Platform gets', value: formatNaira(Math.round(totalGMV * settings.commissionRate / 100)), color: '#DC2626' },
                { label: 'Owner gets', value: formatNaira(Math.round(totalGMV * (1 - settings.commissionRate / 100))), color: '#7C3AED' },
                { label: 'Split', value: `${settings.commissionRate}/${100 - settings.commissionRate}`, color: '#0F172A' },
              ].map(item => (
                <div key={item.label}>
                  <p style={{ fontSize: '0.6875rem', color: '#94A3B8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 4px' }}>{item.label}</p>
                  <p style={{ fontSize: '0.9375rem', fontWeight: 800, color: item.color, fontFamily: 'monospace', margin: 0 }}>{item.value}</p>
                </div>
              ))}
            </div>
          </div>

          {/* General settings */}
          <div style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: 12, padding: '20px 24px' }}>
            <h2 style={{ fontSize: '1rem', fontWeight: 700, color: '#0F172A', margin: '0 0 4px' }}>General settings</h2>
            <p style={{ fontSize: '0.8125rem', color: '#94A3B8', margin: '0 0 20px' }}>Platform-wide configuration stored locally.</p>

            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#374151', marginBottom: 6 }}>Platform name</label>
              <input
                type="text"
                value={settings.platformName}
                onChange={e => setSettings(s => ({ ...s, platformName: e.target.value }))}
                style={{ width: '100%', padding: '8px 11px', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: '0.875rem', color: '#0F172A', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }}
                onFocus={e => e.currentTarget.style.borderColor = '#DC2626'}
                onBlur={e => e.currentTarget.style.borderColor = '#E2E8F0'}
              />
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#374151', marginBottom: 6 }}>Alert email</label>
              <input
                type="email"
                value={settings.alertEmail}
                onChange={e => setSettings(s => ({ ...s, alertEmail: e.target.value }))}
                placeholder="admin@oohplatform.ng"
                style={{ width: '100%', padding: '8px 11px', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: '0.875rem', color: '#0F172A', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }}
                onFocus={e => e.currentTarget.style.borderColor = '#DC2626'}
                onBlur={e => e.currentTarget.style.borderColor = '#E2E8F0'}
              />
              <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: '4px 0 0' }}>Receives notifications for flagged compliance and failed payments</p>
            </div>

            {/* Maintenance mode toggle */}
            <div style={{ background: settings.maintenanceMode ? '#FEF2F2' : '#F8FAFC', border: `1px solid ${settings.maintenanceMode ? '#FECACA' : '#E8EDF2'}`, borderRadius: 10, padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <div>
                <p style={{ fontSize: '0.875rem', fontWeight: 600, color: settings.maintenanceMode ? '#991B1B' : '#0F172A', margin: '0 0 2px' }}>Maintenance mode</p>
                <p style={{ fontSize: '0.75rem', color: '#94A3B8', margin: 0 }}>Displays a notice to all non-admin users</p>
              </div>
              <button
                onClick={() => setSettings(s => ({ ...s, maintenanceMode: !s.maintenanceMode }))}
                style={{
                  width: 44, height: 24, borderRadius: 999, border: 'none', cursor: 'pointer',
                  background: settings.maintenanceMode ? '#DC2626' : '#E2E8F0',
                  position: 'relative', transition: 'background 0.2s', flexShrink: 0,
                }}
              >
                <span style={{
                  position: 'absolute', top: 3, left: settings.maintenanceMode ? 23 : 3,
                  width: 18, height: 18, borderRadius: '50%', background: '#fff',
                  transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
                }} />
              </button>
            </div>
          </div>

          {/* Save button - full width */}
          <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
            <button
              onClick={() => setSettings(DEFAULT_SETTINGS)}
              style={{ padding: '10px 20px', background: '#F1F5F9', color: '#475569', border: 'none', borderRadius: 9, fontSize: '0.875rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
            >
              Reset to defaults
            </button>
            <button
              onClick={saveSettings}
              style={{ padding: '10px 24px', background: settingsSaved ? '#10B981' : '#DC2626', color: '#fff', border: 'none', borderRadius: 9, fontSize: '0.875rem', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', transition: 'background 0.3s' }}
            >
              {settingsSaved ? '✓ Saved' : 'Save settings'}
            </button>
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
