import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { logActivity } from '@/lib/activity-log';

export const runtime = 'nodejs';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

function generateInvoiceNumber(count: number): string {
  const year = new Date().getFullYear();
  return `INV-${year}-${String(count + 1).padStart(4, '0')}`;
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { campaign_id, client_name, client_email, due_date, tax_rate = 7.5, notes, client_invoice_number } = body;

  if (!client_name) {
    return NextResponse.json({ error: 'client_name is required' }, { status: 400 });
  }

  // Generate invoice number from current count
  const { count } = await supabase
    .from('invoices')
    .select('*', { count: 'exact', head: true });

  const invoice_number = generateInvoiceNumber(count ?? 0);

  // Fetch bookings for this campaign (agreed/signed/live/complete)
  let bookings: {
    id: string; offered_rate: number; agreed_rate: number | null;
    start_date: string; end_date: string;
    boards: { name: string; format: string; address: string; city: string; state: string };
  }[] = [];

  if (campaign_id) {
    const { data } = await supabase
      .from('bookings')
      .select('id, offered_rate, agreed_rate, start_date, end_date, boards(name, format, address, city, state)')
      .eq('campaign_id', campaign_id)
      .in('status', ['agreed', 'signed', 'live', 'complete']);

    bookings = (data as unknown as typeof bookings) || [];
  }

  // Build line items
  const items = bookings.map(b => {
    const rate = b.agreed_rate ?? b.offered_rate ?? 0;
    const location = [b.boards?.city, b.boards?.state].filter(Boolean).join(', ');
    return {
      booking_id:   b.id,
      description:  b.boards?.name ?? 'Billboard placement',
      board_name:   b.boards?.name,
      board_format: b.boards?.format,
      location,
      start_date:   b.start_date,
      end_date:     b.end_date,
      quantity:     1,
      unit_price:   rate,
      total:        rate,
    };
  });

  const subtotal    = items.reduce((s, i) => s + i.total, 0);
  const tax_amount  = Math.round(subtotal * (tax_rate / 100) * 100) / 100;
  const total_amount = subtotal + tax_amount;

  // Create invoice
  const { data: invoice, error } = await supabase
    .from('invoices')
    .insert({
      invoice_number, campaign_id, client_name, client_email,
      subtotal, tax_rate, tax_amount, total_amount,
      due_date: due_date || null, notes: notes || null,
      client_invoice_number: client_invoice_number || null,
      status: 'draft',
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Create line items
  if (items.length > 0) {
    await supabase
      .from('invoice_items')
      .insert(items.map(i => ({ ...i, invoice_id: invoice.id })));
  }

  await logActivity({
    entityType: 'invoice',
    entityId: invoice.id,
    campaignId: campaign_id ?? null,
    action: 'invoice.created',
    summary: `Invoice ${invoice_number} created for ${client_name} — ₦${Number(total_amount).toLocaleString('en-NG')}`,
    actorRole: 'agency',
    metadata: { line_count: items.length, status: 'draft' },
  }, supabase);

  return NextResponse.json(invoice, { status: 201 });
}

export async function GET() {
  const { data, error } = await supabase
    .from('invoices')
    .select('*, campaign:campaigns(id, name)')
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
