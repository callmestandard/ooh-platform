'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { Invoice } from '@/lib/types';
import { formatNaira, formatDate } from './client-utils';

const STATUS_CONFIG: Record<string, { label: string; bg: string; color: string }> = {
  draft:     { label: 'Draft',     bg: '#F1F5F9', color: '#475569' },
  sent:      { label: 'Due',       bg: '#EFF6FF', color: '#1D4ED8' },
  paid:      { label: 'Paid',      bg: '#ECFDF5', color: '#065F46' },
  overdue:   { label: 'Overdue',   bg: '#FEF2F2', color: '#991B1B' },
  cancelled: { label: 'Cancelled', bg: '#F8FAFC', color: '#94A3B8' },
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

  useEffect(() => {
    async function load() {
      setLoading(true);
      let query = supabase
        .from('invoices')
        .select('*, campaign:campaigns(id, name)')
        .order('created_at', { ascending: false });

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

  const due = invoices.filter(i => i.status === 'sent' || i.status === 'overdue');
  const paid = invoices.filter(i => i.status === 'paid');
  const totalDue = due.reduce((s, i) => s + i.total_amount, 0);
  const totalPaid = paid.reduce((s, i) => s + i.total_amount, 0);

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
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: '1.25rem' }}>
        {[
          { label: 'Outstanding', value: formatNaira(totalDue), sub: `${due.length} invoice${due.length !== 1 ? 's' : ''}`, color: due.length ? '#EF4444' : '#10B981' },
          { label: 'Paid to date', value: formatNaira(totalPaid), sub: `${paid.length} settled`, color: '#10B981' },
          { label: 'All invoices', value: String(invoices.length), sub: 'This campaign', color: '#1B4F8A' },
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
            Your agency will send an invoice when boards are booked. You can pay securely via Paystack from this page.
          </p>
        </div>
      ) : (
        <div style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ padding: '14px 20px', borderBottom: '1px solid #F1F5F9' }}>
            <h2 style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#0F172A', margin: '0 0 2px' }}>Invoices</h2>
            <p style={{ fontSize: '0.75rem', color: '#94A3B8', margin: 0 }}>View, download, and pay campaign invoices</p>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#F8FAFC' }}>
                {['Invoice', 'Amount', 'Due', 'Status', ''].map(h => (
                  <th key={h} style={{ padding: '10px 16px', fontSize: '0.6875rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.07em', textAlign: 'left', borderBottom: '1px solid #F1F5F9' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv, i) => {
                const cfg = STATUS_CONFIG[inv.status] || STATUS_CONFIG.draft;
                const canPay = inv.status === 'sent' || inv.status === 'overdue';
                return (
                  <tr key={inv.id} style={{ borderBottom: i < invoices.length - 1 ? '1px solid #F8FAFC' : 'none' }}>
                    <td style={{ padding: '14px 16px' }}>
                      <p style={{ fontSize: '0.875rem', fontWeight: 700, color: '#0F172A', margin: '0 0 2px', fontFamily: 'monospace' }}>{inv.invoice_number}</p>
                      <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: 0 }}>{inv.campaign?.name || 'Campaign invoice'}</p>
                    </td>
                    <td style={{ padding: '14px 16px', fontSize: '0.875rem', fontWeight: 700, color: '#1B4F8A', fontFamily: 'monospace' }}>
                      {formatNaira(inv.total_amount)}
                    </td>
                    <td style={{ padding: '14px 16px', fontSize: '0.8125rem', color: '#64748B' }}>
                      {inv.due_date ? formatDate(inv.due_date) : '—'}
                    </td>
                    <td style={{ padding: '14px 16px' }}>
                      <span style={{ fontSize: '0.6875rem', fontWeight: 700, background: cfg.bg, color: cfg.color, padding: '3px 9px', borderRadius: 999 }}>
                        {cfg.label}
                      </span>
                    </td>
                    <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                      <a
                        href={`/invoice/${inv.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          display: 'inline-block',
                          padding: '7px 14px',
                          background: canPay ? '#1B4F8A' : '#F1F5F9',
                          color: canPay ? '#fff' : '#475569',
                          borderRadius: 8,
                          fontSize: '0.75rem',
                          fontWeight: 700,
                          textDecoration: 'none',
                        }}
                      >
                        {canPay ? 'Pay now' : inv.status === 'paid' ? 'Receipt' : 'View'}
                      </a>
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
