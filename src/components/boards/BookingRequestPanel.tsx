'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { getActivityActor, logActivity } from '@/lib/activity-log';

type Board = {
  id: string;
  name: string;
  address: string;
  city?: string;
  state?: string;
  format?: string;
  asking_rate?: number;
  width?: number;
  height?: number;
  photos?: string[];
  status: string;
};

type Campaign = {
  id: string;
  name: string;
  client_name?: string;
  status: string;
};

type Props = {
  board: Board;
  onClose: () => void;
  onSuccess: () => void;
};

const FORMAT_LABELS: Record<string, string> = {
  billboard: 'Billboard', unipole: 'Unipole', gantry: 'Gantry',
  bridge_panel: 'Bridge Panel', wall_drape: 'Wall Drape',
};

const MONO: React.CSSProperties = {
  fontFamily: "'JetBrains Mono', monospace",
  fontVariantNumeric: 'tabular-nums',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '9px 12px',
  border: '1px solid #E2E8F0',
  borderRadius: 8,
  fontSize: '0.875rem',
  color: '#0F172A',
  outline: 'none',
  fontFamily: 'inherit',
  background: '#fff',
  boxSizing: 'border-box',
  transition: 'border-color 0.15s, box-shadow 0.15s',
};

function onInputFocus(e: React.FocusEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) {
  e.currentTarget.style.borderColor = '#1B4F8A';
  e.currentTarget.style.boxShadow = '0 0 0 3px rgba(27, 79, 138, 0.08)';
}

function onInputBlur(e: React.FocusEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) {
  e.currentTarget.style.borderColor = '#E2E8F0';
  e.currentTarget.style.boxShadow = 'none';
}

function formatNaira(amount?: number | null) {
  if (!amount) return '—';
  return '₦' + Number(amount).toLocaleString('en-NG');
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 500, color: '#374151', marginBottom: 6 }}>
        {label}{required && <span style={{ color: '#F87171', marginLeft: 2 }}>*</span>}
      </label>
      {children}
    </div>
  );
}

