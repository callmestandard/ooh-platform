'use client';

import { useEffect, useRef } from 'react';
import OOHMap, { Marker, type MapRef } from '@/components/map/OOHMap';
import type { MapMouseEvent, MarkerDragEvent } from '@/components/map/engine';
import { CITY_CENTERS } from '@/components/map/ooh-map-shared';

const NIGERIA_CENTER: [number, number] = [7.4951, 9.0579];

type Props = {
  lat: number | null;
  lng: number | null;
  city: string;
  onChange: (lat: number, lng: number) => void;
  onClear: () => void;
};

export default function LocationPinPicker({ lat, lng, city, onChange, onClear }: Props) {
  const mapRef = useRef<MapRef>(null);
  const hasPin = lat !== null && lng !== null;
  const initialCenter: [number, number] = hasPin ? [lng, lat] : CITY_CENTERS[city] ?? NIGERIA_CENTER;
  const initialZoom = hasPin ? 15 : city ? 13 : 7;

  // Recenter when the city changes (before a pin exists) or a pin is set/cleared from outside.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (hasPin) {
      map.flyTo({ center: [lng as number, lat as number], zoom: Math.max(map.getZoom(), 15), duration: 600 });
    } else if (city && CITY_CENTERS[city]) {
      map.flyTo({ center: CITY_CENTERS[city], zoom: 13, duration: 600 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lat, lng, city]);

  function handleClick(e: MapMouseEvent) {
    onChange(e.lngLat.lat, e.lngLat.lng);
  }

  function handleDragEnd(e: MarkerDragEvent) {
    onChange(e.lngLat.lat, e.lngLat.lng);
  }

  return (
    <div>
      <div style={{ height: 280, width: '100%', borderRadius: 10, border: '1px solid #E2E8F0', overflow: 'hidden', cursor: hasPin ? 'default' : 'crosshair' }}>
        <OOHMap
          ref={mapRef}
          initialViewState={{ longitude: initialCenter[0], latitude: initialCenter[1], zoom: initialZoom }}
          onClick={handleClick}
          scrollZoom={false}
          hideNavControl
        >
          {hasPin && (
            <Marker longitude={lng as number} latitude={lat as number} anchor="bottom" draggable onDragEnd={handleDragEnd}>
              <div style={{ width: 28, height: 28, background: '#7C3AED', border: '3px solid #fff', borderRadius: '50% 50% 50% 0', transform: 'rotate(-45deg)', boxShadow: '0 3px 10px rgba(124,58,237,0.45)' }} />
            </Marker>
          )}
        </OOHMap>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8, minHeight: 20 }}>
        {hasPin ? (
          <>
            <span style={{ fontSize: '0.75rem', color: '#10B981', fontWeight: 600 }}>
              ✓ Pin placed — drag to fine-tune
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: '0.6875rem', color: '#94A3B8', fontFamily: 'monospace' }}>
                {lat.toFixed(5)}, {lng.toFixed(5)}
              </span>
              <button
                type="button"
                onClick={onClear}
                style={{ fontSize: '0.6875rem', color: '#EF4444', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'inherit', fontWeight: 600 }}
              >
                Clear
              </button>
            </div>
          </>
        ) : (
          <span style={{ fontSize: '0.75rem', color: '#94A3B8', width: '100%', textAlign: 'center' }}>
            {city ? `Tap the map to pin your board's exact location in ${city}` : 'Select a city first, then tap the map to pin your board'}
          </span>
        )}
      </div>
    </div>
  );
}
