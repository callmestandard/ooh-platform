// Browser helpers for quotations (061).
import { supabase } from './supabase';
import { authedFetch } from './api';

export type QuoteEmailEvent = 'sent' | 'resend' | 'withdrawn' | 'confirmed' | 'accepted' | 'declined' | 'clarify';

/** Ask the server to send the email for a quotation event. Resolves with how many went out, or null on error. */
export async function notifyQuotation(id: string, event: QuoteEmailEvent): Promise<{ sent: number; failed: number; already?: boolean } | null> {
  try {
    const res = await authedFetch('/api/quotations/notify', { method: 'POST', body: JSON.stringify({ id, event }) });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

/** Downloads the quotation PDF. The server checks who may have it. Returns an error message or null. */
export async function downloadQuotationPdf(id: string, ref: string): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return 'Sign in again to download.';
  const res = await fetch(`/api/quotations/${id}/pdf`, { headers: { Authorization: `Bearer ${session.access_token}` } });
  if (!res.ok) return 'Could not create the PDF. Try again.';
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url; a.download = `${ref}.pdf`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return null;
}
