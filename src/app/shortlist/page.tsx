'use client';

/**
 * The buyer's shortlist (boards saved with the heart). From here a buyer can
 * request prices for many boards in one go, or share the set with their
 * client as a proposal link. Works signed out: saving needs no account;
 * requesting and sharing ask the buyer to sign in.
 */

import { useEffect, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { supabase } from '@/lib/supabase';
import { useShortlist, removeFromShortlist, setShortlist, clearShortlist } from '@/lib/shortlist';
import { attachGuidePrices, compactNaira, guideText, GUIDE_NOTE, type GuidePrice } from '@/lib/guide-prices';
import { boardFormatLabel } from '@/lib/board-formats';
import { VerificationBadge, dimensionsText } from '@/lib/board-verification';
import { sendBoardRequests } from '@/lib/availability-requests';
import type { MapBoard } from '../marketplace/MarketplaceMap';

const MarketplaceMap = dynamic(() => import('../marketplace/MarketplaceMap'), {
  ssr: false,
  loading: () => <div style={{ height: '100%', background: '#EEF2F7' }} />,
});

const REQUEST_MAX = 15;

type SBoard = {
  id: string; name: string; address: string | null; area: string | null; city: string | null; state: string | null;
  format: string | null; width: number | null; height: number | null; illuminated: boolean | null;
  photo_urls: string[] | null; verification_status: string | null; latitude: number | null; longitude: number | null;
  guide: GuidePrice | null;
};

type Viewer =
  | { kind: 'loading' }
  | { kind: 'anon' }
  | { kind: 'buyer'; uid: string; name: string; company: string; email: string; phone: string }
  | { kind: 'admin'; uid: string }
  | { kind: 'other'; role: string };

const noop = () => () => {};
const today = () => new Date().toISOString().slice(0, 10);
const place = (b: SBoard) => [b.area, b.city].filter(Boolean).join(', ') || b.address || '—';

export default function ShortlistPage() {
  const ids = useShortlist();
  const mounted = useSyncExternalStore(noop, () => true, () => false);
  const [byId, setById] = useState<Record<string, SBoard | null>>({});
  const [viewer, setViewer] = useState<Viewer>({ kind: 'loading' });
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [tab, setTab] = useState<'request' | 'share'>('request');
  const [showMap, setShowMap] = useState(false);

  // Fetch only boards we haven't loaded yet, so removing one doesn't reload the list.
  const missing = ids.filter(id => !(id in byId));
  const missingKey = missing.join(',');
  useEffect(() => {
    if (!missingKey) return;
    let cancelled = false;
    (async () => {
      const want = missingKey.split(',');
      const { data } = await supabase.from('boards')
        .select('id, name, address, area, city, state, format, width, height, illuminated, photo_urls, verification_status, latitude, longitude')
        .in('id', want);
      const rows = await attachGuidePrices((data ?? []) as Omit<SBoard, 'guide'>[]);
      if (cancelled) return;
      setById(prev => {
        const next = { ...prev };
        want.forEach(id => { next[id] = null; });
        rows.forEach(r => { next[r.id] = r; });
        return next;
      });
    })();
    return () => { cancelled = true; };
  }, [missingKey]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { if (!cancelled) setViewer({ kind: 'anon' }); return; }
      const { data: p } = await supabase.from('profiles').select('role, full_name, company_name, phone').eq('id', session.user.id).maybeSingle();
      if (cancelled) return;
      if (p?.role === 'agency') setViewer({ kind: 'buyer', uid: session.user.id, name: p.full_name ?? '', company: p.company_name ?? '', email: session.user.email ?? '', phone: p.phone ?? '' });
      else if (p?.role === 'admin') setViewer({ kind: 'admin', uid: session.user.id });
      else setViewer({ kind: 'other', role: p?.role ?? 'unknown' });
    })();
    const q = new URLSearchParams(window.location.search);
    if (q.get('share') === '1') queueMicrotask(() => setTab('share'));
    return () => { cancelled = true; };
  }, []);

  const loading = !mounted || missing.length > 0;
  const boards = ids.map(id => byId[id]).filter((b): b is SBoard => !!b);
  const gone = ids.filter(id => byId[id] === null);
  const chosen = boards.filter(b => !excluded.has(b.id));
  const priced = chosen.filter(b => b.guide);
  const total = priced.reduce((t, b) => ({ low: t.low + b.guide!.low, high: t.high + b.guide!.high }), { low: 0, high: 0 });
  const cities = [...new Set(chosen.map(b => b.city).filter(Boolean))] as string[];

  const mapBoards: MapBoard[] = boards
    .filter(b => b.latitude != null && b.longitude != null)
    .map(b => ({
      id: b.id, name: b.name, area: b.area, city: b.city ?? '', format: boardFormatLabel(b.format), photo_urls: b.photo_urls,
      verification_status: b.verification_status, latitude: b.latitude!, longitude: b.longitude!,
      rate: b.guide ? guideText(b.guide) : 'Request quote', perMonth: !!b.guide, guide: !!b.guide,
    }));

  function toggleChosen(id: string) {
    setExcluded(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }

  const browseHref = viewer.kind === 'anon' ? '/billboards' : '/marketplace';

  return (
    <div className="sl">
      <style>{CSS}</style>

      <header className="sl-head">
        <div className="sl-head-in">
          <Link href="/" className="sl-logo">
            <span className="sl-logo-mark">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round"><rect x="3" y="3" width="18" height="5" rx="1.5" /><line x1="6" y1="8" x2="6" y2="21" /><line x1="18" y1="8" x2="18" y2="21" /></svg>
            </span>
            <span>OOH Platform</span>
          </Link>
          <nav style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Link href={browseHref} className="sl-ghost">Browse boards</Link>
            {boards.length > 0 && <button type="button" className="sl-ghost sl-hide-m" onClick={() => window.print()}>Print / PDF</button>}
          </nav>
        </div>
      </header>

      <main className="sl-main">
        <div className="sl-title-row">
          <div>
            <p className="sl-eyebrow">Your shortlist</p>
            <h1 className="sl-h1">
              {loading ? 'Loading your boards…' : boards.length === 0 ? 'Nothing saved yet' : `${boards.length} board${boards.length !== 1 ? 's' : ''} saved`}
            </h1>
            {!loading && boards.length > 0 && (
              <p className="sl-sub">
                {cities.length > 0 && <>{cities.slice(0, 3).join(', ')}{cities.length > 3 ? ` +${cities.length - 3}` : ''} · </>}
                {priced.length > 0
                  ? <>Guide total <strong>{compactNaira(total.low)}–{compactNaira(total.high).replace('₦', '')}</strong> per month{priced.length < chosen.length ? ` for ${priced.length} of ${chosen.length} boards` : ''}</>
                  : 'Owners confirm prices when you request'}
              </p>
            )}
          </div>
          {!loading && boards.length > 0 && (
            <div style={{ display: 'flex', gap: 8 }} className="sl-noprint">
              {mapBoards.length > 0 && (
                <button type="button" className={`sl-chip${showMap ? ' is-on' : ''}`} onClick={() => setShowMap(v => !v)} data-map-toggle>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" /><line x1="8" y1="2" x2="8" y2="18" /><line x1="16" y1="6" x2="16" y2="22" /></svg>
                  {showMap ? 'Hide map' : 'Map'}
                </button>
              )}
              <button type="button" className="sl-chip" onClick={() => { if (confirmClear()) clearShortlist(); }}>Clear all</button>
            </div>
          )}
        </div>

        {loading ? (
          <div className="sl-grid">
            <div>{[0, 1, 2].map(i => <div key={i} className="sl-skel" />)}</div>
            <div className="sl-skel" style={{ height: 380 }} />
          </div>
        ) : boards.length === 0 ? (
          <div className="sl-empty" data-empty>
            <span className="sl-empty-icon">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#E11D48" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z" /></svg>
            </span>
            <h2>Save boards as you browse</h2>
            <p>Tap the heart on any board to keep it here. Then request prices for all of them at once, or send them to your client as one link.</p>
            <Link href={browseHref} className="sl-btn">Browse boards</Link>
            {gone.length > 0 && <p style={{ marginTop: 16, fontSize: 13, color: '#94A3B8' }}>{gone.length} saved board{gone.length !== 1 ? 's are' : ' is'} no longer listed.</p>}
          </div>
        ) : (
          <div className="sl-grid">
            <section>
              {showMap && mapBoards.length > 0 && (
                <div className="sl-map sl-noprint" data-map>
                  <MarketplaceMap boards={mapBoards} onOpen={id => document.getElementById(`sl-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })} />
                </div>
              )}
              {gone.length > 0 && (
                <p className="sl-note sl-noprint">
                  {gone.length} saved board{gone.length !== 1 ? 's are' : ' is'} no longer listed.{' '}
                  <button type="button" className="sl-link" onClick={() => setShortlist(boards.map(b => b.id))}>Tidy up</button>
                </p>
              )}
              <ul className="sl-list">
                {boards.map(b => {
                  const on = !excluded.has(b.id);
                  const size = b.width && b.height ? dimensionsText(b.width, b.height) : null;
                  return (
                    <li key={b.id} id={`sl-${b.id}`} className={`sl-item${on ? '' : ' is-off'}`} data-shortlist-item>
                      <label className="sl-check sl-noprint" title={on ? 'Included' : 'Left out'}>
                        <input type="checkbox" checked={on} onChange={() => toggleChosen(b.id)} aria-label={`Include ${b.name}`} />
                        <span aria-hidden="true" />
                      </label>
                      <Link href={`/boards/${b.id}`} className="sl-photo">
                        {b.photo_urls?.[0]
                          // eslint-disable-next-line @next/next/no-img-element
                          ? <img src={b.photo_urls[0]} alt="" loading="lazy" />
                          : <span className="sl-nophoto">No photo</span>}
                      </Link>
                      <div className="sl-info">
                        <Link href={`/boards/${b.id}`} className="sl-name">{b.name}</Link>
                        <p className="sl-place">{place(b)}</p>
                        <p className="sl-meta">
                          {boardFormatLabel(b.format)}{size ? ` · ${size}` : ''}{b.illuminated ? ' · Lit' : ''}
                        </p>
                        <div style={{ marginTop: 6 }}><VerificationBadge status={b.verification_status} small /></div>
                      </div>
                      <div className="sl-price">
                        {b.guide
                          ? <><strong>{guideText(b.guide)}</strong><span>per month · guide</span></>
                          : <><strong className="is-quote">Request quote</strong><span>owner confirms</span></>}
                      </div>
                      <button type="button" className="sl-remove sl-noprint" onClick={() => removeFromShortlist(b.id)} aria-label={`Remove ${b.name}`} title="Remove">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                      </button>
                    </li>
                  );
                })}
              </ul>
              <p className="sl-fine">{GUIDE_NOTE}</p>
            </section>

            <aside className="sl-side sl-noprint">
              <div className="sl-panel">
                <div className="sl-tabs" role="tablist">
                  <button type="button" role="tab" aria-selected={tab === 'request'} className={tab === 'request' ? 'is-on' : ''} onClick={() => setTab('request')}>Request prices</button>
                  <button type="button" role="tab" aria-selected={tab === 'share'} className={tab === 'share' ? 'is-on' : ''} onClick={() => setTab('share')}>Share with client</button>
                </div>
                <p className="sl-count">
                  {chosen.length} of {boards.length} board{boards.length !== 1 ? 's' : ''} included
                  {excluded.size > 0 && <> · <button type="button" className="sl-link" onClick={() => setExcluded(new Set())}>Include all</button></>}
                </p>
                {tab === 'request'
                  ? <RequestPanel key={viewer.kind} viewer={viewer} boards={chosen} />
                  : <SharePanel viewer={viewer} boards={chosen} />}
              </div>
            </aside>
          </div>
        )}
      </main>
    </div>
  );
}

function confirmClear() {
  // A plain confirm keeps this simple; the list is easy to rebuild either way.
  try { return window.confirm('Remove every board from your shortlist?'); } catch { return true; }
}

// ── Sign-in prompt shared by both panels ────────────────────────────────────
function SignInPrompt({ viewer, action, next }: { viewer: Viewer; action: string; next: string }) {
  if (viewer.kind === 'loading') return <div className="sl-skel" style={{ height: 120, margin: 0 }} />;
  if (viewer.kind === 'anon') {
    return (
      <div data-signin>
        <p className="sl-p">Sign in with a free buyer account to {action}. Your shortlist stays saved.</p>
        <a href={`/auth/login?redirect=${encodeURIComponent(next)}`} className="sl-btn sl-block">Sign in</a>
        <a href={`/signup?role=agency&redirect=${encodeURIComponent(next)}`} className="sl-btn-2 sl-block">Create a buyer account</a>
      </div>
    );
  }
  if (viewer.kind === 'other') {
    return <p className="sl-p">Buyer accounts (agencies, brands and marketers) can {action}. You&rsquo;re signed in with a {viewer.role} account.</p>;
  }
  return null;
}

// ── Request prices for many boards ──────────────────────────────────────────
function RequestPanel({ viewer, boards }: { viewer: Viewer; boards: SBoard[] }) {
  const buyer = viewer.kind === 'buyer' ? viewer : null;
  // Remounted (key) once we know who's signed in, so the profile fills the form.
  const [f, setF] = useState({ name: buyer?.name ?? '', company: buyer?.company ?? '', email: buyer?.email ?? '', phone: buyer?.phone ?? '', start: '', end: '', message: '', budget: '', extra: '' });
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ sent: number; skipped: string[] } | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF(p => ({ ...p, [k]: e.target.value }));

  if (viewer.kind === 'admin') return <p className="sl-p">Requests are sent from buyer accounts. As an admin you can still share these boards as a proposal link.</p>;
  if (!buyer) return <SignInPrompt viewer={viewer} action="request prices" next="/shortlist" />;

  if (done) {
    return (
      <div data-request-done>
        <div className="sl-ok">
          <strong>{done.sent > 0 ? `Request sent for ${done.sent} board${done.sent !== 1 ? 's' : ''}` : 'Nothing new to send'}</strong>
          <span>{done.sent > 0 ? 'Each owner checks their board and quotes you. You’ll see every answer in Requests.' : 'You already have open requests for these boards.'}</span>
        </div>
        {done.skipped.length > 0 && <p className="sl-p" style={{ fontSize: 13 }}>Already requested, so skipped: {done.skipped.join(', ')}.</p>}
        <Link href="/dashboard/agency/requests" className="sl-btn sl-block">Go to my requests</Link>
        <button type="button" className="sl-btn-2 sl-block" onClick={() => { clearShortlist(); }}>Clear my shortlist</button>
      </div>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (boards.length === 0) { setError('Tick at least one board.'); return; }
    if (boards.length > REQUEST_MAX) { setError(`You can request up to ${REQUEST_MAX} boards at a time. Untick ${boards.length - REQUEST_MAX}.`); return; }
    if (f.end < f.start) { setError('The end date is before the start date.'); return; }
    setSending(true); setError(null);
    const res = await sendBoardRequests({
      boardIds: boards.map(b => b.id), startDate: f.start, endDate: f.end,
      name: f.name.trim(), company: f.company.trim(), email: f.email.trim(), phone: f.phone.trim(),
      message: f.message.trim(), budget: f.budget ? Number(f.budget) : null, extra: f.extra.trim(),
    });
    setSending(false);
    if (res.error) { setError(res.error.includes('send_board_requests') ? 'Requests for several boards are not switched on yet. Please try again later.' : res.error); return; }
    setDone({ sent: res.ids.length, skipped: res.skipped });
  }

  return (
    <form onSubmit={submit} data-request-form>
      <p className="sl-p">One request goes to the owner of each board. Up to {REQUEST_MAX} at a time.</p>
      <div className="sl-2">
        <div><label className="sl-lbl" htmlFor="sr-start">Campaign start *</label><input id="sr-start" type="date" required min={today()} value={f.start} onChange={set('start')} className="sl-field" /></div>
        <div><label className="sl-lbl" htmlFor="sr-end">Campaign end *</label><input id="sr-end" type="date" required min={f.start || today()} value={f.end} onChange={set('end')} className="sl-field" /></div>
      </div>
      <label className="sl-lbl" htmlFor="sr-message">What&rsquo;s the campaign? *</label>
      <textarea id="sr-message" required rows={3} value={f.message} onChange={set('message')} placeholder="e.g. Product launch for a drinks brand across Lagos for 3 months." className="sl-field" style={{ resize: 'vertical' }} />
      <div className="sl-2">
        <div><label className="sl-lbl" htmlFor="sr-name">Your name *</label><input id="sr-name" required value={f.name} onChange={set('name')} autoComplete="name" className="sl-field" /></div>
        <div><label className="sl-lbl" htmlFor="sr-company">Company *</label><input id="sr-company" required value={f.company} onChange={set('company')} autoComplete="organization" className="sl-field" /></div>
      </div>
      <div className="sl-2">
        <div><label className="sl-lbl" htmlFor="sr-email">Email *</label><input id="sr-email" type="email" required value={f.email} onChange={set('email')} autoComplete="email" className="sl-field" /></div>
        <div><label className="sl-lbl" htmlFor="sr-phone">Phone *</label><input id="sr-phone" type="tel" required value={f.phone} onChange={set('phone')} autoComplete="tel" placeholder="080…" className="sl-field" /></div>
      </div>
      <details style={{ margin: '2px 0 12px' }}>
        <summary className="sl-summary">Add budget and other details (optional)</summary>
        <label className="sl-lbl" htmlFor="sr-budget" style={{ marginTop: 10 }}>Total budget (₦)</label>
        <input id="sr-budget" type="number" min={0} value={f.budget} onChange={set('budget')} className="sl-field" />
        <label className="sl-lbl" htmlFor="sr-extra">Other requirements</label>
        <textarea id="sr-extra" rows={2} value={f.extra} onChange={set('extra')} placeholder="e.g. printing included, lit boards only" className="sl-field" style={{ resize: 'vertical' }} />
      </details>
      <p className="sl-fine" style={{ margin: '0 0 12px' }}>Owners see your company and request. Your email and phone are shared only with our team.</p>
      {error && <p role="alert" className="sl-err">{error}</p>}
      <button type="submit" disabled={sending || boards.length === 0} className="sl-btn sl-block" style={{ opacity: sending ? 0.7 : 1 }}>
        {sending ? 'Sending…' : `Request ${boards.length} board${boards.length !== 1 ? 's' : ''}`}
      </button>
    </form>
  );
}

// ── Share as a proposal link ────────────────────────────────────────────────
function SharePanel({ viewer, boards }: { viewer: Viewer; boards: SBoard[] }) {
  const [f, setF] = useState({ client: '', title: '', note: '', prices: true });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  if (viewer.kind !== 'buyer' && viewer.kind !== 'admin') return <SignInPrompt viewer={viewer} action="share boards with your client" next="/shortlist?share=1" />;
  const uid = viewer.uid;

  if (link) {
    const msg = `${f.title.trim() || 'Billboard options'}: ${link}`;
    return (
      <div data-proposal-done>
        <div className="sl-ok">
          <strong>Your proposal link is ready</strong>
          <span>Anyone with the link can view these {boards.length} boards. It doesn&rsquo;t show your contact details or let them book around you.</span>
        </div>
        <div className="sl-linkbox"><input readOnly value={link} onFocus={e => e.currentTarget.select()} aria-label="Proposal link" /></div>
        <button type="button" className="sl-btn sl-block" onClick={async () => {
          try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch {}
        }}>{copied ? 'Copied ✓' : 'Copy link'}</button>
        <div className="sl-2" style={{ marginTop: 8 }}>
          <a href={`https://wa.me/?text=${encodeURIComponent(msg)}`} target="_blank" rel="noopener noreferrer" className="sl-btn-2">WhatsApp</a>
          <a href={link} target="_blank" rel="noopener noreferrer" className="sl-btn-2">Open</a>
        </div>
        <button type="button" className="sl-link" style={{ marginTop: 12 }} onClick={() => { setLink(null); setF({ client: '', title: '', note: '', prices: true }); }}>Make another</button>
      </div>
    );
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (boards.length === 0) { setError('Tick at least one board.'); return; }
    setSaving(true); setError(null);
    const client = f.client.trim();
    const { data, error: e2 } = await supabase.from('proposals').insert({
      created_by: uid,
      title: (f.title.trim() || (client ? `Billboard options for ${client}` : 'Billboard options')).slice(0, 120),
      client_name: client || null,
      note: f.note.trim() || null,
      board_ids: boards.map(b => b.id).slice(0, 30),
      show_prices: f.prices,
    }).select('token').single();
    setSaving(false);
    if (e2 || !data) { setError(e2?.message?.includes('proposals') ? 'Proposal links are not switched on yet. Please try again later.' : e2?.message ?? 'Could not create the link'); return; }
    setLink(`${window.location.origin}/p/${data.token}`);
  }

  return (
    <form onSubmit={create} data-share-form>
      <p className="sl-p">Send these boards to your client as one tidy link they can open on their phone.</p>
      <label className="sl-lbl" htmlFor="sp-client">Client name</label>
      <input id="sp-client" value={f.client} maxLength={120} onChange={e => setF(p => ({ ...p, client: e.target.value }))} placeholder="e.g. Chi Limited" className="sl-field" />
      <label className="sl-lbl" htmlFor="sp-title">Title</label>
      <input id="sp-title" value={f.title} maxLength={120} onChange={e => setF(p => ({ ...p, title: e.target.value }))}
        placeholder={f.client.trim() ? `Billboard options for ${f.client.trim()}` : 'Billboard options'} className="sl-field" />
      <label className="sl-lbl" htmlFor="sp-note">Note to your client</label>
      <textarea id="sp-note" rows={3} maxLength={1000} value={f.note} onChange={e => setF(p => ({ ...p, note: e.target.value }))}
        placeholder="e.g. Shortlisted for the Q1 launch. All lit, high-traffic sites." className="sl-field" style={{ resize: 'vertical' }} />
      <label className="sl-toggle">
        <input type="checkbox" checked={f.prices} onChange={e => setF(p => ({ ...p, prices: e.target.checked }))} />
        <span><strong>Show guide prices</strong><br />Rounded monthly ranges, not exact rates.</span>
      </label>
      {error && <p role="alert" className="sl-err">{error}</p>}
      <button type="submit" disabled={saving || boards.length === 0} className="sl-btn sl-block" style={{ opacity: saving ? 0.7 : 1 }}>
        {saving ? 'Creating…' : 'Create proposal link'}
      </button>
    </form>
  );
}

const CSS = `
.sl { min-height: 100vh; background: #F8FAFC; color: #0F172A; font-family: 'Inter', system-ui, sans-serif; }
.sl-head { position: sticky; top: 0; z-index: 700; background: rgba(255,255,255,.96); backdrop-filter: blur(12px); border-bottom: 1px solid #E2E8F0; }
.sl-head-in { max-width: 1180px; margin: 0 auto; padding: 11px 24px; display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.sl-logo { text-decoration: none; display: flex; align-items: center; gap: 9px; font-size: .9375rem; font-weight: 800; color: #0F172A; letter-spacing: -.02em; }
.sl-logo-mark { width: 30px; height: 30px; background: #1B4F8A; border-radius: 8px; display: grid; place-items: center; flex-shrink: 0; }
.sl-ghost { background: none; border: none; padding: 8px 8px; font-size: .8125rem; font-weight: 600; line-height: 1; font-family: inherit; color: #334155; cursor: pointer; text-decoration: none; border-radius: 8px; }
.sl-ghost:hover { background: #F1F5F9; }
.sl-main { max-width: 1180px; margin: 0 auto; padding: 28px 24px 64px; }
.sl-title-row { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; margin-bottom: 20px; flex-wrap: wrap; }
.sl-eyebrow { font-size: .6875rem; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; color: #E11D48; margin: 0 0 6px; }
.sl-h1 { font-size: 1.75rem; font-weight: 800; letter-spacing: -.025em; margin: 0; }
.sl-sub { font-size: .9375rem; color: #475569; margin: 6px 0 0; }
.sl-sub strong { color: #0F172A; }
.sl-chip { display: inline-flex; align-items: center; gap: 6px; height: 36px; padding: 0 13px; border-radius: 999px; border: 1px solid #E2E8F0; background: #fff; color: #334155; font-size: .8125rem; font-weight: 600; line-height: 1; font-family: inherit; cursor: pointer; }
.sl-chip:hover { border-color: #CBD5E1; }
.sl-chip.is-on { background: #0F172A; color: #fff; border-color: #0F172A; }
.sl-grid { display: grid; grid-template-columns: minmax(0, 1fr) 380px; gap: 24px; align-items: start; }
.sl-map { height: 340px; border-radius: 16px; overflow: hidden; border: 1px solid #E2E8F0; margin-bottom: 14px; position: relative; }
.sl-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
.sl-item { display: grid; grid-template-columns: auto 112px minmax(0, 1fr) auto auto; align-items: center; gap: 14px; background: #fff; border: 1px solid #E2E8F0; border-radius: 16px; padding: 10px 12px 10px 14px; transition: opacity .15s, box-shadow .15s; }
.sl-item:hover { box-shadow: 0 6px 20px -12px rgba(15,23,42,.25); }
.sl-item.is-off { opacity: .55; }
.sl-check { position: relative; width: 20px; height: 20px; cursor: pointer; }
.sl-check input { position: absolute; opacity: 0; inset: 0; margin: 0; cursor: pointer; }
.sl-check span { position: absolute; inset: 0; border-radius: 6px; border: 1.5px solid #CBD5E1; background: #fff; transition: all .12s; }
.sl-check input:checked + span { background: #1B4F8A; border-color: #1B4F8A; }
.sl-check input:checked + span::after { content: ''; position: absolute; left: 6px; top: 2px; width: 5px; height: 10px; border: solid #fff; border-width: 0 2px 2px 0; transform: rotate(45deg); }
.sl-check input:focus-visible + span { outline: 2px solid #93C5FD; outline-offset: 2px; }
.sl-photo { width: 112px; height: 80px; border-radius: 10px; overflow: hidden; background: #EEF2F7; display: block; }
.sl-photo img { width: 100%; height: 100%; object-fit: cover; display: block; }
.sl-nophoto { display: grid; place-items: center; height: 100%; font-size: 11px; color: #94A3B8; }
.sl-name { font-weight: 700; font-size: .9375rem; color: #0F172A; text-decoration: none; display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sl-name:hover { color: #1B4F8A; }
.sl-place { font-size: .8125rem; color: #475569; margin: 2px 0 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sl-meta { font-size: .75rem; color: #94A3B8; margin: 2px 0 0; }
.sl-price { text-align: right; display: flex; flex-direction: column; gap: 2px; min-width: 110px; }
.sl-price strong { font-size: .9375rem; font-weight: 800; letter-spacing: -.01em; }
.sl-price strong.is-quote { font-size: .8125rem; color: #1B4F8A; font-weight: 700; }
.sl-price span { font-size: .6875rem; color: #94A3B8; }
.sl-remove { width: 32px; height: 32px; border-radius: 8px; border: none; background: none; color: #94A3B8; cursor: pointer; display: grid; place-items: center; }
.sl-remove:hover { background: #FEF2F2; color: #B91C1C; }
.sl-fine { font-size: .75rem; color: #94A3B8; margin: 12px 2px 0; line-height: 1.5; }
.sl-note { font-size: .8125rem; color: #92400E; background: #FFFBEB; border: 1px solid #FDE68A; border-radius: 10px; padding: 8px 12px; margin: 0 0 10px; }
.sl-link { background: none; border: none; padding: 0; color: #1B4F8A; font: inherit; font-weight: 600; cursor: pointer; }
.sl-side { position: sticky; top: 76px; }
.sl-panel { background: #fff; border: 1px solid #E2E8F0; border-radius: 18px; padding: 16px; box-shadow: 0 10px 30px -18px rgba(15,23,42,.25); }
.sl-tabs { display: grid; grid-template-columns: 1fr 1fr; background: #F1F5F9; border-radius: 11px; padding: 3px; gap: 3px; }
.sl-tabs button { height: 36px; border: none; border-radius: 9px; background: none; font-size: .8125rem; font-weight: 600; line-height: 1; font-family: inherit; color: #64748B; cursor: pointer; }
.sl-tabs button.is-on { background: #fff; color: #0F172A; box-shadow: 0 1px 3px rgba(15,23,42,.12); }
.sl-count { font-size: .75rem; color: #64748B; margin: 12px 2px 10px; }
.sl-p { font-size: .875rem; color: #475569; line-height: 1.55; margin: 0 0 12px; }
.sl-lbl { display: block; font-size: .75rem; font-weight: 600; color: #334155; margin: 0 0 4px; }
.sl-field { width: 100%; box-sizing: border-box; padding: 9px 11px; border-radius: 9px; border: 1px solid #CBD5E1; font-size: .875rem; font-family: inherit; color: #0F172A; background: #fff; margin-bottom: 10px; }
.sl-field:focus { outline: none; border-color: #1B4F8A; box-shadow: 0 0 0 3px rgba(27,79,138,.12); }
.sl-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.sl-summary { font-size: .8125rem; font-weight: 600; color: #1B4F8A; cursor: pointer; }
.sl-toggle { display: flex; gap: 10px; align-items: flex-start; font-size: .8125rem; color: #64748B; line-height: 1.45; background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 10px; padding: 10px 12px; margin: 2px 0 14px; cursor: pointer; }
.sl-toggle strong { color: #0F172A; }
.sl-toggle input { margin-top: 2px; accent-color: #1B4F8A; }
.sl-err { font-size: .8125rem; color: #B91C1C; background: #FEF2F2; border: 1px solid #FECACA; border-radius: 8px; padding: 8px 10px; margin: 0 0 12px; }
.sl-btn, .sl-btn-2 { display: inline-flex; align-items: center; justify-content: center; height: 44px; padding: 0 18px; border-radius: 11px; font-size: .875rem; font-weight: 700; line-height: 1; font-family: inherit; text-decoration: none; cursor: pointer; box-sizing: border-box; }
.sl-btn { background: #1B4F8A; color: #fff; border: none; }
.sl-btn:hover { background: #163F6F; }
.sl-btn:disabled { cursor: not-allowed; }
.sl-btn-2 { background: #fff; color: #0F172A; border: 1.5px solid #E2E8F0; }
.sl-btn-2:hover { border-color: #CBD5E1; background: #F8FAFC; }
.sl-block { display: flex; width: 100%; margin-top: 8px; }
.sl-ok { display: flex; flex-direction: column; gap: 4px; background: #ECFDF5; border: 1px solid #A7F3D0; border-radius: 12px; padding: 12px 14px; margin-bottom: 12px; font-size: .8125rem; color: #065F46; line-height: 1.5; }
.sl-ok strong { font-size: .9375rem; color: #064E3B; }
.sl-linkbox input { width: 100%; box-sizing: border-box; padding: 10px 12px; border-radius: 9px; border: 1px solid #CBD5E1; background: #F8FAFC; font: 500 .8125rem/1.2 ui-monospace, monospace; color: #0F172A; }
.sl-empty { background: #fff; border: 1px solid #E2E8F0; border-radius: 20px; padding: 56px 24px; text-align: center; max-width: 560px; margin: 24px auto 0; }
.sl-empty-icon { width: 56px; height: 56px; border-radius: 50%; background: #FFF1F2; display: inline-grid; place-items: center; margin-bottom: 14px; }
.sl-empty h2 { font-size: 1.25rem; font-weight: 800; letter-spacing: -.02em; margin: 0 0 8px; }
.sl-empty p { font-size: .9375rem; color: #64748B; line-height: 1.55; margin: 0 auto 20px; max-width: 420px; }
.sl-skel { height: 102px; border-radius: 16px; background: linear-gradient(90deg, #EEF2F7 0%, #F8FAFC 50%, #EEF2F7 100%); background-size: 200% 100%; animation: slSk 1.2s infinite; margin-bottom: 10px; }
@keyframes slSk { from { background-position: 200% 0; } to { background-position: -200% 0; } }
@media (max-width: 900px) {
  .sl-head-in { padding: 10px 16px; }
  .sl-main { padding: 20px 16px 48px; }
  .sl-h1 { font-size: 1.375rem; }
  .sl-grid { grid-template-columns: minmax(0, 1fr); }
  .sl-side { position: static; }
  .sl-hide-m { display: none; }
  .sl-map { height: 260px; }
  .sl-item { grid-template-columns: auto 76px minmax(0, 1fr) auto; grid-template-areas: 'chk photo info rm' 'chk photo price rm'; gap: 4px 12px; padding: 10px; }
  .sl-check { grid-area: chk; }
  .sl-photo { grid-area: photo; width: 76px; height: 76px; }
  .sl-info { grid-area: info; min-width: 0; }
  .sl-info > div { display: none; }
  .sl-price { grid-area: price; text-align: left; flex-direction: row; flex-wrap: wrap; align-items: baseline; gap: 0 6px; min-width: 0; margin-top: 2px; }
  .sl-price strong, .sl-price span { white-space: nowrap; }
  .sl-remove { grid-area: rm; align-self: start; }
}
@media print {
  .sl-head, .sl-noprint { display: none !important; }
  .sl { background: #fff; }
  .sl-grid { grid-template-columns: 1fr; }
  .sl-item { break-inside: avoid; box-shadow: none; grid-template-columns: 112px minmax(0, 1fr) auto; }
  .sl-item.is-off { display: none; }
}
`;
