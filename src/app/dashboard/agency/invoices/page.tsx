'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import type { Invoice } from '@/lib/types';

type Campaign = { id: string; name: string; client_name: string };

const STATUS_CONFIG: Record<string, { label: string; bg: string; color: string; dot: string }> = {
  draft:     { label: 'Draft',     bg: '#F1F5F9', color: '#475569', dot: '#94A3B8' },
  sent:      { label: 'Sent',      bg: '#EFF6FF', color: '#1D4ED8', dot: '#3B82F6' },
  paid:      { label: 'Paid',      bg: '#ECFDF5', color: '#065F46', dot: '#10B981' },
  overdue:   { label: 'Overdue',   bg: '#FEF2F2', color: '#991B1B', dot: '#EF4444' },
  cancelled: { label: 'Cancelled', bg: '#F8FAFC', color: '#94A3B8', dot: '#CBD5E1' },
};

const TABS = ['all', 'draft', 'sent', 'paid', 'overdue'] as const;

function fmtNaira(n: number) {
  if (n >= 1_000_000) return '₦' + (n / 1_000_000).toFixed(2) + 'M';
  if (n >= 1_000)     return '₦' + n.toLocaleString('en-NG');
  return '₦' + n.toFixed(2);
}

function fmtDate(s?: string | null) {
  if (!s) return '—';
  return new Date(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function isOverdue(inv: Invoice): boolean {
  return inv.status === 'sent' && !!inv.due_date && new Date(inv.due_date) < new Date();
}

export default function InvoicesPage() {
  const router = useRouter();
  const [invoices, setInvoices]   = useState<Invoice[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading]     = useState(true);
  const [tab, setTab]             = useState<typeof TABS[number]>('all');
  const [showModal, setShowModal] = useState(false);
  const [creating, setCreating]   = useState(false);
  const [form, setForm]           = useState({
    campaign_id: '', client_name: '', client_email: '',
    due_date: '', tax_rate: '7.5', notes: '',
  });
  const [formError, setFormError] = useState('');

  useEffect(() => {
    fetchInvoices();
    fetchCampaigns();
  }, []);

  async function fetchInvoices() {
    const { data } = await supabase
      .from('invoices')
      .select('*, campaign:campaigns(id, name)')
      .order('created_at', { ascending: false });
    // Mark overdue
    const list = ((data as Invoice[]) || []).map(inv =>
      isOverdue(inv) ? { ...inv, status: 'overdue' as const } : inv
    );
    setInvoices(list);
    setLoading(false);
  }

  async function fetchCampaigns() {
    const { data } = await supabase
      .from('campaigns')
      .select('id, name, client_name')
      .order('created_at', { ascending: false });
    setCampaigns((data as Campaign[]) || []);
  }

  function handleCampaignChange(id: string) {
    const camp = campaigns.find(c => c.id === id);
    setForm(f => ({ ...f, campaign_id: id, client_name: camp?.client_name || f.client_name }));
  }

  async function createInvoice() {
    if (!form.client_name.trim()) { setFormError('Client name is required'); return; }
    setCreating(true); setFormError('');
    try {
      const res = await fetch('/api/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaign_id:  form.campaign_id || null,
          client_name:  form.client_name,
          client_email: form.client_email || null,
          due_date:     form.due_date || null,
          tax_rate:     parseFloat(form.tax_rate) || 7.5,
          notes:        form.notes || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create invoice');
      setShowModal(false);
      router.push(`/dashboard/agency/invoices/${data.id}`);
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed');
    }
    setCreating(false);
  }

  const filtered = invoices.filter(inv => tab === 'all' || inv.status === tab);

  const stats = {
    total:   invoices.length,
    draft:   invoices.filter(i => i.status === 'draft').length,
    sent:    invoices.filter(i => i.status === 'sent').length,
    paid:    invoices.filter(i => i.status === 'paid').length,
    overdue: invoices.filter(i => i.status === 'overdue').length,
    totalValue: invoices.filter(i => i.status !== 'cancelled').reduce((s, i) => s + i.total_amount, 0),
    paidValue:  invoices.filter(i => i.status === 'paid').reduce((s, i) => s + i.total_amount, 0),
  };

  return (
    <div style={{ fontFamily: "'Inter', -apple-system, sans-serif", padding: '0 0 40px' }}>
      <style>{`@keyframes fadeIn { from { opacity:0; transform:translateY(8px) } to { opacity:1; transform:none } }`}</style>

      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: '1.375rem', fontWeight: 700, color: '#0F172A', letterSpacing: '-0.025em', margin: '0 0 4px' }}>Invoices</h1>
          <p style={{ fontSize: '0.8125rem', color: '#94A3B8', margin: 0 }}>Generate, track, and collect payments for campaign bookings</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          style={{ background: '#1B4F8A', color: '#fff', border: 'none', borderRadius: 10, padding: '10px 18px', fontSize: '0.875rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 7 }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          New Invoice
        </button>
      </div>

      {/* ── Stats ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 24 }}>
        {[
          { label: 'Total Invoices',  value: stats.total,              sub: fmtNaira(stats.totalValue),  color: '#0F172A' },
          { label: 'Draft',           value: stats.draft,              sub: 'Awaiting send',              color: '#64748B' },
          { label: 'Sent / Awaiting', value: stats.sent,               sub: 'Payment pending',            color: '#3B82F6' },
          { label: 'Paid',            value: stats.paid,               sub: fmtNaira(stats.paidValue),   color: '#10B981' },
          { label: 'Overdue',         value: stats.overdue,            sub: 'Action needed',              color: '#EF4444' },
        ].map(s => (
          <div key={s.label} style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 12, padding: '14px 16px' }}>
            <p style={{ fontSize: '0.6875rem', color: '#94A3B8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 6px' }}>{s.label}</p>
            <p style={{ fontSize: '1.5rem', fontWeight: 800, color: s.color, margin: '0 0 2px', fontFamily: 'monospace', letterSpacing: '-0.03em' }}>{s.value}</p>
            <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: 0 }}>{s.sub}</p>
          </div>
        ))}
      </div>

      {/* ── Tabs + table ── */}
      <div style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 12, overflow: 'hidden' }}>
        {/* Tab bar */}
        <div style={{ display: 'flex', borderBottom: '1px solid #F1F5F9', padding: '0 16px' }}>
          {TABS.map(t => (
            <button key={t} onClick={() => setTab(t)}
              style={{ padding: '13px 16px', border: 'none', background: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.8125rem', fontWeight: tab === t ? 600 : 400, color: tab === t ? '#1B4F8A' : '#94A3B8', borderBottom: `2px solid ${tab === t ? '#1B4F8A' : 'transparent'}`, transition: 'all 0.15s', textTransform: 'capitalize' }}>
              {t === 'all' ? `All (${stats.total})` : t}
            </button>
          ))}
        </div>

        {/* Table */}
        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '3rem', gap: 12 }}>
            <div style={{ width: 22, height: 22, border: '2px solid #E2E8F0', borderTopColor: '#1B4F8A', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            <span style={{ fontSize: '0.875rem', color: '#94A3B8' }}>Loading invoices…</span>
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '3rem 0' }}>
            <div style={{ fontSize: '2.5rem', marginBottom: 12 }}>🧾</div>
            <p style={{ fontSize: '1rem', fontWeight: 600, color: '#0F172A', margin: '0 0 6px' }}>No invoices yet</p>
            <p style={{ fontSize: '0.875rem', color: '#94A3B8', margin: '0 0 20px' }}>Create your first invoice to start billing clients.</p>
            <button onClick={() => setShowModal(true)}
              style={{ background: '#1B4F8A', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 18px', fontSize: '0.875rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
              Create invoice →
            </button>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#F8FAFC' }}>
                {['Invoice #', 'Client', 'Campaign', 'Amount', 'Due Date', 'Status', ''].map(h => (
                  <th key={h} style={{ padding: '10px 16px', textAlign: 'left', fontSize: '0.6875rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: '1px solid #F1F5F9' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((inv, i) => {
                const sc = STATUS_CONFIG[inv.status] || STATUS_CONFIG.draft;
                return (
                  <tr key={inv.id}
                    onClick={() => router.push(`/dashboard/agency/invoices/${inv.id}`)}
                    style={{ borderBottom: '1px solid #F8FAFC', cursor: 'pointer', transition: 'background 0.1s', animation: `fadeIn 0.2s ${i * 0.03}s both` }}
                    onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = '#FAFBFC'}
                    onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = ''}
                  >
                    <td style={{ padding: '14px 16px' }}>
                      <span style={{ fontSize: '0.875rem', fontWeight: 700, color: '#1B4F8A', fontFamily: 'monospace' }}>{inv.invoice_number}</span>
                    </td>
                    <td style={{ padding: '14px 16px' }}>
                      <span style={{ fontSize: '0.875rem', fontWeight: 500, color: '#0F172A' }}>{inv.client_name}</span>
                      {inv.client_email && <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: '1px 0 0' }}>{inv.client_email}</p>}
                    </td>
                    <td style={{ padding: '14px 16px' }}>
                      <span style={{ fontSize: '0.8125rem', color: '#64748B' }}>{(inv as Invoice & { campaign?: { name: string } }).campaign?.name || '—'}</span>
                    </td>
                    <td style={{ padding: '14px 16px' }}>
                      <span style={{ fontSize: '0.9375rem', fontWeight: 700, color: '#0F172A', fontFamily: 'monospace' }}>{fmtNaira(inv.total_amount)}</span>
                      {inv.tax_amount > 0 && <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: '1px 0 0' }}>incl. ₦{inv.tax_amount.toLocaleString('en-NG')} VAT</p>}
                    </td>
                    <td style={{ padding: '14px 16px' }}>
                      <span style={{ fontSize: '0.8125rem', color: inv.status === 'overdue' ? '#EF4444' : '#64748B', fontWeight: inv.status === 'overdue' ? 600 : 400 }}>{fmtDate(inv.due_date)}</span>
                    </td>
                    <td style={{ padding: '14px 16px' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: sc.bg, color: sc.color, padding: '3px 10px', borderRadius: 999, fontSize: '0.75rem', fontWeight: 600 }}>
                        <span style={{ width: 5, height: 5, borderRadius: '50%', background: sc.dot }} />
                        {sc.label}
                      </span>
                    </td>
                    <td style={{ padding: '14px 16px' }}>
                      <a
                        href={`/api/invoices/${inv.id}/pdf`}
                        target="_blank"
                        onClick={e => e.stopPropagation()}
                        style={{ fontSize: '0.75rem', color: '#1B4F8A', fontWeight: 600, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                        PDF
                      </a>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ── New Invoice Modal ── */}
      {showModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.6)', backdropFilter: 'blur(4px)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
          onClick={e => { if (e.target === e.currentTarget) setShowModal(false); }}>
          <div style={{ background: '#fff', borderRadius: 16, width: '100%', maxWidth: 520, padding: 28, boxShadow: '0 20px 60px rgba(0,0,0,0.2)', animation: 'fadeIn 0.2s both' }}>
            <h2 style={{ fontSize: '1.125rem', fontWeight: 700, color: '#0F172A', margin: '0 0 4px' }}>New Invoice</h2>
            <p style={{ fontSize: '0.8125rem', color: '#94A3B8', margin: '0 0 22px' }}>Link to a campaign to auto-populate bookings as line items.</p>

            {formError && (
              <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: '0.8125rem', color: '#991B1B' }}>{formError}</div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>Campaign (optional)</label>
                <select value={form.campaign_id} onChange={e => handleCampaignChange(e.target.value)}
                  style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid #E2E8F0', fontSize: '0.875rem', color: '#0F172A', fontFamily: 'inherit', background: '#fff' }}>
                  <option value="">— No campaign —</option>
                  {campaigns.map(c => <option key={c.id} value={c.id}>{c.name} ({c.client_name})</option>)}
                </select>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>Client Name *</label>
                  <input value={form.client_name} onChange={e => setForm(f => ({ ...f, client_name: e.target.value }))} placeholder="e.g. MTN Nigeria"
                    style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid #E2E8F0', fontSize: '0.875rem', color: '#0F172A', fontFamily: 'inherit', boxSizing: 'border-box' }} />
                </div>
                <div>
                  <label style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>Client Email</label>
                  <input type="email" value={form.client_email} onChange={e => setForm(f => ({ ...f, client_email: e.target.value }))} placeholder="billing@client.com"
                    style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid #E2E8F0', fontSize: '0.875rem', color: '#0F172A', fontFamily: 'inherit', boxSizing: 'border-box' }} />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>Due Date</label>
                  <input type="date" value={form.due_date} onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))}
                    style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid #E2E8F0', fontSize: '0.875rem', color: '#0F172A', fontFamily: 'inherit', boxSizing: 'border-box' }} />
                </div>
                <div>
                  <label style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>VAT Rate (%)</label>
                  <input type="number" value={form.tax_rate} onChange={e => setForm(f => ({ ...f, tax_rate: e.target.value }))} min="0" max="30" step="0.5"
                    style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid #E2E8F0', fontSize: '0.875rem', color: '#0F172A', fontFamily: 'inherit', boxSizing: 'border-box' }} />
                </div>
              </div>
              <div>
                <label style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>Notes</label>
                <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Payment terms, special instructions…" rows={2}
                  style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid #E2E8F0', fontSize: '0.875rem', color: '#0F172A', fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box' }} />
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 22 }}>
              <button onClick={() => setShowModal(false)} style={{ flex: 1, padding: '10px 0', borderRadius: 9, border: '1px solid #E2E8F0', background: '#fff', fontSize: '0.875rem', fontWeight: 600, color: '#64748B', cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
              <button onClick={createInvoice} disabled={creating}
                style={{ flex: 2, padding: '10px 0', borderRadius: 9, border: 'none', background: creating ? '#94A3B8' : '#1B4F8A', fontSize: '0.875rem', fontWeight: 600, color: '#fff', cursor: creating ? 'not-allowed' : 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                {creating && <span style={{ width: 14, height: 14, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', display: 'inline-block', animation: 'spin 0.7s linear infinite' }} />}
                {creating ? 'Creating…' : 'Create Invoice →'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
