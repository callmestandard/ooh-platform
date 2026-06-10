'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import dynamic from 'next/dynamic';
import BoardDetailPanel from '@/components/boards/BoardDetailPanel';
import BookingRequestPanel from '@/components/boards/BookingRequestPanel';
import LocationIntelPanel from '@/components/boards/LocationIntelPanel';
import type { OverlayLayer } from '@/components/boards/BoardsMapView';
import type { AudienceProfile } from '@/lib/types';

const BoardsMapView = dynamic(() => import('@/components/boards/BoardsMapView'), {
  ssr: false,
  loading: () => (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', background: '#0F172A' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ width: 28, height: 28, border: '2px solid rgba(255,255,255,0.1)', borderTopColor: '#60A5FA', borderRadius: '50%', animation: 'spin 0.7s linear infinite', margin: '0 auto 10px' }} />
        <p style={{ fontSize: '0.8125rem', color: '#64748B', margin: 0 }}>Loading map...</p>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    </div>
  ),
});

export type Board = {
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

type SearchPin = { lat: number; lng: number; name: string };
type Filters = { status: string; format: string; city: string; audience: string };

const AUDIENCE_FILTERS = [
  { value: 'all',          label: 'All Audiences',     icon: '👥' },
  { value: 'youth',        label: 'Youth / Students',  icon: '🎓' },
  { value: 'professional', label: 'Professionals',     icon: '💼' },
  { value: 'transit',      label: 'Transit Commuters', icon: '🚌' },
  { value: 'premium',      label: 'Affluent / Premium',icon: '💎' },
];

const FORMAT_LABELS: Record<string, string> = {
  billboard: 'Billboard', unipole: 'Unipole', gantry: 'Gantry',
  bridge_panel: 'Bridge Panel', wall_drape: 'Wall Drape',
};

const STATUS_CONFIG = [
  { value: 'all',         label: 'All',         dot: '#94A3B8' },
  { value: 'available',   label: 'Available',   dot: '#10B981' },
  { value: 'booked',      label: 'Booked',      dot: '#3B82F6' },
  { value: 'maintenance', label: 'Maintenance', dot: '#F59E0B' },
];

const LAYER_CONFIG: { key: OverlayLayer; label: string; color: string; bg: string; icon: string }[] = [
  { key: 'universities', label: 'Universities',     color: '#2563EB', bg: '#DBEAFE', icon: '🎓' },
  { key: 'youth',        label: 'Youth clusters',   color: '#7C3AED', bg: '#EDE9FE', icon: '👥' },
  { key: 'traffic',      label: 'Traffic hotspots', color: '#D97706', bg: '#FEF3C7', icon: '🚦' },
];

export default function BoardsMapPage() {
  const [boards, setBoards]                         = useState<Board[]>([]);
  const [filteredBoards, setFilteredBoards]         = useState<Board[]>([]);
  const [selectedBoard, setSelectedBoard]           = useState<Board | null>(null);
  const [bookingBoard, setBookingBoard]             = useState<Board | null>(null);
  const [searchPin, setSearchPin]                   = useState<SearchPin | null>(null);
  const [loading, setLoading]                       = useState(true);
  const [filters, setFilters]                       = useState<Filters>({ status: 'all', format: 'all', city: 'all', audience: 'all' });
  const [activeLayers, setActiveLayers]             = useState<OverlayLayer[]>([]);
  const [showFilters, setShowFilters]               = useState(true);
  const [audienceProfiles, setAudienceProfiles]     = useState<Record<string, AudienceProfile>>({});
  const [enrichedCount, setEnrichedCount]           = useState(0);

  useEffect(() => { fetchBoards(); }, []);
  useEffect(() => { applyFilters(); }, [boards, filters, audienceProfiles]);

  async function fetchBoards() {
    const { data } = await supabase
      .from('boards')
      .select('id, name, address, city, state, format, asking_rate, status, latitude, longitude, width, height, photos')
      .order('created_at', { ascending: false })
      .limit(500);
    setBoards((data as Board[]) || []);
    setLoading(false);
  }

  function applyFilters() {
    let result = [...boards];
    if (filters.status !== 'all') result = result.filter(b => b.status === filters.status);
    if (filters.format !== 'all') result = result.filter(b => b.format === filters.format);
    if (filters.city !== 'all')   result = result.filter(b => b.city === filters.city);
    if (filters.audience !== 'all') {
      result = result.filter(b => {
        const p = audienceProfiles[b.id];
        if (!p) return false;
        switch (filters.audience) {
          case 'youth':        return p.youth_score > 50;
          case 'professional': return p.commercial_score > 55 && p.premium_score > 40;
          case 'transit':      return p.footfall_score > 60;
          case 'premium':      return p.premium_score > 55;
          default:             return true;
        }
      });
    }
    setFilteredBoards(result);
  }

  function updateFilter(key: keyof Filters, value: string) {
    setFilters(prev => ({ ...prev, [key]: value }));
  }

  function toggleLayer(layer: OverlayLayer) {
    setActiveLayers(prev =>
      prev.includes(layer) ? prev.filter(l => l !== layer) : [...prev, layer]
    );
  }

  function handleSearchPin(pin: SearchPin | null) {
    setSearchPin(pin);
    if (pin) {
      // Close any open board panel when searching a new location
      setSelectedBoard(null);
      setBookingBoard(null);
    }
  }

  const cities   = ['all', ...Array.from(new Set(boards.map(b => b.city).filter(Boolean))) as string[]];
  const formats  = ['all', ...Array.from(new Set(boards.map(b => b.format).filter(Boolean))) as string[]];
  const hasActiveFilters = filters.status !== 'all' || filters.format !== 'all' || filters.city !== 'all' || filters.audience !== 'all';

  const stats = {
    total:       boards.length,
    available:   boards.filter(b => b.status === 'available').length,
    booked:      boards.filter(b => b.status === 'booked').length,
    maintenance: boards.filter(b => b.status === 'maintenance').length,
  };

  const rightPanelOpen = !!selectedBoard || !!bookingBoard || !!searchPin;

  return (
    <div style={{ fontFamily: "'Inter', -apple-system, sans-serif", display: 'flex', flexDirection: 'column', height: 'calc(100vh - 56px)' }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      {/* ── Top bar ── */}
      <div style={{ marginBottom: 10, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <div>
            <h1 style={{ fontSize: '1.375rem', fontWeight: 700, color: '#0F172A', letterSpacing: '-0.025em', margin: '0 0 3px' }}>
              Boards Map
            </h1>
            <p style={{ fontSize: '0.8125rem', color: '#94A3B8', margin: 0 }}>
              Live OOH inventory · Search any location · AI location intelligence
            </p>
          </div>

          {/* Stats */}
          <div style={{ display: 'flex', gap: 8 }}>
            {[
              { label: 'Total',       value: stats.total,       color: '#0F172A' },
              { label: 'Available',   value: stats.available,   color: '#10B981' },
              { label: 'Booked',      value: stats.booked,      color: '#3B82F6' },
              { label: 'Maintenance', value: stats.maintenance, color: '#F59E0B' },
            ].map(({ label, value, color }) => (
              <div key={label} style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 8, padding: '6px 12px', textAlign: 'center' }}>
                <p style={{ fontSize: '0.5625rem', color: '#94A3B8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', margin: '0 0 2px' }}>{label}</p>
                <p style={{ fontSize: '1rem', fontWeight: 800, color, margin: 0, fontFamily: 'monospace' }}>{value}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Intelligence layer toggles */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748B' }}>Intelligence layers:</span>
          {LAYER_CONFIG.map(({ key, label, color, bg, icon }) => {
            const isActive = activeLayers.includes(key);
            return (
              <button key={key} onClick={() => toggleLayer(key)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '5px 12px', borderRadius: 20, cursor: 'pointer',
                  fontFamily: 'inherit', fontSize: '0.8125rem', fontWeight: 600,
                  border: `1.5px solid ${isActive ? color : '#E2E8F0'}`,
                  background: isActive ? bg : '#fff',
                  color: isActive ? color : '#94A3B8',
                  transition: 'all 0.15s',
                }}
              >
                <span style={{ fontSize: 13 }}>{icon}</span>
                {label}
                {isActive && <span style={{ fontSize: 10, opacity: 0.6 }}>✕</span>}
              </button>
            );
          })}
          {activeLayers.length > 0 && (
            <button onClick={() => setActiveLayers([])}
              style={{ fontSize: '0.75rem', color: '#94A3B8', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
              Clear all
            </button>
          )}

          {/* Filter toggle */}
          <button
            onClick={() => setShowFilters(v => !v)}
            style={{
              marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 5,
              padding: '5px 12px', borderRadius: 20, cursor: 'pointer',
              fontFamily: 'inherit', fontSize: '0.8125rem', fontWeight: 600,
              border: `1.5px solid ${hasActiveFilters ? '#1B4F8A' : '#E2E8F0'}`,
              background: hasActiveFilters ? '#EFF6FF' : '#fff',
              color: hasActiveFilters ? '#1B4F8A' : '#94A3B8',
              transition: 'all 0.15s',
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="4" y1="6" x2="20" y2="6"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="11" y1="18" x2="13" y2="18"/>
            </svg>
            Filters {hasActiveFilters ? '(active)' : ''}
          </button>
        </div>
      </div>

      {/* ── Map area ── */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', borderRadius: 12, overflow: 'hidden', border: '1px solid #E2E8F0', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>

        {/* Filter sidebar */}
        {showFilters && (
          <div style={{ width: 200, flexShrink: 0, background: '#fff', borderRight: '1px solid #E2E8F0', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ padding: '12px 14px', borderBottom: '1px solid #F1F5F9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#0F172A' }}>Filters</span>
              {hasActiveFilters && (
                <button onClick={() => setFilters({ status: 'all', format: 'all', city: 'all', audience: 'all' })}
                  style={{ fontSize: '0.75rem', color: '#1B4F8A', fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
                  Reset
                </button>
              )}
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: 10 }}>
              {/* Status */}
              <p style={{ fontSize: '0.5625rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 6px 4px' }}>Status</p>
              {STATUS_CONFIG.map(({ value, label, dot }) => (
                <button key={value} onClick={() => updateFilter('status', value)}
                  style={{ display: 'flex', alignItems: 'center', gap: 7, width: '100%', padding: '6px 8px', borderRadius: 7, border: 'none', cursor: 'pointer', fontFamily: 'inherit', background: filters.status === value ? '#EFF6FF' : 'transparent', color: filters.status === value ? '#1B4F8A' : '#475569', fontSize: '0.8125rem', fontWeight: filters.status === value ? 600 : 400, textAlign: 'left', marginBottom: 1 }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: dot, flexShrink: 0 }} />
                  {label}
                </button>
              ))}

              <div style={{ height: 1, background: '#F1F5F9', margin: '10px 0' }} />

              {/* Format */}
              <p style={{ fontSize: '0.5625rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 6px 4px' }}>Format</p>
              {formats.map(f => (
                <button key={f} onClick={() => updateFilter('format', f)}
                  style={{ display: 'block', width: '100%', padding: '6px 8px', borderRadius: 7, border: 'none', cursor: 'pointer', fontFamily: 'inherit', background: filters.format === f ? '#EFF6FF' : 'transparent', color: filters.format === f ? '#1B4F8A' : '#475569', fontSize: '0.8125rem', fontWeight: filters.format === f ? 600 : 400, textAlign: 'left', marginBottom: 1 }}>
                  {f === 'all' ? 'All formats' : (FORMAT_LABELS[f] || f)}
                </button>
              ))}

              <div style={{ height: 1, background: '#F1F5F9', margin: '10px 0' }} />

              {/* City */}
              <p style={{ fontSize: '0.5625rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 6px 4px' }}>City</p>
              {cities.map(c => (
                <button key={c} onClick={() => updateFilter('city', c)}
                  style={{ display: 'block', width: '100%', padding: '6px 8px', borderRadius: 7, border: 'none', cursor: 'pointer', fontFamily: 'inherit', background: filters.city === c ? '#EFF6FF' : 'transparent', color: filters.city === c ? '#1B4F8A' : '#475569', fontSize: '0.8125rem', fontWeight: filters.city === c ? 600 : 400, textAlign: 'left', marginBottom: 1 }}>
                  {c === 'all' ? 'All cities' : c}
                </button>
              ))}

              <div style={{ height: 1, background: '#F1F5F9', margin: '10px 0' }} />

              {/* Audience */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <p style={{ fontSize: '0.5625rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 0 4px' }}>Audience</p>
                {enrichedCount > 0 && (
                  <span style={{ fontSize: '0.5625rem', color: '#059669', fontWeight: 600, background: '#ECFDF5', padding: '1px 5px', borderRadius: 4 }}>
                    {enrichedCount} enriched
                  </span>
                )}
              </div>
              {enrichedCount === 0 && (
                <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: '0 0 8px 4px', lineHeight: 1.4 }}>
                  Open a board and click "Enrich" to enable audience filters.
                </p>
              )}
              {AUDIENCE_FILTERS.map(({ value, label, icon }) => (
                <button key={value} onClick={() => updateFilter('audience', value)}
                  style={{ display: 'flex', alignItems: 'center', gap: 7, width: '100%', padding: '6px 8px', borderRadius: 7, border: 'none', cursor: 'pointer', fontFamily: 'inherit', background: filters.audience === value ? '#F0FDF4' : 'transparent', color: filters.audience === value ? '#059669' : '#475569', fontSize: '0.8125rem', fontWeight: filters.audience === value ? 600 : 400, textAlign: 'left', marginBottom: 1 }}>
                  <span style={{ fontSize: 11 }}>{icon}</span>
                  {label}
                </button>
              ))}
            </div>

            {/* Legend */}
            <div style={{ padding: '10px 14px', borderTop: '1px solid #F1F5F9' }}>
              {[
                { dot: '#10B981', label: 'Available' },
                { dot: '#3B82F6', label: 'Booked' },
                { dot: '#F59E0B', label: 'Maintenance' },
              ].map(({ dot, label }) => (
                <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 4 }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: dot }} />
                  <span style={{ fontSize: '0.75rem', color: '#64748B' }}>{label}</span>
                </div>
              ))}
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 6, paddingTop: 6, borderTop: '1px solid #F8FAFC' }}>
                <svg width="7" height="9" viewBox="0 0 28 36"><path d="M14 0C6.268 0 0 6.268 0 14c0 9.333 14 22 14 22S28 23.333 28 14C28 6.268 21.732 0 14 0z" fill="#3B82F6"/></svg>
                <span style={{ fontSize: '0.75rem', color: '#64748B' }}>Searched location</span>
              </div>
            </div>
          </div>
        )}

        {/* Map */}
        <div style={{ flex: 1, position: 'relative', minWidth: 0 }}>
          {loading ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', background: '#0F172A' }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ width: 28, height: 28, border: '2px solid rgba(255,255,255,0.1)', borderTopColor: '#60A5FA', borderRadius: '50%', animation: 'spin 0.7s linear infinite', margin: '0 auto 10px' }} />
                <p style={{ fontSize: '0.8125rem', color: '#64748B', margin: 0 }}>Loading boards...</p>
              </div>
            </div>
          ) : (
            <BoardsMapView
              boards={filteredBoards}
              selectedBoard={selectedBoard ?? bookingBoard}
              onSelectBoard={(board) => {
                setSelectedBoard(board);
                setBookingBoard(null);
                if (board) setSearchPin(null);
              }}
              activeLayers={activeLayers}
              cityFilter={filters.city}
              onSearchPin={handleSearchPin}
            />
          )}

          {/* Boards shown badge */}
          <div style={{ position: 'absolute', bottom: 12, left: 12, zIndex: 10, background: 'rgba(15,23,42,0.9)', backdropFilter: 'blur(8px)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '5px 12px', fontSize: '0.75rem', fontWeight: 600, color: '#F1F5F9' }}>
            {filteredBoards.length} board{filteredBoards.length !== 1 ? 's' : ''} shown
          </div>
        </div>

        {/* Right panels — only one at a time */}
        {bookingBoard && (
          <BookingRequestPanel
            board={bookingBoard}
            onClose={() => setBookingBoard(null)}
            onSuccess={() => { setBookingBoard(null); fetchBoards(); }}
          />
        )}

        {selectedBoard && !bookingBoard && (
          <BoardDetailPanel
            board={selectedBoard}
            onClose={() => setSelectedBoard(null)}
            onBookingRequest={() => { setBookingBoard(selectedBoard); setSelectedBoard(null); }}
            audienceProfile={audienceProfiles[selectedBoard.id] ?? null}
          />
        )}

        {searchPin && !selectedBoard && !bookingBoard && (
          <LocationIntelPanel
            lat={searchPin.lat}
            lng={searchPin.lng}
            name={searchPin.name}
            nearbyBoards={filteredBoards.filter(b => {
              const dlat = b.latitude - searchPin.lat;
              const dlng = b.longitude - searchPin.lng;
              return Math.sqrt(dlat * dlat + dlng * dlng) < 0.05; // ~5km
            })}
            onClose={() => setSearchPin(null)}
          />
        )}
      </div>
    </div>
  );
}
