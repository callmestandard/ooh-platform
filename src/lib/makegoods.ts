/**
 * Makegood tracking: what an owner promised when a board fell through or
 * under-delivered, and whether it was delivered. Requires
 * supabase/migrations/036_vendor_preferences_makegoods.sql, where the rules
 * live (who may change which field; a history row for every change).
 *
 * A makegood is a record only. Nothing here changes a negotiated rate, an
 * invoice or an MPO — a credit is an amount the agency applies by hand.
 */

import { supabase } from './supabase';

export type MakegoodReason = 'board_unavailable' | 'late_posting' | 'wrong_or_damaged_creative' | 'poor_condition' | 'other';
export type MakegoodRemedy = 'replacement_board' | 'extension' | 'credit' | 'other';
export type MakegoodStatus = 'promised' | 'delivered' | 'partially_delivered' | 'disputed' | 'waived';

export const MAKEGOOD_REASON_LABELS: Record<MakegoodReason, string> = {
  board_unavailable: 'Board unavailable',
  late_posting: 'Late posting',
  wrong_or_damaged_creative: 'Wrong or damaged creative',
  poor_condition: 'Poor condition',
  other: 'Other',
};
export const MAKEGOOD_REMEDY_LABELS: Record<MakegoodRemedy, string> = {
  replacement_board: 'Replacement board',
  extension: 'Extension',
  credit: 'Credit',
  other: 'Other',
};
export const MAKEGOOD_STATUS_LABELS: Record<MakegoodStatus, string> = {
  promised: 'Promised',
  delivered: 'Delivered',
  partially_delivered: 'Partially delivered',
  disputed: 'Disputed',
  waived: 'Waived',
};
export const MAKEGOOD_STATUS_STYLE: Record<MakegoodStatus, { bg: string; color: string }> = {
  promised:            { bg: '#FFFBEB', color: '#92400E' },
  delivered:           { bg: '#ECFDF5', color: '#065F46' },
  partially_delivered: { bg: '#EFF6FF', color: '#1E3A8A' },
  disputed:            { bg: '#FEF2F2', color: '#991B1B' },
  waived:              { bg: '#F1F5F9', color: '#475569' },
};

export type Makegood = {
  id: string;
  booking_id: string;
  campaign_id: string | null;
  reason: MakegoodReason;
  promised_by_owner_id: string | null;
  promised_remedy_type: MakegoodRemedy;
  promised_detail: string | null;
  promised_value: number | null;
  promised_on: string;
  due_by: string | null;
  status: MakegoodStatus;
  delivered_on: string | null;
  notes: string | null;
  owner_notes: string | null;
  replacement_board_id: string | null;
  replacement_booking_id: string | null;
  credit_applied_at: string | null;
  updated_by_name: string | null;
  updated_by_side: 'agency' | 'owner' | 'admin' | null;
  created_at: string;
  updated_at: string;
  bookings?: { id: string; board_id: string; boards: { name: string; city: string | null } | null; campaigns?: { name: string } | null } | null;
  replacement_board?: { name: string } | null;
};

const COLS = '*, bookings!makegoods_booking_id_fkey(id, board_id, boards(name, city), campaigns(name)), replacement_board:boards!makegoods_replacement_board_id_fkey(name)';
const err = (e: { message: string } | null) => e?.message ?? null;

/** Still owed: promised, partly delivered or in dispute. */
export const isUnresolved = (m: Pick<Makegood, 'status'>) => m.status === 'promised' || m.status === 'partially_delivered' || m.status === 'disputed';
/** Unresolved and past its due date. */
export const isOverdue = (m: Pick<Makegood, 'status' | 'due_by'>, today = new Date().toISOString().slice(0, 10)) => isUnresolved(m) && !!m.due_by && m.due_by < today;
/** A credit the agency has not yet applied by hand. */
export const isUnappliedCredit = (m: Pick<Makegood, 'promised_remedy_type' | 'promised_value' | 'status' | 'credit_applied_at'>) =>
  m.promised_remedy_type === 'credit' && !!m.promised_value && m.status !== 'waived' && !m.credit_applied_at;

/** Every makegood the caller is a party to (RLS: the booking's agency, or the owner side for its boards). */
export async function listMakegoods(): Promise<{ makegoods: Makegood[]; error: string | null }> {
  const { data, error } = await supabase.from('makegoods').select(COLS).order('created_at', { ascending: false });
  return { makegoods: (data ?? []) as unknown as Makegood[], error: err(error) };
}

export async function listMakegoodsForBookings(bookingIds: string[]): Promise<Makegood[]> {
  if (bookingIds.length === 0) return [];
  const { data } = await supabase.from('makegoods').select(COLS).in('booking_id', bookingIds);
  return (data ?? []) as unknown as Makegood[];
}

export async function listMakegoodsForCampaigns(campaignIds: string[]): Promise<Makegood[]> {
  if (campaignIds.length === 0) return [];
  const { data } = await supabase.from('makegoods').select(COLS).in('campaign_id', campaignIds);
  return (data ?? []) as unknown as Makegood[];
}

export type MakegoodInput = {
  bookingId: string;
  reason: MakegoodReason;
  remedy: MakegoodRemedy;
  detail?: string | null;
  value?: number | null;
  dueBy?: string | null;
  notes?: string | null;
  replacementBoardId?: string | null;
  replacementBookingId?: string | null;
};

export async function createMakegood(input: MakegoodInput): Promise<{ makegood: Makegood | null; error: string | null }> {
  const { data, error } = await supabase.from('makegoods').insert({
    booking_id: input.bookingId,
    reason: input.reason,
    promised_remedy_type: input.remedy,
    promised_detail: input.detail?.trim() || null,
    promised_value: input.value && input.value > 0 ? input.value : null,
    due_by: input.dueBy || null,
    notes: input.notes?.trim() || null,
    replacement_board_id: input.replacementBoardId ?? null,
    replacement_booking_id: input.replacementBookingId ?? null,
  }).select(COLS).single();
  return { makegood: (data as unknown as Makegood) ?? null, error: err(error) };
}

/** One-click makegood from an approved board swap, prefilled from the swap itself. */
export function makegoodFromSwap(original: { id: string; boardName: string }, replacement: { id: string; boardId: string; boardName: string }): MakegoodInput {
  return {
    bookingId: original.id,
    reason: 'board_unavailable',
    remedy: 'replacement_board',
    detail: `${original.boardName} replaced by ${replacement.boardName}`,
    replacementBoardId: replacement.boardId,
    replacementBookingId: replacement.id,
  };
}

async function patch(id: string, changes: Record<string, unknown>): Promise<{ error: string | null }> {
  const { error } = await supabase.from('makegoods').update(changes).eq('id', id);
  return { error: err(error) };
}

export const setMakegoodStatus = (id: string, status: MakegoodStatus) => patch(id, { status });
/** Agency only (the database rejects it from the owner side). */
export const setAgencyNotes = (id: string, notes: string) => patch(id, { notes: notes.trim() || null });
/** Owner side only (the database rejects it from the agency). */
export const setOwnerNotes = (id: string, ownerNotes: string) => patch(id, { owner_notes: ownerNotes.trim() || null });
/** Agency records that it has applied (or un-applied) a credit by hand elsewhere. */
export const setCreditApplied = (id: string, applied: boolean) => patch(id, { credit_applied_at: applied ? new Date().toISOString() : null });
export const updateMakegoodPromise = (id: string, changes: { promised_detail?: string | null; promised_value?: number | null; due_by?: string | null }) => patch(id, changes);
