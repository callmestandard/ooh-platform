export { formatNaira, formatDate, formatDateShort, formatImpressions } from '@/lib/utils';

export const OBJECTIVE_LABELS: Record<string, string> = {
  brand_awareness: 'Brand Awareness',
  product_launch: 'Product Launch',
  sales_promotion: 'Sales Promotion',
  event_promotion: 'Event Promotion',
  brand_reminder: 'Brand Reminder',
  market_expansion: 'Market Expansion',
  awareness: 'Brand Awareness',
  launch: 'Product Launch',
  engagement: 'Engagement',
  conversion: 'Conversion',
};

export type ClientTab =
  | 'overview'
  | 'plan'
  | 'board-status'
  | 'compliance'
  | 'impressions'
  | 'map'
  | 'billing';

export function parseClientTab(tab: string | null): ClientTab {
  const valid: ClientTab[] = ['overview', 'plan', 'board-status', 'compliance', 'impressions', 'map', 'billing'];
  if (tab && valid.includes(tab as ClientTab)) return tab as ClientTab;
  return 'overview';
}
