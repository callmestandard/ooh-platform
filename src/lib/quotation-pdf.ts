// Quotation PDF (061). Server only. Takes buyer-facing fields only: owner
// prices, costs, pricing modes and margins are never passed in, so they
// cannot end up in the file.
//
// The built-in PDF fonts have no ₦ glyph, so amounts are written "NGN".

export type QuotationPdfData = {
  ref: string;
  status: string;
  title: string | null;
  issuedOn: string | null;
  validUntil: string | null;
  buyer: { company: string | null; name: string | null; email: string | null };
  lines: { kind: string; description: string; startDate: string | null; endDate: string | null; months: number; unitMonthly: number | null; lineTotal: number }[];
  subtotal: number; discountTotal: number; vatRate: number; vatAmount: number; total: number;
  paymentTerms: string | null; cancellationTerms: string | null; specialConditions: string | null; buyerNote: string | null;
};

const ngn = (n: number) => `${n < 0 ? '-' : ''}NGN ${Math.abs(n).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (d: string | null) => {
  if (!d) return '-';
  const t = new Date(d);
  return isNaN(t.getTime()) ? '-' : t.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};
const KIND: Record<string, string> = { board: 'Media', printing: 'Printing', installation: 'Installation', production: 'Production', fee: 'Fee', discount: 'Discount' };

export async function quotationPdf(q: QuotationPdfData): Promise<Buffer> {
  const PDFDocument = (await import('pdfkit')).default;
  const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Title: `Quotation ${q.ref}`, Author: 'OOH Platform' } });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const W = doc.page.width, M = 48, CW = W - M * 2;
  const NAVY = '#0F172A', BLUE = '#1B4F8A', SLATE = '#64748B', LINE = '#E2E8F0', LIGHT = '#F8FAFC';

  // Header
  doc.rect(0, 0, W, 84).fill(NAVY);
  doc.font('Helvetica-Bold').fontSize(18).fillColor('#FFFFFF').text('OOH Platform', M, 26);
  doc.font('Helvetica').fontSize(8).fillColor('#94A3B8').text("Nigeria's billboard marketplace", M, 50);
  doc.font('Helvetica-Bold').fontSize(22).fillColor('#FFFFFF').text('QUOTATION', M, 24, { width: CW, align: 'right' });
  doc.font('Helvetica').fontSize(9).fillColor('#CBD5E1').text(q.ref, M, 52, { width: CW, align: 'right' });

  let y = 104;
  if (q.status !== 'sent' && q.status !== 'accepted') {
    const label = q.status === 'draft' ? 'DRAFT - NOT SENT' : q.status.toUpperCase() + ' - NOT VALID FOR ACCEPTANCE';
    doc.rect(M, y, CW, 22).fill('#FEF3C7');
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#92400E').text(label, M, y + 7, { width: CW, align: 'center' });
    y += 32;
  }

  // Meta
  const meta = [['Issued', day(q.issuedOn)], ['Valid until', day(q.validUntil)], ['Reference', q.ref], ['Status', q.status === 'sent' ? 'Open' : q.status[0].toUpperCase() + q.status.slice(1)]];
  doc.rect(M, y, CW, 40).fill(LIGHT);
  meta.forEach(([k, v], i) => {
    const x = M + 12 + i * (CW / 4);
    doc.font('Helvetica-Bold').fontSize(7).fillColor(SLATE).text(k.toUpperCase(), x, y + 8);
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor(NAVY).text(v, x, y + 21, { width: CW / 4 - 16 });
  });
  y += 56;

  // Parties
  doc.font('Helvetica-Bold').fontSize(7).fillColor(SLATE).text('PREPARED FOR', M, y);
  doc.text('FROM', M + CW / 2, y);
  y += 12;
  doc.font('Helvetica-Bold').fontSize(10.5).fillColor(NAVY).text(q.buyer.company || q.buyer.name || 'Buyer', M, y, { width: CW / 2 - 10 });
  doc.text('OOH Platform', M + CW / 2, y);
  y += 15;
  doc.font('Helvetica').fontSize(9).fillColor(SLATE);
  const who = [q.buyer.company ? q.buyer.name : null, q.buyer.email].filter(Boolean).join(' · ');
  if (who) doc.text(who, M, y, { width: CW / 2 - 10 });
  doc.text('Lagos, Nigeria', M + CW / 2, y);
  y += 28;
  if (q.title) {
    doc.font('Helvetica-Bold').fontSize(12).fillColor(NAVY).text(q.title, M, y, { width: CW });
    y = doc.y + 10;
  }

  // Lines
  const cols = [{ t: 'Item', w: CW * 0.46 }, { t: 'Period', w: CW * 0.2 }, { t: 'Per month', w: CW * 0.16, r: true }, { t: 'Amount', w: CW * 0.18, r: true }];
  const head = () => {
    doc.rect(M, y, CW, 20).fill(BLUE);
    let x = M;
    for (const c of cols) {
      doc.font('Helvetica-Bold').fontSize(8).fillColor('#FFFFFF').text(c.t.toUpperCase(), x + 6, y + 6, { width: c.w - 12, align: c.r ? 'right' : 'left' });
      x += c.w;
    }
    y += 20;
  };
  head();
  for (const l of q.lines) {
    const period = l.kind === 'board' ? `${day(l.startDate)} - ${day(l.endDate)}\n${l.months} month${l.months === 1 ? '' : 's'}` : '';
    const desc = `${KIND[l.kind] ?? l.kind}: ${l.description}`;
    doc.font('Helvetica').fontSize(9);
    const h = Math.max(doc.heightOfString(desc, { width: cols[0].w - 12 }), doc.heightOfString(period || ' ', { width: cols[1].w - 12 })) + 12;
    if (y + h > doc.page.height - 200) { doc.addPage(); y = 48; head(); }
    let x = M;
    const cells = [desc, period, l.unitMonthly != null ? ngn(l.unitMonthly) : '', ngn(l.lineTotal)];
    cells.forEach((v, i) => {
      doc.font(i === 3 ? 'Helvetica-Bold' : 'Helvetica').fontSize(9).fillColor(NAVY).text(v, x + 6, y + 6, { width: cols[i].w - 12, align: cols[i].r ? 'right' : 'left' });
      x += cols[i].w;
    });
    y += h;
    doc.moveTo(M, y).lineTo(M + CW, y).strokeColor(LINE).lineWidth(0.6).stroke();
  }

  // Totals
  y += 10;
  const tot: [string, string, boolean][] = [['Subtotal', ngn(q.subtotal), false]];
  if (q.discountTotal) tot.push(['Discount', ngn(-q.discountTotal), false]);
  tot.push([`VAT (${q.vatRate}%)`, ngn(q.vatAmount), false]);
  tot.push(['Total', ngn(q.total), true]);
  for (const [k, v, strong] of tot) {
    doc.font(strong ? 'Helvetica-Bold' : 'Helvetica').fontSize(strong ? 11.5 : 9.5).fillColor(NAVY);
    doc.text(k, M + CW * 0.5, y, { width: CW * 0.25 });
    doc.text(v, M + CW * 0.75, y, { width: CW * 0.25, align: 'right' });
    y += strong ? 20 : 15;
  }
  y += 10;

  // Terms
  const terms: [string, string | null][] = [
    ['Note', q.buyerNote], ['Payment terms', q.paymentTerms], ['Cancellation', q.cancellationTerms], ['Conditions', q.specialConditions],
  ];
  for (const [k, v] of terms) {
    if (!v) continue;
    if (y > doc.page.height - 120) { doc.addPage(); y = 48; }
    doc.font('Helvetica-Bold').fontSize(8).fillColor(SLATE).text(k.toUpperCase(), M, y);
    doc.font('Helvetica').fontSize(9).fillColor(NAVY).text(v, M, y + 11, { width: CW });
    y = doc.y + 10;
  }
  if (y > doc.page.height - 90) { doc.addPage(); y = 48; }
  doc.font('Helvetica').fontSize(8).fillColor(SLATE).text(
    `This quotation can be accepted until ${day(q.validUntil)}. Availability is confirmed by the media owner; nothing is booked until OOH Platform confirms the booking in writing.`,
    M, y + 6, { width: CW });

  doc.end();
  return done;
}
