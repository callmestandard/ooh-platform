import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { createClient } from '@supabase/supabase-js';
import { requireAuth, unauthorized } from '@/lib/require-auth';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

type RawRow = {
  board_name:     string;
  city:           string;
  state:          string;
  format:         string;
  start_date:     string;
  end_date:       string;
  offered_rate:   number | null;
  notes:          string;
  media_partner?: string;
};

type MatchedRow = RawRow & {
  row_index:    number;
  board_id:     string | null;
  matched_name: string | null;
  matched_city: string | null;
  confidence:   'exact' | 'fuzzy' | 'none';
};

type DBBoard = {
  id:          string;
  name:        string;
  city:        string;
  state:       string | null;
  format:      string | null;
  asking_rate: number | null;
  status:      string;
  latitude:    number | null;
  longitude:   number | null;
};

function normalise(s: string): string {
  return (s || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function similarity(a: string, b: string): number {
  const na = normalise(a);
  const nb = normalise(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const ta = new Set(na.split(' '));
  const tb = new Set(nb.split(' '));
  const intersection = [...ta].filter(t => tb.has(t)).length;
  const union = new Set([...ta, ...tb]).size;
  return intersection / union;
}

function parseDate(raw: unknown): string {
  if (!raw) return '';
  if (typeof raw === 'number') {
    const d = XLSX.SSF.parse_date_code(raw);
    if (d) {
      const mm = String(d.m).padStart(2, '0');
      const dd = String(d.d).padStart(2, '0');
      return `${d.y}-${mm}-${dd}`;
    }
  }
  const s = String(raw).trim();
  const dmy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2,'0')}-${dmy[1].padStart(2,'0')}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return '';
}

function parseRate(raw: unknown): number | null {
  if (!raw) return null;
  const n = Number(String(raw).replace(/[₦,\s]/g, ''));
  return isNaN(n) || n <= 0 ? null : n;
}

// Map board format labels from this template to our system's format keys
function normaliseFormat(raw: string): string {
  const r = (raw || '').toLowerCase().trim();
  if (r === 'dooh' || r === 'led' || r === 'digital' || r.includes('digital')) return 'digital';
  if (r.includes('unipole'))     return 'unipole';
  if (r.includes('gantry'))      return 'gantry';
  if (r.includes('bridge'))      return 'bridge_panel';
  if (r.includes('wall'))        return 'wall_drape';
  if (r.includes('billboard'))   return 'billboard';
  return r.replace(/\s+/g, '_') || 'billboard';
}

// ─── Detect & parse the standard OOH Agency Media Plan template ──────────────
// This is the format used by agencies: multi-row header block at the top,
// data rows identified by a numeric SN in column index 1.
// Key column positions (0-indexed):
//   [1]  SN (numeric → data row)
//   [2]  Region
//   [3]  State
//   [5]  City / Area
//   [8]  Board Format (DOOH, Static LED, etc.)
//   [11] Media Partner's Name
//   [13] Location / Routes / Description  ← used as board_name for matching
//   [37] Start Date (Excel serial)
//   [38] End Date   (Excel serial)
//   [45] Negotiated Monthly Rental Cost
function tryParseOohTemplate(arrayRows: unknown[][]): RawRow[] | null {
  // Check if any row looks like the SN header row
  const hasSnHeader = arrayRows.some(row => {
    const c1 = normalise(String(row[1] ?? ''));
    return c1 === 'sn' || c1 === 'no' || c1 === 's n';
  });

  // Check if any row has a numeric SN with text in the key positions
  const hasDataRow = arrayRows.some(row =>
    typeof row[1] === 'number' && row[1] > 0 &&
    typeof row[3] === 'string' && row[3].length > 0 &&
    typeof row[13] === 'string' && row[13].length > 0
  );

  if (!hasSnHeader && !hasDataRow) return null;

  const results: RawRow[] = [];

  for (const row of arrayRows) {
    const sn = row[1];
    if (typeof sn !== 'number' || sn <= 0) continue;

    const state       = String(row[3]  || '').trim();
    const city        = String(row[5]  || '').trim();
    const boardFormat = String(row[8]  || '').trim();
    const mediaPartner = String(row[11] || '').trim();
    const description  = String(row[13] || '').trim();

    if (!description && !mediaPartner) continue;

    // Compose a board_name for matching: prefer description, fall back to partner
    const boardName = description || mediaPartner;

    const startDate = parseDate(row[37]);
    const endDate   = parseDate(row[38]);
    const rate      = parseRate(row[45]);   // negotiated monthly rental

    results.push({
      board_name:   boardName,
      city,
      state,
      format:       normaliseFormat(boardFormat),
      start_date:   startDate,
      end_date:     endDate,
      offered_rate: rate,
      notes:        mediaPartner ? `Media partner: ${mediaPartner}` : '',
      media_partner: mediaPartner || undefined,
    });
  }

  return results.length > 0 ? results : null;
}

export async function POST(req: NextRequest) {
  const user = await requireAuth(req);
  if (!user) return unauthorized();
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    if (!file) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });

    const arrayBuffer = await file.arrayBuffer();
    const wb = XLSX.read(arrayBuffer, { type: 'buffer', cellDates: false });

    const sheetName = wb.SheetNames.find(n => /media.?plan/i.test(n)) || wb.SheetNames[0];
    const ws = wb.Sheets[sheetName];

    // First try the OOH agency template (positional column format)
    const arrayRows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '' }) as unknown[][];
    let parsed = tryParseOohTemplate(arrayRows);

    if (!parsed) {
      // Fall back to header-based parsing for custom/simple templates
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });

      if (rows.length === 0) {
        return NextResponse.json({ error: 'The sheet appears to be empty' }, { status: 400 });
      }

      function col(row: Record<string, unknown>, ...keys: string[]): string {
        for (const key of keys) {
          for (const [k, v] of Object.entries(row)) {
            if (normalise(k).includes(normalise(key))) return String(v || '').trim();
          }
        }
        return '';
      }

      parsed = rows.map(row => ({
        board_name:   col(row, 'board name', 'board', 'name'),
        city:         col(row, 'city'),
        state:        col(row, 'state'),
        format:       col(row, 'format').toLowerCase().replace(/\s+/g, '_'),
        start_date:   parseDate(
          rows[0]['Start Date'] !== undefined
            ? row['Start Date']
            : Object.values(row).find((_, i) => i === 4)
        ) || parseDate(col(row, 'start')),
        end_date:     parseDate(
          rows[0]['End Date'] !== undefined
            ? row['End Date']
            : Object.values(row).find((_, i) => i === 5)
        ) || parseDate(col(row, 'end')),
        offered_rate: parseRate(col(row, 'rate', 'offered rate', 'rate naira')),
        notes:        col(row, 'notes', 'note', 'instruction'),
      })).filter(r => r.board_name.length > 0);
    }

    if (!parsed || parsed.length === 0) {
      return NextResponse.json({ error: 'No valid rows found. Check your column headers match the template.' }, { status: 400 });
    }

    // Fetch all boards for matching
    const { data: dbBoards } = await supabaseAdmin
      .from('boards')
      .select('id, name, city, state, format, asking_rate, status, latitude, longitude')
      .in('status', ['available', 'booked']);

    const boards: DBBoard[] = (dbBoards as DBBoard[]) || [];

    const matched: MatchedRow[] = parsed.map((row, idx) => {
      const exactMatch = boards.find(b =>
        normalise(b.name) === normalise(row.board_name) &&
        normalise(b.city) === normalise(row.city)
      );
      if (exactMatch) {
        return { ...row, row_index: idx, board_id: exactMatch.id, matched_name: exactMatch.name, matched_city: exactMatch.city, confidence: 'exact' };
      }

      const nameOnly = boards.find(b => normalise(b.name) === normalise(row.board_name));
      if (nameOnly) {
        return { ...row, row_index: idx, board_id: nameOnly.id, matched_name: nameOnly.name, matched_city: nameOnly.city, confidence: 'exact' };
      }

      // Fuzzy: score by description similarity + city/state bonus
      const scored = boards.map(b => {
        const nameSim   = similarity(row.board_name, b.name);
        const cityBonus  = normalise(b.city)  === normalise(row.city)  ? 0.20 : 0;
        const stateBonus = normalise(b.state || '') === normalise(row.state) ? 0.10 : 0;
        // Also score against media_partner name if present
        const partnerSim = row.media_partner
          ? similarity(row.media_partner, b.name) * 0.5
          : 0;
        return { board: b, score: Math.max(nameSim, partnerSim) + cityBonus + stateBonus };
      }).sort((a, b) => b.score - a.score);

      if (scored.length > 0 && scored[0].score >= 0.30) {
        const best = scored[0].board;
        return { ...row, row_index: idx, board_id: best.id, matched_name: best.name, matched_city: best.city, confidence: 'fuzzy' };
      }

      return { ...row, row_index: idx, board_id: null, matched_name: null, matched_city: null, confidence: 'none' };
    });

    const exactCount = matched.filter(r => r.confidence === 'exact').length;
    const fuzzyCount = matched.filter(r => r.confidence === 'fuzzy').length;
    const noneCount  = matched.filter(r => r.confidence === 'none').length;

    return NextResponse.json({
      rows: matched,
      summary: { total: matched.length, exact: exactCount, fuzzy: fuzzyCount, unmatched: noneCount },
    });
  } catch (err) {
    console.error('[import-plan]', err);
    return NextResponse.json({ error: 'Failed to parse file. Make sure you are uploading a valid .xlsx file.' }, { status: 500 });
  }
}
