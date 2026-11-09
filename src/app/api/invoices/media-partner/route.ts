import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { diffFields, logActivity } from '@/lib/activity-log';
import { emailMPISent } from '@/lib/email';
import { requireAuth, unauthorized } from '@/lib/require-auth';

export const runtime = 'nodejs';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

/** The owner company the caller works for (an owner or their team), or null. */
async function callerOwnerCompany(uid: string): Promise<string | null> {
  const { data } = await supabase.rpc('owner_company_of', { p_uid: uid });
  return (data as string | null) ?? null;
}

async function isOwnerSide(ownerId: string | null | undefined, uid: string): Promise<boolean> {
  if (!ownerId) return false;
  if (ownerId === uid) return true;
  const { data } = await supabase.rpc('is_owner_member', { p_owner_id: ownerId, p_uid: uid });
  return !!data;
}

function nextInvoiceNumber(count: number): string {
  const year = new Date().getFullYear();
  return `MPI-${year}-${String(count + 1).padStart(4, '0')}`;
}

// POST — owner creates a media partner invoice for a booking
export async function POST(req: NextRequest) {
  const user = await requireAuth(req);
  if (!user) return unauthorized();
  // Only a board owner (or their team) raises these, and always as their own company.
  const owner_id = await callerOwnerCompany(user.id);
  if (!owner_id) return NextResponse.json({ error: 'Only board owners can raise media partner invoices' }, { status: 403 });
  const body = await req.json();
  const {
    booking_id,
    campaign_id,
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
  let invoiceCampaignId: string | null = campaign_id ?? null;
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
      .select('id, campaign_id, agreed_rate, offered_rate, start_date, end_date, boards!inner(name, format, city, state, owner_id)')
      .eq('id', booking_id)
      .eq('boards.owner_id', owner_id)
      .single() as {
        data: {
          id: string;
          campaign_id: string | null;
          agreed_rate: number | null;
          offered_rate: number;
          start_date: string;
          end_date: string;
          boards: { name: string; format: string; city: string; state: string };
        } | null
      };

    if (!booking) return NextResponse.json({ error: 'That booking is not on one of your boards' }, { status: 403 });
    // Link the invoice to the booking's campaign, so it can only go to that agency.
    invoiceCampaignId = booking.campaign_id ?? null;
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
      .select('id, agreed_rate, offered_rate, start_date, end_date, boards!inner(name, format, city, state, owner_id)')
      .eq('campaign_id', campaign_id)
      .eq('boards.owner_id', owner_id)
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
    if (items.length === 0) return NextResponse.json({ error: 'No agreed bookings on your boards in that campaign' }, { status: 403 });
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
      campaign_id: invoiceCampaignId,
      owner_id,
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
    campaignId: invoiceCampaignId,
    action: 'invoice.mpi_created',
    summary: `Media partner invoice ${invoice_number} raised — ₦${Number(total_amount).toLocaleString('en-NG')}`,
    actorRole: 'owner',
    metadata: { line_count: items.length },
  }, supabase);

  return NextResponse.json(invoice, { status: 201 });
}

// GET — list media partner invoices scoped to the caller
export async function GET(req: NextRequest) {
  const user = await requireAuth(req);
  if (!user) return unauthorized();
  const { searchParams } = new URL(req.url);
  const campaign_id = searchParams.get('campaign_id');

  // Scope: determine role and filter accordingly
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single();
  const role = profile?.role;

  let q = supabase
    .from('invoices')
    .select('*, campaign:campaigns(id, name), items:invoice_items(*)')
    .eq('invoice_type', 'media_partner')
    .order('created_at', { ascending: false });

  if (role === 'owner') {
    q = q.eq('owner_id', user.id);
  } else if (role === 'agency') {
    q = q.eq('agency_id', user.id);
  }
  if (campaign_id) q = q.eq('campaign_id', campaign_id);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

// PATCH — update status (draft→sent, sent→acknowledged, acknowledged→paid)
export async function PATCH(req: NextRequest) {
  const user = await requireAuth(req);
  if (!user) return unauthorized();
  const body = await req.json();
  const { id, status } = body;
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  // Only the invoice's own owner side may change it.
  const { data: current } = await supabase.from('invoices')
    .select('owner_id, campaign:campaigns(agency_id)').eq('id', id).eq('invoice_type', 'media_partner').maybeSingle();
  if (!current || !(await isOwnerSide(current.owner_id as string | null, user.id))) {
    return NextResponse.json({ error: 'Not your invoice' }, { status: 403 });
  }
  // The invoice can only be addressed to the campaign's agency, or (with no
  // campaign) to an agency account.
  if ('agency_id' in body && body.agency_id) {
    const campaignAgency = (current.campaign as { agency_id?: string } | null)?.agency_id;
    if (campaignAgency ? body.agency_id !== campaignAgency : (await supabase.from('profiles').select('role').eq('id', body.agency_id).maybeSingle()).data?.role !== 'agency') {
      return NextResponse.json({ error: 'That agency is not on this campaign' }, { status: 400 });
    }
  }

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