export default function BookingRequestPanel({ board, onClose, onSuccess }: Props) {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [selectedCampaign, setSelectedCampaign] = useState('');
  const [offeredRate, setOfferedRate] = useState(
    board.asking_rate ? Math.round(board.asking_rate * 0.85) : 0
  );
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchCampaigns();
    const start = new Date();
    start.setDate(start.getDate() + 7);
    const end = new Date();
    end.setDate(end.getDate() + 37);
    setStartDate(start.toISOString().split('T')[0]);
    setEndDate(end.toISOString().split('T')[0]);
  }, []);

  async function fetchCampaigns() {
    const { data } = await supabase
      .from('campaigns')
      .select('id, name, client_name, status')
      .in('status', ['active', 'draft'])
      .order('created_at', { ascending: false });
    if (data) setCampaigns(data as Campaign[]);
    if (data && data.length > 0) setSelectedCampaign(data[0].id);
  }

  async function handleSubmit() {
    setError('');
    if (!selectedCampaign) { setError('Please select a campaign'); return; }
    if (!offeredRate || offeredRate <= 0) { setError('Please enter a valid rate'); return; }
    if (!startDate || !endDate) { setError('Please set campaign dates'); return; }
    if (new Date(endDate) <= new Date(startDate)) { setError('End date must be after start date'); return; }

    setSubmitting(true);

    const { data: newBooking, error: insertError } = await supabase.from('bookings').insert({
      campaign_id: selectedCampaign,
      board_id: board.id,
      offered_rate: offeredRate,
      status: 'pending',
      start_date: startDate,
      end_date: endDate,
      notes: notes || null,
    }).select('id').single();

    if (insertError) {
      console.error(insertError);
      setError('Failed to send request. Please try again.');
      setSubmitting(false);
      return;
    }

    const actor = await getActivityActor();
    await logActivity({
      entityType: 'booking',
      entityId: newBooking!.id,
      campaignId: selectedCampaign,
      action: 'booking.requested',
      summary: `Booking request sent for ${board.name} at ₦${offeredRate.toLocaleString('en-NG')}/mo`,
      ...actor,
      metadata: { board_id: board.id, start_date: startDate, end_date: endDate },
    });

    setSubmitted(true);
    setSubmitting(false);
    setTimeout(() => {
      onSuccess();
    }, 2000);
  }

  const hasValidDates = startDate && endDate && new Date(endDate) > new Date(startDate);
  const durationDays = hasValidDates
    ? Math.round((new Date(endDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24))
    : 0;
  const durationMonths = hasValidDates
    ? Math.ceil(durationDays / 30)
    : 0;

  const discountPct = board.asking_rate && offeredRate > 0
    ? Math.round(((board.asking_rate - offeredRate) / board.asking_rate) * 100)
    : 0;

  const isBelowAsking = board.asking_rate ? offeredRate < board.asking_rate : false;
  const isAtOrAboveAsking = board.asking_rate ? offeredRate >= board.asking_rate : false;

  const showDealPreview = hasValidDates && offeredRate > 0;
  const totalCost = offeredRate * durationMonths;
  const askingTotal = board.asking_rate ? board.asking_rate * durationMonths : 0;
  const savingsTotal = askingTotal > 0 ? askingTotal - totalCost : 0;

  if (submitted) {
    return (
      <div style={{
        width: 320, flexShrink: 0, background: '#fff', borderLeft: '1px solid #E2E8F0',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: 16, padding: '32px 24px', textAlign: 'center',
        fontFamily: "'Inter', -apple-system, sans-serif",
      }}>
        <div style={{
          width: 56, height: 56, background: '#ECFDF5', borderRadius: '50%',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <div>
          <p style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0F172A', margin: 0 }}>Booking request sent!</p>
          <p style={{ fontSize: '0.75rem', color: '#94A3B8', margin: '6px 0 0', lineHeight: 1.5 }}>
            The board owner will be notified. You can track this in Negotiations.
          </p>
        </div>
        <div style={{ width: '100%', background: '#F1F5F9', borderRadius: 99, height: 4, overflow: 'hidden' }}>
          <div style={{ background: '#10B981', height: '100%', width: '100%', borderRadius: 99, transition: 'width 2s' }} />
        </div>
      </div>
    );
  }

  return (
    <div style={{
      width: 320, flexShrink: 0, background: '#fff', borderLeft: '1px solid #E2E8F0',
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
      fontFamily: "'Inter', -apple-system, sans-serif",
    }}>
      <style>{`
        .booking-rate-slider {
          -webkit-appearance: none;
          appearance: none;
          width: 100%;
          height: 4px;
          border-radius: 99px;
          background: #E2E8F0;
          outline: none;
          cursor: pointer;
        }
        .booking-rate-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: #1B4F8A;
          border: 2px solid #fff;
          box-shadow: 0 1px 4px rgba(27, 79, 138, 0.35);
          cursor: pointer;
        }
        .booking-rate-slider::-moz-range-thumb {
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: #1B4F8A;
          border: 2px solid #fff;
          box-shadow: 0 1px 4px rgba(27, 79, 138, 0.35);
          cursor: pointer;
        }
        .booking-rate-slider::-moz-range-track {
          height: 4px;
          border-radius: 99px;
          background: #1B4F8A;
        }
        .booking-rate-slider::-webkit-slider-runnable-track {
          height: 4px;
          border-radius: 99px;
          background: linear-gradient(
            to right,
            #1B4F8A 0%,
            #1B4F8A var(--pct, 50%),
            #E2E8F0 var(--pct, 50%),
            #E2E8F0 100%
          );
        }
        .booking-panel-notes::placeholder { color: #CBD5E1; opacity: 1; }
      `}</style>

      {/* Header */}
      <div style={{ padding: '20px 24px', borderBottom: '1px solid #F1F5F9', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <p style={{
              fontSize: '0.6875rem', fontWeight: 700, color: '#1B4F8A',
              textTransform: 'uppercase', letterSpacing: '0.07em', margin: '0 0 6px',
            }}>
              Booking request
            </p>
            <h2 style={{
              fontSize: '1rem', fontWeight: 700, color: '#0F172A', margin: '0 0 4px',
              letterSpacing: '-0.015em', lineHeight: 1.3,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {board.name}
            </h2>
            <p style={{
              fontSize: '0.75rem', color: '#94A3B8', margin: 0,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {board.address}
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: '#94A3B8', fontSize: '1.125rem', padding: 2,
              display: 'flex', flexShrink: 0, lineHeight: 1,
            }}
            aria-label="Close"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Stat row */}
      <div style={{ padding: '0 24px', marginTop: 16, flexShrink: 0 }}>
        <div style={{
          display: 'grid', gridTemplateColumns: '1fr 1fr 1fr',
          border: '1px solid #E2E8F0', borderRadius: 8, overflow: 'hidden',
        }}>
          {[
            { label: 'Format', value: FORMAT_LABELS[board.format || ''] || board.format || '—', mono: false },
            { label: 'Location', value: board.city || board.state || '—', mono: false },
            { label: 'Asking rate', value: formatNaira(board.asking_rate), mono: true },
          ].map((cell, i) => (
            <div
              key={cell.label}
              style={{
                padding: '12px 10px', textAlign: 'center',
                borderRight: i < 2 ? '1px solid #E2E8F0' : 'none',
              }}
            >
              <p style={{
                fontSize: '0.625rem', fontWeight: 700, color: '#94A3B8',
                textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 5px',
              }}>
                {cell.label}
              </p>
              <p style={{
                fontSize: '0.8125rem', fontWeight: 700, color: '#0F172A', margin: 0,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                ...(cell.mono ? MONO : {}),
              }}>
                {cell.value}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Form */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>

        <Field label="Link to campaign" required>
          {campaigns.length === 0 ? (
            <div style={{
              fontSize: '0.8125rem', color: '#DC2626', background: '#FEF2F2',
              borderRadius: 8, padding: '10px 12px', border: '1px solid #FECACA',
            }}>
              No active campaigns found. Create a campaign first.
            </div>
          ) : (
            <select
              value={selectedCampaign}
              onChange={e => setSelectedCampaign(e.target.value)}
              style={{ ...inputStyle, cursor: 'pointer' }}
              onFocus={onInputFocus}
              onBlur={onInputBlur}
            >
              {campaigns.map(c => (
                <option key={c.id} value={c.id}>
                  {c.name}{c.client_name ? ` — ${c.client_name}` : ''}
                </option>
              ))}
            </select>
          )}
        </Field>

        <Field label="Your offer (₦/month)" required>
          <div style={{ position: 'relative' }}>
            <span style={{
              position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
              fontSize: '0.875rem', color: '#94A3B8', fontWeight: 500, ...MONO,
            }}>
              ₦
            </span>
            <input
              type="number"
              value={offeredRate}
              onChange={e => setOfferedRate(Number(e.target.value))}
              style={{ ...inputStyle, paddingLeft: 28, ...MONO }}
              placeholder="Enter your offer"
              onFocus={onInputFocus}
              onBlur={onInputBlur}
            />
          </div>

          {board.asking_rate && offeredRate > 0 && (
            <div style={{ margin: '12px 0' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <span style={{ fontSize: '0.75rem', color: '#64748B' }}>
                  Asking: <span style={MONO}>{formatNaira(board.asking_rate)}</span>
                </span>
                {isBelowAsking && discountPct > 0 ? (
                  <span style={{
                    fontSize: '0.6875rem', fontWeight: 600, padding: '3px 10px', borderRadius: 999,
                    background: '#ECFDF5', color: '#059669',
                  }}>
                    {discountPct}% below asking
                  </span>
                ) : isAtOrAboveAsking ? (
                  <span style={{
                    fontSize: '0.6875rem', fontWeight: 600, padding: '3px 10px', borderRadius: 999,
                    background: '#FFFBEB', color: '#D97706',
                  }}>
                    {discountPct === 0 ? 'At asking' : `${Math.abs(discountPct)}% above asking`}
                  </span>
                ) : null}
              </div>
              <input
                type="range"
                className="booking-rate-slider"
                min={Math.round(board.asking_rate * 0.5)}
                max={Math.round(board.asking_rate * 1.2)}
                value={offeredRate}
                onChange={e => setOfferedRate(Number(e.target.value))}
                style={{
                  ['--pct' as string]: `${((offeredRate - board.asking_rate * 0.5) / (board.asking_rate * 0.7)) * 100}%`,
                }}
              />
            </div>
          )}
        </Field>

        <div style={{ marginBottom: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 500, color: '#374151', marginBottom: 6 }}>
                Start date<span style={{ color: '#F87171', marginLeft: 2 }}>*</span>
              </label>
              <input
                type="date"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
                style={inputStyle}
                onFocus={onInputFocus}
                onBlur={onInputBlur}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 500, color: '#374151', marginBottom: 6 }}>
                End date<span style={{ color: '#F87171', marginLeft: 2 }}>*</span>
              </label>
              <input
                type="date"
                value={endDate}
                onChange={e => setEndDate(e.target.value)}
                style={inputStyle}
                onFocus={onInputFocus}
                onBlur={onInputBlur}
              />
            </div>
          </div>
          {hasValidDates && (
            <p style={{ fontSize: '0.75rem', color: '#94A3B8', margin: '8px 0 0' }}>
              Campaign duration: {durationDays} days
            </p>
          )}
        </div>

        <Field label="Notes to board owner">
          <textarea
            className="booking-panel-notes"
            value={notes}
            onChange={e => setNotes(e.target.value)}
            rows={3}
            placeholder="Explain your campaign goals, audience, any special requirements..."
            style={{ ...inputStyle, resize: 'none', lineHeight: 1.5 }}
            onFocus={onInputFocus}
            onBlur={onInputBlur}
          />
        </Field>

        {showDealPreview && (
          <div style={{
            background: '#F8FAFC', borderRadius: 10, padding: '14px 16px',
            border: '1px solid #F1F5F9', marginBottom: 14,
          }}>
            <p style={{
              fontSize: '0.6875rem', fontWeight: 700, color: '#94A3B8',
              textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 10px',
            }}>
              Deal preview
            </p>
            <p style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#0F172A', margin: '0 0 8px' }}>
              {board.name}
            </p>
            <p style={{ fontSize: '0.8125rem', color: '#475569', margin: '0 0 6px', lineHeight: 1.5 }}>
              <span style={MONO}>{formatNaira(offeredRate)}</span>
              <span style={{ color: '#94A3B8', margin: '0 4px' }}>×</span>
              {durationMonths} mo
              <span style={{ color: '#94A3B8', margin: '0 4px' }}>=</span>
              <span style={{ ...MONO, fontWeight: 700, color: '#0F172A' }}>{formatNaira(totalCost)}</span>
            </p>
            {board.asking_rate && savingsTotal > 0 && (
              <p style={{ fontSize: '0.75rem', color: '#059669', fontWeight: 600, margin: 0 }}>
                Saves <span style={MONO}>{formatNaira(savingsTotal)}</span> vs asking ({formatNaira(askingTotal)})
              </p>
            )}
            {board.asking_rate && savingsTotal <= 0 && isAtOrAboveAsking && (
              <p style={{ fontSize: '0.75rem', color: '#D97706', fontWeight: 600, margin: 0 }}>
                {savingsTotal < 0
                  ? <>+<span style={MONO}>{formatNaira(Math.abs(savingsTotal))}</span> vs asking total</>
                  : 'Offer matches asking rate'}
              </p>
            )}
          </div>
        )}

        {error && (
          <div style={{
            background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8,
            padding: '10px 12px', fontSize: '0.8125rem', color: '#DC2626', marginBottom: 14,
          }}>
            {error}
          </div>
        )}
      </div>

      {/* Footer buttons */}
      <div style={{
        padding: 16, borderTop: '1px solid #E2E8F0',
        display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0,
      }}>
        <button
          onClick={handleSubmit}
          disabled={submitting || campaigns.length === 0}
          style={{
            width: '100%', padding: 11, background: submitting || campaigns.length === 0 ? '#94A3B8' : '#1B4F8A',
            color: '#fff', border: 'none', borderRadius: 8,
            fontSize: '0.875rem', fontWeight: 600, cursor: submitting || campaigns.length === 0 ? 'not-allowed' : 'pointer',
            fontFamily: 'inherit', transition: 'background 0.15s',
          }}
        >
          {submitting ? 'Sending request...' : 'Send booking request'}
        </button>
        <button
          onClick={onClose}
          style={{
            width: '100%', padding: 11, background: 'transparent',
            color: '#475569', border: '1px solid #E2E8F0', borderRadius: 8,
            fontSize: '0.875rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
