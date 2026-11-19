'use client';

import { useEffect, useState } from 'react';
import {
  PLACE_META, PLACE_ORDER, compact, intelMatchesPin, loadDatasets, loadIntelFor, placeLabel,
  type BoardIntel, type GeoDataset, type PlaceCategory,
} from '@/lib/intel';
import { trackMap } from '@/lib/map-track';

export function PlaceIcon({ category, size = 18 }: { category: PlaceCategory; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={PLACE_META[category].icon} />
    </svg>
  );
}

const AGE_LABEL: Record<string, string> = { '0_14': 'Under 15', '15_24': '15–24', '25_34': '25–34', '35_44': '35–44', '45_plus': '45+', '35_plus': '35+' };

type Props = {
  boardId: string;
  lat: number | null;
  lng: number | null;
  /** Side panel on the map: fewer rows, no age split. */
  compactView?: boolean;
  /** Where this is shown, for usage counts. */
  where?: string;
};

/** "Around this board": residents nearby, mapped places, and where the numbers come from. */
export default function AroundBoard({ boardId, lat, lng, compactView, where = 'board_page' }: Props) {
  const [intel, setIntel] = useState<BoardIntel | null | undefined>(undefined);
  const [sources, setSources] = useState<Map<string, GeoDataset> | null>(null);
  const [radius, setRadius] = useState<'500m' | '1km'>('1km');
  const [showSources, setShowSources] = useState(false);
  const [showAge, setShowAge] = useState(false);

  useEffect(() => {
    let live = true;
    if (lat == null || lng == null) return;
    loadIntelFor(boardId).then(r => { if (live) setIntel(r); });
    trackMap('intel_open', where, boardId);
    return () => { live = false; };
  }, [boardId, lat, lng, where]);

  useEffect(() => {
    if (showSources && !sources) loadDatasets().then(setSources);
  }, [showSources, sources]);

  const hasPin = lat != null && lng != null;
  if (!hasPin) {
    return (
      <div className="ai ai-empty" data-around-board>
        <Style />
        <p>Details about the area appear once this board&apos;s map location is added.</p>
      </div>
    );
  }
  if (intel === undefined) return <div className="ai ai-loading" aria-busy="true"><Style /><span /><span /><span /></div>;
  if (intel === null) {
    return (
      <div className="ai ai-empty" data-around-board>
        <Style />
        <p>Area details for this board are not yet available.</p>
      </div>
    );
  }

  const fresh = intelMatchesPin(intel, lat, lng);
  const rings: { label: string; n: number | null }[] = [
    { label: '250 m', n: intel.pop_250m }, { label: '500 m', n: intel.pop_500m },
    { label: '1 km', n: intel.pop_1km }, { label: '2 km', n: intel.pop_2km },
  ].filter(r => !compactView || r.label !== '250 m');
  const maxRing = Math.max(1, ...rings.map(r => r.n ?? 0));
  const places = radius === '500m' ? intel.places_500m : intel.places_1km;
  const placeRows = PLACE_ORDER.filter(c => (places?.[c] ?? 0) > 0);
  const shownPlaces = placeRows.slice(0, compactView ? 4 : 8);
  const age = intel.age_1km ? Object.entries(intel.age_1km).filter(([k]) => AGE_LABEL[k]) : [];
  const ageTotal = age.reduce((a, [, n]) => a + n, 0);
  const usedIds = [intel.population_dataset_id, intel.population_method === 'raster_100m' ? 'worldpop_agesex_2020_constrained' : null, intel.places_dataset_id]
    .filter((x, i, a): x is string => !!x && a.indexOf(x) === i);

  return (
    <div className={`ai${compactView ? ' ai-compact' : ''}`} data-around-board>
      <Style />
      {!fresh && <p className="ai-note">This board&apos;s pin moved recently, so these figures may be out of date.</p>}

      {/* Residents */}
      <div className="ai-block" data-intel-population>
        <div className="ai-head">
          <p className="ai-title">Estimated residents</p>
          <p className="ai-sub">People living nearby, not passing traffic</p>
        </div>
        {intel.pop_1km == null ? (
          <p className="ai-na">Not yet available</p>
        ) : (
          <div className="ai-rings">
            {rings.map(r => (
              <div key={r.label} className="ai-ring">
                <span className="ai-ring-r">{r.label}</span>
                <span className="ai-bar"><i style={{ width: r.n == null ? 0 : `${Math.max(2, (r.n / maxRing) * 100)}%` }} /></span>
                <span className="ai-ring-n">{r.n == null ? <small>n/a</small> : compact(r.n)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Places */}
      <div className="ai-block" data-intel-places>
        <div className="ai-head ai-head-row">
          <p className="ai-title">Nearby places</p>
          <div className="ai-seg" role="group" aria-label="Distance">
            {(['500m', '1km'] as const).map(r => (
              <button key={r} type="button" aria-pressed={radius === r} className={radius === r ? 'on' : ''} onClick={() => { setRadius(r); trackMap('intel_detail', `places_${r}`, boardId); }}>
                {r === '500m' ? '500 m' : '1 km'}
              </button>
            ))}
          </div>
        </div>
        {places == null ? (
          <p className="ai-na">Not yet available</p>
        ) : shownPlaces.length === 0 ? (
          <p className="ai-na">No places mapped within {radius === '500m' ? '500 m' : '1 km'} yet</p>
        ) : (
          <div className="ai-places">
            {shownPlaces.map(c => (
              <div key={c} className="ai-place" title={`${places[c]} ${placeLabel(c, places[c]!)} within ${radius === '500m' ? '500 m' : '1 km'}`}>
                <span className="ai-ico"><PlaceIcon category={c} /></span>
                <b>{places[c]}</b>
                <span>{placeLabel(c, places[c]!)}</span>
              </div>
            ))}
          </div>
        )}
        {placeRows.length > shownPlaces.length && <p className="ai-more">+ {placeRows.slice(shownPlaces.length).map(c => `${places![c]} ${placeLabel(c, places![c]!)}`).join(', ')}</p>}
      </div>

      {!compactView && (
        <>
          {/* Traffic: shown honestly as missing until a source is connected */}
          <div className="ai-block ai-inline" data-intel-traffic>
            <p className="ai-title">Traffic</p>
            {intel.traffic_level ? <p className="ai-val">{intel.traffic_level.replace('_', ' ')}</p> : <p className="ai-na">Not available yet</p>}
          </div>

          {age.length > 0 && ageTotal > 0 && (
            <div className="ai-block">
              <button type="button" className="ai-toggle" aria-expanded={showAge} onClick={() => { setShowAge(s => !s); trackMap('intel_detail', 'age', boardId); }}>
                Age of residents within 1 km <Chevron open={showAge} />
              </button>
              {showAge && (
                <div className="ai-rings" style={{ marginTop: 10 }} data-intel-age>
                  {age.map(([k, n]) => (
                    <div key={k} className="ai-ring">
                      <span className="ai-ring-r">{AGE_LABEL[k]}</span>
                      <span className="ai-bar"><i style={{ width: `${(n / ageTotal) * 100}%` }} /></span>
                      <span className="ai-ring-n">{Math.round((n / ageTotal) * 100)}%</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      <button type="button" className="ai-toggle ai-src-toggle" aria-expanded={showSources} onClick={() => { setShowSources(s => !s); trackMap('intel_detail', 'sources', boardId); }} data-intel-sources>
        About this data <Chevron open={showSources} />
      </button>
      {showSources && (
        <div className="ai-sources">
          {!sources ? <p className="ai-na">Loading…</p> : usedIds.map(id => {
            const d = sources.get(id);
            if (!d) return null;
            return (
              <div key={id} className="ai-source">
                <p className="ai-src-name">{d.name}</p>
                <p className="ai-src-meta">
                  {d.publisher}{d.reference_year ? ` · ${d.reference_year}` : ''}{d.licence ? ' · ' : ''}
                  {d.licence && (d.licence_url ? <a href={d.licence_url} target="_blank" rel="noopener noreferrer">{d.licence}</a> : d.licence)}
                  {d.retrieved_on ? ` · retrieved ${d.retrieved_on}` : ''}
                </p>
                {d.method_summary && <p className="ai-src-text"><b>Method.</b> {d.method_summary}</p>}
                {d.known_limitations && <p className="ai-src-text"><b>Limits.</b> {d.known_limitations}</p>}
              </div>
            );
          })}
          {intel.population_method === 'h3_r9' && <p className="ai-src-text">This board was pinned recently: its 1 km and 2 km figures come from 350 m cells until the next full update, and 250 m / 500 m are not calculated yet.</p>}
          <p className="ai-src-text">Traffic: no traffic data source is connected yet. Updated {new Date(intel.computed_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}.</p>
        </div>
      )}
    </div>
  );
}

function Chevron({ open }: { open: boolean }) {
  return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ transform: open ? 'rotate(180deg)' : undefined, transition: 'transform .15s' }}><path d="m6 9 6 6 6-6" /></svg>;
}

function Style() {
  return (
    <style>{`
      .ai { display: flex; flex-direction: column; gap: 12px; font-family: inherit; }
      .ai-block { border: 1px solid #E8EDF2; border-radius: 14px; padding: 14px 16px; background: #fff; }
      .ai-compact .ai-block { padding: 12px 13px; border-radius: 12px; }
      .ai-head { margin-bottom: 10px; }
      .ai-head-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
      .ai-title { margin: 0; font-size: 0.8125rem; font-weight: 700; color: #0F172A; }
      .ai-sub { margin: 2px 0 0; font-size: 0.75rem; color: #64748B; }
      .ai-na { margin: 0; font-size: 0.8125rem; color: #94A3B8; }
      .ai-val { margin: 0; font-size: 0.875rem; font-weight: 600; color: #0F172A; text-transform: capitalize; }
      .ai-inline { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding-top: 11px; padding-bottom: 11px; }
      .ai-note { margin: 0; padding: 8px 12px; border-radius: 10px; background: #FFFBEB; color: #92400E; font-size: 0.75rem; }
      .ai-rings { display: grid; gap: 7px; }
      .ai-ring { display: grid; grid-template-columns: 58px 1fr 52px; align-items: center; gap: 10px; }
      .ai-ring-r { font-size: 0.75rem; color: #64748B; font-variant-numeric: tabular-nums; }
      .ai-bar { height: 8px; border-radius: 4px; background: #F1F5F9; overflow: hidden; }
      .ai-bar i { display: block; height: 100%; border-radius: 4px; background: #1B4F8A; opacity: .85; }
      .ai-ring-n { text-align: right; font-size: 0.9375rem; font-weight: 700; color: #0F172A; font-variant-numeric: tabular-nums; letter-spacing: -0.01em; }
      .ai-ring-n small { font-size: 0.6875rem; font-weight: 500; color: #94A3B8; }
      .ai-seg { display: inline-flex; padding: 2px; border-radius: 8px; background: #F1F5F9; }
      .ai-seg button { border: none; background: none; font-size: 0.6875rem; font-weight: 600; line-height: 1; font-family: inherit; color: #64748B; padding: 5px 9px; border-radius: 6px; cursor: pointer; }
      .ai-seg button.on { background: #fff; color: #0F172A; box-shadow: 0 1px 2px rgba(15,23,42,.12); }
      .ai-places { display: grid; grid-template-columns: repeat(auto-fill, minmax(104px, 1fr)); gap: 8px; }
      .ai-compact .ai-places { grid-template-columns: repeat(2, 1fr); }
      .ai-place { display: flex; flex-direction: column; gap: 1px; padding: 10px 11px; border-radius: 11px; background: #F8FAFC; min-width: 0; }
      .ai-ico { color: #475569; margin-bottom: 4px; display: inline-flex; }
      .ai-place b { font-size: 1.125rem; font-weight: 800; color: #0F172A; letter-spacing: -0.02em; line-height: 1.1; }
      .ai-place span:last-child { font-size: 0.6875rem; color: #64748B; line-height: 1.3; }
      .ai-more { margin: 8px 0 0; font-size: 0.6875rem; color: #64748B; line-height: 1.5; }
      .ai-toggle { all: unset; box-sizing: border-box; display: inline-flex; align-items: center; gap: 6px; font-size: 0.8125rem; font-weight: 600; color: #0F172A; cursor: pointer; }
      .ai-toggle:focus-visible { outline: 2px solid #1B4F8A; outline-offset: 2px; border-radius: 4px; }
      .ai-src-toggle { font-size: 0.75rem; color: #1B4F8A; padding: 0 2px; }
      .ai-sources { display: grid; gap: 10px; padding: 12px 14px; border-radius: 12px; background: #F8FAFC; }
      .ai-src-name { margin: 0; font-size: 0.75rem; font-weight: 700; color: #0F172A; }
      .ai-src-meta { margin: 1px 0 4px; font-size: 0.6875rem; color: #64748B; }
      .ai-src-meta a { color: #1B4F8A; }
      .ai-src-text { margin: 2px 0 0; font-size: 0.6875rem; color: #475569; line-height: 1.55; }
      .ai-empty p { margin: 0; padding: 14px 16px; border: 1px dashed #CBD5E1; border-radius: 14px; font-size: 0.8125rem; color: #64748B; }
      .ai-loading { gap: 8px; }
      .ai-loading span { display: block; height: 54px; border-radius: 14px; background: linear-gradient(90deg,#F1F5F9,#F8FAFC,#F1F5F9); background-size: 200% 100%; animation: aiPulse 1.2s ease-in-out infinite; }
      @keyframes aiPulse { 0% { background-position: 0 0; } 100% { background-position: -200% 0; } }
    `}</style>
  );
}
