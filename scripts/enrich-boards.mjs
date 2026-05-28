/**
 * Audience Data Enrichment Script
 * Usage: node scripts/enrich-boards.mjs
 *
 * Fetches all boards from Supabase, queries OpenStreetMap Overpass API
 * for POI data around each board, scores the location, and upserts
 * the audience profile into board_audience_profiles.
 *
 * Requires .env.local with NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Load .env.local manually (no dotenv dependency needed)
try {
  const envPath = resolve(process.cwd(), '.env.local');
  const env = readFileSync(envPath, 'utf-8');
  for (const line of env.split('\n')) {
    const [k, ...v] = line.split('=');
    if (k && !k.startsWith('#') && v.length) process.env[k.trim()] = v.join('=').trim();
  }
} catch { /* .env.local not found — rely on real env */ }

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// ─── Scoring logic (mirrors /api/location-intel) ───────────────────────────

const AMENITY_CATEGORIES = {
  bank:             { label: 'Banks',           icon: '🏦', weight: 8 },
  atm:              { label: 'ATMs',            icon: '💳', weight: 5 },
  fuel:             { label: 'Fuel stations',   icon: '⛽', weight: 7 },
  supermarket:      { label: 'Supermarkets',    icon: '🛒', weight: 9 },
  marketplace:      { label: 'Markets',         icon: '🏪', weight: 10 },
  mall:             { label: 'Malls',           icon: '🏬', weight: 10 },
  department_store: { label: 'Dept. stores',    icon: '🏬', weight: 9 },
  fast_food:        { label: 'Fast food',       icon: '🍔', weight: 6 },
  restaurant:       { label: 'Restaurants',     icon: '🍽️', weight: 5 },
  cafe:             { label: 'Cafés',           icon: '☕', weight: 4 },
  bar:              { label: 'Bars/clubs',      icon: '🍺', weight: 4 },
  hospital:         { label: 'Hospitals',       icon: '🏥', weight: 7 },
  clinic:           { label: 'Clinics',         icon: '🏥', weight: 5 },
  school:           { label: 'Schools',         icon: '🏫', weight: 6 },
  college:          { label: 'Colleges',        icon: '🎓', weight: 7 },
  university:       { label: 'Universities',    icon: '🎓', weight: 9 },
  pharmacy:         { label: 'Pharmacies',      icon: '💊', weight: 5 },
  office:           { label: 'Offices',         icon: '🏢', weight: 7 },
  hotel:            { label: 'Hotels',          icon: '🏨', weight: 6 },
  place_of_worship: { label: 'Churches/Mosques',icon: '🕌', weight: 6 },
  cinema:           { label: 'Cinemas',         icon: '🎬', weight: 7 },
  gym:              { label: 'Gyms',            icon: '💪', weight: 5 },
  bus_station:      { label: 'Bus stations',    icon: '🚌', weight: 9 },
  taxi:             { label: 'Taxi/ride hubs',  icon: '🚕', weight: 7 },
};

function countByCategory(elements) {
  const counts = {};
  for (const el of elements) {
    const tags = el.tags || {};
    const type = tags.amenity || tags.shop || tags.building || tags.landuse || '';
    if (type) counts[type] = (counts[type] || 0) + 1;
  }
  return counts;
}

function scoreLocation(counts) {
  let commercialScore = 0, footfallScore = 0, youthScore = 0, premiumScore = 0, totalPOIs = 0;

  for (const [type, count] of Object.entries(counts)) {
    const cat = AMENITY_CATEGORIES[type];
    if (cat) { commercialScore += cat.weight * count; totalPOIs += count; }
    if (['marketplace','bus_station','supermarket','mall'].includes(type)) footfallScore += count * 15;
    if (['bank','fast_food','fuel'].includes(type)) footfallScore += count * 8;
    if (['restaurant','cafe','pharmacy'].includes(type)) footfallScore += count * 4;
    if (['college','university','cinema','gym','cafe','bar'].includes(type)) youthScore += count * 10;
    if (['fast_food','school'].includes(type)) youthScore += count * 5;
    if (['hotel','mall','department_store','office'].includes(type)) premiumScore += count * 12;
    if (['bank','hospital'].includes(type)) premiumScore += count * 6;
  }

  return {
    commercial: Math.min(100, Math.round(commercialScore / 2)),
    footfall:   Math.min(100, Math.round(footfallScore)),
    youth:      Math.min(100, Math.round(youthScore)),
    premium:    Math.min(100, Math.round(premiumScore)),
    totalPOIs,
  };
}

function estimateImpressions(scores) {
  let base = 5000;
  base += scores.footfall * 500;
  base += scores.commercial * 200;
  return Math.round(base / 1000) * 1000;
}

