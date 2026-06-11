'use client';

import GeneratePOEDeck from '@/components/poe/GeneratePOEDeck';
import SharePOELink from '@/components/poe/SharePOELink';
import { createNotification } from '@/lib/notifications';
import { getActivityActor, logActivity } from '@/lib/activity-log';
import CampaignActivityTimeline from '@/components/activity/CampaignActivityTimeline';
import CreativeUploadPanel, { type CreativeUpload } from '@/components/creatives/CreativeUploadPanel';
import DownloadInvoice from '@/components/invoice/DownloadInvoice';
import { useState, useEffect } from 'react';
import { useToast } from '@/components/ui/Toast';
import { authedFetch } from '@/lib/api';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { formatNaira, formatDate } from '@/lib/utils';
import { getMarketRate, type MarketRate } from '@/lib/rate-intelligence';

type Campaign = {
  id: string;
  name: string;
  client_name: string;
  client_id: string | null;
  status: string;
  start_date: string;
  end_date: string;
  total_budget: number;
  plan_notes: string | null;
  approved_at: string | null;
  approved_by: string | null;
  arcon_status: 'not_submitted' | 'pending' | 'approved' | 'rejected' | 'expired' | null;
  arcon_ref: string | null;
  arcon_submitted_at: string | null;
  arcon_approved_at: string | null;
  arcon_expiry_date: string | null;
  arcon_notes: string | null;
};

type ClientProfile = {
  id: string;
  full_name: string | null;
  company_name: string | null;
};

type Board = {
  id: string;
  name: string;
  address: string;
  city: string;
  state: string;
  format: string;
  asking_rate: number;
  status: string;
  width: number;
  height: number;
  print_width_mm: number | null;
  print_height_mm: number | null;
  illuminated: boolean;
  face_count: number;
  latitude: number;
  longitude: number;
};

type PlanItem = {
  id: string;
  campaign_id: string;
  board_id: string;
  offered_rate: number;
  agreed_rate: number | null;
  status: string;
  start_date: string;
  end_date: string;
  duration_months: number;
  creative_type: string;
  print_required: boolean;
  notes: string | null;
  boards: Board;
};

const FORMAT_LABELS: Record<string, string> = {
  billboard: 'Billboard', unipole: 'Unipole', gantry: 'Gantry',
  bridge_panel: 'Bridge Panel', wall_drape: 'Wall Drape',
};

const STATUS_CONFIG: Record<string, { label: string; bg: string; color: string; dot: string }> = {
  pending:     { label: 'Pending',     bg: '#FFFBEB', color: '#92400E', dot: '#F59E0B' },
  negotiating: { label: 'Negotiating', bg: '#EFF6FF', color: '#1E3A8A', dot: '#3B82F6' },
  agreed:      { label: 'Agreed',      bg: '#ECFDF5', color: '#065F46', dot: '#10B981' },
  signed:      { label: 'Signed',      bg: '#F5F3FF', color: '#3730A3', dot: '#8B5CF6' },
  declined:    { label: 'Declined',    bg: '#FEF2F2', color: '#7F1D1D', dot: '#EF4444' },
};

function StatusPill({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.pending;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: cfg.bg, color: cfg.color, padding: '3px 9px', borderRadius: '999px', fontSize: '0.6875rem', fontWeight: 600 }}>
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: cfg.dot }} />
      {cfg.label}
    </span>
  );
}

function BudgetBar({ used, total }: { used: number; total: number }) {
  const pct = total > 0 ? Math.min((used / total) * 100, 100) : 0;
  const over = used > total;
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontSize: '0.75rem', color: '#64748B' }}>
          <strong style={{ color: over ? '#EF4444' : '#0F172A' }}>{formatNaira(used)}</strong> of {formatNaira(total)} budget used
        </span>
        <span style={{ fontSize: '0.75rem', fontWeight: 700, color: over ? '#EF4444' : pct > 80 ? '#F59E0B' : '#10B981' }}>
          {Math.round(pct)}%
        </span>
      </div>
      <div style={{ height: 8, background: '#F1F5F9', borderRadius: 999, overflow: 'hidden' }}>
        <div style={{
          height: '100%', borderRadius: 999, transition: 'width 0.5s ease',
          width: `${pct}%`,
          background: over ? '#EF4444' : pct > 80 ? '#F59E0B' : '#10B981'
        }} />
      </div>
      {over && (
        <p style={{ fontSize: '0.6875rem', color: '#EF4444', marginTop: 4, fontWeight: 600 }}>
          ⚠ Over budget by {formatNaira(used - total)}
        </p>
      )}
      {!over && total - used > 0 && (
        <p style={{ fontSize: '0.6875rem', color: '#94A3B8', marginTop: 4 }}>
          {formatNaira(total - used)} remaining
        </p>
      )}
    </div>
  );
}

