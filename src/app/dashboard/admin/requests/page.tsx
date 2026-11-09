'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useDashboardRole } from '@/components/layout/DashboardLayout';
import { boardFormatLabel } from '@/lib/board-formats';
import { STAGE_META, notifyRequest, type RequestStage } from '@/lib/availability-requests';

// Admin console for "Request this location" (043–045): see every board
// request, who to call, and move deals through the manual hand-off.

type Contact = { name: string | null; company: string | null; email: string | null; phone: string | null };
type Reply = {
  id: string; owner_id: string; available: boolean; quoted_rate: number | null; note: string | null;
  available_from: string | null; available_to: string | null; conditions: string | null;
  accepted_booking_id: string | null; answered_by_admin: boolean; updated_at: string;
};
type Req = {
  id: string; agency_id: string; agency_name: string | null; title: string; stage: RequestStage; stage_updated_at: string;
  start_date: string; end_date: string; budget: number | null; notes: string | null; sites_needed: number | null;
  extra_requirements: string | null; created_at: string; board_id: string;
  board: { id: string; name: string; city: string | null; area: string | null; format: string | null; owner_id: string | null; contact_name: string | null; contact_phone: string | null } | null;
  responses: Reply[];
  recipients: { owner_id: string; owner_name: string | null; responded_at: string | null }[];
  contacts: Contact | Contact[] | null;
};
type Message = { id: string; sender_role: 'agency' | 'owner'; message_type: string; content: string; offered_rate: number | null; created_at: string };
type Booking = { id: string; status: string; offered_rate: number | null; agreed_rate: number | null };

const OPEN: RequestStage[] = ['requested', 'owner_responded', 'quote_received', 'unavailable', 'negotiating', 'accepted', 'booking_in_progress'];
const ANSWERABLE: RequestStage[] = ['requested', 'owner_responded', 'quote_received', 'unavailable'];
const DAY = 86_400_000;

const naira = (n: number) => '₦' + Math.round(n).toLocaleString('en-NG');
const fmtDate = (d: string) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const ago = (d: string) => {
  const h = Math.round((Date.now() - new Date(d).getTime()) / 3_600_000);
  return h < 1 ? 'just now' : h < 48 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
};
const contactOf = (r: Req): Contact | null => (Array.isArray(r.contacts) ? r.contacts[0] : r.contacts) ?? null;
const replyOf = (r: Req) => r.responses?.[0] ?? null;
const ownerOnPlatform = (r: Req) => !!r.board?.owner_id || (r.recipients?.length ?? 0) > 0;

/** Why this request needs someone from our team, or null. */
function followUp(r: Req): string | null {
  const since = Date.now() - new Date(r.stage_updated_at || r.created_at).getTime();
  switch (r.stage) {
    case 'requested': return !ownerOnPlatform(r) ? 'Owner not on the platform — call them' : since > 2 * DAY ? 'No owner reply for 2 days' : null;
    case 'owner_responded': return since > 2 * DAY ? 'Owner said available but sent no price' : null;
    case 'quote_received': return since > 3 * DAY ? "Buyer hasn't answered the quote in 3 days" : null;
    case 'negotiating': return since > 3 * DAY ? 'Negotiation quiet for 3 days' : null;
    case 'accepted': return 'Deal agreed — start the booking';
    case 'booking_in_progress': return 'Booking in progress — confirm when done';
    default: return null;
  }
}

