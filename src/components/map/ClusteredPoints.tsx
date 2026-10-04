'use client';

import { useEffect, useMemo, useRef } from 'react';
import { Source, Layer, useMap, type MapMouseEvent, type GeoJSONSource } from './engine';
import { MAP_LABEL_FONT } from './ooh-map-shared';

export type ClusterPoint = { id: string; lng: number; lat: number; color: string; radius?: number; stroke?: string };

type Props = {
  sourceId: string;
  /** Memoize this in the caller — a new array identity re-uploads every point to the GPU worker. */
  points: ClusterPoint[];
  onPointClick?: (id: string) => void;
  /** Fires on mousemove over an unclustered point (id + screen-space pixel, for positioning a hover card) and on mouseleave (null, null). */
  onPointHover?: (id: string | null, screenPoint: { x: number; y: number } | null) => void;
  /** Set false to make points and clusters ignore the mouse (e.g. while a drawing tool owns map clicks). */
  interactive?: boolean;
  clusterRadius?: number;
  clusterMaxZoom?: number;
  pointRadius?: number;
};

/**
 * Native GL clustering: one GeoJSON source (cluster: true) + a cluster-circle
 * layer, a count-label layer, and an unclustered-point layer — all rendered
 * by the GPU, not one React <Marker> DOM node per board. This is what keeps
 * pan/zoom smooth with thousands of points (a per-board <Marker> does not
 * scale past a few hundred).
 */
export default function ClusteredPoints({
  sourceId, points, onPointClick, onPointHover, interactive = true, clusterRadius = 50, clusterMaxZoom = 14, pointRadius = 7,
}: Props) {
  const { current: mapRef } = useMap();
  const clusterLayerId = `${sourceId}-clusters`;
  const countLayerId = `${sourceId}-count`;
  const pointLayerId = `${sourceId}-points`;
  const onPointClickRef = useRef(onPointClick);
  const onPointHoverRef = useRef(onPointHover);
  const hoveredIdRef = useRef<string | null>(null);

  useEffect(() => {
    onPointClickRef.current = onPointClick;
    onPointHoverRef.current = onPointHover;
  }, [onPointClick, onPointHover]);

  useEffect(() => {
    const map = mapRef?.getMap();
    if (!map || !interactive) return;

    function handleClusterClick(e: MapMouseEvent) {
      const features = map!.queryRenderedFeatures(e.point, { layers: [clusterLayerId] });
      const feature = features[0];
      if (!feature || feature.geometry.type !== 'Point') return;
      const coordinates = feature.geometry.coordinates as [number, number];
      const clusterId = feature.properties?.cluster_id;
      const source = map!.getSource(sourceId) as GeoJSONSource | undefined;
      source?.getClusterExpansionZoom(clusterId, (err, zoom) => {
        if (err || zoom == null) return;
        map!.easeTo({ center: coordinates, zoom, duration: 500 });
      });
    }

    function handlePointClick(e: MapMouseEvent) {
      const features = map!.queryRenderedFeatures(e.point, { layers: [pointLayerId] });
      const id = features[0]?.properties?.id;
      if (id) onPointClickRef.current?.(id);
    }

    function cursorPointer() { map!.getCanvas().style.cursor = 'pointer'; }
    function cursorDefault() { map!.getCanvas().style.cursor = ''; }

    function handlePointMouseMove(e: MapMouseEvent) {
      const features = map!.queryRenderedFeatures(e.point, { layers: [pointLayerId] });
      const id = features[0]?.properties?.id ?? null;
      if (id !== hoveredIdRef.current) {
        hoveredIdRef.current = id;
        onPointHoverRef.current?.(id, id ? { x: e.point.x, y: e.point.y } : null);
      }
    }
    function handlePointMouseLeave() {
      hoveredIdRef.current = null;
      onPointHoverRef.current?.(null, null);
    }

    map.on('click', clusterLayerId, handleClusterClick);
    map.on('click', pointLayerId, handlePointClick);
    map.on('mouseenter', clusterLayerId, cursorPointer);
    map.on('mouseleave', clusterLayerId, cursorDefault);
    map.on('mouseenter', pointLayerId, cursorPointer);
    map.on('mousemove', pointLayerId, handlePointMouseMove);
    map.on('mouseleave', pointLayerId, cursorDefault);
    map.on('mouseleave', pointLayerId, handlePointMouseLeave);

    return () => {
      map.off('click', clusterLayerId, handleClusterClick);
      map.off('click', pointLayerId, handlePointClick);
      map.off('mouseenter', clusterLayerId, cursorPointer);
      map.off('mouseleave', clusterLayerId, cursorDefault);
      map.off('mouseenter', pointLayerId, cursorPointer);
      map.off('mousemove', pointLayerId, handlePointMouseMove);
      map.off('mouseleave', pointLayerId, cursorDefault);
      map.off('mouseleave', pointLayerId, handlePointMouseLeave);
    };
  }, [mapRef, sourceId, clusterLayerId, pointLayerId, interactive]);

  const geojson = useMemo<GeoJSON.FeatureCollection<GeoJSON.Point, { id: string; color: string; radius: number; stroke: string }>>(() => ({
    type: 'FeatureCollection',
    features: points.map(p => ({
      type: 'Feature',
      properties: { id: p.id, color: p.color, radius: p.radius ?? pointRadius, stroke: p.stroke ?? '#fff' },
      geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
    })),
  }), [points, pointRadius]);

  return (
    <Source id={sourceId} type="geojson" data={geojson} cluster clusterMaxZoom={clusterMaxZoom} clusterRadius={clusterRadius}>
      <Layer
        id={clusterLayerId}
        type="circle"
        filter={['has', 'point_count']}
        paint={{
          'circle-color': ['step', ['get', 'point_count'], '#1B4F8A', 25, '#1E40AF', 100, '#172554'],
          'circle-radius': ['step', ['get', 'point_count'], 16, 25, 22, 100, 28],
          'circle-stroke-width': 2,
          'circle-stroke-color': '#fff',
          'circle-opacity': 0.9,
        }}
      />
      <Layer
        id={countLayerId}
        type="symbol"
        filter={['has', 'point_count']}
        layout={{ 'text-field': ['get', 'point_count_abbreviated'], 'text-size': 12, 'text-font': MAP_LABEL_FONT, 'text-allow-overlap': true }}
        paint={{ 'text-color': '#fff' }}
      />
      <Layer
        id={pointLayerId}
        type="circle"
        filter={['!', ['has', 'point_count']]}
        paint={{
          'circle-color': ['get', 'color'],
          'circle-radius': ['get', 'radius'],
          'circle-stroke-width': 2,
          'circle-stroke-color': ['get', 'stroke'],
        }}
      />
    </Source>
  );
}
