'use client';

import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { RoleGuard } from '@/components/layout/RoleGuard';
import type { Invoice, InvoiceItem } from '@/lib/types';

type FullInvoice = Invoice & {
  campaign?: { id: string; name: string } | null;
  items: InvoiceItem[];
};

const STATUS_CONFIG: Record<string, { label: string; bg: string; color: string }> = {
  draft:        { label: 'Draft',               bg: '#F1F5F9', color: '#475569' },
  sent:         { label: 'Sent to Agency',       bg: '#EFF6FF', color: '#1D4ED8' },
  acknowledged: { label: 'Compiled by Agency',   bg: '#F5F3FF', color: '#3730A3' },
  paid:         { label: 'Paid',                 bg: '#ECFDF5', color: '#065F46' },
  overdue:      { label: 'Overdue',              bg: '#FEF2F2', color: '#991B1B' },
  cancelled:    { label: 'Cancelled',            bg: '#F8FAFC', color: '#94A3B8' },
};

const FORMAT_LABELS: Record<string, string> = {
  billboard: 'Billboard', unipole: 'Unipole', gantry: 'Gantry',
  bridge_panel: 'Bridge Panel', wall_drape: 'Wall Drape',
};

function fmtMoney(n: number | string | undefined | null) {
  const num = Number(n ?? 0);
  return '₦' + num.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(s?: string | null) {
  if (!s) return '—';
  return new Date(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

function fmtPeriod(start?: string | null, end?: string | null) {
  if (!start && !end) return '—';
  const s = start ? new Date(start).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }) : '';
  const e = end   ? new Date(end).toLocaleDateString('en-GB',   { month: 'short', year: 'numeric' }) : '';
  if (s === e) return s;
  return [s, e].filter(Boolean).join(' – ');
}

export default function OwnerInvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router  = useRouter();

  const [invoice, setInvoice] = useState<FullInvoice | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [toast,   setToast]   = useState('');

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(''), 3200);
  }

  useEffect(() => {
    fetch(`/api/invoices/${id}`)
      .then(r => {
        if (!r.ok) throw new Error('Not found');
        return r.json();
      })
      .then((data: FullInvoice) => {
        const isOverdue =
          data.status === 'sent' && !!data.due_date && new Date(data.due_date) < new Date();
        setInvoice(isOverdue ? { ...data, status: 'overdue' } : data);
      })
      .catch(() => setInvoice(null))
      .finally(() => setLoading(false));
  }, [id]);

  async function sendToAgency() {
    if (!invoice) return;
    setSending(true);
    try {
      const res = await fetch('/api/invoices/media-partner', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: invoice.id, status: 'sent' }),
      });
      if (!res.ok) throw new Error('Failed to send');
      const updated: FullInvoice = await res.json();
      setInvoice(prev => prev ? { ...prev, ...updated } : null);
      showToast('Invoice sent to agency');
    } catch {
      showToast('Failed to send invoice');
    } finally {
      setSending(false);
    }
  }

  const cfg = invoice ? (STATUS_CONFIG[invoice.status] ?? STATUS_CONFIG.draft) : STATUS_CONFIG.draft;

  return (
    <RoleGuard role="owner">
      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
          background: '#0F172A', color: '#fff', padding: '10px 20px', borderRadius: 10,
          fontSize: '0.875rem', fontWeight: 600, zIndex: 9999, boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
          whiteSpace: 'nowrap',
        }}>
          {toast}
        </div>
      )}

      <div style={{ maxWidth: 860, margin: '0 auto' }}>
        {/* Toolbar */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
          <button
            onClick={() => router.push('/dashboard/owner?tab=invoices')}
            style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', color: '#64748B', fontSize: '0.875rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
            Back to invoices
          </button>

          {invoice && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <button
                onClick={() => window.print()}
                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 8, border: '1.5px solid #E2E8F0', background: '#fff', color: '#374151', fontSize: '0.8125rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
                Print
              </button>

              {invoice.status === 'draft' && (
                <button
                  onClick={sendToAgency}
                  disabled={sending}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 8, border: 'none', background: sending ? '#CBD5E1' : '#1B4F8A', color: '#fff', fontSize: '0.8125rem', fontWeight: 600, cursor: sending ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}
                >
                  {sending ? (
                    <>
                      <div style={{ width: 12, height: 12, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
                      Sending…
                    </>
                  ) : (
                    <>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                      Send to Agency
                    </>
                  )}
                </button>
              )}

              {invoice.status === 'acknowledged' && invoice.compiled_invoice_id && (
                <a
                  href={`/invoice/${invoice.compiled_invoice_id}`}
                  target="_blank"
                  style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 8, border: 'none', background: '#7C3AED', color: '#fff', fontSize: '0.8125rem', fontWeight: 600, textDecoration: 'none', fontFamily: 'inherit' }}
                >
                  View client invoice
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                </a>
              )}
            </div>
          )}
        </div>

        {loading && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '4rem 0' }}>
            <div style={{ width: 28, height: 28, border: '2px solid #E2E8F0', borderTopColor: '#1B4F8A', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </div>
        )}

        {!loading && !invoice && (
          <div style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: 16, padding: '3rem', textAlign: 'center' }}>
            <p style={{ fontSize: '2rem', margin: '0 0 8px' }}>🧾</p>
            <p style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#0F172A', margin: '0 0 4px' }}>Invoice not found</p>
            <p style={{ fontSize: '0.8125rem', color: '#94A3B8', margin: 0 }}>This invoice may have been deleted or you don&apos;t have access.</p>
          </div>
        )}

        {!loading && invoice && (
          <div style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: 16, overflow: 'hidden', boxShadow: '0 1px 6px rgba(0,0,0,0.04)' }}>
            {/* Invoice header */}
            <div style={{ padding: '32px 40px 28px', borderBottom: '1px solid #F1F5F9' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                    <span style={{ background: cfg.bg, color: cfg.color, fontSize: '0.6875rem', fontWeight: 700, padding: '3px 10px', borderRadius: 999, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                      {cfg.label}
                    </span>
                    {invoice.compiled_invoice_id && (
                      <span style={{ background: '#F5F3FF', color: '#7C3AED', fontSize: '0.6875rem', fontWeight: 700, padding: '3px 10px', borderRadius: 999 }}>
                        ↗ Compiled into client invoice
                      </span>
                    )}
                  </div>
                  <h1 style={{ fontSize: '1.5rem', fontWeight: 800, color: '#0F172A', margin: '0 0 4px', fontFamily: 'monospace', letterSpacing: '-0.02em' }}>
                    {invoice.invoice_number}
                  </h1>
                  <p style={{ fontSize: '0.8125rem', color: '#94A3B8', margin: 0, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    Media Partner Invoice
                  </p>
                </div>

                <div style={{ textAlign: 'right' }}>
                  <p style={{ fontSize: '2rem', fontWeight: 800, color: '#0F172A', margin: '0 0 2px', fontFamily: 'monospace' }}>
                    {fmtMoney(invoice.total_amount)}
                  </p>
                  {invoice.paid_at && (
                    <p style={{ fontSize: '0.75rem', color: '#10B981', fontWeight: 600, margin: 0 }}>
                      Paid {fmtDate(invoice.paid_at)}
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* Meta grid */}
            <div style={{ padding: '24px 40px', borderBottom: '1px solid #F1F5F9', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '20px 32px' }}>
              <div>
                <p style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 4px' }}>Issued</p>
                <p style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#0F172A', margin: 0 }}>{fmtDate(invoice.created_at)}</p>
              </div>
              <div>
                <p style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 4px' }}>Due Date</p>
                <p style={{
                  fontSize: '0.9375rem', fontWeight: 600, margin: 0,
                  color: invoice.status === 'overdue' ? '#DC2626' : '#0F172A',
                }}>
                  {fmtDate(invoice.due_date)}
                  {invoice.status === 'overdue' && <span style={{ fontSize: '0.75rem', color: '#DC2626', marginLeft: 6, fontWeight: 700 }}>OVERDUE</span>}
                </p>
              </div>
              <div>
                <p style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 4px' }}>Billed To</p>
                <p style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#0F172A', margin: 0 }}>{invoice.client_name}</p>
                {invoice.client_email && (
                  <p style={{ fontSize: '0.75rem', color: '#64748B', margin: '2px 0 0' }}>{invoice.client_email}</p>
                )}
              </div>
              {invoice.campaign && (
                <div>
                  <p style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 4px' }}>Campaign</p>
                  <p style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#0F172A', margin: 0 }}>{invoice.campaign.name}</p>
                </div>
              )}
            </div>

            {/* Line items */}
            <div style={{ padding: '24px 40px', borderBottom: invoice.notes ? '1px solid #F1F5F9' : undefined }}>
              <p style={{ fontSize: '0.75rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 14px' }}>Line Items</p>

              {invoice.items.length === 0 ? (
                <p style={{ fontSize: '0.875rem', color: '#94A3B8', margin: 0 }}>No line items recorded.</p>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 500 }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid #E8EDF2' }}>
                        {['Description', 'Format', 'Location', 'Period', 'Rate', 'Total'].map(h => (
                          <th key={h} style={{ padding: '6px 0', textAlign: h === 'Rate' || h === 'Total' ? 'right' : 'left', fontSize: '0.6875rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap', paddingRight: h !== 'Total' ? 16 : 0 }}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {invoice.items.map((item, i) => (
                        <tr key={item.id ?? i} style={{ borderBottom: i < invoice.items.length - 1 ? '1px solid #F8FAFC' : 'none' }}>
                          <td style={{ padding: '12px 16px 12px 0', verticalAlign: 'top' }}>
                            <p style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0F172A', margin: 0 }}>{item.board_name || item.description}</p>
                            {item.board_name && item.description !== item.board_name && (
                              <p style={{ fontSize: '0.75rem', color: '#94A3B8', margin: '2px 0 0' }}>{item.description}</p>
                            )}
                          </td>
                          <td style={{ padding: '12px 16px 12px 0', fontSize: '0.8125rem', color: '#64748B', verticalAlign: 'top', whiteSpace: 'nowrap' }}>
                            {FORMAT_LABELS[item.board_format ?? ''] || item.board_format || '—'}
                          </td>
                          <td style={{ padding: '12px 16px 12px 0', fontSize: '0.8125rem', color: '#64748B', verticalAlign: 'top' }}>
                            {item.location || '—'}
                          </td>
                          <td style={{ padding: '12px 16px 12px 0', fontSize: '0.8125rem', color: '#64748B', verticalAlign: 'top', whiteSpace: 'nowrap' }}>
                            {fmtPeriod(item.start_date, item.end_date)}
                          </td>
                          <td style={{ padding: '12px 16px 12px 0', fontSize: '0.8125rem', color: '#0F172A', fontWeight: 500, textAlign: 'right', verticalAlign: 'top', whiteSpace: 'nowrap', fontFamily: 'monospace' }}>
                            {fmtMoney(item.unit_price)}
                          </td>
                          <td style={{ padding: '12px 0', fontSize: '0.875rem', color: '#0F172A', fontWeight: 700, textAlign: 'right', verticalAlign: 'top', whiteSpace: 'nowrap', fontFamily: 'monospace' }}>
                            {fmtMoney(item.total)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Totals */}
              <div style={{ borderTop: '1px solid #E8EDF2', marginTop: 16, paddingTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
                <div style={{ minWidth: 260 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 32, marginBottom: 6 }}>
                    <span style={{ fontSize: '0.8125rem', color: '#64748B' }}>Subtotal</span>
                    <span style={{ fontSize: '0.8125rem', color: '#0F172A', fontFamily: 'monospace', fontWeight: 600 }}>{fmtMoney(invoice.subtotal)}</span>
                  </div>
                  {invoice.tax_rate > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 32, marginBottom: 6 }}>
                      <span style={{ fontSize: '0.8125rem', color: '#64748B' }}>VAT ({invoice.tax_rate}%)</span>
                      <span style={{ fontSize: '0.8125rem', color: '#0F172A', fontFamily: 'monospace', fontWeight: 600 }}>{fmtMoney(invoice.tax_amount)}</span>
                    </div>
                  )}
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 32, borderTop: '2px solid #0F172A', paddingTop: 10, marginTop: 6 }}>
                    <span style={{ fontSize: '0.9375rem', fontWeight: 800, color: '#0F172A' }}>Total</span>
                    <span style={{ fontSize: '1.0625rem', fontWeight: 800, color: '#0F172A', fontFamily: 'monospace' }}>{fmtMoney(invoice.total_amount)}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Notes */}
            {invoice.notes && (
              <div style={{ padding: '20px 40px' }}>
                <p style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 6px' }}>Notes</p>
                <p style={{ fontSize: '0.875rem', color: '#475569', margin: 0, lineHeight: 1.6 }}>{invoice.notes}</p>
              </div>
            )}

            {/* Status info banner */}
            {invoice.status === 'sent' && (
              <div style={{ margin: '0 40px 32px', background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 10, padding: '12px 16px', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }}><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                <div>
                  <p style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#1D4ED8', margin: '0 0 2px' }}>Awaiting agency acknowledgment</p>
                  <p style={{ fontSize: '0.75rem', color: '#3B82F6', margin: 0 }}>The agency will receive this invoice and compile it into their client billing.</p>
                </div>
              </div>
            )}
            {invoice.status === 'overdue' && (
              <div style={{ margin: '0 40px 32px', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 10, padding: '12px 16px', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#DC2626" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }}><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                <div>
                  <p style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#991B1B', margin: '0 0 2px' }}>Payment overdue</p>
                  <p style={{ fontSize: '0.75rem', color: '#7F1D1D', margin: 0 }}>This invoice was due on {fmtDate(invoice.due_date)}. Follow up with the agency.</p>
                </div>
              </div>
            )}
          </div>
        )}

        <style>{`
          @keyframes spin { to { transform: rotate(360deg); } }
          @media print {
            body { background: #fff !important; }
            button, a[href*="dashboard"] { display: none !important; }
          }
        `}</style>
      </div>
    </RoleGuard>
  );
}
