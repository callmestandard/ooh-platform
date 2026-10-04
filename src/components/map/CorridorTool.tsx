'use client';

import { useEffect, useMemo, useState } from 'react';
import { Marker, Source, Layer, useMap, type MapMouseEvent } from './engine';
import { boardsWithinRadius, boardsWithinCorridor, corridorPolygon, circlePolygon, type GeoPoint, type CorridorBoard } from './corridor';

export type CorridorMode = 'off' | 'radius' | 'corridor';
type Mode = CorridorMode;

type Props<T extends CorridorBoard> = {
  boards: T[];
  onMatchedChange: (matched: T[]) => void;
  /** Lets the host stop its own marker clicks from firing while the tool owns map clicks. */
  onModeChange?: (mode: CorridorMode) => void;
};

/**
 * Corridor/radius campaign-planning tool: draw either a radius circle around
 * a point, or a multi-point route corridor, and every board in the `boards`
 * table that falls inside it is returned via onMatchedChange — the caller
 * (campaign planner) feeds that straight into its existing shortlist.
 *
 * Drawing is click-to-place (same interaction already used for the
 * boards-map route planner) rather than the Mapbox GL Draw plugin, so the
 * tool's own UI stays in the app's inline-style design system instead of
 * Draw's harder-to-restyle default controls.
 */
