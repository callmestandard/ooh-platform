'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import OOHMap, { Popup, Source, Layer, Marker, type MapRef } from '@/components/map/OOHMap';
import { boardsWithinRadius, boardsWithinCorridor, corridorPolygon, circlePolygon, type GeoPoint } from '@/components/map/corridor';
import { fetchDrivingRoute } from '@/components/map/ooh-map-shared';
import BoardPins, { type BoardPin } from '@/components/map/BoardPins';
import { VerificationBadge, VERIFICATION_META, verificationOf, type VerificationStatus } from '@/lib/board-verification';
import { boardFormatLabel } from '@/lib/board-formats';
import type { MapStyleKey } from '@/components/map/ooh-map-shared';
import { PhotoStepper, StreetViewButton } from './BoardLook';
import { SHOW_PRICES } from '@/lib/mvp';
import IntelLayers, { POP_RAMP, type PlacesStatus } from '@/components/map/IntelLayers';
import { LAYER_CATEGORIES, PLACE_META, intelSummary, type BoardIntel, type PlaceCategory } from '@/lib/intel';
import { trackMap } from '@/lib/map-track';

export type MapBoard = {
  /** The pin is rough (shared by several boards, or few decimals): don't stand Street View on it. */
  pinVague?: boolean;
  id: string;
  name: string;
  area: string | null;
  city: string;
  format: string;
  photo_urls: string[] | null;
  verification_status: string | null;
  latitude: number;
  longitude: number;
  rate: string;
  perMonth: boolean;
  /** The rate is a guide range, not the exact price. */
  guide?: boolean;
  /** Short price on the map pin ("₦1.2M"); falls back to the rate. */
  pin?: string;
  /** Public page of the board (for "Request pricing"). */
  href?: string;
  /** Digital screen (drawn as a ringed dot). */
  digital?: boolean;
  /** Width × height, e.g. "12m × 4m". */
  size?: string | null;
};

export type MapView = { bounds: [number, number, number, number]; lng: number; lat: number; zoom: number };

const NIGERIA = { longitude: 7.4951, latitude: 9.0579, zoom: 5.2 };

// Admin pins follow the verification badges, so map and table read the same.
const VERIFY_PIN: Record<VerificationStatus, string> = { partner_verified: '#059669', verified: '#1D4ED8', pending: '#94A3B8' };

// Mapbox Standard in its "faded" theme: quiet, so the board pins stand out.
const FADED = 'mapbox://styles/mapbox/standard';
type ConfigurableMap = { getStyle?: () => { imports?: { id: string }[] } | undefined; setConfigProperty?: (i: string, k: string, v: unknown) => void };
function fadeBasemap(map: ConfigurableMap) {
  try {
    if (!map.getStyle?.()?.imports?.some(i => i.id === 'basemap')) return;
    map.setConfigProperty?.('basemap', 'theme', 'faded');
    map.setConfigProperty?.('basemap', 'show3dObjects', false);
    map.setConfigProperty?.('basemap', 'showPointOfInterestLabels', false);
    map.setConfigProperty?.('basemap', 'showTransitLabels', false);
  } catch { /* style still loading; the next styledata event retries */ }
}

type Props = {
  boards: MapBoard[];
  onOpen: (id: string) => void;
  /** Highlight from outside, e.g. the list card under the mouse. */
  hoveredId?: string | null;
  onHover?: (id: string | null) => void;
  /** Controlled selection; uncontrolled when left out. */
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  /** After every move: what is on screen. */
  onView?: (v: MapView) => void;
  /** Start here instead of fitting the boards (a shared link). */
  initialCamera?: { lng: number; lat: number; zoom: number } | null;
  /** Refit when this changes (filters). Defaults to the board ids. */
  fitKey?: string;
  /** Fit to where most boards are, ignoring far-off strays. */
  trimOutliers?: boolean;
  /** Embedded in a scrolling page: two fingers / ctrl to zoom. */
  cooperative?: boolean;
  /** Show a card on the map for the selected board (desktop). */
  preview?: boolean;
  /** Full-screen explorer: near-me, Map/Satellite switch, controls top-right. */
  explorer?: boolean;
  /** Admin view: dots coloured by verification, with a legend, instead of prices. */
  verificationColors?: boolean;
  /** Centre this board in the part of the map a side panel leaves visible. */
  focus?: { id: string; padRight: number } | null;
  /** Space kept clear at the edges when fitting (e.g. a card row on phones). */
  fitPadding?: { top: number; bottom: number; left: number; right: number };
  /** What is around each board (shown on the card). */
  intel?: Map<string, BoardIntel>;
  /** Explorer: the boards inside the area the buyer drew, or null when none is drawn. */
  onArea?: (ids: Set<string> | null) => void;
  /** Explorer: bump to remove the drawn area from outside (the list's "Clear area"). */
  clearArea?: number;
};

type AreaMode = 'spot' | 'road';
/** Most taps a road can take (the directions service allows 25 waypoints). */
const MAX_ROAD_TAPS = 12;

