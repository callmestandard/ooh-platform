/**
 * Print progress tracking — status-only visibility into whether a board's
 * printed creative is ready. The platform never prints anything; this just
 * tracks who's responsible and what state they've reported.
 *
 * Requires: supabase/migrations/030_print_tasks.sql
 * History reuses src/lib/activity-log.ts (entityType: 'print_task'), same
 * as board/compliance/invoice history — no second audit mechanism here.
 */

import { supabase } from './supabase';
import { getActivityActor } from './activity-log';
import type { SupabaseClient } from '@supabase/supabase-js';

export type ResponsibleParty = 'agency' | 'client' | 'board_owner';
export type PrintStatus = 'not_started' | 'in_production' | 'printed' | 'delivered_to_site' | 'installed';

export const PRINT_STATUS_ORDER: PrintStatus[] = [
  'not_started', 'in_production', 'printed', 'delivered_to_site', 'installed',
];

export const PRINT_STATUS_LABELS: Record<PrintStatus, string> = {
  not_started:       'Not started',
  in_production:     'In production',
  printed:           'Printed',
  delivered_to_site: 'Delivered to site',
  installed:         'Installed',
};

export const PRINT_STATUS_STYLE: Record<PrintStatus, { bg: string; color: string; dot: string }> = {
  not_started:       { bg: '#F1F5F9', color: '#475569', dot: '#94A3B8' },
  in_production:     { bg: '#FFFBEB', color: '#92400E', dot: '#F59E0B' },
  printed:           { bg: '#EFF6FF', color: '#1E3A8A', dot: '#3B82F6' },
  delivered_to_site: { bg: '#F5F3FF', color: '#3730A3', dot: '#8B5CF6' },
  installed:         { bg: '#ECFDF5', color: '#065F46', dot: '#10B981' },
};

export const RESPONSIBLE_PARTY_LABELS: Record<ResponsibleParty, string> = {
  agency:      'Agency',
  client:      'Client',
  board_owner: 'Board owner',
};

