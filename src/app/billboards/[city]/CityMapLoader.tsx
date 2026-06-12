'use client';

import dynamic from 'next/dynamic';

const CityMapDynamic = dynamic(() => import('./CityMap'), {
  ssr: false,
  loading: () => (
    <div style={{
      height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#F1F5F9', borderRadius: 16,
    }}>
      <span style={{ color: '#94A3B8', fontSize: '0.875rem' }}>Loading map…</span>
    </div>
  ),
});

export default CityMapDynamic;
