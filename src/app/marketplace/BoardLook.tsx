'use client';

import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import type { MapBoard } from './MarketplaceMap';
import AroundBoard from '@/components/intel/AroundBoard';
import { streetViewFor, plainStreetViewUrl, placeSearchUrl, pinMapUrl, type StreetViewLinks } from '@/lib/street-view';

// Loaded only when someone opens the panel (it pulls in the tile decoder).
const StreetLevelView = dynamic(() => import('@/components/map/StreetLevelView'), {
  ssr: false,
  loading: () => <div style={{ height: 300, background: '#F1F5F9' }} />,
});

type SvLinks = { kind: 'facing'; links: StreetViewLinks } | { kind: 'near'; url: string } | { kind: 'search'; url: string };

/**
 * The best Google link for a board: Street View from the road facing it when
 * the pin is precise, the plain nearest-panorama link while that loads (or if
 * no road is found), and a Google Maps search by name when the pin is rough.
 */
export function useStreetViewLinks(board: MapBoard): SvLinks {
  const [found, setFound] = useState<{ key: string; links: StreetViewLinks | null } | null>(null);
  const hint = [board.name, board.area].filter(Boolean).join(' ');
  const key = `${board.latitude},${board.longitude}|${hint}`;
  useEffect(() => {
    if (board.pinVague) return;
    let live = true;
    streetViewFor(board.latitude, board.longitude, hint).then(links => { if (live) setFound({ key, links }); });
    return () => { live = false; };
  }, [board.latitude, board.longitude, board.pinVague, hint, key]);
  if (board.pinVague) return { kind: 'search', url: placeSearchUrl([board.name, board.area, board.city].filter(Boolean).join(', ')) };
  if (found?.key === key && found.links) return { kind: 'facing', links: found.links };
  return { kind: 'near', url: plainStreetViewUrl(board.latitude, board.longitude) };
}

const PIN = <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="10" r="2.5"/></svg>;
const PERSON = <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="5" r="2.5"/><path d="M9.5 21v-6l-2-1V10a2 2 0 0 1 2-2h5a2 2 0 0 1 2 2v4l-2 1v6"/></svg>;

/** Compact Google button for the map card. */
export function StreetViewButton({ board }: { board: MapBoard }) {
  const href = board.pinVague ? placeSearchUrl([board.name, board.area, board.city].filter(Boolean).join(', ')) : pinMapUrl(board.latitude, board.longitude);
  return (
    <a data-street-btn href={href} target="_blank" rel="noopener noreferrer"
      title={board.pinVague ? 'This pin is approximate: search Google Maps by name' : "Open Google Maps at the board's exact spot"}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '8px 10px', border: '1px solid #E2E8F0', background: '#fff', color: '#0F172A', borderRadius: 9, fontSize: '0.8125rem', fontWeight: 600, fontFamily: 'inherit', whiteSpace: 'nowrap', textDecoration: 'none' }}>
      {PIN}Google Maps ↗
    </a>
  );
}

