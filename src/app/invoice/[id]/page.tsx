'use client';

import { useState, useEffect, use } from 'react';
import type { Invoice, InvoiceItem } from '@/lib/types';

type FullInvoice = Invoice & {
  campaign?: { id: string; name: string };
  items: InvoiceItem[];
};

const FORMAT_LABELS: Record<string, string> = {
  billboard: 'Billboard', unipole: 'Unipole', gantry: 'Gantry',
  bridge_panel: 'Bridge Panel', wall_drape: 'Wall Drape',
};

const STATUS_CONFIG: Record<string, { label: string; bg: string; color: string; dot: string }> = {
  draft:     { label: 'Draft',     bg: '#F1F5F9', color: '#475569', dot: '#94A3B8' },
  sent:      { label: 'Awaiting Payment', bg: '#EFF6FF', color: '#1D4ED8', dot: '#3B82F6' },
  paid:      { label: 'Paid',      bg: '#ECFDF5', color: '#065F46', dot: '#10B981' },
  overdue:   { label: 'Overdue',   bg: '#FEF2F2', color: '#991B1B', dot: '#EF4444' },
  cancelled: { label: 'Cancelled', bg: '#F8FAFC', color: '#94A3B8', dot: '#CBD5E1' },
};

function fmtNaira(n: number) {
  if (n >= 1_000_000) return '₦' + (n / 1_000_000).toFixed(2) + 'M';
  if (n >= 1_000)     return '₦' + n.toLocaleString('en-NG');
  return '₦' + n.toFixed(2);
}