/** Boards near where most of them are: drops strays far from the middle. */
function coreOf(boards: MapBoard[]): MapBoard[] {
  if (boards.length < 6) return boards;
  const mid = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
  const lat0 = mid(boards.map(b => b.latitude)), lng0 = mid(boards.map(b => b.longitude));
  const km = (b: MapBoard) => Math.hypot((b.latitude - lat0) * 111, (b.longitude - lng0) * 111 * Math.cos(lat0 * Math.PI / 180));
  const d = boards.map(km);
  const limit = Math.max(25, mid(d) * 3);
  const core = boards.filter((_, i) => d[i] <= limit);
  return core.length >= boards.length * 0.6 ? core : boards;
}

export default function MarketplaceMap({
  boards, onOpen, hoveredId = null, onHover, selectedId, onSelect, onView, initialCamera,
  fitKey, trimOutliers, cooperative = true, preview = true, explorer, verificationColors, focus, fitPadding, intel,
  onArea, clearArea = 0,
}: Props) {
  // ── Select an area: a circle around a spot, or a strip along a road ──
  const [drawing, setDrawing] = useState(false);
  const [areaMode, setAreaMode] = useState<AreaMode>('spot');
  const [taps, setTaps] = useState<GeoPoint[]>([]);
  const [radiusKm, setRadiusKm] = useState(1);
  const [widthKm, setWidthKm] = useState(0.3);
  const [road, setRoad] = useState<{ key: string; line: GeoPoint[] | null } | null>(null);
  const tapsKey = areaMode === 'road' && taps.length >= 2 ? taps.map(p => `${p.lng.toFixed(5)},${p.lat.toFixed(5)}`).join(';') : '';

  // Follow the real road between the taps; straight lines if that fails.
  useEffect(() => {
    if (!tapsKey) return;
    let live = true;
    fetchDrivingRoute(taps.map(p => [p.lng, p.lat]))
      .then(r => { if (live) setRoad({ key: tapsKey, line: r ? r.geometry.coordinates.map(([lng, lat]) => ({ lng, lat })) : null }); })
      .catch(() => { if (live) setRoad({ key: tapsKey, line: null }); });
    return () => { live = false; };
    // taps is captured through tapsKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tapsKey]);

  const routing = !!tapsKey && road?.key !== tapsKey;
  const roadLine = tapsKey ? (road?.key === tapsKey && road.line ? road.line : taps) : null;
  const areaShape = useMemo(() => {
    if (areaMode === 'spot' && taps.length === 1) return circlePolygon(taps[0], radiusKm);
    if (areaMode === 'road' && roadLine && roadLine.length >= 2) return corridorPolygon(roadLine, widthKm);
    return null;
  }, [areaMode, taps, radiusKm, roadLine, widthKm]);
  const inArea = useMemo(() => {
    if (!areaShape) return null;
    const hits = areaMode === 'spot' ? boardsWithinRadius(boards, taps[0], radiusKm) : boardsWithinCorridor(boards, roadLine ?? [], widthKm);
    return new Set(hits.map(b => b.id));
  }, [areaShape, areaMode, boards, taps, radiusKm, roadLine, widthKm]);

  const onAreaRef = useRef(onArea);
  useEffect(() => { onAreaRef.current = onArea; }, [onArea]);
  useEffect(() => { onAreaRef.current?.(inArea); }, [inArea]);

  const seenClear = useRef(clearArea);
  useEffect(() => {
    if (seenClear.current === clearArea) return;
    seenClear.current = clearArea;
    setTaps([]); setDrawing(false);
  }, [clearArea]);

  function startArea(mode: AreaMode) {
    if (mode !== areaMode) { setAreaMode(mode); setTaps([]); }
    setDrawing(true);
    trackMap('layer', `area_${mode}`);
  }

  const [layersOpen, setLayersOpen] = useState(false);
  const [showPop, setShowPop] = useState(false);
  const [showPlaces, setShowPlaces] = useState(false);
  const [cats, setCats] = useState<PlaceCategory[]>(LAYER_CATEGORIES);
  const [placesStatus, setPlacesStatus] = useState<{ s: PlacesStatus; n: number }>({ s: 'off', n: 0 });
  const onPlacesStatus = useCallback((st: PlacesStatus, n: number) => setPlacesStatus({ s: st, n }), []);
  const mapRef = useRef<MapRef>(null);
  const [ready, setReady] = useState(false);
  const [ownSelected, setOwnSelected] = useState<string | null>(null);
  const [stack, setStack] = useState<{ ids: string[]; at: [number, number] } | null>(null);
  const [style, setStyle] = useState<MapStyleKey>(explorer ? 'light' : 'streets');
  const selId = selectedId !== undefined ? selectedId : ownSelected;
  const select = useCallback((id: string | null) => {
    setStack(null);
    if (selectedId === undefined) setOwnSelected(id);
    onSelect?.(id);
  }, [selectedId, onSelect]);

  // Fit the boards whenever the filters change (not on every render).
  const sig = fitKey ?? boards.map(b => b.id).join(',');
  const fitted = useRef<string | null>(initialCamera ? sig : null);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || fitted.current === sig) return;
    fitted.current = sig;
    const pad = fitPadding ?? { top: 60, bottom: 60, left: 60, right: 60 };
    const target = trimOutliers ? coreOf(boards) : boards;
    if (target.length === 0) { map.flyTo({ center: [NIGERIA.longitude, NIGERIA.latitude], zoom: NIGERIA.zoom, duration: 600 }); return; }
    if (target.length === 1) { map.flyTo({ center: [target[0].longitude, target[0].latitude], zoom: 14, duration: 600, padding: pad }); return; }
    const lngs = target.map(b => b.longitude), lats = target.map(b => b.latitude);
    map.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]], { padding: pad, maxZoom: 14, duration: 650 });
  }, [boards, ready, sig, trimOutliers, fitPadding]);

  const emitView = useCallback(() => {
    const map = mapRef.current;
    if (!map || !onView) return;
    const b = map.getBounds();
    if (!b) return;
    const c = map.getCenter();
    onView({ bounds: [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()], lng: c.lng, lat: c.lat, zoom: map.getZoom() });
  }, [onView]);

  // Slide the map just enough that the selected board's card fits on screen.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !preview || !selId) return;
    const b = boards.find(x => x.id === selId);
    if (!b) return;
    const p = map.project([b.longitude, b.latitude]);
    const { clientWidth: w, clientHeight: h } = map.getContainer();
    const CARD_H = 420, HALF_W = 150, EDGE = 14;
    const dx = p.x < HALF_W + EDGE ? p.x - HALF_W - EDGE : p.x > w - HALF_W - EDGE ? p.x - (w - HALF_W - EDGE) : 0;
    const dy = p.y < CARD_H ? p.y - CARD_H : p.y > h - 40 ? p.y - (h - 40) : 0;
    if (dx || dy) map.panBy([dx, dy], { duration: 300 });
  }, [selId, preview, boards]);

  // A side panel opened: keep its board in view beside it; closed: undo the inset.
  const focusId = focus?.id ?? null, focusPad = focus?.padRight ?? 0;
  const wasFocused = useRef(false);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const b = focusId ? boards.find(x => x.id === focusId) : null;
    if (b) {
      wasFocused.current = true;
      map.easeTo({ center: [b.longitude, b.latitude], padding: { top: 0, bottom: 0, left: 0, right: focusPad }, duration: 450 });
    } else if (wasFocused.current) {
      wasFocused.current = false;
      map.easeTo({ padding: { top: 0, bottom: 0, left: 0, right: 0 }, duration: 300 });
    }
  }, [focusId, focusPad, ready, boards]);

  // Escape closes the card (or stops drawing, keeping the area).
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (drawing) { setDrawing(false); return; }
      setStack(null); select(null);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [select, drawing]);

  // A crosshair while taps place the area.
  useEffect(() => {
    const canvas = ready ? mapRef.current?.getMap().getCanvasContainer() : null;
    if (!canvas) return;
    canvas.classList.toggle('ooh-drawing', drawing);
  }, [drawing, ready]);

  const pins = useMemo<BoardPin[]>(
    () => boards.map(b => ({
      id: b.id, lng: b.longitude, lat: b.latitude, label: b.pin ?? (b.perMonth ? b.rate : 'Quote'),
      color: verificationColors ? VERIFY_PIN[verificationOf(b)] : undefined, digital: !!b.digital,
    })),
    [boards, verificationColors],
  );
  const activeIds = useMemo(() => [selId, hoveredId].filter((x): x is string => !!x), [selId, hoveredId]);
  const byId = useMemo(() => new Map(boards.map(b => [b.id, b])), [boards]);
  const open = preview && selId ? byId.get(selId) ?? null : null;

  return (
    <div style={{ position: 'relative', height: '100%' }} data-map-explorer={explorer ? '' : undefined}>
      <OOHMap
        ref={mapRef}
        styleKey={style}
        mapStyleUrl={explorer && style === 'light' ? FADED : undefined}
        initialViewState={initialCamera ? { longitude: initialCamera.lng, latitude: initialCamera.lat, zoom: initialCamera.zoom } : NIGERIA}
        cooperativeGestures={cooperative}
        dragRotate={false}
        touchPitch={false}
        onLoad={() => {
          const m = mapRef.current?.getMap();
          if (m) { fadeBasemap(m as unknown as ConfigurableMap); m.on('style.load', () => fadeBasemap(m as unknown as ConfigurableMap)); }
          setReady(true); emitView();
        }}
        onMoveEnd={emitView}
        onClick={e => {
          if (drawing) {
            const p = { lng: e.lngLat.lng, lat: e.lngLat.lat };
            setStack(null); select(null);
            setTaps(t => (areaMode === 'spot' ? [p] : t.length >= MAX_ROAD_TAPS ? t : [...t, p]));
            return;
          }
          // A click on empty map closes the card (pins handle their own clicks).
          const hit = mapRef.current?.queryRenderedFeatures(e.point).some(f => String(f.layer?.id ?? '').startsWith('marketplace-boards'));
          if (!hit) { setStack(null); select(null); }
        }}
        navPosition={explorer ? 'top-right' : 'bottom-right'}
        geolocate={explorer}
        search
        searchWidth={explorer ? 260 : 280}
        searchPlaceholder="Go to a place or street…"
        onSearchResult={() => trackMap('map_search', 'place')}
      >
        {explorer && (
          <IntelLayers population={showPop} places={showPlaces} categories={cats} beforeId="marketplace-boards-clusters" onPlacesStatus={onPlacesStatus} />
        )}
        {explorer && areaShape && (
          <Source id="area-select" type="geojson" data={areaShape}>
            <Layer id="area-select-fill" type="fill" beforeId="marketplace-boards-clusters" paint={{ 'fill-color': '#1B4F8A', 'fill-opacity': 0.1 }} />
            <Layer id="area-select-line" type="line" beforeId="marketplace-boards-clusters" paint={{ 'line-color': '#1B4F8A', 'line-width': 2, 'line-opacity': 0.85 }} />
          </Source>
        )}
        {explorer && roadLine && (
          <Source id="area-road" type="geojson" data={{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: roadLine.map(p => [p.lng, p.lat]) } }}>
            <Layer id="area-road-line" type="line" beforeId="marketplace-boards-clusters" layout={{ 'line-cap': 'round', 'line-join': 'round' }} paint={{ 'line-color': '#1B4F8A', 'line-width': 3, 'line-dasharray': [1.5, 1.5] }} />
          </Source>
        )}
        {explorer && taps.map((p, i) => (
          <Marker key={i} longitude={p.lng} latitude={p.lat} anchor="center">
            <span className="ooh-tap" data-area-tap>{areaMode === 'road' ? (i === 0 ? 'A' : i === taps.length - 1 && taps.length > 1 ? 'B' : '') : ''}</span>
          </Marker>
        ))}
        <BoardPins
          sourceId="marketplace-boards"
          pins={pins}
          activeIds={activeIds}
          onPinClick={id => { if (drawing) return; if (id !== selId) trackMap('board_click', 'pin', id); select(id === selId ? null : id); }}
          onPinHover={onHover}
          onStackClick={(ids, at) => { if (drawing) return; select(null); setStack({ ids, at }); }}
          prices={!verificationColors && SHOW_PRICES}
        />

        {open && (
          <Popup longitude={open.longitude} latitude={open.latitude} anchor="bottom" offset={18} closeButton={false} closeOnClick={false} onClose={() => select(null)} maxWidth="280px" className="ooh-map-card">
            <div data-map-card style={{ fontFamily: "'Inter', -apple-system, sans-serif", width: 256, borderRadius: 14, overflow: 'hidden', background: '#fff' }}>
              <PhotoStepper key={open.id} photos={(open.photo_urls ?? []).filter(Boolean)} alt={open.name} height={140} />
              <div style={{ padding: '11px 13px 12px' }}>
                <button type="button" onClick={() => onOpen(open.id)} style={{ all: 'unset', display: 'block', width: '100%', cursor: 'pointer' }} aria-label={`Open ${open.name}`}>
                  <p style={{ fontSize: '0.875rem', fontWeight: 700, color: '#0F172A', margin: '0 0 2px', lineHeight: 1.3, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{open.name}</p>
                  <p style={{ fontSize: '0.75rem', color: '#64748B', margin: '0 0 8px' }}>{[open.area, open.city].filter(Boolean).join(', ')} · {[open.size, boardFormatLabel(open.format)].filter(Boolean).join(' · ')}</p>
                  {(() => {
                    const sm = intelSummary(intel?.get(open.id));
                    if (!sm.people && !sm.places) return null;
                    return (
                      <div data-card-intel style={{ margin: '0 0 9px', padding: '7px 9px', borderRadius: 9, background: '#F8FAFC', display: 'grid', gap: 2 }}>
                        {sm.people && <p style={{ margin: 0, fontSize: '0.75rem', color: '#0F172A', fontWeight: 600 }}>{sm.people}</p>}
                        {sm.places && <p style={{ margin: 0, fontSize: '0.6875rem', color: '#64748B', lineHeight: 1.35 }}>{sm.places}</p>}
                      </div>
                    );
                  })()}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <div>
                      {open.perMonth ? (
                        <p style={{ fontSize: '0.9375rem', fontWeight: 800, color: '#0F172A', margin: 0, letterSpacing: '-0.02em', whiteSpace: 'nowrap' }}>
                          {open.rate}<span style={{ fontSize: '0.6875rem', fontWeight: 500, color: '#94A3B8' }}> /mo</span>
                        </p>
                      ) : (
                        <p style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#64748B', margin: 0 }}>Price on request</p>
                      )}
                      {open.guide && <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: '1px 0 0' }}>Guide price</p>}
                    </div>
                    <VerificationBadge status={open.verification_status} small />
                  </div>
                </button>
                <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                  {open.href ? (
                    <a href={`${open.href}?request=1`} onClick={() => trackMap('pricing_click', 'map_card', open.id)} data-request-pricing
                      style={{ flex: 1, padding: '8px 0', border: 'none', background: '#1B4F8A', color: '#fff', borderRadius: 9, fontSize: '0.8125rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'center', textDecoration: 'none' }}>Request pricing</a>
                  ) : null}
                  <button type="button" onClick={() => onOpen(open.id)} style={open.href
                    ? { flex: 1, padding: '8px 0', border: '1px solid #E2E8F0', background: '#fff', color: '#0F172A', borderRadius: 9, fontSize: '0.8125rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }
                    : { flex: 1, padding: '8px 0', border: 'none', background: '#1B4F8A', color: '#fff', borderRadius: 9, fontSize: '0.8125rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>View board</button>
                  {explorer && !open.href && <StreetViewButton board={open} />}
                </div>
              </div>
              <button type="button" onClick={() => select(null)} aria-label="Close" style={{ position: 'absolute', top: 8, right: 8, width: 28, height: 28, borderRadius: '50%', border: 'none', background: 'rgba(255,255,255,0.94)', boxShadow: '0 1px 4px rgba(15,23,42,0.2)', cursor: 'pointer', display: 'grid', placeItems: 'center', color: '#0F172A' }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
              </button>
            </div>
          </Popup>
        )}

        {stack && (
          <Popup longitude={stack.at[0]} latitude={stack.at[1]} anchor="bottom" offset={22} closeButton={false} closeOnClick={false} onClose={() => setStack(null)} maxWidth="280px" className="ooh-map-card">
            <div data-map-stack style={{ fontFamily: "'Inter', -apple-system, sans-serif", width: 248, background: '#fff', borderRadius: 14, overflow: 'hidden' }}>
              <p style={{ margin: 0, padding: '10px 13px 8px', fontSize: '0.75rem', fontWeight: 600, color: '#64748B', borderBottom: '1px solid #F1F5F9' }}>{stack.ids.length} boards at this spot</p>
              <div style={{ maxHeight: 240, overflowY: 'auto' }}>
                {stack.ids.map(id => byId.get(id)).filter((b): b is MapBoard => !!b).map(b => (
                  <button key={b.id} type="button" onClick={() => select(b.id)}
                    onMouseEnter={() => onHover?.(b.id)} onMouseLeave={() => onHover?.(null)}
                    style={{ display: 'flex', gap: 10, alignItems: 'center', width: '100%', padding: '8px 13px', border: 'none', background: 'none', borderBottom: '1px solid #F8FAFC', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit' }}>
                    <span style={{ width: 40, height: 32, borderRadius: 6, background: '#F1F5F9', flexShrink: 0, overflow: 'hidden' }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {b.photo_urls?.[0] && <img src={b.photo_urls[0]} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />}
                    </span>
                    <span style={{ minWidth: 0, flex: 1 }}>
                      <span style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, color: '#0F172A', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.name}</span>
                      <span style={{ display: 'block', fontSize: '0.75rem', color: '#64748B' }}>{b.perMonth ? `${b.rate} /mo` : 'Price on request'}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </Popup>
        )}
      </OOHMap>

      {verificationColors && (
        <div className="ooh-legend">
          {(['partner_verified', 'verified', 'pending'] as VerificationStatus[]).map(v => (
            <span key={v}><i style={{ background: VERIFY_PIN[v] }} />{VERIFICATION_META[v].label}</span>
          ))}
        </div>
      )}

      {explorer && (
        <div className="ooh-map-tools">
          <div className="ooh-tool-row">
            <div className="ooh-style-switch" role="group" aria-label="Map style">
              {(['light', 'satellite'] as const).map(k => (
                <button key={k} type="button" aria-pressed={style === k} className={style === k ? 'on' : ''} onClick={() => setStyle(k)}>
                  {k === 'light' ? 'Map' : 'Satellite'}
                </button>
              ))}
            </div>
            <button type="button" className={`ooh-layers-btn${drawing || inArea ? ' on' : ''}`} aria-expanded={drawing} data-area-btn
              onClick={() => { if (drawing) setDrawing(false); else { setLayersOpen(false); startArea(areaMode); } }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><circle cx="12" cy="12" r="9" strokeDasharray="3 3"/><circle cx="12" cy="12" r="2"/></svg>
              Select area{inArea ? <b>{inArea.size}</b> : null}
            </button>
            <button type="button" className={`ooh-layers-btn${layersOpen || showPop || showPlaces ? ' on' : ''}`} aria-expanded={layersOpen} onClick={() => { setDrawing(false); setLayersOpen(o => !o); }} data-layers-btn>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m12 2 10 5-10 5L2 7z"/><path d="m2 12 10 5 10-5"/><path d="m2 17 10 5 10-5"/></svg>
              Layers{showPop || showPlaces ? <b>{(showPop ? 1 : 0) + (showPlaces ? 1 : 0)}</b> : null}
            </button>
          </div>
          {drawing && (
            <div className="ooh-layers ooh-area" role="dialog" aria-label="Select an area" data-area-panel>
              <div className="ooh-area-top">
                <p className="ooh-layers-h">Select an area</p>
                <button type="button" className="ooh-area-done" onClick={() => setDrawing(false)}>Done</button>
              </div>
              <div className="ooh-style-switch ooh-area-modes" role="group" aria-label="Kind of area">
                {([['spot', 'Around a spot'], ['road', 'Along a road']] as [AreaMode, string][]).map(([m, label]) => (
                  <button key={m} type="button" aria-pressed={areaMode === m} className={areaMode === m ? 'on' : ''} onClick={() => startArea(m)}>{label}</button>
                ))}
              </div>
              <p className="ooh-area-hint" data-area-hint>
                {areaMode === 'spot'
                  ? (taps.length ? 'Tap again to move the centre.' : 'Tap the map where you want to advertise.')
                  : taps.length === 0 ? 'Tap where the road starts.'
                  : taps.length === 1 ? 'Now tap where it ends. We follow the road between.'
                  : taps.length >= MAX_ROAD_TAPS ? 'That’s the most taps a road can take.'
                  : routing ? 'Following the road…' : 'Tap again to carry the road on.'}
              </p>
              {areaMode === 'spot' && taps.length === 1 && (
                <label className="ooh-area-range">
                  <span>Within <b>{radiusKm < 1 ? `${Math.round(radiusKm * 1000)} m` : `${radiusKm} km`}</b></span>
                  <input type="range" min={0.25} max={10} step={0.25} value={radiusKm} onChange={e => setRadiusKm(Number(e.target.value))} aria-label="Distance from the spot" />
                </label>
              )}
              {areaMode === 'road' && taps.length >= 2 && (
                <label className="ooh-area-range">
                  <span>Up to <b>{Math.round(widthKm * 1000)} m</b> either side of the road</span>
                  <input type="range" min={0.1} max={2} step={0.1} value={widthKm} onChange={e => setWidthKm(Number(e.target.value))} aria-label="Distance either side of the road" />
                </label>
              )}
              <div className="ooh-area-foot">
                <span data-area-count className={inArea?.size ? 'yes' : ''}>
                  {inArea ? `${inArea.size} board${inArea.size !== 1 ? 's' : ''} inside` : 'No area yet'}
                </span>
                <span className="ooh-area-acts">
                  {areaMode === 'road' && taps.length > 0 && <button type="button" onClick={() => setTaps(t => t.slice(0, -1))}>Undo</button>}
                  {taps.length > 0 && <button type="button" className="clear" onClick={() => setTaps([])}>Clear</button>}
                </span>
              </div>
            </div>
          )}
          {!drawing && inArea && (
            <div className="ooh-area-chip" data-area-chip>
              <span>{inArea.size} board{inArea.size !== 1 ? 's' : ''} in your area</span>
              <button type="button" onClick={() => startArea(areaMode)}>Edit</button>
              <button type="button" onClick={() => setTaps([])} aria-label="Clear area">✕</button>
            </div>
          )}
          {layersOpen && (
            <div className="ooh-layers" role="dialog" aria-label="Map layers" data-layers-panel>
              <p className="ooh-layers-h">Layers</p>
              <label className="ooh-layer">
                <span className="ooh-layer-ico" style={{ background: `linear-gradient(135deg, ${POP_RAMP[2]}, ${POP_RAMP[5]})` }} />
                <span><b>Population</b><small>Where people live · WorldPop 2020</small></span>
                <input type="checkbox" role="switch" checked={showPop} data-layer="population"
                  onChange={e => { setShowPop(e.target.checked); if (e.target.checked) trackMap('layer', 'population'); }} />
              </label>
              <label className="ooh-layer">
                <span className="ooh-layer-ico ooh-layer-dots"><i style={{ background: PLACE_META.mall.color }} /><i style={{ background: PLACE_META.bank.color }} /><i style={{ background: PLACE_META.restaurant.color }} /></span>
                <span><b>Places</b><small>Malls, banks, offices… · OpenStreetMap</small></span>
                <input type="checkbox" role="switch" checked={showPlaces} data-layer="places"
                  onChange={e => { setShowPlaces(e.target.checked); if (e.target.checked) trackMap('layer', 'places'); }} />
              </label>
              {showPlaces && (
                <div className="ooh-cats" role="group" aria-label="Kinds of place">
                  {LAYER_CATEGORIES.map(c => {
                    const on = cats.includes(c);
                    return (
                      <button key={c} type="button" aria-pressed={on} className={on ? 'on' : ''}
                        onClick={() => { setCats(cs => (on ? cs.filter(x => x !== c) : [...cs, c])); trackMap('layer', `places_${c}`); }}>
                        <i style={{ background: PLACE_META[c].color }} />{PLACE_META[c].many.replace(/^./, m => m.toUpperCase())}
                      </button>
                    );
                  })}
                </div>
              )}
              <p className="ooh-layers-key"><span className="ooh-key-dot" /> Static board <span className="ooh-key-dot ring" /> Digital screen</p>
            </div>
          )}
          {(showPop || (showPlaces && placesStatus.s !== 'ready' && placesStatus.s !== 'off')) && (
            <div className="ooh-legends">
              {showPop && (
                <div className="ooh-legend-pop" data-pop-legend>
                  <span>Residents</span><i style={{ background: `linear-gradient(90deg, ${POP_RAMP.slice(1).join(',')})` }} /><span className="lh"><small>Low</small><small>High</small></span>
                </div>
              )}
              {showPlaces && placesStatus.s === 'zoom' && <p className="ooh-hint" data-places-hint>Zoom in to see places</p>}
              {showPlaces && placesStatus.s === 'loading' && <p className="ooh-hint">Loading places…</p>}
              {showPlaces && placesStatus.s === 'error' && <p className="ooh-hint">Places could not load</p>}
            </div>
          )}
        </div>
      )}

      <style>{`
        .ooh-map-card .mapboxgl-popup-content { padding: 0; border-radius: 14px; box-shadow: 0 18px 40px -12px rgba(15,23,42,.35), 0 0 0 1px rgba(15,23,42,.06); position: relative; }
        .ooh-map-card .mapboxgl-popup-tip { border-top-color: #fff; }
        .ooh-map-card { animation: oohCardIn .16s ease-out; }
        @keyframes oohCardIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; } }
        .ooh-map-tools { position: absolute; left: 10px; bottom: 34px; z-index: 5; display: flex; flex-direction: column-reverse; align-items: flex-start; gap: 8px; font-family: 'Inter', sans-serif; }
        .ooh-tool-row { display: flex; gap: 6px; align-items: center; }
        .ooh-style-switch { display: flex; padding: 3px; gap: 2px; background: rgba(255,255,255,.96); border-radius: 10px; box-shadow: 0 2px 10px rgba(15,23,42,.14), 0 0 0 1px rgba(15,23,42,.06); }
        .ooh-layers-btn { display: inline-flex; align-items: center; gap: 6px; height: 33px; padding: 0 11px; border: none; border-radius: 10px; background: rgba(255,255,255,.96); color: #0F172A; font: 600 12px/1 'Inter', sans-serif; cursor: pointer; box-shadow: 0 2px 10px rgba(15,23,42,.14), 0 0 0 1px rgba(15,23,42,.06); }
        .ooh-layers-btn.on { color: #1B4F8A; }
        .ooh-layers-btn b { min-width: 16px; height: 16px; border-radius: 8px; background: #1B4F8A; color: #fff; font-size: 10px; display: inline-grid; place-items: center; padding: 0 4px; }
        .ooh-layers { width: 268px; background: #fff; border-radius: 14px; padding: 12px; box-shadow: 0 16px 40px -14px rgba(15,23,42,.35), 0 0 0 1px rgba(15,23,42,.07); animation: oohCardIn .14s ease-out; }
        .ooh-layers-h { margin: 0 0 6px 2px; font-size: 11px; font-weight: 700; color: #64748B; text-transform: uppercase; letter-spacing: .05em; }
        .ooh-layer { display: flex; align-items: center; gap: 10px; padding: 8px 4px; border-radius: 10px; cursor: pointer; }
        .ooh-layer:hover { background: #F8FAFC; }
        .ooh-layer > span:nth-child(2) { flex: 1; min-width: 0; display: flex; flex-direction: column; }
        .ooh-layer b { font-size: 13px; color: #0F172A; font-weight: 600; }
        .ooh-layer small { font-size: 11px; color: #64748B; }
        .ooh-layer-ico { width: 30px; height: 30px; border-radius: 8px; flex-shrink: 0; }
        .ooh-layer-dots { background: #F1F5F9; display: grid; grid-template-columns: repeat(3, 6px); gap: 2px; place-content: center; }
        .ooh-layer-dots i { width: 6px; height: 6px; border-radius: 50%; }
        .ooh-layer input { appearance: none; width: 32px; height: 19px; border-radius: 10px; background: #CBD5E1; position: relative; cursor: pointer; transition: background .15s; flex-shrink: 0; margin: 0; }
        .ooh-layer input::after { content: ''; position: absolute; top: 2px; left: 2px; width: 15px; height: 15px; border-radius: 50%; background: #fff; box-shadow: 0 1px 2px rgba(15,23,42,.25); transition: transform .15s; }
        .ooh-layer input:checked { background: #1B4F8A; }
        .ooh-layer input:checked::after { transform: translateX(13px); }
        .ooh-layer input:focus-visible { outline: 2px solid #1B4F8A; outline-offset: 2px; }
        .ooh-cats { display: flex; flex-wrap: wrap; gap: 5px; padding: 2px 4px 6px 44px; }
        .ooh-cats button { display: inline-flex; align-items: center; gap: 5px; border: 1px solid #E2E8F0; background: #fff; color: #94A3B8; border-radius: 999px; padding: 4px 8px; font: 500 11px/1 'Inter', sans-serif; cursor: pointer; }
        .ooh-cats button.on { color: #0F172A; border-color: #CBD5E1; }
        .ooh-cats button i { width: 7px; height: 7px; border-radius: 50%; opacity: .3; }
        .ooh-cats button.on i { opacity: 1; }
        .ooh-layers-key { margin: 6px 4px 0; padding-top: 8px; border-top: 1px solid #F1F5F9; font-size: 11px; color: #64748B; display: flex; align-items: center; gap: 6px; }
        .ooh-key-dot { width: 10px; height: 10px; border-radius: 50%; background: #1B4F8A; box-shadow: 0 0 0 1.5px #fff, 0 0 0 2.5px rgba(15,23,42,.12); display: inline-block; }
        .ooh-key-dot.ring { background: radial-gradient(circle, #fff 0 2.5px, #1B4F8A 3px); margin-left: 8px; }
        .ooh-legends { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; }
        .ooh-legend-pop { display: grid; grid-template-columns: auto 90px; align-items: center; column-gap: 8px; padding: 6px 10px; background: rgba(255,255,255,.96); border-radius: 9px; box-shadow: 0 2px 8px rgba(15,23,42,.1), 0 0 0 1px rgba(15,23,42,.06); font: 600 11px/1 'Inter', sans-serif; color: #334155; }
        .ooh-legend-pop i { height: 6px; border-radius: 3px; display: block; }
        .ooh-legend-pop .lh { grid-column: 2; display: flex; justify-content: space-between; margin-top: 3px; }
        .ooh-legend-pop small { font-size: 9.5px; font-weight: 500; color: #94A3B8; }
        .ooh-hint { margin: 0; padding: 6px 10px; background: rgba(15,23,42,.82); color: #fff; border-radius: 9px; font: 600 11px/1.2 'Inter', sans-serif; }
        .ooh-style-switch button { border: none; background: none; font: 600 12px/1 'Inter', sans-serif; color: #475569; padding: 7px 11px; border-radius: 7px; cursor: pointer; }
        .ooh-style-switch button.on { background: #0F172A; color: #fff; }
        [data-map-explorer] .mapboxgl-ctrl-top-right { margin-top: 2px; }
        .ooh-drawing, .ooh-drawing .mapboxgl-canvas { cursor: crosshair !important; }
        .ooh-tap { width: 18px; height: 18px; border-radius: 50%; background: #1B4F8A; border: 2px solid #fff; box-shadow: 0 2px 6px rgba(15,23,42,.35); display: grid; place-items: center; color: #fff; font: 700 9px/1 'Inter', sans-serif; }
        .ooh-area { display: flex; flex-direction: column; gap: 10px; }
        .ooh-area-top { display: flex; align-items: center; justify-content: space-between; }
        .ooh-area-top .ooh-layers-h { margin: 0 0 0 2px; }
        .ooh-area-done { border: none; background: #0F172A; color: #fff; font: 600 12px/1 'Inter', sans-serif; padding: 7px 12px; border-radius: 8px; cursor: pointer; }
        .ooh-area-modes { box-shadow: none; background: #F1F5F9; }
        .ooh-area-modes button { flex: 1; }
        .ooh-area-hint { margin: 0 2px; font-size: 12px; color: #334155; line-height: 1.4; }
        .ooh-area-range { display: flex; flex-direction: column; gap: 6px; font-size: 12px; color: #64748B; margin: 0 2px; }
        .ooh-area-range b { color: #0F172A; }
        .ooh-area-range input { width: 100%; accent-color: #1B4F8A; margin: 0; }
        .ooh-area-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 2px 0; border-top: 1px solid #F1F5F9; font-size: 12px; font-weight: 700; color: #94A3B8; }
        .ooh-area-foot .yes { color: #065F46; }
        .ooh-area-acts { display: flex; gap: 12px; }
        .ooh-area-acts button { border: none; background: none; padding: 0; font: 600 12px/1 'Inter', sans-serif; color: #475569; cursor: pointer; }
        .ooh-area-acts button.clear { color: #DC2626; }
        .ooh-area-chip { display: inline-flex; align-items: center; gap: 10px; padding: 6px 6px 6px 11px; background: #0F172A; color: #fff; border-radius: 10px; font: 600 12px/1 'Inter', sans-serif; box-shadow: 0 6px 18px -6px rgba(15,23,42,.5); }
        .ooh-area-chip button { border: none; background: rgba(255,255,255,.14); color: #fff; font: 600 11px/1 'Inter', sans-serif; padding: 6px 9px; border-radius: 7px; cursor: pointer; }
        .ooh-legend { position: absolute; left: 12px; bottom: 30px; z-index: 5; display: flex; flex-direction: column; gap: 4px; padding: 8px 10px; background: rgba(255,255,255,.96); border-radius: 10px; box-shadow: 0 2px 8px rgba(15,23,42,.1), 0 0 0 1px rgba(15,23,42,.06); font: 500 11px/1.2 'Inter', sans-serif; color: #475569; }
        .ooh-legend span { display: flex; align-items: center; gap: 6px; }
        .ooh-legend i { width: 9px; height: 9px; border-radius: 50%; border: 1.5px solid #fff; box-shadow: 0 0 0 1px rgba(15,23,42,.12); }
        @media (max-width: 900px) {
          [data-map-explorer] .ooh-map-tools { bottom: auto; top: 58px; flex-direction: column; }
          [data-map-explorer] .ooh-layers { width: min(268px, calc(100vw - 20px)); }
        }
      `}</style>
    </div>
  );
}