/** Board photos you can step through: arrows, a counter, and swipe on phones. */
export function PhotoStepper({ photos, alt, height, rounded = 0 }: { photos: string[]; alt: string; height: number; rounded?: number }) {
  const [i, setI] = useState(0);
  const [touchX, setTouchX] = useState<number | null>(null);
  const n = photos.length;
  const go = (d: number) => setI(v => (v + d + n) % n);
  if (!n) return <div style={{ height, background: '#F1F5F9', borderRadius: rounded, display: 'grid', placeItems: 'center', color: '#94A3B8', fontSize: '0.75rem' }}>No photo yet</div>;
  return (
    <div
      className="ph-step"
      style={{ height, borderRadius: rounded }}
      onTouchStart={e => setTouchX(e.touches[0].clientX)}
      onTouchEnd={e => { if (touchX == null) return; const dx = e.changedTouches[0].clientX - touchX; if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1); setTouchX(null); }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img key={photos[i]} src={photos[i]} alt={`${alt}, photo ${i + 1} of ${n}`} decoding="async" />
      {/* Preload the next photo so stepping feels instant. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {n > 1 && <img src={photos[(i + 1) % n]} alt="" aria-hidden style={{ display: 'none' }} />}
      {n > 1 && (
        <>
          <button type="button" className="ph-arrow l" aria-label="Previous photo" onClick={e => { e.stopPropagation(); go(-1); }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
          </button>
          <button type="button" className="ph-arrow r" aria-label="Next photo" onClick={e => { e.stopPropagation(); go(1); }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6"/></svg>
          </button>
          <span className="ph-count">{i + 1} / {n}</span>
        </>
      )}
      <style>{`
        .ph-step { position: relative; overflow: hidden; background: #F1F5F9; touch-action: pan-y; }
        .ph-step > img { width: 100%; height: 100%; object-fit: cover; display: block; animation: phIn .18s ease-out; }
        @keyframes phIn { from { opacity: .4; } to { opacity: 1; } }
        .ph-arrow { position: absolute; top: 50%; transform: translateY(-50%); width: 30px; height: 30px; border-radius: 50%; border: none; background: rgba(255,255,255,.94); color: #0F172A; display: grid; place-items: center; cursor: pointer; box-shadow: 0 1px 6px rgba(15,23,42,.25); opacity: 0; transition: opacity .15s; }
        .ph-arrow.l { left: 8px; } .ph-arrow.r { right: 8px; }
        .ph-step:hover .ph-arrow, .ph-arrow:focus-visible { opacity: 1; }
        @media (hover: none) { .ph-arrow { opacity: 1; width: 28px; height: 28px; } }
        .ph-count { position: absolute; left: 8px; bottom: 8px; padding: 3px 8px; border-radius: 999px; background: rgba(15,23,42,.72); color: #fff; font: 600 11px/1.3 'Inter', sans-serif; }
      `}</style>
    </div>
  );
}

/** "See the site": the board's own photos and the street-level view of its spot. */
export default function BoardLook({ board, onClose, onOpen }: { board: MapBoard; onClose: () => void; onOpen: (id: string) => void }) {
  const photos = (board.photo_urls ?? []).filter(Boolean);
  const [community, setCommunity] = useState(false);
  const sv = useStreetViewLinks(board);
  // One listener for the panel's lifetime: re-adding it on every render could
  // drop the key press when another Escape handler re-renders the page first.
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') closeRef.current(); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  return (
    <div className="bl" role="dialog" aria-label={`See the site: ${board.name}`} data-board-look>
      <div className="bl-head">
        <div style={{ minWidth: 0 }}>
          <p className="bl-name">{board.name}</p>
          <p className="bl-place">{[board.area, board.city].filter(Boolean).join(', ')}</p>
        </div>
        <button type="button" className="bl-x" onClick={onClose} aria-label="Close">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </button>
      </div>
      <div className="bl-scroll">
        <p className="bl-label">Photos of the board</p>
        <PhotoStepper photos={photos} alt={board.name} height={220} rounded={12} />
        <p className="bl-label">Around this board</p>
        <AroundBoard boardId={board.id} lat={board.latitude} lng={board.longitude} compactView where="map_panel" />
        <p className="bl-label">On Google</p>
        <a className="bl-google" href={sv.kind === 'search' ? sv.url : pinMapUrl(board.latitude, board.longitude)} target="_blank" rel="noopener noreferrer" data-google-sv data-sv-kind={sv.kind}
          data-road-mismatch={sv.kind === 'facing' && sv.links.roadMismatch ? '' : undefined}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="10" r="2.5"/></svg>
          {sv.kind === 'search' ? (
            <span><b>Find it on Google Maps</b><small>This board&apos;s pin is approximate, so we search by its name</small></span>
          ) : (
            <span><b>See the exact spot on Google Maps</b><small>Pinned where the board stands. Switch to satellite, or tap Street View if Google shows a photo there.</small></span>
          )}
          <svg className="bl-ext" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 17 17 7M8 7h9v9"/></svg>
        </a>
        {sv.kind !== 'search' && (
          <p className="bl-sv">
            {PERSON}
            <a href={sv.kind === 'facing' ? sv.links.url : sv.url} target="_blank" rel="noopener noreferrer" data-sv-facing>
              Street View{sv.kind === 'facing' && sv.links.road ? ` from ${sv.links.road}` : ''}, facing the board ↗
            </a>
            {sv.kind === 'facing' && sv.links.otherUrl && (
              <> · <a href={sv.links.otherUrl} target="_blank" rel="noopener noreferrer" data-sv-other>other direction ↗</a></>
            )}
            <small>Google has Street View on some Nigerian roads only.</small>
          </p>
        )}
        {community ? (
          <div className="bl-street">
            <StreetLevelView key={board.id} lat={board.latitude} lng={board.longitude} height={280} showGoogle={false} />
          </div>
        ) : (
          <button type="button" className="bl-more" onClick={() => setCommunity(true)} data-community-btn>
            Also show community street photos <span>(Mapillary, may be older)</span>
          </button>
        )}
        <button type="button" className="bl-open" onClick={() => onOpen(board.id)}>View board and request pricing</button>
      </div>
      <style>{`
        .bl { position: absolute; top: 12px; right: 12px; bottom: 12px; width: min(440px, calc(100% - 24px)); z-index: 8; background: #fff; border-radius: 16px; box-shadow: 0 24px 60px -18px rgba(15,23,42,.45), 0 0 0 1px rgba(15,23,42,.06); display: flex; flex-direction: column; overflow: hidden; font-family: 'Inter', -apple-system, sans-serif; animation: blIn .2s cubic-bezier(.2,.9,.3,1); }
        @keyframes blIn { from { opacity: 0; transform: translateX(16px); } to { opacity: 1; transform: none; } }
        .bl-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 14px 14px 12px 16px; border-bottom: 1px solid #F1F5F9; }
        .bl-name { margin: 0; font-size: 0.9375rem; font-weight: 700; color: #0F172A; line-height: 1.3; }
        .bl-place { margin: 2px 0 0; font-size: 0.75rem; color: #64748B; }
        .bl-x { flex-shrink: 0; width: 32px; height: 32px; border-radius: 50%; border: none; background: #F1F5F9; color: #0F172A; display: grid; place-items: center; cursor: pointer; }
        .bl-x:hover { background: #E2E8F0; }
        .bl-scroll { flex: 1; overflow-y: auto; padding: 4px 16px 76px; overscroll-behavior: contain; }
        .bl-label { margin: 14px 0 8px; font-size: 0.75rem; font-weight: 700; color: #0F172A; text-transform: uppercase; letter-spacing: .04em; }
        .bl-label span { text-transform: none; letter-spacing: 0; font-weight: 500; color: #94A3B8; }
        .bl-street { border-radius: 12px; overflow: hidden; border: 1px solid #E2E8F0; }
        .bl-google { display: flex; align-items: center; gap: 12px; padding: 12px 14px; border-radius: 12px; background: #0F172A; color: #fff; text-decoration: none; transition: background .12s; }
        .bl-google:hover { background: #1E293B; }
        .bl-google span { flex: 1; display: flex; flex-direction: column; gap: 2px; }
        .bl-google b { font-size: 0.875rem; font-weight: 700; }
        .bl-google small { font-size: 0.75rem; color: #CBD5E1; }
        .bl-sv { margin: 10px 2px 0; font-size: 0.75rem; color: #475569; line-height: 1.5; }
        .bl-sv svg { vertical-align: -2px; margin-right: 5px; color: #64748B; }
        .bl-sv a { color: #1B4F8A; font-weight: 600; text-decoration: none; }
        .bl-sv a:hover { text-decoration: underline; }
        .bl-sv small { display: block; color: #94A3B8; font-size: 0.6875rem; margin-top: 2px; }
        .bl-more { margin-top: 10px; width: 100%; padding: 9px; border: 1px dashed #CBD5E1; border-radius: 10px; background: #fff; color: #334155; font: 600 0.8125rem/1.3 'Inter', sans-serif; cursor: pointer; }
        .bl-more span { font-weight: 500; color: #94A3B8; }
        .bl-more:hover { border-color: #94A3B8; background: #F8FAFC; }
        .bl-street { margin-top: 10px; }
        .bl-open { margin-top: 14px; width: 100%; padding: 11px; border: none; border-radius: 10px; background: #1B4F8A; color: #fff; font: 600 0.875rem/1 'Inter', sans-serif; cursor: pointer; }
        @media (max-width: 900px) {
          .bl { position: fixed; inset: 0; width: auto; border-radius: 0; z-index: 1000; animation-name: blUp; }
          @keyframes blUp { from { opacity: 0; transform: translateY(24px); } to { opacity: 1; transform: none; } }
        }
      `}</style>
    </div>
  );
}
