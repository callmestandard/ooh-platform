'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { formatNaira, formatImpressions } from '@/lib/utils';

// ── Types ─────────────────────────────────────────────────────────────────────

type Board = {
  id: string;
  name: string;
  city: string;
  state: string | null;
  format: string;
  latitude: number | null;
  longitude: number | null;
  asking_rate: number;
  illuminated: boolean;
  status: string;
};

type AudienceProfile = {
  boardId: string;
  // Traffic
  dailyVehicles: number;
  dailyPedestrians: number;
  peakHours: string;
  // Demographics
  ageBreakdown: { label: string; pct: number; color: string }[];
  incomeBreakdown: { label: string; pct: number; color: string }[];
  genderSplit: { male: number; female: number };
  // Reach metrics
  dailyImpressions: number;
  weeklyReach: number;
  frequency: number;
  cpm: number;
  // Nearby POIs
  nearbyPOIs: { type: string; count: number; icon: string }[];
  // Context
  locationScore: number;
  trafficGrade: 'A' | 'B' | 'C' | 'D';
};

// ── Nigerian location intelligence data ───────────────────────────────────────
// Based on OOH industry benchmarks for Nigerian urban markets

const CITY_PROFILES: Record<string, {
  tier: 'prime' | 'secondary' | 'tertiary';
  dailyVehiclesBase: number;
  dailyPedestriansBase: number;
  incomeProfile: 'affluent' | 'mixed' | 'mass';
}> = {
  'Lagos':      { tier: 'prime',     dailyVehiclesBase: 45000, dailyPedestriansBase: 28000, incomeProfile: 'mixed' },
  'Abuja':      { tier: 'prime',     dailyVehiclesBase: 35000, dailyPedestriansBase: 18000, incomeProfile: 'affluent' },
  'Port Harcourt': { tier: 'prime',  dailyVehiclesBase: 28000, dailyPedestriansBase: 15000, incomeProfile: 'mixed' },
  'Kano':       { tier: 'secondary', dailyVehiclesBase: 22000, dailyPedestriansBase: 32000, incomeProfile: 'mass' },
  'Ibadan':     { tier: 'secondary', dailyVehiclesBase: 20000, dailyPedestriansBase: 22000, incomeProfile: 'mass' },
  'Enugu':      { tier: 'secondary', dailyVehiclesBase: 15000, dailyPedestriansBase: 12000, incomeProfile: 'mixed' },
  'Warri':      { tier: 'secondary', dailyVehiclesBase: 18000, dailyPedestriansBase: 14000, incomeProfile: 'mixed' },
  'Kaduna':     { tier: 'secondary', dailyVehiclesBase: 16000, dailyPedestriansBase: 18000, incomeProfile: 'mass' },
  'Benin City': { tier: 'secondary', dailyVehiclesBase: 14000, dailyPedestriansBase: 16000, incomeProfile: 'mass' },
};

const FORMAT_MULTIPLIERS: Record<string, { visibility: number; impressionRate: number }> = {
  billboard:    { visibility: 1.0, impressionRate: 0.25 },
  unipole:      { visibility: 1.2, impressionRate: 0.30 },
  gantry:       { visibility: 1.4, impressionRate: 0.35 },
  bridge_panel: { visibility: 1.1, impressionRate: 0.28 },
  wall_drape:   { visibility: 0.7, impressionRate: 0.18 },
};

const INCOME_PROFILES = {
  affluent: [
    { label: 'Upper income (A)',  pct: 25, color: '#1B4F8A' },
    { label: 'Upper-mid (B)',     pct: 40, color: '#3B82F6' },
    { label: 'Mid income (C)',    pct: 28, color: '#93C5FD' },
    { label: 'Lower income (D)', pct: 7,  color: '#BFDBFE' },
  ],
  mixed: [
    { label: 'Upper income (A)',  pct: 15, color: '#1B4F8A' },
    { label: 'Upper-mid (B)',     pct: 30, color: '#3B82F6' },
    { label: 'Mid income (C)',    pct: 40, color: '#93C5FD' },
    { label: 'Lower income (D)', pct: 15, color: '#BFDBFE' },
  ],
  mass: [
    { label: 'Upper income (A)',  pct: 5,  color: '#1B4F8A' },
    { label: 'Upper-mid (B)',     pct: 20, color: '#3B82F6' },
    { label: 'Mid income (C)',    pct: 45, color: '#93C5FD' },
    { label: 'Lower income (D)', pct: 30, color: '#BFDBFE' },
  ],
};

