import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { logActivity } from '@/lib/activity-log';
import { emailPaymentReceived } from '@/lib/email';

export const runtime = 'nodejs';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function notify(recipientRole: 'agency' | 'owner', type: string, title: string, body: string, link: string) {
  await supabase.from('notifications').insert({ recipient_role: recipientRole, type, title, body, link });
}

export async function POST(req: NextRequest) {
  const secretKey = process.env.PAYSTACK_SECRET_KEY;
  if (!secretKey) {
    return NextResponse.json({ error: 'Paystack not configured' }, { status: 503 });
  }

  const body = await req.text();
  const signature = req.headers.get('x-paystack-signature') || '';

  // Verify webhook authenticity
  const hash = crypto.createHmac('sha512', secretKey).update(body).digest('hex');
  if (hash !== signature) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  const event = JSON.parse(body) as {
    event: string;
    data: {
      reference: string;
      status: string;
      paid_at: string;
      metadata?: { invoice_id?: string };
      customer?: { email?: string };
    };
  };

  if (event.event === 'charge.success') {
    const { reference, status, paid_at, metadata } = event.data;

    if (status !== 'success') {
      return NextResponse.json({ received: true });
    }

    // Find invoice by payment_ref or metadata.invoice_id
    let invoiceId = metadata?.invoice_id;

    if (!invoiceId) {
      const { data } = await supabase
        .from('invoices')
        .select('id')
        .eq('payment_ref', reference)
        .single();
      invoiceId = data?.id;
    }

    if (invoiceId) {
      const { data: inv } = await supabase
        .from('invoices')
        .update({
          status:      'paid',
          paid_at:     paid_at || new Date().toISOString(),
          payment_ref: reference,
        })
        .eq('id', invoiceId)
        .select('invoice_number, total_amount, client_name')
        .single();

      if (inv) {
        const amount = '₦' + Number(inv.total_amount).toLocaleString('en-NG');
        await notify(
          'agency',
          'plan_approved',
          `Payment received — ${inv.invoice_number}`,
          `${inv.client_name} paid ${amount}. Invoice is now settled.`,
          `/dashboard/agency/invoices/${invoiceId}`,
        );

        // Email the agency
        const { data: agencyInv } = await supabase
          .from('invoices')
          .select('agency_id, campaign:campaigns(agency_id)')
          .eq('id', invoiceId)
          .single() as { data: { agency_id?: string; campaign?: { agency_id?: string } } | null };
        const agencyUserId = agencyInv?.agency_id ?? (agencyInv?.campaign as { agency_id?: string } | null)?.agency_id;
        if (agencyUserId) {
          const { data: { user } } = await supabase.auth.admin.getUserById(agencyUserId);
          if (user?.email) {
            await emailPaymentReceived({
              to: user.email,
              invoiceNumber: inv.invoice_number,
              totalAmount: inv.total_amount,
              clientName: inv.client_name,
              invoiceId: invoiceId!,
            });
          }
        }
        await logActivity({
          entityType: 'invoice',
          entityId: invoiceId,
          action: 'invoice.paid',
          summary: `${inv.invoice_number} paid via Paystack (${amount})`,
          actorRole: 'system',
          changes: { status: { from: 'sent', to: 'paid' } },
          metadata: { payment_ref: reference, source: 'paystack_webhook' },
        }, supabase);
      }
    }
  }

  return NextResponse.json({ received: true });
}
