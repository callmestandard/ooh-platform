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
  | 'invoice_paid'
  | 'agent_authorization_request'
  | 'agent_authorization_resolved'
  | 'availability_request'
  | 'availability_response'
  | 'makegood';

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

// A notification must name its recipient. One without recipientUserId is
// shown to admins only (migration 041), so for any other role it would never
// be seen — it is skipped instead of being written.
export async function createNotification(params: {
  recipientRole: DemoRole;
  recipientUserId?: string | null;
  type: NotificationType;
  title: string;
  body?: string;
  link?: string;
}) {
  if (!params.recipientUserId && params.recipientRole !== 'admin') {
    console.warn(`[notifications] skipped "${params.title}": no recipient user for role ${params.recipientRole}`);
    return;
  }
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

// The account that answers for a board: its direct owner, else the owner who
// confirmed an agent's authorization (see board_owner_account in 034).
export async function getBoardOwnerAccount(board: { id?: string | null; owner_id?: string | null } | null | undefined): Promise<string | null> {
  if (!board) return null;
  if (board.owner_id) return board.owner_id;
  if (!board.id) return null;
  const { data, error } = await supabase.rpc('board_owner_account', { p_board_id: board.id });
  if (error) console.error('[notifications] board owner lookup failed:', error.message);
  return (data as string | null) ?? null;
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
  agent_authorization_request:  '🤝',
  agent_authorization_resolved: '✅',
  availability_request:  '📨',
  availability_response: '📬',
  makegood: '🤝',
};
