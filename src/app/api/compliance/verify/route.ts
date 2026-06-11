import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAuth, unauthorized } from '@/lib/require-auth';
import { rateLimit, rateLimitResponse } from '@/lib/rate-limit';

export const runtime = 'nodejs';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

type AIResult = {
  is_billboard_photo: boolean;
  creative_visible: boolean;
  condition: 'good' | 'acceptable' | 'poor';
  location_plausible: boolean;
  issues: string[];
  verdict: 'verified' | 'review' | 'flagged';
  confidence: number;
  summary: string;
};

function haversineMetres(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export async function POST(req: NextRequest) {
  const user = await requireAuth(req);
  if (!user) return unauthorized();
  if (!rateLimit(`compliance:${user.id}`)) return rateLimitResponse();

  const { compliance_check_id } = await req.json();

  if (!compliance_check_id) {
    return NextResponse.json({ error: 'compliance_check_id required' }, { status: 400 });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 503 });
  }

  // Fetch compliance check + board details
  const { data: check, error: fetchErr } = await supabase
    .from('compliance_checks')
    .select(`
      id, photo_url, latitude, longitude, notes,
      bookings (
        id,
        boards (name, address, city, state, format, latitude, longitude)
      )
    `)
    .eq('id', compliance_check_id)
    .single();

  if (fetchErr || !check) {
    return NextResponse.json({ error: 'Compliance check not found' }, { status: 404 });
  }

  if (!check.photo_url) {
    return NextResponse.json({ error: 'No photo to verify' }, { status: 400 });
  }

  const board = (check.bookings as any)?.boards;

  // GPS distance check
  let gpsNote = 'No GPS data submitted.';
  if (check.latitude && check.longitude && board?.latitude && board?.longitude) {
    const dist = Math.round(haversineMetres(check.latitude, check.longitude, board.latitude, board.longitude));
    if (dist <= 300) gpsNote = `GPS matches (${dist}m from expected location — within tolerance).`;
    else if (dist <= 1500) gpsNote = `GPS is ${dist}m from expected location — slightly off, may be acceptable.`;
    else gpsNote = `GPS is ${dist}m from expected location — significantly off. Possible wrong board or fake location.`;
  }

  const prompt = `You are an automated compliance verifier for an out-of-home advertising platform in Nigeria.
A field agent has submitted this photo as proof of posting for a billboard booking.

Board details:
- Name: ${board?.name || 'Unknown'}
- Format: ${board?.format || 'Unknown'} (e.g. billboard, unipole, gantry, bridge_panel, wall_drape)
- Address: ${board?.address || '—'}, ${board?.city || '—'}, ${board?.state || 'Nigeria'}
- GPS note: ${gpsNote}
${check.notes ? `- Agent notes: "${check.notes}"` : ''}

Analyse the photo and respond in valid JSON only (no markdown, no commentary):
{
  "is_billboard_photo": boolean,
  "creative_visible": boolean,
  "condition": "good" | "acceptable" | "poor",
  "location_plausible": boolean,
  "issues": ["string", ...],
  "verdict": "verified" | "review" | "flagged",
  "confidence": 0.0 to 1.0,
  "summary": "one sentence for the agency reviewer"
}

Rules:
- "verified": clearly a billboard photo, creative visible, no major issues
- "review": billboard visible but something is uncertain (lighting, partial view, minor issue)
- "flagged": not a billboard photo, creative not visible, major damage, or suspicious
- Be strict. A selfie, random street photo, or image with no billboard must be flagged.`;

  try {
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'url', url: check.photo_url },
          },
          { type: 'text', text: prompt },
        ],
      }],
    });

    const raw = (response.content[0] as { type: string; text: string }).text.trim();

    let result: AIResult;
    try {
      // Strip any accidental markdown fences
      const cleaned = raw.replace(/^```json?\s*/i, '').replace(/```\s*$/, '').trim();
      result = JSON.parse(cleaned);
    } catch {
      return NextResponse.json({ error: 'AI returned invalid JSON', raw }, { status: 502 });
    }

    // Clamp confidence
    const confidence = Math.min(1, Math.max(0, Number(result.confidence) || 0.5));

    // Persist AI result
    await supabase
      .from('compliance_checks')
      .update({
        ai_verdict: result.verdict,
        ai_confidence: confidence,
        ai_notes: result.summary,
        ai_verified_at: new Date().toISOString(),
      })
      .eq('id', compliance_check_id);

    return NextResponse.json({
      verdict: result.verdict,
      confidence,
      summary: result.summary,
      issues: result.issues || [],
      is_billboard_photo: result.is_billboard_photo,
      creative_visible: result.creative_visible,
      condition: result.condition,
      location_plausible: result.location_plausible,
      gps_note: gpsNote,
    });

  } catch (err) {
    const msg = err instanceof Error ? err.message : 'AI verification failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
