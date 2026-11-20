'use client';

// Campaigns (064): every booked board from booking to proof. Our team sends the
// install link, checks artwork, and approves install photos. A booking shows
// as live only after a photo is approved here.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useDashboardRole } from '@/components/layout/DashboardLayout';
import {
  type CampaignBooking, type ProofPhoto, type ArtworkFile, stagesOf, headline, fmtDay, signedLinks, uploadProofAsTeam,
} from '@/lib/campaign-progress';

type Filter = 'action' | 'progress' | 'live' | 'ended' | 'all';
type Need = { text: string; tone: 'warn' | 'now' };

function needsOf(b: CampaignBooking, today: string): Need | null {
  if (b.proofs.some(p => p.status === 'submitted')) return { text: 'Check install photo', tone: 'warn' };
  if (b.artwork[0]?.status === 'uploaded') return { text: 'Check artwork', tone: 'warn' };
  const st = stagesOf(b, today);
  if (st[4].done) return null;
  if (!b.confirmed) return { text: 'Confirm booking in Quotations', tone: 'now' };
  if (st[3].done) return null;
  if (!b.has_install_link) return { text: 'Send install link', tone: 'now' };
  if (b.start_date && b.start_date < today) return { text: 'Install photo overdue', tone: 'warn' };
  return null;
}

export default function AdminCampaignsPage() {
  const role = useDashboardRole();
  const [rows, setRows] = useState<CampaignBooking[]>([]);
  const [links, setLinks] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>('action');
  const [open, setOpen] = useState<string | null>(null);
  const [today] = useState(() => new Date(Date.now() + 3600_000).toISOString().slice(0, 10));

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('admin_campaign_bookings');
    if (error) {
      setError(/does not exist|schema cache|function/i.test(error.message) ? 'Run migration 064 in Supabase to switch on campaign tracking.' : error.message);
      setLoading(false);
      return;
    }
    const list = (data ?? []) as CampaignBooking[];
    setRows(list);
    const [art, proof] = await Promise.all([
      signedLinks('creatives', list.flatMap(b => b.artwork.map(a => a.path)), 3600),
      signedLinks('compliance-photos', list.flatMap(b => b.proofs.map(p => p.path)), 3600),
    ]);
    setLinks({ ...art, ...proof });
    setError(null);
    setLoading(false);
  }, []);
  useEffect(() => { if (role !== 'admin') return; (async () => { await load(); })(); }, [role, load]);

  const enriched = useMemo(() => rows.map(b => ({ b, need: needsOf(b, today), st: stagesOf(b, today) })), [rows, today]);
  const counts = useMemo(() => ({
    action: enriched.filter(x => x.need).length,
    progress: enriched.filter(x => !x.st[3].done && !x.st[4].done).length,
    live: enriched.filter(x => x.st[3].done && !x.st[4].done).length,
    ended: enriched.filter(x => x.st[4].done).length,
    all: enriched.length,
    photos: rows.reduce((n, b) => n + b.proofs.filter(p => p.status === 'submitted').length, 0),
    art: rows.filter(b => b.artwork[0]?.status === 'uploaded').length,
  }), [enriched, rows]);
  const shown = enriched.filter(x =>
    filter === 'all' ? true : filter === 'action' ? !!x.need : filter === 'live' ? x.st[3].done && !x.st[4].done
      : filter === 'ended' ? x.st[4].done : !x.st[3].done && !x.st[4].done);

  if (role && role !== 'admin') return <div className="cp-pad">Admins only.</div>;

  return (
    <div className="cp">
      <style>{CSS}</style>
      <header className="cp-top">
        <div>
          <h1>Campaigns</h1>
          <p className="cp-sub">Booked boards from confirmation to approved install photo. Buyers only see photos you approve.</p>
        </div>
      </header>

      <div className="cp-stats">
        <div className={counts.photos ? 'hot' : ''}><b>{counts.photos}</b><span>install photo{counts.photos === 1 ? '' : 's'} to check</span></div>
        <div className={counts.art ? 'hot' : ''}><b>{counts.art}</b><span>artwork to check</span></div>
        <div><b>{counts.live}</b><span>live (proof approved)</span></div>
        <div><b>{counts.progress}</b><span>in progress</span></div>
      </div>

      <div className="cp-tabs" role="tablist">
        {([['action', 'Needs you'], ['progress', 'In progress'], ['live', 'Live'], ['ended', 'Ended'], ['all', 'All']] as [Filter, string][]).map(([k, t]) => (
          <button key={k} role="tab" aria-selected={filter === k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>{t}<span>{counts[k]}</span></button>
        ))}
      </div>

      {error && <div className="cp-err" role="alert">{error}</div>}
      {loading ? <div className="cp-card cp-skel" />
        : shown.length === 0 ? (
          <div className="cp-empty">
            <h2>{rows.length === 0 ? 'No booked boards yet' : 'Nothing here'}</h2>
            <p>{rows.length === 0 ? 'When a buyer accepts a quotation, its boards show here. Confirm the booking in Quotations, then send the install link to whoever puts the ad up.' : 'Try another tab.'}</p>
          </div>
        ) : (
          <div className="cp-list">
            {shown.map(({ b, need }) => (
              <Row key={b.id} b={b} need={need} links={links} today={today} open={open === b.id} onToggle={() => setOpen(o => (o === b.id ? null : b.id))} onChanged={load} />
            ))}
          </div>
        )}
    </div>
  );
}

