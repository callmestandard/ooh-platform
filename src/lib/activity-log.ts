/**
 * Append-only activity / audit log.
 *
 * Requires: supabase-add-activity-events.sql
 * Hook map: docs/ACTIVITY_HOOKS.md
 */

import { supabase } from './supabase';
import { getSupabaseAdmin } from './supabase-admin';
import type { SupabaseClient } from '@supabase/supabase-js';

export type ActivityEntityType = 'campaign' | 'booking' | 'invoice' | 'compliance_check';

export type ActivityEvent = {
  id: string;
  entity_type: ActivityEntityType;
  entity_id: string;
  campaign_id: string | null;
  actor_id: string | null;
  actor_role: string | null;
  actor_name: string | null;
  action: string;
  summary: string;
  changes: Record<string, { from?: unknown; to?: unknown }> | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

export type LogActivityParams = {
  entityType: ActivityEntityType;
  entityId: string;
  action: string;
  summary: string;
  campaignId?: string | null;
  actorId?: string | null;
  actorRole?: string | null;
  actorName?: string | null;
  changes?: Record<string, { from?: unknown; to?: unknown }>;
  metadata?: Record<string, unknown>;
};

function db(client?: SupabaseClient | null) {
  return client ?? getSupabaseAdmin() ?? supabase;
}

/** Build a changes map for fields that differ between before/after snapshots. */
export function diffFields<T extends Record<string, unknown>>(
  before: T,
  after: T,
  keys: (keyof T)[],
): Record<string, { from?: unknown; to?: unknown }> | undefined {
  const changes: Record<string, { from?: unknown; to?: unknown }> = {};
  for (const key of keys) {
    const k = String(key);
    if (before[key] !== after[key]) {
      changes[k] = { from: before[key], to: after[key] };
    }
  }
  return Object.keys(changes).length > 0 ? changes : undefined;
}

/** Resolve current user for client-side audit entries. */
export async function getActivityActor(): Promise<{
  actorId?: string;
  actorRole?: string;
  actorName?: string;
}> {
  const { data: { session } } = await supabase.auth.getSession();
  const user = session?.user;
  if (!user) return { actorRole: 'anonymous' };

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, full_name, company_name')
    .eq('id', user.id)
    .single();

  return {
    actorId: user.id,
    actorRole: profile?.role || (user.user_metadata?.role as string) || undefined,
    actorName: profile?.full_name || profile?.company_name || user.email?.split('@')[0],
  };
}

export async function logActivity(
  params: LogActivityParams,
  client?: SupabaseClient | null,
): Promise<void> {
  const { error } = await db(client).from('activity_events').insert({
    entity_type: params.entityType,
    entity_id: params.entityId,
    campaign_id: params.campaignId ?? null,
    actor_id: params.actorId ?? null,
    actor_role: params.actorRole ?? null,
    actor_name: params.actorName ?? null,
    action: params.action,
    summary: params.summary,
    changes: params.changes ?? null,
    metadata: params.metadata ?? null,
  });
  if (error) console.error('[activity-log]', error.message);
}

export async function fetchActivityForEntity(
  entityType: ActivityEntityType,
  entityId: string,
  limit = 50,
): Promise<ActivityEvent[]> {
  const { data, error } = await supabase
    .from('activity_events')
    .select('*')
    .eq('entity_type', entityType)
    .eq('entity_id', entityId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('[activity-log] fetch failed:', error.message);
    return [];
  }
  return (data as ActivityEvent[]) || [];
}

export async function fetchActivityForCampaign(
  campaignId: string,
  limit = 100,
): Promise<ActivityEvent[]> {
  const { data, error } = await supabase
    .from('activity_events')
    .select('*')
    .eq('campaign_id', campaignId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('[activity-log] fetch campaign failed:', error.message);
    return [];
  }
  return (data as ActivityEvent[]) || [];
}
