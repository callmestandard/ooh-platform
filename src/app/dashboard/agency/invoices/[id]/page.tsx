'use client';

import { useState, useEffect, use } from 'react';
import { useRouter } from 'next/navigation';
import type { Invoice, InvoiceItem } from '@/lib/types';
import ActivityTimeline from '@/components/activity/ActivityTimeline';
import { computeTaxBreakdown } from '@/lib/erp-export';
import { supabase } from '@/lib/supabase';

type FullInvoice = Invoice & {
  campaign?: { id: string; name: string };
  items: InvoiceItem[];
};

const STATUS_CONFIG: Record<string, { label: string; bg: string; color: string; dot: string }> = {
  draft:     { label: 'Draft',     bg: '#F1F5F9', color: '#475569', dot: '#94A3B8' },
  sent:      { label: 'Sent',      bg: '#EFF6FF', color: '#1D4ED8', dot: '#3B82F6' },
  paid:      { label: 'Paid',      bg: '#ECFDF5', color: '#065F46', dot: '#10B981' },
  overdue:   { label: 'Overdue',   bg: '#FEF2F2', color: '#991B1B', dot: '#EF4444' },
  cancelled: { label: 'Cancelled', bg: '#F8FAFC', color: '#94A3B8', dot: '#CBD5E1' },
};

const FORMAT_LABELS: Record<string, string> = {
  billboard: 'Billboard', unipole: 'Unipole', gantry: 'Gantry',
  bridge_panel: 'Bridge Panel', wall_drape: 'Wall Drape',
};

function fmtNaira(n: number) {
  if (n >= 1_000_000) return '₦' + (n / 1_000_000).toFixed(2) + 'M';
  if (n >= 1_000)     return '₦' + n.toLocaleString('en-NG');
  return '₦' + n.toFixed(2);
}

