'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { RoleGuard } from '@/components/layout/RoleGuard';
import { supabase } from '@/lib/supabase';
import { getCurrentProfile } from '@/lib/auth';
import { createNotification } from '@/lib/notifications';
import { logActivity } from '@/lib/activity-log';
import { CampaignJourneyStrip, buildCampaignJourney } from '@/components/client/CampaignJourneyStrip';
import { ClientActionsPanel, type ClientAction } from '@/components/client/ClientActionsPanel';
import { ClientBillingTab } from '@/components/client/ClientBillingTab';
import { parseClientTab, OBJECTIVE_LABELS, type ClientTab } from '@/components/client/client-utils';
import { formatNaira, formatDate, formatDateShort, formatImpressions } from '@/lib/utils';

const ClientPortalMap = dynamic(() => import('@/components/client/ClientPortalMap'), { ssr: false, loading: () => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', background: '#F8FAFC' }}>
    <div style={{ width: 22, height: 22, border: '2px solid #E2E8F0', borderTopColor: '#1B4F8A', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
  </div>
) });

// ── Types ──────────────────────────────────────────────────────────────────

type Campaign = {
  id: string;
  name: string;
  client_name: string | null;
  status: string;
  start_date: string;
  end_date: string;
  total_budget: number;
  objective?: string | null;
  target_cities?: string | null;
  plan_notes?: string | null;
  agency_id?: string | null;
};

type Booking = {
  id: string;
  status: string;
  start_date: string;
  end_date: string;
  offered_rate: number;
  agreed_rate: number | null;
  boards: {
    id: string;
    name: string;
    address: string;
    city: string;
    state: string;
    format: string;
    latitude: number | null;
    longitude: number | null;
  };
};

type CampaignForm = {
  name: string;
  client_name: string;
  total_budget: string;
  start_date: string;
  end_date: string;
  objective: string;
  target_cities: string;
};

type ComplianceCheck = {
  id: string;
  booking_id: string;
  status: 'submitted' | 'verified' | 'flagged';
  submitted_at: string;
  photo_url: string | null;
  latitude: number | null;
  longitude: number | null;
  submitted_by: string | null;
  notes: string | null;
};

// ── Helpers ────────────────────────────────────────────────────────────────

function getDaysRemaining(endDate: string) {
  return Math.ceil((new Date(endDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

const FORMAT_LABELS: Record<string, string> = {
  billboard: 'Billboard', unipole: 'Unipole', gantry: 'Gantry',
  bridge_panel: 'Bridge Panel', wall_drape: 'Wall Drape',
};

// ── Small components ───────────────────────────────────────────────────────

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string; dot: string; label: string }> = {
    active:    { bg: '#ECFDF5', color: '#065F46', dot: '#10B981', label: 'Active' },
    live:      { bg: '#ECFDF5', color: '#065F46', dot: '#10B981', label: 'Live' },
    draft:     { bg: '#F1F5F9', color: '#475569', dot: '#94A3B8', label: 'Draft' },
    pending:   { bg: '#FFFBEB', color: '#92400E', dot: '#F59E0B', label: 'Pending' },
    completed: { bg: '#EFF6FF', color: '#1E3A8A', dot: '#3B82F6', label: 'Completed' },
    cancelled: { bg: '#FEF2F2', color: '#7F1D1D', dot: '#EF4444', label: 'Cancelled' },
  };
  const cfg = map[status] || map.draft;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: cfg.bg, color: cfg.color, padding: '3px 9px', borderRadius: '999px', fontSize: '0.6875rem', fontWeight: 600 }}>
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: cfg.dot }} />
      {cfg.label}
    </span>
  );
}

function BookingStatusPill({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string; dot: string; label: string }> = {
    pending:     { bg: '#FFFBEB', color: '#92400E', dot: '#F59E0B', label: 'Pending' },
    negotiating: { bg: '#EFF6FF', color: '#1E3A8A', dot: '#3B82F6', label: 'Negotiating' },
    agreed:      { bg: '#F5F3FF', color: '#3730A3', dot: '#8B5CF6', label: 'Agreed' },
    signed:      { bg: '#F5F3FF', color: '#3730A3', dot: '#8B5CF6', label: 'Signed' },
    live:        { bg: '#ECFDF5', color: '#065F46', dot: '#10B981', label: 'Live' },
    completed:   { bg: '#EFF6FF', color: '#1E3A8A', dot: '#3B82F6', label: 'Completed' },
    declined:    { bg: '#FEF2F2', color: '#7F1D1D', dot: '#EF4444', label: 'Declined' },
  };
  const cfg = map[status] || map.pending;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: cfg.bg, color: cfg.color, padding: '3px 9px', borderRadius: '999px', fontSize: '0.6875rem', fontWeight: 600 }}>
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: cfg.dot }} />
      {cfg.label}
    </span>
  );
}

function CompliancePill({ check }: { check: ComplianceCheck | undefined }) {
  if (!check) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: '#F1F5F9', color: '#64748B', padding: '3px 9px', borderRadius: '999px', fontSize: '0.6875rem', fontWeight: 600 }}>
        <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#94A3B8' }} />
        No POE
      </span>
    );
  }
  const map = {
    verified: { bg: '#ECFDF5', color: '#065F46', dot: '#10B981', label: 'Verified' },
    submitted: { bg: '#FFFBEB', color: '#92400E', dot: '#F59E0B', label: 'Pending review' },
    flagged:   { bg: '#FEF2F2', color: '#7F1D1D', dot: '#EF4444', label: 'Flagged' },
  };
  const cfg = map[check.status];
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: cfg.bg, color: cfg.color, padding: '3px 9px', borderRadius: '999px', fontSize: '0.6875rem', fontWeight: 600 }}>
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: cfg.dot }} />
      {cfg.label}
    </span>
  );
}

