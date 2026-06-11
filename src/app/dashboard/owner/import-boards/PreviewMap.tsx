'use client';

import { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

export type MapBoard = {
  id: string;
  name: string;
  city: string;
  format: string;
  asking_rate: number | null;
  lat: number;
  lng: number;
  geocoded: boolean;
  status: 'ready' | 'warning';
};

function makePin(status: 'ready' | 'warning', geocoded: boolean): L.DivIcon {
  const bg = status === 'ready' ? '#1B4F8A' : '#D97706';
  const border = geocoded ? '#F59E0B' : 'rgba(255,255,255,0.6)';
  return L.divIcon({
    html: `<div style="
      width:22px; height:22px; border-radius:50%;
      background:${bg}; border:2px solid ${border};
      display:flex; align-items:center; justify-content:center;
      box-shadow:0 2px 6px rgba(0,0,0,0.3);
    "></div>`,
    className: '',
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
}

function FitBounds({ boards }: { boards: MapBoard[] }) {
  const map = useMap();
  useEffect(() => {
    if (boards.length === 0) return;
    if (boards.length === 1) {
      map.setView([boards[0].lat, boards[0].lng], 13);
      return;
    }
    const lats = boards.map(b => b.lat);
    const lngs = boards.map(b => b.lng);
    map.fitBounds([
      [Math.min(...lats), Math.min(...lngs)],
      [Math.max(...lats), Math.max(...lngs)],
    ], { padding: [40, 40] });
  }, [boards, map]);
  return null;
}

function fmt(n: number | null) {
  if (!n) return '—';
  if (n >= 1_000_000) return '₦' + (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return '₦' + Math.round(n / 1_000) + 'K';
  return '₦' + n.toLocaleString('en-NG');
}

export default function PreviewMap({ boards }: { boards: MapBoard[] }) {
  const center: [number, number] = boards.length > 0
    ? [boards[0].lat, boards[0].lng]
    : [9.0579, 7.4951]; // Nigeria centroid

  return (
    <MapContainer
      center={center}
      zoom={6}
      style={{ height: '100%', width: '100%', borderRadius: 12 }}
      scrollWheelZoom
    >
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
      />
      <FitBounds boards={boards} />
      {boards.map(b => (
        <Marker key={b.id} position={[b.lat, b.lng]} icon={makePin(b.status, b.geocoded)}>
          <Popup>
            <strong style={{ fontSize: '0.8125rem' }}>{b.name}</strong><br />
            <span style={{ fontSize: '0.75rem', color: '#64748B' }}>{b.city} · {b.format}</span><br />
            <span style={{ fontSize: '0.75rem', fontWeight: 600 }}>{fmt(b.asking_rate)}/mo</span>
            {b.geocoded && (
              <><br /><span style={{ fontSize: '0.6875rem', color: '#D97706' }}>⚠ Geocoded — verify pin</span></>
            )}
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
