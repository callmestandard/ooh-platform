import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, unauthorized } from '@/lib/require-auth';
import { rateLimit, rateLimitResponse } from '@/lib/rate-limit';

export const runtime = 'nodejs';

type OverpassElement = {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  tags?: Record<string, string>;
};

const AMENITY_CATEGORIES: Record<string, { label: string; icon: string; weight: number }> = {
  // Traffic generators (high OOH value)
  bank:              { label: 'Banks',          icon: '🏦', weight: 8 },
  atm:               { label: 'ATMs',           icon: '💳', weight: 5 },
  fuel:              { label: 'Fuel stations',  icon: '⛽', weight: 7 },
  supermarket:       { label: 'Supermarkets',   icon: '🛒', weight: 9 },
  marketplace:       { label: 'Markets',        icon: '🏪', weight: 10 },
  mall:              { label: 'Malls',          icon: '🏬', weight: 10 },
  department_store:  { label: 'Dept. stores',   icon: '🏬', weight: 9 },
  // Audience indicators
  fast_food:         { label: 'Fast food',      icon: '🍔', weight: 6 },
  restaurant:        { label: 'Restaurants',    icon: '🍽️', weight: 5 },
  cafe:              { label: 'Cafés',          icon: '☕', weight: 4 },
  bar:               { label: 'Bars/clubs',     icon: '🍺', weight: 4 },
  hospital:          { label: 'Hospitals',      icon: '🏥', weight: 7 },
  clinic:            { label: 'Clinics',        icon: '🏥', weight: 5 },
  school:            { label: 'Schools',        icon: '🏫', weight: 6 },
  college:           { label: 'Colleges',       icon: '🎓', weight: 7 },
  university:        { label: 'Universities',   icon: '🎓', weight: 9 },
  pharmacy:          { label: 'Pharmacies',     icon: '💊', weight: 5 },
  office:            { label: 'Offices',        icon: '🏢', weight: 7 },
  hotel:             { label: 'Hotels',         icon: '🏨', weight: 6 },
  place_of_worship:  { label: 'Churches/Mosques', icon: '🕌', weight: 6 },
  cinema:            { label: 'Cinemas',        icon: '🎬', weight: 7 },
  gym:               { label: 'Gyms',           icon: '💪', weight: 5 },
  bus_station:       { label: 'Bus stations',   icon: '🚌', weight: 9 },
  taxi:              { label: 'Taxi/ride hubs', icon: '🚕', weight: 7 },
};

function countByCategory(elements: OverpassElement[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const el of elements) {
    const tags = el.tags || {};
    const type = tags.amenity || tags.shop || tags.building || tags.landuse || '';
    if (type) {
      counts[type] = (counts[type] || 0) + 1;
    }
  }
  return counts;
}

function scoreLocation(counts: Record<string, number>) {
  let commercialScore = 0;
  let footfallScore   = 0;
  let youthScore      = 0;
  let premiumScore    = 0;
  let totalPOIs       = 0;

  for (const [type, count] of Object.entries(counts)) {
    const cat = AMENITY_CATEGORIES[type];
    if (cat) {
      commercialScore += cat.weight * count;
      totalPOIs += count;
    }

    // Footfall
    if (['marketplace', 'bus_station', 'supermarket', 'mall'].includes(type)) footfallScore += count * 15;
    if (['bank', 'fast_food', 'fuel'].includes(type)) footfallScore += count * 8;
    if (['restaurant', 'cafe', 'pharmacy'].includes(type)) footfallScore += count * 4;

    // Youth
    if (['college', 'university', 'cinema', 'gym', 'cafe', 'bar'].includes(type)) youthScore += count * 10;
    if (['fast_food', 'school'].includes(type)) youthScore += count * 5;

    // Premium
    if (['hotel', 'mall', 'department_store', 'office'].includes(type)) premiumScore += count * 12;
    if (['bank', 'hospital'].includes(type)) premiumScore += count * 6;
  }

  return {
    commercial: Math.min(100, Math.round(commercialScore / 2)),
    footfall:   Math.min(100, Math.round(footfallScore)),
    youth:      Math.min(100, Math.round(youthScore)),
    premium:    Math.min(100, Math.round(premiumScore)),
    totalPOIs,
  };
}

function estimateImpressions(scores: ReturnType<typeof scoreLocation>, roadHint?: string): number {
  // Base daily impressions from POI density
  let base = 5000;
  base += scores.footfall * 500;
  base += scores.commercial * 200;

  // Road type multiplier
  if (roadHint) {
    const road = roadHint.toLowerCase();
    if (road.includes('express') || road.includes('highway') || road.includes('motorway')) base *= 4;
    else if (road.includes('arterial') || road.includes('major')) base *= 2;
    else if (road.includes('bridge') || road.includes('flyover')) base *= 3;
  }

  return Math.round(base / 1000) * 1000; // round to nearest 1000
}

