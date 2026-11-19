/**
 * Board intelligence (migration 062): what is around each board.
 *
 * Population = modelled RESIDENTS (WorldPop), never traffic or impressions.
 * Places = OpenStreetMap, lower bounds. NULL always means "not available".
 * The rows are prepared offline (scripts/intel/build.mjs) and only read here.
 */
import { supabase } from './supabase';

export type PlaceCategory =
  | 'bank' | 'mall' | 'market' | 'supermarket' | 'restaurant' | 'hotel' | 'office'
  | 'fuel' | 'school' | 'university' | 'health' | 'transport' | 'entertainment';

export type PlaceCounts = Partial<Record<PlaceCategory, number>>;

export type BoardIntel = {
  board_id: string;
  latitude: number;
  longitude: number;
  pop_250m: number | null;
  pop_500m: number | null;
  pop_1km: number | null;
  pop_2km: number | null;
  age_1km: Record<string, number> | null;
  population_method: 'raster_100m' | 'h3_r9' | null;
  population_dataset_id: string | null;
  population_at: string | null;
  places_500m: PlaceCounts | null;
  places_1km: PlaceCounts | null;
  places_dataset_id: string | null;
  places_at: string | null;
  buildings_500m: number | null;
  buildings_1km: number | null;
  road_class: string | null;
  traffic_level: 'low' | 'medium' | 'high' | 'very_high' | null;
  traffic_dataset_id: string | null;
  computed_at: string;
};

export type GeoDataset = {
  id: string; name: string; publisher: string; version: string | null; reference_year: string | null;
  licence: string | null; licence_url: string | null; url: string | null; retrieved_on: string | null;
  method_summary: string | null; known_limitations: string | null; attribution: string | null;
};

/** Order = importance to an advertiser; the card shows the first few that exist. */
export const PLACE_META: Record<PlaceCategory, { one: string; many: string; color: string; icon: string }> = {
  mall:          { one: 'mall',              many: 'malls',               color: '#7C3AED', icon: 'M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4zM3 6h18M16 10a4 4 0 0 1-8 0' },
  bank:          { one: 'bank',              many: 'banks',               color: '#0F766E', icon: 'M3 21h18M3 10h18M5 6l7-3 7 3M4 10v11M20 10v11M8 14v3M12 14v3M16 14v3' },
  restaurant:    { one: 'place to eat',      many: 'places to eat',       color: '#EA580C', icon: 'M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2M7 2v20M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3zm0 0v7' },
  hotel:         { one: 'hotel',             many: 'hotels',              color: '#CA8A04', icon: 'M2 20v-8a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v8M4 10V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v4M12 4v6M2 18h20' },
  office:        { one: 'office',            many: 'offices',             color: '#1D4ED8', icon: 'M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18zM6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2M10 6h4M10 10h4M10 14h4M10 18h4' },
  supermarket:   { one: 'supermarket',       many: 'supermarkets',        color: '#9333EA', icon: 'M8 21a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM19 21a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM2 2h3l2.7 12.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6' },
  market:        { one: 'market',            many: 'markets',             color: '#C2410C', icon: 'M2 7l2-4h16l2 4M2 7h20v3a3 3 0 0 1-5 2 3 3 0 0 1-5 0 3 3 0 0 1-5 0 3 3 0 0 1-5-2zM4 12v9h16v-9' },
  fuel:          { one: 'fuel station',      many: 'fuel stations',       color: '#475569', icon: 'M3 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18M2 22h14M15 9h2a2 2 0 0 1 2 2v6a2 2 0 0 0 4 0V8l-3-3M7 7h4' },
  university:    { one: 'university',        many: 'universities',        color: '#4338CA', icon: 'M22 10 12 5 2 10l10 5 10-5zM6 12v5c3 2 9 2 12 0v-5' },
  school:        { one: 'school',            many: 'schools',             color: '#16A34A', icon: 'M4 21V9l8-6 8 6v12M9 21v-6h6v6' },
  health:        { one: 'hospital or clinic', many: 'hospitals & clinics', color: '#DC2626', icon: 'M12 6v12M6 12h12M4 3h16a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z' },
  transport:     { one: 'transport station', many: 'transport stations',  color: '#0369A1', icon: 'M8 6v6M16 6v6M2 12h20M7 18l-2 3M17 18l2 3M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z' },
  entertainment: { one: 'entertainment venue', many: 'entertainment venues', color: '#DB2777', icon: 'M2 8h20v12H2zM7 4l5 4 5-4' },
};
export const PLACE_ORDER = Object.keys(PLACE_META) as PlaceCategory[];
/** Categories offered on the Places map layer (the rest are still counted). */
export const LAYER_CATEGORIES: PlaceCategory[] = ['mall', 'bank', 'restaurant', 'hotel', 'office', 'school', 'health'];

