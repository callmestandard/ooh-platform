'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { supabase } from '@/lib/supabase';

const CampaignMap = dynamic(() => import('./CampaignMap'), {
  ssr: false,
  loading: () => (
    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#F8FAFC', flexDirection: 'column', gap: 12 }}>
      <div style={{ width: 28, height: 28, border: '3px solid #E2E8F0', borderTopColor: '#22C55E', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
      <span style={{ fontSize: '0.875rem', color: '#94A3B8' }}>Loading map…</span>
    </div>
  ),
});

// ── Types ──────────────────────────────────────────────────────────────────────

type Board = {
  id: string;
  name: string;
  address: string;
  city: string;
  state: string;
  format: string;
  asking_rate: number;
  width: number | null;
  height: number | null;
  illuminated: boolean;
  face_count: number;
  latitude: number;
  longitude: number;
  owner_id: string;
  photo_urls: string[] | null;
};

type SubmitResult = {
  campaignId: string;
  boardCount: number;
  ownerCount: number;
};

// ── Constants ─────────────────────────────────────────────────────────────────

const BUDGET_PILLS = [1_000_000, 3_000_000, 5_000_000, 10_000_000, 20_000_000, 50_000_000];
const TOP_CITIES   = ['Lagos', 'Abuja', 'Port Harcourt', 'Ibadan', 'Kano', 'Enugu'];
const MORE_CITIES  = [
  'Warri', 'Kaduna', 'Benin City', 'Onitsha', 'Aba', 'Jos', 'Ilorin',
  'Uyo', 'Calabar', 'Abeokuta', 'Owerri', 'Asaba',
  'Victoria Island', 'Lekki', 'Ikeja', 'Surulere', 'Wuse', 'Maitama',
];
const DURATION_OPTIONS = [1, 3, 6, 12];

const FORMAT_LABELS: Record<string, string> = {
  billboard: 'Billboard', unipole: 'Unipole', gantry: 'Gantry',
  bridge_panel: 'Bridge Panel', wall_drape: 'Wall Drape', digital: 'LED/Digital', led: 'LED',
};

const FORMAT_COLORS: Record<string, { bg: string; text: string }> = {
  billboard:    { bg: '#EFF6FF', text: '#1D4ED8' },
  unipole:      { bg: '#F5F3FF', text: '#6D28D9' },
  gantry:       { bg: '#ECFDF5', text: '#065F46' },
  bridge_panel: { bg: '#FFF7ED', text: '#C2410C' },
  wall_drape:   { bg: '#FDF2F8', text: '#9D174D' },
  digital:      { bg: '#F0FDF4', text: '#15803D' },
  led:          { bg: '#F0FDF4', text: '#15803D' },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtNaira(n: number) {
  if (n >= 1_000_000) return '₦' + (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1_000)     return '₦' + (n / 1_000).toFixed(0) + 'K';
  return '₦' + n.toLocaleString('en-NG');
}

function fmtFull(n: number) {
  return '₦' + n.toLocaleString('en-NG');
}

function budgetLabel(n: number) {
  if (n >= 1_000_000) return '₦' + (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + ' million';
  if (n >= 1_000)     return '₦' + (n / 1_000).toFixed(0) + ' thousand';
  return '₦' + n.toLocaleString('en-NG');
}

function autoName() {
  return 'Campaign ' + Date.now().toString(36).toUpperCase().slice(-5);
}

function parseBudgetInput(raw: string): number {
  const stripped = raw.replace(/[₦,\s]/g, '');
  const parsed   = parseInt(stripped, 10);
  return isNaN(parsed) ? 0 : parsed;
}

// ── Stepper ───────────────────────────────────────────────────────────────────

const STEP_LABELS = ['Brief', 'Pick boards', 'Review', 'Submitted'];

function Stepper({ step }: { step: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0, marginBottom: 40 }}>
      {STEP_LABELS.map((label, i) => {
        const n       = i + 1;
        const done    = n < step;
        const active  = n === step;
        const dotBg   = done ? '#1B4F8A' : active ? '#1B4F8A' : '#E2E8F0';
        const dotText = done || active ? '#fff' : '#94A3B8';
        const lineClr = done ? '#1B4F8A' : '#E2E8F0';
        return (
          <div key={n} style={{ display: 'flex', alignItems: 'center' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
              <div style={{
                width: 32, height: 32, borderRadius: '50%', background: dotBg, color: dotText,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '0.8125rem', fontWeight: 700, transition: 'background 0.2s',
              }}>
                {done
                  ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                  : n}
              </div>
              <span style={{ fontSize: '0.6875rem', fontWeight: active ? 700 : 500, color: active ? '#0F172A' : '#94A3B8', whiteSpace: 'nowrap' }}>{label}</span>
            </div>
            {i < STEP_LABELS.length - 1 && (
              <div style={{ width: 64, height: 2, background: lineClr, margin: '0 4px', marginBottom: 20, transition: 'background 0.2s' }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Board mockup fallback ─────────────────────────────────────────────────────

function BoardMockup({ format }: { format: string }) {
  const fc = FORMAT_COLORS[format] || { bg: '#F1F5F9', text: '#64748B' };
  return (
    <div style={{
      width: '100%', height: '100%', background: fc.bg,
      display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 8,
    }}>
      <span style={{ fontSize: '0.6875rem', fontWeight: 600, color: fc.text }}>
        {FORMAT_LABELS[format] || format}
      </span>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function CampaignBuilderPage() {
  const router = useRouter();

  // ── Step 1: Brief ──
  const [step,           setStep]           = useState(1);
  const [name,           setName]           = useState('');
  const [creativeType,   setCreativeType]   = useState<'static' | 'digital'>('static');
  const [budget,         setBudget]         = useState(5_000_000);
  const [budgetInput,    setBudgetInput]    = useState('5,000,000');
  const [cities,         setCities]         = useState<string[]>(['Lagos', 'Abuja']);
  const [durationMonths, setDurationMonths] = useState(3);
  const [showMoreCities, setShowMoreCities] = useState(false);

  // ── Step 2: Boards ──
  const [boards,       setBoards]       = useState<Board[]>([]);
  const [loadingBoards,setLoadingBoards] = useState(false);
  const [boardsError,  setBoardsError]  = useState<string | null>(null);
  const [selectedIds,  setSelectedIds]  = useState<Set<string>>(new Set());
  const [hoveredId,    setHoveredId]    = useState<string | null>(null);
  const [mobileView,   setMobileView]   = useState<'map' | 'list'>('map');
  const [isMobile,     setIsMobile]     = useState(false);

  // ── Step 4: Submit ──
  const [submitting,   setSubmitting]   = useState(false);
  const [submitError,  setSubmitError]  = useState<string | null>(null);
  const [submitResult, setSubmitResult] = useState<SubmitResult | null>(null);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  // Pre-select city from ?city= URL param
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const cityParam = params.get('city');
    if (!cityParam) return;
    const allCities = [...TOP_CITIES, ...MORE_CITIES];
    if (allCities.includes(cityParam)) {
      setCities([cityParam]);
      setShowMoreCities(!TOP_CITIES.includes(cityParam));
    }
  }, []);

  // ── Computed values ───────────────────────────────────────────────────────

  const selectedBoards = useMemo(
    () => boards.filter(b => selectedIds.has(b.id)),
    [boards, selectedIds],
  );

  const askingTotal   = selectedBoards.reduce((s, b) => s + (b.asking_rate || 0) * durationMonths, 0);
  const discount      = Math.round(askingTotal * 0.05);
  const totalAfter    = askingTotal - discount;
  const perMonth      = durationMonths > 0 ? Math.round(totalAfter / durationMonths) : totalAfter;
  const budgetRemain  = budget - totalAfter;
  const overBudget    = totalAfter > budget;

  // ── Map board format ──────────────────────────────────────────────────────

  const mapBoards = useMemo(() => boards.map(b => ({
    id: b.id, name: b.name, city: b.city, format: b.format,
    asking_rate: b.asking_rate, lat: b.latitude, lng: b.longitude,
  })), [boards]);

  // ── Handlers ─────────────────────────────────────────────────────────────

  const toggleCity = (city: string) => {
    setCities(prev =>
      prev.includes(city) ? prev.filter(c => c !== city) : [...prev, city],
    );
  };

  const handleBudgetInput = (val: string) => {
    const digits = val.replace(/[^0-9]/g, '');
    const num    = parseInt(digits, 10) || 0;
    setBudget(num);
    setBudgetInput(num ? num.toLocaleString('en-NG') : '');
  };

  const toggleBoard = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  async function findBoards() {
    if (cities.length === 0) { alert('Select at least one city'); return; }
    setLoadingBoards(true);
    setBoardsError(null);
    setSelectedIds(new Set());
    try {
      const qs = new URLSearchParams({
        cities:       cities.join(','),
        creativeType,
      });
      const res  = await fetch(`/api/campaign-builder/boards?${qs}`);
      const data = await res.json() as { boards?: Board[]; error?: string };
      if (!res.ok || data.error) throw new Error(data.error || 'Failed to load boards');
      setBoards(data.boards || []);
      setStep(2);
    } catch (err) {
      setBoardsError(err instanceof Error ? err.message : 'Failed to load boards');
    } finally {
      setLoadingBoards(false);
    }
  }

  async function handleSubmit() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      router.push('/auth/login?redirect=/campaign-builder');
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const campaignName = name.trim() || autoName();
      const res = await fetch('/api/campaign-builder/submit', {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          campaignName,
          budget,
          durationMonths,
          boardIds: [...selectedIds],
        }),
      });
      const data = await res.json() as SubmitResult & { error?: string };
      if (!res.ok || data.error) throw new Error(data.error || 'Submission failed');
      setSubmitResult(data);
      setStep(4);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Submission failed');
    } finally {
      setSubmitting(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={{ minHeight: '100vh', background: '#F8FAFC', fontFamily: "'Inter', -apple-system, sans-serif" }}>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeUp { from { opacity:0; transform:translateY(10px); } to { opacity:1; transform:translateY(0); } }
        .cb-fade { animation: fadeUp 0.3s ease forwards; }
        .cb-board-tile:hover { border-color: #1B4F8A !important; background: #F8FAFF !important; }
        .cb-pill:hover { opacity: 0.85; }
      `}</style>

      {/* Nav bar */}
      <nav style={{
        background: '#fff', borderBottom: '1px solid #E8EDF2',
        padding: '0 24px', height: 60,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        position: 'sticky', top: 0, zIndex: 50,
      }}>
        <a href="/" style={{ display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none' }}>
          <div style={{
            width: 30, height: 30, background: '#0F172A', borderRadius: 8,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <span style={{ color: '#F59E0B', fontWeight: 800, fontSize: '0.875rem', fontFamily: 'monospace' }}>O</span>
          </div>
          <span style={{ fontSize: '0.9375rem', fontWeight: 700, color: '#0F172A', letterSpacing: '-0.02em' }}>OOH Platform</span>
        </a>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {step < 4 && (
            <span style={{ fontSize: '0.8125rem', color: '#94A3B8' }}>
              {step === 1 ? 'Step 1 of 3' : step === 2 ? 'Step 2 of 3' : 'Step 3 of 3'}
            </span>
          )}
          <a href="/auth/login" style={{
            fontSize: '0.8125rem', fontWeight: 600, color: '#1B4F8A',
            textDecoration: 'none', padding: '7px 14px',
            border: '1.5px solid #1B4F8A', borderRadius: 8,
          }}>Sign in</a>
        </div>
      </nav>

      {/* ── STEP 1: BRIEF ─────────────────────────────────────────────────────── */}
      {step === 1 && (
        <div className="cb-fade" style={{ maxWidth: 680, margin: '0 auto', padding: '48px 20px 80px' }}>
          <div style={{ textAlign: 'center', marginBottom: 40 }}>
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, background: '#EFF6FF',
              border: '1px solid #BFDBFE', borderRadius: 999, padding: '5px 14px', marginBottom: 16,
            }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#3B82F6', display: 'block' }} />
              <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#1D4ED8' }}>Self-service campaign builder</span>
            </div>
            <h1 style={{ fontSize: '2rem', fontWeight: 800, color: '#0F172A', margin: '0 0 10px', letterSpacing: '-0.03em', lineHeight: 1.2 }}>
              Plan your OOH campaign
            </h1>
            <p style={{ fontSize: '1rem', color: '#64748B', margin: 0, lineHeight: 1.6 }}>
              Tell us your brief. We&apos;ll find the right boards in under a minute.
            </p>
          </div>

          <Stepper step={1} />

          {/* Campaign name */}
          <div style={{ marginBottom: 28 }}>
            <label style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#374151', display: 'block', marginBottom: 8 }}>
              Campaign name <span style={{ fontSize: '0.75rem', fontWeight: 400, color: '#94A3B8' }}>(optional — we&apos;ll auto-generate)</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Q3 Product Launch"
              style={{
                width: '100%', padding: '11px 14px', borderRadius: 10,
                border: '1.5px solid #E2E8F0', fontSize: '0.9375rem', color: '#0F172A',
                background: '#fff', outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit',
              }}
            />
          </div>

          {/* Creative type */}
          <div style={{ marginBottom: 28 }}>
            <label style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#374151', display: 'block', marginBottom: 10 }}>
              Creative type
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {([
                {
                  key: 'static', icon: '🖼',
                  title: 'Static / Print',
                  desc: 'Billboards, gantries, unipoles, wall drapes',
                },
                {
                  key: 'digital', icon: '📺',
                  title: 'LED / Digital',
                  desc: 'Digital screens, LED boards, dynamic displays',
                },
              ] as const).map(({ key, icon, title, desc }) => (
                <button
                  key={key}
                  onClick={() => setCreativeType(key)}
                  style={{
                    padding: '18px 16px', borderRadius: 12, cursor: 'pointer', textAlign: 'left',
                    border:      creativeType === key ? '2px solid #1B4F8A' : '1.5px solid #E2E8F0',
                    background:  creativeType === key ? '#EFF6FF' : '#fff',
                    fontFamily: 'inherit',
                    transition: 'border-color 0.15s, background 0.15s',
                  }}
                >
                  <div style={{ fontSize: '1.5rem', marginBottom: 8 }}>{icon}</div>
                  <div style={{ fontSize: '0.9375rem', fontWeight: 700, color: '#0F172A', marginBottom: 4 }}>{title}</div>
                  <div style={{ fontSize: '0.75rem', color: '#64748B', lineHeight: 1.5 }}>{desc}</div>
                  {creativeType === key && (
                    <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 5 }}>
                      <div style={{ width: 16, height: 16, borderRadius: '50%', background: '#1B4F8A', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                      </div>
                      <span style={{ fontSize: '0.6875rem', fontWeight: 600, color: '#1B4F8A' }}>Selected</span>
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Budget */}
          <div style={{ marginBottom: 28 }}>
            <label style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#374151', display: 'block', marginBottom: 10 }}>
              Total budget
            </label>
            <div style={{ position: 'relative', marginBottom: 10 }}>
              <span style={{
                position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)',
                fontSize: '1rem', fontWeight: 700, color: '#0F172A',
              }}>₦</span>
              <input
                type="text"
                value={budgetInput}
                onChange={e => handleBudgetInput(e.target.value)}
                placeholder="5,000,000"
                style={{
                  width: '100%', padding: '11px 14px 11px 28px', borderRadius: 10,
                  border: '1.5px solid #E2E8F0', fontSize: '1rem', color: '#0F172A',
                  background: '#fff', outline: 'none', boxSizing: 'border-box', fontFamily: "'JetBrains Mono', monospace",
                }}
              />
            </div>
            {budget > 0 && (
              <p style={{ fontSize: '0.75rem', color: '#64748B', margin: '0 0 10px' }}>
                {budgetLabel(budget)}
              </p>
            )}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {BUDGET_PILLS.map(p => (
                <button
                  key={p}
                  className="cb-pill"
                  onClick={() => { setBudget(p); setBudgetInput(p.toLocaleString('en-NG')); }}
                  style={{
                    padding: '6px 14px', borderRadius: 999, cursor: 'pointer',
                    border:      budget === p ? '1.5px solid #1B4F8A' : '1.5px solid #E2E8F0',
                    background:  budget === p ? '#1B4F8A' : '#fff',
                    color:       budget === p ? '#fff' : '#374151',
                    fontSize: '0.8125rem', fontWeight: 600, fontFamily: "'JetBrains Mono', monospace",
                    transition: 'all 0.15s',
                  }}
                >
                  {fmtNaira(p)}
                </button>
              ))}
            </div>
          </div>

          {/* Cities */}
          <div style={{ marginBottom: 28 }}>
            <label style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#374151', display: 'block', marginBottom: 10 }}>
              Target cities <span style={{ fontSize: '0.75rem', fontWeight: 400, color: '#94A3B8' }}>({cities.length} selected)</span>
            </label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
              {[...TOP_CITIES, ...(showMoreCities ? MORE_CITIES : [])].map(city => (
                <button
                  key={city}
                  className="cb-pill"
                  onClick={() => toggleCity(city)}
                  style={{
                    padding: '7px 16px', borderRadius: 999, cursor: 'pointer',
                    border:      cities.includes(city) ? '1.5px solid #1B4F8A' : '1.5px solid #E2E8F0',
                    background:  cities.includes(city) ? '#1B4F8A' : '#fff',
                    color:       cities.includes(city) ? '#fff' : '#374151',
                    fontSize: '0.8125rem', fontWeight: 500,
                    fontFamily: 'inherit', transition: 'all 0.15s',
                  }}
                >
                  {city}
                </button>
              ))}
              <button
                className="cb-pill"
                onClick={() => setShowMoreCities(v => !v)}
                style={{
                  padding: '7px 16px', borderRadius: 999, cursor: 'pointer',
                  border: '1.5px dashed #CBD5E1', background: '#F8FAFC', color: '#64748B',
                  fontSize: '0.8125rem', fontWeight: 500, fontFamily: 'inherit',
                }}
              >
                {showMoreCities ? 'Show fewer' : '+ More cities'}
              </button>
            </div>
          </div>

          {/* Duration */}
          <div style={{ marginBottom: 40 }}>
            <label style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#374151', display: 'block', marginBottom: 10 }}>
              Campaign duration
            </label>
            <div style={{ display: 'flex', gap: 10 }}>
              {DURATION_OPTIONS.map(d => (
                <button
                  key={d}
                  className="cb-pill"
                  onClick={() => setDurationMonths(d)}
                  style={{
                    flex: 1, padding: '10px 0', borderRadius: 10, cursor: 'pointer',
                    border:     durationMonths === d ? '2px solid #1B4F8A' : '1.5px solid #E2E8F0',
                    background: durationMonths === d ? '#EFF6FF' : '#fff',
                    color:      durationMonths === d ? '#1B4F8A' : '#374151',
                    fontSize: '0.875rem', fontWeight: durationMonths === d ? 700 : 500,
                    fontFamily: 'inherit', transition: 'all 0.15s',
                  }}
                >
                  {d === 1 ? '1 month' : `${d} months`}
                </button>
              ))}
            </div>
          </div>

          {boardsError && (
            <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 10, padding: '12px 16px', marginBottom: 16, fontSize: '0.875rem', color: '#991B1B' }}>
              {boardsError}
            </div>
          )}

          <button
            onClick={findBoards}
            disabled={loadingBoards || cities.length === 0 || budget <= 0}
            style={{
              width: '100%', padding: '15px', borderRadius: 12, border: 'none', cursor: 'pointer',
              background: loadingBoards || cities.length === 0 || budget <= 0 ? '#E2E8F0' : '#1B4F8A',
              color:  loadingBoards || cities.length === 0 || budget <= 0 ? '#94A3B8' : '#fff',
              fontSize: '1rem', fontWeight: 700, fontFamily: 'inherit', letterSpacing: '-0.01em',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
              transition: 'background 0.15s',
            }}
          >
            {loadingBoards ? (
              <>
                <div style={{ width: 18, height: 18, border: '2.5px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
                Finding boards…
              </>
            ) : (
              <>Find boards <span style={{ fontSize: '1.125rem' }}>→</span></>
            )}
          </button>
        </div>
      )}

      {/* ── STEP 2: MAP ───────────────────────────────────────────────────────── */}
      {step === 2 && (
        <div className="cb-fade" style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 60px)' }}>

          {/* Top status bar */}
          <div style={{
            background: '#fff', borderBottom: '1px solid #E8EDF2',
            padding: '12px 24px', display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap',
          }}>
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: '1.25rem', fontWeight: 800, color: '#1B4F8A', fontFamily: "'JetBrains Mono', monospace" }}>{selectedIds.size}</span>
                <span style={{ fontSize: '0.8125rem', color: '#64748B' }}>boards selected</span>
              </div>
              {selectedIds.size > 0 && (
                <>
                  <div style={{ width: 1, height: 20, background: '#E2E8F0' }} />
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: '0.875rem', fontWeight: 700, color: '#0F172A', fontFamily: "'JetBrains Mono', monospace" }}>{fmtNaira(totalAfter)}</span>
                    <span style={{ fontSize: '0.8125rem', color: '#64748B' }}>estimated total</span>
                  </div>
                  <div style={{ width: 1, height: 20, background: '#E2E8F0' }} />
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: '0.875rem', fontWeight: 700, color: overBudget ? '#DC2626' : '#10B981', fontFamily: "'JetBrains Mono', monospace" }}>
                      {overBudget ? '-' : '+'}{fmtNaira(Math.abs(budgetRemain))}
                    </span>
                    <span style={{ fontSize: '0.8125rem', color: '#64748B' }}>{overBudget ? 'over budget' : 'remaining'}</span>
                  </div>
                </>
              )}
            </div>

            {overBudget && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 8, padding: '6px 12px' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#D97706" strokeWidth="2.5" strokeLinecap="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#92400E' }}>Over budget — remove some boards</span>
              </div>
            )}

            {isMobile && (
              <div style={{ display: 'flex', border: '1px solid #E2E8F0', borderRadius: 8, overflow: 'hidden' }}>
                {(['map', 'list'] as const).map(v => (
                  <button key={v} onClick={() => setMobileView(v)} style={{
                    padding: '7px 16px', border: 'none', cursor: 'pointer', fontSize: '0.8125rem', fontWeight: 600,
                    background: mobileView === v ? '#1B4F8A' : '#fff',
                    color:      mobileView === v ? '#fff' : '#64748B',
                    fontFamily: 'inherit',
                  }}>
                    {v === 'map' ? 'Map' : `List (${boards.length})`}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Split pane */}
          <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

            {/* Map */}
            {(!isMobile || mobileView === 'map') && (
              <div style={{ flex: isMobile ? 1 : '0 0 55%', minWidth: 0, height: '100%' }}>
                <CampaignMap
                  boards={mapBoards}
                  selectedIds={selectedIds}
                  hoveredId={hoveredId}
                  onToggle={toggleBoard}
                  onHover={setHoveredId}
                />
              </div>
            )}

            {/* Board list */}
            {(!isMobile || mobileView === 'list') && (
              <div style={{
                flex: isMobile ? 1 : '0 0 45%', display: 'flex', flexDirection: 'column',
                borderLeft: '1px solid #E8EDF2', overflow: 'hidden',
              }}>
                <div style={{ padding: '12px 16px', borderBottom: '1px solid #F1F5F9', background: '#fff' }}>
                  <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#374151' }}>{boards.length} boards available</span>
                  <span style={{ fontSize: '0.75rem', color: '#94A3B8', marginLeft: 8 }}>
                    {cities.join(', ')} · {creativeType === 'digital' ? 'LED/Digital' : 'Static/Print'}
                  </span>
                </div>

                <div style={{ flex: 1, overflowY: 'auto', padding: '12px' }}>
                  {boards.length === 0 ? (
                    <div style={{ padding: '3rem 1rem', textAlign: 'center' }}>
                      <p style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#0F172A', margin: '0 0 6px' }}>No boards found</p>
                      <p style={{ fontSize: '0.8125rem', color: '#94A3B8', margin: '0 0 16px' }}>Try adding more cities or changing the creative type.</p>
                      <button onClick={() => setStep(1)} style={{ background: '#1B4F8A', color: '#fff', border: 'none', padding: '9px 20px', borderRadius: 8, fontSize: '0.875rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>Edit brief</button>
                    </div>
                  ) : boards.map(b => {
                    const selected = selectedIds.has(b.id);
                    const hovered  = hoveredId === b.id;
                    const fc       = FORMAT_COLORS[b.format] || { bg: '#F1F5F9', text: '#64748B' };
                    return (
                      <div
                        key={b.id}
                        className="cb-board-tile"
                        onMouseEnter={() => setHoveredId(b.id)}
                        onMouseLeave={() => setHoveredId(null)}
                        onClick={() => toggleBoard(b.id)}
                        style={{
                          display: 'flex', gap: 12, padding: '10px 12px', borderRadius: 10, marginBottom: 8,
                          border: selected ? '1.5px solid #1B4F8A' : hovered ? '1.5px solid #93C5FD' : '1.5px solid #E8EDF2',
                          background: selected ? '#EFF6FF' : '#fff',
                          cursor: 'pointer', transition: 'border-color 0.15s, background 0.15s',
                        }}
                      >
                        {/* Thumbnail */}
                        <div style={{ width: 56, height: 44, borderRadius: 7, overflow: 'hidden', flexShrink: 0, background: fc.bg }}>
                          {b.photo_urls?.[0]
                            ? <img src={b.photo_urls[0]} alt={b.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                            : <BoardMockup format={b.format} />
                          }
                        </div>

                        {/* Info */}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#0F172A', marginBottom: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.name}</div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                            <span style={{ fontSize: '0.6875rem', color: '#64748B' }}>{b.city}</span>
                            <span style={{ fontSize: '0.6875rem', background: fc.bg, color: fc.text, padding: '1px 6px', borderRadius: 4, fontWeight: 600 }}>
                              {FORMAT_LABELS[b.format] || b.format}
                            </span>
                            {b.illuminated && (
                              <span style={{ fontSize: '0.6875rem', background: '#FFFBEB', color: '#92400E', padding: '1px 6px', borderRadius: 4, fontWeight: 600 }}>24hr</span>
                            )}
                          </div>
                        </div>

                        {/* Rate + checkbox */}
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
                          <span style={{ fontSize: '0.8125rem', fontWeight: 700, color: '#0F172A', fontFamily: "'JetBrains Mono', monospace" }}>
                            {fmtNaira(b.asking_rate)}
                          </span>
                          <span style={{ fontSize: '0.6875rem', color: '#94A3B8' }}>/mo</span>
                          <div style={{
                            width: 18, height: 18, borderRadius: 5, marginTop: 2,
                            border: selected ? 'none' : '1.5px solid #CBD5E1',
                            background: selected ? '#1B4F8A' : '#fff',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                          }}>
                            {selected && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Sticky bottom bar */}
          <div style={{
            background: '#fff', borderTop: '1px solid #E8EDF2',
            padding: '12px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
          }}>
            <button
              onClick={() => setStep(1)}
              style={{
                padding: '10px 18px', borderRadius: 10, border: '1.5px solid #E2E8F0',
                background: '#fff', color: '#374151', fontSize: '0.875rem', fontWeight: 600,
                cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              ← Edit brief
            </button>
            <button
              onClick={() => setStep(3)}
              disabled={selectedIds.size === 0}
              style={{
                padding: '11px 28px', borderRadius: 10, border: 'none', cursor: selectedIds.size === 0 ? 'not-allowed' : 'pointer',
                background: selectedIds.size === 0 ? '#E2E8F0' : '#1B4F8A',
                color:      selectedIds.size === 0 ? '#94A3B8' : '#fff',
                fontSize: '0.9375rem', fontWeight: 700, fontFamily: 'inherit', letterSpacing: '-0.01em',
              }}
            >
              Review plan → {selectedIds.size > 0 && `(${selectedIds.size} boards)`}
            </button>
          </div>
        </div>
      )}

      {/* ── STEP 3: REVIEW ────────────────────────────────────────────────────── */}
      {step === 3 && (
        <div className="cb-fade" style={{ maxWidth: 820, margin: '0 auto', padding: '48px 20px 100px' }}>
          <div style={{ textAlign: 'center', marginBottom: 40 }}>
            <h1 style={{ fontSize: '1.75rem', fontWeight: 800, color: '#0F172A', margin: '0 0 8px', letterSpacing: '-0.03em' }}>Review your plan</h1>
            <p style={{ fontSize: '0.9375rem', color: '#64748B', margin: 0 }}>
              {selectedBoards.length} board{selectedBoards.length !== 1 ? 's' : ''} · {durationMonths} month{durationMonths !== 1 ? 's' : ''} · {cities.join(', ')}
            </p>
          </div>

          <Stepper step={3} />

          {/* Plan summary card */}
          <div style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: 14, padding: '20px 24px', marginBottom: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <h2 style={{ fontSize: '1rem', fontWeight: 700, color: '#0F172A', margin: 0 }}>
                {name.trim() || '(Name will be auto-generated)'}
              </h2>
              <span style={{ fontSize: '0.75rem', background: '#EFF6FF', color: '#1D4ED8', padding: '3px 10px', borderRadius: 999, fontWeight: 600 }}>
                {creativeType === 'digital' ? 'LED/Digital' : 'Static/Print'}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap' }}>
              {[
                { label: 'Duration',  value: `${durationMonths} month${durationMonths !== 1 ? 's' : ''}` },
                { label: 'Cities',    value: cities.join(', ') },
                { label: 'Budget',    value: fmtNaira(budget) },
                { label: 'Boards',    value: String(selectedBoards.length) },
              ].map(({ label, value }) => (
                <div key={label}>
                  <p style={{ fontSize: '0.6875rem', fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 3px' }}>{label}</p>
                  <p style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#0F172A', margin: 0 }}>{value}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Board table */}
          <div style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: 14, overflow: 'hidden', marginBottom: 20 }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#F8FAFC' }}>
                    {['Board', 'City', 'Format', 'Rate/mo', 'Duration', 'Subtotal'].map(h => (
                      <th key={h} style={{ padding: '10px 16px', fontSize: '0.6875rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.07em', textAlign: 'left', borderBottom: '1px solid #F1F5F9', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {selectedBoards.map((b, i) => {
                    const offered  = Math.round(b.asking_rate * 0.95);
                    const subtotal = offered * durationMonths;
                    return (
                      <tr key={b.id} style={{ borderBottom: i < selectedBoards.length - 1 ? '1px solid #F8FAFC' : 'none' }}>
                        <td style={{ padding: '12px 16px', fontSize: '0.8125rem', fontWeight: 600, color: '#0F172A', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.name}</td>
                        <td style={{ padding: '12px 16px', fontSize: '0.8125rem', color: '#64748B' }}>{b.city}</td>
                        <td style={{ padding: '12px 16px' }}>
                          <span style={{ fontSize: '0.6875rem', background: (FORMAT_COLORS[b.format] || { bg: '#F1F5F9' }).bg, color: (FORMAT_COLORS[b.format] || { text: '#64748B' }).text, padding: '2px 8px', borderRadius: 4, fontWeight: 600 }}>
                            {FORMAT_LABELS[b.format] || b.format}
                          </span>
                        </td>
                        <td style={{ padding: '12px 16px', fontSize: '0.8125rem', fontWeight: 600, color: '#0F172A', fontFamily: "'JetBrains Mono', monospace" }}>{fmtNaira(offered)}</td>
                        <td style={{ padding: '12px 16px', fontSize: '0.8125rem', color: '#64748B' }}>{durationMonths}mo</td>
                        <td style={{ padding: '12px 16px', fontSize: '0.875rem', fontWeight: 700, color: '#0F172A', fontFamily: "'JetBrains Mono', monospace" }}>{fmtNaira(subtotal)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Pricing breakdown */}
          <div style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: 14, overflow: 'hidden', marginBottom: 32 }}>
            <div style={{ padding: '16px 24px', display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #F1F5F9' }}>
              <span style={{ fontSize: '0.875rem', color: '#64748B' }}>Subtotal ({selectedBoards.length} boards × {durationMonths}mo)</span>
              <span style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#0F172A', fontFamily: "'JetBrains Mono', monospace" }}>{fmtFull(askingTotal)}</span>
            </div>
            <div style={{ padding: '14px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#F0FDF4', borderBottom: '1px solid #BBF7D0' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ background: '#22C55E', borderRadius: 6, padding: '3px 8px' }}>
                  <span style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#fff' }}>5% PLATFORM DISCOUNT</span>
                </div>
                <span style={{ fontSize: '0.8125rem', color: '#16A34A', fontWeight: 600 }}>Save {fmtFull(discount)}</span>
              </div>
              <span style={{ fontSize: '0.9375rem', fontWeight: 700, color: '#16A34A', fontFamily: "'JetBrains Mono', monospace" }}>-{fmtFull(discount)}</span>
            </div>
            <div style={{ padding: '16px 24px', display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #F1F5F9' }}>
              <span style={{ fontSize: '1rem', fontWeight: 700, color: '#0F172A' }}>Total</span>
              <span style={{ fontSize: '1.125rem', fontWeight: 800, color: '#0F172A', fontFamily: "'JetBrains Mono', monospace" }}>{fmtFull(totalAfter)}</span>
            </div>
            <div style={{ padding: '12px 24px', display: 'flex', justifyContent: 'space-between', background: '#F8FAFC' }}>
              <span style={{ fontSize: '0.8125rem', color: '#64748B' }}>Per month</span>
              <span style={{ fontSize: '0.9375rem', fontWeight: 700, color: '#1B4F8A', fontFamily: "'JetBrains Mono', monospace" }}>{fmtFull(perMonth)}/mo</span>
            </div>
          </div>

          {overBudget && (
            <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 10, padding: '12px 16px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#D97706" strokeWidth="2" strokeLinecap="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
              <span style={{ fontSize: '0.8125rem', color: '#92400E', fontWeight: 500 }}>
                This plan is <strong>{fmtFull(totalAfter - budget)}</strong> over your stated budget. You can still submit or go back to remove boards.
              </span>
            </div>
          )}

          {submitError && (
            <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 10, padding: '12px 16px', marginBottom: 16, fontSize: '0.875rem', color: '#991B1B' }}>
              {submitError}
            </div>
          )}

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <button
              onClick={() => setStep(2)}
              style={{
                padding: '12px 24px', borderRadius: 10, border: '1.5px solid #E2E8F0',
                background: '#fff', color: '#374151', fontSize: '0.9375rem', fontWeight: 600,
                cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              ← Edit selection
            </button>
            <button
              onClick={handleSubmit}
              disabled={submitting}
              style={{
                flex: 1, padding: '13px 28px', borderRadius: 10, border: 'none',
                background: submitting ? '#E2E8F0' : '#1B4F8A',
                color:      submitting ? '#94A3B8' : '#fff',
                fontSize: '1rem', fontWeight: 700, fontFamily: 'inherit',
                cursor: submitting ? 'not-allowed' : 'pointer', letterSpacing: '-0.01em',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
              }}
            >
              {submitting
                ? <><div style={{ width: 18, height: 18, border: '2.5px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />Submitting…</>
                : 'Submit plan →'}
            </button>
          </div>
          <p style={{ fontSize: '0.75rem', color: '#94A3B8', textAlign: 'center', marginTop: 12 }}>
            By submitting you agree to our terms. Board owners will receive booking requests and can accept, counter, or decline.
          </p>
        </div>
      )}

      {/* ── STEP 4: SUBMITTED ─────────────────────────────────────────────────── */}
      {step === 4 && submitResult && (
        <div className="cb-fade" style={{ maxWidth: 560, margin: '0 auto', padding: '80px 20px', textAlign: 'center' }}>
          {/* Checkmark */}
          <div style={{
            width: 80, height: 80, borderRadius: '50%', background: '#ECFDF5',
            border: '3px solid #6EE7B7', display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 28px', animation: 'fadeUp 0.4s ease forwards',
          }}>
            <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
          </div>

          <h1 style={{ fontSize: '1.875rem', fontWeight: 800, color: '#0F172A', margin: '0 0 10px', letterSpacing: '-0.03em' }}>
            Campaign submitted!
          </h1>
          <p style={{ fontSize: '1rem', color: '#64748B', margin: '0 0 36px', lineHeight: 1.6 }}>
            Your plan is live. We&apos;ve notified <strong style={{ color: '#0F172A' }}>{submitResult.ownerCount} board owner{submitResult.ownerCount !== 1 ? 's' : ''}</strong> with booking requests for <strong style={{ color: '#0F172A' }}>{submitResult.boardCount} boards</strong>.
          </p>

          {/* Summary */}
          <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 14, padding: '20px 24px', marginBottom: 32, textAlign: 'left' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 24px' }}>
              {[
                { label: 'Boards',   value: String(submitResult.boardCount) },
                { label: 'Duration', value: `${durationMonths} months` },
                { label: 'Total',    value: fmtFull(totalAfter) },
                { label: 'Owners notified', value: String(submitResult.ownerCount) },
              ].map(({ label, value }) => (
                <div key={label}>
                  <p style={{ fontSize: '0.6875rem', fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 3px' }}>{label}</p>
                  <p style={{ fontSize: '0.9375rem', fontWeight: 700, color: '#0F172A', margin: 0, fontFamily: label === 'Total' ? "'JetBrains Mono', monospace" : 'inherit' }}>{value}</p>
                </div>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <button
              onClick={() => router.push('/dashboard/client')}
              style={{
                padding: '13px', borderRadius: 10, border: 'none', cursor: 'pointer',
                background: '#1B4F8A', color: '#fff',
                fontSize: '0.9375rem', fontWeight: 700, fontFamily: 'inherit',
              }}
            >
              Track your campaign →
            </button>
            <a
              href={`https://wa.me/?text=${encodeURIComponent(`Just submitted an OOH campaign plan on OOH Platform — ${submitResult.boardCount} boards across ${cities.join(', ')} for ${durationMonths} months. Check it out: ${typeof window !== 'undefined' ? window.location.origin : ''}/campaign-builder`)}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                padding: '13px', borderRadius: 10, border: '1.5px solid #22C55E',
                background: '#fff', color: '#16A34A',
                fontSize: '0.9375rem', fontWeight: 700, fontFamily: 'inherit',
                textDecoration: 'none', display: 'block',
              }}
            >
              📲 Share on WhatsApp
            </a>
            <button
              onClick={() => { setStep(1); setName(''); setSelectedIds(new Set()); setBoards([]); setSubmitResult(null); }}
              style={{
                padding: '11px', borderRadius: 10, border: '1.5px solid #E2E8F0',
                background: '#fff', color: '#64748B',
                fontSize: '0.875rem', fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer',
              }}
            >
              Plan another campaign
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
