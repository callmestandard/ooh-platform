// Finds boards in the inventory that are probably the same board listed twice
// (a deck uploaded again, a board added by hand and then imported…).
//
// Two boards are flagged when they share a photo, when their real pins are
// within 50 m and they're the same kind of board, or when they're in the same
// city with nearly the same name. Pairs an admin marked "not duplicates" are
// left out.

import { similarity, sameSize, metres, isCityCentrePin } from './import-match';

export type DupBoard = {
  id: string;
  name: string;
  city: string | null;
  format: string;
  width?: number | null;
  height?: number | null;
  latitude: number | null;
  longitude: number | null;
  photo_urls: string[] | null;
};

export type DupGroup = { ids: string[]; why: string };

/** The key a dismissed pair is stored under: the two ids, smaller first. */
export const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

const size = (b: DupBoard) => ({ width: b.width ?? null, height: b.height ?? null });
const hasSize = (b: DupBoard) => !!b.width && !!b.height;

/** Which way the face looks, from the name: "FTF" / "facing traffic from" vs "FTT" / "to", or "face 2". */
function facing(name: string): string | null {
  const s = name.toLowerCase();
  const face = s.match(/\bface\s*(\d)\b/);
  if (face) return 'face' + face[1];
  const dir = s.match(/\bft([ft])\b|facing\s+traffic\s+(from|to)\b|\btraffic\s+(from|to)\b/);
  if (!dir) return null;
  return dir[1] === 'f' || dir[2] === 'from' || dir[3] === 'from' ? 'from' : 'to';
}

function reason(a: DupBoard, b: DupBoard, aPin: boolean, bPin: boolean): string | null {
  const photos = new Set(a.photo_urls ?? []);
  if ((b.photo_urls ?? []).some(u => photos.has(u))) return 'Same photo';

  // Two faces of one structure are two listings, not a duplicate.
  const fa = facing(a.name), fb = facing(b.name);
  if (fa && fb && fa !== fb) return null;
  // Clearly different sizes: different boards.
  if (hasSize(a) && hasSize(b) && !sameSize(size(a), size(b))) return null;

  // A pin shared by different boards is common (an address found only to the
  // street), so a close pin counts only with the same size.
  if (aPin && bPin && hasSize(a) && hasSize(b)) {
    const m = metres(a.latitude!, a.longitude!, b.latitude!, b.longitude!);
    if (m <= 50) return m < 1 ? 'Same pin and size' : `Pins ${Math.round(m)} m apart, same size`;
  }

  const city = (x: DupBoard) => (x.city ?? '').trim().toLowerCase();
  if (city(a) && city(a) === city(b)) {
    const s = similarity(a.name, b.name);
    if (s >= 0.8) return 'Same name';
    if (s >= 0.7 && hasSize(a) && hasSize(b)) return 'Similar name, same size';
  }
  return null;
}

export function findDuplicateGroups(boards: DupBoard[], dismissed: Set<string>): DupGroup[] {
  const pinned = boards.map(b => b.latitude != null && b.longitude != null && !isCityCentrePin(b.latitude, b.longitude, b.city));
  const parent = boards.map((_, i) => i);
  const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i])));
  const why = new Map<number, string>();

  for (let i = 0; i < boards.length; i++) {
    for (let j = i + 1; j < boards.length; j++) {
      if (dismissed.has(pairKey(boards[i].id, boards[j].id))) continue;
      const r = reason(boards[i], boards[j], pinned[i], pinned[j]);
      if (!r) continue;
      const a = root(i), b = root(j);
      if (a !== b) parent[b] = a;
      // The group shows the first reason found for it.
      why.set(a, why.get(a) ?? why.get(b) ?? r);
    }
  }

  const groups = new Map<number, number[]>();
  boards.forEach((_, i) => groups.set(root(i), [...(groups.get(root(i)) ?? []), i]));
  return [...groups.entries()]
    .filter(([, members]) => members.length > 1)
    .map(([r, members]) => ({ ids: members.map(i => boards[i].id), why: why.get(r) ?? 'Look alike' }));
}
