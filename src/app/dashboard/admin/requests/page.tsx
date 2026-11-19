'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useDashboardRole } from '@/components/layout/DashboardLayout';
import { boardFormatLabel } from '@/lib/board-formats';
import { STAGE_META, notifyRequest, type RequestStage } from '@/lib/availability-requests';
import { Journey, StageTag, fmtShort, spanText } from '@/components/requests/journey';

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
  board: { id: string; name: string; city: string | null; area: string | null; format: string | null; owner_id: string | null; contact_name: string | null; contact_phone: string | null; photo_urls: string[] | null } | null;
  responses: Reply[];
  recipients: { owner_id: string; owner_name: string | null; responded_at: string | null }[];
  contacts: Contact | Contact[] | null;
};
type Message = { id: string; sender_role: 'agency' | 'owner'; message_type: string; content: string; offered_rate: number | null; created_at: string };
type Booking = { id: string; status: string; offered_rate: number | null; agreed_rate: number | null };

const OPEN: RequestStage[] = ['requested', 'owner_responded', 'quote_received', 'unavailable', 'negotiating', 'accepted', 'booking_in_progress'];
const ANSWERABLE: RequestStage[] = ['requested', 'owner_responded', 'quote_received', 'unavailable'];
const DAY = 86_400_000;

/** The pipeline columns along the top: the same four steps the buyer sees. */
const LANES: { key: string; label: string; hint: string; stages: RequestStage[] }[] = [
  { key: 'owner', label: 'Waiting on owner', hint: 'Get the owner’s price', stages: ['requested', 'owner_responded'] },
  { key: 'buyer', label: 'Price sent', hint: 'Buyer to answer', stages: ['quote_received'] },
  { key: 'agree', label: 'Agreeing', hint: 'In conversation', stages: ['negotiating'] },
  { key: 'book', label: 'To book', hint: 'Complete the booking', stages: ['accepted', 'booking_in_progress'] },
];

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

