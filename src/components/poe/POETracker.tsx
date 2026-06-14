'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import SharePOELink from './SharePOELink';
import GeneratePOEDeck from './GeneratePOEDeck';

export type POECompliance = {
  id: string;
  booking_id: string;
  status: 'submitted' | 'verified' | 'flagged';
  submitted_at: string;
  photo_url: string | null;
  notes: string | null;
  submitted_by: string | null;
  submitted_name: string | null;
  latitude: number | null;
  longitude: number | null;
};

export type POEPlanItem = {
  id: string;
  boards: {
    name: string;
    city: string;
    format: string;
  } | null;
};

type Props = {
  campaignId:          string;
  campaignName:        string;
  clientName:          string;
  planItems:           POEPlanItem[];
  complianceByBooking: Record<string, POECompliance>;
  onUpdate:            (bookingId: string, patch: Partial<POECompliance>) => void;
};

const FORMAT_LABELS: Record<string, string> = {
  billboard: 'Billboard', unipole: 'Unipole', gantry: 'Gantry',
  bridge_panel: 'Bridge Panel', wall_drape: 'Wall Drape', digital: 'Digital/LED', led: 'LED',
};

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

type LightboxProps = { url: string; boardName: string; onClose: () => void };

function PhotoLightbox({ url, boardName, onClose }: LightboxProps) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(0,0,0,0.85)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
      }}
    >
      <div onClick={e => e.stopPropagation()} style={{ position: 'relative', maxWidth: 900, maxHeight: '90vh', width: '100%' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={boardName}
          style={{ width: '100%', maxHeight: '80vh', objectFit: 'contain', borderRadius: 12, display: 'block' }}
        />
        <p style={{ textAlign: 'center', color: 'rgba(255,255,255,0.7)', fontSize: '0.875rem', marginTop: 12 }}>{boardName}</p>
        <button
          onClick={onClose}
          style={{
            position: 'absolute', top: -14, right: -14,
            width: 32, height: 32, borderRadius: '50%',
            background: '#fff', border: 'none', cursor: 'pointer',
            fontSize: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
          }}
        >
          ✕
        </button>
      </div>
    </div>
  );
}

type FlagModalProps = { onConfirm: (notes: string) => void; onCancel: () => void };

