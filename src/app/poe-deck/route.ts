import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Client brand colors map
const CLIENT_BRANDS: Record<string, { primary: string; secondary: string; accent: string; logo_text: string }> = {
  'MTN Nigeria': { primary: '#FFC614', secondary: '#000000', accent: '#FFC614', logo_text: 'MTN' },
  'MTN':         { primary: '#FFC614', secondary: '#000000', accent: '#FFC614', logo_text: 'MTN' },
  'Airtel':      { primary: '#FF0000', secondary: '#FFFFFF', accent: '#FF0000', logo_text: 'Airtel' },
  'Dangote':     { primary: '#003087', secondary: '#FFFFFF', accent: '#E31837', logo_text: 'Dangote' },
  'GTBank':      { primary: '#F58220', secondary: '#002147', accent: '#F58220', logo_text: 'GTBank' },
  'Access Bank': { primary: '#E30613', secondary: '#FFFFFF', accent: '#E30613', logo_text: 'Access' },
  'default':     { primary: '#1B4F8A', secondary: '#FFFFFF', accent: '#F59E0B', logo_text: 'OOH' },
};

function getBrand(clientName: string) {
  for (const [key, val] of Object.entries(CLIENT_BRANDS)) {
    if (clientName?.toLowerCase().includes(key.toLowerCase())) return val;
  }
  return CLIENT_BRANDS.default;
}

function hexToRgb(hex: string) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return { r, g, b };
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('en-NG', { day: 'numeric', month: 'long', year: 'numeric' });
}