function Row({ b, need, links, today, open, onToggle, onChanged }: {
  b: CampaignBooking; need: Need | null; links: Record<string, string>; today: string; open: boolean; onToggle: () => void; onChanged: () => Promise<void>;
}) {
  const head = headline(b, today);
  const stages = stagesOf(b, today);
  return (
    <article className={`cp-card${open ? ' open' : ''}`}>
      <button type="button" className="cp-row" onClick={onToggle} aria-expanded={open}>
        {b.board.photo ? <img src={b.board.photo} alt="" className="cp-thumb" /> : <span className="cp-thumb cp-ph" />}
        <span className="cp-id">
          <b>{b.board.name}</b>
          <small>{[b.campaign.client_name || b.campaign.name, b.quotation_ref, b.start_date ? `${fmtDay(b.start_date)} – ${fmtDay(b.end_date)}` : null].filter(Boolean).join(' · ')}</small>
        </span>
        <span className="cp-dots" aria-label={stages.map(s => `${s.label}: ${s.note}`).join('; ')}>
          {stages.map(s => <i key={s.key} className={s.tone} title={`${s.label}: ${s.note}`} />)}
        </span>
        {need ? <span className={`cp-pill ${need.tone}`}>{need.text}</span> : <span className={`cp-pill ${head.tone}`}>{head.text}</span>}
        <span className="cp-chev" aria-hidden>▾</span>
      </button>
      {open && <Detail b={b} links={links} onChanged={onChanged} />}
    </article>
  );
}

function Detail({ b, links, onChanged }: { b: CampaignBooking; links: Record<string, string>; onChanged: () => Promise<void> }) {
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const say = (text: string, bad = false) => setMsg({ text, bad });
  return (
    <div className="cp-detail">
      <div className="cp-grid">
        <InstallLink b={b} say={say} onChanged={onChanged} />
        <section className="cp-box">
          <h3>Media owner</h3>
          {b.owner ? <p className="cp-line"><b>{b.owner.name}</b>{b.owner.phone ? <> · <a href={`tel:${b.owner.phone}`}>{b.owner.phone}</a></> : ' · no phone on file'}</p>
            : <p className="cp-muted">No owner linked to this board. Assign one on Media owners.</p>}
          {!b.pinned && <p className="cp-warnline">This board has no map pin, so install photos can&apos;t be checked against its location.</p>}
        </section>
      </div>

      <section className="cp-box">
        <h3>Artwork</h3>
        {b.artwork.length === 0 ? <p className="cp-muted">The buyer hasn&apos;t sent artwork yet. They can send it from My requests.</p>
          : <ul className="cp-files">{b.artwork.map(a => <ArtworkRow key={a.id} a={a} url={a.path ? links[a.path] : a.url} say={say} onChanged={onChanged} />)}</ul>}
      </section>

      <section className="cp-box">
        <h3>Install photos</h3>
        {b.proofs.length === 0 && <p className="cp-muted">No photos yet. Send the install link to whoever puts the ad up, or add a photo you received another way.</p>}
        <div className="cp-proofs">{b.proofs.map(p => <ProofCard key={p.id} p={p} url={p.path ? links[p.path] : p.url} say={say} onChanged={onChanged} />)}</div>
        <AddProof b={b} say={say} onChanged={onChanged} />
      </section>
      {msg && <p className={`cp-msg${msg.bad ? ' bad' : ''}`} role="status">{msg.text}</p>}
    </div>
  );
}

