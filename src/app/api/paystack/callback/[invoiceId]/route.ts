import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { logActivity } from '@/lib/activity-log';
import { emailPaymentReceived } from '@/lib/email';

export const runtime = 'nodejs';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ invoiceId: string }> }
) {
  const { invoiceId } = await params;
  const { searchParams } = new URL(req.url);
  const reference = searchParams.get('reference') || searchParams.get('trxref');
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || req.headers.get('origin') || 'http://localhost:3000';

  if (!reference) {
    return NextResponse.redirect(`${baseUrl}/invoice/${invoiceId}?payment=failed`);
  }

  const secretKey = process.env.PAYSTACK_SECRET_KEY;
  if (!secretKey) {
    // No key in env — treat the redirect as success (webhook will confirm later)
    return NextResponse.redirect(`${baseUrl}/invoice/${invoiceId}?payment=done`);
  }

  try {
    const verifyRes = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
      headers: { Authorization: `Bearer ${secretKey}` },
    });
    const verifyData = await verifyRes.json() as {
      status: boolean;
      data?: {
        status: string;
        paid_at: string;
        metadata?: { invoice_id?: string };
      };
    };

    if (!verifyData.status || verifyData.data?.status !== 'success') {
      return NextResponse.redirect(`${baseUrl}/invoice/${invoiceId}?payment=failed`);
    }

    // Mark invoice as paid
    const { data: inv } = await supabase
      .from('invoices')
      .update({
        status:      'paid',
        paid_at:     verifyData.data.paid_at || new Date().toISOString(),
        payment_ref: reference,
      })
      .eq('id', invoiceId)
      .neq('status', 'paid') // idempotent — skip if already marked paid by webhook
      .select('invoice_number, total_amount, client_name, agency_id, campaign_id')
      .single();

    if (inv) {
      // Email agency
      const agencyUserId = inv.agency_id;
      if (agencyUserId) {
        try {
          const { data: { user } } = await supabase.auth.admin.getUserById(agencyUserId);
          if (user?.email) {
            await emailPaymentReceived({
              to:            user.email,
              invoiceNumber: inv.invoice_number,
              totalAmount:   inv.total_amount,
              clientName:    inv.client_name,
              invoiceId,
            });
          }
        } catch { /* non-fatal */ }
      }

      await logActivity({
        entityType: 'invoice',
        entityId:   invoiceId,
        campaignId: inv.campaign_id,
        action:     'invoice.paid',
        summary:    `${inv.invoice_number} paid via Paystack (₦${Number(inv.total_amount).toLocaleString('en-NG')})`,
        actorRole:  'system',
        changes:    { status: { from: 'sent', to: 'paid' } },
        metadata:   { payment_ref: reference, source: 'paystack_callback' },
      }, supabase);
    }

    return NextResponse.redirect(`${baseUrl}/invoice/${invoiceId}?payment=done`);
  } catch (err) {
    console.error('[paystack callback]', err);
    return NextResponse.redirect(`${baseUrl}/invoice/${invoiceId}?payment=failed`);
  }
}
