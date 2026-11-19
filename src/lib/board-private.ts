// Board fields anyone may read, and a loader for the private ones.
//
// Since migration 060 the database refuses contact_name, contact_phone and
// rate_card to normal users, so `select('*')` on boards fails. List these
// columns instead, and fetch the private fields with loadBoardPrivate(),
// which only returns them to admins, the board owner's team or the board's
// creator.

import { supabase } from './supabase';

// One string literal (not concatenated) so supabase-js can type the result.
export const BOARD_PUBLIC_COLUMNS = 'id, owner_id, name, address, latitude, longitude, width, height, format, asking_rate, status, created_at, state, city, print_width_mm, print_height_mm, face_count, illuminated, traffic_count, photo_urls, notes, available_from, partner_name, orientation, created_by, assigned_marketer_id, rate_visibility, verification_status, last_verified_at, source, area, availability_checked_at';

export type BoardPrivate = { contact_name: string | null; contact_phone: string | null; rate_card: unknown };

/** Private fields by board id. Boards the user may not see are simply absent. */
export async function loadBoardPrivate(ids: string[]): Promise<Record<string, BoardPrivate>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return {};
  let { data, error } = await supabase.rpc('board_private_fields', { p_ids: unique });
  if (error && /could not find the function|does not exist/i.test(error.message)) {
    // Migration 060 not run yet: the columns are still readable directly.
    ({ data, error } = await supabase.from('boards').select('id, contact_name, contact_phone, rate_card').in('id', unique));
  }
  if (error) {
    console.error('[board-private] load failed:', error.message);
    return {};
  }
  const out: Record<string, BoardPrivate> = {};
  for (const r of (data ?? []) as ({ id: string } & BoardPrivate)[]) {
    out[r.id] = { contact_name: r.contact_name, contact_phone: r.contact_phone, rate_card: r.rate_card };
  }
  return out;
}

/** Adds the private fields onto board rows (null where not allowed). */
export async function withBoardPrivate<T extends { id: string }>(rows: T[]): Promise<(T & BoardPrivate)[]> {
  const priv = await loadBoardPrivate(rows.map(r => r.id));
  const none: BoardPrivate = { contact_name: null, contact_phone: null, rate_card: null };
  return rows.map(r => ({ ...r, ...(priv[r.id] ?? none) }));
}
