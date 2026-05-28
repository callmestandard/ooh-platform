'use client';

import { useState, useCallback, useRef } from 'react';
import Map, { Marker, NavigationControl, Source, Layer, MapRef } from 'react-map-gl/maplibre';
import type { MapMouseEvent } from 'maplibre-gl';
import type { Board } from '@/app/dashboard/agency/boards-map/page';

export type OverlayLayer = 'universities' | 'youth' | 'traffic';

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || '';

const MAP_STYLES = {
  streets: {
    label: 'Streets', icon: '🗺️',
    url: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
  },
  dark: {
    label: 'Dark', icon: '🌙',
    url: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
  },
  satellite: {
    label: 'Satellite', icon: '🛰️',
    url: MAPBOX_TOKEN
      ? `https://api.mapbox.com/styles/v1/mapbox/satellite-streets-v12?access_token=${MAPBOX_TOKEN}`
      : 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
  },
};

const STATUS_COLORS: Record<string, string> = {
  available:   '#10B981',
  booked:      '#3B82F6',
  maintenance: '#F59E0B',
};

type IntelPoint = { id: string; name: string; lat: number; lng: number; city: string; reach: string; detail: string };

const UNIVERSITIES: IntelPoint[] = [
  { id: 'u1', name: 'University of Lagos',         lat: 6.5158,  lng: 3.3877,  city: 'Lagos',  reach: '50,000 students', detail: 'Yaba — highest footfall campus in Nigeria' },
  { id: 'u2', name: 'Lagos State University',      lat: 6.4653,  lng: 3.2350,  city: 'Lagos',  reach: '35,000 students', detail: 'Ojo — Isale Eko corridor' },
  { id: 'u3', name: 'Yaba College of Technology',  lat: 6.5095,  lng: 3.3752,  city: 'Lagos',  reach: '20,000 students', detail: 'Yaba — tech-savvy youth' },
  { id: 'u5', name: 'University of Abuja',         lat: 8.9855,  lng: 7.3776,  city: 'Abuja',  reach: '30,000 students', detail: 'Gwagwalada campus' },
  { id: 'u6', name: 'Nile University',             lat: 9.0567,  lng: 7.4609,  city: 'Abuja',  reach: '12,000 students', detail: 'Jabi — affluent market' },
  { id: 'u8', name: 'University of Port Harcourt', lat: 4.8983,  lng: 6.9054,  city: 'PH',     reach: '40,000 students', detail: 'Choba — oil-belt youth' },
  { id: 'u10',name: 'Bayero University Kano',      lat: 12.0022, lng: 8.5920,  city: 'Kano',   reach: '45,000 students', detail: 'Largest northern campus' },
];

const YOUTH_CLUSTERS: IntelPoint[] = [
  { id: 'y1', name: 'Yaba Tech Corridor',   lat: 6.5095, lng: 3.3782, city: 'Lagos', reach: '200,000 daily', detail: 'Highest youth density in Lagos' },
  { id: 'y2', name: 'Lekki Phase 1',        lat: 6.4421, lng: 3.4735, city: 'Lagos', reach: '150,000 daily', detail: 'Affluent 18-35 demographic' },
  { id: 'y5', name: 'Victoria Island',      lat: 6.4281, lng: 3.4219, city: 'Lagos', reach: '250,000 daily', detail: 'Premium commercial' },
  { id: 'y6', name: 'Wuse 2 / Maitama',    lat: 9.0735, lng: 7.4891, city: 'Abuja', reach: '100,000 daily', detail: 'Upscale youth zone' },
  { id: 'y8', name: 'GRA Phase 2 PH',      lat: 4.8156, lng: 7.0134, city: 'PH',    reach: '90,000 daily',  detail: 'Oil industry youth' },
];