function classifyArea(scores, counts) {
  const hasUniversities = (counts.university || 0) > 0;
  const hasMalls = (counts.mall || 0) + (counts.supermarket || 0) > 0;
  const hasOffices = (counts.office || 0) > 2;
  const hasBusStations = (counts.bus_station || 0) > 0;
  const noOSM = Object.keys(counts).length === 0; // using keyword estimate

  // Premium CBD: OSM offices OR high premium score (keyword-derived)
  if (scores.premium > 60 && (hasOffices || noOSM)) return { type: 'Commercial CBD',    icon: '🏢', description: 'High-income professionals, corporate decision-makers' };
  if (scores.premium > 50 && hasOffices)             return { type: 'Commercial CBD',    icon: '🏢', description: 'High-income professionals, corporate decision-makers' };
  if (hasUniversities || (noOSM && scores.youth > 65)) return { type: 'University Zone', icon: '🎓', description: 'Students, young professionals, tech-forward audience' };
  if (hasMalls || scores.commercial > 60)            return { type: 'Retail Hub',        icon: '🛒', description: 'Active shoppers, families, high purchase intent' };
  if (hasBusStations || scores.footfall > 75)        return { type: 'Transit Corridor',  icon: '🚌', description: 'Mass commuters, high daily impressions, mixed demographics' };
  if (scores.youth > 55)                             return { type: 'Youth Cluster',      icon: '👥', description: 'Gen Z & Millennial dominant, entertainment & lifestyle brands' };
  if (scores.footfall > 50)                          return { type: 'Transit Corridor',  icon: '🚌', description: 'Mass commuters, high daily impressions, mixed demographics' };
  if (scores.premium > 40)                           return { type: 'Upscale Residential',icon: '🏘️', description: 'Affluent homeowners, luxury brand receptive' };
  if (scores.commercial > 30)                        return { type: 'Mixed Commercial',   icon: '🏪', description: 'Diverse audience, broad brand appeal' };
  return                                                    { type: 'Residential',         icon: '🏠', description: 'Local community, FMCG and essential services brands' };
}

function getTopPOIs(counts) {
  return Object.entries(counts)
    .filter(([type]) => AMENITY_CATEGORIES[type])
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([type, count]) => ({
      label: AMENITY_CATEGORIES[type].label,
      icon:  AMENITY_CATEGORIES[type].icon,
      count,
    }));
}

function getVerticals(scores, areaType) {
  const v = [];
  if (scores.premium > 40)  v.push('Banking & Finance', 'Automotive', 'Real Estate');
  if (scores.youth > 40)    v.push('Telecom', 'Fashion', 'Entertainment', 'Beverages');
  if (scores.footfall > 40) v.push('FMCG', 'Fast Food', 'Retail');
  if (areaType.includes('Transit'))    v.push('Transport & Logistics', 'Mobile Money');
  if (areaType.includes('University')) v.push('Education Tech', 'Financial Services', 'Lifestyle');
  if (areaType.includes('Commercial')) v.push('B2B Services', 'Professional Services');
  return [...new Set(v)].slice(0, 5);
}

async function fetchOverpass(lat, lng) {
  const mirrors = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://overpass.openstreetmap.fr/api/interpreter',
  ];

  const query = `
    [out:json][timeout:10];
    (
      node[amenity](around:800,${lat},${lng});
      node[shop](around:800,${lat},${lng});
      node[building~"commercial|office|retail"](around:800,${lat},${lng});
    );
    out body 100;
  `.trim();

  for (const mirror of mirrors) {
    try {
      const res = await fetch(mirror, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(12000),
      });
      if (!res.ok) continue;
      const text = await res.text();
      if (!text.startsWith('{')) continue; // HTML error page
      const json = JSON.parse(text);
      if ((json.elements || []).length > 0) return json.elements;
    } catch {
      // try next mirror
    }
  }
  return [];
}

// ─── Keyword-based heuristic scoring for Nigeria OOH (used when OSM data unavailable) ─

const FOOTFALL_KEYWORDS  = ['toll gate','toll','bridge','junction','roundabout','interchange','axis','corridor','bus stop','terminal','station','airport','motorway','expressway','highway','flyover','ring road','overhead','underpass'];
const TRANSIT_KEYWORDS   = ['bridge','toll','flyover','overhead','bus terminal','motor park','park','junction','axis'];
const YOUTH_KEYWORDS     = ['university','polytechnic','college','campus','youth','student','ikeja','yaba','surulere','agege','ogba'];
const PREMIUM_KEYWORDS   = ['victoria island','v.i','vi ','ikoyi','lekki phase 1','maitama','asokoro','jabi','wuse ii','banana island','eko atlantic','oniru','parkview'];
const COMMERCIAL_KEYWORDS= ['market','mall','plaza','shopping','centre','center','cbd','business district','commercial','bank','wuse','ikeja gra','maryland'];

