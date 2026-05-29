'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

// ── Types ───────────────────────────────────────────────────────────────────

type MPI = {
  id: string;
  invoice_number: string;
  client_name: string;
  client_email: string | null;
  campaign_id: string | null;
  status: string;
  subtotal: number;
  tax_rate: number;
  tax_amount: number;
  total_amount: number;
  due_date: string | null;
  compiled_invoice_id: string | null;
  notes: string | null;
  created_at: string;
  campaign?: { id: string; name: string } | null;
  items?: { id: string; booking_id: string | null; description: string; board_name: string | null; board_format: string | null; location: string | null; start_date: string | null; end_date: string | null; total: number }[];
  compliance?: { booking_id: string; status: string; photo_url: string | null }[];
};

type ClientInvoice = {
  id: string;
  invoice_number: string;
  client_name: string;
  client_email: string | null;
  total_amount: number;
  status: string;
  due_date: string | null;
  created_at: string;
  campaign?: { id: string; name: string } | null;
};

type Campaign = { id: string; name: string; client_name: string };

// ── Helpers ─────────────────────────────────────────────────────────────────

function fmtNaira(n: number) {
  if (n >= 1_000_000) return '₦' + (n / 1_000_000).toFixed(2) + 'M';
  return '₦' + Number(n).toLocaleString('en-NG');
}

