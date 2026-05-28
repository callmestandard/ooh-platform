import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const { data: board, error: boardErr } = await supabase
    .from('boards')
    .select('id, name, latitude, longitude')
    .eq('id', id)
    .single();

  if (boardErr || !board) {
    return NextResponse.json({ error: 'Board not found' }, { status: 404 });
  }

  if (!board.latitude || !board.longitude) {
    return NextResponse.json({ error: 'Board has no GPS coordinates' }, { status: 400 });
  }

  // Call location-intel using the same host
  const host = req.headers.get('host') || 'localhost:3000';
  const protocol = host.startsWith('localhost') || host.startsWith('127') ? 'http' : 'https';
  const intelUrl = `${protocol}://${host}/api/location-intel?lat=${board.latitude}&lng=${board.longitude}&name=${encodeURIComponent(board.name)}`;

  let intel: {
    area: { type: string; icon: string; description: string };
    scores: { commercial: number; footfall: number; youth: number; premium: number };
    impressions: number;
    topPOIs: { label: string; icon: string; count: number }[];
    verticals: string[];
    totalPOIs: number;
    aiInsight: string | null;
    dataSource: 'live' | 'estimated';
  };

  try {
    const intelRes = await fetch(intelUrl, { signal: AbortSignal.timeout(20000) });
    if (!intelRes.ok) throw new Error('intel api error');
    intel = await intelRes.json();
  } catch {
    return NextResponse.json({ error: 'Location intelligence fetch failed' }, { status: 502 });
  }

  const profile = {
    board_id: id,
    area_type: intel.area.type,
    area_icon: intel.area.icon,
    area_description: intel.area.description,
    commercial_score: intel.scores.commercial,
    footfall_score: intel.scores.footfall,
    youth_score: intel.scores.youth,
    premium_score: intel.scores.premium,
    daily_impressions: intel.impressions,
    top_pois: intel.topPOIs,
    verticals: intel.verticals,
    total_pois: intel.totalPOIs,
    ai_insight: intel.aiInsight,
    data_source: intel.dataSource,
    enriched_at: new Date().toISOString(),
  };

  const { data: saved, error: saveErr } = await supabase
    .from('board_audience_profiles')
    .upsert(profile, { onConflict: 'board_id' })
    .select()
    .single();

  if (saveErr) {
    return NextResponse.json({ error: saveErr.message }, { status: 500 });
  }

  return NextResponse.json(saved);
}
