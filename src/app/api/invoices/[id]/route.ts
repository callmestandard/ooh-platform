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
  // Auth is optional here: /invoice/[id] is a shareable link (WhatsApp/copy
  // link/Paystack pay), the same unguessable-UUID-as-access-token model
  // already used for /api/report/[id] and /api/poe/[token] — anyone with
  // the link can view/pay that one invoice, no account required. When a
  // session IS present (the agency/client/owner dashboards), the stricter
  // ownership check below still applies.
  const user = await requireAuth(req);
  const { id } = await params;

  const { data, error } = await supabase
    .from('invoices')
    .select('*, campaign:campaigns(id, name, erp_system, client_cost_centre, payment_terms, agency_id, client_id), items:invoice_items(*)')
    .eq('id', id)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 404 });

  if (user) {
    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single();
    const inv = data as Record<string, unknown> & { campaign?: { agency_id?: string; client_id?: string } | null; owner_id?: string | null; agency_id?: string | null };
    if (profile?.role === 'agency' && inv.campaign?.agency_id !== user.id && inv.agency_id !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (profile?.role === 'owner' && inv.owner_id !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (profile?.role === 'client' && inv.campaign?.client_id !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }

  return NextResponse.json(data);
}

// Only the agency that owns the campaign (or admin) may touch financial/
// status fields — a client may only annotate their own ERP reference.
const AGENCY_ONLY_FIELDS = ['status', 'paid_at', 'payment_ref', 'payment_url', 'due_date', 'notes', 'wht_rate'];
const CLIENT_ALLOWED_FIELDS = ['client_email', 'client_invoice_number'];

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireAuth(req);
  if (!user) return unauthorized();
  const { id } = await params;
  const body = await req.json();

  const { data: existing } = await supabase
    .from('invoices')
    .select('agency_id, campaign:campaigns(agency_id, client_id)')
    .eq('id', id)
    .single();
  const existingCampaign = existing?.campaign as unknown as { agency_id?: string; client_id?: string } | null;
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single();
  const isAdmin = profile?.role === 'admin';
  const isOwningAgency = existingCampaign?.agency_id === user.id || existing?.agency_id === user.id;
  const isOwningClient = existingCampaign?.client_id === user.id;

  if (!isAdmin && !isOwningAgency && !isOwningClient) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const allowed = (isAdmin || isOwningAgency)
    ? [...AGENCY_ONLY_FIELDS, ...CLIENT_ALLOWED_FIELDS]
    : CLIENT_ALLOWED_FIELDS; // client-only session: reference fields only
  const updates: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in body) updates[key] = body[key];
  }

  if (updates.status === 'paid' && !updates.paid_at) {
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
    .select('id, invoice_number, status, campaign_id, agency_id, campaign:campaigns(agency_id)')
    .eq('id', id)
    .single();

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single();
  const invCampaign = inv?.campaign as unknown as { agency_id?: string } | null;
  const authorized = profile?.role === 'admin' || invCampaign?.agency_id === user.id || inv?.agency_id === user.id;
  if (!authorized) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

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
