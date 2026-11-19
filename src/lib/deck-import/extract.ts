// Turns the text of one deck slide (or PDF page) into board fields using
// plain rules — no AI. It reads labelled lines ("Size: 40ft x 20ft",
// "Location - Along Eko Bridge") first, then looks for tell-tale patterns
// anywhere on the slide. Anything it can't read is left blank, never
// guessed; the import review screen shows what's missing.

import { parseCoordinates } from '@/lib/coordinates';
import { cityCentre, nearestCity } from '@/lib/geocode-board';

/** Column names the import screen already recognises (see FIELD_HINTS). */
export const DECK_COLUMNS = [
  'Board Name', 'Address', 'City', 'Area', 'State', 'Format', 'Width (m)', 'Height (m)',
  'Illuminated', 'Monthly Rate', 'Latitude', 'Longitude', 'Faces',
] as const;
export type DeckRow = Record<(typeof DECK_COLUMNS)[number], string>;

type Field = 'name' | 'address' | 'city' | 'area' | 'state' | 'size' | 'format' | 'illum' | 'rate' | 'rate_annual' | 'gps' | 'lat' | 'lng' | 'faces' | 'width' | 'height' | 'note';

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
  [/^((annual )+(rate|rental|rent|cost|fee|charge)?|(yearly|per annum)( rate| rental| cost)?|(cost|rate|rental|price|fee) (per|a|\/) ?(annum|year)|(rate|cost|rental|price) ?\(? ?(annual|yearly|per annum|pa) ?\)?)$/, 'rate_annual'],
  [/^(rate|rates|price|pricing|cost|rental|rent|amount|monthly rate|rate per month|cost per month|monthly cost|monthly rental|monthly rent|media rate|media cost|tariff|fee|charge|monthly fee)(\s*\(.*\))?$/, 'rate'],
  [/^(faces?|no\.? of faces|number of faces|sides?|no\.? of sides)$/, 'faces'],
  [/^(city|town)$/, 'city'],
  [/^(state)$/, 'state'],
  [/^(area|lga|axis|district|zone|neighbou?rhood|locality|region)$/, 'area'],
  [/^(location|address|site|site location|site address|location description|road|street|position|placement)$/, 'address'],
  // Traffic directions and nearby landmarks: not where the board is.
  [/^(description|landmarks?|route|traffic|direction|direction of traffic|traffic direction|type of area|vehicular traffic|visibility( angle| distance)?|audience|ftf|ftt|ftf\/ftt|ftt\/ftf)$/, 'note'],
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
  [/\bos(h)?ogbo\b/i, 'Osogbo', 'Osun'],
  [/\biles(h)?a\b/i, 'Ilesa', 'Osun'],
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
  [/\b(sango[\s-]?)?ott?a\b/i, 'Ota', 'Ogun'],
  [/\bgbongan\b/i, 'Gbongan', 'Osun'],
  [/\b(magboro|mowe|ibafo)\b/i, 'Mowe', 'Ogun'],
  [/\bijebu[\s-]?ode\b/i, 'Ijebu Ode', 'Ogun'],
  [/\bogbomo(so|sho)\b/i, 'Ogbomoso', 'Oyo'],
  [/\bile\s*-?\s*ife\b/i, 'Ile-Ife', 'Osun'],
  [/\bzaria\b/i, 'Zaria', 'Kaduna'],
];
// Intercity roads name two cities ("Lagos Ibadan Expressway"); they say nothing
// about where the board is, so they're ignored when looking for the city.
const CITY_NAMES = String.raw`lagos|ibadan|abeokuta|benin|ore|ijebu[\s-]?ode|ilorin|oyo|ife|kaduna|abuja|kano|zaria|keffi|lokoja|onitsha|enugu|port[\s-]?harcourt|aba|owerri|badagry|epe|sagamu|shagamu|ota|idiroko|ikorodu|iwo|ogbomoso|akure|ilesha|ilesa|osogbo|sokoto|jos|makurdi|calabar|uyo|warri|asaba`;
const INTERCITY_ROAD = new RegExp(String.raw`\b(?:${CITY_NAMES})(?:[\s/-]+(?:${CITY_NAMES}))+[\s/-]+(?:express\s?way|exp\.?|road|rd\.?|highway)\b`, 'gi');
const LAGOS_AREAS = ['Victoria Island', 'Ikoyi', 'Lekki', 'Ajah', 'Ikeja', 'Surulere', 'Yaba', 'Maryland', 'Ojota', 'Apapa', 'Oshodi', 'Festac', 'Gbagada', 'Ikorodu', 'Mushin', 'Agege', 'Obalende', 'Marina', 'Ojuelegba', 'Ogba', 'Magodo', 'Ketu', 'Mile 2', 'Iyana Ipaja', 'Alausa', 'Allen', 'Opebi', 'Oregun', 'Anthony', 'Ilupeju', 'Palmgroove', 'Onipanu', 'Ebute Metta', 'Oyingbo', 'Costain', 'Ijora', 'Orile', 'Sangotedo', 'Chevron', 'Ikota', 'Osapa', 'Agungi', 'Oniru', 'Eko Atlantic', 'Third Mainland', '3rd Mainland', 'Eko Bridge', 'Carter Bridge', 'Ozumba Mbadiwe', 'Adeola Odeku', 'Admiralty', 'Awolowo Road', 'Ikorodu Road', 'Lekki-Epe', 'Apapa-Oshodi', 'Agidingbi', 'Toyin', 'Obafemi Awolowo Way'];
const ABUJA_AREAS = ['Wuse', 'Garki', 'Maitama', 'Asokoro', 'Jabi', 'Utako', 'Gwarinpa', 'Kubwa', 'Lugbe', 'Apo', 'Lokogoma', 'Katampe', 'Life Camp', 'Durumi', 'Gudu', 'Wuye', 'Mabushi', 'Kado', 'Airport Road', 'Nyanya', 'Karu', 'Central Business District', 'CBD'];
const IBADAN_AREAS = ['Mokola', 'Iwo Road', 'Dugbe', 'Challenge', 'Bodija', 'Ojoo', 'Agodi', 'Adeoyo', 'Apata', 'Ring Road', 'New Garage', 'Alesinloye', 'Alenshinloye', 'Oke Ado', 'Eleyele', 'Moniya', 'Akobo', 'Egbeda', 'Secretariat', 'Oluyole', 'Jericho', 'Samonda', 'Idi Ape', 'Oja Oba'];
const PH_AREAS = ['GRA Phase', 'Trans Amadi', 'Rumuokoro', 'Rumuola', 'Eleme', 'Aba Road', 'Garrison', 'Choba', 'Woji', 'Rumuibekwe', 'Elelenwo'];

