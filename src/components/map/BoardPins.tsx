'use client';

import { useEffect, useMemo, useRef } from 'react';
import { Source, Layer, useMap, type MapMouseEvent, type GeoJSONSource } from './engine';
import { MAP_LABEL_FONT } from './ooh-map-shared';

export type BoardPin = { id: string; lng: number; lat: number; /** Short price for the pin, e.g. "₦1.2M". */ label: string; /** Dot colour (when prices are off). */ color?: string; /** Digital screen: drawn as a ringed dot (◉) instead of a solid one. */ digital?: boolean };

type Props = {
  sourceId: string;
  /** Memoize this in the caller: a new array re-uploads every pin. */
  pins: BoardPin[];
  /** Pins drawn highlighted (hovered card, selected board). */
  activeIds: string[];
  onPinClick: (id: string) => void;
  onPinHover?: (id: string | null) => void;
  /** Several boards share one spot (two faces of a structure): the caller lists them. */
  onStackClick?: (ids: string[], lngLat: [number, number]) => void;
  /** false: coloured dots at every zoom instead of price pills. */
  prices?: boolean;
};

/** Zoomed in this far, pins show their price; further out they are dots. */
export const PILL_ZOOM = 11;
const CLUSTER_MAX_ZOOM = 15;
const BRAND = '#1B4F8A';
const INK = '#0F172A';

// Price pills are a stretchable image (drawn once on a canvas) behind a text
// label, so the GPU draws them like any map label: smooth with thousands.
const PILL = 'ooh-pill', PILL_ON = 'ooh-pill-on';

