'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Campaign } from '@/lib/types';
import { getCampaigns, createCampaign, updateCampaignStatus, deleteCampaign } from '@/lib/campaigns';
import { formatNaira, formatDate } from '@/lib/utils';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

const STATUS_CONFIG: Record<string, { bg: string; color: string; dot: string }> = {
  draft:     { bg: '#F1F5F9', color: '#475569', dot: '#94A3B8' },
  pending:   { bg: '#FFFBEB', color: '#92400E', dot: '#F59E0B' },
  active:    { bg: '#ECFDF5', color: '#065F46', dot: '#10B981' },
  completed: { bg: '#EFF6FF', color: '#1E3A8A', dot: '#3B82F6' },
  cancelled: { bg: '#FEF2F2', color: '#7F1D1D', dot: '#EF4444' },
};

function StatusPill({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.draft;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: cfg.bg, color: cfg.color, padding: '3px 9px', borderRadius: '999px', fontSize: '0.6875rem', fontWeight: 600, textTransform: 'capitalize' }}>
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: cfg.dot }} />
      {status}
    </span>
  );
}

function Toast({ message, type, onClose }: { message: string; type: 'success' | 'error'; onClose: () => void }) {
  useEffect(() => { const t = setTimeout(onClose, 3000); return () => clearTimeout(t); }, [onClose]);
  return (
    <div style={{
      position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '12px 18px', borderRadius: '10px',
      background: type === 'success' ? '#0F172A' : '#7F1D1D',
      color: '#F8FAFC', fontSize: '0.8125rem', fontWeight: 500,
      boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
      animation: 'fadeUp 0.25s ease',
      fontFamily: 'inherit',
    }}>
      <span>{type === 'success' ? '✓' : '✕'}</span>
      <span>{message}</span>
    </div>
  );
}

