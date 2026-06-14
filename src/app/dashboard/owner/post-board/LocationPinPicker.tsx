'use client';

import { useRef, useMemo, useEffect } from 'react';
import { MapContainer, TileLayer, Marker, useMapEvents, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const CITY_CENTERS: Record<string, [number, number]> = {
  'Lagos': [6.5244, 3.3792],
  'Abuja': [9.0579, 7.4951],
  'Port Harcourt': [4.8156, 7.0498],
  'Kano': [12.0022, 8.5919],
  'Ibadan': [7.3775, 3.9470],
  'Benin City': [6.3350, 5.6037],
  'Enugu': [6.4584, 7.5464],
  'Aba': [5.1069, 7.3664],
  'Warri': [5.5167, 5.7500],
  'Onitsha': [6.1449, 6.7874],
  'Kaduna': [10.5105, 7.4165],
  'Jos': [9.8965, 8.8583],
  'Ilorin': [8.4966, 4.5426],
  'Calabar': [4.9517, 8.3220],
  'Akure': [7.2526, 5.1977],
  'Uyo': [5.0510, 7.9328],
  'Osogbo': [7.7712, 4.5573],
  'Owerri': [5.4836, 7.0330],
  'Maiduguri': [11.8333, 13.1500],
  'Zaria': [11.0667, 7.7000],
  'Abeokuta': [7.1475, 3.3619],
  'Asaba': [6.1952, 6.7353],
  'Umuahia': [5.5266, 7.4927],
  'Bauchi': [10.3158, 9.8442],
  'Sokoto': [13.0622, 5.2339],
  'Yola': [9.2035, 12.4954],
  'Makurdi': [7.7319, 8.5237],
  'Lokoja': [7.7963, 6.7384],
  'Lafia': [8.4939, 8.5219],
  'Gusau': [12.1649, 6.6599],
};

const NIGERIA_CENTER: [number, number] = [9.0579, 7.4951];

function makePinIcon(): L.DivIcon {
  return L.divIcon({
    html: `<div style="
      position:relative;
      width:0; height:0;
    ">
      <div style="
        position:absolute;
        left:-14px; top:-28px;
        width:28px; height:28px;
        background:#7C3AED;
        border:3px solid #fff;
        border-radius:50% 50% 50% 0;
        transform:rotate(-45deg);
        box-shadow:0 3px 10px rgba(124,58,237,0.45);
      "></div>
    </div>`,
    className: '',
    iconSize: [0, 0],
    iconAnchor: [0, 0],
  });
}

function ClickToPlace({ onPlace }: { onPlace: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onPlace(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

function MapRecenterer({ lat, lng, city }: { lat: number | null; lng: number | null; city: string }) {
  const map = useMap();
  useEffect(() => {
    if (lat !== null && lng !== null) {
      map.setView([lat, lng], Math.max(map.getZoom(), 15));
    } else if (city && CITY_CENTERS[city]) {
      map.setView(CITY_CENTERS[city], 13);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lat, lng, city]);
  return null;
}

type Props = {
  lat: number | null;
  lng: number | null;
  city: string;
  onChange: (lat: number, lng: number) => void;
  onClear: () => void;
};

export default function LocationPinPicker({ lat, lng, city, onChange, onClear }: Props) {
  const markerRef = useRef<L.Marker>(null);

  const eventHandlers = useMemo(() => ({
    dragend() {
      const m = markerRef.current;
      if (m) {
        const pos = m.getLatLng();
        onChange(pos.lat, pos.lng);
      }
    },
  }), [onChange]);

  const pinIcon = useMemo(() => makePinIcon(), []);

  const hasPin = lat !== null && lng !== null;
  const initialCenter: [number, number] = hasPin
    ? [lat, lng]
    : CITY_CENTERS[city] ?? NIGERIA_CENTER;
  const initialZoom = hasPin ? 15 : city ? 13 : 7;

  return (
    <div>
      <MapContainer
        center={initialCenter}
        zoom={initialZoom}
        style={{ height: 280, width: '100%', borderRadius: 10, border: '1px solid #E2E8F0', cursor: hasPin ? 'default' : 'crosshair' }}
        scrollWheelZoom={false}
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        />
        <MapRecenterer lat={lat} lng={lng} city={city} />
        <ClickToPlace onPlace={onChange} />
        {hasPin && (
          <Marker
            draggable
            eventHandlers={eventHandlers}
            position={[lat, lng]}
            icon={pinIcon}
            ref={markerRef}
          />
        )}
      </MapContainer>

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
