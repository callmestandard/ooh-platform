'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import OOHMap, { Popup, type MapRef } from '@/components/map/OOHMap';
import ClusteredPoints from '@/components/map/ClusteredPoints';

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

  const points = useMemo(
    () => boards.map(b => ({ id: b.id, lng: b.lng, lat: b.lat, color: FORMAT_PIN_COLORS[b.format] || '#1B4F8A', radius: 8 })),
    [boards],
  );

  return (
    <OOHMap ref={mapRef} initialViewState={{ ...center, zoom: 12 }} scrollZoom={false}>
      <ClusteredPoints sourceId="city-boards" points={points} onPointClick={setPoppedId} />

      {poppedId && (() => {
        const b = boards.find(x => x.id === poppedId);
        if (!b) return null;
        return (
          <Popup longitude={b.lng} latitude={b.lat} anchor="bottom" offset={14} closeOnClick={false} onClose={() => setPoppedId(null)}>
            <div style={{ fontFamily: "'Inter', sans-serif", minWidth: 150 }}>
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
            </div>
          </Popup>
        );
      })()}
    </OOHMap>
  );
}
