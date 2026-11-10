'use client';

import dynamic from 'next/dynamic';

// The map library is large and needs the browser: load it only when the page shows it.
const Board3DMap = dynamic(() => import('./Board3DMap'), {
  ssr: false,
  loading: () => <div style={{ height: 420, borderRadius: 16, background: 'linear-gradient(135deg,#E2E8F0,#F1F5F9)' }} />,
});

export default Board3DMap;
