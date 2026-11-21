'use client';

// Admin financial view (061): every quotation with our cost, revenue and
// margin, the default quotation terms, and the email log. Admins only — the
// tables behind this page are closed to everyone else by row-level security.

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useDashboardRole } from '@/components/layout/DashboardLayout';
import { QuoteCard, QUOTE_SELECT, AQ_CSS, quoteState, type AdminQuote } from '@/components/quotations/AdminQuotations';
import { naira } from '@/lib/quotations';

type Settings = { validity_days: number; vat_rate: number; payment_terms: string; cancellation_terms: string; special_conditions: string; approved: boolean; updated_at: string };
type EmailRow = { id: number; kind: string; recipient: string; subject: string | null; status: string; error: string | null; created_at: string };
type Filter = 'open' | 'accepted' | 'closed' | 'all';

const FILTERS: [Filter, string][] = [['open', 'Open'], ['accepted', 'Accepted'], ['closed', 'Closed'], ['all', 'All']];
const fmt = (d: string) => new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export default function AdminQuotationsPage() {
  const role = useDashboardRole();
  const [quotes, setQuotes] = useState<AdminQuote[]>([]);
  const [buyers, setBuyers] = useState<Record<string, string>>({});
  const [emails, setEmails] = useState<EmailRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>('open');
  const [showTest, setShowTest] = useState(false);

  async function load() {
    const [q, e] = await Promise.all([
      supabase.from('quotations').select(QUOTE_SELECT).order('created_at', { ascending: false }).limit(300),
      supabase.from('email_log').select('id, kind, recipient, subject, status, error, created_at').order('created_at', { ascending: false }).limit(40),
    ]);
    if (q.error) {
      setError(/does not exist|schema cache/i.test(q.error.message) ? 'Run migration 061 in Supabase to switch on quotations.' : q.error.message);
      setLoading(false);
      return;
    }
    const rows = (q.data ?? []) as AdminQuote[];
    setQuotes(rows);
    setEmails((e.data ?? []) as EmailRow[]);
    const reqIds = [...new Set(rows.map(r => r.request_id).filter((x): x is string => !!x))];
    if (reqIds.length) {
      const { data: c } = await supabase.from('availability_request_contacts').select('request_id, company, name').in('request_id', reqIds);
      setBuyers(Object.fromEntries(((c ?? []) as { request_id: string; company: string | null; name: string | null }[]).map(x => [x.request_id, x.company ?? x.name ?? ''])));
    }
    setError(null);
    setLoading(false);
  }
  useEffect(() => { if (role === 'admin') (async () => { await load(); })(); }, [role]);

  const live = useMemo(() => quotes.filter(q => showTest || !q.is_test), [quotes, showTest]);
  const shown = live.filter(q => {
    const st = quoteState(q);
    if (filter === 'open') return st === 'draft' || st === 'sent' || st === 'expired';
    if (filter === 'accepted') return st === 'accepted';
    if (filter === 'closed') return ['declined', 'withdrawn', 'superseded'].includes(st);
    return true;
  });
  const sum = (xs: AdminQuote[], f: (q: AdminQuote) => number) => xs.reduce((a, q) => a + (Number(f(q)) || 0), 0);
  const sentOpen = live.filter(q => quoteState(q) === 'sent');
  const accepted = live.filter(q => q.status === 'accepted');
  const confirmed = accepted.filter(q => q.booking_confirmed_at);
  const failedEmails = emails.filter(e => e.status !== 'sent').length;

  if (role !== 'admin') return <div style={{ padding: 32, color: '#64748B', fontSize: '0.875rem' }}>Admins only.</div>;

  return (
    <div className="qp">
      <header className="qp-head">
        <div>
          <h1>Quotations</h1>
          <p>Our selling prices, what we pay owners and suppliers, and what we keep. Build quotations from a request on the <a href="/dashboard/admin/requests">Requests</a> page.</p>
        </div>
      </header>

      {error && <div className="qp-err">{error}</div>}

      <div className="qp-kpis" data-finance>
        <div><small>Open quotations</small><b>{sentOpen.length}</b><span>{naira(sum(sentOpen, q => q.total))} incl. VAT</span></div>
        <div><small>Accepted</small><b>{accepted.length}</b><span>{naira(sum(accepted, q => q.total - q.vat_amount))} excl. VAT</span></div>
        <div><small>Confirmed bookings</small><b>{confirmed.length}</b><span>{naira(sum(confirmed, q => q.total - q.vat_amount))} excl. VAT</span></div>
        <div className="int"><small>Our revenue, confirmed</small><b>{naira(sum(confirmed, q => q.platform_revenue))}</b><span>accepted not yet confirmed: {naira(sum(accepted.filter(q => !q.booking_confirmed_at), q => q.platform_revenue))}</span></div>
        <div><small>Received</small><b>{naira(sum(accepted, q => q.amount_paid))}</b><span>of {naira(sum(accepted, q => q.total))} accepted</span></div>
      </div>

      <div className="qp-bar">
        <div className="qp-tabs">
          {FILTERS.map(([k, t]) => <button key={k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>{t}</button>)}
        </div>
        <label className="qp-check"><input type="checkbox" checked={showTest} onChange={e => setShowTest(e.target.checked)} /> Show test quotations</label>
      </div>

      {loading ? <div className="qp-box">Loading…</div> : shown.length === 0 ? (
        <div className="qp-box">No quotations here yet.</div>
      ) : (
        <div className="qp-list">
          {shown.map(q => (
            <div key={q.id}>
              {q.request_id && buyers[q.request_id] ? <p className="qp-buyer">{buyers[q.request_id]}</p> : null}
              <QuoteCard q={q} onChanged={load} showRequestLink />
            </div>
          ))}
        </div>
      )}

      <SettingsPanel />

      <section className="qp-sec">
        <h2>Email log {failedEmails ? <span className="qp-bad">{failedEmails} not sent</span> : null}</h2>
        <p className="qp-muted">Every quotation email we tried to send. &ldquo;Skipped&rdquo; means email is not set up on the server.</p>
        {emails.length === 0 ? <p className="qp-muted">Nothing yet.</p> : (
          <div className="qp-table">
            {emails.map(e => (
              <div key={e.id} className="qp-tr">
                <span className={`qp-st ${e.status}`}>{e.status}</span>
                <span>{e.kind.replace('quotation_', '').replace('_', ' ')}</span>
                <span className="qp-to">{e.recipient}</span>
                <span className="qp-muted">{fmt(e.created_at)}</span>
                {e.error && <span className="qp-bad-t">{e.error}</span>}
              </div>
            ))}
          </div>
        )}
      </section>

      <style>{AQ_CSS + QP_CSS}</style>
    </div>
  );
}

/** Default quotation terms. They stay marked as drafts until the business owner approves them. */
function SettingsPanel() {
  const [s, setS] = useState<Settings | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('commercial_settings').select('validity_days, vat_rate, payment_terms, cancellation_terms, special_conditions, approved, updated_at').eq('id', 1).maybeSingle();
      setS(data as Settings | null);
      if (data) setSaved(JSON.stringify(data));
    })();
  }, []);
  if (!s) return null;
  const save = async () => {
    setBusy(true); setMsg(null);
    const { data: { session } } = await supabase.auth.getSession();
    const { data, error } = await supabase.from('commercial_settings').update({
      validity_days: Number(s.validity_days), vat_rate: Number(s.vat_rate), payment_terms: s.payment_terms,
      cancellation_terms: s.cancellation_terms, special_conditions: s.special_conditions, approved: s.approved,
      updated_by: session?.user.id ?? null, updated_at: new Date().toISOString(),
    }).eq('id', 1).select('updated_at');
    setBusy(false);
    // An update that matches no row (e.g. not signed in as admin) returns no error, so check a row came back.
    if (error || !data?.length) { setMsg(`Not saved. ${error?.message ?? 'Sign in with an admin account and try again.'}`); return; }
    setSaved(JSON.stringify(s));
    setMsg('Saved. New quotations use these defaults; existing ones keep their own terms.');
  };
  const dirty = saved !== null && saved !== JSON.stringify(s);
  return (
    <section className="qp-sec" data-commercial-settings>
      <h2>Default terms for new quotations {!s.approved && <span className="qp-bad">Draft — not yet approved</span>}</h2>
      <p className="qp-muted">These fill in each new quotation and can be changed per quotation. They are a starting point, not legal advice.</p>
      <div className="aq-grid">
        <label>Valid for (days)<input type="number" min={1} max={90} className="aq-in" value={s.validity_days} onChange={e => setS({ ...s, validity_days: Number(e.target.value) })} /></label>
        <label>VAT %<input type="number" min={0} max={100} step={0.5} className="aq-in" value={s.vat_rate} onChange={e => setS({ ...s, vat_rate: Number(e.target.value) })} /></label>
        <label className="wide">Payment terms<textarea className="aq-in" rows={2} value={s.payment_terms} onChange={e => setS({ ...s, payment_terms: e.target.value })} /></label>
        <label className="wide">Cancellation terms<textarea className="aq-in" rows={2} value={s.cancellation_terms} onChange={e => setS({ ...s, cancellation_terms: e.target.value })} /></label>
        <label className="wide">Special conditions<textarea className="aq-in" rows={2} value={s.special_conditions} onChange={e => setS({ ...s, special_conditions: e.target.value })} /></label>
      </div>
      <label className="aq-check" style={{ marginTop: 8 }}><input type="checkbox" checked={s.approved} onChange={e => setS({ ...s, approved: e.target.checked })} /> The business owner has approved these terms</label>
      <div className="aq-actions" style={{ alignItems: 'center' }}>
        <button className="aq-btn primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save defaults'}</button>
        {dirty && !busy && <span data-unsaved style={{ fontSize: '0.75rem', fontWeight: 600, color: '#B45309' }}>Not saved yet. Press Save defaults.</span>}
      </div>
      {msg && <p className="aq-muted" style={{ marginTop: 6 }}>{msg}</p>}
    </section>
  );
}