function fmtDate(s?: string | null) {
  if (!s) return '—';
  return new Date(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

const STATUS_CFG: Record<string, { bg: string; color: string; label: string }> = {
  draft:        { bg: '#F1F5F9', color: '#475569', label: 'Draft' },
  sent:         { bg: '#EFF6FF', color: '#1D4ED8', label: 'From Owner' },
  acknowledged: { bg: '#F5F3FF', color: '#3730A3', label: 'Compiled' },
  paid:         { bg: '#ECFDF5', color: '#065F46', label: 'Paid' },
  overdue:      { bg: '#FEF2F2', color: '#991B1B', label: 'Overdue' },
  cancelled:    { bg: '#F8FAFC', color: '#94A3B8', label: 'Cancelled' },
};

// ── Main page ────────────────────────────────────────────────────────────────

export default function AgencyInvoicesPage() {
  const router = useRouter();
  const [mainTab, setMainTab] = useState<'received' | 'sent'>('received');
  const [mpis, setMpis] = useState<MPI[]>([]);
  const [clientInvoices, setClientInvoices] = useState<ClientInvoice[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState('');
  const [toastErr, setToastErr] = useState(false);

  // Compile panel state
  const [showCompile, setShowCompile] = useState(false);
  const [selectedMPIs, setSelectedMPIs] = useState<Set<string>>(new Set());
  const [compileForm, setCompileForm] = useState({
    clientName: '',
    clientEmail: '',
    agencyFee: '',
    agencyFeeLabel: 'Agency management fee',
    dueDate: '',
    taxRate: '7.5',
    notes: '',
    includeCompliance: true,
    campaignId: '',
  });
  const [compiling, setCompiling] = useState(false);
  const [compiledResult, setCompiledResult] = useState<{ id: string; invoice_number: string; total_amount: number } | null>(null);

  // New direct client invoice modal
  const [showNewInvoice, setShowNewInvoice] = useState(false);
  const [newInvForm, setNewInvForm] = useState({ campaign_id: '', client_name: '', client_email: '', due_date: '', tax_rate: '7.5', notes: '' });
  const [newInvSaving, setNewInvSaving] = useState(false);

  // Filter
  const [filterCampaign, setFilterCampaign] = useState('');

  const showToast = useCallback((msg: string, err = false) => {
    setToast(msg); setToastErr(err);
    setTimeout(() => setToast(''), 3500);
  }, []);

  useEffect(() => { fetchAll(); }, []);

  async function fetchAll() {
    setLoading(true);
    const [mpiRes, clientRes, campRes] = await Promise.all([
      supabase
        .from('invoices')
        .select('*, campaign:campaigns(id, name), items:invoice_items(*)')
        .eq('invoice_type', 'media_partner')
        .order('created_at', { ascending: false }),
      supabase
        .from('invoices')
        .select('*, campaign:campaigns(id, name)')
        .eq('invoice_type', 'client')
        .order('created_at', { ascending: false }),
      supabase.from('campaigns').select('id, name, client_name').order('name'),
    ]);

    const rawMpis = (mpiRes.data ?? []) as unknown as MPI[];

    // Pull compliance checks for all bookings referenced in MPIs
    const bookingIds = rawMpis
      .flatMap(m => (m.items ?? []).map(i => i.booking_id).filter(Boolean)) as string[];

    if (bookingIds.length > 0) {
      const { data: checks } = await supabase
        .from('compliance_checks')
        .select('booking_id, status, photo_url')
        .in('booking_id', bookingIds);

      if (checks) {
        const byBooking: Record<string, typeof checks> = {};
        for (const c of checks) {
          if (!byBooking[c.booking_id]) byBooking[c.booking_id] = [];
          byBooking[c.booking_id].push(c);
        }
        for (const m of rawMpis) {
          m.compliance = (m.items ?? [])
            .flatMap(i => i.booking_id ? (byBooking[i.booking_id] ?? []) : []);
        }
      }
    }

    setMpis(rawMpis);
    setClientInvoices((clientRes.data ?? []) as unknown as ClientInvoice[]);
    setCampaigns((campRes.data ?? []) as Campaign[]);
    setLoading(false);
  }

  const filteredMPIs = filterCampaign
    ? mpis.filter(m => m.campaign_id === filterCampaign)
    : mpis;

  const pendingMPIs = filteredMPIs.filter(m => m.status === 'sent');

  function toggleMPI(id: string) {
    setSelectedMPIs(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function openCompile() {
    if (selectedMPIs.size === 0) { showToast('Select at least one invoice to compile', true); return; }
    const first = mpis.find(m => selectedMPIs.has(m.id));
    const camp = first?.campaign_id ? campaigns.find(c => c.id === first.campaign_id) : null;
    setCompileForm(f => ({
      ...f,
      campaignId: camp?.id ?? '',
      clientName: camp?.client_name ?? '',
    }));
    setCompiledResult(null);
    setShowCompile(true);
  }

  async function compileInvoice() {
    if (!compileForm.clientName.trim()) { showToast('Enter client name', true); return; }
    setCompiling(true);
    try {
      const res = await fetch('/api/invoices/compile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mpi_ids: [...selectedMPIs],
          campaign_id: compileForm.campaignId || undefined,
          client_name: compileForm.clientName.trim(),
          client_email: compileForm.clientEmail.trim() || undefined,
          agency_fee: parseFloat(compileForm.agencyFee) || 0,
          agency_fee_label: compileForm.agencyFeeLabel.trim() || 'Agency management fee',
          due_date: compileForm.dueDate || undefined,
          tax_rate: parseFloat(compileForm.taxRate) || 7.5,
          notes: compileForm.notes.trim() || undefined,
          include_compliance: compileForm.includeCompliance,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setCompiledResult(data as { id: string; invoice_number: string; total_amount: number });
      setMpis(prev => prev.map(m =>
        selectedMPIs.has(m.id) ? { ...m, status: 'acknowledged', compiled_invoice_id: data.id } : m
      ));
      setClientInvoices(prev => [data as ClientInvoice, ...prev]);
      setSelectedMPIs(new Set());
      showToast('Client invoice created');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Compile failed', true);
    } finally {
      setCompiling(false);
    }
  }

  async function createDirectInvoice() {
    if (!newInvForm.client_name.trim()) { showToast('Client name is required', true); return; }
    setNewInvSaving(true);
    try {
      const res = await fetch('/api/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaign_id: newInvForm.campaign_id || null,
          client_name: newInvForm.client_name,
          client_email: newInvForm.client_email || null,
          due_date: newInvForm.due_date || null,
          tax_rate: parseFloat(newInvForm.tax_rate) || 7.5,
          notes: newInvForm.notes || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setShowNewInvoice(false);
      router.push(`/invoice/${data.id}`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed', true);
    } finally {
      setNewInvSaving(false);
    }
  }

  async function sendClientInvoice(id: string) {
    const res = await fetch(`/api/invoices/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'sent' }),
    });
    if (res.ok) {
      setClientInvoices(prev => prev.map(i => i.id === id ? { ...i, status: 'sent' } : i));
      showToast('Invoice marked as sent');
    } else {
      showToast('Failed to update status', true);
    }
  }

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '40vh', fontFamily: "'Inter', sans-serif" }}>
      <div style={{ width: 28, height: 28, border: '3px solid #E2E8F0', borderTopColor: '#1B4F8A', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );

  const totalPending = pendingMPIs.reduce((s, m) => s + m.total_amount, 0);
  const totalCompiled = mpis.filter(m => m.status === 'acknowledged').reduce((s, m) => s + m.total_amount, 0);
  const totalBilled = clientInvoices.reduce((s, i) => s + i.total_amount, 0);
  const selectedTotal = [...selectedMPIs].reduce((s, id) => { const m = mpis.find(x => x.id === id); return s + (m?.total_amount ?? 0); }, 0);

  return (
    <div style={{ fontFamily: "'Inter', -apple-system, sans-serif" }}>
      <style>{`
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes fadeUp{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
        .inv-row:hover{background:#F5F8FF!important}
      `}</style>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={() => router.back()} style={{ background: 'none', border: '1px solid #E2E8F0', borderRadius: 8, padding: '6px 12px', fontSize: '0.8125rem', color: '#64748B', cursor: 'pointer', fontFamily: 'inherit' }}>← Back</button>
          <div>
            <h1 style={{ fontSize: '1.125rem', fontWeight: 700, color: '#0F172A', margin: 0 }}>Invoice Management</h1>
            <p style={{ fontSize: '0.75rem', color: '#94A3B8', margin: 0 }}>Receive from media partners · Compile with compliance · Send to clients</p>
          </div>
        </div>
        <button
          onClick={() => setShowNewInvoice(true)}
          style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#0F172A', color: '#fff', border: 'none', padding: '9px 16px', borderRadius: 9, fontSize: '0.8125rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
        >
          + Direct Client Invoice
        </button>
      </div>

      {/* KPI strip */}
      <div className="resp-grid-4" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 20 }}>
        {[
          { label: 'Pending from owners', value: fmtNaira(totalPending), sub: `${pendingMPIs.length} invoice${pendingMPIs.length !== 1 ? 's' : ''} awaiting compile`, color: '#F59E0B' },
          { label: 'Compiled (owner paid)', value: fmtNaira(totalCompiled), sub: `${mpis.filter(m => m.status === 'acknowledged').length} compiled`, color: '#8B5CF6' },
          { label: 'Total billed to clients', value: fmtNaira(totalBilled), sub: `${clientInvoices.length} client invoice${clientInvoices.length !== 1 ? 's' : ''}`, color: '#10B981' },
        ].map(k => (
          <div key={k.label} style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: 12, padding: '16px 20px' }}>
            <p style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 8px' }}>{k.label}</p>
            <p style={{ fontSize: '1.5rem', fontWeight: 800, color: k.color, fontFamily: 'monospace', letterSpacing: '-0.03em', margin: '0 0 3px' }}>{k.value}</p>
            <p style={{ fontSize: '0.6875rem', color: '#CBD5E1', margin: 0 }}>{k.sub}</p>
          </div>
        ))}
      </div>

      {/* Tab nav */}
      <div className="resp-tabs" style={{ display: 'flex', gap: 4, background: '#F1F5F9', padding: 4, borderRadius: 10, width: 'fit-content', marginBottom: 20 }}>
        {[
          { key: 'received', label: `From Media Partners (${mpis.length})` },
          { key: 'sent', label: `To Clients (${clientInvoices.length})` },
        ].map(t => (
          <button key={t.key} onClick={() => setMainTab(t.key as typeof mainTab)}
            style={{ padding: '7px 16px', borderRadius: 7, border: 'none', background: mainTab === t.key ? '#fff' : 'transparent', color: mainTab === t.key ? '#0F172A' : '#64748B', fontSize: '0.8125rem', fontWeight: mainTab === t.key ? 600 : 400, cursor: 'pointer', fontFamily: 'inherit', boxShadow: mainTab === t.key ? '0 1px 3px rgba(0,0,0,0.08)' : 'none' }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── From Media Partners ── */}
      {mainTab === 'received' && (
        <div>
          {/* Toolbar */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <select value={filterCampaign} onChange={e => setFilterCampaign(e.target.value)}
                style={{ padding: '7px 12px', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: '0.8125rem', fontFamily: 'inherit', background: '#fff', color: '#0F172A' }}>
                <option value="">All campaigns</option>
                {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              {selectedMPIs.size > 0 && (
                <span style={{ fontSize: '0.75rem', color: '#1B4F8A', fontWeight: 600, background: '#EFF6FF', padding: '4px 10px', borderRadius: 999 }}>
                  {selectedMPIs.size} selected · {fmtNaira(selectedTotal)}
                </span>
              )}
            </div>
            {selectedMPIs.size > 0 && (
              <button onClick={openCompile}
                style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#1B4F8A', color: '#fff', border: 'none', padding: '9px 18px', borderRadius: 9, fontSize: '0.8125rem', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                Compile & Send to Client →
              </button>
            )}
          </div>

          {filteredMPIs.length === 0 ? (
            <div style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: 12, padding: '3rem', textAlign: 'center' }}>
              <p style={{ fontSize: '2rem', margin: '0 0 8px' }}>📭</p>
              <p style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#0F172A', margin: '0 0 4px' }}>No invoices from media partners yet</p>
              <p style={{ fontSize: '0.8125rem', color: '#94A3B8', margin: 0 }}>Board owners will send invoices here once bookings are agreed and live</p>
            </div>
          ) : (
            <div className="table-scroll" style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: 12, overflow: 'hidden' }}>
              {/* Select-all header */}
              <div style={{ padding: '10px 14px', borderBottom: '1px solid #F1F5F9', display: 'flex', alignItems: 'center', gap: 10, background: '#FAFBFF' }}>
                <input type="checkbox"
                  checked={pendingMPIs.length > 0 && pendingMPIs.every(m => selectedMPIs.has(m.id))}
                  onChange={e => { if (e.target.checked) setSelectedMPIs(new Set(pendingMPIs.map(m => m.id))); else setSelectedMPIs(new Set()); }}
                  style={{ width: 15, height: 15, cursor: 'pointer', accentColor: '#1B4F8A' }}
                />
                <span style={{ fontSize: '0.75rem', color: '#64748B' }}>
                  Check owner invoices (status: <strong>From Owner</strong>) to compile them into a single client invoice
                </span>
              </div>

              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#F8FAFC' }}>
                    <th style={{ width: 36, padding: '10px 12px' }} />
                    {['Invoice #', 'From Owner', 'Campaign', 'Boards', 'Compliance', 'Amount', 'Due', 'Status'].map(h => (
                      <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontSize: '0.6875rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredMPIs.map((mpi, i) => {
                    const cfg = STATUS_CFG[mpi.status] ?? STATUS_CFG.draft;
                    const isSelectable = mpi.status === 'sent';
                    const isSelected = selectedMPIs.has(mpi.id);
                    const verifiedCount = (mpi.compliance ?? []).filter(c => c.status === 'verified').length;
                    const totalChecks = (mpi.compliance ?? []).length;
                    const pct = totalChecks > 0 ? Math.round((verifiedCount / totalChecks) * 100) : null;

                    return (
                      <tr key={mpi.id} className="inv-row"
                        style={{ borderBottom: i < filteredMPIs.length - 1 ? '1px solid #F8FAFC' : 'none', background: isSelected ? '#EFF6FF' : '#fff', cursor: isSelectable ? 'pointer' : 'default', transition: 'background 0.1s' }}
                        onClick={() => isSelectable && toggleMPI(mpi.id)}
                      >
                        <td style={{ padding: '12px 12px' }}>
                          {isSelectable && (
                            <input type="checkbox" checked={isSelected} onChange={() => toggleMPI(mpi.id)} onClick={e => e.stopPropagation()}
                              style={{ width: 15, height: 15, cursor: 'pointer', accentColor: '#1B4F8A' }} />
                          )}
                        </td>
                        <td style={{ padding: '12px 12px' }}>
                          <span style={{ fontSize: '0.8125rem', fontWeight: 700, color: '#0F172A', fontFamily: 'monospace' }}>{mpi.invoice_number}</span>
                          <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: '2px 0 0' }}>{fmtDate(mpi.created_at)}</p>
                        </td>
                        <td style={{ padding: '12px 12px' }}>
                          <p style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#0F172A', margin: 0 }}>{mpi.client_name}</p>
                          {mpi.client_email && <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: '2px 0 0' }}>{mpi.client_email}</p>}
                        </td>
                        <td style={{ padding: '12px 12px', fontSize: '0.8125rem', color: '#64748B' }}>{mpi.campaign?.name ?? '—'}</td>
                        <td style={{ padding: '12px 12px' }}>
                          {(mpi.items ?? []).slice(0, 2).map((item, j) => (
                            <p key={j} style={{ fontSize: '0.6875rem', color: '#475569', margin: j > 0 ? '2px 0 0' : 0, fontWeight: 500 }}>
                              {item.description}{item.location ? ` · ${item.location}` : ''}
                            </p>
                          ))}
                          {(mpi.items?.length ?? 0) > 2 && <p style={{ fontSize: '0.625rem', color: '#94A3B8', margin: '2px 0 0' }}>+{(mpi.items?.length ?? 0) - 2} more</p>}
                        </td>
                        <td style={{ padding: '12px 12px' }}>
                          {pct === null ? (
                            <span style={{ fontSize: '0.6875rem', color: '#CBD5E1' }}>No checks</span>
                          ) : (
                            <>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <div style={{ flex: 1, height: 5, background: '#E2E8F0', borderRadius: 99, minWidth: 48 }}>
                                  <div style={{ height: '100%', background: pct === 100 ? '#10B981' : pct >= 50 ? '#F59E0B' : '#EF4444', borderRadius: 99, width: `${pct}%` }} />
                                </div>
                                <span style={{ fontSize: '0.625rem', fontWeight: 700, color: pct === 100 ? '#10B981' : '#64748B' }}>{pct}%</span>
                              </div>
                              <p style={{ fontSize: '0.5625rem', color: '#CBD5E1', margin: '2px 0 0' }}>{verifiedCount}/{totalChecks} verified</p>
                            </>
                          )}
                        </td>
                        <td style={{ padding: '12px 12px', fontFamily: 'monospace', fontWeight: 700, color: '#0F172A', fontSize: '0.9375rem', whiteSpace: 'nowrap' }}>
                          {fmtNaira(mpi.total_amount)}
                        </td>
                        <td style={{ padding: '12px 12px', fontSize: '0.8125rem', color: mpi.due_date && new Date(mpi.due_date) < new Date() && mpi.status !== 'paid' ? '#DC2626' : '#64748B' }}>
                          {mpi.due_date ? new Date(mpi.due_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '—'}
                        </td>
                        <td style={{ padding: '12px 12px' }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: cfg.bg, color: cfg.color, padding: '3px 9px', borderRadius: 999, fontSize: '0.6875rem', fontWeight: 700 }}>{cfg.label}</span>
                          {mpi.compiled_invoice_id && (
                            <a href={`/invoice/${mpi.compiled_invoice_id}`} target="_blank" onClick={e => e.stopPropagation()}
                              style={{ display: 'block', fontSize: '0.6875rem', color: '#8B5CF6', fontWeight: 600, marginTop: 3, textDecoration: 'none' }}>
                              View client invoice →
                            </a>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── To Clients ── */}
      {mainTab === 'sent' && (
        <div>
          {clientInvoices.length === 0 ? (
            <div style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: 12, padding: '3rem', textAlign: 'center' }}>
              <p style={{ fontSize: '2rem', margin: '0 0 8px' }}>🧾</p>
              <p style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#0F172A', margin: '0 0 4px' }}>No client invoices yet</p>
              <p style={{ fontSize: '0.8125rem', color: '#94A3B8', margin: '0 0 16px' }}>Compile media partner invoices or create a direct invoice for a client</p>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
                <button onClick={() => setMainTab('received')} style={{ background: '#1B4F8A', color: '#fff', border: 'none', padding: '9px 18px', borderRadius: 9, fontSize: '0.8125rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>Compile from owners →</button>
                <button onClick={() => setShowNewInvoice(true)} style={{ background: '#F8FAFC', color: '#0F172A', border: '1px solid #E2E8F0', padding: '9px 18px', borderRadius: 9, fontSize: '0.8125rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>Direct invoice</button>
              </div>
            </div>
          ) : (
            <div className="table-scroll" style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: 12, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#F8FAFC' }}>
                    {['Invoice #', 'Client', 'Campaign', 'Amount', 'Due', 'Status', 'Actions'].map(h => (
                      <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: '0.6875rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {clientInvoices.map((inv, i) => {
                    const cfgKey = inv.status === 'sent' ? 'sent' : inv.status;
                    const cfg2: Record<string, { bg: string; color: string; label: string }> = {
                      draft:    { bg: '#F1F5F9', color: '#475569', label: 'Draft' },
                      sent:     { bg: '#EFF6FF', color: '#1D4ED8', label: 'Sent' },
                      paid:     { bg: '#ECFDF5', color: '#065F46', label: 'Paid' },
                      overdue:  { bg: '#FEF2F2', color: '#991B1B', label: 'Overdue' },
                    };
                    const cfg = cfg2[cfgKey] ?? cfg2.draft;
                    return (
                      <tr key={inv.id} className="inv-row" style={{ borderBottom: i < clientInvoices.length - 1 ? '1px solid #F8FAFC' : 'none', background: '#fff', transition: 'background 0.1s' }}>
                        <td style={{ padding: '12px 14px' }}>
                          <span style={{ fontSize: '0.8125rem', fontWeight: 700, color: '#0F172A', fontFamily: 'monospace' }}>{inv.invoice_number}</span>
                          <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: '2px 0 0' }}>{fmtDate(inv.created_at)}</p>
                        </td>
                        <td style={{ padding: '12px 14px' }}>
                          <p style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#0F172A', margin: 0 }}>{inv.client_name}</p>
                          {inv.client_email && <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: '2px 0 0' }}>{inv.client_email}</p>}
                        </td>
                        <td style={{ padding: '12px 14px', fontSize: '0.8125rem', color: '#64748B' }}>{inv.campaign?.name ?? '—'}</td>
                        <td style={{ padding: '12px 14px', fontFamily: 'monospace', fontWeight: 700, color: '#0F172A', fontSize: '0.9375rem', whiteSpace: 'nowrap' }}>{fmtNaira(inv.total_amount)}</td>
                        <td style={{ padding: '12px 14px', fontSize: '0.8125rem', color: inv.due_date && new Date(inv.due_date) < new Date() && inv.status !== 'paid' ? '#DC2626' : '#64748B' }}>
                          {inv.due_date ? new Date(inv.due_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '—'}
                        </td>
                        <td style={{ padding: '12px 14px' }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: cfg.bg, color: cfg.color, padding: '3px 9px', borderRadius: 999, fontSize: '0.6875rem', fontWeight: 700 }}>{cfg.label}</span>
                        </td>
                        <td style={{ padding: '12px 14px' }}>
                          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                            <a href={`/invoice/${inv.id}`} target="_blank"
                              style={{ fontSize: '0.75rem', fontWeight: 600, color: '#1B4F8A', textDecoration: 'none', background: '#EFF6FF', padding: '5px 10px', borderRadius: 7 }}>
                              View
                            </a>
                            {inv.status === 'draft' && (
                              <button onClick={() => sendClientInvoice(inv.id)}
                                style={{ fontSize: '0.75rem', fontWeight: 600, color: '#fff', background: '#10B981', border: 'none', padding: '5px 10px', borderRadius: 7, cursor: 'pointer', fontFamily: 'inherit' }}>
                                Send to Client
                              </button>
                            )}
                            <button onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/invoice/${inv.id}`); showToast('Link copied'); }}
                              style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748B', background: '#F1F5F9', border: 'none', padding: '5px 10px', borderRadius: 7, cursor: 'pointer', fontFamily: 'inherit' }}>
                              Copy link
                            </button>
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
      )}

      {/* ── Compile Panel ── */}
      {showCompile && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
          onClick={e => { if (e.target === e.currentTarget) setShowCompile(false); }}>
          <div style={{ background: '#fff', borderRadius: 16, width: '100%', maxWidth: 520, maxHeight: '90vh', overflowY: 'auto', padding: 28 }}>
            {compiledResult ? (
              <div style={{ textAlign: 'center', padding: '16px 0' }}>
                <div style={{ width: 56, height: 56, background: '#ECFDF5', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', fontSize: '1.75rem' }}>✅</div>
                <h3 style={{ fontSize: '1.125rem', fontWeight: 700, color: '#0F172A', margin: '0 0 6px' }}>Client invoice created!</h3>
                <p style={{ fontSize: '0.875rem', color: '#64748B', margin: '0 0 4px' }}>{compiledResult.invoice_number} · {fmtNaira(compiledResult.total_amount)}</p>
                <p style={{ fontSize: '0.8125rem', color: '#94A3B8', margin: '0 0 24px' }}>Owner invoices marked as compiled. Share the link with your client.</p>
                <div style={{ display: 'flex', gap: 10 }}>
                  <a href={`/invoice/${compiledResult.id}`} target="_blank"
                    style={{ flex: 1, padding: '10px 0', borderRadius: 9, background: '#1B4F8A', color: '#fff', fontWeight: 700, fontSize: '0.875rem', textAlign: 'center', textDecoration: 'none', display: 'block' }}>
                    View Invoice →
                  </a>
                  <button onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/invoice/${compiledResult.id}`); showToast('Link copied'); }}
                    style={{ flex: 1, padding: '10px 0', borderRadius: 9, background: '#F1F5F9', color: '#1B4F8A', fontWeight: 700, fontSize: '0.875rem', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
                    Copy client link
                  </button>
                </div>
                <button onClick={() => setShowCompile(false)} style={{ marginTop: 10, width: '100%', padding: '10px 0', borderRadius: 9, background: 'none', border: '1px solid #E2E8F0', color: '#64748B', fontWeight: 600, fontSize: '0.875rem', cursor: 'pointer', fontFamily: 'inherit' }}>
                  Close
                </button>
              </div>
            ) : (
              <>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                  <div>
                    <h3 style={{ fontSize: '1rem', fontWeight: 700, color: '#0F172A', margin: 0 }}>Compile Client Invoice</h3>
                    <p style={{ fontSize: '0.75rem', color: '#94A3B8', margin: '2px 0 0' }}>{selectedMPIs.size} owner invoice{selectedMPIs.size !== 1 ? 's' : ''} · {fmtNaira(selectedTotal)} subtotal</p>
                  </div>
                  <button onClick={() => setShowCompile(false)} style={{ background: 'none', border: 'none', fontSize: '1.25rem', color: '#94A3B8', cursor: 'pointer', lineHeight: 1 }}>×</button>
                </div>

                {/* Included MPIs summary */}
                <div style={{ background: '#F8FAFC', border: '1px solid #F1F5F9', borderRadius: 10, padding: '12px 14px', marginBottom: 16 }}>
                  <p style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 8px' }}>Included Owner Invoices</p>
                  {[...selectedMPIs].map(id => {
                    const m = mpis.find(x => x.id === id);
                    if (!m) return null;
                    const vf = (m.compliance ?? []).filter(c => c.status === 'verified').length;
                    const tc = (m.compliance ?? []).length;
                    return (
                      <div key={id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 6, marginBottom: 6, borderBottom: '1px solid #F1F5F9' }}>
                        <div>
                          <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#0F172A' }}>{m.client_name}</span>
                          <span style={{ fontSize: '0.6875rem', color: '#94A3B8', marginLeft: 6 }}>{m.invoice_number}</span>
                          {tc > 0 && <span style={{ fontSize: '0.625rem', marginLeft: 6, color: vf === tc ? '#10B981' : '#F59E0B', fontWeight: 700 }}>✓ {vf}/{tc} compliant</span>}
                        </div>
                        <span style={{ fontSize: '0.875rem', fontWeight: 700, fontFamily: 'monospace', color: '#0F172A' }}>{fmtNaira(m.total_amount)}</span>
                      </div>
                    );
                  })}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {/* Campaign */}
                  <div>
                    <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#374151', display: 'block', marginBottom: 5 }}>Campaign</label>
                    <select value={compileForm.campaignId}
                      onChange={e => { const c = campaigns.find(x => x.id === e.target.value); setCompileForm(f => ({ ...f, campaignId: e.target.value, clientName: c?.client_name ?? f.clientName })); }}
                      style={{ width: '100%', padding: '9px 12px', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: '0.875rem', fontFamily: 'inherit', background: '#fff' }}>
                      <option value="">— No campaign —</option>
                      {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <div>
                      <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#374151', display: 'block', marginBottom: 5 }}>Client Name *</label>
                      <input type="text" placeholder="e.g. Unilever Nigeria" value={compileForm.clientName} onChange={e => setCompileForm(f => ({ ...f, clientName: e.target.value }))}
                        style={{ width: '100%', padding: '9px 12px', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: '0.875rem', fontFamily: 'inherit', boxSizing: 'border-box' }} />
                    </div>
                    <div>
                      <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#374151', display: 'block', marginBottom: 5 }}>Client Email</label>
                      <input type="email" placeholder="client@example.com" value={compileForm.clientEmail} onChange={e => setCompileForm(f => ({ ...f, clientEmail: e.target.value }))}
                        style={{ width: '100%', padding: '9px 12px', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: '0.875rem', fontFamily: 'inherit', boxSizing: 'border-box' }} />
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 10 }}>
                    <div>
                      <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#374151', display: 'block', marginBottom: 5 }}>Agency Fee (₦)</label>
                      <input type="number" min="0" placeholder="0" value={compileForm.agencyFee} onChange={e => setCompileForm(f => ({ ...f, agencyFee: e.target.value }))}
                        style={{ width: '100%', padding: '9px 12px', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: '0.875rem', fontFamily: 'inherit', boxSizing: 'border-box' }} />
                    </div>
                    <div>
                      <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#374151', display: 'block', marginBottom: 5 }}>Fee Label</label>
                      <input type="text" placeholder="Agency management fee" value={compileForm.agencyFeeLabel} onChange={e => setCompileForm(f => ({ ...f, agencyFeeLabel: e.target.value }))}
                        style={{ width: '100%', padding: '9px 12px', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: '0.875rem', fontFamily: 'inherit', boxSizing: 'border-box' }} />
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <div>
                      <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#374151', display: 'block', marginBottom: 5 }}>Due Date</label>
                      <input type="date" value={compileForm.dueDate} onChange={e => setCompileForm(f => ({ ...f, dueDate: e.target.value }))}
                        style={{ width: '100%', padding: '9px 12px', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: '0.875rem', fontFamily: 'inherit', boxSizing: 'border-box' }} />
                    </div>
                    <div>
                      <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#374151', display: 'block', marginBottom: 5 }}>VAT %</label>
                      <input type="number" min="0" max="25" step="0.5" value={compileForm.taxRate} onChange={e => setCompileForm(f => ({ ...f, taxRate: e.target.value }))}
                        style={{ width: '100%', padding: '9px 12px', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: '0.875rem', fontFamily: 'inherit', boxSizing: 'border-box' }} />
                    </div>
                  </div>

                  <div>
                    <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#374151', display: 'block', marginBottom: 5 }}>Notes</label>
                    <textarea rows={2} placeholder="Payment terms, campaign summary…" value={compileForm.notes} onChange={e => setCompileForm(f => ({ ...f, notes: e.target.value }))}
                      style={{ width: '100%', padding: '9px 12px', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: '0.875rem', fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box' }} />
                  </div>

                  {/* Compliance toggle */}
                  <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', padding: '10px 14px', background: compileForm.includeCompliance ? '#EFF6FF' : '#F8FAFC', border: '1px solid', borderColor: compileForm.includeCompliance ? '#BFDBFE' : '#F1F5F9', borderRadius: 9 }}>
                    <input type="checkbox" checked={compileForm.includeCompliance} onChange={e => setCompileForm(f => ({ ...f, includeCompliance: e.target.checked }))}
                      style={{ width: 15, height: 15, accentColor: '#1B4F8A', cursor: 'pointer', flexShrink: 0 }} />
                    <div>
                      <p style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#0F172A', margin: 0 }}>Attach compliance summary</p>
                      <p style={{ fontSize: '0.6875rem', color: '#64748B', margin: 0 }}>Adds proof of posting status for each board to the invoice notes</p>
                    </div>
                  </label>

                  {/* Total preview */}
                  <div style={{ background: '#0F172A', borderRadius: 10, padding: '14px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'rgba(255,255,255,0.7)' }}>Estimated Total (incl. VAT)</span>
                    <span style={{ fontSize: '1.25rem', fontWeight: 800, fontFamily: 'monospace', color: '#F59E0B' }}>
                      {fmtNaira((() => {
                        const sub = selectedTotal + (parseFloat(compileForm.agencyFee) || 0);
                        return sub + sub * ((parseFloat(compileForm.taxRate) || 0) / 100);
                      })())}
                    </span>
                  </div>

                  <div style={{ display: 'flex', gap: 10 }}>
                    <button onClick={() => setShowCompile(false)} style={{ flex: 1, padding: '11px', borderRadius: 9, border: '1px solid #E2E8F0', background: '#F8FAFC', fontSize: '0.875rem', fontWeight: 600, color: '#64748B', cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
                    <button onClick={compileInvoice} disabled={compiling}
                      style={{ flex: 2, padding: '11px', borderRadius: 9, border: 'none', background: compiling ? '#94A3B8' : '#1B4F8A', fontSize: '0.875rem', fontWeight: 700, color: '#fff', cursor: compiling ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}>
                      {compiling ? 'Compiling…' : 'Compile & Create Invoice'}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Direct New Invoice Modal ── */}
      {showNewInvoice && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.6)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
          onClick={e => { if (e.target === e.currentTarget) setShowNewInvoice(false); }}>
          <div style={{ background: '#fff', borderRadius: 16, width: '100%', maxWidth: 480, padding: 28 }}>
            <h2 style={{ fontSize: '1.0625rem', fontWeight: 700, color: '#0F172A', margin: '0 0 4px' }}>Direct Client Invoice</h2>
            <p style={{ fontSize: '0.8125rem', color: '#94A3B8', margin: '0 0 20px' }}>Create a client invoice directly without compiling owner invoices</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#374151', display: 'block', marginBottom: 5 }}>Campaign (optional)</label>
                <select value={newInvForm.campaign_id}
                  onChange={e => { const c = campaigns.find(x => x.id === e.target.value); setNewInvForm(f => ({ ...f, campaign_id: e.target.value, client_name: c?.client_name ?? f.client_name })); }}
                  style={{ width: '100%', padding: '9px 12px', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: '0.875rem', fontFamily: 'inherit', background: '#fff' }}>
                  <option value="">— No campaign —</option>
                  {campaigns.map(c => <option key={c.id} value={c.id}>{c.name} ({c.client_name})</option>)}
                </select>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#374151', display: 'block', marginBottom: 5 }}>Client Name *</label>
                  <input type="text" placeholder="e.g. MTN Nigeria" value={newInvForm.client_name} onChange={e => setNewInvForm(f => ({ ...f, client_name: e.target.value }))}
                    style={{ width: '100%', padding: '9px 12px', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: '0.875rem', fontFamily: 'inherit', boxSizing: 'border-box' }} />
                </div>
                <div>
                  <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#374151', display: 'block', marginBottom: 5 }}>Client Email</label>
                  <input type="email" placeholder="billing@client.com" value={newInvForm.client_email} onChange={e => setNewInvForm(f => ({ ...f, client_email: e.target.value }))}
                    style={{ width: '100%', padding: '9px 12px', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: '0.875rem', fontFamily: 'inherit', boxSizing: 'border-box' }} />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#374151', display: 'block', marginBottom: 5 }}>Due Date</label>
                  <input type="date" value={newInvForm.due_date} onChange={e => setNewInvForm(f => ({ ...f, due_date: e.target.value }))}
                    style={{ width: '100%', padding: '9px 12px', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: '0.875rem', fontFamily: 'inherit', boxSizing: 'border-box' }} />
                </div>
                <div>
                  <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#374151', display: 'block', marginBottom: 5 }}>VAT %</label>
                  <input type="number" min="0" max="25" step="0.5" value={newInvForm.tax_rate} onChange={e => setNewInvForm(f => ({ ...f, tax_rate: e.target.value }))}
                    style={{ width: '100%', padding: '9px 12px', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: '0.875rem', fontFamily: 'inherit', boxSizing: 'border-box' }} />
                </div>
              </div>
              <div>
                <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#374151', display: 'block', marginBottom: 5 }}>Notes</label>
                <textarea rows={2} placeholder="Payment terms…" value={newInvForm.notes} onChange={e => setNewInvForm(f => ({ ...f, notes: e.target.value }))}
                  style={{ width: '100%', padding: '9px 12px', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: '0.875rem', fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box' }} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
              <button onClick={() => setShowNewInvoice(false)} style={{ flex: 1, padding: '10px', borderRadius: 9, border: '1px solid #E2E8F0', background: '#F8FAFC', fontSize: '0.875rem', fontWeight: 600, color: '#64748B', cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
              <button onClick={createDirectInvoice} disabled={newInvSaving}
                style={{ flex: 2, padding: '10px', borderRadius: 9, border: 'none', background: newInvSaving ? '#94A3B8' : '#1B4F8A', fontSize: '0.875rem', fontWeight: 700, color: '#fff', cursor: newInvSaving ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}>
                {newInvSaving ? 'Creating…' : 'Create Invoice →'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 9999, background: toastErr ? '#7F1D1D' : '#0F172A', color: '#fff', padding: '12px 20px', borderRadius: 10, fontSize: '0.875rem', fontWeight: 600, boxShadow: '0 4px 20px rgba(0,0,0,0.2)', animation: 'fadeUp 0.2s both', whiteSpace: 'nowrap' }}>
          {toast}
        </div>
      )}
    </div>
  );
}
