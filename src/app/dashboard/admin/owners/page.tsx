'use client';

/**
 * Media owners (063): one record per owner company, with contact people,
 * a status, their private link, what they've answered, and their boards.
 * Owner contacts are only ever shown here, to admins.
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { useDashboardRole } from '@/components/layout/DashboardLayout';
import { authedFetch } from '@/lib/api';
import { ownerLinkMessage, ownerLinkUrl, sinceText, waNumber, CHECK_EVERY_DAYS } from '@/lib/owner-links';

type OwnerStatus = 'unreviewed' | 'approved' | 'rejected' | 'suspended';
type Contact = { id: string; name: string; phone: string; email: string | null; role: string | null; is_primary: boolean; notes: string | null };
type Owner = {
  id: string; owner_key: string; name: string; legal_name: string | null; rc_number: string | null; address: string | null;
  website: string | null; notes: string | null; status: OwnerStatus; status_note: string | null; status_at: string | null;
  account_id: string | null; created_at: string;
  boards: number; stale: number; unpriced: number; boards_with_phone: number; contacts: Contact[];
  has_link: boolean; link_state: 'none' | 'active' | 'revoked' | 'expired'; expires_at: string | null; reminder_email: string | null;
  last_opened_at: string | null; last_saved_at: string | null; last_reminded_at: string | null; last_response_at: string | null;
  waiting_requests: number; oldest_waiting_at: string | null;
};
type OwnerBoard = { id: string; name: string; city: string | null; area: string | null; status: string; availability_checked_at: string | null; photo_urls: string[] | null; source: string | null };
type Rate = { board_id: string; rate_monthly: number; source: string; updated_at: string };
type HistoryItem = { event: string; at: string; board: string | null; detail: Record<string, unknown> };
type Unowned = { id: string; name: string; city: string | null; area: string | null; source: string | null; photo_urls: string[] | null };

type Filter = 'all' | 'contact' | 'silent' | 'review' | 'inactive';
const DAY = 86400000;

const STATUS_META: Record<OwnerStatus, { label: string; cls: string }> = {
  unreviewed: { label: 'To review', cls: 'is-grey' },
  approved: { label: 'Approved', cls: 'is-ok' },
  rejected: { label: 'Rejected', cls: 'is-bad' },
  suspended: { label: 'Suspended', cls: 'is-warn' },
};

const hasContact = (o: Owner) => o.contacts.some(c => c.phone?.trim() || c.email) || !!o.reminder_email;
const silent = (o: Owner) =>
  (o.waiting_requests > 0 && !!o.oldest_waiting_at && Date.now() - +new Date(o.oldest_waiting_at) > 2 * DAY) ||
  (o.has_link && (!o.last_response_at || Date.now() - +new Date(o.last_response_at) > 30 * DAY));
const inactive = (o: Owner) => o.boards === 0 || o.status === 'suspended' || o.status === 'rejected';
const naira = (n: number) => '₦' + Math.round(n).toLocaleString('en-NG');
const fmtDate = (d: string) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Suggests an owner for an import file name ("ABIOK inventory (3).pdf" → Abiok). Only a suggestion: an admin confirms it. */
function suggestOwner(source: string | null, owners: Owner[]): Owner | null {
  if (!source) return null;
  const s = ` ${norm(source)} `;
  let best: Owner | null = null;
  for (const o of owners) {
    const first = norm(o.name).split(' ').filter(w => w.length >= 4)[0];
    const full = norm(o.name);
    if ((full.length >= 4 && s.includes(` ${full} `)) || (first && s.includes(` ${first} `))) {
      if (!best || o.name.length > best.name.length) best = o;
    }
  }
  return best;
}