const card: React.CSSProperties = { background: '#fff', border: '1px solid #E2E8F0', borderRadius: 12 };
const input: React.CSSProperties = { boxSizing: 'border-box', padding: '7px 10px', borderRadius: 8, border: '1px solid #E2E8F0', fontSize: '0.8125rem', color: '#0F172A', background: '#fff', fontFamily: 'inherit', outline: 'none' };
const small: React.CSSProperties = { fontSize: '0.6875rem', fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 4px' };
const btn = (kind: 'primary' | 'plain' | 'danger' = 'plain'): React.CSSProperties => ({
  padding: '7px 12px', borderRadius: 8, fontSize: '0.75rem', fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer', whiteSpace: 'nowrap',
  border: kind === 'plain' ? '1px solid #CBD5E1' : 'none',
  background: kind === 'primary' ? '#1B4F8A' : kind === 'danger' ? '#FEE2E2' : '#fff',
  color: kind === 'primary' ? '#fff' : kind === 'danger' ? '#B91C1C' : '#1B4F8A',
});

function StagePill({ stage }: { stage: RequestStage }) {
  const m = STAGE_META[stage];
  return <span data-stage={stage} style={{ fontSize: '0.6875rem', fontWeight: 700, padding: '3px 9px', borderRadius: 999, background: m.bg, color: m.color, whiteSpace: 'nowrap' }}>{m.label}</span>;
}

type Filter = 'follow' | 'open' | 'all';

export default function AdminRequestsPage() {
  const role = useDashboardRole();
  const [requests, setRequests] = useState<Req[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('follow');
  const [stageFilter, setStageFilter] = useState<RequestStage | ''>('');
  const [search, setSearch] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  async function refresh() {
    const { data, error } = await supabase
      .from('availability_requests')
      .select(`id, agency_id, agency_name, title, stage, stage_updated_at, start_date, end_date, budget, notes, sites_needed, extra_requirements, created_at, board_id,
        board:boards(id, name, city, area, format, owner_id, contact_name, contact_phone),
        responses:availability_responses(id, owner_id, available, quoted_rate, note, available_from, available_to, conditions, accepted_booking_id, answered_by_admin, updated_at),
        recipients:availability_request_recipients(owner_id, owner_name, responded_at),
        contacts:availability_request_contacts(name, company, email, phone)`)
      .not('board_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(300);
    if (error) { setError(error.message); setLoading(false); return; }
    const rows = (data ?? []) as unknown as Req[];
    setRequests(rows);
    if (rows.length) {
      const { data: n } = await supabase.from('availability_request_admin_notes').select('request_id, notes').in('request_id', rows.map(r => r.id));
      setNotes(Object.fromEntries((n ?? []).map((x: { request_id: string; notes: string | null }) => [x.request_id, x.notes ?? ''])));
    }
    setError(null);
    setLoading(false);
  }

  useEffect(() => {
    if (role !== 'admin') return;
    (async () => { await refresh(); })();
  }, [role]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return requests.filter(r => {
      // Keep the request being managed on screen even if it no longer matches.
      if (r.id === openId) return true;
      if (filter === 'follow' && !followUp(r)) return false;
      if (filter === 'open' && !OPEN.includes(r.stage)) return false;
      if (stageFilter && r.stage !== stageFilter) return false;
      if (!q) return true;
      const c = contactOf(r);
      return [r.board?.name, r.board?.city, r.board?.area, r.agency_name, c?.name, c?.company, c?.email].some(v => v?.toLowerCase().includes(q));
    });
  }, [requests, filter, stageFilter, search, openId]);

  if (role !== 'admin') return <div style={{ padding: 32, color: '#64748B', fontSize: '0.875rem' }}>Admins only.</div>;

  const followCount = requests.filter(r => followUp(r)).length;
  const openCount = requests.filter(r => OPEN.includes(r.stage)).length;

  return (
    <div style={{ maxWidth: 1040, margin: '0 auto', padding: '8px 0 48px' }}>
      <h1 style={{ fontSize: '1.375rem', fontWeight: 800, color: '#0F172A', margin: '0 0 4px', letterSpacing: '-0.02em' }}>Requests</h1>
      <p style={{ fontSize: '0.875rem', color: '#64748B', margin: '0 0 18px', maxWidth: 680 }}>
        Every &ldquo;Request this location&rdquo;. Call owners who aren&rsquo;t on the platform, answer for them, and take agreed deals through to a confirmed booking.
      </p>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
        {([['follow', `Needs follow-up (${followCount})`], ['open', `Open (${openCount})`], ['all', `All (${requests.length})`]] as const).map(([k, text]) => (
          <button key={k} onClick={() => setFilter(k)} style={{
            padding: '6px 12px', borderRadius: 8, fontSize: '0.75rem', fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer',
            border: '1px solid ' + (filter === k ? '#1B4F8A' : '#E2E8F0'), background: filter === k ? '#EFF6FF' : '#fff', color: filter === k ? '#1B4F8A' : '#475569',
          }}>{text}</button>
        ))}
        <select value={stageFilter} onChange={e => setStageFilter(e.target.value as RequestStage | '')} style={{ ...input, padding: '6px 8px' }} aria-label="Stage">
          <option value="">Any stage</option>
          {(Object.keys(STAGE_META) as RequestStage[]).map(s => <option key={s} value={s}>{STAGE_META[s].label}</option>)}
        </select>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search board, buyer, email…" style={{ ...input, flex: 1, minWidth: 180 }} aria-label="Search" />
      </div>

      {error && <div style={{ ...card, padding: 14, borderColor: '#FECACA', background: '#FEF2F2', color: '#B91C1C', fontSize: '0.8125rem', marginBottom: 14 }}>{error}</div>}

      {loading ? (
        <div style={{ ...card, padding: 24, color: '#94A3B8', fontSize: '0.875rem' }}>Loading…</div>
      ) : shown.length === 0 ? (
        <div style={{ ...card, padding: '36px 24px', textAlign: 'center', color: '#64748B', fontSize: '0.875rem' }}>
          {filter === 'follow' ? 'Nothing needs follow-up right now.' : 'No requests match.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {shown.map(r => (
            <RequestCard key={r.id} r={r} open={openId === r.id} onToggle={() => setOpenId(openId === r.id ? null : r.id)}
              note={notes[r.id] ?? ''} onNoteSaved={text => setNotes(prev => ({ ...prev, [r.id]: text }))} onChanged={refresh} />
          ))}
        </div>
      )}
    </div>
  );
}

