import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

function generateCode(): string {
  return Math.random().toString(36).slice(2, 8);
}

// POST — create a tracking link for a booking
export async function POST(req: NextRequest) {
  const { booking_id, campaign_id, target_url, label } = await req.json();

  if (!booking_id || !target_url) {
    return NextResponse.json({ error: 'booking_id and target_url are required' }, { status: 400 });
  }

  // Return existing link if one already exists for this booking
  const { data: existing } = await supabase
    .from('tracking_links')
    .select('*')
    .eq('booking_id', booking_id)
    .single();

  if (existing) return NextResponse.json(existing);

  // Generate unique short code
  let short_code = generateCode();
  let attempts = 0;
  while (attempts < 5) {
    const { data: clash } = await supabase.from('tracking_links').select('id').eq('short_code', short_code).single();
    if (!clash) break;
    short_code = generateCode();
    attempts++;
  }

  const { data, error } = await supabase
    .from('tracking_links')
    .insert({ booking_id, campaign_id: campaign_id || null, short_code, target_url, label: label || null })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}

// GET — list tracking links for a campaign with scan counts
export async function GET(req: NextRequest) {
  const campaignId = req.nextUrl.searchParams.get('campaign_id');
  const bookingId  = req.nextUrl.searchParams.get('booking_id');

  let query = supabase
    .from('tracking_links')
    .select('*, events:tracking_events(scanned_at, device_type)');

  if (campaignId) query = query.eq('campaign_id', campaignId);
  if (bookingId)  query = query.eq('booking_id', bookingId);

  const { data, error } = await query.order('created_at');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Attach computed stats
  const now = Date.now();
  const enriched = (data || []).map((link: any) => {
    const events: { scanned_at: string; device_type: string | null }[] = link.events || [];
    const total  = events.length;
    const today  = events.filter(e => now - new Date(e.scanned_at).getTime() < 86400000).length;
    const week   = events.filter(e => now - new Date(e.scanned_at).getTime() < 7 * 86400000).length;
    const mobile = events.filter(e => e.device_type === 'mobile').length;
    return { ...link, events: undefined, stats: { total, today, week, mobile } };
  });

  return NextResponse.json(enriched);
}
