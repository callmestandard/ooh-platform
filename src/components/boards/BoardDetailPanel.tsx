'use client';

import { useState, useEffect } from 'react';
import type { AudienceProfile } from '@/lib/types';

type Board = {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  width?: number;
  height?: number;
  format?: string;
  asking_rate?: number;
  photos?: string[];
  status: 'available' | 'booked' | 'maintenance';
  state?: string;
  city?: string;
};

type Props = {
  board: Board;
  onClose: () => void;
  onBookingRequest?: () => void;
  audienceProfile?: AudienceProfile | null;
};

type IntelData = {
  area: { type: string; icon: string; description: string };
  scores: { commercial: number; footfall: number; youth: number; premium: number };
  impressions: number;
  topPOIs: { label: string; icon: string; count: number }[];
  verticals: string[];
  totalPOIs: number;
  aiInsight: string | null;
  dataSource: 'live' | 'estimated';
};

const STATUS_CONFIG = {
  available:   { label: 'Available',   dot: '#10B981', bg: '#ECFDF5', color: '#065F46' },
  booked:      { label: 'Booked',      dot: '#3B82F6', bg: '#EFF6FF', color: '#1D4ED8' },
  maintenance: { label: 'Maintenance', dot: '#F59E0B', bg: '#FFFBEB', color: '#92400E' },
};

const FORMAT_LABELS: Record<string, string> = {
  billboard: 'Billboard', unipole: 'Unipole', gantry: 'Gantry',
  bridge_panel: 'Bridge Panel', wall_drape: 'Wall Drape',
};

function formatNaira(amount?: number) {
  if (!amount) return '—';
  return '₦' + Number(amount).toLocaleString('en-NG');
}

function ScoreBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontSize: '0.6875rem', color: '#64748B', fontWeight: 500 }}>{label}</span>
        <span style={{ fontSize: '0.6875rem', color, fontWeight: 700 }}>{value}</span>
      </div>
      <div style={{ height: 4, background: '#F1F5F9', borderRadius: 99, overflow: 'hidden' }}>
        <div style={{
          height: '100%', width: `${value}%`, background: color,
          borderRadius: 99, transition: 'width 0.8s cubic-bezier(0.4,0,0.2,1)',
        }} />
      </div>
    </div>
  );
}

function derivePersonas(p: AudienceProfile) {
  const personas: { icon: string; label: string; desc: string; color: string; bg: string }[] = [];
  if (p.youth_score > 55)
    personas.push({ icon: '🎓', label: 'Students & Youth', desc: 'Gen Z & Millennials, 18–30', color: '#7C3AED', bg: '#F5F3FF' });
  if (p.commercial_score > 55 && p.premium_score > 40)
    personas.push({ icon: '💼', label: 'Professionals', desc: 'Working adults & decision-makers', color: '#1D4ED8', bg: '#EFF6FF' });
  if (p.footfall_score > 60)
    personas.push({ icon: '🚌', label: 'Transit Commuters', desc: 'Daily mass-transit users', color: '#0891B2', bg: '#ECFEFF' });
  if (p.commercial_score > 50 && p.footfall_score > 45)
    personas.push({ icon: '🛒', label: 'Active Shoppers', desc: 'High purchase-intent consumers', color: '#059669', bg: '#ECFDF5' });
  if (p.premium_score > 60)
    personas.push({ icon: '💎', label: 'Affluent Consumers', desc: 'High-income, brand-conscious', color: '#D97706', bg: '#FFFBEB' });
  if (personas.length === 0)
    personas.push({ icon: '🏘️', label: 'Local Community', desc: 'Residential neighbourhood audience', color: '#64748B', bg: '#F8FAFC' });
  return personas.slice(0, 3);
}

type TabId = 'details' | 'audience' | 'intelligence' | 'streetview';

