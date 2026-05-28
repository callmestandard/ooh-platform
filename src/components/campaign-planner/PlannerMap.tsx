'use client';

import { useRef, useCallback } from 'react';
import Map, { Marker, NavigationControl, MapRef } from 'react-map-gl/maplibre';
import type { Board } from '@/app/dashboard/agency/boards-map/page';

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || '';

const MAP_STYLE = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json';

const FORMAT_ICONS: Record<string, string> = {
  unipole: '▲', gantry: '⬛', billboard: '▬', bridge_panel: '─', wall_drape: '▼',
};

type Props = {
  boards: Board[];
  selectedIds: Set<string>;
  onToggleBoard: (board: Board) => void;
  highlightedId?: string | null;
};

export default function PlannerMap({ boards, selectedIds, onToggleBoard, highlightedId }: Props) {
  const mapRef = useRef<MapRef>(null);

  const geo = boards.filter(b => b.latitude && b.longitude);

  return (
    <Map
      ref={mapRef}
      initialViewState={{ longitude: 3.3792, latitude: 6.5244, zoom: 11 }}
      style={{ width: '100%', height: '100%' }}
      mapStyle={MAP_STYLE}
      attributionControl={false}
    >
      <NavigationControl position="bottom-right" />

      {geo.map(board => {
        const selected = selectedIds.has(board.id);
        const highlighted = highlightedId === board.id;
        const isAvailable = board.status === 'available';

        return (
          <Marker
            key={board.id}
            longitude={board.longitude!}
            latitude={board.latitude!}
            anchor="bottom"
            onClick={e => {
              e.originalEvent.stopPropagation();
              if (isAvailable) onToggleBoard(board);
            }}
          >
            <div
              title={isAvailable ? (selected ? 'Remove from plan' : 'Add to plan') : 'Not available'}
              style={{
                position: 'relative',
                cursor: isAvailable ? 'pointer' : 'not-allowed',
                transform: selected || highlighted ? 'scale(1.2)' : 'scale(1)',
                transition: 'transform 0.15s',
              }}
            >
              {/* Pulse ring for selected */}
              {selected && (
                <div style={{
                  position: 'absolute',
                  inset: -8,
                  borderRadius: '50%',
                  border: '2px solid #1B4F8A',
                  opacity: 0.5,
                  animation: 'plannerPulse 1.5s ease-in-out infinite',
                  pointerEvents: 'none',
                }} />
              )}

              {/* Pin body */}
              <div style={{
                width: 32,
                height: 32,
                borderRadius: selected ? '8px' : '50% 50% 50% 0',
                transform: selected ? 'none' : 'rotate(-45deg)',
                background: selected
                  ? '#1B4F8A'
                  : !isAvailable
                    ? '#94A3B8'
                    : highlighted
                      ? '#F59E0B'
                      : '#10B981',
                border: `2px solid ${selected ? '#3B82F6' : 'rgba(255,255,255,0.8)'}`,
                boxShadow: selected
                  ? '0 4px 12px rgba(27,79,138,0.5)'
                  : '0 2px 8px rgba(0,0,0,0.2)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}>
                <span style={{
                  transform: selected ? 'none' : 'rotate(45deg)',
                  fontSize: '11px',
                  fontWeight: 700,
                  color: '#fff',
                  lineHeight: 1,
                  fontFamily: 'monospace',
                }}>
                  {selected
                    ? '✓'
                    : (FORMAT_ICONS[board.format || ''] || '●')
                  }
                </span>
              </div>
            </div>
          </Marker>
        );
      })}

      <style>{`
        @keyframes plannerPulse {
          0%, 100% { transform: scale(1); opacity: 0.5; }
          50% { transform: scale(1.4); opacity: 0.2; }
        }
      `}</style>
    </Map>
  );
}
