'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import OOHMap, { Source, Layer, Marker, NavigationControl, type MapRef } from './OOHMap';

/**
 * A board on a tilted 3D street map: 3D buildings around it, the board itself
 * drawn at its real size (pole + panel), and a camera that flies in from the
 * city and slowly circles the site until the viewer takes over.
 */

export type NearbyBoard = { id: string; name: string; lat: number; lng: number; href: string };

type Props = {
  lat: number;
  lng: number;
  format: string | null | undefined;
  width?: number | null;   // metres
  height?: number | null;  // metres
  name?: string;
  /** Compass direction the face points to (0 = north). Unknown = 0. */
  facing?: number | null;
  nearby?: NearbyBoard[];
  height_px?: number;
  /** Start already tilted and skip the fly-in (dashboards). */
  instant?: boolean;
};

const STYLE_3D = 'mapbox://styles/mapbox/standard';
const STYLE_SAT = 'mapbox://styles/mapbox/standard-satellite';

// Rough real-world shapes per format, in metres.
function shapeFor(format: string | null | undefined, width?: number | null, height?: number | null) {
  const a = Math.abs(width || 0), b = Math.abs(height || 0);
  let w = Math.max(a, b), h = Math.min(a, b);
  const f = (format || 'billboard').toLowerCase();
  const defaults: Record<string, { w: number; h: number; pole: number; legs: 'one' | 'two' | 'none' }> = {
    billboard:    { w: 12, h: 4,  pole: 8,  legs: 'one' },
    digital:      { w: 10, h: 5,  pole: 7,  legs: 'one' },
    led:          { w: 10, h: 5,  pole: 7,  legs: 'one' },
    unipole:      { w: 12, h: 5,  pole: 12, legs: 'one' },
    gantry:       { w: 22, h: 3,  pole: 6,  legs: 'two' },
    bridge_panel: { w: 15, h: 3,  pole: 5,  legs: 'none' },
    wall_drape:   { w: 10, h: 14, pole: 2,  legs: 'none' },
  };
  const d = defaults[f] ?? defaults.billboard;
  if (!w) { w = d.w; h = d.h; }
  if (f === 'wall_drape') [w, h] = [Math.min(a || d.w, b || d.h), Math.max(a || d.w, b || d.h)]; // tall
  w = Math.min(Math.max(w, 3), 40);
  h = Math.min(Math.max(h || d.h, 2), 24);
  return { w, h, pole: d.pole, legs: d.legs };
}

// A rotated rectangle around (cx, cy) metres from the board, as [lng, lat].
function rect(lat: number, lng: number, cx: number, cy: number, w: number, d: number, bearingDeg: number) {
  const t = (bearingDeg * Math.PI) / 180;
  const mLat = 111_320, mLng = 111_320 * Math.cos((lat * Math.PI) / 180);
  const pts = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2], [-w / 2, -d / 2]].map(([x, y]) => {
    const px = x + cx, py = y + cy;
    // Clockwise rotation (compass bearing): the panel's face points to `bearing`.
    const rx = px * Math.cos(t) + py * Math.sin(t);
    const ry = -px * Math.sin(t) + py * Math.cos(t);
    return [lng + rx / mLng, lat + ry / mLat];
  });
  return [pts];
}

function boardModel(lat: number, lng: number, format: string | null | undefined, width?: number | null, height?: number | null, facing = 0) {
  const { w, h, pole, legs } = shapeFor(format, width, height);
  const feature = (coords: number[][][], base: number, top: number, color: string, part: string) => ({
    type: 'Feature' as const,
    properties: { base, top, color, part },
    geometry: { type: 'Polygon' as const, coordinates: coords },
  });
  const parts = [
    // The face, then a thin darker back so the front reads clearly.
    feature(rect(lat, lng, 0, 0.25, w, 0.5, facing), pole, pole + h, '#2F6BFF', 'face'),
    feature(rect(lat, lng, 0, -0.35, w + 0.4, 0.7, facing), pole - 0.3, pole + h + 0.3, '#1E293B', 'frame'),
  ];
  if (legs === 'one') parts.push(feature(rect(lat, lng, 0, -0.5, 1.1, 1.1, facing), 0, pole, '#475569', 'pole'));
  if (legs === 'two') {
    parts.push(feature(rect(lat, lng, -w / 2 + 0.6, -0.4, 0.9, 0.9, facing), 0, pole + h, '#475569', 'pole'));
    parts.push(feature(rect(lat, lng, w / 2 - 0.6, -0.4, 0.9, 0.9, facing), 0, pole + h, '#475569', 'pole'));
  }
  return { type: 'FeatureCollection' as const, features: parts };
}

