'use client';

// The buyer's view of a quotation (061). Data comes from my_quotations(),
// which returns buyer-facing fields only — no owner prices or margins.

import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { naira, QUOTE_STATUS, type BuyerQuotation } from '@/lib/quotations';
import { notifyQuotation, downloadQuotationPdf } from '@/lib/quotations-client';

const fmt = (d: string | null) => (d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const daysLeft = (d: string | null) => (d ? Math.ceil((new Date(d + 'T23:59:59+01:00').getTime() - Date.now()) / 86_400_000) : null);

/** Loads the signed-in buyer's quotations. Empty (not an error) before migration 061 is run. */
export async function loadMyQuotations(): Promise<BuyerQuotation[]> {
  const { data, error } = await supabase.rpc('my_quotations');
  if (error) return [];
  return (data ?? []) as BuyerQuotation[];
}

export function BuyerQuotationCard({ q, onChanged }: { q: BuyerQuotation; onChanged: () => Promise<void> }) {
  const [mode, setMode] = useState<'accept' | 'decline' | 'ask' | null>(null);
  const [text, setText] = useState('');
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const [showTerms, setShowTerms] = useState(false);

  const state = q.expired ? 'expired' : q.status;
  const st = QUOTE_STATUS[state] ?? QUOTE_STATUS.sent;
  const open = q.status === 'sent' && !q.expired;
  const left = daysLeft(q.valid_until);

  async function respond(action: 'accept' | 'decline' | 'clarify') {
    setBusy(action); setMsg(null);
    const { error } = await supabase.rpc('buyer_respond_quotation', { p_id: q.id, p_action: action, p_note: text.trim() || null });
    if (error) { setBusy(null); setMsg({ text: error.message, bad: true }); return; }
    await notifyQuotation(q.id, action === 'accept' ? 'accepted' : action === 'decline' ? 'declined' : 'clarify');
    setBusy(null); setMode(null); setText('');
    setMsg({ text: action === 'accept' ? 'Accepted. Our team will confirm the booking with the media owner and contact you.' : action === 'decline' ? 'Declined. Thanks for letting us know.' : 'Question sent. Our team will reply by email or phone.' });
    await onChanged();
  }

  const pdf = async () => {
    setBusy('pdf');
    const e = await downloadQuotationPdf(q.id, q.ref);
    setBusy(null);
    if (e) setMsg({ text: e, bad: true });
  };

  return (
    <section className={`bq${open ? ' bq-open' : ''}`} data-buyer-quote={q.ref}>
      <header className="bq-h">
        <div>
          <p className="bq-k">Quotation</p>
          <p className="bq-ref">{q.ref} <span style={{ color: st.tone, background: st.tone + '14', borderColor: st.tone + '40' }}>{st.label}</span></p>
          {q.title && <p className="bq-title">{q.title}</p>}
        </div>
        <div className="bq-total">
          <b>{naira(q.total)}</b>
          <small>{q.vat_amount ? `incl. VAT ${naira(q.vat_amount)}` : 'total'}</small>
        </div>
      </header>

      <p className="bq-valid">
        Issued {fmt(q.issued_on)} ·{' '}
        {q.status === 'accepted' ? <>accepted {fmt(q.accepted_at)}{q.booking_confirmed_at ? <> · <b className="ok">booking confirmed {fmt(q.booking_confirmed_at)}</b></> : ' · our team is confirming the booking'}</>
          : q.expired ? <b className="bad">expired on {fmt(q.valid_until)} — ask us for an updated quotation</b>
          : q.status === 'sent' ? <>valid until <b className={left != null && left <= 2 ? 'warn' : ''}>{fmt(q.valid_until)}</b>{left != null && left <= 2 ? ` (${left <= 0 ? 'last day' : `${left} day${left === 1 ? '' : 's'} left`})` : ''}</>
          : q.status === 'declined' ? <>you declined this on {fmt(q.declined_at)}</>
          : q.status === 'withdrawn' ? <>withdrawn by OOH Platform</>
          : q.status === 'superseded' ? <>replaced by an updated quotation</> : null}
      </p>

      <div className="bq-lines">
        {q.lines.map((l, i) => (
          <div key={i} className="bq-l">
            <div>
              <p>{l.description}</p>
              {l.kind === 'board' && <small>{fmt(l.start_date)} – {fmt(l.end_date)} · {l.months} month{Number(l.months) === 1 ? '' : 's'}{l.unit_monthly != null ? ` · ${naira(l.unit_monthly)}/month` : ''}</small>}
            </div>
            <b>{naira(l.line_total)}</b>
          </div>
        ))}
        <div className="bq-l sub"><span>Subtotal</span><b>{naira(q.subtotal)}</b></div>
        {q.discount_total > 0 && <div className="bq-l sub"><span>Discount</span><b>−{naira(q.discount_total)}</b></div>}
        <div className="bq-l sub"><span>VAT ({q.vat_rate}%)</span><b>{naira(q.vat_amount)}</b></div>
        <div className="bq-l tot"><span>Total</span><b>{naira(q.total)}</b></div>
      </div>

      {q.buyer_note && <p className="bq-note">{q.buyer_note}</p>}

      {(q.payment_terms || q.cancellation_terms || q.special_conditions) && (
        <div className="bq-terms">
          <button className="bq-link" onClick={() => setShowTerms(v => !v)} aria-expanded={showTerms}>{showTerms ? 'Hide terms' : 'Payment and cancellation terms'}</button>
          {showTerms && (
            <dl>
              {q.payment_terms && <><dt>Payment</dt><dd>{q.payment_terms}</dd></>}
              {q.cancellation_terms && <><dt>Cancellation</dt><dd>{q.cancellation_terms}</dd></>}
              {q.special_conditions && <><dt>Conditions</dt><dd>{q.special_conditions}</dd></>}
            </dl>
          )}
        </div>
      )}

      {mode === 'accept' ? (
        <div className="bq-confirm" data-accept-confirm>
          <p>Accept quotation <b>{q.ref}</b> for <b>{naira(q.total)}</b>? Our team then confirms availability with the media owner. Nothing is booked until we confirm it, and the accepted terms can’t be changed afterwards.</p>
          <label><input type="checkbox" checked={agree} onChange={e => setAgree(e.target.checked)} /> I’ve read the payment and cancellation terms</label>
          <div className="bq-act">
            <button className="bq-btn primary" onClick={() => respond('accept')} disabled={!agree || !!busy}>{busy === 'accept' ? 'Accepting…' : 'Yes, accept'}</button>
            <button className="bq-btn" onClick={() => setMode(null)} disabled={!!busy}>Back</button>
          </div>
        </div>
      ) : mode ? (
        <div className="bq-confirm">
          <textarea rows={3} value={text} onChange={e => setText(e.target.value)} maxLength={2000}
            placeholder={mode === 'ask' ? 'What would you like to know? E.g. different dates, printing, payment.' : 'Why are you declining? (optional, helps us)'} aria-label={mode === 'ask' ? 'Your question' : 'Reason'} />
          <div className="bq-act">
            <button className="bq-btn primary" onClick={() => respond(mode === 'ask' ? 'clarify' : 'decline')} disabled={!!busy || (mode === 'ask' && !text.trim())}>
              {busy ? 'Sending…' : mode === 'ask' ? 'Send question' : 'Decline quotation'}
            </button>
            <button className="bq-btn" onClick={() => setMode(null)} disabled={!!busy}>Back</button>
          </div>
        </div>
      ) : (
        <div className="bq-act">
          {open && <button className="bq-btn primary" onClick={() => setMode('accept')}>Accept quotation</button>}
          <button className="bq-btn" onClick={pdf} disabled={!!busy}>{busy === 'pdf' ? 'Preparing…' : 'Download PDF'}</button>
          {open && <button className="bq-btn" onClick={() => setMode('ask')}>Ask a question</button>}
          {open && <button className="bq-btn quiet" onClick={() => setMode('decline')}>Decline</button>}
        </div>
      )}
      {msg && <p className={msg.bad ? 'bq-bad' : 'bq-ok'} role="status">{msg.text}</p>}
    </section>
  );
}

export const BQ_CSS = `
.bq { margin-top: 12px; border: 1px solid #E2E8F0; border-radius: 14px; background: #fff; padding: 14px 16px; }
.bq-open { border-color: #93C5FD; box-shadow: 0 6px 20px -12px rgba(27,79,138,.45); }
.bq-h { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; }
.bq-k { margin: 0; font-size: 0.625rem; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; color: #64748B; }
.bq-ref { margin: 2px 0 0; font-size: 0.9375rem; font-weight: 800; color: #0F172A; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.bq-ref span { font-size: 0.625rem; font-weight: 800; text-transform: uppercase; letter-spacing: .04em; padding: 2px 8px; border-radius: 6px; border: 1px solid; }
.bq-title { margin: 2px 0 0; font-size: 0.8125rem; color: #475569; }
.bq-total { text-align: right; }
.bq-total b { display: block; font-size: 1.25rem; font-weight: 800; color: #0F172A; letter-spacing: -0.02em; }
.bq-total small { font-size: 0.6875rem; color: #94A3B8; }
.bq-valid { margin: 8px 0 10px; font-size: 0.75rem; color: #64748B; }
.bq-valid b { color: #0F172A; }
.bq-valid b.warn { color: #B45309; }
.bq-valid b.bad { color: #B91C1C; }
.bq-valid b.ok { color: #047857; }
.bq-lines { border-top: 1px solid #F1F5F9; }
.bq-l { display: flex; justify-content: space-between; gap: 12px; padding: 8px 0; border-bottom: 1px solid #F1F5F9; font-size: 0.8125rem; color: #0F172A; }
.bq-l p { margin: 0; font-weight: 600; }
.bq-l small { font-size: 0.6875rem; color: #64748B; }
.bq-l b { white-space: nowrap; }
.bq-l.sub { color: #64748B; font-size: 0.75rem; padding: 5px 0; border: none; }
.bq-l.sub b { color: #334155; font-weight: 600; }
.bq-l.tot { border: none; padding-top: 8px; font-weight: 800; }
.bq-l.tot b { font-size: 1rem; }
.bq-note { margin: 8px 0 0; padding: 8px 10px; border-left: 3px solid #E2E8F0; font-size: 0.8125rem; color: #475569; }
.bq-terms { margin-top: 8px; }
.bq-link { border: none; background: none; padding: 0; color: #1B4F8A; font-family: inherit; font-size: 0.75rem; font-weight: 700; cursor: pointer; }
.bq-terms dl { margin: 6px 0 0; display: grid; grid-template-columns: auto 1fr; gap: 4px 12px; font-size: 0.75rem; }
.bq-terms dt { color: #64748B; font-weight: 700; }
.bq-terms dd { margin: 0; color: #334155; white-space: pre-wrap; }
.bq-act { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
.bq-btn { padding: 10px 16px; border-radius: 10px; font-size: 0.8125rem; font-weight: 700; font-family: inherit; cursor: pointer; border: 1px solid #CBD5E1; background: #fff; color: #0F172A; }
.bq-btn.primary { background: #1B4F8A; color: #fff; border-color: #1B4F8A; }
.bq-btn.quiet { border-color: transparent; color: #64748B; }
.bq-btn:disabled { opacity: .55; cursor: default; }
.bq-confirm { margin-top: 12px; padding: 12px; border-radius: 12px; background: #F8FAFC; }
.bq-confirm p { margin: 0 0 8px; font-size: 0.8125rem; color: #334155; line-height: 1.5; }
.bq-confirm label { display: flex; gap: 8px; align-items: center; font-size: 0.75rem; color: #334155; }
.bq-confirm textarea { width: 100%; box-sizing: border-box; padding: 9px 11px; border-radius: 10px; border: 1.5px solid #E2E8F0; font-family: inherit; font-size: 0.8125rem; resize: vertical; }
.bq-ok { margin: 8px 0 0; font-size: 0.8125rem; color: #047857; }
.bq-bad { margin: 8px 0 0; font-size: 0.8125rem; color: #B91C1C; }
@media (max-width: 520px) {
  .bq-h { flex-direction: column; }
  .bq-total { text-align: left; }
  .bq-act .bq-btn { flex: 1; }
}
`;