function RequestCard({ r, open, onToggle, note, onNoteSaved, onChanged }: {
  r: Req; open: boolean; onToggle: () => void; note: string; onNoteSaved: (t: string) => void; onChanged: () => Promise<void>;
}) {
  const c = contactOf(r);
  const reply = replyOf(r);
  const reason = followUp(r);
  const onPlatform = ownerOnPlatform(r);
  const ownerName = r.recipients?.[0]?.owner_name;

  return (
    <div data-admin-request={r.id} style={{ ...card, padding: 16, borderColor: reason ? '#FDE68A' : '#E2E8F0' }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <a href={`/boards/${r.board_id}`} target="_blank" rel="noopener noreferrer" style={{ fontSize: '0.9375rem', fontWeight: 700, color: '#0F172A', textDecoration: 'none' }}>{r.board?.name ?? r.title}</a>
            <StagePill stage={r.stage} />
          </div>
          <p style={{ fontSize: '0.75rem', color: '#64748B', margin: '3px 0 0' }}>
            {[r.board?.area, r.board?.city].filter(Boolean).join(', ')}{r.board?.format ? ` · ${boardFormatLabel(r.board.format)}` : ''} · {fmtDate(r.start_date)} → {fmtDate(r.end_date)}
            {r.budget ? ` · budget ${naira(r.budget)}` : ''} · sent {ago(r.created_at)}
          </p>
          {reason && <p data-follow-up style={{ fontSize: '0.75rem', fontWeight: 700, color: '#92400E', margin: '6px 0 0' }}>⚑ {reason}</p>}
        </div>
        <button onClick={onToggle} style={btn(open ? 'plain' : 'primary')}>{open ? 'Close' : 'Manage'}</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10, marginTop: 12 }}>
        <div style={{ background: '#F8FAFC', borderRadius: 10, padding: '10px 12px' }}>
          <p style={small}>Buyer</p>
          <p style={{ fontSize: '0.8125rem', color: '#0F172A', margin: 0, fontWeight: 600 }}>{c?.name ?? '—'}{c?.company ? ` · ${c.company}` : ''}</p>
          <p style={{ fontSize: '0.75rem', color: '#475569', margin: '2px 0 0', wordBreak: 'break-all' }}>
            {c?.email && <a href={`mailto:${c.email}`} style={{ color: '#1B4F8A' }}>{c.email}</a>}
            {c?.phone && <> · <a href={`tel:${c.phone}`} style={{ color: '#1B4F8A' }}>{c.phone}</a></>}
          </p>
        </div>
        <div style={{ background: '#F8FAFC', borderRadius: 10, padding: '10px 12px' }}>
          <p style={small}>Owner</p>
          <p style={{ fontSize: '0.8125rem', color: '#0F172A', margin: 0, fontWeight: 600 }}>
            {onPlatform ? ownerName ?? 'On the platform' : 'Not on the platform'}
          </p>
          <p style={{ fontSize: '0.75rem', color: '#475569', margin: '2px 0 0' }}>
            {r.board?.contact_name ?? 'No contact name'}
            {r.board?.contact_phone ? <> · <a href={`tel:${r.board.contact_phone}`} style={{ color: '#1B4F8A' }}>{r.board.contact_phone}</a></> : ' · no phone on file'}
          </p>
        </div>
        <div style={{ background: '#F8FAFC', borderRadius: 10, padding: '10px 12px' }}>
          <p style={small}>Reply{reply?.answered_by_admin ? ' (entered by our team)' : ''}</p>
          {reply ? (
            <>
              <p style={{ fontSize: '0.8125rem', color: '#0F172A', margin: 0, fontWeight: 600 }}>
                {reply.available ? 'Available' : 'Not available'}{reply.available && reply.quoted_rate ? ` · ${naira(reply.quoted_rate)}/mo` : ''}
              </p>
              {(reply.conditions || reply.note) && <p style={{ fontSize: '0.75rem', color: '#475569', margin: '2px 0 0' }}>{[reply.conditions, reply.note].filter(Boolean).join(' · ')}</p>}
            </>
          ) : <p style={{ fontSize: '0.8125rem', color: '#94A3B8', margin: 0 }}>No reply yet</p>}
        </div>
      </div>

      {open && <Manage r={r} note={note} onNoteSaved={onNoteSaved} onChanged={onChanged} />}
    </div>
  );
}

