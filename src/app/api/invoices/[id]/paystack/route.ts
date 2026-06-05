import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Fetch invoice
  const { data: invoice, error } = await supabase
    .from('invoices')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !invoice) {
    return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
  }

  if (invoice.status === 'paid') {
    return NextResponse.json({ error: 'Invoice already paid' }, { status: 400 });
  }

  // Check if we already have a payment URL stored
  if (invoice.payment_url) {
    return NextResponse.json({
      authorization_url: invoice.payment_url,
      reference: invoice.payment_ref,
      reused: true,
    });
  }

  const secretKey = process.env.PAYSTACK_SECRET_KEY;

  // Without Paystack key: return a demo link (shareable invoice page)
  if (!secretKey) {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || req.headers.get('origin') || 'http://localhost:3000';
    const invoicePageUrl = `${baseUrl}/invoice/${invoice.id}`;
    await supabase.from('invoices').update({
      payment_url: invoicePageUrl,
      status: 'sent',
    }).eq('id', id);

    return NextResponse.json({
      authorization_url: invoicePageUrl,
      reference: invoice.invoice_number,
      mode: 'invoice_page',
    });
  }

  // Paystack: amounts must be in kobo (x100)
  const amountKobo = Math.round(invoice.total_amount * 100);
  const email      = invoice.client_email || `invoice+${invoice.id.slice(0, 8)}@oohplatform.com`;
  const reference  = `${invoice.invoice_number}-${Date.now()}`;
  const baseUrl    = process.env.NEXT_PUBLIC_APP_URL || req.headers.get('origin') || 'http://localhost:3000';
  const callbackUrl = `${baseUrl}/api/paystack/callback/${invoice.id}`;

  try {
    const psRes = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email,
        amount:       amountKobo,
        reference,
        currency:     'NGN',
        callback_url: callbackUrl,
        metadata: {
          invoice_id:     invoice.id,
          invoice_number: invoice.invoice_number,
          client_name:    invoice.client_name,
          campaign_id:    invoice.campaign_id,
        },
        channels: ['card', 'bank', 'ussd', 'bank_transfer'],
      }),
    });

    const psData = await psRes.json();

    if (!psData.status) {
      throw new Error(psData.message || 'Paystack error');
    }

    // Store the payment URL and mark as sent
    await supabase.from('invoices').update({
      payment_url: psData.data.authorization_url,
      payment_ref: reference,
      status:      'sent',
    }).eq('id', id);

    return NextResponse.json({
      authorization_url: psData.data.authorization_url,
      access_code:       psData.data.access_code,
      reference,
      mode: 'paystack',
    });
  } catch (err) {
    console.error('[paystack init]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Payment initialization failed' },
      { status: 500 }
    );
  }
}
