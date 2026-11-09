// Finds a map pin for a board from its address text (decks and spreadsheets
// rarely include GPS). Nigerian board addresses read like
// "Along Eko Bridge by Apongbon (GIRAFFE) FTT Costain", so we pull out the
// landmarks and roads, search OpenStreetMap (Photon) first because it knows
// junctions, markets and parks, then Mapbox. Hits are scored on the words
// they share with the address (allowing small spelling differences such as
// Apongbon/Apogbon) and on the kind of place asked for. Any hit far from the
// board's city is thrown away; if nothing fits, the pin goes to the area or
// city centre and is marked as a rough guess.

export type GeoHit = { lat: number; lng: number; label: string; confidence: 'high' | 'low' };

const CENTRES: Record<string, [number, number]> = {
  'Lagos': [6.5244, 3.3792], 'Abuja': [9.0765, 7.3986], 'Port Harcourt': [4.8156, 7.0498], 'Ibadan': [7.3775, 3.947],
  'Kano': [12.0022, 8.592], 'Benin City': [6.335, 5.6037], 'Enugu': [6.4584, 7.5464], 'Kaduna': [10.5105, 7.4165],
  'Abeokuta': [7.1475, 3.3619], 'Owerri': [5.4836, 7.0333], 'Uyo': [5.0377, 7.9128], 'Calabar': [4.9757, 8.3417],
  'Warri': [5.5167, 5.75], 'Asaba': [6.1985, 6.7319], 'Onitsha': [6.1413, 6.8029], 'Awka': [6.2107, 7.0742],
  'Ilorin': [8.4966, 4.5426], 'Jos': [9.8965, 8.8583], 'Akure': [7.2571, 5.2058], 'Osogbo': [7.7827, 4.5418],
  'Ado-Ekiti': [7.6211, 5.2214], 'Makurdi': [7.7337, 8.5214], 'Lokoja': [7.8023, 6.7333], 'Umuahia': [5.5249, 7.4942],
  'Aba': [5.1066, 7.3667], 'Sokoto': [13.0059, 5.2476], 'Maiduguri': [11.8311, 13.151], 'Yola': [9.2035, 12.4954],
  'Bauchi': [10.3158, 9.8442], 'Minna': [9.6139, 6.5569], 'Sagamu': [6.8322, 3.6319], 'Ota': [6.6918, 3.2357],
  'Ijebu Ode': [6.8194, 3.9173], 'Ilesa': [7.6278, 4.7416], 'Ogbomoso': [8.1335, 4.2407], 'Oyo': [7.8526, 3.9312], 'Ile-Ife': [7.4824, 4.5603],
  'Zaria': [11.0855, 7.7199],
};

/** Centre of a known city, if we have it. */
export function cityCentre(city: string): [number, number] | null {
  const key = Object.keys(CENTRES).find(k => k.toLowerCase() === city.trim().toLowerCase());
  return key ? CENTRES[key] : null;
}

function km(a: [number, number], b: [number, number]): number {
  const R = 6371, r = Math.PI / 180;
  const dLat = (b[0] - a[0]) * r, dLng = (b[1] - a[1]) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const GENERIC = new Set(['road', 'street', 'junction', 'way', 'avenue', 'along', 'expressway', 'express', 'close', 'drive', 'bridge', 'park', 'market', 'state', 'board', 'static', 'roundabout', 'gate', 'toll', 'motor', 'garage', 'central', 'lagos', 'ibadan', 'abuja', 'nigeria', 'opposite', 'beside', 'third', 'college', 'school', 'hospital', 'police', 'station', 'hotel', 'stop', 'former', 'stadium', 'international', 'adjacent', 'under', 'face', 'facing', 'traffic', 'from']);

const STOP = new Set(['the', 'and', 'off', 'opp', 'old', 'new', 'via', 'gra']);

function strip(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function words(s: string): string[] {
  return strip(s).replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length > 2 && !GENERIC.has(w) && !STOP.has(w));
}

function editDistance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return d[a.length][b.length];
}

/** Same word, allowing the small spelling differences owners make (Apongbon/Apogbon). */
function sameWord(a: string, b: string): boolean {
  if (a === b) return true;
  const n = Math.min(a.length, b.length);
  if (n < 5) return false;
  return editDistance(a, b) <= (n >= 9 ? 2 : 1);
}

const KINDS = /\b(roundabout|junction|market|motor park|park|garage|toll gate|bridge|round about|interchange|terminal|mall|plaza|stadium|hospital|university|school|church|mosque|estate)\b/i;