const card: React.CSSProperties = { background: '#fff', border: '1px solid #E8EDF3', borderRadius: 16 };
const input: React.CSSProperties = { boxSizing: 'border-box', padding: '9px 11px', borderRadius: 9, border: '1.5px solid #E2E8F0', fontSize: '0.8125rem', color: '#0F172A', background: '#fff', fontFamily: 'inherit', outline: 'none' };
const small: React.CSSProperties = { fontSize: '0.6875rem', fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 6px' };
const btn = (kind: 'primary' | 'plain' | 'danger' = 'plain'): React.CSSProperties => ({
  padding: '9px 14px', borderRadius: 9, fontSize: '0.75rem', fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer', whiteSpace: 'nowrap',
  border: kind === 'plain' ? '1px solid #CBD5E1' : 'none',
  background: kind === 'primary' ? '#1B4F8A' : kind === 'danger' ? '#FEF2F2' : '#fff',
  color: kind === 'primary' ? '#fff' : kind === 'danger' ? '#B91C1C' : '#0F172A',
});

type Filter = 'follow' | 'open' | 'all' | `lane:${string}`;

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
        board:boards(id, name, city, area, format, owner_id, contact_name, contact_phone, photo_urls),
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
    const lane = filter.startsWith('lane:') ? LANES.find(l => `lane:${l.key}` === filter) : null;
    return requests.filter(r => {
      // Keep the request being managed on screen even if it no longer matches.
      if (r.id === openId) return true;
      if (filter === 'follow' && !followUp(r)) return false;
      if (filter === 'open' && !OPEN.includes(r.stage)) return false;
      if (lane && !lane.stages.includes(r.stage)) return false;
      if (stageFilter && r.stage !== stageFilter) return false;
      if (!q) return true;
      const c = contactOf(r);
      return [r.board?.name, r.board?.city, r.board?.area, r.agency_name, c?.name, c?.company, c?.email].some(v => v?.toLowerCase().includes(q));
    });
  }, [requests, filter, stageFilter, search, openId]);

  if (role !== 'admin') return <div style={{ padding: 32, color: '#64748B', fontSize: '0.875rem' }}>Admins only.</div>;

  const followCount = requests.filter(r => followUp(r)).length;
  const openCount = requests.filter(r => OPEN.includes(r.stage)).length;
  const booked = requests.filter(r => r.stage === 'confirmed').length;

  return (
    <div className="ar">
      <header className="ar-head">
        <div>
          <h1>Requests</h1>
          <p>Every &ldquo;Request this location&rdquo;. Get the owner&rsquo;s price, help the buyer agree, and take the deal through to a booking.</p>
        </div>
        <div className="ar-kpis">
          <div><b>{openCount}</b><span>open</span></div>
          <div className={followCount ? 'warn' : ''}><b>{followCount}</b><span>need follow-up</span></div>
          <div className="good"><b>{booked}</b><span>booked</span></div>
        </div>
      </header>

      {/* Pipeline: the same four steps the buyer sees. Click a step to see its requests. */}
      <div className="ar-lanes" role="tablist" aria-label="Pipeline">
        {LANES.map((l, i) => {
          const rows = requests.filter(r => l.stages.includes(r.stage));
          const late = rows.filter(r => followUp(r)).length;
          const on = filter === `lane:${l.key}`;
          return (
            <button key={l.key} role="tab" aria-selected={on} className={`ar-lane${on ? ' on' : ''}`} onClick={() => setFilter(on ? 'open' : `lane:${l.key}`)}>
              <span className="ar-lane-n">{i + 1}</span>
              <span className="ar-lane-t">{l.label}</span>
              <b>{rows.length}</b>
              <small>{late ? <em>{late} need follow-up</em> : l.hint}</small>
            </button>
          );
        })}
      </div>

      <div className="ar-bar">
        <div className="ar-tabs">
          {([['follow', 'Needs follow-up', followCount], ['open', 'Open', openCount], ['all', 'All', requests.length]] as const).map(([k, text, n]) => (
            <button key={k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>{text}<span>{n}</span></button>
          ))}
        </div>
        <select value={stageFilter} onChange={e => setStageFilter(e.target.value as RequestStage | '')} style={{ ...input, padding: '8px 10px' }} aria-label="Stage">
          <option value="">Any stage</option>
          {(Object.keys(STAGE_META) as RequestStage[]).map(s => <option key={s} value={s}>{STAGE_META[s].label}</option>)}
        </select>
        <div className="ar-search">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search board, buyer, email…" aria-label="Search" />
        </div>
      </div>

      {error && <div style={{ ...card, padding: 14, borderColor: '#FECACA', background: '#FEF2F2', color: '#B91C1C', fontSize: '0.8125rem', marginBottom: 14 }}>{error}</div>}

      {loading ? (
        <div style={{ ...card, padding: 24, color: '#94A3B8', fontSize: '0.875rem' }}>Loading…</div>
      ) : shown.length === 0 ? (
        <div className="ar-empty">
          <div className="ar-empty-ico"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></div>
          <b>{filter === 'follow' ? 'All caught up' : 'No requests here'}</b>
          <p>{filter === 'follow' ? 'Nothing needs follow-up right now.' : requests.length === 0 ? 'Requests from buyers will appear here.' : 'No requests match.'}</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {shown.map(r => (
            <RequestCard key={r.id} r={r} open={openId === r.id} onToggle={() => setOpenId(openId === r.id ? null : r.id)}
              note={notes[r.id] ?? ''} onNoteSaved={text => setNotes(prev => ({ ...prev, [r.id]: text }))} onChanged={refresh} />
          ))}
        </div>
      )}

      <style>{ADMIN_CSS}</style>
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
  const photo = r.board?.photo_urls?.[0];
  const closed = r.stage === 'cancelled' || r.stage === 'unavailable' || r.stage === 'confirmed';

  return (
    <article data-admin-request={r.id} className={`ar-card${reason ? ' late' : ''}${open ? ' open' : ''}`}>
      {reason && <p data-follow-up className="ar-flag"><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M5 3v18h2v-7h11l-2-4.5L18 5H7V3z"/></svg>{reason}</p>}
      <div className="ar-top">
        <a href={`/boards/${r.board_id}`} target="_blank" rel="noopener noreferrer" className="ar-ph" aria-hidden tabIndex={-1}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {photo && <img src={photo} alt="" loading="lazy" />}
        </a>
        <div className="ar-id">
          <div className="ar-l1">
            <a href={`/boards/${r.board_id}`} target="_blank" rel="noopener noreferrer" className="ar-name">{r.board?.name ?? r.title}</a>
            <StageTag stage={r.stage} />
          </div>
          <p className="ar-meta">
            {[r.board?.area, r.board?.city].filter(Boolean).join(', ')}{r.board?.format ? ` · ${boardFormatLabel(r.board.format)}` : ''}
          </p>
          <p className="ar-meta2">
            <b>{fmtShort(r.start_date)} – {fmtDate(r.end_date)}</b> · {spanText(r.start_date, r.end_date)}{r.budget ? ` · budget ${naira(r.budget)}` : ''} · sent {ago(r.created_at)}
          </p>
        </div>
        <div className="ar-side">
          {!closed && <div className="ar-j"><Journey stage={r.stage} compact /></div>}
          <button onClick={onToggle} style={btn(open ? 'plain' : 'primary')}>{open ? 'Close' : 'Manage'}</button>
        </div>
      </div>

      <div className="ar-cells">
        <div className="ar-cell">
          <p style={small}>Buyer</p>
          <p className="ar-cell-m">{c?.name ?? '—'}{c?.company ? <span> · {c.company}</span> : ''}</p>
          <p className="ar-cell-s">
            {c?.email && <a href={`mailto:${c.email}`}>{c.email}</a>}
            {c?.phone && <> · <a href={`tel:${c.phone}`}>{c.phone}</a></>}
          </p>
        </div>
        <div className="ar-cell">
          <p style={small}>Owner {onPlatform ? <span className="ar-on">on platform</span> : <span className="ar-off">offline</span>}</p>
          <p className="ar-cell-m">{onPlatform ? ownerName ?? 'On the platform' : r.board?.contact_name ?? 'No contact name'}</p>
          <p className="ar-cell-s">
            {onPlatform && r.board?.contact_name ? <>{r.board.contact_name} · </> : null}
            {r.board?.contact_phone ? <a href={`tel:${r.board.contact_phone}`}>{r.board.contact_phone}</a> : 'no phone on file'}
          </p>
        </div>
        <div className="ar-cell">
          <p style={small}>Reply{reply?.answered_by_admin ? ' · entered by us' : ''}</p>
          {reply ? (
            <>
              <p className="ar-cell-m">
                {reply.available ? (reply.quoted_rate ? <><span className="ar-price">{naira(reply.quoted_rate)}</span> /mo</> : 'Available, no price yet') : 'Not available'}
              </p>
              {(reply.conditions || reply.note) && <p className="ar-cell-s">{[reply.conditions, reply.note].filter(Boolean).join(' · ')}</p>}
            </>
          ) : <p className="ar-cell-m" style={{ color: '#94A3B8', fontWeight: 500 }}>No reply yet</p>}
        </div>
      </div>

      {open && <Manage r={r} note={note} onNoteSaved={onNoteSaved} onChanged={onChanged} />}
    </article>
  );
}

const ADMIN_CSS = `
.ar { max-width: 1080px; margin: 0 auto; padding: 8px 0 56px; font-family: 'Inter', -apple-system, sans-serif; }
.ar-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 20px; flex-wrap: wrap; margin-bottom: 20px; }
.ar-head h1 { margin: 0; font-size: 1.625rem; font-weight: 800; color: #0F172A; letter-spacing: -0.025em; }
.ar-head p { margin: 6px 0 0; max-width: 560px; font-size: 0.875rem; color: #64748B; line-height: 1.5; }
.ar-kpis { display: flex; gap: 8px; }
.ar-kpis div { padding: 8px 14px; border-radius: 12px; background: #fff; border: 1px solid #E8EDF3; display: flex; flex-direction: column; min-width: 72px; }
.ar-kpis b { font-size: 1.25rem; font-weight: 800; color: #0F172A; letter-spacing: -0.02em; line-height: 1.2; }
.ar-kpis span { font-size: 0.6875rem; color: #64748B; font-weight: 600; }
.ar-kpis .warn { background: #FFFBEB; border-color: #FDE68A; }
.ar-kpis .warn b { color: #B45309; }
.ar-kpis .good b { color: #047857; }
.ar-lanes { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0; margin-bottom: 16px; background: #fff; border: 1px solid #E8EDF3; border-radius: 16px; overflow: hidden; }
.ar-lane { position: relative; display: grid; grid-template-columns: auto 1fr auto; grid-template-rows: auto auto; column-gap: 10px; row-gap: 4px; align-items: center; padding: 14px 16px; border: none; background: none; text-align: left; font-family: inherit; cursor: pointer; transition: background .15s; }
.ar-lane + .ar-lane { border-left: 1px solid #F1F5F9; }
.ar-lane:hover { background: #F8FAFC; }
.ar-lane.on { background: #EFF6FF; }
.ar-lane.on::after { content: ''; position: absolute; left: 0; right: 0; bottom: 0; height: 3px; background: #1B4F8A; }
.ar-lane-n { width: 22px; height: 22px; border-radius: 50%; background: #F1F5F9; color: #475569; display: grid; place-items: center; font-size: 0.6875rem; font-weight: 800; }
.ar-lane.on .ar-lane-n { background: #1B4F8A; color: #fff; }
.ar-lane-t { font-size: 0.8125rem; font-weight: 700; color: #0F172A; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ar-lane b { font-size: 1.375rem; font-weight: 800; color: #0F172A; letter-spacing: -0.02em; grid-row: span 2; }
.ar-lane small { grid-column: 2; font-size: 0.6875rem; color: #94A3B8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ar-lane small em { font-style: normal; color: #B45309; font-weight: 700; }
.ar-bar { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-bottom: 14px; }
.ar-tabs { display: inline-flex; gap: 2px; padding: 3px; border-radius: 11px; background: #F1F5F9; }
.ar-tabs button { display: inline-flex; align-items: center; gap: 7px; padding: 7px 12px; border: none; border-radius: 8px; background: none; color: #64748B; font: 600 0.8125rem/1 inherit; font-family: inherit; cursor: pointer; }
.ar-tabs button span { font-size: 0.6875rem; padding: 2px 6px; border-radius: 6px; background: rgba(15,23,42,.06); }
.ar-tabs button.on { background: #fff; color: #0F172A; box-shadow: 0 1px 3px rgba(15,23,42,.1); }
.ar-search { flex: 1; min-width: 200px; display: flex; align-items: center; gap: 8px; padding: 0 12px; border-radius: 10px; border: 1.5px solid #E2E8F0; background: #fff; color: #94A3B8; }
.ar-search:focus-within { border-color: #1B4F8A; }
.ar-search input { flex: 1; border: none; outline: none; padding: 9px 0; font: 400 0.8125rem/1 inherit; font-family: inherit; color: #0F172A; background: none; }
.ar-card { background: #fff; border: 1px solid #E8EDF3; border-radius: 18px; padding: 16px; box-shadow: 0 1px 2px rgba(15,23,42,.04); transition: box-shadow .2s; }
.ar-card:hover, .ar-card.open { box-shadow: 0 8px 28px -12px rgba(15,23,42,.18); }
.ar-card.late { border-color: #FDE68A; }
.ar-flag { display: inline-flex; align-items: center; gap: 6px; margin: 0 0 12px; padding: 4px 10px; border-radius: 8px; background: #FFFBEB; color: #B45309; font-size: 0.75rem; font-weight: 700; }
.ar-top { display: flex; gap: 14px; align-items: flex-start; }
.ar-ph { width: 76px; height: 60px; border-radius: 11px; overflow: hidden; background: linear-gradient(135deg, #E2E8F0, #CBD5E1); flex-shrink: 0; display: block; }
.ar-ph img { width: 100%; height: 100%; object-fit: cover; display: block; }
.ar-id { flex: 1; min-width: 0; }
.ar-l1 { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.ar-name { font-size: 0.9375rem; font-weight: 700; color: #0F172A; text-decoration: none; letter-spacing: -0.01em; }
.ar-name:hover { color: #1B4F8A; }
.ar-meta { margin: 3px 0 0; font-size: 0.8125rem; color: #64748B; }
.ar-meta2 { margin: 4px 0 0; font-size: 0.75rem; color: #94A3B8; }
.ar-meta2 b { color: #334155; font-weight: 600; }
.ar-side { display: flex; align-items: center; gap: 14px; flex-shrink: 0; }
.ar-j { width: 120px; }
.ar-cells { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-top: 14px; }
.ar-cell { background: #F8FAFC; border-radius: 12px; padding: 11px 13px; min-width: 0; }
.ar-cell-m { margin: 0; font-size: 0.8125rem; font-weight: 600; color: #0F172A; }
.ar-cell-m span { color: #64748B; font-weight: 500; }
.ar-cell-s { margin: 3px 0 0; font-size: 0.75rem; color: #475569; word-break: break-word; }
.ar-cell-s a { color: #1B4F8A; text-decoration: none; }
.ar-cell-s a:hover { text-decoration: underline; }
.ar-on, .ar-off { margin-left: 4px; padding: 1px 6px; border-radius: 5px; font-size: 0.5625rem; letter-spacing: .04em; }
.ar-on { background: #D1FAE5; color: #047857; }
.ar-off { background: #FEF3C7; color: #92400E; }
.ar-price { font-size: 1rem; font-weight: 800; letter-spacing: -0.01em; }
.ar-empty { text-align: center; padding: 44px 24px; border-radius: 18px; background: #fff; border: 1px dashed #CBD5E1; }
.ar-empty-ico { width: 48px; height: 48px; margin: 0 auto 12px; border-radius: 50%; background: #ECFDF5; color: #10B981; display: grid; place-items: center; }
.ar-empty b { font-size: 1rem; color: #0F172A; }
.ar-empty p { margin: 4px 0 0; font-size: 0.8125rem; color: #64748B; }
@media (max-width: 860px) {
  .ar-lanes { grid-template-columns: 1fr 1fr; }
  .ar-lane:nth-child(3) { border-left: none; }
  .ar-lane:nth-child(n+3) { border-top: 1px solid #F1F5F9; }
  .ar-cells { grid-template-columns: 1fr; }
  .ar-top { flex-wrap: wrap; }
  .ar-side { width: 100%; justify-content: space-between; }
}
@media (max-width: 520px) {
  .ar-kpis { width: 100%; }
  .ar-kpis div { flex: 1; }
  .ar-lane { padding: 12px; }
  .ar-lane small { display: none; }
}
`;


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
    <div style={{ marginTop: 14, borderTop: '1px solid #F1F5F9', paddingTop: 16, display: 'flex', flexDirection: 'column', gap: 18 }}>
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
