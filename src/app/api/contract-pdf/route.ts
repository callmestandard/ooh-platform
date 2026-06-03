import { NextRequest, NextResponse } from 'next/server';
import PDFDocument from 'pdfkit';

export const runtime = 'nodejs';

const NAVY  = '#1B4F8A';
const AMBER = '#F59E0B';
const DARK  = '#0F172A';
const SLATE = '#475569';
const LIGHT = '#F8FAFC';
const GREEN = '#10B981';

function rgb(hex: string): [number, number, number] {
  const c = hex.replace('#', '');
  return [parseInt(c.slice(0,2),16), parseInt(c.slice(2,4),16), parseInt(c.slice(4,6),16)];
}

function fmtNaira(n: number) {
  if (n >= 1_000_000) return '₦' + (n / 1_000_000).toFixed(2) + 'M';
  return '₦' + Number(n).toLocaleString('en-NG');
}

function fmtDate(s: string) {
  return new Date(s).toLocaleDateString('en-NG', { day: 'numeric', month: 'long', year: 'numeric' });
}

function daysBetween(a: string, b: string) {
  return Math.max(1, Math.ceil((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000));
}

function hRule(doc: PDFKit.PDFDocument, x: number, y: number, w: number, color = '#E2E8F0') {
  doc.rect(x, y, w, 0.75).fill(rgb(color));
}

export type ContractPayload = {
  booking_id:    string;
  agency_name:   string;
  agency_email?: string;
  owner_name:    string;
  board_name:    string;
  board_address: string;
  board_city:    string;
  board_state:   string;
  board_format:  string;
  board_width?:  number;
  board_height?: number;
  campaign_name: string;
  client_name:   string;
  start_date:    string;
  end_date:      string;
  agreed_rate:   number;
  notes?:        string;
};

const FORMAT_LABELS: Record<string, string> = {
  billboard: 'Billboard', unipole: 'Unipole', gantry: 'Gantry',
  bridge_panel: 'Bridge Panel', wall_drape: 'Wall Drape',
};

export async function POST(req: NextRequest) {
  try {
    const p: ContractPayload = await req.json();

    const refNum = `OOH-CONTRACT-${new Date().getFullYear()}-${p.booking_id.slice(0,6).toUpperCase()}`;
    const today  = new Date().toLocaleDateString('en-NG', { day: 'numeric', month: 'long', year: 'numeric' });
    const days   = daysBetween(p.start_date, p.end_date);
    const months = Math.max(1, Math.round(days / 30));
    const total  = p.agreed_rate * months;
    const format = FORMAT_LABELS[p.board_format] || p.board_format;
    const dims   = p.board_width && p.board_height ? `${p.board_width}m × ${p.board_height}m` : 'As agreed';
    const location = [p.board_address, p.board_city, p.board_state].filter(Boolean).join(', ');

    const doc    = new PDFDocument({ size: 'A4', margin: 0, info: { Title: `Contract - ${refNum}`, Author: 'OOH Platform' } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));

    // ── HEADER ───────────────────────────────────────────────────────────────
    doc.rect(0, 0, 595, 68).fill(rgb(DARK));
    doc.rect(0, 68, 595, 5).fill(rgb(NAVY));

    doc.fontSize(7.5).font('Helvetica').fillColor([255,255,255,0.4]).text('OOH PLATFORM', 40, 16);
    doc.fontSize(16).font('Helvetica-Bold').fillColor([255,255,255,1]).text('Advertising Space Booking Agreement', 40, 32);
    doc.fontSize(9).font('Helvetica-Bold').fillColor(rgb(AMBER)).text(refNum, 395, 22, { width: 160, align: 'right' });
    doc.fontSize(7.5).font('Helvetica').fillColor([255,255,255,0.45]).text(`Dated: ${today}`, 395, 38, { width: 160, align: 'right' });

    // AGREED badge
    doc.rect(40, 86, 68, 18).fill(rgb(GREEN));
    doc.fontSize(7.5).font('Helvetica-Bold').fillColor([255,255,255,1]).text('AGREED', 40, 92, { width: 68, align: 'center' });

    // ── INTRO TEXT ────────────────────────────────────────────────────────────
    let y = 118;
    doc.fontSize(8.5).font('Helvetica').fillColor(rgb(SLATE))
      .text('This Advertising Space Booking Agreement ("Agreement") is entered into as of the date above between the parties named herein, facilitated by OOH Platform as booking agent.', 40, y, { width: 515, lineGap: 2 });
    y = doc.y + 14;

    // ── PARTIES ──────────────────────────────────────────────────────────────
    doc.fontSize(10).font('Helvetica-Bold').fillColor(rgb(DARK)).text('1. Parties', 40, y);
    y += 12;
    hRule(doc, 40, y, 515);
    y += 8;

    // Two-column party boxes
    const boxH = 52;
    doc.rect(40,  y, 245, boxH).stroke(rgb('#E2E8F0'));
    doc.rect(310, y, 245, boxH).stroke(rgb('#E2E8F0'));

    doc.rect(40,  y, 245, 16).fill(rgb(LIGHT));
    doc.rect(310, y, 245, 16).fill(rgb(LIGHT));
    doc.fontSize(7).font('Helvetica-Bold').fillColor(rgb(SLATE))
      .text('AGENCY (ADVERTISER)', 40, y + 5, { width: 245, align: 'center' })
      .text('MEDIA OWNER', 310, y + 5, { width: 245, align: 'center' });

    doc.fontSize(9).font('Helvetica-Bold').fillColor(rgb(DARK))
      .text(p.agency_name, 50, y + 22, { width: 225 })
      .text(p.owner_name,  320, y + 22, { width: 225 });
    if (p.agency_email) {
      doc.fontSize(7.5).font('Helvetica').fillColor(rgb(SLATE)).text(p.agency_email, 50, y + 36, { width: 225 });
    }
    y += boxH + 16;

    // ── THE PROPERTY ─────────────────────────────────────────────────────────
    doc.fontSize(10).font('Helvetica-Bold').fillColor(rgb(DARK)).text('2. The Advertising Space', 40, y);
    y += 12;
    hRule(doc, 40, y, 515);
    y += 8;

    const propRows: [string, string][] = [
      ['Board Name',   p.board_name],
      ['Location',     location || '—'],
      ['Format',       format],
      ['Dimensions',   dims],
      ['Board Owner',  p.owner_name],
    ];
    for (let i = 0; i < propRows.length; i++) {
      doc.rect(40, y, 515, 18).fill(i % 2 === 0 ? rgb(LIGHT) : [255,255,255]);
      doc.fontSize(8).font('Helvetica-Bold').fillColor(rgb(SLATE)).text(propRows[i][0], 50, y + 5, { width: 160 });
      doc.font('Helvetica').fillColor(rgb(DARK)).text(propRows[i][1], 220, y + 5, { width: 330 });
      y += 18;
    }
    y += 14;

    // ── CAMPAIGN DETAILS ──────────────────────────────────────────────────────
    doc.fontSize(10).font('Helvetica-Bold').fillColor(rgb(DARK)).text('3. Campaign Details', 40, y);
    y += 12;
    hRule(doc, 40, y, 515);
    y += 8;

    const campRows: [string, string][] = [
      ['Campaign Name',   p.campaign_name],
      ['Client / Brand',  p.client_name],
      ['Start Date',      fmtDate(p.start_date)],
      ['End Date',        fmtDate(p.end_date)],
      ['Duration',        `${days} days (approx. ${months} month${months !== 1 ? 's' : ''})`],
    ];
    for (let i = 0; i < campRows.length; i++) {
      doc.rect(40, y, 515, 18).fill(i % 2 === 0 ? rgb(LIGHT) : [255,255,255]);
      doc.fontSize(8).font('Helvetica-Bold').fillColor(rgb(SLATE)).text(campRows[i][0], 50, y + 5, { width: 160 });
      doc.font('Helvetica').fillColor(rgb(DARK)).text(campRows[i][1], 220, y + 5, { width: 330 });
      y += 18;
    }
    y += 14;

    // ── COMMERCIAL TERMS ─────────────────────────────────────────────────────
    doc.fontSize(10).font('Helvetica-Bold').fillColor(rgb(DARK)).text('4. Commercial Terms', 40, y);
    y += 12;
    hRule(doc, 40, y, 515);
    y += 8;

    // Rate highlight
    doc.rect(40, y, 515, 28).fill(rgb('#EFF6FF'));
    doc.rect(40, y, 5,   28).fill(rgb(NAVY));
    doc.fontSize(8).font('Helvetica-Bold').fillColor(rgb(SLATE)).text('Agreed Monthly Rate', 55, y + 4, { width: 200 });
    doc.fontSize(15).font('Helvetica-Bold').fillColor(rgb(NAVY)).text(fmtNaira(p.agreed_rate), 55, y + 13, { width: 200 });
    doc.fontSize(8).font('Helvetica').fillColor(rgb(SLATE))
      .text(`Total Contract Value: ${fmtNaira(total)}`, 310, y + 4, { width: 240, align: 'right' })
      .text(`(${months} month${months !== 1 ? 's' : ''} × ${fmtNaira(p.agreed_rate)})`, 310, y + 16, { width: 240, align: 'right' });
    y += 28;

    const commRows: [string, string][] = [
      ['Payment Terms',     'Net 30 days from invoice date'],
      ['VAT',               '7.5% (where applicable, charged separately)'],
      ['OOH Platform Fee',  '10% service fee on the agreed rate'],
      ['Currency',          'Nigerian Naira (NGN)'],
    ];
    for (let i = 0; i < commRows.length; i++) {
      doc.rect(40, y, 515, 18).fill(i % 2 === 0 ? [255,255,255] : rgb(LIGHT));
      doc.fontSize(8).font('Helvetica-Bold').fillColor(rgb(SLATE)).text(commRows[i][0], 50, y + 5, { width: 160 });
      doc.font('Helvetica').fillColor(rgb(DARK)).text(commRows[i][1], 220, y + 5, { width: 330 });
      y += 18;
    }
    y += 14;

    // ── NEW PAGE FOR OBLIGATIONS + SIGNATURES ─────────────────────────────────
    if (y > 560) {
      doc.addPage({ margin: 0 });
      doc.rect(0, 0, 595, 28).fill(rgb(DARK));
      doc.fontSize(7.5).font('Helvetica').fillColor([255,255,255,0.4]).text(`${refNum}  ·  Terms & Conditions`, 40, 10);
      y = 46;
    }

    // ── OBLIGATIONS ──────────────────────────────────────────────────────────
    doc.fontSize(10).font('Helvetica-Bold').fillColor(rgb(DARK)).text('5. Obligations', 40, y);
    y += 12;
    hRule(doc, 40, y, 515);
    y += 10;

    const agencyObs = [
      'Supply approved artwork meeting board specifications at least 5 working days before the campaign start date.',
      'Make payment of the agreed monthly rate within 30 days of receiving a valid invoice.',
      'Ensure creative content complies with all applicable Nigerian advertising regulations.',
      'Provide the media owner with any client branding guidelines relevant to the display.',
      'Notify OOH Platform of any required changes to campaign dates or creative at least 7 days in advance.',
    ];
    const ownerObs = [
      'Display the client\'s advertisement prominently on the specified board for the agreed campaign period.',
      'Ensure the board structure is in good condition and illuminated (where applicable) throughout the campaign.',
      'Submit proof-of-posting photographs via OOH Platform within 48 hours of campaign launch.',
      'Notify the agency promptly of any structural damage, obstruction, or force majeure event affecting display.',
      'Maintain the board in a clean, visible condition throughout the campaign period.',
    ];

    doc.fontSize(8.5).font('Helvetica-Bold').fillColor(rgb(NAVY)).text('5.1  Agency Obligations', 40, y);
    y += 12;
    for (const ob of agencyObs) {
      doc.fontSize(8).font('Helvetica').fillColor(rgb(SLATE)).text(`•  ${ob}`, 50, y, { width: 505, lineGap: 1 });
      y = doc.y + 5;
    }
    y += 6;

    doc.fontSize(8.5).font('Helvetica-Bold').fillColor(rgb(NAVY)).text('5.2  Media Owner Obligations', 40, y);
    y += 12;
    for (const ob of ownerObs) {
      doc.fontSize(8).font('Helvetica').fillColor(rgb(SLATE)).text(`•  ${ob}`, 50, y, { width: 505, lineGap: 1 });
      y = doc.y + 5;
    }
    y += 10;

    // ── GENERAL TERMS ─────────────────────────────────────────────────────────
    if (y > 620) {
      doc.addPage({ margin: 0 });
      doc.rect(0, 0, 595, 28).fill(rgb(DARK));
      doc.fontSize(7.5).font('Helvetica').fillColor([255,255,255,0.4]).text(`${refNum}  ·  General Terms`, 40, 10);
      y = 46;
    }

    doc.fontSize(10).font('Helvetica-Bold').fillColor(rgb(DARK)).text('6. General Terms', 40, y);
    y += 12;
    hRule(doc, 40, y, 515);
    y += 10;

    const generalTerms = [
      ['Cancellation', 'Either party may cancel this agreement with 14 days\' written notice before the campaign start date. Cancellation after commencement is subject to a 50% fee of the remaining contract value.'],
      ['Force Majeure', 'Neither party shall be liable for failure to perform obligations due to circumstances beyond their reasonable control, including but not limited to natural disasters, government orders, or civil unrest.'],
      ['Governing Law', 'This Agreement shall be governed by and construed in accordance with the laws of the Federal Republic of Nigeria.'],
      ['Dispute Resolution', 'Any dispute arising from this Agreement shall first be referred to OOH Platform mediation. Unresolved disputes shall be referred to the appropriate court of jurisdiction in Lagos State, Nigeria.'],
      ['Entire Agreement', 'This Agreement constitutes the entire agreement between the parties with respect to its subject matter and supersedes all prior negotiations and communications.'],
      ['Amendments', 'No amendment to this Agreement shall be effective unless made in writing and agreed through the OOH Platform system.'],
    ];

    for (const [title, text] of generalTerms) {
      doc.fontSize(8).font('Helvetica-Bold').fillColor(rgb(DARK)).text(title + '.  ', 50, y, { continued: true });
      doc.font('Helvetica').fillColor(rgb(SLATE)).text(text, { width: 495, lineGap: 1 });
      y = doc.y + 8;
    }
    y += 6;

    // ── SPECIAL INSTRUCTIONS ─────────────────────────────────────────────────
    if (p.notes) {
      doc.fontSize(8.5).font('Helvetica-Bold').fillColor(rgb(DARK)).text('Special Instructions', 40, y);
      y += 10;
      doc.fontSize(8).font('Helvetica').fillColor(rgb(SLATE)).text(p.notes, 50, y, { width: 505, lineGap: 2 });
      y = doc.y + 14;
    }

    // ── SIGNATURE BLOCKS ─────────────────────────────────────────────────────
    if (y > 680) {
      doc.addPage({ margin: 0 });
      doc.rect(0, 0, 595, 28).fill(rgb(DARK));
      doc.fontSize(7.5).font('Helvetica').fillColor([255,255,255,0.4]).text(`${refNum}  ·  Signatures`, 40, 10);
      y = 46;
    }

    doc.fontSize(10).font('Helvetica-Bold').fillColor(rgb(DARK)).text('7. Signatures', 40, y);
    y += 12;
    hRule(doc, 40, y, 515);
    y += 12;

    doc.fontSize(8.5).font('Helvetica').fillColor(rgb(SLATE))
      .text('IN WITNESS WHEREOF, the parties have executed this Agreement as of the date first written above.', 40, y, { width: 515 });
    y += 18;

    const sigW = 232;
    for (const [label, name, side] of [
      ['For and on behalf of the Agency', p.agency_name, 0],
      ['For and on behalf of the Media Owner', p.owner_name, 1],
    ] as [string, string, number][]) {
      const sx = 40 + side * (sigW + 31);

      doc.rect(sx, y, sigW, 90).stroke(rgb('#CBD5E1'));
      doc.rect(sx, y, sigW, 18).fill(rgb(LIGHT));

      doc.fontSize(7).font('Helvetica-Bold').fillColor(rgb(SLATE)).text(label, sx + 8, y + 6, { width: sigW - 16 });
      doc.fontSize(9).font('Helvetica-Bold').fillColor(rgb(DARK)).text(name, sx + 8, y + 24, { width: sigW - 16 });
      doc.fontSize(7.5).font('Helvetica').fillColor(rgb(SLATE)).text('Authorised Signatory', sx + 8, y + 38, { width: sigW - 16 });

      hRule(doc, sx + 8, y + 60, sigW - 16, '#CBD5E1');
      doc.fontSize(7).font('Helvetica').fillColor(rgb(SLATE)).text('Signature', sx + 8, y + 64, { width: 80 });
      hRule(doc, sx + 96, y + 60, sigW - 104, '#CBD5E1');
      doc.text('Date', sx + 100, y + 64, { width: sigW - 108 });
    }
    y += 106;

    // OOH Platform witness line
    doc.rect(40, y, 515, 32).fill(rgb(LIGHT));
    doc.fontSize(7).font('Helvetica-Bold').fillColor(rgb(SLATE)).text('Facilitated by OOH Platform (as Booking Agent — not a party to this Agreement)', 50, y + 6, { width: 515 });
    doc.text(`Reference: ${refNum}  ·  ${today}`, 50, y + 18, { width: 515 });
    y += 44;

    // ── BOTTOM BAR ───────────────────────────────────────────────────────────
    const barY = 800;
    doc.rect(0, barY, 595, 42).fill(rgb(DARK));
    doc.fontSize(7.5).font('Helvetica').fillColor([255,255,255,0.35])
      .text(`${refNum}  ·  Facilitated by OOH Platform  ·  ${today}  ·  This document is confidential`, 40, barY + 14, { width: 515, align: 'center' });

    // ── FINALIZE ─────────────────────────────────────────────────────────────
    doc.end();

    const buffer = await new Promise<Buffer>((resolve, reject) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });

    const safeName = `${refNum}-${p.board_name.replace(/[^a-z0-9]/gi, '-').toLowerCase()}.pdf`;
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type':        'application/pdf',
        'Content-Disposition': `attachment; filename="${safeName}"`,
        'Content-Length':      buffer.length.toString(),
      },
    });
  } catch (err) {
    console.error('[contract-pdf]', err);
    return NextResponse.json({ error: 'Failed to generate contract' }, { status: 500 });
  }
}
