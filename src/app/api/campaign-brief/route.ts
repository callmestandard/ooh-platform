import { NextRequest, NextResponse } from 'next/server';

// Nigerian brands to recognise in briefs
const BRAND_PATTERNS: { match: string | RegExp; name: string }[] = [
  { match: /mtn/i,          name: 'MTN Nigeria' },
  { match: /airtel/i,       name: 'Airtel Nigeria' },
  { match: /glo/i,          name: 'Glo Mobile' },
  { match: /9mobile/i,      name: '9mobile' },
  { match: /dangote/i,      name: 'Dangote Group' },
  { match: /gtbank|gtco/i,  name: 'GTBank' },
  { match: /access bank/i,  name: 'Access Bank' },
  { match: /zenith/i,       name: 'Zenith Bank' },
  { match: /uba/i,          name: 'UBA' },
  { match: /first bank/i,   name: 'First Bank' },
  { match: /opay/i,         name: 'OPay' },
  { match: /kuda/i,         name: 'Kuda Bank' },
  { match: /flutterwave/i,  name: 'Flutterwave' },
  { match: /paystack/i,     name: 'Paystack' },
  { match: /jumia/i,        name: 'Jumia Nigeria' },
  { match: /konga/i,        name: 'Konga' },
  { match: /nestle/i,       name: 'Nestlé Nigeria' },
  { match: /unilever/i,     name: 'Unilever Nigeria' },
  { match: /guinness/i,     name: 'Guinness Nigeria' },
  { match: /nigerian breweries|nb plc/i, name: 'Nigerian Breweries' },
  { match: /total energies|totalenergies/i, name: 'TotalEnergies' },
  { match: /coca.?cola/i,   name: 'Coca-Cola Nigeria' },
  { match: /pepsi/i,        name: 'PepsiCo Nigeria' },
];

const NIGERIAN_CITIES = [
  'Lagos', 'Abuja', 'Port Harcourt', 'Kano', 'Ibadan',
  'Enugu', 'Warri', 'Kaduna', 'Benin City', 'Onitsha',
  'Aba', 'Jos', 'Ilorin', 'Uyo', 'Calabar', 'Maiduguri',
  'Abeokuta', 'Owerri', 'Asaba', 'Akure', 'Bauchi', 'Sokoto',
  'Victoria Island', 'Lekki', 'Ikeja', 'Surulere', 'Wuse', 'Maitama',
  'GRA', 'Trans Amadi',
];

// Month name → month index (0-based)
const MONTHS: Record<string, number> = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2,
  apr: 3, april: 3, may: 4, jun: 5, june: 5, jul: 6, july: 6,
  aug: 7, august: 7, sep: 8, september: 8, oct: 9, october: 9,
  nov: 10, november: 10, dec: 11, december: 11,
};

const OBJECTIVE_KEYWORDS: Record<string, string> = {
  awareness: 'awareness', brand: 'awareness', visibility: 'awareness', 'brand awareness': 'awareness',
  launch: 'launch', launching: 'launch', unveil: 'launch', introduce: 'launch', 'new product': 'launch',
  engagement: 'engagement', 'foot traffic': 'engagement', mall: 'engagement', experiential: 'engagement',
  conversion: 'conversion', sales: 'conversion', retail: 'conversion', purchase: 'conversion', 'drive sales': 'conversion',
};

export type ParsedBrief = {
  client_name: string;
  campaign_name: string;
  objective: 'awareness' | 'launch' | 'engagement' | 'conversion' | '';
  total_budget: number;
  start_date: string;
  end_date: string;
  cities: string[];
  formats: string[];
  notes: string;
  confidence: number;   // 0–100
  warnings: string[];
};

