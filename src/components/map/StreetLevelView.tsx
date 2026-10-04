'use client';

import { useEffect, useRef, useState } from 'react';
import 'mapillary-js/dist/mapillary.css';

const MAPILLARY_TOKEN = process.env.NEXT_PUBLIC_MAPILLARY_TOKEN || '';

type NearestImage = { id: string; capturedAt: number | null; distanceM: number };

// Search outwards in steps so a nearby photo wins over a distant one; ~0.001° ≈ 110 m.
const SEARCH_STEPS_DEG = [0.0008, 0.002, 0.005];

function distanceMetres(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6_371_000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Nearest Mapillary photo to a point, or null when nobody has photographed the area. */
async function findNearestImage(lat: number, lng: number, signal: AbortSignal): Promise<NearestImage | null> {
  for (const d of SEARCH_STEPS_DEG) {
    const url = new URL('https://graph.mapillary.com/images');
    url.searchParams.set('access_token', MAPILLARY_TOKEN);
    url.searchParams.set('fields', 'id,computed_geometry,captured_at');
    url.searchParams.set('bbox', [lng - d, lat - d, lng + d, lat + d].join(','));
    url.searchParams.set('limit', '100');
    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error(`Mapillary returned ${res.status}`);
    const json = (await res.json()) as { data?: { id: string; captured_at?: number; computed_geometry?: { coordinates: [number, number] } }[] };
    const candidates = (json.data ?? [])
      .filter(i => i.computed_geometry?.coordinates)
      .map(i => ({
        id: i.id,
        capturedAt: i.captured_at ?? null,
        distanceM: distanceMetres(lat, lng, i.computed_geometry!.coordinates[1], i.computed_geometry!.coordinates[0]),
      }))
      .sort((a, b) => a.distanceM - b.distanceM);
    if (candidates.length > 0) return candidates[0];
  }
  return null;
}

type Status = 'loading' | 'ready' | 'none' | 'error';

/**
 * Street-level photos you can step through, from Mapillary (crowd-sourced,
 * so coverage and age vary a lot). Shows the nearest photo to the point and
 * lets the viewer walk along the sequence with the on-image arrows.
 */
export default function StreetLevelView({ lat, lng, height = 400 }: { lat: number; lng: number; height?: number }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [image, setImage] = useState<NearestImage | null>(null);
  const openInMapillary = `https://www.mapillary.com/app/?lat=${lat}&lng=${lng}&z=17`;

  useEffect(() => {
    if (!MAPILLARY_TOKEN) return;
    const abort = new AbortController();
    let viewer: { remove: () => void } | null = null;

    (async () => {
      setStatus('loading');
      setImage(null);
      try {
        const nearest = await findNearestImage(lat, lng, abort.signal);
        if (abort.signal.aborted) return;
        if (!nearest) { setStatus('none'); return; }
        setImage(nearest);
        const { Viewer } = await import('mapillary-js');
        if (abort.signal.aborted || !containerRef.current) return;
        viewer = new Viewer({
          accessToken: MAPILLARY_TOKEN,
          container: containerRef.current,
          imageId: nearest.id,
          component: { cover: false },
        });
        setStatus('ready');
      } catch (e) {
        if (!abort.signal.aborted) {
          console.error('[street-level]', e);
          setStatus('error');
        }
      }
    })();

    return () => {
      abort.abort();
      viewer?.remove();
    };
  }, [lat, lng]);

  const message = (title: string, body: string) => (
    <div style={{ height, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, padding: 20, textAlign: 'center', background: '#F8FAFC', boxSizing: 'border-box' }}>
      <p style={{ fontSize: '0.875rem', fontWeight: 700, color: '#0F172A', margin: 0 }}>{title}</p>
      <p style={{ fontSize: '0.75rem', color: '#64748B', margin: 0, maxWidth: 260, lineHeight: 1.5 }}>{body}</p>
    </div>
  );

  return (
    <div data-street-level={MAPILLARY_TOKEN ? status : 'no-token'} style={{ display: 'flex', flexDirection: 'column', fontFamily: "'Inter', sans-serif" }}>
      {!MAPILLARY_TOKEN ? (
        message('Street-level view is not set up', 'NEXT_PUBLIC_MAPILLARY_TOKEN is not set for this environment.')
      ) : (
        <div style={{ position: 'relative', height }}>
          <div ref={containerRef} style={{ position: 'absolute', inset: 0, visibility: status === 'ready' ? 'visible' : 'hidden' }} />
          {status === 'loading' && message('Looking for street-level photos…', 'Searching Mapillary around this point.')}
          {status === 'none' && message('No street-level photos here', 'Nobody has contributed Mapillary imagery within about 500 m of this point yet.')}
          {status === 'error' && message('Could not load street-level photos', 'Mapillary did not respond. Try again in a moment.')}
        </div>
      )}

      <div style={{ padding: '10px 16px', borderTop: '1px solid #F1F5F9', background: '#F8FAFC', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <span style={{ fontSize: '0.6875rem', color: '#94A3B8' }}>
          {status === 'ready' && image
            ? `Photo ${Math.round(image.distanceM)} m from this point${image.capturedAt ? ` · taken ${new Date(image.capturedAt).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}` : ''} · Mapillary`
            : 'Street-level imagery by Mapillary contributors'}
        </span>
        <a href={openInMapillary} target="_blank" rel="noopener noreferrer" style={{ fontSize: '0.75rem', color: '#1B4F8A', fontWeight: 600, textDecoration: 'none', flexShrink: 0 }}>
          Open in Mapillary →
        </a>
      </div>
    </div>
  );
}