const TRAFFIC_HOTSPOTS: IntelPoint[] = [
  { id: 't1', name: 'Third Mainland Bridge', lat: 6.5000,  lng: 3.3900, city: 'Lagos', reach: '400,000 vehicles/day', detail: 'Captive audience' },
  { id: 't2', name: 'Oshodi Interchange',    lat: 6.5567,  lng: 3.3490, city: 'Lagos', reach: '500,000 people/day',   detail: 'Busiest transit hub in West Africa' },
  { id: 't3', name: 'Lekki-Epe Expressway', lat: 6.4700,  lng: 3.5200, city: 'Lagos', reach: '250,000 vehicles/day', detail: 'Premium corridor' },
  { id: 't6', name: 'Ahmadu Bello Way',      lat: 9.0590,  lng: 7.4910, city: 'Abuja', reach: '180,000 vehicles/day', detail: 'Main commercial artery' },
  { id: 't8', name: 'Aba Road PH',          lat: 4.8400,  lng: 7.0200, city: 'PH',    reach: '220,000 vehicles/day', detail: 'Main PH arterial' },
  { id: 't9', name: 'Kano-Zaria Road',      lat: 12.0200, lng: 8.5800, city: 'Kano',  reach: '300,000 vehicles/day', detail: 'Northern Nigeria highest traffic' },
];

type SearchResult = { place_name: string; lat: number; lng: number; mapbox_id?: string };
type SearchPin   = { lat: number; lng: number; name: string };

type RouteInfo = {
  distance: number;   // metres
  duration: number;   // seconds
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  geometry: any;      // GeoJSON LineString
};

type Props = {
  boards: Board[];
  selectedBoard: Board | null;
  onSelectBoard: (board: Board | null) => void;
  activeLayers: OverlayLayer[];
  cityFilter: string;
  onSearchPin?: (pin: SearchPin | null) => void;
};

