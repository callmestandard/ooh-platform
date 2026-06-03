'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { Invoice } from '@/lib/types';
import { formatNaira, formatDate } from './client-utils';

const STATUS_CONFIG: Record<string, { label: string; bg: string; color: string }> = {
  draft:        { label: 'Draft',     bg: '#F1F5F9', color: '#475569' },
  sent:         { label: 'Due',       bg: '#EFF6FF', color: '#1D4ED8' },
  paid:         { label: 'Paid',      bg: '#ECFDF5', color: '#065F46' },
  overdue:      { label: 'Overdue',   bg: '#FEF2F2', color: '#991B1B' },
  cancelled:    { label: 'Cancelled', bg: '#F8FAFC', color: '#94A3B8' },
  acknowledged: { label: 'Received',  bg: '#F5F3FF', color: '#6D28D9' },
};

function isOverdue(inv: Invoice): boolean {
  return inv.status === 'sent' && !!inv.due_date && new Date(inv.due_date) < new Date();
}

type Props = {
  campaignId: string | null;
  clientName?: string | null;
};

export function ClientBillingTab({ campaignId, clientName }: Props) {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingRef, setEditingRef] = useState<string | null>(null);
  const [refValue, setRefValue] = useState('');
  const [savingRef, setSavingRef] = useState(false);

  async function saveOracleRef(invoiceId: string) {
    const trimmed = refValue.trim();
    setSavingRef(true);
    const res = await fetch(`/api/invoices/${invoiceId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_invoice_number: trimmed || null }),
    });
    if (res.ok) {
      setInvoices(prev => prev.map(inv =>
        inv.id === invoiceId ? { ...inv, client_invoice_number: trimmed || null } : inv
      ));
    }
    setSavingRef(false);
    setEditingRef(null);
  }

  useEffect(() => {
    async function load() {
      setLoading(true);
      let query = supabase
        .from('invoices')
        .select('*, items:invoice_items(description, quantity, unit_price, total), campaign:campaigns(id, name)')
        .order('created_at', { ascending: false })
        // Only show client-facing invoices (type = 'client' or legacy null)
        .or('invoice_type.eq.client,invoice_type.is.null');

      if (campaignId) query = query.eq('campaign_id', campaignId);
      else if (clientName) query = query.ilike('client_name', `%${clientName}%`);

      const { data } = await query;
      const list = ((data as Invoice[]) || []).map(inv =>
        isOverdue(inv) ? { ...inv, status: 'overdue' as const } : inv
      );
      setInvoices(list);
      setLoading(false);
    }
    load();
  }, [campaignId, clientName]);

  const due       = invoices.filter(i => i.status === 'sent' || i.status === 'overdue');
  const paid      = invoices.filter(i => i.status === 'paid');
  const totalDue  = due.reduce((s, i) => s + i.total_amount, 0);
  const totalPaid = paid.reduce((s, i) => s + i.total_amount, 0);
  const grandTotal = invoices.reduce((s, i) => s + i.total_amount, 0);

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '4rem', gap: 12 }}>
        <div style={{ width: 22, height: 22, border: '2px solid #E2E8F0', borderTopColor: '#1B4F8A', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
        <span style={{ fontSize: '0.8125rem', color: '#94A3B8' }}>Loading invoices...</span>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: '1.25rem' }}>
        {[
          { label: 'Total invoiced', value: formatNaira(grandTotal), sub: `${invoices.length} invoice${invoices.length !== 1 ? 's' : ''}`, color: '#1B4F8A' },
          { label: 'Outstanding',    value: formatNaira(totalDue),   sub: `${due.length} pending payment`,                                  color: due.length ? '#DC2626' : '#10B981' },
          { label: 'Paid to date',   value: formatNaira(totalPaid),  sub: `${paid.length} settled`,                                         color: '#10B981' },
          { label: 'Remaining',      value: formatNaira(grandTotal - totalPaid), sub: 'Balance outstanding',                                color: (grandTotal - totalPaid) > 0 ? '#D97706' : '#10B981' },
        ].map(s => (
          <div key={s.label} style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: 12, padding: '16px 18px' }}>
            <p style={{ fontSize: '0.6875rem', color: '#94A3B8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 6px' }}>{s.label}</p>
            <p style={{ fontSize: '1.375rem', fontWeight: 800, color: s.color, fontFamily: 'monospace', margin: '0 0 2px', letterSpacing: '-0.03em' }}>{s.value}</p>
            <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: 0 }}>{s.sub}</p>
          </div>
        ))}
      </div>

      {invoices.length === 0 ? (
        <div style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: 12, padding: '4rem 2rem', textAlign: 'center' }}>
          <p style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#0F172A', margin: '0 0 6px' }}>No invoices yet</p>
          <p style={{ fontSize: '0.8125rem', color: '#94A3B8', margin: 0, maxWidth: 360, marginLeft: 'auto', marginRight: 'auto' }}>
            Your agency will send an invoice when boards are booked. Download the PDF and upload it to Oracle for processing.
          </p>
        </div>
      ) : (
        <div style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ padding: '14px 20px', borderBottom: '1px solid #F1F5F9' }}>
            <h2 style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#0F172A', margin: '0 0 2px' }}>Invoices</h2>
            <p style={{ fontSize: '0.75rem', color: '#94A3B8', margin: 0 }}>Download PDF and upload to Oracle for payment processing</p>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#F8FAFC' }}>
                {['Invoice', 'Breakdown', 'Amount', 'Due date', 'Status', ''].map(h => (
                  <th key={h} style={{ padding: '10px 16px', fontSize: '0.6875rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.07em', textAlign: 'left', borderBottom: '1px solid #F1F5F9' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv, i) => {
                const cfg    = STATUS_CONFIG[inv.status] || STATUS_CONFIG.draft;
                const canPay = inv.status === 'sent' || inv.status === 'overdue';
                const items  = (inv as Invoice & { items?: { description: string; total: number }[] }).items || [];
                return (
                  <tr key={inv.id} style={{ borderBottom: i < invoices.length - 1 ? '1px solid #F8FAFC' : 'none' }}>
                    <td style={{ padding: '14px 16px' }}>
                      <p style={{ fontSize: '0.875rem', fontWeight: 700, color: '#0F172A', margin: '0 0 2px', fontFamily: 'monospace' }}>{inv.invoice_number}</p>
                      <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: '0 0 4px' }}>{inv.campaign?.name || 'Campaign invoice'}</p>
                      {/* Oracle / Client reference */}
                      {editingRef === inv.id ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 4 }}>
                          <input
                            autoFocus
                            value={refValue}
                            onChange={e => setRefValue(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') saveOracleRef(inv.id); if (e.key === 'Escape') setEditingRef(null); }}
                            placeholder="Oracle ref no."
                            style={{ width: 120, padding: '3px 7px', border: '1.5px solid #1B4F8A', borderRadius: 5, fontSize: '0.6875rem', fontFamily: 'monospace', outline: 'none' }}
                          />
                          <button onClick={() => saveOracleRef(inv.id)} disabled={savingRef}
                            style={{ background: '#1B4F8A', color: '#fff', border: 'none', borderRadius: 5, padding: '3px 8px', fontSize: '0.6875rem', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                            {savingRef ? '…' : 'Save'}
                          </button>
                          <button onClick={() => setEditingRef(null)} style={{ background: 'none', border: 'none', color: '#94A3B8', cursor: 'pointer', fontSize: '0.6875rem', padding: 2 }}>✕</button>
                        </div>
                      ) : inv.client_invoice_number ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 2 }}>
                          <span style={{ fontSize: '0.625rem', fontWeight: 700, color: '#065F46', background: '#D1FAE5', padding: '1px 6px', borderRadius: 4, fontFamily: 'monospace' }}>
                            Oracle: {inv.client_invoice_number}
                          </span>
                          <button onClick={() => { setEditingRef(inv.id); setRefValue(inv.client_invoice_number || ''); }}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8', padding: 0, lineHeight: 1 }}>
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                          </button>
                        </div>
                      ) : (
                        <button onClick={() => { setEditingRef(inv.id); setRefValue(''); }}
                          style={{ marginTop: 3, background: 'none', border: '1px dashed #CBD5E1', borderRadius: 4, padding: '2px 8px', fontSize: '0.625rem', color: '#94A3B8', cursor: 'pointer', fontFamily: 'inherit' }}>
                          + Add Oracle ref
                        </button>
                      )}
                      {inv.notes && (
                        <p style={{ fontSize: '0.6875rem', color: '#7C3AED', margin: '4px 0 0', fontStyle: 'italic' }}>{inv.notes.slice(0, 60)}{inv.notes.length > 60 ? '…' : ''}</p>
                      )}
                    </td>
                    <td style={{ padding: '14px 16px' }}>
                      {items.length > 0 ? (
                        <div>
                          {items.slice(0, 2).map((it, j) => (
                            <p key={j} style={{ fontSize: '0.6875rem', color: '#64748B', margin: '0 0 2px' }}>
                              · {it.description.slice(0, 35)}{it.description.length > 35 ? '…' : ''}
                            </p>
                          ))}
                          {items.length > 2 && (
                            <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: 0 }}>+{items.length - 2} more</p>
                          )}
                        </div>
                      ) : (
                        <span style={{ fontSize: '0.6875rem', color: '#CBD5E1' }}>—</span>
                      )}
                    </td>
                    <td style={{ padding: '14px 16px', fontSize: '0.875rem', fontWeight: 700, color: '#1B4F8A', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
                      {formatNaira(inv.total_amount)}
                    </td>
                    <td style={{ padding: '14px 16px', fontSize: '0.8125rem', color: canPay ? '#DC2626' : '#64748B', fontWeight: canPay ? 600 : 400 }}>
                      {inv.due_date ? formatDate(inv.due_date) : '—'}
                    </td>
                    <td style={{ padding: '14px 16px' }}>
                      <span style={{ fontSize: '0.6875rem', fontWeight: 700, background: cfg.bg, color: cfg.color, padding: '3px 9px', borderRadius: 999, whiteSpace: 'nowrap' }}>
                        {cfg.label}
                      </span>
                    </td>
                    <td style={{ padding: '14px 16px' }}>
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                        <a
                          href={`/api/invoices/${inv.id}/pdf`}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '6px 10px', background: '#F1F5F9', color: '#475569', borderRadius: 7, fontSize: '0.75rem', fontWeight: 600, textDecoration: 'none', whiteSpace: 'nowrap' }}
                        >
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                          PDF
                        </a>
                        <a
                          href={`/invoice/${inv.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ display: 'inline-block', padding: '6px 12px', background: canPay ? '#1B4F8A' : '#F1F5F9', color: canPay ? '#fff' : '#475569', borderRadius: 7, fontSize: '0.75rem', fontWeight: 700, textDecoration: 'none', whiteSpace: 'nowrap' }}
                        >
                          {inv.status === 'paid' ? 'Receipt' : 'View'}
                        </a>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
