'use client';

import { useState, useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { createNotification } from '@/lib/notifications';
import { getActivityActor, logActivity } from '@/lib/activity-log';
import ActivityTimeline from '@/components/activity/ActivityTimeline';

type Booking = {
  id: string;
  offered_rate: number;
  agreed_rate: number | null;
  status: string;
  start_date: string;
  end_date: string;
  notes: string | null;
  created_at: string;
  mpo_number?: string | null;
  mpo_issued_at?: string | null;
  mpo_agency_name?: string | null;
  boards: {
    id: string;
    name: string;
    address: string;
    city: string;
    state: string;
    format: string;
    asking_rate: number;
    width: number;
    height: number;
    photos: string[];
    contact_phone: string | null;
  };
  campaigns: {
    id: string;
    name: string;
    client_name: string | null;
  };
};

type Message = {
  id: string;
  booking_id: string;
  sender_role: 'agency' | 'owner';
  message_type: 'message' | 'offer' | 'counter_offer' | 'accepted' | 'declined';
  content: string;
  offered_rate: number | null;
  created_at: string;
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
  return new Date(dateStr).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' });
}

type ActionMode = null | 'message' | 'counter' | 'accept' | 'decline';

export default function NegotiationDetailPage() {
  const { id: idParam } = useParams();
  const id = typeof idParam === 'string' ? idParam : idParam?.[0] ?? '';
  const router = useRouter();
  const bottomRef = useRef<HTMLDivElement>(null);

  const [booking, setBooking] = useState<Booking | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionMode, setActionMode] = useState<ActionMode>(null);
  const [messageText, setMessageText] = useState('');
  const [counterRate, setCounterRate] = useState('');
  const [sending, setSending]       = useState(false);
  const [exportingMPO, setExportingMPO] = useState(false);
  const [activityKey, setActivityKey] = useState(0);
  const [exportingContract, setExportingContract] = useState(false);
  const [showPhone, setShowPhone] = useState(false);

  useEffect(() => {
    if (!id) return;
    fetchBooking();
    fetchMessages();
    const unsub = subscribeToMessages();
    return unsub;
  }, [id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function fetchBooking() {
    const { data } = await supabase
      .from('bookings')
      .select(`*, boards!bookings_board_id_fkey (*), campaigns!bookings_campaign_id_fkey (id, name, client_name)`)
      .eq('id', id)
      .single();
    if (data) setBooking(data as Booking);
    setLoading(false);
  }

  async function fetchMessages() {
    const { data } = await supabase
      .from('messages')
      .select('*')
      .eq('booking_id', id)
      .order('created_at', { ascending: true });
    if (data) setMessages(data as Message[]);
  }

  function subscribeToMessages() {
    const channel = supabase
      .channel(`agency-msgs-${id}-${Math.random().toString(36).slice(2, 7)}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `booking_id=eq.${id}`,
      }, (payload) => {
        setMessages(prev => [...prev, payload.new as Message]);
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }

  async function sendMessage() {
    if (!booking) return;
    setSending(true);

    let messageType: Message['message_type'] = 'message';
    let content = messageText;
    let rate: number | null = null;
    let newStatus = booking.status;

    if (actionMode === 'counter') {
      messageType = 'counter_offer';
      rate = parseFloat(counterRate);
      content = messageText || `Counter offer: ${formatNaira(rate)} per month`;
      newStatus = 'negotiating';
    } else if (actionMode === 'accept') {
      messageType = 'accepted';
      content = messageText || 'Offer accepted. Looking forward to working together.';
      newStatus = 'agreed';
    } else if (actionMode === 'decline') {
      messageType = 'declined';
      content = messageText || 'Thank you for your interest. We are unable to proceed at this time.';
      newStatus = 'declined';
    } else {
      if (!messageText.trim()) { setSending(false); return; }
      newStatus = booking.status === 'pending' ? 'negotiating' : booking.status;
    }

    const { error: msgError } = await supabase.from('messages').insert({
      booking_id: booking.id,
      sender_role: 'agency',
      message_type: messageType,
      content,
      offered_rate: rate,
    });

    if (msgError) { console.error(msgError); setSending(false); return; }

    const updateData: Record<string, unknown> = { status: newStatus };
    if (actionMode === 'accept') updateData.agreed_rate = booking.offered_rate;
    if (actionMode === 'counter' && rate) updateData.offered_rate = rate;
    const prevStatus = booking.status;
    await supabase.from('bookings').update(updateData).eq('id', booking.id);

    const boardName = booking.boards?.name || 'a board';
    const actor = await getActivityActor();
    const campaignId = (booking.campaigns as { id?: string })?.id;

    if (actionMode === 'accept' || actionMode === 'decline' || actionMode === 'counter') {
      await logActivity({
        entityType: 'booking',
        entityId: booking.id,
        campaignId,
        action: 'booking.status_changed',
        summary: actionMode === 'accept'
          ? `Agency accepted — ${boardName} at ${formatNaira(booking.offered_rate)}/mo`
          : actionMode === 'decline'
            ? `Agency declined — ${boardName}`
            : `Agency counter offer — ${formatNaira(parseFloat(counterRate))}/mo for ${boardName}`,
        ...actor,
        changes: { status: { from: prevStatus, to: newStatus } },
      });
    } else {
      await logActivity({
        entityType: 'booking',
        entityId: booking.id,
        campaignId,
        action: 'booking.message_sent',
        summary: `Message sent to owner re ${boardName}`,
        ...actor,
      });
    }

    if (actionMode === 'accept') {
      await createNotification({ recipientRole: 'owner', type: 'offer_accepted', title: 'Agency accepted your terms', body: `Deal confirmed for ${boardName}`, link: `/dashboard/owner/negotiations/${booking.id}` });
    } else if (actionMode === 'decline') {
      await createNotification({ recipientRole: 'owner', type: 'offer_declined', title: 'Agency declined', body: `Booking for ${boardName} was declined`, link: `/dashboard/owner/negotiations/${booking.id}` });
    } else if (actionMode === 'counter') {
      await createNotification({ recipientRole: 'owner', type: 'counter_offer', title: 'Agency sent a counter offer', body: `${formatNaira(parseFloat(counterRate))}/month for ${boardName}`, link: `/dashboard/owner/negotiations/${booking.id}` });
    } else {
      await createNotification({ recipientRole: 'owner', type: 'message', title: 'New message from agency', body: content.slice(0, 80), link: `/dashboard/owner/negotiations/${booking.id}` });
    }

    await fetchBooking();
    setMessageText('');
    setCounterRate('');
    setActionMode(null);
    setSending(false);
    setActivityKey(k => k + 1);
  }

  async function handleRaiseMPO() {
    if (!booking) return;
    setExportingMPO(true);
    try {
      const agencyName = (typeof localStorage !== 'undefined' && localStorage.getItem('ooh_company_name')) || 'OOH Platform Agency';
      const mpoNum = `OOH-MPO-${new Date().getFullYear()}-${booking.id.slice(0, 6).toUpperCase()}`;

      const res = await fetch('/api/mpo-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          booking_id:    booking.id,
          campaign_name: booking.campaigns?.name || 'Campaign',
          client_name:   booking.campaigns?.client_name || '',
          start_date:    booking.start_date,
          end_date:      booking.end_date,
          agreed_rate:   booking.agreed_rate || booking.offered_rate,
          board_name:    booking.boards?.name || '',
          board_address: booking.boards?.address || '',
          board_city:    booking.boards?.city || '',
          board_state:   booking.boards?.state || '',
          board_format:  booking.boards?.format || 'billboard',
          board_width:   booking.boards?.width,
          board_height:  booking.boards?.height,
          agency_name:   agencyName,
        }),
      });
      if (!res.ok) throw new Error('PDF failed');

      // Download the PDF
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `MPO-${booking.boards?.name?.replace(/\s+/g, '-') || booking.id}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      // Stamp the booking so the owner can see it in their dashboard
      await supabase.from('bookings').update({
        mpo_number:      mpoNum,
        mpo_issued_at:   new Date().toISOString(),
        mpo_agency_name: agencyName,
      }).eq('id', booking.id);

      // Notify the owner so they know to create their invoice
      await createNotification({
        recipientRole: 'owner',
        type: 'mpo_raised',
        title: 'MPO received — create your invoice',
        body: `${agencyName} has raised MPO ${mpoNum} for ${booking.boards?.name || 'your board'}`,
        link: '/dashboard/owner?tab=invoices',
      });

      const actor = await getActivityActor();
      await logActivity({
        entityType: 'booking',
        entityId: booking.id,
        campaignId: (booking.campaigns as { id?: string })?.id,
        action: 'booking.mpo_raised',
        summary: `MPO ${mpoNum} raised for ${booking.boards?.name || 'board'}`,
        ...actor,
        metadata: { mpo_number: mpoNum, agreed_rate: booking.agreed_rate || booking.offered_rate },
      });

      setBooking(prev => prev ? { ...prev, mpo_number: mpoNum, mpo_issued_at: new Date().toISOString(), mpo_agency_name: agencyName } : prev);
      setActivityKey(k => k + 1);
    } catch {
      // silent — user will notice the download didn't happen
    } finally {
      setExportingMPO(false);
    }
  }

  async function handleDownloadContract() {
    if (!booking) return;
    setExportingContract(true);
    try {
      const agencyName = (typeof localStorage !== 'undefined' && localStorage.getItem('ooh_company_name')) || 'OOH Platform Agency';
      const res = await fetch('/api/contract-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          booking_id:    booking.id,
          agency_name:   agencyName,
          owner_name:    'Board Owner',
          board_name:    booking.boards?.name || '',
          board_address: booking.boards?.address || '',
          board_city:    booking.boards?.city || '',
          board_state:   booking.boards?.state || '',
          board_format:  booking.boards?.format || 'billboard',
          board_width:   booking.boards?.width,
          board_height:  booking.boards?.height,
          campaign_name: booking.campaigns?.name || 'Campaign',
          client_name:   booking.campaigns?.client_name || '',
          start_date:    booking.start_date,
          end_date:      booking.end_date,
          agreed_rate:   booking.agreed_rate || booking.offered_rate,
          notes:         booking.notes || undefined,
        }),
      });
      if (!res.ok) throw new Error('PDF failed');
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href = url;
      a.download = `Contract-${booking.boards?.name?.replace(/\s+/g, '-') || booking.id}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      // silent
    } finally {
      setExportingContract(false);
    }
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{
            width: 36, height: 36, border: '2.5px solid #1B4F8A',
            borderTopColor: 'transparent', borderRadius: '50%',
            animation: 'spin 0.8s linear infinite', margin: '0 auto 12px'
          }} />
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          <p style={{ fontSize: '0.8125rem', color: '#94A3B8', margin: 0 }}>Loading negotiation…</p>
        </div>
      </div>
    );
  }

  if (!booking) {
    return (
      <div style={{ textAlign: 'center', padding: '5rem 0', color: '#94A3B8' }}>
        <p style={{ fontSize: '0.9375rem' }}>Booking not found</p>
      </div>
    );
  }

  const statusCfg = STATUS[booking.status] || STATUS.pending;
  const isResolved = ['agreed', 'signed', 'live', 'completed', 'declined'].includes(booking.status);
  const photo = booking.boards?.photos?.[0];
  const savingsAmt = booking.agreed_rate && booking.boards?.asking_rate
    ? booking.boards.asking_rate - booking.agreed_rate : null;
  const savingsPct = savingsAmt && booking.boards?.asking_rate
    ? Math.round((savingsAmt / booking.boards.asking_rate) * 100) : null;
  const offerPct = booking.boards?.asking_rate
    ? Math.round((booking.offered_rate / booking.boards.asking_rate) * 100) : null;

  return (
    <div style={{ fontFamily: "'DM Sans','Inter',sans-serif", display: 'flex', flexDirection: 'column', height: 'calc(100vh - 7rem)' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=DM+Mono:wght@400;500&display=swap');
        .msg-thread::-webkit-scrollbar { width: 4px; }
        .msg-thread::-webkit-scrollbar-track { background: transparent; }
        .msg-thread::-webkit-scrollbar-thumb { background: #E2E8F0; border-radius: 99px; }
        .action-btn { transition: all 0.15s ease; cursor: pointer; border: none; }
        .action-btn:hover { transform: translateY(-1px); }
        .action-btn:active { transform: translateY(0); }
        .composer-area { transition: all 0.2s cubic-bezier(0.4,0,0.2,1); }
        @keyframes slideUp { from { opacity:0; transform:translateY(10px); } to { opacity:1; transform:translateY(0); } }
        .slide-up { animation: slideUp 0.2s ease forwards; }
        @keyframes msgIn { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:translateY(0); } }
        .msg-in { animation: msgIn 0.25s ease forwards; }
        .left-panel::-webkit-scrollbar { width: 4px; }
        .left-panel::-webkit-scrollbar-track { background: transparent; }
        .left-panel::-webkit-scrollbar-thumb { background: #E2E8F0; border-radius: 99px; }
      `}</style>

      {/* ── Page header ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px', flexShrink: 0 }}>
        <button
          onClick={() => router.push('/dashboard/agency/negotiations')}
          style={{
            width: 34, height: 34, borderRadius: '10px', border: '1px solid #E2E8F0',
            background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', flexShrink: 0, transition: 'all 0.15s',
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = '#F8FAFC'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = '#fff'; }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#64748B" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <h1 style={{ fontSize: '1.0625rem', fontWeight: 600, color: '#0F172A', margin: 0, letterSpacing: '-0.02em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {booking.boards?.name}
            </h1>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: '5px',
              background: statusCfg.bg, color: statusCfg.color,
              padding: '3px 10px', borderRadius: '999px',
              fontSize: '0.6875rem', fontWeight: 600, flexShrink: 0, letterSpacing: '0.01em'
            }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: statusCfg.dot }} />
              {statusCfg.label}
            </span>
          </div>
          <p style={{ fontSize: '0.75rem', color: '#94A3B8', margin: '2px 0 0' }}>
            {booking.campaigns?.name} · {booking.boards?.city}{booking.boards?.state ? `, ${booking.boards.state}` : ''}
          </p>
        </div>
      </div>

      {/* ── Two-column layout ── */}
      <div style={{ display: 'flex', gap: '16px', flex: 1, minHeight: 0 }}>

        {/* ── Left panel ── */}
        <div className="left-panel" style={{ width: 264, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '12px', overflowY: 'auto' }}>

          {/* Board photo hero */}
          <div style={{ borderRadius: '14px', overflow: 'hidden', position: 'relative', flexShrink: 0 }}>
            {photo ? (
              <img src={photo} alt={booking.boards?.name} style={{ width: '100%', height: 160, objectFit: 'cover', display: 'block' }} />
            ) : (
              <div style={{ width: '100%', height: 160, background: 'linear-gradient(135deg, #1e293b 0%, #334155 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="1.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </div>
            )}
            {/* Gradient overlay */}
            <div style={{
              position: 'absolute', bottom: 0, left: 0, right: 0, height: '60%',
              background: 'linear-gradient(to top, rgba(15,23,42,0.85) 0%, transparent 100%)',
              display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', padding: '12px'
            }}>
              <span style={{
                display: 'inline-block', background: 'rgba(255,255,255,0.15)', backdropFilter: 'blur(8px)',
                color: '#fff', fontSize: '0.625rem', fontWeight: 600, padding: '2px 8px',
                borderRadius: '5px', width: 'fit-content', marginBottom: '4px', letterSpacing: '0.04em',
                textTransform: 'uppercase', border: '1px solid rgba(255,255,255,0.15)'
              }}>
                {FORMAT_LABELS[booking.boards?.format] || booking.boards?.format}
              </span>
              <p style={{ color: '#fff', fontSize: '0.8125rem', fontWeight: 600, margin: 0, lineHeight: 1.3 }}>
                {booking.boards?.name}
              </p>
            </div>
          </div>

          {/* Contact owner card */}
          {(() => {
            const raw = booking.boards?.contact_phone;
            const wa  = raw?.replace(/\s/g, '').replace(/^0/, '234');
            const waMsg = encodeURIComponent(
              `Hi, I found your board listing "${booking.boards?.name}" on OOH Platform and I'm interested.\n\nCan we discuss availability and pricing?`
            );
            return (
              <div style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 14, padding: '14px 16px', flexShrink: 0 }}>
                <p style={{ fontSize: '0.6875rem', fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 10px' }}>
                  Contact owner
                </p>
                {raw ? (
                  showPhone ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div style={{ background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 8, padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#16A34A" strokeWidth="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.6 1.36h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 9a16 16 0 0 0 6.1 6.1l.91-.91a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
                        <span style={{ fontSize: '0.875rem', fontWeight: 700, color: '#15803D', letterSpacing: '0.02em' }}>{raw}</span>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                        <a href={`tel:${raw}`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '9px', borderRadius: 9, background: '#F1F5F9', border: '1.5px solid #E2E8F0', color: '#0F172A', textDecoration: 'none', fontSize: '0.75rem', fontWeight: 700 }}>
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.6 1.36h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 9a16 16 0 0 0 6.1 6.1l.91-.91a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
                          Call
                        </a>
                        <a href={`https://wa.me/${wa}?text=${waMsg}`} target="_blank" rel="noopener noreferrer" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '9px', borderRadius: 9, background: '#25D366', color: '#fff', textDecoration: 'none', fontSize: '0.75rem', fontWeight: 700 }}>
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                          WhatsApp
                        </a>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => setShowPhone(true)}
                      style={{ width: '100%', padding: '10px', borderRadius: 9, border: '1.5px dashed #CBD5E1', background: '#F8FAFC', color: '#1B4F8A', fontSize: '0.8125rem', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.6 1.36h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 9a16 16 0 0 0 6.1 6.1l.91-.91a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
                      Show phone number
                    </button>
                  )
                ) : (
                  <p style={{ fontSize: '0.75rem', color: '#94A3B8', margin: 0, textAlign: 'center', padding: '8px 0' }}>
                    No phone listed — use the chat to reach the owner
                  </p>
                )}
              </div>
            );
          })()}

          {/* Rate comparison card */}
          <div style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: '14px', padding: '14px 16px' }}>
            <p style={{ fontSize: '0.6875rem', fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 12px' }}>Rate comparison</p>

            <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
              <div style={{ flex: 1, background: '#F8FAFC', borderRadius: '10px', padding: '10px 12px' }}>
                <p style={{ fontSize: '0.625rem', color: '#94A3B8', margin: '0 0 3px', fontWeight: 500 }}>YOUR OFFER</p>
                <p style={{ fontSize: '1rem', fontWeight: 700, color: '#1B4F8A', margin: 0, fontFamily: "'DM Mono', monospace", letterSpacing: '-0.02em' }}>
                  {formatNaira(booking.agreed_rate || booking.offered_rate)}
                </p>
              </div>
              <div style={{ flex: 1, background: '#F8FAFC', borderRadius: '10px', padding: '10px 12px' }}>
                <p style={{ fontSize: '0.625rem', color: '#94A3B8', margin: '0 0 3px', fontWeight: 500 }}>ASKING</p>
                <p style={{ fontSize: '1rem', fontWeight: 700, color: '#64748B', margin: 0, fontFamily: "'DM Mono', monospace", letterSpacing: '-0.02em' }}>
                  {formatNaira(booking.boards?.asking_rate)}
                </p>
              </div>
            </div>

            {/* Progress bar */}
            {offerPct !== null && (
              <div style={{ marginBottom: '8px' }}>
                <div style={{ height: 5, background: '#F1F5F9', borderRadius: '99px', overflow: 'hidden' }}>
                  <div style={{
                    height: '100%', width: `${Math.min(offerPct, 100)}%`,
                    background: offerPct >= 90 ? '#10B981' : offerPct >= 70 ? '#3B82F6' : '#F59E0B',
                    borderRadius: '99px', transition: 'width 0.6s cubic-bezier(0.4,0,0.2,1)'
                  }} />
                </div>
                <p style={{ fontSize: '0.6875rem', color: '#64748B', margin: '5px 0 0', fontWeight: 500 }}>
                  {offerPct}% of asking price
                </p>
              </div>
            )}

            {savingsAmt && savingsAmt > 0 && (
              <div style={{ background: '#ECFDF5', border: '1px solid #A7F3D0', borderRadius: '8px', padding: '7px 10px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="2.5">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                <p style={{ fontSize: '0.75rem', color: '#065F46', fontWeight: 600, margin: 0 }}>
                  {formatNaira(savingsAmt)} saved{savingsPct ? ` (${savingsPct}%)` : ''}
                </p>
              </div>
            )}
          </div>

          {/* Board details */}
          <div style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: '14px', padding: '14px 16px' }}>
            <p style={{ fontSize: '0.6875rem', fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 10px' }}>Board details</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '9px' }}>
              {[
                { label: 'Location', value: [booking.boards?.city, booking.boards?.state].filter(Boolean).join(', ') },
                { label: 'Address', value: booking.boards?.address },
                { label: 'Dimensions', value: booking.boards?.width && booking.boards?.height ? `${booking.boards.width}m × ${booking.boards.height}m` : null },
              ].filter(r => r.value).map(({ label, value }) => (
                <div key={label} style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px' }}>
                  <span style={{ fontSize: '0.75rem', color: '#94A3B8', whiteSpace: 'nowrap' }}>{label}</span>
                  <span style={{ fontSize: '0.75rem', fontWeight: 500, color: '#334155', textAlign: 'right' }}>{value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Campaign + dates */}
          <div style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: '14px', padding: '14px 16px' }}>
            <p style={{ fontSize: '0.6875rem', fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 10px' }}>Campaign</p>
            <p style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#0F172A', margin: '0 0 8px' }}>{booking.campaigns?.name}</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {[
                { label: 'Start', value: formatDate(booking.start_date) },
                { label: 'End', value: formatDate(booking.end_date) },
              ].map(({ label, value }) => (
                <div key={label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '0.75rem', color: '#94A3B8' }}>{label}</span>
                  <span style={{ fontSize: '0.75rem', fontWeight: 500, color: '#334155' }}>{value}</span>
                </div>
              ))}
            </div>
          </div>

          <ActivityTimeline
            entityType="booking"
            entityId={id}
            title="Audit trail"
            refreshKey={activityKey}
          />

          {booking.notes && (
            <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: '14px', padding: '14px 16px' }}>
              <p style={{ fontSize: '0.6875rem', fontWeight: 600, color: '#92400E', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 6px' }}>Initial notes</p>
              <p style={{ fontSize: '0.75rem', color: '#78350F', lineHeight: 1.6, margin: 0, fontStyle: 'italic' }}>"{booking.notes}"</p>
            </div>
          )}

          {/* Raise MPO — only available once deal is agreed/live */}
          {['agreed', 'signed', 'live'].includes(booking.status) && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {booking.mpo_issued_at && (
                <div style={{ background: '#ECFDF5', border: '1px solid #A7F3D0', borderRadius: 10, padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: '0.75rem' }}>✅</span>
                  <div>
                    <p style={{ fontSize: '0.75rem', fontWeight: 700, color: '#065F46', margin: 0 }}>MPO issued — {booking.mpo_number}</p>
                    <p style={{ fontSize: '0.6875rem', color: '#10B981', margin: 0 }}>Owner notified · {new Date(booking.mpo_issued_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</p>
                  </div>
                </div>
              )}
              <button
                onClick={handleRaiseMPO}
                disabled={exportingMPO}
                style={{
                  width: '100%', padding: '12px 16px',
                  background: exportingMPO ? '#F1F5F9' : booking.mpo_issued_at ? '#F8FAFC' : '#0F172A',
                  color: exportingMPO ? '#94A3B8' : booking.mpo_issued_at ? '#64748B' : '#fff',
                  border: booking.mpo_issued_at ? '1px solid #E2E8F0' : 'none', borderRadius: '14px',
                  fontSize: '0.8125rem', fontWeight: 700,
                  cursor: exportingMPO ? 'not-allowed' : 'pointer',
                  fontFamily: 'inherit', transition: 'all 0.15s',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  boxShadow: exportingMPO || booking.mpo_issued_at ? 'none' : '0 4px 14px rgba(15,23,42,0.25)',
                }}
              >
                {exportingMPO ? (
                  <>
                    <span style={{ width: 14, height: 14, border: '2px solid #CBD5E1', borderTopColor: '#1B4F8A', borderRadius: '50%', animation: 'spin 0.7s linear infinite', display: 'inline-block' }} />
                    Generating MPO…
                  </>
                ) : (
                  <>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                      <polyline points="14 2 14 8 20 8"/>
                      <line x1="12" y1="18" x2="12" y2="12"/>
                      <line x1="9" y1="15" x2="15" y2="15"/>
                    </svg>
                    {booking.mpo_issued_at ? 'Re-download MPO' : 'Raise MPO'}
                  </>
                )}
              </button>

              {/* Download contract */}
              <button
                onClick={handleDownloadContract}
                disabled={exportingContract}
                style={{
                  width: '100%', padding: '11px 16px',
                  background: exportingContract ? '#F1F5F9' : '#F5F3FF',
                  color: exportingContract ? '#94A3B8' : '#5B21B6',
                  border: '1px solid #DDD6FE', borderRadius: '14px',
                  fontSize: '0.8125rem', fontWeight: 700,
                  cursor: exportingContract ? 'not-allowed' : 'pointer',
                  fontFamily: 'inherit', transition: 'all 0.15s',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                }}
              >
                {exportingContract ? (
                  <>
                    <span style={{ width: 13, height: 13, border: '2px solid #DDD6FE', borderTopColor: '#7C3AED', borderRadius: '50%', animation: 'spin 0.7s linear infinite', display: 'inline-block' }} />
                    Generating…
                  </>
                ) : (
                  <>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                      <polyline points="14 2 14 8 20 8"/>
                      <line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="15" y2="17"/>
                    </svg>
                    Download contract
                  </>
                )}
              </button>
            </div>
          )}
        </div>

        {/* ── Right panel: message thread ── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, background: '#fff', borderRadius: '14px', border: '1px solid #E2E8F0', overflow: 'hidden' }}>

          {/* Thread header */}
          <div style={{ padding: '14px 20px', borderBottom: '1px solid #F1F5F9', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#10B981', boxShadow: '0 0 0 2px #D1FAE5' }} />
              <p style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0F172A', margin: 0 }}>Negotiation thread</p>
            </div>
            <span style={{ fontSize: '0.6875rem', color: '#CBD5E1', fontWeight: 500 }}>
              {messages.length} message{messages.length !== 1 ? 's' : ''}
            </span>
          </div>

          {/* Messages */}
          <div className="msg-thread" style={{ flex: 1, overflowY: 'auto', padding: '20px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {messages.length === 0 ? (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '3rem 0' }}>
                <div style={{ width: 48, height: 48, borderRadius: '14px', background: '#F1F5F9', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" strokeWidth="1.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                </div>
                <p style={{ fontSize: '0.875rem', color: '#64748B', fontWeight: 500, margin: '0 0 4px' }}>No messages yet</p>
                <p style={{ fontSize: '0.75rem', color: '#CBD5E1', margin: 0 }}>Open the conversation below</p>
              </div>
            ) : (
              messages.map((msg, i) => (
                <MessageBubble key={msg.id} message={msg} index={i} />
              ))
            )}
            <div ref={bottomRef} />
          </div>

          {/* ── Composer ── */}
          {!isResolved ? (
            <div style={{ borderTop: '1px solid #F1F5F9', padding: '12px 16px', flexShrink: 0, background: '#FAFAFA' }}>

              {/* Formal action banners (counter/accept/decline) */}
              {actionMode === 'accept' && (
                <div className="slide-up" style={{ background: '#ECFDF5', border: '1px solid #A7F3D0', borderRadius: 10, padding: '9px 14px', marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>
                    <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#065F46' }}>Accepting at {formatNaira(booking.offered_rate)}/month — deal marked as agreed</span>
                  </div>
                  <button onClick={() => setActionMode(null)} style={{ background: 'none', border: 'none', color: '#6EE7B7', cursor: 'pointer', fontSize: 16, padding: 0, lineHeight: 1 }}>✕</button>
                </div>
              )}
              {actionMode === 'decline' && (
                <div className="slide-up" style={{ background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 10, padding: '9px 14px', marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#EF4444" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#991B1B' }}>Declining this booking — owner will be notified</span>
                  </div>
                  <button onClick={() => setActionMode(null)} style={{ background: 'none', border: 'none', color: '#FCA5A5', cursor: 'pointer', fontSize: 16, padding: 0, lineHeight: 1 }}>✕</button>
                </div>
              )}
              {actionMode === 'counter' && (
                <div className="slide-up" style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 10, padding: '9px 14px', marginBottom: 8 }}>
                  <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#1D4ED8', flexShrink: 0 }}>Counter ₦/mo</span>
                  <input
                    type="number"
                    value={counterRate}
                    onChange={e => setCounterRate(e.target.value)}
                    placeholder={String(booking.offered_rate)}
                    autoFocus
                    style={{ flex: 1, border: '1px solid #BFDBFE', borderRadius: 8, padding: '6px 10px', fontSize: '0.9375rem', fontWeight: 700, color: '#1D4ED8', background: '#fff', outline: 'none', fontFamily: "'DM Mono', monospace" }}
                  />
                  <button onClick={() => { setActionMode(null); setCounterRate(''); }} style={{ background: 'none', border: 'none', color: '#93C5FD', cursor: 'pointer', fontSize: 16, padding: 0, lineHeight: 1 }}>✕</button>
                </div>
              )}

              {/* Action pills row (when no formal action active) */}
              {!actionMode && (
                <div className="slide-up" style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                  {[
                    { mode: 'counter' as ActionMode, label: 'Counter offer', bg: '#EFF6FF', border: '#BFDBFE', color: '#1D4ED8' },
                    { mode: 'accept'  as ActionMode, label: 'Accept',        bg: '#ECFDF5', border: '#6EE7B7', color: '#065F46' },
                    { mode: 'decline' as ActionMode, label: 'Decline',       bg: '#FEF2F2', border: '#FCA5A5', color: '#991B1B' },
                  ].map(({ mode, label, bg, border, color }) => (
                    <button key={mode} className="action-btn" onClick={() => setActionMode(mode)}
                      style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 13px', borderRadius: 99, background: bg, border: `1px solid ${border}`, color, fontSize: '0.75rem', fontWeight: 600, fontFamily: 'inherit' }}>
                      {label}
                    </button>
                  ))}
                </div>
              )}

              {/* Always-visible input row */}
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                <textarea
                  value={messageText}
                  onChange={e => setMessageText(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !actionMode) { e.preventDefault(); if (messageText.trim()) sendMessage(); } }}
                  placeholder={
                    actionMode === 'accept'  ? 'Add a note for the owner (optional)…' :
                    actionMode === 'decline' ? 'Add a reason (optional)…' :
                    actionMode === 'counter' ? 'Explain your counter offer…' :
                    'Message the owner… (Enter to send)'
                  }
                  rows={2}
                  style={{
                    flex: 1, border: '1px solid #E2E8F0', borderRadius: 10,
                    padding: '10px 14px', fontSize: '0.875rem', color: '#334155',
                    resize: 'none', outline: 'none', fontFamily: 'inherit',
                    lineHeight: 1.5, background: '#fff', transition: 'border-color 0.15s',
                  }}
                  onFocus={e => { e.currentTarget.style.borderColor = '#93C5FD'; }}
                  onBlur={e => { e.currentTarget.style.borderColor = '#E2E8F0'; }}
                />
                <button
                  className="action-btn"
                  onClick={sendMessage}
                  disabled={sending || (!messageText.trim() && !actionMode) || (actionMode === 'counter' && !counterRate)}
                  style={{
                    padding: '10px 16px', borderRadius: 10, fontSize: '0.8125rem',
                    fontWeight: 700, color: '#fff', cursor: 'pointer', fontFamily: 'inherit',
                    border: 'none', letterSpacing: '0.01em', flexShrink: 0,
                    background: actionMode === 'accept' ? '#059669' : actionMode === 'decline' ? '#DC2626' : actionMode === 'counter' ? '#2563EB' : '#1B4F8A',
                    opacity: (sending || (!messageText.trim() && !actionMode) || (actionMode === 'counter' && !counterRate)) ? 0.4 : 1,
                  }}
                >
                  {sending
                    ? <span style={{ width: 14, height: 14, border: '2px solid rgba(255,255,255,0.4)', borderTopColor: '#fff', borderRadius: '50%', display: 'inline-block', animation: 'spin 0.7s linear infinite' }} />
                    : actionMode === 'accept' ? 'Accept' : actionMode === 'decline' ? 'Decline' : actionMode === 'counter' ? 'Send' : (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                    )}
                </button>
              </div>
            </div>
          ) : (
            /* Resolved state banner */
            <div style={{
              borderTop: `1px solid ${
                booking.status === 'agreed' || booking.status === 'live' ? '#A7F3D0' :
                booking.status === 'declined' ? '#FCA5A5' : '#E2E8F0'
              }`,
              padding: '16px 20px', flexShrink: 0,
              background: booking.status === 'agreed' || booking.status === 'live' ? '#ECFDF5' :
                          booking.status === 'declined' ? '#FEF2F2' : '#F8FAFC',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px'
            }}>
              <span style={{ fontSize: '1.125rem' }}>
                {booking.status === 'agreed' ? '🎉' :
                 booking.status === 'declined' ? '✕' :
                 booking.status === 'signed' ? '✍️' :
                 booking.status === 'live' ? '📍' : '✓'}
              </span>
              <span style={{
                fontSize: '0.875rem', fontWeight: 600,
                color: booking.status === 'agreed' || booking.status === 'live' ? '#065F46' :
                       booking.status === 'declined' ? '#991B1B' : '#334155',
              }}>
                {booking.status === 'agreed' && `Deal agreed — ${formatNaira(booking.agreed_rate)}/month`}
                {booking.status === 'declined' && 'This negotiation was declined'}
                {booking.status === 'signed' && 'Contract signed'}
                {booking.status === 'live' && 'Campaign is live'}
                {booking.status === 'completed' && 'Campaign completed'}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ message, index }: { message: Message; index: number }) {
  const isAgency = message.sender_role === 'agency';
  const isSpecial = message.message_type !== 'message';

  const time = new Date(message.created_at).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' });

  // Special event messages (counter, accept, decline) — centered card
  if (isSpecial) {
    const cfgMap: Record<string, { bg: string; border: string; labelColor: string; rateColor: string; label: string }> = {
      counter_offer: { bg: '#F5F3FF', border: '#C4B5FD', labelColor: '#5B21B6', rateColor: '#4C1D95', label: '🔄 Counter offer' },
      accepted:      { bg: '#ECFDF5', border: '#6EE7B7', labelColor: '#065F46', rateColor: '#065F46', label: '✅ Accepted' },
      declined:      { bg: '#FEF2F2', border: '#FCA5A5', labelColor: '#991B1B', rateColor: '#991B1B', label: '❌ Declined' },
      offer:         { bg: '#EFF6FF', border: '#BFDBFE', labelColor: '#1D4ED8', rateColor: '#1E3A8A', label: '💰 Offer' },
    };
    const cfg = cfgMap[message.message_type] || cfgMap.offer;

    return (
      <div className="msg-in" style={{ display: 'flex', justifyContent: 'center', padding: '6px 0', animationDelay: `${index * 0.03}s` }}>
        <div style={{
          background: cfg.bg, border: `1px solid ${cfg.border}`,
          borderRadius: '12px', padding: '12px 18px', maxWidth: '75%', width: 'fit-content', textAlign: 'center'
        }}>
          <p style={{ fontSize: '0.75rem', fontWeight: 700, color: cfg.labelColor, margin: '0 0 4px', letterSpacing: '0.01em' }}>
            {cfg.label}
          </p>
          {message.offered_rate && (
            <p style={{ fontSize: '1.0625rem', fontWeight: 700, color: cfg.rateColor, margin: '0 0 4px', fontFamily: "'DM Mono', monospace" }}>
              ₦{Number(message.offered_rate).toLocaleString('en-NG')}/mo
            </p>
          )}
          {message.content && (
            <p style={{ fontSize: '0.8125rem', color: '#334155', margin: '0 0 6px', lineHeight: 1.5 }}>
              {message.content}
            </p>
          )}
          <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: 0 }}>
            {isAgency ? 'You' : 'Owner'} · {time}
          </p>
        </div>
      </div>
    );
  }

  // Regular chat messages
  return (
    <div className="msg-in" style={{ display: 'flex', justifyContent: isAgency ? 'flex-end' : 'flex-start', padding: '3px 0', animationDelay: `${index * 0.03}s` }}>
      <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', maxWidth: '72%', flexDirection: isAgency ? 'row-reverse' : 'row' }}>
        {/* Avatar */}
        <div style={{
          width: 28, height: 28, borderRadius: '8px', flexShrink: 0,
          background: isAgency ? '#1B4F8A' : '#F1F5F9',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '0.625rem', fontWeight: 700,
          color: isAgency ? '#fff' : '#64748B',
          border: isAgency ? 'none' : '1px solid #E2E8F0'
        }}>
          {isAgency ? 'AG' : 'OW'}
        </div>

        {/* Bubble */}
        <div style={{
          background: isAgency ? '#1B4F8A' : '#F8FAFC',
          border: isAgency ? 'none' : '1px solid #E2E8F0',
          borderRadius: isAgency ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
          padding: '10px 14px',
        }}>
          <p style={{ fontSize: '0.875rem', color: isAgency ? '#fff' : '#334155', margin: '0 0 4px', lineHeight: 1.55 }}>
            {message.content}
          </p>
          <p style={{ fontSize: '0.6875rem', color: isAgency ? 'rgba(255,255,255,0.45)' : '#CBD5E1', margin: 0 }}>
            {time}
          </p>
        </div>
      </div>
    </div>
  );
}
