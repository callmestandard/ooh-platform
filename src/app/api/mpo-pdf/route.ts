import { NextRequest, NextResponse } from 'next/server';
import PDFDocument from 'pdfkit';

const NAVY  = '#1B4F8A';
const AMBER = '#F59E0B';
const DARK  = '#0F172A';
const SLATE = '#475569';
const LIGHT = '#F8FAFC';
const GREEN = '#10B981';
const RED   = '#DC2626';

function rgb(hex: string): [number, number, number] {
  const c = hex.replace('#', '');
  return [parseInt(c.slice(0,2),16), parseInt(c.slice(2,4),16), parseInt(c.slice(4,6),16)];
}

function fmtNaira(n: number) {
  if (n >= 1_000_000_000) return '₦' + (n / 1_000_000_000).toFixed(2) + 'B';
  if (n >= 1_000_000)     return '₦' + (n / 1_000_000).toFixed(2) + 'M';
  if (n >= 1_000)         return '₦' + (n / 1_000).toLocaleString('en-NG');
  return '₦' + n.toLocaleString('en-NG');
}

function fmtDate(s: string) {
  return new Date(s).toLocaleDateString('en-NG', { day: 'numeric', month: 'long', year: 'numeric' });
}

function mpoNumber(bookingId: string) {
  const year = new Date().getFullYear();
  const ref  = bookingId.slice(0, 6).toUpperCase();
  return `OOH-MPO-${year}-${ref}`;
}

function daysBetween(start: string, end: string) {
  return Math.max(1, Math.ceil((new Date(end).getTime() - new Date(start).getTime()) / 86400000));
}

export type MPOPayload = {
  booking_id:    string;
  campaign_name: string;
  client_name:   string;
  start_date:    string;
  end_date:      string;
  agreed_rate:   number;
  board_name:    string;
  board_address: string;
  board_city:    string;
  board_state:   string;
  board_format:  string;
  board_width?:  number;
  board_height?: number;
  agency_name?:  string;
  agency_contact?: string;
  owner_name?:   string;
  notes?:        string;
};

function drawHRule(doc: PDFKit.PDFDocument, x: number, y: number, w: number, color = SLATE) {
  doc.rect(x, y, w, 1).fill(rgb(color));
}