/** Address text → search phrases, most specific first. Exported for tests. */
export function addressQueries(address: string, name = ''): string[] {
  const clean = (s: string) => s
    .replace(/\([^)]*\)/g, ' ')                       // (GIRAFFE), (LION)
    .replace(/\b(f\.?t\.?t\.?|facing traffic (to|from)|facing)\b.*$/i, ' ') // "FTT Costain" = which way it faces
    .replace(/\b(led|digital|rooftop( at)?|roof top( at)?|static board|unipole|gantry|billboard|board)\b/gi, ' ')
    .replace(/\b3rd\b/gi, 'Third')
    .replace(/\b(along|on)\b/gi, ' ')
    .replace(/\b(ogun|oyo|lagos|osun|ondo|ekiti|kwara|edo|delta|rivers|kano|kaduna) state\b/gi, ' ')
    .replace(/[\s,]+/g, ' ').trim();
  const out: string[] = [];
  const add = (s: string) => { const t = s.replace(/^[\s,.-]+|[\s,.-]+$/g, ''); if (t.length > 2 && !out.some(o => o.toLowerCase() === t.toLowerCase())) out.push(t); };
  for (const src of [address, name]) {
    if (!src) continue;
    const c = clean(src);
    const parts = c.split(/\b(?:by|opp\.?|opposite|beside|near|adjacent to|adjacent|close to|before|after|inside|in front of)\b/i).map(p => p.trim()).filter(Boolean);
    // Landmarks (after "by"/"opposite") first, then the road, then the whole thing.
    for (const p of [...parts.slice(1), parts[0]]) {
      if (!p) continue;
      add(p);
      // "Central Motor Park Iwo Road" → also "Central Motor Park" and "Iwo Road".
      for (const m of p.matchAll(/((?:[\w'-]+\s+){1,2}?)(roundabout|junction|market|motor park|park|garage|toll gate|bridge|road|way|street|avenue|expressway)\b/gi)) add(m[0]);
    }
    add(c);
  }
  return out.slice(0, 7);
}

type PhotonFeature = { geometry: { coordinates: [number, number] }; properties: Record<string, string | undefined> };

async function getJson(url: string): Promise<{ features?: unknown[] } | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(url);
    if (res.ok) return res.json();
    if (res.status !== 429 && res.status < 500) return null;
    await new Promise(r => setTimeout(r, 1200));
  }
  return null;
}

async function photon(q: string, centre: [number, number] | null): Promise<PhotonFeature[]> {
  const url = new URL('https://photon.komoot.io/api/');
  url.searchParams.set('q', q);
  url.searchParams.set('limit', '8');
  if (centre) {
    url.searchParams.set('lat', String(centre[0]));
    url.searchParams.set('lon', String(centre[1]));
    url.searchParams.set('bbox', [centre[1] - 0.45, centre[0] - 0.45, centre[1] + 0.45, centre[0] + 0.45].join(','));
  } else {
    url.searchParams.set('bbox', '2.676,3.917,14.678,13.886'); // Nigeria
  }
  return ((await getJson(url.toString()))?.features ?? []) as PhotonFeature[];
}

type MapboxFeature = { center: [number, number]; place_type?: string[]; relevance?: number; place_name?: string; text?: string };

async function mapbox(q: string, centre: [number, number] | null, token: string): Promise<MapboxFeature[]> {
  const params = new URLSearchParams({ access_token: token, country: 'ng', limit: '5', types: 'address,poi,neighborhood,locality,place' });
  if (centre) {
    params.set('proximity', `${centre[1]},${centre[0]}`);
    params.set('bbox', [centre[1] - 0.45, centre[0] - 0.45, centre[1] + 0.45, centre[0] + 0.45].join(','));
  }
  return ((await getJson(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json?${params}`))?.features ?? []) as MapboxFeature[];
}

const BROAD = new Set(['city', 'town', 'village', 'state', 'county', 'district', 'country', 'region', 'municipality', 'administrative', 'suburb', 'quarter', 'neighbourhood', 'hamlet']);
const ROADS = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'residential', 'unclassified', 'road', 'service']);
const MAX_KM = 45;

/** How well a found place matches what was asked; 0 means no shared name. */
function score(asked: string[], kind: string, name: string, osmValue: string, ownName = name): number {
  const named = words(name);
  const shared = asked.filter(w => named.some(n => sameWord(w, n))).length;
  if (!shared) return 0;
  let s = shared * 10;
  // The place is called just what was asked ("Sango", not "Sango Ota Primary School").
  const own = words(ownName);
  if (own.length && own.every(n => asked.some(w => sameWord(w, n)))) s += 5;
  const k = kind.toLowerCase();
  const nm = strip(name);
  if (k && nm.includes(k.split(' ')[0])) s += 6;
  if (k === 'market' && osmValue === 'marketplace') s += 6;
  if ((k === 'park' || k === 'motor park' || k === 'garage') && ['bus_station', 'taxi', 'parking', 'station'].includes(osmValue)) s += 6;
  if ((k === 'roundabout' || k === 'junction') && ROADS.has(osmValue)) s += 3;
  if (!k && ROADS.has(osmValue)) s += 2;
  if (['hospital', 'clinic', 'pharmacy', 'shop', 'electronics', 'restaurant', 'hotel'].includes(osmValue) && !k) s -= 4;
  if (['hospital', 'clinic'].includes(osmValue) && k && k !== 'hospital') s -= 4;
  return s;
}

/**
 * Best pin for a board. `city` keeps matches near the right town;
 * without it, anywhere in Nigeria is allowed but the pin is a rough guess.
 */
export async function geocodeBoard(b: { address: string; name?: string; area?: string; city?: string; state?: string }, mapboxToken?: string): Promise<GeoHit | null> {
  const centre = b.city ? cityCentre(b.city) : null;
  const area = b.area && b.area.length <= 30 ? b.area : '';
  const near = (p: [number, number]) => !centre || km(centre, p) <= MAX_KM;
  const queries = addressQueries(b.address, b.name);
  if (area) queries.push(area);

  let district: GeoHit | null = null;
  let tried = 0;
  for (const q of queries) {
    const suffix = [area && !strip(q).includes(strip(area)) ? area : '', b.city && !strip(q).includes(strip(b.city)) ? b.city : ''].filter(Boolean).join(', ');
    const full = suffix ? `${q}, ${suffix}` : q;
    // Every hit is already near the city, so its name proves nothing.
    const cityWords = words(b.city ?? '');
    const asked = words(q).filter(w => !cityWords.includes(w));
    if (!asked.length) continue;
    tried++;
    const kind = q.match(KINDS)?.[1] ?? '';
    let best: (GeoHit & { s: number }) | null = null;
    try {
      for (const f of await photon(full, centre)) {
        const [lng, lat] = f.geometry.coordinates;
        const p = f.properties;
        if (!near([lat, lng])) continue;
        if (BROAD.has(p.osm_value ?? '') || BROAD.has(p.type ?? '')) {
          // A district or town with the asked name: a fallback that beats the city centre.
          if (!district && centre && words(p.name ?? '').some(n => asked.some(w => sameWord(w, n)))) {
            district = { lat, lng, label: `${p.name} (area)`, confidence: 'low' };
          }
          continue;
        }
        const s = score(asked, kind, `${p.name ?? ''} ${p.street ?? ''}`, p.osm_value ?? '', p.name ?? '');
        if (s > (best?.s ?? 0)) best = { lat, lng, s, label: [p.name, p.street, p.district ?? p.locality, p.city].filter(Boolean).join(', '), confidence: 'high' };
      }
    } catch { /* try Mapbox */ }
    if (!best && mapboxToken) {
      try {
        for (const f of await mapbox(full, centre, mapboxToken)) {
          const [lng, lat] = f.center;
          if (!near([lat, lng]) || !(f.place_type ?? []).some(t => t === 'address' || t === 'poi')) continue;
          const s = score(asked, kind, f.text ?? '', '');
          if (s > (best?.s ?? 0) && Number(f.relevance) >= 0.7) best = { lat, lng, s, label: f.place_name ?? q, confidence: 'high' };
        }
      } catch { /* fall through */ }
    }
    if (best) {
      const { lat, lng, label } = best;
      const hit = { lat, lng, label };
      // The area name alone, or a match without a known city, is only a rough guess.
      // A single shared word with nothing else agreeing, the area name alone,
      // or a match without a known city, is only a rough guess.
      // Good only for the main landmark, or when two or more words agree.
      const good = centre && q !== area && ((tried === 1 && best.s >= 12) || best.s >= 20);
      return { ...hit, confidence: good ? 'high' : 'low' };
    }
  }
  if (district) return district;
  if (centre) return { lat: centre[0], lng: centre[1], label: `${b.city} (city centre)`, confidence: 'low' };
  return null;
}