function pillImage(fill: string, stroke: string) {
  const r = 2;                    // pixel ratio
  const m = 4, w = 40, h = 24;    // shadow margin, pill size (logical px)
  const W = (w + m * 2) * r, H = (h + m * 2 + 2) * r;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d')!;
  ctx.scale(r, r);
  ctx.shadowColor = 'rgba(15,23,42,0.22)';
  ctx.shadowBlur = 5;
  ctx.shadowOffsetY = 1.5;
  ctx.beginPath();
  ctx.roundRect(m, m, w, h, h / 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.lineWidth = 1;
  ctx.strokeStyle = stroke;
  ctx.stroke();
  const data = ctx.getImageData(0, 0, W, H);
  return {
    image: { width: W, height: H, data: new Uint8Array(data.data.buffer) },
    options: {
      pixelRatio: r,
      stretchX: [[(m + 12) * r, (m + w - 12) * r]] as [number, number][],
      stretchY: [[(m + 11) * r, (m + 13) * r]] as [number, number][],
      content: [(m + 9) * r, (m + 4) * r, (m + w - 9) * r, (m + h - 4) * r] as [number, number, number, number],
    },
  };
}

export default function BoardPins({ sourceId, pins, activeIds, onPinClick, onPinHover, onStackClick, prices = true }: Props) {
  const { current: mapRef } = useMap();
  const ids = {
    cluster: `${sourceId}-clusters`, count: `${sourceId}-count`,
    dot: `${sourceId}-dots`, dotOn: `${sourceId}-dots-on`, core: `${sourceId}-digital`, coreOn: `${sourceId}-digital-on`,
    pill: `${sourceId}-pills`, pillOn: `${sourceId}-pills-on`,
  };
  const cb = useRef({ onPinClick, onPinHover, onStackClick });
  useEffect(() => { cb.current = { onPinClick, onPinHover, onStackClick }; }, [onPinClick, onPinHover, onStackClick]);

  // The pill images, added now and again whenever the base map style changes.
  useEffect(() => {
    const map = mapRef?.getMap();
    if (!map) return;
    const add = () => {
      if (!map.hasImage(PILL)) { const p = pillImage('#ffffff', 'rgba(15,23,42,0.14)'); map.addImage(PILL, p.image, p.options); }
      if (!map.hasImage(PILL_ON)) { const p = pillImage(BRAND, BRAND); map.addImage(PILL_ON, p.image, p.options); }
    };
    const missing = (e: { id: string }) => { if (e.id === PILL || e.id === PILL_ON) add(); };
    add();
    map.on('styleimagemissing', missing);
    map.on('style.load', add);
    return () => { map.off('styleimagemissing', missing); map.off('style.load', add); };
  }, [mapRef]);

  useEffect(() => {
    const map = mapRef?.getMap();
    if (!map) return;
    const pinLayers = [ids.pill, ids.pillOn, ids.dot, ids.dotOn, ids.core, ids.coreOn];
    let hovered: string | null = null;

    function clusterClick(e: MapMouseEvent) {
      // A highlighted pin drawn over a cluster wins the click.
      if (map!.queryRenderedFeatures(e.point, { layers: pinLayers.filter(l => map!.getLayer(l)) }).length) return;
      const f = map!.queryRenderedFeatures(e.point, { layers: [ids.cluster] })[0];
      if (!f || f.geometry.type !== 'Point') return;
      const at = f.geometry.coordinates as [number, number];
      const clusterId = f.properties?.cluster_id;
      const src = map!.getSource(sourceId) as GeoJSONSource | undefined;
      src?.getClusterExpansionZoom(clusterId, (err, zoom) => {
        if (err || zoom == null) return;
        // Boards on the very same spot never split apart: list them instead.
        if (zoom > CLUSTER_MAX_ZOOM && cb.current.onStackClick) {
          src.getClusterLeaves(clusterId, 50, 0, (e2, leaves) => {
            if (!e2 && leaves) cb.current.onStackClick?.(leaves.map(l => String(l.properties?.id)), at);
          });
          return;
        }
        map!.easeTo({ center: at, zoom: Math.min(zoom, CLUSTER_MAX_ZOOM + 1), duration: 450 });
      });
    }
    function pinClick(e: MapMouseEvent) {
      const id = map!.queryRenderedFeatures(e.point, { layers: pinLayers.filter(l => map!.getLayer(l)) })[0]?.properties?.id;
      if (id) cb.current.onPinClick(String(id));
    }
    function move(e: MapMouseEvent) {
      const id = map!.queryRenderedFeatures(e.point, { layers: pinLayers.filter(l => map!.getLayer(l)) })[0]?.properties?.id ?? null;
      map!.getCanvas().style.cursor = 'pointer';
      if (id !== hovered) { hovered = id; cb.current.onPinHover?.(id ? String(id) : null); }
    }
    function leave() {
      map!.getCanvas().style.cursor = '';
      if (hovered) { hovered = null; cb.current.onPinHover?.(null); }
    }
    const pointer = () => { map!.getCanvas().style.cursor = 'pointer'; };
    const plain = () => { map!.getCanvas().style.cursor = ''; };

    map.on('click', ids.cluster, clusterClick);
    map.on('mouseenter', ids.cluster, pointer);
    map.on('mouseleave', ids.cluster, plain);
    for (const l of pinLayers) {
      map.on('click', l, pinClick);
      map.on('mousemove', l, move);
      map.on('mouseleave', l, leave);
    }
    return () => {
      map.off('click', ids.cluster, clusterClick);
      map.off('mouseenter', ids.cluster, pointer);
      map.off('mouseleave', ids.cluster, plain);
      for (const l of pinLayers) {
        map.off('click', l, pinClick);
        map.off('mousemove', l, move);
        map.off('mouseleave', l, leave);
      }
    };
  // ids are derived from sourceId
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapRef, sourceId]);

  const geojson = useMemo<GeoJSON.FeatureCollection<GeoJSON.Point, { id: string; label: string; color: string; digital: boolean }>>(() => ({
    type: 'FeatureCollection',
    features: pins.map(p => ({ type: 'Feature', properties: { id: p.id, label: p.label, color: p.color ?? BRAND, digital: !!p.digital }, geometry: { type: 'Point', coordinates: [p.lng, p.lat] } })),
  }), [pins]);

  // Highlighted boards come from their own small source, so they show on top
  // even when their board is inside a cluster.
  const activeGeojson = useMemo<typeof geojson>(() => {
    const on = new Set(activeIds);
    return { type: 'FeatureCollection', features: geojson.features.filter(f => on.has(f.properties.id)) };
  }, [geojson, activeIds]);
  const notCluster = ['!', ['has', 'point_count']];

  return (
    <>
    <Source id={sourceId} type="geojson" data={geojson} cluster clusterMaxZoom={CLUSTER_MAX_ZOOM} clusterRadius={44}>
      <Layer
        id={ids.cluster}
        type="circle"
        filter={['has', 'point_count']}
        paint={{
          'circle-color': BRAND,
          'circle-radius': ['step', ['get', 'point_count'], 15, 10, 18, 50, 23],
          'circle-stroke-width': 5,
          'circle-stroke-color': 'rgba(27,79,138,0.22)',
        }}
      />
      <Layer
        id={ids.count}
        type="symbol"
        filter={['has', 'point_count']}
        layout={{ 'text-field': ['get', 'point_count_abbreviated'], 'text-size': 12.5, 'text-font': MAP_LABEL_FONT, 'text-allow-overlap': true, 'text-ignore-placement': true }}
        paint={{ 'text-color': '#fff' }}
      />

      {/* Zoomed out: dots */}
      <Layer
        id={ids.dot}
        type="circle"
        maxzoom={prices ? PILL_ZOOM : 24}
        filter={notCluster as never}
        paint={{ 'circle-color': ['get', 'color'], 'circle-radius': prices ? 6 : 7, 'circle-stroke-width': 2, 'circle-stroke-color': '#fff' }}
      />
      {/* Digital screens: a white core makes the dot a ring (◉) */}
      <Layer
        id={ids.core}
        type="circle"
        maxzoom={prices ? PILL_ZOOM : 24}
        filter={['all', notCluster, ['==', ['get', 'digital'], true]] as never}
        paint={{ 'circle-color': '#fff', 'circle-radius': prices ? 2.2 : 2.6 }}
      />
      {/* Zoomed in: price pills */}
      {prices && <Layer
        id={ids.pill}
        type="symbol"
        minzoom={PILL_ZOOM}
        filter={notCluster as never}
        layout={{
          'icon-image': PILL, 'icon-text-fit': 'both', 'icon-allow-overlap': true, 'icon-ignore-placement': true,
          'text-field': ['get', 'label'], 'text-font': MAP_LABEL_FONT, 'text-size': 12, 'text-allow-overlap': true, 'text-ignore-placement': true,
        }}
        paint={{ 'text-color': INK }}
      />}
    </Source>
    <Source id={`${sourceId}-active`} type="geojson" data={activeGeojson}>
      <Layer
        id={ids.dotOn}
        type="circle"
        maxzoom={prices ? PILL_ZOOM : 24}
        paint={{ 'circle-color': INK, 'circle-radius': 9, 'circle-stroke-width': 3, 'circle-stroke-color': '#fff' }}
      />
      <Layer
        id={ids.coreOn}
        type="circle"
        maxzoom={prices ? PILL_ZOOM : 24}
        filter={['==', ['get', 'digital'], true] as never}
        paint={{ 'circle-color': '#fff', 'circle-radius': 3.4 }}
      />

      {prices && <Layer
        id={ids.pillOn}
        type="symbol"
        minzoom={PILL_ZOOM}
        layout={{
          'icon-image': PILL_ON, 'icon-text-fit': 'both', 'icon-allow-overlap': true, 'icon-ignore-placement': true,
          'text-field': ['get', 'label'], 'text-font': MAP_LABEL_FONT, 'text-size': 13, 'text-allow-overlap': true, 'text-ignore-placement': true,
        }}
        paint={{ 'text-color': '#fff' }}
      />}
    </Source>
    </>
  );
}
