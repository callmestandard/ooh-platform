'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '@/lib/supabase';
import { sendBoardRequest } from '@/lib/availability-requests';
import { track } from '@/lib/track';
import { Journey, fmtDate, spanText } from '@/components/requests/journey';

/**
 * "Request this location" on a public board page (MVP core loop).
 * The button opens a dialog (a full-screen sheet on phones) with the request
 * form. A visitor who isn't signed in fills the same form plus a password:
 * sending creates their free buyer account (or signs them in) and sends the
 * request in one step, without leaving the board. Other roles see a short
 * explanation.
 *
 * Opens when the URL has ?request=1 or #request, or when the page dispatches
 * the "ooh:request-location" event (the page's other CTA buttons do this).
 */
export const OPEN_REQUEST_EVENT = 'ooh:request-location';

export type Viewer =
  | { kind: 'loading' }
  | { kind: 'anon' }
  | { kind: 'other'; role: string }
  | { kind: 'buyer'; name: string; company: string; email: string; phone: string };

export type RequestBoard = { id: string; name: string; status: string; photo?: string | null; place?: string | null };

export type RequestForm = {
  name: string; company: string; email: string; phone: string; start: string; end: string; message: string; budget: string; sites: string; extra: string;
  /** Only for visitors who aren't signed in. */
  password: string; account: 'new' | 'existing';
};