function InstallLink({ b, say, onChanged }: { b: CampaignBooking; say: (t: string, bad?: boolean) => void; onChanged: () => Promise<void> }) {
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const usable = ['agreed', 'signed', 'live'].includes(b.status) && b.confirmed;
  async function make(fresh: boolean) {
    setBusy(true);
    const { data, error } = await supabase.rpc('admin_poe_link', { p_booking_id: b.id, p_new: fresh });
    setBusy(false);
    if (error) { say(error.message, true); return; }
    const link = `${window.location.origin}/poe/${data}`;
    setUrl(link);
    try { await navigator.clipboard.writeText(link); say(fresh ? 'New link made and copied. The old link no longer works.' : 'Link copied.'); } catch { say('Link ready below.'); }
    if (fresh || !b.has_install_link) await onChanged();
  }
  const msg = `Hello, please send a photo of ${b.board.name} once the ad is up, using this link: ${url ?? ''}`;
  return (
    <section className="cp-box">
      <h3>Install link</h3>
      {!usable ? <p className="cp-muted">Confirm the booking first (Quotations → Confirm booking).</p> : (
        <>
          <p className="cp-muted">Send this to the installer. No account needed. Photos wait for your check here.</p>
          <div className="cp-actions">
            <button type="button" className="cp-btn primary" disabled={busy} onClick={() => make(false)}>{b.has_install_link ? 'Copy link' : 'Make link'}</button>
            {b.has_install_link && <button type="button" className="cp-btn" disabled={busy} onClick={() => make(true)}>Replace link</button>}
            {url && <a className="cp-btn" href={`https://wa.me/?text=${encodeURIComponent(msg)}`} target="_blank" rel="noreferrer">Share on WhatsApp ↗</a>}
          </div>
          {url && <input className="cp-linkbox" readOnly value={url} onFocus={e => e.currentTarget.select()} aria-label="Install link" />}
        </>
      )}
    </section>
  );
}

function ArtworkRow({ a, url, say, onChanged }: { a: ArtworkFile; url: string | null | undefined; say: (t: string, bad?: boolean) => void; onChanged: () => Promise<void> }) {
  const [note, setNote] = useState('');
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  async function review(approve: boolean) {
    setBusy(true);
    const { error } = await supabase.rpc('admin_review_artwork', { p_id: a.id, p_approve: approve, p_note: approve ? null : note });
    setBusy(false);
    if (error) { say(error.message, true); return; }
    say(approve ? 'Artwork approved. The buyer has been told.' : 'Changes requested. The buyer has been told.');
    setAsking(false); setNote('');
    await onChanged();
  }
  const size = a.file_size ? `${(a.file_size / 1048576).toFixed(a.file_size > 10485760 ? 0 : 1)} MB` : '';
  return (
    <li>
      <div className="cp-fline">
        {url ? <a href={url} target="_blank" rel="noreferrer">{a.file_name}</a> : <span>{a.file_name}</span>}
        <small>{[size, fmtDay(a.created_at)].filter(Boolean).join(' · ')}</small>
        <span className={`cp-tag ${a.status === 'uploaded' ? 'warn' : a.status === 'changes_requested' ? 'bad' : 'ok'}`}>
          {a.status === 'uploaded' ? 'To check' : a.status === 'changes_requested' ? 'Changes asked' : 'Approved'}
        </span>
        {a.status === 'uploaded' && !asking && (
          <span className="cp-actions">
            <button type="button" className="cp-btn primary sm" disabled={busy} onClick={() => review(true)}>Approve</button>
            <button type="button" className="cp-btn sm" disabled={busy} onClick={() => setAsking(true)}>Ask for changes</button>
          </span>
        )}
      </div>
      {a.review_note && a.status === 'changes_requested' && <p className="cp-note">“{a.review_note}”</p>}
      {asking && (
        <div className="cp-ask">
          <input value={note} onChange={e => setNote(e.target.value)} maxLength={500} placeholder="What needs changing? e.g. logo too small, wrong size (48×16 ft)" autoFocus />
          <button type="button" className="cp-btn primary sm" disabled={busy || !note.trim()} onClick={() => review(false)}>Send</button>
          <button type="button" className="cp-btn sm" onClick={() => setAsking(false)}>Cancel</button>
        </div>
      )}
    </li>
  );
}

