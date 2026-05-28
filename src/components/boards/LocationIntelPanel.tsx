'use client';

import { useState, useEffect } from 'react';
import type { Board } from '@/app/dashboard/agency/boards-map/page';

type Props = {
  lat: number;
  lng: number;
  name: string;
  nearbyBoards: Board[];
  onClose: () => void;
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

const FORMAT_LABELS: Record<string, string> = {
  billboard: 'Billboard', unipole: 'Unipole', gantry: 'Gantry',
  bridge_panel: 'Bridge Panel', wall_drape: 'Wall Drape',
};

const STATUS_COLORS: Record<string, string> = {
  available:   '#10B981',
  booked:      '#3B82F6',
  maintenance: '#F59E0B',
};

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

export default function LocationIntelPanel({ lat, lng, name, nearbyBoards, onClose }: Props) {
  const [intel, setIntel] = useState<IntelData | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'intel' | 'boards' | 'streetview'>('intel');

  useEffect(() => {
    fetchIntel();
  }, [lat, lng]);

  async function fetchIntel() {
    setLoading(true);
    setIntel(null);
    try {
      const res = await fetch(`/api/location-intel?lat=${lat}&lng=${lng}&name=${encodeURIComponent(name)}`);
      const data = await res.json();
      setIntel(data);
    } catch { /* ignore */ }
    setLoading(false);
  }

  const TABS = [
    { id: 'intel' as const,      label: 'Intelligence', icon: '🧠' },
    { id: 'boards' as const,     label: `Boards (${nearbyBoards.length})`, icon: '📍' },
    { id: 'streetview' as const, label: 'Street View',  icon: '🚶' },
  ];

  return (
    <div style={{
      width: 320, flexShrink: 0, background: '#fff', borderLeft: '1px solid #E2E8F0',
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
      fontFamily: "'Inter', -apple-system, sans-serif",
    }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      {/* Header */}
      <div style={{ padding: '14px 16px 0', borderBottom: '1px solid #F1F5F9' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 12 }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <span style={{ fontSize: '0.625rem', fontWeight: 700, color: '#3B82F6', background: '#EFF6FF', padding: '2px 8px', borderRadius: 999, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                📍 Searched location
              </span>
            </div>
            <h3 style={{ fontSize: '0.9375rem', fontWeight: 700, color: '#0F172A', margin: 0, lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {name}
            </h3>
            <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: '2px 0 0', fontFamily: 'monospace' }}>
              {lat.toFixed(5)}, {lng.toFixed(5)}
            </p>
          </div>
          <button onClick={onClose}
            style={{ width: 26, height: 26, borderRadius: '50%', border: '1px solid #E2E8F0', background: '#F8FAFC', color: '#94A3B8', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, flexShrink: 0 }}>
            ✕
          </button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 2 }}>
          {TABS.map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              style={{
                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                padding: '7px 4px', border: 'none', background: 'none', cursor: 'pointer',
                fontSize: '0.6875rem', fontWeight: activeTab === tab.id ? 600 : 400,
                color: activeTab === tab.id ? '#1B4F8A' : '#94A3B8',
                borderBottom: `2px solid ${activeTab === tab.id ? '#1B4F8A' : 'transparent'}`,
                transition: 'all 0.15s', fontFamily: 'inherit', whiteSpace: 'nowrap',
              }}>
              <span style={{ fontSize: 11 }}>{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, overflowY: 'auto' }}>

        {/* INTELLIGENCE TAB */}
        {activeTab === 'intel' && (
          <div style={{ padding: 16 }}>
            {loading ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '3rem 0', gap: 12 }}>
                <div style={{ width: 30, height: 30, border: '2.5px solid #E2E8F0', borderTopColor: '#1B4F8A', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
                <p style={{ fontSize: '0.8125rem', color: '#64748B', margin: 0, fontWeight: 500 }}>Analysing location…</p>
                <p style={{ fontSize: '0.75rem', color: '#CBD5E1', margin: 0, textAlign: 'center' }}>Querying OpenStreetMap data</p>
              </div>
            ) : !intel ? (
              <div style={{ textAlign: 'center', padding: '2rem 0' }}>
                <p style={{ color: '#EF4444', fontSize: '0.8125rem' }}>Failed to load intelligence</p>
                <button onClick={fetchIntel} style={{ marginTop: 8, background: '#1B4F8A', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: '0.8125rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                  Retry
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

                {/* Area classification */}
                <div style={{ background: 'linear-gradient(135deg, #0F172A, #1E293B)', borderRadius: 12, padding: '14px 16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                    <span style={{ fontSize: '1.5rem' }}>{intel.area.icon}</span>
                    <div>
                      <p style={{ fontSize: '0.875rem', fontWeight: 700, color: '#F1F5F9', margin: 0 }}>{intel.area.type}</p>
                      <p style={{ fontSize: '0.6875rem', color: '#64748B', margin: '2px 0 0' }}>{intel.area.description}</p>
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                    <div style={{ background: 'rgba(255,255,255,0.07)', borderRadius: 8, padding: '10px 12px' }}>
                      <p style={{ fontSize: '1.25rem', fontWeight: 800, color: '#60A5FA', margin: 0, fontFamily: 'monospace', lineHeight: 1 }}>
                        {intel.impressions >= 1000 ? `${Math.round(intel.impressions / 1000)}K` : intel.impressions.toLocaleString()}
                      </p>
                      <p style={{ fontSize: '0.5625rem', color: '#64748B', margin: '4px 0 0', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        Est. daily impressions
                      </p>
                    </div>
                    <div style={{ background: 'rgba(255,255,255,0.07)', borderRadius: 8, padding: '10px 12px' }}>
                      <p style={{ fontSize: '1.25rem', fontWeight: 800, color: '#34D399', margin: 0, fontFamily: 'monospace', lineHeight: 1 }}>{intel.totalPOIs}</p>
                      <p style={{ fontSize: '0.5625rem', color: '#64748B', margin: '4px 0 0', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        POIs within 800m
                      </p>
                    </div>
                    <div style={{ background: 'rgba(255,255,255,0.07)', borderRadius: 8, padding: '10px 12px' }}>
                      <p style={{ fontSize: '1.25rem', fontWeight: 800, color: '#F59E0B', margin: 0, fontFamily: 'monospace', lineHeight: 1 }}>{nearbyBoards.length}</p>
                      <p style={{ fontSize: '0.5625rem', color: '#64748B', margin: '4px 0 0', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        Boards within 5km
                      </p>
                    </div>
                    <div style={{ background: 'rgba(255,255,255,0.07)', borderRadius: 8, padding: '10px 12px' }}>
                      <p style={{ fontSize: '0.5625rem', color: intel.dataSource === 'live' ? '#34D399' : '#F59E0B', margin: '0 0 4px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        {intel.dataSource === 'live' ? '● Live data' : '◌ Estimated'}
                      </p>
                      <p style={{ fontSize: '0.6875rem', color: '#64748B', margin: 0 }}>OpenStreetMap</p>
                    </div>
                  </div>
                </div>

                {/* Location scores */}
                <div style={{ background: '#F8FAFC', borderRadius: 12, padding: 14 }}>
                  <p style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 12px' }}>Location scores</p>
                  <ScoreBar label="Commercial activity" value={intel.scores.commercial} color="#2563EB" />
                  <ScoreBar label="Footfall density"    value={intel.scores.footfall}   color="#10B981" />
                  <ScoreBar label="Youth audience"      value={intel.scores.youth}      color="#8B5CF6" />
                  <ScoreBar label="Premium appeal"      value={intel.scores.premium}    color="#F59E0B" />
                </div>

                {/* Top POIs */}
                {intel.topPOIs.length > 0 && (
                  <div style={{ background: '#F8FAFC', borderRadius: 12, padding: 14 }}>
                    <p style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 10px' }}>
                      Top nearby POIs
                    </p>
                    {intel.topPOIs.map(poi => (
                      <div key={poi.label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 7 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 14 }}>{poi.icon}</span>
                          <span style={{ fontSize: '0.75rem', color: '#334155', fontWeight: 500 }}>{poi.label}</span>
                        </div>
                        <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#0F172A', background: '#E2E8F0', padding: '1px 8px', borderRadius: 999 }}>
                          {poi.count}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Recommended verticals */}
                <div style={{ background: '#F8FAFC', borderRadius: 12, padding: 14 }}>
                  <p style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 10px' }}>
                    Best campaign verticals
                  </p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {intel.verticals.map(v => (
                      <span key={v} style={{ background: '#EFF6FF', color: '#1D4ED8', padding: '4px 10px', borderRadius: 999, fontSize: '0.6875rem', fontWeight: 600 }}>
                        {v}
                      </span>
                    ))}
                  </div>
                </div>

                {/* AI narrative */}
                {intel.aiInsight && (
                  <div style={{ background: 'linear-gradient(135deg, #EFF6FF, #F5F3FF)', border: '1px solid #BFDBFE', borderRadius: 12, padding: 14 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                      <span>✨</span>
                      <p style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#1D4ED8', margin: 0, textTransform: 'uppercase', letterSpacing: '0.06em' }}>AI media brief</p>
                    </div>
                    <p style={{ fontSize: '0.8125rem', color: '#1E3A8A', lineHeight: 1.65, margin: 0 }}>{intel.aiInsight}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* NEARBY BOARDS TAB */}
        {activeTab === 'boards' && (
          <div style={{ padding: 16 }}>
            {nearbyBoards.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '3rem 0' }}>
                <div style={{ fontSize: '1.75rem', marginBottom: 8 }}>📍</div>
                <p style={{ fontSize: '0.875rem', color: '#64748B', fontWeight: 500, margin: '0 0 4px' }}>No boards nearby</p>
                <p style={{ fontSize: '0.75rem', color: '#CBD5E1', margin: 0 }}>No boards within 5km of this location</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <p style={{ fontSize: '0.75rem', color: '#94A3B8', margin: '0 0 4px' }}>
                  {nearbyBoards.length} board{nearbyBoards.length !== 1 ? 's' : ''} within 5km
                </p>
                {nearbyBoards.map(board => {
                  const photo = board.photos?.[0];
                  const statusColor = STATUS_COLORS[board.status] || STATUS_COLORS.available;
                  const dist = Math.round(
                    Math.sqrt(
                      Math.pow((board.latitude - lat) * 111, 2) +
                      Math.pow((board.longitude - lng) * 111 * Math.cos(lat * Math.PI / 180), 2)
                    ) * 10
                  ) / 10;

                  return (
                    <div key={board.id} style={{ display: 'flex', gap: 10, background: '#F8FAFC', borderRadius: 10, padding: 10, border: '1px solid #E2E8F0' }}>
                      <div style={{ width: 44, height: 44, borderRadius: 8, overflow: 'hidden', flexShrink: 0, background: '#E2E8F0' }}>
                        {photo
                          ? <img src={photo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          : <div style={{ width: '100%', height: '100%', background: 'linear-gradient(135deg,#1e293b,#334155)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12 }}>📷</div>
                        }
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 }}>
                          <p style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#0F172A', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {board.name}
                          </p>
                          <span style={{ width: 7, height: 7, borderRadius: '50%', background: statusColor, flexShrink: 0, marginLeft: 6 }} />
                        </div>
                        <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: 0 }}>
                          {FORMAT_LABELS[board.format || ''] || board.format} · {dist}km away
                        </p>
                        <p style={{ fontSize: '0.75rem', fontWeight: 700, color: '#1B4F8A', margin: '3px 0 0' }}>
                          ₦{Number(board.asking_rate || 0).toLocaleString('en-NG')}/mo
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* STREET VIEW TAB */}
        {activeTab === 'streetview' && (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <div style={{ padding: '10px 16px', background: '#F8FAFC', borderBottom: '1px solid #F1F5F9' }}>
              <p style={{ fontSize: '0.75rem', color: '#64748B', margin: 0 }}>
                Ground-level view of <strong>{name}</strong>
              </p>
            </div>
            <div style={{ flex: 1, minHeight: 400 }}>
              <iframe
                src={`https://www.google.com/maps/embed/v1/streetview?key=AIzaSyD-placeholder&location=${lat},${lng}&heading=0&pitch=0&fov=90`}
                style={{ width: '100%', height: '100%', border: 'none', minHeight: 400 }}
                title="Street View"
                allowFullScreen
                loading="lazy"
              />
            </div>
            <div style={{ padding: '10px 16px', borderTop: '1px solid #F1F5F9', display: 'flex', gap: 10 }}>
              <a href={`https://maps.google.com/?q=${lat},${lng}&layer=c`} target="_blank" rel="noopener noreferrer"
                style={{ fontSize: '0.75rem', color: '#1B4F8A', fontWeight: 600, textDecoration: 'none' }}>
                Open Street View →
              </a>
              <a href={`https://maps.google.com/?q=${lat},${lng}`} target="_blank" rel="noopener noreferrer"
                style={{ fontSize: '0.75rem', color: '#64748B', fontWeight: 500, textDecoration: 'none' }}>
                Open in Maps
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
