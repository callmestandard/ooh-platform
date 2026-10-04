'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import OOHMap, { type MapRef } from '@/components/map/OOHMap';
import ClusteredPoints from '@/components/map/ClusteredPoints';
import CorridorTool, { type CorridorMode } from '@/components/map/CorridorTool';
import { BOARD_STATUS_COLORS, CITY_CENTERS, NIGERIA_CENTER, type BoardMapStatus } from '@/components/map/ooh-map-shared';

// Deterministic PRNG so every run benchmarks the same points.
function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const STATUSES: BoardMapStatus[] = ['available', 'available', 'available', 'booked', 'booked', 'unavailable', 'needs_replacement'];

/** Synthetic boards: gaussian blobs around real Nigerian city centers, Lagos/Abuja/PH/Kano weighted heaviest. */
function generate(count: number) {
  const rand = mulberry32(42);
  const gauss = () => Math.sqrt(-2 * Math.log(rand() || 1e-9)) * Math.cos(2 * Math.PI * rand());
  const cities = Object.entries(CITY_CENTERS);
  const weights = cities.map(([name]) => (name === 'Lagos' ? 12 : ['Abuja', 'Port Harcourt', 'Kano', 'Ibadan'].includes(name) ? 4 : 1));
  const total = weights.reduce((a, b) => a + b, 0);
  return Array.from({ length: count }, (_, i) => {
    let r = rand() * total;
    let idx = 0;
    while (r > weights[idx]) { r -= weights[idx]; idx++; }
    const [lng, lat] = cities[idx][1];
    return {
      id: `synthetic-${i}`,
      lng: lng + gauss() * 0.07,
      lat: lat + gauss() * 0.07,
      color: BOARD_STATUS_COLORS[STATUSES[Math.floor(rand() * STATUSES.length)]],
    };
  });
}

type Result = { points: number; frames: number; avgFps: number; p95FrameMs: number; worstFrameMs: number; framesOver33ms: number };

const TOUR: { center: [number, number]; zoom: number }[] = [
  { center: [NIGERIA_CENTER.longitude, NIGERIA_CENTER.latitude], zoom: 5.2 },
  { center: CITY_CENTERS['Lagos'], zoom: 9 },
  { center: CITY_CENTERS['Lagos'], zoom: 13.5 },
  { center: CITY_CENTERS['Ibadan'], zoom: 11 },
  { center: CITY_CENTERS['Abuja'], zoom: 12 },
  { center: CITY_CENTERS['Kano'], zoom: 10 },
  { center: CITY_CENTERS['Port Harcourt'], zoom: 14 },
  { center: [NIGERIA_CENTER.longitude, NIGERIA_CENTER.latitude], zoom: 5.2 },
];

export default function StressMap() {
  const mapRef = useRef<MapRef>(null);
  const [count, setCount] = useState(5000);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const points = useMemo(() => generate(count), [count]);
  // Same points in the shape the corridor tool queries, to exercise it at volume.
  const corridorBoards = useMemo(() => points.map(p => ({ id: p.id, latitude: p.lat, longitude: p.lng })), [points]);
  const [matched, setMatched] = useState(0);
  const [mode, setMode] = useState<CorridorMode>('off');
  const handleMatched = useCallback((m: { id: string }[]) => setMatched(m.length), []);

  async function runBenchmark() {
    const map = mapRef.current?.getMap();
    if (!map) return;
    setRunning(true);
    setResult(null);
    const frames: number[] = [];
    let last = performance.now();
    let raf = 0;
    const tick = (now: number) => { frames.push(now - last); last = now; raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    for (const stop of TOUR) {
      await new Promise<void>(resolve => {
        map.once('moveend', () => resolve());
        map.flyTo({ ...stop, duration: 2200, essential: true });
      });
    }
    cancelAnimationFrame(raf);
    const sorted = [...frames].sort((a, b) => a - b);
    const sum = frames.reduce((a, b) => a + b, 0);
    const res: Result = {
      points: count,
      frames: frames.length,
      avgFps: Math.round((frames.length / sum) * 1000 * 10) / 10,
      p95FrameMs: Math.round(sorted[Math.floor(sorted.length * 0.95)] * 10) / 10,
      worstFrameMs: Math.round(sorted[sorted.length - 1] * 10) / 10,
      framesOver33ms: frames.filter(f => f > 33.4).length,
    };
    (window as unknown as { __mapStress?: Result }).__mapStress = res;
    setResult(res);
    setRunning(false);
  }

  return (
    <div style={{ position: 'fixed', inset: 0, fontFamily: "'Inter', sans-serif" }}>
      <OOHMap ref={mapRef} initialViewState={{ ...NIGERIA_CENTER, zoom: 5.2 }} search>
        <ClusteredPoints sourceId="stress-boards" points={points} interactive={mode === 'off'} />
        <CorridorTool boards={corridorBoards} onMatchedChange={handleMatched} onModeChange={setMode} />
      </OOHMap>
      <div style={{ position: 'absolute', top: 12, right: 12, zIndex: 10, width: 250, background: '#fff', borderRadius: 12, padding: 14, boxShadow: '0 8px 32px rgba(0,0,0,0.18)', fontSize: '0.75rem', color: '#475569' }}>
        <p style={{ fontWeight: 700, color: '#0F172A', margin: '0 0 8px' }}>Cluster stress test (synthetic)</p>
        <div style={{ display: 'flex', gap: 4, marginBottom: 10 }}>
          {[1000, 5000, 20000, 50000].map(n => (
            <button key={n} data-count={n} onClick={() => setCount(n)} disabled={running}
              style={{ flex: 1, padding: '5px 0', borderRadius: 6, border: 'none', cursor: 'pointer', background: count === n ? '#1B4F8A' : '#F1F5F9', color: count === n ? '#fff' : '#475569', fontWeight: 600, fontSize: '0.6875rem' }}>
              {n / 1000}k
            </button>
          ))}
        </div>
        <button id="run-benchmark" onClick={runBenchmark} disabled={running}
          style={{ width: '100%', padding: 8, borderRadius: 7, border: 'none', cursor: 'pointer', background: '#1B4F8A', color: '#fff', fontWeight: 600 }}>
          {running ? 'Flying…' : 'Run fly-through benchmark'}
        </button>
        <p id="corridor-matched" data-matched={matched} style={{ margin: '10px 0 0' }}>Corridor/radius tool: {matched} inside</p>
        {result && (
          <pre id="benchmark-result" style={{ margin: '10px 0 0', fontSize: '0.6875rem', whiteSpace: 'pre-wrap' }}>{JSON.stringify(result, null, 2)}</pre>
        )}
      </div>
    </div>
  );
}
