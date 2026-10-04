'use client';

import dynamic from 'next/dynamic';

// Dev-only harness: renders thousands of synthetic board points through the
// shared OOHMap + ClusteredPoints to benchmark clustering. Renders nothing in
// production builds.
const StressMap = dynamic(() => import('./StressMap'), { ssr: false });

export default function MapStressPage() {
  if (process.env.NODE_ENV === 'production') return null;
  return <StressMap />;
}
