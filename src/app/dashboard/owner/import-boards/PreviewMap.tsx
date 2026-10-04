'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import OOHMap, { Popup, type MapRef } from '@/components/map/OOHMap';
import ClusteredPoints from '@/components/map/ClusteredPoints';

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

function fmt(n: number | null) {
  if (!n) return '—';
  if (n >= 1_000_000) return '₦' + (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return '₦' + Math.round(n / 1_000) + 'K';
  return '₦' + n.toLocaleString('en-NG');
}

export default function PreviewMap({ boards }: { boards: MapBoard[] }) {
  const mapRef = useRef<MapRef>(null);
  const [poppedId, setPoppedId] = useState<string | null>(null);
  const center = boards.length > 0 ? { longitude: boards[0].lng, latitude: boards[0].lat } : { longitude: 7.4951, latitude: 9.0579 };

  useEffect(() => {
    const map = mapRef.current;
    if (!map || boards.length === 0) return;
    if (boards.length === 1) {
      map.flyTo({ center: [boards[0].lng, boards[0].lat], zoom: 13, duration: 600 });
      return;
    }
    const lngs = boards.map(b => b.lng);
    const lats = boards.map(b => b.lat);
    map.fitBounds(
      [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
      { padding: 40, duration: 600 },
    );
  }, [boards]);

  // Fill = row status, ring = amber when the pin was geocoded rather than supplied.
  const points = useMemo(
    () => boards.map(b => ({
      id: b.id, lng: b.lng, lat: b.lat, radius: 9,
      color: b.status === 'ready' ? '#1B4F8A' : '#D97706',
      stroke: b.geocoded ? '#F59E0B' : '#fff',
    })),
    [boards],
  );

  return (
    <OOHMap ref={mapRef} initialViewState={{ ...center, zoom: 6 }} style={{ width: '100%', height: '100%', borderRadius: 12 }}>
      <ClusteredPoints sourceId="import-preview-boards" points={points} onPointClick={setPoppedId} />

      {poppedId && (() => {
        const b = boards.find(x => x.id === poppedId);
        if (!b) return null;
        return (
          <Popup longitude={b.lng} latitude={b.lat} anchor="bottom" offset={16} closeOnClick={false} onClose={() => setPoppedId(null)}>
            <div style={{ fontFamily: "'Inter', sans-serif", minWidth: 150 }}>
              <strong style={{ fontSize: '0.8125rem' }}>{b.name}</strong><br />
              <span style={{ fontSize: '0.75rem', color: '#64748B' }}>{b.city} · {b.format}</span><br />
              <span style={{ fontSize: '0.75rem', fontWeight: 600 }}>{fmt(b.asking_rate)}/mo</span>
              {b.geocoded && (
                <><br /><span style={{ fontSize: '0.6875rem', color: '#D97706' }}>⚠ Geocoded — verify pin</span></>
              )}
            </div>
          </Popup>
        );
      })()}
    </OOHMap>
  );
}