function FlagModal({ onConfirm, onCancel }: FlagModalProps) {
  const [notes, setNotes] = useState('');
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9998, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.4)' }} onClick={onCancel} />
      <div style={{ position: 'relative', background: '#fff', borderRadius: 14, padding: 24, width: '100%', maxWidth: 400, boxShadow: '0 24px 48px rgba(0,0,0,0.15)', fontFamily: 'inherit' }}>
        <h3 style={{ fontSize: '0.9375rem', fontWeight: 700, color: '#0F172A', margin: '0 0 8px' }}>Flag this POE submission</h3>
        <p style={{ fontSize: '0.8125rem', color: '#64748B', margin: '0 0 16px' }}>
          Describe the issue so the media partner can re-submit.
        </p>
        <textarea
          autoFocus
          placeholder="e.g. Photo is blurry, wrong board visible, creative not installed correctly…"
          value={notes}
          onChange={e => setNotes(e.target.value)}
          rows={4}
          style={{
            width: '100%', boxSizing: 'border-box',
            padding: '10px 12px', border: '1px solid #E2E8F0', borderRadius: 8,
            fontSize: '0.875rem', resize: 'vertical', outline: 'none',
            fontFamily: 'inherit', color: '#0F172A',
          }}
        />
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button
            onClick={() => onConfirm(notes.trim())}
            style={{ flex: 1, padding: '10px', background: '#EF4444', color: '#fff', border: 'none', borderRadius: 8, fontSize: '0.875rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
          >
            Flag submission
          </button>
          <button
            onClick={onCancel}
            style={{ flex: 1, padding: '10px', background: '#F1F5F9', color: '#475569', border: 'none', borderRadius: 8, fontSize: '0.875rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

export default function POETracker({ campaignId, campaignName, clientName, planItems, complianceByBooking, onUpdate }: Props) {
  const [lightbox, setLightbox]     = useState<{ url: string; name: string } | null>(null);
  const [flagging, setFlagging]     = useState<string | null>(null); // bookingId
  const [saving, setSaving]         = useState<string | null>(null);

  const submitted = planItems.filter(i => complianceByBooking[i.id]);
  const pending   = planItems.filter(i => !complianceByBooking[i.id]);
  const verified  = submitted.filter(i => complianceByBooking[i.id]?.status === 'verified');

  async function verify(bookingId: string) {
    setSaving(bookingId);
    const comp = complianceByBooking[bookingId];
    if (!comp) { setSaving(null); return; }
    const { error } = await supabase
      .from('compliance_checks')
      .update({ status: 'verified' })
      .eq('id', comp.id);
    if (!error) onUpdate(bookingId, { status: 'verified' });
    setSaving(null);
  }

  async function flag(bookingId: string, notes: string) {
    setSaving(bookingId);
    const comp = complianceByBooking[bookingId];
    setFlagging(null);
    if (!comp) { setSaving(null); return; }
    const { error } = await supabase
      .from('compliance_checks')
      .update({ status: 'flagged', notes: notes || null })
      .eq('id', comp.id);
    if (!error) onUpdate(bookingId, { status: 'flagged', notes: notes || null });
    setSaving(null);
  }

  if (planItems.length === 0) {
    return (
      <div style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: 12, padding: '4rem', textAlign: 'center' }}>
        <p style={{ color: '#94A3B8', fontSize: '0.875rem', margin: 0 }}>Add boards to the plan first to track proof of execution.</p>
      </div>
    );
  }

  return (
    <>
      <style>{`
        .poe-card { transition: box-shadow 0.15s; }
        .poe-card:hover { box-shadow: 0 8px 24px -8px rgba(0,0,0,0.12) !important; }
        .poe-photo { transition: opacity 0.15s; cursor: zoom-in; }
        .poe-photo:hover { opacity: 0.9; }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>

      {/* ── Progress summary ── */}
      <div style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: 12, padding: '20px 24px', marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16, marginBottom: 16 }}>
          <div>
            <h3 style={{ fontSize: '0.9375rem', fontWeight: 700, color: '#0F172A', margin: '0 0 4px' }}>
              Proof of Execution Tracker
            </h3>
            <p style={{ fontSize: '0.8125rem', color: '#64748B', margin: 0 }}>
              {submitted.length} of {planItems.length} boards have submitted photos · {verified.length} verified
            </p>
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#10B981', lineHeight: 1 }}>{submitted.length}</div>
              <div style={{ fontSize: '0.6875rem', color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 2 }}>Submitted</div>
            </div>
            <div style={{ width: 1, background: '#F1F5F9' }} />
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#6D28D9', lineHeight: 1 }}>{verified.length}</div>
              <div style={{ fontSize: '0.6875rem', color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 2 }}>Verified</div>
            </div>
            <div style={{ width: 1, background: '#F1F5F9' }} />
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#F59E0B', lineHeight: 1 }}>{pending.length}</div>
              <div style={{ fontSize: '0.6875rem', color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 2 }}>Pending</div>
            </div>
          </div>
        </div>

        {/* Progress bar */}
        <div style={{ height: 8, background: '#F1F5F9', borderRadius: 999, overflow: 'hidden', position: 'relative' }}>
          <div style={{
            position: 'absolute', left: 0, top: 0, bottom: 0,
            width: `${planItems.length > 0 ? (submitted.length / planItems.length) * 100 : 0}%`,
            background: verified.length === planItems.length && planItems.length > 0 ? '#10B981' : 'linear-gradient(90deg, #10B981 0%, #6D28D9 100%)',
            borderRadius: 999, transition: 'width 0.5s ease',
          }} />
        </div>
      </div>

      {/* ── POE deck download ── */}
      <div style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: 12, padding: '18px 24px', marginBottom: 24 }}>
        <p style={{ fontSize: '0.8125rem', fontWeight: 700, color: '#0F172A', margin: '0 0 12px' }}>Generate POE Report</p>
        <GeneratePOEDeck
          campaignId={campaignId}
          campaignName={campaignName}
          clientName={clientName}
          boardCount={planItems.length}
          poeCount={submitted.length}
        />
      </div>

      {/* ── Submitted boards ── */}
      {submitted.length > 0 && (
        <section style={{ marginBottom: 32 }}>
          <h3 style={{ fontSize: '0.8125rem', fontWeight: 700, color: '#065F46', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 14px', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#10B981', display: 'inline-block' }} />
            Submitted ({submitted.length})
          </h3>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
            {submitted.map(item => {
              const comp = complianceByBooking[item.id]!;
              const isVerified = comp.status === 'verified';
              const isFlagged  = comp.status === 'flagged';
              const isSaving   = saving === item.id;

              return (
                <div
                  key={item.id}
                  className="poe-card"
                  style={{
                    background: '#fff', borderRadius: 12,
                    border: `1px solid ${isVerified ? '#A7F3D0' : isFlagged ? '#FECACA' : '#E2E8F0'}`,
                    overflow: 'hidden',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.05)',
                  }}
                >
                  {/* Photo */}
                  <div style={{ height: 180, background: '#F1F5F9', position: 'relative', overflow: 'hidden' }}>
                    {comp.photo_url
                      ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={comp.photo_url}
                          alt={item.boards?.name}
                          className="poe-photo"
                          onClick={() => setLightbox({ url: comp.photo_url!, name: item.boards?.name || 'Board' })}
                          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                        />
                      )
                      : (
                        <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                          <div style={{ fontSize: '2rem' }}>📷</div>
                          <span style={{ fontSize: '0.75rem', color: '#94A3B8' }}>Photo submitted but not available for preview</span>
                        </div>
                      )
                    }
                    {/* Status badge */}
                    <span style={{
                      position: 'absolute', top: 10, right: 10,
                      fontSize: '0.625rem', fontWeight: 700, padding: '3px 8px', borderRadius: 5,
                      background: isVerified ? '#ECFDF5' : isFlagged ? '#FEF2F2' : '#FFFBEB',
                      color: isVerified ? '#065F46' : isFlagged ? '#7F1D1D' : '#92400E',
                      border: `1px solid ${isVerified ? '#A7F3D0' : isFlagged ? '#FECACA' : '#FDE68A'}`,
                    }}>
                      {isVerified ? '✓ Verified' : isFlagged ? '⚠ Flagged' : '⏳ Submitted'}
                    </span>
                  </div>

                  {/* Info */}
                  <div style={{ padding: '14px 16px' }}>
                    <div style={{ marginBottom: 10 }}>
                      <p style={{ fontSize: '0.875rem', fontWeight: 700, color: '#0F172A', margin: '0 0 2px', lineHeight: 1.3 }}>
                        {item.boards?.name || 'Unknown board'}
                      </p>
                      <p style={{ fontSize: '0.75rem', color: '#64748B', margin: 0 }}>
                        {item.boards?.city && `${item.boards.city} · `}
                        {FORMAT_LABELS[item.boards?.format || ''] || item.boards?.format}
                      </p>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 14 }}>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <span style={{ fontSize: '0.6875rem', color: '#94A3B8', width: 64, flexShrink: 0 }}>Submitted</span>
                        <span style={{ fontSize: '0.6875rem', color: '#475569', fontWeight: 500 }}>{fmtDate(comp.submitted_at)}</span>
                      </div>
                      {(comp.submitted_name || comp.submitted_by) && (
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          <span style={{ fontSize: '0.6875rem', color: '#94A3B8', width: 64, flexShrink: 0 }}>By</span>
                          <span style={{ fontSize: '0.6875rem', color: '#475569', fontWeight: 500 }}>{comp.submitted_name || comp.submitted_by}</span>
                        </div>
                      )}
                      {comp.latitude && comp.longitude && (
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          <span style={{ fontSize: '0.6875rem', color: '#94A3B8', width: 64, flexShrink: 0 }}>GPS</span>
                          <a
                            href={`https://www.google.com/maps?q=${comp.latitude},${comp.longitude}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ fontSize: '0.6875rem', color: '#1B4F8A', fontWeight: 500, textDecoration: 'none' }}
                          >
                            {Number(comp.latitude).toFixed(5)}, {Number(comp.longitude).toFixed(5)} ↗
                          </a>
                        </div>
                      )}
                      {comp.notes && (
                        <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 6, padding: '6px 10px', marginTop: 4 }}>
                          <p style={{ fontSize: '0.6875rem', color: '#7F1D1D', margin: 0, lineHeight: 1.5 }}>
                            <strong>Flag notes:</strong> {comp.notes}
                          </p>
                        </div>
                      )}
                    </div>

                    {/* Actions */}
                    {!isVerified && (
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button
                          onClick={() => verify(item.id)}
                          disabled={isSaving}
                          style={{
                            flex: 1, padding: '8px', borderRadius: 7, border: 'none', cursor: isSaving ? 'not-allowed' : 'pointer',
                            background: '#ECFDF5', color: '#065F46', fontSize: '0.75rem', fontWeight: 700, fontFamily: 'inherit',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                          }}
                        >
                          {isSaving
                            ? <div style={{ width: 12, height: 12, border: '2px solid #A7F3D0', borderTopColor: '#10B981', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
                            : '✓'
                          }
                          {isSaving ? 'Saving…' : 'Verify'}
                        </button>
                        <button
                          onClick={() => setFlagging(item.id)}
                          disabled={isSaving}
                          style={{
                            flex: 1, padding: '8px', borderRadius: 7, cursor: isSaving ? 'not-allowed' : 'pointer',
                            background: '#FEF2F2', color: '#EF4444', border: '1px solid #FECACA',
                            fontSize: '0.75rem', fontWeight: 600, fontFamily: 'inherit',
                          }}
                        >
                          ⚠ Flag issue
                        </button>
                      </div>
                    )}

                    {isVerified && (
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '8px', background: '#ECFDF5', borderRadius: 7 }}>
                        <span style={{ color: '#10B981', fontWeight: 700, fontSize: '0.8125rem' }}>✓ Verified — all good</span>
                      </div>
                    )}

                    {isFlagged && (
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button
                          onClick={() => verify(item.id)}
                          style={{ flex: 1, padding: '8px', borderRadius: 7, border: 'none', cursor: 'pointer', background: '#ECFDF5', color: '#065F46', fontSize: '0.75rem', fontWeight: 700, fontFamily: 'inherit' }}
                        >
                          Accept anyway
                        </button>
                        <SharePOELink bookingId={item.id} boardName={item.boards?.name || ''} variant="inline" />
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ── Pending boards ── */}
      {pending.length > 0 && (
        <section>
          <h3 style={{ fontSize: '0.8125rem', fontWeight: 700, color: '#92400E', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 14px', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#F59E0B', display: 'inline-block' }} />
            Awaiting POE ({pending.length})
          </h3>

          <div style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: 12, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
              <thead>
                <tr style={{ background: '#F8FAFC', borderBottom: '1px solid #E2E8F0' }}>
                  {['Board', 'City', 'Format', 'Get POE link'].map(h => (
                    <th key={h} style={{ padding: '10px 16px', fontSize: '0.6875rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.07em', textAlign: 'left' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pending.map((item, i) => (
                  <tr key={item.id} style={{ borderBottom: i < pending.length - 1 ? '1px solid #F8FAFC' : 'none' }}>
                    <td style={{ padding: '12px 16px' }}>
                      <p style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#0F172A', margin: 0 }}>
                        {item.boards?.name || 'Unknown board'}
                      </p>
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: '0.8125rem', color: '#64748B' }}>
                      {item.boards?.city || '—'}
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <span style={{ fontSize: '0.6875rem', fontWeight: 600, padding: '2px 8px', borderRadius: 4, background: '#F1F5F9', color: '#475569' }}>
                        {FORMAT_LABELS[item.boards?.format || ''] || item.boards?.format || '—'}
                      </span>
                    </td>
                    <td style={{ padding: '10px 16px' }}>
                      <SharePOELink bookingId={item.id} boardName={item.boards?.name || ''} variant="inline" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Photo lightbox */}
      {lightbox && (
        <PhotoLightbox url={lightbox.url} boardName={lightbox.name} onClose={() => setLightbox(null)} />
      )}

      {/* Flag modal */}
      {flagging && (
        <FlagModal
          onConfirm={notes => flag(flagging, notes)}
          onCancel={() => setFlagging(null)}
        />
      )}
    </>
  );
}
