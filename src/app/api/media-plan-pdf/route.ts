import { NextRequest, NextResponse } from 'next/server';
import PDFDocument from 'pdfkit';

// Colors
const NAVY   = '#1B4F8A';
const AMBER  = '#F59E0B';
const DARK   = '#0F172A';
const SLATE  = '#475569';
const LIGHT  = '#F8FAFC';
const WHITE  = '#FFFFFF';
const GREEN  = '#10B981';
const BORDER = '#E2E8F0';

const CLIENT_BRANDS: Record<string, { primary: string; accent: string; label: string }> = {
  'MTN':         { primary: '#FFC614', accent: '#000000', label: 'MTN' },
  'Airtel':      { primary: '#FF0000', accent: '#FFFFFF', label: 'Airtel' },
  'Dangote':     { primary: '#003087', accent: '#E31837', label: 'Dangote' },
  'GTBank':      { primary: '#F58220', accent: '#002147', label: 'GTBank' },
  'Access Bank': { primary: '#E30613', accent: '#FFFFFF', label: 'Access' },
  'Zenith':      { primary: '#C00000', accent: '#FFFFFF', label: 'Zenith' },
  'UBA':         { primary: '#E31837', accent: '#FFFFFF', label: 'UBA' },
  'Jumia':       { primary: '#F77F00', accent: '#FFFFFF', label: 'Jumia' },
};

function getBrand(client: string) {
  for (const [k, v] of Object.entries(CLIENT_BRANDS)) {
    if (client?.toLowerCase().includes(k.toLowerCase())) return v;
  }
  return { primary: NAVY, accent: AMBER, label: 'OOH' };
}

function hexToRgb(hex: string): [number, number, number] {
  const c = hex.replace('#', '');
  return [parseInt(c.slice(0,2),16), parseInt(c.slice(2,4),16), parseInt(c.slice(4,6),16)];
}

function fmtNaira(n: number) {
  if (n >= 1_000_000_000) return '₦' + (n / 1_000_000_000).toFixed(2) + 'B';
  if (n >= 1_000_000)     return '₦' + (n / 1_000_000).toFixed(2) + 'M';
  if (n >= 1_000)         return '₦' + (n / 1_000).toFixed(0) + 'K';
  return '₦' + n.toLocaleString('en-NG');
}

function fmtDate(s: string) {
  return new Date(s).toLocaleDateString('en-NG', { day: 'numeric', month: 'long', year: 'numeric' });
}

function fmtImpr(n: number) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000)     return (n / 1_000).toFixed(0) + 'K';
  return n.toString();
}

export type MediaPlanBoard = {
  id: string;
  name: string;
  address: string;
  city: string;
  state: string;
  format: string;
  asking_rate: number;
  width?: number;
  height?: number;
  estimated_impressions: number;
};

export type MediaPlanPayload = {
  campaign_name: string;
  client_name: string;
  objective: string;
  start_date: string;
  end_date: string;
  total_budget: number;
  boards: MediaPlanBoard[];
  agency_name?: string;
  prepared_by?: string;
  notes?: string;
};