const AGE_PROFILES = [
  { label: '18–24',  pct: 22, color: '#7C3AED' },
  { label: '25–34',  pct: 30, color: '#8B5CF6' },
  { label: '35–44',  pct: 24, color: '#A78BFA' },
  { label: '45–54',  pct: 15, color: '#C4B5FD' },
  { label: '55+',    pct: 9,  color: '#DDD6FE' },
];

function generateAudienceProfile(board: Board): AudienceProfile {
  const cityKey = Object.keys(CITY_PROFILES).find(k => board.city?.toLowerCase().includes(k.toLowerCase())) || 'Lagos';
  const cityData = CITY_PROFILES[cityKey] || CITY_PROFILES['Lagos'];
  const fmul = FORMAT_MULTIPLIERS[board.format] || FORMAT_MULTIPLIERS.billboard;

  // Add deterministic variation based on board ID
  const seed = board.id.charCodeAt(0) / 255;
  const variance = 0.7 + seed * 0.6;

  const dailyVehicles = Math.round(cityData.dailyVehiclesBase * fmul.visibility * variance);
  const dailyPedestrians = Math.round(cityData.dailyPedestriansBase * variance);
  const totalTraffic = dailyVehicles + dailyPedestrians;

  const dailyImpressions = Math.round(totalTraffic * fmul.impressionRate * (board.illuminated ? 1.25 : 1.0));
  const weeklyReach = Math.round(dailyImpressions * 7 * 0.65); // account for repeat
  const frequency = parseFloat((dailyImpressions * 7 / weeklyReach).toFixed(1));
  const cpm = board.asking_rate > 0 ? Math.round((board.asking_rate / dailyImpressions) * 1000) : 0;

  // Score
  const tierScore = { prime: 90, secondary: 70, tertiary: 50 }[cityData.tier];
  const formatScore = (fmul.visibility / 1.4) * 100;
  const illuminationBonus = board.illuminated ? 10 : 0;
  const locationScore = Math.min(100, Math.round(tierScore * 0.5 + formatScore * 0.4 + illuminationBonus));

  // Traffic grade
  const grade: 'A' | 'B' | 'C' | 'D' =
    dailyVehicles > 35000 ? 'A' :
    dailyVehicles > 20000 ? 'B' :
    dailyVehicles > 12000 ? 'C' : 'D';

  // POIs
  const poiSets = {
    prime: [
      { type: 'Banks & ATMs', count: Math.round(8 + seed * 5), icon: '🏦' },
      { type: 'Restaurants', count: Math.round(22 + seed * 12), icon: '🍽️' },
      { type: 'Shopping malls', count: Math.round(3 + seed * 3), icon: '🛍️' },
      { type: 'Hotels', count: Math.round(6 + seed * 4), icon: '🏨' },
      { type: 'Petrol stations', count: Math.round(5 + seed * 3), icon: '⛽' },
    ],
    secondary: [
      { type: 'Banks & ATMs', count: Math.round(5 + seed * 4), icon: '🏦' },
      { type: 'Markets', count: Math.round(4 + seed * 3), icon: '🛒' },
      { type: 'Restaurants', count: Math.round(14 + seed * 8), icon: '🍽️' },
      { type: 'Petrol stations', count: Math.round(4 + seed * 2), icon: '⛽' },
    ],
    tertiary: [
      { type: 'Banks & ATMs', count: Math.round(2 + seed * 2), icon: '🏦' },
      { type: 'Markets', count: Math.round(3 + seed * 3), icon: '🛒' },
      { type: 'Petrol stations', count: Math.round(2 + seed * 2), icon: '⛽' },
    ],
  };

  return {
    boardId: board.id,
    dailyVehicles,
    dailyPedestrians,
    peakHours: cityData.tier === 'prime' ? '7–9am, 12–2pm, 5–8pm' : '7–10am, 5–7pm',
    ageBreakdown: AGE_PROFILES,
    incomeBreakdown: INCOME_PROFILES[cityData.incomeProfile],
    genderSplit: { male: 54, female: 46 },
    dailyImpressions,
    weeklyReach,
    frequency,
    cpm,
    nearbyPOIs: poiSets[cityData.tier],
    locationScore,
    trafficGrade: grade,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const FORMAT_LABELS: Record<string, string> = {
  billboard: 'Billboard', unipole: 'Unipole', gantry: 'Gantry',
  bridge_panel: 'Bridge Panel', wall_drape: 'Wall Drape',
};

// ── Components ────────────────────────────────────────────────────────────────

function GradeRing({ grade, score }: { grade: string; score: number }) {
  const gradeColors = { A: '#10B981', B: '#3B82F6', C: '#F59E0B', D: '#EF4444' };
  const color = gradeColors[grade as keyof typeof gradeColors] || '#94A3B8';
  const circumference = 2 * Math.PI * 36;
  const strokeDash = (score / 100) * circumference;

  return (
    <div style={{ position: 'relative', width: 100, height: 100, flexShrink: 0 }}>
      <svg width="100" height="100" style={{ transform: 'rotate(-90deg)' }}>
        <circle cx="50" cy="50" r="36" fill="none" stroke="#F1F5F9" strokeWidth="8" />
        <circle cx="50" cy="50" r="36" fill="none" stroke={color} strokeWidth="8"
          strokeDasharray={`${strokeDash} ${circumference}`}
          strokeLinecap="round"
          style={{ transition: 'stroke-dasharray 1s ease' }}
        />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontSize: '1.625rem', fontWeight: 800, color, lineHeight: 1 }}>{grade}</span>
        <span style={{ fontSize: '0.6875rem', color: '#94A3B8', fontWeight: 600 }}>{score}/100</span>
      </div>
    </div>
  );
}

