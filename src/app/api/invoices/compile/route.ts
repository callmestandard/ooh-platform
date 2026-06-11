import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { logActivity } from '@/lib/activity-log';
import { requireAuth, unauthorized } from '@/lib/require-auth';

export const runtime = 'nodejs';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// POST — compile one or more media partner invoices into a single client invoice.
// Pulls all line items from the selected MPIs, optionally adds an agency fee,
// optionally appends a compliance summary in the notes, then creates a client invoice.
// Each source MPI gets its compiled_invoice_id set to the new invoice's id.
export async function POST(req: NextRequest) {
  const user = await requireAuth(req);
  if (!user) return unauthorized();
  const body = await req.json();
  const {
    mpi_ids,           // string[] — media partner invoice IDs to compile
    campaign_id,
    client_name,
    client_email,
    agency_fee = 0,    // optional flat agency fee
    agency_fee_label = 'Agency management fee',
    due_date,
    tax_rate = 7.5,
    notes = '',
    include_compliance = false,
    client_invoice_number,
  } = body as {
    mpi_ids: string[];
    campaign_id?: string;
    client_name: string;
    client_email?: string;
    agency_fee?: number;
    agency_fee_label?: string;
    due_date?: string;
    tax_rate?: number;
    notes?: string;
    include_compliance?: boolean;
    client_invoice_number?: string;
  };

  if (!mpi_ids?.length) {
    return NextResponse.json({ error: 'mpi_ids must not be empty' }, { status: 400 });
  }
  if (!client_name) {
    return NextResponse.json({ error: 'client_name required' }, { status: 400 });
  }

  // Fetch source MPIs and their items
  const { data: mpis, error: mpiErr } = await supabase
    .from('invoices')
    .select('*, items:invoice_items(*)')
    .in('id', mpi_ids)
    .eq('invoice_type', 'media_partner');

  if (mpiErr) return NextResponse.json({ error: mpiErr.message }, { status: 500 });
  if (!mpis?.length) return NextResponse.json({ error: 'No matching media partner invoices' }, { status: 404 });

  // Build line items from all MPIs
  type RawItem = {
    booking_id?: string;
    description: string;
    board_name?: string;
    board_format?: string;
    location?: string;
    start_date?: string;
    end_date?: string;
    quantity: number;
    unit_price: number;
    total: number;
  };
  const allItems: RawItem[] = (mpis as { items: RawItem[] }[]).flatMap(mpi => mpi.items ?? []);

  // Add agency fee line item if provided
  if (agency_fee > 0) {
    allItems.push({
      description: agency_fee_label,
      quantity: 1,
      unit_price: agency_fee,
      total: agency_fee,
    });
  }

  // Optionally pull compliance summary
  let complianceNote = '';
  if (include_compliance) {
    const bookingIds = allItems
      .map(i => i.booking_id)
      .filter((id): id is string => !!id);

    if (bookingIds.length > 0) {
      const { data: checks } = await supabase
        .from('compliance_checks')
        .select('booking_id, status, submitted_at, photo_url')
        .in('booking_id', bookingIds)
        .order('submitted_at', { ascending: false });

      if (checks?.length) {
        const verified = checks.filter(c => c.status === 'verified').length;
        const total = checks.length;
        complianceNote = `\n\n--- Compliance Summary ---\n${verified}/${total} sites verified with proof of posting.\n` +
          checks.map(c => {
            const item = allItems.find(i => i.booking_id === c.booking_id);
            return `• ${item?.description ?? c.booking_id}: ${c.status.toUpperCase()} (${c.submitted_at ? new Date(c.submitted_at).toLocaleDateString('en-GB') : '—'})`;
          }).join('\n');
      }
    }
  }

  const finalNotes = [notes, complianceNote].filter(Boolean).join('').trim();

  // Generate invoice number
  const { count } = await supabase
    .from('invoices')
    .select('*', { count: 'exact', head: true });

  const year = new Date().getFullYear();
  const invoice_number = `INV-${year}-${String((count ?? 0) + 1).padStart(4, '0')}`;

  const subtotal = allItems.reduce((s, i) => s + i.total, 0);
  const tax_amount = Math.round(subtotal * (tax_rate / 100) * 100) / 100;
  const total_amount = subtotal + tax_amount;

  // Insert the client invoice
  const { data: invoice, error: invErr } = await supabase
    .from('invoices')
    .insert({
      invoice_number,
      invoice_type: 'client',
      campaign_id: campaign_id ?? null,
      client_name,
      client_email: client_email ?? null,
      subtotal,
      tax_rate,
      tax_amount,
      total_amount,
      due_date: due_date ?? null,
      notes: finalNotes || null,
      client_invoice_number: client_invoice_number || null,
      status: 'draft',
    })
    .select()
    .single();

  if (invErr) return NextResponse.json({ error: invErr.message }, { status: 500 });

  // Insert line items (exclude the id from source items to avoid conflicts)
  const lineItems = allItems.map(({ ...i }) => ({
    invoice_id: invoice.id,
    booking_id: i.booking_id ?? null,
    description: i.description,
    board_name: i.board_name ?? null,
    board_format: i.board_format ?? null,
    location: i.location ?? null,
    start_date: i.start_date ?? null,
    end_date: i.end_date ?? null,
    quantity: i.quantity,
    unit_price: i.unit_price,
    total: i.total,
  }));

  if (lineItems.length > 0) {
    await supabase.from('invoice_items').insert(lineItems);
  }

  // Mark each source MPI as compiled
  await supabase
    .from('invoices')
    .update({ compiled_invoice_id: invoice.id, status: 'acknowledged' })
    .in('id', mpi_ids);

  await logActivity({
    entityType: 'invoice',
    entityId: invoice.id,
    campaignId: campaign_id ?? null,
    action: 'invoice.compiled',
    summary: `Client invoice ${invoice_number} compiled from ${mpi_ids.length} media partner invoice(s) — ${total_amount.toLocaleString('en-NG')} NGN`,
    actorRole: 'agency',
    metadata: { mpi_ids, line_count: lineItems.length },
  }, supabase);

  for (const mpiId of mpi_ids) {
    await logActivity({
      entityType: 'invoice',
      entityId: mpiId,
      campaignId: campaign_id ?? null,
      action: 'invoice.mpi_acknowledged',
      summary: `Acknowledged and linked to ${invoice_number}`,
      actorRole: 'agency',
      metadata: { compiled_invoice_id: invoice.id },
    }, supabase);
  }

  return NextResponse.json(invoice, { status: 201 });
}