export default function BoardsMapView({ boards, selectedBoard, onSelectBoard, activeLayers, cityFilter, onSearchPin }: Props) {
  const mapRef = useRef<MapRef>(null);
  const [mapStyle, setMapStyle] = useState<keyof typeof MAP_STYLES>('streets');

  // ── Search state ──────────────────────────────────────────────────────────
  const [searchQuery, setSearchQuery]     = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchPin, setSearchPin]         = useState<SearchPin | null>(null);
  const [searching, setSearching]         = useState(false);
  // Session token for Mapbox Search Box API (rotated after each retrieval for correct billing)
  const geocodeSession = useRef(typeof crypto !== 'undefined' ? crypto.randomUUID() : Math.random().toString(36));

  // ── Route planner state ───────────────────────────────────────────────────
  const [routeMode, setRouteMode]         = useState(false);
  const [routeBoards, setRouteBoards]     = useState<Board[]>([]);
  const [routeInfo, setRouteInfo]         = useState<RouteInfo | null>(null);
  const [routeLoading, setRouteLoading]   = useState(false);

  const handleMapClick = useCallback((_e: MapMouseEvent) => {
    if (!routeMode) onSelectBoard(null);
  }, [routeMode, onSelectBoard]);

  function filterByCity<T extends IntelPoint>(pts: T[]): T[] {
    if (!cityFilter || cityFilter === 'all') return pts;
    return pts.filter(p => p.city.toLowerCase() === cityFilter.toLowerCase());
  }

  // ── Geocoding: Mapbox Search Box API v1 (best Nigeria coverage) ──────────
  async function handleSearch(q: string) {
    setSearchQuery(q);
    if (q.length < 2) { setSearchResults([]); return; }
    setSearching(true);
    try {
      if (MAPBOX_TOKEN) {
        // Mapbox Search Box API v1 — no Lagos proximity bias, full Nigeria
        // Nigeria bounding box: west,south,east,north
        const url = new URL('https://api.mapbox.com/search/searchbox/v1/suggest');
        url.searchParams.set('q', q);
        url.searchParams.set('access_token', MAPBOX_TOKEN);
        url.searchParams.set('session_token', geocodeSession.current);
        url.searchParams.set('country', 'NG');
        url.searchParams.set('limit', '8');
        url.searchParams.set('language', 'en');
        url.searchParams.set('bbox', '2.676,3.917,14.678,13.886'); // Nigeria bounds

        const res = await fetch(url.toString());
        const data = await res.json();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const suggestions: any[] = data.suggestions || [];
        setSearchResults(
          suggestions.map(s => ({
            place_name: [s.name, s.place_formatted].filter(Boolean).join(', '),
            mapbox_id: s.mapbox_id,
            lat: 0,
            lng: 0,
          }))
        );
      } else {
        // Nominatim fallback — Nigeria-wide, no Lagos bias
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q + ', Nigeria')}&format=json&limit=8&addressdetails=1&countrycodes=ng`,
          { headers: { 'Accept-Language': 'en', 'User-Agent': 'OOH-Platform/1.0' } }
        );
        const data = await res.json();
        setSearchResults(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (data as any[]).map((r: any) => ({
            place_name: r.display_name,
            lat: parseFloat(r.lat),
            lng: parseFloat(r.lon),
          }))
        );
      }
    } catch { /* ignore network errors */ }
    setSearching(false);
  }

  async function selectResult(result: SearchResult) {
    // Mapbox Search Box API: need a retrieve call to get coordinates
    if (result.mapbox_id && MAPBOX_TOKEN) {
      try {
        const url = new URL(`https://api.mapbox.com/search/searchbox/v1/retrieve/${result.mapbox_id}`);
        url.searchParams.set('access_token', MAPBOX_TOKEN);
        url.searchParams.set('session_token', geocodeSession.current);
        const res = await fetch(url.toString());
        const data = await res.json();
        const feature = data.features?.[0];
        if (feature) {
          const [lng, lat] = feature.geometry.coordinates as [number, number];
          const pin: SearchPin = { lat, lng, name: result.place_name.split(',')[0] };
          setSearchPin(pin);
          setSearchQuery(result.place_name.split(',')[0]);
          setSearchResults([]);
          onSearchPin?.(pin);
          mapRef.current?.flyTo({ center: [lng, lat], zoom: 14, duration: 1200 });
          // Rotate session token — each suggest→retrieve cycle should use one token
          geocodeSession.current = typeof crypto !== 'undefined' ? crypto.randomUUID() : Math.random().toString(36);
          return;
        }
      } catch { /* fall through to direct coords */ }
    }
    // Direct coords path (Nominatim fallback or legacy)
    const pin: SearchPin = { lat: result.lat, lng: result.lng, name: result.place_name.split(',')[0] };
    setSearchPin(pin);
    setSearchQuery(result.place_name.split(',')[0]);
    setSearchResults([]);
    onSearchPin?.(pin);
    mapRef.current?.flyTo({ center: [result.lng, result.lat], zoom: 14, duration: 1200 });
  }

  function clearSearch() {
    setSearchQuery('');
    setSearchResults([]);
    setSearchPin(null);
    onSearchPin?.(null);
  }

  // ── Route planner ─────────────────────────────────────────────────────────
  function toggleRouteBoard(board: Board) {
    if (!board.latitude || !board.longitude) return;
    setRouteBoards(prev => {
      const exists = prev.find(b => b.id === board.id);
      if (exists) return prev.filter(b => b.id !== board.id);
      return [...prev, board];
    });
    setRouteInfo(null);
  }

  async function calculateRoute() {
    const geo = routeBoards.filter(b => b.latitude && b.longitude);
    if (geo.length < 2 || !MAPBOX_TOKEN) return;
    setRouteLoading(true);
    try {
      const waypoints = geo.map(b => `${b.longitude},${b.latitude}`).join(';');
      const res = await fetch(
        `https://api.mapbox.com/directions/v5/mapbox/driving/${waypoints}?geometries=geojson&overview=full&steps=false&access_token=${MAPBOX_TOKEN}`
      );
      const data = await res.json();
      if (data.routes?.[0]) {
        setRouteInfo({
          distance: data.routes[0].distance,
          duration: data.routes[0].duration,
          geometry: data.routes[0].geometry,
        });
        // Fit map to route bounds
        const coords: [number, number][] = data.routes[0].geometry.coordinates;
        if (coords.length > 0) {
          const lngs = coords.map(c => c[0]);
          const lats = coords.map(c => c[1]);
          mapRef.current?.fitBounds(
            [[Math.min(...lngs) - 0.01, Math.min(...lats) - 0.01], [Math.max(...lngs) + 0.01, Math.max(...lats) + 0.01]],
            { padding: 80, duration: 1000 }
          );
        }
      }
    } catch { /* ignore */ }
    setRouteLoading(false);
  }

  function clearRoute() {
    setRouteBoards([]);
    setRouteInfo(null);
  }

  function formatDistance(m: number) {
    return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
  }
  function formatDuration(s: number) {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    return `${m} min`;
  }

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', background: '#F8FAFC' }}>
      <style>{`
        .maplibregl-ctrl-attrib, .maplibregl-ctrl-logo { display: none !important; }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes slideIn { from { opacity:0; transform:translateY(-6px); } to { opacity:1; transform:translateY(0); } }
      `}</style>

      {/* ── Search bar ── */}
      <div style={{ position: 'absolute', top: 12, left: 12, zIndex: 10, width: 300 }}>
        <div style={{ position: 'relative' }}>
          <svg style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}
            width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" strokeWidth="2.5">
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
          </svg>
          <input
            value={searchQuery}
            onChange={e => handleSearch(e.target.value)}
            placeholder="Search any location in Nigeria…"
            style={{
              width: '100%', boxSizing: 'border-box',
              background: 'rgba(255,255,255,0.97)', backdropFilter: 'blur(12px)',
              border: '1px solid rgba(0,0,0,0.1)', borderRadius: 10,
              padding: '9px 32px 9px 30px', color: '#0F172A',
              fontSize: '0.8125rem', outline: 'none',
              boxShadow: '0 4px 20px rgba(0,0,0,0.12)',
              fontFamily: "'Inter', sans-serif",
            }}
          />
          {searching && (
            <div style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', width: 13, height: 13, border: '1.5px solid #E2E8F0', borderTopColor: '#1B4F8A', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
          )}
          {searchQuery && !searching && (
            <button onClick={clearSearch} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#94A3B8', cursor: 'pointer', padding: 2, fontSize: 13 }}>✕</button>
          )}
        </div>

        {/* Results dropdown */}
        {searchResults.length > 0 && (
          <div style={{ marginTop: 4, background: 'rgba(255,255,255,0.99)', border: '1px solid rgba(0,0,0,0.08)', borderRadius: 10, overflow: 'hidden', boxShadow: '0 12px 40px rgba(0,0,0,0.15)', animation: 'slideIn 0.15s ease' }}>
            {searchResults.map((r, i) => (
              <button key={i} onClick={() => selectResult(r)}
                style={{ display: 'flex', alignItems: 'flex-start', gap: 8, width: '100%', padding: '10px 12px', background: 'none', border: 'none', borderBottom: i < searchResults.length - 1 ? '1px solid #F1F5F9' : 'none', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit' }}
                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = '#F8FAFC'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'none'; }}>
                <svg width="11" height="14" viewBox="0 0 24 36" fill="#1B4F8A" style={{ flexShrink: 0, marginTop: 2 }}>
                  <path d="M12 0C5.373 0 0 5.373 0 12c0 9 12 24 12 24s12-15 12-24C24 5.373 18.627 0 12 0z"/>
                </svg>
                <div style={{ minWidth: 0 }}>
                  <p style={{ fontSize: '0.8125rem', color: '#0F172A', fontWeight: 600, margin: 0, lineHeight: 1.3 }}>
                    {r.place_name.split(',')[0]}
                  </p>
                  <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: '2px 0 0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {r.place_name.split(',').slice(1, 3).join(',').trim()}
                  </p>
                </div>
              </button>
            ))}
            {MAPBOX_TOKEN && (
              <div style={{ padding: '5px 12px 6px', borderTop: '1px solid #F8FAFC', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '0.5625rem', color: '#94A3B8' }}>Nigeria-wide · {searchResults.length} results</span>
                <span style={{ fontSize: '0.5625rem', color: '#CBD5E1' }}>Mapbox Search</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Top-right controls: style toggle + route mode ── */}
      <div style={{ position: 'absolute', top: 12, right: 12, zIndex: 10, display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end' }}>
        {/* Map style toggle */}
        <div style={{ display: 'flex', gap: 3, background: 'rgba(255,255,255,0.97)', backdropFilter: 'blur(12px)', border: '1px solid rgba(0,0,0,0.1)', borderRadius: 10, padding: 4, boxShadow: '0 4px 20px rgba(0,0,0,0.12)' }}>
          {(Object.keys(MAP_STYLES) as (keyof typeof MAP_STYLES)[]).map(key => (
            <button key={key} onClick={() => setMapStyle(key)}
              style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 7, border: 'none', cursor: 'pointer', background: mapStyle === key ? '#0F172A' : 'transparent', color: mapStyle === key ? '#F1F5F9' : '#64748B', fontSize: '0.75rem', fontWeight: mapStyle === key ? 600 : 400, fontFamily: 'inherit', transition: 'all 0.15s' }}>
              <span>{MAP_STYLES[key].icon}</span>
              <span>{MAP_STYLES[key].label}</span>
            </button>
          ))}
        </div>

        {/* Route planner toggle */}
        <button
          onClick={() => { setRouteMode(v => !v); if (routeMode) clearRoute(); }}
          style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '7px 14px', borderRadius: 10, border: 'none', cursor: 'pointer', background: routeMode ? '#1B4F8A' : 'rgba(255,255,255,0.97)', color: routeMode ? '#fff' : '#374151', fontSize: '0.8125rem', fontWeight: 600, fontFamily: 'inherit', boxShadow: '0 4px 20px rgba(0,0,0,0.12)', backdropFilter: 'blur(12px)', transition: 'all 0.2s' }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="6" cy="19" r="3"/><circle cx="18" cy="5" r="3"/><path d="M6 16V7a9 9 0 0 1 9-9"/>
          </svg>
          {routeMode ? 'Exit route mode' : 'Plan route'}
        </button>
      </div>

      {/* ── Route planner panel ── */}
      {routeMode && (
        <div style={{ position: 'absolute', bottom: 20, left: 12, zIndex: 10, width: 300, background: 'rgba(255,255,255,0.99)', border: '1px solid rgba(0,0,0,0.1)', borderRadius: 12, boxShadow: '0 8px 32px rgba(0,0,0,0.15)', overflow: 'hidden', animation: 'slideIn 0.2s ease' }}>
          {/* Header */}
          <div style={{ padding: '12px 14px', borderBottom: '1px solid #F1F5F9', background: '#1B4F8A' }}>
            <p style={{ fontSize: '0.8125rem', fontWeight: 700, color: '#fff', margin: 0 }}>
              Route planner
            </p>
            <p style={{ fontSize: '0.6875rem', color: 'rgba(255,255,255,0.65)', margin: '2px 0 0' }}>
              {routeBoards.length === 0
                ? 'Click boards on the map to add waypoints'
                : `${routeBoards.length} stop${routeBoards.length !== 1 ? 's' : ''} added`}
            </p>
          </div>

          {/* Waypoints list */}
          {routeBoards.length > 0 && (
            <div style={{ maxHeight: 200, overflowY: 'auto' }}>
              {routeBoards.map((b, i) => (
                <div key={b.id} style={{ padding: '9px 12px', borderBottom: '1px solid #F8FAFC', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ width: 20, height: 20, borderRadius: '50%', background: '#1B4F8A', color: '#fff', fontSize: '0.625rem', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{i + 1}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#0F172A', margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.name}</p>
                    <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: 0 }}>{b.city}</p>
                  </div>
                  <button onClick={() => toggleRouteBoard(b)} style={{ background: 'none', border: 'none', color: '#EF4444', cursor: 'pointer', padding: 2, fontSize: 12 }}>✕</button>
                </div>
              ))}
            </div>
          )}

          {/* Route result */}
          {routeInfo && (
            <div style={{ padding: '10px 14px', background: '#F0FDF4', borderTop: '1px solid #BBF7D0' }}>
              <div style={{ display: 'flex', gap: 16 }}>
                <div>
                  <p style={{ fontSize: '0.6875rem', color: '#15803D', fontWeight: 600, margin: '0 0 2px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Distance</p>
                  <p style={{ fontSize: '1rem', fontWeight: 800, color: '#14532D', fontFamily: 'monospace', margin: 0 }}>{formatDistance(routeInfo.distance)}</p>
                </div>
                <div>
                  <p style={{ fontSize: '0.6875rem', color: '#15803D', fontWeight: 600, margin: '0 0 2px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Drive time</p>
                  <p style={{ fontSize: '1rem', fontWeight: 800, color: '#14532D', fontFamily: 'monospace', margin: 0 }}>{formatDuration(routeInfo.duration)}</p>
                </div>
              </div>
            </div>
          )}

          {/* Actions */}
          <div style={{ padding: '10px 12px', display: 'flex', gap: 8 }}>
            <button
              onClick={calculateRoute}
              disabled={routeBoards.length < 2 || routeLoading || !MAPBOX_TOKEN}
              style={{ flex: 1, padding: '8px', background: routeBoards.length < 2 ? '#F1F5F9' : '#1B4F8A', color: routeBoards.length < 2 ? '#94A3B8' : '#fff', border: 'none', borderRadius: 7, fontSize: '0.8125rem', fontWeight: 600, cursor: routeBoards.length < 2 ? 'not-allowed' : 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              {routeLoading
                ? <><span style={{ width: 11, height: 11, border: '1.5px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />Calculating…</>
                : routeInfo ? '↻ Recalculate' : 'Get directions'}
            </button>
            {routeBoards.length > 0 && (
              <button onClick={clearRoute} style={{ padding: '8px 12px', background: '#FEF2F2', color: '#EF4444', border: 'none', borderRadius: 7, fontSize: '0.8125rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>Clear</button>
            )}
          </div>
          {!MAPBOX_TOKEN && (
            <p style={{ fontSize: '0.6875rem', color: '#EF4444', padding: '0 12px 10px', margin: 0 }}>Add NEXT_PUBLIC_MAPBOX_TOKEN to enable directions</p>
          )}
        </div>
      )}

      {/* ── Route mode hint ── */}
      {routeMode && routeBoards.length === 0 && (
        <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', zIndex: 5, pointerEvents: 'none' }}>
          <div style={{ background: 'rgba(255,255,255,0.95)', border: '1px dashed #1B4F8A', borderRadius: 12, padding: '14px 20px', textAlign: 'center', backdropFilter: 'blur(8px)' }}>
            <p style={{ fontSize: '0.875rem', fontWeight: 600, color: '#1B4F8A', margin: '0 0 4px' }}>Route planner active</p>
            <p style={{ fontSize: '0.75rem', color: '#64748B', margin: 0 }}>Click any board marker to add it as a stop</p>
          </div>
        </div>
      )}

      <Map
        ref={mapRef}
        initialViewState={{ longitude: 3.3792, latitude: 6.5244, zoom: 11 }}
        style={{ width: '100%', height: '100%' }}
        mapStyle={MAP_STYLES[mapStyle].url}
        onClick={handleMapClick}
        attributionControl={false}
      >
        <NavigationControl position="bottom-right" showCompass={false} />

        {/* ── Route line ── */}
        {routeInfo?.geometry && (
          <>
            <Source id="route-line" type="geojson" data={{ type: 'Feature', geometry: routeInfo.geometry, properties: {} }}>
              <Layer id="route-casing" type="line" paint={{ 'line-color': '#fff', 'line-width': 7, 'line-opacity': 0.8 }} layout={{ 'line-cap': 'round', 'line-join': 'round' }} />
              <Layer id="route-fill" type="line" paint={{ 'line-color': '#1B4F8A', 'line-width': 4, 'line-opacity': 1 }} layout={{ 'line-cap': 'round', 'line-join': 'round' }} />
            </Source>
          </>
        )}

        {/* ── University markers ── */}
        {activeLayers.includes('universities') && filterByCity(UNIVERSITIES).map(u => (
          <Marker key={u.id} latitude={u.lat} longitude={u.lng} anchor="center">
            <div title={`${u.name} — ${u.reach}`} style={{ width: 30, height: 30, borderRadius: '50%', background: 'rgba(37,99,235,0.9)', border: '2px solid #2563EB', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, cursor: 'default', boxShadow: '0 0 0 5px rgba(37,99,235,0.15)' }}>
              🎓
            </div>
          </Marker>
        ))}

        {/* ── Youth cluster areas ── */}
        {activeLayers.includes('youth') && filterByCity(YOUTH_CLUSTERS).map(y => (
          <Source key={y.id} id={`youth-${y.id}`} type="geojson" data={{ type: 'Feature', geometry: { type: 'Point', coordinates: [y.lng, y.lat] }, properties: {} }}>
            <Layer id={`youth-circle-${y.id}`} type="circle" paint={{ 'circle-radius': 42, 'circle-color': '#8B5CF6', 'circle-opacity': 0.13, 'circle-stroke-color': '#7C3AED', 'circle-stroke-width': 1.5, 'circle-stroke-opacity': 0.5 }} />
          </Source>
        ))}
        {activeLayers.includes('youth') && filterByCity(YOUTH_CLUSTERS).map(y => (
          <Marker key={`yl-${y.id}`} latitude={y.lat} longitude={y.lng} anchor="center">
            <div style={{ background: 'rgba(124,58,237,0.9)', color: '#fff', padding: '2px 8px', borderRadius: 6, fontSize: '0.625rem', fontWeight: 700, whiteSpace: 'nowrap', pointerEvents: 'none', backdropFilter: 'blur(4px)' }}>
              👥 {y.name}
            </div>
          </Marker>
        ))}

        {/* ── Traffic hotspot areas ── */}
        {activeLayers.includes('traffic') && filterByCity(TRAFFIC_HOTSPOTS).map(t => (
          <Source key={t.id} id={`traffic-${t.id}`} type="geojson" data={{ type: 'Feature', geometry: { type: 'Point', coordinates: [t.lng, t.lat] }, properties: {} }}>
            <Layer id={`traffic-circle-${t.id}`} type="circle" paint={{ 'circle-radius': 32, 'circle-color': '#F59E0B', 'circle-opacity': 0.2, 'circle-stroke-color': '#D97706', 'circle-stroke-width': 1.5 }} />
          </Source>
        ))}
        {activeLayers.includes('traffic') && filterByCity(TRAFFIC_HOTSPOTS).map(t => (
          <Marker key={`tl-${t.id}`} latitude={t.lat} longitude={t.lng} anchor="center">
            <div style={{ background: 'rgba(217,119,6,0.9)', color: '#fff', padding: '2px 8px', borderRadius: 6, fontSize: '0.625rem', fontWeight: 700, whiteSpace: 'nowrap', pointerEvents: 'none' }}>
              🚦 {t.name}
            </div>
          </Marker>
        ))}

        {/* ── Search pin ── */}
        {searchPin && (
          <Marker latitude={searchPin.lat} longitude={searchPin.lng} anchor="bottom">
            <div style={{ position: 'relative', cursor: 'default' }}>
              <div style={{ position: 'absolute', bottom: 40, left: '50%', transform: 'translateX(-50%)', background: 'rgba(255,255,255,0.98)', border: '1px solid rgba(0,0,0,0.1)', borderRadius: 8, padding: '4px 10px', whiteSpace: 'nowrap', fontSize: '0.75rem', fontWeight: 600, color: '#0F172A', boxShadow: '0 4px 16px rgba(0,0,0,0.12)' }}>
                📍 {searchPin.name}
              </div>
              <svg width="26" height="34" viewBox="0 0 28 36" fill="none">
                <path d="M14 0C6.268 0 0 6.268 0 14c0 9.333 14 22 14 22S28 23.333 28 14C28 6.268 21.732 0 14 0z" fill="#3B82F6"/>
                <circle cx="14" cy="14" r="6" fill="white"/>
              </svg>
            </div>
          </Marker>
        )}

        {/* ── Board markers ── */}
        {boards.map(board => {
          if (!board.latitude || !board.longitude) return null;
          const color     = STATUS_COLORS[board.status] || STATUS_COLORS.available;
          const isSelected = selectedBoard?.id === board.id;
          const inRoute    = routeBoards.some(b => b.id === board.id);
          const routeIdx   = routeBoards.findIndex(b => b.id === board.id);

          return (
            <Marker
              key={board.id}
              latitude={board.latitude}
              longitude={board.longitude}
              anchor="center"
              onClick={e => {
                e.originalEvent.stopPropagation();
                if (routeMode) {
                  toggleRouteBoard(board);
                } else {
                  onSelectBoard(board);
                }
              }}
            >
              <div
                title={routeMode ? `${inRoute ? 'Remove' : 'Add'} ${board.name}` : board.name}
                style={{
                  width:  isSelected || inRoute ? 24 : 14,
                  height: isSelected || inRoute ? 24 : 14,
                  borderRadius: '50%',
                  background: inRoute ? '#1B4F8A' : color,
                  border: `${isSelected || inRoute ? 3 : 2}px solid ${inRoute ? '#fff' : isSelected ? '#fff' : 'rgba(0,0,0,0.2)'}`,
                  boxShadow: inRoute
                    ? `0 0 0 4px rgba(27,79,138,0.3), 0 4px 14px rgba(0,0,0,0.3)`
                    : isSelected
                    ? `0 0 0 5px ${color}35, 0 4px 14px rgba(0,0,0,0.3)`
                    : '0 2px 6px rgba(0,0,0,0.25)',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  position: 'relative',
                  fontSize: '0.5625rem', fontWeight: 800, color: '#fff',
                }}
              >
                {inRoute && routeIdx + 1}
                {(isSelected && !inRoute) && (
                  <div style={{ position: 'absolute', bottom: 28, left: '50%', transform: 'translateX(-50%)', background: 'rgba(255,255,255,0.98)', border: '1px solid rgba(0,0,0,0.1)', borderRadius: 8, padding: '4px 10px', whiteSpace: 'nowrap', fontSize: '0.6875rem', fontWeight: 600, color: '#0F172A', boxShadow: '0 4px 16px rgba(0,0,0,0.12)', pointerEvents: 'none' }}>
                    {board.name}
                  </div>
                )}
              </div>
            </Marker>
          );
        })}

        {/* ── Route waypoint number labels ── */}
        {routeMode && routeBoards.map((b, i) => {
          if (!b.latitude || !b.longitude) return null;
          return (
            <Marker key={`rml-${b.id}`} latitude={b.latitude} longitude={b.longitude} anchor="bottom" offset={[0, -16]}>
              <div style={{ background: '#1B4F8A', color: '#fff', padding: '2px 7px', borderRadius: 5, fontSize: '0.625rem', fontWeight: 700, whiteSpace: 'nowrap', pointerEvents: 'none' }}>
                Stop {i + 1}
              </div>
            </Marker>
          );
        })}
      </Map>
    </div>
  );
}
