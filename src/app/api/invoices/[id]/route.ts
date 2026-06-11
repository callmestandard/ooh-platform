import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { diffFields, logActivity } from '@/lib/activity-log';
import { emailInvoiceSent } from '@/lib/email';
import { requireAuth, unauthorized } from '@/lib/require-auth';

export const runtime = 'nodejs';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireAuth(req);
  if (!user) return unauthorized();
  const { id } = await params;

  const { data, error } = await supabase
    .from('invoices')
    .select('*, campaign:campaigns(id, name, erp_system, client_cost_centre, payment_terms, agency_id), items:invoice_items(*)')
    .eq('id', id)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 404 });

  // Scope: verify caller owns this invoice
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single();
  const inv = data as Record<string, unknown> & { campaign?: { agency_id?: string } | null; owner_id?: string | null; agency_id?: string | null };
  if (profile?.role === 'agency' && inv.campaign?.agency_id !== user.id && inv.agency_id !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (profile?.role === 'owner' && inv.owner_id !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  return NextResponse.json(data);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireAuth(req);
  if (!user) return unauthorized();
  const { id } = await params;
  const body = await req.json();

  // Only allow safe status/payment fields
  const allowed = ['status', 'paid_at', 'payment_ref', 'payment_url', 'due_date', 'notes', 'client_email', 'client_invoice_number', 'wht_rate'];
  const updates: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in body) updates[key] = body[key];
  }

  if (body.status === 'paid' && !updates.paid_at) {
    updates.paid_at = new Date().toISOString();
  }

  const { data: before } = await supabase
    .from('invoices')
    .select('id, status, client_invoice_number, total_amount, campaign_id, invoice_number')
    .eq('id', id)
    .single();

  const { data, error } = await supabase
    .from('invoices')
    .update(updates)
    .eq('id', id)
    .select('*, campaign:campaigns(id, name, erp_system, client_cost_centre, payment_terms, agency_id), items:invoice_items(*)')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Send email when invoice is first sent to client
  if (data && data.status === 'sent' && before?.status !== 'sent' && data.client_email) {
    const agencyName = data.campaign?.agency_id ? 'Your agency' : 'OOH Platform Agency';
    await emailInvoiceSent({
      to: data.client_email,
      invoiceNumber: data.invoice_number,
      totalAmount: data.total_amount,
      agencyName,
      dueDate: data.due_date ?? null,
      invoiceId: id,
    });
  }

  if (before && data) {
    const changes = diffFields(
      before as Record<string, unknown>,
      {
        status: data.status,
        client_invoice_number: data.client_invoice_number,
        paid_at: data.paid_at,
      } as Record<string, unknown>,
      ['status', 'client_invoice_number', 'paid_at'],
    );
    const statusLine = data.status !== before.status
      ? `Status → ${data.status}`
      : data.client_invoice_number !== before.client_invoice_number
        ? `Oracle ref updated`
        : 'Invoice updated';
    await logActivity({
      entityType: 'invoice',
      entityId: id,
      campaignId: data.campaign_id,
      action: data.status === 'paid' ? 'invoice.paid' : 'invoice.updated',
      summary: `${data.invoice_number}: ${statusLine}`,
      actorRole: 'agency',
      changes,
      metadata: { invoice_number: data.invoice_number },
    }, supabase);
  }

  return NextResponse.json(data);
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireAuth(req);
  if (!user) return unauthorized();
  const { id } = await params;

  const { data: inv } = await supabase
    .from('invoices')
    .select('id, invoice_number, status, campaign_id')
    .eq('id', id)
    .single();

  const { error } = await supabase
    .from('invoices')
    .update({ status: 'cancelled' })
    .eq('id', id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (inv) {
    await logActivity({
      entityType: 'invoice',
      entityId: id,
      campaignId: inv.campaign_id,
      action: 'invoice.cancelled',
      summary: `${inv.invoice_number} cancelled`,
      actorRole: 'agency',
      changes: { status: { from: inv.status, to: 'cancelled' } },
    }, supabase);
  }

  return NextResponse.json({ ok: true });
}
