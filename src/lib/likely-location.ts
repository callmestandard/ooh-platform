// "Most likely here" links: a Google Maps search built from a board's own address.
// Only a link out (Google is never embedded or stored). The result is where Google
// thinks that address is, so it is always labelled "most likely", never verified.

type Where = { name?: string | null; address?: string | null; area?: string | null; city?: string | null; state?: string | null };

/** Removes deck shorthand that confuses a map search: facing-traffic notes, LHD/RHD, sizes. */
export function cleanPlaceText(s: string | null | undefined): string {
  return (s ?? '')
    // "This board is a few meters away from Banex Junction; it is facing…" → "Banex Junction"
    .replace(/^(this|the) (board|site|billboard) is\s+(located\s+)?(a\s+)?(few\s+meters?\s+away\s+from|just\s+(after|before)|close\s+to|near|at|on|along|by|beside|opposite)?\s*/i, '')
    .replace(/[;.].*$/, '')
    // Shorthand for which traffic it faces. The place after it stays: it is near the board.
    .replace(/\b(direction( of traffic)?|facing( the)? traffic( coming)?( from| to)?|ftf\/?t?|ftt\/?f?|lftt|lhd|rhd|lhs|rhs)\b\s*:?/gi, ' ')
    .replace(/\(.*?\)/g, ' ')
    .replace(/^\s*(portrait|landscape|unipole|gantry|billboard|wall drape|led( screen)?|bridge panel)\b\s*[-:]?\s*/i, '')
    .replace(/\b\d+(\.\d+)?\s*(m|ft|x|by)\s*\d+(\.\d+)?\s*(m|ft)?\b/gi, ' ')
    .replace(/\s+,/g, ',')
    .replace(/,\s*(,\s*)+/g, ', ')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s,.:;-]+|[\s,.:;-]+$/g, '')
    .trim();
}

const isDescription = (s: string) => /^(this|the) (board|site|billboard)\b/i.test(s);

/** The search text: the clearer of address and name, plus area, city and state.
 *  Null when neither says more than a city, so there's nothing to search for. */
export function likelyPlaceQuery(b: Where): string | null {
  const addr = cleanPlaceText(b.address), name = cleanPlaceText(b.name);
  const town = [b.area, b.city, b.state].map(x => (x ?? '').trim().toLowerCase());
  const useful = (s: string) => s.length >= 8 && !town.includes(s.toLowerCase()) && !/^[^,]+, (lagos|abuja|ibadan)$/i.test(s);
  const main = useful(addr) && !isDescription(addr) ? addr : useful(name) ? name : useful(addr) ? addr : null;
  if (!main) return null;
  const parts = [main, b.area, b.city, b.state].map(x => (x ?? '').trim()).filter(Boolean);
  const seen = new Set<string>();
  const uniq = parts.filter(p => { const k = p.toLowerCase(); if ([...seen].some(s => s.includes(k))) return false; seen.add(k); return true; });
  return [...uniq, 'Nigeria'].join(', ');
}

export function likelyLocationUrl(b: Where): string | null {
  const q = likelyPlaceQuery(b);
  return q ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}` : null;
}
