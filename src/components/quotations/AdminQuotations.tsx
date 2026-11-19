'use client';

// Admin quotations (061): build our selling price from the owner's private
// price, send it to the buyer, and follow it through to a confirmed booking.
// Everything on this screen marked "internal" is admin-only; the buyer sees
// the quotation through my_quotations(), the PDF and the email.

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import {
  PRICING_MODES, EXTRA_KINDS, QUOTE_STATUS, lineTotals, quoteTotals, quoteProblems, monthsBetween, naira,
  type LineKind, type PricingMode,
} from '@/lib/quotations';
import { notifyQuotation, downloadQuotationPdf } from '@/lib/quotations-client';

export type QuoteRequest = {
  id: string; agency_id: string; stage: string; start_date: string; end_date: string; board_id: string | null;
  board: { id: string; name: string; city: string | null; area: string | null } | null;
  reply?: { available_from: string | null; available_to: string | null } | null;
};

type Line = {
  id?: string; position?: number; kind: LineKind; board_id: string | null; request_id: string | null; description: string;
  start_date: string | null; end_date: string | null; months: number;
  owner_net_monthly: number | null; pricing_mode: PricingMode | null; pricing_value: number | null;
  amount: number | null; cost: number | null; sell_monthly?: number | null; line_total?: number; line_cost?: number;
};
export type AdminQuote = {
  id: string; ref: string; status: string; request_id: string | null; request_ids: string[]; agency_id: string; title: string | null;
  issued_on: string | null; valid_until: string | null; vat_rate: number; payment_terms: string | null; cancellation_terms: string | null;
  special_conditions: string | null; buyer_note: string | null; subtotal: number; discount_total: number; vat_amount: number; total: number;
  owner_cost_total: number; platform_revenue: number; revised_from: string | null; campaign_id: string | null;
  payment_status: string; amount_paid: number; is_test: boolean; created_at: string; sent_at: string | null; accepted_at: string | null;
  declined_at: string | null; decline_reason: string | null; withdrawn_at: string | null; withdraw_reason: string | null; booking_confirmed_at: string | null;
  lines: Line[]; events: { event: string; note: string | null; created_at: string }[];
};
type Settings = { validity_days: number; vat_rate: number; payment_terms: string; cancellation_terms: string; special_conditions: string; approved: boolean };

export const QUOTE_SELECT = '*, lines:quotation_lines(*), events:quotation_events(event, note, created_at)';

