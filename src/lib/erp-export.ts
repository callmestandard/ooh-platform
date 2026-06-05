/**
 * ERP-ready invoice export (CSV / XML) for Oracle, SAP, Business Central import.
 */

export type ErpInvoiceItem = {
  description: string;
  board_name?: string | null;
  board_format?: string | null;
  location?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  quantity: number;
  unit_price: number;
  total: number;
};

export type ErpInvoicePayload = {
  invoice_number: string;
  created_at: string;
  due_date?: string | null;
  status: string;
  client_name: string;
  client_email?: string | null;
  client_invoice_number?: string | null;
  campaign_name?: string | null;
  erp_system?: string | null;
  client_cost_centre?: string | null;
  payment_terms?: string | null;
  agency_vendor_code?: string | null;
  agency_name?: string | null;
  currency: string;
  subtotal: number;
  tax_rate: number;
  tax_amount: number;
  wht_rate: number;
  items: ErpInvoiceItem[];
};

export type TaxBreakdown = {
  subtotal: number;
  vatRate: number;
  vatAmount: number;
  whtRate: number;
  whtAmount: number;
  grossTotal: number;
  netPayable: number;
};

export function computeTaxBreakdown(
  subtotal: number,
  vatRate: number,
  whtRate: number,
): TaxBreakdown {
  const vatAmount = Math.round(subtotal * (vatRate / 100) * 100) / 100;
  const whtAmount = Math.round(subtotal * (whtRate / 100) * 100) / 100;
  const grossTotal = Math.round((subtotal + vatAmount) * 100) / 100;
  const netPayable = Math.round((grossTotal - whtAmount) * 100) / 100;
  return { subtotal, vatRate, vatAmount, whtRate, whtAmount, grossTotal, netPayable };
}

function escCsv(v: string | number | null | undefined): string {
  if (v == null) return '';
  const s = String(v);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function escXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtDateIso(s?: string | null): string {
  if (!s) return '';
  return new Date(s).toISOString().slice(0, 10);
}

export function buildInvoiceCsv(payload: ErpInvoicePayload): string {
  const tax = computeTaxBreakdown(payload.subtotal, payload.tax_rate, payload.wht_rate);
  const header = [
    'invoice_number', 'invoice_date', 'due_date', 'status', 'currency',
    'client_name', 'client_email', 'client_po_ref', 'campaign_name',
    'erp_system', 'cost_centre', 'payment_terms', 'vendor_code', 'supplier_name',
    'line_no', 'description', 'board_name', 'board_format', 'location',
    'start_date', 'end_date', 'quantity', 'unit_price', 'line_total',
    'subtotal', 'vat_rate_pct', 'vat_amount', 'wht_rate_pct', 'wht_amount',
    'gross_total', 'net_payable',
  ];

  const meta = [
    payload.invoice_number,
    fmtDateIso(payload.created_at),
    fmtDateIso(payload.due_date),
    payload.status,
    payload.currency,
    payload.client_name,
    payload.client_email ?? '',
    payload.client_invoice_number ?? '',
    payload.campaign_name ?? '',
    payload.erp_system ?? '',
    payload.client_cost_centre ?? '',
    payload.payment_terms ?? '',
    payload.agency_vendor_code ?? '',
    payload.agency_name ?? '',
  ];

  const rows: string[] = [header.join(',')];

  const items = payload.items.length > 0 ? payload.items : [{
    description: 'OOH media placement',
    quantity: 1,
    unit_price: payload.subtotal,
    total: payload.subtotal,
  }];

  items.forEach((item, i) => {
    rows.push([
      ...meta,
      String(i + 1),
      item.description,
      item.board_name ?? '',
      item.board_format ?? '',
      item.location ?? '',
      fmtDateIso(item.start_date),
      fmtDateIso(item.end_date),
      item.quantity,
      item.unit_price,
      item.total,
      i === 0 ? tax.subtotal : '',
      i === 0 ? tax.vatRate : '',
      i === 0 ? tax.vatAmount : '',
      i === 0 ? tax.whtRate : '',
      i === 0 ? tax.whtAmount : '',
      i === 0 ? tax.grossTotal : '',
      i === 0 ? tax.netPayable : '',
    ].map(escCsv).join(','));
  });

  return rows.join('\r\n');
}

export function buildInvoiceXml(payload: ErpInvoicePayload): string {
  const tax = computeTaxBreakdown(payload.subtotal, payload.tax_rate, payload.wht_rate);
  const lines = (payload.items.length > 0 ? payload.items : [{
    description: 'OOH media placement',
    quantity: 1,
    unit_price: payload.subtotal,
    total: payload.subtotal,
  }]).map((item, i) => `
    <LineItem lineNumber="${i + 1}">
      <Description>${escXml(item.description)}</Description>
      ${item.board_name ? `<BoardName>${escXml(item.board_name)}</BoardName>` : ''}
      ${item.location ? `<Location>${escXml(item.location)}</Location>` : ''}
      ${item.start_date ? `<StartDate>${fmtDateIso(item.start_date)}</StartDate>` : ''}
      ${item.end_date ? `<EndDate>${fmtDateIso(item.end_date)}</EndDate>` : ''}
      <Quantity>${item.quantity}</Quantity>
      <UnitPrice currency="${payload.currency}">${item.unit_price}</UnitPrice>
      <LineTotal currency="${payload.currency}">${item.total}</LineTotal>
      ${payload.client_cost_centre ? `<CostCentre>${escXml(payload.client_cost_centre)}</CostCentre>` : ''}
    </LineItem>`).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<OOHPlatformInvoice xmlns="https://ooh-platform.ng/erp-export/1.0">
  <Header>
    <InvoiceNumber>${escXml(payload.invoice_number)}</InvoiceNumber>
    <InvoiceDate>${fmtDateIso(payload.created_at)}</InvoiceDate>
    <DueDate>${fmtDateIso(payload.due_date)}</DueDate>
    <Status>${escXml(payload.status)}</Status>
    <Currency>${escXml(payload.currency)}</Currency>
    <ClientName>${escXml(payload.client_name)}</ClientName>
    ${payload.client_email ? `<ClientEmail>${escXml(payload.client_email)}</ClientEmail>` : ''}
    ${payload.client_invoice_number ? `<ClientPOReference>${escXml(payload.client_invoice_number)}</ClientPOReference>` : ''}
    ${payload.campaign_name ? `<CampaignName>${escXml(payload.campaign_name)}</CampaignName>` : ''}
    ${payload.erp_system ? `<ERPSystem>${escXml(payload.erp_system)}</ERPSystem>` : ''}
    ${payload.payment_terms ? `<PaymentTerms>${escXml(payload.payment_terms)}</PaymentTerms>` : ''}
    ${payload.agency_vendor_code ? `<VendorCode>${escXml(payload.agency_vendor_code)}</VendorCode>` : ''}
    ${payload.agency_name ? `<SupplierName>${escXml(payload.agency_name)}</SupplierName>` : ''}
  </Header>
  <LineItems>${lines}
  </LineItems>
  <TaxSummary currency="${payload.currency}">
    <Subtotal>${tax.subtotal}</Subtotal>
    <VAT rate="${tax.vatRate}">${tax.vatAmount}</VAT>
    <WHT rate="${tax.whtRate}">${tax.whtAmount}</WHT>
    <GrossTotal>${tax.grossTotal}</GrossTotal>
    <NetPayable>${tax.netPayable}</NetPayable>
  </TaxSummary>
</OOHPlatformInvoice>`;
}
