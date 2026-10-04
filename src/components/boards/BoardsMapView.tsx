'use client';

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import OOHMap, { Marker, Source, Layer, type MapRef } from '@/components/map/OOHMap';
import ClusteredPoints from '@/components/map/ClusteredPoints';
import MapSearchBar from '@/components/map/MapSearchBar';
import { MAPBOX_TOKEN, MAP_STYLES, MAP_LABEL_FONT, type MapStyleKey, boardStatusColor, fetchDrivingRoute, formatDistance, formatDuration, type DrivingRoute } from '@/components/map/ooh-map-shared';
import type { Board } from '@/app/dashboard/agency/boards-map/page';

// ── Mini-map tile helpers ─────────────────────────────────────────────────────

function latLngToTileXY(lat: number, lng: number, zoom: number) {
  const x = Math.floor((lng + 180) / 360 * Math.pow(2, zoom));
  const latRad = lat * Math.PI / 180;
  const y = Math.floor(
    (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * Math.pow(2, zoom)
  );
  return { x, y };
}

function latLngToPixelOffset(lat: number, lng: number, zoom: number) {
  const { x: tileX, y: tileY } = latLngToTileXY(lat, lng, zoom);
  const totalTiles = Math.pow(2, zoom);
  const pixelX = (lng + 180) / 360 * totalTiles * 256;
  const latRad = lat * Math.PI / 180;
  const pixelY = (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * totalTiles * 256;
  return { offsetX: pixelX - tileX * 256, offsetY: pixelY - tileY * 256 };
}

function BoardMiniMap({ lat, lng }: { lat: number; lng: number }) {
  const ZOOM = 15;
  const W = 236;
  const H = 128;
  const { x: tx, y: ty } = latLngToTileXY(lat, lng, ZOOM);
  const { offsetX, offsetY } = latLngToPixelOffset(lat, lng, ZOOM);

  const dx = -(256 + offsetX - W / 2);
  const dy = -(256 + offsetY - H / 2);

  return (
    <div style={{ width: W, height: H, overflow: 'hidden', position: 'relative', borderRadius: '10px 10px 0 0', background: '#E8EDF2' }}>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 256px)',
        transform: `translate(${dx}px, ${dy}px)`,
        pointerEvents: 'none',
        willChange: 'transform',
      }}>
        {[-1, 0, 1].flatMap(row =>
          [-1, 0, 1].map(col => (
            <img
              key={`${row}-${col}`}
              src={`https://basemaps.cartocdn.com/rastertiles/voyager/${ZOOM}/${tx + col}/${ty + row}.png`}
              width={256}
              height={256}
              style={{ display: 'block' }}
              loading="lazy"
              alt=""
            />
          ))
        )}
      </div>
      <div style={{ position: 'absolute', left: W / 2, top: H / 2, transform: 'translate(-50%, -100%)', pointerEvents: 'none', filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.4))' }}>
        <svg width="22" height="28" viewBox="0 0 22 28" fill="none">
          <path d="M11 0C4.925 0 0 4.925 0 11c0 8.25 11 17 11 17s11-8.75 11-17C22 4.925 17.075 0 11 0z" fill="#1B4F8A"/>
          <circle cx="11" cy="11" r="4.5" fill="white"/>
        </svg>
      </div>
      <div style={{ position: 'absolute', inset: 0, borderRadius: '10px 10px 0 0', boxShadow: 'inset 0 0 20px rgba(0,0,0,0.12)', pointerEvents: 'none' }} />
    </div>
  );
}

export type OverlayLayer = 'universities' | 'youth' | 'traffic';

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

type SearchPin = { lat: number; lng: number; name: string };

type Props = {
  boards: Board[];
  selectedBoard: Board | null;
  onSelectBoard: (board: Board | null) => void;
  activeLayers: OverlayLayer[];
  cityFilter: string;
  onSearchPin?: (pin: SearchPin | null) => void;
};

const FORMAT_LABELS: Record<string, string> = {
  billboard: 'Billboard', unipole: 'Unipole', gantry: 'Gantry',
  bridge_panel: 'Bridge Panel', wall_drape: 'Wall Drape',
};

function fmtNaira(n: number) {
  if (n >= 1_000_000) return '₦' + (n / 1_000_000).toFixed(1) + 'M';
  return '₦' + n.toLocaleString('en-NG');
}

