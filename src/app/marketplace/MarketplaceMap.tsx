'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import OOHMap, { Popup, type MapRef } from '@/components/map/OOHMap';
import BoardPins, { type BoardPin } from '@/components/map/BoardPins';
import { VerificationBadge, VERIFICATION_META, verificationOf, type VerificationStatus } from '@/lib/board-verification';
import { boardFormatLabel } from '@/lib/board-formats';
import type { MapStyleKey } from '@/components/map/ooh-map-shared';
import { PhotoStepper, StreetViewButton } from './BoardLook';
import { SHOW_PRICES } from '@/lib/mvp';

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
};

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
  fitKey, trimOutliers, cooperative = true, preview = true, explorer, verificationColors, focus, fitPadding,
}: Props) {
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
    const CARD_H = 350, HALF_W = 150, EDGE = 14;
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

  // Escape closes the card.
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { setStack(null); select(null); } };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [select]);

  const pins = useMemo<BoardPin[]>(
    () => boards.map(b => ({
      id: b.id, lng: b.longitude, lat: b.latitude, label: b.pin ?? (b.perMonth ? b.rate : 'Quote'),
      color: verificationColors ? VERIFY_PIN[verificationOf(b)] : undefined,
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
          // A click on empty map closes the card (pins handle their own clicks).
          const hit = mapRef.current?.queryRenderedFeatures(e.point).some(f => String(f.layer?.id ?? '').startsWith('marketplace-boards'));
          if (!hit) { setStack(null); select(null); }
        }}
        navPosition={explorer ? 'top-right' : 'bottom-right'}
        geolocate={explorer}
        search
        searchWidth={explorer ? 260 : 280}
        searchPlaceholder="Go to a place or street…"
      >
        <BoardPins
          sourceId="marketplace-boards"
          pins={pins}
          activeIds={activeIds}
          onPinClick={id => select(id === selId ? null : id)}
          onPinHover={onHover}
          onStackClick={(ids, at) => { select(null); setStack({ ids, at }); }}
          prices={!verificationColors && SHOW_PRICES}
        />

        {open && (
          <Popup longitude={open.longitude} latitude={open.latitude} anchor="bottom" offset={18} closeButton={false} closeOnClick={false} onClose={() => select(null)} maxWidth="280px" className="ooh-map-card">
            <div data-map-card style={{ fontFamily: "'Inter', -apple-system, sans-serif", width: 256, borderRadius: 14, overflow: 'hidden', background: '#fff' }}>
              <PhotoStepper key={open.id} photos={(open.photo_urls ?? []).filter(Boolean)} alt={open.name} height={140} />
              <div style={{ padding: '11px 13px 12px' }}>
                <button type="button" onClick={() => onOpen(open.id)} style={{ all: 'unset', display: 'block', width: '100%', cursor: 'pointer' }} aria-label={`Open ${open.name}`}>
                  <p style={{ fontSize: '0.875rem', fontWeight: 700, color: '#0F172A', margin: '0 0 2px', lineHeight: 1.3, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{open.name}</p>
                  <p style={{ fontSize: '0.75rem', color: '#64748B', margin: '0 0 8px' }}>{[open.area, open.city].filter(Boolean).join(', ')} · {boardFormatLabel(open.format)}</p>
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
                  <button type="button" onClick={() => onOpen(open.id)} style={{ flex: 1, padding: '8px 0', border: 'none', background: '#1B4F8A', color: '#fff', borderRadius: 9, fontSize: '0.8125rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>View board</button>
                  {explorer && <StreetViewButton board={open} />}
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
        <div className="ooh-style-switch" role="group" aria-label="Map style">
          {(['light', 'satellite'] as const).map(k => (
            <button key={k} type="button" aria-pressed={style === k} className={style === k ? 'on' : ''} onClick={() => setStyle(k)}>
              {k === 'light' ? 'Map' : 'Satellite'}
            </button>
          ))}
        </div>
      )}

      <style>{`
        .ooh-map-card .mapboxgl-popup-content { padding: 0; border-radius: 14px; box-shadow: 0 18px 40px -12px rgba(15,23,42,.35), 0 0 0 1px rgba(15,23,42,.06); position: relative; }
        .ooh-map-card .mapboxgl-popup-tip { border-top-color: #fff; }
        .ooh-map-card { animation: oohCardIn .16s ease-out; }
        @keyframes oohCardIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; } }
        .ooh-style-switch { position: absolute; left: 10px; bottom: 34px; z-index: 5; display: flex; padding: 3px; gap: 2px; background: rgba(255,255,255,.96); border-radius: 10px; box-shadow: 0 2px 10px rgba(15,23,42,.14), 0 0 0 1px rgba(15,23,42,.06); }
        .ooh-style-switch button { border: none; background: none; font: 600 12px/1 'Inter', sans-serif; color: #475569; padding: 7px 11px; border-radius: 7px; cursor: pointer; }
        .ooh-style-switch button.on { background: #0F172A; color: #fff; }
        [data-map-explorer] .mapboxgl-ctrl-top-right { margin-top: 2px; }
        .ooh-legend { position: absolute; left: 12px; bottom: 30px; z-index: 5; display: flex; flex-direction: column; gap: 4px; padding: 8px 10px; background: rgba(255,255,255,.96); border-radius: 10px; box-shadow: 0 2px 8px rgba(15,23,42,.1), 0 0 0 1px rgba(15,23,42,.06); font: 500 11px/1.2 'Inter', sans-serif; color: #475569; }
        .ooh-legend span { display: flex; align-items: center; gap: 6px; }
        .ooh-legend i { width: 9px; height: 9px; border-radius: 50%; border: 1.5px solid #fff; box-shadow: 0 0 0 1px rgba(15,23,42,.12); }
        @media (max-width: 900px) { [data-map-explorer] .ooh-style-switch { bottom: auto; top: 58px; left: 10px; } }
      `}</style>
    </div>
  );
}
