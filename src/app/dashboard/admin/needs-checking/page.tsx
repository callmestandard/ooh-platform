'use client';

/**
 * Needs checking (053): what owners sent from their no-login links, and
 * which owners need their weekly WhatsApp nudge. Owner answers reach the
 * buyer only when someone here presses "Send to buyer".
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { useDashboardRole } from '@/components/layout/DashboardLayout';
import { notifyRequest } from '@/lib/availability-requests';
import { authedFetch } from '@/lib/api';
import { ownerLinkMessage, ownerLinkUrl, sinceText, waNumber, CHECK_EVERY_DAYS } from '@/lib/owner-links';

type Owner = {
  owner_key: string | null; owner_name: string | null; boards: number; stale: number; never_checked: number;
  oldest_check: string | null; waiting_requests: number; pending_replies: number;
  token: string | null; last_opened_at: string | null; last_saved_at: string | null;
  contact_name: string | null; contact_phone: string | null;
  email?: string | null; last_reminded_at?: string | null;
};
type PendingReply = {
  request_id: string; owner_key: string; available: boolean; quoted_rate: number | null;
  available_from: string | null; available_to: string | null; conditions: string | null; note: string | null; updated_at: string;
  request: {
    id: string; start_date: string; end_date: string; agency_name: string | null; stage: string;
    board: { name: string; city: string | null; area: string | null; photo_urls: string[] | null } | null;
    contacts: { company: string | null } | { company: string | null }[] | null;
  } | null;
};

/** A correction an owner sent from their link (056), with what the listing says now. */
type BoardEdit = {
  board_id: string; owner_key: string; owner_name: string | null; updated_at: string;
  changes: { name?: string; area?: string; address?: string; width?: number; height?: number; illuminated?: boolean };
  photo_url: string | null; note: string | null;
  now: { name: string; area: string | null; city: string | null; address: string | null; width: number | null; height: number | null; illuminated: boolean | null; photo: string | null };
};

const naira = (n: number) => '₦' + Math.round(n).toLocaleString('en-NG');
const fmtDate = (d: string) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const companyOf = (r: PendingReply['request']) => {
  const c = Array.isArray(r?.contacts) ? r?.contacts[0] : r?.contacts;
  return c?.company || r?.agency_name || 'Buyer';
};