export default function CampaignPlanPage() {
  const { id: idParam } = useParams();
  const id = typeof idParam === 'string' ? idParam : idParam?.[0] ?? '';
  const router = useRouter();

  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [planItems, setPlanItems] = useState<PlanItem[]>([]);
  const [allBoards, setAllBoards] = useState<Board[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'plan' | 'boards' | 'summary' | 'arcon' | 'attribution' | 'activity' | 'timeline'>('plan');
  const [activityKey, setActivityKey] = useState(0);
  const [showAddBoard, setShowAddBoard] = useState(false);
  const [boardSearch, setBoardSearch] = useState('');
  const [editingItem, setEditingItem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [complianceByBooking, setComplianceByBooking] = useState<Record<string, any>>({});
  const [creativesByBooking, setCreativesByBooking] = useState<Record<string, CreativeUpload>>({});
  const [uploadingFor, setUploadingFor] = useState<PlanItem | null>(null);
  const { toast: showToast } = useToast();
  const [removeConfirm, setRemoveConfirm] = useState<{ id: string; name: string } | null>(null);
  const [approveConfirm, setApproveConfirm] = useState(false);
  const [showSendToClient, setShowSendToClient] = useState(false);
  const [clientProfiles, setClientProfiles] = useState<ClientProfile[]>([]);
  const [selectedClientId, setSelectedClientId] = useState('');
  const [sendingToClient, setSendingToClient] = useState(false);

  const [marketRate, setMarketRate] = useState<MarketRate | null>(null);
  const [marketRateLoading, setMarketRateLoading] = useState(false);
  const [reportCopied, setReportCopied] = useState(false);

  // ARCON form state
  const [arconForm, setArconForm] = useState({
    arcon_status: 'not_submitted' as Campaign['arcon_status'],
    arcon_ref: '',
    arcon_submitted_at: '',
    arcon_approved_at: '',
    arcon_expiry_date: '',
    arcon_notes: '',
  });
  const [savingArcon, setSavingArcon] = useState(false);

  // Attribution tracking
  type TrackingLink = {
    id: string; booking_id: string; short_code: string;
    target_url: string; label: string | null;
    stats: { total: number; today: number; week: number; mobile: number };
  };
  const [trackingLinks, setTrackingLinks] = useState<TrackingLink[]>([]);
  const [trackingLoaded, setTrackingLoaded] = useState(false);
  const [creatingLinkFor, setCreatingLinkFor] = useState<string | null>(null);
  const [targetUrlInput, setTargetUrlInput] = useState<Record<string, string>>({});
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  // Add board form state
  const [addForm, setAddForm] = useState({
    boardId: '',
    rate: '',
    startDate: '',
    endDate: '',
    durationMonths: '1',
    creativeType: 'static' as 'static' | 'led' | 'digital',
    printRequired: false,
    notes: '',
  });


  async function saveArcon() {
    if (!campaign) return;
    setSavingArcon(true);
    const { error } = await supabase.from('campaigns').update({
      arcon_status: arconForm.arcon_status,
      arcon_ref: arconForm.arcon_ref.trim() || null,
      arcon_submitted_at: arconForm.arcon_submitted_at || null,
      arcon_approved_at: arconForm.arcon_approved_at || null,
      arcon_expiry_date: arconForm.arcon_expiry_date || null,
      arcon_notes: arconForm.arcon_notes.trim() || null,
    }).eq('id', campaign.id);
    if (!error) {
      setCampaign(prev => prev ? { ...prev, ...arconForm, arcon_ref: arconForm.arcon_ref || null, arcon_notes: arconForm.arcon_notes || null } : prev);
      const actor = await getActivityActor();
      await logActivity({
        entityType: 'campaign',
        entityId: campaign.id,
        campaignId: campaign.id,
        action: 'campaign.arcon_updated',
        summary: `ARCON status → ${arconForm.arcon_status}${arconForm.arcon_ref ? ` (ref ${arconForm.arcon_ref})` : ''}`,
        ...actor,
        changes: { arcon_status: { from: campaign.arcon_status, to: arconForm.arcon_status } },
      });
      setActivityKey(k => k + 1);
      showToast('ARCON compliance saved');
    } else {
      showToast('Failed to save', 'error');
    }
    setSavingArcon(false);
  }

  async function loadTracking() {
    if (!campaign || trackingLoaded) return;
    const res = await fetch(`/api/tracking?campaign_id=${campaign.id}`);
    if (res.ok) setTrackingLinks(await res.json());
    setTrackingLoaded(true);
  }

  async function createTrackingLink(bookingId: string, boardName: string) {
    const url = (targetUrlInput[bookingId] || '').trim();
    if (!url) return;
    setCreatingLinkFor(bookingId);
    const res = await fetch('/api/tracking', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        booking_id: bookingId,
        campaign_id: campaign?.id,
        target_url: url,
        label: `${boardName} — ${campaign?.name}`,
      }),
    });
    if (res.ok) {
      const link = await res.json();
      setTrackingLinks(prev => {
        const without = prev.filter(l => l.booking_id !== bookingId);
        return [...without, { ...link, stats: { total: 0, today: 0, week: 0, mobile: 0 } }];
      });
      setTargetUrlInput(prev => ({ ...prev, [bookingId]: '' }));
    }
    setCreatingLinkFor(null);
  }

  function copyTrackingUrl(code: string) {
    const url = `${window.location.origin}/t/${code}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopiedCode(code);
      setTimeout(() => setCopiedCode(null), 2000);
    });
  }

  function shareReport() {
    const url = `${window.location.origin}/report/${id}`;
    navigator.clipboard.writeText(url).then(() => {
      setReportCopied(true);
      showToast('Report link copied — share it with your client');
      setTimeout(() => setReportCopied(false), 2500);
    });
  }

  useEffect(() => {
    if (id) fetchData();
  }, [id]);

  useEffect(() => {
    if (!addForm.boardId) { setMarketRate(null); return; }
    const board = allBoards.find(b => b.id === addForm.boardId);
    if (!board) return;
    setMarketRateLoading(true);
    getMarketRate(board.format, board.city).then(rate => {
      setMarketRate(rate);
      setMarketRateLoading(false);
    });
  }, [addForm.boardId, allBoards]);

  async function fetchData() {
    setLoading(true);
    setFetchError(null);
    try {
      const [campRes, itemsRes, boardsRes] = await Promise.all([
        supabase.from('campaigns').select('*').eq('id', id).single(),
        supabase.from('bookings').select('*, boards(*)').eq('campaign_id', id).order('created_at'),
        supabase.from('boards').select('*').eq('status', 'available').order('name'),
      ]);
      if (campRes.error) throw campRes.error;
      if (campRes.data) {
        const c = campRes.data as Campaign;
        setCampaign(c);
        setArconForm({
          arcon_status: c.arcon_status || 'not_submitted',
          arcon_ref: c.arcon_ref || '',
          arcon_submitted_at: c.arcon_submitted_at ? c.arcon_submitted_at.slice(0, 10) : '',
          arcon_approved_at: c.arcon_approved_at ? c.arcon_approved_at.slice(0, 10) : '',
          arcon_expiry_date: c.arcon_expiry_date || '',
          arcon_notes: c.arcon_notes || '',
        });
      }
      if (itemsRes.data) {
        const items = itemsRes.data as unknown as PlanItem[];
        setPlanItems(items);

        if (items.length > 0) {
          const [compRes, crRes] = await Promise.all([
            supabase.from('compliance_checks').select('*').in('booking_id', items.map(i => i.id)),
            supabase.from('creative_uploads').select('*').in('booking_id', items.map(i => i.id)).order('created_at', { ascending: false }),
          ]);
          if (compRes.data) {
            const compMap: Record<string, any> = {};
            compRes.data.forEach(c => { if (!compMap[c.booking_id]) compMap[c.booking_id] = c; });
            setComplianceByBooking(compMap);
          }
          if (crRes.data) {
            const crMap: Record<string, CreativeUpload> = {};
            (crRes.data as CreativeUpload[]).forEach(c => { if (!crMap[c.booking_id]) crMap[c.booking_id] = c; });
            setCreativesByBooking(crMap);
          }
        }
      }
      if (boardsRes.data) setAllBoards(boardsRes.data as Board[]);
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : 'Failed to load campaign');
    } finally {
      setLoading(false);
    }
  }

  async function openSendToClient() {
    if (clientProfiles.length === 0) {
      const { data } = await supabase
        .from('profiles')
        .select('id, full_name, company_name')
        .eq('role', 'client')
        .order('company_name');
      setClientProfiles((data as ClientProfile[]) || []);
    }
    setSelectedClientId(campaign?.client_id || '');
    setShowSendToClient(true);
  }

  async function sendToClient() {
    if (!selectedClientId || !campaign) return;
    setSendingToClient(true);
    const { error } = await supabase
      .from('campaigns')
      .update({ client_id: selectedClientId, status: 'pending' })
      .eq('id', campaign.id);
    if (!error) {
      const client = clientProfiles.find(c => c.id === selectedClientId);
      await createNotification({
        recipientRole: 'client',
        type: 'campaign_request',
        title: 'New media plan ready for your review',
        body: `${campaign.name} — ${planItems.length} board${planItems.length !== 1 ? 's' : ''} proposed`,
        link: '/dashboard/client?tab=plan',
      });
      setCampaign(prev => prev ? { ...prev, client_id: selectedClientId, status: 'pending' } : null);
      const actor = await getActivityActor();
      await logActivity({
        entityType: 'campaign',
        entityId: campaign.id,
        campaignId: campaign.id,
        action: 'campaign.sent_for_approval',
        summary: `Media plan sent to ${client?.company_name || client?.full_name || 'client'} (${planItems.length} boards)`,
        ...actor,
        changes: { status: { from: campaign.status, to: 'pending' } },
      });
      setActivityKey(k => k + 1);
      setShowSendToClient(false);
      showToast(`Plan sent to ${client?.company_name || client?.full_name || 'client'} for approval`);
      // Fire-and-forget email to client
      const { data: { user: agencyUser } } = await supabase.auth.getUser();
      if (agencyUser) {
        authedFetch('/api/notify/email', {
          method: 'POST',
          body: JSON.stringify({
            type: 'plan_sent_for_approval',
            clientId: selectedClientId,
            agencyId: agencyUser.id,
            campaignName: campaign.name,
            boardCount: planItems.length,
          }),
        }).catch(() => {});
      }
    } else {
      showToast('Failed to send to client', 'error');
    }
    setSendingToClient(false);
  }

  // Derived financials
  const totalPlanCost = planItems.reduce((sum, item) => {
    const rate = item.agreed_rate || item.offered_rate;
    return sum + (rate * (item.duration_months || 1));
  }, 0);

  const agreedCount = planItems.filter(i => ['agreed', 'signed'].includes(i.status)).length;
  const pendingCount = planItems.filter(i => i.status === 'pending').length;

  async function addBoardToPlan() {
    if (!addForm.boardId || !addForm.rate) return;
    setSaving(true);
    const board = allBoards.find(b => b.id === addForm.boardId);
    const startDate = addForm.startDate || campaign?.start_date;
    const endDate = addForm.endDate || campaign?.end_date;

    const { data: newItem, error } = await supabase.from('bookings').insert({
      campaign_id: id,
      board_id: addForm.boardId,
      offered_rate: parseFloat(addForm.rate),
      status: 'pending',
      start_date: startDate,
      end_date: endDate,
      duration_months: parseInt(addForm.durationMonths),
      creative_type: addForm.creativeType,
      print_required: addForm.printRequired,
      notes: addForm.notes || null,
      is_in_plan: true,
    }).select('id').single();

    if (!error && newItem) {
      const actor = await getActivityActor();
      await logActivity({
        entityType: 'booking',
        entityId: newItem.id,
        campaignId: id,
        action: 'booking.added_to_plan',
        summary: `${board?.name} added to plan at ${formatNaira(parseFloat(addForm.rate))}/mo`,
        ...actor,
      });
      setActivityKey(k => k + 1);
      // Notify owner that a new booking request has arrived
      await createNotification({
        recipientRole: 'owner',
        type: 'new_booking',
        title: 'New booking request',
        body: `${campaign?.name} is interested in ${board?.name}`,
        link: `/dashboard/owner/negotiations`,
      });
      await fetchData();
      setShowAddBoard(false);
      setAddForm({ boardId: '', rate: '', startDate: '', endDate: '', durationMonths: '1', creativeType: 'static', printRequired: false, notes: '' });
      showToast(`${board?.name} added to plan`);
    } else {
      showToast('Failed to add board', 'error');
    }
    setSaving(false);
  }

  async function removeFromPlan(itemId: string, boardName: string) {
    setRemoveConfirm({ id: itemId, name: boardName });
  }

  async function confirmRemoveFromPlan() {
    if (!removeConfirm) return;
    const { id: itemId, name: boardName } = removeConfirm;
    setRemoveConfirm(null);
    const { error } = await supabase.from('bookings').delete().eq('id', itemId);
    if (!error) {
      const actor = await getActivityActor();
      await logActivity({
        entityType: 'booking',
        entityId: itemId,
        campaignId: id,
        action: 'booking.removed_from_plan',
        summary: `${boardName} removed from plan`,
        ...actor,
      });
      setActivityKey(k => k + 1);
      setPlanItems(prev => prev.filter(i => i.id !== itemId));
      showToast(`${boardName} removed from plan`);
    }
  }

  async function updateItemRate(itemId: string, newRate: number) {
    const item = planItems.find(i => i.id === itemId);
    await supabase.from('bookings').update({ offered_rate: newRate }).eq('id', itemId);
    const actor = await getActivityActor();
    await logActivity({
      entityType: 'booking',
      entityId: itemId,
      campaignId: id,
      action: 'booking.rate_updated',
      summary: `${item?.boards?.name || 'Board'} rate → ${formatNaira(newRate)}/mo`,
      ...actor,
      changes: { offered_rate: { from: item?.offered_rate, to: newRate } },
    });
    setActivityKey(k => k + 1);
    setPlanItems(prev => prev.map(i => i.id === itemId ? { ...i, offered_rate: newRate } : i));
    setEditingItem(null);
    showToast('Rate updated');
  }

  async function approvePlan() {
    setApproveConfirm(true);
  }

  async function confirmApprovePlan() {
    setApproveConfirm(false);
    const { error } = await supabase.from('campaigns').update({
      status: 'active',
      approved_at: new Date().toISOString(),
      approved_by: 'Client approval',
    }).eq('id', id);
    if (!error) {
      const actor = await getActivityActor();
      await logActivity({
        entityType: 'campaign',
        entityId: id,
        campaignId: id,
        action: 'campaign.status_changed',
        summary: 'Campaign marked active (client approval recorded)',
        ...actor,
        changes: { status: { from: campaign?.status, to: 'active' } },
      });
      setActivityKey(k => k + 1);
      setCampaign(prev => prev ? { ...prev, status: 'active', approved_at: new Date().toISOString() } : null);
      showToast('Plan approved! Campaign is now active.');
    }
  }

  const filteredBoards = allBoards.filter(b =>
    !planItems.find(i => i.board_id === b.id) &&
    (b.name.toLowerCase().includes(boardSearch.toLowerCase()) ||
     b.city?.toLowerCase().includes(boardSearch.toLowerCase()) ||
     b.address?.toLowerCase().includes(boardSearch.toLowerCase()))
  );

  if (fetchError) return (
    <div style={{ padding: '3rem', textAlign: 'center' }}>
      <p style={{ color: '#EF4444', fontWeight: 600, marginBottom: 12 }}>Failed to load campaign</p>
      <p style={{ color: '#64748B', fontSize: '0.875rem', marginBottom: 16 }}>{fetchError}</p>
      <button onClick={fetchData} style={{ padding: '8px 20px', background: '#1B4F8A', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: '0.875rem' }}>Retry</button>
    </div>
  );

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '50vh' }}>
        <div style={{ width: 28, height: 28, border: '2px solid #E2E8F0', borderTopColor: '#1B4F8A', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (!campaign) {
    return <div style={{ textAlign: 'center', padding: '4rem', color: '#94A3B8' }}>Campaign not found</div>;
  }

  return (
    <>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeUp { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:translateY(0); } }
        .row-hover:hover { background: #FAFBFF !important; }
        .board-row:hover { background: #F8FAFF !important; border-color: #BFDBFE !important; }
        .remove-btn { opacity: 0; transition: opacity 0.15s; }
        tr:hover .remove-btn { opacity: 1; }
      `}</style>

      <div style={{ fontFamily: "'Inter', -apple-system, sans-serif" }}>
        {/* Back nav */}
        <button
          onClick={() => router.push('/dashboard/agency/campaigns')}
          style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8', fontSize: '0.8125rem', fontFamily: 'inherit', marginBottom: '1.25rem', padding: 0 }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          All campaigns
        </button>

        {/* Campaign header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
              <h1 style={{ fontSize: '1.375rem', fontWeight: 700, color: '#0F172A', letterSpacing: '-0.025em', margin: 0 }}>
                {campaign.name}
              </h1>
              <StatusPill status={campaign.status} />
              {campaign.approved_at && (
                <span style={{ fontSize: '0.6875rem', color: '#10B981', fontWeight: 600, background: '#ECFDF5', padding: '2px 8px', borderRadius: 4 }}>
                  ✓ Client approved
                </span>
              )}
            </div>
            <p style={{ fontSize: '0.8125rem', color: '#94A3B8', margin: 0 }}>
              {campaign.client_name || '—'} · {formatDate(campaign.start_date)} → {formatDate(campaign.end_date)}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={shareReport}
              title="Copy shareable report link"
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                background: reportCopied ? '#ECFDF5' : '#F8FAFC',
                color: reportCopied ? '#065F46' : '#374151',
                border: `1px solid ${reportCopied ? '#6EE7B7' : '#E2E8F0'}`,
                padding: '9px 16px', borderRadius: '8px', fontSize: '0.8125rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.2s'
              }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                {reportCopied
                  ? <polyline points="20 6 9 17 4 12"/>
                  : <><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></>
                }
              </svg>
              {reportCopied ? 'Link copied!' : 'Share Report'}
            </button>
            {planItems.length > 0 && campaign.status !== 'pending' && (
              <button
                onClick={openSendToClient}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  background: campaign.client_id ? '#F5F3FF' : '#F8FAFC',
                  color: campaign.client_id ? '#6D28D9' : '#374151',
                  border: `1px solid ${campaign.client_id ? '#DDD6FE' : '#E2E8F0'}`,
                  padding: '9px 16px', borderRadius: '8px', fontSize: '0.8125rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit'
                }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
                </svg>
                {campaign.client_id ? 'Resend to client' : 'Send to client'}
              </button>
            )}
            <button
              onClick={() => setShowAddBoard(true)}
              style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#1B4F8A', color: '#fff', border: 'none', padding: '9px 16px', borderRadius: '8px', fontSize: '0.8125rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
            >
              <span style={{ fontSize: '1rem', lineHeight: 1 }}>+</span> Add board to plan
            </button>
          </div>
        </div>

        {/* Stats row */}
        <div className="resp-grid-5" style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10, marginBottom: '1.5rem' }}>
          {[
            { label: 'Total budget', value: formatNaira(campaign.total_budget), bar: '#1B4F8A' },
            { label: 'Plan cost', value: formatNaira(totalPlanCost), bar: totalPlanCost > campaign.total_budget ? '#EF4444' : '#10B981' },
            { label: 'Boards in plan', value: String(planItems.length), bar: '#3B82F6' },
            { label: 'Agreed', value: String(agreedCount), bar: '#10B981' },
            { label: 'Pending', value: String(pendingCount), bar: '#F59E0B' },
          ].map(({ label, value, bar }) => (
            <div key={label} style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: '10px', padding: '14px 16px' }}>
              <p style={{ fontSize: '0.625rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.07em', margin: '0 0 6px' }}>{label}</p>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ display: 'block', width: 3, height: 22, background: bar, borderRadius: 2, flexShrink: 0 }} />
                <span style={{ fontSize: '1.375rem', fontWeight: 700, color: '#0F172A', fontFamily: 'monospace', letterSpacing: '-0.02em' }}>{value}</span>
              </div>
            </div>
          ))}
        </div>

        {/* Budget bar */}
        <div style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: '10px', padding: '16px 20px', marginBottom: '1.25rem' }}>
          <BudgetBar used={totalPlanCost} total={campaign.total_budget} />
        </div>

        <div style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: '10px', padding: '16px 20px', marginBottom: '1.25rem' }}>
  <p style={{ fontSize: '0.8125rem', fontWeight: 700, color: '#0F172A', margin: '0 0 10px' }}>
    POE Report
  </p>
  <GeneratePOEDeck
    campaignId={campaign.id}
    campaignName={campaign.name}
    clientName={campaign.client_name || ''}
    boardCount={planItems.length}
    poeCount={planItems.filter(i => complianceByBooking[i.id]).length}
  />
