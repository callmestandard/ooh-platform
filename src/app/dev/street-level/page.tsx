'use client';

import dynamic from 'next/dynamic';
import { useSyncExternalStore } from 'react';

// Dev-only harness for the Mapillary street-level view:
// /dev/street-level?lat=6.4281&lng=3.4219 — renders nothing in production builds.
const StreetLevelView = dynamic(() => import('@/components/map/StreetLevelView'), { ssr: false });

const subscribe = () => () => {};

export default function StreetLevelDevPage() {
  const search = useSyncExternalStore(subscribe, () => window.location.search, () => '');
  if (process.env.NODE_ENV === 'production') return null;
  const params = new URLSearchParams(search);
  const lat = Number(params.get('lat')), lng = Number(params.get('lng'));
  if (!lat || !lng) return <p style={{ padding: 24, fontFamily: 'sans-serif' }}>Add ?lat=…&amp;lng=… to the URL.</p>;
  return (
    <div style={{ width: 340, margin: '24px auto', border: '1px solid #E2E8F0', borderRadius: 12, overflow: 'hidden' }}>
      <StreetLevelView lat={lat} lng={lng} />
    </div>
  );
}
