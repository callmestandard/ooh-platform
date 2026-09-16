'use client';

import { formatDate } from '@/lib/utils';

const FORMAT_LABELS: Record<string, string> = {
  billboard: 'Billboard', unipole: 'Unipole', gantry: 'Gantry',
  bridge_panel: 'Bridge Panel', wall_drape: 'Wall Drape', digital: 'Digital/LED', led: 'LED',
};

type PreviewBoard = {
  name: string;
  address?: string | null;
  city: string;
  format: string;
};

type PreviewPlanItem = {
  id: string;
  boards: PreviewBoard | null;
};

type PreviewCompliance = {
  status: 'submitted' | 'verified' | 'flagged';
  submitted_at: string;
  photo_url: string | null;
  notes: string | null;
  submitted_by: string | null;
  submitted_name: string | null;
  latitude: number | null;
  longitude: number | null;
};

type Props = {
  campaignName: string;
  clientName: string;
  startDate: string | null;
  endDate: string | null;
  planItems: PreviewPlanItem[];
  complianceByBooking: Record<string, PreviewCompliance>;
  onClose: () => void;
};

export default function POEReportPreview({ campaignName, clientName, startDate, endDate, planItems, complianceByBooking, onClose }: Props) {
  const submittedCount = planItems.filter(i => complianceByBooking[i.id]).length;

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(15,23,42,0.6)',
        display: 'flex', justifyContent: 'center',
        overflowY: 'auto', padding: '32px 16px',
        fontFamily: "'Inter', -apple-system, sans-serif",
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 660, height: 'fit-content',
          background: '#fff', borderRadius: 16, overflow: 'hidden',
          boxShadow: '0 32px 64px -16px rgba(0,0,0,0.35)',
        }}
      >
        {/* Sticky chrome */}
        <div style={{
          position: 'sticky', top: 0, zIndex: 2, background: '#fff',
          borderBottom: '1px solid #E2E8F0', padding: '14px 20px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div>
            <p style={{ fontSize: '0.8125rem', fontWeight: 700, color: '#0F172A', margin: 0 }}>Report preview</p>
            <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: '1px 0 0' }}>Exactly what the client receives — updates live as boards report POE</p>
          </div>
          <button
            onClick={onClose}
            style={{
              width: 30, height: 30, borderRadius: '50%', flexShrink: 0,
              background: '#F1F5F9', border: 'none', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.9375rem', color: '#475569',
            }}
          >
            ✕
          </button>
        </div>

        {/* Live tag */}
        <div style={{
          padding: '8px 20px', background: '#F8FAFC', borderBottom: '1px solid #E2E8F0',
          display: 'flex', justifyContent: 'space-between', fontSize: '0.6875rem', color: '#64748B',
          fontFamily: 'monospace', letterSpacing: '0.03em',
        }}>
          <span>LIVE · proof-of-execution.pdf</span>
          <span>{submittedCount} of {planItems.length} boards submitted</span>
        </div>

        {/* ── Cover ── */}
        <div style={{
          position: 'relative', background: '#0F172A', color: '#fff',
          padding: '36px 28px 28px',
        }}>
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 4, background: '#1B4F8A' }} />
          <p style={{ fontSize: '0.8125rem', fontWeight: 700, letterSpacing: '0.04em', color: '#7FB0E8', margin: '0 0 26px' }}>OOH PLATFORM</p>
          <h2 style={{ fontFamily: 'Georgia, serif', fontSize: '1.75rem', fontWeight: 700, margin: '0 0 6px', lineHeight: 1.15 }}>Proof of Execution</h2>
          <p style={{ fontSize: '0.9375rem', color: '#9FB2C2', margin: '0 0 18px' }}>{campaignName}</p>
          <div style={{ width: 56, height: 3, background: '#1B4F8A', marginBottom: 22 }} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px 24px' }}>
            {[
              { label: 'Client', value: clientName || '—' },
              { label: 'Campaign period', value: `${formatDate(startDate)} – ${formatDate(endDate)}` },
              { label: 'Total boards', value: String(planItems.length) },
              { label: 'POE submitted', value: `${submittedCount} of ${planItems.length} boards` },
            ].map(m => (
              <div key={m.label}>
                <p style={{ fontSize: '0.625rem', letterSpacing: '0.06em', textTransform: 'uppercase', color: '#7C8D9B', margin: '0 0 3px' }}>{m.label}</p>
                <p style={{ fontSize: '0.875rem', fontWeight: 700, color: '#fff', margin: 0 }}>{m.value}</p>
              </div>
            ))}
          </div>
        </div>

        {/* ── Board pages ── */}
        {planItems.map((item, idx) => {
          const comp = complianceByBooking[item.id];
          const board = item.boards;
          const hasComp = !!comp;
          const isVerified = comp?.status === 'verified';
          const isFlagged = comp?.status === 'flagged';

          return (
            <div key={item.id} style={{ borderTop: '1px solid #E2E8F0' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '20px 20px 14px' }}>
                <div style={{
                  flexShrink: 0, width: 30, height: 30, borderRadius: '50%',
                  background: '#1B4F8A', color: '#fff', fontSize: '0.8125rem', fontWeight: 700,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {idx + 1}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: '1rem', fontWeight: 700, color: '#0F172A', margin: '0 0 2px' }}>{board?.name || 'Unknown board'}</p>
                  <p style={{ fontSize: '0.75rem', color: '#64748B', margin: 0 }}>
                    {board?.address && `${board.address} · `}{board?.city}
                  </p>
                </div>
                <span style={{
                  flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 5,
                  padding: '4px 10px', borderRadius: 999, fontSize: '0.6875rem', fontWeight: 700,
                  background: isVerified ? '#ECFDF5' : isFlagged ? '#FEF2F2' : hasComp ? '#FFFBEB' : '#F1F5F9',
                  color: isVerified ? '#065F46' : isFlagged ? '#7F1D1D' : hasComp ? '#92400E' : '#64748B',
                }}>
                  {isVerified ? '✓ Verified' : isFlagged ? '⚠ Flagged' : hasComp ? 'Submitted' : 'Pending'}
                </span>
              </div>

              <div style={{
                margin: '0 20px 16px', borderRadius: 8, overflow: 'hidden',
                border: '1px solid #E2E8F0', aspectRatio: '16/9', background: '#F8FAFC',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {comp?.photo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={comp.photo_url} alt={board?.name || 'Board photo'} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                ) : (
                  <p style={{ fontSize: '0.8125rem', color: '#CBD5E1', margin: 0 }}>
                    {hasComp ? 'Photo submitted — preview unavailable' : 'No photo submitted yet'}
                  </p>
                )}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: '12px 10px', padding: '0 20px 16px' }}>
                {[
                  { label: 'Format', value: FORMAT_LABELS[board?.format || ''] || board?.format || '—' },
                  { label: 'Location', value: board?.city || '—' },
                  { label: 'Submitted by', value: comp?.submitted_name || comp?.submitted_by || '—' },
                  { label: 'GPS coordinates', value: comp?.latitude && comp?.longitude ? `${Number(comp.latitude).toFixed(5)}, ${Number(comp.longitude).toFixed(5)}` : '—' },
                  { label: 'Date submitted', value: comp?.submitted_at ? formatDate(comp.submitted_at) : '—' },
                  { label: 'Status', value: hasComp ? (comp.status[0].toUpperCase() + comp.status.slice(1)) : 'Pending' },
                ].map(d => (
                  <div key={d.label}>
                    <p style={{ fontSize: '0.5625rem', letterSpacing: '0.06em', textTransform: 'uppercase', color: '#94A3B8', margin: '0 0 3px' }}>{d.label}</p>
                    <p style={{ fontSize: '0.75rem', fontWeight: 700, color: '#0F172A', margin: 0, fontFamily: d.label === 'GPS coordinates' ? 'monospace' : 'inherit' }}>{d.value}</p>
                  </div>
                ))}
              </div>

              {comp?.notes && (
                <div style={{ margin: '0 20px 20px', padding: '10px 12px', background: '#F8FAFC', borderLeft: '3px solid #1B4F8A', borderRadius: '0 6px 6px 0' }}>
                  <p style={{ fontSize: '0.5625rem', letterSpacing: '0.06em', textTransform: 'uppercase', color: '#94A3B8', margin: '0 0 3px' }}>Notes</p>
                  <p style={{ fontSize: '0.75rem', color: '#334155', margin: 0, lineHeight: 1.5 }}>{comp.notes}</p>
                </div>
              )}
            </div>
          );
        })}

        <div style={{ padding: '12px 20px', background: '#F8FAFC', borderTop: '1px solid #E2E8F0', fontSize: '0.6875rem', color: '#94A3B8' }}>
          {clientName} · {campaignName} · Confidential
        </div>
      </div>
    </div>
  );
}