const CITY_PROFILES = {
  lagos:         { commercial: 55, footfall: 60, youth: 50, premium: 45 },
  abuja:         { commercial: 50, footfall: 45, youth: 40, premium: 60 },
  'port harcourt':{ commercial: 45, footfall: 50, youth: 42, premium: 40 },
  kano:          { commercial: 50, footfall: 55, youth: 38, premium: 30 },
  ibadan:        { commercial: 42, footfall: 50, youth: 45, premium: 28 },
};

function keywordScore(text) {
  const t = text.toLowerCase();

  const hit = (keywords) => keywords.filter(k => t.includes(k)).length;

  const footfallHits   = hit(FOOTFALL_KEYWORDS)  + hit(TRANSIT_KEYWORDS);
  const youthHits      = hit(YOUTH_KEYWORDS);
  const premiumHits    = hit(PREMIUM_KEYWORDS);
  const commercialHits = hit(COMMERCIAL_KEYWORDS) + hit(FOOTFALL_KEYWORDS);

  return {
    footfallBonus:   Math.min(40, footfallHits * 18),
    youthBonus:      Math.min(35, youthHits * 20),
    premiumBonus:    Math.min(40, premiumHits * 22),
    commercialBonus: Math.min(35, commercialHits * 12),
    impressionsMult: footfallHits > 0 ? 1 + (footfallHits * 0.4) : 1,
  };
}

function smartEstimate(board) {
  const city = (board.city || board.state || '').toLowerCase();
  const searchText = `${board.name} ${board.address || ''} ${city}`;
  const cityBase = CITY_PROFILES[city] || { commercial: 40, footfall: 40, youth: 35, premium: 30 };
  const kw = keywordScore(searchText);

  const scores = {
    commercial: Math.min(100, cityBase.commercial + kw.commercialBonus),
    footfall:   Math.min(100, cityBase.footfall   + kw.footfallBonus),
    youth:      Math.min(100, cityBase.youth       + kw.youthBonus),
    premium:    Math.min(100, cityBase.premium     + kw.premiumBonus),
    totalPOIs:  0,
  };

  let impressions = 5000 + scores.footfall * 500 + scores.commercial * 200;
  impressions = Math.round(impressions * kw.impressionsMult / 1000) * 1000;

  return { scores, impressions };
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  console.log('🔍  Fetching boards from Supabase…');

  const { data: boards, error } = await supabase
    .from('boards')
    .select('id, name, address, city, state, latitude, longitude')
    .not('latitude', 'is', null)
    .not('longitude', 'is', null);

  if (error) {
    console.error('❌  Failed to fetch boards:', error.message);
    process.exit(1);
  }

  console.log(`📍  Found ${boards.length} boards with GPS coordinates\n`);

  let success = 0, failed = 0, estimated = 0;

  for (let i = 0; i < boards.length; i++) {
    const board = boards[i];
    const prefix = `[${i + 1}/${boards.length}]`;

    process.stdout.write(`${prefix}  ${board.name.slice(0, 40).padEnd(40)} `);

    const elements = await fetchOverpass(board.latitude, board.longitude);
    let scores, impressions, dataSource;
    let counts = {};

    if (elements.length > 0) {
      counts = countByCategory(elements);
      scores = scoreLocation(counts);
      impressions = estimateImpressions(scores);
      dataSource = 'live';
    } else {
      // OSM data unavailable — use keyword heuristics from board name/address/city
      const est = smartEstimate(board);
      scores = est.scores;
      impressions = est.impressions;
      dataSource = 'estimated';
    }

    const area = classifyArea(scores, counts);
    const topPOIs = getTopPOIs(counts);
    const verticals = getVerticals(scores, area.type);

    if (dataSource === 'estimated') estimated++;

    const { error: upsertErr } = await supabase
      .from('board_audience_profiles')
      .upsert({
        board_id:         board.id,
        area_type:        area.type,
        area_icon:        area.icon,
        area_description: area.description,
        commercial_score: scores.commercial,
        footfall_score:   scores.footfall,
        youth_score:      scores.youth,
        premium_score:    scores.premium,
        daily_impressions: impressions,
        top_pois:         topPOIs,
        verticals,
        total_pois:       scores.totalPOIs,
        ai_insight:       null,
        data_source:      dataSource,
        enriched_at:      new Date().toISOString(),
      }, { onConflict: 'board_id' });

    if (upsertErr) {
      console.log(`❌  ${upsertErr.message}`);
      failed++;
    } else {
      console.log(`✓  ${area.icon} ${area.type.padEnd(20)} footfall:${String(scores.footfall).padStart(3)}  youth:${String(scores.youth).padStart(3)}  impressions:${String(Math.round(impressions/1000)).padStart(4)}K  [${dataSource}]`);
      success++;
    }

    // Respect Overpass rate limits — 500ms between requests
    if (i < boards.length - 1) await sleep(500);
  }

  console.log('\n─────────────────────────────────────────────────');
  console.log(`✅  Done. ${success} enriched  |  ${estimated} estimated (no OSM data)  |  ${failed} failed`);
  console.log('─────────────────────────────────────────────────');
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