export default function BoardsMapView({ boards, selectedBoard, onSelectBoard, activeLayers, cityFilter, onSearchPin }: Props) {
  const mapRef = useRef<MapRef>(null);
  const [mapStyle, setMapStyle] = useState<MapStyleKey>('streets');
  const [hoveredBoardId, setHoveredBoardId] = useState<string | null>(null);
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(null);

  const [searchPin, setSearchPin] = useState<SearchPin | null>(null);

  // ── Route planner state ───────────────────────────────────────────────────
  const [routeMode, setRouteMode]         = useState(false);
  const [routeBoards, setRouteBoards]     = useState<Board[]>([]);
  const [routeInfo, setRouteInfo]         = useState<DrivingRoute | null>(null);
  const [routeLoading, setRouteLoading]   = useState(false);

  const handleMapClick = useCallback(() => {
    if (!routeMode) onSelectBoard(null);
  }, [routeMode, onSelectBoard]);

  function filterByCity<T extends IntelPoint>(pts: T[]): T[] {
    if (!cityFilter || cityFilter === 'all') return pts;
    return pts.filter(p => p.city.toLowerCase() === cityFilter.toLowerCase());
  }

  function handleSearchResult(result: { lat: number; lng: number; name: string }) {
    const pin: SearchPin = result;
    setSearchPin(pin);
    onSearchPin?.(pin);
    mapRef.current?.flyTo({ center: [result.lng, result.lat], zoom: 14, duration: 1200 });
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
      const route = await fetchDrivingRoute(geo.map(b => [b.longitude!, b.latitude!]));
      if (route) {
        setRouteInfo(route);
        const coords = route.geometry.coordinates as [number, number][];
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

  const boardsById = useMemo(() => new Map(boards.filter(b => b.latitude && b.longitude).map(b => [b.id, b])), [boards]);

  // Memoized so hover/search re-renders don't re-upload every point to the map.
  const selectedId = selectedBoard?.id ?? null;
  const points = useMemo(() => Array.from(boardsById.values()).map(board => {
    const isSelected = selectedId === board.id;
    const inRoute = routeBoards.some(b => b.id === board.id);
    return {
      id: board.id,
      lng: board.longitude!,
      lat: board.latitude!,
      color: inRoute ? '#1B4F8A' : boardStatusColor(board.status),
      radius: isSelected || inRoute ? 11 : 7,
    };
  }), [boardsById, selectedId, routeBoards]);

  // Fly to a board whenever it becomes the selection (marker click or picked from a list).
  useEffect(() => {
    if (!selectedBoard?.latitude || !selectedBoard?.longitude) return;
    const map = mapRef.current;
    if (!map) return;
    map.flyTo({ center: [selectedBoard.longitude, selectedBoard.latitude], zoom: Math.max(map.getZoom(), 13), duration: 800 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  function handlePointClick(id: string) {
    const board = boardsById.get(id);
    if (!board) return;
    if (routeMode) toggleRouteBoard(board);
    else onSelectBoard(board);
  }

  function handlePointHover(id: string | null, point: { x: number; y: number } | null) {
    setHoveredBoardId(id);
    setHoverPos(point);
  }

  const hoveredBoard = hoveredBoardId ? boardsById.get(hoveredBoardId) : null;
  const showCard = !!hoveredBoard && !routeMode && selectedBoard?.id !== hoveredBoardId && !!hoverPos;

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', background: '#F8FAFC' }}>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes hoverCardIn { from { opacity:0; transform:translate(-50%, 4px); } to { opacity:1; transform:translate(-50%, 0); } }
      `}</style>

      {/* ── Search bar ── */}
      <div style={{ position: 'absolute', top: 12, left: 12, zIndex: 10 }}>
        <MapSearchBar onResult={handleSearchResult} />
      </div>

      {/* ── Top-right controls: style toggle + route mode ── */}
      <div style={{ position: 'absolute', top: 12, right: 12, zIndex: 10, display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end' }}>
        <div style={{ display: 'flex', gap: 3, background: 'rgba(255,255,255,0.97)', backdropFilter: 'blur(12px)', border: '1px solid rgba(0,0,0,0.1)', borderRadius: 10, padding: 4, boxShadow: '0 4px 20px rgba(0,0,0,0.12)' }}>
          {(Object.keys(MAP_STYLES) as MapStyleKey[]).map(key => (
            <button key={key} onClick={() => setMapStyle(key)}
              style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 7, border: 'none', cursor: 'pointer', background: mapStyle === key ? '#0F172A' : 'transparent', color: mapStyle === key ? '#F1F5F9' : '#64748B', fontSize: '0.75rem', fontWeight: mapStyle === key ? 600 : 400, fontFamily: 'inherit', transition: 'all 0.15s' }}>
              <span>{MAP_STYLES[key].icon}</span>
              <span>{MAP_STYLES[key].label}</span>
            </button>
          ))}
        </div>

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
        <div style={{ position: 'absolute', bottom: 20, left: 12, zIndex: 10, width: 300, background: 'rgba(255,255,255,0.99)', border: '1px solid rgba(0,0,0,0.1)', borderRadius: 12, boxShadow: '0 8px 32px rgba(0,0,0,0.15)', overflow: 'hidden' }}>
          <div style={{ padding: '12px 14px', borderBottom: '1px solid #F1F5F9', background: '#1B4F8A' }}>
            <p style={{ fontSize: '0.8125rem', fontWeight: 700, color: '#fff', margin: 0 }}>Route planner</p>
            <p style={{ fontSize: '0.6875rem', color: 'rgba(255,255,255,0.65)', margin: '2px 0 0' }}>
              {routeBoards.length === 0
                ? 'Click boards on the map to add waypoints'
                : `${routeBoards.length} stop${routeBoards.length !== 1 ? 's' : ''} added`}
            </p>
          </div>

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

      {routeMode && routeBoards.length === 0 && (
        <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', zIndex: 5, pointerEvents: 'none' }}>
          <div style={{ background: 'rgba(255,255,255,0.95)', border: '1px dashed #1B4F8A', borderRadius: 12, padding: '14px 20px', textAlign: 'center', backdropFilter: 'blur(8px)' }}>
            <p style={{ fontSize: '0.875rem', fontWeight: 600, color: '#1B4F8A', margin: '0 0 4px' }}>Route planner active</p>
            <p style={{ fontSize: '0.75rem', color: '#64748B', margin: 0 }}>Click any board marker to add it as a stop</p>
          </div>
        </div>
      )}

      {/* ── Hover card (positioned over the projected screen point of the hovered board) ── */}
      {showCard && hoveredBoard && hoverPos && (
        <div
          style={{
            position: 'absolute', left: hoverPos.x, top: hoverPos.y - 22, zIndex: 20,
            transform: 'translate(-50%, -100%)', width: 236, background: '#fff', borderRadius: 12,
            boxShadow: '0 8px 32px rgba(0,0,0,0.22), 0 2px 8px rgba(0,0,0,0.1)', overflow: 'hidden',
            pointerEvents: 'none', animation: 'hoverCardIn 0.15s ease',
          }}
        >
          {hoveredBoard.photo_urls?.[0] ? (
            <div style={{ width: 236, height: 128, overflow: 'hidden', borderRadius: '10px 10px 0 0', position: 'relative', background: '#0F172A' }}>
              <img src={hoveredBoard.photo_urls[0]} alt={hoveredBoard.name} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
              {hoveredBoard.photo_urls.length > 1 && (
                <div style={{ position: 'absolute', bottom: 7, right: 7, background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: '0.625rem', fontWeight: 700, padding: '2px 7px', borderRadius: 5, backdropFilter: 'blur(4px)' }}>
                  +{hoveredBoard.photo_urls.length - 1} more
                </div>
              )}
            </div>
          ) : (
            <BoardMiniMap lat={hoveredBoard.latitude!} lng={hoveredBoard.longitude!} />
          )}
          <div style={{ padding: '10px 12px 11px' }}>
            <p style={{ fontSize: '0.8125rem', fontWeight: 700, color: '#0F172A', margin: '0 0 4px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {hoveredBoard.name}
            </p>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: boardStatusColor(hoveredBoard.status), flexShrink: 0 }} />
                <span style={{ fontSize: '0.6875rem', color: '#64748B', fontWeight: 500 }}>
                  {(hoveredBoard.format ? FORMAT_LABELS[hoveredBoard.format] || hoveredBoard.format : '—')} · {hoveredBoard.city || '—'}
                </span>
              </div>
              <span style={{ fontSize: '0.8125rem', fontWeight: 800, color: '#1B4F8A', fontFamily: 'monospace', flexShrink: 0 }}>
                {hoveredBoard.asking_rate != null ? fmtNaira(hoveredBoard.asking_rate) : '—'}<span style={{ fontSize: '0.625rem', fontWeight: 500, color: '#94A3B8' }}>/mo</span>
              </span>
            </div>
          </div>
        </div>
      )}

      <OOHMap
        ref={mapRef}
        initialViewState={{ longitude: 3.3792, latitude: 6.5244, zoom: 11 }}
        styleKey={mapStyle}
        onClick={handleMapClick}
      >
        {/* ── Route line ── */}
        {routeInfo?.geometry && (
          <Source id="route-line" type="geojson" data={{ type: 'Feature', geometry: routeInfo.geometry, properties: {} }}>
            <Layer id="route-casing" type="line" paint={{ 'line-color': '#fff', 'line-width': 7, 'line-opacity': 0.8 }} layout={{ 'line-cap': 'round', 'line-join': 'round' }} />
            <Layer id="route-fill" type="line" paint={{ 'line-color': '#1B4F8A', 'line-width': 4, 'line-opacity': 1 }} layout={{ 'line-cap': 'round', 'line-join': 'round' }} />
          </Source>
        )}

        {/* ── University markers ── */}
        {activeLayers.includes('universities') && (
          <Source
            id="universities"
            type="geojson"
            data={{ type: 'FeatureCollection', features: filterByCity(UNIVERSITIES).map(u => ({ type: 'Feature', properties: { name: u.name, reach: u.reach }, geometry: { type: 'Point', coordinates: [u.lng, u.lat] } })) }}
          >
            <Layer id="universities-circle" type="circle" paint={{ 'circle-radius': 13, 'circle-color': '#2563EB', 'circle-opacity': 0.9, 'circle-stroke-color': '#2563EB', 'circle-stroke-width': 5, 'circle-stroke-opacity': 0.15 }} />
            <Layer id="universities-label" type="symbol" layout={{ 'text-field': '🎓', 'text-size': 13, 'text-allow-overlap': true }} />
          </Source>
        )}

        {/* ── Youth cluster areas ── */}
        {activeLayers.includes('youth') && filterByCity(YOUTH_CLUSTERS).map(y => (
          <Source key={y.id} id={`youth-${y.id}`} type="geojson" data={{ type: 'Feature', geometry: { type: 'Point', coordinates: [y.lng, y.lat] }, properties: {} }}>
            <Layer id={`youth-circle-${y.id}`} type="circle" paint={{ 'circle-radius': 42, 'circle-color': '#8B5CF6', 'circle-opacity': 0.13, 'circle-stroke-color': '#7C3AED', 'circle-stroke-width': 1.5, 'circle-stroke-opacity': 0.5 }} />
            <Layer id={`youth-label-${y.id}`} type="symbol" layout={{ 'text-field': `👥 ${y.name}`, 'text-size': 11, 'text-allow-overlap': true, 'text-font': MAP_LABEL_FONT }} paint={{ 'text-color': '#7C3AED', 'text-halo-color': '#fff', 'text-halo-width': 1 }} />
          </Source>
        ))}

        {/* ── Traffic hotspot areas ── */}
        {activeLayers.includes('traffic') && filterByCity(TRAFFIC_HOTSPOTS).map(t => (
          <Source key={t.id} id={`traffic-${t.id}`} type="geojson" data={{ type: 'Feature', geometry: { type: 'Point', coordinates: [t.lng, t.lat] }, properties: {} }}>
            <Layer id={`traffic-circle-${t.id}`} type="circle" paint={{ 'circle-radius': 32, 'circle-color': '#F59E0B', 'circle-opacity': 0.2, 'circle-stroke-color': '#D97706', 'circle-stroke-width': 1.5 }} />
            <Layer id={`traffic-label-${t.id}`} type="symbol" layout={{ 'text-field': `🚦 ${t.name}`, 'text-size': 11, 'text-allow-overlap': true, 'text-font': MAP_LABEL_FONT }} paint={{ 'text-color': '#D97706', 'text-halo-color': '#fff', 'text-halo-width': 1 }} />
          </Source>
        ))}

        {/* ── Search pin ── */}
        {searchPin && (
          <Source id="search-pin" type="geojson" data={{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [searchPin.lng, searchPin.lat] } }}>
            <Layer id="search-pin-circle" type="circle" paint={{ 'circle-radius': 9, 'circle-color': '#3B82F6', 'circle-stroke-color': '#fff', 'circle-stroke-width': 2.5 }} />
          </Source>
        )}

        {/* ── Board markers (clustered — smooth at national scale) ── */}
        <ClusteredPoints
          sourceId="boards-map-boards"
          points={points}
          onPointClick={handlePointClick}
          onPointHover={handlePointHover}
        />

        {/* ── Selected board name label ── */}
        {selectedBoard && !routeBoards.some(b => b.id === selectedBoard.id) && selectedBoard.latitude && selectedBoard.longitude && (
          <Marker longitude={selectedBoard.longitude} latitude={selectedBoard.latitude} anchor="bottom" offset={[0, -14]}>
            <div style={{ background: 'rgba(255,255,255,0.98)', border: '1px solid rgba(0,0,0,0.1)', borderRadius: 8, padding: '4px 10px', whiteSpace: 'nowrap', fontSize: '0.6875rem', fontWeight: 600, color: '#0F172A', boxShadow: '0 4px 16px rgba(0,0,0,0.12)', pointerEvents: 'none' }}>
              {selectedBoard.name}
            </div>
          </Marker>
        )}

        {/* ── Route waypoint number labels ── */}
        {routeMode && routeBoards.map((b, i) => {
          if (!b.latitude || !b.longitude) return null;
          return (
            <Marker key={`rml-${b.id}`} longitude={b.longitude} latitude={b.latitude} anchor="bottom" offset={[0, -16]}>
              <div style={{ background: '#1B4F8A', color: '#fff', padding: '2px 7px', borderRadius: 5, fontSize: '0.625rem', fontWeight: 700, whiteSpace: 'nowrap', pointerEvents: 'none' }}>
                Stop {i + 1}
              </div>
            </Marker>
          );
        })}
      </OOHMap>
    </div>
  );
}
