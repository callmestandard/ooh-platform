'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import OOHMap, { Source, Layer, type MapRef } from '@/components/map/OOHMap';
import type { MapMouseEvent } from '@/components/map/engine';
import { MARKET_INTEL_STYLE_URL, NIGERIA_BOUNDS } from '@/components/map/ooh-map-shared';
import { NO_DATA_COLOR, classColors, type GeoLevel } from '@/lib/geo/metrics';
import type { H3Meta } from '@/lib/geo/types';
import { T, numeric } from './ui';

export type HexMetric = 'd' | 'yd';
export type MapBoard = { id: string; name: string; lng: number; lat: number };
export type HoverCard = { title: string; subtitle?: string; lines: { label: string; value: string }[] };

/** Zoom at which the hexagon layers take over from the LGA/state fill. */
export const HEX_MIN_ZOOM = 8;

type Props = {
  level: GeoLevel;
  lgaGeo: GeoJSON.FeatureCollection;
  stateGeo: GeoJSON.FeatureCollection;
  /** pcode → fill colour for the geography level in view. Anything missing is drawn as "no data". */
  fillByCode: Record<string, string>;
  /** LGA pcodes to outline as low confidence for the metric in view. */
  flaggedCodes: string[];
  selectedCode: string | null;
  /** Set when the metric has a hexagon version; null keeps the fill at every zoom. */
  hexMetric: HexMetric | null;
  h3Meta: H3Meta | null;
  boards: MapBoard[];
  /** Fit the map to this box when it changes (e.g. a state picked from the list). */
  focusBounds: [number, number, number, number] | null;
  describeArea: (code: string) => HoverCard | null;
  describeHex: (props: { pop: number; y: number; d: number; yd: number }, resolution: number) => HoverCard;
  onSelect: (code: string) => void;
  onZoomChange: (zoom: number) => void;
};

const FILL = 'mi-fill';
const BOARDS = 'mi-boards';
const hexLayerId = (res: number) => `mi-h3-r${res}`;