export default function NeedsCheckingPage() {
  const role = useDashboardRole();
  const [owners, setOwners] = useState<Owner[] | null>(null);
  const [replies, setReplies] = useState<PendingReply[]>([]);
  const [boardEdits, setBoardEdits] = useState<BoardEdit[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const [o, r] = await Promise.all([
      supabase.rpc('admin_owner_overview'),
      supabase.from('owner_link_replies')
        .select('request_id, owner_key, available, quoted_rate, available_from, available_to, conditions, note, updated_at, request:availability_requests(id, start_date, end_date, agency_name, stage, board:boards(name, city, area, photo_urls), contacts:availability_request_contacts(company))')
        .eq('status', 'pending').order('updated_at', { ascending: true }),
    ]);
    if (o.error) { setError(o.error.message.includes('admin_owner_overview') ? 'Run migration 053 in Supabase to switch this page on.' : o.error.message); setOwners([]); return; }
    setError(null);
    setOwners((o.data ?? []) as Owner[]);
    setReplies(((r.data ?? []) as unknown) as PendingReply[]);
    // Until migration 056 is run this simply stays empty.
    const e = await supabase.rpc('admin_owner_board_edits');
    setBoardEdits(e.error ? [] : ((e.data ?? []) as BoardEdit[]));
  }

  useEffect(() => {
    if (role !== 'admin') return;
    (async () => { await refresh(); })();
  }, [role]);

  if (role !== 'admin') return <div style={{ padding: 32, color: '#64748B', fontSize: '0.875rem' }}>Admins only.</div>;

  const named = (owners ?? []).filter(o => o.owner_key);
  const unknown = (owners ?? []).find(o => !o.owner_key);
  const nameOf = (key: string) => named.find(o => o.owner_key === key)?.owner_name ?? 'Owner';
  const waiting = named.reduce((t, o) => t + o.waiting_requests, 0);
  const stale = (owners ?? []).reduce((t, o) => t + o.stale, 0);
  const total = (owners ?? []).reduce((t, o) => t + o.boards, 0);

  return (
    <div className="nc">
      <style>{CSS}</style>
      <h1 className="nc-h1">Needs checking</h1>
      <p className="nc-sub">
        Each owner has a private link (no login) to confirm their boards every week and answer buyer requests.
        Check their answers here before the buyer sees them.
      </p>

      {error && <div className="nc-card nc-error">{error}</div>}

      <div className="nc-stats">
        <div className={replies.length + boardEdits.length ? 'is-hot' : ''}><strong>{replies.length + boardEdits.length}</strong><span>owner answer{replies.length + boardEdits.length !== 1 ? 's' : ''} and correction{replies.length + boardEdits.length !== 1 ? 's' : ''} to check</span></div>
        <div className={waiting ? 'is-warm' : ''}><strong>{waiting}</strong><span>request{waiting !== 1 ? 's' : ''} waiting on owners</span></div>
        <div className={stale ? 'is-warm' : ''}><strong>{stale}<small>/{total}</small></strong><span>boards not confirmed in {CHECK_EVERY_DAYS} days</span></div>
      </div>

      {replies.length > 0 && (
        <section className="nc-sec" data-replies>
          <h2>Owner answers to check</h2>
          {replies.map(x => <ReplyCard key={x.request_id} x={x} ownerName={nameOf(x.owner_key)} onDone={refresh} />)}
        </section>
      )}

      {boardEdits.length > 0 && (
        <section className="nc-sec" data-board-edits>
          <h2>Board corrections from owners</h2>
          <p className="nc-hint">Buyers see a correction only after you apply it. To change more than the owner sent, apply it and then edit the board in the inventory.</p>
          {boardEdits.map(x => <EditCard key={x.board_id} x={x} onDone={refresh} />)}
        </section>
      )}

      <section className="nc-sec" data-owners>
        <h2>Owners</h2>
        <p className="nc-hint">Owners with an email get their link automatically every Monday at 8am, when they have boards to confirm or requests waiting. For the rest, send it on WhatsApp.</p>
        {owners == null ? (
          <div className="nc-card" style={{ color: '#94A3B8' }}>Loading…</div>
        ) : (
          <div className="nc-card nc-table">
            <div className="nc-row nc-head">
              <span>Owner</span><span>Boards</span><span>Confirmed</span><span>Link</span><span />
            </div>
            {[...named].sort((a, b) => b.waiting_requests - a.waiting_requests || b.stale - a.stale).map(o => (
              <OwnerRow key={o.owner_key} o={o} onChanged={refresh} />
            ))}
            {unknown && (
              <div className="nc-row is-unknown">
                <span><strong>Owner not set</strong><em>Add the owner name to these boards so they can get a link.</em></span>
                <span>{unknown.boards}<i className="nc-m"> board{unknown.boards !== 1 ? 's' : ''}</i></span><span /><span />
                <span><Link href="/dashboard/admin?tab=inventory" className="nc-btn-2">Open inventory</Link></span>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function OwnerRow({ o, onChanged }: { o: Owner; onChanged: () => Promise<void> }) {
  const [token, setToken] = useState(o.token);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const phone = waNumber(o.contact_phone);
  const allStale = o.stale === o.boards;
  const [email, setEmail] = useState(o.email ?? '');
  const [editingEmail, setEditingEmail] = useState(false);
  const [mailNote, setMailNote] = useState<string | null>(null);

  async function saveEmail(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    const { error } = await supabase.rpc('admin_set_owner_email', { p_owner_key: o.owner_key, p_owner_name: o.owner_name ?? 'Board owner', p_email: email.trim() || null });
    setBusy(false);
    if (error) { setErr(error.message.includes('admin_set_owner_email') ? 'Run migration 055 in Supabase to switch on owner emails.' : error.message); return; }
    setEditingEmail(false);
    await onChanged();
  }

  async function emailNow() {
    setBusy(true); setErr(null); setMailNote(null);
    const res = await authedFetch('/api/owner-reminders', { method: 'POST', body: JSON.stringify({ ownerKey: o.owner_key }) });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setErr(json.error ?? 'Could not send the email'); return; }
    setMailNote('Email sent ✓');
    await onChanged();
  }

  async function getToken(fresh = false): Promise<string | null> {
    if (token && !fresh) return token;
    setBusy(true); setErr(null);
    const { data, error } = await supabase.rpc('admin_owner_link', { p_owner_key: o.owner_key, p_owner_name: o.owner_name ?? 'Board owner', p_new: fresh });
    setBusy(false);
    if (error) { setErr(error.message); return null; }
    setToken(data as string);
    return data as string;
  }

  async function whatsapp() {
    // Open the tab first so the browser doesn't block it after the await.
    const w = window.open('', '_blank');
    const t = await getToken();
    if (!t) { w?.close(); return; }
    const text = ownerLinkMessage({ contactName: o.contact_name, boards: o.boards, waiting: o.waiting_requests, url: ownerLinkUrl(t) });
    const url = `https://wa.me/${phone ?? ''}?text=${encodeURIComponent(text)}`;
    if (w) w.location.href = url; else window.location.href = url;
  }

  async function copy() {
    const t = await getToken();
    if (!t) return;
    try { await navigator.clipboard.writeText(ownerLinkUrl(t)); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch {}
  }

  async function renew() {
    if (!window.confirm(`Make a new link for ${o.owner_name}? The old link will stop working.`)) return;
    if (await getToken(true)) await onChanged();
  }

  return (
    <div className="nc-row" data-owner-row>
      <span>
        <strong>{o.owner_name ?? 'Owner'}</strong>
        <em>{o.contact_name || o.contact_phone ? [o.contact_name, o.contact_phone].filter(Boolean).join(' · ') : 'No sales contact saved'}</em>
        {editingEmail ? (
          <form className="nc-mail-form" onSubmit={saveEmail}>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="owner@company.com" aria-label={`Email for ${o.owner_name}`} autoFocus />
            <button type="submit" className="nc-btn" disabled={busy}>Save</button>
            <button type="button" className="nc-btn-2" onClick={() => { setEditingEmail(false); setEmail(o.email ?? ''); }}>Cancel</button>
          </form>
        ) : o.email ? (
          <span className="nc-mail">
            ✉ {o.email} · {mailNote ?? (o.last_reminded_at ? `emailed ${sinceText(o.last_reminded_at)}` : 'weekly email on')}
            <button type="button" onClick={emailNow} disabled={busy}>Email now</button>
            <button type="button" onClick={() => setEditingEmail(true)}>Edit</button>
          </span>
        ) : (
          <span className="nc-mail"><button type="button" onClick={() => setEditingEmail(true)}>+ Add email for weekly reminders</button></span>
        )}
        {(o.waiting_requests > 0 || o.pending_replies > 0) && (
          <span className="nc-tags">
            {o.waiting_requests > 0 && <i className="is-hot">{o.waiting_requests} request{o.waiting_requests !== 1 ? 's' : ''} waiting</i>}
            {o.pending_replies > 0 && <i className="is-blue">{o.pending_replies} answer{o.pending_replies !== 1 ? 's' : ''} to check</i>}
          </span>
        )}
      </span>
      <span>{o.boards}<i className="nc-m"> board{o.boards !== 1 ? 's' : ''}</i></span>
      <span>
        {o.stale === 0
          ? <b className="is-ok">All this week</b>
          : <b className="is-warn">{allStale ? (o.never_checked === o.boards ? 'Never' : sinceText(o.oldest_check)) : `${o.stale} out of date`}</b>}
      </span>
      <span className="nc-muted">
        {!token ? 'Not sent yet' : o.last_saved_at ? `Used ${sinceText(o.last_saved_at)}` : o.last_opened_at ? `Opened ${sinceText(o.last_opened_at)}` : 'Not opened yet'}
      </span>
      <span className="nc-actions">
        <button type="button" className="nc-btn-wa" onClick={whatsapp} disabled={busy} title={phone ? `WhatsApp ${o.contact_phone}` : 'No phone saved: choose the contact in WhatsApp'}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.5 14.4c-.3-.1-1.8-.9-2-1-.3-.1-.5-.1-.7.1-.2.3-.8 1-.9 1.2-.2.2-.3.2-.6.1-.3-.1-1.3-.5-2.4-1.5-.9-.8-1.5-1.8-1.7-2.1-.2-.3 0-.5.1-.6l.4-.5c.2-.2.2-.3.3-.5.1-.2.1-.4 0-.5l-.9-2.2c-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.5s1.1 2.9 1.2 3.1c.1.2 2.1 3.2 5.1 4.5 2.5 1 3 .8 3.6.7.6-.1 1.8-.7 2-1.4.2-.7.2-1.3.2-1.4-.1-.1-.3-.2-.6-.3zM12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2z" /></svg>
          Send link
        </button>
        <button type="button" className="nc-btn-2" onClick={copy} disabled={busy}>{copied ? 'Copied ✓' : 'Copy'}</button>
        {token && <button type="button" className="nc-btn-x" onClick={renew} disabled={busy} title="Make a new link (the old one stops working)" aria-label="Make a new link">↻</button>}
      </span>
      {err && <p className="nc-err">{err}</p>}
    </div>
  );
}

function EditCard({ x, onDone }: { x: BoardEdit; onDone: () => Promise<void> }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const c = x.changes ?? {};
  const lit = (v: boolean | null | undefined) => (v == null ? 'not set' : v ? 'lit at night' : 'not lit');
  const rows: [string, string, string][] = [];
  if (c.name != null) rows.push(['Name', x.now.name, c.name]);
  if (c.area != null) rows.push(['Area', x.now.area || 'not set', c.area || 'none']);
  if (c.address != null) rows.push(['Address', x.now.address || 'not set', c.address]);
  if (c.width != null) rows.push(['Width', x.now.width != null ? `${x.now.width}m` : 'not set', `${c.width}m`]);
  if (c.height != null) rows.push(['Height', x.now.height != null ? `${x.now.height}m` : 'not set', `${c.height}m`]);
  if (c.illuminated != null) rows.push(['Lighting', lit(x.now.illuminated), lit(c.illuminated)]);

  async function decide(apply: boolean) {
    if (!apply && !window.confirm('Dismiss this correction? The listing stays as it is.')) return;
    setBusy(apply ? 'apply' : 'dismiss'); setErr(null);
    const { error } = await supabase.rpc('admin_decide_owner_board_edit', { p_board_id: x.board_id, p_apply: apply });
    setBusy(null);
    if (error) { setErr(error.message); return; }
    await onDone();
  }

  return (
    <article className="nc-card nc-reply" data-edit-card>
      <div className="nc-reply-main">
        <div style={{ minWidth: 0, flex: 1 }}>
          <p className="nc-title">{x.now.name}</p>
          <p className="nc-meta">{[x.now.area, x.now.city].filter(Boolean).join(', ') || 'No area'} · sent {sinceText(x.updated_at)} by {x.owner_name ?? 'the owner'}</p>
          {x.photo_url && (
            <div className="nc-photos">
              <figure>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {x.now.photo ? <img src={x.now.photo} alt="Photo on the listing now" /> : <span>No photo</span>}
                <figcaption>Now</figcaption>
              </figure>
              <span className="nc-arrow" aria-hidden="true">→</span>
              <figure className="is-new">
                <a href={x.photo_url} target="_blank" rel="noopener noreferrer" title="Open the full photo">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={x.photo_url} alt="New photo from the owner" />
                </a>
                <figcaption>New main photo</figcaption>
              </figure>
            </div>
          )}
          {rows.length > 0 && (
            <dl className="nc-diff">
              {rows.map(([label, was, next]) => (
                <div key={label}><dt>{label}</dt><dd><s>{was}</s><b>{next}</b></dd></div>
              ))}
            </dl>
          )}
          {x.note && <p className="nc-note">Note: {x.note}</p>}
        </div>
      </div>
      <div className="nc-reply-act">
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="nc-btn" onClick={() => decide(true)} disabled={!!busy} data-apply-edit>{busy === 'apply' ? 'Applying…' : rows.length || x.photo_url ? 'Apply to listing' : 'Mark as done'}</button>
          <button type="button" className="nc-btn-2" onClick={() => decide(false)} disabled={!!busy}>Dismiss</button>
        </div>
        <Link href="/dashboard/admin?tab=inventory" className="nc-btn-2">Open inventory</Link>
        {err && <p className="nc-err" style={{ margin: 0 }}>{err}</p>}
      </div>
    </article>
  );
}

function ReplyCard({ x, ownerName, onDone }: { x: PendingReply; ownerName: string; onDone: () => Promise<void> }) {
  const [rate, setRate] = useState(x.quoted_rate ? String(x.quoted_rate) : '');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const r = x.request;
  const b = r?.board;

  async function send() {
    if (x.available && !(Number(rate) > 0)) { setErr('Add the price per month the buyer should see.'); return; }
    setBusy('send'); setErr(null);
    const { error } = await supabase.rpc('admin_send_owner_reply', { p_request_id: x.request_id, p_rate: x.available ? Number(rate) : null });
    setBusy(null);
    if (error) { setErr(error.message); return; }
    notifyRequest({ requestId: x.request_id });
    await onDone();
  }
  async function dismiss() {
    if (!window.confirm('Dismiss this answer? The buyer won’t see it. Call the owner to sort it out.')) return;
    setBusy('dismiss'); setErr(null);
    const { data: { session } } = await supabase.auth.getSession();
    const { error } = await supabase.from('owner_link_replies').update({ status: 'dismissed', reviewed_by: session?.user.id ?? null, reviewed_at: new Date().toISOString() }).eq('request_id', x.request_id);
    setBusy(null);
    if (error) { setErr(error.message); return; }
    await onDone();
  }

  const changed = x.available && x.quoted_rate && Number(rate) !== Number(x.quoted_rate);

  return (
    <article className="nc-card nc-reply" data-reply-card>
      <div className="nc-reply-main">
        <span className="nc-thumb">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {b?.photo_urls?.[0] ? <img src={b.photo_urls[0]} alt="" /> : null}
        </span>
        <div style={{ minWidth: 0 }}>
          <p className="nc-title">{b?.name ?? 'Board'}</p>
          <p className="nc-meta">{companyOf(r)} · {r ? `${fmtDate(r.start_date)} – ${fmtDate(r.end_date)}` : ''} · answered {sinceText(x.updated_at)} by {ownerName}</p>
          <p className={`nc-said ${x.available ? 'is-yes' : 'is-no'}`}>
            <strong>{x.available ? 'Available' : 'Not available'}</strong>
            {x.available && x.quoted_rate ? <> at {naira(x.quoted_rate)}/month</> : null}
            {x.available && x.available_from ? <> · {fmtDate(x.available_from)}{x.available_to ? ` – ${fmtDate(x.available_to)}` : ''}</> : null}
          </p>
          {(x.conditions || x.note) && <p className="nc-note">{x.conditions && <>Terms: {x.conditions}<br /></>}{x.note && <>Note: {x.note}</>}</p>}
        </div>
      </div>
      <div className="nc-reply-act">
        {x.available && (
          <label className="nc-price">
            <span>Buyer sees (₦/month)</span>
            <input inputMode="numeric" value={rate} onChange={e => setRate(e.target.value.replace(/[^\d]/g, ''))} />
            {Number(rate) > 0 && <em className={changed ? 'is-changed' : ''}>{naira(Number(rate))}{changed ? ` · owner said ${naira(Number(x.quoted_rate))}` : ''}</em>}
          </label>
        )}
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="nc-btn" onClick={send} disabled={!!busy}>{busy === 'send' ? 'Sending…' : 'Send to buyer'}</button>
          <button type="button" className="nc-btn-2" onClick={dismiss} disabled={!!busy}>Dismiss</button>
        </div>
        {err && <p className="nc-err" style={{ margin: 0 }}>{err}</p>}
      </div>
    </article>
  );
}

const CSS = `
.nc { max-width: 1040px; margin: 0 auto; padding: 8px 0 48px; color: #0F172A; }
.nc-h1 { font-size: 1.375rem; font-weight: 800; margin: 0 0 4px; letter-spacing: -.02em; }
.nc-sub { font-size: .875rem; color: #64748B; margin: 0 0 18px; max-width: 680px; line-height: 1.55; }
.nc-card { background: #fff; border: 1px solid #E2E8F0; border-radius: 14px; padding: 14px 16px; }
.nc-error { border-color: #FECACA; background: #FEF2F2; color: #B91C1C; font-size: .8125rem; margin-bottom: 14px; }
.nc-stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin-bottom: 24px; }
.nc-stats div { background: #fff; border: 1px solid #E2E8F0; border-radius: 14px; padding: 14px 16px; display: flex; flex-direction: column; gap: 2px; }
.nc-stats strong { font-size: 1.625rem; font-weight: 800; letter-spacing: -.02em; color: #94A3B8; }
.nc-stats small { font-size: .9375rem; color: #94A3B8; font-weight: 600; }
.nc-stats span { font-size: .8125rem; color: #64748B; }
.nc-stats .is-hot { border-color: #FECDD3; background: #FFF1F2; } .nc-stats .is-hot strong { color: #E11D48; }
.nc-stats .is-warm { border-color: #FDE68A; background: #FFFBEB; } .nc-stats .is-warm strong { color: #B45309; }
.nc-sec { margin-bottom: 26px; }
.nc-sec h2 { font-size: 1rem; font-weight: 800; margin: 0 0 4px; letter-spacing: -.01em; }
.nc-hint { font-size: .8125rem; color: #64748B; margin: 0 0 10px; }
.nc-reply { display: flex; gap: 16px; justify-content: space-between; align-items: center; margin-top: 10px; flex-wrap: wrap; }
.nc-reply-main { display: flex; gap: 12px; min-width: 0; flex: 1 1 380px; }
.nc-reply-act { display: flex; flex-direction: column; gap: 8px; align-items: flex-end; }
.nc-thumb { width: 64px; height: 64px; border-radius: 10px; background: #EEF2F7; overflow: hidden; flex-shrink: 0; }
.nc-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.nc-title { font-weight: 700; font-size: .9375rem; margin: 0; }
.nc-meta { font-size: .75rem; color: #64748B; margin: 2px 0 6px; }
.nc-said { font-size: .875rem; margin: 0; }
.nc-said.is-yes strong { color: #047857; } .nc-said.is-no strong { color: #B91C1C; }
.nc-note { font-size: .8125rem; color: #475569; background: #F8FAFC; border-radius: 8px; padding: 6px 9px; margin: 6px 0 0; }
.nc-photos { display: flex; align-items: center; gap: 10px; margin: 8px 0 4px; }
.nc-photos figure { margin: 0; width: 132px; }
.nc-photos img, .nc-photos figure > span { width: 132px; height: 92px; border-radius: 10px; object-fit: cover; display: block; background: #EEF2F7; }
.nc-photos figure > span { display: grid; place-items: center; font-size: .75rem; color: #94A3B8; }
.nc-photos figure.is-new img { box-shadow: 0 0 0 2px #1B4F8A; }
.nc-photos figcaption { font-size: .6875rem; font-weight: 600; color: #64748B; margin-top: 4px; }
.nc-arrow { color: #94A3B8; font-size: 1.125rem; margin-bottom: 18px; }
.nc-diff { margin: 8px 0 0; display: grid; gap: 4px; }
.nc-diff div { display: grid; grid-template-columns: 76px minmax(0, 1fr); gap: 10px; font-size: .8125rem; }
.nc-diff dt { color: #64748B; }
.nc-diff dd { margin: 0; display: flex; flex-wrap: wrap; gap: 4px 10px; min-width: 0; }
.nc-diff s { color: #94A3B8; overflow-wrap: anywhere; }
.nc-diff b { font-weight: 700; color: #0F172A; overflow-wrap: anywhere; }
.nc-price { display: flex; flex-direction: column; gap: 3px; font-size: .6875rem; font-weight: 600; color: #64748B; text-transform: uppercase; letter-spacing: .04em; }
.nc-price input { width: 170px; height: 36px; border-radius: 9px; border: 1px solid #CBD5E1; padding: 0 10px; font-family: inherit; font-size: .9375rem; font-weight: 700; color: #0F172A; text-align: right; }
.nc-price em { font-style: normal; text-transform: none; letter-spacing: 0; color: #64748B; text-align: right; font-weight: 500; }
.nc-price em.is-changed { color: #B45309; font-weight: 600; }
.nc-table { padding: 0; overflow: hidden; }
.nc-row { display: grid; grid-template-columns: minmax(0, 1fr) 64px 130px 140px 236px; gap: 12px; align-items: center; padding: 12px 16px; border-top: 1px solid #F1F5F9; font-size: .8125rem; }
.nc-row > span:first-child { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.nc-row strong { font-size: .875rem; }
.nc-row em { font-style: normal; color: #94A3B8; font-size: .75rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nc-head { border-top: none; background: #F8FAFC; font-size: .6875rem; font-weight: 700; color: #64748B; text-transform: uppercase; letter-spacing: .05em; padding: 9px 16px; }
.nc-row.is-unknown { background: #FFFBEB; }
.nc-tags { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 3px; }
.nc-tags i { font-style: normal; font-size: .6875rem; font-weight: 700; padding: 2px 8px; border-radius: 999px; }
.nc-tags .is-hot { background: #FFE4E6; color: #BE123C; } .nc-tags .is-blue { background: #DBEAFE; color: #1D4ED8; }
.nc-row b { font-weight: 600; font-size: .8125rem; }
.nc-row b.is-ok { color: #047857; } .nc-row b.is-warn { color: #B45309; }
.nc-muted { color: #64748B; }
.nc-mail { font-size: .75rem; color: #475569; display: flex; flex-wrap: wrap; gap: 4px 10px; align-items: center; margin-top: 3px; }
.nc-mail button { background: none; border: none; padding: 0; font-family: inherit; font-size: .75rem; font-weight: 700; color: #1B4F8A; cursor: pointer; }
.nc-mail button:disabled { opacity: .5; }
.nc-mail-form { display: flex; gap: 6px; margin-top: 6px; flex-wrap: wrap; }
.nc-mail-form input { flex: 1 1 180px; min-width: 0; height: 34px; border-radius: 9px; border: 1px solid #CBD5E1; padding: 0 10px; font-family: inherit; font-size: .8125rem; }
.nc-m { display: none; font-style: normal; }
.nc-actions { display: flex; gap: 6px; justify-content: flex-end; }
.nc-btn, .nc-btn-2, .nc-btn-wa, .nc-btn-x { height: 34px; border-radius: 9px; font-family: inherit; font-size: .8125rem; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 0 12px; text-decoration: none; white-space: nowrap; }
.nc-btn { background: #1B4F8A; color: #fff; border: none; }
.nc-btn-wa { background: #16A34A; color: #fff; border: none; }
.nc-btn-2 { background: #fff; color: #334155; border: 1px solid #E2E8F0; }
.nc-btn-x { background: #fff; color: #64748B; border: 1px solid #E2E8F0; padding: 0; width: 34px; font-size: 1rem; }
.nc-btn:disabled, .nc-btn-2:disabled, .nc-btn-wa:disabled { opacity: .6; cursor: default; }
.nc-err { grid-column: 1 / -1; font-size: .75rem; color: #B91C1C; margin: 0; }
@media (max-width: 760px) {
  .nc-stats { grid-template-columns: 1fr; }
  .nc-head { display: none; }
  .nc-row { grid-template-columns: 1fr auto; gap: 6px 12px; }
  .nc-m { display: inline; }
  .nc-row > span:nth-child(2) { text-align: right; color: #64748B; }
  .nc-row > span:nth-child(3), .nc-row > span:nth-child(4) { font-size: .75rem; }
  .nc-row > span:nth-child(4) { text-align: right; }
  .nc-actions { grid-column: 1 / -1; justify-content: flex-start; }
  .nc-reply-act { align-items: stretch; width: 100%; }
  .nc-price input { width: 100%; }
}
`;