export default function CorridorTool<T extends CorridorBoard>({ boards, onMatchedChange, onModeChange }: Props<T>) {
  const { current: mapRef } = useMap();
  const [mode, setMode] = useState<Mode>('off');
  const [points, setPoints] = useState<GeoPoint[]>([]);
  const [radiusKm, setRadiusKm] = useState(2);
  const [corridorWidthKm, setCorridorWidthKm] = useState(1);

  useEffect(() => {
    const map = mapRef?.getMap();
    if (!map || mode === 'off') return;
    function handleClick(e: MapMouseEvent) {
      const p: GeoPoint = { lng: e.lngLat.lng, lat: e.lngLat.lat };
      setPoints(prev => (mode === 'radius' ? [p] : [...prev, p]));
    }
    map.on('click', handleClick);
    const canvas = map.getCanvas();
    canvas.style.cursor = 'crosshair';
    return () => {
      map.off('click', handleClick);
      canvas.style.cursor = '';
    };
  }, [mapRef, mode]);

  const matched = useMemo(() => {
    if (mode === 'radius' && points.length === 1) return boardsWithinRadius(boards, points[0], radiusKm);
    if (mode === 'corridor' && points.length >= 2) return boardsWithinCorridor(boards, points, corridorWidthKm);
    return [];
  }, [mode, points, boards, radiusKm, corridorWidthKm]);

  useEffect(() => { onMatchedChange(matched); }, [matched, onMatchedChange]);
  useEffect(() => { onModeChange?.(mode); }, [mode, onModeChange]);
  // Hand marker clicks back to the host when the tool is closed.
  useEffect(() => () => { onModeChange?.('off'); }, [onModeChange]);

  const overlay = mode === 'radius' && points.length === 1
    ? circlePolygon(points[0], radiusKm)
    : mode === 'corridor' && points.length >= 2
      ? corridorPolygon(points, corridorWidthKm)
      : null;

  function clear() {
    setPoints([]);
  }

  function undo() {
    setPoints(prev => prev.slice(0, -1));
  }

  function setModeAndClear(m: Mode) {
    setMode(m);
    setPoints([]);
  }

  return (
    <>
      {/* ── Control panel ── */}
      <div style={{ position: 'absolute', bottom: 20, right: 12, zIndex: 10, width: 260, background: 'rgba(255,255,255,0.99)', border: '1px solid rgba(0,0,0,0.1)', borderRadius: 12, boxShadow: '0 8px 32px rgba(0,0,0,0.15)', overflow: 'hidden', fontFamily: "'Inter', sans-serif" }}>
        <div style={{ padding: '10px 14px', borderBottom: '1px solid #F1F5F9', display: 'flex', gap: 6 }}>
          {([['off', 'Off'], ['radius', '◎ Radius'], ['corridor', '⟿ Corridor']] as [Mode, string][]).map(([m, label]) => (
            <button
              key={m}
              onClick={() => setModeAndClear(m)}
              style={{
                flex: 1, padding: '6px 8px', borderRadius: 7, border: 'none', cursor: 'pointer',
                background: mode === m ? '#1B4F8A' : '#F1F5F9', color: mode === m ? '#fff' : '#475569',
                fontSize: '0.75rem', fontWeight: 600, fontFamily: 'inherit',
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {mode !== 'off' && (
          <div style={{ padding: '12px 14px' }}>
            {mode === 'radius' && (
              <>
                <p style={{ fontSize: '0.75rem', color: '#64748B', margin: '0 0 8px' }}>
                  {points.length === 0 ? 'Click the map to drop a center point' : `Radius: ${radiusKm.toFixed(1)} km`}
                </p>
                {points.length === 1 && (
                  <input type="range" min={0.5} max={15} step={0.5} value={radiusKm} onChange={e => setRadiusKm(parseFloat(e.target.value))} style={{ width: '100%' }} />
                )}
              </>
            )}
            {mode === 'corridor' && (
              <>
                <p style={{ fontSize: '0.75rem', color: '#64748B', margin: '0 0 8px' }}>
                  {points.length === 0
                    ? 'Click the map to start a route'
                    : `${points.length} point${points.length !== 1 ? 's' : ''} · width ${corridorWidthKm.toFixed(1)} km`}
                </p>
                {points.length >= 2 && (
                  <input type="range" min={0.2} max={5} step={0.2} value={corridorWidthKm} onChange={e => setCorridorWidthKm(parseFloat(e.target.value))} style={{ width: '100%' }} />
                )}
              </>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
              <span style={{ fontSize: '0.75rem', fontWeight: 700, color: matched.length > 0 ? '#065F46' : '#94A3B8' }}>
                {matched.length} board{matched.length !== 1 ? 's' : ''} inside
              </span>
              {points.length > 0 && (
                <span style={{ display: 'flex', gap: 10 }}>
                  {mode === 'corridor' && (
                    <button onClick={undo} style={{ fontSize: '0.6875rem', fontWeight: 600, color: '#475569', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>Undo point</button>
                  )}
                  <button onClick={clear} style={{ fontSize: '0.6875rem', fontWeight: 600, color: '#EF4444', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>Clear</button>
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Drawn shape overlay ── */}
      {overlay && (
        <Source id="corridor-tool-overlay" type="geojson" data={overlay}>
          <Layer id="corridor-tool-fill" type="fill" paint={{ 'fill-color': '#1B4F8A', 'fill-opacity': 0.15 }} />
          <Layer id="corridor-tool-outline" type="line" paint={{ 'line-color': '#1B4F8A', 'line-width': 2 }} />
        </Source>
      )}

      {mode === 'corridor' && points.length >= 2 && (
        <Source id="corridor-tool-route" type="geojson" data={{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: points.map(p => [p.lng, p.lat]) } }}>
          <Layer id="corridor-tool-route-line" type="line" paint={{ 'line-color': '#1B4F8A', 'line-width': 2, 'line-dasharray': [2, 2] }} />
        </Source>
      )}

      {/* ── Clicked waypoints (corridor mode) ── */}
      {mode === 'corridor' && points.map((p, i) => (
        <Marker key={i} longitude={p.lng} latitude={p.lat} anchor="center">
          <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#1B4F8A', border: '2px solid #fff', boxShadow: '0 2px 6px rgba(0,0,0,0.3)' }} />
        </Marker>
      ))}
      {mode === 'radius' && points.map((p, i) => (
        <Marker key={i} longitude={p.lng} latitude={p.lat} anchor="center">
          <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#1B4F8A', border: '2px solid #fff', boxShadow: '0 2px 6px rgba(0,0,0,0.3)' }} />
        </Marker>
      ))}
    </>
  );
}
