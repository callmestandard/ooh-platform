'use client';

import { useEffect, useMemo, useState } from 'react';
import { Source, Layer, Popup, useMap } from './engine';
import { MAP_LABEL_FONT } from './ooh-map-shared';
import { supabase } from '@/lib/supabase';
import { PLACE_META, type PlaceCategory } from '@/lib/intel';

/** Places are fetched only this far in (a few streets), at most 600 at a time. */
export const PLACES_MIN_ZOOM = 13;

/** Single-hue ramp, light to dark: calm enough to keep the map readable. */
export const POP_RAMP = ['rgba(27,79,138,0)', '#DCE7F5', '#A9C3E6', '#6B95CF', '#2F63A8', '#173E6E'];

type PopFile = { data: number[] };
let popCache: Promise<GeoJSON.FeatureCollection> | null = null;
function loadPopulation() {
  popCache ??= fetch('/intel/population.json')
    .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    .then((f: PopFile) => {
      const features: GeoJSON.Feature<GeoJSON.Point, { d: number }>[] = [];
      for (let i = 0; i < f.data.length; i += 3) {
        features.push({ type: 'Feature', properties: { d: f.data[i + 2] }, geometry: { type: 'Point', coordinates: [f.data[i] / 1e4, f.data[i + 1] / 1e4] } });
      }
      return { type: 'FeatureCollection', features } as GeoJSON.FeatureCollection;
    })
    .catch(e => { popCache = null; throw e; });
  return popCache;
}

type Place = { id: string; category: PlaceCategory; name: string | null; lat: number; lng: number };
export type PlacesStatus = 'off' | 'zoom' | 'loading' | 'ready' | 'error';

type Props = {
  population: boolean;
  places: boolean;
  categories: PlaceCategory[];
  /** Layers go under this layer (the board pins), so boards stay on top. */
  beforeId?: string;
  onPlacesStatus?: (s: PlacesStatus, count: number) => void;
};

