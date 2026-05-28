'use client';

import { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

type Board = {
  id: string;
  name: string;
  format: string;
  address: string;
  city: string;
  state: string;
  width: number | null;
  height: number | null;
  asking_rate: number;
  face_count: number;
  illuminated: boolean;
  status: string;
  photo_urls: string[] | null;
  latitude: number | null;
  longitude: number | null;
  notes: string | null;
  contact_phone: string | null;
  available_from: string | null;
  created_at: string;
};

const FORMAT_INITIALS: Record<string, string> = {
  billboard: 'B', unipole: 'U', gantry: 'G',
  bridge_panel: 'P', wall_drape: 'W', digital: 'D',
};

function makePin(status: string, format: string): L.DivIcon {
  const available = status === 'available';
  const color = available ? '#1B4F8A' : '#94A3B8';
  const initial = FORMAT_INITIALS[format] || format[0]?.toUpperCase() || 'B';
  return L.divIcon({
    html: `<div style="
      width:34px;height:34px;border-radius:50% 50% 50% 0;
      transform:rotate(-45deg);
      background:${color};
      border:2.5px solid white;
      box-shadow:0 2px 10px rgba(0,0,0,0.35);
      display:flex;align-items:center;justify-content:center;
    "><span style="
      transform:rotate(45deg);
      color:white;font-weight:800;font-size:11px;
      font-family:-apple-system,sans-serif;line-height:1;
    ">${initial}</span></div>`,
    className: '',
    iconSize: [34, 34],
    iconAnchor: [17, 34],
    popupAnchor: [0, -38],
  });
}

function FitBounds({ boards }: { boards: Board[] }) {
  const map = useMap();
  useEffect(() => {
    const pts = boards.filter(b => b.latitude != null && b.longitude != null);
    if (pts.length === 0) return;
    if (pts.length === 1) {
      map.setView([pts[0].latitude!, pts[0].longitude!], 15);
      return;
    }
    const bounds = L.latLngBounds(pts.map(b => [b.latitude!, b.longitude!] as [number, number]));
    map.fitBounds(bounds, { padding: [60, 60], maxZoom: 14 });
  }, [boards, map]);
  return null;
}

export default function MapView({
  boards,
  onSelectBoard,
}: {
  boards: Board[];
  onSelectBoard: (b: Board) => void;
}) {
  const boardsWithGPS = boards.filter(b => b.latitude != null && b.longitude != null);
  const boardsNoGPS = boards.length - boardsWithGPS.length;

  return (
    <div style={{ position: 'relative', height: 'calc(100vh - 300px)', minHeight: 480, borderRadius: 14, overflow: 'hidden', border: '1px solid #E2E8F0', boxShadow: '0 2px 16px rgba(0,0,0,0.06)' }}>
      <MapContainer
        center={[9.082, 8.675]}
        zoom={6}
        style={{ height: '100%', width: '100%' }}
        zoomControl={true}
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        />
        <FitBounds boards={boardsWithGPS} />
        {boardsWithGPS.map(board => (
          <Marker
            key={board.id}
            position={[board.latitude!, board.longitude!]}
            icon={makePin(board.status, board.format)}
            eventHandlers={{ click: () => onSelectBoard(board) }}
          />
        ))}
      </MapContainer>

      {/* Legend */}
      <div style={{
        position: 'absolute', top: 14, right: 14, zIndex: 1000,
        background: 'rgba(255,255,255,0.96)', borderRadius: 10,
        padding: '10px 14px', boxShadow: '0 2px 12px rgba(0,0,0,0.12)',
      }}>
        <p style={{ fontSize: '0.5625rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 7px' }}>Legend</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#1B4F8A', flexShrink: 0 }} />
            <span style={{ fontSize: '0.6875rem', color: '#374151', fontWeight: 500 }}>Available</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#94A3B8', flexShrink: 0 }} />
            <span style={{ fontSize: '0.6875rem', color: '#374151', fontWeight: 500 }}>Booked</span>
          </div>
        </div>
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid #F1F5F9' }}>
          <p style={{ fontSize: '0.5625rem', color: '#94A3B8', margin: 0, lineHeight: 1.5 }}>
            Letter = format<br />B·U·G·P·W·D
          </p>
        </div>
      </div>

      {/* Boards without GPS notice */}
      {boardsNoGPS > 0 && (
        <div style={{
          position: 'absolute', bottom: 14, left: 14, zIndex: 1000,
          background: 'rgba(15,23,42,0.82)', color: '#fff',
          padding: '8px 13px', borderRadius: 8,
          fontSize: '0.6875rem', fontWeight: 600,
          backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          {boardsNoGPS} board{boardsNoGPS !== 1 ? 's' : ''} without GPS — use Grid view to see all
        </div>
      )}

      {/* Empty state */}
      {boardsWithGPS.length === 0 && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 999,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(248,250,252,0.9)', backdropFilter: 'blur(4px)',
          gap: 10,
        }}>
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" strokeWidth="1.5">
            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
            <circle cx="12" cy="10" r="3"/>
          </svg>
          <p style={{ fontSize: '0.9375rem', fontWeight: 700, color: '#0F172A', margin: 0 }}>No boards have GPS coordinates</p>
          <p style={{ fontSize: '0.8125rem', color: '#94A3B8', margin: 0, textAlign: 'center', maxWidth: 300 }}>
            Board owners need to pin their boards when listing. Switch to Grid view to browse all boards.
          </p>
        </div>
      )}
    </div>
  );
}
