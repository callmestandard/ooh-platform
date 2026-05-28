/**
 * Notification helpers for OOH Platform.
 *
 * ── Required database setup ──────────────────────────────────────────────────
 * Run this SQL once in the Supabase SQL editor:
 *
 *   create table if not exists public.notifications (
 *     id             uuid default gen_random_uuid() primary key,
 *     recipient_role text not null check (recipient_role in ('agency', 'client', 'owner')),
 *     type           text not null,
 *     title          text not null,
 *     body           text,
 *     link           text,
 *     read           boolean default false,
 *     created_at     timestamptz default now()
 *   );
 *
 *   alter table public.notifications enable row level security;
 *
 *   -- Allow any authenticated user (or anon for demo) to read/write notifications
 *   create policy "Anyone can read notifications"
 *     on public.notifications for select using (true);
 *
 *   create policy "Anyone can insert notifications"
 *     on public.notifications for insert with check (true);
 *
 *   create policy "Anyone can update notifications"
 *     on public.notifications for update using (true);
 */

import { supabase } from './supabase';
import type { DemoRole } from './constants';

export type NotificationType =
  | 'new_booking'
  | 'counter_offer'
  | 'offer_accepted'
  | 'offer_declined'
  | 'message'
  | 'poe_submitted'
  | 'plan_approved'
  | 'campaign_request';

export type Notification = {
  id: string;
  recipient_role: DemoRole;
  type: NotificationType;
  title: string;
  body: string | null;
  link: string | null;
  read: boolean;
  created_at: string;
};

export async function createNotification(params: {
  recipientRole: DemoRole;
  type: NotificationType;
  title: string;
  body?: string;
  link?: string;
}) {
  const { error } = await supabase.from('notifications').insert({
    recipient_role: params.recipientRole,
    type: params.type,
    title: params.title,
    body: params.body ?? null,
    link: params.link ?? null,
  });
  if (error) console.error('[notifications] insert failed:', error.message);
}

export async function markAllRead(role: DemoRole) {
  await supabase
    .from('notifications')
    .update({ read: true })
    .eq('recipient_role', role)
    .eq('read', false);
}

export async function markOneRead(id: string) {
  await supabase.from('notifications').update({ read: true }).eq('id', id);
}

/** Icon emoji per notification type — used in the bell dropdown. */
export const NOTIF_ICONS: Record<NotificationType, string> = {
  new_booking:    '📋',
  counter_offer:  '🔄',
  offer_accepted: '✅',
  offer_declined: '❌',
  message:        '💬',
  poe_submitted:  '📸',
  plan_approved:  '🎉',
  campaign_request: '📝',
};
