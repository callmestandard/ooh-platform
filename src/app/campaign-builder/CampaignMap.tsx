'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import OOHMap, { Popup, type MapRef } from '@/components/map/OOHMap';
import ClusteredPoints from '@/components/map/ClusteredPoints';

export type CampaignMapBoard = {
  id: string;
  name: string;
  city: string;
  format: string;
  asking_rate: number;
  lat: number;
  lng: number;
};

function fmtRate(n: number) {

  if (!n) return 'on request'; // rates are private unless the owner opens them (migration 035)
  if (n >= 1_000_000) return '₦' + (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return '₦' + Math.round(n / 1_000) + 'K';
  return '₦' + n.toLocaleString('en-NG');
}

type Props = {
  boards: CampaignMapBoard[];
  selectedIds: Set<string>;
  hoveredId: string | null;
  onToggle: (id: string) => void;
  onHover: (id: string | null) => void;
};

export default function CampaignMap({ boards, selectedIds, hoveredId, onToggle, onHover }: Props) {
  const mapRef = useRef<MapRef>(null);
  const [poppedId, setPoppedId] = useState<string | null>(null);
  const center = boards.length > 0 ? { longitude: boards[0].lng, latitude: boards[0].lat } : { longitude: 7.4951, latitude: 9.0579 };

  useEffect(() => {
    const map = mapRef.current;
    if (!map || boards.length === 0) return;
    if (boards.length === 1) {
      map.flyTo({ center: [boards[0].lng, boards[0].lat], zoom: 13, duration: 800 });
      return;
    }
    const lngs = boards.map(b => b.lng);
    const lats = boards.map(b => b.lat);
    map.fitBounds(
      [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
      { padding: 40, duration: 800 },
    );
  }, [boards]);

  const points = useMemo(() => boards.map(b => {
    const selected = selectedIds.has(b.id);
    return {
      id: b.id, lng: b.lng, lat: b.lat,
      color: selected ? '#1B4F8A' : '#22C55E',
      stroke: selected ? '#F59E0B' : '#fff',
      radius: hoveredId === b.id ? 12 : 9,
    };
  }), [boards, selectedIds, hoveredId]);

  function handlePointClick(id: string) {
    onToggle(id);
    setPoppedId(id);
  }

  return (
    <OOHMap ref={mapRef} initialViewState={{ ...center, zoom: 6 }} search>
      <ClusteredPoints
        sourceId="campaign-builder-boards"
        points={points}
        onPointClick={handlePointClick}
        onPointHover={id => onHover(id)}
      />

      {poppedId && (() => {
        const b = boards.find(x => x.id === poppedId);
        if (!b) return null;
        return (
          <Popup longitude={b.lng} latitude={b.lat} anchor="bottom" offset={16} closeButton={true} closeOnClick={false} onClose={() => setPoppedId(null)}>
            <div style={{ fontFamily: "'Inter', sans-serif", minWidth: 150 }}>
              <strong style={{ fontSize: '0.8125rem', display: 'block', marginBottom: 2 }}>{b.name}</strong>
              <span style={{ fontSize: '0.75rem', color: '#64748B' }}>{b.city} · {b.format}</span><br />
              <span style={{ fontSize: '0.75rem', fontWeight: 600 }}>{fmtRate(b.asking_rate)}/mo</span>
              <br />
              <button
                onClick={() => onToggle(b.id)}
                style={{
                  marginTop: 8, padding: '5px 12px', borderRadius: 7, cursor: 'pointer',
                  background: selectedIds.has(b.id) ? '#FEF2F2' : '#1B4F8A',
                  color: selectedIds.has(b.id) ? '#DC2626' : '#fff',
                  border: selectedIds.has(b.id) ? '1px solid #FECACA' : 'none',
                  fontSize: '0.6875rem', fontWeight: 600, fontFamily: 'inherit',
                }}
              >
                {selectedIds.has(b.id) ? 'Remove' : 'Add to plan'}
              </button>
            </div>
          </Popup>
        );
      })()}
    </OOHMap>
  );
}
