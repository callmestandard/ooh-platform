'use client';

import { useRef, useState } from 'react';
import { MAPBOX_TOKEN, newGeocodeSession, searchPlaces, retrievePlace, type GeocodeSuggestion } from './ooh-map-shared';

type Props = {
  placeholder?: string;
  width?: number;
  onResult: (result: { lat: number; lng: number; name: string }) => void;
};

/** A Mapbox Search Box–powered location search bar — shared UI so every map offers the same geocoding experience. */
export default function MapSearchBar({ placeholder = 'Search any location in Nigeria…', width = 300, onResult }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GeocodeSuggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const session = useRef(newGeocodeSession());

  async function handleChange(q: string) {
    setQuery(q);
    if (q.length < 2) { setResults([]); return; }
    setSearching(true);
    try {
      setResults(await searchPlaces(q, session.current));
    } catch { /* ignore network errors */ }
    setSearching(false);
  }

  async function selectResult(result: GeocodeSuggestion) {
    const name = result.place_name.split(',')[0];
    if (result.mapbox_id && MAPBOX_TOKEN) {
      const coords = await retrievePlace(result.mapbox_id, session.current);
      if (coords) {
        setQuery(name);
        setResults([]);
        onResult({ ...coords, name });
        session.current = newGeocodeSession();
        return;
      }
    }
    setQuery(name);
    setResults([]);
    onResult({ lat: result.lat, lng: result.lng, name });
  }

  function clear() {
    setQuery('');
    setResults([]);
  }

  return (
    <div style={{ width, fontFamily: "'Inter', sans-serif" }}>
      <div style={{ position: 'relative' }}>
        <svg style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}
          width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" strokeWidth="2.5">
          <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
        </svg>
        <input
          value={query}
          onChange={e => handleChange(e.target.value)}
          placeholder={placeholder}
          style={{
            width: '100%', boxSizing: 'border-box',
            background: 'rgba(255,255,255,0.97)', backdropFilter: 'blur(12px)',
            border: '1px solid rgba(0,0,0,0.1)', borderRadius: 10,
            padding: '9px 32px 9px 30px', color: '#0F172A',
            fontSize: '0.8125rem', outline: 'none',
            boxShadow: '0 4px 20px rgba(0,0,0,0.12)',
            fontFamily: 'inherit',
          }}
        />
        {searching && (
          <div style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', width: 13, height: 13, border: '1.5px solid #E2E8F0', borderTopColor: '#1B4F8A', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
        )}
        {query && !searching && (
          <button onClick={clear} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#94A3B8', cursor: 'pointer', padding: 2, fontSize: 13 }}>✕</button>
        )}
      </div>

      {results.length > 0 && (
        <div style={{ marginTop: 4, background: 'rgba(255,255,255,0.99)', border: '1px solid rgba(0,0,0,0.08)', borderRadius: 10, overflow: 'hidden', boxShadow: '0 12px 40px rgba(0,0,0,0.15)' }}>
          {results.map((r, i) => (
            <button key={i} onClick={() => selectResult(r)}
              style={{ display: 'flex', alignItems: 'flex-start', gap: 8, width: '100%', padding: '10px 12px', background: 'none', border: 'none', borderBottom: i < results.length - 1 ? '1px solid #F1F5F9' : 'none', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit' }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = '#F8FAFC'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'none'; }}>
              <svg width="11" height="14" viewBox="0 0 24 36" fill="#1B4F8A" style={{ flexShrink: 0, marginTop: 2 }}>
                <path d="M12 0C5.373 0 0 5.373 0 12c0 9 12 24 12 24s12-15 12-24C24 5.373 18.627 0 12 0z"/>
              </svg>
              <div style={{ minWidth: 0 }}>
                <p style={{ fontSize: '0.8125rem', color: '#0F172A', fontWeight: 600, margin: 0, lineHeight: 1.3 }}>
                  {r.place_name.split(',')[0]}
                </p>
                <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: '2px 0 0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {r.place_name.split(',').slice(1, 3).join(',').trim()}
                </p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
