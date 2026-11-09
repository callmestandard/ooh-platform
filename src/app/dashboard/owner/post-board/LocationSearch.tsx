'use client';

import { useEffect, useRef, useState } from 'react';
import { MAPBOX_TOKEN, CITY_CENTERS, newGeocodeSession, searchPlaces, retrievePlace } from '@/components/map/ooh-map-shared';

type Coords = { lat: number; lng: number };

function inRange({ lat, lng }: Coords): Coords | null {
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
}

/**
 * Reads GPS coordinates typed or pasted in the usual formats:
 *   6.4541, 3.4206 · 6.4541 3.4206 · 6.4541° N, 3.4206° E
 *   6°27'14.8"N 3°25'14.2"E · a Google Maps link (…/@6.4541,3.4206,17z or ?q=6.4541,3.4206)
 */
export function parseCoordinates(input: string): Coords | null {
  const s = input.trim().replace(/[′’]/g, "'").replace(/[″”]/g, '"');
  if (!s) return null;

  const link = s.match(/(?:@|[?&](?:q|query|ll)=)(-?\d{1,2}\.\d+),\s*(-?\d{1,3}\.\d+)/);
  if (link) return inRange({ lat: +link[1], lng: +link[2] });

  const dms = [...s.matchAll(/(\d{1,3})\s*°\s*(\d{1,2})\s*'\s*(\d{1,2}(?:\.\d+)?)\s*(?:"|'')?\s*([NSEW])/gi)];
  if (dms.length === 2) {
    const val = (m: RegExpMatchArray) => (+m[1] + +m[2] / 60 + +m[3] / 3600) * (/[SW]/i.test(m[4]) ? -1 : 1);
    const latM = dms.find(m => /[NS]/i.test(m[4])), lngM = dms.find(m => /[EW]/i.test(m[4]));
    if (latM && lngM) return inRange({ lat: val(latM), lng: val(lngM) });
  }

  const dec = s.match(/^(-?\d{1,2}(?:\.\d+)?)\s*°?\s*([NS])?\s*(?:,\s*|\s+)(-?\d{1,3}(?:\.\d+)?)\s*°?\s*([EW])?$/i);
  if (dec && (dec[1].includes('.') || dec[3].includes('.'))) {
    const lat = +dec[1] * (dec[2]?.toUpperCase() === 'S' ? -1 : 1);
    const lng = +dec[3] * (dec[4]?.toUpperCase() === 'W' ? -1 : 1);
    return inRange({ lat, lng });
  }
  return null;
}

const inNigeria = ({ lat, lng }: Coords) => lat >= 3.9 && lat <= 13.9 && lng >= 2.6 && lng <= 14.7;

type Place = { title: string; subtitle: string; lat?: number; lng?: number; mapboxId?: string };
type Option = { kind: 'coords'; coords: Coords } | { kind: 'place'; place: Place };

type PhotonFeature = {
  geometry: { coordinates: [number, number] };
  properties: { name?: string; street?: string; housenumber?: string; district?: string; city?: string; state?: string };
};

// Landmarks, malls, junctions and bus stops come from OpenStreetMap (Photon),
// which knows far more Nigerian places than Mapbox; Mapbox adds streets.
async function searchLandmarks(q: string, near?: [number, number]): Promise<Place[]> {
  const url = new URL('https://photon.komoot.io/api/');
  url.searchParams.set('q', q);
  url.searchParams.set('limit', '6');
  url.searchParams.set('lang', 'en');
  url.searchParams.set('bbox', '2.676,3.917,14.678,13.886'); // Nigeria
  if (near) { url.searchParams.set('lon', String(near[0])); url.searchParams.set('lat', String(near[1])); }
  const res = await fetch(url.toString());
  if (!res.ok) return [];
  const data = await res.json() as { features?: PhotonFeature[] };
  return (data.features ?? []).filter(f => f.properties.name).map(f => {
    const pr = f.properties;
    const street = [pr.housenumber, pr.street].filter(Boolean).join(' ');
    return {
      title: pr.name as string,
      subtitle: [street, pr.district, pr.city, pr.state].filter((x, i, a) => x && a.indexOf(x) === i && x !== pr.name).join(', '),
      lat: f.geometry.coordinates[1],
      lng: f.geometry.coordinates[0],
    };
  });
}

async function searchStreets(q: string, session: string): Promise<Place[]> {
  return (await searchPlaces(q, session)).map(r => ({
    title: r.place_name.split(',')[0],
    subtitle: r.place_name.split(',').slice(1, 3).join(',').trim(),
    ...(r.mapbox_id ? { mapboxId: r.mapbox_id } : { lat: r.lat, lng: r.lng }),
  }));
}

/** One box for a place name, a street, a landmark or GPS coordinates. */
export default function LocationSearch({ city, onPick }: { city?: string; onPick: (r: Coords & { name?: string }) => void }) {
  const [query, setQuery] = useState('');
  const [places, setPlaces] = useState<Place[]>([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [focused, setFocused] = useState(false);
  const [note, setNote] = useState('');
  const session = useRef(newGeocodeSession());
  const latest = useRef(0);

  const coords = parseCoordinates(query);
  const options: Option[] = coords ? [{ kind: 'coords', coords }] : places.map(place => ({ kind: 'place' as const, place }));

  // Search places as the user types (debounced; stale replies are ignored).
  useEffect(() => {
    if (coords || query.trim().length < 2) { setPlaces([]); setSearching(false); return; }
    const id = ++latest.current;
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const q = query.trim();
        const [landmarks, streets] = await Promise.all([
          searchLandmarks(q, city ? CITY_CENTERS[city] : undefined).catch(() => [] as Place[]),
          searchStreets(q, session.current).catch(() => [] as Place[]),
        ]);
        const seen = new Set<string>();
        const merged = [...landmarks, ...streets].filter(pl => {
          const key = `${pl.title}|${pl.subtitle.split(',')[0]}`.toLowerCase();
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        }).slice(0, 8);
        if (id === latest.current) setPlaces(merged);
      } catch { if (id === latest.current) setPlaces([]); }
      if (id === latest.current) setSearching(false);
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  useEffect(() => { setActive(0); }, [query, places.length]);

  async function choose(o: Option) {
    setOpen(false);
    if (o.kind === 'coords') {
      onPick(o.coords);
      setNote(inNigeria(o.coords) ? '' : 'These coordinates are outside Nigeria. Check the numbers are latitude first, then longitude.');
      return;
    }
    const name = o.place.title;
    let c: Coords | null = o.place.lat !== undefined && o.place.lng !== undefined
      ? { lat: o.place.lat, lng: o.place.lng }
      : o.place.mapboxId && MAPBOX_TOKEN ? await retrievePlace(o.place.mapboxId, session.current) : null;
    if (o.place.mapboxId) session.current = newGeocodeSession();
    if (!c) { setNote('Could not find that place on the map. Try another search, or tap the map.'); return; }
    c = { lat: +c.lat.toFixed(6), lng: +c.lng.toFixed(6) };
    setQuery(name);
    setNote('');
    onPick({ ...c, name });
  }

  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || options.length === 0) { if (e.key === 'Enter') e.preventDefault(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => (a + 1) % options.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => (a - 1 + options.length) % options.length); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(options[active]); }
    else if (e.key === 'Escape') setOpen(false);
  }

  const showList = open && query.trim().length >= 2 && (options.length > 0 || !searching);

  return (
    <div data-location-search style={{ position: 'relative' }}>
      <div style={{ display: 'flex', alignItems: 'center', border: `1px solid ${focused ? '#7C3AED' : '#E2E8F0'}`, borderRadius: 8, background: '#fff', transition: 'border-color 0.15s' }}>
        <svg style={{ marginLeft: 12, flexShrink: 0 }} width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" strokeWidth="2.5" strokeLinecap="round">
          <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
        </svg>
        <input
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true); setNote(''); }}
          onFocus={() => { setFocused(true); setOpen(true); }}
          onBlur={() => { setFocused(false); setTimeout(() => setOpen(false), 150); }}
          onKeyDown={onKey}
          placeholder="Search a place or landmark, or paste GPS e.g. 6.4541, 3.4206"
          aria-label="Search a place or enter GPS coordinates"
          autoComplete="off"
          style={{ flex: 1, padding: '10px 10px', border: 'none', outline: 'none', fontSize: '0.9375rem', fontFamily: 'inherit', color: '#0F172A', background: 'transparent', minWidth: 0 }}
        />
        {searching && <div style={{ marginRight: 12, width: 14, height: 14, border: '2px solid #E2E8F0', borderTopColor: '#7C3AED', borderRadius: '50%', animation: 'spin 0.7s linear infinite', flexShrink: 0 }} />}
        {query && !searching && (
          <button type="button" onClick={() => { setQuery(''); setPlaces([]); setNote(''); }} aria-label="Clear search"
            style={{ marginRight: 6, background: 'none', border: 'none', color: '#94A3B8', cursor: 'pointer', padding: '4px 6px', fontSize: 14, lineHeight: 1 }}>✕</button>
        )}
      </div>

      {showList && (
        <div role="listbox" style={{ position: 'absolute', zIndex: 20, left: 0, right: 0, top: 'calc(100% + 4px)', background: '#fff', border: '1px solid #E2E8F0', borderRadius: 10, overflow: 'hidden', boxShadow: '0 12px 32px rgba(15,23,42,0.14)' }}>
          {options.length === 0 ? (
            <p style={{ margin: 0, padding: '12px 14px', fontSize: '0.8125rem', color: '#64748B' }}>
              No places found. Try a nearby landmark, or paste the GPS coordinates.
            </p>
          ) : options.map((o, i) => (
            <button key={i} type="button" role="option" aria-selected={i === active}
              onMouseDown={e => e.preventDefault()} onClick={() => choose(o)} onMouseEnter={() => setActive(i)}
              style={{ display: 'flex', alignItems: 'flex-start', gap: 10, width: '100%', padding: '10px 14px', background: i === active ? '#F5F3FF' : '#fff', border: 'none', borderBottom: i < options.length - 1 ? '1px solid #F1F5F9' : 'none', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit' }}>
              {o.kind === 'coords' ? (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#7C3AED" strokeWidth="2.5" strokeLinecap="round" style={{ flexShrink: 0, marginTop: 2 }}>
                    <circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
                  </svg>
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, color: '#0F172A' }}>Pin these GPS coordinates</span>
                    <span style={{ display: 'block', fontSize: '0.75rem', color: '#64748B', fontFamily: 'monospace', marginTop: 2 }}>{o.coords.lat.toFixed(6)}, {o.coords.lng.toFixed(6)}</span>
                  </span>
                </>
              ) : (
                <>
                  <svg width="11" height="14" viewBox="0 0 24 36" fill="#7C3AED" style={{ flexShrink: 0, marginTop: 2 }}>
                    <path d="M12 0C5.373 0 0 5.373 0 12c0 9 12 24 12 24s12-15 12-24C24 5.373 18.627 0 12 0z" />
                  </svg>
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, color: '#0F172A', lineHeight: 1.3 }}>{o.place.title}</span>
                    <span style={{ display: 'block', fontSize: '0.6875rem', color: '#94A3B8', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{o.place.subtitle}</span>
                  </span>
                </>
              )}
            </button>
          ))}
        </div>
      )}
      {note && <p style={{ fontSize: '0.6875rem', color: '#B45309', margin: '4px 0 0' }}>{note}</p>}
    </div>
  );
}
