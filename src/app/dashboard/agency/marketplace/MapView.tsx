'use client';

import { useEffect, useMemo, useRef } from 'react';
import OOHMap, { type MapRef } from '@/components/map/OOHMap';
import ClusteredPoints from '@/components/map/ClusteredPoints';
import { boardStatusColor } from '@/components/map/ooh-map-shared';

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

export default function MapView({
  boards,
  onSelectBoard,
}: {
  boards: Board[];
  onSelectBoard: (b: Board) => void;
}) {
  const mapRef = useRef<MapRef>(null);
  const boardsWithGPS = useMemo(() => boards.filter(b => b.latitude != null && b.longitude != null), [boards]);
  const boardsNoGPS = boards.length - boardsWithGPS.length;
  const points = useMemo(
    () => boardsWithGPS.map(b => ({ id: b.id, lng: b.longitude!, lat: b.latitude!, color: boardStatusColor(b.status) })),
    [boardsWithGPS],
  );

  useEffect(() => {
    const map = mapRef.current;
    if (!map || boardsWithGPS.length === 0) return;
    if (boardsWithGPS.length === 1) {
      map.flyTo({ center: [boardsWithGPS[0].longitude!, boardsWithGPS[0].latitude!], zoom: 15, duration: 600 });
      return;
    }
    const lngs = boardsWithGPS.map(b => b.longitude!);
    const lats = boardsWithGPS.map(b => b.latitude!);
    map.fitBounds(
      [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
      { padding: 60, maxZoom: 14, duration: 600 },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardsWithGPS.length]);

  function handlePointClick(id: string) {
    const board = boardsWithGPS.find(b => b.id === id);
    if (!board) return;
    mapRef.current?.flyTo({ center: [board.longitude!, board.latitude!], zoom: Math.max(mapRef.current.getZoom(), 13), duration: 700 });
    onSelectBoard(board);
  }

  return (
    <div style={{ position: 'relative', height: 'calc(100vh - 300px)', minHeight: 480, borderRadius: 14, overflow: 'hidden', border: '1px solid #E2E8F0', boxShadow: '0 2px 16px rgba(0,0,0,0.06)' }}>
      <OOHMap ref={mapRef} initialViewState={{ longitude: 8.675, latitude: 9.082, zoom: 6 }} search>
        <ClusteredPoints
          sourceId="marketplace-boards"
          points={points}
          onPointClick={handlePointClick}
        />
      </OOHMap>

      {/* Legend */}
      <div style={{
        position: 'absolute', top: 14, right: 14, zIndex: 1,
        background: 'rgba(255,255,255,0.96)', borderRadius: 10,
        padding: '10px 14px', boxShadow: '0 2px 12px rgba(0,0,0,0.12)',
      }}>
        <p style={{ fontSize: '0.5625rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 7px' }}>Legend</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 10, height: 10, borderRadius: '50%', background: boardStatusColor('available'), flexShrink: 0 }} />
            <span style={{ fontSize: '0.6875rem', color: '#374151', fontWeight: 500 }}>Available</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 10, height: 10, borderRadius: '50%', background: boardStatusColor('booked'), flexShrink: 0 }} />
            <span style={{ fontSize: '0.6875rem', color: '#374151', fontWeight: 500 }}>Booked</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 10, height: 10, borderRadius: '50%', background: boardStatusColor('unavailable'), flexShrink: 0 }} />
            <span style={{ fontSize: '0.6875rem', color: '#374151', fontWeight: 500 }}>Unavailable</span>
          </div>
        </div>
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid #F1F5F9' }}>
          <p style={{ fontSize: '0.5625rem', color: '#94A3B8', margin: 0, lineHeight: 1.5 }}>
            Numbered circles = clusters<br />Click to zoom in
          </p>
        </div>
      </div>

      {/* Boards without GPS notice */}
      {boardsNoGPS > 0 && (
        <div style={{
          position: 'absolute', bottom: 14, left: 14, zIndex: 1,
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
          position: 'absolute', inset: 0, zIndex: 1,
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
