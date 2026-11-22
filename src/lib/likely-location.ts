// "Most likely here" links: a Google Maps search built from a board's own address.
// Only a link out (Google is never embedded or stored). The result is where Google
// thinks that address is, so it is always labelled "most likely", never verified.
//
// Deck terms: FTF = facing traffic from, FTT = facing traffic to (FTF/T = both).
// The places after them say which traffic the board faces, not where it stands,
// so the board's spot is the text before them.

type Where = { name?: string | null; address?: string | null; area?: string | null; city?: string | null; state?: string | null };

export type Likely = {
  kind: 'spot' | 'route';  // spot: a place search; route: the road between the places it faces
  url: string;
  text: string;            // what was searched, for display
  facing: string | null;   // e.g. "Faces traffic to Ikeja, Dopemu"
};

const FACING = /\b(direction(\s+of\s+traffic)?|facing(\s+the)?\s+traffic(\s+coming)?(\s+(from|to))?|ftf(\s*\/\s*t)?|ftt(\s*\/\s*f)?|lftt)\b/i;
const SIDE = /\b(lhd|rhd|lhs|rhs)\b/gi;

/** Splits "Jubilee bridge FTF/T Iyana" into the spot and the facing note. */
function splitFacing(s: string): { before: string; after: string; dir: 'from' | 'to' | 'both' | null } {
  const m = s.match(FACING);
  if (!m || m.index === undefined) return { before: s, after: '', dir: null };
  const word = m[0].toLowerCase();
  let after = s.slice(m.index + m[0].length);
  // "DIRECTION OF TRAFFIC: FTF BANEX": the real term follows the label.
  const inner = after.match(/^\s*:?\s*(ftf(\s*\/\s*t)?|ftt(\s*\/\s*f)?|from|to)\b/i);
  const term = inner ? inner[1].toLowerCase() : word;
  if (inner) after = after.slice(inner[0].length);
  const dir = /\//.test(term) ? 'both' : /ftf|from/.test(term) ? 'from' : /ftt|lftt|to/.test(term) ? 'to' : null;
  return { before: s.slice(0, m.index), after: after.replace(/^\s*:?\s*/, ''), dir };
}

/** Removes deck shorthand that confuses a map search. */
export function cleanPlaceText(s: string | null | undefined): string {
  return (s ?? '')
    // "This board is a few meters away from Banex Junction; it is…" → "Banex Junction"
    .replace(/^(this|the) (board|site|billboard) is\s+(located\s+)?(a\s+)?(few\s+meters?\s+away\s+from|just\s+(after|before)|close\s+to|near|at|on|along|by|beside|opposite)?\s*/i, '')
    .replace(/[;.].*$/, '')
    .replace(SIDE, ' ')
    .replace(/\(.*?\)/g, ' ')
    .replace(/^\s*(portrait|landscape|unipole|gantry|billboard|wall drape|led( screen)?|bridge panel)\b\s*[-:]?\s*/i, '')
    .replace(/\b\d+(\.\d+)?\s*(m|ft|x|by)\s*\d+(\.\d+)?\s*(m|ft)?\b/gi, ' ')
    .replace(/\s+,/g, ',')
    .replace(/,\s*(,\s*)+/g, ', ')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s,.:;/-]+|[\s,.:;/-]+$/g, '')
    .trim();
}

const isDescription = (s: string) => /^(this|the) (board|site|billboard)\b/i.test(s);
const titleCase = (s: string) => s === s.toUpperCase() ? s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase()) : s;

/** The places a board faces: "Ikeja, Iyana ipaja and Dopemu" → three places. */
function facingPlaces(after: string): string[] {
  return after.replace(SIDE, ' ').replace(/\bV\s*\/\s*I(sland)?\b/gi, 'Victoria Island').replace(/[;.].*$/, '').split(/,|\/|\band\b|&/i)
    .map(p => p.replace(/\s{2,}/g, ' ').replace(/^[\s:-]+|[\s:-]+$/g, '').trim())
    .filter(p => p.length >= 3 && !FACING.test(p) && !/^(beyond|others?|etc|environs)$/i.test(p));
}

function withTown(main: string, b: Where): string {
  const parts = [main, b.area, b.city, b.state].map(x => (x ?? '').trim()).filter(Boolean);
  const seen: string[] = [];
  const uniq = parts.filter(p => { const k = p.toLowerCase(); if (seen.some(s => s.includes(k))) return false; seen.push(k); return true; });
  return [...uniq, 'Nigeria'].join(', ');
}

const splitTexts = (b: Where) => [b.address, b.name].map(t => (t ?? '').trim()).filter(Boolean).map(t => ({ t, ...splitFacing(t) }));

/** The traffic a board faces, from the owner's FTF/FTT note, plus the places it names. */
function facingOf(split: ReturnType<typeof splitTexts>): { text: string | null; places: string[] } {
  const facingFrom = split.find(x => x.dir && facingPlaces(x.after).length);
  const places = facingFrom ? facingPlaces(facingFrom.after).map(titleCase) : [];
  // Some imported names stop mid-place ("FTF Outer", "FTF Third"): leave those words out of the sentence.
  const shown = places.filter(p => !HALF_PLACE.test(p));
  if (!facingFrom || !shown.length) return { text: null, places };
  return { text: facingSentence(facingFrom.dir, shown), places };
}

const HALF_PLACE = /^(outer|inner|third|state|national|iyana|nnamdi|old|new|upper|lower|federal|first|second|ahmadu|obafemi|murtala)$/i;

function facingSentence(dir: 'from' | 'to' | 'both' | null, places: string[]): string {
  const list = places.slice(0, 4).join(', ') + (places.length > 4 ? ' and more' : '');
  const way = dir === 'from' ? 'coming from' : dir === 'to' ? 'going to' : 'to and from';
  return `Faces traffic ${way} ${list}`;
}

/** "Faces traffic coming from Ife": the owner's FTF/FTT note in plain words, or null. */
export const facingText = (b: Where): string | null => facingOf(splitTexts(b)).text;

export function likelyLocation(b: Where): Likely | null {
  const town = [b.area, b.city, b.state].map(x => (x ?? '').trim().toLowerCase());
  const useful = (s: string) => s.length >= 8 && !town.includes(s.toLowerCase());
  const split = splitTexts(b);
  const { text: facing, places } = facingOf(split);

  // 1. The board's own spot: the text before FTF/FTT, address first unless it's a description.
  const spots = split.map(x => ({ raw: x.t, spot: cleanPlaceText(x.before) })).filter(x => useful(x.spot));
  const pick = spots.find(x => !isDescription(x.raw)) ?? spots[0];
  if (pick) {
    const text = withTown(pick.spot, b);
    return { kind: 'spot', url: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(text)}`, text, facing };
  }

  // 2. Only a facing list: the board stands on the road between those places.
  if (places.length >= 2) {
    const a = withTown(places[0], b), z = withTown(places[places.length - 1], b);
    return {
      kind: 'route',
      url: `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(a)}&destination=${encodeURIComponent(z)}&travelmode=driving`,
      text: `${places[0]} → ${places[places.length - 1]}`,
      facing,
    };
  }
  if (places.length === 1 && places[0].length >= 4) {
    const text = withTown(places[0], b);
    return { kind: 'spot', url: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(text)}`, text, facing };
  }
  return null;
}

/** Kept for callers that only need the link or the search text. */
export const likelyLocationUrl = (b: Where) => likelyLocation(b)?.url ?? null;
export const likelyPlaceQuery = (b: Where) => likelyLocation(b)?.text ?? null;