const QP_CSS = `
.qp { max-width: 1080px; margin: 0 auto; padding: 8px 0 56px; font-family: 'Inter', -apple-system, sans-serif; }
.qp-head h1 { margin: 0; font-size: 1.625rem; font-weight: 800; color: #0F172A; letter-spacing: -0.025em; }
.qp-head p { margin: 6px 0 18px; max-width: 620px; font-size: 0.875rem; color: #64748B; line-height: 1.5; }
.qp-head a { color: #1B4F8A; }
.qp-err { padding: 12px 14px; border-radius: 12px; border: 1px solid #FECACA; background: #FEF2F2; color: #B91C1C; font-size: 0.8125rem; margin-bottom: 14px; }
.qp-kpis { display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; margin-bottom: 16px; }
.qp-kpis div { background: #fff; border: 1px solid #E8EDF3; border-radius: 14px; padding: 12px 14px; min-width: 0; }
.qp-kpis div.int { background: #FAF5FF; border-color: #E9D5FF; }
.qp-kpis small { display: block; font-size: 0.6875rem; font-weight: 700; color: #64748B; }
.qp-kpis b { display: block; font-size: 1.25rem; font-weight: 800; color: #0F172A; letter-spacing: -0.02em; margin: 2px 0; }
.qp-kpis span { font-size: 0.6875rem; color: #94A3B8; }
.qp-bar { display: flex; gap: 10px; align-items: center; justify-content: space-between; flex-wrap: wrap; margin-bottom: 12px; }
.qp-tabs { display: inline-flex; gap: 2px; padding: 3px; border-radius: 11px; background: #F1F5F9; }
.qp-tabs button { padding: 7px 12px; border: none; border-radius: 8px; background: none; color: #64748B; font-family: inherit; font-weight: 600; font-size: 0.8125rem; cursor: pointer; }
.qp-tabs button.on { background: #fff; color: #0F172A; box-shadow: 0 1px 3px rgba(15,23,42,.1); }
.qp-check { display: flex; gap: 6px; align-items: center; font-size: 0.75rem; color: #475569; }
.qp-box { padding: 22px; border-radius: 14px; background: #fff; border: 1px dashed #CBD5E1; color: #64748B; font-size: 0.875rem; text-align: center; }
.qp-list { display: flex; flex-direction: column; gap: 10px; }
.qp-buyer { margin: 0 0 4px 2px; font-size: 0.75rem; font-weight: 700; color: #334155; }
.qp-sec { margin-top: 26px; background: #fff; border: 1px solid #E8EDF3; border-radius: 16px; padding: 16px; }
.qp-sec h2 { margin: 0 0 4px; font-size: 1rem; font-weight: 800; color: #0F172A; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.qp-muted { font-size: 0.75rem; color: #64748B; margin: 0 0 10px; }
.qp-bad { font-size: 0.6875rem; font-weight: 700; color: #92400E; background: #FEF3C7; padding: 2px 8px; border-radius: 6px; }
.qp-table { display: flex; flex-direction: column; }
.qp-tr { display: flex; flex-wrap: wrap; gap: 4px 12px; align-items: center; padding: 7px 0; border-top: 1px solid #F1F5F9; font-size: 0.75rem; color: #334155; }
.qp-to { flex: 1; min-width: 160px; word-break: break-all; }
.qp-st { font-weight: 800; text-transform: uppercase; font-size: 0.625rem; padding: 2px 7px; border-radius: 6px; background: #ECFDF5; color: #047857; }
.qp-st.failed { background: #FEF2F2; color: #B91C1C; }
.qp-st.skipped { background: #FEF3C7; color: #92400E; }
.qp-bad-t { width: 100%; color: #B91C1C; }
@media (max-width: 860px) { .qp-kpis { grid-template-columns: 1fr 1fr; } }
`;
