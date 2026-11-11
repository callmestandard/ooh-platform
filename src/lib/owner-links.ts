/**
 * Owner links (migration 053): a private, no-login page per media owner at
 * /o/[token], where they confirm which boards are free each week and answer
 * buyer requests. Their answers wait for our team (Needs checking) before
 * a buyer sees them.
 */

export type OwnerBoardStatus = 'available' | 'booked' | 'unavailable';

export type OwnerLinkBoard = {
  id: string; name: string; area: string | null; city: string | null; format: string | null; photo: string | null;
  status: OwnerBoardStatus | string; available_from: string | null; checked_at: string | null;
};

export type OwnerLinkReply = {
  available: boolean; quoted_rate: number | null; available_from: string | null; available_to: string | null;
  conditions: string | null; note: string | null; status: 'pending' | 'sent' | 'dismissed';
};

export type OwnerLinkRequest = {
  id: string; board_id: string; board_name: string; photo: string | null; start_date: string; end_date: string;
  company: string; message: string | null; extra: string | null; created_at: string; reply: OwnerLinkReply | null;
};

export type OwnerLinkView = { owner_name: string; boards: OwnerLinkBoard[]; requests: OwnerLinkRequest[] };

/** Boards not confirmed for this long show as needing a check. */
export const CHECK_EVERY_DAYS = 7;

export function isStale(checkedAt: string | null | undefined, now = Date.now()): boolean {
  return !checkedAt || now - new Date(checkedAt).getTime() > CHECK_EVERY_DAYS * 86_400_000;
}

export function ownerLinkUrl(token: string, origin = typeof window !== 'undefined' ? window.location.origin : ''): string {
  return `${origin}/o/${token}`;
}

/** Nigerian numbers to wa.me form: 0803… → 234803… */
export function waNumber(phone: string | null | undefined): string | null {
  const d = (phone ?? '').replace(/\D/g, '');
  if (d.length < 10) return null;
  return d.startsWith('0') ? `234${d.slice(1)}` : d;
}

/** The weekly WhatsApp message to an owner, with their link. */
export function ownerLinkMessage(o: { contactName?: string | null; boards: number; waiting: number; url: string }): string {
  const hi = o.contactName?.trim() ? `Hello ${o.contactName.trim().split(/\s+/)[0]},` : 'Hello,';
  const ask = o.waiting > 0
    ? `${o.waiting} buyer request${o.waiting !== 1 ? 's are' : ' is'} waiting for your answer, and please confirm which of your ${o.boards} board${o.boards !== 1 ? 's are' : ' is'} free this week.`
    : `Please take a minute to confirm which of your ${o.boards} board${o.boards !== 1 ? 's are' : ' is'} free this week.`;
  return `${hi} this is the OOH Platform team. ${ask}\n\n${o.url}\n\nNo login needed. Thank you!`;
}

/** "today", "3 days ago", "2 weeks ago" */
export function sinceText(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return 'never';
  const days = Math.floor((now - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  return `${Math.round(days / 30)} months ago`;
}