function areaHit(text: string): { area: string; city: string; state: string } | null {
  for (const [list, city, state] of [[LAGOS_AREAS, 'Lagos', 'Lagos'], [ABUJA_AREAS, 'Abuja', 'FCT'], [PH_AREAS, 'Port Harcourt', 'Rivers'], [IBADAN_AREAS, 'Ibadan', 'Oyo']] as const) {
    for (const a of list) {
      if (new RegExp(`\\b${a.replace(/[-]/g, '[-\\s]?').replace(/ /g, '\\s+')}\\b`, 'i').test(text)) return { area: a.replace('3rd Mainland', 'Third Mainland'), city, state };
    }
  }
  return null;
}

/** The town an address ends with ("…, along Lagos to Benin Expressway, Benin City" is in Benin City). */
function cityAtEnd(address: string): { city: string; state: string } | null {
  const last = address.split(/[,;]/).map(p => p.trim()).filter(Boolean).pop();
  if (!last || last.length > 40) return null;
  for (const [re, city, state] of CITIES) if (re.test(last)) return { city, state };
  return null;
}

export function findCity(raw: string): { city: string; state: string } | null {
  const text = raw.replace(INTERCITY_ROAD, ' ');
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
  [/\b(billboard|48[\s-]?sheet|96[\s-]?sheet|portrait( board)?|landscape( board)?|roof[\s-]?top|backlit board|bill[\s-]?board|eye[\s-]?catchers?|super[\s-]?48|mega[\s-]?board|spectacular|lamp[\s-]?posts?|street[\s-]?poles?|hoarding|static board)\b/i, 'billboard'],
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

/**
 * "40ft x 20ft", "48 x 12", "12m × 4m", "40' by 20'" → metres. Unitless sizes of 25+ are read as feet.
 * Sides marked H/W ("11mH by 5mW", "2.8M (H) x 6.90M (W)") go the right way round.
 */
export function findSize(text: string): { width: number; height: number } | null {
  const UNIT = String.raw`(m|mtrs?|metres?|meters?|ft|feet|foot|'|’)?`;
  // A side letter stuck to the number ("11mH") or alone in brackets ("5m(W)", "2.8M (H)").
  const SIDE = String.raw`(?:([hw])(?![a-z])|\s*\(\s*([hw])\s*\))?`;
  const re = new RegExp(String.raw`(\d+(?:\.\d+)?)\s*${UNIT}${SIDE}\s*(?:x|×|\*|by)\s*(\d+(?:\.\d+)?)\s*${UNIT}${SIDE}`, 'i');
  const m = text.match(re);
  if (!m) return null;
  let w = parseFloat(m[1]), h = parseFloat(m[5]);
  const first = (m[3] || m[4] || '').toLowerCase(), second = (m[7] || m[8] || '').toLowerCase();
  // Or the order given after the size: "20M X 4M (W x H)", "6m x 18m (H x W)".
  const order = text.slice((m.index ?? 0) + m[0].length).match(/^\s*\(\s*([hw])\s*[x×]\s*([hw])\s*\)/i);
  if (first === 'h' || second === 'w' || order?.[1].toLowerCase() === 'h') [w, h] = [h, w];
  if (!(w > 0 && h > 0) || w > 400 || h > 400) return null;
  const unit = (m[2] || m[6] || '').toLowerCase();
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

const MONEY = String.raw`(?:₦|NGN|N)?[ ]*\d[\d,.]*(?:[ ]?(?:million|mil|mn|m|k)\b)?`;
const ANNUAL_BEFORE = new RegExp(String.raw`(?:(?:annual\s+)+(?:rate|rental|rent|cost|fee|charge)?|(?:cost|rate|rental|price|fee)\s+per\s+(?:annum|year)|per\s+annum|yearly(?:\s+(?:rate|rental|cost))?)\s*[:=–-]?\s*(${MONEY})`, 'gi');
const MONTHLY_BEFORE = new RegExp(String.raw`(?:monthly(?:\s+(?:rate|rental|rent|cost|fee|charge))?|(?:cost|rate|rental|price|fee)\s+per\s+month|per\s+month)\s*[:=–-]?\s*(${MONEY})`, 'gi');
const ANNUAL_AFTER = new RegExp(String.raw`(${MONEY})\s*(?:\/\s*face\.?\s*)?(?:per\s+(?:annum|year)|\/\s*(?:annum|year|yr)|p\.?a\.?\b|annually|yearly)`, 'gi');
const MONTHLY_AFTER = new RegExp(String.raw`(${MONEY})\s*(?:\/\s*face\.?\s*)?(?:per\s+month|\/\s*mo(?:nth)?\b|monthly|a\s+month|p\.?m\.?\b)`, 'gi');

/**
 * Prices a slide gives per month and per year, kept apart. Decks often show
 * both ("Annual Rate: N8,000,000 · Monthly Rental: N750,000"); the yearly
 * figure must never be saved as the monthly rate.
 */
export function findRates(text: string): { monthly: number | null; annual: number | null } {
  const first = (res: RegExp[]) => {
    for (const re of res) {
      for (const m of text.matchAll(re)) {
        const v = findRate(m[1], true);
        if (v) return v;
      }
    }
    return null;
  };
  return { monthly: first([MONTHLY_BEFORE, MONTHLY_AFTER]), annual: first([ANNUAL_BEFORE, ANNUAL_AFTER]) };
}

/** True when text reads like a price or a field label, not a place (so it can't be a board's name). */
export function looksLikePriceOrLabel(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (/^(annual|yearly|monthly|cost|rate|rates|price|rental|rent|size|dimension|fee|amount|tariff|vat|production|printing|available|contact|tel|phone|email)\b/i.test(t)) return true;
  return /(?:₦|\bNGN\b|\bN)\s?\d[\d,.]{4,}/.test(t) && !/\b(road|rd|street|way|avenue|bridge|junction|roundabout|market|along|opposite|express)\b/i.test(t);
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

const NOT_A_TITLE = /^(size|rate|price|gps|location|type|format|illumination|faces?|available|contact|tel|phone|email|www\.|http|annual|yearly|monthly|cost|rental|rent|since|vacant|description|landmarks?|(ft[ft]|ftf\/t|ftf\/ftt|ftt\/ftf)\b\s*:|facing\s+traffic\b|traffic\s+(from|to)\b\s*:|((front|back|flood)[\s-]?lit|non[\s-]?illuminated|illuminated)$|([rl]h[ds]\s*)+$)/i;
// Words that show a line is where the board stands.
const PLACE_WORDS = /\b(along|road|rd|street|str|avenue|ave|way|express(way)?|exp|bridge|junction|jct|roundabout|round about|market|by|opp|opposite|beside|near|inside|in front of|adjacent|ftt|ftf|lftt|facing|bus ?stop|b\/stop|estate|toll ?gate|garage|motor park|flyover|interchange|close|crescent|drive|airport|stadium|mall|plaza)\b/i;
const CONTINUES = /^(by|opp\.?|opposite|beside|near|ftt|ftf|facing|off|after|before|adjacent|at|,)\b/i;
// A line that only names the board type, e.g. "(GANTRY)", "EYE CATCHER", "(PORTRAIT)".
const FORMAT_TAG = /^\s*[([]?\s*(led|digital|unipole|uni-?pole|gantry|billboard|eye[\s-]?catcher|portrait|landscape|bridge panel|wall drape|rooftop|roof top|super 48|48 sheet|96 sheet|mega board|lamp[\s-]?post|street pole)s?\s*(board)?\s*[)\]]?\s*$/i;

/** Drops coordinates (3°20'01.4"E, 6.5123 3.3456) and stray punctuation from a title. */
function cleanTitle(s: string): string {
  // Text that ran on into the next label ("…Abiola wayFacing Traffic From…", "…LagosDescription: FTF…").
  const runOn = s.search(/\s*(description|landmarks?|ftf|ftt)\s*:|(?<=[a-z])facing\s+traffic/i);
  if (runOn > 10) s = s.slice(0, runOn);
  return s
    .replace(/\d{1,3}\s*°\s*\d{1,2}\s*['′’]\s*\d{1,2}(?:\.\d+)?\s*(?:["″”]|'')?\s*[NSEW]?/gi, ' ')
    .replace(/-?\d{1,2}\.\d{4,}\s*[,;/ ]\s*-?\d{1,3}\.\d{4,}/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/[\s,;:–—-]+$/, '')
    .trim();
}
// Tabs are kept: table cells arrive as "Label<TAB>value".
const tidy = (s: string) => s.replace(/[  \r\n\f\v]+/g, ' ').replace(/\t+/g, '\t').replace(/^[\s•●▪‣◦…\-–—*]+/, '').trim();

/**
 * A row from a two-column page ("Along Oba Akran Road<TAB>Size: 7m x 5m") is
 * two lines, one per column. A row that is itself "Label<TAB>value" stays whole.
 */
function splitColumns(lines: string[]): { lines: string[]; split: boolean } {
  let split = false;
  const out = lines.flatMap(l => {
    if (!l.includes('	') || splitLabel(l)) return [l];
    split = true;
    return l.split('	').map(tidy).filter(Boolean);
  });
  return { lines: out, split };
}

/**
 * Reads one slide. Returns null for slides that aren't a board (cover,
 * contact, terms): nothing that looks like a size, rate, GPS pin, format or
 * labelled location.
 */
/**
 * Board names and addresses are public. Never let a price or a size label
 * ride along in them ("Iyana<TAB>Annual Rate: N8,000,000.00"): prices are
 * private and sizes have their own fields.
 */
export function withoutPriceText(s: string): string {
  return s
    .replace(/\s*(annual(\s*rate)?|monthly(\s*(rental|rate))?|cost\s*per\s*(month|annum|year)|rate|rental|price)\s*:?\s*(₦|NGN|N)?\s?\d[\d,]*(\.\d+)?(\s*\/\s*face)?/gi, ' ')
    .replace(/\s*size\s*:\s*[\d.]+\s*m?\s*\(h\)\s*(by|x)\s*[\d.]+\s*m?\s*\(w\)/gi, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[\s,;:–—-]+$/, '')
    .trim();
}

export function extractBoard(rawLines: string[]): DeckRow | null {
  const cols = splitColumns(rawLines.map(tidy).filter(l => l.length > 0 && l.length < 400));
  const lines = cols.lines;
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
  // Monthly price: a monthly figure if the slide gives one, else a yearly
  // figure divided by 12, else whatever single price is on the slide.
  const both = findRates(text);
  const annual = both.annual ?? (got.rate_annual ? findRate(got.rate_annual, true) : null);
  const rate = both.monthly
    ?? (annual ? Math.round(annual / 12 / 1000) * 1000 : null)
    ?? findRate(got.rate ?? '', true) ?? findRate(text);
  let gps = got.gps ? findGps(got.gps) : null;
  if (!gps && got.lat && got.lng) gps = parseCoordinates(`${got.lat}, ${got.lng}`);
  gps = gps ?? findGps(text);
  const faces = findFaces(got.faces ? `${got.faces} faces` : text);

  // Title: the first line that isn't a label, a number-only line, or just a
  // format tag like "(GANTRY)" / "(EYE CATCHER)". GPS stuck on the end is cut off.
  // Among those, the line that reads most like a place wins (decks often put
  // the size and price above the location, or a company tagline on every slide).
  const usable = (l: string) => !splitLabel(l) && !NOT_A_TITLE.test(l) && !FORMAT_TAG.test(l) && /[a-z]{3,}/i.test(cleanTitle(l)) && !findSize(l) && l.length >= 6 && !looksLikePriceOrLabel(l);
  const placeScore = (l: string) => (PLACE_WORDS.test(l) ? 3 : 0) + (findCity(l) ? 2 : 0) + (l.length >= 25 ? 1 : 0);
  // An address split over two lines is read as one:
  // "Along Oba Akran Road" / "by Guinness FTT Agege, Lagos."
  const ok = lines.map(usable);
  // Two-column slides (address on one side, size and price on the other)
  // interleave the address's lines with labels: those pieces are read as one
  // address up to the line that ends it with a full stop.
  const switches = ok.filter((u, i) => i > 0 && u !== ok[i - 1]).length;
  const twoColumn = cols.split || switches >= 4;
  const candidates: string[] = [];
  if (twoColumn) {
    let run = '';
    lines.forEach((l, i) => {
      if (!ok[i]) return;
      // "Visibility: …", "PIXEL DIMENSION: …" are details, never the rest of an address.
      if (run && !/[.!?]$/.test(run) && !l.includes(':') && `${run} ${l}`.length <= 220) run = `${run} ${l}`;
      else { if (run) candidates.push(run); run = l; }
    });
    if (run) candidates.push(run);
  } else {
    for (let i = 0; i < lines.length; i++) {
      if (!ok[i]) continue;
      const next = lines[i + 1];
      const joins = next && ok[i + 1] && !/[.!?]$/.test(lines[i]) && `${lines[i]} ${next}`.length <= 220
        && (CONTINUES.test(next) || /^[a-z]/.test(next) || (PLACE_WORDS.test(lines[i]) && /[.]$/.test(next)));
      if (joins) { candidates.push(`${lines[i]} ${next}`); i++; } else candidates.push(lines[i]);
    }
  }
  const top = candidates.reduce<string | null>((best, c) => (best === null || placeScore(c) > placeScore(best) ? c : best), null);
  const title = cleanTitle(top ?? '').replace(/[\s.]+$/, '');
  const address = tidy(got.address ?? '') || title;
  let where = findCity(got.city ?? '') ?? cityAtEnd(address) ?? findCity(`${address}\n${text}`);
  // The slide's GPS settles it: "…FTT Gwagwalada, Lokoja" faces traffic to Lokoja but stands in Abuja.
  if (gps && !got.city) {
    const centre = where ? cityCentre(where.city) : null;
    const near = nearestCity(gps.lat, gps.lng);
    if (near && (!centre || Math.hypot(centre[0] - gps.lat, centre[1] - gps.lng) > 0.7)) {
      where = findCity(near) ?? where;
    }
  }
  const area = tidy(got.area ?? '') || areaHit(`${address}\n${text}`)?.area || '';

  const looksLikeBoard = !!(size || gps || rate || got.address || got.size || got.format || (format && address));
  if (!looksLikeBoard) return null;

  // A labelled location ("Location: Alfred Rewane Road, by Falomo Bridge") beats a guessed title.
  const labelled = cleanTitle(tidy(got.address ?? '')).replace(/[\s.]+$/, '');
  const name = tidy(got.name ?? '') || (/[a-z]{3,}/i.test(labelled) && labelled.length >= 6 ? labelled : '') || title || address;
  return {
    'Board Name': withoutPriceText(name).slice(0, 160),
    'Address': withoutPriceText(address).slice(0, 300),
    'City': where?.city || tidy(got.city ?? ''),
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
 * Lines that repeat across a deck (a tagline, "…SINCE 1976", "RHD"/"LHD"
 * arrows) say nothing about one board. Returns them so each slide can be
 * read without them. Format words ("Unipole", "Portrait") and labelled lines
 * are kept even when they repeat.
 */
export function deckBoilerplate(slides: string[][]): Set<string> {
  const key = boilerKey;
  // Each column of a two-column row counts on its own ("…SINCE 1976<TAB>LHD").
  const pieces = (lines: string[]) => lines.flatMap(l => (l.includes('\t') ? [l, ...l.split('\t')] : [l]));
  const counts = new Map<string, number>();
  for (const lines of slides) {
    for (const k of new Set(pieces(lines).map(key))) if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  // On a quarter of the slides, or on 8 or more (a tagline on one section of a long deck).
  const min = Math.max(3, Math.min(8, Math.ceil(slides.length * 0.25)));
  const out = new Set<string>();
  for (const lines of slides) {
    for (const l of pieces(lines)) {
      const k = key(l);
      if ((counts.get(k) ?? 0) < min || out.has(k)) continue;
      if (splitLabel(tidy(l)) || findFormat(l) || findSize(l) || findCity(l)) continue;
      out.add(k);
    }
  }
  return out;
}

/** A slide's lines without the deck's repeated lines. */
export function withoutBoilerplate(lines: string[], boilerplate: Set<string>): string[] {
  return lines
    .map(l => (l.includes('\t') && !boilerplate.has(boilerKey(l)) ? l.split('\t').filter(c => !boilerplate.has(boilerKey(c))).join('\t') : l))
    .filter(l => l.trim() && !boilerplate.has(boilerKey(l)));
}

function boilerKey(l: string): string {
  return tidy(l).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
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

// Nigerian mobile numbers: 0803 123 4567, 08031234567, +234 803 123 4567, 234-803-123-4567.
const PHONE_RE = /(?:\+?234[\s-]?|0)[789][01]\d(?:[\s-]?\d){7}/;

function tidyPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  const local = digits.startsWith('234') ? '0' + digits.slice(3) : digits;
  return local.length === 11 ? local : raw.trim();
}

/**
 * The sales contact a deck gives (usually on its last "Contact us" slide):
 * the first Nigerian mobile number, and a name from a "Contact person:" style
 * label if there is one. Slides are searched last-first.
 */
export function findContact(slides: string[][]): { name: string; phone: string } | null {
  for (const lines of [...slides].reverse()) {
    const text = lines.join('\n');
    const phone = text.match(PHONE_RE);
    if (!phone) continue;
    let name = '';
    for (const l of lines) {
      const m = l.match(/^\s*(?:contact(?:\s+person)?|sales(?:\s+(?:contact|rep|manager|executive))?|marketer|account\s+manager|name|call)\s*[:\-–]\s*(.+)$/i);
      if (!m) continue;
      const candidate = m[1].replace(PHONE_RE, '').replace(/\b(tel|phone|mobile|whatsapp|on|at)\b\s*[:.]?\s*$/i, '').replace(/[\s,;|/\-–—]+$/, '').trim();
      if (/^[A-Za-z][A-Za-z .'-]{1,60}$/.test(candidate) && !/@|www|\d/.test(candidate)) { name = candidate; break; }
    }
    return { name, phone: tidyPhone(phone[0]) };
  }
  return null;
}