const todayStr = () => toStr(new Date());
function toStr(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
/** Last day of a run of `months` months starting on `start`: 1 Feb + 3 months → 30 Apr. */
function endAfter(start: string, months: number) {
  const [y, m, d] = start.split('-').map(Number);
  const end = new Date(y, m - 1 + months, d);
  end.setDate(end.getDate() - 1);
  return toStr(end);
}

const DURATIONS = [1, 3, 6, 12] as const;
const IDEAS = ['Product launch', 'Brand awareness', 'Event or promotion', 'Seasonal campaign'];

async function loadViewer(userId: string, email: string): Promise<Viewer> {
  const { data: p } = await supabase.from('profiles').select('role, full_name, company_name, phone').eq('id', userId).maybeSingle();
  if (p?.role !== 'agency') return { kind: 'other', role: p?.role ?? 'unknown' };
  return { kind: 'buyer', name: p.full_name ?? '', company: p.company_name ?? '', email, phone: p.phone ?? '' };
}

export default function RequestLocation({ board, compact }: { board: RequestBoard; compact?: boolean }) {
  const [viewer, setViewer] = useState<Viewer>({ kind: 'loading' });
  const [open, setOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentId, setSentId] = useState<string | null>(null);
  const [f, setF] = useState<RequestForm>({ name: '', company: '', email: '', phone: '', start: '', end: '', message: '', budget: '', sites: '', extra: '', password: '', account: 'new' });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { if (!cancelled) setViewer({ kind: 'anon' }); return; }
      const v = await loadViewer(session.user.id, session.user.email ?? '');
      if (cancelled) return;
      setViewer(v);
      if (v.kind === 'buyer') setF(prev => ({ ...prev, name: prev.name || v.name, company: prev.company || v.company, email: prev.email || v.email, phone: prev.phone || v.phone }));
    })();
    return () => { cancelled = true; };
  }, []);

  const start = useCallback(() => {
    track('request_open', board.id);
    setOpen(true);
  }, [board.id]);

  // Open from ?request=1 (after login), #request, or the page's CTA buttons.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get('request') === '1' || window.location.hash === '#request') queueMicrotask(start);
    const onEvent = () => start();
    window.addEventListener(OPEN_REQUEST_EVENT, onEvent);
    return () => window.removeEventListener(OPEN_REQUEST_EVENT, onEvent);
  }, [start]);

  /** Visitors: create the buyer account (or sign in) first. Returns false and shows why when it can't. */
  async function ensureBuyer(): Promise<boolean> {
    if (viewer.kind === 'buyer') return true;
    const email = f.email.trim().toLowerCase();
    if (f.account === 'existing') {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password: f.password });
      if (error || !data.session) { setError(error?.message === 'Invalid login credentials' ? 'That email and password don’t match. Try again, or reset your password from the sign-in page.' : error?.message ?? 'Could not sign in.'); return false; }
      const v = await loadViewer(data.session.user.id, data.session.user.email ?? email);
      setViewer(v);
      if (v.kind !== 'buyer') return false;
      setF(prev => ({ ...prev, name: prev.name || v.name, company: prev.company || v.company, phone: prev.phone || v.phone }));
      if (!(f.name.trim() || v.name) || !(f.company.trim() || v.company) || !(f.phone.trim() || v.phone)) {
        setError('You’re signed in. Add your name, company and phone, then send.');
        return false;
      }
      return true;
    }
    const { data, error } = await supabase.auth.signUp({
      email, password: f.password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/login?redirect=${encodeURIComponent(`/boards/${board.id}?request=1`)}`,
        data: { full_name: f.name.trim(), company_name: f.company.trim(), role: 'agency' },
      },
    });
    if (error) {
      if (/already|registered|exists/i.test(error.message)) {
        setF(prev => ({ ...prev, account: 'existing', password: '' }));
        setError('There’s already an account with this email. Enter its password to sign in and send.');
      } else setError(error.message);
      return false;
    }
    if (!data.session) {
      setError('We’ve emailed you a link to confirm your account. Open it, and you’ll come back here to send your request.');
      return false;
    }
    track('signup', board.id);
    // The phone isn't part of sign-up; save it on the new profile for next time.
    await supabase.from('profiles').update({ phone: f.phone.trim() }).eq('id', data.session.user.id);
    setViewer({ kind: 'buyer', name: f.name.trim(), company: f.company.trim(), email, phone: f.phone.trim() });
    return true;
  }

  async function submit() {
    setError(null);
    setSending(true);
    if (!(await ensureBuyer())) { setSending(false); return; }
    const { id, error } = await sendBoardRequest({
      boardId: board.id, startDate: f.start, endDate: f.end,
      name: f.name.trim(), company: f.company.trim(), email: f.email.trim(), phone: f.phone.trim(), message: f.message.trim(),
      budget: Number(f.budget) > 0 ? Number(f.budget) : null,
      sites: Number(f.sites) > 0 ? Math.round(Number(f.sites)) : null,
      extra: f.extra.trim(),
    });
    setSending(false);
    if (error) { setError(error); return; }
    track('request_sent', board.id);
    setSentId(id);
  }

  const isBooked = board.status === 'booked';

  return (
    <div id="request" style={compact ? { scrollMarginTop: 84 } : { background: '#fff', borderTop: '1px solid #F1F5F9', borderBottom: '1px solid #F1F5F9', padding: 16, margin: '8px 0', scrollMarginTop: 72 }}>
      {sentId ? (
        <a href="/dashboard/agency/requests" data-request-sent className="rl-sent">
          <span className="rl-sent-ico"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span>
          <span><b>Request sent</b><small>Track it in My Requests →</small></span>
        </a>
      ) : (
        <>
          {(!compact || isBooked) && <p style={{ fontSize: '0.875rem', color: '#475569', margin: '0 0 12px', lineHeight: 1.55 }}>
            {isBooked
              ? 'This board is currently booked. Tell us your campaign dates and we’ll ask the owner when it is free.'
              : 'Tell us your campaign dates. We check availability with the media owner and send you a quotation, then help you complete the booking.'}
          </p>}
          <button type="button" onClick={start} className="rl-cta" data-request-open>Request this location</button>
        </>
      )}

      {open && (
        <RequestDialog
          board={board} viewer={viewer} form={f} setForm={setF}
          sending={sending} error={error} sentId={sentId}
          onSubmit={submit} onClose={() => setOpen(false)}
        />
      )}

      <style>{`
        .rl-cta { display: block; width: 100%; box-sizing: border-box; background: #1B4F8A; color: #fff; border: none; border-radius: 12px; padding: 15px; font: 700 0.9375rem/1 'Inter', sans-serif; cursor: pointer; box-shadow: 0 4px 16px rgba(27,79,138,.25); transition: background .15s, transform .1s; }
        .rl-cta:hover { background: #163F70; }
        .rl-cta:active { transform: scale(.99); }
        .rl-sent { display: flex; align-items: center; gap: 12px; padding: 12px 14px; border-radius: 12px; background: #ECFDF5; border: 1px solid #A7F3D0; color: #065F46; text-decoration: none; }
        .rl-sent-ico { width: 28px; height: 28px; border-radius: 50%; background: #10B981; color: #fff; display: grid; place-items: center; flex-shrink: 0; }
        .rl-sent span:last-child { display: flex; flex-direction: column; gap: 1px; }
        .rl-sent b { font-size: 0.9375rem; }
        .rl-sent small { font-size: 0.8125rem; color: #047857; }
      `}</style>
    </div>
  );
}

/** The dialog itself: kept separate from the data loading so it can be previewed. */
export function RequestDialog({ board, viewer, form: f, setForm: setF, sending, error, sentId, onSubmit, onClose }: {
  board: RequestBoard; viewer: Viewer; form: RequestForm; setForm: React.Dispatch<React.SetStateAction<RequestForm>>;
  sending: boolean; error: string | null; sentId: string | null;
  onSubmit: () => void; onClose: () => void;
}) {
  const [months, setMonths] = useState<number | 'custom' | null>(f.start && f.end ? 'custom' : null);
  const [editMe, setEditMe] = useState(false);
  const [more, setMore] = useState(!!(f.budget || f.sites || f.extra));
  const [localError, setLocalError] = useState<string | null>(null);
  const firstRef = useRef<HTMLInputElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);

  // Escape closes; the page behind doesn't scroll while the dialog is up.
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') closeRef.current(); };
    window.addEventListener('keydown', key);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', key); document.body.style.overflow = prev; };
  }, []);
  useEffect(() => { if ((viewer.kind === 'buyer' || viewer.kind === 'anon') && !sentId) firstRef.current?.focus({ preventScroll: true }); }, [viewer.kind, sentId]);

  const set = (k: keyof RequestForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF(prev => ({ ...prev, [k]: e.target.value }));
  const pickStart = (v: string) => setF(prev => ({ ...prev, start: v, end: v && typeof months === 'number' ? endAfter(v, months) : prev.end && prev.end < v ? '' : prev.end }));
  const pickMonths = (m: number | 'custom') => {
    setMonths(m);
    if (typeof m === 'number' && f.start) setF(prev => ({ ...prev, end: endAfter(prev.start, m) }));
  };
  const meComplete = viewer.kind === 'buyer' && !!(f.name.trim() && f.company.trim() && f.email.trim() && f.phone.trim());
  const showMe = editMe || !meComplete;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setLocalError(null);
    if (!f.start) { setLocalError('Pick the date your campaign starts.'); return; }
    if (!f.end) { setLocalError(months === 'custom' ? 'Pick the date your campaign ends.' : 'Choose how long you need the board.'); return; }
    if (f.end < f.start) { setLocalError('The end date must be on or after the start date.'); return; }
    if (!f.message.trim()) { setLocalError('Add a line about your campaign, so the owner can price it.'); return; }
    const anon = viewer.kind === 'anon';
    if (anon && f.account === 'existing') {
      if (!f.email.trim() || !f.password) { setLocalError('Enter your email and password.'); return; }
    } else if (!f.name.trim() || !f.company.trim() || !f.email.trim() || !f.phone.trim()) { setEditMe(true); setLocalError('Add your name, company, email and phone.'); return; }
    if (anon && f.account === 'new' && f.password.length < 8) { setLocalError('Choose a password of at least 8 characters.'); return; }
    if (anon && !/^\S+@\S+\.\S+$/.test(f.email.trim())) { setLocalError('Check your email address.'); return; }
    onSubmit();
  }

  const shownError = localError ?? error;

  const body = (
    <div className="rd-wrap" role="dialog" aria-modal="true" aria-labelledby="rd-title" data-request-dialog onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="rd">
        <header className="rd-head">
          <div className="rd-thumb">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {board.photo && <img src={board.photo} alt="" />}
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <p className="rd-eyebrow">{sentId ? 'Request sent' : 'Request this location'}</p>
            <h2 id="rd-title" className="rd-title">{board.name}</h2>
            {board.place && <p className="rd-place">{board.place}</p>}
          </div>
          <button type="button" className="rd-x" onClick={onClose} aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </header>

        {sentId ? (
          <div className="rd-body rd-done" data-request-sent>
            <div className="rd-check"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></div>
            <h3>Your request is with the owner</h3>
            <p>We&rsquo;ll email you as soon as they reply with a price for {f.start && f.end ? <>{fmtDate(f.start)} to {fmtDate(f.end)}</> : 'your dates'}.</p>
            <div className="rd-journey"><Journey active={1} /></div>
            <div className="rd-actions">
              <a href="/dashboard/agency/requests" className="rd-primary">Track it in My Requests</a>
              <button type="button" className="rd-ghost" onClick={onClose}>Keep browsing</button>
            </div>
          </div>
        ) : viewer.kind === 'loading' ? (
          <div className="rd-body"><p className="rd-muted">Loading…</p></div>
        ) : viewer.kind === 'other' ? (
          <div className="rd-body">
            <p className="rd-muted">Requests are sent from buyer accounts (agencies, brands and marketers). You&rsquo;re signed in with a {viewer.role} account.</p>
          </div>
        ) : (
          <form className="rd-form" onSubmit={submit} data-request-form noValidate>
            <div className="rd-body">
              {/* 1. Dates */}
              <section className="rd-sec">
                <h3><span>1</span>When do you need it?</h3>
                <div className="rd-row">
                  <label className="rd-field">
                    <span>Start date</span>
                    <input ref={firstRef} id="rq-start" type="date" min={todayStr()} value={f.start} onChange={e => pickStart(e.target.value)} />
                  </label>
                  {months === 'custom' && (
                    <label className="rd-field">
                      <span>End date</span>
                      <input id="rq-end" type="date" min={f.start || todayStr()} value={f.end} onChange={set('end')} />
                    </label>
                  )}
                </div>
                <div className="rd-chips" role="group" aria-label="How long">
                  {DURATIONS.map(m => (
                    <button key={m} type="button" className={months === m ? 'on' : ''} aria-pressed={months === m} onClick={() => pickMonths(m)}>
                      {m === 12 ? '1 year' : `${m} month${m === 1 ? '' : 's'}`}
                    </button>
                  ))}
                  <button type="button" className={months === 'custom' ? 'on' : ''} aria-pressed={months === 'custom'} onClick={() => pickMonths('custom')}>Other dates</button>
                </div>
                {f.start && f.end && f.end >= f.start && (
                  <p className="rd-span" data-span><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4.5" width="18" height="16" rx="2.5"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/></svg>
                    {fmtDate(f.start)} → {fmtDate(f.end)} <b>· {spanText(f.start, f.end)}</b></p>
                )}
              </section>

              {/* 2. Campaign */}
              <section className="rd-sec">
                <h3><span>2</span>What&rsquo;s the campaign?</h3>
                <div className="rd-chips rd-ideas">
                  {IDEAS.map(t => (
                    <button key={t} type="button" onClick={() => setF(prev => ({ ...prev, message: prev.message.trim() ? prev.message : `${t}. ` }))}>{t}</button>
                  ))}
                </div>
                <label className="rd-field">
                  <span className="rd-sr">About your campaign</span>
                  <textarea id="rq-message" rows={3} value={f.message} onChange={set('message')} placeholder="e.g. Launching a new drink in Lagos. We’d like a busy road and the board lit at night." />
                </label>
                {!more ? (
                  <button type="button" className="rd-link" onClick={() => setMore(true)}>+ Add a budget or other needs (optional)</button>
                ) : (
                  <div className="rd-more">
                    <div className="rd-row">
                      <label className="rd-field"><span>Budget, ₦ (optional)</span><input id="rq-budget" type="number" inputMode="numeric" min={0} value={f.budget} onChange={set('budget')} placeholder="e.g. 1500000" /></label>
                      <label className="rd-field"><span>Boards needed</span><input id="rq-sites" type="number" inputMode="numeric" min={1} value={f.sites} onChange={set('sites')} placeholder="1" /></label>
                    </div>
                    <label className="rd-field"><span>Anything else</span><input id="rq-extra" value={f.extra} onChange={set('extra')} placeholder="e.g. printing included, the face towards traffic" /></label>
                  </div>
                )}
              </section>

              {/* 3. Contact */}
              <section className="rd-sec">
                <h3><span>3</span>Your details</h3>
                {viewer.kind === 'anon' && (
                  <div className="rd-acct" role="tablist" aria-label="Account">
                    <button type="button" role="tab" aria-selected={f.account === 'new'} className={f.account === 'new' ? 'on' : ''} onClick={() => setF(prev => ({ ...prev, account: 'new' }))}>I&rsquo;m new here</button>
                    <button type="button" role="tab" aria-selected={f.account === 'existing'} className={f.account === 'existing' ? 'on' : ''} onClick={() => setF(prev => ({ ...prev, account: 'existing' }))}>I have an account</button>
                  </div>
                )}
                {viewer.kind === 'anon' && f.account === 'existing' ? (
                  <div className="rd-row">
                    <label className="rd-field"><span>Email</span><input id="rq-email" type="email" value={f.email} onChange={set('email')} autoComplete="email" /></label>
                    <label className="rd-field"><span>Password</span><input id="rq-password" type="password" value={f.password} onChange={set('password')} autoComplete="current-password" /></label>
                  </div>
                ) : !showMe ? (
                  <div className="rd-me" data-me-summary>
                    <div className="rd-av">{(f.name.trim()[0] ?? '?').toUpperCase()}</div>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <p className="rd-me-n">{f.name} · {f.company}</p>
                      <p className="rd-me-c">{f.email} · {f.phone}</p>
                    </div>
                    <button type="button" className="rd-link" onClick={() => setEditMe(true)}>Edit</button>
                  </div>
                ) : (
                  <>
                    <div className="rd-row">
                      <label className="rd-field"><span>Your name</span><input id="rq-name" value={f.name} onChange={set('name')} autoComplete="name" /></label>
                      <label className="rd-field"><span>Company</span><input id="rq-company" value={f.company} onChange={set('company')} autoComplete="organization" /></label>
                    </div>
                    <div className="rd-row">
                      <label className="rd-field"><span>Email</span><input id="rq-email" type="email" value={f.email} onChange={set('email')} autoComplete="email" /></label>
                      <label className="rd-field"><span>Phone</span><input id="rq-phone" type="tel" value={f.phone} onChange={set('phone')} autoComplete="tel" placeholder="080…" /></label>
                    </div>
                    {viewer.kind === 'anon' && (
                      <div className="rd-row">
                        <label className="rd-field"><span>Create a password</span><input id="rq-password" type="password" value={f.password} onChange={set('password')} autoComplete="new-password" placeholder="At least 8 characters" /></label>
                      </div>
                    )}
                  </>
                )}
                <p className="rd-fine">
                  {viewer.kind === 'anon' && f.account === 'new' ? <>This creates your free buyer account, so you can track replies. </> : null}
                  The owner sees your company and what you asked for. Your email and phone are shared only with our team.{' '}
                  <a href="/privacy" target="_blank" rel="noopener noreferrer" data-legal-notice>Privacy notice</a>
                </p>
              </section>
            </div>

            <footer className="rd-foot">
              {shownError && <p role="alert" className="rd-err">{shownError}</p>}
              <button type="submit" className="rd-primary" disabled={sending}>
                {sending ? 'Sending…' : viewer.kind === 'anon' && f.account === 'new' ? 'Create account and send request' : viewer.kind === 'anon' ? 'Sign in and send request' : 'Send request'}
              </button>
              <p className="rd-free">Free, and nothing is booked until you agree a price. By sending you agree to our <a href="/terms" target="_blank" rel="noopener noreferrer">Terms</a>.</p>
            </footer>
          </form>
        )}
      </div>
      <style>{DIALOG_CSS}</style>
    </div>
  );

  return typeof document === 'undefined' ? null : createPortal(body, document.body);
}

const DIALOG_CSS = `
.rd-wrap { position: fixed; inset: 0; z-index: 1200; background: rgba(15,23,42,.55); backdrop-filter: blur(3px); display: flex; align-items: center; justify-content: center; padding: 24px; animation: rdFade .18s ease-out; font-family: 'Inter', -apple-system, sans-serif; }
@keyframes rdFade { from { opacity: 0; } to { opacity: 1; } }
.rd { width: 100%; max-width: 540px; max-height: min(860px, calc(100dvh - 48px)); background: #fff; border-radius: 20px; box-shadow: 0 30px 80px -20px rgba(15,23,42,.5); display: flex; flex-direction: column; overflow: hidden; animation: rdIn .22s cubic-bezier(.2,.9,.3,1); }
@keyframes rdIn { from { opacity: 0; transform: translateY(12px) scale(.985); } to { opacity: 1; transform: none; } }
.rd-head { display: flex; align-items: center; gap: 14px; padding: 18px 18px 16px 20px; border-bottom: 1px solid #F1F5F9; }
.rd-thumb { width: 56px; height: 56px; border-radius: 12px; overflow: hidden; background: #E2E8F0; flex-shrink: 0; }
.rd-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.rd-eyebrow { margin: 0; font-size: 0.6875rem; font-weight: 700; color: #1B4F8A; text-transform: uppercase; letter-spacing: .06em; }
.rd-title { margin: 2px 0 0; font-size: 1.0625rem; font-weight: 800; color: #0F172A; line-height: 1.25; letter-spacing: -.01em; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.rd-place { margin: 2px 0 0; font-size: 0.8125rem; color: #64748B; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rd-x { width: 34px; height: 34px; border-radius: 50%; border: none; background: #F1F5F9; color: #0F172A; display: grid; place-items: center; cursor: pointer; flex-shrink: 0; align-self: flex-start; }
.rd-x:hover { background: #E2E8F0; }
.rd-form { display: flex; flex-direction: column; min-height: 0; flex: 1; }
.rd-body { padding: 6px 20px 20px; overflow-y: auto; overscroll-behavior: contain; flex: 1; }
.rd-sec { padding-top: 18px; }
.rd-sec + .rd-sec { margin-top: 4px; border-top: 1px solid #F1F5F9; }
.rd-sec h3 { display: flex; align-items: center; gap: 10px; margin: 0 0 12px; font-size: 0.9375rem; font-weight: 700; color: #0F172A; }
.rd-sec h3 span { width: 22px; height: 22px; border-radius: 50%; background: #EFF6FF; color: #1B4F8A; display: grid; place-items: center; font-size: 0.75rem; font-weight: 800; }
.rd-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.rd-row + .rd-row, .rd-more .rd-field { margin-top: 10px; }
.rd-field { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
.rd-field > span { font-size: 0.75rem; font-weight: 600; color: #475569; }
.rd-field input, .rd-field textarea { width: 100%; box-sizing: border-box; padding: 11px 12px; border-radius: 10px; border: 1.5px solid #E2E8F0; font-family: inherit; font-weight: 400; font-size: 0.9375rem; line-height: 1.4; color: #0F172A; background: #fff; outline: none; transition: border-color .12s, box-shadow .12s; }
.rd-field textarea { resize: vertical; min-height: 84px; }
.rd-field input:focus, .rd-field textarea:focus { border-color: #1B4F8A; box-shadow: 0 0 0 3px rgba(27,79,138,.12); }
.rd-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
.rd-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.rd-chips button { padding: 7px 13px; border-radius: 999px; border: 1.5px solid #E2E8F0; background: #fff; color: #334155; font-family: inherit; font-weight: 600; font-size: 0.8125rem; line-height: 1.2; cursor: pointer; transition: all .12s; }
.rd-chips button:hover { border-color: #94A3B8; }
.rd-chips button.on { background: #1B4F8A; border-color: #1B4F8A; color: #fff; }
.rd-ideas { margin: 0 0 10px; }
.rd-ideas button { padding: 5px 11px; font-size: 0.75rem; color: #475569; background: #F8FAFC; border-color: #F1F5F9; }
.rd-span { display: flex; align-items: center; gap: 7px; margin: 12px 0 0; padding: 9px 12px; border-radius: 10px; background: #F8FAFC; font-size: 0.8125rem; color: #334155; }
.rd-span svg { color: #1B4F8A; flex-shrink: 0; }
.rd-span b { color: #1B4F8A; font-weight: 700; }
.rd-link { padding: 0; border: none; background: none; color: #1B4F8A; font-family: inherit; font-weight: 600; font-size: 0.8125rem; line-height: 1.4; cursor: pointer; margin-top: 10px; }
.rd-link:hover { text-decoration: underline; }
.rd-more { margin-top: 12px; }
.rd-me { display: flex; align-items: center; gap: 12px; padding: 12px 14px; border-radius: 12px; border: 1.5px solid #E2E8F0; }
.rd-me .rd-link { margin: 0; }
.rd-av { width: 36px; height: 36px; border-radius: 50%; background: #1B4F8A; color: #fff; display: grid; place-items: center; font-weight: 700; flex-shrink: 0; }
.rd-me-n { margin: 0; font-size: 0.875rem; font-weight: 700; color: #0F172A; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rd-me-c { margin: 2px 0 0; font-size: 0.8125rem; color: #64748B; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rd-fine { margin: 10px 0 0; font-size: 0.75rem; color: #94A3B8; line-height: 1.5; }
.rd-fine a { color: #64748B; }
.rd-acct { display: flex; gap: 2px; padding: 3px; margin-bottom: 12px; border-radius: 11px; background: #F1F5F9; }
.rd-acct button { flex: 1; padding: 8px 10px; border: none; border-radius: 8px; background: none; color: #64748B; font-family: inherit; font-weight: 600; font-size: 0.8125rem; line-height: 1.2; cursor: pointer; transition: all .15s; }
.rd-acct button.on { background: #fff; color: #0F172A; box-shadow: 0 1px 3px rgba(15,23,42,.1); }
.rd-foot { padding: 14px 20px 18px; border-top: 1px solid #F1F5F9; background: #fff; }
.rd-err { margin: 0 0 10px; padding: 9px 12px; border-radius: 10px; background: #FEF2F2; border: 1px solid #FECACA; color: #B91C1C; font-size: 0.8125rem; }
.rd-primary { display: block; width: 100%; box-sizing: border-box; padding: 15px; border: none; border-radius: 12px; background: #1B4F8A; color: #fff; text-align: center; text-decoration: none; font-family: inherit; font-weight: 700; font-size: 0.9375rem; line-height: 1; cursor: pointer; box-shadow: 0 4px 16px rgba(27,79,138,.25); transition: background .15s; }
.rd-primary:hover { background: #163F70; }
.rd-primary:disabled { opacity: .7; cursor: wait; }
.rd-free { margin: 9px 0 0; text-align: center; font-size: 0.75rem; color: #64748B; }
.rd-free a { color: #1B4F8A; font-weight: 600; }
.rd-ghost { padding: 12px; border: none; background: none; color: #1B4F8A; font-family: inherit; font-weight: 600; font-size: 0.875rem; line-height: 1; cursor: pointer; text-decoration: none; text-align: center; }
.rd-block { display: block; margin-top: 6px; }
.rd-muted { margin: 16px 0 0; font-size: 0.875rem; color: #475569; line-height: 1.55; }
.rd-how { list-style: none; margin: 16px 0 0; padding: 0; display: flex; flex-direction: column; gap: 14px; }
.rd-how li { display: flex; gap: 12px; align-items: flex-start; }
.rd-how li > span { width: 26px; height: 26px; border-radius: 50%; background: #EFF6FF; color: #1B4F8A; display: grid; place-items: center; font-size: 0.8125rem; font-weight: 800; flex-shrink: 0; }
.rd-how b { display: block; font-size: 0.9375rem; color: #0F172A; }
.rd-how small { display: block; margin-top: 2px; font-size: 0.8125rem; color: #64748B; line-height: 1.45; }
.rd-done { text-align: center; padding: 28px 24px 24px; }
.rd-check { width: 56px; height: 56px; margin: 0 auto 14px; border-radius: 50%; background: #10B981; color: #fff; display: grid; place-items: center; box-shadow: 0 0 0 8px #ECFDF5; animation: rdPop .35s cubic-bezier(.2,1.4,.4,1); }
@keyframes rdPop { from { transform: scale(.6); opacity: 0; } to { transform: none; opacity: 1; } }
.rd-done h3 { margin: 0; font-size: 1.1875rem; font-weight: 800; color: #0F172A; letter-spacing: -.01em; }
.rd-done > p { margin: 6px auto 0; max-width: 360px; font-size: 0.875rem; color: #475569; line-height: 1.55; }
.rd-journey { margin: 22px 0 22px; padding: 16px 8px 12px; border-radius: 14px; background: #F8FAFC; }
.rd-actions { display: flex; flex-direction: column; gap: 4px; }
@media (max-width: 640px) {
  .rd-wrap { padding: 0; align-items: stretch; }
  .rd { max-width: none; max-height: none; height: 100dvh; border-radius: 0; animation-name: rdUp; }
  @keyframes rdUp { from { transform: translateY(30px); opacity: 0; } to { transform: none; opacity: 1; } }
  .rd-row { grid-template-columns: 1fr; }
  .rd-head { padding: 14px 14px 12px 16px; }
  .rd-body { padding: 4px 16px 18px; }
  .rd-foot { padding: 12px 16px calc(14px + env(safe-area-inset-bottom)); }
}
`;