function extractBudget(text: string): number {
  // Match patterns like: ₦5M, ₦5 million, 5m, N5,000,000, 5 billion, etc.
  const patterns = [
    { re: /[₦N#]\s*([\d,\.]+)\s*b(?:illion)?/i, mult: 1_000_000_000 },
    { re: /[₦N#]\s*([\d,\.]+)\s*m(?:illion)?/i, mult: 1_000_000 },
    { re: /[₦N#]\s*([\d,\.]+)\s*k/i,             mult: 1_000 },
    { re: /[₦N#]\s*([\d,\.]+)/,                   mult: 1 },
    { re: /([\d,\.]+)\s*b(?:illion)?\s+naira/i,   mult: 1_000_000_000 },
    { re: /([\d,\.]+)\s*m(?:illion)?\s+naira/i,   mult: 1_000_000 },
    { re: /budget\s+(?:of\s+)?[₦N#]?\s*([\d,\.]+)\s*m/i, mult: 1_000_000 },
    { re: /budget\s+(?:of\s+)?[₦N#]?\s*([\d,\.]+)\s*k/i, mult: 1_000 },
    { re: /budget\s+(?:of\s+)?[₦N#]?\s*([\d,\.]+)/i,      mult: 1 },
  ];
  for (const { re, mult } of patterns) {
    const m = text.match(re);
    if (m) {
      const num = parseFloat(m[1].replace(/,/g, ''));
      if (!isNaN(num) && num > 0) return Math.round(num * mult);
    }
  }
  return 0;
}

function extractDates(text: string, today: Date): { start: string; end: string } {
  const year = today.getFullYear();
  let start = '';
  let end = '';

  // Duration patterns: "2 weeks", "30 days", "3 months"
  const durationMatch = text.match(/(\d+)\s*(day|week|month)s?/i);
  if (durationMatch) {
    const qty = parseInt(durationMatch[1]);
    const unit = durationMatch[2].toLowerCase();
    const startDate = new Date(today);
    startDate.setDate(startDate.getDate() + 3); // 3-day buffer
    const endDate = new Date(startDate);
    if (unit === 'day')   endDate.setDate(endDate.getDate() + qty);
    if (unit === 'week')  endDate.setDate(endDate.getDate() + qty * 7);
    if (unit === 'month') endDate.setMonth(endDate.getMonth() + qty);
    start = startDate.toISOString().slice(0, 10);
    end   = endDate.toISOString().slice(0, 10);
    return { start, end };
  }

  // "April to May", "from April to June", "April – May"
  const rangeMatch = text.match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b.*?\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i);
  if (rangeMatch) {
    const m1 = MONTHS[rangeMatch[1].toLowerCase().slice(0, 3)];
    const m2 = MONTHS[rangeMatch[2].toLowerCase().slice(0, 3)];
    if (m1 !== undefined && m2 !== undefined) {
      const sy = m1 < today.getMonth() ? year + 1 : year;
      const ey = m2 < m1 ? sy + 1 : sy;
      start = new Date(sy, m1, 1).toISOString().slice(0, 10);
      end   = new Date(ey, m2 + 1, 0).toISOString().slice(0, 10);
      return { start, end };
    }
  }

  // Single month: "in April", "during Ramadan/Q2 2026"
  const monthMatch = text.match(/\b(?:in|during|for)?\s*(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i);
  if (monthMatch) {
    const mo = MONTHS[monthMatch[1].toLowerCase().slice(0, 3)];
    if (mo !== undefined) {
      const sy = mo < today.getMonth() ? year + 1 : year;
      start = new Date(sy, mo, 1).toISOString().slice(0, 10);
      end   = new Date(sy, mo + 1, 0).toISOString().slice(0, 10);
      return { start, end };
    }
  }

  // Ramadan 2026 → approximate: late Feb to late March 2027 (shifts yearly)
  if (/ramadan/i.test(text)) {
    start = `${year}-03-01`;
    end   = `${year}-03-30`;
    return { start, end };
  }

  // Q1/Q2/Q3/Q4
  const qMatch = text.match(/Q([1-4])/i);
  if (qMatch) {
    const q = parseInt(qMatch[1]);
    const qStart = [0, 3, 6, 9][q - 1];
    const sy = qStart < today.getMonth() ? year + 1 : year;
    start = new Date(sy, qStart, 1).toISOString().slice(0, 10);
    end   = new Date(sy, qStart + 3, 0).toISOString().slice(0, 10);
    return { start, end };
  }

  return { start, end };
}

function extractCities(text: string): string[] {
  const found: string[] = [];
  for (const city of NIGERIAN_CITIES) {
    if (new RegExp(`\\b${city.replace(/\s+/g, '\\s+')}\\b`, 'i').test(text)) {
      found.push(city);
    }
  }
  // Dedup and prioritise tier-1
  const tier1 = ['Lagos', 'Abuja', 'Port Harcourt', 'Kano'];
  return [...new Set(found)].sort((a, b) => {
    const ai = tier1.indexOf(a);
    const bi = tier1.indexOf(b);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return 0;
  });
}

function extractObjective(text: string): 'awareness' | 'launch' | 'engagement' | 'conversion' | '' {
  const lower = text.toLowerCase();
  for (const [kw, obj] of Object.entries(OBJECTIVE_KEYWORDS)) {
    if (lower.includes(kw)) return obj as ParsedBrief['objective'];
  }
  return '';
}

function extractFormats(text: string): string[] {
  const lower = text.toLowerCase();
  const all = [
    { kw: ['billboard', 'billboards'], val: 'billboard' },
    { kw: ['unipole', 'unipoles'], val: 'unipole' },
    { kw: ['gantry', 'gantries', 'highway', 'expressway'], val: 'gantry' },
    { kw: ['bridge panel', 'bridge panels', 'bridge banner'], val: 'bridge_panel' },
    { kw: ['wall drape', 'wall drapes', 'building wrap', 'building drape'], val: 'wall_drape' },
    { kw: ['digital', 'led', 'digital board'], val: 'digital' },
    { kw: ['transit', 'bus shelter', 'bus stop'], val: 'transit' },
  ];
  const found: string[] = [];
  for (const { kw, val } of all) {
    if (kw.some(k => lower.includes(k))) found.push(val);
  }
  return found;
}

function extractClientName(text: string): string {
  for (const { match, name } of BRAND_PATTERNS) {
    if (typeof match === 'string' ? text.toLowerCase().includes(match) : match.test(text)) {
      return name;
    }
  }
  // Try: "for [CLIENT]", "campaign for [CLIENT]"
  const forMatch = text.match(/\bfor\s+([A-Z][A-Za-z\s&]+?)(?:\s+in\b|\s+campaign|\s+brand|\.|,|$)/);
  if (forMatch) return forMatch[1].trim();
  return '';
}

function buildCampaignName(brief: string, client: string, objective: string): string {
  const season = /ramadan/i.test(brief) ? 'Ramadan' : /christmas|xmas/i.test(brief) ? 'Christmas' : /easter/i.test(brief) ? 'Easter' : '';
  const yearMatch = brief.match(/\b(202\d)\b/);
  const year = yearMatch ? yearMatch[1] : new Date().getFullYear().toString();
  const objLabel: Record<string, string> = { awareness: 'Brand Campaign', launch: 'Product Launch', engagement: 'Engagement Drive', conversion: 'Sales Drive', '': 'Campaign' };
  const parts = [client || 'Campaign', season, objLabel[objective], year].filter(Boolean);
  return parts.join(' ');
}

export async function POST(req: NextRequest) {
  try {
    const { brief } = await req.json() as { brief: string };
    if (!brief || brief.trim().length < 10) {
      return NextResponse.json({ error: 'Brief is too short' }, { status: 400 });
    }

    const today = new Date();
    const warnings: string[] = [];
    let confidence = 60;

    const client_name = extractClientName(brief);
    const objective = extractObjective(brief);
    const total_budget = extractBudget(brief);
    const { start, end } = extractDates(brief, today);
    const cities = extractCities(brief);
    const formats = extractFormats(brief);
    const campaign_name = buildCampaignName(brief, client_name, objective);

    if (!client_name) { warnings.push('Could not identify a brand or client name — please fill in manually.'); } else { confidence += 10; }
    if (!objective)   { warnings.push('Campaign objective unclear — defaulting to Brand Awareness.'); } else { confidence += 10; }
    if (!total_budget){ warnings.push('No budget amount found — please enter your budget manually.'); } else { confidence += 10; }
    if (!start || !end){ warnings.push('Could not extract flight dates — please select them manually.'); } else { confidence += 10; }
    if (cities.length === 0) { warnings.push('No specific cities mentioned — Smart Suggest will use all available boards.'); } else { confidence += 5; }

    const result: ParsedBrief = {
      client_name,
      campaign_name,
      objective: objective || 'awareness',
      total_budget,
      start_date: start,
      end_date: end,
      cities,
      formats,
      notes: brief.trim(),
      confidence: Math.min(100, confidence),
      warnings,
    };

    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: 'Failed to parse brief' }, { status: 500 });
  }
}
