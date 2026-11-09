// Turns the text of one deck slide (or PDF page) into board fields using
// plain rules — no AI. It reads labelled lines ("Size: 40ft x 20ft",
// "Location - Along Eko Bridge") first, then looks for tell-tale patterns
// anywhere on the slide. Anything it can't read is left blank, never
// guessed; the import review screen shows what's missing.

import { parseCoordinates } from '@/lib/coordinates';

/** Column names the import screen already recognises (see FIELD_HINTS). */
export const DECK_COLUMNS = [
  'Board Name', 'Address', 'City', 'Area', 'State', 'Format', 'Width (m)', 'Height (m)',
  'Illuminated', 'Monthly Rate', 'Latitude', 'Longitude', 'Faces',
] as const;
export type DeckRow = Record<(typeof DECK_COLUMNS)[number], string>;

type Field = 'name' | 'address' | 'city' | 'area' | 'state' | 'size' | 'format' | 'illum' | 'rate' | 'gps' | 'lat' | 'lng' | 'faces' | 'width' | 'height';

// Words owners use as labels, checked in order (longer phrases first).
const LABELS: [RegExp, Field][] = [
  [/^(board|site|billboard|location)\s*(name|title|id|code)$/, 'name'],
  [/^(name|title)$/, 'name'],
  [/^(gps|gps coordinates?|co-?ordinates?|geo|geo ?location|lat\s*[/&,]?\s*long?|lat-?lng|google pin|map pin|pin)$/, 'gps'],
  [/^(latitude|lat)$/, 'lat'],
  [/^(longitude|long|lng|lon)$/, 'lng'],
  [/^(size|sizes|dimensions?|board size|face size|panel size|structure size|display size|screen size)$/, 'size'],
  [/^(width|w)$/, 'width'],
  [/^(height|h|length)$/, 'height'],
  [/^(type|format|structure|structure type|media type|board type|media|medium|product|asset type|category)$/, 'format'],
  [/^(illumination|illuminated|lighting|light|lit|power)$/, 'illum'],
  [/^(rate|rates|price|pricing|cost|rental|rent|amount|monthly rate|rate per month|monthly rental|media rate|media cost|tariff|fee|charge|monthly fee)(\s*\(.*\))?$/, 'rate'],
  [/^(faces?|no\.? of faces|number of faces|sides?|no\.? of sides)$/, 'faces'],
  [/^(city|town)$/, 'city'],
  [/^(state)$/, 'state'],
  [/^(area|lga|axis|district|zone|neighbou?rhood|locality|region)$/, 'area'],
  [/^(location|address|site|site location|site address|location description|description|landmark|route|road|street|position|placement)$/, 'address'],
];

