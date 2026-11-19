// Server-side quotation loading (061) for the PDF and email routes.
// Reads with the service role but selects buyer-facing columns only, so the
// owner's price, costs, pricing modes and platform revenue are never loaded
// into anything that leaves the server.

import type { SupabaseClient, User } from '@supabase/supabase-js';
import type { QuotationPdfData } from './quotation-pdf';
import type { QuotationEmailInfo } from './email';

const Q_PUBLIC = 'id, ref, status, title, request_id, agency_id, issued_on, valid_until, vat_rate, subtotal, discount_total, vat_amount, total, payment_terms, cancellation_terms, special_conditions, buyer_note, revised_from, withdraw_reason, decline_reason';
const L_PUBLIC = 'kind, description, start_date, end_date, months, sell_monthly, line_total';

export type LoadedQuotation = {
  id: string; ref: string; status: string; agencyId: string; requestId: string | null; revised: boolean;
  withdrawReason: string | null; declineReason: string | null;
  pdf: QuotationPdfData; email: QuotationEmailInfo; buyerEmail: string | null;
};

export async function loadQuotation(db: SupabaseClient, id: string): Promise<LoadedQuotation | null> {
  const { data: q } = await db.from('quotations').select(Q_PUBLIC).eq('id', id).maybeSingle();
  if (!q) return null;
  const [{ data: lines }, { data: contact }, { data: u }] = await Promise.all([
    db.from('quotation_lines').select(L_PUBLIC).eq('quotation_id', id).order('position'),
    q.request_id
      ? db.from('availability_request_contacts').select('name, company, email').eq('request_id', q.request_id).maybeSingle()
      : Promise.resolve({ data: null }),
    db.auth.admin.getUserById(q.agency_id),
  ]);
  const c = contact as { name: string | null; company: string | null; email: string | null } | null;
  const buyerEmail = u?.user?.email ?? c?.email ?? null;
  const ls = (lines ?? []) as { kind: string; description: string; start_date: string | null; end_date: string | null; months: number; sell_monthly: number | null; line_total: number }[];
  const num = (v: unknown) => Number(v) || 0;
  const pdf: QuotationPdfData = {
    ref: q.ref, status: q.status, title: q.title, issuedOn: q.issued_on, validUntil: q.valid_until,
    buyer: { company: c?.company ?? null, name: c?.name ?? null, email: buyerEmail },
    lines: ls.map(l => ({
      kind: l.kind, description: l.description, startDate: l.start_date, endDate: l.end_date, months: num(l.months),
      unitMonthly: l.sell_monthly == null ? null : num(l.sell_monthly), lineTotal: num(l.line_total),
    })),
    subtotal: num(q.subtotal), discountTotal: num(q.discount_total), vatRate: num(q.vat_rate), vatAmount: num(q.vat_amount), total: num(q.total),
    paymentTerms: q.payment_terms, cancellationTerms: q.cancellation_terms, specialConditions: q.special_conditions, buyerNote: q.buyer_note,
  };
  return {
    id: q.id, ref: q.ref, status: q.status, agencyId: q.agency_id, requestId: q.request_id, revised: !!q.revised_from,
    withdrawReason: q.withdraw_reason, declineReason: q.decline_reason,
    pdf, buyerEmail,
    email: {
      ref: q.ref, title: q.title, total: pdf.total, vatAmount: pdf.vatAmount, validUntil: q.valid_until,
      buyerCompany: c?.company ?? c?.name ?? 'A buyer', paymentTerms: q.payment_terms,
      lines: pdf.lines.map(l => ({ description: l.description, lineTotal: l.lineTotal })),
    },
  };
}

export async function isAdmin(db: SupabaseClient, user: User): Promise<boolean> {
  const { data } = await db.from('profiles').select('role').eq('id', user.id).maybeSingle();
  return data?.role === 'admin';
}

export async function adminEmails(db: SupabaseClient): Promise<string[]> {
  const { data } = await db.from('profiles').select('id').eq('role', 'admin');
  const out = await Promise.all((data ?? []).map(async a => (await db.auth.admin.getUserById(a.id)).data?.user?.email ?? null));
  return out.filter((e): e is string => !!e);
}

/** Records every email attempt (sent, failed or skipped) in email_log. */
export async function logEmail(db: SupabaseClient, row: {
  kind: string; recipient: string; subject?: string | null; status: 'sent' | 'failed' | 'skipped'; error?: string | null;
  quotation_id?: string | null; request_id?: string | null; booking_id?: string | null;
}) {
  const { error } = await db.from('email_log').insert(row);
  if (error) console.error('[email_log]', error.message);
}