function Manage({ r, note, onNoteSaved, onChanged }: { r: Req; note: string; onNoteSaved: (t: string) => void; onChanged: () => Promise<void> }) {
  const reply = replyOf(r);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [stageMsg, setStageMsg] = useState('');
  const [noteText, setNoteText] = useState(note);
  const [noteSaved, setNoteSaved] = useState(false);

  // Answer-for-owner form
  const [avail, setAvail] = useState<boolean | null>(reply ? reply.available : null);
  const [rate, setRate] = useState(reply?.quoted_rate ? String(reply.quoted_rate) : '');
  const [from, setFrom] = useState(reply?.available_from ?? '');
  const [to, setTo] = useState(reply?.available_to ?? '');
  const [cond, setCond] = useState(reply?.conditions ?? '');
  const [replyNote, setReplyNote] = useState(reply?.note ?? '');

  const run = async (key: string, fn: () => Promise<{ error: { message: string } | null }>) => {
    setBusy(key); setErr(null);
    const { error } = await fn();
    setBusy(null);
    if (error) { setErr(error.message); return false; }
    await onChanged();
    return true;
  };

  const answer = () => run('answer', async () => supabase.rpc('admin_answer_board_request', {
    p_request_id: r.id, p_available: !!avail, p_rate: avail && Number(rate) > 0 ? Number(rate) : null,
    p_from: avail && from ? from : null, p_to: avail && to ? to : null, p_conditions: cond, p_note: replyNote,
  }).then(res => { if (!res.error) notifyRequest({ requestId: r.id }); return res; }));
  const setStage = (stage: RequestStage) => run(stage, async () => supabase.rpc('admin_set_request_stage', { p_request_id: r.id, p_stage: stage, p_message: stageMsg || null }));
  const saveNote = async () => {
    setBusy('note'); setErr(null);
    const { data: { session } } = await supabase.auth.getSession();
    const { error } = await supabase.from('availability_request_admin_notes')
      .upsert({ request_id: r.id, notes: noteText.trim() || null, updated_by: session?.user.id ?? null, updated_at: new Date().toISOString() });
    setBusy(null);
    if (error) { setErr(error.message); return; }
    onNoteSaved(noteText); setNoteSaved(true);
  };

  const canAnswer = ANSWERABLE.includes(r.stage);
  const dealId = reply?.accepted_booking_id ?? null;

  return (
    <div style={{ marginTop: 14, borderTop: '1px solid #F1F5F9', paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 16 }}>
      {err && <p style={{ fontSize: '0.8125rem', color: '#B91C1C', margin: 0 }}>{err}</p>}

      {(r.notes || r.extra_requirements || r.sites_needed) && (
        <div>
          <p style={small}>What the buyer asked for</p>
          {r.notes && <p style={{ fontSize: '0.8125rem', color: '#334155', margin: '0 0 4px' }}>{r.notes}</p>}
          {r.extra_requirements && <p style={{ fontSize: '0.8125rem', color: '#334155', margin: '0 0 4px' }}><strong>Extra:</strong> {r.extra_requirements}</p>}
          {r.sites_needed ? <p style={{ fontSize: '0.75rem', color: '#64748B', margin: 0 }}>{r.sites_needed} site{r.sites_needed > 1 ? 's' : ''} needed</p> : null}
        </div>
      )}

      {canAnswer && (
        <div data-answer-for-owner>
          <p style={small}>Answer for the owner</p>
          <p style={{ fontSize: '0.75rem', color: '#64748B', margin: '0 0 8px' }}>Use this after speaking to the owner. The buyer sees it as the owner&rsquo;s reply.</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
            {([[true, 'Available — send quote'], [false, 'Not available']] as const).map(([v, t]) => (
              <button key={t} onClick={() => setAvail(v)} style={{ ...btn(), background: avail === v ? (v ? '#10B981' : '#EF4444') : '#fff', color: avail === v ? '#fff' : '#475569', border: avail === v ? 'none' : '1px solid #CBD5E1' }}>{t}</button>
            ))}
          </div>
          {avail && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8, alignItems: 'flex-end' }}>
              <input type="number" min={0} value={rate} onChange={e => setRate(e.target.value)} placeholder="Price, ₦ per month" aria-label="Price per month" style={{ ...input, width: 180 }} />
              <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: '0.6875rem', color: '#64748B', fontWeight: 600 }}>From
                <input type="date" value={from} onChange={e => setFrom(e.target.value)} style={{ ...input, width: 150 }} /></label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: '0.6875rem', color: '#64748B', fontWeight: 600 }}>To
                <input type="date" value={to} onChange={e => setTo(e.target.value)} style={{ ...input, width: 150 }} /></label>
              <input value={cond} onChange={e => setCond(e.target.value)} placeholder="Conditions (optional)" aria-label="Conditions" style={{ ...input, flex: 1, minWidth: 180 }} />
            </div>
          )}
          {avail !== null && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <input value={replyNote} onChange={e => setReplyNote(e.target.value)} placeholder="Note to the buyer (optional)" aria-label="Note to the buyer" style={{ ...input, flex: 1, minWidth: 200 }} />
              <button onClick={answer} disabled={busy === 'answer'} style={btn('primary')}>{busy === 'answer' ? 'Sending…' : reply ? 'Update reply' : 'Send reply to buyer'}</button>
            </div>
          )}
        </div>
      )}

      {dealId && <Thread bookingId={dealId} canReplyAsOwner={!!reply?.answered_by_admin || !ownerOnPlatform(r)} onChanged={onChanged} />}

      {r.stage !== 'confirmed' && r.stage !== 'cancelled' && (
        <div data-stage-actions>
          <p style={small}>Move the request</p>
          <input value={stageMsg} onChange={e => setStageMsg(e.target.value)} placeholder="Message to the buyer and owner (optional)" aria-label="Stage message" style={{ ...input, width: '100%', marginBottom: 8 }} />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {r.stage === 'accepted' && <button onClick={() => setStage('booking_in_progress')} disabled={!!busy} style={btn('primary')}>{busy === 'booking_in_progress' ? 'Saving…' : 'Start booking'}</button>}
            {(r.stage === 'accepted' || r.stage === 'booking_in_progress') && <button onClick={() => setStage('confirmed')} disabled={!!busy} style={btn('primary')}>{busy === 'confirmed' ? 'Saving…' : 'Mark booking confirmed'}</button>}
            <button onClick={() => setStage('cancelled')} disabled={!!busy} style={btn('danger')}>{busy === 'cancelled' ? 'Closing…' : 'Close request'}</button>
          </div>
        </div>
      )}

      <div>
        <p style={small}>Internal notes (only admins see these)</p>
        <textarea value={noteText} onChange={e => { setNoteText(e.target.value); setNoteSaved(false); }} rows={2} placeholder="Calls made, what the owner said, next step…" aria-label="Internal notes" style={{ ...input, width: '100%', resize: 'vertical' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
          <button onClick={saveNote} disabled={busy === 'note' || noteText === note} style={btn()}>{busy === 'note' ? 'Saving…' : 'Save notes'}</button>
          {noteSaved && <span style={{ fontSize: '0.75rem', color: '#15803D' }}>Saved</span>}
        </div>
      </div>
    </div>
  );
}