function NewCampaignModal({ onSuccess, onCancel }: { onSuccess: (c: Campaign) => void; onCancel: () => void }) {
  const [form, setForm] = useState({ name: '', client_name: '', start_date: '', end_date: '', total_budget: '', status: 'draft' as 'draft' | 'active' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  function validate() {
    const e: Record<string, string> = {};
    if (!form.name.trim()) e.name = 'Required';
    if (!form.client_name.trim()) e.client_name = 'Required';
    if (!form.start_date) e.start_date = 'Required';
    if (!form.end_date) e.end_date = 'Required';
    if (!form.total_budget || Number(form.total_budget) <= 0) e.total_budget = 'Enter a valid amount';
    if (form.start_date && form.end_date && form.end_date <= form.start_date) e.end_date = 'Must be after start date';
    return e;
  }

  async function handleSubmit() {
    const e = validate();
    if (Object.keys(e).length > 0) { setErrors(e); return; }
    setLoading(true);
    const result = await createCampaign({ ...form, total_budget: Number(form.total_budget) });
    setLoading(false);
    if (result) onSuccess(result);
    else setErrors({ submit: 'Failed to create. Please try again.' });
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.4)' }} onClick={onCancel} />
      <div style={{ position: 'relative', width: '100%', maxWidth: 480, background: '#fff', borderRadius: '16px', boxShadow: '0 24px 48px rgba(0,0,0,0.12)', padding: '28px', fontFamily: 'inherit' }}>
        <div style={{ marginBottom: '24px' }}>
          <h2 style={{ fontSize: '1.125rem', fontWeight: 700, color: '#0F172A', margin: '0 0 4px', letterSpacing: '-0.02em' }}>New campaign</h2>
          <p style={{ fontSize: '0.8125rem', color: '#94A3B8', margin: 0 }}>Fill in the details to create a new OOH campaign</p>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {[
            { label: 'Campaign name', key: 'name', placeholder: 'e.g. MTN Q2 Brand Push' },
            { label: 'Client name', key: 'client_name', placeholder: 'e.g. MTN Nigeria' },
          ].map(({ label, key, placeholder }) => (
            <div key={key}>
              <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 500, color: '#374151', marginBottom: '5px' }}>{label}</label>
              <input
                placeholder={placeholder}
                value={(form as any)[key]}
                onChange={e => { setForm(f => ({ ...f, [key]: e.target.value })); setErrors(er => ({ ...er, [key]: '' })); }}
                style={{ width: '100%', padding: '9px 12px', border: `1px solid ${errors[key] ? '#EF4444' : '#E2E8F0'}`, borderRadius: '8px', fontSize: '0.875rem', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }}
              />
              {errors[key] && <p style={{ fontSize: '0.75rem', color: '#EF4444', margin: '3px 0 0' }}>{errors[key]}</p>}
            </div>
          ))}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            {[{ label: 'Start date', key: 'start_date' }, { label: 'End date', key: 'end_date' }].map(({ label, key }) => (
              <div key={key}>
                <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 500, color: '#374151', marginBottom: '5px' }}>{label}</label>
                <input
                  type="date"
                  value={(form as any)[key]}
                  onChange={e => { setForm(f => ({ ...f, [key]: e.target.value })); setErrors(er => ({ ...er, [key]: '' })); }}
                  style={{ width: '100%', padding: '9px 12px', border: `1px solid ${errors[key] ? '#EF4444' : '#E2E8F0'}`, borderRadius: '8px', fontSize: '0.875rem', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }}
                />
                {errors[key] && <p style={{ fontSize: '0.75rem', color: '#EF4444', margin: '3px 0 0' }}>{errors[key]}</p>}
              </div>
            ))}
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 500, color: '#374151', marginBottom: '5px' }}>Total budget (₦)</label>
            <input
              type="number"
              placeholder="e.g. 5000000"
              value={form.total_budget}
              onChange={e => { setForm(f => ({ ...f, total_budget: e.target.value })); setErrors(er => ({ ...er, total_budget: '' })); }}
              style={{ width: '100%', padding: '9px 12px', border: `1px solid ${errors.total_budget ? '#EF4444' : '#E2E8F0'}`, borderRadius: '8px', fontSize: '0.875rem', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }}
            />
            {form.total_budget && !errors.total_budget && (
              <p style={{ fontSize: '0.75rem', color: '#94A3B8', margin: '3px 0 0' }}>{formatNaira(Number(form.total_budget))}</p>
            )}
            {errors.total_budget && <p style={{ fontSize: '0.75rem', color: '#EF4444', margin: '3px 0 0' }}>{errors.total_budget}</p>}
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 500, color: '#374151', marginBottom: '5px' }}>Initial status</label>
            <select
              value={form.status}
              onChange={e => setForm(f => ({ ...f, status: e.target.value as 'draft' | 'active' }))}
              style={{ width: '100%', padding: '9px 12px', border: '1px solid #E2E8F0', borderRadius: '8px', fontSize: '0.875rem', outline: 'none', fontFamily: 'inherit', background: '#fff', boxSizing: 'border-box' }}
            >
              <option value="draft">Draft</option>
              <option value="active">Active</option>
            </select>
          </div>
          {errors.submit && (
            <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: '8px', padding: '10px 12px', fontSize: '0.8125rem', color: '#7F1D1D' }}>
              {errors.submit}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: '8px', marginTop: '24px' }}>
          <button onClick={handleSubmit} disabled={loading}
            style={{ flex: 1, padding: '11px', background: loading ? '#94A3B8' : '#1B4F8A', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '0.875rem', fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}>
            {loading ? 'Creating...' : 'Create campaign'}
          </button>
          <button onClick={onCancel}
            style={{ flex: 1, padding: '11px', background: '#F1F5F9', color: '#475569', border: 'none', borderRadius: '8px', fontSize: '0.875rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function CampaignDetailPanel({ campaign, onClose, onStatusChange, onOpenPlan }: {
  campaign: Campaign;
  onClose: () => void;
  onStatusChange: (id: string, status: Campaign['status']) => void;
  onOpenPlan: (id: string) => void;
}) {
  const statuses = ['draft', 'active', 'completed'];
  const currentIdx = statuses.indexOf(campaign.status);

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 40, display: 'flex', justifyContent: 'flex-end' }}>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.3)' }} onClick={onClose} />
      <div style={{ position: 'relative', width: 400, background: '#fff', height: '100%', boxShadow: '-8px 0 32px rgba(0,0,0,0.08)', display: 'flex', flexDirection: 'column', fontFamily: 'inherit' }}>
        <div style={{ padding: '20px 24px', borderBottom: '1px solid #F1F5F9', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div>
            <h2 style={{ fontSize: '1rem', fontWeight: 700, color: '#0F172A', margin: '0 0 6px', letterSpacing: '-0.015em' }}>{campaign.name}</h2>
            <StatusPill status={campaign.status} />
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8', fontSize: '1.125rem', padding: '2px', display: 'flex' }}>✕</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
          {/* Open plan CTA */}
          <button
            onClick={() => onOpenPlan(campaign.id)}
            style={{
              width: '100%', padding: '12px 16px', background: '#EFF6FF',
              border: '1px solid #BFDBFE', borderRadius: '10px',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              cursor: 'pointer', fontFamily: 'inherit', marginBottom: '16px',
            }}
          >
            <div style={{ textAlign: 'left' }}>
              <p style={{ fontSize: '0.875rem', fontWeight: 700, color: '#1E3A8A', margin: '0 0 2px' }}>Open media plan</p>
              <p style={{ fontSize: '0.75rem', color: '#3B82F6', margin: 0 }}>Add boards, set rates, track budget</p>
            </div>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6"/>
            </svg>
          </button>

          <div style={{ background: '#F8FAFC', borderRadius: '10px', padding: '16px', marginBottom: '20px' }}>
            {[
              { label: 'Client', value: campaign.client_name || '—' },
              { label: 'Start date', value: formatDate(campaign.start_date) },
              { label: 'End date', value: formatDate(campaign.end_date) },
              { label: 'Total budget', value: formatNaira(campaign.total_budget) },
              { label: 'Boards', value: `${campaign.boards_count || 0} boards` },
            ].map(({ label, value }) => (
              <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #F1F5F9' }}>
                <span style={{ fontSize: '0.8125rem', color: '#94A3B8' }}>{label}</span>
                <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#0F172A' }}>{value}</span>
              </div>
            ))}
          </div>

          {/* Timeline */}
          <div style={{ marginBottom: '20px' }}>
            <p style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.07em', margin: '0 0 12px' }}>Campaign timeline</p>
            <div style={{ display: 'flex', alignItems: 'center' }}>
              {statuses.map((stage, i) => {
                const done = i <= currentIdx;
                return (
                  <div key={stage} style={{ display: 'flex', alignItems: 'center', flex: 1 }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1 }}>
                      <div style={{ width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 700, background: done ? '#1B4F8A' : '#F1F5F9', color: done ? '#fff' : '#CBD5E1', border: `2px solid ${done ? '#1B4F8A' : '#E2E8F0'}` }}>
                        {i < currentIdx ? '✓' : i + 1}
                      </div>
                      <span style={{ fontSize: '0.6875rem', marginTop: '4px', fontWeight: 500, color: done ? '#1B4F8A' : '#CBD5E1', textTransform: 'capitalize' }}>{stage}</span>
                    </div>
                    {i < statuses.length - 1 && <div style={{ height: 2, flex: 1, background: i < currentIdx ? '#1B4F8A' : '#E2E8F0', marginBottom: '16px' }} />}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {campaign.status !== 'completed' && campaign.status !== 'cancelled' && (
          <div style={{ padding: '16px 24px', borderTop: '1px solid #F1F5F9', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {campaign.status === 'draft' && (
              <button onClick={() => onStatusChange(campaign.id, 'active')}
                style={{ width: '100%', padding: '11px', background: '#1B4F8A', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '0.875rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                Set as Active
              </button>
            )}
            {campaign.status === 'active' && (
              <button onClick={() => onStatusChange(campaign.id, 'completed')}
                style={{ width: '100%', padding: '11px', background: '#ECFDF5', color: '#065F46', border: '1px solid #A7F3D0', borderRadius: '8px', fontSize: '0.875rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                Mark as Completed
              </button>
            )}
            <button onClick={() => onStatusChange(campaign.id, 'cancelled')}
              style={{ width: '100%', padding: '11px', background: '#FEF2F2', color: '#7F1D1D', border: '1px solid #FECACA', borderRadius: '8px', fontSize: '0.875rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
              Cancel Campaign
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

const FILTERS = ['all', 'draft', 'active', 'completed', 'cancelled'];

export default function CampaignsPage() {
  const router = useRouter();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [filter, setFilter] = useState('all');
  const [selected, setSelected] = useState<Campaign | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  useEffect(() => { loadCampaigns(); }, []);

  async function loadCampaigns() {
    setLoading(true);
    const data = await getCampaigns();
    setCampaigns(data);
    setLoading(false);
  }

  async function handleStatusChange(id: string, status: Campaign['status']) {
    const ok = await updateCampaignStatus(id, status);
    if (ok) {
      setCampaigns(cs => cs.map(c => c.id === id ? { ...c, status } : c));
      setSelected(s => s?.id === id ? { ...s, status } : s);
      setToast({ message: `Campaign marked as ${status}`, type: 'success' });
    } else {
      setToast({ message: 'Failed to update', type: 'error' });
    }
  }

  function handleDelete(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    setDeleteConfirmId(id);
  }

  async function confirmDelete() {
    if (!deleteConfirmId) return;
    const id = deleteConfirmId;
    setDeleteConfirmId(null);
    const ok = await deleteCampaign(id);
    if (ok) {
      setCampaigns(cs => cs.filter(c => c.id !== id));
      if (selected?.id === id) setSelected(null);
      setToast({ message: 'Campaign deleted', type: 'success' });
    }
  }

  function handleOpenPlan(id: string) {
    router.push(`/dashboard/agency/campaigns/${id}`);
  }

  const filtered = filter === 'all' ? campaigns : campaigns.filter(c => c.status === filter);

  return (
    <>
      <style>{`
        @keyframes fadeUp { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:translateY(0); } }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>

      <div style={{ fontFamily: "'Inter', -apple-system, sans-serif" }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1.75rem' }}>
          <div>
            <h1 style={{ fontSize: '1.375rem', fontWeight: 700, color: '#0F172A', letterSpacing: '-0.025em', margin: '0 0 4px', display: 'flex', alignItems: 'center', gap: '10px' }}>
              Campaigns
              <span style={{ fontSize: '0.8125rem', fontWeight: 600, background: '#F1F5F9', color: '#64748B', padding: '2px 10px', borderRadius: '999px' }}>
                {campaigns.length}
              </span>
            </h1>
            <p style={{ fontSize: '0.8125rem', color: '#94A3B8', margin: 0 }}>
              Manage all client campaigns from brief to completion
            </p>
          </div>
          <button
            onClick={() => setShowNew(true)}
            style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#1B4F8A', color: '#fff', border: 'none', padding: '9px 16px', borderRadius: '8px', fontSize: '0.8125rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
          >
            <span style={{ fontSize: '1rem', lineHeight: 1 }}>+</span> New campaign
          </button>
        </div>

        {/* Filters */}
        <div style={{ display: 'flex', gap: '4px', background: '#F1F5F9', padding: '4px', borderRadius: '10px', width: 'fit-content', marginBottom: '1.25rem' }}>
          {FILTERS.map(f => {
            const count = f === 'all' ? campaigns.length : campaigns.filter(c => c.status === f).length;
            const active = filter === f;
            return (
              <button key={f} onClick={() => setFilter(f)} style={{
                padding: '6px 14px', borderRadius: '7px', border: 'none',
                background: active ? '#fff' : 'transparent',
                color: active ? '#0F172A' : '#64748B',
                fontSize: '0.8125rem', fontWeight: active ? 600 : 400,
                cursor: 'pointer', fontFamily: 'inherit',
                boxShadow: active ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                display: 'flex', alignItems: 'center', gap: 6, textTransform: 'capitalize',
              }}>
                {f === 'all' ? 'All' : f}
                <span style={{ fontSize: '0.625rem', fontWeight: 700, padding: '1px 5px', borderRadius: '999px', background: active ? '#EFF6FF' : '#E2E8F0', color: active ? '#1B4F8A' : '#94A3B8' }}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Content */}
        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '4rem' }}>
            <div style={{ width: 28, height: 28, border: '2px solid #E2E8F0', borderTopColor: '#1B4F8A', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: '12px', textAlign: 'center', padding: '5rem 2rem', minHeight: 320, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ width: 48, height: 48, background: '#F1F5F9', border: '1px solid #E2E8F0', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" strokeWidth="1.5"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/></svg>
            </div>
            <p style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#0F172A', margin: '0 0 4px' }}>
              {filter === 'all' ? 'No campaigns yet' : `No ${filter} campaigns`}
            </p>
            <p style={{ fontSize: '0.8125rem', color: '#94A3B8', margin: '0 0 16px' }}>
              {filter === 'all' ? 'Create your first campaign to get started' : 'Switch filter to see other campaigns'}
            </p>
            {filter === 'all' && (
              <button onClick={() => setShowNew(true)} style={{ background: '#1B4F8A', color: '#fff', border: 'none', padding: '9px 18px', borderRadius: '8px', fontSize: '0.8125rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                + Create campaign
              </button>
            )}
          </div>
        ) : (
          <div style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: '12px', overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#F8FAFC' }}>
                  {['Campaign', 'Client', 'Budget', 'Dates', 'Status', ''].map(h => (
                    <th key={h} style={{ padding: '10px 16px', fontSize: '0.6875rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.07em', textAlign: 'left', borderBottom: '1px solid #F1F5F9', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((campaign, i) => (
                  <tr
                    key={campaign.id}
                    onClick={() => setSelected(campaign)}
                    style={{ borderBottom: i < filtered.length - 1 ? '1px solid #F1F5F9' : 'none', cursor: 'pointer', transition: 'background 0.12s' }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#F5F8FF'; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                  >
                    <td style={{ padding: '14px 16px' }}>
                      <p style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0F172A', margin: '0 0 4px' }}>{campaign.name}</p>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: '#F1F5F9', color: '#64748B', fontSize: '0.625rem', fontWeight: 700, padding: '2px 7px', borderRadius: '999px', letterSpacing: '0.02em' }}>
                        {campaign.boards_count || 0} boards
                      </span>
                    </td>
                    <td style={{ padding: '13px 16px', fontSize: '0.8125rem', color: '#475569' }}>{campaign.client_name || '—'}</td>
                    <td style={{ padding: '13px 16px', fontSize: '0.875rem', fontWeight: 700, color: '#0F172A', fontFamily: 'monospace' }}>{formatNaira(campaign.total_budget)}</td>
                    <td style={{ padding: '13px 16px', fontSize: '0.75rem', color: '#94A3B8', whiteSpace: 'nowrap' }}>
                      {formatDate(campaign.start_date)} → {formatDate(campaign.end_date)}
                    </td>
                    <td style={{ padding: '13px 16px' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <StatusPill status={campaign.status} />
                        {campaign.status === 'pending' && (
                          <span style={{ fontSize: '0.625rem', fontWeight: 600, color: '#D97706' }}>Awaiting client approval</span>
                        )}
                        {(() => {
                          const as = campaign.arcon_status;
                          if (!as || as === 'not_submitted') return (
                            <span style={{ fontSize: '0.625rem', fontWeight: 700, color: '#92400E', background: '#FEF3C7', padding: '1px 6px', borderRadius: 4 }}>ARCON: Not submitted</span>
                          );
                          if (as === 'pending') return (
                            <span style={{ fontSize: '0.625rem', fontWeight: 700, color: '#1D4ED8', background: '#DBEAFE', padding: '1px 6px', borderRadius: 4 }}>ARCON: Pending</span>
                          );
                          if (as === 'approved') return (
                            <span style={{ fontSize: '0.625rem', fontWeight: 700, color: '#065F46', background: '#D1FAE5', padding: '1px 6px', borderRadius: 4 }}>ARCON: Approved</span>
                          );
                          if (as === 'rejected') return (
                            <span style={{ fontSize: '0.625rem', fontWeight: 700, color: '#991B1B', background: '#FEE2E2', padding: '1px 6px', borderRadius: 4 }}>ARCON: Rejected</span>
                          );
                          if (as === 'expired') return (
                            <span style={{ fontSize: '0.625rem', fontWeight: 700, color: '#92400E', background: '#FEF3C7', padding: '1px 6px', borderRadius: 4 }}>ARCON: Expired</span>
                          );
                          return null;
                        })()}
                      </div>
                    </td>
                    <td style={{ padding: '13px 16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }} onClick={e => e.stopPropagation()}>
                        {/* Open Plan button */}
                        <button
                          onClick={() => handleOpenPlan(campaign.id)}
                          style={{
                            fontSize: '0.75rem', color: '#1B4F8A', fontWeight: 600,
                            background: '#EFF6FF', border: '1px solid #BFDBFE',
                            padding: '4px 10px', borderRadius: '6px',
                            cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
                            transition: 'all 0.15s',
                          }}
                          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#DBEAFE'; }}
                          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '#EFF6FF'; }}
                        >
                          Open plan →
                        </button>
                        {/* Delete button */}
                        <button
                          onClick={e => handleDelete(campaign.id, e)}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#CBD5E1', padding: '4px', borderRadius: '6px', display: 'flex', fontFamily: 'inherit' }}
                          onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = '#EF4444'}
                          onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = '#CBD5E1'}
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
                          </svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {/* Table footer */}
            <div style={{ padding: '10px 16px', borderTop: '1px solid #F1F5F9', background: '#FAFBFC', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '0.75rem', color: '#94A3B8' }}>
                Showing {filtered.length} of {campaigns.length} campaign{campaigns.length !== 1 ? 's' : ''}
              </span>
              <button
                onClick={() => setShowNew(true)}
                style={{ fontSize: '0.75rem', fontWeight: 600, color: '#1B4F8A', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', padding: '2px 0' }}
              >
                + Add campaign
              </button>
            </div>
          </div>
        )}
      </div>

      {showNew && <NewCampaignModal onSuccess={c => { setCampaigns(cs => [c, ...cs]); setShowNew(false); setToast({ message: `"${c.name}" created`, type: 'success' }); }} onCancel={() => setShowNew(false)} />}
      {selected && (
        <CampaignDetailPanel
          campaign={selected}
          onClose={() => setSelected(null)}
          onStatusChange={handleStatusChange}
          onOpenPlan={id => { setSelected(null); handleOpenPlan(id); }}
        />
      )}
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      <ConfirmDialog
        open={!!deleteConfirmId}
        title="Delete campaign?"
        description="This cannot be undone. All bookings and data associated with this campaign will be permanently removed."
        confirmLabel="Delete"
        variant="danger"
        onConfirm={confirmDelete}
        onCancel={() => setDeleteConfirmId(null)}
      />
    </>
  );
}