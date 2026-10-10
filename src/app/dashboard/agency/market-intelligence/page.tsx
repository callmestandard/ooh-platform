'use client';

import dynamic from 'next/dynamic';

// Mapbox GL needs the browser, so the whole view loads client-side only.
const MarketIntelView = dynamic(() => import('@/components/market-intel/MarketIntelView'), {
  ssr: false,
  loading: () => <div style={{ padding: 24, fontSize: '0.875rem', color: '#64748B' }}>Loading market data…</div>,
});

export default function MarketIntelligencePage() {
  return <MarketIntelView />;
}