function ProofCard({ p, url, say, onChanged }: { p: ProofPhoto; url: string | null | undefined; say: (t: string, bad?: boolean) => void; onChanged: () => Promise<void> }) {
  const [note, setNote] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const [busy, setBusy] = useState(false);
  async function review(approve: boolean) {
    setBusy(true);
    const { error } = await supabase.rpc('admin_review_proof', { p_check_id: p.id, p_approve: approve, p_note: approve ? null : note });
    setBusy(false);
    if (error) { say(error.message, true); return; }
    say(approve ? 'Approved. The booking is live and the buyer can see the photo.' : 'Photo rejected. The installer sees your reason when they open the link.');
    setRejecting(false);
    await onChanged();
  }
  const far = p.distance_m != null && p.distance_m > 300;
  return (
    <figure className={`cp-proof ${p.status}`}>
      {url ? <a href={url} target="_blank" rel="noreferrer"><img src={url} alt="Install photo" /></a> : <span className="cp-ph cp-proof-ph">Photo unavailable</span>}
      <figcaption>
        <span className={`cp-tag ${p.status === 'verified' ? 'ok' : p.status === 'flagged' ? 'bad' : 'warn'}`}>
          {p.status === 'verified' ? 'Approved' : p.status === 'flagged' ? 'Rejected' : 'To check'}
        </span>
        <small>{new Date(p.submitted_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}{p.submitted_by ? ` · ${p.submitted_by}` : ''}</small>
        <small className={far ? 'cp-far' : ''}>
          {p.distance_m == null ? (p.source === 'admin' ? 'Added by our team' : 'No location sent') : `${p.distance_m} m from the map pin${far ? ', check it is the right board' : ''}`}
        </small>
        {p.notes && <small>“{p.notes}”</small>}
        {p.review_note && <small className="cp-far">Reason: {p.review_note}</small>}
        {p.status === 'submitted' && !rejecting && (
          <span className="cp-actions">
            <button type="button" className="cp-btn primary sm" disabled={busy || !url} onClick={() => review(true)}>Approve</button>
            <button type="button" className="cp-btn sm" disabled={busy} onClick={() => setRejecting(true)}>Reject</button>
          </span>
        )}
        {rejecting && (
          <span className="cp-ask col">
            <input value={note} onChange={e => setNote(e.target.value)} maxLength={500} placeholder="Why? e.g. too dark, ad not visible" autoFocus />
            <span className="cp-actions">
              <button type="button" className="cp-btn primary sm" disabled={busy || !note.trim()} onClick={() => review(false)}>Reject photo</button>
              <button type="button" className="cp-btn sm" onClick={() => setRejecting(false)}>Cancel</button>
            </span>
          </span>
        )}
      </figcaption>
    </figure>
  );
}

function AddProof({ b, say, onChanged }: { b: CampaignBooking; say: (t: string, bad?: boolean) => void; onChanged: () => Promise<void> }) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  if (!['agreed', 'signed', 'live'].includes(b.status)) return null;
  async function add(f: File | undefined) {
    if (!f) return;
    setBusy(true);
    const err = await uploadProofAsTeam(b.id, f, '');
    setBusy(false);
    if (ref.current) ref.current.value = '';
    if (err) { say(err, true); return; }
    say('Photo added. Check it and approve it above.');
    await onChanged();
  }
  return (
    <div className="cp-add">
      <input ref={ref} type="file" accept="image/*" hidden onChange={e => add(e.target.files?.[0])} />
      <button type="button" className="cp-btn sm" disabled={busy} onClick={() => ref.current?.click()}>{busy ? 'Uploading…' : '+ Add a photo you received (e.g. on WhatsApp)'}</button>
    </div>
  );
}