export default function BoardDetailPanel({ board, onClose, onBookingRequest, audienceProfile }: Props) {
  const [activeTab, setActiveTab] = useState<TabId>('details');
  const [intel, setIntel] = useState<IntelData | null>(null);
  const [intelLoading, setIntelLoading] = useState(false);
  const [photoIdx, setPhotoIdx] = useState(0);
  const [localProfile, setLocalProfile] = useState<AudienceProfile | null>(null);
  const [enriching, setEnriching] = useState(false);
  const [enrichError, setEnrichError] = useState<string | null>(null);

  const status = STATUS_CONFIG[board.status] || STATUS_CONFIG.available;
  const photos = board.photos || [];
  const activeProfile = localProfile || audienceProfile || null;

  useEffect(() => {
    setActiveTab('details');
    setIntel(null);
    setPhotoIdx(0);
    setLocalProfile(null);
    setEnrichError(null);
  }, [board.id]);

  async function loadIntelligence() {
    if (intel || intelLoading) return;
    setIntelLoading(true);
    try {
      const res = await fetch(
        `/api/location-intel?lat=${board.latitude}&lng=${board.longitude}&name=${encodeURIComponent(board.name)}`
      );
      const data = await res.json();
      setIntel(data);
    } catch {
      // silently fail
    }
    setIntelLoading(false);
  }

  async function handleEnrich() {
    setEnriching(true);
    setEnrichError(null);
    try {
      const res = await fetch(`/api/boards/${board.id}/enrich`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Enrichment failed');
      setLocalProfile(data as AudienceProfile);
    } catch (err) {
      setEnrichError(err instanceof Error ? err.message : 'Enrichment failed');
    }
    setEnriching(false);
  }

  function handleTabClick(tab: TabId) {
    setActiveTab(tab);
    if (tab === 'intelligence') loadIntelligence();
  }

  const TABS: { id: TabId; label: string; icon: string }[] = [
    { id: 'details',      label: 'Details',     icon: '📋' },
    { id: 'audience',     label: 'Audience',    icon: '👥' },
    { id: 'intelligence', label: 'Intel',        icon: '🧠' },
    { id: 'streetview',   label: 'Street',       icon: '🚶' },
  ];

  return (
    <div style={{
      width: 320, flexShrink: 0, background: '#fff', borderLeft: '1px solid #E2E8F0',
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
      fontFamily: "'Inter', -apple-system, sans-serif",
    }}>
      {/* ── Header ── */}
      <div style={{ padding: '14px 16px 0', borderBottom: '1px solid #F1F5F9' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 12 }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 3 }}>
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                background: status.bg, color: status.color,
                padding: '2px 8px', borderRadius: 999, fontSize: '0.6875rem', fontWeight: 600,
              }}>
                <span style={{ width: 5, height: 5, borderRadius: '50%', background: status.dot }} />
                {status.label}
              </span>
              {board.format && (
                <span style={{ fontSize: '0.6875rem', color: '#64748B', background: '#F8FAFC', padding: '2px 7px', borderRadius: 4, fontWeight: 500 }}>
                  {FORMAT_LABELS[board.format] || board.format}
                </span>
              )}
              {activeProfile && (
                <span style={{ fontSize: '0.6875rem', color: '#059669', background: '#ECFDF5', padding: '2px 7px', borderRadius: 4, fontWeight: 600 }}>
                  ✓ Enriched
                </span>
              )}
            </div>
            <h3 style={{ fontSize: '0.9375rem', fontWeight: 700, color: '#0F172A', margin: 0, lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {board.name}
            </h3>
            <p style={{ fontSize: '0.75rem', color: '#94A3B8', margin: '2px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {board.address}
            </p>
          </div>
          <button
            onClick={onClose}
            style={{ width: 26, height: 26, borderRadius: '50%', border: '1px solid #E2E8F0', background: '#F8FAFC', color: '#94A3B8', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, flexShrink: 0 }}
          >✕</button>
        </div>

        {/* Tab bar */}
        <div style={{ display: 'flex', gap: 2 }}>
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => handleTabClick(tab.id)}
              style={{
                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                padding: '7px 0', border: 'none', background: 'none', cursor: 'pointer',
                fontSize: '0.6875rem', fontWeight: activeTab === tab.id ? 600 : 400,
                color: activeTab === tab.id ? '#1B4F8A' : '#94A3B8',
                borderBottom: `2px solid ${activeTab === tab.id ? '#1B4F8A' : 'transparent'}`,
                transition: 'all 0.15s', fontFamily: 'inherit',
              }}
            >
              <span style={{ fontSize: 10 }}>{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Tab content ── */}
      <div style={{ flex: 1, overflowY: 'auto' }}>

        {/* DETAILS TAB */}
        {activeTab === 'details' && (
          <div>
            <div style={{ height: 160, background: '#F1F5F9', position: 'relative', overflow: 'hidden' }}>
              {photos.length > 0 ? (
                <>
                  <img src={photos[photoIdx]} alt={board.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  {photos.length > 1 && (
                    <>
                      <button onClick={() => setPhotoIdx(p => (p - 1 + photos.length) % photos.length)}
                        style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', width: 26, height: 26, borderRadius: '50%', background: 'rgba(0,0,0,0.5)', border: 'none', color: '#fff', cursor: 'pointer', fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>‹</button>
                      <button onClick={() => setPhotoIdx(p => (p + 1) % photos.length)}
                        style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', width: 26, height: 26, borderRadius: '50%', background: 'rgba(0,0,0,0.5)', border: 'none', color: '#fff', cursor: 'pointer', fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>›</button>
                      <div style={{ position: 'absolute', bottom: 8, left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: 4 }}>
                        {photos.map((_, i) => (
                          <div key={i} style={{ width: i === photoIdx ? 16 : 5, height: 5, borderRadius: 99, background: i === photoIdx ? '#fff' : 'rgba(255,255,255,0.4)', transition: 'width 0.2s' }} />
                        ))}
                      </div>
                    </>
                  )}
                </>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', flexDirection: 'column', gap: 6 }}>
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#CBD5E1" strokeWidth="1.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  <p style={{ fontSize: '0.75rem', color: '#CBD5E1', margin: 0 }}>No photo available</p>
                </div>
              )}
            </div>

            <div style={{ padding: '14px 16px 0' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 12, padding: '12px 14px', marginBottom: 14 }}>
                <div>
                  <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: '0 0 2px', fontWeight: 500 }}>Monthly rate</p>
                  <p style={{ fontSize: '1.375rem', fontWeight: 800, color: '#0F172A', margin: 0, letterSpacing: '-0.03em', fontFamily: "'DM Mono', monospace" }}>
                    {formatNaira(board.asking_rate)}
                  </p>
                </div>
                {board.width && board.height && (
                  <div style={{ textAlign: 'right' }}>
                    <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: '0 0 2px', fontWeight: 500 }}>Dimensions</p>
                    <p style={{ fontSize: '0.875rem', fontWeight: 700, color: '#0F172A', margin: 0 }}>
                      {board.width}m × {board.height}m
                    </p>
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                {[
                  { label: 'City / State', value: [board.city, board.state].filter(Boolean).join(', ') || '—' },
                  { label: 'Address', value: board.address || '—' },
                  { label: 'GPS', value: `${board.latitude?.toFixed(5)}, ${board.longitude?.toFixed(5)}` },
                ].map(({ label, value }) => (
                  <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 0', borderBottom: '1px solid #F8FAFC', gap: 8 }}>
                    <span style={{ fontSize: '0.75rem', color: '#94A3B8', flexShrink: 0 }}>{label}</span>
                    <span style={{ fontSize: '0.75rem', fontWeight: 500, color: '#334155', textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis' }}>{value}</span>
                  </div>
                ))}
              </div>

              {/* Quick audience peek if enriched */}
              {activeProfile && (
                <div
                  onClick={() => setActiveTab('audience')}
                  style={{ marginTop: 14, background: 'linear-gradient(135deg, #F0FDF4, #ECFEFF)', border: '1px solid #A7F3D0', borderRadius: 10, padding: '10px 12px', cursor: 'pointer' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                      <p style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#059669', margin: '0 0 2px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Audience profile ready</p>
                      <p style={{ fontSize: '0.75rem', color: '#0F172A', margin: 0, fontWeight: 500 }}>{activeProfile.area_icon} {activeProfile.area_type}</p>
                    </div>
                    <span style={{ fontSize: '0.75rem', color: '#059669', fontWeight: 700 }}>View →</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* AUDIENCE TAB */}
        {activeTab === 'audience' && (
          <div style={{ padding: 16 }}>
            {!activeProfile ? (
              <div style={{ textAlign: 'center', padding: '2rem 0' }}>
                <div style={{ fontSize: '2.5rem', marginBottom: 10 }}>👥</div>
                <p style={{ fontSize: '0.9375rem', fontWeight: 700, color: '#0F172A', margin: '0 0 6px' }}>No audience data yet</p>
                <p style={{ fontSize: '0.8125rem', color: '#64748B', margin: '0 0 20px', lineHeight: 1.6 }}>
                  Enrich this board to discover who sees it — demographics, foot traffic, and brand fit.
                </p>
                {enrichError && (
                  <p style={{ fontSize: '0.75rem', color: '#EF4444', margin: '0 0 12px', background: '#FEF2F2', padding: '8px 12px', borderRadius: 8 }}>{enrichError}</p>
                )}
                <button
                  onClick={handleEnrich}
                  disabled={enriching}
                  style={{
                    background: enriching ? '#94A3B8' : '#1B4F8A', color: '#fff', border: 'none',
                    borderRadius: 10, padding: '11px 22px', fontSize: '0.875rem', fontWeight: 600,
                    cursor: enriching ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
                    display: 'inline-flex', alignItems: 'center', gap: 8,
                  }}
                >
                  {enriching && (
                    <span style={{ width: 14, height: 14, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', display: 'inline-block', animation: 'spin 0.7s linear infinite' }} />
                  )}
                  {enriching ? 'Enriching location…' : 'Enrich this board →'}
                </button>
                <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

                {/* Area header */}
                <div style={{ background: 'linear-gradient(135deg, #0F172A, #1E293B)', borderRadius: 12, padding: '14px 16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 10 }}>
                    <span style={{ fontSize: '1.5rem' }}>{activeProfile.area_icon}</span>
                    <div>
                      <p style={{ fontSize: '0.875rem', fontWeight: 700, color: '#F1F5F9', margin: 0 }}>{activeProfile.area_type}</p>
                      <p style={{ fontSize: '0.6875rem', color: '#64748B', margin: '2px 0 0' }}>{activeProfile.area_description}</p>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <div style={{ flex: 1, background: 'rgba(255,255,255,0.06)', borderRadius: 8, padding: '8px 10px', textAlign: 'center' }}>
                      <p style={{ fontSize: '1.125rem', fontWeight: 800, color: '#60A5FA', margin: 0, fontFamily: 'monospace' }}>
                        {activeProfile.daily_impressions >= 1000
                          ? `${Math.round(activeProfile.daily_impressions / 1000)}K`
                          : activeProfile.daily_impressions.toLocaleString()}
                      </p>
                      <p style={{ fontSize: '0.5625rem', color: '#64748B', margin: '2px 0 0', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Daily impressions</p>
                    </div>
                    <div style={{ flex: 1, background: 'rgba(255,255,255,0.06)', borderRadius: 8, padding: '8px 10px', textAlign: 'center' }}>
                      <p style={{ fontSize: '1.125rem', fontWeight: 800, color: '#34D399', margin: 0, fontFamily: 'monospace' }}>{activeProfile.total_pois}</p>
                      <p style={{ fontSize: '0.5625rem', color: '#64748B', margin: '2px 0 0', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.06em' }}>POIs within 800m</p>
                    </div>
                  </div>
                </div>

                {/* Audience personas */}
                <div>
                  <p style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 10px' }}>Who sees this board</p>
                  {derivePersonas(activeProfile).map(persona => (
                    <div key={persona.label} style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      background: persona.bg, borderRadius: 10, padding: '10px 12px', marginBottom: 8,
                      border: `1px solid ${persona.color}22`,
                    }}>
                      <span style={{ fontSize: 22, flexShrink: 0 }}>{persona.icon}</span>
                      <div>
                        <p style={{ fontSize: '0.8125rem', fontWeight: 700, color: persona.color, margin: 0 }}>{persona.label}</p>
                        <p style={{ fontSize: '0.6875rem', color: '#64748B', margin: '1px 0 0' }}>{persona.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Audience scores */}
                <div style={{ background: '#F8FAFC', borderRadius: 12, padding: 14 }}>
                  <p style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 12px' }}>Audience signals</p>
                  <ScoreBar label="Footfall density"    value={activeProfile.footfall_score}   color="#10B981" />
                  <ScoreBar label="Youth audience"      value={activeProfile.youth_score}      color="#8B5CF6" />
                  <ScoreBar label="Commercial activity" value={activeProfile.commercial_score} color="#2563EB" />
                  <ScoreBar label="Premium appeal"      value={activeProfile.premium_score}    color="#F59E0B" />
                </div>

                {/* Recommended verticals */}
                {activeProfile.verticals.length > 0 && (
                  <div style={{ background: '#F8FAFC', borderRadius: 12, padding: 14 }}>
                    <p style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 10px' }}>Best brand categories</p>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {activeProfile.verticals.map(v => (
                        <span key={v} style={{ background: '#EFF6FF', color: '#1D4ED8', padding: '4px 10px', borderRadius: 999, fontSize: '0.6875rem', fontWeight: 600 }}>{v}</span>
                      ))}
                    </div>
                  </div>
                )}

                {/* AI insight */}
                {activeProfile.ai_insight && (
                  <div style={{ background: 'linear-gradient(135deg, #EFF6FF, #F5F3FF)', border: '1px solid #BFDBFE', borderRadius: 12, padding: 14 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                      <span style={{ fontSize: 13 }}>✨</span>
                      <p style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#1D4ED8', margin: 0, textTransform: 'uppercase', letterSpacing: '0.06em' }}>AI media brief</p>
                    </div>
                    <p style={{ fontSize: '0.8125rem', color: '#1E3A8A', lineHeight: 1.6, margin: 0 }}>{activeProfile.ai_insight}</p>
                  </div>
                )}

                {/* Enriched at + re-enrich */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <p style={{ fontSize: '0.6875rem', color: '#CBD5E1', margin: 0 }}>
                    Last enriched: {new Date(activeProfile.enriched_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                    {activeProfile.data_source === 'estimated' && ' · estimated data'}
                  </p>
                  <button
                    onClick={handleEnrich}
                    disabled={enriching}
                    style={{ fontSize: '0.6875rem', color: '#1B4F8A', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 }}
                  >
                    {enriching ? 'Refreshing…' : 'Refresh ↺'}
                  </button>
                </div>

              </div>
            )}
          </div>
        )}

        {/* INTELLIGENCE TAB */}
        {activeTab === 'intelligence' && (
          <div style={{ padding: 16 }}>
            {intelLoading ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '2rem 0', gap: 12 }}>
                <div style={{ width: 28, height: 28, border: '2px solid #E2E8F0', borderTopColor: '#1B4F8A', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
                <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
                <p style={{ fontSize: '0.8125rem', color: '#94A3B8', margin: 0 }}>Analysing location…</p>
                <p style={{ fontSize: '0.75rem', color: '#CBD5E1', margin: 0, textAlign: 'center' }}>Fetching nearby POIs from OpenStreetMap</p>
              </div>
            ) : !intel ? (
              <div style={{ textAlign: 'center', padding: '2rem 0' }}>
                <div style={{ fontSize: '2rem', marginBottom: 8 }}>🧠</div>
                <p style={{ fontSize: '0.875rem', color: '#64748B', margin: '0 0 12px' }}>Location intelligence</p>
                <button onClick={loadIntelligence}
                  style={{ background: '#1B4F8A', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 18px', fontSize: '0.8125rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                  Analyse this location
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div style={{ background: 'linear-gradient(135deg, #0F172A, #1E293B)', borderRadius: 12, padding: '14px 16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <span style={{ fontSize: '1.25rem' }}>{intel.area.icon}</span>
                    <div>
                      <p style={{ fontSize: '0.8125rem', fontWeight: 700, color: '#F1F5F9', margin: 0 }}>{intel.area.type}</p>
                      <p style={{ fontSize: '0.6875rem', color: '#64748B', margin: '1px 0 0' }}>{intel.area.description}</p>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                    <div style={{ flex: 1, background: 'rgba(255,255,255,0.06)', borderRadius: 8, padding: '8px 10px', textAlign: 'center' }}>
                      <p style={{ fontSize: '1.125rem', fontWeight: 800, color: '#60A5FA', margin: 0, fontFamily: 'monospace' }}>
                        {intel.impressions >= 1000 ? `${Math.round(intel.impressions / 1000)}K` : intel.impressions.toLocaleString()}
                      </p>
                      <p style={{ fontSize: '0.5625rem', color: '#64748B', margin: '2px 0 0', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Est. daily impressions</p>
                    </div>
                    <div style={{ flex: 1, background: 'rgba(255,255,255,0.06)', borderRadius: 8, padding: '8px 10px', textAlign: 'center' }}>
                      <p style={{ fontSize: '1.125rem', fontWeight: 800, color: '#34D399', margin: 0, fontFamily: 'monospace' }}>{intel.totalPOIs}</p>
                      <p style={{ fontSize: '0.5625rem', color: '#64748B', margin: '2px 0 0', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.06em' }}>POIs within 800m</p>
                    </div>
                  </div>
                  {intel.dataSource === 'estimated' && (
                    <p style={{ fontSize: '0.5625rem', color: '#475569', margin: '8px 0 0', textAlign: 'center' }}>
                      ⚠ No live OSM data — metrics are estimated
                    </p>
                  )}
                </div>

                <div style={{ background: '#F8FAFC', borderRadius: 12, padding: 14 }}>
                  <p style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 12px' }}>Location scores</p>
                  <ScoreBar label="Commercial activity" value={intel.scores.commercial} color="#2563EB" />
                  <ScoreBar label="Footfall density"    value={intel.scores.footfall}   color="#10B981" />
                  <ScoreBar label="Youth audience"      value={intel.scores.youth}      color="#8B5CF6" />
                  <ScoreBar label="Premium appeal"      value={intel.scores.premium}    color="#F59E0B" />
                </div>

                {intel.topPOIs.length > 0 && (
                  <div style={{ background: '#F8FAFC', borderRadius: 12, padding: 14 }}>
                    <p style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 10px' }}>Top nearby POIs</p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {intel.topPOIs.map(poi => (
                        <div key={poi.label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                            <span style={{ fontSize: 14 }}>{poi.icon}</span>
                            <span style={{ fontSize: '0.75rem', color: '#334155', fontWeight: 500 }}>{poi.label}</span>
                          </div>
                          <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#0F172A', background: '#E2E8F0', padding: '1px 7px', borderRadius: 99 }}>{poi.count}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div style={{ background: '#F8FAFC', borderRadius: 12, padding: 14 }}>
                  <p style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 10px' }}>Best campaign verticals</p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {intel.verticals.map(v => (
                      <span key={v} style={{ background: '#EFF6FF', color: '#1D4ED8', padding: '4px 10px', borderRadius: 999, fontSize: '0.6875rem', fontWeight: 600 }}>{v}</span>
                    ))}
                  </div>
                </div>

                {intel.aiInsight && (
                  <div style={{ background: 'linear-gradient(135deg, #EFF6FF, #F5F3FF)', border: '1px solid #BFDBFE', borderRadius: 12, padding: 14 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                      <span style={{ fontSize: 14 }}>✨</span>
                      <p style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#1D4ED8', margin: 0, textTransform: 'uppercase', letterSpacing: '0.06em' }}>AI media brief</p>
                    </div>
                    <p style={{ fontSize: '0.8125rem', color: '#1E3A8A', lineHeight: 1.6, margin: 0 }}>{intel.aiInsight}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* STREET VIEW TAB */}
        {activeTab === 'streetview' && (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <div style={{ padding: '12px 16px', background: '#F8FAFC', borderBottom: '1px solid #F1F5F9' }}>
              <p style={{ fontSize: '0.75rem', color: '#64748B', margin: 0, lineHeight: 1.4 }}>
                Explore the street around this board location using Google Street View.
              </p>
            </div>
            <div style={{ flex: 1, minHeight: 400 }}>
              <iframe
                src={`https://www.google.com/maps/embed/v1/streetview?key=AIzaSyD-placeholder&location=${board.latitude},${board.longitude}&heading=0&pitch=0&fov=90`}
                style={{ width: '100%', height: '100%', border: 'none', minHeight: 400 }}
                title="Street View"
                allowFullScreen
                loading="lazy"
              />
            </div>
            <div style={{ padding: '10px 16px', background: '#F8FAFC', borderTop: '1px solid #F1F5F9' }}>
              <a
                href={`https://maps.google.com/?q=${board.latitude},${board.longitude}&layer=c`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ fontSize: '0.75rem', color: '#1B4F8A', fontWeight: 600, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4 }}
              >
                Open in Google Maps →
              </a>
            </div>
          </div>
        )}
      </div>

      {/* ── Actions ── */}
      <div style={{ padding: '12px 16px', borderTop: '1px solid #F1F5F9' }}>
        {board.status === 'available' ? (
          <button
            onClick={onBookingRequest}
            style={{
              width: '100%', background: '#1B4F8A', color: '#fff', border: 'none',
              padding: '11px 0', borderRadius: 10, fontSize: '0.875rem', fontWeight: 600,
              cursor: 'pointer', fontFamily: 'inherit', letterSpacing: '0.01em',
              transition: 'background 0.15s',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = '#163f6e'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = '#1B4F8A'; }}
          >
            Send booking request →
          </button>
        ) : (
          <div style={{ textAlign: 'center', padding: '10px 0', background: '#F8FAFC', borderRadius: 10, fontSize: '0.8125rem', color: '#94A3B8', border: '1px solid #E2E8F0' }}>
            {board.status === 'booked' ? 'Currently booked' : 'Under maintenance'}
          </div>
        )}
      </div>
    </div>
  );
}