function fmtDate(s?: string | null) {
  if (!s) return '—';
  return new Date(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [invoice, setInvoice]         = useState<FullInvoice | null>(null);
  const [loading, setLoading]         = useState(true);
  const [updating, setUpdating]       = useState(false);
  const [showPayModal, setShowPayModal] = useState(false);
  const [payRef, setPayRef]           = useState('');
  const [toast, setToast]             = useState<{ msg: string; ok: boolean } | null>(null);
  const [generatingLink, setGeneratingLink] = useState(false);
  const [paymentLink, setPaymentLink] = useState('');
  const [copiedLink, setCopiedLink]   = useState(false);
  const [activityKey, setActivityKey] = useState(0);
  const [erpForm, setErpForm] = useState({
    erp_system: '',
    client_cost_centre: '',
    payment_terms: 'Net 30',
    client_invoice_number: '',
    wht_rate: '5',
  });
  const [savingErp, setSavingErp] = useState(false);

  useEffect(() => { fetchInvoice(); }, [id]);

  async function fetchInvoice() {
    const res = await fetch(`/api/invoices/${id}`);
    if (res.ok) {
      const data = await res.json() as FullInvoice;
      setInvoice(data);
      setErpForm({
        erp_system: data.campaign?.erp_system || '',
        client_cost_centre: data.campaign?.client_cost_centre || '',
        payment_terms: data.campaign?.payment_terms || 'Net 30',
        client_invoice_number: data.client_invoice_number || '',
        wht_rate: String(data.wht_rate ?? 5),
      });
    }
    setLoading(false);
  }

  async function saveErpFields() {
    if (!invoice) return;
    setSavingErp(true);
    const res = await fetch(`/api/invoices/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_invoice_number: erpForm.client_invoice_number.trim() || null,
        wht_rate: parseFloat(erpForm.wht_rate) || 5,
      }),
    });
    if (invoice.campaign?.id) {
      await supabase.from('campaigns').update({
        erp_system: erpForm.erp_system || null,
        client_cost_centre: erpForm.client_cost_centre || null,
        payment_terms: erpForm.payment_terms || null,
      }).eq('id', invoice.campaign.id);
    }
    if (res.ok) {
      const data = await res.json() as FullInvoice;
      setInvoice({
        ...data,
        campaign: invoice.campaign ? {
          ...invoice.campaign,
          erp_system: erpForm.erp_system || null,
          client_cost_centre: erpForm.client_cost_centre || null,
          payment_terms: erpForm.payment_terms || null,
        } : data.campaign,
      });
      setActivityKey(k => k + 1);
      showToast('ERP fields saved');
    } else {
      showToast('Failed to save ERP fields', false);
    }
    setSavingErp(false);
  }

  function showToast(msg: string, ok = true) {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3500);
  }

  async function patch(updates: Record<string, unknown>) {
    setUpdating(true);
    const res = await fetch(`/api/invoices/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    const data = await res.json();
    if (res.ok) {
      setInvoice(data);
      showToast('Invoice updated');
      setActivityKey(k => k + 1);
    }
    else showToast(data.error || 'Update failed', false);
    setUpdating(false);
  }

  async function recordPayment() {
    await patch({ status: 'paid', payment_ref: payRef || invoice?.invoice_number, paid_at: new Date().toISOString() });
    setShowPayModal(false);
    setPayRef('');
  }

  async function generatePaymentLink() {
    if (!invoice) return;
    setGeneratingLink(true);
    try {
      const res  = await fetch(`/api/invoices/${invoice.id}/paystack`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      const link = data.authorization_url;
      setPaymentLink(link);
      setInvoice(prev => prev ? { ...prev, status: 'sent', payment_url: link } : prev);
      showToast('Payment link generated — copy and send to your client');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to generate link', false);
    } finally {
      setGeneratingLink(false);
    }
  }

  async function copyLink(link: string) {
    await navigator.clipboard.writeText(link);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  }

  function shareWhatsApp(link: string) {
    if (!invoice) return;
    const text = `Hello, please find your invoice ${invoice.invoice_number} for ${fmtNaira(invoice.total_amount)} from OOH Platform.\n\nPay securely here: ${link}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
  }

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 300, gap: 12 }}>
      <div style={{ width: 22, height: 22, border: '2px solid #E2E8F0', borderTopColor: '#1B4F8A', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <span style={{ fontSize: '0.875rem', color: '#94A3B8' }}>Loading invoice…</span>
    </div>
  );

  if (!invoice) return (
    <div style={{ textAlign: 'center', padding: '3rem 0' }}>
      <p style={{ fontSize: '1rem', color: '#64748B' }}>Invoice not found.</p>
      <button onClick={() => router.back()} style={{ marginTop: 12, background: '#1B4F8A', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 18px', cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.875rem', fontWeight: 600 }}>← Back</button>
    </div>
  );

  const sc = STATUS_CONFIG[invoice.status] || STATUS_CONFIG.draft;
  const canSend   = invoice.status === 'draft';
  const canPay    = invoice.status === 'sent' || invoice.status === 'overdue';
  const canCancel = invoice.status !== 'paid' && invoice.status !== 'cancelled';
  const tax = computeTaxBreakdown(
    invoice.subtotal,
    invoice.tax_rate,
    parseFloat(erpForm.wht_rate) || invoice.wht_rate || 5,
  );

  const erpInput: React.CSSProperties = {
    width: '100%', padding: '8px 10px', border: '1px solid #E2E8F0', borderRadius: 7,
    fontSize: '0.8125rem', color: '#0F172A', fontFamily: 'inherit', boxSizing: 'border-box',
  };

  return (
    <div style={{ fontFamily: "'Inter', -apple-system, sans-serif", maxWidth: 960, margin: '0 auto', padding: '0 0 60px' }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } } @keyframes fadeIn { from { opacity:0;transform:translateY(6px) } to { opacity:1;transform:none } }`}</style>

      {/* ── Toast ── */}
      {toast && (
        <div style={{ position: 'fixed', top: 20, right: 20, zIndex: 100, background: toast.ok ? '#0F172A' : '#EF4444', color: '#fff', padding: '12px 18px', borderRadius: 10, fontSize: '0.875rem', fontWeight: 600, boxShadow: '0 4px 20px rgba(0,0,0,0.2)', animation: 'fadeIn 0.2s both' }}>
          {toast.ok ? '✓' : '✕'} {toast.msg}
        </div>
      )}

      {/* ── Back + header ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
        <button onClick={() => router.push('/dashboard/agency/invoices')}
          style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 8, padding: '7px 12px', fontSize: '0.8125rem', color: '#64748B', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 5 }}>
          ← Invoices
        </button>
        <div style={{ flex: 1 }} />
        <a href={`/api/invoices/${invoice.id}/erp-export?format=csv`}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 8, border: '1px solid #E2E8F0', background: '#fff', fontSize: '0.8125rem', fontWeight: 600, color: '#475569', textDecoration: 'none' }}>
          Export CSV
        </a>
        <a href={`/api/invoices/${invoice.id}/erp-export?format=xml`}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 8, border: '1px solid #E2E8F0', background: '#fff', fontSize: '0.8125rem', fontWeight: 600, color: '#475569', textDecoration: 'none' }}>
          Export XML
        </a>
        <a href={`/api/invoices/${invoice.id}/pdf`} target="_blank"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 8, border: '1px solid #E2E8F0', background: '#fff', fontSize: '0.8125rem', fontWeight: 600, color: '#1B4F8A', textDecoration: 'none' }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          Download PDF
        </a>
      </div>

      <div className="resp-2col" style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 20, animation: 'fadeIn 0.25s both' }}>

        {/* ── Left: Invoice document ── */}
        <div>
          {/* Invoice header card */}
          <div style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 12, overflow: 'hidden', marginBottom: 16 }}>
            <div style={{ background: '#0F172A', padding: '20px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <p style={{ fontSize: '0.6875rem', color: 'rgba(255,255,255,0.4)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 4px' }}>OOH Platform</p>
                <p style={{ fontSize: '1.5rem', fontWeight: 800, color: '#fff', margin: 0, letterSpacing: '-0.03em', fontFamily: 'monospace' }}>{invoice.invoice_number}</p>
              </div>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: sc.bg, color: sc.color, padding: '5px 12px', borderRadius: 999, fontSize: '0.8125rem', fontWeight: 700 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: sc.dot }} />{sc.label}
              </span>
            </div>

            <div style={{ padding: '16px 24px', borderBottom: '1px solid #F1F5F9', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
              {[
                { label: 'Invoice Date', value: fmtDate(invoice.created_at) },
                { label: 'Due Date',     value: fmtDate(invoice.due_date) },
                { label: 'Campaign',     value: invoice.campaign?.name || '—' },
                { label: invoice.paid_at ? 'Paid On' : 'Client', value: invoice.paid_at ? fmtDate(invoice.paid_at) : invoice.client_name },
              ].map(({ label, value }) => (
                <div key={label}>
                  <p style={{ fontSize: '0.6875rem', color: '#94A3B8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 3px' }}>{label}</p>
                  <p style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0F172A', margin: 0 }}>{value}</p>
                </div>
              ))}
            </div>

            {/* Bill To */}
            <div style={{ padding: '14px 24px', borderBottom: '1px solid #F1F5F9', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              <div style={{ width: 3, background: '#1B4F8A', borderRadius: 99, alignSelf: 'stretch', flexShrink: 0 }} />
              <div>
                <p style={{ fontSize: '0.6875rem', color: '#94A3B8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 3px' }}>Bill To</p>
                <p style={{ fontSize: '1rem', fontWeight: 700, color: '#0F172A', margin: '0 0 2px' }}>{invoice.client_name}</p>
                {invoice.client_email && <p style={{ fontSize: '0.8125rem', color: '#64748B', margin: 0 }}>{invoice.client_email}</p>}
              </div>
            </div>

            {/* Line items */}
            <div style={{ padding: '0 24px 24px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 16 }}>
                <thead>
                  <tr style={{ background: '#0F172A' }}>
                    {['#', 'Description', 'Period', 'Qty', 'Unit Price', 'Total'].map((h, i) => (
                      <th key={h} style={{ padding: '9px 12px', textAlign: i >= 4 ? 'right' : 'left', fontSize: '0.6875rem', fontWeight: 700, color: '#fff', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {invoice.items.length === 0 ? (
                    <tr><td colSpan={6} style={{ padding: '20px 12px', textAlign: 'center', fontSize: '0.875rem', color: '#94A3B8', background: '#F8FAFC' }}>No line items — add bookings to a campaign to auto-populate</td></tr>
                  ) : (
                    invoice.items.map((item, i) => (
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
                          {item.start_date ? `${fmtDate(item.start_date)} → ${fmtDate(item.end_date)}` : '—'}
                        </td>
                        <td style={{ padding: '12px', fontSize: '0.8125rem', color: '#0F172A', textAlign: 'center' }}>{item.quantity}</td>
                        <td style={{ padding: '12px', fontSize: '0.875rem', color: '#0F172A', textAlign: 'right', fontFamily: 'monospace' }}>{fmtNaira(item.unit_price)}</td>
                        <td style={{ padding: '12px', fontSize: '0.9375rem', fontWeight: 700, color: '#0F172A', textAlign: 'right', fontFamily: 'monospace' }}>{fmtNaira(item.total)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>

              {/* Totals */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
                <div style={{ width: 280 }}>
                  {[
                    { label: 'Subtotal', value: fmtNaira(tax.subtotal), bold: false },
                    { label: `VAT (${tax.vatRate}%)`, value: fmtNaira(tax.vatAmount), bold: false },
                    { label: `WHT (${tax.whtRate}%)`, value: `−${fmtNaira(tax.whtAmount)}`, bold: false },
                    { label: 'Net payable', value: fmtNaira(tax.netPayable), bold: false },
                  ].map(r => (
                    <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #F1F5F9' }}>
                      <span style={{ fontSize: '0.875rem', color: '#64748B' }}>{r.label}</span>
                      <span style={{ fontSize: '0.875rem', fontFamily: 'monospace', color: '#0F172A' }}>{r.value}</span>
                    </div>
                  ))}
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 16px', background: '#0F172A', borderRadius: 8, marginTop: 8 }}>
                    <span style={{ fontSize: '0.9375rem', fontWeight: 700, color: '#fff' }}>Total</span>
                    <span style={{ fontSize: '1.125rem', fontWeight: 800, fontFamily: 'monospace', color: '#F59E0B' }}>{fmtNaira(invoice.total_amount)}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Notes */}
            {invoice.notes && (
              <div style={{ padding: '14px 24px', borderTop: '1px solid #F1F5F9', background: '#F8FAFC' }}>
                <p style={{ fontSize: '0.6875rem', color: '#94A3B8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 6px' }}>Notes</p>
                <p style={{ fontSize: '0.875rem', color: '#334155', margin: 0, lineHeight: 1.6 }}>{invoice.notes}</p>
              </div>
            )}
          </div>

          {/* Payment confirmation */}
          {invoice.status === 'paid' && (
            <div style={{ background: '#ECFDF5', border: '1px solid #A7F3D0', borderRadius: 12, padding: '16px 20px', display: 'flex', gap: 12, alignItems: 'center' }}>
              <span style={{ fontSize: '1.5rem' }}>✅</span>
              <div>
                <p style={{ fontSize: '0.9375rem', fontWeight: 700, color: '#065F46', margin: '0 0 2px' }}>Payment received</p>
                <p style={{ fontSize: '0.8125rem', color: '#059669', margin: 0 }}>
                  Paid on {fmtDate(invoice.paid_at)}
                  {invoice.payment_ref && ` · Ref: ${invoice.payment_ref}`}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* ── Right: Actions panel ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* Actions */}
          <div style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 12, padding: 18 }}>
            <p style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 14px' }}>Actions</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>

              {/* Generate payment link (draft or sent without link) */}
              {(canSend || (canPay && !invoice.payment_url)) && (
                <button onClick={generatePaymentLink} disabled={generatingLink || updating}
                  style={{ width: '100%', padding: '10px 0', borderRadius: 9, border: 'none', background: generatingLink ? '#94A3B8' : '#1B4F8A', color: '#fff', fontSize: '0.875rem', fontWeight: 600, cursor: generatingLink ? 'not-allowed' : 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}>
                  {generatingLink
                    ? <><span style={{ display: 'inline-block', width: 13, height: 13, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} /> Generating…</>
                    : <><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg> Send to Client →</>
                  }
                </button>
              )}

              {/* Copy payment link */}
              {(paymentLink || invoice.payment_url) && (
                <div style={{ background: '#F0FDF4', border: '1px solid #A7F3D0', borderRadius: 9, padding: '10px 12px' }}>
                  <p style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#065F46', margin: '0 0 6px' }}>Payment link ready</p>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button onClick={() => copyLink(paymentLink || invoice?.payment_url || '')}
                      style={{ flex: 1, padding: '7px 0', borderRadius: 7, border: `1px solid ${copiedLink ? '#059669' : '#E2E8F0'}`, background: copiedLink ? '#059669' : '#fff', color: copiedLink ? '#fff' : '#0F172A', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                      {copiedLink ? '✓ Copied!' : 'Copy link'}
                    </button>
                    <button onClick={() => shareWhatsApp(paymentLink || invoice?.payment_url || '')}
                      style={{ flex: 1, padding: '7px 0', borderRadius: 7, border: 'none', background: '#25D366', color: '#fff', fontSize: '0.75rem', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
                      </svg>
                      WhatsApp
                    </button>
                  </div>
                  <a href={`/invoice/${invoice.id}`} target="_blank" style={{ display: 'block', marginTop: 5, fontSize: '0.625rem', color: '#059669', textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {typeof window !== 'undefined' ? `${window.location.origin}/invoice/${invoice.id}` : `/invoice/${invoice.id}`}
                  </a>
                </div>
              )}

              {canPay && (
                <button onClick={() => setShowPayModal(true)} disabled={updating}
                  style={{ width: '100%', padding: '10px 0', borderRadius: 9, border: 'none', background: '#059669', color: '#fff', fontSize: '0.875rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
                  Record Manual Payment
                </button>
              )}

              <a href={`/api/invoices/${invoice.id}/pdf`} target="_blank"
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '10px 0', borderRadius: 9, border: '1px solid #E2E8F0', background: '#fff', fontSize: '0.875rem', fontWeight: 600, color: '#1B4F8A', textDecoration: 'none' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                Download PDF
              </a>

              <a href={`/invoice/${invoice.id}`} target="_blank"
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '10px 0', borderRadius: 9, border: '1px solid #E2E8F0', background: '#fff', fontSize: '0.875rem', fontWeight: 600, color: '#64748B', textDecoration: 'none' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                Preview client view
              </a>

              {canCancel && (
                <button onClick={() => { if (confirm('Cancel this invoice?')) patch({ status: 'cancelled' }); }} disabled={updating}
                  style={{ width: '100%', padding: '10px 0', borderRadius: 9, border: '1px solid #FECACA', background: '#FEF2F2', color: '#991B1B', fontSize: '0.875rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                  Cancel Invoice
                </button>
              )}
            </div>
          </div>

          {/* ERP reconciliation */}
          <div style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 12, padding: 18, marginBottom: 12 }}>
            <p style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 4px' }}>ERP reconciliation</p>
            <p style={{ fontSize: '0.75rem', color: '#94A3B8', margin: '0 0 14px', lineHeight: 1.4 }}>
              Fields for Oracle / SAP / Business Central import. Export CSV or XML after saving.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div>
                <label style={{ fontSize: '0.75rem', fontWeight: 500, color: '#374151', display: 'block', marginBottom: 4 }}>Client ERP system</label>
                <select value={erpForm.erp_system} onChange={e => setErpForm(f => ({ ...f, erp_system: e.target.value }))} style={{ ...erpInput, cursor: 'pointer' }}>
                  <option value="">— Select —</option>
                  <option value="oracle">Oracle</option>
                  <option value="sap">SAP</option>
                  <option value="business_central">Microsoft Business Central</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: '0.75rem', fontWeight: 500, color: '#374151', display: 'block', marginBottom: 4 }}>Client PO / Oracle ref</label>
                <input value={erpForm.client_invoice_number} onChange={e => setErpForm(f => ({ ...f, client_invoice_number: e.target.value }))} placeholder="e.g. MTN-PO-2026-00441" style={erpInput} />
              </div>
              <div>
                <label style={{ fontSize: '0.75rem', fontWeight: 500, color: '#374151', display: 'block', marginBottom: 4 }}>Cost centre</label>
                <input value={erpForm.client_cost_centre} onChange={e => setErpForm(f => ({ ...f, client_cost_centre: e.target.value }))} placeholder="e.g. MKT-LAG-OOH-001" style={erpInput} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <div>
                  <label style={{ fontSize: '0.75rem', fontWeight: 500, color: '#374151', display: 'block', marginBottom: 4 }}>Payment terms</label>
                  <input value={erpForm.payment_terms} onChange={e => setErpForm(f => ({ ...f, payment_terms: e.target.value }))} style={erpInput} />
                </div>
                <div>
                  <label style={{ fontSize: '0.75rem', fontWeight: 500, color: '#374151', display: 'block', marginBottom: 4 }}>WHT %</label>
                  <input type="number" value={erpForm.wht_rate} onChange={e => setErpForm(f => ({ ...f, wht_rate: e.target.value }))} style={erpInput} />
                </div>
              </div>
              <button onClick={saveErpFields} disabled={savingErp}
                style={{ width: '100%', padding: 9, borderRadius: 8, border: 'none', background: '#1B4F8A', color: '#fff', fontSize: '0.8125rem', fontWeight: 600, cursor: savingErp ? 'not-allowed' : 'pointer', fontFamily: 'inherit', opacity: savingErp ? 0.7 : 1 }}>
                {savingErp ? 'Saving…' : 'Save ERP fields'}
              </button>
            </div>
          </div>

          {/* Invoice summary */}
          <div style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 12, padding: 18 }}>
            <p style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 14px' }}>Summary</p>
            {[
              { label: 'Line items',   value: String(invoice.items.length) },
              { label: 'Subtotal',     value: fmtNaira(invoice.subtotal) },
              { label: `VAT ${tax.vatRate}%`, value: fmtNaira(tax.vatAmount) },
              { label: `WHT ${tax.whtRate}%`, value: fmtNaira(tax.whtAmount) },
              { label: 'Net payable',  value: fmtNaira(tax.netPayable) },
            ].map(({ label, value }) => (
              <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid #F8FAFC' }}>
                <span style={{ fontSize: '0.8125rem', color: '#64748B' }}>{label}</span>
                <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#0F172A', fontFamily: label === 'Line items' ? 'inherit' : 'monospace' }}>{value}</span>
              </div>
            ))}
          </div>

          {/* Timeline */}
          <div style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 12, padding: 18 }}>
            <p style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 14px' }}>Timeline</p>
            {[
              { label: 'Created',   date: invoice.created_at,  done: true },
              { label: 'Sent',      date: invoice.status !== 'draft' ? invoice.created_at : null, done: invoice.status !== 'draft' },
              { label: 'Paid',      date: invoice.paid_at,     done: invoice.status === 'paid' },
            ].map(({ label, date, done }) => (
              <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: done ? '#10B981' : '#E2E8F0', flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <span style={{ fontSize: '0.8125rem', fontWeight: done ? 600 : 400, color: done ? '#0F172A' : '#94A3B8' }}>{label}</span>
                  {date && <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: '1px 0 0' }}>{fmtDate(date)}</p>}
                </div>
              </div>
            ))}
          </div>

          <ActivityTimeline entityType="invoice" entityId={id} title="Audit trail" refreshKey={activityKey} />
        </div>
      </div>

      {/* ── Record Payment Modal ── */}
      {showPayModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.6)', backdropFilter: 'blur(4px)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
          onClick={e => { if (e.target === e.currentTarget) setShowPayModal(false); }}>
          <div style={{ background: '#fff', borderRadius: 16, width: '100%', maxWidth: 420, padding: 28, boxShadow: '0 20px 60px rgba(0,0,0,0.2)', animation: 'fadeIn 0.2s both' }}>
            <h2 style={{ fontSize: '1.125rem', fontWeight: 700, color: '#0F172A', margin: '0 0 4px' }}>Record Payment</h2>
            <p style={{ fontSize: '0.8125rem', color: '#94A3B8', margin: '0 0 22px' }}>Mark this invoice as paid and record the payment reference.</p>

            <div style={{ background: '#ECFDF5', border: '1px solid #A7F3D0', borderRadius: 10, padding: '12px 16px', marginBottom: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.8125rem', color: '#059669', fontWeight: 600 }}>Amount</span>
              <span style={{ fontSize: '1.25rem', fontWeight: 800, color: '#065F46', fontFamily: 'monospace' }}>{fmtNaira(invoice.total_amount)}</span>
            </div>

            <label style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>Payment Reference</label>
            <input
              value={payRef}
              onChange={e => setPayRef(e.target.value)}
              placeholder={invoice.invoice_number}
              style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #E2E8F0', fontSize: '0.875rem', fontFamily: 'inherit', color: '#0F172A', boxSizing: 'border-box', marginBottom: 20 }}
              autoFocus
            />

            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setShowPayModal(false)} style={{ flex: 1, padding: '10px 0', borderRadius: 9, border: '1px solid #E2E8F0', background: '#fff', fontSize: '0.875rem', fontWeight: 600, color: '#64748B', cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
              <button onClick={recordPayment} disabled={updating}
                style={{ flex: 2, padding: '10px 0', borderRadius: 9, border: 'none', background: '#059669', color: '#fff', fontSize: '0.875rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                Confirm Payment ✓
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
