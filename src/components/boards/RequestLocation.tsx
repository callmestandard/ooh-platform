'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { sendBoardRequest } from '@/lib/availability-requests';
import { track } from '@/lib/track';

/**
 * "Request this location" on a public board page (MVP core loop).
 * Logged out → sign in / create a buyer account, then come straight back
 * here with the form open. Buyer (agency role) → the request form.
 * Any other role → a short explanation.
 *
 * Opens when the URL has ?request=1 or #request, or when the page dispatches
 * the "ooh:request-location" event (the page's CTA buttons do this).
 */
export const OPEN_REQUEST_EVENT = 'ooh:request-location';

type Viewer =
  | { kind: 'loading' }
  | { kind: 'anon' }
  | { kind: 'other'; role: string }
  | { kind: 'buyer'; name: string; company: string; email: string; phone: string };

const today = () => new Date().toISOString().slice(0, 10);

const field: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '11px 12px', borderRadius: 10,
  border: '1.5px solid #E2E8F0', fontSize: '0.9375rem', color: '#0F172A', background: '#fff',
  fontFamily: 'inherit', outline: 'none',
};
const lbl: React.CSSProperties = { display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#475569', marginBottom: 5 };
const primary: React.CSSProperties = {
  display: 'block', width: '100%', textAlign: 'center', boxSizing: 'border-box',
  background: '#1B4F8A', color: '#fff', border: 'none', borderRadius: 12, padding: '15px',
  fontSize: '0.9375rem', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', textDecoration: 'none',
  boxShadow: '0 4px 16px rgba(27,79,138,0.25)',
};

export default function RequestLocation({ board, compact }: { board: { id: string; name: string; status: string }; compact?: boolean }) {
  const [viewer, setViewer] = useState<Viewer>({ kind: 'loading' });
  const [open, setOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentId, setSentId] = useState<string | null>(null);
  const [f, setF] = useState({ name: '', company: '', email: '', phone: '', start: '', end: '', message: '', budget: '', sites: '', extra: '' });
  const sectionRef = useRef<HTMLDivElement>(null);
  const returnTo = `/boards/${board.id}?request=1`;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { if (!cancelled) setViewer({ kind: 'anon' }); return; }
      const { data: p } = await supabase.from('profiles').select('role, full_name, company_name, phone').eq('id', session.user.id).maybeSingle();
      if (cancelled) return;
      if (p?.role !== 'agency') { setViewer({ kind: 'other', role: p?.role ?? 'unknown' }); return; }
      const v = { kind: 'buyer' as const, name: p.full_name ?? '', company: p.company_name ?? '', email: session.user.email ?? '', phone: p.phone ?? '' };
      setViewer(v);
      setF(prev => ({ ...prev, name: prev.name || v.name, company: prev.company || v.company, email: prev.email || v.email, phone: prev.phone || v.phone }));
    })();
    return () => { cancelled = true; };
  }, []);

  const start = useCallback(() => {
    track('request_open', board.id);
    setOpen(true);
    requestAnimationFrame(() => sectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }, [board.id]);

  // Open from ?request=1 (after login), #request, or the page's CTA buttons.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get('request') === '1' || window.location.hash === '#request') queueMicrotask(start);
    const onEvent = () => start();
    window.addEventListener(OPEN_REQUEST_EVENT, onEvent);
    return () => window.removeEventListener(OPEN_REQUEST_EVENT, onEvent);
  }, [start]);

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF(prev => ({ ...prev, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (f.end && f.start && f.end < f.start) { setError('The end date must be on or after the start date.'); return; }
    setSending(true);
    const { id, error } = await sendBoardRequest({
      boardId: board.id, startDate: f.start, endDate: f.end,
      name: f.name, company: f.company, email: f.email, phone: f.phone, message: f.message,
      budget: Number(f.budget) > 0 ? Number(f.budget) : null,
      sites: Number(f.sites) > 0 ? Math.round(Number(f.sites)) : null,
      extra: f.extra,
    });
    setSending(false);
    if (error) { setError(error); return; }
    setSentId(id);
  }

  const isBooked = board.status === 'booked';

  return (
    <div id="request" ref={sectionRef} style={compact
      ? { scrollMarginTop: 84 }
      : { background: '#fff', borderTop: '1px solid #F1F5F9', borderBottom: '1px solid #F1F5F9', padding: 16, margin: '8px 0', scrollMarginTop: 72 }}>
      {!compact && <p style={{ fontSize: '0.625rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.07em', margin: '0 0 6px' }}>Request this location</p>}

      {sentId ? (
        <div data-request-sent style={{ background: '#ECFDF5', border: '1px solid #A7F3D0', borderRadius: 12, padding: 16 }}>
          <p style={{ fontSize: '1rem', fontWeight: 700, color: '#065F46', margin: '0 0 6px' }}>Request sent</p>
          <p style={{ fontSize: '0.875rem', color: '#065F46', margin: '0 0 14px', lineHeight: 1.55 }}>
            We&rsquo;ve passed your request for {board.name} to the media owner. You&rsquo;ll be notified when they reply with availability or a quote.
          </p>
          <a href="/dashboard/agency/requests" style={{ ...primary, background: '#065F46', boxShadow: 'none' }}>Track it in My Requests</a>
        </div>
      ) : viewer.kind === 'loading' ? (
        <p style={{ fontSize: '0.875rem', color: '#94A3B8', margin: 0 }}>Loading…</p>
      ) : !open ? (
        <>
          {/* The board page explains the steps itself, so the compact form skips this. */}
          {(!compact || isBooked) && <p style={{ fontSize: '0.875rem', color: '#475569', margin: '0 0 12px', lineHeight: 1.55 }}>
            {isBooked
              ? 'This board is currently booked. Tell us your campaign dates and we’ll ask the owner when it is free.'
              : 'Tell us your campaign dates. The media owner replies with availability and a price, and our team helps you complete the booking.'}
          </p>}
          <button type="button" onClick={start} style={primary}>Request this location</button>
        </>
      ) : viewer.kind === 'anon' ? (
        <>
          <p style={{ fontSize: '0.875rem', color: '#475569', margin: '0 0 12px', lineHeight: 1.55 }}>
            Sign in or create a free buyer account to send your request. You&rsquo;ll come straight back to this board.
          </p>
          <a href={`/auth/login?redirect=${encodeURIComponent(returnTo)}`} style={primary}>Sign in to request</a>
          <a href={`/signup?role=agency&redirect=${encodeURIComponent(returnTo)}`}
            style={{ ...primary, background: '#fff', color: '#1B4F8A', border: '1.5px solid #BFDBFE', boxShadow: 'none', marginTop: 10 }}>
            Create a buyer account
          </a>
        </>
      ) : viewer.kind === 'other' ? (
        <p style={{ fontSize: '0.875rem', color: '#475569', margin: 0, lineHeight: 1.55 }}>
          Requests are sent from buyer accounts (agencies, brands and marketers). You&rsquo;re signed in with a {viewer.role} account.
        </p>
      ) : (
        <form onSubmit={submit} data-request-form>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
            <div><label style={lbl} htmlFor="rq-start">Campaign start *</label><input id="rq-start" type="date" required min={today()} value={f.start} onChange={set('start')} style={field} /></div>
            <div><label style={lbl} htmlFor="rq-end">Campaign end *</label><input id="rq-end" type="date" required min={f.start || today()} value={f.end} onChange={set('end')} style={field} /></div>
          </div>
          <div style={{ marginBottom: 10 }}>
            <label style={lbl} htmlFor="rq-message">Message / campaign requirement *</label>
            <textarea id="rq-message" required rows={3} value={f.message} onChange={set('message')} placeholder="e.g. Product launch for a telecom brand. Need a high-traffic site for 3 months." style={{ ...field, resize: 'vertical' }} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
            <div><label style={lbl} htmlFor="rq-name">Your name *</label><input id="rq-name" required value={f.name} onChange={set('name')} autoComplete="name" style={field} /></div>
            <div><label style={lbl} htmlFor="rq-company">Company *</label><input id="rq-company" required value={f.company} onChange={set('company')} autoComplete="organization" style={field} /></div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
            <div><label style={lbl} htmlFor="rq-email">Email *</label><input id="rq-email" type="email" required value={f.email} onChange={set('email')} autoComplete="email" style={field} /></div>
            <div><label style={lbl} htmlFor="rq-phone">Phone *</label><input id="rq-phone" type="tel" required value={f.phone} onChange={set('phone')} autoComplete="tel" placeholder="080…" style={field} /></div>
          </div>

          <details style={{ marginBottom: 14 }}>
            <summary style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#1B4F8A', cursor: 'pointer' }}>Add budget and other details (optional)</summary>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, margin: '10px 0' }}>
              <div><label style={lbl} htmlFor="rq-budget">Budget (₦)</label><input id="rq-budget" type="number" min={0} value={f.budget} onChange={set('budget')} style={field} /></div>
              <div><label style={lbl} htmlFor="rq-sites">Sites needed</label><input id="rq-sites" type="number" min={1} value={f.sites} onChange={set('sites')} style={field} /></div>
            </div>
            <label style={lbl} htmlFor="rq-extra">Additional requirements</label>
            <textarea id="rq-extra" rows={2} value={f.extra} onChange={set('extra')} placeholder="e.g. printing included, specific face, illumination" style={{ ...field, resize: 'vertical' }} />
          </details>

          <p style={{ fontSize: '0.75rem', color: '#94A3B8', margin: '0 0 12px', lineHeight: 1.5 }}>
            The media owner sees your company and request. Your email and phone are shared only with our team.
          </p>
          {error && <p role="alert" style={{ fontSize: '0.8125rem', color: '#B91C1C', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: '8px 10px', margin: '0 0 12px' }}>{error}</p>}
          <button type="submit" disabled={sending} style={{ ...primary, opacity: sending ? 0.7 : 1, cursor: sending ? 'wait' : 'pointer' }}>
            {sending ? 'Sending…' : 'Send request'}
          </button>
        </form>
      )}
    </div>
  );
}