// City names, plus well-known areas that tell us the city.
const CITIES: [RegExp, string, string][] = [
  [/\blagos\b/i, 'Lagos', 'Lagos'],
  [/\b(abuja|fct)\b/i, 'Abuja', 'FCT'],
  [/\bport[\s-]?harcourt\b|\bph\s*city\b/i, 'Port Harcourt', 'Rivers'],
  [/\bibadan\b/i, 'Ibadan', 'Oyo'],
  [/\bkano\b/i, 'Kano', 'Kano'],
  [/\bbenin(\s*city)?\b/i, 'Benin City', 'Edo'],
  [/\benugu\b/i, 'Enugu', 'Enugu'],
  [/\bkaduna\b/i, 'Kaduna', 'Kaduna'],
  [/\babeokuta\b/i, 'Abeokuta', 'Ogun'],
  [/\bowerri\b/i, 'Owerri', 'Imo'],
  [/\buyo\b/i, 'Uyo', 'Akwa Ibom'],
  [/\bcalabar\b/i, 'Calabar', 'Cross River'],
  [/\bwarri\b/i, 'Warri', 'Delta'],
  [/\basaba\b/i, 'Asaba', 'Delta'],
  [/\bonitsha\b/i, 'Onitsha', 'Anambra'],
  [/\bawka\b/i, 'Awka', 'Anambra'],
  [/\bilorin\b/i, 'Ilorin', 'Kwara'],
  [/\bjos\b/i, 'Jos', 'Plateau'],
  [/\bakure\b/i, 'Akure', 'Ondo'],
  [/\bosogbo\b/i, 'Osogbo', 'Osun'],
  [/\bado[\s-]?ekiti\b/i, 'Ado-Ekiti', 'Ekiti'],
  [/\bmakurdi\b/i, 'Makurdi', 'Benue'],
  [/\blokoja\b/i, 'Lokoja', 'Kogi'],
  [/\bumuahia\b/i, 'Umuahia', 'Abia'],
  [/\baba\b/i, 'Aba', 'Abia'],
  [/\bsokoto\b/i, 'Sokoto', 'Sokoto'],
  [/\bmaiduguri\b/i, 'Maiduguri', 'Borno'],
  [/\byola\b/i, 'Yola', 'Adamawa'],
  [/\bbauchi\b/i, 'Bauchi', 'Bauchi'],
  [/\bminna\b/i, 'Minna', 'Niger'],
  [/\bsagamu|shagamu\b/i, 'Sagamu', 'Ogun'],
];
const LAGOS_AREAS = ['Victoria Island', 'Ikoyi', 'Lekki', 'Ajah', 'Ikeja', 'Surulere', 'Yaba', 'Maryland', 'Ojota', 'Apapa', 'Oshodi', 'Festac', 'Gbagada', 'Ikorodu', 'Mushin', 'Agege', 'Obalende', 'Marina', 'Ojuelegba', 'Ogba', 'Magodo', 'Ketu', 'Mile 2', 'Iyana Ipaja', 'Alausa', 'Allen', 'Opebi', 'Oregun', 'Anthony', 'Ilupeju', 'Palmgroove', 'Onipanu', 'Ebute Metta', 'Oyingbo', 'Costain', 'Ijora', 'Orile', 'Sangotedo', 'Chevron', 'Ikota', 'Osapa', 'Agungi', 'Oniru', 'Eko Atlantic', 'Third Mainland', '3rd Mainland', 'Eko Bridge', 'Carter Bridge', 'Ozumba Mbadiwe', 'Adeola Odeku', 'Admiralty', 'Awolowo Road', 'Ikorodu Road', 'Lekki-Epe', 'Apapa-Oshodi', 'Agidingbi', 'Toyin', 'Obafemi Awolowo Way'];
const ABUJA_AREAS = ['Wuse', 'Garki', 'Maitama', 'Asokoro', 'Jabi', 'Utako', 'Gwarinpa', 'Kubwa', 'Lugbe', 'Apo', 'Lokogoma', 'Katampe', 'Life Camp', 'Durumi', 'Gudu', 'Wuye', 'Mabushi', 'Kado', 'Airport Road', 'Nyanya', 'Karu', 'Central Business District', 'CBD'];
const PH_AREAS = ['GRA Phase', 'Trans Amadi', 'Rumuokoro', 'Rumuola', 'Eleme', 'Aba Road', 'Garrison', 'Choba', 'Woji', 'Rumuibekwe', 'Elelenwo'];

function areaHit(text: string): { area: string; city: string; state: string } | null {
  for (const [list, city, state] of [[LAGOS_AREAS, 'Lagos', 'Lagos'], [ABUJA_AREAS, 'Abuja', 'FCT'], [PH_AREAS, 'Port Harcourt', 'Rivers']] as const) {
    for (const a of list) {
      if (new RegExp(`\\b${a.replace(/[-]/g, '[-\\s]?').replace(/ /g, '\\s+')}\\b`, 'i').test(text)) return { area: a.replace('3rd Mainland', 'Third Mainland'), city, state };
    }
  }
  return null;
}

export function findCity(text: string): { city: string; state: string } | null {
  for (const [re, city, state] of CITIES) if (re.test(text)) return { city, state };
  const a = areaHit(text);
  return a ? { city: a.city, state: a.state } : null;
}

const FORMAT_WORDS: [RegExp, string][] = [
  [/\b(led|digital|dooh|e-?board|electronic|screen|video wall)\b/i, 'led'],
  [/\b(uni[\s-]?pole|monopole|mono[\s-]?pole|single[\s-]?pole)\b/i, 'unipole'],
  [/\b(gantry|gantries|overhead)\b/i, 'gantry'],
  [/\b(bridge[\s-]?(panel|board|banner)s?|flyover (panel|board))\b/i, 'bridge_panel'],
  [/\b(wall[\s-]?(drape|banner|wrap|scape)|drape|building wrap|facade)\b/i, 'wall_drape'],
  [/\b(billboard|48[\s-]?sheet|96[\s-]?sheet|portrait board|landscape board|roof[\s-]?top|backlit board|bill[\s-]?board)\b/i, 'billboard'],
];

export function findFormat(text: string): string {
  for (const [re, f] of FORMAT_WORDS) if (re.test(text)) return f;
  return '';
}