export async function POST(req: NextRequest) {
  try {
    const p: MPOPayload = await req.json();

    const mpo        = mpoNumber(p.booking_id);
    const today      = new Date().toLocaleDateString('en-NG', { day: 'numeric', month: 'long', year: 'numeric' });
    const days       = daysBetween(p.start_date, p.end_date);
    const months     = Math.max(1, Math.round(days / 30));
    const totalValue = p.agreed_rate * months;
    const agencyName = p.agency_name   || 'OOH Platform Agency';
    const ownerName  = p.owner_name    || 'Board Owner';
    const formatLabel: Record<string, string> = {
      billboard: 'Billboard', unipole: 'Unipole', gantry: 'Gantry',
      bridge_panel: 'Bridge Panel', wall_drape: 'Wall Drape',
    };
    const format = formatLabel[p.board_format] || p.board_format || 'Billboard';
    const dimensions = p.board_width && p.board_height
      ? `${p.board_width}m × ${p.board_height}m`
      : 'Contact for dimensions';

    const doc    = new PDFDocument({ size: 'A4', margin: 0, info: { Title: `MPO - ${mpo}`, Author: agencyName } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));

    // ── HEADER BAR ────────────────────────────────────────────────────────────
    doc.rect(0, 0, 595, 72).fill(rgb(DARK));
    doc.rect(0, 72, 595, 4).fill(rgb(AMBER));

    // Platform brand
    doc.fontSize(8).font('Helvetica').fillColor([255,255,255,0.45]).text('OOH PLATFORM', 40, 18);
    doc.fontSize(18).font('Helvetica-Bold').fillColor([255,255,255,1]).text('Media Purchase Order', 40, 34);

    // MPO number + date — right aligned
    doc.fontSize(10).font('Helvetica-Bold').fillColor(rgb(AMBER)).text(mpo, 395, 24, { width: 160, align: 'right' });
    doc.fontSize(8).font('Helvetica').fillColor([255,255,255,0.5]).text(`Issued: ${today}`, 395, 42, { width: 160, align: 'right' });

    // ── STATUS BADGE ─────────────────────────────────────────────────────────
    doc.rect(40, 90, 80, 20).fill(rgb(GREEN));
    doc.fontSize(8).font('Helvetica-Bold').fillColor([255,255,255,1]).text('AGREED', 40, 96, { width: 80, align: 'center' });

    // ── PARTIES ──────────────────────────────────────────────────────────────
    let y = 126;

    doc.fontSize(7).font('Helvetica-Bold').fillColor(rgb(SLATE)).text('ISSUED BY (AGENCY)', 40, y);
    doc.fontSize(7).font('Helvetica-Bold').fillColor(rgb(SLATE)).text('ISSUED TO (MEDIA OWNER)', 310, y);
    y += 12;
    drawHRule(doc, 40, y, 232);
    drawHRule(doc, 310, y, 245);
    y += 6;

    doc.fontSize(10).font('Helvetica-Bold').fillColor(rgb(DARK)).text(agencyName, 40, y, { width: 232 });
    doc.fontSize(10).font('Helvetica-Bold').fillColor(rgb(DARK)).text(ownerName, 310, y, { width: 245 });
    y += 14;

    if (p.agency_contact) {
      doc.fontSize(8).font('Helvetica').fillColor(rgb(SLATE)).text(p.agency_contact, 40, y, { width: 232 });
      y += 12;
    }

    doc.fontSize(8).font('Helvetica').fillColor(rgb(SLATE))
      .text(`Campaign: ${p.campaign_name}`, 40, y, { width: 232 })
      .text(`Client / Brand: ${p.client_name}`, 310, y, { width: 245 });
    y += 20;

    // ── CAMPAIGN DETAILS TABLE ────────────────────────────────────────────────
    drawHRule(doc, 40, y, 515, '#E2E8F0');
    y += 10;

    doc.fontSize(10).font('Helvetica-Bold').fillColor(rgb(DARK)).text('Campaign Details', 40, y);
    y += 16;

    const campRows: [string, string][] = [
      ['Campaign Name',   p.campaign_name],
      ['Client / Brand',  p.client_name],
      ['Campaign Start',  fmtDate(p.start_date)],
      ['Campaign End',    fmtDate(p.end_date)],
      ['Flight Duration', `${days} days (approx. ${months} month${months !== 1 ? 's' : ''})`],
    ];

    for (let i = 0; i < campRows.length; i++) {
      doc.rect(40, y, 515, 20).fill(i % 2 === 0 ? rgb(LIGHT) : [255,255,255]);
      doc.fontSize(8.5).font('Helvetica-Bold').fillColor(rgb(SLATE)).text(campRows[i][0], 50, y + 6, { width: 180 });
      doc.font('Helvetica').fillColor(rgb(DARK)).text(campRows[i][1], 240, y + 6, { width: 310 });
      y += 20;
    }
    y += 14;

    // ── BOARD DETAILS ─────────────────────────────────────────────────────────
    doc.fontSize(10).font('Helvetica-Bold').fillColor(rgb(DARK)).text('Board Details', 40, y);
    y += 16;

    const location = [p.board_address, p.board_city, p.board_state].filter(Boolean).join(', ');
    const boardRows: [string, string][] = [
      ['Board Name',   p.board_name],
      ['Location',     location || '—'],
      ['Format',       format],
      ['Dimensions',   dimensions],
    ];

    for (let i = 0; i < boardRows.length; i++) {
      doc.rect(40, y, 515, 20).fill(i % 2 === 0 ? rgb(LIGHT) : [255,255,255]);
      doc.fontSize(8.5).font('Helvetica-Bold').fillColor(rgb(SLATE)).text(boardRows[i][0], 50, y + 6, { width: 180 });
      doc.font('Helvetica').fillColor(rgb(DARK)).text(boardRows[i][1], 240, y + 6, { width: 310 });
      y += 20;
    }
    y += 14;

    // ── COMMERCIAL TERMS ─────────────────────────────────────────────────────
    doc.fontSize(10).font('Helvetica-Bold').fillColor(rgb(DARK)).text('Commercial Terms', 40, y);
    y += 16;

    // Highlighted rate row
    doc.rect(40, y, 515, 26).fill(rgb('#EFF6FF'));
    doc.rect(40, y, 4, 26).fill(rgb(NAVY));
    doc.fontSize(9).font('Helvetica-Bold').fillColor(rgb(SLATE)).text('Agreed Monthly Rate', 54, y + 8, { width: 200 });
    doc.fontSize(13).font('Helvetica-Bold').fillColor(rgb(NAVY)).text(fmtNaira(p.agreed_rate), 240, y + 6, { width: 310 });
    y += 26;

    const commRows: [string, string][] = [
      ['Number of Months',   months.toString()],
      ['Total Order Value',  fmtNaira(totalValue)],
      ['Payment Terms',      'Net 30 days from invoice date'],
      ['VAT',                '7.5% (VAT inclusive where applicable)'],
    ];

    for (let i = 0; i < commRows.length; i++) {
      doc.rect(40, y, 515, 20).fill(i % 2 === 0 ? [255,255,255] : rgb(LIGHT));
      doc.fontSize(8.5).font('Helvetica-Bold').fillColor(rgb(SLATE)).text(commRows[i][0], 50, y + 6, { width: 180 });
      doc.font('Helvetica').fillColor(rgb(DARK)).text(commRows[i][1], 240, y + 6, { width: 310 });
      y += 20;
    }
    y += 14;

    // ── TOTAL VALUE CALLOUT ────────────────────────────────────────────────────
    doc.rect(40, y, 515, 40).fill(rgb(DARK));
    doc.fontSize(9).font('Helvetica').fillColor([255,255,255,0.55]).text('TOTAL ORDER VALUE', 50, y + 8, { width: 250 });
    doc.fontSize(20).font('Helvetica-Bold').fillColor(rgb(AMBER)).text(fmtNaira(totalValue), 50, y + 18, { width: 250 });
    doc.fontSize(8).font('Helvetica').fillColor([255,255,255,0.55])
      .text(`${fmtNaira(p.agreed_rate)}/month × ${months} month${months !== 1 ? 's' : ''}`, 350, y + 8, { width: 195, align: 'right' })
      .text(`Flight: ${fmtDate(p.start_date)} – ${fmtDate(p.end_date)}`, 350, y + 22, { width: 195, align: 'right' });
    y += 56;

    // ── SPECIAL INSTRUCTIONS ─────────────────────────────────────────────────
    if (p.notes) {
      doc.fontSize(10).font('Helvetica-Bold').fillColor(rgb(DARK)).text('Special Instructions', 40, y);
      y += 14;
      doc.rect(40, y, 515, 1).fill(rgb('#E2E8F0'));
      y += 8;
      doc.fontSize(8.5).font('Helvetica').fillColor(rgb(SLATE)).text(p.notes, 40, y, { width: 515, lineGap: 3 });
      y = doc.y + 16;
    }

    // ── ARTWORK SPECS ─────────────────────────────────────────────────────────
    doc.fontSize(10).font('Helvetica-Bold').fillColor(rgb(DARK)).text('Artwork Specifications', 40, y);
    y += 14;
    drawHRule(doc, 40, y, 515, '#E2E8F0');
    y += 8;

    const specs = [
      `Format: ${format} (${dimensions})`,
      'File format: PDF, AI, or high-resolution JPEG/PNG (min. 300 DPI)',
      'Colour mode: CMYK',
      'Artwork to be uploaded via the OOH Platform Creatives portal',
      'Artwork deadline: 5 working days before campaign start date',
    ];
    for (const spec of specs) {
      doc.fontSize(8.5).font('Helvetica').fillColor(rgb(SLATE)).text(`• ${spec}`, 50, y, { width: 505, lineGap: 2 });
      y = doc.y + 4;
    }
    y += 12;

    // ── SIGNATURE BLOCKS ─────────────────────────────────────────────────────
    // Check page space — if too close to bottom, add new page
    if (y > 680) {
      doc.addPage({ margin: 0 });
      // mini header
      doc.rect(0, 0, 595, 30).fill(rgb(DARK));
      doc.fontSize(8).font('Helvetica').fillColor([255,255,255,0.45]).text(`${mpo}  ·  Signatures`, 40, 10);
      y = 46;
    }

    doc.fontSize(10).font('Helvetica-Bold').fillColor(rgb(DARK)).text('Authorisation', 40, y);
    y += 14;
    drawHRule(doc, 40, y, 515, '#E2E8F0');
    y += 14;

    doc.fontSize(8.5).font('Helvetica').fillColor(rgb(SLATE))
      .text('By signing below, both parties confirm acceptance of the terms set out in this Media Purchase Order.', 40, y, { width: 515 });
    y += 20;

    // Two signature boxes side by side
    const sigW = 232;
    for (const [label, name, side] of [
      ['Agency Authorised Signatory', agencyName, 0],
      ['Media Owner Acceptance',      ownerName,  1],
    ] as [string, string, number][]) {
      const sx = 40 + side * (sigW + 31);

      doc.rect(sx, y, sigW, 80).stroke(rgb('#E2E8F0'));

      doc.fontSize(7).font('Helvetica-Bold').fillColor(rgb(SLATE)).text(label, sx + 8, y + 8, { width: sigW - 16 });
      doc.fontSize(8).font('Helvetica').fillColor(rgb(DARK)).text(name, sx + 8, y + 22, { width: sigW - 16 });

      // Signature line
      doc.rect(sx + 8, y + 54, sigW - 16, 1).fill(rgb('#CBD5E1'));
      doc.fontSize(7).font('Helvetica').fillColor(rgb(SLATE)).text('Signature & date', sx + 8, y + 58, { width: sigW - 16 });
    }
    y += 96;

    // ── T&C FOOTER ───────────────────────────────────────────────────────────
    drawHRule(doc, 40, y, 515, '#E2E8F0');
    y += 8;
    doc.fontSize(7).font('Helvetica').fillColor(rgb(SLATE)).text(
      'TERMS & CONDITIONS: This Media Purchase Order is subject to OOH Platform\'s standard terms and conditions. The media owner undertakes to display the client\'s advertisement on the specified board for the agreed period. The agency undertakes to supply artwork meeting the specifications above and to make payment within the agreed terms. Any cancellation must be notified in writing at least 14 days before campaign start. OOH Platform acts as facilitating agent and is not liable for disputes between agency and media owner.',
      40, y, { width: 515, lineGap: 2 }
    );
    y = doc.y + 10;

    // ── BOTTOM BAR ───────────────────────────────────────────────────────────
    const barY = 800;
    doc.rect(0, barY, 595, 42).fill(rgb(DARK));
    doc.fontSize(7.5).font('Helvetica').fillColor([255,255,255,0.4])
      .text(`${mpo}  ·  ${agencyName}  ·  Facilitated by OOH Platform  ·  ${today}`, 40, barY + 14, { width: 515, align: 'center' });

    // ── FINALIZE ─────────────────────────────────────────────────────────────
    doc.end();

    const buffer = await new Promise<Buffer>((resolve, reject) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });

    const safeName = `${mpo}-${p.board_name.replace(/[^a-z0-9]/gi, '-').toLowerCase()}`;
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type':        'application/pdf',
        'Content-Disposition': `attachment; filename="${safeName}.pdf"`,
        'Content-Length':      buffer.length.toString(),
      },
    });
  } catch (err) {
    console.error('[mpo-pdf]', err);
    return NextResponse.json({ error: 'Failed to generate MPO' }, { status: 500 });
  }
}