export async function POST(req: NextRequest) {
  try {
    const payload: MediaPlanPayload = await req.json();
    const { campaign_name, client_name, objective, start_date, end_date, total_budget, boards } = payload;
    const brand = getBrand(client_name);
    const agencyName = payload.agency_name || 'OOH Platform Agency';
    const preparedBy = payload.prepared_by || 'Campaign Planner';

    const totalCost = boards.reduce((s, b) => s + (b.asking_rate || 0), 0);
    const totalImpr = boards.reduce((s, b) => s + (b.estimated_impressions || 0), 0);
    const days = Math.max(1, Math.round((new Date(end_date).getTime() - new Date(start_date).getTime()) / 86400000));
    const blendedCPM = totalImpr > 0 ? ((totalCost / totalImpr) * 1000) : 0;
    const budgetPct = total_budget > 0 ? Math.round((totalCost / total_budget) * 100) : 100;

    // Group boards by city
    const citySummary: Record<string, { count: number; cost: number; impr: number }> = {};
    for (const b of boards) {
      const c = b.city || b.state || 'Other';
      if (!citySummary[c]) citySummary[c] = { count: 0, cost: 0, impr: 0 };
      citySummary[c].count += 1;
      citySummary[c].cost += b.asking_rate || 0;
      citySummary[c].impr += b.estimated_impressions || 0;
    }

    const doc = new PDFDocument({ size: 'A4', margin: 0, info: { Title: campaign_name, Author: agencyName } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));

    // ── PAGE 1: Cover ─────────────────────────────────────────────────────────

    // Background
    const [pr, pg, pb] = hexToRgb(brand.primary);
    doc.rect(0, 0, 595, 842).fill([pr, pg, pb]);

    // Top accent bar
    const [ar, ag, ab] = hexToRgb(brand.accent === '#FFFFFF' ? AMBER : brand.accent);
    doc.rect(0, 0, 595, 6).fill([ar, ag, ab]);

    // OOH Platform badge
    doc.rect(40, 28, 120, 28).fill([0, 0, 0, 0.2]);
    doc.font('Helvetica-Bold').fontSize(9).fillColor(WHITE).text('OOH PLATFORM', 50, 37, { width: 100, align: 'center' });

    // Date badge
    const today = new Date().toLocaleDateString('en-NG', { day: 'numeric', month: 'long', year: 'numeric' });
    doc.fontSize(8).fillColor([255, 255, 255, 0.6]).text(`Prepared ${today}`, 395, 37, { width: 160, align: 'right' });

    // Big title area
    doc.fontSize(10).fillColor([255, 255, 255, 0.6]).font('Helvetica').text('MEDIA PLAN', 60, 240);
    doc.moveDown(0.3);
    doc.fontSize(32).font('Helvetica-Bold').fillColor(WHITE).text(campaign_name, 60, 265, { width: 475, lineGap: 4 });
    doc.moveDown(0.5);

    const titleBottom = doc.y + 20;
    doc.fontSize(15).font('Helvetica').fillColor([255, 255, 255, 0.85]).text(client_name, 60, titleBottom);
    doc.fontSize(11).fillColor([255, 255, 255, 0.6]).text(agencyName, 60, titleBottom + 24);

    // Stats row
    const statsY = 500;
    const statItems = [
      { label: 'BOARDS',     value: boards.length.toString() },
      { label: 'MEDIA COST', value: fmtNaira(totalCost) },
      { label: 'IMPRESSIONS', value: fmtImpr(totalImpr) },
      { label: 'CAMPAIGN DAYS', value: days.toString() },
    ];
    const statW = 595 / statItems.length;
    for (let i = 0; i < statItems.length; i++) {
      const x = i * statW;
      const { label, value } = statItems[i];
      if (i > 0) doc.rect(x, statsY - 8, 1, 72).fill([255, 255, 255, 0.15]);
      doc.fontSize(9).font('Helvetica').fillColor([255, 255, 255, 0.55]).text(label, x + 16, statsY, { width: statW - 20 });
      doc.fontSize(20).font('Helvetica-Bold').fillColor(WHITE).text(value, x + 16, statsY + 18, { width: statW - 20 });
    }

    // Footer on cover
    doc.rect(0, 810, 595, 32).fill([0, 0, 0, 0.2]);
    doc.fontSize(8).font('Helvetica').fillColor([255, 255, 255, 0.45])
      .text(`Flight: ${fmtDate(start_date)} – ${fmtDate(end_date)}  ·  Objective: ${objective}  ·  Prepared by ${preparedBy}`, 40, 820, { width: 515 });

    // ── PAGE 2: Executive Summary ─────────────────────────────────────────────
    doc.addPage({ margin: 0 });

    // Header bar
    doc.rect(0, 0, 595, 56).fill(hexToRgb(DARK));
    doc.rect(0, 56, 595, 3).fill(hexToRgb(AMBER));
    doc.fontSize(9).font('Helvetica').fillColor([255,255,255,0.45]).text('OOH PLATFORM  ·  CONFIDENTIAL', 40, 14);
    doc.fontSize(14).font('Helvetica-Bold').fillColor(WHITE).text('Executive Summary', 40, 30);
    doc.fontSize(8).fillColor([255,255,255,0.45]).text(campaign_name, 400, 30, { width: 155, align: 'right' });

    let y = 80;

    // Campaign details table
    const rows = [
      ['Campaign',  campaign_name],
      ['Client',    client_name],
      ['Objective', objective.charAt(0).toUpperCase() + objective.slice(1)],
      ['Start',     fmtDate(start_date)],
      ['End',       fmtDate(end_date)],
      ['Duration',  `${days} days`],
      ['Total Budget', fmtNaira(total_budget)],
      ['Media Cost',   fmtNaira(totalCost)],
      ['Budget Used',  `${budgetPct}%`],
      ['Boards Selected', boards.length.toString()],
    ];

    doc.fontSize(10).font('Helvetica-Bold').fillColor(hexToRgb(DARK)).text('Campaign Overview', 40, y);
    y += 16;

    for (let i = 0; i < rows.length; i++) {
      const bg = i % 2 === 0 ? hexToRgb(LIGHT) : hexToRgb(WHITE);
      doc.rect(40, y, 515, 22).fill(bg);
      doc.fontSize(9).font('Helvetica-Bold').fillColor(hexToRgb(SLATE)).text(rows[i][0], 50, y + 7, { width: 160 });
      doc.font('Helvetica').fillColor(hexToRgb(DARK)).text(rows[i][1], 220, y + 7, { width: 320 });
      y += 22;
    }
    y += 16;

    // KPI cards
    doc.fontSize(10).font('Helvetica-Bold').fillColor(hexToRgb(DARK)).text('Campaign Performance Projections', 40, y);
    y += 14;

    const kpis = [
      { label: 'Total Impressions', value: fmtImpr(totalImpr), sub: `across ${boards.length} boards`, color: NAVY },
      { label: 'Blended CPM',       value: fmtNaira(Math.round(blendedCPM)), sub: 'cost per 1,000 impressions', color: '#7C3AED' },
      { label: 'Weekly Reach',      value: fmtImpr(Math.round(totalImpr / (days / 7))), sub: 'unique contacts per week', color: GREEN },
      { label: 'Media Efficiency',  value: budgetPct + '%', sub: 'of budget allocated', color: AMBER },
    ];

    const kpiW = (515 - 15) / 4;
    for (let i = 0; i < kpis.length; i++) {
      const x = 40 + i * (kpiW + 5);
      const [kr, kg, kb] = hexToRgb(kpis[i].color);
      doc.rect(x, y, kpiW, 70).fill([kr, kg, kb, 0.08]);
      doc.rect(x, y, 3, 70).fill([kr, kg, kb]);
      doc.fontSize(9).font('Helvetica').fillColor(hexToRgb(SLATE)).text(kpis[i].label, x + 10, y + 8, { width: kpiW - 15 });
      doc.fontSize(18).font('Helvetica-Bold').fillColor([kr, kg, kb]).text(kpis[i].value, x + 10, y + 24, { width: kpiW - 15 });
      doc.fontSize(7.5).font('Helvetica').fillColor(hexToRgb(SLATE)).text(kpis[i].sub, x + 10, y + 52, { width: kpiW - 15 });
    }
    y += 88;

    // City breakdown table
    if (Object.keys(citySummary).length > 0) {
      doc.fontSize(10).font('Helvetica-Bold').fillColor(hexToRgb(DARK)).text('Geo Distribution', 40, y);
      y += 14;

      // Header
      doc.rect(40, y, 515, 20).fill(hexToRgb(DARK));
      ['City', 'Boards', 'Media Cost', 'Impressions', '% Spend'].forEach((h, ci) => {
        const xs = [50, 170, 250, 360, 470];
        const ws = [110, 70, 100, 100, 80];
        doc.fontSize(8).font('Helvetica-Bold').fillColor(WHITE).text(h, xs[ci], y + 6, { width: ws[ci] });
      });
      y += 20;

      const cities = Object.entries(citySummary).sort((a, b) => b[1].cost - a[1].cost);
      for (let i = 0; i < cities.length; i++) {
        const [city, s] = cities[i];
        const pct = totalCost > 0 ? Math.round((s.cost / totalCost) * 100) : 0;
        const bg = i % 2 === 0 ? hexToRgb(LIGHT) : hexToRgb(WHITE);
        doc.rect(40, y, 515, 20).fill(bg);
        const vals = [city, s.count.toString(), fmtNaira(s.cost), fmtImpr(s.impr), pct + '%'];
        const xs = [50, 170, 250, 360, 470];
        const ws = [110, 70, 100, 100, 80];
        vals.forEach((v, ci) => {
          doc.fontSize(8.5).font(ci === 0 ? 'Helvetica-Bold' : 'Helvetica').fillColor(hexToRgb(DARK)).text(v, xs[ci], y + 6, { width: ws[ci] });
        });
        y += 20;
      }
    }

    // ── PAGE 3+: Board Inventory ──────────────────────────────────────────────
    const ROWS_PER_PAGE = 20;
    let pageBoards = [...boards];
    let isFirstBoardPage = true;

    while (pageBoards.length > 0) {
      const chunk = pageBoards.splice(0, ROWS_PER_PAGE);
      doc.addPage({ margin: 0 });

      // Header
      doc.rect(0, 0, 595, 56).fill(hexToRgb(DARK));
      doc.rect(0, 56, 595, 3).fill(hexToRgb(AMBER));
      doc.fontSize(9).font('Helvetica').fillColor([255,255,255,0.45]).text('OOH PLATFORM  ·  CONFIDENTIAL', 40, 14);
      doc.fontSize(14).font('Helvetica-Bold').fillColor(WHITE).text(isFirstBoardPage ? 'Board Inventory' : 'Board Inventory (cont.)', 40, 30);
      doc.fontSize(8).fillColor([255,255,255,0.45]).text(campaign_name, 400, 30, { width: 155, align: 'right' });
      isFirstBoardPage = false;

      let ry = 72;

      // Column headers
      const cols = [
        { label: '#',           x: 40,  w: 25 },
        { label: 'Board Name',  x: 68,  w: 155 },
        { label: 'Location',    x: 228, w: 115 },
        { label: 'Format',      x: 347, w: 65 },
        { label: 'Rate/mo',     x: 416, w: 80 },
        { label: 'Impressions', x: 499, w: 78 },
      ];

      doc.rect(40, ry, 515, 20).fill(hexToRgb(DARK));
      for (const col of cols) {
        doc.fontSize(7.5).font('Helvetica-Bold').fillColor(WHITE).text(col.label, col.x, ry + 6, { width: col.w });
      }
      ry += 20;

      for (let i = 0; i < chunk.length; i++) {
        const b = chunk[i];
        const globalIdx = boards.length - pageBoards.length - chunk.length + i + 1;
        const bg = i % 2 === 0 ? hexToRgb(LIGHT) : hexToRgb(WHITE);
        doc.rect(40, ry, 515, 24).fill(bg);
        const rowData: [string, number, number][] = [
          [globalIdx.toString(), 40, 25],
          [b.name || '—',        68, 155],
          [(b.city || b.address || b.state || '—').slice(0, 22), 228, 115],
          [(b.format || '—').replace(/_/g, ' '), 347, 65],
          [fmtNaira(b.asking_rate || 0), 416, 80],
          [fmtImpr(b.estimated_impressions || 0), 499, 78],
        ];
        for (const [text, x, w] of rowData) {
          doc.fontSize(8).font('Helvetica').fillColor(hexToRgb(DARK)).text(String(text), x, ry + 7, { width: w, ellipsis: true });
        }
        ry += 24;
      }

      // Subtotal for this page chunk
      const chunkCost = chunk.reduce((s, b) => s + (b.asking_rate || 0), 0);
      const chunkImpr = chunk.reduce((s, b) => s + (b.estimated_impressions || 0), 0);
      doc.rect(40, ry, 515, 22).fill(hexToRgb(BORDER));
      doc.fontSize(8).font('Helvetica-Bold').fillColor(hexToRgb(DARK)).text('Page subtotal', 68, ry + 7, { width: 155 });
      doc.text(fmtNaira(chunkCost), 416, ry + 7, { width: 80 });
      doc.text(fmtImpr(chunkImpr), 499, ry + 7, { width: 78 });
    }

    // ── FINAL PAGE: Terms & Next Steps ───────────────────────────────────────
    doc.addPage({ margin: 0 });
    doc.rect(0, 0, 595, 56).fill(hexToRgb(DARK));
    doc.rect(0, 56, 595, 3).fill(hexToRgb(AMBER));
    doc.fontSize(9).font('Helvetica').fillColor([255,255,255,0.45]).text('OOH PLATFORM  ·  CONFIDENTIAL', 40, 14);
    doc.fontSize(14).font('Helvetica-Bold').fillColor(WHITE).text('Terms & Next Steps', 40, 30);

    let ty = 80;

    // Notes / brief
    if (payload.notes) {
      doc.fontSize(10).font('Helvetica-Bold').fillColor(hexToRgb(DARK)).text('Campaign Brief', 40, ty);
      ty += 14;
      doc.rect(40, ty, 515, 1).fill(hexToRgb(BORDER));
      ty += 8;
      doc.fontSize(9).font('Helvetica').fillColor(hexToRgb(SLATE)).text(payload.notes, 40, ty, { width: 515, lineGap: 4 });
      ty = doc.y + 20;
    }

    // Next steps
    doc.fontSize(10).font('Helvetica-Bold').fillColor(hexToRgb(DARK)).text('Next Steps', 40, ty);
    ty += 14;
    doc.rect(40, ty, 515, 1).fill(hexToRgb(BORDER));
    ty += 8;
    const steps = [
      '1. Review and approve this media plan.',
      '2. Sign the booking agreements for each selected board.',
      '3. Submit campaign artwork (minimum 72 DPI, PDF/AI format) via the Creatives portal.',
      '4. OOH Platform will co-ordinate posting dates with board owners.',
      '5. Live campaign monitoring reports will be shared weekly via the Compliance portal.',
      '6. Post-campaign impression verification report delivered within 7 days of campaign end.',
    ];
    for (const step of steps) {
      doc.fontSize(9).font('Helvetica').fillColor(hexToRgb(DARK)).text(step, 40, ty, { width: 515, lineGap: 3 });
      ty = doc.y + 8;
    }
    ty += 12;

    // Disclaimer
    doc.rect(40, ty, 515, 1).fill(hexToRgb(BORDER));
    ty += 10;
    doc.fontSize(7.5).font('Helvetica').fillColor(hexToRgb(SLATE))
      .text('DISCLAIMER: Impression estimates are based on traffic data from the Nigerian Urban Transport Study and OAA measurement standards. Actual impressions may vary by ±15%. Rates are indicative and subject to final negotiation with board owners. This document is confidential and intended solely for the named client.', 40, ty, { width: 515, lineGap: 3 });

    // Footer
    doc.rect(0, 800, 595, 42).fill(hexToRgb(DARK));
    doc.fontSize(8).font('Helvetica').fillColor([255,255,255,0.5])
      .text(`${agencyName}  ·  Powered by OOH Platform  ·  Generated ${today}`, 40, 815, { width: 515, align: 'center' });

    // ── Finalize ──────────────────────────────────────────────────────────────
    doc.end();

    const pdfBuffer = await new Promise<Buffer>((resolve, reject) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });

    const safeName = campaign_name.replace(/[^a-z0-9]/gi, '-').toLowerCase();
    return new NextResponse(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="media-plan-${safeName}.pdf"`,
        'Content-Length': pdfBuffer.length.toString(),
      },
    });
  } catch (err) {
    console.error('[media-plan-pdf]', err);
    return NextResponse.json({ error: 'Failed to generate media plan PDF' }, { status: 500 });
  }
}