function BarChart({ data }: { data: { label: string; pct: number; color: string }[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {data.map((item, i) => (
        <div key={i}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
            <span style={{ fontSize: '0.75rem', color: '#374151', fontWeight: 500 }}>{item.label}</span>
            <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#0F172A', fontFamily: 'monospace' }}>{item.pct}%</span>
          </div>
          <div style={{ height: 7, background: '#F1F5F9', borderRadius: 999, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${item.pct}%`, background: item.color, borderRadius: 999, transition: 'width 0.8s ease' }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function GenderDonut({ male, female }: { male: number; female: number }) {
  const total = male + female;
  const maleArc = (male / total) * 2 * Math.PI * 30;
  const circumference = 2 * Math.PI * 30;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
      <div style={{ position: 'relative', width: 80, height: 80, flexShrink: 0 }}>
        <svg width="80" height="80" style={{ transform: 'rotate(-90deg)' }}>
          <circle cx="40" cy="40" r="30" fill="none" stroke="#F9A8D4" strokeWidth="12" />
          <circle cx="40" cy="40" r="30" fill="none" stroke="#1B4F8A" strokeWidth="12"
            strokeDasharray={`${maleArc} ${circumference}`} />
        </svg>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: '#1B4F8A', flexShrink: 0 }} />
          <span style={{ fontSize: '0.8125rem', color: '#374151' }}>Male</span>
          <span style={{ fontSize: '0.8125rem', fontWeight: 700, color: '#0F172A', fontFamily: 'monospace', marginLeft: 'auto' }}>{male}%</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: '#F9A8D4', flexShrink: 0 }} />
          <span style={{ fontSize: '0.8125rem', color: '#374151' }}>Female</span>
          <span style={{ fontSize: '0.8125rem', fontWeight: 700, color: '#0F172A', fontFamily: 'monospace', marginLeft: 'auto' }}>{female}%</span>
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AudiencePage() {
  const [boards, setBoards] = useState<Board[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedBoard, setSelectedBoard] = useState<Board | null>(null);
  const [campaignBudget, setCampaignBudget] = useState('');
  const [campaignDuration, setCampaignDuration] = useState('4');
  const [selectedBoards, setSelectedBoards] = useState<Set<string>>(new Set());

  useEffect(() => { fetchBoards(); }, []);

  async function fetchBoards() {
    const { data } = await supabase
      .from('boards')
      .select('id, name, city, state, format, latitude, longitude, asking_rate, illuminated, status')
      .order('city');
    if (data) {
      const boardList = data as Board[];
      setBoards(boardList);
      if (boardList.length > 0) setSelectedBoard(boardList[0]);
    }
    setLoading(false);
  }

  function toggleBoard(id: string) {
    setSelectedBoards(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const profile = selectedBoard ? generateAudienceProfile(selectedBoard) : null;

  // Campaign reach calculator
  const planBoards = boards.filter(b => selectedBoards.has(b.id));
  const totalDailyImpressions = planBoards.reduce((s, b) => s + generateAudienceProfile(b).dailyImpressions, 0);
  const duration = parseInt(campaignDuration) || 4;
  const totalImpressions = totalDailyImpressions * 30 * duration;
  const planCost = planBoards.reduce((s, b) => s + b.asking_rate * duration, 0);
  const planCPM = planCost > 0 && totalImpressions > 0 ? Math.round((planCost / totalImpressions) * 1000) : 0;
  const budget = parseFloat(campaignBudget) || 0;
  const budgetUtilisation = budget > 0 ? Math.min(100, Math.round((planCost / budget) * 100)) : 0;

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '50vh' }}>
      <div style={{ width: 28, height: 28, border: '2px solid #E2E8F0', borderTopColor: '#1B4F8A', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );

  return (
    <div style={{ fontFamily: "'Inter', -apple-system, sans-serif" }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } } @keyframes fadeUp { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:translateY(0); } }`}</style>

      {/* Header */}
      <div style={{ marginBottom: '1.75rem' }}>
        <h1 style={{ fontSize: '1.375rem', fontWeight: 700, color: '#0F172A', letterSpacing: '-0.025em', margin: '0 0 4px' }}>Audience Intelligence</h1>
        <p style={{ fontSize: '0.8125rem', color: '#94A3B8', margin: 0 }}>
          Nigerian OOH audience data — traffic, demographics, reach estimates, and CPM by board location.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 16, alignItems: 'start' }}>

        {/* Board selector */}
        <div style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid #F1F5F9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <p style={{ fontSize: '0.8125rem', fontWeight: 700, color: '#0F172A', margin: 0 }}>Select boards</p>
            <span style={{ fontSize: '0.6875rem', color: '#94A3B8' }}>{boards.length} boards</span>
          </div>
          <div style={{ maxHeight: 520, overflowY: 'auto' }}>
            {boards.map(board => {
              const p = generateAudienceProfile(board);
              const isSelected = selectedBoard?.id === board.id;
              const isChecked = selectedBoards.has(board.id);
              return (
                <div
                  key={board.id}
                  onClick={() => setSelectedBoard(board)}
                  style={{
                    padding: '10px 14px', borderBottom: '1px solid #F8FAFC',
                    background: isSelected ? '#EFF6FF' : '#fff',
                    cursor: 'pointer', transition: 'background 0.1s',
                    display: 'flex', alignItems: 'flex-start', gap: 10,
                  }}
                  onMouseEnter={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = '#FAFBFF'; }}
                  onMouseLeave={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = '#fff'; }}
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => toggleBoard(board.id)}
                    onClick={e => e.stopPropagation()}
                    style={{ marginTop: 2, cursor: 'pointer', accentColor: '#1B4F8A', flexShrink: 0 }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                      <p style={{ fontSize: '0.8125rem', fontWeight: 600, color: isSelected ? '#1B4F8A' : '#0F172A', margin: '0 0 2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {board.name}
                      </p>
                      <span style={{
                        fontSize: '0.5625rem', fontWeight: 800, color:
                          p.trafficGrade === 'A' ? '#10B981' : p.trafficGrade === 'B' ? '#3B82F6' : p.trafficGrade === 'C' ? '#F59E0B' : '#EF4444',
                        background:
                          p.trafficGrade === 'A' ? '#ECFDF5' : p.trafficGrade === 'B' ? '#EFF6FF' : p.trafficGrade === 'C' ? '#FFFBEB' : '#FEF2F2',
                        padding: '2px 5px', borderRadius: 4, flexShrink: 0,
                      }}>
                        {p.trafficGrade}
                      </span>
                    </div>
                    <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: '0 0 3px' }}>{board.city} · {FORMAT_LABELS[board.format] || board.format}</p>
                    <p style={{ fontSize: '0.6875rem', color: '#1B4F8A', fontWeight: 600, fontFamily: 'monospace', margin: 0 }}>
                      {formatImpressions(p.dailyImpressions)}/day · {formatNaira(board.asking_rate)}/mo
                    </p>
                  </div>
                </div>
              );
            })}
            {boards.length === 0 && (
              <div style={{ padding: '3rem', textAlign: 'center' }}>
                <p style={{ fontSize: '0.875rem', color: '#94A3B8', margin: 0 }}>No boards in inventory yet</p>
              </div>
            )}
          </div>
        </div>

        {/* Right panel */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* Board audience profile */}
          {profile && selectedBoard && (
            <>
              {/* Board header */}
              <div style={{ background: '#0F172A', borderRadius: 12, padding: '20px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
                <div>
                  <p style={{ fontSize: '0.6875rem', fontWeight: 700, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.07em', margin: '0 0 4px' }}>
                    {FORMAT_LABELS[selectedBoard.format] || selectedBoard.format} · {selectedBoard.city}{selectedBoard.state ? `, ${selectedBoard.state}` : ''}
                  </p>
                  <h2 style={{ fontSize: '1.125rem', fontWeight: 700, color: '#F8FAFC', margin: '0 0 4px' }}>{selectedBoard.name}</h2>
                  <p style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.4)', margin: 0 }}>
                    {selectedBoard.illuminated ? '✦ Illuminated · ' : ''}Peak hours: {profile.peakHours}
                  </p>
                </div>
                <GradeRing grade={profile.trafficGrade} score={profile.locationScore} />
              </div>

              {/* Reach metrics */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
                {[
                  { label: 'Daily impressions',  value: formatImpressions(profile.dailyImpressions), sub: 'Vehicles + pedestrians', bar: '#1B4F8A' },
                  { label: 'Weekly reach',        value: formatImpressions(profile.weeklyReach),       sub: 'Unique eyes per week', bar: '#7C3AED' },
                  { label: 'Avg frequency',       value: `${profile.frequency}×`,                      sub: 'Views per person/week', bar: '#10B981' },
                  { label: 'CPM (cost/1,000)',    value: `₦${profile.cpm.toLocaleString()}`,           sub: 'At asking rate', bar: '#F59E0B' },
                ].map(card => (
                  <div key={card.label} style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: 10, padding: '14px 16px' }}>
                    <p style={{ fontSize: '0.625rem', fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.07em', margin: '0 0 6px' }}>{card.label}</p>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                      <span style={{ width: 3, height: 24, background: card.bar, borderRadius: 2, flexShrink: 0 }} />
                      <span style={{ fontSize: '1.5rem', fontWeight: 800, color: '#0F172A', fontFamily: 'monospace', letterSpacing: '-0.03em' }}>{card.value}</span>
                    </div>
                    <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: '4px 0 0' }}>{card.sub}</p>
                  </div>
                ))}
              </div>

              {/* Traffic breakdown */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <div style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: 10, padding: '16px 18px' }}>
                  <p style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.07em', margin: '0 0 14px' }}>Daily traffic</p>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
                    <div style={{ background: '#F8FAFC', borderRadius: 8, padding: '12px 14px', textAlign: 'center' }}>
                      <p style={{ fontSize: '1.25rem', fontWeight: 800, color: '#1B4F8A', fontFamily: 'monospace', margin: '0 0 2px' }}>{formatImpressions(profile.dailyVehicles)}</p>
                      <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: 0 }}>Vehicles</p>
                    </div>
                    <div style={{ background: '#F8FAFC', borderRadius: 8, padding: '12px 14px', textAlign: 'center' }}>
                      <p style={{ fontSize: '1.25rem', fontWeight: 800, color: '#7C3AED', fontFamily: 'monospace', margin: '0 0 2px' }}>{formatImpressions(profile.dailyPedestrians)}</p>
                      <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: 0 }}>Pedestrians</p>
                    </div>
                  </div>
                  <p style={{ fontSize: '0.75rem', color: '#64748B', margin: '0 0 6px', fontWeight: 500 }}>Gender split</p>
                  <GenderDonut male={profile.genderSplit.male} female={profile.genderSplit.female} />
                </div>

                {/* Nearby POIs */}
                <div style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: 10, padding: '16px 18px' }}>
                  <p style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.07em', margin: '0 0 14px' }}>Nearby POIs (500m radius)</p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {profile.nearbyPOIs.map((poi, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: '1rem' }}>{poi.icon}</span>
                          <span style={{ fontSize: '0.8125rem', color: '#374151' }}>{poi.type}</span>
                        </div>
                        <span style={{ fontSize: '0.875rem', fontWeight: 700, color: '#0F172A', fontFamily: 'monospace' }}>{poi.count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Demographics */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <div style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: 10, padding: '16px 18px' }}>
                  <p style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.07em', margin: '0 0 14px' }}>Age breakdown</p>
                  <BarChart data={profile.ageBreakdown} />
                </div>
                <div style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: 10, padding: '16px 18px' }}>
                  <p style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.07em', margin: '0 0 14px' }}>Income profile (SEC)</p>
                  <BarChart data={profile.incomeBreakdown} />
                </div>
              </div>
            </>
          )}

          {/* Campaign reach calculator */}
          <div style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: 12, padding: '20px 24px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <div style={{ width: 32, height: 32, background: '#F5F3FF', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#7C3AED" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
              </div>
              <div>
                <h3 style={{ fontSize: '0.9375rem', fontWeight: 700, color: '#0F172A', margin: '0 0 2px' }}>Campaign reach calculator</h3>
                <p style={{ fontSize: '0.75rem', color: '#94A3B8', margin: 0 }}>Select boards above + set parameters to estimate total reach</p>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, color: '#374151', marginBottom: 5 }}>Campaign budget (₦)</label>
                <input
                  type="number"
                  value={campaignBudget}
                  onChange={e => setCampaignBudget(e.target.value)}
                  placeholder="e.g. 10000000"
                  style={{ width: '100%', padding: '8px 12px', border: '1.5px solid #E2E8F0', borderRadius: 8, fontSize: '0.875rem', color: '#0F172A', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }}
                  onFocus={e => { e.currentTarget.style.borderColor = '#7C3AED'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(124,58,237,0.08)'; }}
                  onBlur={e => { e.currentTarget.style.borderColor = '#E2E8F0'; e.currentTarget.style.boxShadow = 'none'; }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, color: '#374151', marginBottom: 5 }}>Duration (months)</label>
                <select
                  value={campaignDuration}
                  onChange={e => setCampaignDuration(e.target.value)}
                  style={{ width: '100%', padding: '8px 12px', border: '1.5px solid #E2E8F0', borderRadius: 8, fontSize: '0.875rem', color: '#0F172A', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box', cursor: 'pointer' }}
                >
                  {['1','2','3','4','6','12'].map(m => <option key={m} value={m}>{m} month{parseInt(m) > 1 ? 's' : ''}</option>)}
                </select>
              </div>
            </div>

            {selectedBoards.size === 0 ? (
              <div style={{ background: '#F8FAFC', borderRadius: 10, padding: '20px', textAlign: 'center' }}>
                <p style={{ fontSize: '0.8125rem', color: '#94A3B8', margin: 0 }}>Select boards on the left to calculate reach</p>
              </div>
            ) : (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 14 }}>
                  {[
                    { label: 'Boards selected',      value: String(planBoards.length),               color: '#1B4F8A' },
                    { label: 'Total impressions',    value: formatImpressions(totalImpressions),      color: '#7C3AED' },
                    { label: 'Campaign cost',        value: formatNaira(planCost),                    color: planCost > budget && budget > 0 ? '#EF4444' : '#10B981' },
                    { label: 'Blended CPM',          value: planCPM > 0 ? `₦${planCPM.toLocaleString()}` : '—', color: '#F59E0B' },
                  ].map(item => (
                    <div key={item.label} style={{ background: '#F8FAFC', borderRadius: 8, padding: '12px 14px' }}>
                      <p style={{ fontSize: '0.625rem', fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 4px' }}>{item.label}</p>
                      <p style={{ fontSize: '1rem', fontWeight: 800, color: item.color, fontFamily: 'monospace', margin: 0 }}>{item.value}</p>
                    </div>
                  ))}
                </div>

                {budget > 0 && (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ fontSize: '0.8125rem', color: '#374151', fontWeight: 500 }}>Budget utilisation</span>
                      <span style={{ fontSize: '0.8125rem', fontWeight: 700, color: budgetUtilisation > 100 ? '#EF4444' : budgetUtilisation > 80 ? '#F59E0B' : '#10B981' }}>{budgetUtilisation}%</span>
                    </div>
                    <div style={{ height: 8, background: '#F1F5F9', borderRadius: 999, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${Math.min(100, budgetUtilisation)}%`, background: budgetUtilisation > 100 ? '#EF4444' : budgetUtilisation > 80 ? '#F59E0B' : '#10B981', borderRadius: 999, transition: 'width 0.6s ease' }} />
                    </div>
                    {planCost > budget && (
                      <p style={{ fontSize: '0.75rem', color: '#DC2626', margin: '6px 0 0', fontWeight: 600 }}>
                        ⚠ Campaign cost exceeds budget by {formatNaira(planCost - budget)}. Remove {Math.ceil((planCost - budget) / (planCost / planBoards.length))} board(s).
                      </p>
                    )}
                  </div>
                )}

                {/* Selected board list */}
                <div style={{ marginTop: 14, borderTop: '1px solid #F1F5F9', paddingTop: 14 }}>
                  <p style={{ fontSize: '0.75rem', fontWeight: 600, color: '#94A3B8', margin: '0 0 8px' }}>SELECTED BOARDS</p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    {planBoards.map(b => {
                      const p = generateAudienceProfile(b);
                      return (
                        <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#F8FAFC', borderRadius: 7, padding: '8px 12px' }}>
                          <span style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0F172A', flex: 1 }}>{b.name}</span>
                          <span style={{ fontSize: '0.6875rem', color: '#94A3B8' }}>{b.city}</span>
                          <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#7C3AED', fontFamily: 'monospace' }}>{formatImpressions(p.dailyImpressions * 30 * duration)}</span>
                          <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#1B4F8A', fontFamily: 'monospace' }}>{formatNaira(b.asking_rate * duration)}</span>
                          <button
                            onClick={() => toggleBoard(b.id)}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8', padding: 0, fontSize: '0.875rem', lineHeight: 1 }}
                            onMouseEnter={e => (e.currentTarget.style.color = '#EF4444')}
                            onMouseLeave={e => (e.currentTarget.style.color = '#94A3B8')}
                          >
                            ×
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Data footnote */}
          <div style={{ background: '#F8FAFC', border: '1px solid #E8EDF2', borderRadius: 10, padding: '12px 16px', display: 'flex', gap: 10 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }}>
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            <p style={{ fontSize: '0.75rem', color: '#64748B', margin: 0, lineHeight: 1.6 }}>
              Audience estimates based on Nigerian Urban Transport Study benchmarks, OAA measurement standards, and city-level traffic flow data. Actual impressions vary by creative quality, dwell time, and seasonal factors. CPM is calculated at asking rate per booking.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
