import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { diffFields, logActivity } from '@/lib/activity-log';
import { emailMPISent } from '@/lib/email';

export const runtime = 'nodejs';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

function nextInvoiceNumber(count: number): string {
  const year = new Date().getFullYear();
  return `MPI-${year}-${String(count + 1).padStart(4, '0')}`;
}

// POST — owner creates a media partner invoice for a booking
export async function POST(req: NextRequest) {
  const body = await req.json();
  const {
    booking_id,
    campaign_id,
    owner_id,
    agency_name,      // "client_name" field: the agency this invoice is addressed to
    agency_email,
    due_date,
    tax_rate = 0,
    notes,
    amount,           // line item total; if omitted, pulled from booking agreed_rate
  } = body;

  if (!booking_id && !campaign_id) {
    return NextResponse.json({ error: 'booking_id or campaign_id required' }, { status: 400 });
  }
  if (!agency_name) {
    return NextResponse.json({ error: 'agency_name required' }, { status: 400 });
  }

  // Resolve booking details
  let items: {
    booking_id: string;
    description: string;
    board_name?: string;
    board_format?: string;
    location?: string;
    start_date?: string;
    end_date?: string;
    quantity: number;
    unit_price: number;
    total: number;
  }[] = [];

  if (booking_id) {
    const { data: booking } = await supabase
      .from('bookings')
      .select('id, agreed_rate, offered_rate, start_date, end_date, boards(name, format, city, state)')
      .eq('id', booking_id)
      .single() as {
        data: {
          id: string;
          agreed_rate: number | null;
          offered_rate: number;
          start_date: string;
          end_date: string;
          boards: { name: string; format: string; city: string; state: string };
        } | null
      };

    if (booking) {
      const rate = amount ?? booking.agreed_rate ?? booking.offered_rate ?? 0;
      const loc = [booking.boards?.city, booking.boards?.state].filter(Boolean).join(', ');
      items = [{
        booking_id: booking.id,
        description: booking.boards?.name ?? 'Billboard placement',
        board_name: booking.boards?.name,
        board_format: booking.boards?.format,
        location: loc,
        start_date: booking.start_date,
        end_date: booking.end_date,
        quantity: 1,
        unit_price: rate,
        total: rate,
      }];
    }
  } else if (campaign_id) {
    // Invoice for all bookings in a campaign
    const { data: bookings } = await supabase
      .from('bookings')
      .select('id, agreed_rate, offered_rate, start_date, end_date, boards(name, format, city, state)')
      .eq('campaign_id', campaign_id)
      .in('status', ['agreed', 'signed', 'live', 'complete']) as {
        data: {
          id: string;
          agreed_rate: number | null;
          offered_rate: number;
          start_date: string;
          end_date: string;
          boards: { name: string; format: string; city: string; state: string };
        }[] | null
      };

    items = (bookings ?? []).map(b => {
      const rate = b.agreed_rate ?? b.offered_rate ?? 0;
      const loc = [b.boards?.city, b.boards?.state].filter(Boolean).join(', ');
      return {
        booking_id: b.id,
        description: b.boards?.name ?? 'Billboard placement',
        board_name: b.boards?.name,
        board_format: b.boards?.format,
        location: loc,
        start_date: b.start_date,
        end_date: b.end_date,
        quantity: 1,
        unit_price: b.agreed_rate ?? b.offered_rate ?? 0,
        total: rate,
      };
    });
  }

  const { count } = await supabase
    .from('invoices')
    .select('*', { count: 'exact', head: true });

  const invoice_number = nextInvoiceNumber(count ?? 0);
  const subtotal = items.reduce((s, i) => s + i.total, 0);
  const tax_amount = Math.round(subtotal * (tax_rate / 100) * 100) / 100;
  const total_amount = subtotal + tax_amount;

  const { data: invoice, error } = await supabase
    .from('invoices')
    .insert({
      invoice_number,
      invoice_type: 'media_partner',
      campaign_id: campaign_id ?? null,
      owner_id: owner_id ?? null,
      client_name: agency_name,
      client_email: agency_email ?? null,
      subtotal,
      tax_rate,
      tax_amount,
      total_amount,
      due_date: due_date ?? null,
      notes: notes ?? null,
      status: 'draft',
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (items.length > 0) {
    await supabase
      .from('invoice_items')
      .insert(items.map(i => ({ ...i, invoice_id: invoice.id })));
  }

  await logActivity({
    entityType: 'invoice',
    entityId: invoice.id,
    campaignId: campaign_id ?? null,
    action: 'invoice.mpi_created',
    summary: `Media partner invoice ${invoice_number} raised — ₦${Number(total_amount).toLocaleString('en-NG')}`,
    actorRole: 'owner',
    metadata: { line_count: items.length },
  }, supabase);

  return NextResponse.json(invoice, { status: 201 });
}

// GET — list media partner invoices, optionally filtered by owner_id or agency_id
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const owner_id = searchParams.get('owner_id');
  const agency_id = searchParams.get('agency_id');
  const campaign_id = searchParams.get('campaign_id');

  let q = supabase
    .from('invoices')
    .select('*, campaign:campaigns(id, name), items:invoice_items(*)')
    .eq('invoice_type', 'media_partner')
    .order('created_at', { ascending: false });

  if (owner_id)   q = q.eq('owner_id', owner_id);
  if (agency_id)  q = q.eq('agency_id', agency_id);
  if (campaign_id) q = q.eq('campaign_id', campaign_id);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

// PATCH — update status (draft→sent, sent→acknowledged, acknowledged→paid)
export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const { id, status } = body;
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const allowed = ['status', 'agency_id', 'due_date', 'notes'];
  const updates: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in body) updates[key] = body[key];
  }
  if (status === 'paid') updates.paid_at = new Date().toISOString();

  const { data: before } = await supabase
    .from('invoices')
    .select('id, status, invoice_number, campaign_id')
    .eq('id', id)
    .single();

  const { data, error } = await supabase
    .from('invoices')
    .update(updates)
    .eq('id', id)
    .eq('invoice_type', 'media_partner')
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Email agency when owner sends the MPI
  if (data && data.status === 'sent' && before?.status !== 'sent') {
    const agencyUserId = data.agency_id ?? data.campaign?.agency_id;
    if (agencyUserId) {
      const { data: { user } } = await supabase.auth.admin.getUserById(agencyUserId);
      if (user?.email) {
        const ownerUser = data.owner_id ? await supabase.auth.admin.getUserById(data.owner_id) : null;
        const ownerName = ownerUser?.data?.user?.user_metadata?.full_name ?? 'Board owner';
        await emailMPISent({
          to: user.email,
          invoiceNumber: data.invoice_number,
          totalAmount: data.total_amount,
          ownerName,
          invoiceId: id,
        });
      }
    }
  }

  if (before && data) {
    const changes = diffFields(
      before as Record<string, unknown>,
      { status: data.status } as Record<string, unknown>,
      ['status'],
    );
    await logActivity({
      entityType: 'invoice',
      entityId: id,
      campaignId: data.campaign_id,
      action: 'invoice.mpi_updated',
      summary: `MPI ${data.invoice_number}: status → ${data.status}`,
      actorRole: 'owner',
      changes,
    }, supabase);
  }

  return NextResponse.json(data);
}