export default function OwnersPage() {
  const role = useDashboardRole();
  const [owners, setOwners] = useState<Owner[] | null>(null);
  const [unowned, setUnowned] = useState<Unowned[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  async function refresh() {
    const [o, u] = await Promise.all([
      supabase.rpc('admin_media_owners'),
      supabase.from('boards').select('id, name, city, area, source, photo_urls').is('media_owner_id', null).is('owner_id', null).neq('status', 'decommissioned').order('source').limit(1000),
    ]);
    if (o.error) {
      setError(o.error.message.includes('admin_media_owners') ? 'Run migration 063 in Supabase to switch this page on.' : o.error.message);
      setOwners([]);
      return;
    }
    setError(null);
    setOwners((o.data ?? []) as Owner[]);
    setUnowned(u.error ? [] : ((u.data ?? []) as Unowned[]));
  }

  useEffect(() => {
    if (role !== 'admin') return;
    (async () => { await refresh(); })();
  }, [role]);

  const list = owners ?? [];
  const counts = useMemo(() => ({
    all: list.length,
    contact: list.filter(o => !hasContact(o)).length,
    silent: list.filter(silent).length,
    review: list.filter(o => o.status === 'unreviewed').length,
    inactive: list.filter(inactive).length,
  }), [list]);
  const shown = useMemo(() => {
    const q = norm(query);
    return list.filter(o => {
      if (filter === 'contact' && hasContact(o)) return false;
      if (filter === 'silent' && !silent(o)) return false;
      if (filter === 'review' && o.status !== 'unreviewed') return false;
      if (filter === 'inactive' && !inactive(o)) return false;
      if (!q) return true;
      return norm([o.name, o.legal_name, ...o.contacts.map(c => `${c.name} ${c.email ?? ''}`)].filter(Boolean).join(' ')).includes(q);
    });
  }, [list, filter, query]);
  const open = list.find(o => o.id === openId) ?? null;

  if (role !== 'admin') return <div style={{ padding: 32, color: '#64748B', fontSize: '0.875rem' }}>Admins only.</div>;

  const FILTERS: { key: Filter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'contact', label: 'No contact' },
    { key: 'silent', label: 'Not responding' },
    { key: 'review', label: 'To review' },
    { key: 'inactive', label: 'Inactive' },
  ];

  return (
    <div className="mo">
      <style>{CSS}</style>
      <div className="mo-top">
        <div>
          <h1 className="mo-h1">Media owners</h1>
          <p className="mo-sub">Owner companies, their contact people and their private links. Only admins see this page; buyers never see owner contacts.</p>
        </div>
        <button type="button" className="mo-btn" onClick={() => { setAdding(true); setOpenId(null); }} data-add-owner>+ Add owner</button>
      </div>

      {error && <div className="mo-card mo-error">{error}</div>}

      <div className="mo-stats">
        <div><strong>{counts.all}</strong><span>owners</span></div>
        <div className={counts.contact ? 'is-warm' : ''}><strong>{counts.contact}</strong><span>with no phone or email</span></div>
        <div className={counts.silent ? 'is-hot' : ''}><strong>{counts.silent}</strong><span>not responding</span></div>
        <div className={unowned.length ? 'is-warm' : ''}><strong>{unowned.length}</strong><span>boards with no owner</span></div>
      </div>

      {adding && <NewOwner onCancel={() => setAdding(false)} onSaved={async id => { setAdding(false); await refresh(); setOpenId(id); }} />}

      <div className={`mo-split${open ? ' has-open' : ''}`}>
        <section className="mo-list" aria-label="Owners">
          <div className="mo-tools">
            <input className="mo-search" type="search" placeholder="Search owners or contacts" value={query} onChange={e => setQuery(e.target.value)} aria-label="Search owners" />
            <div className="mo-filters" role="tablist">
              {FILTERS.map(f => (
                <button key={f.key} type="button" role="tab" aria-selected={filter === f.key} className={filter === f.key ? 'is-on' : ''} onClick={() => setFilter(f.key)}>
                  {f.label}<i>{counts[f.key]}</i>
                </button>
              ))}
            </div>
          </div>
          {owners == null ? (
            <div className="mo-card mo-muted">Loading…</div>
          ) : shown.length === 0 ? (
            <div className="mo-card mo-muted">No owners match.</div>
          ) : (
            <div className="mo-card mo-rows">
              {shown.map(o => (
                <button key={o.id} type="button" className={`mo-row${openId === o.id ? ' is-open' : ''}`} onClick={() => { setOpenId(o.id); setAdding(false); }} data-owner-row>
                  <span className="mo-row-main">
                    <strong>{o.name}</strong>
                    <em>
                      {o.boards} board{o.boards !== 1 ? 's' : ''}
                      {' · '}{hasContact(o) ? `${o.contacts.length} contact${o.contacts.length !== 1 ? 's' : ''}` : <b className="is-warn-t">no contact</b>}
                      {' · '}{o.last_response_at ? `answered ${sinceText(o.last_response_at)}` : o.has_link ? 'never answered' : 'no link yet'}
                    </em>
                  </span>
                  <span className="mo-row-tags">
                    {o.waiting_requests > 0 && <i className="is-hot">{o.waiting_requests} waiting</i>}
                    <i className={STATUS_META[o.status].cls}>{STATUS_META[o.status].label}</i>
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>

        {open && (
          <section className="mo-detail" aria-label={`${open.name} details`}>
            <button type="button" className="mo-back" onClick={() => setOpenId(null)}>← All owners</button>
            <OwnerDetail key={open.id} o={open} all={list} onChanged={refresh} onGone={async () => { setOpenId(null); await refresh(); }} />
          </section>
        )}
      </div>

      {unowned.length > 0 && <UnownedBoards boards={unowned} owners={list} onChanged={refresh} />}
    </div>
  );
}

// ── New owner ──────────────────────────────────────────────────────────────

function NewOwner({ onCancel, onSaved }: { onCancel: () => void; onSaved: (id: string) => Promise<void> }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    const { data, error } = await supabase.rpc('admin_save_media_owner', { p_id: null, p: { name } });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    await onSaved(data as string);
  }
  return (
    <form className="mo-card mo-new" onSubmit={save}>
      <label className="mo-field" style={{ flex: 1 }}>
        <span>Owner company name</span>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Sule Outdoor Ltd" autoFocus maxLength={200} />
      </label>
      <button type="submit" className="mo-btn" disabled={busy || name.trim().length < 2}>{busy ? 'Saving…' : 'Create owner'}</button>
      <button type="button" className="mo-btn-2" onClick={onCancel}>Cancel</button>
      {err && <p className="mo-err">{err}</p>}
    </form>
  );
}

// ── One owner ──────────────────────────────────────────────────────────────

function OwnerDetail({ o, all, onChanged, onGone }: { o: Owner; all: Owner[]; onChanged: () => Promise<void>; onGone: () => Promise<void> }) {
  const [tab, setTab] = useState<'details' | 'boards' | 'history'>('details');
  return (
    <div className="mo-card mo-pane">
      <div className="mo-pane-head">
        <div style={{ minWidth: 0 }}>
          <h2>{o.name}</h2>
          <p className="mo-muted-s">
            {o.boards} live board{o.boards !== 1 ? 's' : ''} · {o.stale} not confirmed in {CHECK_EVERY_DAYS} days · {o.unpriced} without a current rate
          </p>
        </div>
        <StatusControl o={o} onChanged={onChanged} />
      </div>
      <div className="mo-tabs" role="tablist">
        {(['details', 'boards', 'history'] as const).map(t => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? 'is-on' : ''} onClick={() => setTab(t)}>
            {t === 'details' ? 'Details & link' : t === 'boards' ? `Boards (${o.boards})` : 'Response history'}
          </button>
        ))}
      </div>
      {tab === 'details' && (
        <>
          <LinkPanel o={o} onChanged={onChanged} />
          <Contacts o={o} onChanged={onChanged} />
          <CompanyForm o={o} onChanged={onChanged} />
          <MergePanel o={o} all={all} onGone={onGone} />
        </>
      )}
      {tab === 'boards' && <OwnerBoards o={o} onChanged={onChanged} />}
      {tab === 'history' && <History o={o} />}
    </div>
  );
}

function StatusControl({ o, onChanged }: { o: Owner; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function set(next: OwnerStatus) {
    if (next === o.status) return;
    let note: string | null = null;
    if (next === 'suspended' || next === 'rejected') {
      note = window.prompt(`Why is ${o.name} ${next}? Their private link stops working and they get no reminders.`, '');
      if (note === null) return;
    }
    setBusy(true); setErr(null);
    const { error } = await supabase.rpc('admin_set_media_owner_status', { p_id: o.id, p_status: next, p_note: note });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    await onChanged();
  }
  return (
    <div className="mo-status">
      <label>
        <span className="mo-sr">Owner status</span>
        <select value={o.status} onChange={e => set(e.target.value as OwnerStatus)} disabled={busy} className={`mo-select ${STATUS_META[o.status].cls}`} data-owner-status>
          {(Object.keys(STATUS_META) as OwnerStatus[]).map(s => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
        </select>
      </label>
      {o.status_note && <em title={o.status_note}>{o.status_note}</em>}
      {err && <p className="mo-err">{err}</p>}
    </div>
  );
}

function LinkPanel({ o, onChanged }: { o: Owner; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [email, setEmail] = useState(o.reminder_email ?? '');
  const [expiry, setExpiry] = useState(o.expires_at ? o.expires_at.slice(0, 10) : '');
  const [now] = useState(() => Date.now());
  const primary = o.contacts.find(c => c.is_primary) ?? o.contacts.find(c => c.phone?.trim()) ?? null;
  const phone = waNumber(primary?.phone);
  const blocked = o.status === 'suspended' || o.status === 'rejected';

  async function token(fresh: boolean): Promise<string | null> {
    setBusy(true); setErr(null);
    const { data, error } = await supabase.rpc('admin_owner_link', { p_owner_key: o.owner_key, p_owner_name: o.name, p_new: fresh });
    setBusy(false);
    if (error) { setErr(error.message); return null; }
    return data as string;
  }
  async function copy() {
    const t = await token(o.link_state !== 'active' && o.link_state !== 'none');
    if (!t) return;
    try { await navigator.clipboard.writeText(ownerLinkUrl(t)); setNote('Link copied ✓'); } catch { setNote(ownerLinkUrl(t)); }
    await onChanged();
  }
  async function whatsapp() {
    const w = window.open('', '_blank');
    const t = await token(o.link_state === 'revoked' || o.link_state === 'expired');
    if (!t) { w?.close(); return; }
    const text = ownerLinkMessage({ contactName: primary?.name || null, boards: o.boards, waiting: o.waiting_requests, url: ownerLinkUrl(t) });
    const url = `https://wa.me/${phone ?? ''}?text=${encodeURIComponent(text)}`;
    if (w) w.location.href = url; else window.location.href = url;
    await onChanged();
  }
  async function replace() {
    if (!window.confirm(`Make a new link for ${o.name}? The old link stops working straight away.`)) return;
    if (await token(true)) { setNote('New link made. Send it to the owner.'); await onChanged(); }
  }
  async function revoke() {
    if (!window.confirm(`Turn off ${o.name}'s link? They can't open it until you make a new one.`)) return;
    setBusy(true); setErr(null);
    const { error } = await supabase.rpc('admin_revoke_owner_link', { p_owner_key: o.owner_key });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    await onChanged();
  }
  async function saveExpiry(value: string) {
    setBusy(true); setErr(null);
    const { error } = await supabase.rpc('admin_set_owner_link_expiry', { p_owner_key: o.owner_key, p_expires: value || null });
    setBusy(false);
    if (error) { setErr(error.message); setExpiry(o.expires_at ? o.expires_at.slice(0, 10) : ''); return; }
    await onChanged();
  }
  async function saveEmail(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    const { error } = await supabase.rpc('admin_set_owner_email', { p_owner_key: o.owner_key, p_owner_name: o.name, p_email: email.trim() || null });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setNote('Reminder email saved ✓');
    await onChanged();
  }
  async function emailNow() {
    setBusy(true); setErr(null); setNote(null);
    const res = await authedFetch('/api/owner-reminders', { method: 'POST', body: JSON.stringify({ ownerKey: o.owner_key }) });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setErr(json.error ?? 'Could not send the email'); return; }
    setNote('Reminder emailed ✓');
    await onChanged();
  }

  const stateText = {
    none: 'No link yet',
    active: o.expires_at ? `Active until ${fmtDate(o.expires_at)}` : 'Active',
    revoked: 'Turned off',
    expired: 'Expired',
  }[o.link_state];

  return (
    <div className="mo-block" data-link-panel>
      <h3>Private link</h3>
      <p className="mo-hint">The owner uses it (no login) to confirm which boards are free, send current rates, answer buyer requests and report corrections. It only ever shows this owner&apos;s boards.</p>
      {blocked && <p className="mo-warnbox">This owner is {o.status}: the link doesn&apos;t open and no reminders go out.</p>}
      <div className="mo-kv">
        <div><dt>Status</dt><dd><b className={o.link_state === 'active' ? 'is-ok-t' : o.link_state === 'none' ? '' : 'is-warn-t'}>{stateText}</b></dd></div>
        <div><dt>Last opened</dt><dd>{o.last_opened_at ? sinceText(o.last_opened_at) : 'Never'}</dd></div>
        <div><dt>Last answer</dt><dd>{o.last_response_at ? sinceText(o.last_response_at) : 'Never'}</dd></div>
        <div><dt>Last reminder</dt><dd>{o.last_reminded_at ? sinceText(o.last_reminded_at) : 'Never'}</dd></div>
      </div>
      <div className="mo-actions">
        <button type="button" className="mo-btn-wa" onClick={whatsapp} disabled={busy || blocked} title={phone ? `WhatsApp ${primary?.phone}` : 'No phone saved: choose the contact in WhatsApp'}>Send on WhatsApp</button>
        <button type="button" className="mo-btn-2" onClick={copy} disabled={busy || blocked}>Copy link</button>
        {o.has_link && <button type="button" className="mo-btn-2" onClick={replace} disabled={busy || blocked}>Make new link</button>}
        {o.link_state === 'active' && <button type="button" className="mo-btn-2 is-danger" onClick={revoke} disabled={busy}>Turn off link</button>}
      </div>
      {o.has_link && o.link_state !== 'revoked' && (
        <label className="mo-inline">
          <span>Link expires</span>
          <input type="date" value={expiry} min={new Date(now + DAY).toISOString().slice(0, 10)} onChange={e => setExpiry(e.target.value)} disabled={busy} />
          <button type="button" className="mo-btn-2" disabled={busy || expiry === (o.expires_at ? o.expires_at.slice(0, 10) : '')} onClick={() => saveExpiry(expiry)}>Save</button>
          {o.expires_at && <button type="button" className="mo-link" disabled={busy} onClick={() => { setExpiry(''); saveExpiry(''); }}>No expiry</button>}
        </label>
      )}
      <form className="mo-inline" onSubmit={saveEmail}>
        <span>Weekly reminder email</span>
        <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="owner@company.com" aria-label="Weekly reminder email" />
        <button type="submit" className="mo-btn-2" disabled={busy || email.trim() === (o.reminder_email ?? '')}>Save</button>
        {o.reminder_email && <button type="button" className="mo-link" onClick={emailNow} disabled={busy || blocked}>Email now</button>}
      </form>
      {note && <p className="mo-ok">{note}</p>}
      {err && <p className="mo-err">{err}</p>}
    </div>
  );
}

function Contacts({ o, onChanged }: { o: Owner; onChanged: () => Promise<void> }) {
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  return (
    <div className="mo-block" data-contacts>
      <div className="mo-block-head">
        <h3>Contact people</h3>
        {editing !== 'new' && <button type="button" className="mo-link" onClick={() => setEditing('new')}>+ Add contact</button>}
      </div>
      {o.contacts.length === 0 && editing !== 'new' && (
        <p className="mo-warnbox">No contact saved. {o.boards_with_phone > 0 ? `${o.boards_with_phone} of their boards have a phone number from the import; add the right person here.` : 'Find out who sells these boards before sending buyers to them.'}</p>
      )}
      <ul className="mo-contacts">
        {o.contacts.map(c => editing === c.id
          ? <li key={c.id}><ContactForm ownerId={o.id} c={c} onDone={async () => { setEditing(null); await onChanged(); }} onCancel={() => setEditing(null)} /></li>
          : (
            <li key={c.id} className="mo-contact">
              <span>
                <strong>{c.name || 'No name'}{c.is_primary && <i className="mo-primary">Main</i>}</strong>
                <em>{[c.role, c.phone, c.email].filter(Boolean).join(' · ') || 'No phone or email'}</em>
                {c.notes && <em>{c.notes}</em>}
              </span>
              <button type="button" className="mo-link" onClick={() => setEditing(c.id)}>Edit</button>
            </li>
          ))}
        {editing === 'new' && <li><ContactForm ownerId={o.id} c={null} onDone={async () => { setEditing(null); await onChanged(); }} onCancel={() => setEditing(null)} /></li>}
      </ul>
    </div>
  );
}

function ContactForm({ ownerId, c, onDone, onCancel }: { ownerId: string; c: Contact | null; onDone: () => Promise<void>; onCancel: () => void }) {
  const [f, setF] = useState({ name: c?.name ?? '', phone: c?.phone ?? '', email: c?.email ?? '', role: c?.role ?? '', notes: c?.notes ?? '', is_primary: c?.is_primary ?? false });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function save(del = false) {
    if (del && !window.confirm('Delete this contact?')) return;
    setBusy(true); setErr(null);
    const { error } = await supabase.rpc('admin_save_owner_contact', { p_owner_id: ownerId, p_id: c?.id ?? null, p: f, p_delete: del });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    await onDone();
  }
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF(v => ({ ...v, [k]: k === 'is_primary' ? e.target.checked : e.target.value }));
  return (
    <form className="mo-contact-form" onSubmit={e => { e.preventDefault(); save(); }}>
      <label className="mo-field"><span>Name</span><input value={f.name} onChange={set('name')} maxLength={120} autoFocus /></label>
      <label className="mo-field"><span>Role</span><input value={f.role} onChange={set('role')} maxLength={80} placeholder="e.g. Sales manager" /></label>
      <label className="mo-field"><span>Phone</span><input value={f.phone} onChange={set('phone')} maxLength={40} inputMode="tel" placeholder="0803 000 0000" /></label>
      <label className="mo-field"><span>Email</span><input type="email" value={f.email} onChange={set('email')} maxLength={200} /></label>
      <label className="mo-field mo-wide"><span>Notes</span><input value={f.notes} onChange={set('notes')} maxLength={500} placeholder="e.g. Prefers WhatsApp, mornings" /></label>
      <label className="mo-check mo-wide"><input type="checkbox" checked={f.is_primary} onChange={set('is_primary')} /> Main contact (used for WhatsApp)</label>
      <div className="mo-actions mo-wide">
        <button type="submit" className="mo-btn" disabled={busy}>{busy ? 'Saving…' : 'Save contact'}</button>
        <button type="button" className="mo-btn-2" onClick={onCancel}>Cancel</button>
        {c && <button type="button" className="mo-btn-2 is-danger" onClick={() => save(true)} disabled={busy}>Delete</button>}
      </div>
      {err && <p className="mo-err mo-wide">{err}</p>}
    </form>
  );
}

function CompanyForm({ o, onChanged }: { o: Owner; onChanged: () => Promise<void> }) {
  const init = { name: o.name, legal_name: o.legal_name ?? '', rc_number: o.rc_number ?? '', address: o.address ?? '', website: o.website ?? '', notes: o.notes ?? '' };
  const [f, setF] = useState(init);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const dirty = JSON.stringify(f) !== JSON.stringify(init);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null); setOk(false);
    const { error } = await supabase.rpc('admin_save_media_owner', { p_id: o.id, p: f });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setOk(true);
    await onChanged();
  }
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => { setOk(false); setF(v => ({ ...v, [k]: e.target.value })); };
  return (
    <form className="mo-block mo-company" onSubmit={save} data-company-form>
      <h3>Company</h3>
      <p className="mo-hint mo-wide">Only what the owner has told us. Leave blank anything not confirmed.</p>
      <label className="mo-field"><span>Name we use</span><input value={f.name} onChange={set('name')} maxLength={200} required /></label>
      <label className="mo-field"><span>Registered name</span><input value={f.legal_name} onChange={set('legal_name')} maxLength={200} /></label>
      <label className="mo-field"><span>RC number</span><input value={f.rc_number} onChange={set('rc_number')} maxLength={40} /></label>
      <label className="mo-field"><span>Website</span><input value={f.website} onChange={set('website')} maxLength={200} /></label>
      <label className="mo-field mo-wide"><span>Office address</span><input value={f.address} onChange={set('address')} maxLength={300} /></label>
      <label className="mo-field mo-wide"><span>Notes (team only)</span><textarea value={f.notes} onChange={set('notes')} maxLength={2000} rows={3} /></label>
      <div className="mo-actions mo-wide">
        <button type="submit" className="mo-btn" disabled={busy || !dirty}>{busy ? 'Saving…' : 'Save company details'}</button>
        {ok && <span className="mo-ok">Saved ✓</span>}
      </div>
      {err && <p className="mo-err mo-wide">{err}</p>}
    </form>
  );
}

function MergePanel({ o, all, onGone }: { o: Owner; all: Owner[]; onGone: () => Promise<void> }) {
  const [into, setInto] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const others = all.filter(x => x.id !== o.id).sort((a, b) => a.name.localeCompare(b.name));
  // Likely duplicates first: names that share their first word.
  const first = norm(o.name).split(' ')[0];
  const likely = others.filter(x => first.length >= 3 && norm(x.name).split(' ')[0] === first);
  async function merge() {
    const keep = others.find(x => x.id === into);
    if (!keep) return;
    if (!window.confirm(`Move everything from “${o.name}” into “${keep.name}” and delete “${o.name}”?\n\nBoards, contacts, answers and history move over. This can't be undone.`)) return;
    setBusy(true); setErr(null);
    const { error } = await supabase.rpc('admin_merge_media_owners', { p_keep: keep.id, p_drop: o.id });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    await onGone();
  }
  return (
    <div className="mo-block" data-merge>
      <h3>Same company listed twice?</h3>
      {likely.length > 0 && <p className="mo-hint">Possible duplicate: {likely.map(x => x.name).join(', ')}</p>}
      <div className="mo-inline">
        <select value={into} onChange={e => setInto(e.target.value)} aria-label="Owner to merge into" className="mo-select">
          <option value="">Merge into…</option>
          {likely.length > 0 && <optgroup label="Possible duplicates">{likely.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</optgroup>}
          <optgroup label="All owners">{others.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</optgroup>
        </select>
        <button type="button" className="mo-btn-2" disabled={!into || busy} onClick={merge}>{busy ? 'Merging…' : 'Merge'}</button>
      </div>
      {err && <p className="mo-err">{err}</p>}
    </div>
  );
}

function OwnerBoards({ o, onChanged }: { o: Owner; onChanged: () => Promise<void> }) {
  const [boards, setBoards] = useState<OwnerBoard[] | null>(null);
  const [rates, setRates] = useState<Record<string, Rate>>({});
  const [now] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    const { data, error } = await supabase.from('boards').select('id, name, city, area, status, availability_checked_at, photo_urls, source').eq('media_owner_id', o.id).order('name');
    if (error) { setErr(error.message); setBoards([]); return; }
    const list = (data ?? []) as OwnerBoard[];
    setBoards(list);
    if (list.length) {
      const r = await supabase.from('board_owner_rates').select('board_id, rate_monthly, source, updated_at').in('board_id', list.map(b => b.id));
      setRates(Object.fromEntries(((r.data ?? []) as Rate[]).map(x => [x.board_id, x])));
    }
  }
  useEffect(() => { (async () => { await load(); })(); }, [o.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function setRate(b: OwnerBoard) {
    const cur = rates[b.id]?.rate_monthly;
    const v = window.prompt(`Owner's current monthly rate for ${b.name} (₦). Leave empty to clear.`, cur ? String(cur) : '');
    if (v === null) return;
    const n = v.replace(/[^\d.]/g, '');
    setBusy(true); setErr(null);
    const { error } = await supabase.rpc('admin_set_board_rate', { p_board_id: b.id, p_rate: n ? Number(n) : null, p_note: null });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    await load(); await onChanged();
  }
  async function unassign(b: OwnerBoard) {
    if (!window.confirm(`Take ${b.name} off ${o.name}? It will show as "owner unknown" until you assign it again.`)) return;
    setBusy(true); setErr(null);
    const { error } = await supabase.rpc('admin_assign_owner', { p_board_ids: [b.id], p_owner_id: null });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    await load(); await onChanged();
  }

  if (boards == null) return <p className="mo-muted">Loading boards…</p>;
  return (
    <div className="mo-block" data-owner-boards>
      <p className="mo-hint">Rates here are the owner&apos;s own figures, for our team only. Buyers never see them. To add boards to this owner, select them in the inventory and choose “Assign owner”.</p>
      {boards.length === 0 && <p className="mo-muted">No boards yet.</p>}
      <ul className="mo-boards">
        {boards.map(b => {
          const r = rates[b.id];
          const fresh = b.availability_checked_at && now - +new Date(b.availability_checked_at) < CHECK_EVERY_DAYS * DAY;
          return (
            <li key={b.id} className={b.status === 'decommissioned' ? 'is-archived' : ''}>
              <span className="mo-thumb">{/* eslint-disable-next-line @next/next/no-img-element */}{b.photo_urls?.[0] ? <img src={b.photo_urls[0]} alt="" /> : null}</span>
              <span className="mo-board-main">
                <strong>{b.name}</strong>
                <em>{[b.area, b.city].filter(Boolean).join(', ') || 'No area'} · {b.status === 'decommissioned' ? 'Archived' : b.status}{' · '}
                  {fresh ? <b className="is-ok-t">confirmed {sinceText(b.availability_checked_at)}</b> : <b className="is-warn-t">{b.availability_checked_at ? `confirmed ${sinceText(b.availability_checked_at)}` : 'never confirmed'}</b>}
                </em>
              </span>
              <span className="mo-board-rate">
                {r ? <>{naira(r.rate_monthly)}<small>/mo · {r.source === 'owner_link' ? 'from owner' : 'typed by team'} {sinceText(r.updated_at)}</small></> : <small>No current rate</small>}
              </span>
              <span className="mo-board-act">
                <button type="button" className="mo-link" disabled={busy} onClick={() => setRate(b)}>Rate</button>
                <button type="button" className="mo-link is-danger" disabled={busy} onClick={() => unassign(b)}>Remove</button>
              </span>
            </li>
          );
        })}
      </ul>
      {err && <p className="mo-err">{err}</p>}
    </div>
  );
}

const EVENT_TEXT: Record<string, string> = {
  link_created: 'Link made', link_replaced: 'New link made (old one stopped)', link_revoked: 'Link turned off', link_expiry: 'Link expiry changed',
  opened: 'Opened their link', availability: 'Confirmed a board', replied: 'Answered a buyer request', reply_sent: 'Answer sent to buyer',
  reply_dismissed: 'Answer dismissed', correction: 'Sent a correction', correction_applied: 'Correction applied', correction_dismissed: 'Correction dismissed',
  location_report: 'Reported a wrong location', rate: 'Sent a current rate', reminder_sent: 'Reminder emailed', reminder_failed: 'Reminder failed', status: 'Status changed',
};
const OWNER_DID = new Set(['opened', 'availability', 'replied', 'correction', 'location_report', 'rate']);

function History({ o }: { o: Owner }) {
  const [items, setItems] = useState<HistoryItem[] | null>(null);
  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.rpc('admin_owner_history', { p_owner_id: o.id, p_limit: 200 });
      setItems(error ? [] : ((data ?? []) as HistoryItem[]));
    })();
  }, [o.id]);
  if (items == null) return <p className="mo-muted">Loading…</p>;
  if (!items.length) return <p className="mo-muted">Nothing yet. Every link open, answer, confirmation, correction and reminder is recorded here from now on.</p>;
  const detail = (x: HistoryItem) => {
    const d = x.detail ?? {};
    if (x.event === 'availability') return [d.status, d.available_from ? `free from ${fmtDate(String(d.available_from))}` : null].filter(Boolean).join(', ');
    if (x.event === 'replied') return d.available === false ? 'not available' : d.available ? 'available' : '';
    if (x.event === 'status') return d.merged ? `merged in “${d.merged}”` : [d.status, d.note].filter(Boolean).join(': ');
    if (x.event === 'reminder_failed') return String(d.error ?? '');
    if (x.event === 'location_report') return String(d.note ?? '');
    return '';
  };
  return (
    <ol className="mo-history" data-history>
      {items.map((x, i) => (
        <li key={i} className={OWNER_DID.has(x.event) ? 'is-owner' : x.event === 'reminder_failed' ? 'is-bad' : ''}>
          <time dateTime={x.at}>{new Date(x.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</time>
          <span><strong>{EVENT_TEXT[x.event] ?? x.event}</strong>{x.board ? ` · ${x.board}` : ''}{detail(x) ? <em> · {detail(x)}</em> : null}</span>
        </li>
      ))}
    </ol>
  );
}

// ── Boards with no owner ───────────────────────────────────────────────────

function UnownedBoards({ boards, owners, onChanged }: { boards: Unowned[]; owners: Owner[]; onChanged: () => Promise<void> }) {
  const groups = useMemo(() => {
    const m = new Map<string, Unowned[]>();
    for (const b of boards) { const k = b.source || 'Added by hand'; m.set(k, [...(m.get(k) ?? []), b]); }
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [boards]);
  return (
    <section className="mo-sec" data-unowned>
      <h2>Boards with no owner</h2>
      <p className="mo-hint">Grouped by the file they were imported from. A suggested owner comes only from the file name: check it before assigning.</p>
      {groups.map(([source, list]) => <UnownedGroup key={source} source={source} list={list} owners={owners} onChanged={onChanged} />)}
    </section>
  );
}

function UnownedGroup({ source, list, owners, onChanged }: { source: string; list: Unowned[]; owners: Owner[]; onChanged: () => Promise<void> }) {
  const suggestion = suggestOwner(source, owners);
  const [pick, setPick] = useState('');
  const [openList, setOpenList] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const sorted = [...owners].sort((a, b) => a.name.localeCompare(b.name));
  async function assign(id: string) {
    const o = owners.find(x => x.id === id);
    if (!o || !window.confirm(`Assign all ${list.length} boards from “${source}” to ${o.name}?`)) return;
    setBusy(true); setErr(null);
    const { error } = await supabase.rpc('admin_assign_owner', { p_board_ids: list.map(b => b.id), p_owner_id: id });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    await onChanged();
  }
  return (
    <div className="mo-card mo-group">
      <div className="mo-group-head">
        <span style={{ minWidth: 0 }}>
          <strong title={source}>{source}</strong>
          <em>{list.length} board{list.length !== 1 ? 's' : ''} · {[...new Set(list.map(b => b.city).filter(Boolean))].slice(0, 3).join(', ')}
            {' · '}<button type="button" className="mo-link" onClick={() => setOpenList(v => !v)}>{openList ? 'Hide boards' : 'Show boards'}</button></em>
        </span>
        <span className="mo-actions">
          {suggestion && <button type="button" className="mo-btn" disabled={busy} onClick={() => assign(suggestion.id)} data-suggested>Assign to {suggestion.name}?</button>}
          <select className="mo-select" value={pick} onChange={e => setPick(e.target.value)} aria-label={`Owner for ${source}`}>
            <option value="">{suggestion ? 'Someone else…' : 'Choose owner…'}</option>
            {sorted.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
          <button type="button" className="mo-btn-2" disabled={!pick || busy} onClick={() => assign(pick)}>Assign</button>
        </span>
      </div>
      {openList && (
        <ul className="mo-mini">
          {list.map(b => <li key={b.id}>{b.name}<em>{[b.area, b.city].filter(Boolean).join(', ')}</em></li>)}
        </ul>
      )}
      <p className="mo-hint" style={{ margin: '6px 0 0' }}>Different owners in one file? Assign them one by one from the <Link href="/dashboard/admin?tab=inventory">inventory</Link>.</p>
      {err && <p className="mo-err">{err}</p>}
    </div>
  );
}

const CSS = `
.mo { max-width: 1180px; margin: 0 auto; padding: 8px 0 48px; color: #0F172A; }
.mo-top { display: flex; justify-content: space-between; gap: 0 16px; align-items: flex-start; flex-wrap: wrap; margin-bottom: 18px; }
.mo-h1 { font-size: 1.375rem; font-weight: 800; margin: 0 0 4px; letter-spacing: -.02em; }
.mo-sub { font-size: .875rem; color: #64748B; margin: 0 0 12px; max-width: 640px; line-height: 1.55; }
.mo-card { background: #fff; border: 1px solid #E2E8F0; border-radius: 14px; padding: 14px 16px; }
.mo-error { border-color: #FECACA; background: #FEF2F2; color: #B91C1C; font-size: .8125rem; margin-bottom: 14px; }
.mo-muted { color: #94A3B8; font-size: .8125rem; }
.mo-muted-s { color: #64748B; font-size: .8125rem; margin: 2px 0 0; }
.mo-stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin-bottom: 18px; }
.mo-stats div { background: #fff; border: 1px solid #E2E8F0; border-radius: 14px; padding: 12px 16px; display: flex; flex-direction: column; gap: 2px; }
.mo-stats strong { font-size: 1.5rem; font-weight: 800; letter-spacing: -.02em; color: #334155; font-variant-numeric: tabular-nums; }
.mo-stats span { font-size: .8125rem; color: #64748B; }
.mo-stats .is-hot { border-color: #FECDD3; background: #FFF1F2; } .mo-stats .is-hot strong { color: #E11D48; }
.mo-stats .is-warm { border-color: #FDE68A; background: #FFFBEB; } .mo-stats .is-warm strong { color: #B45309; }
.mo-new { display: flex; gap: 10px; align-items: flex-end; flex-wrap: wrap; margin-bottom: 16px; }
.mo-split { display: grid; grid-template-columns: minmax(0, 1fr); gap: 16px; align-items: start; }
.mo-split.has-open { grid-template-columns: minmax(0, 380px) minmax(0, 1fr); }
.mo-tools { display: flex; flex-direction: column; gap: 8px; margin-bottom: 10px; }
.mo-search { height: 38px; border-radius: 10px; border: 1px solid #CBD5E1; padding: 0 12px; font-family: inherit; font-size: .875rem; }
.mo-filters { display: flex; gap: 6px; flex-wrap: wrap; }
.mo-filters button { height: 30px; border-radius: 999px; border: 1px solid #E2E8F0; background: #fff; padding: 0 11px; font-family: inherit; font-size: .75rem; font-weight: 600; color: #475569; cursor: pointer; display: inline-flex; gap: 6px; align-items: center; }
.mo-filters button i { font-style: normal; color: #94A3B8; font-variant-numeric: tabular-nums; }
.mo-filters button.is-on { background: #1B4F8A; border-color: #1B4F8A; color: #fff; } .mo-filters button.is-on i { color: #BFD3EA; }
.mo-rows { padding: 0; overflow: hidden; }
.mo-row { display: flex; width: 100%; text-align: left; justify-content: space-between; gap: 10px; align-items: center; padding: 11px 14px; background: #fff; border: none; border-top: 1px solid #F1F5F9; font-family: inherit; cursor: pointer; }
.mo-row:first-child { border-top: none; }
.mo-row:hover { background: #F8FAFC; } .mo-row.is-open { background: #EFF5FC; box-shadow: inset 3px 0 0 #1B4F8A; }
.mo-row-main { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.mo-row-main strong { font-size: .875rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mo-row-main em { font-style: normal; font-size: .75rem; color: #64748B; }
.mo-row-tags { display: flex; gap: 4px; flex-shrink: 0; }
.mo-row-tags i, .mo-primary { font-style: normal; font-size: .6875rem; font-weight: 700; padding: 2px 8px; border-radius: 999px; white-space: nowrap; }
.is-grey { background: #F1F5F9; color: #475569; } .is-ok { background: #DCFCE7; color: #166534; } .is-bad { background: #FEE2E2; color: #B91C1C; }
.is-warn { background: #FEF3C7; color: #92400E; } .mo-row-tags .is-hot { background: #FFE4E6; color: #BE123C; }
.is-warn-t { color: #B45309; font-weight: 600; } .is-ok-t { color: #047857; font-weight: 600; }
.mo-primary { background: #DBEAFE; color: #1D4ED8; margin-left: 6px; }
.mo-back { display: none; background: none; border: none; font-family: inherit; font-weight: 600; color: #1B4F8A; padding: 0 0 10px; cursor: pointer; font-size: .875rem; }
.mo-pane { padding: 0; overflow: hidden; }
.mo-pane-head { display: flex; justify-content: space-between; gap: 12px; padding: 16px 18px 12px; align-items: flex-start; flex-wrap: wrap; }
.mo-pane-head h2 { font-size: 1.125rem; font-weight: 800; margin: 0; letter-spacing: -.01em; overflow-wrap: anywhere; }
.mo-status { display: flex; flex-direction: column; align-items: flex-end; gap: 3px; max-width: 240px; }
.mo-status em { font-style: normal; font-size: .6875rem; color: #64748B; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; }
.mo-select { height: 34px; border-radius: 9px; border: 1px solid #CBD5E1; padding: 0 8px; font-family: inherit; font-size: .8125rem; font-weight: 600; background-color: #fff; color: #0F172A; max-width: 100%; }
.mo-select.is-ok { background-color: #F0FDF4; border-color: #BBF7D0; } .mo-select.is-bad { background-color: #FEF2F2; border-color: #FECACA; } .mo-select.is-warn { background-color: #FFFBEB; border-color: #FDE68A; }
.mo-tabs { display: flex; gap: 2px; padding: 0 12px; border-bottom: 1px solid #E2E8F0; overflow-x: auto; }
.mo-tabs button { background: none; border: none; border-bottom: 2px solid transparent; padding: 9px 10px; font-family: inherit; font-size: .8125rem; font-weight: 600; color: #64748B; cursor: pointer; white-space: nowrap; }
.mo-tabs button.is-on { color: #1B4F8A; border-bottom-color: #1B4F8A; }
.mo-block { padding: 16px 18px; border-top: 1px solid #F1F5F9; }
.mo-tabs + .mo-block { border-top: none; }
.mo-block h3 { font-size: .875rem; font-weight: 800; margin: 0 0 4px; }
.mo-block-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.mo-hint { font-size: .75rem; color: #64748B; margin: 0 0 10px; line-height: 1.5; }
.mo-warnbox { font-size: .8125rem; color: #92400E; background: #FFFBEB; border: 1px solid #FDE68A; border-radius: 10px; padding: 8px 10px; margin: 6px 0 10px; }
.mo-kv { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; margin: 0 0 12px; }
.mo-kv div { background: #F8FAFC; border-radius: 10px; padding: 8px 10px; min-width: 0; }
.mo-kv dt { font-size: .6875rem; color: #64748B; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; }
.mo-kv dd { margin: 2px 0 0; font-size: .8125rem; }
.mo-actions { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.mo-inline { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-top: 10px; font-size: .75rem; color: #475569; font-weight: 600; }
.mo-inline > span { min-width: 140px; }
.mo-inline input { height: 34px; border-radius: 9px; border: 1px solid #CBD5E1; padding: 0 10px; font-family: inherit; font-size: .8125rem; flex: 1 1 180px; min-width: 0; max-width: 280px; }
.mo-inline input[type=date] { flex: 0 1 170px; }
.mo-btn, .mo-btn-2, .mo-btn-wa { height: 34px; border-radius: 9px; font-family: inherit; font-size: .8125rem; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; padding: 0 12px; white-space: nowrap; }
.mo-btn { background: #1B4F8A; color: #fff; border: none; }
.mo-btn-wa { background: #16A34A; color: #fff; border: none; }
.mo-btn-2 { background: #fff; color: #334155; border: 1px solid #E2E8F0; }
.mo-btn-2.is-danger { color: #B91C1C; border-color: #FECACA; }
.mo-btn:disabled, .mo-btn-2:disabled, .mo-btn-wa:disabled { opacity: .55; cursor: default; }
.mo-link { background: none; border: none; padding: 0; font-family: inherit; font-size: .75rem; font-weight: 700; color: #1B4F8A; cursor: pointer; }
.mo-link.is-danger { color: #B91C1C; } .mo-link:disabled { opacity: .5; cursor: default; }
.mo-err { font-size: .75rem; color: #B91C1C; margin: 8px 0 0; width: 100%; }
.mo-ok { font-size: .75rem; color: #047857; font-weight: 600; margin: 8px 0 0; }
.mo-field { display: flex; flex-direction: column; gap: 4px; font-size: .6875rem; font-weight: 600; color: #64748B; text-transform: uppercase; letter-spacing: .04em; min-width: 0; }
.mo-field input, .mo-field textarea { height: 36px; border-radius: 9px; border: 1px solid #CBD5E1; padding: 0 10px; font-family: inherit; font-size: .875rem; color: #0F172A; text-transform: none; letter-spacing: 0; font-weight: 500; }
.mo-field textarea { height: auto; padding: 8px 10px; resize: vertical; }
.mo-company, .mo-contact-form { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.mo-company h3 { grid-column: 1 / -1; margin: 0; }
.mo-wide { grid-column: 1 / -1; }
.mo-check { display: flex; gap: 8px; align-items: center; font-size: .8125rem; color: #334155; }
.mo-contacts { list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.mo-contact { display: flex; justify-content: space-between; gap: 10px; align-items: flex-start; background: #F8FAFC; border-radius: 10px; padding: 9px 12px; }
.mo-contact > span { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.mo-contact strong { font-size: .8125rem; } .mo-contact em { font-style: normal; font-size: .75rem; color: #64748B; overflow-wrap: anywhere; }
.mo-contact-form { background: #F8FAFC; border-radius: 12px; padding: 12px; }
.mo-boards { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
.mo-boards li { display: grid; grid-template-columns: 44px minmax(0, 1fr) auto auto; gap: 10px; align-items: center; padding: 8px 0; border-top: 1px solid #F1F5F9; }
.mo-boards li:first-child { border-top: none; } .mo-boards li.is-archived { opacity: .55; }
.mo-thumb { width: 44px; height: 44px; border-radius: 8px; background: #EEF2F7; overflow: hidden; }
.mo-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.mo-board-main { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.mo-board-main strong { font-size: .8125rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mo-board-main em { font-style: normal; font-size: .75rem; color: #64748B; }
.mo-board-rate { font-size: .8125rem; font-weight: 700; text-align: right; display: flex; flex-direction: column; font-variant-numeric: tabular-nums; }
.mo-board-rate small { font-size: .6875rem; color: #94A3B8; font-weight: 500; }
.mo-board-act { display: flex; gap: 10px; }
.mo-history { list-style: none; margin: 0; padding: 14px 18px; display: flex; flex-direction: column; gap: 0; }
.mo-history li { display: grid; grid-template-columns: 112px minmax(0, 1fr); gap: 10px; font-size: .8125rem; padding: 7px 0 7px 12px; border-left: 2px solid #E2E8F0; }
.mo-history li.is-owner { border-left-color: #1B4F8A; } .mo-history li.is-bad { border-left-color: #DC2626; }
.mo-history time { color: #94A3B8; font-size: .75rem; font-variant-numeric: tabular-nums; }
.mo-history em { font-style: normal; color: #64748B; }
.mo-sec { margin-top: 28px; }
.mo-sec h2 { font-size: 1rem; font-weight: 800; margin: 0 0 4px; }
.mo-group { margin-top: 10px; }
.mo-group-head { display: flex; justify-content: space-between; gap: 12px; align-items: center; flex-wrap: wrap; }
.mo-group-head > span:first-child { display: flex; flex-direction: column; gap: 2px; }
.mo-group-head strong { font-size: .875rem; overflow-wrap: anywhere; }
.mo-group-head em { font-style: normal; font-size: .75rem; color: #64748B; }
.mo-mini { list-style: none; margin: 10px 0 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 4px 16px; font-size: .75rem; }
.mo-mini li { display: flex; flex-direction: column; padding: 4px 0; border-top: 1px solid #F1F5F9; }
.mo-mini em { font-style: normal; color: #94A3B8; }
.mo-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
@media (max-width: 900px) {
  .mo-split.has-open { grid-template-columns: minmax(0, 1fr); }
  .mo-split.has-open .mo-list { display: none; }
  .mo-back { display: inline-block; }
  .mo-kv { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 640px) {
  .mo-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .mo-company, .mo-contact-form { grid-template-columns: minmax(0, 1fr); }
  .mo-status { align-items: flex-start; }
  .mo-boards li { grid-template-columns: 44px minmax(0, 1fr); }
  .mo-board-rate { grid-column: 2; text-align: left; }
  .mo-board-act { grid-column: 2; }
  .mo-inline > span { min-width: 100%; }
  .mo-inline input { max-width: none; }
  .mo-history li { grid-template-columns: minmax(0, 1fr); gap: 0; }
  .mo-group-head .mo-actions { width: 100%; }
  .mo-group-head .mo-select { flex: 1; }
}
`;
