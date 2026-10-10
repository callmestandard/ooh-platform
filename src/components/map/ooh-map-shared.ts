/**
 * Shared constants, types and framework-free helpers for every map in the
 * app. All map rendering is consolidated on Mapbox GL JS (via
 * react-map-gl/mapbox — see ./engine.ts) using Mapbox vector styles, and the
 * same token powers the HTTP APIs (Search Box, Directions). See
 * src/components/map/OOHMap.tsx for the shared <Map> wrapper that every page
 * renders through.
 */

export const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || '';

export const LAGOS_CENTER = { longitude: 3.3792, latitude: 6.5244 };
export const NIGERIA_CENTER = { longitude: 8.6753, latitude: 9.0820 };

export const MAP_STYLES = {
  streets:   { label: 'Streets',   icon: '🗺️', url: 'mapbox://styles/mapbox/streets-v12' },
  dark:      { label: 'Dark',      icon: '🌙', url: 'mapbox://styles/mapbox/dark-v11' },
  satellite: { label: 'Satellite', icon: '🛰️', url: 'mapbox://styles/mapbox/satellite-streets-v12' },
} as const;

/**
 * Neutral, low-saturation basemap for the market-intelligence choropleth, so
 * the data carries the colour. Not in MAP_STYLES because it is not a style
 * the user toggles to — that map always uses it.
 */
export const MARKET_INTEL_STYLE_URL = 'mapbox://styles/mapbox/light-v11';

/** [[west, south], [east, north]] — the extent of the Nigeria boundary dataset. */
export const NIGERIA_BOUNDS: [[number, number], [number, number]] = [[2.66, 4.26], [14.69, 13.9]];

/** A bold fontstack that exists in every Mapbox style above — use for any symbol layer's `text-font`. */
export const MAP_LABEL_FONT = ['DIN Pro Bold', 'Arial Unicode MS Bold'];

/** [lng, lat] centers for flying the map to a named Nigerian city. */
export const CITY_CENTERS: Record<string, [number, number]> = {
  'Lagos': [3.3792, 6.5244],
  'Abuja': [7.4951, 9.0579],
  'Port Harcourt': [7.0498, 4.8156],
  'Kano': [8.5919, 12.0022],
  'Ibadan': [3.9470, 7.3775],
  'Benin City': [5.6037, 6.3350],
  'Enugu': [7.5464, 6.4584],
  'Aba': [7.3664, 5.1069],
  'Warri': [5.7500, 5.5167],
  'Onitsha': [6.7874, 6.1449],
  'Kaduna': [7.4165, 10.5105],
  'Jos': [8.8583, 9.8965],
  'Ilorin': [4.5426, 8.4966],
  'Calabar': [8.3220, 4.9517],
  'Akure': [5.1977, 7.2526],
  'Uyo': [7.9328, 5.0510],
  'Osogbo': [4.5573, 7.7712],
  'Owerri': [7.0330, 5.4836],
  'Maiduguri': [13.1500, 11.8333],
  'Zaria': [7.7000, 11.0667],
  'Abeokuta': [3.3619, 7.1475],
  'Asaba': [6.7353, 6.1952],
  'Umuahia': [7.4927, 5.5266],
  'Bauchi': [9.8442, 10.3158],
  'Sokoto': [5.2339, 13.0622],
  'Yola': [12.4954, 9.2035],
  'Makurdi': [8.5237, 7.7319],
  'Lokoja': [6.7384, 7.7963],
  'Lafia': [8.5219, 8.4939],
  'Gusau': [6.6599, 12.1649],
};

/** Case-insensitive lookup into CITY_CENTERS (briefs and filters don't always match the canonical casing). */
export function cityCenter(city: string | null | undefined): [number, number] | null {
  if (!city) return null;
  const key = Object.keys(CITY_CENTERS).find(k => k.toLowerCase() === city.trim().toLowerCase());
  return key ? CITY_CENTERS[key] : null;
}

export type MapStyleKey = keyof typeof MAP_STYLES;

/** The standardized status vocabulary used for color-coding board markers everywhere. */
export type BoardMapStatus = 'available' | 'booked' | 'unavailable' | 'decommissioned' | 'needs_replacement';