const CSS = `
.cp { max-width: 1100px; }
.cp-pad { padding: 32px; color: #64748B; font-size: .875rem; }
.cp-top h1 { font-size: 1.5rem; font-weight: 700; margin: 0; letter-spacing: -.02em; color: #0F172A; }
.cp-sub { font-size: .875rem; color: #64748B; margin: 4px 0 18px; }
.cp-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 18px; }
.cp-stats div { background: #fff; border: 1px solid #E2E8F0; border-radius: 12px; padding: 12px 14px; display: grid; }
.cp-stats b { font-size: 1.375rem; color: #0F172A; } .cp-stats span { font-size: .75rem; color: #64748B; }
.cp-stats .hot { border-color: #FDBA74; background: #FFF7ED; } .cp-stats .hot b { color: #C2410C; }
.cp-tabs { display: flex; gap: 6px; margin-bottom: 14px; flex-wrap: wrap; }
.cp-tabs button { border: 1px solid #E2E8F0; background: #fff; border-radius: 999px; padding: 6px 12px; font: inherit; font-size: .8125rem; font-weight: 600; color: #475569; cursor: pointer; display: flex; gap: 6px; align-items: center; }
.cp-tabs button span { font-size: .6875rem; background: #F1F5F9; border-radius: 999px; padding: 0 6px; }
.cp-tabs button.on { background: #0F172A; color: #fff; border-color: #0F172A; } .cp-tabs button.on span { background: rgba(255,255,255,.18); }
.cp-err { background: #FEF2F2; border: 1px solid #FECACA; color: #B91C1C; border-radius: 10px; padding: 10px 12px; font-size: .875rem; margin-bottom: 12px; }
.cp-list { display: grid; gap: 8px; }
.cp-card { background: #fff; border: 1px solid #E2E8F0; border-radius: 12px; overflow: hidden; }
.cp-card.open { border-color: #CBD5E1; box-shadow: 0 2px 10px rgba(15,23,42,.05); }
.cp-skel { height: 64px; background: linear-gradient(90deg, #F8FAFC, #F1F5F9, #F8FAFC); }
.cp-row { width: 100%; display: flex; align-items: center; gap: 12px; padding: 10px 14px; background: none; border: 0; font: inherit; text-align: left; cursor: pointer; color: inherit; }
.cp-thumb { width: 48px; height: 36px; border-radius: 7px; object-fit: cover; flex: none; }
.cp-ph { background: linear-gradient(135deg, #F1F5F9, #E2E8F0); display: grid; place-items: center; color: #94A3B8; font-size: .75rem; }
.cp-id { flex: 1; min-width: 0; display: grid; } .cp-id b { font-size: .9375rem; color: #0F172A; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cp-id small { font-size: .75rem; color: #64748B; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cp-dots { display: flex; gap: 3px; flex: none; } .cp-dots i { width: 18px; height: 5px; border-radius: 3px; background: #E2E8F0; }
.cp-dots i.done { background: #10B981; } .cp-dots i.now { background: #3B82F6; } .cp-dots i.warn { background: #F97316; }
.cp-pill { font-size: .75rem; font-weight: 600; border-radius: 999px; padding: 4px 10px; white-space: nowrap; flex: none; }
.cp-pill.done { background: #ECFDF5; color: #047857; } .cp-pill.now { background: #EFF6FF; color: #1D4ED8; } .cp-pill.warn { background: #FFF7ED; color: #C2410C; } .cp-pill.todo { background: #F1F5F9; color: #475569; }
.cp-chev { color: #94A3B8; transition: transform .15s; } .cp-card.open .cp-chev { transform: rotate(180deg); }
.cp-detail { border-top: 1px solid #F1F5F9; padding: 14px; display: grid; gap: 12px; background: #FCFDFE; }
.cp-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.cp-box { background: #fff; border: 1px solid #EEF2F6; border-radius: 10px; padding: 12px 14px; }
.cp-box h3 { font-size: .6875rem; text-transform: uppercase; letter-spacing: .07em; color: #64748B; margin: 0 0 8px; font-weight: 600; }
.cp-muted { font-size: .8125rem; color: #64748B; margin: 0 0 8px; line-height: 1.5; }
.cp-line { font-size: .875rem; margin: 0; } .cp-line a { color: #1B4F8A; }
.cp-warnline { font-size: .75rem; color: #C2410C; margin: 8px 0 0; }
.cp-actions { display: inline-flex; gap: 6px; flex-wrap: wrap; align-items: center; }
.cp-btn { border: 1px solid #CBD5E1; background: #fff; color: #0F172A; border-radius: 8px; padding: 7px 12px; font: inherit; font-size: .8125rem; font-weight: 600; cursor: pointer; text-decoration: none; display: inline-block; }
.cp-btn.primary { background: #1B4F8A; border-color: #1B4F8A; color: #fff; } .cp-btn.sm { padding: 5px 10px; font-size: .75rem; }
.cp-btn:disabled { opacity: .55; cursor: default; }
.cp-linkbox { width: 100%; margin-top: 8px; border: 1px solid #E2E8F0; border-radius: 8px; padding: 7px 10px; font: inherit; font-size: .75rem; color: #475569; background: #F8FAFC; box-sizing: border-box; }
.cp-files { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
.cp-fline { display: flex; flex-wrap: wrap; gap: 6px 10px; align-items: center; font-size: .8125rem; }
.cp-fline a { color: #1B4F8A; font-weight: 600; } .cp-fline small { color: #94A3B8; font-size: .75rem; }
.cp-fline .cp-actions { margin-left: auto; }
.cp-tag { font-size: .6875rem; font-weight: 600; border-radius: 6px; padding: 2px 7px; }
.cp-tag.ok { background: #ECFDF5; color: #047857; } .cp-tag.warn { background: #FFF7ED; color: #C2410C; } .cp-tag.bad { background: #FEF2F2; color: #B91C1C; }
.cp-note { font-size: .75rem; color: #9A3412; margin: 4px 0 0; }
.cp-ask { display: flex; gap: 6px; margin-top: 6px; flex-wrap: wrap; } .cp-ask.col { flex-direction: column; }
.cp-ask input { flex: 1; min-width: 200px; border: 1px solid #CBD5E1; border-radius: 8px; padding: 6px 10px; font: inherit; font-size: .8125rem; }
.cp-proofs { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 10px; }
.cp-proof { margin: 0; border: 1px solid #E2E8F0; border-radius: 10px; overflow: hidden; background: #fff; }
.cp-proof.submitted { border-color: #FDBA74; box-shadow: 0 0 0 2px #FFEDD5; }
.cp-proof img, .cp-proof-ph { width: 100%; aspect-ratio: 4 / 3; object-fit: cover; display: block; }
.cp-proof figcaption { padding: 8px 10px; display: grid; gap: 4px; justify-items: start; }
.cp-proof small { font-size: .75rem; color: #64748B; } .cp-proof .cp-far { color: #C2410C; }
.cp-add { margin-top: 10px; }
.cp-msg { font-size: .8125rem; color: #047857; margin: 0; } .cp-msg.bad { color: #B91C1C; }
.cp-empty { background: #fff; border: 1px dashed #CBD5E1; border-radius: 14px; padding: 36px 20px; text-align: center; }
.cp-empty h2 { font-size: 1rem; margin: 0 0 6px; color: #0F172A; } .cp-empty p { font-size: .875rem; color: #64748B; margin: 0 auto; max-width: 480px; line-height: 1.55; }
@media (max-width: 760px) {
  .cp-stats { grid-template-columns: 1fr 1fr; }
  .cp-grid { grid-template-columns: 1fr; }
  .cp-row { flex-wrap: wrap; row-gap: 8px; } .cp-id { flex: 1 1 calc(100% - 64px); } .cp-dots { order: 3; margin-left: 60px; } .cp-pill { order: 4; margin-left: auto; } .cp-chev { display: none; }
}
`;
