'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import OOHMap, { Popup, type MapRef } from '@/components/map/OOHMap';
import ClusteredPoints from '@/components/map/ClusteredPoints';
import { VerificationBadge, VERIFICATION_META, verificationOf, type VerificationStatus } from '@/lib/board-verification';
import { boardFormatLabel } from '@/lib/board-formats';

export type MapBoard = {
  id: string;
  name: string;
  area: string | null;
  city: string;
  format: string;
  photo_urls: string[] | null;
  verification_status: string | null;
  latitude: number;
  longitude: number;
  rate: string;
  perMonth: boolean;
  /** The rate is a guide range, not the exact price. */
  guide?: boolean;
};

// Pin colours follow the verification badges, so the map and cards read the same.
const PIN: Record<VerificationStatus, string> = {
  partner_verified: '#059669',
  verified: '#1D4ED8',
  pending: '#94A3B8',
};

const NIGERIA = { longitude: 7.4951, latitude: 9.0579, zoom: 5.2 };

type Props = {
  boards: MapBoard[];
  onOpen: (id: string) => void;
};

export default function MarketplaceMap({ boards, onOpen }: Props) {
  const mapRef = useRef<MapRef>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  // Fit the map to the boards the filters leave on screen.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    if (boards.length === 0) { map.flyTo({ center: [NIGERIA.longitude, NIGERIA.latitude], zoom: NIGERIA.zoom, duration: 600 }); return; }
    if (boards.length === 1) { map.flyTo({ center: [boards[0].longitude, boards[0].latitude], zoom: 13, duration: 600 }); return; }
    const lngs = boards.map(b => b.longitude), lats = boards.map(b => b.latitude);
    map.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]], { padding: 60, maxZoom: 14, duration: 600 });
  }, [boards, ready]);

  const points = useMemo(
    () => boards.map(b => ({ id: b.id, lng: b.longitude, lat: b.latitude, color: PIN[verificationOf(b)], radius: 8 })),
    [boards],
  );
  const open = openId ? boards.find(b => b.id === openId) ?? null : null;

  return (
    <div style={{ position: 'relative', height: '100%' }}>
      <OOHMap
        ref={mapRef}
        initialViewState={NIGERIA}
        cooperativeGestures
        onLoad={() => setReady(true)}
        search
        searchPlaceholder="Search a place or street…"
      >
        <ClusteredPoints sourceId="marketplace-boards" points={points} onPointClick={setOpenId} />

        {open && (
          <Popup longitude={open.longitude} latitude={open.latitude} anchor="bottom" offset={14} closeOnClick={false} onClose={() => setOpenId(null)} maxWidth="260px">
            <div data-map-card style={{ fontFamily: "'Inter', -apple-system, sans-serif", width: 228, margin: -10, borderRadius: 10, overflow: 'hidden' }}>
              {open.photo_urls?.[0] && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={open.photo_urls[0]} alt={open.name} style={{ width: '100%', height: 110, objectFit: 'cover', display: 'block' }} />
              )}
              <div style={{ padding: '10px 12px 12px' }}>
                <p style={{ fontSize: '0.875rem', fontWeight: 700, color: '#0F172A', margin: '0 0 2px', lineHeight: 1.3 }}>{open.name}</p>
                <p style={{ fontSize: '0.75rem', color: '#94A3B8', margin: '0 0 8px' }}>{[open.area, open.city].filter(Boolean).join(', ')}</p>
                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 10 }}>
                  <span style={{ fontSize: '0.6875rem', fontWeight: 600, color: '#1B4F8A', background: '#EFF6FF', padding: '2px 8px', borderRadius: 999 }}>{boardFormatLabel(open.format)}</span>
                  <VerificationBadge status={open.verification_status} small />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  {open.perMonth ? (
                    <p style={{ fontSize: '0.9375rem', fontWeight: 800, color: '#1B4F8A', fontFamily: 'monospace', margin: 0, letterSpacing: '-0.02em', whiteSpace: 'nowrap' }}>
                      {open.rate}<span style={{ fontSize: '0.6875rem', fontWeight: 500, color: '#94A3B8', fontFamily: 'inherit' }}>/mo{open.guide ? ' guide' : ''}</span>
                    </p>
                  ) : (
                    <p style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748B', margin: 0, whiteSpace: 'nowrap' }}>Price on request</p>
                  )}
                  <button
                    onClick={() => { setOpenId(null); onOpen(open.id); }}
                    style={{ padding: '6px 12px', background: '#1B4F8A', color: '#fff', border: 'none', borderRadius: 8, fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}
                  >
                    View details
                  </button>
                </div>
              </div>
            </div>
          </Popup>
        )}
      </OOHMap>

      {/* Legend */}
      <div style={{
        position: 'absolute', left: 12, bottom: 28, zIndex: 5,
        background: 'rgba(255,255,255,0.95)', border: '1px solid #E8EDF2', borderRadius: 10,
        padding: '8px 10px', boxShadow: '0 2px 8px rgba(15,23,42,0.08)',
        display: 'flex', flexDirection: 'column', gap: 4,
      }}>
        {(['partner_verified', 'verified', 'pending'] as VerificationStatus[]).map(s => (
          <span key={s} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.6875rem', color: '#475569', fontWeight: 500 }}>
            <span style={{ width: 9, height: 9, borderRadius: '50%', background: PIN[s], border: '1.5px solid #fff', boxShadow: '0 0 0 1px rgba(15,23,42,0.12)' }} />
            {VERIFICATION_META[s].label}
          </span>
        ))}
      </div>
    </div>
  );
}