export const BOARD_STATUS_COLORS: Record<BoardMapStatus, string> = {
  available:         '#10B981',
  booked:            '#3B82F6',
  unavailable:       '#F59E0B',
  decommissioned:    '#94A3B8',
  needs_replacement: '#EF4444',
};

export const BOARD_STATUS_LABELS: Record<BoardMapStatus, string> = {
  available:         'Available',
  booked:            'Booked',
  unavailable:        'Unavailable',
  decommissioned:     'Decommissioned',
  needs_replacement:  'Needs replacement',
};

export function boardStatusColor(status: string | null | undefined): string {
  return BOARD_STATUS_COLORS[(status as BoardMapStatus)] || BOARD_STATUS_COLORS.available;
}

// ── Geocoding — Mapbox Search Box API v1 (full-Nigeria coverage), with a
//    Nominatim fallback when no token is configured. Extracted from the
//    boards-map page so every map can offer the same search bar. ───────────

export type GeocodeSuggestion = { place_name: string; lat: number; lng: number; mapbox_id?: string };

export function newGeocodeSession(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36);
}

export async function searchPlaces(query: string, sessionToken: string): Promise<GeocodeSuggestion[]> {
  if (query.length < 2) return [];
  if (MAPBOX_TOKEN) {
    const url = new URL('https://api.mapbox.com/search/searchbox/v1/suggest');
    url.searchParams.set('q', query);
    url.searchParams.set('access_token', MAPBOX_TOKEN);
    url.searchParams.set('session_token', sessionToken);
    url.searchParams.set('country', 'NG');
    url.searchParams.set('limit', '8');
    url.searchParams.set('language', 'en');
    url.searchParams.set('bbox', '2.676,3.917,14.678,13.886'); // Nigeria bounds
    const res = await fetch(url.toString());
    const data = await res.json();
    const suggestions: Array<{ name?: string; place_formatted?: string; mapbox_id?: string }> = data.suggestions || [];
    return suggestions.map(s => ({
      place_name: [s.name, s.place_formatted].filter(Boolean).join(', '),
      mapbox_id: s.mapbox_id,
      lat: 0,
      lng: 0,
    }));
  }
  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query + ', Nigeria')}&format=json&limit=8&addressdetails=1&countrycodes=ng`,
    { headers: { 'Accept-Language': 'en', 'User-Agent': 'OOH-Platform/1.0' } }
  );
  const data = await res.json();
  return (data as Array<{ display_name: string; lat: string; lon: string }>).map(r => ({
    place_name: r.display_name,
    lat: parseFloat(r.lat),
    lng: parseFloat(r.lon),
  }));
}

/** Resolves a Search Box suggestion's mapbox_id into real coordinates (required second call for that API). */
export async function retrievePlace(mapboxId: string, sessionToken: string): Promise<{ lat: number; lng: number } | null> {
  if (!MAPBOX_TOKEN) return null;
  const url = new URL(`https://api.mapbox.com/search/searchbox/v1/retrieve/${mapboxId}`);
  url.searchParams.set('access_token', MAPBOX_TOKEN);
  url.searchParams.set('session_token', sessionToken);
  const res = await fetch(url.toString());
  const data = await res.json();
  const feature = data.features?.[0];
  if (!feature) return null;
  const [lng, lat] = feature.geometry.coordinates as [number, number];
  return { lat, lng };
}

export type DrivingRoute = { distance: number; duration: number; geometry: GeoJSON.LineString };

export async function fetchDrivingRoute(points: [number, number][]): Promise<DrivingRoute | null> {
  if (points.length < 2 || !MAPBOX_TOKEN) return null;
  const waypoints = points.map(([lng, lat]) => `${lng},${lat}`).join(';');
  const res = await fetch(
    `https://api.mapbox.com/directions/v5/mapbox/driving/${waypoints}?geometries=geojson&overview=full&steps=false&access_token=${MAPBOX_TOKEN}`
  );
  const data = await res.json();
  const route = data.routes?.[0];
  if (!route) return null;
  return { distance: route.distance, duration: route.duration, geometry: route.geometry };
}

export function formatDistance(m: number) {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}

export function formatDuration(s: number) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m} min`;
}