function fmtDate(s?: string | null) {
  if (!s) return '—';
  return new Date(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

function isOverdue(inv: Invoice): boolean {
  return inv.status === 'sent' && !!inv.due_date && new Date(inv.due_date) < new Date();
}

export default function PublicInvoicePage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ payment?: string }>;
}) {
  const { id }        = use(params);
  const sp            = use(searchParams);
  const paymentDone   = sp.payment === 'done';
  const paymentFailed = sp.payment === 'failed';

  const [invoice, setInvoice]   = useState<FullInvoice | null>(null);
  const [loading, setLoading]   = useState(true);
  const [paying, setPaying]     = useState(false);
  const [toast, setToast]       = useState('');
  const [copied, setCopied]     = useState(false);

  useEffect(() => {
    fetch(`/api/invoices/${id}`)
      .then(r => r.json())
      .then((data: FullInvoice) => {
        const isOd = isOverdue(data);
        setInvoice(isOd ? { ...data, status: 'overdue' } : data);
      })
      .finally(() => setLoading(false));
  }, [id]);

  async function handlePayNow() {
    if (!invoice || invoice.status === 'paid') return;
    setPaying(true);
    try {
      const res = await fetch(`/api/invoices/${invoice.id}/paystack`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');

      if (data.authorization_url) {
        if (data.mode === 'invoice_page') {
          showToast('This is the invoice page — share the URL with your client.');
        } else {
          window.location.href = data.authorization_url;
        }
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Payment failed');
    } finally {
      setPaying(false);
    }
  }

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(''), 4000);
  }

  async function handleCopy() {
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleWhatsApp() {
    if (!invoice) return;
    const text = `Hi, please find your invoice ${invoice.invoice_number} for ${fmtNaira(invoice.total_amount)} from OOH Platform.\n\nPay here: ${window.location.href}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
  }

  if (loading) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#F8FAFC', fontFamily: "'Inter', -apple-system, sans-serif" }}>
      <div style={{ width: 28, height: 28, border: '3px solid #E2E8F0', borderTopColor: '#1B4F8A', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );

  if (!invoice) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#F8FAFC', fontFamily: "'Inter', -apple-system, sans-serif" }}>
      <div style={{ textAlign: 'center' }}>
        <p style={{ fontSize: '3rem', margin: '0 0 12px' }}>🧾</p>
        <p style={{ fontSize: '1rem', color: '#64748B', margin: 0 }}>Invoice not found.</p>
      </div>
    </div>
  );

  const sc = STATUS_CONFIG[invoice.status] || STATUS_CONFIG.draft;
  const canPay = invoice.status === 'sent' || invoice.status === 'overdue';
  const isPaid = invoice.status === 'paid';

  return (
    <div style={{ minHeight: '100vh', background: '#F1F5F9', fontFamily: "'Inter', -apple-system, sans-serif", padding: '0 0 60px' }}>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeIn { from { opacity:0; transform:translateY(8px) } to { opacity:1; transform:none } }
        @keyframes slideDown { from { opacity:0; transform:translateY(-10px) } to { opacity:1; transform:none } }
        * { box-sizing: border-box; }
      `}</style>

      {/* ── Top bar ── */}
      <div style={{ background: '#0F172A', padding: '0 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 52 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#F59E0B' }} />
          <span style={{ fontSize: '0.875rem', fontWeight: 700, color: '#fff', letterSpacing: '-0.01em' }}>OOH Platform</span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <a href={`/api/invoices/${invoice.id}/pdf`} target="_blank"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 12px', borderRadius: 7, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.06)', fontSize: '0.75rem', fontWeight: 600, color: 'rgba(255,255,255,0.7)', textDecoration: 'none' }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            PDF
          </a>
          <button onClick={handleCopy}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 12px', borderRadius: 7, border: '1px solid rgba(255,255,255,0.12)', background: copied ? 'rgba(16,185,129,0.2)' : 'rgba(255,255,255,0.06)', fontSize: '0.75rem', fontWeight: 600, color: copied ? '#34D399' : 'rgba(255,255,255,0.7)', cursor: 'pointer', fontFamily: 'inherit' }}>
            {copied ? '✓ Copied!' : 'Copy link'}
          </button>
          <button onClick={handleWhatsApp}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 12px', borderRadius: 7, border: 'none', background: '#25D366', fontSize: '0.75rem', fontWeight: 700, color: '#fff', cursor: 'pointer', fontFamily: 'inherit' }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
              <path d="M11.5 2.25C6.394 2.25 2.25 6.394 2.25 11.5c0 1.632.43 3.16 1.18 4.482L2.25 21.75l5.883-1.164A9.175 9.175 0 0 0 11.5 21.75c5.106 0 9.25-4.144 9.25-9.25S16.606 2.25 11.5 2.25z" fillRule="evenodd" clipRule="evenodd"/>
            </svg>
            WhatsApp
          </button>
        </div>
      </div>

      {/* ── Payment success banner ── */}
      {(paymentDone || isPaid) && (
        <div style={{ background: '#059669', padding: '14px 24px', display: 'flex', alignItems: 'center', gap: 12, animation: 'slideDown 0.3s both' }}>
          <span style={{ fontSize: '1.25rem' }}>✅</span>
          <div>
            <p style={{ fontSize: '0.9375rem', fontWeight: 700, color: '#fff', margin: 0 }}>Payment received — thank you!</p>
            <p style={{ fontSize: '0.8125rem', color: 'rgba(255,255,255,0.8)', margin: 0 }}>
              {invoice.paid_at ? `Paid on ${fmtDate(invoice.paid_at)}` : 'Your payment has been confirmed.'}
              {invoice.payment_ref ? ` · Ref: ${invoice.payment_ref}` : ''}
            </p>
          </div>
        </div>
      )}

      {/* ── Payment failed banner ── */}
      {paymentFailed && (
        <div style={{ background: '#DC2626', padding: '14px 24px', display: 'flex', alignItems: 'center', gap: 12, animation: 'slideDown 0.3s both' }}>
          <span style={{ fontSize: '1.25rem' }}>❌</span>
          <div>
            <p style={{ fontSize: '0.9375rem', fontWeight: 700, color: '#fff', margin: 0 }}>Payment was not completed</p>
            <p style={{ fontSize: '0.8125rem', color: 'rgba(255,255,255,0.8)', margin: 0 }}>Your card was not charged. Please try again or use a different payment method.</p>
          </div>
        </div>
      )}

      {/* ── Main content ── */}
      <div style={{ maxWidth: 760, margin: '32px auto', padding: '0 20px' }}>

        {/* Overdue banner */}
        {invoice.status === 'overdue' && (
          <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 10, padding: '12px 16px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: '1.25rem' }}>⚠️</span>
            <div>
              <p style={{ fontSize: '0.9375rem', fontWeight: 700, color: '#991B1B', margin: 0 }}>This invoice is overdue</p>
              <p style={{ fontSize: '0.8125rem', color: '#DC2626', margin: 0 }}>Due date was {fmtDate(invoice.due_date)} — please arrange payment as soon as possible.</p>
            </div>
          </div>
        )}

        {/* Invoice card */}
        <div style={{ background: '#fff', borderRadius: 16, boxShadow: '0 4px 24px rgba(0,0,0,0.08)', overflow: 'hidden', animation: 'fadeIn 0.3s both' }}>

          {/* Header */}
          <div style={{ background: '#0F172A', padding: '24px 28px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <p style={{ fontSize: '0.6875rem', color: 'rgba(255,255,255,0.4)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 6px' }}>
                OOH Platform · Invoice
              </p>
              <p style={{ fontSize: '2rem', fontWeight: 800, color: '#fff', margin: 0, letterSpacing: '-0.04em', fontFamily: 'monospace' }}>
                {invoice.invoice_number}
              </p>
            </div>
            <div style={{ textAlign: 'right' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: sc.bg, color: sc.color, padding: '5px 14px', borderRadius: 999, fontSize: '0.8125rem', fontWeight: 700 }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: sc.dot }} />
                {sc.label}
              </span>
              <p style={{ fontSize: '2rem', fontWeight: 800, color: '#F59E0B', margin: '12px 0 0', fontFamily: 'monospace', letterSpacing: '-0.03em' }}>
                {fmtNaira(invoice.total_amount)}
              </p>
            </div>
          </div>

          {/* Meta row */}
          <div style={{ padding: '16px 28px', borderBottom: '1px solid #F1F5F9', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
            {[
              { label: 'Invoice Date', value: fmtDate(invoice.created_at) },
              { label: 'Due Date',     value: fmtDate(invoice.due_date) },
              { label: 'Campaign',     value: invoice.campaign?.name || '—' },
              { label: 'Client',       value: invoice.client_name },
            ].map(({ label, value }) => (
              <div key={label}>
                <p style={{ fontSize: '0.6875rem', color: '#94A3B8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 3px' }}>{label}</p>
                <p style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0F172A', margin: 0 }}>{value}</p>
              </div>
            ))}
          </div>

          {/* Bill To */}
          <div style={{ padding: '14px 28px', borderBottom: '1px solid #F1F5F9', display: 'flex', gap: 12 }}>
            <div style={{ width: 3, background: '#1B4F8A', borderRadius: 99, flexShrink: 0 }} />
            <div>
              <p style={{ fontSize: '0.6875rem', color: '#94A3B8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 3px' }}>Bill To</p>
              <p style={{ fontSize: '1rem', fontWeight: 700, color: '#0F172A', margin: '0 0 2px' }}>{invoice.client_name}</p>
              {invoice.client_email && <p style={{ fontSize: '0.8125rem', color: '#64748B', margin: 0 }}>{invoice.client_email}</p>}
            </div>
          </div>

          {/* Line items */}
          <div style={{ padding: '0 28px 24px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 20 }}>
              <thead>
                <tr style={{ background: '#0F172A' }}>
                  {['#', 'Description', 'Period', 'Total'].map((h, i) => (
                    <th key={h} style={{ padding: '9px 12px', textAlign: i === 3 ? 'right' : 'left', fontSize: '0.6875rem', fontWeight: 700, color: '#fff', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {invoice.items.length === 0 ? (
                  <tr><td colSpan={4} style={{ padding: '20px 12px', textAlign: 'center', fontSize: '0.875rem', color: '#94A3B8', background: '#F8FAFC' }}>No line items on this invoice</td></tr>
                ) : (
                  invoice.items.map((item: InvoiceItem, i: number) => (
                    <tr key={item.id} style={{ background: i % 2 === 0 ? '#fff' : '#F8FAFC', borderBottom: '1px solid #F1F5F9' }}>
                      <td style={{ padding: '12px', fontSize: '0.8125rem', color: '#94A3B8' }}>{i + 1}</td>
                      <td style={{ padding: '12px' }}>
                        <p style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0F172A', margin: 0 }}>{item.description}</p>
                        {(item.board_format || item.location) && (
                          <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: '2px 0 0' }}>
                            {[FORMAT_LABELS[item.board_format || ''] || item.board_format, item.location].filter(Boolean).join(' · ')}
                          </p>
                        )}
                      </td>
                      <td style={{ padding: '12px', fontSize: '0.8125rem', color: '#64748B' }}>
                        {item.start_date ? `${fmtDate(item.start_date)} – ${fmtDate(item.end_date)}` : '—'}
                      </td>
                      <td style={{ padding: '12px', fontSize: '0.9375rem', fontWeight: 700, color: '#0F172A', textAlign: 'right', fontFamily: 'monospace' }}>{fmtNaira(item.total)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>

            {/* Totals */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
              <div style={{ width: 260 }}>
                {[
                  { label: 'Subtotal', value: fmtNaira(invoice.subtotal) },
                  { label: `VAT (${invoice.tax_rate}%)`, value: fmtNaira(invoice.tax_amount) },
                ].map(r => (
                  <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #F1F5F9' }}>
                    <span style={{ fontSize: '0.875rem', color: '#64748B' }}>{r.label}</span>
                    <span style={{ fontSize: '0.875rem', fontFamily: 'monospace', color: '#0F172A' }}>{r.value}</span>
                  </div>
                ))}
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 16px', background: '#0F172A', borderRadius: 8, marginTop: 8 }}>
                  <span style={{ fontSize: '0.9375rem', fontWeight: 700, color: '#fff' }}>Total Due</span>
                  <span style={{ fontSize: '1.125rem', fontWeight: 800, fontFamily: 'monospace', color: '#F59E0B' }}>{fmtNaira(invoice.total_amount)}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Notes */}
          {invoice.notes && (
            <div style={{ padding: '14px 28px', borderTop: '1px solid #F1F5F9', background: '#F8FAFC' }}>
              <p style={{ fontSize: '0.6875rem', color: '#94A3B8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 6px' }}>Notes</p>
              <p style={{ fontSize: '0.875rem', color: '#334155', margin: 0, lineHeight: 1.6 }}>{invoice.notes}</p>
            </div>
          )}

          {/* CTA: Pay now */}
          {canPay && (
            <div style={{ padding: '20px 28px', borderTop: '1px solid #F1F5F9', background: '#FAFBFF' }}>
              <button
                onClick={handlePayNow}
                disabled={paying}
                style={{
                  width: '100%', padding: '14px 0', borderRadius: 12, border: 'none',
                  background: paying ? '#94A3B8' : '#1B4F8A',
                  color: '#fff', fontSize: '1rem', fontWeight: 700,
                  cursor: paying ? 'not-allowed' : 'pointer',
                  fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                  boxShadow: paying ? 'none' : '0 4px 20px rgba(27,79,138,0.3)',
                  transition: 'all 0.15s',
                }}
              >
                {paying
                  ? <><span style={{ display: 'inline-block', width: 16, height: 16, border: '2px solid rgba(255,255,255,0.4)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} /> Redirecting to payment…</>
                  : <>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
                      Pay {fmtNaira(invoice.total_amount)} now
                    </>
                }
              </button>
              <p style={{ fontSize: '0.75rem', color: '#94A3B8', textAlign: 'center', margin: '10px 0 0' }}>
                Secured by Paystack · Card, Bank Transfer, USSD accepted
              </p>
            </div>
          )}

          {isPaid && (
            <div style={{ padding: '20px 28px', borderTop: '1px solid #A7F3D0', background: '#ECFDF5' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ fontSize: '1.5rem' }}>✅</span>
                <div>
                  <p style={{ fontSize: '0.9375rem', fontWeight: 700, color: '#065F46', margin: 0 }}>Invoice fully paid</p>
                  <p style={{ fontSize: '0.8125rem', color: '#059669', margin: 0 }}>
                    Paid {fmtDate(invoice.paid_at)}
                    {invoice.payment_ref ? ` · Ref: ${invoice.payment_ref}` : ''}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ textAlign: 'center', marginTop: 24 }}>
          <p style={{ fontSize: '0.75rem', color: '#94A3B8', margin: 0 }}>
            Issued by <strong style={{ color: '#64748B' }}>OOH Platform</strong> · Questions? Contact your account manager
          </p>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 100, background: '#0F172A', color: '#fff', padding: '12px 20px', borderRadius: 10, fontSize: '0.875rem', fontWeight: 600, boxShadow: '0 4px 20px rgba(0,0,0,0.2)', animation: 'fadeIn 0.2s both', whiteSpace: 'nowrap' }}>
          {toast}
        </div>
      )}
    </div>
  );
}