export function findIlluminated(text: string): string {
  if (/\b(non[\s-]?illuminated|not\s+illuminated|unlit|not\s+lit|no\s+(light|illumination|power))\b/i.test(text)) return 'No';
  if (/\b(illuminated|front[\s-]?lit|back[\s-]?lit|flood[\s-]?lit|lit|led|digital|lighting|lights?|solar)\b/i.test(text)) return 'Yes';
  return '';
}

/** "40ft x 20ft", "48 x 12", "12m × 4m", "40' by 20'" → metres. Unitless sizes of 25+ are read as feet. */
export function findSize(text: string): { width: number; height: number } | null {
  const m = text.match(/(\d+(?:\.\d+)?)\s*(m|mtrs?|metres?|meters?|ft|feet|foot|'|’)?\s*(?:x|×|\*|by)\s*(\d+(?:\.\d+)?)\s*(m|mtrs?|metres?|meters?|ft|feet|foot|'|’)?/i);
  if (!m) return null;
  let w = parseFloat(m[1]), h = parseFloat(m[3]);
  if (!(w > 0 && h > 0) || w > 400 || h > 400) return null;
  const unit = (m[2] || m[4] || '').toLowerCase();
  const feet = /^(ft|feet|foot|'|’)$/.test(unit) || (!unit && Math.max(w, h) >= 25);
  if (feet) { w *= 0.3048; h *= 0.3048; }
  return { width: Math.round(w * 10) / 10, height: Math.round(h * 10) / 10 };
}

/**
 * "N7,000,000", "₦7.5m", "NGN 2.5 million", "7m per month" → naira. Below
 * ₦10,000 is ignored. Outside a "Rate:" label a number only counts with a
 * currency sign or "per month", so sizes ("12m x 4m") and phone numbers aren't read as rates.
 */
export function findRate(text: string, labelled = false): number | null {
  const re = /(?:₦|\bNGN\b|\bN(?=\s?\d)|naira)?\s*(\d{1,3}(?:[,\s]\d{3})+|\d+(?:\.\d+)?)\s*(million|mil|mn|m|k|thousand)?\b/gi;
  let best: number | null = null;
  for (const m of text.matchAll(re)) {
    const hasCurrency = /₦|ngn|n|naira/i.test(m[0].replace(m[1], '').replace(m[2] ?? '', ''));
    const mult = m[2] ? (/^(k|thousand)$/i.test(m[2]) ? 1e3 : 1e6) : 1;
    const after = text.slice((m.index ?? 0) + m[0].length);
    if (/^\s*(x|×|\*|by\b)/i.test(after)) continue; // a size, not a price
    const perMonth = /^\s*(per\s+month|monthly|a\s+month|\/\s*mo(nth)?|p\.?\s?m\b)/i.test(after);
    if (!hasCurrency && !labelled && !perMonth) continue; // a bare number could be anything
    const v = parseFloat(m[1].replace(/[,\s]/g, '')) * mult;
    if (v >= 10000 && v <= 1e10 && (best === null || v > best)) best = v;
  }
  return best === null ? null : Math.round(best);
}

/** First GPS pair anywhere in the text. */
export function findGps(text: string): { lat: number; lng: number } | null {
  const whole = parseCoordinates(text);
  if (whole) return whole;
  const dec = text.match(/(-?\d{1,2}\.\d{3,})\s*°?\s*[NS]?\s*[,;/\s]\s*(?:long?\w*\s*[:=]?\s*)?(-?\d{1,3}\.\d{3,})/i);
  if (dec) return parseCoordinates(`${dec[1]}, ${dec[2]}`);
  const dms = text.match(/\d{1,3}\s*°\s*\d{1,2}\s*['′’]\s*\d{1,2}(?:\.\d+)?\s*(?:["″”]|'')?\s*[NS][\s,]+\d{1,3}\s*°\s*\d{1,2}\s*['′’]\s*\d{1,2}(?:\.\d+)?\s*(?:["″”]|'')?\s*[EW]/i);
  return dms ? parseCoordinates(dms[0]) : null;
}

function findFaces(text: string): string {
  const n = text.match(/\b(\d)\s*(?:faces?|sides?|sided)\b/i);
  if (n && +n[1] >= 1 && +n[1] <= 6) return n[1];
  if (/\b(double[\s-]?(sided|face[sd]?)|back[\s-]?to[\s-]?back|two[\s-]?(sided|faces?)|both sides)\b/i.test(text)) return '2';
  if (/\b(single[\s-]?(sided|face[sd]?)|one[\s-]?(sided|face))\b/i.test(text)) return '1';
  if (/\b(three[\s-]?(sided|faces?)|tri[\s-]?(vision|face))\b/i.test(text)) return '3';
  return '';
}

/** Splits "Label: value" (also "-", "–", "=" or a tab). */
function splitLabel(line: string): [Field, string] | null {
  const m = line.match(/^\s*([A-Za-z][A-Za-z0-9 .&/()'-]{0,40}?)[ ]*(?::|=|\t+| - | – | — )\s*(.+)$/);
  if (!m) return null;
  const label = m[1].toLowerCase().replace(/\s+/g, ' ').replace(/[.]/g, '').trim();
  for (const [re, f] of LABELS) if (re.test(label)) return [f, m[2].trim()];
  return null;
}

const NOT_A_TITLE = /^(size|rate|price|gps|location|type|format|illumination|faces?|available|contact|tel|phone|email|www\.|http)/i;
// Tabs are kept: table cells arrive as "Label<TAB>value".
const tidy = (s: string) => s.replace(/[  \r\n\f\v]+/g, ' ').replace(/\t+/g, '\t').replace(/^[\s•●▪‣◦\-–—*]+/, '').trim();

/**
 * Reads one slide. Returns null for slides that aren't a board (cover,
 * contact, terms): nothing that looks like a size, rate, GPS pin, format or
 * labelled location.
 */
export function extractBoard(rawLines: string[]): DeckRow | null {
  const lines = rawLines.map(tidy).filter(l => l.length > 0 && l.length < 400);
  if (lines.length === 0) return null;
  const text = lines.join('\n');
  const got: Partial<Record<Field, string>> = {};
  for (const l of lines) {
    const hit = splitLabel(l);
    if (hit && !got[hit[0]]) got[hit[0]] = hit[1];
  }

  const size = findSize(got.size ?? '') ?? findSize(text);
  const width = got.width ? parseFloat(got.width) : size?.width ?? null;
  const height = got.height ? parseFloat(got.height) : size?.height ?? null;
  const format = findFormat(got.format ?? '') || findFormat(text);
  const illum = findIlluminated(got.illum ?? '') || (got.illum ? '' : findIlluminated(text));
  const rate = findRate(got.rate ?? '', true) ?? findRate(text);
  let gps = got.gps ? findGps(got.gps) : null;
  if (!gps && got.lat && got.lng) gps = parseCoordinates(`${got.lat}, ${got.lng}`);
  gps = gps ?? findGps(text);
  const faces = findFaces(got.faces ? `${got.faces} faces` : text);

  // Title: the first line that isn't a label or a number-only line.
  const title = lines.find(l => !splitLabel(l) && !NOT_A_TITLE.test(l) && /[a-z]{3,}/i.test(l) && !findSize(l) && l.length >= 6) ?? '';
  const address = tidy(got.address ?? '') || title;
  const where = findCity(got.city ?? '') ?? findCity(`${address}\n${text}`);
  const area = tidy(got.area ?? '') || areaHit(`${address}\n${text}`)?.area || '';

  const looksLikeBoard = !!(size || gps || rate || got.address || got.size || got.format || (format && address));
  if (!looksLikeBoard) return null;

  const name = tidy(got.name ?? '') || title || address;
  return {
    'Board Name': name.slice(0, 160),
    'Address': address.slice(0, 300),
    'City': tidy(got.city ?? '') || where?.city || '',
    'Area': area.slice(0, 80),
    'State': tidy(got.state ?? '') || where?.state || '',
    'Format': format,
    'Width (m)': width && width > 0 ? String(width) : '',
    'Height (m)': height && height > 0 ? String(height) : '',
    'Illuminated': illum,
    'Monthly Rate': rate ? String(rate) : '',
    'Latitude': gps ? gps.lat.toFixed(6) : '',
    'Longitude': gps ? gps.lng.toFixed(6) : '',
    'Faces': faces,
  };
}

/**
 * The city a whole deck is about, from the slides that name one; used for
 * slides that don't say (e.g. a "Lagos inventory" deck).
 */
export function deckCity(allText: string[]): { city: string; state: string } | null {
  const counts = new Map<string, { n: number; state: string }>();
  for (const t of allText) {
    const c = findCity(t);
    if (c) counts.set(c.city, { n: (counts.get(c.city)?.n ?? 0) + 1, state: c.state });
  }
  const top = [...counts.entries()].sort((a, b) => b[1].n - a[1].n)[0];
  return top ? { city: top[0], state: top[1].state } : null;
}
