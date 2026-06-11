import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAuth, unauthorized } from '@/lib/require-auth';

export const runtime = 'nodejs';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const BRAND = { navy: '#1B4F8A', amber: '#F59E0B', dark: '#0F172A', slate: '#64748B', light: '#F8FAFC' };

function fmtNaira(n: number): string {
  if (n >= 1_000_000) return '₦' + (n / 1_000_000).toFixed(2) + 'M';
  if (n >= 1_000)     return '₦' + n.toLocaleString('en-NG');
  return '₦' + n.toFixed(2);
}

function fmtDate(s?: string | null): string {
  if (!s) return '—';
  return new Date(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function hexToRgb(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return [r, g, b];
}

function setFill(doc: PDFKit.PDFDocument, hex: string) {
  doc.fillColor(hexToRgb(hex) as unknown as string);
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireAuth(req);
  if (!user) return unauthorized();
  const { id } = await params;

  const { data: invoice, error } = await supabase
    .from('invoices')
    .select('*, campaign:campaigns(id, name), items:invoice_items(*)')
    .eq('id', id)
    .single();

  if (error || !invoice) {
    return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
  }

  const PDFDocument = (await import('pdfkit')).default;

  const pdfBuffer = await new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 0, info: { Title: invoice.invoice_number } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const W = 595.28;
    const M = 48; // margin
    const contentW = W - M * 2;

    // ── Header band ──────────────────────────────────────────────────
    doc.rect(0, 0, W, 90).fill(hexToRgb(BRAND.navy) as unknown as string);

    // Company name
    setFill(doc, '#FFFFFF');
    doc.font('Helvetica-Bold').fontSize(20).text('OOH PLATFORM', M, 28);

    setFill(doc, 'rgba(255,255,255,0.55)');
    doc.font('Helvetica').fontSize(8).text('Lagos, Nigeria · ooh-platform.com', M, 52);

    // INVOICE label
    setFill(doc, '#FFFFFF');
    doc.font('Helvetica-Bold').fontSize(28).text('INVOICE', W - M - 150, 22, { width: 150, align: 'right' });

    setFill(doc, hexToRgb(BRAND.amber) as unknown as string);
    doc.font('Helvetica-Bold').fontSize(10).text(invoice.invoice_number, W - M - 150, 58, { width: 150, align: 'right' });

    // ── Invoice meta row ─────────────────────────────────────────────
    let y = 110;
    const metaItems = [
      { label: 'Invoice Date', value: fmtDate(invoice.created_at) },
      { label: 'Due Date',     value: fmtDate(invoice.due_date) },
      { label: 'Our Ref.',     value: invoice.invoice_number },
      ...(invoice.client_invoice_number ? [{ label: 'Client Ref. (Oracle)', value: invoice.client_invoice_number }] : []),
      ...(invoice.campaign ? [{ label: 'Campaign', value: invoice.campaign.name }] : []),
    ];

    const colW = contentW / metaItems.length;
    metaItems.forEach((m, i) => {
      const x = M + i * colW;
      setFill(doc, BRAND.slate);
      doc.font('Helvetica').fontSize(7).text(m.label.toUpperCase(), x, y, { width: colW - 8 });
      setFill(doc, BRAND.dark);
      doc.font('Helvetica-Bold').fontSize(9.5).text(m.value, x, y + 12, { width: colW - 8 });
    });

    // ── Bill To ──────────────────────────────────────────────────────
    y = 158;
    doc.rect(M, y, contentW, 60).fill(hexToRgb('#F8FAFC') as unknown as string);
    doc.rect(M, y, 3, 60).fill(hexToRgb(BRAND.navy) as unknown as string);

    setFill(doc, BRAND.slate);
    doc.font('Helvetica').fontSize(7).text('BILL TO', M + 12, y + 10);
    setFill(doc, BRAND.dark);
    doc.font('Helvetica-Bold').fontSize(12).text(invoice.client_name, M + 12, y + 22);
    if (invoice.client_email) {
      setFill(doc, BRAND.slate);
      doc.font('Helvetica').fontSize(8.5).text(invoice.client_email, M + 12, y + 38);
    }

    // ── Line items table ─────────────────────────────────────────────
    y = 238;

    // Table header
    doc.rect(M, y, contentW, 22).fill(hexToRgb(BRAND.dark) as unknown as string);
    const cols = [
      { label: '#',          x: M + 8,    width: 18 },
      { label: 'Description', x: M + 30,   width: 200 },
      { label: 'Period',      x: M + 238,  width: 120 },
      { label: 'Qty',         x: M + 364,  width: 30 },
      { label: 'Unit Price',  x: M + 400,  width: 70 },
      { label: 'Total',       x: M + 478,  width: 65 },
    ];

    setFill(doc, '#FFFFFF');
    doc.font('Helvetica-Bold').fontSize(7.5);
    cols.forEach(c => doc.text(c.label, c.x, y + 7, { width: c.width }));

    y += 22;

    const items: {
      description: string; board_format?: string; location?: string;
      start_date?: string; end_date?: string; quantity: number;
      unit_price: number; total: number;
    }[] = invoice.items || [];

    items.forEach((item, idx) => {
      const rowH = 36;
      const bg = idx % 2 === 0 ? '#FFFFFF' : '#F8FAFC';
      doc.rect(M, y, contentW, rowH).fill(hexToRgb(bg) as unknown as string);

      // Row number
      setFill(doc, BRAND.slate);
      doc.font('Helvetica').fontSize(8).text(String(idx + 1), cols[0].x, y + 8, { width: cols[0].width });

      // Description + format badge
      setFill(doc, BRAND.dark);
      doc.font('Helvetica-Bold').fontSize(8.5).text(item.description, cols[1].x, y + 7, { width: cols[1].width });
      if (item.board_format || item.location) {
        setFill(doc, BRAND.slate);
        doc.font('Helvetica').fontSize(7).text(
          [item.board_format, item.location].filter(Boolean).join(' · '),
          cols[1].x, y + 21, { width: cols[1].width }
        );
      }

      // Period
      const period = item.start_date && item.end_date
        ? `${fmtDate(item.start_date)} →\n${fmtDate(item.end_date)}`
        : '—';
      setFill(doc, BRAND.slate);
      doc.font('Helvetica').fontSize(7.5).text(period, cols[2].x, y + 8, { width: cols[2].width, lineGap: 1 });

      // Qty
      setFill(doc, BRAND.dark);
      doc.font('Helvetica').fontSize(8.5).text(String(item.quantity), cols[3].x, y + 8, { width: cols[3].width, align: 'center' });

      // Unit price
      doc.font('Helvetica').fontSize(8.5).text(fmtNaira(item.unit_price), cols[4].x, y + 8, { width: cols[4].width, align: 'right' });

      // Total
      doc.font('Helvetica-Bold').fontSize(8.5).text(fmtNaira(item.total), cols[5].x, y + 8, { width: cols[5].width, align: 'right' });

      y += rowH;
    });

    if (items.length === 0) {
      doc.rect(M, y, contentW, 30).fill(hexToRgb('#F8FAFC') as unknown as string);
      setFill(doc, BRAND.slate);
      doc.font('Helvetica').fontSize(9).text('No line items', M, y + 10, { width: contentW, align: 'center' });
      y += 30;
    }

    // ── Totals ───────────────────────────────────────────────────────
    y += 16;
    const totalsX = W - M - 200;

    const totalRows = [
      { label: 'Subtotal',          value: fmtNaira(invoice.subtotal),     bold: false },
      { label: `VAT (${invoice.tax_rate}%)`, value: fmtNaira(invoice.tax_amount), bold: false },
    ];

    totalRows.forEach(row => {
      setFill(doc, BRAND.slate);
      doc.font('Helvetica').fontSize(9).text(row.label, totalsX, y, { width: 110 });
      setFill(doc, BRAND.dark);
      doc.font(row.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9)
        .text(row.value, totalsX + 110, y, { width: 90, align: 'right' });
      y += 16;
    });

    // Total band
    y += 4;
    doc.rect(totalsX - 8, y, 210, 32).fill(hexToRgb(BRAND.navy) as unknown as string);
    setFill(doc, '#FFFFFF');
    doc.font('Helvetica-Bold').fontSize(10).text('TOTAL', totalsX, y + 10, { width: 110 });
    doc.font('Helvetica-Bold').fontSize(14).text(fmtNaira(invoice.total_amount), totalsX + 110, y + 7, { width: 90, align: 'right' });

    // ── Payment details ───────────────────────────────────────────────
    y += 56;
    doc.rect(M, y, contentW, 1).fill(hexToRgb('#E2E8F0') as unknown as string);
    y += 12;

    setFill(doc, BRAND.slate);
    doc.font('Helvetica-Bold').fontSize(8).text('PAYMENT DETAILS', M, y);
    y += 14;

    const bankDetails = [
      { label: 'Bank',       value: process.env.BANK_NAME || 'Guaranty Trust Bank (GTB)' },
      { label: 'Account No', value: process.env.BANK_ACCOUNT || '0123456789' },
      { label: 'Account Name', value: process.env.BANK_ACCOUNT_NAME || 'OOH Platform Limited' },
      { label: 'Our Ref.',   value: invoice.invoice_number },
      ...(invoice.client_invoice_number ? [{ label: 'Client Ref. (Oracle)', value: invoice.client_invoice_number }] : []),
    ];

    const detailColW = contentW / bankDetails.length;
    bankDetails.forEach((d, i) => {
      const x = M + i * detailColW;
      setFill(doc, BRAND.slate);
      doc.font('Helvetica').fontSize(7).text(d.label, x, y);
      setFill(doc, BRAND.dark);
      doc.font('Helvetica-Bold').fontSize(8.5).text(d.value, x, y + 11);
    });

    if (invoice.payment_url) {
      y += 36;
      setFill(doc, BRAND.slate);
      doc.font('Helvetica').fontSize(7.5).text('Or pay online:', M, y);
      setFill(doc, BRAND.navy);
      doc.font('Helvetica').fontSize(7.5).text(invoice.payment_url, M + 60, y, { link: invoice.payment_url });
    }

    if (invoice.notes) {
      y += 36;
      setFill(doc, BRAND.slate);
      doc.font('Helvetica-Bold').fontSize(8).text('NOTES', M, y);
      doc.font('Helvetica').fontSize(8.5).text(invoice.notes, M, y + 12, { width: contentW });
    }

    // ── Footer ───────────────────────────────────────────────────────
    const pageH = 841.89;
    doc.rect(0, pageH - 36, W, 36).fill(hexToRgb(BRAND.dark) as unknown as string);
    setFill(doc, 'rgba(255,255,255,0.4)');
    doc.font('Helvetica').fontSize(7).text(
      `${invoice.invoice_number}  ·  Generated by OOH Platform  ·  Thank you for your business`,
      M, pageH - 22, { width: contentW, align: 'center' }
    );

    doc.end();
  });

  return new NextResponse(pdfBuffer as unknown as BodyInit, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${invoice.invoice_number}.pdf"`,
    },
  });
}
