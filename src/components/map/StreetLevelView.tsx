'use client';

import { useEffect, useRef, useState } from 'react';
import 'mapillary-js/dist/mapillary.css';

const MAPILLARY_TOKEN = process.env.NEXT_PUBLIC_MAPILLARY_TOKEN || '';

type NearestImage = { id: string; capturedAt: number | null; distanceM: number };

// How far from the point a photo may be and still count as "this street".
const MAX_DISTANCE_M = 500;
const TILE_ZOOM = 14; // the only zoom Mapillary serves individual photos at

function tileXY(lat: number, lng: number) {
  const n = 2 ** TILE_ZOOM;
  const latRad = (lat * Math.PI) / 180;
  return {
    x: ((lng + 180) / 360) * n,
    y: ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n,
  };
}

function distanceMetres(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6_371_000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * Nearest Mapillary photo to a point, or null when nobody has photographed
 * the area. Reads Mapillary's coverage vector tiles rather than the Graph
 * API's bbox image search, which returns empty results even over dense
 * coverage. Also loads the neighbouring tile(s) when the point sits near a
 * tile edge, so a photo just across the boundary isn't missed.
 */
async function findNearestImage(lat: number, lng: number, signal: AbortSignal): Promise<NearestImage | null> {
  const [{ VectorTile }, { default: Pbf }] = await Promise.all([import('@mapbox/vector-tile'), import('pbf')]);
  const { x, y } = tileXY(lat, lng);
  const tx = Math.floor(x), ty = Math.floor(y);
  const xs = [tx], ys = [ty];
  if (x - tx < 0.25) xs.push(tx - 1); else if (x - tx > 0.75) xs.push(tx + 1);
  if (y - ty < 0.25) ys.push(ty - 1); else if (y - ty > 0.75) ys.push(ty + 1);

  const candidates: NearestImage[] = [];
  await Promise.all(xs.flatMap(cx => ys.map(async cy => {
    const res = await fetch(`https://tiles.mapillary.com/maps/vtp/mly1_public/2/${TILE_ZOOM}/${cx}/${cy}?access_token=${encodeURIComponent(MAPILLARY_TOKEN)}`, { signal });
    if (res.status === 404 || res.status === 204) return; // no coverage in this tile
    if (!res.ok) throw new Error(`Mapillary returned ${res.status}`);
    const layer = new VectorTile(new Pbf(new Uint8Array(await res.arrayBuffer()))).layers.image;
    if (!layer) return;
    for (let i = 0; i < layer.length; i++) {
      const feature = layer.feature(i);
      const geometry = feature.toGeoJSON(cx, cy, TILE_ZOOM).geometry;
      if (geometry.type !== 'Point') continue;
      const distanceM = distanceMetres(lat, lng, geometry.coordinates[1], geometry.coordinates[0]);
      if (distanceM > MAX_DISTANCE_M) continue;
      const capturedAt = Number(feature.properties.captured_at);
      candidates.push({ id: String(feature.properties.id), capturedAt: Number.isFinite(capturedAt) ? capturedAt : null, distanceM });
    }
  })));

  candidates.sort((a, b) => a.distanceM - b.distanceM);
  return candidates[0] ?? null;
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
  // Plain link-out built from the coordinates (Google's documented Maps URL
  // for a panorama) — opens in a new tab, uses no Google API or key.
  const openInGoogleStreetView = `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lng}`;

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
        const v = new Viewer({
          accessToken: MAPILLARY_TOKEN,
          container: containerRef.current,
          component: { cover: false },
        });
        viewer = v;
        // moveTo rejects when Mapillary won't serve the photo (e.g. the token's
        // app has no read permission) — without this the tab is just a black box.
        await v.moveTo(nearest.id);
        if (!abort.signal.aborted) setStatus('ready');
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
          {status === 'none' && message('No street-level photos here', 'Nobody has contributed Mapillary imagery within about 500 m of this point yet. Try Google Street View below.')}
          {status === 'error' && message('Could not load street-level photos', 'Mapillary would not serve imagery for this point. Try Google Street View below.')}
        </div>
      )}

      <div style={{ padding: '10px 16px', borderTop: '1px solid #F1F5F9', background: '#F8FAFC' }}>
        {status === 'ready' && image && (
          <p style={{ fontSize: '0.6875rem', color: '#64748B', margin: '0 0 6px' }}>
            Photo {Math.round(image.distanceM)} m from this point{image.capturedAt ? ` · taken ${new Date(image.capturedAt).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}` : ''}
          </p>
        )}
        <p data-attribution style={{ fontSize: '0.6875rem', color: '#64748B', margin: '0 0 10px' }}>
          Imagery ©{' '}
          <a href={openInMapillary} target="_blank" rel="noopener noreferrer" style={{ color: '#1B4F8A', fontWeight: 600, textDecoration: 'none' }}>Mapillary</a>
          {' '}contributors, licensed{' '}
          <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener noreferrer" style={{ color: '#1B4F8A', fontWeight: 600, textDecoration: 'none' }}>CC BY-SA 4.0</a>
        </p>
        <a
          href={openInGoogleStreetView}
          target="_blank"
          rel="noopener noreferrer"
          style={{ display: 'inline-block', padding: '7px 14px', borderRadius: 8, border: '1px solid #E2E8F0', background: '#fff', color: '#1B4F8A', fontSize: '0.75rem', fontWeight: 600, textDecoration: 'none' }}
        >
          View on Google Street View ↗
        </a>
      </div>
    </div>
  );
}