/** The deal's conversation. Admins can reply as the owner when the owner isn't on the platform. */
function Thread({ bookingId, canReplyAsOwner, onChanged }: { bookingId: string; canReplyAsOwner: boolean; onChanged: () => Promise<void> }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [booking, setBooking] = useState<Booking | null>(null);
  const [text, setText] = useState('');
  const [counter, setCounter] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    const [m, b] = await Promise.all([
      supabase.from('messages').select('id, sender_role, message_type, content, offered_rate, created_at').eq('booking_id', bookingId).order('created_at'),
      supabase.from('bookings').select('id, status, offered_rate, agreed_rate').eq('id', bookingId).single(),
    ]);
    setMessages((m.data ?? []) as Message[]);
    setBooking((b.data as Booking) ?? null);
  }
  useEffect(() => { (async () => { await load(); })(); }, [bookingId]); // eslint-disable-line react-hooks/exhaustive-deps

  const open = booking && ['pending', 'negotiating'].includes(booking.status);

  async function send(kind: 'message' | 'counter' | 'agree') {
    if (!booking) return;
    const rate = kind === 'counter' ? Number(counter) : null;
    if (kind === 'counter' && !(rate && rate > 0)) { setErr('Enter the counter price'); return; }
    if (kind === 'message' && !text.trim()) return;
    setBusy(true); setErr(null);
    const content = kind === 'agree' ? `Agreed at ${naira(booking.offered_rate ?? 0)} per month.`
      : kind === 'counter' ? (text.trim() || `Counter offer: ${naira(rate!)} per month`) : text.trim();
    const m = await supabase.from('messages').insert({ booking_id: bookingId, sender_role: 'owner', message_type: kind === 'agree' ? 'accepted' : kind === 'counter' ? 'counter_offer' : 'message', content, offered_rate: rate });
    if (m.error) { setErr(m.error.message); setBusy(false); return; }
    const update = kind === 'agree' ? { status: 'agreed', agreed_rate: booking.offered_rate } : kind === 'counter' ? { status: 'negotiating', offered_rate: rate } : null;
    if (update) {
      const u = await supabase.from('bookings').update(update).eq('id', bookingId);
      if (u.error) { setErr(u.error.message); setBusy(false); return; }
      notifyRequest({ bookingId });
    }
    const { data: who } = await supabase.rpc('booking_buyer', { p_booking_id: bookingId });
    const buyerId = ((who as { buyer_id: string }[] | null) ?? [])[0]?.buyer_id;
    if (buyerId) {
      await supabase.from('notifications').insert({
        recipient_role: 'agency', recipient_user_id: buyerId, type: kind === 'agree' ? 'offer_accepted' : kind === 'counter' ? 'counter_offer' : 'message',
        title: kind === 'agree' ? 'The owner agreed — our team will contact you' : kind === 'counter' ? 'The owner sent a counter offer' : 'New message from the owner',
        body: content.slice(0, 80), link: `/dashboard/agency/negotiations/${bookingId}`,
      });
    }
    setText(''); setCounter(''); setBusy(false);
    await load();
    if (update) await onChanged();
  }

  return (
    <div data-admin-thread>
      <p style={small}>Conversation{booking ? ` · deal ${booking.status}${booking.offered_rate ? ` · offer on the table ${naira(booking.offered_rate)}/mo` : ''}` : ''}</p>
      <div style={{ maxHeight: 260, overflowY: 'auto', background: '#F8FAFC', borderRadius: 10, padding: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {messages.length === 0 ? <p style={{ fontSize: '0.75rem', color: '#94A3B8', margin: 0 }}>No messages yet.</p> : messages.map(m => (
          <div key={m.id} style={{ alignSelf: m.sender_role === 'owner' ? 'flex-start' : 'flex-end', maxWidth: '85%', background: m.sender_role === 'owner' ? '#fff' : '#EFF6FF', border: '1px solid #E2E8F0', borderRadius: 10, padding: '6px 10px' }}>
            <p style={{ fontSize: '0.625rem', fontWeight: 700, color: '#94A3B8', margin: '0 0 2px', textTransform: 'uppercase' }}>{m.sender_role === 'owner' ? 'Owner' : 'Buyer'} · {ago(m.created_at)}</p>
            <p style={{ fontSize: '0.8125rem', color: '#0F172A', margin: 0, whiteSpace: 'pre-wrap' }}>{m.content}</p>
          </div>
        ))}
      </div>
      {err && <p style={{ fontSize: '0.75rem', color: '#B91C1C', margin: '6px 0 0' }}>{err}</p>}
      {canReplyAsOwner && open ? (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
          <input value={text} onChange={e => setText(e.target.value)} placeholder="Reply as the owner…" aria-label="Reply as the owner" style={{ ...input, flex: 1, minWidth: 200 }} />
          <button onClick={() => send('message')} disabled={busy || !text.trim()} style={btn()}>Send</button>
          <input type="number" min={0} value={counter} onChange={e => setCounter(e.target.value)} placeholder="Counter, ₦/mo" aria-label="Counter price" style={{ ...input, width: 140 }} />
          <button onClick={() => send('counter')} disabled={busy} style={btn()}>Counter</button>
          {booking?.offered_rate ? <button onClick={() => send('agree')} disabled={busy} style={btn('primary')}>Agree at {naira(booking.offered_rate)}</button> : null}
        </div>
      ) : !canReplyAsOwner && open ? (
        <p style={{ fontSize: '0.75rem', color: '#64748B', margin: '6px 0 0' }}>The owner is on the platform and replies here themselves.</p>
      ) : null}
    </div>
  );
}
