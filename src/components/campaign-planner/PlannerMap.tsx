'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import OOHMap, { type MapRef } from '@/components/map/OOHMap';
import ClusteredPoints from '@/components/map/ClusteredPoints';
import CorridorTool, { type CorridorMode } from '@/components/map/CorridorTool';
import { boardStatusColor, cityCenter, LAGOS_CENTER } from '@/components/map/ooh-map-shared';
import type { Board } from '@/app/dashboard/agency/boards-map/page';

type Props = {
  boards: Board[];
  selectedIds: Set<string>;
  onToggleBoard: (board: Board) => void;
  highlightedId?: string | null;
  /** Corridor/radius tool result — lets the parent merge matched boards straight into the shortlist. */
  onCorridorMatch?: (boards: Board[]) => void;
  showCorridorTool?: boolean;
  /** Board ids currently inside the drawn corridor/radius — ringed on the map. */
  corridorMatchIds?: Set<string>;
  /** A city to fly to (e.g. the first target city from a parsed brief). */
  focusCity?: string | null;
};

export default function PlannerMap({ boards, selectedIds, onToggleBoard, highlightedId, onCorridorMatch, showCorridorTool, corridorMatchIds, focusCity }: Props) {
  const mapRef = useRef<MapRef>(null);
  const [mapReady, setMapReady] = useState(false);
  const [corridorMode, setCorridorMode] = useState<CorridorMode>('off');
  const drawing = !!showCorridorTool && corridorMode !== 'off';

  const geo = useMemo(() => boards.filter(b => b.latitude && b.longitude), [boards]);
  const byId = useMemo(() => new Map(geo.map(b => [b.id, b])), [geo]);
  const corridorBoards = useMemo(() => geo.filter(b => b.status === 'available'), [geo]);

  // Fly to a board highlighted from the list (e.g. hovering a shortlist row).
  useEffect(() => {
    if (!highlightedId) return;
    const b = byId.get(highlightedId);
    const map = mapRef.current;
    if (!b || !map) return;
    map.flyTo({ center: [b.longitude!, b.latitude!], zoom: Math.max(map.getZoom(), 13), duration: 700 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightedId]);

  // Fly to the brief's target city so a corridor can be drawn there right away.
  useEffect(() => {
    const center = cityCenter(focusCity);
    if (!center || !mapReady) return;
    mapRef.current?.flyTo({ center, zoom: 11.5, duration: 1400 });
  }, [focusCity, mapReady]);

  const points = useMemo(() => geo.map(b => {
    const selected = selectedIds.has(b.id);
    const highlighted = highlightedId === b.id;
    const matched = !!corridorMatchIds?.has(b.id);
    return {
      id: b.id,
      lng: b.longitude!,
      lat: b.latitude!,
      color: selected ? '#1B4F8A' : highlighted ? '#F59E0B' : boardStatusColor(b.status),
      radius: selected || highlighted || matched ? 10 : 7,
      stroke: matched ? '#F59E0B' : '#fff',
    };
  }), [geo, selectedIds, highlightedId, corridorMatchIds]);

  const handleMatched = useCallback((matched: Board[]) => onCorridorMatch?.(matched), [onCorridorMatch]);

  function handlePointClick(id: string) {
    const board = byId.get(id);
    if (board && board.status === 'available') onToggleBoard(board);
  }

  return (
    <OOHMap ref={mapRef} initialViewState={{ ...LAGOS_CENTER, zoom: 11 }} search onLoad={() => setMapReady(true)}>
      <ClusteredPoints
        sourceId="planner-boards"
        points={points}
        onPointClick={handlePointClick}
        interactive={!drawing}
      />

      {showCorridorTool && (
        <CorridorTool
          boards={corridorBoards}
          onMatchedChange={handleMatched}
          onModeChange={setCorridorMode}
        />
      )}
    </OOHMap>
  );
}

export type { Board };