function MetricBlock({ label, value, bar, sub }: { label: string; value: string; bar: string; sub?: string }) {
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

const OBJECTIVES = [
  { value: 'brand_awareness',   label: 'Brand Awareness' },
  { value: 'product_launch',    label: 'Product Launch' },
  { value: 'sales_promotion',   label: 'Sales Promotion' },
  { value: 'event_promotion',   label: 'Event Promotion' },
  { value: 'brand_reminder',    label: 'Brand Reminder' },
  { value: 'market_expansion',  label: 'Market Expansion' },
];

function CampaignCreatePanel({ form, setForm, onSave, saving, onClose }: {
  form: CampaignForm;
  setForm: React.Dispatch<React.SetStateAction<CampaignForm>>;
  onSave: () => void;
  saving: boolean;
  onClose: () => void;
}) {
  const isValid = form.name && form.start_date && form.end_date && form.total_budget;
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', justifyContent: 'flex-end' }}>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)' }} onClick={onClose} />
      <div style={{ position: 'relative', width: 540, background: '#fff', height: '100%', display: 'flex', flexDirection: 'column', boxShadow: '-8px 0 32px rgba(0,0,0,0.12)', fontFamily: "'Inter', sans-serif", overflowY: 'auto' }}>
        {/* Header */}
        <div style={{ padding: '20px 24px', borderBottom: '1px solid #F1F5F9', position: 'sticky', top: 0, background: '#fff', zIndex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <h2 style={{ fontSize: '1rem', fontWeight: 700, color: '#0F172A', margin: '0 0 2px' }}>New Campaign</h2>
              <p style={{ fontSize: '0.75rem', color: '#94A3B8', margin: 0 }}>Your agency will receive this and add boards to the plan</p>
            </div>
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8', fontSize: '1.125rem', padding: 4 }}>✕</button>
          </div>
        </div>

        {/* Form */}
        <div style={{ padding: '24px', flex: 1 }}>
          <Section label="Campaign details">
            <Field label="Campaign name *">
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. MTN Ramadan 2026" style={inputStyle} onFocus={focusStyle} onBlur={blurStyle} />
            </Field>
            <Field label="Brand / Client">
              <input value={form.client_name} onChange={e => setForm(f => ({ ...f, client_name: e.target.value }))} placeholder="e.g. MTN Nigeria" style={inputStyle} onFocus={focusStyle} onBlur={blurStyle} />
            </Field>
            <Field label="Campaign objective">
              <select value={form.objective} onChange={e => setForm(f => ({ ...f, objective: e.target.value }))} style={{ ...inputStyle, cursor: 'pointer' }}>
                {OBJECTIVES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </Field>
          </Section>

          <Section label="Budget & timeline">
            <Field label="Total budget (₦) *">
              <input type="number" value={form.total_budget} onChange={e => setForm(f => ({ ...f, total_budget: e.target.value }))} placeholder="e.g. 5000000" style={inputStyle} onFocus={focusStyle} onBlur={blurStyle} />
              {form.total_budget && (
                <p style={{ fontSize: '0.75rem', color: '#1B4F8A', fontWeight: 600, margin: '4px 0 0' }}>
                  Budget: {formatNaira(parseFloat(form.total_budget))}
                </p>
              )}
            </Field>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label="Start date *">
                <input type="date" value={form.start_date} onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))} style={inputStyle} onFocus={focusStyle} onBlur={blurStyle} />
              </Field>
              <Field label="End date *">
                <input type="date" value={form.end_date} min={form.start_date} onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))} style={inputStyle} onFocus={focusStyle} onBlur={blurStyle} />
              </Field>
            </div>
          </Section>

          <Section label="Target">
            <Field label="Target cities">
              <input value={form.target_cities} onChange={e => setForm(f => ({ ...f, target_cities: e.target.value }))} placeholder="e.g. Lagos, Abuja, Port Harcourt" style={inputStyle} onFocus={focusStyle} onBlur={blurStyle} />
              <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: '4px 0 0' }}>Your agency will use this to find available boards in these markets</p>
            </Field>
          </Section>

          {/* Next steps info */}
          <div style={{ background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 10, padding: '14px 16px', marginBottom: 24 }}>
            <p style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#1E3A8A', margin: '0 0 6px' }}>What happens next?</p>
            <ol style={{ margin: 0, paddingLeft: 18 }}>
              {[
                'Campaign is created in draft status',
                'Your agency gets notified and starts adding boards',
                'You approve the board selection and budget allocation',
                'Agency confirms bookings with board owners',
                'Campaign goes live — you track compliance here',
              ].map((s, i) => (
                <li key={i} style={{ fontSize: '0.8125rem', color: '#1E3A8A', marginBottom: 4, lineHeight: 1.5 }}>{s}</li>
              ))}
            </ol>
          </div>

          <button
            onClick={onSave}
            disabled={saving || !isValid}
            style={{ width: '100%', padding: '12px', background: saving || !isValid ? '#94A3B8' : '#1B4F8A', color: '#fff', border: 'none', borderRadius: 8, fontSize: '0.875rem', fontWeight: 600, cursor: saving || !isValid ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}
          >
            {saving ? 'Creating campaign...' : 'Create campaign'}
          </button>
        </div>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = { width: '100%', padding: '8px 11px', border: '1px solid #E2E8F0', borderRadius: 7, fontSize: '0.875rem', color: '#0F172A', outline: 'none', fontFamily: 'inherit', background: '#fff', boxSizing: 'border-box' };
function focusStyle(e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) { e.currentTarget.style.borderColor = '#1B4F8A'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(27,79,138,0.08)'; }
function blurStyle(e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) { e.currentTarget.style.borderColor = '#E2E8F0'; e.currentTarget.style.boxShadow = 'none'; }
function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return <div style={{ marginBottom: 24 }}><p style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.07em', margin: '0 0 12px' }}>{label}</p>{children}</div>;
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div style={{ marginBottom: 12 }}><label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#374151', marginBottom: 5 }}>{label}</label>{children}</div>;
}

// ── Main content ───────────────────────────────────────────────────────────

function ClientContent() {
  const router = useRouter();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [activeCampaign, setActiveCampaign] = useState<Campaign | null>(null);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [compliance, setCompliance] = useState<ComplianceCheck[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingCampaign, setLoadingCampaign] = useState(false);
  const [activeTab, setActiveTab] = useState<ClientTab>('overview');
  const [brandName, setBrandName] = useState('Your brand');
  const [unpaidInvoices, setUnpaidInvoices] = useState(0);
  const [exportingPOE, setExportingPOE] = useState<'pdf' | 'pptx' | null>(null);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [decliningId, setDecliningId] = useState<string | null>(null);
  const [showNewCampaign, setShowNewCampaign] = useState(false);
  const [campaignForm, setCampaignForm] = useState<CampaignForm>({ name: '', client_name: 'MTN Nigeria', total_budget: '', start_date: '', end_date: '', objective: 'brand_awareness', target_cities: '' });
  const [savingCampaign, setSavingCampaign] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const [photoLightbox, setPhotoLightbox] = useState<string | null>(null);
  const searchParams = useSearchParams();

  useEffect(() => {
    setActiveTab(parseClientTab(searchParams.get('tab')));
  }, [searchParams]);

  function goToTab(tab: ClientTab) {
    setActiveTab(tab);
    const path = tab === 'overview' ? '/dashboard/client' : `/dashboard/client?tab=${tab}`;
    router.push(path, { scroll: false });
  }

  function showToast(msg: string, type: 'success' | 'error' = 'success') {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }

  const fetchCampaignData = useCallback(async (campaignId: string) => {
    setLoadingCampaign(true);

    const { data: bookData } = await supabase
      .from('bookings')
      .select('id, status, start_date, end_date, offered_rate, agreed_rate, boards(id, name, address, city, state, format, latitude, longitude)')
      .eq('campaign_id', campaignId)
      .order('created_at');

    const bookList = (bookData as unknown as Booking[]) || [];
    setBookings(bookList);

    if (bookList.length > 0) {
      const { data: compData } = await supabase
        .from('compliance_checks')
        .select('*')
        .in('booking_id', bookList.map(b => b.id));
      setCompliance((compData as ComplianceCheck[]) || []);
    } else {
      setCompliance([]);
    }

    setLoadingCampaign(false);
  }, []);

  useEffect(() => { fetchCampaigns(); }, []);

  async function fetchCampaigns() {
    const profile = await getCurrentProfile();
    const userId = profile?.id;
    if (profile?.company_name || profile?.full_name) {
      setBrandName(profile.company_name || profile.full_name || 'Your brand');
    }

    let data: Campaign[] | null = null;

    if (userId) {
      const { data: byClient } = await supabase
        .from('campaigns')
        .select('*')
        .eq('client_id', userId)
        .order('created_at', { ascending: false });
      if (byClient?.length) {
        data = byClient as Campaign[];
      } else {
        const brand = profile?.company_name || profile?.full_name;
        let q = supabase.from('campaigns').select('*').order('created_at', { ascending: false });
        if (brand) q = q.ilike('client_name', `%${brand}%`);
        const { data: byName } = await q;
        data = (byName as Campaign[]) || [];
      }
    } else {
      const { data: all } = await supabase.from('campaigns').select('*').order('created_at', { ascending: false });
      data = (all as Campaign[]) || [];
    }

    if (data && data.length > 0) {
      setCampaigns(data);
      const first = data.find(c => c.status === 'active') || data[0];
      setActiveCampaign(first);
      await fetchCampaignData(first.id);
      await fetchInvoiceCounts(first.id, first.client_name);
    } else {
      setCampaigns([]);
      setActiveCampaign(null);
    }
    setLoading(false);
  }

  async function fetchInvoiceCounts(campaignId: string, clientName: string | null) {
    const { data } = await supabase
      .from('invoices')
      .select('id, status, due_date')
      .eq('campaign_id', campaignId);
    const due = ((data || []) as { status: string; due_date: string | null }[]).filter(inv => {
      if (inv.status === 'paid' || inv.status === 'cancelled' || inv.status === 'draft') return false;
      if (inv.status === 'sent' && inv.due_date && new Date(inv.due_date) < new Date()) return true;
      return inv.status === 'sent';
    });
    setUnpaidInvoices(due.length);
  }

  // Real-time: refresh compliance whenever a new POE is submitted for this campaign
  useEffect(() => {
    if (!activeCampaign) return;
    const channel = supabase
      .channel(`client-compliance-${activeCampaign.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'compliance_checks' }, () => {
        fetchCampaignData(activeCampaign.id);
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'bookings' }, () => {
        fetchCampaignData(activeCampaign.id);
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [activeCampaign?.id, fetchCampaignData]);

  async function switchCampaign(id: string) {
    const c = campaigns.find(c => c.id === id);
    if (!c) return;
    setActiveCampaign(c);
    setBookings([]);
    setCompliance([]);
    await fetchCampaignData(id);
    await fetchInvoiceCounts(id, c.client_name);
  }

  async function createCampaign() {
    if (!campaignForm.name || !campaignForm.start_date || !campaignForm.end_date || !campaignForm.total_budget) return;
    setSavingCampaign(true);

    const profile = await getCurrentProfile();
    const objectiveLabel = OBJECTIVES.find(o => o.value === campaignForm.objective)?.label || campaignForm.objective;
    const briefNotes = [
      `Objective: ${objectiveLabel}`,
      campaignForm.target_cities ? `Target cities: ${campaignForm.target_cities}` : null,
    ].filter(Boolean).join('. ');

    const payload: Record<string, unknown> = {
      name: campaignForm.name.trim(),
      client_name: campaignForm.client_name.trim() || brandName,
      total_budget: parseFloat(campaignForm.total_budget),
      start_date: campaignForm.start_date,
      end_date: campaignForm.end_date,
      status: 'draft',
      plan_notes: briefNotes,
    };
    if (profile?.id) payload.client_id = profile.id;

    let data: Campaign | null = null;
    let error: { message: string } | null = null;

    const withBrief = {
      ...payload,
      objective: campaignForm.objective,
      target_cities: campaignForm.target_cities.trim() || null,
    };
    const first = await supabase.from('campaigns').insert(withBrief).select().single();
    data = first.data as Campaign | null;
    error = first.error;

    if (error?.message?.includes('column')) {
      const fallback = await supabase.from('campaigns').insert(payload).select().single();
      data = fallback.data as Campaign | null;
      error = fallback.error;
    }

    if (error || !data) {
      showToast(error?.message?.includes('column') ? 'Run supabase-client-campaigns.sql in Supabase, then retry' : 'Failed to create campaign', 'error');
    } else {
      await createNotification({
        recipientRole: 'agency',
        type: 'campaign_request',
        title: `New campaign brief — ${campaignForm.name.trim()}`,
        body: `${campaignForm.client_name || brandName} submitted a brief (${objectiveLabel}, ${formatNaira(parseFloat(campaignForm.total_budget))} budget)`,
        link: `/dashboard/agency/campaigns/${data.id}`,
      });
      showToast(`"${campaignForm.name}" sent to your agency — they'll build your media plan`);
      setShowNewCampaign(false);
      setCampaignForm({
        name: '',
        client_name: brandName,
        total_budget: '',
        start_date: '',
        end_date: '',
        objective: 'brand_awareness',
        target_cities: '',
      });
      await fetchCampaigns();
      switchCampaign(data.id);
    }
    setSavingCampaign(false);
  }

  async function approveBooking(bookingId: string) {
    setApprovingId(bookingId);
    const booking = bookings.find(b => b.id === bookingId);
    const { error } = await supabase.from('bookings').update({ status: 'agreed' }).eq('id', bookingId);
    if (error) showToast('Failed to approve', 'error');
    else {
      setBookings(prev => prev.map(b => b.id === bookingId ? { ...b, status: 'agreed' } : b));
      await logActivity({
        entityType: 'booking',
        entityId: bookingId,
        campaignId: activeCampaign?.id,
        action: 'booking.approved_by_client',
        summary: `${brandName} approved ${booking?.boards?.name || 'board'}`,
        actorRole: 'client',
        actorName: brandName,
      });
      await createNotification({
        recipientRole: 'agency',
        type: 'plan_approved',
        title: `${brandName} approved a board`,
        body: `${booking?.boards?.name || 'Board'} approved for ${activeCampaign?.name || 'campaign'}`,
        link: `/dashboard/agency/campaigns/${activeCampaign?.id}`,
      });
      showToast('Board approved — agency notified');
    }
    setApprovingId(null);
  }

  async function declineBooking(bookingId: string) {
    setDecliningId(bookingId);
    const booking = bookings.find(b => b.id === bookingId);
    const { error } = await supabase.from('bookings').update({ status: 'declined' }).eq('id', bookingId);
    if (error) showToast('Failed to decline', 'error');
    else {
      setBookings(prev => prev.map(b => b.id === bookingId ? { ...b, status: 'declined' } : b));
      await logActivity({
        entityType: 'booking',
        entityId: bookingId,
        campaignId: activeCampaign?.id,
        action: 'booking.declined_by_client',
        summary: `${brandName} declined ${booking?.boards?.name || 'board'}`,
        actorRole: 'client',
        actorName: brandName,
      });
      await createNotification({
        recipientRole: 'agency',
        type: 'plan_approved',
        title: `${brandName} declined a board`,
        body: `${booking?.boards?.name || 'Board'} was declined from ${activeCampaign?.name || 'campaign'}`,
        link: `/dashboard/agency/campaigns/${activeCampaign?.id}`,
      });
      showToast('Board declined — agency notified');
    }
    setDecliningId(null);
  }

  async function approveAll() {
    const pendingIds = bookings.filter(b => b.status === 'pending' || b.status === 'negotiating').map(b => b.id);
    if (pendingIds.length === 0) return;
    const { error } = await supabase.from('bookings').update({ status: 'agreed' }).in('id', pendingIds);
    if (error) showToast('Failed to approve all', 'error');
    else {
      setBookings(prev => prev.map(b => pendingIds.includes(b.id) ? { ...b, status: 'agreed' } : b));
      for (const bid of pendingIds) {
        await logActivity({
          entityType: 'booking',
          entityId: bid,
          campaignId: activeCampaign?.id,
          action: 'booking.approved_by_client',
          summary: `${brandName} approved board (bulk plan approval)`,
          actorRole: 'client',
          actorName: brandName,
        });
      }
      if (activeCampaign?.id) {
        await logActivity({
          entityType: 'campaign',
          entityId: activeCampaign.id,
          campaignId: activeCampaign.id,
          action: 'campaign.status_changed',
          summary: `${brandName} approved full media plan (${pendingIds.length} boards)`,
          actorRole: 'client',
          actorName: brandName,
        });
      }
      await createNotification({
        recipientRole: 'agency',
        type: 'plan_approved',
        title: `${brandName} approved the full media plan`,
        body: `All ${pendingIds.length} boards approved for ${activeCampaign?.name || 'campaign'} — ready to proceed`,
        link: `/dashboard/agency/campaigns/${activeCampaign?.id}`,
      });
      showToast(`All ${pendingIds.length} boards approved — agency notified!`);
      // Fire-and-forget email to agency
      const agencyId = activeCampaign?.agency_id;
      if (agencyId) {
        const { data: { user: clientUser } } = await supabase.auth.getUser();
        fetch('/api/notify/email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'plan_approved',
            agencyId,
            clientId: clientUser?.id ?? '',
            campaignName: activeCampaign?.name ?? '',
            boardCount: pendingIds.length,
            campaignId: activeCampaign?.id ?? '',
          }),
        }).catch(() => {});
      }
    }
  }

  // ── Derived stats ──────────────────────────────────────────────────────

  const complianceMap: Record<string, ComplianceCheck> = {};
  compliance.forEach(c => { if (!complianceMap[c.booking_id]) complianceMap[c.booking_id] = c; });

  const liveBoards = bookings.filter(b => ['live', 'agreed', 'signed'].includes(b.status)).length;
  const verifiedCount = compliance.filter(c => c.status === 'verified').length;
  const compRate = bookings.length > 0 ? Math.round((verifiedCount / bookings.length) * 100) : 0;
  const daysLeft = activeCampaign ? getDaysRemaining(activeCampaign.end_date) : 0;

  async function downloadPOE(format: 'pdf' | 'pptx') {
    if (!activeCampaign) return;
    setExportingPOE(format);
    try {
      const res = await fetch('/api/poe-deck', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaignId: activeCampaign.id, format }),
      });
      if (!res.ok) throw new Error('Failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `POE-${activeCampaign.name.replace(/\s+/g, '-')}.${format === 'pdf' ? 'pdf' : 'pptx'}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch { /* silent */ } finally {
      setExportingPOE(null);
    }
  }
  const estImpressions = liveBoards * 15000;

  const attentionBoards = bookings.filter(b => {
    const check = complianceMap[b.id];
    return !check || check.status === 'flagged';
  });

  const committedSpend = bookings
    .filter(b => ['agreed','signed','live','completed'].includes(b.status))
    .reduce((s, b) => s + (b.agreed_rate || b.offered_rate) * (activeCampaign?.end_date && activeCampaign?.start_date
      ? Math.max(1, Math.round((new Date(activeCampaign.end_date).getTime() - new Date(activeCampaign.start_date).getTime()) / (1000*60*60*24*30)))
      : 1), 0);
  const totalBudget = activeCampaign?.total_budget || 0;
  const budgetUtilisation = totalBudget > 0 ? Math.min(100, Math.round((committedSpend / totalBudget) * 100)) : 0;
  const mapBoards = bookings.filter(b => b.boards?.latitude && b.boards?.longitude);
  const planBookings = bookings.filter(b => b.status === 'pending' || b.status === 'negotiating');
  const planValue = planBookings.reduce((s, b) => s + (b.offered_rate || 0), 0);
  const agreedBoards = bookings.filter(b => ['agreed', 'signed', 'live', 'completed'].includes(b.status)).length;

  const journeySteps = useMemo(() => buildCampaignJourney({
    hasBrief: !!(activeCampaign?.objective || activeCampaign?.plan_notes || activeCampaign?.target_cities),
    pendingApprovals: planBookings.length,
    agreedBoards,
    liveBoards,
    verifiedPoe: verifiedCount,
    totalBoards: bookings.length,
    unpaidInvoices,
  }), [activeCampaign, planBookings.length, agreedBoards, liveBoards, verifiedCount, bookings.length, unpaidInvoices]);

  const clientActions = useMemo((): ClientAction[] => {
    const actions: ClientAction[] = [];
    if (planBookings.length > 0) {
      actions.push({
        id: 'approve-plan',
        title: `Approve media plan (${planBookings.length} board${planBookings.length > 1 ? 's' : ''})`,
        description: `${formatNaira(planValue)} proposed spend · Review and confirm before your agency books sites`,
        cta: 'Review proposal',
        urgency: 'high',
        onClick: () => goToTab('plan'),
      });
    }
    if (unpaidInvoices > 0) {
      actions.push({
        id: 'pay-invoice',
        title: `${unpaidInvoices} invoice${unpaidInvoices > 1 ? 's' : ''} awaiting payment`,
        description: 'Settle outstanding invoices to keep your campaign on schedule',
        cta: 'Pay now',
        urgency: 'high',
        onClick: () => goToTab('billing'),
      });
    }
    if (attentionBoards.length > 0 && planBookings.length === 0) {
      actions.push({
        id: 'compliance',
        title: `${attentionBoards.length} board${attentionBoards.length > 1 ? 's' : ''} need POE review`,
        description: 'Proof of posting is missing or flagged — verify your ads went live',
        cta: 'View compliance',
        urgency: 'medium',
        onClick: () => goToTab('compliance'),
      });
    }
    if (bookings.length === 0 && activeCampaign?.status === 'draft') {
      actions.push({
        id: 'waiting-agency',
        title: 'Waiting for your agency',
        description: 'Your brief is in — they will add boards to your media plan shortly',
        cta: 'View brief',
        urgency: 'low',
        onClick: () => goToTab('overview'),
      });
    }
    return actions;
  }, [planBookings.length, planValue, unpaidInvoices, attentionBoards.length, bookings.length, activeCampaign?.status]);

  // ── Render ─────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '50vh' }}>
        <div style={{ width: 28, height: 28, border: '2px solid #E2E8F0', borderTopColor: '#1B4F8A', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (!activeCampaign) {
    return (
      <div style={{ fontFamily: "'Inter', -apple-system, sans-serif" }}>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } } @keyframes fadeUp { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }`}</style>
        <div style={{ textAlign: 'center', padding: '5rem 2rem' }}>
          <div style={{ width: 56, height: 56, background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#1B4F8A" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/>
            </svg>
          </div>
          <p style={{ fontSize: '1rem', fontWeight: 700, color: '#0F172A', margin: '0 0 6px' }}>Start your first OOH campaign</p>
          <p style={{ fontSize: '0.8125rem', color: '#94A3B8', margin: '0 0 24px', maxWidth: 360, marginLeft: 'auto', marginRight: 'auto' }}>
            Submit a brief with your budget, cities, and objective. Your agency builds the media plan — you approve boards, track compliance, and pay invoices here.
          </p>
          <button
            onClick={() => setShowNewCampaign(true)}
            style={{ background: '#1B4F8A', color: '#fff', border: 'none', padding: '11px 24px', borderRadius: '10px', fontSize: '0.875rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
          >
            + Create your first campaign
          </button>
        </div>
        {showNewCampaign && <CampaignCreatePanel form={campaignForm} setForm={setCampaignForm} onSave={createCampaign} saving={savingCampaign} onClose={() => setShowNewCampaign(false)} />}
      </div>
    );
  }

  return (
    <div style={{ fontFamily: "'Inter', -apple-system, sans-serif" }}>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeUp { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:translateY(0); } }
        .fade { animation: fadeUp 0.25s ease forwards; }
        .board-row:hover { background: #F5F8FF; }
        .attn-row:hover { opacity: 0.85; }
      `}</style>

      {/* ── Welcome strip ── */}
      <div className="welcome-strip" style={{
        background: '#fff', border: '1px solid #E8EDF2', borderRadius: 16,
        padding: '18px 24px', marginBottom: '1.5rem',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
      }}>
        {/* Left: avatar + greeting */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{
            width: 46, height: 46, borderRadius: 13, flexShrink: 0,
            background: 'linear-gradient(135deg, #1B4F8A 0%, #7C3AED 100%)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <span style={{ fontSize: '1.125rem', fontWeight: 800, color: '#fff', lineHeight: 1 }}>
              {brandName.charAt(0).toUpperCase()}
            </span>
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
              <h1 style={{ fontSize: '1.0625rem', fontWeight: 700, color: '#0F172A', margin: 0, letterSpacing: '-0.02em' }}>
                Welcome back, {brandName}
              </h1>
              <span style={{ fontSize: '0.625rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#1B4F8A', background: '#EFF6FF', padding: '2px 8px', borderRadius: 999 }}>
                Client Portal
              </span>
            </div>
            <p style={{ fontSize: '0.8125rem', color: '#94A3B8', margin: 0 }}>
              Approve boards · Track compliance · Manage invoices
            </p>
          </div>
        </div>

        {/* Right: live stats */}
        {!loadingCampaign && (
          <div className="welcome-stats" style={{ display: 'flex', alignItems: 'center', gap: 24, flexShrink: 0 }}>
            <div style={{ textAlign: 'center' }}>
              <p style={{ fontSize: '1.5rem', fontWeight: 800, color: '#1B4F8A', fontFamily: 'monospace', margin: '0 0 2px', letterSpacing: '-0.03em' }}>{liveBoards}</p>
              <p style={{ fontSize: '0.625rem', fontWeight: 600, color: '#94A3B8', margin: 0, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Live boards</p>
            </div>
            <div style={{ width: 1, height: 36, background: '#F1F5F9' }} />
            <div style={{ textAlign: 'center' }}>
              <p style={{ fontSize: '1.5rem', fontWeight: 800, fontFamily: 'monospace', margin: '0 0 2px', letterSpacing: '-0.03em', color: daysLeft > 14 ? '#10B981' : daysLeft > 0 ? '#F59E0B' : '#EF4444' }}>
                {daysLeft > 0 ? daysLeft : '—'}
              </p>
              <p style={{ fontSize: '0.625rem', fontWeight: 600, color: '#94A3B8', margin: 0, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Days left</p>
            </div>
            {bookings.length > 0 && (
              <>
                <div style={{ width: 1, height: 36, background: '#F1F5F9' }} />
                <div style={{ textAlign: 'center' }}>
                  <p style={{ fontSize: '1.5rem', fontWeight: 800, fontFamily: 'monospace', margin: '0 0 2px', letterSpacing: '-0.03em', color: compRate >= 90 ? '#10B981' : compRate >= 70 ? '#F59E0B' : '#EF4444' }}>
                    {compRate}%
                  </p>
                  <p style={{ fontSize: '0.625rem', fontWeight: 600, color: '#94A3B8', margin: 0, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Compliance</p>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* ── Page header ── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1.75rem', gap: 16 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
            <h2 style={{ fontSize: '1.375rem', fontWeight: 700, color: '#0F172A', letterSpacing: '-0.025em', margin: 0 }}>
              {activeCampaign.name}
            </h2>
            <StatusPill status={activeCampaign.status} />
          </div>
          <p style={{ fontSize: '0.8125rem', color: '#94A3B8', margin: 0 }}>
            {activeCampaign.client_name || brandName} · {formatDate(activeCampaign.start_date)} → {formatDate(activeCampaign.end_date)}
            {totalBudget > 0 && <> · Budget: <span style={{ color: '#1B4F8A', fontWeight: 600 }}>{formatNaira(totalBudget)}</span></>}
            {(activeCampaign.objective || activeCampaign.target_cities) && (
              <> · {OBJECTIVE_LABELS[activeCampaign.objective || ''] || ''}{activeCampaign.target_cities ? ` · ${activeCampaign.target_cities}` : ''}</>
            )}
          </p>
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', flexShrink: 0 }}>
          {campaigns.length > 1 && (
            <select
              value={activeCampaign.id}
              onChange={e => switchCampaign(e.target.value)}
              style={{ padding: '8px 12px', border: '1px solid #E2E8F0', borderRadius: '8px', fontSize: '0.8125rem', color: '#0F172A', outline: 'none', background: '#fff', fontFamily: 'inherit', cursor: 'pointer' }}
            >
              {campaigns.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          )}
          <button
            onClick={() => setShowNewCampaign(true)}
            style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#1B4F8A', color: '#fff', border: 'none', padding: '9px 16px', borderRadius: '9px', fontSize: '0.8125rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}
          >
            <span style={{ fontSize: '1rem', lineHeight: 1 }}>+</span> New Campaign
          </button>
        </div>
      </div>

      {/* ── Tab nav ── */}
      <div className="resp-tabs" style={{ display: 'flex', gap: 4, background: '#F1F5F9', padding: 4, borderRadius: 10, flexWrap: 'wrap', marginBottom: '1.5rem' }}>
        {[
          { key: 'overview' as ClientTab,      label: 'Overview',              badge: 0 },
          { key: 'plan' as ClientTab,          label: 'Proposals',             badge: planBookings.length },
          { key: 'board-status' as ClientTab,  label: `Boards (${bookings.length})`, badge: 0 },
          { key: 'map' as ClientTab,           label: 'Map',                   badge: 0 },
          { key: 'compliance' as ClientTab,    label: 'Compliance',          badge: attentionBoards.length },
          { key: 'impressions' as ClientTab,   label: 'Performance',         badge: 0 },
          { key: 'billing' as ClientTab,       label: 'Billing',             badge: unpaidInvoices },
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => goToTab(tab.key)}
            style={{
              padding: '6px 14px', borderRadius: 7, border: 'none',
              background: activeTab === tab.key ? '#fff' : 'transparent',
              color: activeTab === tab.key ? '#0F172A' : '#64748B',
              fontSize: '0.8125rem', fontWeight: activeTab === tab.key ? 600 : 400,
              cursor: 'pointer', fontFamily: 'inherit',
              boxShadow: activeTab === tab.key ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
              display: 'flex', alignItems: 'center', gap: 5, position: 'relative',
            }}
          >
            {tab.label}
            {tab.badge > 0 && (
              <span style={{ background: '#FFFBEB', color: '#D97706', borderRadius: '999px', padding: '1px 6px', fontSize: '0.625rem', fontWeight: 700, lineHeight: '16px' }}>
                {tab.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ═══ TAB: OVERVIEW ═══ */}
      {activeTab === 'overview' && <>

      <ClientActionsPanel actions={clientActions} />
      <CampaignJourneyStrip steps={journeySteps} />

      {/* ── Metric cards ── */}
      <div className="resp-grid-4" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '1.75rem' }}>
        <MetricBlock
          label="Active Boards"
          value={loadingCampaign ? '—' : String(liveBoards)}
          bar="#1B4F8A"
          sub={`${bookings.length} boards in plan`}
        />
        <MetricBlock
          label="Compliance Rate"
          value={loadingCampaign ? '—' : `${compRate}%`}
          bar={compRate >= 90 ? '#10B981' : compRate >= 70 ? '#F59E0B' : '#EF4444'}
          sub={`${verifiedCount} of ${bookings.length} verified`}
        />
        <MetricBlock
          label="Est. Daily Impressions"
          value={loadingCampaign ? '—' : formatImpressions(estImpressions)}
          bar="#8B5CF6"
          sub={`Estimated · ${liveBoards} live board${liveBoards !== 1 ? 's' : ''}`}
        />
        <MetricBlock
          label="Days Remaining"
          value={daysLeft > 0 ? String(daysLeft) : 'Ended'}
          bar={daysLeft > 14 ? '#10B981' : daysLeft > 0 ? '#F59E0B' : '#EF4444'}
          sub={daysLeft > 0 ? `Ends ${formatDateShort(activeCampaign.end_date)}` : `Ended ${formatDateShort(activeCampaign.end_date)}`}
        />
      </div>

      {/* ── Budget tracker ── */}
      {totalBudget > 0 && !loadingCampaign && (
        <div style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: 12, padding: '16px 20px', marginBottom: '1.25rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
            <div>
              <p style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0F172A', margin: '0 0 2px' }}>Budget utilisation</p>
              <p style={{ fontSize: '0.75rem', color: '#94A3B8', margin: 0 }}>Committed spend vs. total campaign budget</p>
            </div>
            <div style={{ textAlign: 'right' }}>
              <p style={{ fontSize: '1.25rem', fontWeight: 800, color: budgetUtilisation > 90 ? '#EF4444' : '#1B4F8A', fontFamily: 'monospace', margin: '0 0 2px', letterSpacing: '-0.02em' }}>
                {budgetUtilisation}%
              </p>
              <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: 0 }}>of budget committed</p>
            </div>
          </div>
          <div style={{ height: 10, background: '#F1F5F9', borderRadius: 999, overflow: 'hidden', marginBottom: 8 }}>
            <div style={{ height: '100%', borderRadius: 999, background: budgetUtilisation > 90 ? '#EF4444' : budgetUtilisation > 70 ? '#F59E0B' : '#1B4F8A', width: `${budgetUtilisation}%`, transition: 'width 1s ease' }} />
          </div>
          <div className="resp-grid-3" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
            {[
              { label: 'Total budget',       value: formatNaira(totalBudget),              color: '#0F172A' },
              { label: 'Committed spend',    value: formatNaira(committedSpend),           color: '#1B4F8A' },
              { label: 'Remaining',          value: formatNaira(Math.max(0, totalBudget - committedSpend)), color: totalBudget - committedSpend < 0 ? '#EF4444' : '#10B981' },
            ].map(item => (
              <div key={item.label} style={{ background: '#F8FAFC', borderRadius: 8, padding: '10px 12px' }}>
                <p style={{ fontSize: '0.6875rem', color: '#94A3B8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 4px' }}>{item.label}</p>
                <p style={{ fontSize: '0.9375rem', fontWeight: 700, color: item.color, fontFamily: 'monospace', margin: 0 }}>{item.value}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Compliance progress bar ── */}
      {!loadingCampaign && bookings.length > 0 && (
        <div style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: '10px', padding: '14px 20px', marginBottom: '1.25rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
            <span style={{ fontSize: '0.8125rem', fontWeight: 500, color: '#374151' }}>Proof of posting compliance</span>
            <span style={{ fontSize: '0.8125rem', fontWeight: 700, color: compRate >= 90 ? '#059669' : compRate >= 70 ? '#D97706' : '#DC2626' }}>{compRate}%</span>
          </div>
          <div style={{ height: '8px', background: '#F1F5F9', borderRadius: '999px', overflow: 'hidden' }}>
            <div style={{
              height: '100%', borderRadius: '999px', transition: 'width 0.8s ease',
              width: `${compRate}%`,
              background: compRate >= 90 ? '#10B981' : compRate >= 70 ? '#F59E0B' : '#EF4444',
            }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '6px' }}>
            <span style={{ fontSize: '0.6875rem', color: '#94A3B8' }}>Target: 95%</span>
            <span style={{ fontSize: '0.6875rem', color: '#94A3B8' }}>{verifiedCount} of {bookings.length} boards verified</span>
          </div>
        </div>
      )}

      {/* ── Boards needing attention ── */}
      {!loadingCampaign && attentionBoards.length > 0 && (
        <div style={{ marginBottom: '1.25rem' }}>
          <p style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.07em', margin: '0 0 8px' }}>
            Boards needing attention
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {attentionBoards.slice(0, 4).map((b, i) => {
              const check = complianceMap[b.id];
              const isFlagged = check?.status === 'flagged';
              return (
                <div
                  key={b.id}
                  className="attn-row fade"
                  style={{
                    padding: '10px 14px',
                    background: isFlagged ? '#FEF2F2' : '#FFFBEB',
                    border: `1px solid ${isFlagged ? '#FECACA' : '#FDE68A'}`,
                    borderRadius: '10px',
                    display: 'flex', alignItems: 'center', gap: '10px',
                    transition: 'opacity 0.15s',
                    animationDelay: `${i * 0.04}s`,
                  }}
                >
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: isFlagged ? '#EF4444' : '#F59E0B', flexShrink: 0 }} />
                  <span style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0F172A' }}>{b.boards?.name || 'Unknown board'}</span>
                  {b.boards?.city && (
                    <span style={{ fontSize: '0.75rem', color: '#64748B' }}>{b.boards.city}</span>
                  )}
                  <span style={{ marginLeft: 'auto', fontSize: '0.75rem', color: isFlagged ? '#7F1D1D' : '#92400E', fontWeight: 600 }}>
                    {isFlagged ? '⚑ Flagged — needs review' : 'Overdue proof of posting'}
                  </span>
                </div>
              );
            })}
            {attentionBoards.length > 4 && (
              <p style={{ fontSize: '0.75rem', color: '#94A3B8', margin: '4px 0 0', textAlign: 'center' }}>
                +{attentionBoards.length - 4} more boards pending
              </p>
            )}
          </div>
        </div>
      )}

      {/* ── All boards table ── */}
      <div className="table-scroll" style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: '12px', overflow: 'hidden' }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid #F1F5F9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h2 style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#0F172A', margin: '0 0 2px' }}>Active boards</h2>
            <p style={{ fontSize: '0.75rem', color: '#94A3B8', margin: 0 }}>Inventory health across all locations</p>
          </div>
          {bookings.length > 0 && (
            <div style={{ textAlign: 'right' }}>
              <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: '0 0 2px', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>Overall compliance</p>
              <span style={{ fontSize: '1.25rem', fontWeight: 700, color: compRate >= 90 ? '#10B981' : compRate >= 70 ? '#F59E0B' : '#EF4444', fontFamily: 'monospace' }}>
                {compRate}%
              </span>
            </div>
          )}
        </div>

        {loadingCampaign ? (
          <div style={{ padding: '3rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px' }}>
            <div style={{ width: 22, height: 22, border: '2px solid #E2E8F0', borderTopColor: '#1B4F8A', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
            <span style={{ fontSize: '0.8125rem', color: '#94A3B8' }}>Loading boards...</span>
          </div>
        ) : bookings.length === 0 ? (
          <div style={{ padding: '5rem 2rem', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <div style={{ width: 52, height: 52, background: '#F5F3FF', borderRadius: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#7C3AED" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
            </div>
            <p style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#0F172A', margin: '0 0 6px' }}>No boards in this campaign yet</p>
            <p style={{ fontSize: '0.8125rem', color: '#94A3B8', margin: 0 }}>Your agency will add boards to this campaign — they will appear here</p>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#F8FAFC' }}>
                {['Board', 'Location', 'Format', 'Booking', 'Compliance', 'Last check'].map(h => (
                  <th key={h} style={{ padding: '10px 16px', fontSize: '0.6875rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.07em', textAlign: 'left', borderBottom: '1px solid #F1F5F9', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {bookings.map((booking, i) => {
                const check = complianceMap[booking.id];
                return (
                  <tr
                    key={booking.id}
                    className="board-row fade"
                    style={{ borderBottom: i < bookings.length - 1 ? '1px solid #F8FAFC' : 'none', transition: 'background 0.1s', animationDelay: `${i * 0.04}s` }}
                  >
                    <td style={{ padding: '12px 16px' }}>
                      <p style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0F172A', margin: '0 0 2px' }}>
                        {booking.boards?.name || '—'}
                      </p>
                      {booking.boards?.address && (
                        <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: 0, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {booking.boards.address}
                        </p>
                      )}
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: '0.8125rem', color: '#475569', whiteSpace: 'nowrap' }}>
                      {[booking.boards?.city, booking.boards?.state].filter(Boolean).join(', ') || '—'}
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <span style={{ fontSize: '0.6875rem', fontWeight: 600, color: '#475569', background: '#F1F5F9', padding: '2px 7px', borderRadius: '4px', whiteSpace: 'nowrap' }}>
                        {FORMAT_LABELS[booking.boards?.format] || booking.boards?.format || '—'}
                      </span>
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <BookingStatusPill status={booking.status} />
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <CompliancePill check={check} />
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: '0.75rem', color: '#94A3B8', whiteSpace: 'nowrap' }}>
                      {check
                        ? formatDateShort(check.submitted_at)
                        : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      </>}

      {/* ═══ TAB: BOARD STATUS ═══ */}
      {activeTab === 'board-status' && (
        <div>
          {loadingCampaign ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '4rem', gap: 12 }}>
              <div style={{ width: 22, height: 22, border: '2px solid #E2E8F0', borderTopColor: '#1B4F8A', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
              <span style={{ fontSize: '0.8125rem', color: '#94A3B8' }}>Loading boards...</span>
            </div>
          ) : bookings.length === 0 ? (
            <div style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: 12, padding: '5rem 2rem', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <div style={{ width: 52, height: 52, background: '#F5F3FF', borderRadius: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#7C3AED" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
              </div>
              <p style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#0F172A', margin: '0 0 6px' }}>No boards in this campaign</p>
              <p style={{ fontSize: '0.8125rem', color: '#94A3B8', margin: 0 }}>Your agency will add boards here once they start booking locations</p>
            </div>
          ) : (
            <>
              {/* Status summary row */}
              <div className="resp-grid-4" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: '1.25rem' }}>
                {[
                  { label: 'Live boards',    count: bookings.filter(b => b.status === 'live').length,                               color: '#10B981', bg: '#ECFDF5' },
                  { label: 'Agreed / Signed', count: bookings.filter(b => ['agreed','signed'].includes(b.status)).length,          color: '#8B5CF6', bg: '#F5F3FF' },
                  { label: 'Negotiating',     count: bookings.filter(b => ['pending','negotiating'].includes(b.status)).length,     color: '#F59E0B', bg: '#FFFBEB' },
                  { label: 'Completed',       count: bookings.filter(b => b.status === 'completed').length,                        color: '#3B82F6', bg: '#EFF6FF' },
                ].map(s => (
                  <div key={s.label} style={{ background: s.bg, borderRadius: 12, padding: '16px 18px' }}>
                    <p style={{ fontSize: '1.75rem', fontWeight: 800, color: s.color, fontFamily: 'monospace', margin: '0 0 4px', letterSpacing: '-0.03em' }}>{s.count}</p>
                    <p style={{ fontSize: '0.6875rem', fontWeight: 600, color: s.color, margin: 0, opacity: 0.8 }}>{s.label}</p>
                  </div>
                ))}
              </div>

              {/* Board cards grid */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14 }}>
                {bookings.map((booking, i) => {
                  const check = complianceMap[booking.id];
                  const daysLeft = booking.end_date ? getDaysRemaining(booking.end_date) : null;
                  const isLive = ['live','agreed','signed'].includes(booking.status);
                  const statusColors: Record<string, { border: string; dot: string; label: string }> = {
                    live:        { border: '#10B981', dot: '#10B981', label: 'Live' },
                    agreed:      { border: '#8B5CF6', dot: '#8B5CF6', label: 'Agreed' },
                    signed:      { border: '#8B5CF6', dot: '#8B5CF6', label: 'Signed' },
                    pending:     { border: '#F59E0B', dot: '#F59E0B', label: 'Pending' },
                    negotiating: { border: '#3B82F6', dot: '#3B82F6', label: 'Negotiating' },
                    completed:   { border: '#94A3B8', dot: '#94A3B8', label: 'Completed' },
                    declined:    { border: '#EF4444', dot: '#EF4444', label: 'Declined' },
                  };
                  const sc = statusColors[booking.status] || statusColors.pending;
                  return (
                    <div key={booking.id} className="fade" style={{ background: '#fff', border: `1px solid ${isLive ? sc.border + '40' : '#E8EDF2'}`, borderRadius: 12, overflow: 'hidden', animationDelay: `${i * 0.04}s`, borderTop: `3px solid ${sc.border}` }}>
                      {/* Card header */}
                      <div style={{ padding: '14px 16px', borderBottom: '1px solid #F1F5F9' }}>
                        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <p style={{ fontSize: '0.875rem', fontWeight: 700, color: '#0F172A', margin: '0 0 3px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {booking.boards?.name || '—'}
                            </p>
                            <p style={{ fontSize: '0.75rem', color: '#94A3B8', margin: 0 }}>
                              {[booking.boards?.city, booking.boards?.state].filter(Boolean).join(', ') || '—'}
                            </p>
                          </div>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: sc.dot + '18', color: sc.dot, padding: '3px 9px', borderRadius: 999, fontSize: '0.6875rem', fontWeight: 700, flexShrink: 0 }}>
                            <span style={{ width: 5, height: 5, borderRadius: '50%', background: sc.dot }} />
                            {sc.label}
                          </span>
                        </div>
                      </div>

                      {/* Card body */}
                      <div style={{ padding: '12px 16px' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 16px' }}>
                          <div>
                            <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: '0 0 2px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Format</p>
                            <p style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#0F172A', margin: 0 }}>{FORMAT_LABELS[booking.boards?.format] || '—'}</p>
                          </div>
                          <div>
                            <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: '0 0 2px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Rate</p>
                            <p style={{ fontSize: '0.8125rem', fontWeight: 700, color: '#1B4F8A', margin: 0, fontFamily: 'monospace' }}>
                              ₦{((booking.agreed_rate || booking.offered_rate) / 1000).toFixed(0)}K/mo
                            </p>
                          </div>
                          {booking.start_date && (
                            <div>
                              <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: '0 0 2px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Start</p>
                              <p style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#0F172A', margin: 0 }}>{formatDateShort(booking.start_date)}</p>
                            </div>
                          )}
                          {booking.end_date && (
                            <div>
                              <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: '0 0 2px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>End</p>
                              <p style={{ fontSize: '0.8125rem', fontWeight: 600, color: daysLeft !== null && daysLeft < 7 && daysLeft > 0 ? '#EF4444' : '#0F172A', margin: 0 }}>
                                {formatDateShort(booking.end_date)}
                                {daysLeft !== null && daysLeft > 0 && daysLeft <= 30 && (
                                  <span style={{ fontSize: '0.6875rem', color: daysLeft < 7 ? '#EF4444' : '#94A3B8', marginLeft: 5 }}>({daysLeft}d left)</span>
                                )}
                              </p>
                            </div>
                          )}
                        </div>

                        {/* Compliance badge */}
                        <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid #F8FAFC', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <span style={{ fontSize: '0.6875rem', color: '#94A3B8', fontWeight: 600 }}>POE Status</span>
                          <CompliancePill check={check} />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}

      {/* ═══ TAB: COMPLIANCE REPORT ═══ */}
      {activeTab === 'compliance' && (
        <div>
          {/* Summary header */}
          <div className="resp-grid-4" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: '1.25rem' }}>
            {[
              { label: 'Total submissions',  count: compliance.length,                                          color: '#0F172A', bg: '#F8FAFC',  border: '#E8EDF2' },
              { label: 'Verified',           count: compliance.filter(c => c.status === 'verified').length,    color: '#065F46', bg: '#ECFDF5',  border: '#A7F3D0' },
              { label: 'Pending review',     count: compliance.filter(c => c.status === 'submitted').length,   color: '#92400E', bg: '#FFFBEB',  border: '#FDE68A' },
              { label: 'Flagged',            count: compliance.filter(c => c.status === 'flagged').length,     color: '#991B1B', bg: '#FEF2F2',  border: '#FECACA' },
            ].map(s => (
              <div key={s.label} style={{ background: s.bg, border: `1px solid ${s.border}`, borderRadius: 12, padding: '16px 18px' }}>
                <p style={{ fontSize: '1.75rem', fontWeight: 800, color: s.color, fontFamily: 'monospace', margin: '0 0 4px', letterSpacing: '-0.03em' }}>{s.count}</p>
                <p style={{ fontSize: '0.6875rem', fontWeight: 600, color: s.color, margin: 0, opacity: 0.8 }}>{s.label}</p>
              </div>
            ))}
          </div>

          {/* Compliance rate bar */}
          <div style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: 12, padding: '16px 20px', marginBottom: '1.25rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <div>
                <p style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0F172A', margin: '0 0 2px' }}>Overall compliance rate</p>
                <p style={{ fontSize: '0.75rem', color: '#94A3B8', margin: 0 }}>Target: 95% verified before campaign ends</p>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <button
                  onClick={() => downloadPOE('pdf')}
                  disabled={exportingPOE !== null}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 8, background: exportingPOE === 'pdf' ? '#E2E8F0' : '#1B4F8A', color: exportingPOE === 'pdf' ? '#94A3B8' : '#fff', fontSize: '0.75rem', fontWeight: 700, border: 'none', cursor: exportingPOE !== null ? 'not-allowed' : 'pointer', transition: 'background 0.15s' }}>
                  {exportingPOE === 'pdf' ? '⏳ Generating…' : '⬇ POE PDF'}
                </button>
                <button
                  onClick={() => downloadPOE('pptx')}
                  disabled={exportingPOE !== null}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 8, background: exportingPOE === 'pptx' ? '#E2E8F0' : '#0F172A', color: exportingPOE === 'pptx' ? '#94A3B8' : '#fff', fontSize: '0.75rem', fontWeight: 700, border: 'none', cursor: exportingPOE !== null ? 'not-allowed' : 'pointer', transition: 'background 0.15s' }}>
                  {exportingPOE === 'pptx' ? '⏳ Generating…' : '⬇ POE Deck'}
                </button>
                <span style={{ fontSize: '2rem', fontWeight: 800, fontFamily: 'monospace', color: compRate >= 90 ? '#10B981' : compRate >= 70 ? '#F59E0B' : '#EF4444', letterSpacing: '-0.03em' }}>
                  {compRate}%
                </span>
              </div>
            </div>
            <div style={{ height: 10, background: '#F1F5F9', borderRadius: 999, overflow: 'hidden' }}>
              <div style={{ height: '100%', borderRadius: 999, width: `${compRate}%`, background: compRate >= 90 ? '#10B981' : compRate >= 70 ? '#F59E0B' : '#EF4444', transition: 'width 1s ease' }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
              <span style={{ fontSize: '0.6875rem', color: '#94A3B8' }}>{verifiedCount} of {bookings.length} boards verified</span>
              <span style={{ fontSize: '0.6875rem', color: '#94A3B8' }}>{bookings.length - verifiedCount} remaining</span>
            </div>
          </div>

          {/* Per-board compliance table */}
          <div className="table-scroll" style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ padding: '14px 20px', borderBottom: '1px solid #F1F5F9' }}>
              <h2 style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#0F172A', margin: '0 0 2px' }}>Board-by-board compliance</h2>
              <p style={{ fontSize: '0.75rem', color: '#94A3B8', margin: 0 }}>Proof of posting status for every board in this campaign</p>
            </div>
            {bookings.length === 0 ? (
              <div style={{ padding: '3rem', textAlign: 'center' }}>
                <p style={{ fontSize: '0.875rem', color: '#94A3B8', margin: 0 }}>No boards in this campaign</p>
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#F8FAFC' }}>
                    {['Board', 'Location', 'Booking status', 'POE status', 'Last submitted', 'Notes', 'Photo'].map(h => (
                      <th key={h} style={{ padding: '10px 16px', fontSize: '0.6875rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.07em', textAlign: 'left', borderBottom: '1px solid #F1F5F9', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {bookings.map((booking, i) => {
                    const check = complianceMap[booking.id];
                    const isLast = i === bookings.length - 1;
                    return (
                      <tr key={booking.id} className="board-row fade" style={{ borderBottom: isLast ? 'none' : '1px solid #F8FAFC', animationDelay: `${i * 0.04}s`, background: check?.status === 'flagged' ? '#FFF8F8' : '#fff' }}>
                        <td style={{ padding: '13px 16px' }}>
                          <p style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0F172A', margin: '0 0 2px' }}>{booking.boards?.name || '—'}</p>
                          <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: 0 }}>{FORMAT_LABELS[booking.boards?.format] || '—'}</p>
                        </td>
                        <td style={{ padding: '13px 16px', fontSize: '0.8125rem', color: '#475569', whiteSpace: 'nowrap' }}>
                          {[booking.boards?.city, booking.boards?.state].filter(Boolean).join(', ') || '—'}
                        </td>
                        <td style={{ padding: '13px 16px' }}>
                          <BookingStatusPill status={booking.status} />
                        </td>
                        <td style={{ padding: '13px 16px' }}>
                          <CompliancePill check={check} />
                        </td>
                        <td style={{ padding: '13px 16px', fontSize: '0.8125rem', color: '#475569', whiteSpace: 'nowrap' }}>
                          {check ? formatDate(check.submitted_at) : <span style={{ color: '#CBD5E1' }}>Not submitted</span>}
                        </td>
                        <td style={{ padding: '13px 16px', fontSize: '0.8125rem', color: check?.notes ? '#374151' : '#CBD5E1', maxWidth: 200 }}>
                          {check?.notes || 'No notes'}
                        </td>
                        <td style={{ padding: '13px 16px' }}>
                          {check?.photo_url ? (
                            <button
                              onClick={() => setPhotoLightbox(check.photo_url!)}
                              style={{ background: '#EFF6FF', color: '#1B4F8A', border: '1px solid #BFDBFE', borderRadius: 6, padding: '4px 10px', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}
                            >
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                              View photo
                            </button>
                          ) : (
                            <span style={{ fontSize: '0.75rem', color: '#CBD5E1' }}>No photo</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* Flagged boards section */}
          {compliance.filter(c => c.status === 'flagged').length > 0 && (
            <div style={{ marginTop: '1.25rem', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 12, padding: '16px 20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#DC2626" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                <p style={{ fontSize: '0.875rem', fontWeight: 700, color: '#991B1B', margin: 0 }}>
                  {compliance.filter(c => c.status === 'flagged').length} board{compliance.filter(c => c.status === 'flagged').length !== 1 ? 's' : ''} flagged — contact your agency for resolution
                </p>
              </div>
              <p style={{ fontSize: '0.8125rem', color: '#7F1D1D', margin: 0, lineHeight: 1.6 }}>
                Flagged boards have compliance issues that need to be resolved. Your agency has been notified and will submit a corrected proof of posting.
              </p>
            </div>
          )}
        </div>
      )}

      {/* ═══ TAB: IMPRESSIONS ═══ */}
      {activeTab === 'impressions' && (() => {
        // Impression estimates by format (daily figures)
        const FORMAT_IMPRESSIONS: Record<string, number> = {
          billboard:    25000,
          unipole:      32000,
          gantry:       18000,
          bridge_panel: 22000,
          wall_drape:   12000,
        };

        const liveBookingsList = bookings.filter(b => ['live','agreed','signed'].includes(b.status));
        const boardImpressions = liveBookingsList.map(b => ({
          name: b.boards?.name || '—',
          city: b.boards?.city || '',
          format: b.boards?.format || 'billboard',
          daily: FORMAT_IMPRESSIONS[b.boards?.format || 'billboard'] || 15000,
          monthly: (FORMAT_IMPRESSIONS[b.boards?.format || 'billboard'] || 15000) * 30,
          status: b.status,
          startDate: b.start_date,
          endDate: b.end_date,
        }));

        const totalDaily   = boardImpressions.reduce((s, b) => s + b.daily, 0);
        const totalMonthly = boardImpressions.reduce((s, b) => s + b.monthly, 0);
        const daysLeft     = activeCampaign ? getDaysRemaining(activeCampaign.end_date) : 0;
        const totalCampaignImpressions = boardImpressions.reduce((s, b) => s + b.daily * Math.max(daysLeft, 0), 0);
        const maxMonthly   = Math.max(...boardImpressions.map(b => b.monthly), 1);

        function formatImp(n: number) {
          if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
          if (n >= 1_000) return (n / 1_000).toFixed(0) + 'K';
          return String(n);
        }

        return (
          <div>
            {/* Top KPIs */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: '1.5rem' }}>
              {[
                { label: 'Daily impressions',       value: formatImp(totalDaily),             color: '#1B4F8A', sub: `Across ${liveBookingsList.length} live board${liveBookingsList.length !== 1 ? 's' : ''}` },
                { label: 'Monthly impressions',     value: formatImp(totalMonthly),           color: '#8B5CF6', sub: 'Estimated 30-day total' },
                { label: 'Campaign total (est.)',   value: formatImp(totalCampaignImpressions), color: '#10B981', sub: daysLeft > 0 ? `${daysLeft} days remaining` : 'Campaign ended' },
              ].map(card => (
                <div key={card.label} style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: 12, padding: '20px' }}>
                  <p style={{ fontSize: '0.6875rem', fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.07em', margin: '0 0 8px' }}>{card.label}</p>
                  <p style={{ fontSize: '2rem', fontWeight: 800, color: card.color, letterSpacing: '-0.03em', fontFamily: 'monospace', margin: '0 0 4px' }}>{card.value}</p>
                  <p style={{ fontSize: '0.6875rem', color: '#CBD5E1', margin: 0 }}>{card.sub}</p>
                </div>
              ))}
            </div>

            {/* Methodology note */}
            <div style={{ background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 10, padding: '10px 16px', marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: 10 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#1E3A8A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              <p style={{ fontSize: '0.8125rem', color: '#1E3A8A', margin: 0 }}>
                <strong>Methodology:</strong> Estimates based on NigerianOOH industry benchmarks — Billboard: 25K/day, Unipole: 32K/day, Gantry: 18K/day, Bridge Panel: 22K/day, Wall Drape: 12K/day. Actual figures may vary by location traffic.
              </p>
            </div>

            {/* Per-board impressions */}
            <div style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: 12, overflow: 'hidden', marginBottom: '1.25rem' }}>
              <div style={{ padding: '14px 20px', borderBottom: '1px solid #F1F5F9' }}>
                <h2 style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#0F172A', margin: '0 0 2px' }}>Impressions by board</h2>
                <p style={{ fontSize: '0.75rem', color: '#94A3B8', margin: 0 }}>Live boards contributing to campaign reach</p>
              </div>
              {boardImpressions.length === 0 ? (
                <div style={{ padding: '3rem', textAlign: 'center' }}>
                  <p style={{ fontSize: '0.875rem', color: '#94A3B8', margin: 0 }}>No live boards yet — impressions will show once boards go live</p>
                </div>
              ) : boardImpressions.map((board, i) => (
                <div key={i} style={{ padding: '14px 20px', borderBottom: i < boardImpressions.length - 1 ? '1px solid #F8FAFC' : 'none' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#10B981', flexShrink: 0 }} />
                      <div>
                        <span style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0F172A' }}>{board.name}</span>
                        <span style={{ fontSize: '0.75rem', color: '#94A3B8', marginLeft: 8 }}>{board.city} · {FORMAT_LABELS[board.format] || board.format}</span>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 20, alignItems: 'center' }}>
                      <div style={{ textAlign: 'right' }}>
                        <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: '0 0 2px', fontWeight: 600, textTransform: 'uppercase' }}>Daily</p>
                        <p style={{ fontSize: '0.9375rem', fontWeight: 700, color: '#1B4F8A', fontFamily: 'monospace', margin: 0 }}>{formatImp(board.daily)}</p>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: '0 0 2px', fontWeight: 600, textTransform: 'uppercase' }}>Monthly</p>
                        <p style={{ fontSize: '0.9375rem', fontWeight: 700, color: '#8B5CF6', fontFamily: 'monospace', margin: 0 }}>{formatImp(board.monthly)}</p>
                      </div>
                    </div>
                  </div>
                  {/* Bar */}
                  <div style={{ height: 6, background: '#F1F5F9', borderRadius: 999, overflow: 'hidden' }}>
                    <div style={{ height: '100%', borderRadius: 999, background: 'linear-gradient(90deg, #1B4F8A, #8B5CF6)', width: `${Math.round((board.monthly / maxMonthly) * 100)}%`, transition: 'width 0.8s ease' }} />
                  </div>
                  <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: '4px 0 0' }}>
                    {Math.round((board.monthly / totalMonthly) * 100)}% of total campaign reach
                  </p>
                </div>
              ))}
              {boardImpressions.length > 0 && (
                <div style={{ padding: '12px 20px', background: '#F8FAFC', borderTop: '2px solid #E8EDF2', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.8125rem', fontWeight: 700, color: '#0F172A' }}>Total ({liveBookingsList.length} boards)</span>
                  <div style={{ display: 'flex', gap: 24 }}>
                    <div style={{ textAlign: 'right' }}>
                      <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: '0 0 2px' }}>DAILY</p>
                      <p style={{ fontSize: '0.9375rem', fontWeight: 800, color: '#1B4F8A', fontFamily: 'monospace', margin: 0 }}>{formatImp(totalDaily)}</p>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: '0 0 2px' }}>MONTHLY</p>
                      <p style={{ fontSize: '0.9375rem', fontWeight: 800, color: '#8B5CF6', fontFamily: 'monospace', margin: 0 }}>{formatImp(totalMonthly)}</p>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Weekly projection table */}
            {daysLeft > 0 && boardImpressions.length > 0 && (
              <div style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: 12, overflow: 'hidden' }}>
                <div style={{ padding: '14px 20px', borderBottom: '1px solid #F1F5F9' }}>
                  <h2 style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#0F172A', margin: '0 0 2px' }}>Weekly projection</h2>
                  <p style={{ fontSize: '0.75rem', color: '#94A3B8', margin: 0 }}>Estimated impressions for the remaining campaign period</p>
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: '#F8FAFC' }}>
                      {['Week', 'Dates', 'Daily avg', 'Weekly total', 'Cumulative'].map(h => (
                        <th key={h} style={{ padding: '10px 16px', fontSize: '0.6875rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.07em', textAlign: 'left', borderBottom: '1px solid #F1F5F9', whiteSpace: 'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {Array.from({ length: Math.min(Math.ceil(daysLeft / 7), 12) }, (_, wi) => {
                      const weekStart = new Date();
                      weekStart.setDate(weekStart.getDate() + wi * 7);
                      const weekEnd = new Date(weekStart);
                      weekEnd.setDate(weekEnd.getDate() + 6);
                      const daysInWeek = Math.min(7, daysLeft - wi * 7);
                      const weeklyTotal = totalDaily * daysInWeek;
                      const cumulative = totalDaily * Math.min((wi + 1) * 7, daysLeft);
                      return (
                        <tr key={wi} style={{ borderBottom: '1px solid #F8FAFC', background: wi % 2 === 0 ? '#fff' : '#FAFBFF' }}>
                          <td style={{ padding: '11px 16px', fontSize: '0.8125rem', fontWeight: 600, color: '#0F172A' }}>Week {wi + 1}</td>
                          <td style={{ padding: '11px 16px', fontSize: '0.8125rem', color: '#475569', whiteSpace: 'nowrap' }}>
                            {weekStart.toLocaleDateString('en-NG', { day: 'numeric', month: 'short' })} – {weekEnd.toLocaleDateString('en-NG', { day: 'numeric', month: 'short' })}
                          </td>
                          <td style={{ padding: '11px 16px', fontFamily: 'monospace', fontSize: '0.875rem', fontWeight: 600, color: '#1B4F8A' }}>{formatImp(totalDaily)}</td>
                          <td style={{ padding: '11px 16px', fontFamily: 'monospace', fontSize: '0.875rem', fontWeight: 700, color: '#8B5CF6' }}>{formatImp(weeklyTotal)}</td>
                          <td style={{ padding: '11px 16px', fontFamily: 'monospace', fontSize: '0.875rem', fontWeight: 700, color: '#10B981' }}>{formatImp(cumulative)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr style={{ background: '#F8FAFC', borderTop: '2px solid #E8EDF2' }}>
                      <td colSpan={3} style={{ padding: '12px 16px', fontSize: '0.8125rem', fontWeight: 700, color: '#0F172A' }}>Campaign total</td>
                      <td colSpan={2} style={{ padding: '12px 16px', fontFamily: 'monospace', fontSize: '1rem', fontWeight: 800, color: '#10B981' }}>{formatImp(totalCampaignImpressions)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        );
      })()}

      {/* ═══ TAB: BOARDS MAP ═══ */}
      {activeTab === 'map' && (
        <div>
          {mapBoards.length === 0 ? (
            <div style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: 12, padding: '4rem', textAlign: 'center' }}>
              <div style={{ width: 52, height: 52, background: '#F1F5F9', borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px' }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M1 6l7-4 8 4 7-4v16l-7 4-8-4-7 4V6 M8 2v16 M16 6v16"/></svg>
              </div>
              <p style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#0F172A', margin: '0 0 4px' }}>No geo-located boards yet</p>
              <p style={{ fontSize: '0.8125rem', color: '#94A3B8', margin: 0 }}>Boards will appear on the map once GPS coordinates are added by the board owner</p>
            </div>
          ) : (
            <div>
              {/* Legend */}
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: '0.875rem', alignItems: 'center' }}>
                {[
                  { label: 'Live', color: '#10B981' }, { label: 'Agreed / Signed', color: '#8B5CF6' },
                  { label: 'Pending', color: '#F59E0B' }, { label: 'Negotiating', color: '#3B82F6' },
                ].map(l => (
                  <div key={l.label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <div style={{ width: 10, height: 10, borderRadius: '50%', background: l.color, border: '2px solid #fff', boxShadow: '0 0 0 1px ' + l.color + '60' }} />
                    <span style={{ fontSize: '0.6875rem', fontWeight: 600, color: '#475569' }}>{l.label}</span>
                  </div>
                ))}
                <span style={{ fontSize: '0.6875rem', color: '#94A3B8', marginLeft: 'auto' }}>{mapBoards.length} boards · Click a pin for details</span>
              </div>

              {/* Interactive map */}
              <div style={{ height: 480, borderRadius: 14, overflow: 'hidden', border: '1px solid #E8EDF2', marginBottom: '1.25rem', background: '#F8FAFC' }}>
                <ClientPortalMap
                  pins={mapBoards.map(b => ({
                    id: b.id,
                    status: b.status,
                    boardName: b.boards?.name || '—',
                    city: b.boards?.city || '',
                    format: b.boards?.format || '',
                    rate: b.agreed_rate || b.offered_rate || 0,
                    latitude: b.boards!.latitude!,
                    longitude: b.boards!.longitude!,
                  }))}
                />
              </div>

              {/* City-grouped board list */}
              <div style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: 12, overflow: 'hidden' }}>
                <div style={{ padding: '12px 20px', borderBottom: '1px solid #F1F5F9' }}>
                  <h2 style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0F172A', margin: 0 }}>All board locations</h2>
                </div>
                {(() => {
                  const byCity: Record<string, typeof mapBoards> = {};
                  mapBoards.forEach(b => { const c = b.boards?.city || 'Unknown'; byCity[c] = [...(byCity[c] || []), b]; });
                  return Object.entries(byCity).map(([city, cityBoards]) => (
                    <div key={city}>
                      <div style={{ padding: '7px 20px', background: '#F8FAFC', borderBottom: '1px solid #F1F5F9' }}>
                        <span style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{city} · {cityBoards.length} board{cityBoards.length !== 1 ? 's' : ''}</span>
                      </div>
                      {cityBoards.map((b) => {
                        const statusDot: Record<string, string> = { live: '#10B981', agreed: '#8B5CF6', signed: '#8B5CF6', pending: '#F59E0B', negotiating: '#3B82F6', completed: '#94A3B8' };
                        return (
                          <div key={b.id} style={{ padding: '11px 20px', borderBottom: '1px solid #F8FAFC', display: 'flex', alignItems: 'center', gap: 14 }}>
                            <div style={{ flex: 1 }}>
                              <p style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0F172A', margin: '0 0 2px' }}>{b.boards?.name || '—'}</p>
                              <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: 0 }}>{b.boards?.address || b.boards?.city} · {FORMAT_LABELS[b.boards?.format] || b.boards?.format}</p>
                            </div>
                            <div style={{ textAlign: 'right' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 5, justifyContent: 'flex-end', marginBottom: 2 }}>
                                <span style={{ width: 6, height: 6, borderRadius: '50%', background: statusDot[b.status] || '#94A3B8' }} />
                                <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#374151', textTransform: 'capitalize' }}>{b.status}</span>
                              </div>
                              <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: 0, fontFamily: 'monospace' }}>
                                {b.boards?.latitude?.toFixed(4)}, {b.boards?.longitude?.toFixed(4)}
                              </p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ));
                })()}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ═══ TAB: BILLING ═══ */}
      {activeTab === 'billing' && (
        <ClientBillingTab
          campaignId={activeCampaign.id}
          clientName={activeCampaign.client_name || brandName}
        />
      )}

      {/* ═══ TAB: PLAN APPROVAL ═══ */}
      {activeTab === 'plan' && (() => {
        const approved  = bookings.filter(b => ['agreed','signed','live','completed'].includes(b.status));
        const declined  = bookings.filter(b => b.status === 'declined');
        const approvedValue = approved.reduce((s, b) => s + (b.agreed_rate || b.offered_rate || 0), 0);
        const FORMAT_ICONS: Record<string, string> = { unipole: '▲', gantry: '⬛', billboard: '▬', bridge_panel: '─', wall_drape: '▼' };
        return (
          <div>
            {/* Header */}
            <div style={{ marginBottom: '1.25rem' }}>
              <h2 style={{ fontSize: '1rem', fontWeight: 700, color: '#0F172A', margin: '0 0 4px' }}>Proposal — approve your media plan</h2>
              <p style={{ fontSize: '0.8125rem', color: '#94A3B8', margin: 0 }}>
                Your agency has proposed boards for this campaign. Approve each placement or decline boards that do not fit your strategy.
              </p>
            </div>

            {/* Summary banner */}
            <div className="resp-grid-4" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: '1.25rem' }}>
              {[
                { label: 'Pending approval',  value: planBookings.length,   color: '#D97706', bg: '#FFFBEB', border: '#FDE68A' },
                { label: 'Approved boards',   value: approved.length,       color: '#065F46', bg: '#ECFDF5', border: '#A7F3D0' },
                { label: 'Declined',          value: declined.length,       color: '#7F1D1D', bg: '#FEF2F2', border: '#FECACA' },
                { label: 'Approved value',    value: `₦${approvedValue >= 1_000_000 ? (approvedValue/1_000_000).toFixed(1)+'M' : approvedValue >= 1000 ? (approvedValue/1000).toFixed(0)+'K' : approvedValue}`, color: '#1B4F8A', bg: '#EFF6FF', border: '#BFDBFE' },
              ].map(card => (
                <div key={card.label} style={{ background: card.bg, border: `1px solid ${card.border}`, borderRadius: 10, padding: '14px 16px' }}>
                  <p style={{ fontSize: '0.6875rem', fontWeight: 600, color: card.color, textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 4px' }}>{card.label}</p>
                  <p style={{ fontSize: '1.5rem', fontWeight: 800, color: card.color, margin: 0, fontFamily: 'monospace', letterSpacing: '-0.02em' }}>{card.value}</p>
                </div>
              ))}
            </div>

            {/* Approve All CTA */}
            {planBookings.length > 0 && (
              <div style={{ background: '#0F172A', borderRadius: 12, padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem', gap: 16 }}>
                <div>
                  <p style={{ fontSize: '0.875rem', fontWeight: 700, color: '#F8FAFC', margin: '0 0 3px' }}>
                    {planBookings.length} board{planBookings.length !== 1 ? 's' : ''} waiting for your approval
                  </p>
                  <p style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.45)', margin: 0 }}>
                    Total media value: {planValue >= 1_000_000 ? '₦'+(planValue/1_000_000).toFixed(1)+'M' : '₦'+(planValue/1000).toFixed(0)+'K'} · Approving locks in rates with board owners
                  </p>
                </div>
                <button
                  onClick={approveAll}
                  style={{ padding: '10px 20px', background: '#10B981', color: '#fff', border: 'none', borderRadius: 9, fontSize: '0.8125rem', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0, whiteSpace: 'nowrap', boxShadow: '0 2px 8px rgba(16,185,129,0.35)' }}
                >
                  Approve all {planBookings.length} boards →
                </button>
              </div>
            )}

            {/* Board cards */}
            {bookings.length === 0 ? (
              <div style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: 12, padding: '4rem', textAlign: 'center' }}>
                <div style={{ width: 48, height: 48, background: '#F1F5F9', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px' }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/></svg>
                </div>
                <p style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#0F172A', margin: '0 0 4px' }}>No boards in plan yet</p>
                <p style={{ fontSize: '0.8125rem', color: '#94A3B8', margin: 0 }}>Your agency will add boards to this campaign using the Campaign Planner. They will appear here for your approval.</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {bookings.map((booking, i) => {
                  const isPending  = booking.status === 'pending' || booking.status === 'negotiating';
                  const isApproved = ['agreed','signed','live','completed'].includes(booking.status);
                  const isDeclined = booking.status === 'declined';
                  const isApproving = approvingId === booking.id;
                  const isDeclining = decliningId === booking.id;
                  const rate = booking.offered_rate || 0;
                  return (
                    <div key={booking.id} style={{
                      background: '#fff',
                      border: `1px solid ${isApproved ? '#A7F3D0' : isDeclined ? '#FECACA' : '#E8EDF2'}`,
                      borderLeft: `3px solid ${isApproved ? '#10B981' : isDeclined ? '#EF4444' : '#F59E0B'}`,
                      borderRadius: 10, padding: '16px 18px',
                      display: 'flex', alignItems: 'center', gap: 14,
                      opacity: isDeclined ? 0.6 : 1,
                      animation: 'fadeUp 0.2s ease forwards',
                      animationDelay: `${i * 0.03}s`,
                    }}>
                      {/* Format icon */}
                      <div style={{ width: 40, height: 40, borderRadius: 8, background: isApproved ? '#ECFDF5' : isDeclined ? '#FEF2F2' : '#FFFBEB', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px', flexShrink: 0 }}>
                        {FORMAT_ICONS[booking.boards?.format || 'billboard'] || '▬'}
                      </div>
                      {/* Board info */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2, flexWrap: 'wrap' }}>
                          <p style={{ fontSize: '0.875rem', fontWeight: 700, color: '#0F172A', margin: 0 }}>{booking.boards?.name || '—'}</p>
                          <span style={{ fontSize: '0.625rem', fontWeight: 700, color: '#64748B', background: '#F1F5F9', padding: '2px 7px', borderRadius: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                            {FORMAT_LABELS[booking.boards?.format || ''] || booking.boards?.format || 'Board'}
                          </span>
                        </div>
                        <p style={{ fontSize: '0.75rem', color: '#64748B', margin: '0 0 2px' }}>
                          {booking.boards?.city || ''}{booking.boards?.state ? `, ${booking.boards.state}` : ''} · {booking.boards?.address || ''}
                        </p>
                        {(booking.start_date || booking.end_date) && (
                          <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: 0 }}>
                            {booking.start_date ? formatDateShort(booking.start_date) : '—'} → {booking.end_date ? formatDateShort(booking.end_date) : '—'}
                          </p>
                        )}
                      </div>
                      {/* Rate */}
                      <div style={{ textAlign: 'right', flexShrink: 0, minWidth: 80 }}>
                        <p style={{ fontSize: '1rem', fontWeight: 800, color: '#0F172A', margin: '0 0 2px', fontFamily: 'monospace' }}>
                          {rate >= 1_000_000 ? '₦'+(rate/1_000_000).toFixed(1)+'M' : rate >= 1000 ? '₦'+(rate/1000).toFixed(0)+'K' : '₦'+rate}
                        </p>
                        <p style={{ fontSize: '0.625rem', color: '#94A3B8', margin: 0 }}>per month</p>
                      </div>
                      {/* Status / Actions */}
                      <div style={{ flexShrink: 0, display: 'flex', gap: 6, alignItems: 'center' }}>
                        {isPending && (
                          <>
                            <button
                              onClick={() => approveBooking(booking.id)}
                              disabled={isApproving}
                              style={{ padding: '7px 14px', background: isApproving ? '#D1FAE5' : '#10B981', color: '#fff', border: 'none', borderRadius: 7, fontSize: '0.75rem', fontWeight: 700, cursor: isApproving ? 'not-allowed' : 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}
                            >
                              {isApproving ? '…' : '✓ Approve'}
                            </button>
                            <button
                              onClick={() => declineBooking(booking.id)}
                              disabled={isDeclining}
                              style={{ padding: '7px 14px', background: '#fff', color: '#EF4444', border: '1px solid #FECACA', borderRadius: 7, fontSize: '0.75rem', fontWeight: 700, cursor: isDeclining ? 'not-allowed' : 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}
                            >
                              {isDeclining ? '…' : '✕ Decline'}
                            </button>
                          </>
                        )}
                        {isApproved && (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: '#ECFDF5', color: '#065F46', padding: '6px 12px', borderRadius: 7, fontSize: '0.75rem', fontWeight: 700 }}>
                            ✓ Approved
                          </span>
                        )}
                        {isDeclined && (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: '#FEF2F2', color: '#7F1D1D', padding: '6px 12px', borderRadius: 7, fontSize: '0.75rem', fontWeight: 700 }}>
                            ✕ Declined
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* After all approved */}
            {bookings.length > 0 && planBookings.length === 0 && approved.length > 0 && (
              <div style={{ background: '#ECFDF5', border: '1px solid #A7F3D0', borderRadius: 12, padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 12, marginTop: '1.25rem' }}>
                <span style={{ fontSize: '1.25rem' }}>🎉</span>
                <div>
                  <p style={{ fontSize: '0.875rem', fontWeight: 700, color: '#065F46', margin: '0 0 2px' }}>Media plan fully approved!</p>
                  <p style={{ fontSize: '0.75rem', color: '#047857', margin: 0 }}>
                    {approved.length} board{approved.length !== 1 ? 's' : ''} confirmed · Total: {formatNaira(approvedValue)}/month · Agency will proceed to book sites
                  </p>
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {/* ── Campaign creation panel ── */}
      {showNewCampaign && (
        <CampaignCreatePanel
          form={campaignForm}
          setForm={setCampaignForm}
          onSave={createCampaign}
          saving={savingCampaign}
          onClose={() => setShowNewCampaign(false)}
        />
      )}

      {/* Photo lightbox */}
      {photoLightbox && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 9998, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}
          onClick={() => setPhotoLightbox(null)}
        >
          <button
            onClick={() => setPhotoLightbox(null)}
            style={{ position: 'absolute', top: 20, right: 24, background: 'rgba(255,255,255,0.12)', border: 'none', color: '#fff', width: 36, height: 36, borderRadius: '50%', fontSize: '1.125rem', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            ✕
          </button>
          <img
            src={photoLightbox}
            alt="Proof of posting"
            onClick={e => e.stopPropagation()}
            style={{ maxWidth: '90vw', maxHeight: '85vh', borderRadius: 12, boxShadow: '0 24px 64px rgba(0,0,0,0.5)', objectFit: 'contain' }}
          />
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 9999, display: 'flex', alignItems: 'center', gap: 10, padding: '12px 18px', borderRadius: 10, background: toast.type === 'success' ? '#0F172A' : '#7F1D1D', color: '#F8FAFC', fontSize: '0.8125rem', fontWeight: 500, boxShadow: '0 8px 24px rgba(0,0,0,0.15)', animation: 'fadeUp 0.25s ease', fontFamily: 'inherit' }}>
          <span>{toast.type === 'success' ? '✓' : '✕'}</span>
          <span>{toast.msg}</span>
        </div>
      )}

    </div>
  );
}

// ── Page export ────────────────────────────────────────────────────────────

export default function ClientDashboardPage() {
  return (
    <RoleGuard role="client">
      <ClientContent />
    </RoleGuard>
  );
}
