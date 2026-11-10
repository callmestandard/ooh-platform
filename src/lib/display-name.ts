// Board names often arrive in ALL CAPS from owners' decks ("IFE ROAD BY BOVAS
// FILLING STATION"). Show them in normal capitals without changing the data.

const KEEP_UPPER = new Set([
  'FTF', 'FTT', 'LED', 'GRA', 'FCT', 'UBA', 'GTB', 'GT', 'NNPC', 'CMS', 'VI', 'UI', 'UNN', 'UNILAG', 'LASU', 'OAU', 'FUTA',
  'II', 'III', 'IV', 'PH', 'NTA', 'MTN', 'KFC', 'CBN', 'NAF', 'NPA', 'LUTH', 'UCH', 'ATM', 'BRT', 'LCC', 'FHA', 'NYSC',
  'NW', 'NE', 'SW', 'SE', 'MM', 'MMIA', 'NAA', 'NITEL', 'PHCN', 'SBS', 'DHL', 'UPS', 'ABC', 'CRS',
]);
const SMALL = new Set(['by', 'of', 'the', 'at', 'and', 'on', 'in', 'to', 'opp', 'off', 'for', 'from', 'with', 'via', 'near', 'beside', 'facing', 'along', 'into', 'before', 'after', 'opposite', 'b4']);

function isShouty(s: string) {
  const letters = s.replace(/[^A-Za-z]/g, '');
  if (letters.length < 4) return false;
  const upper = letters.replace(/[^A-Z]/g, '').length;
  return upper / letters.length > 0.75;
}

export function displayName(name: string | null | undefined): string {
  const s = (name ?? '').trim().replace(/\s+/g, ' ');
  if (!isShouty(s)) return s;
  let first = true;
  return s.split(' ').map(word => {
    // Keep punctuation around the word: "(OPP", "STATION," …
    const m = word.match(/^([^A-Za-z0-9]*)(.*?)([^A-Za-z0-9]*)$/);
    if (!m) return word;
    const [, pre, core, post] = m;
    if (!core) return word;
    let out: string;
    const upper = core.toUpperCase();
    if (KEEP_UPPER.has(upper) || /\d/.test(core) && core.length <= 4) out = upper;
    else if (!first && SMALL.has(core.toLowerCase()) && !/[:(]$/.test(pre)) out = core.toLowerCase();
    else out = core.toLowerCase().replace(/(^|[-/'.])([a-z])/g, (_, a, b) => a + b.toUpperCase());
    first = /[:–—-]$/.test(post) || post.includes('(');
    return pre + out + post;
  }).join(' ');
}
