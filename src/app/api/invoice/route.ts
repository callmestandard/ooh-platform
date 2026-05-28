import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const PLATFORM_COMMISSION = 0.12;

function formatNaira(n: number) {
  return '₦' + n.toLocaleString('en-NG', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function formatDate(d: string) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-NG', { day: 'numeric', month: 'long', year: 'numeric' });
}

function invoiceNumber(bookingId: string, createdAt: string) {
  const d = new Date(createdAt);
  const y = d.getFullYear().toString().slice(2);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const ref = bookingId.replace(/-/g, '').slice(0, 6).toUpperCase();
  return `INV-${y}${m}-${ref}`;
}

// ── Route ────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const bookingId = searchParams.get('bookingId');
    const type = (searchParams.get('type') || 'agency') as 'agency' | 'owner';

    if (!bookingId) {
      return NextResponse.json({ error: 'bookingId required' }, { status: 400 });
    }

    // Fetch booking with campaign + board
    const { data: booking, error } = await supabase
      .from('bookings')
      .select(`
        *,
        campaigns ( id, name, client_name, start_date, end_date, total_budget ),
        boards    ( id, name, address, city, state, format, asking_rate, width, height )
      `)
      .eq('id', bookingId)
      .single();

    if (error || !booking) {
      return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
    }

    const pdfBuffer = await generateInvoicePDF(booking, type);

    const invNo = invoiceNumber(booking.id, booking.created_at);

    return new NextResponse(pdfBuffer as unknown as BodyInit, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${invNo}.pdf"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err: any) {
    console.error('Invoice error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// ── PDF Generation ───────────────────────────────────────────────────────────

async function generateInvoicePDF(booking: any, type: 'agency' | 'owner'): Promise<Buffer> {
  const PDFDocument = (await import('pdfkit')).default;
  const chunks: Buffer[] = [];

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 0 });
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const W = 595.28;
    // const H = 841.89;
    const M = 48; // margin

    const campaign = booking.campaigns || {};
    const board    = booking.boards    || {};

    const rate         = booking.agreed_rate || booking.offered_rate || 0;
    const months       = booking.duration_months || 1;
    const mediaSubtotal = rate * months;
    const commission   = Math.round(mediaSubtotal * PLATFORM_COMMISSION);
    const ownerPayout  = mediaSubtotal - commission;
    const agencyTotal  = mediaSubtotal + commission; // agency pays media + fee
    const invNo        = invoiceNumber(booking.id, booking.created_at);
    const issueDate    = formatDate(new Date().toISOString());
    const dueDate      = formatDate(new Date(Date.now() + 30 * 86400000).toISOString());

    // ── Colours ──
    const NAVY   = '#0F172A';
    const BLUE   = '#1B4F8A';
    const AMBER  = '#F59E0B';
    const SLATE  = '#64748B';
    const LIGHT  = '#F8FAFC';
    const GREEN  = '#10B981';
    const WHITE  = '#FFFFFF';

    let y = 0;

    // ── Header bar ──────────────────────────────────────────────────────────
    doc.rect(0, 0, W, 88).fill(NAVY);
    doc.rect(0, 0, W, 4).fill(AMBER);

    // Platform name
    doc.fontSize(20).font('Helvetica-Bold').fillColor(WHITE)
       .text('OOH PLATFORM', M, 24);
    doc.fontSize(8).font('Helvetica').fillColor('rgba(255,255,255,0.45)')
       .text('NIGERIA\'S OOH OPERATING SYSTEM', M, 48);

    // INVOICE label (right-aligned)
    doc.fontSize(28).font('Helvetica-Bold').fillColor(AMBER)
       .text('INVOICE', 0, 24, { align: 'right', width: W - M });
    doc.fontSize(9).font('Helvetica').fillColor('rgba(255,255,255,0.55)')
       .text(invNo, 0, 58, { align: 'right', width: W - M });

    y = 112;

    // ── Meta row (Issue date / Due date / Status) ────────────────────────────
    const metaItems = [
      { label: 'ISSUE DATE',  value: issueDate },
      { label: 'DUE DATE',    value: dueDate },
      { label: 'STATUS',      value: ['agreed','signed','live','completed'].includes(booking.status) ? 'CONFIRMED' : 'PENDING' },
      { label: 'INVOICE NO',  value: invNo },
    ];
    const colW = (W - M * 2) / metaItems.length;
    doc.rect(M, y, W - M * 2, 44).fill(LIGHT);
    metaItems.forEach((item, i) => {
      const x = M + i * colW + 12;
      doc.fontSize(7).font('Helvetica-Bold').fillColor(SLATE).text(item.label, x, y + 8);
      doc.fontSize(9).font('Helvetica-Bold').fillColor(NAVY).text(item.value, x, y + 20);
    });
    y += 60;

    // ── Bill To / Bill From ──────────────────────────────────────────────────
    const halfW = (W - M * 2 - 20) / 2;

    // Bill To (left)
    doc.fontSize(7).font('Helvetica-Bold').fillColor(SLATE).text('BILL TO', M, y);
    y += 14;
    if (type === 'agency') {
      doc.fontSize(11).font('Helvetica-Bold').fillColor(NAVY).text(campaign.client_name || 'Client', M, y);
      y += 16;
      doc.fontSize(9).font('Helvetica').fillColor(SLATE).text('c/o Agency of Record', M, y);
      y += 14;
      doc.fontSize(9).font('Helvetica').fillColor(SLATE).text('Campaign: ' + (campaign.name || '—'), M, y);
    } else {
      doc.fontSize(11).font('Helvetica-Bold').fillColor(NAVY).text('Board Owner', M, y);
      y += 16;
      doc.fontSize(9).font('Helvetica').fillColor(SLATE).text(board.name || '—', M, y);
      y += 14;
      doc.fontSize(9).font('Helvetica').fillColor(SLATE).text(board.address || '', M, y);
    }

    // Bill From (right)
    const billFromX = M + halfW + 20;
    const billFromY = y - 44;
    doc.fontSize(7).font('Helvetica-Bold').fillColor(SLATE).text('BILL FROM', billFromX, billFromY);
    doc.fontSize(11).font('Helvetica-Bold').fillColor(NAVY).text('OOH Platform Nigeria', billFromX, billFromY + 14);
    doc.fontSize(9).font('Helvetica').fillColor(SLATE)
       .text('Lagos, Nigeria', billFromX, billFromY + 30)
       .text('finance@oohplatform.ng', billFromX, billFromY + 44)
       .text('RC: 1234567', billFromX, billFromY + 58);

    y += 32;

    // ── Divider ──────────────────────────────────────────────────────────────
    doc.rect(M, y, W - M * 2, 1).fill('#E2E8F0');
    y += 20;

    // ── Line items table ─────────────────────────────────────────────────────
    doc.fontSize(12).font('Helvetica-Bold').fillColor(NAVY).text('Line Items', M, y);
    y += 18;

    // Table header
    doc.rect(M, y, W - M * 2, 26).fill(NAVY);
    const cols = [
      { label: 'DESCRIPTION',  x: M + 10,        w: 260 },
      { label: 'FLIGHT',       x: M + 270,        w: 100 },
      { label: 'RATE / MO',    x: M + 370,        w: 80  },
      { label: 'MONTHS',       x: M + 448,        w: 50  },
      { label: 'AMOUNT',       x: M + 496,        w: 0   },
    ];
    cols.forEach(col => {
      doc.fontSize(7).font('Helvetica-Bold').fillColor(WHITE).text(col.label, col.x, y + 9);
    });
    y += 26;

    // Row 1 — Media cost
    doc.rect(M, y, W - M * 2, 44).fill('#FAFAFA');
    doc.rect(M, y, W - M * 2, 44).stroke('#F1F5F9');
    doc.fontSize(9).font('Helvetica-Bold').fillColor(NAVY)
       .text(board.name || 'Billboard placement', M + 10, y + 8);
    doc.fontSize(8).font('Helvetica').fillColor(SLATE)
       .text(`${board.format ? board.format.replace('_', ' ') : 'OOH'} · ${board.city || ''}, ${board.state || ''}`, M + 10, y + 22);
    const flightStr = booking.start_date && booking.end_date
      ? `${formatDate(booking.start_date).replace(/ \d{4}/, '')} – ${formatDate(booking.end_date)}`
      : '—';
    doc.fontSize(8).font('Helvetica').fillColor(SLATE).text(flightStr, M + 270, y + 14);
    doc.fontSize(9).font('Helvetica-Bold').fillColor(NAVY).text(formatNaira(rate), M + 370, y + 14);
    doc.fontSize(9).font('Helvetica').fillColor(SLATE).text(String(months), M + 450, y + 14);
    doc.fontSize(9).font('Helvetica-Bold').fillColor(NAVY).text(formatNaira(mediaSubtotal), M + 496, y + 14);
    y += 44;

    // ── Totals block ─────────────────────────────────────────────────────────
    y += 16;
    const totalsX = W - M - 200;
    const totalsW = 200;

    const totalsRows: { label: string; value: string; bold?: boolean; highlight?: boolean }[] =
      type === 'agency'
        ? [
            { label: 'Media subtotal',       value: formatNaira(mediaSubtotal) },
            { label: `Platform fee (${(PLATFORM_COMMISSION * 100).toFixed(0)}%)`, value: formatNaira(commission) },
            { label: 'TOTAL DUE',            value: formatNaira(agencyTotal), bold: true, highlight: true },
          ]
        : [
            { label: 'Gross booking value',  value: formatNaira(mediaSubtotal) },
            { label: `Platform fee (${(PLATFORM_COMMISSION * 100).toFixed(0)}%)`, value: `– ${formatNaira(commission)}` },
            { label: 'YOUR PAYOUT',          value: formatNaira(ownerPayout), bold: true, highlight: true },
          ];

    totalsRows.forEach(row => {
      if (row.highlight) {
        doc.rect(totalsX - 10, y - 4, totalsW + 10, 28).fill(BLUE);
        doc.fontSize(10).font('Helvetica-Bold').fillColor(WHITE)
           .text(row.label, totalsX, y + 4);
        doc.fontSize(10).font('Helvetica-Bold').fillColor(AMBER)
           .text(row.value, totalsX, y + 4, { align: 'right', width: totalsW - 10 });
      } else {
        doc.fontSize(9).font(row.bold ? 'Helvetica-Bold' : 'Helvetica')
           .fillColor(row.bold ? NAVY : SLATE)
           .text(row.label, totalsX, y + 2);
        doc.fontSize(9).font(row.bold ? 'Helvetica-Bold' : 'Helvetica')
           .fillColor(row.bold ? NAVY : SLATE)
           .text(row.value, totalsX, y + 2, { align: 'right', width: totalsW - 10 });
        doc.rect(totalsX - 10, y + 16, totalsW + 10, 1).fill('#E2E8F0');
      }
      y += 28;
    });

    y += 20;

    // ── Payment note ─────────────────────────────────────────────────────────
    doc.rect(M, y, W - M * 2, 52).fill('#ECFDF5');
    doc.rect(M, y, 3, 52).fill(GREEN);
    doc.fontSize(9).font('Helvetica-Bold').fillColor('#065F46')
       .text(type === 'agency' ? 'Payment instructions' : 'Payout details', M + 14, y + 10);
    doc.fontSize(8).font('Helvetica').fillColor('#047857')
       .text(
         type === 'agency'
           ? `Transfer to: OOH Platform Trust Account · Zenith Bank · 1234567890 · Sort: 057\nRef: ${invNo} · Payment due within 30 days of invoice date`
           : `Payout will be processed within 5 business days of campaign completion.\nRef: ${invNo} · OOH Platform will deduct the ${(PLATFORM_COMMISSION * 100).toFixed(0)}% platform fee automatically.`,
         M + 14, y + 22, { width: W - M * 2 - 28 }
       );
    y += 68;

    // ── Campaign details box ──────────────────────────────────────────────────
    doc.rect(M, y, W - M * 2, 1).fill('#E2E8F0');
    y += 16;
    doc.fontSize(10).font('Helvetica-Bold').fillColor(NAVY).text('Campaign details', M, y);
    y += 16;
    const details = [
      ['Campaign',  campaign.name || '—'],
      ['Client',    campaign.client_name || '—'],
      ['Start',     formatDate(campaign.start_date)],
      ['End',       formatDate(campaign.end_date)],
      ['Board',     board.name || '—'],
      ['Location',  `${board.address || ''}, ${board.city || ''}`],
      ['Dimensions',board.width && board.height ? `${board.width}m × ${board.height}m` : '—'],
      ['Booking ID',booking.id.slice(0, 8).toUpperCase()],
    ];
    const dColW = (W - M * 2) / 2;
    details.forEach(([label, val], i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      if (col === 0 && i > 0) y += 18;
      else if (col === 0) {}
      doc.fontSize(7).font('Helvetica-Bold').fillColor(SLATE)
         .text(label.toUpperCase(), M + col * dColW, y);
      doc.fontSize(8).font('Helvetica').fillColor(NAVY)
         .text(val, M + col * dColW, y + 10);
    });
    y += 30;

    // ── Footer ───────────────────────────────────────────────────────────────
    doc.rect(M, y + 20, W - M * 2, 1).fill('#E2E8F0');
    doc.fontSize(7).font('Helvetica').fillColor('#CBD5E1')
       .text(
         `Generated by OOH Platform Nigeria · ${new Date().toLocaleDateString('en-NG')} · ${invNo} · This is a computer-generated invoice`,
         M, y + 30, { align: 'center', width: W - M * 2 }
       );

    doc.end();
  });
}