/** 81119 → "81K", 5400 → "5.4K", 1250000 → "1.3M". */
export function compact(n: number | null | undefined): string {
  if (n == null) return '—';
  if (n >= 999_500) return `${(n / 1e6).toFixed(n >= 9_950_000 ? 0 : 1)}M`;
  if (n >= 9_950) return `${Math.round(n / 1000)}K`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(Math.round(n));
}

export const placeLabel = (c: PlaceCategory, n: number) => (n === 1 ? PLACE_META[c].one : PLACE_META[c].many);

/** The most useful non-zero categories, in importance order. */
export function topPlaces(p: PlaceCounts | null | undefined, max = 3): { category: PlaceCategory; n: number }[] {
  if (!p) return [];
  return PLACE_ORDER.filter(c => (p[c] ?? 0) > 0).slice(0, max).map(c => ({ category: c, n: p[c]! }));
}

export const placesTotal = (p: PlaceCounts | null | undefined) => (p ? Object.values(p).reduce((a, b) => a + (b ?? 0), 0) : 0);

/** A short one-line summary for cards: "81K residents · 1 km" and "3 malls · 8 banks". */
export function intelSummary(i: BoardIntel | null | undefined): { people: string | null; places: string | null } {
  if (!i) return { people: null, places: null };
  const people = i.pop_1km != null ? `${compact(i.pop_1km)} residents within 1 km` : null;
  const top = topPlaces(i.places_1km, 3);
  const places = i.places_1km == null ? null : top.length ? top.map(t => `${t.n} ${placeLabel(t.category, t.n)}`).join(' · ') : 'No mapped places within 1 km';
  return { people, places };
}

/** Population figures are only shown when they still match the board's pin. */
export function intelMatchesPin(i: { latitude: number; longitude: number }, lat: number | null, lng: number | null): boolean {
  if (lat == null || lng == null) return false;
  const dy = (i.latitude - lat) * 111_000, dx = (i.longitude - lng) * 111_000 * Math.cos(lat * Math.PI / 180);
  return Math.hypot(dx, dy) <= 15;
}

// ── Loading (cached for the page's lifetime) ───────────────────────

let all: Promise<Map<string, BoardIntel>> | null = null;
/** Every board's row in one request (one row per board, a few hundred). */
export function loadAllIntel(): Promise<Map<string, BoardIntel>> {
  all ??= (async () => {
    const { data, error } = await supabase.from('board_intelligence').select('*').limit(20000);
    if (error) { all = null; return new Map(); }
    return new Map((data as BoardIntel[]).map(r => [r.board_id, r]));
  })();
  return all;
}

export async function loadIntelFor(boardId: string): Promise<BoardIntel | null> {
  if (all) return (await all).get(boardId) ?? null;
  const { data } = await supabase.from('board_intelligence').select('*').eq('board_id', boardId).maybeSingle();
  return (data as BoardIntel | null) ?? null;
}

let datasets: Promise<Map<string, GeoDataset>> | null = null;
export function loadDatasets(): Promise<Map<string, GeoDataset>> {
  datasets ??= (async () => {
    const { data, error } = await supabase.from('geo_datasets')
      .select('id,name,publisher,version,reference_year,licence,licence_url,url,retrieved_on,method_summary,known_limitations,attribution');
    if (error) { datasets = null; return new Map(); }
    return new Map((data as GeoDataset[]).map(d => [d.id, d]));
  })();
  return datasets;
}

// ── Location filters (plain words, applied in the browser) ─────────

export type IntelFilter = 'pop_100k' | 'pop_250k' | 'near_mall' | 'near_banks' | 'near_offices' | 'near_hotels' | 'near_food';
export const INTEL_FILTERS: { key: IntelFilter; label: string; test: (i: BoardIntel) => boolean }[] = [
  { key: 'pop_100k',     label: '100K+ residents within 1 km', test: i => (i.pop_1km ?? 0) >= 100_000 },
  { key: 'pop_250k',     label: '250K+ residents within 2 km', test: i => (i.pop_2km ?? 0) >= 250_000 },
  { key: 'near_mall',    label: 'Mall within 1 km',            test: i => (i.places_1km?.mall ?? 0) >= 1 },
  { key: 'near_banks',   label: '3+ banks within 1 km',        test: i => (i.places_1km?.bank ?? 0) >= 3 },
  { key: 'near_offices', label: 'Offices within 500 m',        test: i => (i.places_500m?.office ?? 0) >= 1 },
  { key: 'near_hotels',  label: 'Hotels within 1 km',          test: i => (i.places_1km?.hotel ?? 0) >= 1 },
  { key: 'near_food',    label: '10+ places to eat within 1 km', test: i => (i.places_1km?.restaurant ?? 0) >= 10 },
];
