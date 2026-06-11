import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  buildInvoiceCsv,
  buildInvoiceXml,
  type ErpInvoicePayload,
} from '@/lib/erp-export';
import { logActivity } from '@/lib/activity-log';
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
  const format = req.nextUrl.searchParams.get('format') === 'xml' ? 'xml' : 'csv';

  const { data: invoice, error } = await supabase
    .from('invoices')
    .select(`
      *,
      campaign:campaigns(id, name, erp_system, client_cost_centre, payment_terms, agency_id),
      items:invoice_items(*)
    `)
    .eq('id', id)
    .single();

  if (error || !invoice) {
    return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
  }

  let agencyVendorCode: string | null = null;
  let agencyName: string | null = null;
  const agencyId = (invoice.campaign as { agency_id?: string } | null)?.agency_id
    ?? invoice.agency_id;

  if (agencyId) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('erp_vendor_code, company_name, full_name')
      .eq('id', agencyId)
      .single();
    agencyVendorCode = profile?.erp_vendor_code ?? null;
    agencyName = profile?.company_name || profile?.full_name || null;
  }

  const campaign = invoice.campaign as {
    name?: string;
    erp_system?: string | null;
    client_cost_centre?: string | null;
    payment_terms?: string | null;
  } | null;

  const payload: ErpInvoicePayload = {
    invoice_number: invoice.invoice_number,
    created_at: invoice.created_at,
    due_date: invoice.due_date,
    status: invoice.status,
    client_name: invoice.client_name,
    client_email: invoice.client_email,
    client_invoice_number: invoice.client_invoice_number,
    campaign_name: campaign?.name ?? null,
    erp_system: campaign?.erp_system ?? null,
    client_cost_centre: campaign?.client_cost_centre ?? null,
    payment_terms: campaign?.payment_terms ?? 'Net 30',
    agency_vendor_code: agencyVendorCode,
    agency_name: agencyName,
    currency: invoice.currency || 'NGN',
    subtotal: Number(invoice.subtotal),
    tax_rate: Number(invoice.tax_rate),
    tax_amount: Number(invoice.tax_amount),
    wht_rate: Number(invoice.wht_rate ?? 5),
    items: (invoice.items || []).map((i: {
      description: string;
      board_name?: string | null;
      board_format?: string | null;
      location?: string | null;
      start_date?: string | null;
      end_date?: string | null;
      quantity: number;
      unit_price: number;
      total: number;
    }) => ({
      description: i.description,
      board_name: i.board_name,
      board_format: i.board_format,
      location: i.location,
      start_date: i.start_date,
      end_date: i.end_date,
      quantity: Number(i.quantity),
      unit_price: Number(i.unit_price),
      total: Number(i.total),
    })),
  };

  const safeName = invoice.invoice_number.replace(/[^a-zA-Z0-9-_]/g, '_');

  if (format === 'xml') {
    const body = buildInvoiceXml(payload);
    await logActivity({
      entityType: 'invoice',
      entityId: id,
      campaignId: invoice.campaign_id,
      action: 'invoice.erp_exported',
      summary: `${invoice.invoice_number} exported as XML for ${campaign?.erp_system || 'ERP'}`,
      actorRole: 'agency',
      metadata: { format: 'xml' },
    }, supabase);

    return new NextResponse(body, {
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Content-Disposition': `attachment; filename="${safeName}-erp.xml"`,
      },
    });
  }

  const body = buildInvoiceCsv(payload);
  await logActivity({
    entityType: 'invoice',
    entityId: id,
    campaignId: invoice.campaign_id,
    action: 'invoice.erp_exported',
    summary: `${invoice.invoice_number} exported as CSV for ${campaign?.erp_system || 'ERP'}`,
    actorRole: 'agency',
    metadata: { format: 'csv' },
  }, supabase);

  return new NextResponse(body, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${safeName}-erp.csv"`,
    },
  });
}