/** Optional map layers: population density and mapped places. Data only loads when a layer is switched on. */
export default function IntelLayers({ population, places, categories, beforeId, onPlacesStatus }: Props) {
  const { current: mapRef } = useMap();
  const [pop, setPop] = useState<GeoJSON.FeatureCollection | null>(null);
  const [pts, setPts] = useState<Place[]>([]);
  const [picked, setPicked] = useState<Place | null>(null);
  const [before, setBefore] = useState<string | undefined>(undefined);

  // Put the layers under the pins once the pin layer exists.
  useEffect(() => {
    const map = mapRef?.getMap();
    if (!map || !beforeId) return;
    const check = () => setBefore(map.getLayer(beforeId) ? beforeId : undefined);
    check();
    map.on('styledata', check);
    return () => { map.off('styledata', check); };
  }, [mapRef, beforeId]);

  useEffect(() => {
    if (population && !pop) loadPopulation().then(setPop, () => {});
  }, [population, pop]);

  // Places in view: refetched after each move, only when zoomed in.
  const catKey = categories.join(',');
  useEffect(() => {
    const map = mapRef?.getMap();
    if (!map) return;
    if (!places) { setPts([]); setPicked(null); onPlacesStatus?.('off', 0); return; }
    let seq = 0;
    let timer: number | undefined;
    async function load() {
      const id = ++seq;
      if (map!.getZoom() < PLACES_MIN_ZOOM - 0.01) { setPts([]); onPlacesStatus?.('zoom', 0); return; }
      const b = map!.getBounds();
      if (!b) return;
      // Keep the box within the server's limit (0.25° a side) around the centre.
      const c = map!.getCenter();
      const half = 0.124;
      const w = Math.max(b.getWest(), c.lng - half), e = Math.min(b.getEast(), c.lng + half);
      const s = Math.max(b.getSouth(), c.lat - half), n = Math.min(b.getNorth(), c.lat + half);
      onPlacesStatus?.('loading', 0);
      const { data, error } = await supabase.rpc('places_in_view', { p_w: w, p_s: s, p_e: e, p_n: n, p_categories: catKey ? catKey.split(',') : [] });
      if (id !== seq) return;
      if (error) { onPlacesStatus?.('error', 0); return; }
      const rows = (data ?? []) as Place[];
      setPts(rows);
      onPlacesStatus?.('ready', rows.length);
    }
    const debounced = () => { window.clearTimeout(timer); timer = window.setTimeout(load, 250); };
    load();
    map.on('moveend', debounced);
    return () => { seq++; window.clearTimeout(timer); map.off('moveend', debounced); };
  }, [mapRef, places, catKey, onPlacesStatus]);

  // Click a place: its name.
  useEffect(() => {
    const map = mapRef?.getMap();
    if (!map || !places) return;
    const click = (e: { features?: { properties?: Record<string, unknown> | null }[] }) => {
      const id = e.features?.[0]?.properties?.id;
      const p = pts.find(x => x.id === id);
      if (p) setPicked(p);
    };
    const on = () => { map.getCanvas().style.cursor = 'pointer'; };
    const off = () => { map.getCanvas().style.cursor = ''; };
    map.on('click', 'intel-places', click);
    map.on('mouseenter', 'intel-places', on);
    map.on('mouseleave', 'intel-places', off);
    return () => { map.off('click', 'intel-places', click); map.off('mouseenter', 'intel-places', on); map.off('mouseleave', 'intel-places', off); };
  }, [mapRef, places, pts]);

  const placesGeo = useMemo<GeoJSON.FeatureCollection>(() => ({
    type: 'FeatureCollection',
    features: pts.map(p => ({ type: 'Feature', properties: { id: p.id, color: PLACE_META[p.category]?.color ?? '#475569', name: p.name ?? '' }, geometry: { type: 'Point', coordinates: [p.lng, p.lat] } })),
  }), [pts]);

  return (
    <>
      {population && pop && (
        <Source id="intel-pop" type="geojson" data={pop}>
          <Layer
            id="intel-pop-heat"
            type="heatmap"
            beforeId={before}
            maxzoom={16}
            paint={{
              'heatmap-weight': ['interpolate', ['linear'], ['get', 'd'], 500, 0.05, 3000, 0.3, 10000, 0.65, 30000, 1],
              'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 5, 0.5, 9, 0.8, 12, 0.9, 15, 1.2],
              'heatmap-radius': ['interpolate', ['exponential', 2], ['zoom'], 5, 3, 8, 7, 10, 18, 12, 48, 14, 150, 16, 520],
              'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'], 0, POP_RAMP[0], 0.15, POP_RAMP[1], 0.35, POP_RAMP[2], 0.55, POP_RAMP[3], 0.8, POP_RAMP[4], 1, POP_RAMP[5]],
              'heatmap-opacity': ['interpolate', ['linear'], ['zoom'], 5, 0.7, 14, 0.55, 16, 0],
            }}
          />
        </Source>
      )}
      {places && (
        <Source id="intel-places-src" type="geojson" data={placesGeo}>
          <Layer
            id="intel-places"
            type="circle"
            beforeId={before}
            paint={{ 'circle-color': ['get', 'color'], 'circle-radius': ['interpolate', ['linear'], ['zoom'], 13, 3.5, 17, 6], 'circle-stroke-width': 1.5, 'circle-stroke-color': '#fff', 'circle-opacity': 0.9 }}
          />
          <Layer
            id="intel-places-label"
            type="symbol"
            beforeId={before}
            minzoom={16}
            layout={{ 'text-field': ['get', 'name'], 'text-font': MAP_LABEL_FONT, 'text-size': 11, 'text-offset': [0, 1.1], 'text-anchor': 'top', 'text-optional': true }}
            paint={{ 'text-color': '#475569', 'text-halo-color': '#fff', 'text-halo-width': 1.2 }}
          />
        </Source>
      )}
      {picked && (
        <Popup longitude={picked.lng} latitude={picked.lat} anchor="bottom" offset={8} closeButton={false} closeOnClick onClose={() => setPicked(null)} maxWidth="240px">
          <div style={{ font: "500 12px/1.4 'Inter', sans-serif", color: '#0F172A', padding: '2px 2px' }} data-place-popup>
            <b style={{ display: 'block', fontWeight: 700 }}>{picked.name || `Unnamed ${PLACE_META[picked.category].one}`}</b>
            <span style={{ color: '#64748B', textTransform: 'capitalize' }}>{PLACE_META[picked.category].one}</span>
            <span style={{ display: 'block', color: '#94A3B8', fontSize: 10, marginTop: 2 }}>© OpenStreetMap contributors</span>
          </div>
        </Popup>
      )}
    </>
  );
}
