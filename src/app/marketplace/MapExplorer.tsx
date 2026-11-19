'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import dynamic from 'next/dynamic';
import SaveButton from '@/components/shortlist/SaveButton';
import BoardLook from './BoardLook';
import type { MapBoard, MapView } from './MarketplaceMap';

export const loadMap = () => import('./MarketplaceMap');

const MarketplaceMap = dynamic(loadMap, {
  ssr: false,
  loading: () => <div className="mx-map-loading"><span /></div>,
});

/** A board ready to show: map fields plus what the card needs. */
export type ExplorerBoard = MapBoard & { href: string; place: string; spec: string; priceText: string | null };

type Camera = { lng: number; lat: number; zoom: number };

type Props = {
  /** Every board the filters leave, with or without a pin. */
  boards: ExplorerBoard[];
  /** Changes when the filters change, so the map refits. */
  filterKey: string;
  onOpen: (id: string) => void;
  onGrid: () => void;
  initialCamera: Camera | null;
  onCamera: (c: Camera) => void;
};

const PHONE = '(max-width: 900px)';
function usePhone() {
  return useSyncExternalStore(
    cb => { const m = window.matchMedia(PHONE); m.addEventListener('change', cb); return () => m.removeEventListener('change', cb); },
    () => window.matchMedia(PHONE).matches,
    () => false,
  );
}

const inside = (b: MapBoard, [w, s, e, n]: [number, number, number, number]) =>
  b.latitude >= s && b.latitude <= n && b.longitude >= w && b.longitude <= e;

