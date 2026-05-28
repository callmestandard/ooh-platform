'use client';

import { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import DownloadInvoice from '@/components/invoice/DownloadInvoice';
import { RoleGuard } from '@/components/layout/RoleGuard';
import { supabase } from '@/lib/supabase';

// ── Types ──────────────────────────────────────────────────────────────────

type Board = {
  id: string;
  name: string;
  address: string;
  city: string;
  state: string;
  format: string;
  asking_rate: number;
  width: number;
  height: number;
  illuminated: boolean;
  face_count: number;
  latitude: number | null;
  longitude: number | null;
  status: 'available' | 'booked' | 'maintenance';
  created_at: string;
};

type Booking = {
  id: string;
  board_id: string;
  status: string;
  offered_rate: number;
  agreed_rate: number | null;
  start_date: string;
  end_date: string;
  duration_months: number | null;
  created_at: string;
  boards: { name: string; city: string; format: string };
  campaigns: { name: string; client_name: string | null };
};

type Message = {
  id: string;
  booking_id: string;
  sender_role: string;
  content: string;
  message_type: string;
  offered_rate: number | null;
  created_at: string;
  bookings: { boards: { name: string } };
};

type BoardForm = {
  name: string;
  format: string;
  address: string;
  city: string;
  state: string;
  width: string;
  height: string;
  asking_rate: string;
  face_count: string;
  illuminated: boolean;
  latitude: string;
  longitude: string;
};

const EMPTY_FORM: BoardForm = {
  name: '', format: 'billboard', address: '', city: '', state: '',
  width: '', height: '', asking_rate: '', face_count: '1',
  illuminated: false, latitude: '', longitude: '',
};

// ── Helpers ────────────────────────────────────────────────────────────────

function formatNaira(n: number | null | undefined) {
  if (!n) return '₦0';
  if (n >= 1_000_000) return '₦' + (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return '₦' + (n / 1_000).toFixed(0) + 'K';
  return '₦' + Number(n).toLocaleString('en-NG');
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatDateShort(d: string) {
  return new Date(d).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' });
}

function getDaysLeft(end: string) {
  return Math.ceil((new Date(end).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

const FORMAT_LABELS: Record<string, string> = {
  billboard: 'Billboard', unipole: 'Unipole', gantry: 'Gantry',
  bridge_panel: 'Bridge Panel', wall_drape: 'Wall Drape',
};

const FORMAT_OPTIONS = [
  { value: 'billboard',    label: 'Billboard' },
  { value: 'unipole',      label: 'Unipole' },
  { value: 'gantry',       label: 'Gantry' },
  { value: 'bridge_panel', label: 'Bridge Panel' },
  { value: 'wall_drape',   label: 'Wall Drape' },
];

const NIGERIA_STATES = [
  'Abia','Adamawa','Akwa Ibom','Anambra','Bauchi','Bayelsa','Benue','Borno','Cross River',
  'Delta','Ebonyi','Edo','Ekiti','Enugu','FCT - Abuja','Gombe','Imo','Jigawa','Kaduna',
  'Kano','Katsina','Kebbi','Kogi','Kwara','Lagos','Nasarawa','Niger','Ogun','Ondo',
  'Osun','Oyo','Plateau','Rivers','Sokoto','Taraba','Yobe','Zamfara',
];

// ── Small components ───────────────────────────────────────────────────────

function BoardStatusPill({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string; dot: string; label: string }> = {
    available:   { bg: '#ECFDF5', color: '#065F46', dot: '#10B981', label: 'Available' },
    booked:      { bg: '#EFF6FF', color: '#1E3A8A', dot: '#3B82F6', label: 'Booked' },
    maintenance: { bg: '#FFFBEB', color: '#92400E', dot: '#F59E0B', label: 'Maintenance' },
  };
  const cfg = map[status] || map.available;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: cfg.bg, color: cfg.color, padding: '3px 9px', borderRadius: '999px', fontSize: '0.6875rem', fontWeight: 600 }}>
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: cfg.dot }} />
      {cfg.label}
    </span>
  );
}

function BookingPill({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string; dot: string; label: string }> = {
    pending:     { bg: '#FFFBEB', color: '#92400E', dot: '#F59E0B', label: 'Pending' },
    negotiating: { bg: '#EFF6FF', color: '#1E3A8A', dot: '#3B82F6', label: 'Negotiating' },
    agreed:      { bg: '#F5F3FF', color: '#3730A3', dot: '#8B5CF6', label: 'Agreed' },
    signed:      { bg: '#F5F3FF', color: '#3730A3', dot: '#8B5CF6', label: 'Signed' },
    live:        { bg: '#ECFDF5', color: '#065F46', dot: '#10B981', label: 'Live' },
    completed:   { bg: '#EFF6FF', color: '#1E3A8A', dot: '#3B82F6', label: 'Completed' },
    declined:    { bg: '#FEF2F2', color: '#7F1D1D', dot: '#EF4444', label: 'Declined' },
  };
  const cfg = map[status] || map.pending;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: cfg.bg, color: cfg.color, padding: '3px 9px', borderRadius: '999px', fontSize: '0.6875rem', fontWeight: 600 }}>
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: cfg.dot }} />
      {cfg.label}
    </span>
  );
}

function StatBlock({ label, value, bar, sub }: { label: string; value: string; bar: string; sub?: string }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: '12px', padding: '18px 20px' }}>
      <p style={{ fontSize: '0.6875rem', fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.07em', margin: '0 0 8px' }}>{label}</p>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <span style={{ display: 'block', width: 3, height: 28, background: bar, borderRadius: 2, flexShrink: 0 }} />
        <span style={{ fontSize: '1.875rem', fontWeight: 700, color: '#0F172A', letterSpacing: '-0.03em', fontFamily: 'monospace' }}>{value}</span>
      </div>
      {sub && <p style={{ fontSize: '0.6875rem', color: '#CBD5E1', margin: '4px 0 0' }}>{sub}</p>}
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#374151', marginBottom: 5 }}>
      {children}
    </label>
  );
}

function FieldInput({ value, onChange, type = 'text', placeholder, required }: {
  value: string; onChange: (v: string) => void;
  type?: string; placeholder?: string; required?: boolean;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      required={required}
      style={{
        width: '100%', padding: '8px 10px',
        border: '1px solid #E2E8F0', borderRadius: '7px',
        fontSize: '0.875rem', outline: 'none',
        fontFamily: 'inherit', boxSizing: 'border-box',
        color: '#0F172A', background: '#fff',
      }}
      onFocus={e => e.currentTarget.style.borderColor = '#7C3AED'}
      onBlur={e => e.currentTarget.style.borderColor = '#E2E8F0'}
    />
  );
}

// ── Rate Card ─────────────────────────────────────────────────────────────

type RateCardData = {
  baseRate: number;
  seasons: { id: string; label: string; emoji: string; multiplier: number }[];
  durations: { months: number; label: string; discount: number }[];
};

const DEFAULT_SEASONS = [
  { id: 'regular',  label: 'Regular',          emoji: '📅', multiplier: 1.0  },
  { id: 'q4',       label: 'Q4 (Oct–Dec)',      emoji: '📈', multiplier: 1.3  },
  { id: 'festive',  label: 'Festive (Dec–Jan)', emoji: '🎉', multiplier: 1.5  },
  { id: 'ramadan',  label: 'Ramadan',           emoji: '🌙', multiplier: 1.2  },
];

const DEFAULT_DURATIONS = [
  { months: 1,  label: '1 month',  discount: 0    },
  { months: 3,  label: '3 months', discount: 0.05 },
  { months: 6,  label: '6 months', discount: 0.10 },
  { months: 12, label: '12 months',discount: 0.15 },
];

function loadRateCard(boardId: string, askingRate: number): RateCardData {
  try {
    const raw = localStorage.getItem(`ooh_rate_card_${boardId}`);
    if (raw) return JSON.parse(raw) as RateCardData;
  } catch {}
  return { baseRate: askingRate, seasons: DEFAULT_SEASONS.map(s => ({ ...s })), durations: DEFAULT_DURATIONS.map(d => ({ ...d })) };
}

function saveRateCard(boardId: string, card: RateCardData) {
  localStorage.setItem(`ooh_rate_card_${boardId}`, JSON.stringify(card));
}