const today = () => new Date(Date.now() + 3600_000).toISOString().slice(0, 10); // Lagos is UTC+1
const addDays = (d: string, n: number) => new Date(new Date(d).getTime() + n * 86_400_000).toISOString().slice(0, 10);
const fmt = (d: string | null) => (d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
export const quoteState = (q: Pick<AdminQuote, 'status' | 'valid_until'>) =>
  q.status === 'sent' && q.valid_until && q.valid_until < today() ? 'expired' : q.status;
const errText = (m: string) => (/relation .*quotations|does not exist|schema cache/i.test(m) ? 'Run migration 061 in Supabase to switch on quotations.' : m);

export function QuoteStatusTag({ q }: { q: Pick<AdminQuote, 'status' | 'valid_until'> }) {
  const s = QUOTE_STATUS[quoteState(q)] ?? QUOTE_STATUS.draft;
  return <span className="aq-tag" style={{ color: s.tone, borderColor: s.tone + '55', background: s.tone + '12' }}>{s.label}</span>;
}

/** Latest owner price per request id (admins read request_owner_prices). */
export async function loadOwnerPrices(requestIds: string[]): Promise<Record<string, number>> {
  if (!requestIds.length) return {};
  const { data, error } = await supabase.from('request_owner_prices').select('request_id, owner_net_monthly, recorded_at')
    .in('request_id', requestIds).order('recorded_at', { ascending: false });
  if (error) return {};
  const out: Record<string, number> = {};
  for (const r of (data ?? []) as { request_id: string; owner_net_monthly: number }[]) if (!(r.request_id in out)) out[r.request_id] = Number(r.owner_net_monthly);
  return out;
}

/** The quotations panel inside a request's Manage area. */
export function RequestQuotations({ r, siblings, ownerPrices, onChanged }: {
  r: QuoteRequest; siblings: QuoteRequest[]; ownerPrices: Record<string, number>; onChanged: () => Promise<void>;
}) {
  const [quotes, setQuotes] = useState<AdminQuote[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState<AdminQuote | 'new' | null>(null);

  async function load() {
    const { data, error } = await supabase.from('quotations').select(QUOTE_SELECT).contains('request_ids', [r.id]).order('created_at', { ascending: false });
    if (error) { setErr(errText(error.message)); setQuotes([]); return; }
    setQuotes((data ?? []) as AdminQuote[]);
  }
  useEffect(() => { (async () => { await load(); })(); }, [r.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = async () => { await load(); await onChanged(); };
  const open = quotes?.find(q => q.status === 'draft' || q.status === 'sent' || q.status === 'accepted');
  const canQuote = ['requested', 'owner_responded', 'quote_received', 'negotiating'].includes(r.stage);

  return (
    <div data-quotations className="aq">
      <div className="aq-h">
        <p className="aq-label">Quotation</p>
        {canQuote && !editing && !open && quotes && !err && (
          <button className="aq-btn primary" onClick={() => setEditing('new')}>Build quotation</button>
        )}
      </div>
      {err && <p className="aq-err">{err}</p>}
      {quotes === null ? <p className="aq-muted">Loading…</p> : quotes.length === 0 && !editing ? (
        <p className="aq-muted">{ownerPrices[r.id] ? `Owner's price on file: ${naira(ownerPrices[r.id])}/month (internal). ` : 'No owner price yet — record it above first. '}
          No quotation yet. The buyer sees nothing until you send one.</p>
      ) : null}
      {editing && (
        <QuotationEditor r={r} siblings={siblings} ownerPrices={ownerPrices} quote={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await refresh(); }} />
      )}
      {quotes?.map(q => (editing && editing !== 'new' && editing.id === q.id) ? null : (
        <QuoteCard key={q.id} q={q} onEdit={() => setEditing(q)} onChanged={refresh} />
      ))}
      <style>{AQ_CSS}</style>
    </div>
  );
}

/** One quotation: totals, internal margin, and the actions its status allows. */
export function QuoteCard({ q, onEdit, onChanged, showRequestLink }: { q: AdminQuote; onEdit?: () => void; onChanged: () => Promise<void>; showRequestLink?: boolean }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const [panel, setPanel] = useState<'withdraw' | 'extend' | 'pay' | null>(null);
  const [reason, setReason] = useState('');
  const [until, setUntil] = useState(q.valid_until && q.valid_until > today() ? q.valid_until : addDays(today(), 7));
  const [payStatus, setPayStatus] = useState(q.payment_status);
  const [paid, setPaid] = useState(String(q.amount_paid ?? 0));
  const state = quoteState(q);
  const margin = q.subtotal - q.discount_total > 0 ? (q.platform_revenue / (q.subtotal - q.discount_total)) * 100 : null;
  const questions = q.events.filter(e => e.event === 'clarification');

  const act = async (key: string, fn: () => PromiseLike<{ error: { message: string } | null }>, email?: Parameters<typeof notifyQuotation>[1], done?: string) => {
    setBusy(key); setMsg(null);
    const { error } = await fn();
    if (error) { setBusy(null); setMsg({ text: errText(error.message), bad: true }); return; }
    let text = done ?? 'Saved.';
    let bad = false;
    if (email) {
      const res = await notifyQuotation(q.id, email);
      if (res == null || (!res.already && !res.sent)) {
        bad = true;
        text += ' The email did not go out (email may not be set up) — tell the buyer another way.';
      } else if (res.sent) text += ' Email sent.';
    }
    setBusy(null); setPanel(null); setMsg({ text, bad });
    await onChanged();
  };

  const send = () => act('send', () => supabase.rpc('admin_send_quotation', { p_id: q.id }), 'sent', 'Quotation sent.');
  const resend = () => act('resend', async () => ({ error: null }), 'resend', 'Resent.');
  const revise = () => act('revise', () => supabase.rpc('admin_revise_quotation', { p_id: q.id }), undefined, 'Revision created as a draft. Edit it, then send — it replaces this one.');
  const withdraw = () => act('withdraw', () => supabase.rpc('admin_withdraw_quotation', { p_id: q.id, p_reason: reason }), q.status === 'sent' ? 'withdrawn' : undefined, 'Withdrawn.');
  const extend = () => act('extend', () => supabase.rpc('admin_extend_quotation', { p_id: q.id, p_valid_until: until, p_note: reason || null }), undefined, `Valid until ${fmt(until)}.`);
  const confirm = () => act('confirm', () => supabase.rpc('admin_confirm_quotation_booking', { p_id: q.id, p_message: reason || null }), 'confirmed', 'Booking confirmed.');
  const pay = () => act('pay', () => supabase.rpc('admin_set_quotation_payment', { p_id: q.id, p_status: payStatus, p_amount: Number(paid) || 0 }), undefined, 'Payment saved.');
  const pdf = async () => { setBusy('pdf'); const e = await downloadQuotationPdf(q.id, q.ref); setBusy(null); if (e) setMsg({ text: e, bad: true }); };

  return (
    <div className="aq-card" data-quote={q.ref}>
      <div className="aq-top">
        <div>
          <p className="aq-ref"><b>{q.ref}</b> <QuoteStatusTag q={q} />{q.is_test && <span className="aq-tag test">Test</span>}</p>
          <p className="aq-sub">
            {q.title ? `${q.title} · ` : ''}{q.lines.filter(l => l.kind === 'board').length} board{q.lines.filter(l => l.kind === 'board').length === 1 ? '' : 's'}
            {q.sent_at ? ` · sent ${fmt(q.sent_at)}` : ` · created ${fmt(q.created_at)}`}
            {q.status === 'sent' || q.status === 'draft' ? ` · valid until ${fmt(q.valid_until)}` : ''}
            {q.accepted_at ? ` · accepted ${fmt(q.accepted_at)}` : ''}
            {q.booking_confirmed_at ? ` · booking confirmed ${fmt(q.booking_confirmed_at)}` : ''}
            {showRequestLink && q.request_id ? <> · <a href={`/dashboard/admin/requests`}>request</a></> : null}
          </p>
        </div>
        <div className="aq-total"><b>{naira(q.total)}</b><span>incl. VAT {naira(q.vat_amount)}</span></div>
      </div>

      <div className="aq-fin" title="Internal — the buyer never sees this">
        <span>Internal</span>
        <div><small>Owner &amp; supplier cost</small><b>{naira(q.owner_cost_total)}</b></div>
        <div><small>Our revenue</small><b className={q.platform_revenue < 0 ? 'neg' : ''}>{naira(q.platform_revenue)}</b></div>
        <div><small>Margin</small><b>{margin == null ? '—' : `${margin.toFixed(1)}%`}</b></div>
        {q.status === 'accepted' && <div><small>Payment</small><b>{q.payment_status.replace('_', ' ')}{q.amount_paid ? ` · ${naira(q.amount_paid)}` : ''}</b></div>}
      </div>

      {q.decline_reason && <p className="aq-note">Buyer declined: {q.decline_reason}</p>}
      {q.withdraw_reason && <p className="aq-note">Withdrawn: {q.withdraw_reason}</p>}
      {questions.length > 0 && (
        <div className="aq-qs">
          {questions.map((e, i) => <p key={i}><b>Buyer asked {fmt(e.created_at)}:</b> {e.note}</p>)}
          <p className="aq-muted">Answer by phone or email, then revise the quotation if anything changes.</p>
        </div>
      )}

      <div className="aq-actions">
        {q.status === 'draft' && onEdit && <button className="aq-btn" onClick={onEdit} disabled={!!busy}>Edit</button>}
        {q.status === 'draft' && <button className="aq-btn primary" onClick={send} disabled={!!busy}>{busy === 'send' ? 'Sending…' : 'Send to buyer'}</button>}
        <button className="aq-btn" onClick={pdf} disabled={!!busy}>{busy === 'pdf' ? 'Preparing…' : 'PDF'}</button>
        {q.status === 'sent' && <button className="aq-btn" onClick={resend} disabled={!!busy}>{busy === 'resend' ? 'Sending…' : 'Resend email'}</button>}
        {(q.status === 'sent' || q.status === 'draft') && <button className="aq-btn" onClick={() => setPanel(panel === 'extend' ? null : 'extend')} disabled={!!busy}>{state === 'expired' ? 'Extend (expired)' : 'Extend'}</button>}
        {['sent', 'declined', 'withdrawn'].includes(q.status) && <button className="aq-btn" onClick={revise} disabled={!!busy}>{busy === 'revise' ? 'Copying…' : 'Revise'}</button>}
        {q.status === 'accepted' && !q.booking_confirmed_at && <button className="aq-btn primary" onClick={confirm} disabled={!!busy}>{busy === 'confirm' ? 'Confirming…' : 'Confirm booking'}</button>}
        {q.status === 'accepted' && <button className="aq-btn" onClick={() => setPanel(panel === 'pay' ? null : 'pay')} disabled={!!busy}>Payment</button>}
        {(q.status === 'sent' || q.status === 'draft') && <button className="aq-btn danger" onClick={() => setPanel(panel === 'withdraw' ? null : 'withdraw')} disabled={!!busy}>Withdraw</button>}
      </div>

      {panel === 'withdraw' && (
        <div className="aq-panel">
          <input value={reason} onChange={e => setReason(e.target.value)} placeholder="Reason (the buyer sees this)" aria-label="Reason" />
          <button className="aq-btn danger" onClick={withdraw} disabled={!!busy}>{busy === 'withdraw' ? 'Withdrawing…' : 'Withdraw quotation'}</button>
        </div>
      )}
      {panel === 'extend' && (
        <div className="aq-panel">
          <input type="date" value={until} min={today()} onChange={e => setUntil(e.target.value)} aria-label="Valid until" style={{ maxWidth: 170 }} />
          <input value={reason} onChange={e => setReason(e.target.value)} placeholder="Internal note (optional)" aria-label="Note" />
          <button className="aq-btn primary" onClick={extend} disabled={!!busy}>Save date</button>
        </div>
      )}
      {panel === 'pay' && (
        <div className="aq-panel">
          <select value={payStatus} onChange={e => setPayStatus(e.target.value)} aria-label="Payment status">
            {['unpaid', 'part_paid', 'paid', 'refunded'].map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
          </select>
          <input type="number" min={0} value={paid} onChange={e => setPaid(e.target.value)} aria-label="Amount received" placeholder="Amount received, ₦" style={{ maxWidth: 190 }} />
          <button className="aq-btn primary" onClick={pay} disabled={!!busy}>Save</button>
        </div>
      )}
      {msg && <p className={msg.bad ? 'aq-err' : 'aq-ok'}>{msg.text}</p>}
    </div>
  );
}

function QuotationEditor({ r, siblings, ownerPrices, quote, onClose, onSaved }: {
  r: QuoteRequest; siblings: QuoteRequest[]; ownerPrices: Record<string, number>; quote: AdminQuote | null;
  onClose: () => void; onSaved: () => Promise<void>;
}) {
  const boardLine = (x: QuoteRequest): Line => {
    const from = x.reply?.available_from ?? x.start_date;
    const to = x.reply?.available_to ?? x.end_date;
    return {
      kind: 'board', board_id: x.board_id, request_id: x.id,
      description: [x.board?.name, [x.board?.area, x.board?.city].filter(Boolean).join(', ')].filter(Boolean).join(' — ') || 'Board',
      start_date: from, end_date: to, months: monthsBetween(from, to),
      owner_net_monthly: ownerPrices[x.id] ?? null, pricing_mode: 'markup_percent', pricing_value: null, amount: null, cost: null,
    };
  };
  const [settings, setSettings] = useState<Settings | null>(null);
  const [lines, setLines] = useState<Line[]>(() => quote ? quote.lines.slice().sort((a, b) => (a.position ?? 0) - (b.position ?? 0)) : [boardLine(r)]);
  const [title, setTitle] = useState(quote?.title ?? '');
  const [validUntil, setValidUntil] = useState(quote?.valid_until ?? '');
  const [vat, setVat] = useState(quote ? String(quote.vat_rate) : '');
  const [payment, setPayment] = useState(quote?.payment_terms ?? '');
  const [cancel, setCancel] = useState(quote?.cancellation_terms ?? '');
  const [special, setSpecial] = useState(quote?.special_conditions ?? '');
  const [note, setNote] = useState(quote?.buyer_note ?? '');
  const [isTest, setIsTest] = useState(quote?.is_test ?? false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('commercial_settings').select('validity_days, vat_rate, payment_terms, cancellation_terms, special_conditions, approved').eq('id', 1).maybeSingle();
      const s = data as Settings | null;
      setSettings(s);
      if (!quote && s) {
        setValidUntil(addDays(today(), s.validity_days)); setVat(String(s.vat_rate));
        setPayment(s.payment_terms); setCancel(s.cancellation_terms); setSpecial(s.special_conditions);
      }
    })();
  }, [quote]);

  const totals = useMemo(() => quoteTotals(lines, Number(vat) || 0), [lines, vat]);
  const problems = quoteProblems(lines);
  const onQuote = new Set(lines.map(l => l.request_id).filter(Boolean));
  const addable = siblings.filter(s => s.id !== r.id && s.agency_id === r.agency_id && s.board_id && !onQuote.has(s.id)
    && ['requested', 'owner_responded', 'quote_received', 'negotiating'].includes(s.stage));

  const set = (i: number, patch: Partial<Line>) => setLines(ls => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const num = (v: string) => (v === '' ? null : Number(v));

  async function save(thenSend: boolean) {
    if (problems.length) { setErr(problems[0]); return; }
    setBusy(thenSend ? 'send' : 'save'); setErr(null);
    const payload = {
      id: quote?.id ?? null, request_id: r.id, request_ids: [...new Set([r.id, ...lines.map(l => l.request_id).filter(Boolean)])],
      title, valid_until: validUntil, vat_rate: vat, payment_terms: payment, cancellation_terms: cancel,
      special_conditions: special, buyer_note: note, is_test: isTest,
      lines: lines.map(l => ({
        kind: l.kind, board_id: l.board_id, request_id: l.request_id, description: l.description.trim(),
        start_date: l.start_date, end_date: l.end_date, months: l.months,
        owner_net_monthly: l.owner_net_monthly, pricing_mode: l.kind === 'board' ? l.pricing_mode : null,
        pricing_value: l.kind === 'board' ? l.pricing_value : null, amount: l.kind === 'board' ? null : l.amount, cost: l.kind === 'board' ? null : l.cost,
      })),
    };
    const { data: id, error } = await supabase.rpc('admin_save_quotation', { p: payload });
    if (error) { setBusy(null); setErr(errText(error.message)); return; }
    if (thenSend) {
      const s = await supabase.rpc('admin_send_quotation', { p_id: id as string });
      if (s.error) { setBusy(null); setErr(`Saved as a draft, but not sent: ${s.error.message}`); await onSaved(); return; }
      await notifyQuotation(id as string, 'sent');
    }
    setBusy(null);
    await onSaved();
  }

  return (
    <div className="aq-ed" data-quote-editor>
      <div className="aq-ed-h">
        <b>{quote ? `Edit ${quote.ref}` : 'New quotation'}</b>
        <span className="aq-muted">Owner prices, costs and margins stay internal. The buyer sees descriptions, dates, prices per month, totals and terms.</span>
      </div>
      {settings && !settings.approved && (
        <p className="aq-warn">Default terms are still drafts. Have the business owner approve them on the Quotations page before real quotes go out.</p>
      )}

      <input className="aq-in" value={title} onChange={e => setTitle(e.target.value)} placeholder="Campaign or quotation title (optional, buyer sees it)" aria-label="Title" />

      <div className="aq-lines">
        {lines.map((l, i) => {
          const t = lineTotals(l);
          return l.kind === 'board' ? (
            <div key={i} className="aq-line board">
              <div className="aq-row">
                <input className="aq-in grow" value={l.description} onChange={e => set(i, { description: e.target.value })} aria-label="Board description" />
                {lines.filter(x => x.kind === 'board').length > 1 && <button className="aq-x" onClick={() => setLines(ls => ls.filter((_, j) => j !== i))} aria-label="Remove line">×</button>}
              </div>
              <div className="aq-row">
                <label>From<input type="date" className="aq-in" value={l.start_date ?? ''} onChange={e => set(i, { start_date: e.target.value || null, months: monthsBetween(e.target.value, l.end_date) })} /></label>
                <label>To<input type="date" className="aq-in" value={l.end_date ?? ''} onChange={e => set(i, { end_date: e.target.value || null, months: monthsBetween(l.start_date, e.target.value) })} /></label>
                <label>Months<input type="number" min={0.5} step={0.5} className="aq-in" style={{ width: 80 }} value={l.months} onChange={e => set(i, { months: Number(e.target.value) })} /></label>
              </div>
              <div className="aq-row">
                <label className="int">Owner&rsquo;s price /month <em>internal</em>
                  <input type="number" min={0} className="aq-in" value={l.owner_net_monthly ?? ''} onChange={e => set(i, { owner_net_monthly: num(e.target.value) })} placeholder="₦" /></label>
                <label>Pricing
                  <select className="aq-in" value={l.pricing_mode ?? 'markup_percent'} onChange={e => set(i, { pricing_mode: e.target.value as PricingMode, pricing_value: null })}>
                    {PRICING_MODES.map(m => <option key={m.value} value={m.value} title={m.hint}>{m.label}</option>)}
                  </select></label>
                <label>{l.pricing_mode === 'manual' ? 'Selling price /month' : l.pricing_mode === 'markup_fixed' ? 'Markup ₦ /month' : l.pricing_mode === 'commission' ? 'Commission %' : 'Markup %'}
                  <input type="number" className="aq-in" style={{ width: 130 }} value={l.pricing_value ?? ''} onChange={e => set(i, { pricing_value: num(e.target.value) })} /></label>
                <div className="aq-calc"><small>Buyer pays</small><b>{naira(t.unit)}/mo</b><small>{naira(t.total)} total</small></div>
              </div>
            </div>
          ) : (
            <div key={i} className="aq-line">
              <div className="aq-row">
                <label>Type
                  <select className="aq-in" value={l.kind} onChange={e => set(i, { kind: e.target.value as LineKind })} aria-label="Line type">
                    {EXTRA_KINDS.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
                  </select></label>
                <label className="grow">Description (buyer sees it)
                  <input className="aq-in" value={l.description} onChange={e => set(i, { description: e.target.value })} aria-label="Description" /></label>
                <label>{l.kind === 'discount' ? 'Discount ₦' : 'Buyer pays ₦'}
                  <input type="number" min={0} className="aq-in" style={{ width: 130 }} value={l.amount ?? ''} onChange={e => set(i, { amount: num(e.target.value) })} aria-label="Amount" /></label>
                {l.kind !== 'discount' && <label className="int">Our cost ₦ <em>internal</em>
                  <input type="number" min={0} className="aq-in" style={{ width: 130 }} value={l.cost ?? ''} onChange={e => set(i, { cost: num(e.target.value) })} aria-label="Our cost" /></label>}
                <button className="aq-x" onClick={() => setLines(ls => ls.filter((_, j) => j !== i))} aria-label="Remove line">×</button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="aq-row">
        {addable.length > 0 && (
          <select className="aq-in" value="" onChange={e => { const s = siblings.find(x => x.id === e.target.value); if (s) setLines(ls => [...ls, boardLine(s)]); }} aria-label="Add another board">
            <option value="">+ Add another board this buyer requested…</option>
            {addable.map(s => <option key={s.id} value={s.id}>{s.board?.name ?? 'Board'} ({fmt(s.start_date)})</option>)}
          </select>
        )}
        <button className="aq-btn" onClick={() => setLines(ls => [...ls, { kind: 'printing', board_id: null, request_id: null, description: '', start_date: null, end_date: null, months: 1, owner_net_monthly: null, pricing_mode: null, pricing_value: null, amount: null, cost: null }])}>+ Printing, installation, fee or discount</button>
      </div>

      <div className="aq-grid">
        <label>Valid until<input type="date" className="aq-in" min={today()} value={validUntil} onChange={e => setValidUntil(e.target.value)} /></label>
        <label>VAT %<input type="number" min={0} max={100} step={0.5} className="aq-in" value={vat} onChange={e => setVat(e.target.value)} /></label>
        <label className="wide">Payment terms<textarea className="aq-in" rows={2} value={payment} onChange={e => setPayment(e.target.value)} /></label>
        <label className="wide">Cancellation terms<textarea className="aq-in" rows={2} value={cancel} onChange={e => setCancel(e.target.value)} /></label>
        <label className="wide">Special conditions<textarea className="aq-in" rows={2} value={special} onChange={e => setSpecial(e.target.value)} /></label>
        <label className="wide">Note to the buyer (optional)<textarea className="aq-in" rows={2} value={note} onChange={e => setNote(e.target.value)} /></label>
      </div>

      <div className="aq-sum">
        <div><small>Subtotal</small><b>{naira(totals.subtotal)}</b></div>
        {totals.discount > 0 && <div><small>Discount</small><b>−{naira(totals.discount)}</b></div>}
        <div><small>VAT</small><b>{naira(totals.vat)}</b></div>
        <div className="big"><small>Buyer pays</small><b>{naira(totals.total)}</b></div>
        <div className="int"><small>Owner &amp; supplier cost</small><b>{naira(totals.ownerCost)}</b></div>
        <div className="int"><small>Our revenue</small><b className={totals.revenue < 0 ? 'neg' : ''}>{naira(totals.revenue)}{totals.marginPct != null ? ` · ${totals.marginPct}%` : ''}</b></div>
      </div>
      {totals.revenue < 0 && <p className="aq-warn">This quotation is below cost: we would lose {naira(-totals.revenue)}.</p>}

      <label className="aq-check"><input type="checkbox" checked={isTest} onChange={e => setIsTest(e.target.checked)} /> Test quotation (left out of the funnel and revenue figures)</label>
      {err && <p className="aq-err">{err}</p>}
      <div className="aq-actions">
        <button className="aq-btn" onClick={onClose} disabled={!!busy}>Cancel</button>
        <button className="aq-btn" onClick={() => save(false)} disabled={!!busy}>{busy === 'save' ? 'Saving…' : 'Save draft'}</button>
        <button className="aq-btn primary" onClick={() => save(true)} disabled={!!busy || problems.length > 0} title={problems[0] ?? ''}>{busy === 'send' ? 'Sending…' : `Send ${naira(totals.total)} to buyer`}</button>
      </div>
    </div>
  );
}

export const AQ_CSS = `
.aq { display: flex; flex-direction: column; gap: 10px; }
.aq-h { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.aq-label { font-size: 0.6875rem; font-weight: 700; color: #64748B; text-transform: uppercase; letter-spacing: 0.06em; margin: 0; }
.aq-muted { font-size: 0.75rem; color: #64748B; margin: 0; }
.aq-err { font-size: 0.8125rem; color: #B91C1C; margin: 0; }
.aq-ok { font-size: 0.8125rem; color: #047857; margin: 0; }
.aq-warn { font-size: 0.75rem; color: #92400E; background: #FFFBEB; border: 1px solid #FDE68A; border-radius: 9px; padding: 8px 10px; margin: 0; }
.aq-note { font-size: 0.75rem; color: #475569; margin: 8px 0 0; }
.aq-btn { padding: 8px 13px; border-radius: 9px; font-size: 0.75rem; font-weight: 700; font-family: inherit; cursor: pointer; white-space: nowrap; border: 1px solid #CBD5E1; background: #fff; color: #0F172A; }
.aq-btn:disabled { opacity: .55; cursor: default; }
.aq-btn.primary { background: #1B4F8A; color: #fff; border-color: #1B4F8A; }
.aq-btn.danger { background: #FEF2F2; color: #B91C1C; border-color: #FECACA; }
.aq-tag { display: inline-block; margin-left: 6px; padding: 1px 7px; border-radius: 6px; border: 1px solid; font-size: 0.625rem; font-weight: 800; text-transform: uppercase; letter-spacing: .04em; vertical-align: 1px; }
.aq-tag.test { color: #7C3AED; border-color: #DDD6FE; background: #F5F3FF; }
.aq-card { border: 1px solid #E2E8F0; border-radius: 12px; padding: 12px 14px; background: #fff; }
.aq-top { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; flex-wrap: wrap; }
.aq-ref { margin: 0; font-size: 0.875rem; color: #0F172A; }
.aq-sub { margin: 3px 0 0; font-size: 0.75rem; color: #64748B; }
.aq-sub a { color: #1B4F8A; }
.aq-total { text-align: right; }
.aq-total b { display: block; font-size: 1.0625rem; color: #0F172A; letter-spacing: -0.01em; }
.aq-total span { font-size: 0.6875rem; color: #94A3B8; }
.aq-fin { display: flex; flex-wrap: wrap; gap: 6px 18px; align-items: center; margin-top: 10px; padding: 8px 10px; border-radius: 9px; background: repeating-linear-gradient(135deg, #F8FAFC 0 8px, #F1F5F9 8px 9px); border: 1px dashed #CBD5E1; }
.aq-fin > span { font-size: 0.5625rem; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; color: #7C3AED; }
.aq-fin small { display: block; font-size: 0.625rem; color: #64748B; font-weight: 600; }
.aq-fin b { font-size: 0.8125rem; color: #0F172A; }
.neg { color: #B91C1C !important; }
.aq-qs { margin-top: 8px; padding: 8px 10px; border-radius: 9px; background: #EFF6FF; }
.aq-qs p { margin: 0 0 4px; font-size: 0.75rem; color: #1E3A5F; }
.aq-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.aq-panel { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.aq-panel input, .aq-panel select, .aq-in { box-sizing: border-box; padding: 8px 10px; border-radius: 9px; border: 1.5px solid #E2E8F0; font-size: 0.8125rem; color: #0F172A; background: #fff; font-family: inherit; outline: none; min-width: 0; }
.aq-panel input { flex: 1; min-width: 160px; }
.aq-in:focus { border-color: #1B4F8A; }
.aq-in.int, label.int .aq-in { background: #FAF5FF; border-color: #E9D5FF; }
.aq-ed { border: 1.5px solid #BFDBFE; border-radius: 14px; padding: 14px; background: #FBFDFF; display: flex; flex-direction: column; gap: 10px; }
.aq-ed-h b { display: block; font-size: 0.9375rem; color: #0F172A; margin-bottom: 2px; }
.aq-lines { display: flex; flex-direction: column; gap: 8px; }
.aq-line { border: 1px solid #E2E8F0; border-radius: 11px; padding: 10px; background: #fff; display: flex; flex-direction: column; gap: 8px; }
.aq-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: flex-end; }
.aq-row label, .aq-grid label { display: flex; flex-direction: column; gap: 3px; font-size: 0.6875rem; font-weight: 600; color: #64748B; }
.aq-row label em, .aq-in.int::placeholder { font-style: normal; color: #7C3AED; font-weight: 700; }
.aq-row .grow { flex: 1; min-width: 180px; }
.aq-row label.grow .aq-in { width: 100%; }
.aq-x { border: none; background: #F1F5F9; color: #64748B; width: 30px; height: 34px; border-radius: 8px; font-size: 1.1rem; cursor: pointer; }
.aq-calc { margin-left: auto; text-align: right; }
.aq-calc small { display: block; font-size: 0.625rem; color: #64748B; }
.aq-calc b { font-size: 0.9375rem; color: #0F172A; }
.aq-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.aq-grid .wide { grid-column: span 2; }
.aq-grid textarea { resize: vertical; }
.aq-sum { display: flex; flex-wrap: wrap; gap: 8px; }
.aq-sum div { padding: 8px 12px; border-radius: 10px; background: #F8FAFC; min-width: 96px; }
.aq-sum div.big { background: #EFF6FF; }
.aq-sum div.int { background: #FAF5FF; }
.aq-sum small { display: block; font-size: 0.625rem; color: #64748B; font-weight: 600; }
.aq-sum b { font-size: 0.875rem; color: #0F172A; }
.aq-sum .big b { font-size: 1.0625rem; color: #1B4F8A; }
.aq-check { display: flex; gap: 6px; align-items: center; font-size: 0.75rem; color: #475569; }
@media (max-width: 640px) {
  .aq-grid { grid-template-columns: 1fr; }
  .aq-grid .wide { grid-column: auto; }
  .aq-calc { margin-left: 0; text-align: left; }
  .aq-total { text-align: left; }
}
`;