export type PrintTask = {
  id: string;
  booking_id: string;
  campaign_id: string | null;
  responsible_party: ResponsibleParty;
  status: PrintStatus;
  notes: string | null;
  photo_url: string | null;
  updated_by: string | null;
  updated_by_name: string | null;
  updated_by_role: string | null;
  updated_on_behalf_of_owner: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

function db(client?: SupabaseClient | null) {
  return client ?? supabase;
}

export function nextPrintStatus(status: PrintStatus): PrintStatus | null {
  const i = PRINT_STATUS_ORDER.indexOf(status);
  return i >= 0 && i < PRINT_STATUS_ORDER.length - 1 ? PRINT_STATUS_ORDER[i + 1] : null;
}

export async function fetchPrintTask(bookingId: string, client?: SupabaseClient | null): Promise<PrintTask | null> {
  const { data, error } = await db(client)
    .from('print_tasks')
    .select('*')
    .eq('booking_id', bookingId)
    .maybeSingle();
  if (error) {
    console.error('[print-tasks] fetch failed:', error.message);
    return null;
  }
  return (data as PrintTask) || null;
}

export async function fetchPrintTasksForBookings(
  bookingIds: string[],
  client?: SupabaseClient | null,
): Promise<Record<string, PrintTask>> {
  if (bookingIds.length === 0) return {};
  const { data, error } = await db(client)
    .from('print_tasks')
    .select('*')
    .in('booking_id', bookingIds);
  if (error) {
    console.error('[print-tasks] batch fetch failed:', error.message);
    return {};
  }
  const map: Record<string, PrintTask> = {};
  (data as PrintTask[] || []).forEach(t => { map[t.booking_id] = t; });
  return map;
}

/** Create the tracker for a plan line — the agency does this when the line is created/confirmed. */
export async function createPrintTask(
  params: { bookingId: string; campaignId: string; responsibleParty: ResponsibleParty },
  client?: SupabaseClient | null,
): Promise<PrintTask | null> {
  const { data, error } = await db(client)
    .from('print_tasks')
    .insert({
      booking_id: params.bookingId,
      campaign_id: params.campaignId,
      responsible_party: params.responsibleParty,
      status: 'not_started',
    })
    .select('*')
    .single();
  if (error) {
    console.error('[print-tasks] create failed:', error.message);
    return null;
  }
  return data as PrintTask;
}

/** Advance/update a print task. Server-side RLS + trigger are the real enforcement — this just performs the write. */
export async function updatePrintTask(
  taskId: string,
  changes: { status?: PrintStatus; notes?: string | null; photoUrl?: string | null },
  client?: SupabaseClient | null,
): Promise<{ data: PrintTask | null; error: string | null }> {
  const actor = await getActivityActor();
  const payload: Record<string, unknown> = {
    updated_by_name: actor.actorName ?? null,
    updated_by_role: actor.actorRole ?? null,
  };
  if (changes.status !== undefined) payload.status = changes.status;
  if (changes.notes !== undefined) payload.notes = changes.notes;
  if (changes.photoUrl !== undefined) payload.photo_url = changes.photoUrl;

  const { data, error } = await db(client)
    .from('print_tasks')
    .update(payload)
    .eq('id', taskId)
    .select('*')
    .single();

  if (error) return { data: null, error: error.message };
  return { data: data as PrintTask, error: null };
}

/** Reassign responsible_party — agency/admin only (enforced server-side too). */
export async function reassignPrintTaskParty(
  taskId: string,
  responsibleParty: ResponsibleParty,
  client?: SupabaseClient | null,
): Promise<{ data: PrintTask | null; error: string | null }> {
  const actor = await getActivityActor();
  const { data, error } = await db(client)
    .from('print_tasks')
    .update({ responsible_party: responsibleParty, updated_by_name: actor.actorName ?? null, updated_by_role: actor.actorRole ?? null })
    .eq('id', taskId)
    .select('*')
    .single();
  if (error) return { data: null, error: error.message };
  return { data: data as PrintTask, error: null };
}

/**
 * Mirrors the board_owner_match()/board_has_verified_owner() SQL helpers
 * (030_print_tasks.sql) client-side, purely for UI gating (show/hide the
 * advance control). Real enforcement is the RLS policy + trigger — this
 * never needs to be perfectly authoritative, just not misleading.
 */
export async function resolveBoardOwnership(
  boardId: string,
  client?: SupabaseClient | null,
): Promise<{ hasVerifiedOwner: boolean; matchesUid: (uid: string) => boolean }> {
  const c = db(client);
  const [{ data: board }, { data: auths }] = await Promise.all([
    c.from('boards').select('owner_id').eq('id', boardId).maybeSingle(),
    c.from('board_authorizations').select('owner_id, owner_verified, status').eq('board_id', boardId).eq('status', 'active'),
  ]);
  const directOwnerId = (board as { owner_id: string | null } | null)?.owner_id ?? null;
  const verifiedAuth = (auths as { owner_id: string | null; owner_verified: boolean }[] | null)?.find(a => a.owner_verified);
  const hasVerifiedOwner = !!directOwnerId || !!verifiedAuth;
  const verifiedOwnerId = directOwnerId || verifiedAuth?.owner_id || null;
  return {
    hasVerifiedOwner,
    matchesUid: (uid: string) => !!verifiedOwnerId && verifiedOwnerId === uid,
  };
}

/** Client-side mirror of the print_tasks_update RLS policy, for UI gating only. */
export function canActOnPrintTask(
  task: Pick<PrintTask, 'responsible_party'>,
  ctx: {
    role: string | null;
    userId: string | null;
    campaignAgencyId: string | null;
    campaignClientId: string | null;
    boardOwnerMatches: boolean;
    boardHasVerifiedOwner: boolean;
  },
): boolean {
  if (ctx.role === 'admin') return true;
  if (task.responsible_party === 'agency') return ctx.role === 'agency' && ctx.userId === ctx.campaignAgencyId;
  if (task.responsible_party === 'client') return ctx.role === 'client' && ctx.userId === ctx.campaignClientId;
  if (task.responsible_party === 'board_owner') {
    if (ctx.boardOwnerMatches) return true;
    return !ctx.boardHasVerifiedOwner && ctx.role === 'agency' && ctx.userId === ctx.campaignAgencyId;
  }
  return false;
}

const PRINT_PHOTO_BUCKET = 'compliance-photos';

/** Reuses the same Supabase Storage bucket/path convention as POE compliance photos. */
export async function uploadPrintPhoto(bookingId: string, file: File): Promise<string | null> {
  const path = `print/${bookingId}/${Date.now()}_${file.name.replace(/\s+/g, '_')}`;
  const { data, error } = await supabase.storage.from(PRINT_PHOTO_BUCKET).upload(path, file, { upsert: false });
  if (error || !data) {
    console.error('[print-tasks] photo upload failed:', error?.message);
    return null;
  }
  const { data: { publicUrl } } = supabase.storage.from(PRINT_PHOTO_BUCKET).getPublicUrl(data.path);
  return publicUrl;
}