function classifyArea(scores: ReturnType<typeof scoreLocation>, counts: Record<string, number>): {
  type: string; icon: string; description: string;
} {
  const hasUniversities = (counts.university || 0) > 0;
  const hasMalls = (counts.mall || 0) + (counts.supermarket || 0) > 0;
  const hasOffices = (counts.office || 0) > 2;
  const hasBusStations = (counts.bus_station || 0) > 0;

  if (scores.premium > 60 && hasOffices) return { type: 'Commercial CBD', icon: '🏢', description: 'High-income professionals, corporate decision-makers' };
  if (scores.premium > 50 && hasOffices) return { type: 'Commercial CBD', icon: '🏢', description: 'High-income professionals, corporate decision-makers' };
  if (hasUniversities) return { type: 'University Zone', icon: '🎓', description: 'Students, young professionals, tech-forward audience' };
  if (hasMalls || scores.commercial > 60) return { type: 'Retail Hub', icon: '🛒', description: 'Active shoppers, families, high purchase intent' };
  if (hasBusStations || scores.footfall > 75) return { type: 'Transit Corridor', icon: '🚌', description: 'Mass commuters, high daily impressions, mixed demographics' };
  if (scores.youth > 50) return { type: 'Youth Cluster', icon: '👥', description: 'Gen Z & Millennial dominant, entertainment & lifestyle brands' };
  if (scores.premium > 40) return { type: 'Upscale Residential', icon: '🏘️', description: 'Affluent homeowners, luxury brand receptive' };
  if (scores.commercial > 30) return { type: 'Mixed Commercial', icon: '🏪', description: 'Diverse audience, broad brand appeal' };
  return { type: 'Residential', icon: '🏠', description: 'Local community, FMCG and essential services brands' };
}

function getTopPOIs(counts: Record<string, number>): { label: string; icon: string; count: number }[] {
  return Object.entries(counts)
    .filter(([type]) => AMENITY_CATEGORIES[type])
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([type, count]) => ({
      label: AMENITY_CATEGORIES[type].label,
      icon: AMENITY_CATEGORIES[type].icon,
      count,
    }));
}

function getRecommendedVerticals(scores: ReturnType<typeof scoreLocation>, areaType: string): string[] {
  const verticals: string[] = [];
  if (scores.premium > 40) verticals.push('Banking & Finance', 'Automotive', 'Real Estate');
  if (scores.youth > 40)   verticals.push('Telecom', 'Fashion', 'Entertainment', 'Beverages');
  if (scores.footfall > 40) verticals.push('FMCG', 'Fast Food', 'Retail');
  if (areaType.includes('Transit')) verticals.push('Transport & Logistics', 'Mobile Money');
  if (areaType.includes('University')) verticals.push('Education Tech', 'Financial Services', 'Lifestyle');
  if (areaType.includes('Commercial')) verticals.push('B2B Services', 'Professional Services');
  // Deduplicate
  return [...new Set(verticals)].slice(0, 5);
}

export async function GET(req: NextRequest) {
  const user = await requireAuth(req);
  if (!user) return unauthorized();
  if (!rateLimit(`location-intel:${user.id}`)) return rateLimitResponse();

  const { searchParams } = new URL(req.url);
  const lat  = parseFloat(searchParams.get('lat') || '0');
  const lng  = parseFloat(searchParams.get('lng') || '0');
  const name = searchParams.get('name') || '';
  const road = searchParams.get('road') || '';

  if (!lat || !lng) return NextResponse.json({ error: 'lat and lng required' }, { status: 400 });

  // Query Overpass API for POIs within 800m
  const overpassQuery = `
    [out:json][timeout:10];
    (
      node[amenity](around:800,${lat},${lng});
      node[shop](around:800,${lat},${lng});
      node[building~"commercial|office|retail"](around:800,${lat},${lng});
    );
    out body 100;
  `.trim();

  let elements: OverpassElement[] = [];
  try {
    const res = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(overpassQuery)}`,
      signal: AbortSignal.timeout(12000),
    });
    if (res.ok) {
      const json = await res.json();
      elements = json.elements || [];
    }
  } catch {
    // Overpass timeout — proceed with empty data, still generate algo-based metrics
  }

  const counts  = countByCategory(elements);
  const scores  = scoreLocation(counts);
  const area    = classifyArea(scores, counts);
  const topPOIs = getTopPOIs(counts);
  const impressions = estimateImpressions(scores, road);
  const verticals   = getRecommendedVerticals(scores, area.type);

  // Optional: enhance with AI narrative if Anthropic key is set
  let aiInsight: string | null = null;
  if (process.env.ANTHROPIC_API_KEY && elements.length > 0) {
    try {
      const Anthropic = (await import('@anthropic-ai/sdk')).default;
      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

      const poiSummary = topPOIs.map(p => `${p.count} ${p.label}`).join(', ');
      const prompt = `You are an OOH advertising media analyst in Nigeria. Provide a 2–3 sentence location intelligence brief for a billboard site near ${name || `${lat.toFixed(4)}, ${lng.toFixed(4)}`}.

Context:
- Area type: ${area.type}
- Audience: ${area.description}
- Nearby POIs (within 800m): ${poiSummary || 'limited data'}
- Estimated daily impressions: ${impressions.toLocaleString()}
- Top campaign verticals: ${verticals.join(', ')}

Write a concise, confident OOH media brief. Focus on why an advertiser should or should not place a board here. Be specific to Nigeria. No bullet points.`;

      const message = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 180,
        messages: [{ role: 'user', content: prompt }],
      });

      aiInsight = (message.content[0] as { text: string }).text;
    } catch {
      // AI enhancement failed — return algorithmic data only
    }
  }

  return NextResponse.json({
    area,
    scores,
    impressions,
    topPOIs,
    verticals,
    totalPOIs: scores.totalPOIs,
    aiInsight,
    dataSource: elements.length > 0 ? 'live' : 'estimated',
  });
}
