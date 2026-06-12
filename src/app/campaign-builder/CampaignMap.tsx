'use client';

import { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

export type CampaignMapBoard = {
  id: string;
  name: string;
  city: string;
  format: string;
  asking_rate: number;
  lat: number;
  lng: number;
};

function makePin(selected: boolean, hovered: boolean): L.DivIcon {
  const bg   = selected ? '#1B4F8A' : '#22C55E';
  const size = hovered ? 28 : 22;
  const ring = selected ? '#F59E0B' : '#fff';
  return L.divIcon({
    html: `<div style="
      width:${size}px;height:${size}px;border-radius:50%;
      background:${bg};border:2.5px solid ${ring};
      box-shadow:0 2px 8px rgba(0,0,0,0.35);
    "></div>`,
    className: '',
    iconSize:   [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function FitBounds({ boards }: { boards: CampaignMapBoard[] }) {
  const map = useMap();
  useEffect(() => {
    if (boards.length === 0) return;
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
  boards:      CampaignMapBoard[];
  selectedIds: Set<string>;
  hoveredId:   string | null;
  onToggle:    (id: string) => void;
  onHover:     (id: string | null) => void;
};

export default function CampaignMap({ boards, selectedIds, hoveredId, onToggle, onHover }: Props) {
  const center: [number, number] = boards.length > 0 ? [boards[0].lat, boards[0].lng] : [9.0579, 7.4951];

  return (
    <MapContainer center={center} zoom={6} style={{ height: '100%', width: '100%' }} scrollWheelZoom>
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
      />
      <FitBounds boards={boards} />
      {boards.map(b => (
        <Marker
          key={b.id}
          position={[b.lat, b.lng]}
          icon={makePin(selectedIds.has(b.id), hoveredId === b.id)}
          eventHandlers={{
            click:     () => onToggle(b.id),
            mouseover: () => onHover(b.id),
            mouseout:  () => onHover(null),
          }}
        >
          <Popup>
            <strong style={{ fontSize: '0.8125rem', display: 'block', marginBottom: 2 }}>{b.name}</strong>
            <span style={{ fontSize: '0.75rem', color: '#64748B' }}>{b.city} · {b.format}</span><br />
            <span style={{ fontSize: '0.75rem', fontWeight: 600 }}>{fmtRate(b.asking_rate)}/mo</span>
            <br />
            <button
              onClick={() => onToggle(b.id)}
              style={{
                marginTop: 8, padding: '5px 12px', borderRadius: 7, cursor: 'pointer',
                background: selectedIds.has(b.id) ? '#FEF2F2' : '#1B4F8A',
                color:      selectedIds.has(b.id) ? '#DC2626'  : '#fff',
                border:     selectedIds.has(b.id) ? '1px solid #FECACA' : 'none',
                fontSize: '0.6875rem', fontWeight: 600, fontFamily: 'inherit',
              }}
            >
              {selectedIds.has(b.id) ? 'Remove' : 'Add to plan'}
            </button>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
