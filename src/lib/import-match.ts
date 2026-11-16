// Finds boards that are already on the platform when a deck or sheet is
// imported, so a re-upload updates them instead of adding copies, and a board
// someone else listed is not added twice without asking.
//
// Signals, strongest first:
//   1. The same photo (a small fingerprint survives resizing and re-saving).
//   2. The same spot: pins within 50 m and the same type or size.
//   3. The same name or address in the same city.
//   4. Re-uploading an earlier import: boards left over from it are paired by
//      city + size + type when that pairing is unambiguous.

import { cityCentre } from '@/lib/geocode-board';

export type Candidate = {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  format: string | null;
  width: number | null;
  height: number | null;
  latitude: number | null;
  longitude: number | null;
  photo_urls: string[] | null;
  owner_id: string | null;
  source?: string | null;
};

export type MatchRow = {
  _id: string;
  name: string;
  address: string;
  city: string;
  format: string;
  width: number | null;
  height: number | null;
  latitude: number | null;
  longitude: number | null;
  /** Fingerprint of the row's photo, if it has one. */
  print?: string | null;
};

export type Match = {
  id: string;
  name: string;
  city: string;
  /** Why we think it is the same board, in plain words. */
  why: string;
  /** True when this user may update that board (their own, or any for our team). */
  canUpdate: boolean;
  photo: string | null;
};

const STOP = new Set(['the', 'and', 'by', 'at', 'of', 'along', 'road', 'rd', 'street', 'str', 'opposite', 'opp', 'beside', 'near', 'ftt', 'ftf', 'facing', 'in', 'on', 'to', 'state', 'nigeria']);
const wordsOf = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter(w => w.length > 1 && !STOP.has(w));

/** 0–1: how many of the meaningful words two names share. */
export function similarity(a: string, b: string): number {
  const A = new Set(wordsOf(a)), B = new Set(wordsOf(b));
  if (A.size < 2 || B.size < 2) return 0;
  let both = 0;
  for (const w of A) if (B.has(w)) both++;
  return both / Math.min(A.size, B.size) * (both / Math.max(A.size, B.size)) ** 0.25;
}

/** Same size in either orientation (7×5 is 5×7), within 5%. */
export function sameSize(a: { width: number | null; height: number | null }, b: { width: number | null; height: number | null }): boolean {
  if (!a.width || !a.height || !b.width || !b.height) return false;
  const close = (x: number, y: number) => Math.abs(x - y) <= Math.max(x, y) * 0.05;
  return (close(a.width, b.width) && close(a.height, b.height)) || (close(a.width, b.height) && close(a.height, b.width));
}