async function fetchImageBuffer(url: string): Promise<{ buffer: Buffer; mime: string } | null> {
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(12000) });
    if (!resp.ok) return null;
    const mime = resp.headers.get('content-type')?.split(';')[0] ?? 'image/jpeg';
    const ab = await resp.arrayBuffer();
    return { buffer: Buffer.from(ab), mime };
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    const { campaignId, format } = await req.json();
    if (!campaignId) return NextResponse.json({ error: 'campaignId required' }, { status: 400 });

    // Fetch campaign + plan items + compliance checks
    const { data: campaign } = await supabase
      .from('campaigns')
      .select('*')
      .eq('id', campaignId)
      .single();

    if (!campaign) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });

    const { data: bookings } = await supabase
      .from('bookings')
      .select('*, boards(*)')
      .eq('campaign_id', campaignId)
      .order('created_at');

    const { data: compliance } = await supabase
      .from('compliance_checks')
      .select('*')
      .in('booking_id', (bookings || []).map((b: any) => b.id));

    // Map compliance by booking_id
    const compByBooking: Record<string, any> = {};
    (compliance || []).forEach((c: any) => {
      if (!compByBooking[c.booking_id]) compByBooking[c.booking_id] = c;
    });

    const brand = getBrand(campaign.client_name || '');
    const generatedAt = new Date().toLocaleDateString('en-NG', { day: 'numeric', month: 'long', year: 'numeric' });

    // Pre-fetch all compliance photos so generators can embed them synchronously
    const photoBuffers: Record<string, { buffer: Buffer; mime: string } | null> = {};
    await Promise.all(
      Object.entries(compByBooking).map(async ([bookingId, comp]: [string, any]) => {
        if (comp?.photo_url) {
          photoBuffers[bookingId] = await fetchImageBuffer(comp.photo_url);
        }
      })
    );

    if (format === 'pdf') {
      const pdfBuffer = await generatePDF(campaign, bookings || [], compByBooking, brand, generatedAt, photoBuffers);
      return new NextResponse(pdfBuffer as unknown as BodyInit, {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="POE_${campaign.name.replace(/\s+/g, '_')}_${Date.now()}.pdf"`,
        },
      });
    }

    if (format === 'pptx') {
      const pptxBuffer = await generatePPTX(campaign, bookings || [], compByBooking, brand, generatedAt, photoBuffers);
      return new NextResponse(pptxBuffer as unknown as BodyInit, {
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          'Content-Disposition': `attachment; filename="POE_${campaign.name.replace(/\s+/g, '_')}_${Date.now()}.pptx"`,
        },
      });
    }

    return NextResponse.json({ error: 'Invalid format. Use pdf or pptx.' }, { status: 400 });

  } catch (err: any) {
    console.error('POE deck error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// ── PDF Generation ──────────────────────────────────────────────────────────
async function generatePDF(campaign: any, bookings: any[], compByBooking: Record<string, any>, brand: any, generatedAt: string, photoBuffers: Record<string, { buffer: Buffer; mime: string } | null> = {}): Promise<Buffer> {
  const PDFDocument = (await import('pdfkit')).default;
  const chunks: Buffer[] = [];

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 0 });
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const W = 595.28;
    const H = 841.89;
    const rgb = hexToRgb(brand.primary);

    // ── Cover page ──
    // Background
    doc.rect(0, 0, W, H).fill(brand.secondary === '#000000' ? '#111111' : '#0F172A');

    // Brand accent bar
    doc.rect(0, 0, W, 8).fill(brand.primary);
    doc.rect(0, H - 8, W, 8).fill(brand.primary);

    // Brand color block
    doc.rect(0, H * 0.35, W, H * 0.3).fill(brand.primary).fillOpacity(0.12);

    // Client logo text (large)
    doc.fontSize(72).font('Helvetica-Bold')
      .fillColor(brand.primary).fillOpacity(1)
      .text(brand.logo_text, 60, 120, { lineBreak: false });

    // POE title
    doc.fontSize(36).font('Helvetica-Bold')
      .fillColor('#FFFFFF').fillOpacity(1)
      .text('Proof of Execution', 60, 230);

    doc.fontSize(18).font('Helvetica')
      .fillColor('rgba(255,255,255,0.7)').fillOpacity(0.7)
      .text(campaign.name, 60, 278);

    // Divider
    doc.rect(60, 316, 80, 3).fill(brand.primary).fillOpacity(1);

    // Campaign meta
    const meta = [
      { label: 'Client', value: campaign.client_name || '—' },
      { label: 'Campaign period', value: `${formatDate(campaign.start_date)} – ${formatDate(campaign.end_date)}` },
      { label: 'Total boards', value: String(bookings.length) },
      { label: 'POE submitted', value: String(Object.keys(compByBooking).length) + ' boards' },
      { label: 'Report generated', value: generatedAt },
    ];

    let metaY = 340;
    meta.forEach(({ label, value }) => {
      doc.fontSize(10).font('Helvetica').fillColor('rgba(255,255,255,0.5)').fillOpacity(0.5)
        .text(label.toUpperCase(), 60, metaY);
      doc.fontSize(13).font('Helvetica-Bold').fillColor('#FFFFFF').fillOpacity(1)
        .text(value, 60, metaY + 14);
      metaY += 46;
    });

    // Footer
    doc.fontSize(9).font('Helvetica').fillColor('rgba(255,255,255,0.3)').fillOpacity(0.3)
      .text('Confidential · Generated by OOH Platform', 60, H - 40, { align: 'left' })
      .text(`Page 1`, W - 120, H - 40, { align: 'right', width: 60 });

    // ── Board pages ──
    bookings.forEach((booking, idx) => {
      doc.addPage({ size: 'A4', margin: 0 });

      const comp = compByBooking[booking.id];
      const board = booking.boards;

      // Top accent bar
      doc.rect(0, 0, W, 6).fill(brand.primary).fillOpacity(1);

      // Header band
      doc.rect(0, 6, W, 72).fill('#F8FAFC').fillOpacity(1);

      // Board number badge
      doc.circle(48, 42, 20).fill(brand.primary).fillOpacity(1);
      doc.fontSize(14).font('Helvetica-Bold').fillColor('#FFFFFF').fillOpacity(1)
        .text(String(idx + 1), 36, 34, { width: 24, align: 'center' });

      // Board name
      doc.fontSize(16).font('Helvetica-Bold').fillColor('#0F172A').fillOpacity(1)
        .text(board?.name || 'Unknown board', 80, 20, { width: W - 160 });

      doc.fontSize(10).font('Helvetica').fillColor('#64748B').fillOpacity(1)
        .text(`${board?.address || ''}${board?.city ? ' · ' + board.city : ''}`, 80, 40, { width: W - 160 });

      doc.fontSize(10).font('Helvetica').fillColor('#94A3B8').fillOpacity(1)
        .text(campaign.name, W - 200, 30, { width: 140, align: 'right' });

      // Status pill
      const hasComp = !!comp;
      const pillColor = hasComp ? '#10B981' : '#F59E0B';
      const pillText = hasComp ? 'POE SUBMITTED' : 'PENDING';
      doc.roundedRect(W - 150, 50, 110, 18, 9).fill(hasComp ? '#ECFDF5' : '#FFFBEB').fillOpacity(1);
      doc.fontSize(8).font('Helvetica-Bold').fillColor(pillColor).fillOpacity(1)
        .text(pillText, W - 144, 55, { width: 98, align: 'center' });

      // Photo area
      const photoY = 90;
      const photoH = 340;

      const imgData = photoBuffers[booking.id];
      if (comp?.photo_url && imgData) {
        try {
          doc.image(imgData.buffer, 40, photoY, {
            fit: [W - 80, photoH],
            align: 'center',
            valign: 'center',
          });
        } catch {
          // Fallback if image decode fails
          doc.rect(40, photoY, W - 80, photoH).fill('#F1F5F9').fillOpacity(1);
          doc.fontSize(10).font('Helvetica').fillColor('#94A3B8').fillOpacity(1)
            .text('Photo could not be loaded', 40, photoY + photoH / 2 - 10, { width: W - 80, align: 'center' });
        }
      } else if (comp?.photo_url) {
        // URL exists but fetch failed
        doc.rect(40, photoY, W - 80, photoH).fill('#FEF9C3').fillOpacity(1)
          .rect(40, photoY, W - 80, photoH).stroke('#FDE68A').strokeOpacity(1).lineWidth(1);
        doc.fontSize(10).font('Helvetica').fillColor('#92400E').fillOpacity(1)
          .text('Photo submitted — could not load for PDF', 40, photoY + photoH / 2 - 10, { width: W - 80, align: 'center' });
      } else {
        doc.rect(40, photoY, W - 80, photoH).fill('#F8FAFC').fillOpacity(1)
          .rect(40, photoY, W - 80, photoH).stroke('#E2E8F0').strokeOpacity(1).lineWidth(1);
        doc.fontSize(13).font('Helvetica').fillColor('#CBD5E1').fillOpacity(1)
          .text('No photo submitted yet', 40, photoY + photoH / 2 - 10, { width: W - 80, align: 'center' });
      }

      // Details grid
      const detailY = photoY + photoH + 20;
      const details = [
        { label: 'Format', value: board?.format?.replace('_', ' ') || '—' },
        { label: 'Location', value: board?.city || '—' },
        { label: 'Submitted by', value: comp?.submitted_name || comp?.submitted_by || '—' },
        { label: 'GPS coordinates', value: comp ? `${Number(comp.latitude).toFixed(5)}, ${Number(comp.longitude).toFixed(5)}` : '—' },
        { label: 'Date submitted', value: comp?.submitted_at ? formatDate(comp.submitted_at) : '—' },
        { label: 'Status', value: comp?.status?.toUpperCase() || 'PENDING' },
      ];

      const colW = (W - 80) / 3;
      details.forEach((d, i) => {
        const col = i % 3;
        const row = Math.floor(i / 3);
        const x = 40 + col * colW;
        const y = detailY + row * 52;
        doc.fontSize(8).font('Helvetica').fillColor('#94A3B8').fillOpacity(1)
          .text(d.label.toUpperCase(), x, y);
        doc.fontSize(11).font('Helvetica-Bold').fillColor('#0F172A').fillOpacity(1)
          .text(d.value, x, y + 12, { width: colW - 10 });
      });

      if (comp?.notes) {
        doc.fontSize(8).font('Helvetica').fillColor('#94A3B8').fillOpacity(1)
          .text('NOTES', 40, detailY + 110);
        doc.fontSize(10).font('Helvetica').fillColor('#475569').fillOpacity(1)
          .text(comp.notes, 40, detailY + 123, { width: W - 80 });
      }

      // Footer
      doc.rect(0, H - 36, W, 36).fill('#F8FAFC').fillOpacity(1);
      doc.rect(0, H - 36, W, 1).fill('#E2E8F0').fillOpacity(1);
      doc.fontSize(8).font('Helvetica').fillColor('#94A3B8').fillOpacity(1)
        .text(`${campaign.client_name} · ${campaign.name} · Confidential`, 40, H - 22)
        .text(`Board ${idx + 1} of ${bookings.length}`, W - 120, H - 22, { width: 80, align: 'right' });
    });

    doc.end();
  });
}

// ── PPTX Generation ─────────────────────────────────────────────────────────
async function generatePPTX(campaign: any, bookings: any[], compByBooking: Record<string, any>, brand: any, generatedAt: string, photoBuffers: Record<string, { buffer: Buffer; mime: string } | null> = {}): Promise<Buffer> {
  const PptxGenJS = (await import('pptxgenjs')).default;
  const pptx = new PptxGenJS();

  pptx.layout = 'LAYOUT_WIDE'; // 13.33" x 7.5"
  pptx.title = `POE Report — ${campaign.name}`;
  pptx.subject = 'Proof of Execution';
  pptx.company = campaign.client_name || 'OOH Platform';

  const W = 13.33;
  const H = 7.5;
  const primaryHex = brand.primary.replace('#', '');
  const isDark = brand.secondary === '#000000';
  const bgColor = isDark ? '111111' : '0F172A';

  // ── Cover slide ──
  const cover = pptx.addSlide();

  // Background
  cover.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: W, h: H, fill: { color: bgColor } });

  // Top accent bar
  cover.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: W, h: 0.12, fill: { color: primaryHex } });

  // Bottom accent bar
  cover.addShape(pptx.ShapeType.rect, { x: 0, y: H - 0.12, w: W, h: 0.12, fill: { color: primaryHex } });

  // Large brand initial block
  cover.addShape(pptx.ShapeType.rect, { x: 0, y: 2.2, w: 4, h: 3.2, fill: { color: primaryHex, transparency: 88 } });

  // Client name / logo text
  cover.addText(brand.logo_text, {
    x: 0.6, y: 0.8, w: 5, h: 1.4,
    fontSize: 72, bold: true, color: primaryHex,
    fontFace: 'Calibri',
  });

  // POE title
  cover.addText('Proof of Execution Report', {
    x: 0.6, y: 2.2, w: 8, h: 0.7,
    fontSize: 32, bold: true, color: 'FFFFFF',
    fontFace: 'Calibri',
  });

  // Campaign name
  cover.addText(campaign.name, {
    x: 0.6, y: 2.95, w: 8, h: 0.5,
    fontSize: 20, color: 'AAAAAA', fontFace: 'Calibri',
  });

  // Divider
  cover.addShape(pptx.ShapeType.rect, { x: 0.6, y: 3.55, w: 1.2, h: 0.05, fill: { color: primaryHex } });

  // Meta grid
  const metaItems = [
    { label: 'CLIENT', value: campaign.client_name || '—' },
    { label: 'PERIOD', value: `${formatDate(campaign.start_date)} – ${formatDate(campaign.end_date)}` },
    { label: 'TOTAL BOARDS', value: String(bookings.length) },
    { label: 'POE SUBMITTED', value: `${Object.keys(compByBooking).length} of ${bookings.length}` },
    { label: 'GENERATED', value: generatedAt },
  ];

  metaItems.forEach((item, i) => {
    const x = 0.6 + (i % 3) * 4.1;
    const y = 3.8 + Math.floor(i / 3) * 1.0;
    cover.addText(item.label, { x, y, w: 3.8, h: 0.25, fontSize: 9, color: '666666', fontFace: 'Calibri', bold: true });
    cover.addText(item.value, { x, y: y + 0.25, w: 3.8, h: 0.4, fontSize: 16, color: 'FFFFFF', fontFace: 'Calibri', bold: true });
  });

  // Confidential footer
  cover.addText(`Confidential · Generated by OOH Platform`, {
    x: 0, y: H - 0.4, w: W, h: 0.3,
    fontSize: 8, color: '555555', align: 'center', fontFace: 'Calibri',
  });

  // ── Board slides ──
  bookings.forEach((booking, idx) => {
    const slide = pptx.addSlide();
    const comp = compByBooking[booking.id];
    const board = booking.boards;
    const hasPhoto = !!comp?.photo_url;
    const hasComp = !!comp;

    // White background
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: W, h: H, fill: { color: 'F8FAFC' } });

    // Top accent bar
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: W, h: 0.08, fill: { color: primaryHex } });

    // Header band
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0.08, w: W, h: 1.1, fill: { color: 'FFFFFF' } });
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 1.18, w: W, h: 0.01, fill: { color: 'E2E8F0' } });

    // Board number circle
    slide.addShape(pptx.ShapeType.ellipse, {
      x: 0.3, y: 0.2, w: 0.7, h: 0.7,
      fill: { color: primaryHex },
    });
    slide.addText(String(idx + 1), {
      x: 0.3, y: 0.2, w: 0.7, h: 0.7,
      fontSize: 18, bold: true, color: 'FFFFFF',
      align: 'center', valign: 'middle', fontFace: 'Calibri',
    });

    // Board name
    slide.addText(board?.name || 'Unknown board', {
      x: 1.2, y: 0.18, w: 8, h: 0.45,
      fontSize: 22, bold: true, color: '0F172A', fontFace: 'Calibri',
    });

    // Address
    slide.addText(`${board?.address || ''}${board?.city ? ' · ' + board.city : ''}`, {
      x: 1.2, y: 0.63, w: 8, h: 0.32,
      fontSize: 12, color: '64748B', fontFace: 'Calibri',
    });

    // Campaign name top right
    slide.addText(campaign.name, {
      x: 9.5, y: 0.25, w: 3.5, h: 0.35,
      fontSize: 10, color: '94A3B8', align: 'right', fontFace: 'Calibri',
    });

    // Status pill
    const pillBg = hasComp ? 'ECFDF5' : 'FFFBEB';
    const pillFg = hasComp ? '065F46' : '92400E';
    slide.addShape(pptx.ShapeType.roundRect, {
      x: 9.5, y: 0.65, w: 2.2, h: 0.35,
      fill: { color: pillBg }, rectRadius: 0.17,
    });
    slide.addText(hasComp ? '✓ POE SUBMITTED' : '⏳ PENDING', {
      x: 9.5, y: 0.65, w: 2.2, h: 0.35,
      fontSize: 9, bold: true, color: pillFg,
      align: 'center', valign: 'middle', fontFace: 'Calibri',
    });

    // Photo area (left side)
    const photoX = 0.3;
    const photoY = 1.3;
    const photoW = 7.8;
    const photoH = 4.2;

    const imgData = photoBuffers[booking.id];
    if (hasPhoto && imgData) {
      try {
        const dataUrl = `data:${imgData.mime};base64,${imgData.buffer.toString('base64')}`;
        slide.addImage({
          data: dataUrl,
          x: photoX, y: photoY, w: photoW, h: photoH,
          sizing: { type: 'contain', w: photoW, h: photoH },
        });
      } catch {
        slide.addShape(pptx.ShapeType.rect, {
          x: photoX, y: photoY, w: photoW, h: photoH,
          fill: { color: 'F1F5F9' }, line: { color: 'E2E8F0', width: 1 },
        });
        slide.addText('Photo could not be embedded', {
          x: photoX, y: photoY + photoH / 2 - 0.2, w: photoW, h: 0.4,
          fontSize: 11, color: '94A3B8', align: 'center', fontFace: 'Calibri',
        });
      }
    } else if (hasPhoto) {
      // URL exists but fetch failed
      slide.addShape(pptx.ShapeType.rect, {
        x: photoX, y: photoY, w: photoW, h: photoH,
        fill: { color: 'FEF9C3' }, line: { color: 'FDE68A', width: 1 },
      });
      slide.addText('📸 Photo on file — could not load for slide', {
        x: photoX, y: photoY + photoH / 2 - 0.2, w: photoW, h: 0.4,
        fontSize: 11, color: '92400E', align: 'center', fontFace: 'Calibri',
      });
    } else {
      slide.addShape(pptx.ShapeType.rect, {
        x: photoX, y: photoY, w: photoW, h: photoH,
        fill: { color: 'F1F5F9' },
        line: { color: 'E2E8F0', width: 1 },
      });
      slide.addText('No photo submitted', {
        x: photoX, y: photoY + photoH / 2 - 0.2, w: photoW, h: 0.4,
        fontSize: 13, color: 'CBD5E1', align: 'center', fontFace: 'Calibri',
      });
    }

    // Details panel (right side)
    const detX = 8.3;
    const details = [
      { label: 'FORMAT', value: board?.format?.replace('_', ' ')?.toUpperCase() || '—' },
      { label: 'CITY', value: board?.city || '—' },
      { label: 'SUBMITTED BY', value: comp?.submitted_name || comp?.submitted_by || '—' },
      { label: 'DATE', value: comp?.submitted_at ? formatDate(comp.submitted_at) : '—' },
      { label: 'GPS LAT', value: comp ? Number(comp.latitude).toFixed(5) : '—' },
      { label: 'GPS LNG', value: comp ? Number(comp.longitude).toFixed(5) : '—' },
    ];

    let detY = 1.3;
    details.forEach(({ label, value }) => {
      slide.addText(label, {
        x: detX, y: detY, w: 4.7, h: 0.22,
        fontSize: 8, bold: true, color: '94A3B8', fontFace: 'Calibri',
      });
      slide.addText(value, {
        x: detX, y: detY + 0.22, w: 4.7, h: 0.35,
        fontSize: 13, bold: true, color: '0F172A', fontFace: 'Calibri',
      });
      detY += 0.68;
    });

    if (comp?.notes) {
      slide.addText('NOTES', {
        x: detX, y: detY, w: 4.7, h: 0.22,
        fontSize: 8, bold: true, color: '94A3B8', fontFace: 'Calibri',
      });
      slide.addText(comp.notes, {
        x: detX, y: detY + 0.22, w: 4.7, h: 0.6,
        fontSize: 11, color: '475569', fontFace: 'Calibri',
      });
    }

    // Footer
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: H - 0.42, w: W, h: 0.42, fill: { color: 'F1F5F9' } });
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: H - 0.42, w: W, h: 0.01, fill: { color: 'E2E8F0' } });
    slide.addText(`${campaign.client_name} · ${campaign.name} · Confidential`, {
      x: 0.4, y: H - 0.38, w: 9, h: 0.3,
      fontSize: 8, color: '94A3B8', fontFace: 'Calibri',
    });
    slide.addText(`Board ${idx + 1} of ${bookings.length}`, {
      x: 0, y: H - 0.38, w: W - 0.4, h: 0.3,
      fontSize: 8, color: '94A3B8', align: 'right', fontFace: 'Calibri',
    });
  });

  // Return as buffer
  const buffer = await pptx.write({ outputType: 'nodebuffer' }) as Buffer;
  return buffer;
}