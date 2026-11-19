'use client';

import { forwardRef, useState } from 'react';
import type { ComponentProps } from 'react';
import { MapGL, Marker, Popup, NavigationControl, GeolocateControl, Source, Layer, useMap, type MapRef } from './engine';
import MapSearchBar from './MapSearchBar';
import { MAPBOX_TOKEN, MAP_STYLES, LAGOS_CENTER, type MapStyleKey } from './ooh-map-shared';

// Every page imports the map primitives from here — ONE place, one engine
// (Mapbox GL JS via react-map-gl, named only in ./engine.ts) — instead of
// each page importing a map library directly with its own copy of the style
// URL and token constants.
export { Marker, Popup, NavigationControl, GeolocateControl, Source, Layer };
export type { MapRef };

type MapProps = ComponentProps<typeof MapGL>;

type SearchResult = { lat: number; lng: number; name: string };

type Props = Omit<MapProps, 'mapStyle' | 'mapboxAccessToken'> & {
  /** Which shared basemap to render. Defaults to 'streets'. */
  styleKey?: MapStyleKey;
  /** Escape hatch for a page that already computed a style URL (e.g. mid-toggle state) instead of a styleKey. */
  mapStyleUrl?: string;
  hideNavControl?: boolean;
  /** Where the zoom buttons sit. Defaults to bottom-right. */
  navPosition?: 'top-right' | 'bottom-right' | 'top-left' | 'bottom-left';
  /** Adds a "near me" button that centres the map on the visitor. */
  geolocate?: boolean;
  /** Width of the place search box. */
  searchWidth?: number;
  /** Renders the shared geocoding search bar (top-left) that flies the map to the chosen place. */
  search?: boolean;
  searchPlaceholder?: string;
  onSearchResult?: (result: SearchResult) => void;
};

/** Search bar + result pin. Lives inside the map so it can fly it via useMap(). */
function SearchControl({ placeholder, width = 280, onResult }: { placeholder?: string; width?: number; onResult?: (r: SearchResult) => void }) {
  const { current: map } = useMap();
  const [pin, setPin] = useState<SearchResult | null>(null);

  function handleResult(result: SearchResult) {
    setPin(result);
    map?.flyTo({ center: [result.lng, result.lat], zoom: 14, duration: 1200 });
    onResult?.(result);
  }

  return (
    <>
      <div style={{ position: 'absolute', top: 12, left: 12, zIndex: 10 }}>
        <MapSearchBar placeholder={placeholder} width={width} onResult={handleResult} />
      </div>
      {pin && (
        <Marker longitude={pin.lng} latitude={pin.lat} anchor="center">
          <div style={{ width: 16, height: 16, borderRadius: '50%', background: '#3B82F6', border: '2.5px solid #fff', boxShadow: '0 2px 8px rgba(59,130,246,0.5)', pointerEvents: 'none' }} />
        </Marker>
      )}
    </>
  );
}

const OOHMap = forwardRef<MapRef, Props>(function OOHMap(
  { styleKey = 'streets', mapStyleUrl, hideNavControl, navPosition = 'bottom-right', geolocate, search, searchPlaceholder, searchWidth, onSearchResult, initialViewState, attributionControl, children, ...rest },
  ref,
) {
  // Without a token Mapbox GL renders nothing at all — say so instead of
  // leaving a silent blank rectangle.
  if (!MAPBOX_TOKEN) {
    return (
      <div style={{ width: '100%', height: '100%', minHeight: 160, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, background: '#F1F5F9', color: '#64748B', fontFamily: "'Inter', sans-serif", textAlign: 'center', padding: 16, boxSizing: 'border-box' }}>
        <p style={{ fontSize: '0.875rem', fontWeight: 700, color: '#0F172A', margin: 0 }}>Map unavailable</p>
        <p style={{ fontSize: '0.75rem', margin: 0 }}>NEXT_PUBLIC_MAPBOX_TOKEN is not set for this environment.</p>
      </div>
    );
  }

  return (
    <MapGL
      ref={ref}
      mapboxAccessToken={MAPBOX_TOKEN}
      initialViewState={initialViewState || { ...LAGOS_CENTER, zoom: 11 }}
      mapStyle={mapStyleUrl || MAP_STYLES[styleKey].url}
      projection="mercator"
      attributionControl={attributionControl ?? true}
      {...rest}
    >
      {!hideNavControl && <NavigationControl position={navPosition} showCompass={false} />}
      {geolocate && <GeolocateControl position={navPosition} showAccuracyCircle={false} fitBoundsOptions={{ maxZoom: 13 }} />}
      {search && <SearchControl placeholder={searchPlaceholder} width={searchWidth} onResult={onSearchResult} />}
      {children}
    </MapGL>
  );
});

export default OOHMap;
