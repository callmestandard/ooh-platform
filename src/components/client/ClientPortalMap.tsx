'use client';

import Map, { Marker, Popup, NavigationControl } from 'react-map-gl/maplibre';
import { useState } from 'react';

type BookingPin = {
  id: string;
  status: string;
  boardName: string;
  city: string;
  format: string;
  rate: number;
  latitude: number;
  longitude: number;
};

const STATUS_COLOR: Record<string, string> = {
  live:        '#10B981',
  agreed:      '#8B5CF6',
  signed:      '#8B5CF6',
  pending:     '#F59E0B',
  negotiating: '#3B82F6',
  completed:   '#94A3B8',
  declined:    '#EF4444',
};

const FORMAT_LABELS: Record<string, string> = {
  billboard: 'Billboard', unipole: 'Unipole', gantry: 'Gantry',
  bridge_panel: 'Bridge Panel', wall_drape: 'Wall Drape',
};

function formatNaira(n: number) {
  if (n >= 1_000_000) return '₦' + (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return '₦' + (n / 1_000).toFixed(0) + 'K';
  return '₦' + n;
}

export default function ClientPortalMap({ pins }: { pins: BookingPin[] }) {
  const [popup, setPopup] = useState<BookingPin | null>(null);

  const center = pins.length > 0
    ? { longitude: pins.reduce((s, p) => s + p.longitude, 0) / pins.length, latitude: pins.reduce((s, p) => s + p.latitude, 0) / pins.length }
    : { longitude: 3.3792, latitude: 6.5244 };

  return (
    <Map
      initialViewState={{ ...center, zoom: pins.length === 1 ? 13 : 10 }}
      style={{ width: '100%', height: '100%' }}
      mapStyle="https://basemaps.cartocdn.com/gl/positron-gl-style/style.json"
      attributionControl={false}
      onClick={() => setPopup(null)}
    >
      <NavigationControl position="bottom-right" />

      {pins.map(pin => {
        const color = STATUS_COLOR[pin.status] || '#94A3B8';
        return (
          <Marker
            key={pin.id}
            longitude={pin.longitude}
            latitude={pin.latitude}
            anchor="bottom"
            onClick={e => { e.originalEvent.stopPropagation(); setPopup(pin); }}
          >
            <div style={{ cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <div style={{
                width: 28, height: 28, borderRadius: '50%',
                background: color,
                border: '2.5px solid #fff',
                boxShadow: `0 2px 8px ${color}66`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 11, color: '#fff', fontWeight: 700,
                transition: 'transform 0.15s',
              }}>
                ▬
              </div>
              <div style={{ width: 2, height: 6, background: color, borderRadius: 2 }} />
            </div>
          </Marker>
        );
      })}

      {popup && (
        <Popup
          longitude={popup.longitude}
          latitude={popup.latitude}
          anchor="bottom"
          offset={40}
          closeButton={false}
          onClose={() => setPopup(null)}
        >
          <div style={{ fontFamily: "'Inter', sans-serif", minWidth: 180, padding: 2 }}>
            <p style={{ fontSize: '0.8125rem', fontWeight: 700, color: '#0F172A', margin: '0 0 4px' }}>{popup.boardName}</p>
            <p style={{ fontSize: '0.6875rem', color: '#64748B', margin: '0 0 6px' }}>{popup.city} · {FORMAT_LABELS[popup.format] || popup.format}</p>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.6875rem', fontWeight: 700, color: STATUS_COLOR[popup.status] || '#94A3B8', background: (STATUS_COLOR[popup.status] || '#94A3B8') + '18', padding: '2px 8px', borderRadius: 999, textTransform: 'capitalize' }}>
                {popup.status}
              </span>
              <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#1B4F8A', fontFamily: 'monospace' }}>{formatNaira(popup.rate)}/mo</span>
            </div>
          </div>
        </Popup>
      )}
    </Map>
  );
}