export default function MapExplorer({ boards, filterKey, onOpen, onGrid, initialCamera, onCamera }: Props) {
  const phone = usePhone();
  const pinned = useMemo(() => boards.filter(b => Number.isFinite(b.latitude) && Number.isFinite(b.longitude)), [boards]);
  const unpinned = boards.length - pinned.length;
  const pinnedById = useMemo(() => new Map(pinned.map(b => [b.id, b])), [pinned]);

  const [bounds, setBounds] = useState<[number, number, number, number] | null>(null);
  const [follow, setFollow] = useState(true);
  const [hovered, setHovered] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [refit, setRefit] = useState(0);
  const [lookId, setLookId] = useState<string | null>(null);

  const shown = useMemo(
    () => (follow && bounds ? pinned.filter(b => inside(b, bounds)) : pinned),
    [pinned, bounds, follow],
  );

  const onView = useCallback((v: MapView) => {
    setBounds(v.bounds);
    onCamera({ lng: v.lng, lat: v.lat, zoom: v.zoom });
  }, [onCamera]);

  // A new filter clears the selection.
  const [seenKey, setSeenKey] = useState(filterKey);
  if (seenKey !== filterKey) { setSeenKey(filterKey); setSelected(null); setHovered(null); setLookId(null); }

  // Selecting a pin brings its card into view (list on desktop, card row on phones).
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!selected || !listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(`[data-board="${selected}"]`);
    if (!el) return;
    const box = listRef.current;
    if (phone) box.scrollTo({ left: el.offsetLeft - (box.clientWidth - el.offsetWidth) / 2, behavior: 'smooth' });
    else box.scrollTo({ top: el.offsetTop - 12, behavior: 'smooth' });
  }, [selected, phone]);

  // Swiping the phone card row highlights the board in the middle.
  const swipeTimer = useRef<number | undefined>(undefined);
  function onRowScroll() {
    if (!phone || !listRef.current) return;
    window.clearTimeout(swipeTimer.current);
    swipeTimer.current = window.setTimeout(() => {
      const box = listRef.current!;
      const mid = box.scrollLeft + box.clientWidth / 2;
      let best: string | null = null, bestD = Infinity;
      box.querySelectorAll<HTMLElement>('[data-board]').forEach(el => {
        const d = Math.abs(el.offsetLeft + el.offsetWidth / 2 - mid);
        if (d < bestD) { bestD = d; best = el.dataset.board ?? null; }
      });
      if (best) setSelected(best);
    }, 90);
  }

  const card = (b: ExplorerBoard) => {
    const on = b.id === selected || b.id === hovered;
    return (
      <a
        key={b.id}
        href={b.href}
        data-board={b.id}
        className={`mx-card${on ? ' on' : ''}`}
        onMouseEnter={() => setHovered(b.id)}
        onMouseLeave={() => setHovered(h => (h === b.id ? null : h))}
        onFocus={() => setHovered(b.id)}
        onBlur={() => setHovered(h => (h === b.id ? null : h))}
        onClick={e => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; e.preventDefault(); onOpen(b.id); }}
      >
        <span className="mx-photo">
          {b.photo_urls?.[0]
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={b.photo_urls[0]} alt="" loading="lazy" decoding="async" width={128} height={96} />
            : <span className="mx-nophoto">No photo</span>}
        </span>
        <span className="mx-body">
          <span className="mx-name">{b.name}</span>
          <span className="mx-place">{b.place}</span>
          <span className="mx-spec">{b.spec}</span>
          <span className="mx-foot">
            {b.priceText
              ? <span className="mx-price">{b.priceText}<small> /mo{b.guide ? ' · guide' : ''}</small></span>
              : <span className="mx-price none">Price on request</span>}
          </span>
        </span>
        <span className="mx-save" onClick={e => { e.preventDefault(); e.stopPropagation(); }}><SaveButton boardId={b.id} name={b.name} /></span>
        {Number.isFinite(b.latitude) && (
          <span className="mx-street" role="button" tabIndex={0} title="See the site: photos and Google Street View" aria-label={`See the site: ${b.name}`}
            onClick={e => { e.preventDefault(); e.stopPropagation(); setSelected(b.id); setLookId(b.id); }}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); setSelected(b.id); setLookId(b.id); } }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="5" r="2.5"/><path d="M9.5 21v-6l-2-1V10a2 2 0 0 1 2-2h5a2 2 0 0 1 2 2v4l-2 1v6"/></svg>
          </span>
        )}
      </a>
    );
  };

  const fitPadding = useMemo(() => (phone ? { top: 70, bottom: 170, left: 30, right: 30 } : { top: 60, bottom: 60, left: 60, right: 60 }), [phone]);

  return (
    <div className="mx" data-explorer>
      <style>{CSS}</style>

      {!phone && (
        <aside className="mx-side" aria-label="Boards in this area">
          <div className="mx-head">
            <p className="mx-count" data-in-view>
              {follow ? `${shown.length} board${shown.length !== 1 ? 's' : ''} in this area` : `${shown.length} board${shown.length !== 1 ? 's' : ''} on the map`}
            </p>
            <label className="mx-follow">
              <input type="checkbox" checked={follow} onChange={e => setFollow(e.target.checked)} />
              Update as I move the map
            </label>
          </div>
          <div className="mx-list" ref={listRef}>
            {shown.map(card)}
            {shown.length === 0 && (
              <div className="mx-empty">
                <p>No boards in this part of the map.</p>
                <button type="button" onClick={() => setRefit(n => n + 1)}>Show all {pinned.length} boards</button>
              </div>
            )}
            {unpinned > 0 && (
              <p className="mx-unpinned">
                {unpinned} more board{unpinned !== 1 ? 's' : ''} {unpinned !== 1 ? "aren't" : "isn't"} on the map yet.{' '}
                <button type="button" onClick={onGrid}>See all in the grid</button>
              </p>
            )}
          </div>
        </aside>
      )}

      <div className="mx-map">
        <MarketplaceMap
          boards={pinned}
          onOpen={onOpen}
          hoveredId={hovered}
          onHover={setHovered}
          selectedId={selected}
          onSelect={setSelected}
          onView={onView}
          initialCamera={initialCamera}
          fitKey={`${filterKey}#${refit}`}
          trimOutliers
          cooperative={false}
          preview={!phone && !lookId}
          focus={!phone && lookId ? { id: lookId, padRight: 470 } : null}
          explorer
          fitPadding={fitPadding}
        />

        {lookId && pinnedById.get(lookId) && (
          <BoardLook board={pinnedById.get(lookId)!} onClose={() => setLookId(null)} onOpen={id => { setLookId(null); onOpen(id); }} />
        )}

        {phone && !lookId && (
          <div className="mx-row-wrap">
            {shown.length > 0 ? (
              <div className="mx-row" ref={listRef} onScroll={onRowScroll} data-card-row>
                {shown.map(card)}
              </div>
            ) : (
              <button type="button" className="mx-row-empty" onClick={() => setRefit(n => n + 1)}>
                No boards here · Show all {pinned.length}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const CSS = `
.mx { flex: 1; min-height: 0; display: grid; grid-template-columns: 400px 1fr; border-top: 1px solid #E8EDF2; background: #fff; }
.mx-side { display: flex; flex-direction: column; min-height: 0; border-right: 1px solid #E8EDF2; background: #fff; }
.mx-head { padding: 12px 16px 10px; border-bottom: 1px solid #F1F5F9; display: flex; flex-direction: column; gap: 6px; }
.mx-count { margin: 0; font-size: 0.9375rem; font-weight: 700; color: #0F172A; }
.mx-follow { display: inline-flex; align-items: center; gap: 7px; font-size: 0.75rem; color: #64748B; cursor: pointer; user-select: none; width: fit-content; }
.mx-follow input { accent-color: #1B4F8A; width: 14px; height: 14px; margin: 0; }
.mx-list { flex: 1; overflow-y: auto; padding: 10px 12px 24px; display: flex; flex-direction: column; gap: 8px; position: relative; overscroll-behavior: contain; }
.mx-card { position: relative; display: flex; gap: 12px; padding: 8px; border-radius: 14px; text-decoration: none; color: inherit; border: 1px solid transparent; transition: background .12s, border-color .12s, box-shadow .12s; }
.mx-card:hover, .mx-card.on { background: #F8FAFC; border-color: #E2E8F0; }
.mx-card.on { box-shadow: inset 3px 0 0 #1B4F8A; }
.mx-card:focus-visible { outline: 2px solid #1B4F8A; outline-offset: 1px; }
.mx-photo { width: 128px; height: 96px; flex-shrink: 0; border-radius: 10px; overflow: hidden; background: #F1F5F9; display: block; }
.mx-photo img { width: 100%; height: 100%; object-fit: cover; display: block; }
.mx-nophoto { display: grid; place-items: center; height: 100%; font-size: 0.6875rem; color: #94A3B8; }
.mx-body { min-width: 0; flex: 1; display: flex; flex-direction: column; padding: 2px 26px 0 0; }
.mx-name { font-size: 0.875rem; font-weight: 700; color: #0F172A; line-height: 1.3; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.mx-place { font-size: 0.75rem; color: #64748B; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mx-spec { font-size: 0.6875rem; color: #94A3B8; margin-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mx-foot { margin-top: auto; padding-top: 6px; display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.mx-price { font-size: 0.9375rem; font-weight: 800; color: #0F172A; letter-spacing: -0.02em; white-space: nowrap; }
.mx-price small { font-size: 0.6875rem; font-weight: 500; color: #94A3B8; letter-spacing: 0; }
.mx-price.none { font-size: 0.8125rem; font-weight: 600; color: #64748B; letter-spacing: 0; }
.mx-save { position: absolute; top: 6px; right: 6px; transform: scale(.82); transform-origin: top right; }
.mx-street { position: absolute; right: 8px; bottom: 8px; width: 30px; height: 30px; border-radius: 50%; display: grid; place-items: center; color: #334155; background: #fff; border: 1px solid #E2E8F0; cursor: pointer; transition: background .12s, color .12s, border-color .12s; }
.mx-street:hover, .mx-street:focus-visible { background: #0F172A; color: #fff; border-color: #0F172A; outline: none; }
.mx-empty { text-align: center; padding: 40px 16px; color: #64748B; font-size: 0.875rem; }
.mx-empty p { margin: 0 0 12px; }
.mx-empty button, .mx-unpinned button { border: none; background: none; color: #1B4F8A; font: inherit; font-weight: 600; cursor: pointer; padding: 0; }
.mx-empty button { background: #1B4F8A; color: #fff; padding: 8px 14px; border-radius: 9px; }
.mx-unpinned { margin: 8px 4px 0; font-size: 0.75rem; color: #64748B; line-height: 1.5; }
.mx-map { position: relative; min-width: 0; min-height: 0; }
.mx-map-loading { height: 100%; display: grid; place-items: center; background: #F1F5F9; }
.mx-map-loading span { width: 24px; height: 24px; border: 2px solid #E2E8F0; border-top-color: #1B4F8A; border-radius: 50%; animation: spin .7s linear infinite; }
@media (max-width: 900px) {
  .mx { grid-template-columns: 1fr; border-top: none; }
  .mx-row-wrap { position: absolute; left: 0; right: 0; bottom: 30px; z-index: 6; pointer-events: none; }
  .mx-row { display: flex; gap: 10px; overflow-x: auto; scroll-snap-type: x mandatory; padding: 4px 16px; scrollbar-width: none; pointer-events: auto; overscroll-behavior-x: contain; }
  .mx-row::-webkit-scrollbar { display: none; }
  .mx-row .mx-card { flex: 0 0 min(84vw, 340px); scroll-snap-align: center; background: #fff; border: 1px solid #E2E8F0; box-shadow: 0 10px 28px -12px rgba(15,23,42,.35); padding: 7px; gap: 10px; }
  .mx-row .mx-card.on { border-color: #1B4F8A; box-shadow: 0 0 0 1px #1B4F8A, 0 10px 28px -12px rgba(15,23,42,.4); }
  .mx-row .mx-photo { width: 96px; height: 84px; }
  .mx-row-empty { pointer-events: auto; display: block; margin: 0 auto; border: none; background: #0F172A; color: #fff; font: 600 13px/1 'Inter', sans-serif; padding: 11px 16px; border-radius: 999px; box-shadow: 0 8px 22px -8px rgba(15,23,42,.5); cursor: pointer; }
}
`;