function RateCardTab({ boards, formatNaira, onSave }: { boards: Board[]; formatNaira: (n: number) => string; onSave: () => void }) {
  const [selectedBoardId, setSelectedBoardId] = useState<string>(boards[0]?.id || '');
  const [card, setCard] = useState<RateCardData | null>(null);
  const [previewSeason, setPreviewSeason] = useState<string>('regular');
  const [saved, setSaved] = useState(false);

  const selectedBoard = boards.find(b => b.id === selectedBoardId);

  useEffect(() => {
    if (selectedBoardId && selectedBoard) {
      setCard(loadRateCard(selectedBoardId, selectedBoard.asking_rate));
    }
  }, [selectedBoardId]);

  if (boards.length === 0) {
    return (
      <div style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: 12, padding: '4rem', textAlign: 'center' }}>
        <p style={{ fontSize: '0.875rem', color: '#94A3B8', margin: 0 }}>Add boards first to configure rate cards</p>
      </div>
    );
  }

  if (!card || !selectedBoard) return null;

  function updateSeason(id: string, multiplier: number) {
    setCard(prev => prev ? ({ ...prev, seasons: prev.seasons.map(s => s.id === id ? { ...s, multiplier } : s) }) : prev);
  }

  function updateDiscount(months: number, discount: number) {
    setCard(prev => prev ? ({ ...prev, durations: prev.durations.map(d => d.months === months ? { ...d, discount } : d) }) : prev);
  }

  function handleSave() {
    if (!card) return;
    saveRateCard(selectedBoardId, card);
    setSaved(true);
    onSave();
    setTimeout(() => setSaved(false), 2000);
  }

  const effectiveRate = (season: typeof DEFAULT_SEASONS[0], dur: typeof DEFAULT_DURATIONS[0]) =>
    Math.round(card.baseRate * season.multiplier * (1 - dur.discount));

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
        <div>
          <h2 style={{ fontSize: '1rem', fontWeight: 700, color: '#0F172A', margin: '0 0 4px' }}>Rate Card</h2>
          <p style={{ fontSize: '0.8125rem', color: '#94A3B8', margin: 0 }}>
            Set seasonal multipliers and duration discounts per board. Rates appear automatically in negotiations.
          </p>
        </div>
        <button
          onClick={handleSave}
          style={{ padding: '9px 20px', background: saved ? '#10B981' : '#7C3AED', color: '#fff', border: 'none', borderRadius: 9, fontSize: '0.8125rem', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', transition: 'background 0.3s' }}
        >
          {saved ? '✓ Saved' : 'Save rate card'}
        </button>
      </div>

      {/* Board selector */}
      <div style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: 12, padding: '14px 18px', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: 16 }}>
        <p style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#374151', margin: 0, flexShrink: 0 }}>Board</p>
        <select
          value={selectedBoardId}
          onChange={e => setSelectedBoardId(e.target.value)}
          style={{ flex: 1, padding: '8px 12px', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: '0.875rem', color: '#0F172A', fontFamily: 'inherit', cursor: 'pointer', outline: 'none', background: '#fff' }}
        >
          {boards.map(b => (
            <option key={b.id} value={b.id}>{b.name} — {b.city}</option>
          ))}
        </select>
        <div style={{ flexShrink: 0, textAlign: 'right' }}>
          <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: '0 0 2px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Current asking rate</p>
          <p style={{ fontSize: '1rem', fontWeight: 800, color: '#7C3AED', fontFamily: 'monospace', margin: 0 }}>{formatNaira(selectedBoard.asking_rate)}/mo</p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>

        {/* Base rate */}
        <div style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: 12, padding: '18px 20px' }}>
          <p style={{ fontSize: '0.75rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.07em', margin: '0 0 12px' }}>Base rate (₦/month)</p>
          <div style={{ position: 'relative' }}>
            <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', fontSize: '0.9375rem', fontWeight: 700, color: '#7C3AED' }}>₦</span>
            <input
              type="number"
              value={card.baseRate}
              onChange={e => setCard(prev => prev ? ({ ...prev, baseRate: parseFloat(e.target.value) || 0 }) : prev)}
              style={{ width: '100%', padding: '10px 12px 10px 28px', border: '1.5px solid #DDD6FE', borderRadius: 9, fontSize: '1.125rem', fontWeight: 700, fontFamily: 'monospace', color: '#0F172A', outline: 'none', boxSizing: 'border-box', background: '#FAFAFF' }}
              onFocus={e => e.currentTarget.style.borderColor = '#7C3AED'}
              onBlur={e => e.currentTarget.style.borderColor = '#DDD6FE'}
            />
          </div>
          <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: '6px 0 0' }}>
            This overrides the board's asking rate for negotiation guidance. It doesn't change what's publicly listed.
          </p>
        </div>

        {/* Duration discounts */}
        <div style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: 12, padding: '18px 20px' }}>
          <p style={{ fontSize: '0.75rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.07em', margin: '0 0 12px' }}>Duration discounts</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {card.durations.map(dur => (
              <div key={dur.months} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: '0.8125rem', fontWeight: 500, color: '#475569', minWidth: 80 }}>{dur.label}</span>
                <div style={{ flex: 1, position: 'relative' }}>
                  <input
                    type="range"
                    min={0} max={30} step={1}
                    value={Math.round(dur.discount * 100)}
                    onChange={e => updateDiscount(dur.months, parseFloat(e.target.value) / 100)}
                    style={{ width: '100%', accentColor: '#7C3AED' }}
                  />
                </div>
                <span style={{
                  minWidth: 48, textAlign: 'right', fontSize: '0.8125rem', fontWeight: 700,
                  color: dur.discount === 0 ? '#94A3B8' : '#7C3AED',
                  fontFamily: 'monospace',
                }}>
                  {dur.discount === 0 ? '—' : `-${Math.round(dur.discount * 100)}%`}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Seasonal multipliers */}
      <div style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: 12, padding: '18px 20px', marginBottom: '1rem' }}>
        <p style={{ fontSize: '0.75rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.07em', margin: '0 0 14px' }}>Seasonal multipliers</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          {card.seasons.map(season => (
            <div
              key={season.id}
              style={{
                background: previewSeason === season.id ? '#F5F3FF' : '#F8FAFC',
                border: `1.5px solid ${previewSeason === season.id ? '#DDD6FE' : '#E8EDF2'}`,
                borderRadius: 10, padding: '14px',
                cursor: 'pointer', transition: 'all 0.15s',
              }}
              onClick={() => setPreviewSeason(season.id)}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <span style={{ fontSize: '1.125rem' }}>{season.emoji}</span>
                {previewSeason === season.id && (
                  <span style={{ fontSize: '0.5625rem', fontWeight: 700, color: '#7C3AED', background: '#EDE9FE', padding: '2px 6px', borderRadius: 999, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Preview</span>
                )}
              </div>
              <p style={{ fontSize: '0.75rem', fontWeight: 600, color: '#374151', margin: '0 0 8px' }}>{season.label}</p>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input
                  type="number"
                  min={0.5} max={3} step={0.05}
                  value={season.multiplier}
                  onClick={e => e.stopPropagation()}
                  onChange={e => updateSeason(season.id, parseFloat(e.target.value) || 1)}
                  style={{ width: '60px', padding: '5px 8px', border: '1px solid #E2E8F0', borderRadius: 6, fontSize: '0.875rem', fontWeight: 700, fontFamily: 'monospace', color: '#0F172A', outline: 'none', textAlign: 'center' }}
                  onFocus={e => { e.stopPropagation(); e.currentTarget.style.borderColor = '#7C3AED'; }}
                  onBlur={e => e.currentTarget.style.borderColor = '#E2E8F0'}
                />
                <span style={{ fontSize: '0.75rem', color: '#94A3B8' }}>×</span>
                <span style={{
                  fontSize: '0.75rem', fontWeight: 700,
                  color: season.multiplier > 1 ? '#059669' : season.multiplier < 1 ? '#DC2626' : '#94A3B8',
                }}>
                  {season.multiplier > 1 ? `+${Math.round((season.multiplier - 1) * 100)}%` : season.multiplier < 1 ? `-${Math.round((1 - season.multiplier) * 100)}%` : 'base'}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Preview matrix */}
      <div style={{ background: '#0F172A', borderRadius: 12, padding: '20px 22px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div>
            <p style={{ fontSize: '0.875rem', fontWeight: 700, color: '#F8FAFC', margin: '0 0 3px' }}>Effective rate matrix</p>
            <p style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.4)', margin: 0 }}>
              Rates after seasonal multiplier + duration discount — what you'd quote in negotiations
            </p>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {card.seasons.map(s => (
              <button
                key={s.id}
                onClick={() => setPreviewSeason(s.id)}
                style={{
                  padding: '4px 10px', borderRadius: 6, fontSize: '0.6875rem', fontWeight: 600, border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                  background: previewSeason === s.id ? '#7C3AED' : 'rgba(255,255,255,0.08)',
                  color: previewSeason === s.id ? '#fff' : 'rgba(255,255,255,0.5)',
                }}
              >
                {s.emoji} {s.label.split(' ')[0]}
              </button>
            ))}
          </div>
        </div>

        {/* Matrix grid */}
        <div style={{ display: 'grid', gridTemplateColumns: `120px repeat(${card.durations.length}, 1fr)`, gap: '1px', background: 'rgba(255,255,255,0.05)', borderRadius: 8, overflow: 'hidden' }}>
          {/* Header row */}
          <div style={{ padding: '8px 12px', background: 'rgba(255,255,255,0.03)' }} />
          {card.durations.map(d => (
            <div key={d.months} style={{ padding: '8px 12px', background: 'rgba(255,255,255,0.03)', textAlign: 'center' }}>
              <p style={{ fontSize: '0.6875rem', fontWeight: 700, color: 'rgba(255,255,255,0.5)', margin: 0, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{d.label}</p>
              {d.discount > 0 && <p style={{ fontSize: '0.5625rem', color: '#10B981', margin: '2px 0 0', fontWeight: 600 }}>-{Math.round(d.discount * 100)}%</p>}
            </div>
          ))}
          {/* Data rows — one per season, highlight selected */}
          {card.seasons.map(season => {
            const isActive = previewSeason === season.id;
            return (
              <>
                <div key={season.id + '-label'} style={{ padding: '10px 12px', background: isActive ? 'rgba(124,58,237,0.2)' : 'rgba(255,255,255,0.02)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: '0.875rem' }}>{season.emoji}</span>
                  <span style={{ fontSize: '0.75rem', fontWeight: isActive ? 700 : 500, color: isActive ? '#C4B5FD' : 'rgba(255,255,255,0.4)' }}>{season.label.split(' ')[0]}</span>
                  {season.multiplier !== 1 && (
                    <span style={{ fontSize: '0.5625rem', color: season.multiplier > 1 ? '#10B981' : '#F87171', fontWeight: 700 }}>
                      {season.multiplier > 1 ? `+${Math.round((season.multiplier - 1) * 100)}%` : `-${Math.round((1 - season.multiplier) * 100)}%`}
                    </span>
                  )}
                </div>
                {card.durations.map(dur => {
                  const rate = effectiveRate(season, dur);
                  return (
                    <div key={season.id + '-' + dur.months} style={{ padding: '10px 12px', background: isActive ? 'rgba(124,58,237,0.12)' : 'rgba(255,255,255,0.02)', textAlign: 'center', borderLeft: '1px solid rgba(255,255,255,0.04)' }}>
                      <p style={{ fontSize: '0.875rem', fontWeight: isActive ? 800 : 600, color: isActive ? '#E9D5FF' : 'rgba(255,255,255,0.55)', margin: 0, fontFamily: 'monospace', letterSpacing: '-0.01em' }}>
                        {formatNaira(rate)}
                      </p>
                      {dur.months > 1 && (
                        <p style={{ fontSize: '0.5625rem', color: 'rgba(255,255,255,0.25)', margin: '2px 0 0' }}>
                          {formatNaira(rate * dur.months)} total
                        </p>
                      )}
                    </div>
                  );
                })}
              </>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Main content ───────────────────────────────────────────────────────────

function OwnerContent() {
  const [boards, setBoards] = useState<Board[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [creativesByBooking, setCreativesByBooking] = useState<Record<string, { id: string; file_url: string; file_name: string; file_size: number | null; status: string; notes: string | null }>>({});
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'boards' | 'bookings' | 'messages' | 'earnings' | 'calendar' | 'analytics' | 'rate-card'>('boards');
  const [reviewingCreative, setReviewingCreative] = useState<{ bookingId: string; fileUrl: string; fileName: string; creativeId: string } | null>(null);
  const [reviewNote, setReviewNote] = useState('');
  const [reviewSaving, setReviewSaving] = useState(false);
  const searchParams = useSearchParams();

  useEffect(() => {
    const tab = searchParams.get('tab');
    if (tab === 'bookings' || tab === 'messages' || tab === 'earnings' || tab === 'calendar' || tab === 'analytics' || tab === 'rate-card') {
      setActiveTab(tab as typeof activeTab);
    }
  }, [searchParams]);

  // Board management state
  const [showPanel, setShowPanel] = useState(false);
  const [editingBoard, setEditingBoard] = useState<Board | null>(null);
  const [form, setForm] = useState<BoardForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  useEffect(() => { fetchData(); }, []);

  async function fetchData() {
    const [boardsRes, bookingsRes, msgRes] = await Promise.all([
      supabase.from('boards').select('*').order('created_at', { ascending: false }),
      supabase
        .from('bookings')
        .select('*, boards(name, city, format), campaigns(name, client_name)')
        .not('status', 'eq', 'declined')
        .order('created_at', { ascending: false }),
      supabase
        .from('messages')
        .select('*, bookings(boards(name))')
        .eq('sender_role', 'agency')
        .order('created_at', { ascending: false })
        .limit(10),
    ]);
    if (boardsRes.data) setBoards(boardsRes.data as Board[]);
    if (bookingsRes.data) {
      const bks = bookingsRes.data as unknown as Booking[];
      setBookings(bks);
      if (bks.length > 0) {
        const { data: crData } = await supabase
          .from('creative_uploads')
          .select('id, booking_id, file_url, file_name, file_size, status, notes')
          .in('booking_id', bks.map(b => b.id))
          .order('created_at', { ascending: false });
        if (crData) {
          const crMap: Record<string, typeof crData[0]> = {};
          crData.forEach((c: any) => { if (!crMap[c.booking_id]) crMap[c.booking_id] = c; });
          setCreativesByBooking(crMap);
        }
      }
    }
    if (msgRes.data) setMessages(msgRes.data as unknown as Message[]);
    setLoading(false);
  }

  const showToast = useCallback((msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  function openAdd() {
    setEditingBoard(null);
    setForm(EMPTY_FORM);
    setShowPanel(true);
  }

  function openEdit(board: Board) {
    setEditingBoard(board);
    setForm({
      name: board.name,
      format: board.format,
      address: board.address || '',
      city: board.city || '',
      state: board.state || '',
      width: board.width ? String(board.width) : '',
      height: board.height ? String(board.height) : '',
      asking_rate: board.asking_rate ? String(board.asking_rate) : '',
      face_count: board.face_count ? String(board.face_count) : '1',
      illuminated: board.illuminated || false,
      latitude: board.latitude != null ? String(board.latitude) : '',
      longitude: board.longitude != null ? String(board.longitude) : '',
    });
    setShowPanel(true);
  }

  async function saveBoard() {
    if (!form.name || !form.format || !form.city || !form.asking_rate) return;
    setSaving(true);

    const payload = {
      name: form.name.trim(),
      format: form.format,
      address: form.address.trim() || null,
      city: form.city.trim(),
      state: form.state || null,
      width: form.width ? parseFloat(form.width) : null,
      height: form.height ? parseFloat(form.height) : null,
      asking_rate: parseFloat(form.asking_rate),
      face_count: parseInt(form.face_count) || 1,
      illuminated: form.illuminated,
      latitude: form.latitude ? parseFloat(form.latitude) : null,
      longitude: form.longitude ? parseFloat(form.longitude) : null,
    };

    if (editingBoard) {
      const { error } = await supabase.from('boards').update(payload).eq('id', editingBoard.id);
      if (error) { showToast('Failed to update board', 'error'); setSaving(false); return; }
      showToast(`${form.name} updated`);
    } else {
      const { error } = await supabase.from('boards').insert({ ...payload, status: 'available' });
      if (error) { showToast('Failed to add board', 'error'); setSaving(false); return; }
      showToast(`${form.name} added to your inventory`);
    }

    await fetchData();
    setShowPanel(false);
    setEditingBoard(null);
    setForm(EMPTY_FORM);
    setSaving(false);
  }

  async function toggleBoardStatus(board: Board) {
    if (board.status === 'booked') return; // can't toggle booked boards
    const next = board.status === 'available' ? 'maintenance' : 'available';
    const { error } = await supabase.from('boards').update({ status: next }).eq('id', board.id);
    if (!error) {
      setBoards(prev => prev.map(b => b.id === board.id ? { ...b, status: next as Board['status'] } : b));
      showToast(`${board.name} set to ${next}`);
    }
  }

  // ── Derived stats ──────────────────────────────────────────────────────

  const bookedCount = boards.filter(b => b.status === 'booked').length;
  const availableCount = boards.filter(b => b.status === 'available').length;
  const occupancyRate = boards.length > 0 ? Math.round((bookedCount / boards.length) * 100) : 0;
  const activeBookings = bookings.filter(b => ['live', 'agreed', 'signed'].includes(b.status));
  const monthlyEarnings = activeBookings.reduce((sum, b) => sum + (b.agreed_rate || b.offered_rate || 0), 0);
  const pendingBookings = bookings.filter(b => ['pending', 'negotiating'].includes(b.status));

  // ── Render ─────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '50vh' }}>
        <div style={{ width: 28, height: 28, border: '2px solid #E2E8F0', borderTopColor: '#7C3AED', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return (
    <div style={{ fontFamily: "'Inter', -apple-system, sans-serif" }}>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeUp { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:translateY(0); } }
        .fade { animation: fadeUp 0.25s ease forwards; opacity: 0; }
        .row-hover:hover { background: #F5F8FF !important; }
        .row-hover:hover .row-actions { opacity: 1 !important; }
        .row-actions { opacity: 0; transition: opacity 0.15s; }
        .msg-row:hover { background: #F5F8FF; }
      `}</style>

      {/* ── Welcome strip ── */}
      <div className="welcome-strip" style={{
        background: '#fff', border: '1px solid #E8EDF2', borderRadius: 16,
        padding: '18px 24px', marginBottom: '1.5rem',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
      }}>
        {/* Left: avatar + greeting */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{
            width: 46, height: 46, borderRadius: 13, flexShrink: 0,
            background: 'linear-gradient(135deg, #7C3AED 0%, #8B5CF6 100%)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="9" width="18" height="12" rx="2"/><path d="M3 9l9-6 9 6"/><line x1="9" y1="21" x2="9" y2="13"/><line x1="15" y1="21" x2="15" y2="13"/>
            </svg>
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
              <h1 style={{ fontSize: '1.0625rem', fontWeight: 700, color: '#0F172A', margin: 0, letterSpacing: '-0.02em' }}>
                Owner Dashboard
              </h1>
              <span style={{ fontSize: '0.625rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#7C3AED', background: '#F5F3FF', padding: '2px 8px', borderRadius: 999 }}>
                Owner Portal
              </span>
            </div>
            <p style={{ fontSize: '0.8125rem', color: '#94A3B8', margin: 0 }}>
              {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            </p>
          </div>
        </div>
        {/* Right: stats + action */}
        <div className="welcome-stats" style={{ display: 'flex', alignItems: 'center', gap: 24, flexShrink: 0 }}>
          <div style={{ textAlign: 'center' }}>
            <p style={{ fontSize: '1.5rem', fontWeight: 800, color: '#7C3AED', fontFamily: 'monospace', margin: '0 0 2px', letterSpacing: '-0.03em' }}>{boards.length}</p>
            <p style={{ fontSize: '0.625rem', fontWeight: 600, color: '#94A3B8', margin: 0, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Total boards</p>
          </div>
          <div style={{ width: 1, height: 36, background: '#F1F5F9' }} />
          <div style={{ textAlign: 'center' }}>
            <p style={{ fontSize: '1.5rem', fontWeight: 800, color: '#10B981', fontFamily: 'monospace', margin: '0 0 2px', letterSpacing: '-0.03em' }}>{formatNaira(monthlyEarnings)}</p>
            <p style={{ fontSize: '0.625rem', fontWeight: 600, color: '#94A3B8', margin: 0, textTransform: 'uppercase', letterSpacing: '0.05em' }}>This month</p>
          </div>
          <div style={{ width: 1, height: 36, background: '#F1F5F9' }} />
          <div style={{ textAlign: 'center' }}>
            <p style={{ fontSize: '1.5rem', fontWeight: 800, fontFamily: 'monospace', margin: '0 0 2px', letterSpacing: '-0.03em', color: occupancyRate >= 60 ? '#10B981' : '#F59E0B' }}>{occupancyRate}%</p>
            <p style={{ fontSize: '0.625rem', fontWeight: 600, color: '#94A3B8', margin: 0, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Occupancy</p>
          </div>
          <div style={{ width: 1, height: 36, background: '#F1F5F9' }} />
          <button
            onClick={openAdd}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              background: '#7C3AED', color: '#fff', border: 'none',
              padding: '9px 16px', borderRadius: 10,
              fontSize: '0.8125rem', fontWeight: 600,
              cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0,
            }}
          >
            <span style={{ fontSize: '1.1rem', lineHeight: 1 }}>+</span> Add board
          </button>
        </div>
      </div>

      {/* ── Stat cards ── */}
      <div className="resp-grid-4" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '1.75rem' }}>
        <StatBlock label="Total Boards" value={String(boards.length)} bar="#7C3AED" sub="In your inventory" />
        <StatBlock label="Booked" value={String(bookedCount)} bar="#10B981" sub={`${availableCount} available`} />
        <StatBlock label="Occupancy Rate" value={`${occupancyRate}%`} bar={occupancyRate >= 60 ? '#10B981' : '#F59E0B'} sub="Board utilisation" />
        <StatBlock label="Pending Actions" value={String(pendingBookings.length)} bar={pendingBookings.length > 0 ? '#F59E0B' : '#10B981'} sub="Awaiting your response" />
      </div>

      {/* ── Pending actions alert ── */}
      {pendingBookings.length > 0 && (
        <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: '10px', padding: '12px 16px', marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#D97706" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          <p style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#92400E', margin: 0 }}>
            {pendingBookings.length} booking{pendingBookings.length !== 1 ? 's' : ''} awaiting your response
          </p>
          <button
            onClick={() => setActiveTab('bookings')}
            style={{ marginLeft: 'auto', fontSize: '0.75rem', fontWeight: 600, color: '#D97706', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}
          >
            View bookings →
          </button>
        </div>
      )}

      {/* ── Tabs ── */}
      <div className="resp-tabs" style={{ display: 'flex', gap: 4, background: '#F1F5F9', padding: 4, borderRadius: 10, width: 'fit-content', marginBottom: '1.25rem' }}>
        {[
          { key: 'boards',     label: `My Boards (${boards.length})`,       badge: 0 },
          { key: 'bookings',   label: `Bookings (${bookings.length})`,       badge: pendingBookings.length },
          { key: 'calendar',   label: 'Calendar',                             badge: 0 },
          { key: 'messages',   label: `Messages (${messages.length})`,        badge: 0 },
          { key: 'earnings',   label: 'Earnings',                             badge: 0 },
          { key: 'analytics',  label: 'Analytics',                            badge: 0 },
          { key: 'rate-card',  label: 'Rate Card',                            badge: 0 },
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key as typeof activeTab)}
            style={{
              padding: '6px 14px', borderRadius: 7, border: 'none',
              background: activeTab === tab.key ? '#fff' : 'transparent',
              color: activeTab === tab.key ? '#0F172A' : '#64748B',
              fontSize: '0.8125rem', fontWeight: activeTab === tab.key ? 600 : 400,
              cursor: 'pointer', fontFamily: 'inherit',
              boxShadow: activeTab === tab.key ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
              display: 'flex', alignItems: 'center', gap: 6,
            }}
          >
            {tab.label}
            {tab.badge ? (
              <span style={{ background: '#FFFBEB', color: '#D97706', borderRadius: '999px', padding: '0 5px', fontSize: '0.625rem', fontWeight: 700 }}>
                {tab.badge}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      {/* ── Boards tab ── */}
      {activeTab === 'boards' && (
        <div className="table-scroll" style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: '12px', overflow: 'hidden' }}>
          {boards.length === 0 ? (
            <div style={{ padding: '5rem 2rem', textAlign: 'center' }}>
              <div style={{ width: 52, height: 52, background: '#F5F3FF', borderRadius: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#7C3AED" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="12" rx="2"/><line x1="8" y1="15" x2="8" y2="21"/><line x1="16" y1="15" x2="16" y2="21"/><line x1="5" y1="21" x2="19" y2="21"/>
                </svg>
              </div>
              <p style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#0F172A', margin: '0 0 6px' }}>No boards listed yet</p>
              <p style={{ fontSize: '0.8125rem', color: '#94A3B8', margin: '0 0 20px' }}>
                Add your billboard inventory so agencies can discover and book your spaces
              </p>
              <button
                onClick={openAdd}
                style={{ background: '#7C3AED', color: '#fff', border: 'none', padding: '10px 22px', borderRadius: '8px', fontSize: '0.875rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
              >
                + List your first board
              </button>
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#F8FAFC' }}>
                  {['Board', 'Location', 'Format', 'Dimensions', 'Asking rate', 'Status', ''].map(h => (
                    <th key={h} style={{ padding: '10px 16px', fontSize: '0.6875rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.07em', textAlign: 'left', borderBottom: '1px solid #F1F5F9', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {boards.map((board, i) => (
                  <tr
                    key={board.id}
                    className="row-hover fade"
                    style={{ borderBottom: i < boards.length - 1 ? '1px solid #F8FAFC' : 'none', transition: 'background 0.1s', animationDelay: `${i * 0.04}s`, background: '#fff' }}
                  >
                    <td style={{ padding: '13px 16px' }}>
                      <p style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0F172A', margin: '0 0 2px' }}>{board.name}</p>
                      {board.address && (
                        <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: 0, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{board.address}</p>
                      )}
                    </td>
                    <td style={{ padding: '13px 16px', fontSize: '0.8125rem', color: '#475569', whiteSpace: 'nowrap' }}>
                      {[board.city, board.state].filter(Boolean).join(', ') || '—'}
                    </td>
                    <td style={{ padding: '13px 16px' }}>
                      <span style={{ fontSize: '0.6875rem', fontWeight: 600, color: '#475569', background: '#F1F5F9', padding: '2px 7px', borderRadius: '4px' }}>
                        {FORMAT_LABELS[board.format] || board.format || '—'}
                      </span>
                    </td>
                    <td style={{ padding: '13px 16px', fontSize: '0.75rem', color: '#64748B', whiteSpace: 'nowrap' }}>
                      {board.width && board.height ? `${board.width}m × ${board.height}m` : '—'}
                    </td>
                    <td style={{ padding: '13px 16px', fontSize: '0.875rem', fontWeight: 700, color: '#0F172A', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
                      {formatNaira(board.asking_rate)}<span style={{ fontSize: '0.6875rem', fontWeight: 400, color: '#94A3B8' }}>/mo</span>
                    </td>
                    <td style={{ padding: '13px 16px' }}>
                      <BoardStatusPill status={board.status} />
                    </td>
                    <td style={{ padding: '13px 16px' }}>
                      <div className="row-actions" style={{ display: 'flex', gap: 4 }}>
                        <button
                          onClick={() => openEdit(board)}
                          title="Edit board"
                          style={{ background: '#F1F5F9', border: 'none', cursor: 'pointer', padding: '5px 8px', borderRadius: '6px', fontSize: '0.6875rem', fontWeight: 600, color: '#475569', fontFamily: 'inherit' }}
                        >
                          Edit
                        </button>
                        {board.status !== 'booked' && (
                          <button
                            onClick={() => toggleBoardStatus(board)}
                            title={board.status === 'available' ? 'Mark as maintenance' : 'Mark as available'}
                            style={{
                              background: board.status === 'available' ? '#FFFBEB' : '#ECFDF5',
                              color: board.status === 'available' ? '#92400E' : '#065F46',
                              border: 'none', cursor: 'pointer', padding: '5px 8px',
                              borderRadius: '6px', fontSize: '0.6875rem', fontWeight: 600, fontFamily: 'inherit',
                            }}
                          >
                            {board.status === 'available' ? 'Maintenance' : 'Available'}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── Bookings tab ── */}
      {activeTab === 'bookings' && (
        <div className="table-scroll" style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: '12px', overflow: 'hidden' }}>
          {bookings.length === 0 ? (
            <div style={{ padding: '4rem', textAlign: 'center' }}>
              <p style={{ fontSize: '0.875rem', color: '#94A3B8', margin: 0 }}>No bookings yet</p>
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#F8FAFC' }}>
                  {['Board', 'Campaign / Client', 'Rate', 'Flight dates', 'Artwork', 'Status'].map(h => (
                    <th key={h} style={{ padding: '10px 16px', fontSize: '0.6875rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.07em', textAlign: 'left', borderBottom: '1px solid #F1F5F9', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {bookings.map((booking, i) => {
                  const rate = booking.agreed_rate || booking.offered_rate;
                  const daysLeft = booking.end_date ? getDaysLeft(booking.end_date) : null;
                  return (
                    <tr key={booking.id} className="row-hover fade" style={{ borderBottom: i < bookings.length - 1 ? '1px solid #F8FAFC' : 'none', transition: 'background 0.1s', animationDelay: `${i * 0.04}s`, background: '#fff' }}>
                      <td style={{ padding: '13px 16px' }}>
                        <p style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0F172A', margin: '0 0 2px' }}>{booking.boards?.name || '—'}</p>
                        <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: 0 }}>{booking.boards?.city || '—'}</p>
                      </td>
                      <td style={{ padding: '13px 16px' }}>
                        <p style={{ fontSize: '0.8125rem', fontWeight: 500, color: '#0F172A', margin: '0 0 2px' }}>{booking.campaigns?.name || '—'}</p>
                        <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: 0 }}>{booking.campaigns?.client_name || '—'}</p>
                      </td>
                      <td style={{ padding: '13px 16px' }}>
                        <p style={{ fontSize: '0.875rem', fontWeight: 700, color: booking.agreed_rate ? '#10B981' : '#0F172A', margin: '0 0 2px', fontFamily: 'monospace' }}>
                          {formatNaira(rate)}<span style={{ fontSize: '0.6875rem', fontWeight: 400, color: '#94A3B8' }}>/mo</span>
                        </p>
                        {booking.agreed_rate && <p style={{ fontSize: '0.6875rem', color: '#10B981', margin: 0, fontWeight: 600 }}>Agreed</p>}
                      </td>
                      <td style={{ padding: '13px 16px' }}>
                        {booking.start_date && booking.end_date ? (
                          <>
                            <p style={{ fontSize: '0.75rem', color: '#475569', margin: '0 0 2px', whiteSpace: 'nowrap' }}>
                              {formatDateShort(booking.start_date)} → {formatDateShort(booking.end_date)}
                            </p>
                            {daysLeft !== null && (
                              <p style={{ fontSize: '0.6875rem', color: daysLeft < 7 && daysLeft > 0 ? '#EF4444' : '#94A3B8', margin: 0 }}>
                                {daysLeft > 0 ? `${daysLeft}d remaining` : daysLeft === 0 ? 'Ends today' : 'Expired'}
                              </p>
                            )}
                          </>
                        ) : '—'}
                      </td>
                      <td style={{ padding: '10px 16px' }}>
                        {(() => {
                          const cr = creativesByBooking[booking.id];
                          if (!cr) {
                            return <span style={{ fontSize: '0.6875rem', color: '#CBD5E1' }}>—</span>;
                          }
                          const statusLabel: Record<string, { label: string; color: string; bg: string }> = {
                            uploaded:          { label: 'Ready',    color: '#92400E', bg: '#FFFBEB' },
                            approved:          { label: 'Approved', color: '#065F46', bg: '#ECFDF5' },
                            changes_requested: { label: 'Revising', color: '#7F1D1D', bg: '#FEF2F2' },
                            printing:          { label: 'Printing', color: '#1E3A8A', bg: '#EFF6FF' },
                            live:              { label: 'Live',     color: '#065F46', bg: '#ECFDF5' },
                          };
                          const s = statusLabel[cr.status] || statusLabel.uploaded;
                          return (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                              <a
                                href={cr.file_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                title={cr.file_name}
                                style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#1B4F8A', textDecoration: 'none', background: '#EFF6FF', padding: '3px 8px', borderRadius: 5, display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}
                              >
                                ↓ Download
                              </a>
                              {cr.status === 'uploaded' && (
                                <button
                                  onClick={() => { setReviewingCreative({ bookingId: booking.id, fileUrl: cr.file_url, fileName: cr.file_name, creativeId: cr.id }); setReviewNote(''); }}
                                  style={{ fontSize: '0.625rem', fontWeight: 600, color: '#475569', background: '#F1F5F9', border: 'none', padding: '2px 6px', borderRadius: 4, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}
                                >
                                  Review
                                </button>
                              )}
                              {cr.status !== 'uploaded' && (
                                <span style={{ fontSize: '0.625rem', fontWeight: 700, color: s.color, background: s.bg, padding: '2px 6px', borderRadius: 4, display: 'inline-block' }}>{s.label}</span>
                              )}
                            </div>
                          );
                        })()}
                      </td>
                      <td style={{ padding: '13px 16px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <BookingPill status={booking.status} />
                          {['pending', 'negotiating'].includes(booking.status) && (
                            <a
                              href={`/dashboard/owner/negotiations/${booking.id}`}
                              style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#1B4F8A', textDecoration: 'none', background: '#EFF6FF', padding: '3px 8px', borderRadius: 5, whiteSpace: 'nowrap' }}
                            >
                              Respond →
                            </a>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr style={{ background: '#F8FAFC', borderTop: '2px solid #E8EDF2' }}>
                  <td colSpan={2} style={{ padding: '12px 16px', fontSize: '0.8125rem', fontWeight: 700, color: '#0F172A' }}>
                    Total active earnings / month
                  </td>
                  <td colSpan={3} style={{ padding: '12px 16px', fontFamily: 'monospace', fontSize: '1rem', fontWeight: 800, color: '#10B981' }}>
                    {formatNaira(monthlyEarnings)}
                  </td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      )}

      {/* ── Messages tab ── */}
      {activeTab === 'messages' && (
        <div style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: '12px', overflow: 'hidden' }}>
          {messages.length === 0 ? (
            <div style={{ padding: '4rem', textAlign: 'center' }}>
              <p style={{ fontSize: '0.875rem', color: '#94A3B8', margin: 0 }}>No messages yet</p>
              <p style={{ fontSize: '0.75rem', color: '#CBD5E1', margin: '4px 0 0' }}>Messages from agencies will appear here</p>
            </div>
          ) : messages.map((msg, i) => {
            const tc: Record<string, { bg: string; border: string; label: string; labelColor: string }> = {
              offer:         { bg: '#EFF6FF', border: '#BFDBFE', label: '💰 Offer',         labelColor: '#1E3A8A' },
              counter_offer: { bg: '#F5F3FF', border: '#DDD6FE', label: '🔄 Counter offer', labelColor: '#3730A3' },
              accepted:      { bg: '#ECFDF5', border: '#A7F3D0', label: '✅ Accepted',       labelColor: '#065F46' },
              declined:      { bg: '#FEF2F2', border: '#FECACA', label: '❌ Declined',       labelColor: '#7F1D1D' },
              message:       { bg: '#fff',    border: '#F1F5F9', label: '',                 labelColor: '' },
            };
            const cfg = tc[msg.message_type] || tc.message;
            return (
              <div key={msg.id} className="msg-row fade" style={{ padding: '14px 20px', borderBottom: i < messages.length - 1 ? '1px solid #F8FAFC' : 'none', background: cfg.bg, borderLeft: `3px solid ${cfg.border}`, transition: 'background 0.1s', animationDelay: `${i * 0.04}s` }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                      {cfg.label && <span style={{ fontSize: '0.6875rem', fontWeight: 700, color: cfg.labelColor }}>{cfg.label}</span>}
                      {msg.offered_rate && <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#0F172A', fontFamily: 'monospace' }}>{formatNaira(msg.offered_rate)}/mo</span>}
                    </div>
                    <p style={{ fontSize: '0.875rem', color: '#0F172A', margin: '0 0 4px', lineHeight: 1.5 }}>{msg.content}</p>
                    <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: 0 }}>
                      {msg.bookings?.boards?.name || '—'} · {new Date(msg.created_at).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' })}
                    </p>
                  </div>
                  <span style={{ fontSize: '0.6875rem', color: '#94A3B8', fontWeight: 500, flexShrink: 0 }}>Agency</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Calendar tab ── */}
      {activeTab === 'calendar' && (() => {
        const today = new Date();
        const year  = today.getFullYear();
        const month = today.getMonth(); // 0-indexed
        const firstDay = new Date(year, month, 1).getDay(); // 0=Sun
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const monthName = today.toLocaleDateString('en-NG', { month: 'long', year: 'numeric' });

        // Build a map: day → list of bookings active on that day
        const dayBookings: Record<number, Booking[]> = {};
        for (let d = 1; d <= daysInMonth; d++) {
          const date = new Date(year, month, d);
          dayBookings[d] = bookings.filter(b => {
            if (!b.start_date || !b.end_date) return false;
            const start = new Date(b.start_date);
            const end   = new Date(b.end_date);
            return date >= start && date <= end && !['declined'].includes(b.status);
          });
        }

        const STATUS_COLOR: Record<string, string> = {
          live: '#10B981', agreed: '#8B5CF6', signed: '#8B5CF6',
          pending: '#F59E0B', negotiating: '#3B82F6', completed: '#94A3B8',
        };

        return (
          <div>
            {/* Summary */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: '1.25rem' }}>
              {[
                { label: 'Boards booked this month', value: String(new Set(bookings.filter(b => dayBookings[today.getDate()]?.find(db => db.id === b.id)).map(b => b.board_id)).size), color: '#10B981', bg: '#ECFDF5' },
                { label: 'Active bookings today',    value: String(dayBookings[today.getDate()]?.length || 0),                                                                          color: '#1B4F8A', bg: '#EFF6FF' },
                { label: 'Pending responses',        value: String(pendingBookings.length),                                                                                             color: '#D97706', bg: '#FFFBEB' },
              ].map(s => (
                <div key={s.label} style={{ background: s.bg, borderRadius: 12, padding: '16px 18px' }}>
                  <p style={{ fontSize: '1.5rem', fontWeight: 800, color: s.color, fontFamily: 'monospace', margin: '0 0 4px' }}>{s.value}</p>
                  <p style={{ fontSize: '0.6875rem', fontWeight: 600, color: s.color, opacity: 0.8, margin: 0 }}>{s.label}</p>
                </div>
              ))}
            </div>

            {/* Calendar grid */}
            <div style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: 12, overflow: 'hidden' }}>
              <div style={{ padding: '14px 20px', borderBottom: '1px solid #F1F5F9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <h2 style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#0F172A', margin: 0 }}>{monthName}</h2>
                <div style={{ display: 'flex', gap: 12 }}>
                  {[
                    { color: '#10B981', label: 'Live' },
                    { color: '#8B5CF6', label: 'Agreed/Signed' },
                    { color: '#F59E0B', label: 'Pending' },
                    { color: '#3B82F6', label: 'Negotiating' },
                  ].map(l => (
                    <div key={l.label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <span style={{ width: 8, height: 8, borderRadius: 2, background: l.color, flexShrink: 0 }} />
                      <span style={{ fontSize: '0.6875rem', color: '#64748B' }}>{l.label}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ padding: '16px 20px' }}>
                {/* Day headers */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, marginBottom: 4 }}>
                  {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d => (
                    <div key={d} style={{ textAlign: 'center', fontSize: '0.6875rem', fontWeight: 700, color: '#94A3B8', padding: '4px 0' }}>{d}</div>
                  ))}
                </div>

                {/* Calendar cells */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
                  {/* Empty cells for first week offset */}
                  {Array.from({ length: firstDay }, (_, i) => (
                    <div key={`empty-${i}`} />
                  ))}
                  {/* Day cells */}
                  {Array.from({ length: daysInMonth }, (_, i) => {
                    const day = i + 1;
                    const isToday = day === today.getDate();
                    const dayBks = dayBookings[day] || [];
                    const hasActive = dayBks.some(b => ['live','agreed','signed'].includes(b.status));
                    const hasPending = dayBks.some(b => ['pending','negotiating'].includes(b.status));
                    return (
                      <div key={day} style={{ minHeight: 72, padding: '6px', borderRadius: 8, background: isToday ? '#EFF6FF' : dayBks.length > 0 ? '#FAFBFF' : '#fff', border: `1px solid ${isToday ? '#BFDBFE' : '#F1F5F9'}`, position: 'relative' }}>
                        <p style={{ fontSize: '0.75rem', fontWeight: isToday ? 800 : 500, color: isToday ? '#1B4F8A' : '#374151', margin: '0 0 4px' }}>{day}</p>
                        {/* Booking dots */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          {dayBks.slice(0, 3).map((b, bi) => (
                            <div key={bi} style={{ height: 5, borderRadius: 2, background: STATUS_COLOR[b.status] || '#94A3B8', opacity: 0.85 }} />
                          ))}
                          {dayBks.length > 3 && <p style={{ fontSize: '0.5625rem', color: '#94A3B8', margin: 0 }}>+{dayBks.length - 3}</p>}
                        </div>
                        {hasPending && !hasActive && (
                          <div style={{ position: 'absolute', top: 4, right: 4, width: 6, height: 6, borderRadius: '50%', background: '#F59E0B' }} />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Upcoming bookings timeline */}
            <div style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: 12, overflow: 'hidden', marginTop: '1.25rem' }}>
              <div style={{ padding: '14px 20px', borderBottom: '1px solid #F1F5F9' }}>
                <h2 style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#0F172A', margin: '0 0 2px' }}>Upcoming & active bookings</h2>
                <p style={{ fontSize: '0.75rem', color: '#94A3B8', margin: 0 }}>Bookings active in the next 30 days</p>
              </div>
              {(() => {
                const upcoming = bookings.filter(b => {
                  if (!b.start_date || !b.end_date) return false;
                  const end = new Date(b.end_date);
                  const future = new Date(); future.setDate(future.getDate() + 30);
                  return end >= today && new Date(b.start_date) <= future && !['declined'].includes(b.status);
                }).sort((a, b) => new Date(a.start_date).getTime() - new Date(b.start_date).getTime());

                if (upcoming.length === 0) return (
                  <div style={{ padding: '2.5rem', textAlign: 'center' }}>
                    <p style={{ fontSize: '0.875rem', color: '#94A3B8', margin: 0 }}>No upcoming bookings in the next 30 days</p>
                  </div>
                );

                return upcoming.map((b, i) => {
                  const start = new Date(b.start_date);
                  const end = new Date(b.end_date);
                  const totalDays = Math.ceil((end.getTime() - start.getTime()) / (1000*60*60*24));
                  const elapsed = Math.max(0, Math.ceil((today.getTime() - start.getTime()) / (1000*60*60*24)));
                  const progress = Math.min(100, Math.round((elapsed / totalDays) * 100));
                  return (
                    <div key={b.id} style={{ padding: '14px 20px', borderBottom: i < upcoming.length - 1 ? '1px solid #F8FAFC' : 'none' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                        <div>
                          <span style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0F172A' }}>{b.boards?.name || '—'}</span>
                          <span style={{ fontSize: '0.75rem', color: '#94A3B8', marginLeft: 8 }}>{b.boards?.city || ''}</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: '0.75rem', color: '#94A3B8', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
                            {formatDateShort(b.start_date)} → {formatDateShort(b.end_date)}
                          </span>
                          <BookingPill status={b.status} />
                          {['pending','negotiating'].includes(b.status) && (
                            <a href={`/dashboard/owner/negotiations/${b.id}`} style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#1B4F8A', textDecoration: 'none', background: '#EFF6FF', padding: '3px 8px', borderRadius: 5 }}>
                              Respond →
                            </a>
                          )}
                        </div>
                      </div>
                      {['live','agreed','signed'].includes(b.status) && (
                        <div>
                          <div style={{ height: 5, background: '#F1F5F9', borderRadius: 999, overflow: 'hidden' }}>
                            <div style={{ height: '100%', borderRadius: 999, background: STATUS_COLOR[b.status] || '#10B981', width: `${progress}%`, transition: 'width 0.6s' }} />
                          </div>
                          <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: '3px 0 0' }}>{progress}% of booking period elapsed</p>
                        </div>
                      )}
                    </div>
                  );
                });
              })()}
            </div>
          </div>
        );
      })()}

      {/* ── Earnings tab ── */}
      {activeTab === 'earnings' && (() => {
        const agreedBookings = bookings.filter(b => b.agreed_rate && ['agreed', 'signed', 'live', 'completed'].includes(b.status));
        const totalValue = agreedBookings.reduce((s, b) => s + (b.agreed_rate || 0) * (b.duration_months || 1), 0);
        const avgRate = agreedBookings.length > 0 ? Math.round(agreedBookings.reduce((s, b) => s + (b.agreed_rate || 0), 0) / agreedBookings.length) : 0;

        // Per-board revenue map
        const boardRevMap: Record<string, { name: string; city: string; format: string; total: number; count: number; current: number }> = {};
        agreedBookings.forEach(b => {
          if (!boardRevMap[b.board_id]) {
            boardRevMap[b.board_id] = { name: b.boards?.name || '—', city: b.boards?.city || '', format: b.boards?.format || '', total: 0, count: 0, current: 0 };
          }
          boardRevMap[b.board_id].total += (b.agreed_rate || 0) * (b.duration_months || 1);
          boardRevMap[b.board_id].count += 1;
          if (['agreed', 'signed', 'live'].includes(b.status)) {
            boardRevMap[b.board_id].current += b.agreed_rate || 0;
          }
        });
        const boardRevList = Object.values(boardRevMap).sort((a, b) => b.total - a.total);
        const maxTotal = boardRevList[0]?.total || 1;

        return (
          <div>
            {/* Summary cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: '1.5rem' }}>
              {[
                { label: 'Monthly Revenue', value: formatNaira(monthlyEarnings), color: '#10B981', sub: `${activeBookings.length} active booking${activeBookings.length !== 1 ? 's' : ''}` },
                { label: 'Total Portfolio Value', value: formatNaira(totalValue), color: '#7C3AED', sub: 'Across all agreed bookings' },
                { label: 'Avg Rate / Board', value: formatNaira(avgRate), color: '#1B4F8A', sub: 'Per month (agreed only)' },
              ].map(card => (
                <div key={card.label} style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: 12, padding: '18px 20px' }}>
                  <p style={{ fontSize: '0.6875rem', fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.07em', margin: '0 0 8px' }}>{card.label}</p>
                  <p style={{ fontSize: '1.875rem', fontWeight: 700, color: card.color, letterSpacing: '-0.03em', margin: '0 0 4px', fontFamily: 'monospace' }}>{card.value}</p>
                  <p style={{ fontSize: '0.6875rem', color: '#CBD5E1', margin: 0 }}>{card.sub}</p>
                </div>
              ))}
            </div>

            {/* Board performance */}
            <div style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: 12, overflow: 'hidden', marginBottom: '1.25rem' }}>
              <div style={{ padding: '14px 20px', borderBottom: '1px solid #F1F5F9' }}>
                <h2 style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#0F172A', margin: '0 0 2px' }}>Board performance</h2>
                <p style={{ fontSize: '0.75rem', color: '#94A3B8', margin: 0 }}>Revenue contribution per board</p>
              </div>
              {boardRevList.length === 0 ? (
                <div style={{ padding: '3rem', textAlign: 'center' }}>
                  <p style={{ fontSize: '0.875rem', color: '#94A3B8', margin: 0 }}>No agreed bookings yet</p>
                  <p style={{ fontSize: '0.75rem', color: '#CBD5E1', margin: '4px 0 0' }}>Earnings will appear once agencies agree on rates</p>
                </div>
              ) : boardRevList.map((board, i) => (
                <div key={i} style={{ padding: '14px 20px', borderBottom: i < boardRevList.length - 1 ? '1px solid #F8FAFC' : 'none' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <div>
                      <span style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0F172A' }}>{board.name}</span>
                      <span style={{ fontSize: '0.75rem', color: '#94A3B8', marginLeft: 8 }}>{board.city}</span>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <span style={{ fontSize: '0.875rem', fontWeight: 700, color: '#0F172A', fontFamily: 'monospace' }}>{formatNaira(board.total)}</span>
                      {board.current > 0 && (
                        <span style={{ fontSize: '0.6875rem', color: '#10B981', fontWeight: 600, marginLeft: 8 }}>+{formatNaira(board.current)}/mo</span>
                      )}
                    </div>
                  </div>
                  <div style={{ height: 6, background: '#F1F5F9', borderRadius: 999, overflow: 'hidden' }}>
                    <div style={{ height: '100%', borderRadius: 999, background: '#7C3AED', width: `${Math.round((board.total / maxTotal) * 100)}%`, transition: 'width 0.6s ease' }} />
                  </div>
                  <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: '4px 0 0' }}>{board.count} booking{board.count !== 1 ? 's' : ''}</p>
                </div>
              ))}
            </div>

            {/* Booking history */}
            <div style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: 12, overflow: 'hidden' }}>
              <div style={{ padding: '14px 20px', borderBottom: '1px solid #F1F5F9' }}>
                <h2 style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#0F172A', margin: '0 0 2px' }}>Booking history</h2>
                <p style={{ fontSize: '0.75rem', color: '#94A3B8', margin: 0 }}>All agreed deals</p>
              </div>
              {agreedBookings.length === 0 ? (
                <div style={{ padding: '3rem', textAlign: 'center' }}>
                  <p style={{ fontSize: '0.875rem', color: '#94A3B8', margin: 0 }}>No earnings data yet</p>
                </div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: '#F8FAFC' }}>
                      {['Board', 'Campaign', 'Monthly rate', 'Duration', 'Total value', 'Status', 'Invoice'].map(h => (
                        <th key={h} style={{ padding: '10px 16px', fontSize: '0.6875rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.07em', textAlign: 'left', borderBottom: '1px solid #F1F5F9', whiteSpace: 'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {agreedBookings.map((b, i) => (
                      <tr key={b.id} className="row-hover fade" style={{ borderBottom: i < agreedBookings.length - 1 ? '1px solid #F8FAFC' : 'none', background: '#fff', animationDelay: `${i * 0.04}s` }}>
                        <td style={{ padding: '12px 16px' }}>
                          <p style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0F172A', margin: '0 0 2px' }}>{b.boards?.name || '—'}</p>
                          <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: 0 }}>{b.boards?.city || ''}</p>
                        </td>
                        <td style={{ padding: '12px 16px', fontSize: '0.8125rem', color: '#475569' }}>
                          {b.campaigns?.name || '—'}
                        </td>
                        <td style={{ padding: '12px 16px', fontFamily: 'monospace', fontSize: '0.875rem', fontWeight: 700, color: '#10B981', whiteSpace: 'nowrap' }}>
                          {formatNaira(b.agreed_rate)}<span style={{ fontSize: '0.6875rem', fontWeight: 400, color: '#94A3B8' }}>/mo</span>
                        </td>
                        <td style={{ padding: '12px 16px', fontSize: '0.8125rem', color: '#475569', whiteSpace: 'nowrap' }}>
                          {b.duration_months ? `${b.duration_months} mo` : b.start_date && b.end_date ? `${formatDate(b.start_date)} → ${formatDate(b.end_date)}` : '—'}
                        </td>
                        <td style={{ padding: '12px 16px', fontFamily: 'monospace', fontSize: '0.875rem', fontWeight: 700, color: '#0F172A', whiteSpace: 'nowrap' }}>
                          {formatNaira((b.agreed_rate || 0) * (b.duration_months || 1))}
                        </td>
                        <td style={{ padding: '12px 16px' }}>
                          <BookingPill status={b.status} />
                        </td>
                        <td style={{ padding: '10px 16px' }}>
                          <DownloadInvoice bookingId={b.id} type="owner" variant="inline" label="PDF" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ background: '#F8FAFC', borderTop: '2px solid #E8EDF2' }}>
                      <td colSpan={4} style={{ padding: '12px 16px', fontSize: '0.8125rem', fontWeight: 700, color: '#0F172A' }}>Total portfolio value</td>
                      <td colSpan={3} style={{ padding: '12px 16px', fontFamily: 'monospace', fontSize: '1rem', fontWeight: 800, color: '#7C3AED' }}>{formatNaira(totalValue)}</td>
                    </tr>
                  </tfoot>
                </table>
              )}
            </div>
          </div>
        );
      })()}

      {/* ── Analytics tab ── */}
      {activeTab === 'analytics' && (() => {
        // ── Monthly revenue (last 6 months) ──────────────────────────────
        const now = new Date();
        const months = Array.from({ length: 6 }, (_, i) => {
          const d = new Date(now.getFullYear(), now.getMonth() - 5 + i, 1);
          return { year: d.getFullYear(), month: d.getMonth(), label: d.toLocaleDateString('en-NG', { month: 'short', year: '2-digit' }) };
        });
        const monthRevenue = months.map(m => {
          const total = bookings
            .filter(b => {
              if (!['agreed','signed','live','completed'].includes(b.status)) return false;
              const created = new Date(b.created_at);
              return created.getFullYear() === m.year && created.getMonth() === m.month;
            })
            .reduce((s, b) => s + (b.agreed_rate || b.offered_rate || 0) * (b.duration_months || 1), 0);
          return { ...m, total };
        });
        const maxMonthRev = Math.max(...monthRevenue.map(m => m.total), 1);

        // ── Board utilization ─────────────────────────────────────────────
        const boardUtil = boards.map(board => {
          const bks = bookings.filter(bk => bk.board_id === board.id && !['declined'].includes(bk.status));
          const activeBks = bks.filter(bk => ['agreed','signed','live'].includes(bk.status));
          const pendingBks = bks.filter(bk => ['pending','negotiating'].includes(bk.status));
          const totalEarned = bks.filter(bk => ['agreed','signed','live','completed'].includes(bk.status))
            .reduce((s, bk) => s + (bk.agreed_rate || 0) * (bk.duration_months || 1), 0);
          const pendingValue = pendingBks.reduce((s, bk) => s + (bk.offered_rate || 0), 0);
          // Occupancy: estimate based on booked months vs 12 months assumed potential
          const bookedMonths = bks
            .filter(bk => ['agreed','signed','live','completed'].includes(bk.status))
            .reduce((s, bk) => s + (bk.duration_months || 1), 0);
          const occupancy = Math.min(100, Math.round((bookedMonths / 12) * 100));
          return { board, bks: bks.length, activeBks: activeBks.length, pendingBks: pendingBks.length, totalEarned, pendingValue, occupancy };
        }).sort((a, b) => b.totalEarned - a.totalEarned);

        // ── Pipeline funnel ───────────────────────────────────────────────
        const pipeline = [
          { label: 'Pending',     status: ['pending'],           color: '#F59E0B', bg: '#FFFBEB' },
          { label: 'Negotiating', status: ['negotiating'],        color: '#3B82F6', bg: '#EFF6FF' },
          { label: 'Agreed',      status: ['agreed','signed'],    color: '#7C3AED', bg: '#F5F3FF' },
          { label: 'Live',        status: ['live'],               color: '#10B981', bg: '#ECFDF5' },
          { label: 'Completed',   status: ['completed'],          color: '#1B4F8A', bg: '#EFF6FF' },
        ].map(stage => ({
          ...stage,
          count: bookings.filter(b => stage.status.includes(b.status)).length,
          value: bookings.filter(b => stage.status.includes(b.status)).reduce((s, b) => s + (b.agreed_rate || b.offered_rate || 0), 0),
        }));

        const totalPipeline = pipeline.reduce((s, p) => s + p.value, 0);

        return (
          <div>
            {/* ── Monthly revenue chart ── */}
            <div style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: 12, padding: '20px', marginBottom: '1.25rem' }}>
              <div style={{ marginBottom: 16 }}>
                <h2 style={{ fontSize: '0.9375rem', fontWeight: 700, color: '#0F172A', margin: '0 0 2px' }}>Revenue trend</h2>
                <p style={{ fontSize: '0.75rem', color: '#94A3B8', margin: 0 }}>Monthly revenue from agreed bookings · last 6 months</p>
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, height: 120 }}>
                {monthRevenue.map((m, i) => {
                  const pct = maxMonthRev > 0 ? Math.max(4, Math.round((m.total / maxMonthRev) * 100)) : 4;
                  const isCurrentMonth = m.year === now.getFullYear() && m.month === now.getMonth();
                  return (
                    <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                      <p style={{ fontSize: '0.5625rem', fontWeight: 700, color: m.total > 0 ? '#7C3AED' : '#E2E8F0', margin: 0, fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
                        {m.total > 0 ? (m.total >= 1_000_000 ? '₦'+(m.total/1_000_000).toFixed(1)+'M' : '₦'+(m.total/1000).toFixed(0)+'K') : '—'}
                      </p>
                      <div style={{ width: '100%', position: 'relative', height: 80, display: 'flex', alignItems: 'flex-end' }}>
                        <div style={{
                          width: '100%', height: `${pct}%`, borderRadius: '4px 4px 0 0',
                          background: m.total > 0 ? (isCurrentMonth ? '#7C3AED' : 'rgba(124,58,237,0.35)') : '#F1F5F9',
                          transition: 'height 0.6s ease',
                        }} />
                      </div>
                      <p style={{ fontSize: '0.625rem', color: isCurrentMonth ? '#7C3AED' : '#94A3B8', fontWeight: isCurrentMonth ? 700 : 400, margin: 0 }}>{m.label}</p>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* ── Pipeline funnel ── */}
            <div style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: 12, padding: '20px', marginBottom: '1.25rem' }}>
              <div style={{ marginBottom: 14 }}>
                <h2 style={{ fontSize: '0.9375rem', fontWeight: 700, color: '#0F172A', margin: '0 0 2px' }}>Booking pipeline</h2>
                <p style={{ fontSize: '0.75rem', color: '#94A3B8', margin: 0 }}>All bookings by stage · {formatNaira(totalPipeline)} total pipeline value</p>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8 }}>
                {pipeline.map(stage => (
                  <div key={stage.label} style={{ background: stage.bg, borderRadius: 10, padding: '14px 12px', textAlign: 'center' }}>
                    <p style={{ fontSize: '1.75rem', fontWeight: 800, color: stage.color, margin: '0 0 2px', fontFamily: 'monospace', letterSpacing: '-0.02em' }}>{stage.count}</p>
                    <p style={{ fontSize: '0.6875rem', fontWeight: 700, color: stage.color, margin: '0 0 4px' }}>{stage.label}</p>
                    {stage.value > 0 && (
                      <p style={{ fontSize: '0.5625rem', color: stage.color, opacity: 0.7, margin: 0, fontFamily: 'monospace' }}>{formatNaira(stage.value)}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* ── Board utilization ── */}
            <div style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: 12, overflow: 'hidden' }}>
              <div style={{ padding: '16px 20px', borderBottom: '1px solid #F1F5F9' }}>
                <h2 style={{ fontSize: '0.9375rem', fontWeight: 700, color: '#0F172A', margin: '0 0 2px' }}>Board performance</h2>
                <p style={{ fontSize: '0.75rem', color: '#94A3B8', margin: 0 }}>Utilisation rate, pipeline and earned revenue per board</p>
              </div>
              {boardUtil.length === 0 ? (
                <div style={{ padding: '3rem', textAlign: 'center' }}>
                  <p style={{ fontSize: '0.875rem', color: '#94A3B8', margin: 0 }}>No boards listed yet</p>
                </div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: '#F8FAFC' }}>
                      {['Board', 'Utilisation', 'Active bookings', 'Pipeline', 'Total earned'].map(h => (
                        <th key={h} style={{ padding: '10px 16px', fontSize: '0.6875rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.07em', textAlign: 'left', borderBottom: '1px solid #F1F5F9', whiteSpace: 'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {boardUtil.map((row, i) => (
                      <tr key={row.board.id} style={{ borderBottom: i < boardUtil.length - 1 ? '1px solid #F8FAFC' : 'none', background: '#fff' }}>
                        <td style={{ padding: '12px 16px' }}>
                          <p style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0F172A', margin: '0 0 2px' }}>{row.board.name}</p>
                          <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: 0 }}>{row.board.city} · {row.board.format}</p>
                        </td>
                        <td style={{ padding: '12px 16px', minWidth: 130 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div style={{ flex: 1, height: 6, background: '#F1F5F9', borderRadius: 3, overflow: 'hidden' }}>
                              <div style={{ height: '100%', borderRadius: 3, background: row.occupancy >= 70 ? '#10B981' : row.occupancy >= 40 ? '#F59E0B' : '#E2E8F0', width: `${row.occupancy}%`, transition: 'width 0.6s ease' }} />
                            </div>
                            <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#0F172A', fontFamily: 'monospace', flexShrink: 0 }}>{row.occupancy}%</span>
                          </div>
                        </td>
                        <td style={{ padding: '12px 16px', fontSize: '0.875rem', color: '#0F172A', fontWeight: row.activeBks > 0 ? 700 : 400 }}>
                          {row.activeBks > 0
                            ? <span style={{ color: '#10B981' }}>{row.activeBks} live</span>
                            : <span style={{ color: '#CBD5E1' }}>—</span>
                          }
                          {row.pendingBks > 0 && <span style={{ fontSize: '0.75rem', color: '#F59E0B', fontWeight: 600, marginLeft: 6 }}>+{row.pendingBks} pending</span>}
                        </td>
                        <td style={{ padding: '12px 16px', fontFamily: 'monospace', fontSize: '0.875rem', color: row.pendingValue > 0 ? '#F59E0B' : '#CBD5E1', fontWeight: row.pendingValue > 0 ? 700 : 400 }}>
                          {row.pendingValue > 0 ? formatNaira(row.pendingValue) : '—'}
                        </td>
                        <td style={{ padding: '12px 16px', fontFamily: 'monospace', fontSize: '0.875rem', fontWeight: 700, color: row.totalEarned > 0 ? '#7C3AED' : '#CBD5E1' }}>
                          {row.totalEarned > 0 ? formatNaira(row.totalEarned) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  {boardUtil.some(r => r.totalEarned > 0) && (
                    <tfoot>
                      <tr style={{ background: '#F8FAFC', borderTop: '2px solid #E8EDF2' }}>
                        <td colSpan={4} style={{ padding: '12px 16px', fontSize: '0.8125rem', fontWeight: 700, color: '#0F172A' }}>Total earned (all boards)</td>
                        <td style={{ padding: '12px 16px', fontFamily: 'monospace', fontSize: '1rem', fontWeight: 800, color: '#7C3AED' }}>
                          {formatNaira(boardUtil.reduce((s, r) => s + r.totalEarned, 0))}
                        </td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              )}
            </div>
          </div>
        );
      })()}

      {/* ── Add / Edit board slide-in panel ── */}
      {showPanel && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', justifyContent: 'flex-end' }}>
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.4)' }} onClick={() => setShowPanel(false)} />
          <div style={{ position: 'relative', width: 520, background: '#fff', height: '100%', boxShadow: '-8px 0 32px rgba(0,0,0,0.12)', display: 'flex', flexDirection: 'column', fontFamily: 'inherit', overflowY: 'auto' }}>

            {/* Panel header */}
            <div style={{ padding: '20px 24px', borderBottom: '1px solid #F1F5F9', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, background: '#fff', zIndex: 1 }}>
              <div>
                <h2 style={{ fontSize: '1rem', fontWeight: 700, color: '#0F172A', margin: '0 0 2px' }}>
                  {editingBoard ? 'Edit board' : 'List a new board'}
                </h2>
                <p style={{ fontSize: '0.75rem', color: '#94A3B8', margin: 0 }}>
                  {editingBoard ? 'Update your board details' : 'Add a board to make it bookable by agencies'}
                </p>
              </div>
              <button onClick={() => setShowPanel(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8', fontSize: '1.125rem', display: 'flex', padding: 4 }}>✕</button>
            </div>

            {/* Form */}
            <div style={{ padding: '20px 24px', flex: 1 }}>
              {/* Basic info */}
              <p style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.07em', margin: '0 0 12px' }}>Basic info</p>

              <div style={{ marginBottom: 14 }}>
                <FieldLabel>Board name *</FieldLabel>
                <FieldInput value={form.name} onChange={v => setForm(f => ({ ...f, name: v }))} placeholder="e.g. Lagos-Ikeja Bridge Unipole A" required />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
                <div>
                  <FieldLabel>Format *</FieldLabel>
                  <select
                    value={form.format}
                    onChange={e => setForm(f => ({ ...f, format: e.target.value }))}
                    style={{ width: '100%', padding: '8px 10px', border: '1px solid #E2E8F0', borderRadius: '7px', fontSize: '0.875rem', outline: 'none', background: '#fff', fontFamily: 'inherit', boxSizing: 'border-box' as const }}
                  >
                    {FORMAT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div>
                  <FieldLabel>Number of faces</FieldLabel>
                  <select
                    value={form.face_count}
                    onChange={e => setForm(f => ({ ...f, face_count: e.target.value }))}
                    style={{ width: '100%', padding: '8px 10px', border: '1px solid #E2E8F0', borderRadius: '7px', fontSize: '0.875rem', outline: 'none', background: '#fff', fontFamily: 'inherit', boxSizing: 'border-box' as const }}
                  >
                    {[1,2,3,4].map(n => <option key={n} value={n}>{n} face{n > 1 ? 's' : ''}</option>)}
                  </select>
                </div>
              </div>

              <div style={{ marginBottom: 14 }}>
                <FieldLabel>Street address</FieldLabel>
                <FieldInput value={form.address} onChange={v => setForm(f => ({ ...f, address: v }))} placeholder="e.g. Along Airport Road, Ikeja" />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
                <div>
                  <FieldLabel>City *</FieldLabel>
                  <FieldInput value={form.city} onChange={v => setForm(f => ({ ...f, city: v }))} placeholder="e.g. Lagos" required />
                </div>
                <div>
                  <FieldLabel>State</FieldLabel>
                  <select
                    value={form.state}
                    onChange={e => setForm(f => ({ ...f, state: e.target.value }))}
                    style={{ width: '100%', padding: '8px 10px', border: '1px solid #E2E8F0', borderRadius: '7px', fontSize: '0.875rem', outline: 'none', background: '#fff', fontFamily: 'inherit', boxSizing: 'border-box' as const }}
                  >
                    <option value="">Select state...</option>
                    {NIGERIA_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>

              {/* Dimensions + rate */}
              <p style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.07em', margin: '20px 0 12px' }}>Dimensions & pricing</p>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 14 }}>
                <div>
                  <FieldLabel>Width (m)</FieldLabel>
                  <FieldInput type="number" value={form.width} onChange={v => setForm(f => ({ ...f, width: v }))} placeholder="e.g. 12" />
                </div>
                <div>
                  <FieldLabel>Height (m)</FieldLabel>
                  <FieldInput type="number" value={form.height} onChange={v => setForm(f => ({ ...f, height: v }))} placeholder="e.g. 4" />
                </div>
                <div>
                  <FieldLabel>Asking rate (₦/month) *</FieldLabel>
                  <FieldInput type="number" value={form.asking_rate} onChange={v => setForm(f => ({ ...f, asking_rate: v }))} placeholder="e.g. 450000" required />
                </div>
              </div>

              {form.asking_rate && (
                <div style={{ background: '#F5F3FF', borderRadius: 7, padding: '8px 12px', marginBottom: 14 }}>
                  <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#3730A3' }}>
                    Asking rate: {formatNaira(parseFloat(form.asking_rate))}/month
                    {form.width && form.height ? ` · ${form.width}m × ${form.height}m` : ''}
                  </span>
                </div>
              )}

              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
                <input
                  type="checkbox" id="illuminated"
                  checked={form.illuminated}
                  onChange={e => setForm(f => ({ ...f, illuminated: e.target.checked }))}
                  style={{ width: 14, height: 14, cursor: 'pointer', accentColor: '#7C3AED' }}
                />
                <label htmlFor="illuminated" style={{ fontSize: '0.875rem', color: '#374151', cursor: 'pointer' }}>
                  Illuminated (backlit / LED)
                </label>
              </div>

              {/* Location */}
              <p style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.07em', margin: '0 0 12px' }}>GPS coordinates <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(optional — needed for map visibility)</span></p>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 8 }}>
                <div>
                  <FieldLabel>Latitude</FieldLabel>
                  <FieldInput type="number" value={form.latitude} onChange={v => setForm(f => ({ ...f, latitude: v }))} placeholder="e.g. 6.5244" />
                </div>
                <div>
                  <FieldLabel>Longitude</FieldLabel>
                  <FieldInput type="number" value={form.longitude} onChange={v => setForm(f => ({ ...f, longitude: v }))} placeholder="e.g. 3.3792" />
                </div>
              </div>
              <p style={{ fontSize: '0.75rem', color: '#94A3B8', margin: '0 0 24px' }}>
                Open Google Maps, right-click your board location, and copy the coordinates.
              </p>

              <button
                onClick={saveBoard}
                disabled={saving || !form.name || !form.city || !form.asking_rate}
                style={{
                  width: '100%', padding: '12px',
                  background: saving || !form.name || !form.city || !form.asking_rate ? '#94A3B8' : '#7C3AED',
                  color: '#fff', border: 'none', borderRadius: '8px',
                  fontSize: '0.875rem', fontWeight: 600,
                  cursor: saving || !form.name || !form.city || !form.asking_rate ? 'not-allowed' : 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                {saving ? 'Saving...' : editingBoard ? 'Save changes' : 'Add board to inventory'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Artwork review modal */}
      {reviewingCreative && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(15,23,42,0.5)', backdropFilter: 'blur(2px)' }} onClick={() => setReviewingCreative(null)} />
          <div style={{ position: 'relative', width: '100%', maxWidth: 440, background: '#fff', borderRadius: 16, boxShadow: '0 24px 48px rgba(0,0,0,0.15)', padding: 28, fontFamily: 'inherit' }}>
            <div style={{ marginBottom: 20 }}>
              <h2 style={{ fontSize: '1rem', fontWeight: 700, color: '#0F172A', margin: '0 0 4px' }}>Review artwork</h2>
              <p style={{ fontSize: '0.75rem', color: '#94A3B8', margin: 0 }}>{reviewingCreative.fileName}</p>
            </div>
            <a
              href={reviewingCreative.fileUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', background: '#EFF6FF', borderRadius: 8, color: '#1B4F8A', textDecoration: 'none', fontSize: '0.8125rem', fontWeight: 600, marginBottom: 16 }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              Download artwork file
            </a>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#475569', marginBottom: 6 }}>
                Note to agency (required if requesting changes)
              </label>
              <textarea
                value={reviewNote}
                onChange={e => setReviewNote(e.target.value)}
                placeholder="e.g. Bleed is missing, logo is cut off on the right side…"
                rows={3}
                style={{ width: '100%', padding: '9px 12px', border: '1.5px solid #E2E8F0', borderRadius: 8, fontSize: '0.8125rem', fontFamily: 'inherit', resize: 'vertical', outline: 'none', boxSizing: 'border-box', color: '#0F172A' }}
              />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <button
                disabled={reviewSaving}
                onClick={async () => {
                  setReviewSaving(true);
                  await supabase.from('creative_uploads').update({ status: 'changes_requested', notes: reviewNote || null }).eq('id', reviewingCreative.creativeId);
                  setCreativesByBooking(prev => ({ ...prev, [reviewingCreative.bookingId]: { ...prev[reviewingCreative.bookingId], status: 'changes_requested', notes: reviewNote || null } }));
                  setReviewSaving(false);
                  setReviewingCreative(null);
                  showToast('Change request sent to agency');
                }}
                style={{ padding: '10px', background: '#fff', color: '#DC2626', border: '1.5px solid #FECACA', borderRadius: 9, fontSize: '0.8125rem', fontWeight: 700, cursor: reviewSaving ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}
              >
                Request changes
              </button>
              <button
                disabled={reviewSaving}
                onClick={async () => {
                  setReviewSaving(true);
                  await supabase.from('creative_uploads').update({ status: 'approved', reviewed_at: new Date().toISOString() }).eq('id', reviewingCreative.creativeId);
                  setCreativesByBooking(prev => ({ ...prev, [reviewingCreative.bookingId]: { ...prev[reviewingCreative.bookingId], status: 'approved' } }));
                  setReviewSaving(false);
                  setReviewingCreative(null);
                  showToast('Artwork approved — ready for print!');
                }}
                style={{ padding: '10px', background: '#10B981', color: '#fff', border: 'none', borderRadius: 9, fontSize: '0.8125rem', fontWeight: 700, cursor: reviewSaving ? 'not-allowed' : 'pointer', fontFamily: 'inherit', boxShadow: '0 2px 8px rgba(16,185,129,0.3)' }}
              >
                {reviewSaving ? '…' : '✓ Approve for print'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Rate Card tab ── */}
      {activeTab === 'rate-card' && (
        <RateCardTab boards={boards} formatNaira={formatNaira} onSave={() => showToast('Rate card saved')} />
      )}

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '12px 18px', borderRadius: '10px',
          background: toast.type === 'success' ? '#0F172A' : '#7F1D1D',
          color: '#F8FAFC', fontSize: '0.8125rem', fontWeight: 500,
          boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
          animation: 'fadeUp 0.25s ease',
          fontFamily: 'inherit',
        }}>
          <span>{toast.type === 'success' ? '✓' : '✕'}</span>
          <span>{toast.msg}</span>
        </div>
      )}
    </div>
  );
}

// ── Page export ────────────────────────────────────────────────────────────

export default function OwnerDashboardPage() {
  return (
    <RoleGuard role="owner">
      <OwnerContent />
    </RoleGuard>
  );
}
