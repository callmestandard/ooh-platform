// Quotation pricing (migration 061). The database recalculates every total
// when a quotation is saved (quotation_recalc); this file mirrors those rules
// so the admin editor can show the same numbers live. Keep the two in step:
// tests in scripts/test-quotations.mjs check this file.
//
// No margin is built in. The admin chooses how each board is priced.

export type PricingMode = 'markup_percent' | 'markup_fixed' | 'manual' | 'commission';
export type LineKind = 'board' | 'printing' | 'installation' | 'production' | 'fee' | 'discount';

export const PRICING_MODES: { value: PricingMode; label: string; hint: string }[] = [
  { value: 'markup_percent', label: 'Markup %', hint: 'Owner price plus a percentage' },
  { value: 'markup_fixed', label: 'Markup ₦', hint: 'Owner price plus a fixed amount per month' },
  { value: 'manual', label: 'Set price', hint: 'Type the monthly selling price' },
  { value: 'commission', label: 'Commission %', hint: 'Buyer pays the owner price; the owner pays us a share' },
];

export const EXTRA_KINDS: { value: Exclude<LineKind, 'board'>; label: string }[] = [
  { value: 'printing', label: 'Printing' },
  { value: 'installation', label: 'Installation' },
  { value: 'production', label: 'Production' },
  { value: 'fee', label: 'Other fee' },
  { value: 'discount', label: 'Discount' },
];

export type QuoteLineInput = {
  kind: LineKind;
  months?: number | null;
  owner_net_monthly?: number | null;
  pricing_mode?: PricingMode | null;
  pricing_value?: number | null;
  /** extras and discount: what the buyer pays (discount: amount taken off) */
  amount?: number | null;
  /** extras: what it costs us */
  cost?: number | null;
};

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Monthly selling price for a board line. */
export function sellMonthly(net: number, mode: PricingMode, value: number | null | undefined): number {
  const v = Number(value) || 0;
  switch (mode) {
    case 'markup_percent': return round2(net * (1 + v / 100));
    case 'markup_fixed': return round2(net + v);
    case 'manual': return round2(v);
    case 'commission': return round2(net);
  }
}

/** What we pay the owner per month for a board line. */
export function costMonthly(net: number, mode: PricingMode, value: number | null | undefined): number {
  return round2(mode === 'commission' ? net * (1 - (Number(value) || 0) / 100) : net);
}

export function lineTotals(l: QuoteLineInput): { unit: number | null; total: number; cost: number } {
  if (l.kind === 'board') {
    const net = Number(l.owner_net_monthly) || 0;
    const mode = l.pricing_mode ?? 'markup_percent';
    const months = Number(l.months) || 1;
    const unit = sellMonthly(net, mode, l.pricing_value);
    return { unit, total: round2(unit * months), cost: round2(costMonthly(net, mode, l.pricing_value) * months) };
  }
  const amount = Number(l.amount) || 0;
  if (l.kind === 'discount') return { unit: null, total: -amount, cost: 0 };
  return { unit: null, total: amount, cost: Number(l.cost) || 0 };
}

export type QuoteTotals = {
  subtotal: number; discount: number; vat: number; total: number;
  ownerCost: number; revenue: number; /** revenue as % of the price before VAT */ marginPct: number | null;
};

export function quoteTotals(lines: QuoteLineInput[], vatRate: number): QuoteTotals {
  let subtotal = 0, discount = 0, ownerCost = 0;
  for (const l of lines) {
    const t = lineTotals(l);
    if (l.kind === 'discount') discount += -t.total; else subtotal += t.total;
    ownerCost += t.cost;
  }
  subtotal = round2(subtotal); discount = round2(discount); ownerCost = round2(ownerCost);
  const net = round2(subtotal - discount);
  const vat = round2(net * (Number(vatRate) || 0) / 100);
  const revenue = round2(net - ownerCost);
  return { subtotal, discount, vat, total: round2(net + vat), ownerCost, revenue, marginPct: net > 0 ? round2((revenue / net) * 100) : null };
}

/** Problems that stop a quotation being saved, in plain words. */
export function quoteProblems(lines: QuoteLineInput[]): string[] {
  const out: string[] = [];
  const boards = lines.filter(l => l.kind === 'board');
  if (!boards.length) out.push('Add at least one board.');
  lines.forEach((l, i) => {
    const n = i + 1;
    if (l.kind === 'board') {
      if (!(Number(l.owner_net_monthly) > 0)) out.push(`Line ${n}: enter the owner's price.`);
      if (l.pricing_value == null || Number.isNaN(Number(l.pricing_value))) out.push(`Line ${n}: choose the ${l.pricing_mode === 'manual' ? 'selling price' : l.pricing_mode === 'commission' ? 'commission' : 'markup'}.`);
      else if (l.pricing_mode === 'manual' && !(Number(l.pricing_value) > 0)) out.push(`Line ${n}: the selling price must be more than zero.`);
      else if (l.pricing_mode === 'commission' && (Number(l.pricing_value) < 0 || Number(l.pricing_value) >= 100)) out.push(`Line ${n}: commission must be between 0 and 100%.`);
      if (!(Number(l.months) > 0)) out.push(`Line ${n}: months must be more than zero.`);
    } else if (!(Number(l.amount) >= 0) || l.amount == null) out.push(`Line ${n}: enter the amount.`);
  });
  return out;
}

/** Whole months between two dates, at least 1 (matches spanText on the request). */
export function monthsBetween(start: string | null | undefined, end: string | null | undefined): number {
  if (!start || !end) return 1;
  const days = (new Date(end).getTime() - new Date(start).getTime()) / 86_400_000 + 1;
  return Math.max(1, Math.round((days / 30.4375) * 2) / 2);
}

export const QUOTE_STATUS: Record<string, { label: string; tone: string }> = {
  draft: { label: 'Draft', tone: '#64748B' },
  sent: { label: 'Sent', tone: '#1B4F8A' },
  accepted: { label: 'Accepted', tone: '#047857' },
  declined: { label: 'Declined', tone: '#B91C1C' },
  withdrawn: { label: 'Withdrawn', tone: '#92400E' },
  superseded: { label: 'Replaced', tone: '#94A3B8' },
  expired: { label: 'Expired', tone: '#B45309' },
};

/** Buyer-facing quotation, as returned by my_quotations(): never owner rates or margins. */
export type BuyerQuotation = {
  id: string; ref: string; status: string; request_ids: string[]; title: string | null;
  issued_on: string | null; valid_until: string | null; expired: boolean;
  vat_rate: number; subtotal: number; discount_total: number; vat_amount: number; total: number;
  payment_terms: string | null; cancellation_terms: string | null; special_conditions: string | null; buyer_note: string | null;
  sent_at: string | null; accepted_at: string | null; declined_at: string | null; decline_reason: string | null;
  withdrawn_at: string | null; booking_confirmed_at: string | null;
  lines: { kind: LineKind; board_id: string | null; description: string; start_date: string | null; end_date: string | null; months: number; unit_monthly: number | null; line_total: number }[];
};

export const naira = (n: number | null | undefined) =>
  n == null ? '—' : (n < 0 ? '−' : '') + '₦' + Math.abs(n).toLocaleString('en-NG', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