export default function Board3DMap({ lat, lng, format, width, height, name, facing, nearby = [], height_px = 420, instant }: Props) {
  const mapRef = useRef<MapRef>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const orbiting = useRef(false);
  const flown = useRef(false);
  const [is3D, setIs3D] = useState(true);
  const [satellite, setSatellite] = useState(false);
  const [orbit, setOrbit] = useState(false);
  const [ready, setReady] = useState(false);
  const face = facing ?? 0;
  const model = useMemo(() => boardModel(lat, lng, format, width, height, face), [lat, lng, format, width, height, face]);
  const reduceMotion = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  // Look at the face from in front of it, slightly to one side.
  const viewBearing = (face + 180 + 25) % 360;

  const close = useCallback((duration = 2800) => {
    const map = mapRef.current;
    if (!map) return;
    map.flyTo({ center: [lng, lat], zoom: 18.3, pitch: 66, bearing: viewBearing, duration: reduceMotion ? 0 : duration, essential: true });
  }, [lat, lng, viewBearing, reduceMotion]);

  // Slow circle around the board until someone touches the map.
  useEffect(() => {
    orbiting.current = orbit;
    if (!orbit) return;
    let raf = 0, last = performance.now();
    const step = (now: number) => {
      const map = mapRef.current?.getMap();
      if (!map || !orbiting.current) return;
      if (!map.isMoving()) map.setBearing(map.getBearing() + ((now - last) / 1000) * 6);
      last = now;
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [orbit]);

  // Fly in the first time the map scrolls into view.
  useEffect(() => {
    if (!ready || flown.current) return;
    const el = wrapRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting || flown.current) return;
      flown.current = true;
      io.disconnect();
      if (instant) return;
      close();
      const map = mapRef.current?.getMap();
      map?.once('moveend', () => { if (!reduceMotion) setOrbit(true); });
    }, { threshold: 0.35 });
    io.observe(el);
    return () => io.disconnect();
  }, [ready, close, instant, reduceMotion]);

  function onLoad() {
    const map = mapRef.current?.getMap();
    try {
      // Standard style options: daylight, fewer labels so the board stands out.
      map?.setConfigProperty('basemap', 'lightPreset', 'day');
      map?.setConfigProperty('basemap', 'showPointOfInterestLabels', false);
      map?.setConfigProperty('basemap', 'showTransitLabels', false);
    } catch { /* style without these options */ }
    setReady(true);
  }

  const stopOrbit = () => { if (orbiting.current) setOrbit(false); };

  function toggle3D() {
    const map = mapRef.current;
    if (!map) return;
    stopOrbit();
    const next = !is3D;
    setIs3D(next);
    map.easeTo({ pitch: next ? 66 : 0, bearing: next ? viewBearing : 0, zoom: next ? 18.3 : 16.5, duration: 900 });
  }

  const btn: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 11px', borderRadius: 9, border: '1px solid rgba(15,23,42,0.12)',
    background: 'rgba(255,255,255,0.95)', color: '#0F172A', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
    boxShadow: '0 2px 8px rgba(15,23,42,0.12)', whiteSpace: 'nowrap',
  };
  const on: React.CSSProperties = { ...btn, background: '#1B4F8A', color: '#fff', borderColor: '#1B4F8A' };

  return (
    <div ref={wrapRef} data-board-3d-map style={{ position: 'relative', height: height_px, borderRadius: 16, overflow: 'hidden', background: '#E2E8F0' }}
      onPointerDown={stopOrbit} onWheel={stopOrbit} onTouchStart={stopOrbit}>
      <OOHMap
        ref={mapRef}
        mapStyleUrl={satellite ? STYLE_SAT : STYLE_3D}
        initialViewState={instant
          ? { longitude: lng, latitude: lat, zoom: 18, pitch: 62, bearing: viewBearing }
          : { longitude: lng, latitude: lat, zoom: 13.2, pitch: 0, bearing: 0 }}
        maxPitch={75}
        cooperativeGestures
        hideNavControl
        onLoad={onLoad}
        style={{ width: '100%', height: '100%' }}
      >
        <NavigationControl position="top-right" showCompass visualizePitch />
        <Source id="board-model" type="geojson" data={model}>
          <Layer
            id="board-model-3d"
            type="fill-extrusion"
            paint={{
              'fill-extrusion-color': ['get', 'color'],
              'fill-extrusion-base': ['get', 'base'],
              'fill-extrusion-height': ['get', 'top'],
              'fill-extrusion-opacity': 1,
              'fill-extrusion-emissive-strength': ['match', ['get', 'part'], 'face', 0.9, 0.2],
            }}
          />
        </Source>

        <Marker longitude={lng} latitude={lat} anchor="bottom" offset={[0, -6]}>
          <div style={{ pointerEvents: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <span style={{ background: '#0F172A', color: '#fff', fontSize: 11.5, fontWeight: 700, padding: '4px 9px', borderRadius: 999, boxShadow: '0 4px 12px rgba(0,0,0,0.25)', whiteSpace: 'nowrap', fontFamily: "'Inter', sans-serif" }}>
              {name ? (name.length > 28 ? name.slice(0, 27) + '…' : name) : 'This board'}
            </span>
            {/* Long stalk so the label floats above the 3D board instead of covering it. */}
            <span style={{ width: 2, height: 58, background: 'linear-gradient(#0F172A, rgba(15,23,42,0.15))' }} />
          </div>
        </Marker>

        {nearby.map(n => (
          <Marker key={n.id} longitude={n.lng} latitude={n.lat} anchor="center">
            <a href={n.href} title={n.name} aria-label={`Nearby board: ${n.name}`}
              style={{ display: 'block', width: 14, height: 14, borderRadius: '50%', background: '#F59E0B', border: '2.5px solid #fff', boxShadow: '0 2px 6px rgba(0,0,0,0.3)' }} />
          </Marker>
        ))}
      </OOHMap>

      <div style={{ position: 'absolute', top: 10, left: 10, right: 52, display: 'flex', gap: 6, flexWrap: 'wrap', zIndex: 2 }}>
        <button type="button" style={is3D ? on : btn} onClick={toggle3D} aria-pressed={is3D} data-map-3d-toggle>{is3D ? '3D' : '2D'} view</button>
        <button type="button" style={satellite ? on : btn} onClick={() => setSatellite(s => !s)} aria-pressed={satellite}>Satellite</button>
        <button type="button" style={orbit ? on : btn} onClick={() => { if (!orbit) { setIs3D(true); close(900); } setOrbit(o => !o); }} aria-pressed={orbit} data-map-orbit>
          {orbit ? 'Stop' : 'Look around'}
        </button>
        <button type="button" style={btn} onClick={() => { stopOrbit(); setIs3D(true); close(1200); }} aria-label="Back to the board">⌖</button>
      </div>
      {nearby.length > 0 && (
        <span style={{ position: 'absolute', bottom: 34, left: 10, zIndex: 2, ...btn, cursor: 'default', gap: 6 }}>
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#F59E0B', border: '2px solid #fff', boxShadow: '0 0 0 1px rgba(0,0,0,.15)' }} />
          {nearby.length} more nearby
        </span>
      )}
    </div>
  );
}
