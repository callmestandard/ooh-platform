'use client';

import { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

export type CityMapBoard = {
  id: string;
  name: string;
  format: string;
  asking_rate: number;
  lat: number;
  lng: number;
};

const FORMAT_PIN_COLORS: Record<string, string> = {
  billboard:    '#1B4F8A',
  unipole:      '#7C3AED',
  gantry:       '#059669',
  bridge_panel: '#D97706',
  wall_drape:   '#9D174D',
  digital:      '#15803D',
  led:          '#15803D',
};

function makePin(format: string): L.DivIcon {
  const bg = FORMAT_PIN_COLORS[format] || '#1B4F8A';
  return L.divIcon({
    html: `<div style="
      width:18px;height:18px;border-radius:50%;
      background:${bg};border:2.5px solid #fff;
      box-shadow:0 2px 8px rgba(0,0,0,0.35);
    "></div>`,
    className: '',
    iconSize:   [18, 18],
    iconAnchor: [9, 9],
  });
}

function FitBounds({ boards }: { boards: CityMapBoard[] }) {
  const map = useMap();
  useEffect(() => {
    if (!boards.length) return;
    if (boards.length === 1) { map.setView([boards[0].lat, boards[0].lng], 13); return; }
    const lats = boards.map(b => b.lat);
    const lngs = boards.map(b => b.lng);
    map.fitBounds(
      [[Math.min(...lats), Math.min(...lngs)], [Math.max(...lats), Math.max(...lngs)]],
      { padding: [40, 40] },
    );
  }, [boards, map]);
  return null;
}

function fmtRate(n: number) {
  if (n >= 1_000_000) return '₦' + (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000)     return '₦' + Math.round(n / 1_000) + 'K';
  return '₦' + n.toLocaleString('en-NG');
}

type Props = {
  boards: CityMapBoard[];
  city:   string;
};

export default function CityMap({ boards, city }: Props) {
  const center: [number, number] = boards.length > 0
    ? [boards[0].lat, boards[0].lng]
    : [9.0579, 7.4951];

  return (
    <MapContainer
      center={center}
      zoom={12}
      style={{ height: '100%', width: '100%' }}
      scrollWheelZoom={false}
    >
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
      />
      <FitBounds boards={boards} />
      {boards.map(b => (
        <Marker
          key={b.id}
          position={[b.lat, b.lng]}
          icon={makePin(b.format)}
        >
          <Popup>
            <strong style={{ fontSize: '0.8125rem', display: 'block', marginBottom: 2 }}>{b.name}</strong>
            <span style={{ fontSize: '0.75rem', color: '#64748B' }}>{b.format}</span><br />
            <span style={{ fontSize: '0.75rem', fontWeight: 600 }}>{fmtRate(b.asking_rate)}/mo</span>
            <br />
            <a
              href={`/campaign-builder?city=${encodeURIComponent(city)}`}
              style={{
                display: 'inline-block', marginTop: 8,
                padding: '4px 10px', borderRadius: 6,
                background: '#1B4F8A', color: '#fff',
                fontSize: '0.6875rem', fontWeight: 600, textDecoration: 'none',
              }}
            >
              Plan a campaign →
            </a>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