export function metres(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000, r = Math.PI / 180;
  const dLat = (bLat - aLat) * r, dLng = (bLng - aLng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** True when a pin is only the middle of its city (an old fallback, not the board's spot). */
export function isCityCentrePin(lat: number | null, lng: number | null, city: string | null): boolean {
  if (lat == null || lng == null || !city) return false;
  const c = cityCentre(city);
  return !!c && metres(lat, lng, c[0], c[1]) < 300;
}

const sameCity = (a: string | null, b: string | null) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

// ── Photo fingerprints ───────────────────────────────────────────────────────

/**
 * A 64-bit fingerprint of a picture (difference hash): the photo shrunk to
 * 9×8 grey pixels, one bit per "is this pixel brighter than its neighbour".
 * The same photo gives nearly the same bits after resizing or re-saving.
 */
export async function photoPrint(src: Blob | string): Promise<string | null> {
  try {
    let bmp: ImageBitmap;
    if (typeof src === 'string') {
      const res = await fetch(src, { mode: 'cors' });
      if (!res.ok) return null;
      bmp = await createImageBitmap(await res.blob());
    } else {
      bmp = await createImageBitmap(src);
    }
    const canvas = document.createElement('canvas');
    canvas.width = 9; canvas.height = 8;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(bmp, 0, 0, 9, 8);
    bmp.close();
    const px = ctx.getImageData(0, 0, 9, 8).data;
    const grey = (x: number, y: number) => { const i = (y * 9 + x) * 4; return px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114; };
    let bits = '';
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits += grey(x, y) > grey(x + 1, y) ? '1' : '0';
    return bits;
  } catch {
    return null;
  }
}

export function printDistance(a: string, b: string): number {
  let d = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
  return d;
}

// ── Matching ─────────────────────────────────────────────────────────────────

/**
 * Pairs each import row with at most one existing board, and each board with
 * at most one row.
 *
 * `prints` holds fingerprints of existing boards' main photos (by board id).
 * `previous` is the set of boards from an earlier upload being replaced; its
 * leftovers may be paired by city + size + type.
 */
export function findMatches(
  rows: MatchRow[],
  candidates: Candidate[],
  opts: { prints: Map<string, string>; canUpdate: (c: Candidate) => boolean; previous?: Set<string> },
): Map<string, Match> {
  const out = new Map<string, Match>();
  const taken = new Set<string>();
  const byId = new Map(candidates.map(c => [c.id, c]));
  const give = (row: MatchRow, c: Candidate, why: string) => {
    out.set(row._id, { id: c.id, name: c.name, city: c.city ?? '', why, canUpdate: opts.canUpdate(c), photo: c.photo_urls?.[0] ?? null });
    taken.add(c.id);
  };

  // 1. Same photo. Closest pairs first so a near-copy can't steal the exact one.
  const photoPairs: { row: MatchRow; c: Candidate; d: number }[] = [];
  for (const row of rows) {
    if (!row.print) continue;
    for (const [id, print] of opts.prints) {
      const d = printDistance(row.print, print);
      if (d <= 6) photoPairs.push({ row, c: byId.get(id)!, d });
    }
  }
  photoPairs.sort((a, b) => a.d - b.d);
  for (const { row, c } of photoPairs) {
    if (!c || out.has(row._id) || taken.has(c.id)) continue;
    give(row, c, 'Same photo');
  }

  // 2 and 3. Same spot, then same name or address in the same city.
  for (const row of rows) {
    if (out.has(row._id)) continue;
    let best: { c: Candidate; score: number; why: string } | null = null;
    for (const c of candidates) {
      if (taken.has(c.id)) continue;
      const realPins = row.latitude != null && row.longitude != null && c.latitude != null && c.longitude != null
        && !isCityCentrePin(c.latitude, c.longitude, c.city) && !isCityCentrePin(row.latitude, row.longitude, row.city);
      if (realPins) {
        const m = metres(row.latitude!, row.longitude!, c.latitude!, c.longitude!);
        if (m <= 50 && (c.format === row.format || sameSize(row, c))) {
          const score = 100 - m;
          if (score > (best?.score ?? 0)) best = { c, score, why: `Pin ${Math.round(m)} m away, same ${c.format === row.format ? 'type' : 'size'}` };
          continue;
        }
      }
      if (!sameCity(row.city, c.city)) continue;
      const s = Math.max(similarity(row.name, c.name), similarity(row.address || row.name, c.address || c.name));
      const need = sameSize(row, c) ? 0.6 : 0.8;
      if (s >= need) {
        const score = s * 40 + (sameSize(row, c) ? 5 : 0);
        if (score > (best?.score ?? 0)) best = { c, score, why: s >= 0.95 ? 'Same name' : 'Similar name' };
      }
    }
    if (best) give(row, best.c, best.why);
  }

  // 4. Leftovers of an earlier upload being replaced: pair when a city + size
  //    + type group has the same number of rows and boards (any order is fine,
  //    those boards differ in nothing else we know).
  if (opts.previous?.size) {
    const key = (x: { city: string | null; format: string | null; width: number | null; height: number | null }) => {
      const [a, b] = [x.width ?? 0, x.height ?? 0].sort((p, q) => p - q);
      return `${(x.city ?? '').toLowerCase()}|${x.format ?? ''}|${a}x${b}`;
    };
    const left = candidates.filter(c => opts.previous!.has(c.id) && !taken.has(c.id));
    const groups = new Map<string, { rows: MatchRow[]; boards: Candidate[] }>();
    for (const row of rows) if (!out.has(row._id) && row.width && row.height) {
      const k = key(row); const g = groups.get(k) ?? { rows: [], boards: [] }; g.rows.push(row); groups.set(k, g);
    }
    for (const c of left) { const g = groups.get(key(c)); if (g) g.boards.push(c); }
    for (const g of groups.values()) {
      if (!g.boards.length || g.rows.length !== g.boards.length) continue;
      g.rows.forEach((row, i) => give(row, g.boards[i], 'Same city, size and type from the earlier upload'));
    }
  }
  return out;
}
