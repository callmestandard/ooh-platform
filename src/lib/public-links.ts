// Readable public links for boards and cities, and the team's WhatsApp line.

const UUID_AT_END = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

export function toSlug(text: string) {
  return text.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function citySlug(city: string) {
  return toSlug(city);
}

/** "/boards/unipole-at-ring-road-ibadan-<id>". Old "/boards/<id>" links still work. */
export function boardPath(board: { id: string; name?: string | null; city?: string | null }) {
  const name = toSlug(board.name ?? '');
  const city = toSlug(board.city ?? '');
  // Skip the city when the name already ends with it.
  const words = name && city && !name.endsWith(city) ? `${name}-${city}` : name || city;
  let slug = words;
  if (slug.length > 80) {
    slug = slug.slice(0, 80);
    const cut = slug.lastIndexOf('-');
    if (cut > 40) slug = slug.slice(0, cut); // don't end mid-word
  }
  slug = slug.replace(/-+$/, '');
  return `/boards/${slug ? `${slug}-` : ''}${board.id}`;
}

/** The board id from a "/boards/[id]" param, readable or not. */
export function boardIdFromParam(param: string | string[] | undefined): string | null {
  const p = Array.isArray(param) ? param[0] : param;
  if (!p) return null;
  return decodeURIComponent(p).match(UUID_AT_END)?.[1] ?? null;
}

// The platform team's WhatsApp number (not a board owner's: buyers deal
// with owners through the platform). NEXT_PUBLIC_WHATSAPP_NUMBER overrides
// the default; local (080…) or international (234…) form both work.
const DEFAULT_TEAM_WHATSAPP = '08156648786';
export const TEAM_WHATSAPP = (process.env.NEXT_PUBLIC_WHATSAPP_NUMBER || DEFAULT_TEAM_WHATSAPP).replace(/\D/g, '').replace(/^0/, '234');

export function teamWhatsAppLink(message: string) {
  return TEAM_WHATSAPP ? `https://wa.me/${TEAM_WHATSAPP}?text=${encodeURIComponent(message)}` : null;
}
