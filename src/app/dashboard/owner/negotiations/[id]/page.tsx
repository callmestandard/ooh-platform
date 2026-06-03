'use client';

import { useState, useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { createNotification } from '@/lib/notifications';

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
    width: number;
    height: number;
    contact_phone: string | null;
  };
  campaigns: {
    id: string;
    name: string;
    client_name: string;
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

const STATUS_CONFIG: Record<string, { label: string; bg: string; color: string; dot: string }> = {
  pending:     { label: 'New request', bg: '#FFFBEB', color: '#92400E', dot: '#F59E0B' },
  negotiating: { label: 'Negotiating', bg: '#EFF6FF', color: '#1E3A8A', dot: '#3B82F6' },
  agreed:      { label: 'Agreed',      bg: '#ECFDF5', color: '#065F46', dot: '#10B981' },
  signed:      { label: 'Signed',      bg: '#F5F3FF', color: '#3730A3', dot: '#8B5CF6' },
  live:        { label: 'Live',        bg: '#ECFDF5', color: '#065F46', dot: '#10B981' },
  declined:    { label: 'Declined',    bg: '#FEF2F2', color: '#7F1D1D', dot: '#EF4444' },
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
  return new Date(d).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' });
}

type ActionMode = null | 'message' | 'counter' | 'accept' | 'decline';

export default function OwnerNegotiationDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const bottomRef = useRef<HTMLDivElement>(null);

  const [booking, setBooking] = useState<Booking | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionMode, setActionMode] = useState<ActionMode>(null);
  const [messageText, setMessageText] = useState('');
  const [counterRate, setCounterRate] = useState('');
  const [sending, setSending] = useState(false);
  const [exportingContract, setExportingContract] = useState(false);

  async function handleDownloadContract() {
    if (!booking) return;
    setExportingContract(true);
    try {
      const res = await fetch('/api/contract-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          booking_id:    booking.id,
          agency_name:   booking.campaigns?.client_name || 'Agency',
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
        }),
      });
      if (!res.ok) throw new Error('PDF failed');
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href = url;
      a.download = `Contract-${booking.boards?.name?.replace(/\s+/g, '-') || booking.id}.pdf`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch { /* silent */ } finally { setExportingContract(false); }
  }

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
      .select('*, boards!bookings_board_id_fkey(*), campaigns!bookings_campaign_id_fkey(id, name, client_name)')
      .eq('id', id)
      .single();
    if (data) setBooking(data as unknown as Booking);
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
      .channel(`owner-msgs-${id}-${Math.random().toString(36).slice(2, 7)}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'messages',
        filter: `booking_id=eq.${id}`,
      }, payload => {
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
      content = messageText || 'Offer accepted. Looking forward to working with you.';
      newStatus = 'agreed';
    } else if (actionMode === 'decline') {
      messageType = 'declined';
      content = messageText || 'Thank you for your interest. We are unable to proceed at this time.';
      newStatus = 'declined';
    } else {
      if (!messageText.trim()) { setSending(false); return; }
      if (booking.status === 'pending') newStatus = 'negotiating';
    }

    const { error: msgError } = await supabase.from('messages').insert({
      booking_id: booking.id,
      sender_role: 'owner',
      message_type: messageType,
      content,
      offered_rate: rate,
    });

    if (msgError) { console.error(msgError); setSending(false); return; }

    const updateData: Record<string, unknown> = { status: newStatus };
    if (actionMode === 'accept') updateData.agreed_rate = booking.offered_rate;
    if (actionMode === 'counter' && rate) updateData.offered_rate = rate;

    await supabase.from('bookings').update(updateData).eq('id', booking.id);

    // Notify the agency
    const boardName = booking.boards?.name || 'a board';
    if (actionMode === 'accept') {
      await createNotification({ recipientRole: 'agency', type: 'offer_accepted', title: `Owner accepted — deal agreed!`, body: `${boardName} at ${formatNaira(booking.offered_rate)}/month`, link: `/dashboard/agency/negotiations/${booking.id}` });
    } else if (actionMode === 'decline') {
      await createNotification({ recipientRole: 'agency', type: 'offer_declined', title: 'Owner declined your request', body: `Booking for ${boardName} was declined`, link: `/dashboard/agency/negotiations/${booking.id}` });
    } else if (actionMode === 'counter') {
      await createNotification({ recipientRole: 'agency', type: 'counter_offer', title: 'Owner sent a counter offer', body: `${formatNaira(parseFloat(counterRate))}/month for ${boardName}`, link: `/dashboard/agency/negotiations/${booking.id}` });
    } else {
      await createNotification({ recipientRole: 'agency', type: 'message', title: 'New message from board owner', body: content.slice(0, 80), link: `/dashboard/agency/negotiations/${booking.id}` });
    }

    await fetchBooking();
    setMessageText('');
    setCounterRate('');
    setActionMode(null);
    setSending(false);
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '50vh' }}>
        <div style={{ width: 28, height: 28, border: '2px solid #E2E8F0', borderTopColor: '#1B4F8A', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (!booking) {
    return <div style={{ textAlign: 'center', padding: '4rem', color: '#94A3B8' }}>Booking not found</div>;
  }

  const statusCfg = STATUS_CONFIG[booking.status] || STATUS_CONFIG.pending;
  const isResolved = ['agreed', 'signed', 'live', 'declined'].includes(booking.status);
  const agencyOfferedAboveAsking = booking.offered_rate > (booking.boards?.asking_rate || 0);

  return (
    <>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeUp { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:translateY(0); } }
        .action-btn { transition: all 0.15s ease; cursor: pointer; border: none; }
        .action-btn:hover { transform: translateY(-1px); }
        .action-btn:active { transform: translateY(0); }
        @keyframes slideUp { from { opacity:0; transform:translateY(10px); } to { opacity:1; transform:translateY(0); } }
        .slide-up { animation: slideUp 0.2s ease forwards; }
      `}</style>

      <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 8rem)', fontFamily: "'Inter', -apple-system, sans-serif" }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: '1.25rem' }}>
          <button
            onClick={() => router.push('/dashboard/owner/negotiations')}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8', padding: 4, display: 'flex' }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
              <h1 style={{ fontSize: '1.125rem', fontWeight: 700, color: '#0F172A', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {booking.boards?.name}
              </h1>
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                background: statusCfg.bg, color: statusCfg.color,
                padding: '3px 9px', borderRadius: '999px',
                fontSize: '0.6875rem', fontWeight: 600, flexShrink: 0,
              }}>
                <span style={{ width: 5, height: 5, borderRadius: '50%', background: statusCfg.dot }} />
                {statusCfg.label}
              </span>
            </div>
            <p style={{ fontSize: '0.75rem', color: '#94A3B8', margin: 0 }}>
              {booking.campaigns?.client_name || '—'} · {booking.campaigns?.name || '—'}
            </p>
          </div>
        </div>

        {/* Main layout */}
        <div style={{ display: 'flex', gap: 16, flex: 1, minHeight: 0 }}>

          {/* Left panel: board + deal info */}
          <div style={{ width: 272, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 12, overflowY: 'auto' }}>

            {/* Request highlight */}
            {booking.status === 'pending' && (
              <div style={{
                background: '#FFFBEB', border: '1px solid #FDE68A',
                borderRadius: '10px', padding: '12px 14px',
                animation: 'fadeUp 0.3s ease',
              }}>
                <p style={{ fontSize: '0.75rem', fontWeight: 700, color: '#92400E', margin: '0 0 4px' }}>
                  New booking request
                </p>
                <p style={{ fontSize: '0.8125rem', color: '#92400E', margin: 0 }}>
                  Agency is offering <strong>{formatNaira(booking.offered_rate)}</strong>/month for this board.
                  {!agencyOfferedAboveAsking && booking.boards?.asking_rate && (
                    <> Your asking rate is {formatNaira(booking.boards.asking_rate)}.</>
                  )}
                </p>
              </div>
            )}

            {/* Board details */}
            <div style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: '10px', padding: '14px 16px' }}>
              <p style={{ fontSize: '0.625rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.07em', margin: '0 0 12px' }}>
                Board details
              </p>
              {[
                { label: 'Format',      value: FORMAT_LABELS[booking.boards?.format] || booking.boards?.format || '—' },
                { label: 'Location',    value: [booking.boards?.city, booking.boards?.state].filter(Boolean).join(', ') || '—' },
                { label: 'Address',     value: booking.boards?.address || '—' },
                { label: 'Dimensions',  value: booking.boards?.width && booking.boards?.height ? `${booking.boards.width}m × ${booking.boards.height}m` : '—' },
                { label: 'Asking rate', value: formatNaira(booking.boards?.asking_rate) },
              ].map(({ label, value }) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #F8FAFC' }}>
                  <span style={{ fontSize: '0.75rem', color: '#94A3B8' }}>{label}</span>
                  <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#0F172A', textAlign: 'right', maxWidth: '55%' }}>{value}</span>
                </div>
              ))}
            </div>

            {/* Deal summary */}
            <div style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: '10px', padding: '14px 16px' }}>
              <p style={{ fontSize: '0.625rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.07em', margin: '0 0 12px' }}>
                Deal terms
              </p>
              {[
                { label: 'Agency offer',  value: formatNaira(booking.offered_rate), highlight: false },
                { label: 'Agreed rate',   value: booking.agreed_rate ? formatNaira(booking.agreed_rate) : 'Pending', highlight: !!booking.agreed_rate },
                { label: 'Start date',    value: formatDate(booking.start_date), highlight: false },
                { label: 'End date',      value: formatDate(booking.end_date), highlight: false },
              ].map(({ label, value, highlight }) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #F8FAFC' }}>
                  <span style={{ fontSize: '0.75rem', color: '#94A3B8' }}>{label}</span>
                  <span style={{ fontSize: '0.75rem', fontWeight: 600, color: highlight ? '#10B981' : '#0F172A' }}>{value}</span>
                </div>
              ))}
              {booking.agreed_rate && (
                <div style={{ marginTop: 8, padding: '8px 10px', background: '#ECFDF5', borderRadius: 7 }}>
                  <p style={{ fontSize: '0.75rem', fontWeight: 700, color: '#065F46', margin: 0 }}>
                    {booking.agreed_rate >= (booking.boards?.asking_rate || 0)
                      ? `✓ Deal at asking rate`
                      : `↓ ${formatNaira((booking.boards?.asking_rate || 0) - booking.agreed_rate)} below asking`
                    }
                  </p>
                </div>
              )}
            </div>

            {booking.notes && (
              <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: '10px', padding: '12px 14px' }}>
                <p style={{ fontSize: '0.625rem', fontWeight: 700, color: '#92400E', margin: '0 0 4px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Agency notes</p>
                <p style={{ fontSize: '0.8125rem', color: '#92400E', margin: 0, lineHeight: 1.5 }}>"{booking.notes}"</p>
              </div>
            )}

            {/* Download contract — visible once deal is agreed */}
            {['agreed', 'signed', 'live'].includes(booking.status) && (
              <button
                onClick={handleDownloadContract}
                disabled={exportingContract}
                style={{
                  width: '100%', padding: '11px 16px',
                  background: exportingContract ? '#F1F5F9' : '#F5F3FF',
                  color: exportingContract ? '#94A3B8' : '#5B21B6',
                  border: '1px solid #DDD6FE', borderRadius: '10px',
                  fontSize: '0.8125rem', fontWeight: 700,
                  cursor: exportingContract ? 'not-allowed' : 'pointer',
                  fontFamily: 'inherit', transition: 'all 0.15s',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                }}
              >
                {exportingContract ? (
                  <><span style={{ width: 13, height: 13, border: '2px solid #DDD6FE', borderTopColor: '#7C3AED', borderRadius: '50%', animation: 'spin 0.7s linear infinite', display: 'inline-block' }} />Generating…</>
                ) : (
                  <><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="15" y2="17"/></svg>Download contract</>
                )}
              </button>
            )}
          </div>

          {/* Right panel: message thread */}
          <div style={{
            flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0,
            background: '#fff', border: '1px solid #E8EDF2', borderRadius: '12px', overflow: 'hidden',
          }}>
            {/* Thread header */}
            <div style={{ padding: '12px 16px', borderBottom: '1px solid #F1F5F9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <p style={{ fontSize: '0.875rem', fontWeight: 700, color: '#0F172A', margin: 0 }}>Negotiation thread</p>
              <span style={{ fontSize: '0.75rem', color: '#94A3B8' }}>{messages.length} message{messages.length !== 1 ? 's' : ''}</span>
            </div>

            {/* Messages scroll area */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              {messages.length === 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 8 }}>
                  <div style={{ width: 40, height: 40, background: '#F1F5F9', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                    </svg>
                  </div>
                  <p style={{ fontSize: '0.875rem', color: '#64748B', margin: 0, fontWeight: 500 }}>No messages yet</p>
                  <p style={{ fontSize: '0.8125rem', color: '#94A3B8', margin: 0 }}>Respond to this booking request below</p>
                </div>
              ) : (
                messages.map(msg => (
                  <OwnerMessageBubble key={msg.id} message={msg} />
                ))
              )}
              <div ref={bottomRef} />
            </div>

            {/* Action area */}
            {!isResolved ? (
              <div style={{ borderTop: '1px solid #F1F5F9', padding: '12px 16px', flexShrink: 0, background: '#FAFAFA' }}>

                {/* Formal action banners */}
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
                      <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#991B1B' }}>Declining this request — agency will be notified</span>
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
                      placeholder={String(booking.boards?.asking_rate || booking.offered_rate)}
                      autoFocus
                      style={{ flex: 1, border: '1px solid #BFDBFE', borderRadius: 8, padding: '6px 10px', fontSize: '0.9375rem', fontWeight: 700, color: '#1D4ED8', background: '#fff', outline: 'none', fontFamily: "'DM Mono', monospace" }}
                    />
                    <button onClick={() => { setActionMode(null); setCounterRate(''); }} style={{ background: 'none', border: 'none', color: '#93C5FD', cursor: 'pointer', fontSize: 16, padding: 0, lineHeight: 1 }}>✕</button>
                  </div>
                )}

                {/* Action pills (when no formal action active) */}
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
                      actionMode === 'accept'  ? 'Add a note for the agency (optional)…' :
                      actionMode === 'decline' ? 'Add a reason (optional)…' :
                      actionMode === 'counter' ? 'Explain your counter offer…' :
                      'Message the agency… (Enter to send)'
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
              <div style={{
                borderTop: '1px solid #F1F5F9', padding: '14px 16px',
                textAlign: 'center', fontSize: '0.875rem', fontWeight: 600,
                background: booking.status === 'agreed' ? '#ECFDF5' : booking.status === 'declined' ? '#FEF2F2' : '#F8FAFC',
                color: booking.status === 'agreed' ? '#065F46' : booking.status === 'declined' ? '#7F1D1D' : '#64748B',
              }}>
                {booking.status === 'agreed'   && `🎉 Deal agreed at ${formatNaira(booking.agreed_rate)}/month`}
                {booking.status === 'declined' && '✕ This booking has been declined'}
                {booking.status === 'signed'   && '✓ Contract signed'}
                {booking.status === 'live'     && '📍 Campaign is live on your board'}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function OwnerMessageBubble({ message }: { message: Message }) {
  // From the owner's perspective: owner's own messages are on the right
  const isOwn = message.sender_role === 'owner';

  const typeLabel: Record<string, string> = {
    offer:         '💰 Offer',
    counter_offer: '🔄 Counter offer',
    accepted:      '✅ Accepted',
    declined:      '❌ Declined',
  };

  const bubbleBg =
    message.message_type === 'accepted'      ? '#ECFDF5' :
    message.message_type === 'declined'      ? '#FEF2F2' :
    message.message_type === 'counter_offer' ? '#F5F3FF' :
    message.message_type === 'offer'         ? '#EFF6FF' :
    isOwn                                    ? '#1B4F8A' : '#F1F5F9';

  const textColor =
    message.message_type === 'accepted'      ? '#065F46' :
    message.message_type === 'declined'      ? '#7F1D1D' :
    message.message_type === 'counter_offer' ? '#3730A3' :
    message.message_type === 'offer'         ? '#1E3A8A' :
    isOwn                                    ? '#FFFFFF' : '#0F172A';

  const labelColor =
    message.message_type === 'accepted'      ? '#065F46' :
    message.message_type === 'declined'      ? '#7F1D1D' :
    message.message_type === 'counter_offer' ? '#3730A3' :
    '#1E3A8A';

  return (
    <div style={{ display: 'flex', justifyContent: isOwn ? 'flex-end' : 'flex-start' }}>
      <div style={{
        maxWidth: '75%', borderRadius: '12px',
        padding: '10px 14px',
        background: bubbleBg,
        border: message.message_type !== 'message' ? `1px solid ${
          message.message_type === 'accepted' ? '#A7F3D0' :
          message.message_type === 'declined' ? '#FECACA' :
          message.message_type === 'counter_offer' ? '#C4B5FD' : '#BFDBFE'
        }` : 'none',
      }}>
        {message.message_type !== 'message' && (
          <p style={{ fontSize: '0.6875rem', fontWeight: 700, color: labelColor, margin: '0 0 4px' }}>
            {typeLabel[message.message_type]}
          </p>
        )}
        {message.offered_rate && (
          <p style={{ fontSize: '0.9375rem', fontWeight: 700, color: textColor, margin: '0 0 4px', fontFamily: 'monospace' }}>
            {formatNaira(message.offered_rate)}/month
          </p>
        )}
        <p style={{ fontSize: '0.875rem', color: textColor, margin: 0, lineHeight: 1.5 }}>
          {message.content}
        </p>
        <p style={{ fontSize: '0.6875rem', color: isOwn ? 'rgba(255,255,255,0.5)' : '#94A3B8', margin: '4px 0 0' }}>
          {isOwn ? 'You' : 'Agency'} · {new Date(message.created_at).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' })}
        </p>
      </div>
    </div>
  );
}