export default function MarketMap({
  level, lgaGeo, stateGeo, fillByCode, flaggedCodes, selectedCode, hexMetric, h3Meta, boards, focusBounds,
  describeArea, describeHex, onSelect, onZoomChange,
}: Props) {
  const mapRef = useRef<MapRef>(null);
  const [labelLayerId, setLabelLayerId] = useState<string | undefined>(undefined);
  const [loaded, setLoaded] = useState(false);
  const [hover, setHover] = useState<HoverCard | null>(null);
  const hoverKeyRef = useRef<string | null>(null);
  const hoverPointRef = useRef({ x: 0, y: 0 });
  const hoverElRef = useRef<HTMLDivElement>(null);

  // The card follows the pointer by moving its DOM node directly; React re-renders only
  // when the pointer crosses into a different feature.
  const placeHover = useCallback(() => {
    const el = hoverElRef.current;
    if (el) el.style.transform = `translate(${Math.max(8, hoverPointRef.current.x + 14)}px, ${Math.max(8, hoverPointRef.current.y + 14)}px)`;
  }, []);
  useLayoutEffect(placeHover, [hover, placeHover]);

  const idProp = level === 'lga' ? 'lga_pcode' : 'state_pcode';

  const fillColor = useMemo(() => {
    const pairs = Object.entries(fillByCode).flat();
    return pairs.length ? ['match', ['get', idProp], ...pairs, NO_DATA_COLOR] : NO_DATA_COLOR;
  }, [fillByCode, idProp]);

  const boardsGeo = useMemo<GeoJSON.FeatureCollection>(() => ({
    type: 'FeatureCollection',
    features: boards.map(b => ({ type: 'Feature', properties: { id: b.id, name: b.name }, geometry: { type: 'Point', coordinates: [b.lng, b.lat] } })),
  }), [boards]);

  const hexLevels = useMemo(() => h3Meta?.levels ?? [], [h3Meta]);
  const tileUrl = useMemo(() => (h3Meta && typeof window !== 'undefined' ? `${window.location.origin}${h3Meta.tiles}` : null), [h3Meta]);
  const interactiveLayerIds = useMemo(
    () => (loaded ? [FILL, BOARDS, ...(hexMetric ? hexLevels.map(l => hexLayerId(l.resolution)) : [])] : []),
    [loaded, hexMetric, hexLevels],
  );

  useEffect(() => {
    if (!focusBounds || !loaded) return;
    mapRef.current?.fitBounds([[focusBounds[0], focusBounds[1]], [focusBounds[2], focusBounds[3]]], { padding: 48, duration: 900, maxZoom: 9 });
  }, [focusBounds, loaded]);

  const handleLoad = useCallback(() => {
    const map = mapRef.current?.getMap();
    // Data fills sit under the basemap's labels so place names stay readable.
    setLabelLayerId(map?.getStyle()?.layers?.find(l => l.type === 'symbol')?.id);
    setLoaded(true);
    if (map) onZoomChange(map.getZoom());
  }, [onZoomChange]);

  const handleMove = useCallback((e: MapMouseEvent) => {
    const feature = e.features?.[0];
    if (!feature) {
      if (hoverKeyRef.current) { hoverKeyRef.current = null; setHover(null); }
      return;
    }
    const layerId = feature.layer?.id ?? '';
    const props = feature.properties || {};
    let key: string;
    let card: HoverCard | null;
    if (layerId === BOARDS) {
      key = `board:${props.id}`;
      card = { title: props.name || 'Board', subtitle: 'Board on this platform', lines: [] };
    } else if (layerId === FILL) {
      key = `area:${props[idProp]}`;
      card = describeArea(props[idProp]);
    } else {
      const res = Number(layerId.replace('mi-h3-r', ''));
      key = `hex:${props.pop}:${props.d}`;
      card = describeHex({ pop: Number(props.pop), y: Number(props.y), d: Number(props.d), yd: Number(props.yd) }, res);
    }
    if (!card) return;
    hoverPointRef.current = { x: e.point.x, y: e.point.y };
    if (key !== hoverKeyRef.current) {
      hoverKeyRef.current = key;
      setHover(card);
    } else {
      placeHover();
    }
  }, [describeArea, describeHex, idProp, placeHover]);

  const handleLeave = useCallback(() => { hoverKeyRef.current = null; setHover(null); }, []);

  const handleClick = useCallback((e: MapMouseEvent) => {
    const feature = e.features?.find(f => f.layer?.id === FILL);
    const code = feature?.properties?.[idProp];
    if (code) onSelect(code);
  }, [idProp, onSelect]);

  const hexActive = !!hexMetric && !!tileUrl;

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <OOHMap
        ref={mapRef}
        mapStyleUrl={MARKET_INTEL_STYLE_URL}
        initialViewState={{ bounds: NIGERIA_BOUNDS, fitBoundsOptions: { padding: 24 } }}
        minZoom={4}
        maxZoom={15}
        dragRotate={false}
        pitchWithRotate={false}
        touchPitch={false}
        interactiveLayerIds={interactiveLayerIds}
        onLoad={handleLoad}
        onMouseMove={handleMove}
        onMouseLeave={handleLeave}
        onClick={handleClick}
        onZoomEnd={e => onZoomChange(e.viewState.zoom)}
        cursor={hover ? 'pointer' : undefined}
      >
        {loaded && (
          <>
            <Source id="mi-areas" type="geojson" data={level === 'lga' ? lgaGeo : stateGeo}>
              <Layer
                id={FILL}
                type="fill"
                beforeId={labelLayerId}
                maxzoom={hexActive ? HEX_MIN_ZOOM : 24}
                paint={{ 'fill-color': fillColor as never, 'fill-opacity': 0.7 }}
              />
            </Source>

            {hexActive && (
              <Source id="mi-h3" type="vector" tiles={[tileUrl!]} minzoom={hexLevels[0].min_zoom} maxzoom={hexLevels[hexLevels.length - 1].max_zoom} bounds={[NIGERIA_BOUNDS[0][0], NIGERIA_BOUNDS[0][1], NIGERIA_BOUNDS[1][0], NIGERIA_BOUNDS[1][1]]}>
                {hexLevels.map((l, i) => {
                  const breaks = l.breaks[hexMetric!];
                  const colors = classColors(breaks.length + 1);
                  const step: unknown[] = ['step', ['get', hexMetric!], colors[0]];
                  breaks.forEach((b, j) => step.push(b, colors[j + 1]));
                  const next = hexLevels[i + 1];
                  return (
                    <Layer
                      key={l.resolution}
                      id={hexLayerId(l.resolution)}
                      type="fill"
                      source-layer={h3Meta!.source_layer}
                      beforeId={labelLayerId}
                      minzoom={Math.max(HEX_MIN_ZOOM, l.min_zoom)}
                      maxzoom={next ? next.min_zoom : 24}
                      paint={{ 'fill-color': step as never, 'fill-opacity': 0.7, 'fill-outline-color': 'rgba(255,255,255,0.35)' }}
                    />
                  );
                })}
              </Source>
            )}

            <Source id="mi-lga-lines" type="geojson" data={lgaGeo}>
              <Layer id="mi-lga-line" type="line" beforeId={labelLayerId} minzoom={level === 'state' ? 7 : 0} paint={{ 'line-color': '#94A3B8', 'line-width': 0.5 }} />
              <Layer
                id="mi-flagged"
                type="line"
                beforeId={labelLayerId}
                filter={['in', ['get', 'lga_pcode'], ['literal', level === 'lga' ? flaggedCodes : []]]}
                paint={{ 'line-color': T.caution, 'line-width': 1, 'line-dasharray': [2, 2] }}
              />
              <Layer
                id="mi-selected-lga"
                type="line"
                filter={['==', ['get', 'lga_pcode'], level === 'lga' ? selectedCode ?? '' : '']}
                paint={{ 'line-color': T.accent, 'line-width': 2 }}
              />
            </Source>
            <Source id="mi-state-lines" type="geojson" data={stateGeo}>
              <Layer id="mi-state-line" type="line" beforeId={labelLayerId} paint={{ 'line-color': '#64748B', 'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.8, 9, 1.4] }} />
              <Layer
                id="mi-selected-state"
                type="line"
                filter={['==', ['get', 'state_pcode'], level === 'state' ? selectedCode ?? '' : '']}
                paint={{ 'line-color': T.accent, 'line-width': 2 }}
              />
            </Source>

            <Source id="mi-boards-src" type="geojson" data={boardsGeo}>
              <Layer
                id={BOARDS}
                type="circle"
                paint={{
                  'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 2.5, 10, 4, 14, 6],
                  'circle-color': T.ink,
                  'circle-stroke-color': '#FFFFFF',
                  'circle-stroke-width': 1.5,
                }}
              />
            </Source>
          </>
        )}
      </OOHMap>

      {hover && (
        <div
          ref={hoverElRef}
          role="status"
          style={{
            position: 'absolute', left: 0, top: 0, zIndex: 5, pointerEvents: 'none',
            background: T.surface, border: `1px solid ${T.line}`, borderRadius: 6, padding: '8px 10px', minWidth: 180, maxWidth: 260,
            boxShadow: '0 2px 8px rgba(15,23,42,0.08)',
          }}
        >
          <p style={{ fontSize: '0.8125rem', fontWeight: 600, color: T.ink, margin: 0 }}>{hover.title}</p>
          {hover.subtitle && <p style={{ fontSize: '0.6875rem', color: T.muted, margin: '1px 0 0' }}>{hover.subtitle}</p>}
          {hover.lines.length > 0 && (
            <dl style={{ margin: '6px 0 0', display: 'grid', gridTemplateColumns: '1fr auto', columnGap: 12, rowGap: 2, fontSize: '0.75rem' }}>
              {hover.lines.map(line => (
                <div key={line.label} style={{ display: 'contents' }}>
                  <dt style={{ color: T.muted }}>{line.label}</dt>
                  <dd style={{ ...numeric, margin: 0, color: T.ink, textAlign: 'right' }}>{line.value}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      )}
    </div>
  );
}
