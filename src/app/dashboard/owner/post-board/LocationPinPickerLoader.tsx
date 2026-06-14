'use client';

import dynamic from 'next/dynamic';

const LocationPinPicker = dynamic(() => import('./LocationPinPicker'), {
  ssr: false,
  loading: () => (
    <div style={{
      height: 280,
      background: '#F1F5F9',
      borderRadius: 10,
      border: '1px solid #E2E8F0',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}>
      <span style={{ color: '#94A3B8', fontSize: '0.875rem' }}>Loading map…</span>
    </div>
  ),
});

export default LocationPinPicker;
