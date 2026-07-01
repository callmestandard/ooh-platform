import { supabase } from './supabase';
import type { DemoRole } from './constants';

export type NotificationType =
  | 'new_booking'
  | 'counter_offer'
  | 'offer_accepted'
  | 'offer_declined'
  | 'message'
  | 'poe_submitted'
  | 'poe_verified'
  | 'poe_flagged'
  | 'plan_approved'
  | 'campaign_request'
  | 'mpo_raised'
  | 'invoice_sent'
  | 'invoice_paid';

export type Notification = {
  id: string;
  recipient_role: DemoRole;
  recipient_user_id: string | null;
  type: NotificationType;
  title: string;
  body: string | null;
  link: string | null;
  read: boolean;
  created_at: string;
};

export async function createNotification(params: {
  recipientRole: DemoRole;
  recipientUserId?: string;
  type: NotificationType;
  title: string;
  body?: string;
  link?: string;
}) {
  const { error } = await supabase.from('notifications').insert({
    recipient_role: params.recipientRole,
    recipient_user_id: params.recipientUserId ?? null,
    type: params.type,
    title: params.title,
    body: params.body ?? null,
    link: params.link ?? null,
  });
  if (error) console.error('[notifications] insert failed:', error.message);
}

export async function markAllRead(role: DemoRole, userId?: string) {
  const q = supabase
    .from('notifications')
    .update({ read: true })
    .eq('read', false);

  if (userId) {
    await q.or(`recipient_user_id.eq.${userId},and(recipient_user_id.is.null,recipient_role.eq.${role})`);
  } else {
    await q.eq('recipient_role', role);
  }
}

export async function markOneRead(id: string) {
  await supabase.from('notifications').update({ read: true }).eq('id', id);
}

export const NOTIF_ICONS: Record<NotificationType, string> = {
  new_booking:      '📋',
  counter_offer:    '🔄',
  offer_accepted:   '✅',
  offer_declined:   '❌',
  message:          '💬',
  poe_submitted:    '📸',
  poe_verified:     '✅',
  poe_flagged:      '⚠️',
  plan_approved:    '🎉',
  campaign_request: '📝',
  mpo_raised:       '📄',
  invoice_sent:     '🧾',
  invoice_paid:     '💰',
};
