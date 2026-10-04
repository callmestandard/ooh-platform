/**
 * Agency vendor preferences: an agency's private marking of media owners as
 * preferred, direct or excluded. Requires
 * supabase/migrations/036_vendor_preferences_makegoods.sql — RLS there lets
 * an agency read and write only its own rows; nobody else can read them.
 *
 * Preferences affect discovery and shortlisting ONLY. Existing bookings and
 * direct board links are never touched.
 */

import { supabase } from './supabase';

export type VendorPreference = 'preferred' | 'direct' | 'excluded';

export const VENDOR_PREFERENCE_LABELS: Record<VendorPreference, string> = {
  preferred: 'Preferred',
  direct: 'Direct relationship',
  excluded: 'Excluded',
};

export const VENDOR_PREFERENCE_STYLE: Record<VendorPreference, { bg: string; color: string }> = {
  preferred: { bg: '#ECFDF5', color: '#065F46' },
  direct:    { bg: '#EFF6FF', color: '#1E3A8A' },
  excluded:  { bg: '#FEF2F2', color: '#991B1B' },
};

export type MediaPartner = { owner_id: string; owner_name: string; board_count: number; preference: VendorPreference | null; notes: string | null };

export type BoardPreferences = {
  /** board id → this agency's preference for the board's owner */
  byBoard: Record<string, VendorPreference>;
  /** board id → owner account id, for boards whose owner has a preference */
  ownerOfBoard: Record<string, string>;
  excludedOwnerCount: number;
};

const EMPTY: BoardPreferences = { byBoard: {}, ownerOfBoard: {}, excludedOwnerCount: 0 };

/** The signed-in agency's preferences, resolved to boards. Empty for any other role. */
export async function fetchBoardPreferences(): Promise<BoardPreferences> {
  const { data, error } = await supabase.rpc('agency_board_preferences');
  if (error || !data) return EMPTY; // not an agency, or migration 036 not applied
  const rows = data as { board_id: string; owner_id: string; preference: VendorPreference }[];
  const byBoard: Record<string, VendorPreference> = {};
  const ownerOfBoard: Record<string, string> = {};
  rows.forEach(r => { byBoard[r.board_id] = r.preference; ownerOfBoard[r.board_id] = r.owner_id; });
  const { count } = await supabase.from('agency_vendor_preferences').select('id', { count: 'exact', head: true }).eq('preference', 'excluded');
  return { byBoard, ownerOfBoard, excludedOwnerCount: count ?? 0 };
}

/**
 * Apply this agency's preferences to a discovery list: excluded owners'
 * boards are left out, preferred owners' boards come first, and each
 * remaining board carries its marker in `vendor_preference`.
 */
export function applyVendorPreferences<T extends { id: string }>(boards: T[], prefs: BoardPreferences): (T & { vendor_preference?: VendorPreference })[] {
  const kept = boards
    .filter(b => prefs.byBoard[b.id] !== 'excluded')
    .map(b => (prefs.byBoard[b.id] ? { ...b, vendor_preference: prefs.byBoard[b.id] } : b));
  // stable: preferred first, everything else keeps its existing order
  return [...kept.filter(b => prefs.byBoard[b.id] === 'preferred'), ...kept.filter(b => prefs.byBoard[b.id] !== 'preferred')];
}

export async function listMediaPartners(): Promise<{ partners: MediaPartner[]; error: string | null }> {
  const { data, error } = await supabase.rpc('agency_media_partners');
  return { partners: (data ?? []) as MediaPartner[], error: error?.message ?? null };
}

/** Set (or with null, clear) the preference for one owner. A new value replaces the old one. */
export async function setVendorPreference(ownerId: string, preference: VendorPreference | null, notes?: string | null): Promise<{ error: string | null }> {
  if (preference === null) {
    const { error } = await supabase.from('agency_vendor_preferences').delete().eq('owner_id', ownerId);
    return { error: error?.message ?? null };
  }
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { error: 'Not signed in' };
  const row: Record<string, unknown> = { agency_id: session.user.id, owner_id: ownerId, preference };
  if (notes !== undefined) row.notes = notes?.trim() || null;
  const { error } = await supabase.from('agency_vendor_preferences').upsert(row, { onConflict: 'agency_id,owner_id' });
  return { error: error?.message ?? null };
}

/** The owner account behind a board (direct owner, or the owner who confirmed an agent's authorization). */
export async function boardOwnerAccount(boardId: string): Promise<string | null> {
  const { data } = await supabase.rpc('board_owner_account', { p_board_id: boardId });
  return (data as string | null) ?? null;
}

/** This agency's current preference for one owner, if any. */
export async function fetchPreferenceFor(ownerId: string): Promise<VendorPreference | null> {
  const { data } = await supabase.from('agency_vendor_preferences').select('preference').eq('owner_id', ownerId).maybeSingle();
  return ((data as { preference?: VendorPreference } | null)?.preference) ?? null;
}