</div>

        {/* Awaiting client approval banner */}
        {campaign.status === 'pending' && campaign.client_id && (
          <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 10, padding: '12px 18px', marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: 12 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#D97706" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            <div style={{ flex: 1 }}>
              <p style={{ fontSize: '0.875rem', fontWeight: 600, color: '#92400E', margin: '0 0 2px' }}>
                Awaiting client approval — {planItems.filter(i => i.status === 'pending' || i.status === 'negotiating').length} board{planItems.filter(i => i.status === 'pending' || i.status === 'negotiating').length !== 1 ? 's' : ''} pending decision
              </p>
              <p style={{ fontSize: '0.75rem', color: '#92400E', opacity: 0.7, margin: 0 }}>
                Plan was submitted for client review. You will be notified when they approve or decline boards.
              </p>
            </div>
            <button
              onClick={openSendToClient}
              style={{ fontSize: '0.75rem', fontWeight: 600, color: '#92400E', background: 'none', border: '1px solid #FDE68A', borderRadius: 7, padding: '5px 12px', cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 }}
            >
              Resend
            </button>
          </div>
        )}

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 4, background: '#F1F5F9', padding: 4, borderRadius: 10, width: 'fit-content', marginBottom: '1.25rem' }}>
          {[
            { key: 'plan',        label: `Plan (${planItems.length})` },
            { key: 'timeline',    label: 'Timeline' },
            { key: 'summary',     label: 'Plan summary' },
            { key: 'arcon',       label: 'ARCON', badge: !campaign.arcon_status || campaign.arcon_status === 'not_submitted' || campaign.arcon_status === 'rejected' || campaign.arcon_status === 'expired' },
            { key: 'attribution', label: 'Attribution', badge: false },
            { key: 'activity', label: 'Activity', badge: false },
          ].map(tab => (
            <button key={tab.key} onClick={() => { setActiveTab(tab.key as any); if (tab.key === 'attribution') loadTracking(); }} style={{
              padding: '6px 16px', borderRadius: 7, border: 'none',
              background: activeTab === tab.key ? '#fff' : 'transparent',
              color: activeTab === tab.key ? '#0F172A' : '#64748B',
              fontSize: '0.8125rem', fontWeight: activeTab === tab.key ? 600 : 400,
              cursor: 'pointer', fontFamily: 'inherit',
              boxShadow: activeTab === tab.key ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
              display: 'flex', alignItems: 'center', gap: 5,
            }}>
              {tab.label}
              {(tab as any).badge && (
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#F59E0B', flexShrink: 0 }} />
              )}
            </button>
          ))}
        </div>

        {/* Plan tab */}
        {activeTab === 'plan' && (
          <>
            {planItems.length === 0 ? (
              <div style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: '12px', padding: '4rem 2rem', textAlign: 'center' }}>
                <div style={{ width: 48, height: 48, background: '#F1F5F9', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px' }}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/>
                    <line x1="8" y1="2" x2="8" y2="18"/>
                    <line x1="16" y1="6" x2="16" y2="22"/>
                  </svg>
                </div>
                <p style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#0F172A', margin: '0 0 4px' }}>No boards in plan yet</p>
                <p style={{ fontSize: '0.8125rem', color: '#94A3B8', margin: '0 0 20px' }}>
                  Add boards from your inventory to build the media plan
                </p>
                <button
                  onClick={() => setShowAddBoard(true)}
                  style={{ background: '#1B4F8A', color: '#fff', border: 'none', padding: '10px 20px', borderRadius: '8px', fontSize: '0.875rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
                >
                  + Add first board
                </button>
              </div>
            ) : (
              <div style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: '12px', overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: '#F8FAFC' }}>
                      {['Board', 'Location', 'Format', 'Duration', 'Rate/month', 'Total cost', 'Type', 'Status', 'Client', 'Artwork', 'POE link', ''].map(h => (
                        <th key={h} style={{ padding: '10px 14px', fontSize: '0.625rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.07em', textAlign: 'left', borderBottom: '1px solid #F1F5F9', whiteSpace: 'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {planItems.map((item, i) => {
                      const rate = item.agreed_rate || item.offered_rate;
                      const total = rate * (item.duration_months || 1);
                      const isEditing = editingItem === item.id;

                      return (
                        <tr key={item.id} className="row-hover" style={{ borderBottom: i < planItems.length - 1 ? '1px solid #F8FAFC' : 'none', transition: 'background 0.1s' }}>
                          <td style={{ padding: '12px 14px' }}>
                            <p style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#0F172A', margin: '0 0 2px', whiteSpace: 'nowrap' }}>
                              {item.boards?.name || 'Unknown'}
                            </p>
                            {item.notes && <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: 0, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.notes}</p>}
                          </td>
                          <td style={{ padding: '12px 14px', fontSize: '0.75rem', color: '#64748B', whiteSpace: 'nowrap' }}>
                            {item.boards?.city || '—'}
                          </td>
                          <td style={{ padding: '12px 14px' }}>
                            <span style={{ fontSize: '0.6875rem', fontWeight: 600, color: '#475569', background: '#F1F5F9', padding: '2px 7px', borderRadius: 4 }}>
                              {FORMAT_LABELS[item.boards?.format] || item.boards?.format || '—'}
                            </span>
                          </td>
                          <td style={{ padding: '12px 14px', fontSize: '0.75rem', color: '#64748B', whiteSpace: 'nowrap' }}>
                            {item.duration_months || 1} month{(item.duration_months || 1) !== 1 ? 's' : ''}
                          </td>
                          <td style={{ padding: '12px 14px' }}>
                            {isEditing ? (
                              <form onSubmit={e => { e.preventDefault(); const val = parseFloat((e.currentTarget.elements.namedItem('rate') as HTMLInputElement).value); if (val > 0) updateItemRate(item.id, val); }}>
                                <input name="rate" type="number" defaultValue={rate} autoFocus
                                  style={{ width: 90, padding: '4px 8px', border: '1px solid #1B4F8A', borderRadius: 6, fontSize: '0.8125rem', outline: 'none', fontFamily: 'inherit' }}
                                  onBlur={() => setEditingItem(null)}
                                />
                              </form>
                            ) : (
                              <button onClick={() => setEditingItem(item.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'monospace', fontSize: '0.875rem', fontWeight: 600, color: item.agreed_rate ? '#10B981' : '#0F172A', padding: 0 }}>
                                {formatNaira(rate)}
                                {item.agreed_rate && <span style={{ fontSize: '0.625rem', color: '#10B981', marginLeft: 4 }}>agreed</span>}
                              </button>
                            )}
                          </td>
                          <td style={{ padding: '12px 14px', fontFamily: 'monospace', fontSize: '0.875rem', fontWeight: 700, color: '#0F172A' }}>
                            {formatNaira(total)}
                          </td>
                          <td style={{ padding: '12px 14px' }}>
                            <span style={{ fontSize: '0.6875rem', fontWeight: 600, padding: '2px 8px', borderRadius: 4, background: item.creative_type === 'led' ? '#EFF6FF' : '#F5F3FF', color: item.creative_type === 'led' ? '#1E3A8A' : '#3730A3' }}>
                              {item.creative_type?.toUpperCase() || 'STATIC'}
                            </span>
                            {item.print_required && (
                              <span style={{ fontSize: '0.6875rem', fontWeight: 600, padding: '2px 6px', borderRadius: 4, background: '#FFFBEB', color: '#92400E', marginLeft: 4 }}>
                                PRINT
                              </span>
                            )}
                          </td>
                          <td style={{ padding: '12px 14px' }}>
                            <StatusPill status={item.status} />
                          </td>
                          <td style={{ padding: '12px 14px' }}>
                            {campaign.client_id ? (
                              ['agreed', 'signed', 'live', 'completed'].includes(item.status) ? (
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: '#ECFDF5', color: '#065F46', padding: '3px 9px', borderRadius: 999, fontSize: '0.6875rem', fontWeight: 700 }}>
                                  ✓ Approved
                                </span>
                              ) : item.status === 'declined' ? (
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: '#FEF2F2', color: '#7F1D1D', padding: '3px 9px', borderRadius: 999, fontSize: '0.6875rem', fontWeight: 700 }}>
                                  ✕ Declined
                                </span>
                              ) : (
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: '#FFFBEB', color: '#92400E', padding: '3px 9px', borderRadius: 999, fontSize: '0.6875rem', fontWeight: 600 }}>
                                  ⏳ Pending
                                </span>
                              )
                            ) : (
                              <span style={{ fontSize: '0.6875rem', color: '#CBD5E1' }}>—</span>
                            )}
                          </td>
                          <td style={{ padding: '10px 14px' }}>
                            {(() => {
                              const cr = creativesByBooking[item.id];
                              const statusMap: Record<string, { label: string; color: string; bg: string }> = {
                                uploaded:          { label: 'Uploaded',  color: '#92400E', bg: '#FFFBEB' },
                                approved:          { label: 'Approved',  color: '#065F46', bg: '#ECFDF5' },
                                changes_requested: { label: 'Revise',    color: '#7F1D1D', bg: '#FEF2F2' },
                                printing:          { label: 'Printing',  color: '#1E3A8A', bg: '#EFF6FF' },
                                live:              { label: 'Live',      color: '#065F46', bg: '#ECFDF5' },
                              };
                              if (cr) {
                                const s = statusMap[cr.status] || statusMap.uploaded;
                                return (
                                  <button
                                    onClick={() => setUploadingFor(item)}
                                    title={cr.file_name}
                                    style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: s.bg, color: s.color, border: 'none', padding: '3px 8px', borderRadius: 5, fontSize: '0.6875rem', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}
                                  >
                                    ✓ {s.label}
                                  </button>
                                );
                              }
                              return (
                                <button
                                  onClick={() => setUploadingFor(item)}
                                  style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: '#F1F5F9', color: '#64748B', border: '1px dashed #CBD5E1', padding: '3px 8px', borderRadius: 5, fontSize: '0.6875rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}
                                >
                                  + Upload
                                </button>
                              );
                            })()}
                          </td>
                          <td style={{ padding: '10px 14px' }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                              <SharePOELink
                                bookingId={item.id}
                                boardName={item.boards?.name || 'Board'}
                                variant="inline"
                              />
                              {['agreed','signed','live','completed'].includes(item.status) && (
                                <DownloadInvoice bookingId={item.id} type="agency" variant="inline" label="Invoice" />
                              )}
                            </div>
                          </td>
                          <td style={{ padding: '12px 14px' }}>
                            <button
                              className="remove-btn"
                              onClick={() => removeFromPlan(item.id, item.boards?.name)}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#EF4444', display: 'flex', padding: 4 }}
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
                              </svg>
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr style={{ background: '#F8FAFC', borderTop: '2px solid #E8EDF2' }}>
                      <td colSpan={5} style={{ padding: '12px 14px', fontSize: '0.8125rem', fontWeight: 700, color: '#0F172A' }}>
                        Total plan cost
                      </td>
                      <td style={{ padding: '12px 14px', fontFamily: 'monospace', fontSize: '1rem', fontWeight: 800, color: totalPlanCost > campaign.total_budget ? '#EF4444' : '#0F172A' }}>
                        {formatNaira(totalPlanCost)}
                      </td>
                      <td colSpan={4} style={{ padding: '12px 14px', fontSize: '0.75rem', color: '#94A3B8' }}>
                        {planItems.length} board{planItems.length !== 1 ? 's' : ''} · Budget: {formatNaira(campaign.total_budget)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </>
        )}

        {/* Summary tab */}
        {activeTab === 'summary' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            {/* Plan overview */}
            <div style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: '12px', padding: '20px' }}>
              <h2 style={{ fontSize: '0.9375rem', fontWeight: 700, color: '#0F172A', margin: '0 0 16px' }}>Plan overview</h2>
              {[
                { label: 'Campaign', value: campaign.name },
                { label: 'Client', value: campaign.client_name || '—' },
                { label: 'Duration', value: `${formatDate(campaign.start_date)} → ${formatDate(campaign.end_date)}` },
                { label: 'Total budget', value: formatNaira(campaign.total_budget) },
                { label: 'Plan cost', value: formatNaira(totalPlanCost) },
                { label: 'Remaining budget', value: formatNaira(campaign.total_budget - totalPlanCost) },
                { label: 'Boards in plan', value: String(planItems.length) },
                { label: 'Static boards', value: String(planItems.filter(i => i.creative_type === 'static').length) },
                { label: 'LED/Digital boards', value: String(planItems.filter(i => ['led', 'digital'].includes(i.creative_type)).length) },
                { label: 'Print required', value: String(planItems.filter(i => i.print_required).length) + ' boards' },
              ].map(({ label, value }) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #F8FAFC' }}>
                  <span style={{ fontSize: '0.8125rem', color: '#64748B' }}>{label}</span>
                  <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#0F172A' }}>{value}</span>
                </div>
              ))}
            </div>

            {/* By city */}
            <div style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: '12px', padding: '20px' }}>
              <h2 style={{ fontSize: '0.9375rem', fontWeight: 700, color: '#0F172A', margin: '0 0 16px' }}>Boards by city</h2>
              {Object.entries(
                planItems.reduce((acc, item) => {
                  const city = item.boards?.city || 'Unknown';
                  if (!acc[city]) acc[city] = { count: 0, cost: 0 };
                  acc[city].count++;
                  acc[city].cost += (item.agreed_rate || item.offered_rate) * (item.duration_months || 1);
                  return acc;
                }, {} as Record<string, { count: number; cost: number }>)
              ).map(([city, data]) => (
                <div key={city} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid #F8FAFC' }}>
                  <div>
                    <p style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0F172A', margin: '0 0 2px' }}>{city}</p>
                    <p style={{ fontSize: '0.75rem', color: '#94A3B8', margin: 0 }}>{data.count} board{data.count !== 1 ? 's' : ''}</p>
                  </div>
                  <span style={{ fontSize: '0.875rem', fontWeight: 700, color: '#0F172A', fontFamily: 'monospace' }}>{formatNaira(data.cost)}</span>
                </div>
              ))}
              {planItems.length === 0 && <p style={{ fontSize: '0.8125rem', color: '#94A3B8', textAlign: 'center', padding: '2rem 0' }}>No boards in plan yet</p>}

              {/* Print dimensions */}
              {planItems.filter(i => i.print_required).length > 0 && (
                <>
                  <h2 style={{ fontSize: '0.9375rem', fontWeight: 700, color: '#0F172A', margin: '20px 0 12px' }}>Print dimensions needed</h2>
                  {planItems.filter(i => i.print_required).map(item => (
                    <div key={item.id} style={{ padding: '8px 0', borderBottom: '1px solid #F8FAFC' }}>
                      <p style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#0F172A', margin: '0 0 2px' }}>{item.boards?.name}</p>
                      <p style={{ fontSize: '0.75rem', color: '#94A3B8', margin: 0 }}>
                        {item.boards?.print_width_mm && item.boards?.print_height_mm
                          ? `${item.boards.print_width_mm}mm × ${item.boards.print_height_mm}mm`
                          : `${item.boards?.width}m × ${item.boards?.height}m (confirm with owner)`}
                      </p>
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>
        )}

        {activeTab === 'activity' && (
          <CampaignActivityTimeline campaignId={id} refreshKey={activityKey} />
        )}

        {/* ── Timeline Tab ── */}
        {activeTab === 'timeline' && (() => {
          if (planItems.length === 0) {
            return (
              <div style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: 12, padding: '4rem', textAlign: 'center' }}>
                <p style={{ fontSize: '0.875rem', color: '#94A3B8', margin: 0 }}>Add boards to the plan to see the timeline.</p>
              </div>
            );
          }

          const rawStart = campaign.start_date
            ? new Date(campaign.start_date)
            : new Date(Math.min(...planItems.map(i => new Date(i.start_date).getTime())));
          const rawEnd = campaign.end_date
            ? new Date(campaign.end_date)
            : new Date(Math.max(...planItems.map(i => new Date(i.end_date).getTime())));

          const rangeStart = new Date(rawStart.getFullYear(), rawStart.getMonth(), 1);
          const rangeEnd   = new Date(rawEnd.getFullYear(),   rawEnd.getMonth() + 1, 1);
          const totalMs    = rangeEnd.getTime() - rangeStart.getTime();

          const todayMs       = Date.now();
          const todayPct      = (todayMs - rangeStart.getTime()) / totalMs * 100;
          const todayInRange  = todayMs >= rangeStart.getTime() && todayMs <= rangeEnd.getTime();

          const months: { label: string; leftPct: number; widthPct: number }[] = [];
          const cur = new Date(rangeStart);
          while (cur < rangeEnd) {
            const mStart = new Date(cur);
            const mEnd   = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
            months.push({
              label:    mStart.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }),
              leftPct:  (mStart.getTime() - rangeStart.getTime()) / totalMs * 100,
              widthPct: (Math.min(mEnd.getTime(), rangeEnd.getTime()) - mStart.getTime()) / totalMs * 100,
            });
            cur.setMonth(cur.getMonth() + 1);
          }

          const BAR_COLOR: Record<string, string> = {
            pending:     '#F59E0B',
            negotiating: '#3B82F6',
            agreed:      '#10B981',
            signed:      '#7C3AED',
            declined:    '#EF4444',
          };

          const ROW_H    = 48;
          const LABEL_W  = 192;
          const HEADER_H = 34;

          const durationWeeks = Math.round(totalMs / (7 * 24 * 60 * 60 * 1000));

          return (
            <div>
              {/* Legend + duration */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 20, marginBottom: 14, flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  {Object.entries(BAR_COLOR).map(([s, c]) => (
                    <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <div style={{ width: 10, height: 10, borderRadius: 2, background: c }} />
                      <span style={{ fontSize: '0.6875rem', color: '#64748B', textTransform: 'capitalize' }}>{s}</span>
                    </div>
                  ))}
                  {todayInRange && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <div style={{ width: 2, height: 14, background: '#EF4444', borderRadius: 1 }} />
                      <span style={{ fontSize: '0.6875rem', color: '#64748B' }}>Today</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Gantt */}
              <div style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: 12, overflow: 'hidden' }}>
                <div style={{ display: 'flex' }}>
                  {/* Board label column */}
                  <div style={{ width: LABEL_W, flexShrink: 0, borderRight: '1px solid #E8EDF2' }}>
                    <div style={{ height: HEADER_H, background: '#F8FAFC', borderBottom: '1px solid #E8EDF2', display: 'flex', alignItems: 'center', paddingLeft: 14 }}>
                      <span style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Board</span>
                    </div>
                    {planItems.map((item, i) => (
                      <div key={item.id} style={{
                        height: ROW_H,
                        padding: '0 14px',
                        display: 'flex', flexDirection: 'column', justifyContent: 'center',
                        borderBottom: i < planItems.length - 1 ? '1px solid #F1F5F9' : 'none',
                        background: i % 2 === 0 ? '#fff' : '#FAFBFC',
                      }}>
                        <p style={{ fontSize: '0.75rem', fontWeight: 600, color: '#0F172A', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.boards?.name}</p>
                        <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: '1px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.boards?.city}</p>
                      </div>
                    ))}
                  </div>

                  {/* Timeline grid */}
                  <div style={{ flex: 1, overflowX: 'auto', minWidth: 0 }}>
                    <div style={{ minWidth: Math.max(480, months.length * 80), position: 'relative' }}>
                      {/* Month header */}
                      <div style={{ height: HEADER_H, background: '#F8FAFC', borderBottom: '1px solid #E8EDF2', position: 'relative' }}>
                        {months.map(m => (
                          <div key={m.label} style={{
                            position: 'absolute', left: `${m.leftPct}%`, width: `${m.widthPct}%`,
                            height: '100%', borderRight: '1px solid #E8EDF2',
                            display: 'flex', alignItems: 'center', paddingLeft: 8, boxSizing: 'border-box',
                          }}>
                            <span style={{ fontSize: '0.625rem', fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>{m.label}</span>
                          </div>
                        ))}
                      </div>

                      {/* Rows */}
                      {planItems.map((item, i) => {
                        const s   = item.start_date ? new Date(item.start_date).getTime() : rangeStart.getTime();
                        const e   = item.end_date   ? new Date(item.end_date).getTime()   : rangeEnd.getTime();
                        const lft = Math.max(0,   (s - rangeStart.getTime()) / totalMs * 100);
                        const rgt = Math.min(100, (e - rangeStart.getTime()) / totalMs * 100);
                        const w   = Math.max(0.8, rgt - lft);
                        const col = BAR_COLOR[item.status] || '#94A3B8';

                        return (
                          <div key={item.id} style={{
                            height: ROW_H, position: 'relative',
                            background: i % 2 === 0 ? '#fff' : '#FAFBFC',
                            borderBottom: i < planItems.length - 1 ? '1px solid #F1F5F9' : 'none',
                          }}>
                            {/* Grid month dividers */}
                            {months.map(m => (
                              <div key={m.label} style={{
                                position: 'absolute', left: `${m.leftPct + m.widthPct}%`,
                                top: 0, bottom: 0, width: 1, background: '#F1F5F9',
                              }} />
                            ))}
                            {/* Bar */}
                            <div title={`${item.boards?.name} · ${item.status}`} style={{
                              position: 'absolute', left: `${lft}%`, width: `${w}%`,
                              top: '50%', transform: 'translateY(-50%)',
                              height: 24, background: col, borderRadius: 5,
                              opacity: item.status === 'declined' ? 0.35 : 1,
                              display: 'flex', alignItems: 'center', paddingLeft: 7,
                              boxSizing: 'border-box', overflow: 'hidden', minWidth: 6,
                              boxShadow: '0 1px 3px rgba(0,0,0,0.12)',
                            }}>
                              <span style={{ fontSize: '0.5625rem', fontWeight: 700, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {FORMAT_LABELS[item.boards?.format || ''] || item.boards?.format}
                              </span>
                            </div>
                          </div>
                        );
                      })}

                      {/* Today line */}
                      {todayInRange && (
                        <div style={{
                          position: 'absolute', left: `${todayPct}%`,
                          top: 0, bottom: 0, width: 2,
                          background: '#EF4444', zIndex: 10, pointerEvents: 'none',
                        }}>
                          <div style={{ position: 'absolute', top: HEADER_H, left: '50%', transform: 'translateX(-50%)', width: 8, height: 8, borderRadius: '50%', background: '#EF4444' }} />
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* KPI strip */}
              <div className="resp-grid-4" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginTop: 14 }}>
                {[
                  { label: 'Total boards',   value: String(planItems.length) },
                  { label: 'Agreed / Signed', value: String(planItems.filter(i => ['agreed','signed'].includes(i.status)).length) },
                  { label: 'Still pending',  value: String(planItems.filter(i => i.status === 'pending').length) },
                  { label: 'Campaign span',  value: `${durationWeeks} wk${durationWeeks !== 1 ? 's' : ''}` },
                ].map(k => (
                  <div key={k.label} style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: 10, padding: '14px 16px' }}>
                    <p style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 4px' }}>{k.label}</p>
                    <p style={{ fontSize: '1.5rem', fontWeight: 800, color: '#0F172A', fontFamily: 'monospace', letterSpacing: '-0.04em', margin: 0 }}>{k.value}</p>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}

        {/* ── Attribution Tab ── */}
        {activeTab === 'attribution' && (() => {
          const totalScans = trackingLinks.reduce((s, l) => s + l.stats.total, 0);
          const weekScans  = trackingLinks.reduce((s, l) => s + l.stats.week, 0);
          const inputSt: React.CSSProperties = { flex: 1, padding: '7px 10px', border: '1px solid #E2E8F0', borderRadius: 7, fontSize: '0.8125rem', color: '#0F172A', outline: 'none', fontFamily: 'inherit', background: '#fff' };

          return (
            <div>
              {/* KPI strip */}
              {trackingLinks.length > 0 && (
                <div className="resp-grid-3" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 20 }}>
                  {[
                    { label: 'Total scans', value: String(totalScans), color: '#1B4F8A' },
                    { label: 'Last 7 days', value: String(weekScans), color: '#7C3AED' },
                    { label: 'Boards tracked', value: `${trackingLinks.length} / ${planItems.length}`, color: '#10B981' },
                  ].map(k => (
                    <div key={k.label} style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: 12, padding: '16px 20px' }}>
                      <p style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 6px' }}>{k.label}</p>
                      <p style={{ fontSize: '2rem', fontWeight: 800, color: k.color, fontFamily: 'monospace', letterSpacing: '-0.04em', margin: 0 }}>{k.value}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* Board cards */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {planItems.map(item => {
                  const link = trackingLinks.find(l => l.booking_id === item.id);
                  const trackUrl = link ? `${window.location.origin}/t/${link.short_code}` : null;
                  const qrUrl = trackUrl ? `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(trackUrl)}&size=160x160&margin=6&color=0F172A` : null;

                  return (
                    <div key={item.id} style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: 12, overflow: 'hidden' }}>
                      {/* Board header */}
                      <div style={{ padding: '14px 18px', borderBottom: '1px solid #F1F5F9', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                        <div>
                          <p style={{ fontSize: '0.9375rem', fontWeight: 700, color: '#0F172A', margin: '0 0 2px' }}>{item.boards?.name}</p>
                          <p style={{ fontSize: '0.75rem', color: '#94A3B8', margin: 0 }}>
                            {item.boards?.city} · {item.boards?.format?.replace('_', ' ')}
                          </p>
                        </div>
                        {link && (
                          <div style={{ display: 'flex', gap: 16, flexShrink: 0 }}>
                            {[
                              { label: 'Total', value: link.stats.total },
                              { label: 'This week', value: link.stats.week },
                              { label: 'Today', value: link.stats.today },
                              { label: 'Mobile', value: link.stats.mobile > 0 ? `${Math.round((link.stats.mobile / Math.max(1, link.stats.total)) * 100)}%` : '—' },
                            ].map(s => (
                              <div key={s.label} style={{ textAlign: 'center' }}>
                                <p style={{ fontSize: '1.25rem', fontWeight: 800, color: '#0F172A', fontFamily: 'monospace', margin: '0 0 1px', letterSpacing: '-0.02em' }}>{s.value}</p>
                                <p style={{ fontSize: '0.5625rem', fontWeight: 600, color: '#94A3B8', margin: 0, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{s.label}</p>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      <div style={{ padding: '16px 18px' }}>
                        {link ? (
                          <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
                            {/* QR code */}
                            <div style={{ flexShrink: 0, textAlign: 'center' }}>
                              <div style={{ width: 100, height: 100, border: '1px solid #E8EDF2', borderRadius: 8, overflow: 'hidden', background: '#fff' }}>
                                <img src={qrUrl!} style={{ width: '100%', height: '100%' }} alt="QR code" />
                              </div>
                              <a
                                href={qrUrl!}
                                download={`QR-${item.boards?.name?.replace(/\s+/g, '-')}.png`}
                                style={{ display: 'block', marginTop: 5, fontSize: '0.6875rem', color: '#1B4F8A', fontWeight: 600, textDecoration: 'none' }}
                              >
                                Download QR
                              </a>
                            </div>

                            {/* Link info */}
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <p style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 6px' }}>Tracking URL</p>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                                <code style={{ flex: 1, fontSize: '0.8125rem', color: '#1B4F8A', fontFamily: 'monospace', background: '#EFF6FF', padding: '5px 10px', borderRadius: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {trackUrl}
                                </code>
                                <button
                                  onClick={() => copyTrackingUrl(link.short_code)}
                                  style={{ background: copiedCode === link.short_code ? '#10B981' : '#1B4F8A', color: '#fff', border: 'none', borderRadius: 7, padding: '6px 12px', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0, transition: 'background 0.2s' }}
                                >
                                  {copiedCode === link.short_code ? '✓ Copied' : 'Copy'}
                                </button>
                              </div>

                              <p style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 4px' }}>Destination URL</p>
                              <p style={{ fontSize: '0.8125rem', color: '#475569', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{link.target_url}</p>

                              <div style={{ marginTop: 10, background: '#F8FAFC', borderRadius: 6, padding: '8px 10px' }}>
                                <p style={{ fontSize: '0.6875rem', color: '#64748B', margin: 0 }}>
                                  Print or display this QR code on billboard mockups, media proposals, and POE decks. Every scan is logged with device type and timestamp.
                                </p>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div>
                            <p style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#0F172A', margin: '0 0 4px' }}>Set up tracking for this board</p>
                            <p style={{ fontSize: '0.75rem', color: '#94A3B8', margin: '0 0 12px' }}>Enter the brand's destination URL — every QR code scan will be logged and attributed to this board.</p>
                            <div style={{ display: 'flex', gap: 8 }}>
                              <input
                                value={targetUrlInput[item.id] || ''}
                                onChange={e => setTargetUrlInput(prev => ({ ...prev, [item.id]: e.target.value }))}
                                placeholder="https://mtn.ng/fastlink"
                                style={inputSt}
                              />
                              <button
                                onClick={() => createTrackingLink(item.id, item.boards?.name || 'Board')}
                                disabled={creatingLinkFor === item.id || !(targetUrlInput[item.id] || '').trim()}
                                style={{ background: creatingLinkFor === item.id || !(targetUrlInput[item.id] || '').trim() ? '#94A3B8' : '#1B4F8A', color: '#fff', border: 'none', borderRadius: 7, padding: '7px 16px', fontSize: '0.8125rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}
                              >
                                {creatingLinkFor === item.id ? 'Creating…' : 'Generate QR'}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}

                {planItems.length === 0 && (
                  <div style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: 12, padding: '4rem', textAlign: 'center' }}>
                    <p style={{ fontSize: '0.875rem', color: '#94A3B8', margin: 0 }}>Add boards to the plan first, then set up tracking links for each site.</p>
                  </div>
                )}
              </div>
            </div>
          );
        })()}

        {/* ── ARCON Compliance Tab ── */}
        {activeTab === 'arcon' && (() => {
          const statusCfg: Record<string, { label: string; bg: string; color: string; dot: string; desc: string }> = {
            not_submitted: { label: 'Not submitted',  bg: '#F1F5F9', color: '#475569', dot: '#94A3B8', desc: 'Creative has not yet been submitted to ARCON for pre-vetting.' },
            pending:       { label: 'Pending review', bg: '#FFFBEB', color: '#92400E', dot: '#F59E0B', desc: 'Submission sent — awaiting ARCON approval.' },
            approved:      { label: 'Approved',       bg: '#ECFDF5', color: '#065F46', dot: '#10B981', desc: 'ARCON has approved this campaign. It may now go live.' },
            rejected:      { label: 'Rejected',       bg: '#FEF2F2', color: '#7F1D1D', dot: '#EF4444', desc: 'ARCON has rejected this submission. Revise the creative and re-submit.' },
            expired:       { label: 'Expired',        bg: '#FEF3C7', color: '#92400E', dot: '#F59E0B', desc: 'Approval has expired. You must renew with ARCON before continuing.' },
          };
          const current = statusCfg[arconForm.arcon_status || 'not_submitted'];
          const isApproved = arconForm.arcon_status === 'approved';
          const inputSt: React.CSSProperties = { width: '100%', padding: '8px 11px', border: '1px solid #E2E8F0', borderRadius: 7, fontSize: '0.875rem', color: '#0F172A', outline: 'none', fontFamily: 'inherit', background: '#fff', boxSizing: 'border-box' };

          return (
            <div className="resp-2col" style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 16, alignItems: 'start' }}>

              {/* Left — form */}
              <div style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: 12, padding: '22px 24px' }}>
                <h2 style={{ fontSize: '0.9375rem', fontWeight: 700, color: '#0F172A', margin: '0 0 4px' }}>ARCON Compliance Record</h2>
                <p style={{ fontSize: '0.75rem', color: '#94A3B8', margin: '0 0 22px' }}>
                  Under the Advertising Industry Act 2022, all creatives must be pre-vetted and approved by ARCON before going live.
                </p>

                {/* Status select */}
                <div style={{ marginBottom: 16 }}>
                  <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#374151', marginBottom: 5 }}>Approval status</label>
                  <select
                    value={arconForm.arcon_status || 'not_submitted'}
                    onChange={e => setArconForm(f => ({ ...f, arcon_status: e.target.value as Campaign['arcon_status'] }))}
                    style={{ ...inputSt, cursor: 'pointer' }}
                  >
                    <option value="not_submitted">Not submitted</option>
                    <option value="pending">Pending — submitted, awaiting response</option>
                    <option value="approved">Approved</option>
                    <option value="rejected">Rejected</option>
                    <option value="expired">Expired</option>
                  </select>
                </div>

                {/* ARCON reference */}
                <div style={{ marginBottom: 16 }}>
                  <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#374151', marginBottom: 5 }}>
                    ARCON reference number
                    <span style={{ fontWeight: 400, color: '#94A3B8', marginLeft: 4 }}>(from submission receipt or approval letter)</span>
                  </label>
                  <input value={arconForm.arcon_ref} onChange={e => setArconForm(f => ({ ...f, arcon_ref: e.target.value }))} placeholder="e.g. ARCON/2026/04/00291" style={inputSt} />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#374151', marginBottom: 5 }}>Date submitted to ARCON</label>
                    <input type="date" value={arconForm.arcon_submitted_at} onChange={e => setArconForm(f => ({ ...f, arcon_submitted_at: e.target.value }))} style={inputSt} />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#374151', marginBottom: 5 }}>Date approved</label>
                    <input type="date" value={arconForm.arcon_approved_at} onChange={e => setArconForm(f => ({ ...f, arcon_approved_at: e.target.value }))} style={inputSt} />
                  </div>
                </div>

                <div style={{ marginBottom: 16 }}>
                  <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#374151', marginBottom: 5 }}>
                    Approval expiry date
                    <span style={{ fontWeight: 400, color: '#94A3B8', marginLeft: 4 }}>(typically matches campaign end date)</span>
                  </label>
                  <input type="date" value={arconForm.arcon_expiry_date} onChange={e => setArconForm(f => ({ ...f, arcon_expiry_date: e.target.value }))} style={inputSt} />
                </div>

                <div style={{ marginBottom: 22 }}>
                  <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#374151', marginBottom: 5 }}>Notes <span style={{ fontWeight: 400, color: '#94A3B8' }}>(rejection reason, conditions, etc.)</span></label>
                  <textarea value={arconForm.arcon_notes} onChange={e => setArconForm(f => ({ ...f, arcon_notes: e.target.value }))} rows={3} placeholder="e.g. ARCON requested font size adjustment on creative before approval" style={{ ...inputSt, resize: 'vertical' }} />
                </div>

                <button
                  onClick={saveArcon}
                  disabled={savingArcon}
                  style={{ background: savingArcon ? '#94A3B8' : '#1B4F8A', color: '#fff', border: 'none', padding: '10px 22px', borderRadius: 8, fontSize: '0.875rem', fontWeight: 600, cursor: savingArcon ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}
                >
                  {savingArcon ? 'Saving…' : 'Save ARCON record'}
                </button>
              </div>

              {/* Right — status + checklist */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

                {/* Current status card */}
                <div style={{ background: current.bg, border: `1px solid ${current.dot}30`, borderRadius: 12, padding: '18px 20px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <span style={{ width: 9, height: 9, borderRadius: '50%', background: current.dot, flexShrink: 0 }} />
                    <span style={{ fontSize: '0.875rem', fontWeight: 700, color: current.color }}>{current.label}</span>
                  </div>
                  <p style={{ fontSize: '0.8125rem', color: current.color, margin: 0, lineHeight: 1.5, opacity: 0.8 }}>{current.desc}</p>
                  {arconForm.arcon_ref && (
                    <p style={{ fontSize: '0.75rem', fontWeight: 700, color: current.color, margin: '10px 0 0', fontFamily: 'monospace' }}>
                      Ref: {arconForm.arcon_ref}
                    </p>
                  )}
                  {arconForm.arcon_expiry_date && isApproved && (
                    <p style={{ fontSize: '0.6875rem', color: current.color, margin: '4px 0 0', opacity: 0.7 }}>
                      Valid until {new Date(arconForm.arcon_expiry_date).toLocaleDateString('en-NG', { day: 'numeric', month: 'long', year: 'numeric' })}
                    </p>
                  )}
                </div>

                {/* Pre-launch gate */}
                {!isApproved && campaign.status === 'active' && (
                  <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 10, padding: '12px 14px' }}>
                    <p style={{ fontSize: '0.8125rem', fontWeight: 700, color: '#991B1B', margin: '0 0 4px' }}>⚠ Campaign active without approval</p>
                    <p style={{ fontSize: '0.75rem', color: '#B91C1C', margin: 0, lineHeight: 1.5 }}>This campaign is showing as active but does not have ARCON approval on record. Under the Advertising Industry Act 2022, running unapproved ads carries criminal liability.</p>
                  </div>
                )}

                {/* ARCON checklist */}
                <div style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: 12, padding: '16px 18px' }}>
                  <p style={{ fontSize: '0.75rem', fontWeight: 700, color: '#0F172A', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 12px' }}>Submission checklist</p>
                  {[
                    { done: !!campaign.client_name,                        label: 'Advertiser/brand name confirmed' },
                    { done: planItems.length > 0,                          label: `Media plan complete (${planItems.length} board${planItems.length !== 1 ? 's' : ''})` },
                    { done: planItems.some(i => i.creative_type != null),  label: 'Creative type specified on all boards' },
                    { done: !!arconForm.arcon_submitted_at,                label: 'Submitted to ARCON for pre-vetting' },
                    { done: !!arconForm.arcon_ref,                         label: 'ARCON reference number recorded' },
                    { done: isApproved,                                    label: 'ARCON approval received' },
                    { done: !!arconForm.arcon_expiry_date,                 label: 'Approval expiry date logged' },
                  ].map(({ done, label }) => (
                    <div key={label} style={{ display: 'flex', alignItems: 'flex-start', gap: 9, marginBottom: 9 }}>
                      <div style={{ width: 16, height: 16, borderRadius: 4, background: done ? '#10B981' : '#F1F5F9', border: `1px solid ${done ? '#10B981' : '#E2E8F0'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>
                        {done && <svg width="9" height="9" viewBox="0 0 12 12" fill="none"><polyline points="2 6 5 9 10 3" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                      </div>
                      <span style={{ fontSize: '0.75rem', color: done ? '#374151' : '#94A3B8', lineHeight: 1.4 }}>{label}</span>
                    </div>
                  ))}
                </div>

                {/* ARCON contact info */}
                <div style={{ background: '#F8FAFC', border: '1px solid #E8EDF2', borderRadius: 10, padding: '12px 14px' }}>
                  <p style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 8px' }}>ARCON contact</p>
                  {[
                    { label: 'Website',  value: 'arcon.gov.ng' },
                    { label: 'Email',    value: 'info@arcon.gov.ng' },
                    { label: 'Address',  value: '3 Banjul Street, Wuse Zone 4, Abuja' },
                    { label: 'Act',      value: 'Advertising Industry Act 2022' },
                  ].map(({ label, value }) => (
                    <div key={label} style={{ display: 'flex', gap: 8, marginBottom: 4 }}>
                      <span style={{ fontSize: '0.6875rem', color: '#94A3B8', width: 52, flexShrink: 0 }}>{label}</span>
                      <span style={{ fontSize: '0.6875rem', color: '#475569', fontWeight: 500 }}>{value}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          );
        })()}
      </div>

      {/* Send to client modal */}
      {showSendToClient && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)' }} onClick={() => setShowSendToClient(false)} />
          <div style={{ position: 'relative', background: '#fff', borderRadius: 16, width: '100%', maxWidth: 480, boxShadow: '0 24px 64px rgba(0,0,0,0.15)', fontFamily: 'inherit' }}>
            {/* Header */}
            <div style={{ padding: '24px 24px 0', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
              <div>
                <h2 style={{ fontSize: '1.0625rem', fontWeight: 700, color: '#0F172A', margin: '0 0 4px' }}>Send plan to client</h2>
                <p style={{ fontSize: '0.8125rem', color: '#94A3B8', margin: 0 }}>
                  {campaign.name} · {planItems.length} board{planItems.length !== 1 ? 's' : ''} · {formatNaira(totalPlanCost)}
                </p>
              </div>
              <button onClick={() => setShowSendToClient(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8', fontSize: '1.125rem', padding: 4 }}>✕</button>
            </div>

            {/* Body */}
            <div style={{ padding: '20px 24px' }}>
              <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, color: '#374151', marginBottom: 8 }}>
                Select client
              </label>
              {clientProfiles.length === 0 ? (
                <div style={{ padding: '20px', textAlign: 'center', color: '#94A3B8', fontSize: '0.8125rem' }}>
                  No client accounts found
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 280, overflowY: 'auto' }}>
                  {clientProfiles.map(c => (
                    <div
                      key={c.id}
                      onClick={() => setSelectedClientId(c.id)}
                      style={{
                        padding: '12px 14px', borderRadius: 10, cursor: 'pointer',
                        border: `2px solid ${selectedClientId === c.id ? '#7C3AED' : '#E8EDF2'}`,
                        background: selectedClientId === c.id ? '#F5F3FF' : '#fff',
                        transition: 'all 0.12s',
                      }}
                    >
                      <p style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0F172A', margin: '0 0 2px' }}>
                        {c.company_name || c.full_name || 'Unnamed client'}
                      </p>
                      {c.company_name && c.full_name && (
                        <p style={{ fontSize: '0.75rem', color: '#94A3B8', margin: 0 }}>{c.full_name}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {selectedClientId && (
                <div style={{ background: '#EFF6FF', borderRadius: 8, padding: '10px 14px', marginTop: 14 }}>
                  <p style={{ fontSize: '0.8125rem', color: '#1E3A8A', margin: 0 }}>
                    The client will be notified and can review &amp; approve each board from their portal.
                  </p>
                </div>
              )}
            </div>

            {/* Footer */}
            <div style={{ padding: '0 24px 24px', display: 'flex', gap: 10 }}>
              <button
                onClick={() => setShowSendToClient(false)}
                style={{ flex: 1, padding: '11px', background: '#F1F5F9', color: '#374151', border: 'none', borderRadius: 9, fontSize: '0.875rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
              >
                Cancel
              </button>
              <button
                onClick={sendToClient}
                disabled={!selectedClientId || sendingToClient}
                style={{
                  flex: 2, padding: '11px', border: 'none', borderRadius: 9, fontSize: '0.875rem', fontWeight: 600, cursor: !selectedClientId || sendingToClient ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
                  background: !selectedClientId || sendingToClient ? '#CBD5E1' : '#7C3AED',
                  color: '#fff',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                }}
              >
                {sendingToClient ? (
                  <>
                    <div style={{ width: 14, height: 14, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
                    Sending…
                  </>
                ) : (
                  <>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                    Send for approval
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add board slide-in panel */}
      {showAddBoard && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', justifyContent: 'flex-end' }}>
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.4)' }} onClick={() => setShowAddBoard(false)} />
          <div style={{ position: 'relative', width: 480, background: '#fff', height: '100%', boxShadow: '-8px 0 32px rgba(0,0,0,0.1)', display: 'flex', flexDirection: 'column', fontFamily: 'inherit' }}>
            {/* Panel header */}
            <div style={{ padding: '20px 24px', borderBottom: '1px solid #F1F5F9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <h2 style={{ fontSize: '1rem', fontWeight: 700, color: '#0F172A', margin: '0 0 2px' }}>Add board to plan</h2>
                <p style={{ fontSize: '0.75rem', color: '#94A3B8', margin: 0 }}>{campaign.name}</p>
              </div>
              <button onClick={() => setShowAddBoard(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8', fontSize: '1.125rem', display: 'flex', padding: 4 }}>✕</button>
            </div>

            {/* Board search */}
            <div style={{ padding: '16px 24px', borderBottom: '1px solid #F1F5F9' }}>
              <div style={{ position: 'relative' }}>
                <svg style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#94A3B8' }} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                <input
                  placeholder="Search boards by name or city..."
                  value={boardSearch}
                  onChange={e => setBoardSearch(e.target.value)}
                  style={{ width: '100%', padding: '9px 12px 9px 32px', border: '1px solid #E2E8F0', borderRadius: '8px', fontSize: '0.875rem', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }}
                  onFocus={e => e.currentTarget.style.borderColor = '#1B4F8A'}
                  onBlur={e => e.currentTarget.style.borderColor = '#E2E8F0'}
                />
              </div>
            </div>

            {/* Board list */}
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {filteredBoards.length === 0 ? (
                <div style={{ padding: '3rem', textAlign: 'center', color: '#94A3B8' }}>
                  {boardSearch ? 'No boards match your search' : 'All available boards are already in this plan'}
                </div>
              ) : filteredBoards.map(board => (
                <div
                  key={board.id}
                  className="board-row"
                  onClick={() => {
                    setAddForm(f => ({ ...f, boardId: board.id, rate: String(Math.round(board.asking_rate * 0.85)) }));
                  }}
                  style={{
                    padding: '14px 24px', borderBottom: '1px solid #F8FAFC',
                    cursor: 'pointer', transition: 'all 0.15s',
                    background: addForm.boardId === board.id ? '#EFF6FF' : 'transparent',
                    borderLeft: addForm.boardId === board.id ? '3px solid #1B4F8A' : '3px solid transparent',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <p style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0F172A', margin: '0 0 3px' }}>{board.name}</p>
                      <p style={{ fontSize: '0.75rem', color: '#64748B', margin: '0 0 4px' }}>{board.address}</p>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <span style={{ fontSize: '0.6875rem', fontWeight: 600, color: '#475569', background: '#F1F5F9', padding: '1px 6px', borderRadius: 3 }}>
                          {FORMAT_LABELS[board.format] || board.format}
                        </span>
                        <span style={{ fontSize: '0.6875rem', color: '#94A3B8' }}>{board.city}</span>
                      </div>
                    </div>
                    <span style={{ fontSize: '0.875rem', fontWeight: 700, color: '#0F172A', fontFamily: 'monospace' }}>
                      {formatNaira(board.asking_rate)}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            {/* Add form — shows when board selected */}
            {addForm.boardId && (
              <div style={{ padding: '20px 24px', borderTop: '1px solid #E8EDF2', background: '#F8FAFC' }}>
                <p style={{ fontSize: '0.75rem', fontWeight: 700, color: '#0F172A', margin: '0 0 12px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Configure: {allBoards.find(b => b.id === addForm.boardId)?.name}
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 500, color: '#374151', marginBottom: 4 }}>Rate/month (₦) *</label>
                    <input
                      type="number"
                      value={addForm.rate}
                      onChange={e => setAddForm(f => ({ ...f, rate: e.target.value }))}
                      style={{ width: '100%', padding: '8px 10px', border: '1px solid #E2E8F0', borderRadius: '7px', fontSize: '0.875rem', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }}
                    />
                    {addForm.rate && (
                      <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: '3px 0 0' }}>
                        = {formatNaira(parseFloat(addForm.rate))}
                      </p>
                    )}
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 500, color: '#374151', marginBottom: 4 }}>Duration (months)</label>
                    <select
                      value={addForm.durationMonths}
                      onChange={e => setAddForm(f => ({ ...f, durationMonths: e.target.value }))}
                      style={{ width: '100%', padding: '8px 10px', border: '1px solid #E2E8F0', borderRadius: '7px', fontSize: '0.875rem', outline: 'none', background: '#fff', fontFamily: 'inherit', boxSizing: 'border-box' }}
                    >
                      {[1,2,3,4,5,6,7,8,9,10,11,12].map(m => <option key={m} value={m}>{m} month{m > 1 ? 's' : ''}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 500, color: '#374151', marginBottom: 4 }}>Creative type</label>
                    <select
                      value={addForm.creativeType}
                      onChange={e => setAddForm(f => ({ ...f, creativeType: e.target.value as 'static' | 'led' | 'digital' }))}
                      style={{ width: '100%', padding: '8px 10px', border: '1px solid #E2E8F0', borderRadius: '7px', fontSize: '0.875rem', outline: 'none', background: '#fff', fontFamily: 'inherit', boxSizing: 'border-box' }}
                    >
                      <option value="static">Static (print)</option>
                      <option value="led">LED / Digital</option>
                      <option value="digital">Programmatic DOOH</option>
                    </select>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 20 }}>
                    <input
                      type="checkbox"
                      id="printReq"
                      checked={addForm.printRequired}
                      onChange={e => setAddForm(f => ({ ...f, printRequired: e.target.checked }))}
                      style={{ width: 14, height: 14, cursor: 'pointer' }}
                    />
                    <label htmlFor="printReq" style={{ fontSize: '0.8125rem', color: '#374151', cursor: 'pointer' }}>
                      Print required
                    </label>
                  </div>
                </div>

                {/* Market rate intelligence panel */}
                {(() => {
                  const board = allBoards.find(b => b.id === addForm.boardId);
                  if (!board) return null;
                  if (marketRateLoading) {
                    return (
                      <div style={{ background: '#F8FAFC', border: '1px dashed #CBD5E1', borderRadius: 7, padding: '8px 12px', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ width: 10, height: 10, border: '1.5px solid #CBD5E1', borderTopColor: '#1B4F8A', borderRadius: '50%', animation: 'spin 0.7s linear infinite', flexShrink: 0 }} />
                        <span style={{ fontSize: '0.6875rem', color: '#94A3B8' }}>Loading market data…</span>
                      </div>
                    );
                  }
                  if (!marketRate) {
                    return (
                      <div style={{ background: '#F8FAFC', border: '1px dashed #CBD5E1', borderRadius: 7, padding: '8px 12px', marginBottom: 10 }}>
                        <span style={{ fontSize: '0.6875rem', color: '#94A3B8' }}>
                          Building market data — no closed deals for {board.format} in {board.city} yet
                        </span>
                      </div>
                    );
                  }
                  const enteredRate = parseFloat(addForm.rate);
                  const vsAvg = !isNaN(enteredRate) && marketRate.avg > 0
                    ? Math.round(((enteredRate - marketRate.avg) / marketRate.avg) * 100)
                    : null;
                  const isLow = vsAvg !== null && vsAvg < -10;
                  const isHigh = vsAvg !== null && vsAvg > 15;
                  return (
                    <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 7, padding: '8px 12px', marginBottom: 10 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#D97706" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
                        <span style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#92400E', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Market Intel</span>
                        <span style={{ fontSize: '0.6875rem', color: '#92400E' }}>·</span>
                        <span style={{ fontSize: '0.6875rem', color: '#92400E' }}>
                          {marketRate.count < 5 ? `${marketRate.count} deal${marketRate.count !== 1 ? 's' : ''} (limited data)` : `${marketRate.count} closed deals`}
                        </span>
                      </div>
                      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '0.75rem', color: '#0F172A' }}>
                          <span style={{ color: '#94A3B8', marginRight: 3 }}>avg</span>
                          <strong style={{ fontFamily: 'monospace' }}>{formatNaira(marketRate.avg)}</strong>
                        </span>
                        <span style={{ fontSize: '0.75rem', color: '#0F172A' }}>
                          <span style={{ color: '#94A3B8', marginRight: 3 }}>min</span>
                          <strong style={{ fontFamily: 'monospace' }}>{formatNaira(marketRate.min)}</strong>
                        </span>
                        <span style={{ fontSize: '0.75rem', color: '#0F172A' }}>
                          <span style={{ color: '#94A3B8', marginRight: 3 }}>max</span>
                          <strong style={{ fontFamily: 'monospace' }}>{formatNaira(marketRate.max)}</strong>
                        </span>
                      </div>
                      {vsAvg !== null && (
                        <p style={{ fontSize: '0.6875rem', margin: '4px 0 0', color: isLow ? '#059669' : isHigh ? '#EF4444' : '#92400E', fontWeight: 600 }}>
                          {isLow
                            ? `Your rate is ${Math.abs(vsAvg)}% below market — good deal`
                            : isHigh
                              ? `Your rate is ${vsAvg}% above market`
                              : `Your rate is within normal market range`}
                        </p>
                      )}
                    </div>
                  );
                })()}

                {addForm.rate && addForm.durationMonths && (
                  <div style={{ background: '#EFF6FF', borderRadius: 7, padding: '8px 12px', marginBottom: 10 }}>
                    <span style={{ fontSize: '0.75rem', color: '#1E3A8A', fontWeight: 600 }}>
                      Total cost: {formatNaira(parseFloat(addForm.rate) * parseInt(addForm.durationMonths))}
                      {' '}({addForm.durationMonths} month{parseInt(addForm.durationMonths) > 1 ? 's' : ''})
                    </span>
                  </div>
                )}

                <button
                  onClick={addBoardToPlan}
                  disabled={saving || !addForm.rate}
                  style={{ width: '100%', padding: '11px', background: saving || !addForm.rate ? '#94A3B8' : '#1B4F8A', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '0.875rem', fontWeight: 600, cursor: saving || !addForm.rate ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}
                >
                  {saving ? 'Adding...' : 'Add to plan'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Artwork needs-attention banner */}
      {planItems.length > 0 && (() => {
        const agreedWithNoArtwork = planItems.filter(i =>
          ['agreed','signed','live'].includes(i.status) && !creativesByBooking[i.id]
        );
        if (agreedWithNoArtwork.length === 0) return null;
        return (
          <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 10, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, marginTop: '1.25rem' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#D97706" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
            <p style={{ fontSize: '0.8125rem', color: '#92400E', margin: 0 }}>
              <strong>{agreedWithNoArtwork.length} agreed board{agreedWithNoArtwork.length !== 1 ? 's' : ''} still need artwork.</strong>{' '}
              Click <strong>Upload</strong> in the Artwork column for each board.
            </p>
          </div>
        );
      })()}

      {/* Creative upload panel */}
      {uploadingFor && (
        <CreativeUploadPanel
          bookingId={uploadingFor.id}
          board={uploadingFor.boards}
          existing={creativesByBooking[uploadingFor.id] || null}
          onClose={() => setUploadingFor(null)}
          onUploaded={upload => {
            setCreativesByBooking(prev => ({ ...prev, [upload.booking_id]: upload }));
            setUploadingFor(null);
            showToast(`Artwork uploaded for ${uploadingFor.boards?.name}`);
          }}
        />
      )}

      <ConfirmDialog
        open={!!removeConfirm}
        title={`Remove ${removeConfirm?.name ?? 'board'} from plan?`}
        description="The booking record will be deleted. This cannot be undone."
        confirmLabel="Remove"
        variant="danger"
        onConfirm={confirmRemoveFromPlan}
        onCancel={() => setRemoveConfirm(null)}
      />
      <ConfirmDialog
        open={approveConfirm}
        title="Mark plan as client-approved?"
        description="This will set the campaign status to Active and record client approval. Make sure the client has reviewed all boards."
        confirmLabel="Approve"
        variant="default"
        onConfirm={confirmApprovePlan}
        onCancel={() => setApproveConfirm(false)}
      />

    </>
  );
}