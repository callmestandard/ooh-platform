import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

type RawRow = {
  board_name:   string;
  city:         string;
  state:        string;
  format:       string;
  start_date:   string;
  end_date:     string;
  offered_rate: number | null;
  notes:        string;
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
  // Token overlap score
  const ta = new Set(na.split(' '));
  const tb = new Set(nb.split(' '));
  const intersection = [...ta].filter(t => tb.has(t)).length;
  const union = new Set([...ta, ...tb]).size;
  return intersection / union;
}

function parseDate(raw: unknown): string {
  if (!raw) return '';
  if (typeof raw === 'number') {
    // Excel serial date
    const d = XLSX.SSF.parse_date_code(raw);
    if (d) {
      const mm = String(d.m).padStart(2, '0');
      const dd = String(d.d).padStart(2, '0');
      return `${d.y}-${mm}-${dd}`;
    }
  }
  const s = String(raw).trim();
  // DD/MM/YYYY
  const dmy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2,'0')}-${dmy[1].padStart(2,'0')}`;
  // YYYY-MM-DD already
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // Try native parse
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return '';
}

function parseRate(raw: unknown): number | null {
  if (!raw) return null;
  const n = Number(String(raw).replace(/[₦,\s]/g, ''));
  return isNaN(n) || n <= 0 ? null : n;
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    if (!file) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });

    const arrayBuffer = await file.arrayBuffer();
    const wb = XLSX.read(arrayBuffer, { type: 'buffer', cellDates: false });

    // Find the "Media Plan" sheet, or use the first sheet
    const sheetName = wb.SheetNames.find(n => /media.?plan/i.test(n)) || wb.SheetNames[0];
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });

    if (rows.length === 0) {
      return NextResponse.json({ error: 'The sheet appears to be empty' }, { status: 400 });
    }

    // Normalise column names (case-insensitive, ignore symbols)
    function col(row: Record<string, unknown>, ...keys: string[]): string {
      for (const key of keys) {
        for (const [k, v] of Object.entries(row)) {
          if (normalise(k).includes(normalise(key))) return String(v || '').trim();
        }
      }
      return '';
    }

    const parsed: RawRow[] = rows.map(row => ({
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

    if (parsed.length === 0) {
      return NextResponse.json({ error: 'No valid rows found. Check your column headers match the template.' }, { status: 400 });
    }

    // Fetch all available boards from DB
    const { data: dbBoards } = await supabaseAdmin
      .from('boards')
      .select('id, name, city, state, format, asking_rate, status, latitude, longitude')
      .in('status', ['available', 'booked']);

    const boards: DBBoard[] = (dbBoards as DBBoard[]) || [];

    // Match each row to a board
    const matched: MatchedRow[] = parsed.map((row, idx) => {
      // 1. Exact name + city match
      const exactMatch = boards.find(b =>
        normalise(b.name) === normalise(row.board_name) &&
        normalise(b.city) === normalise(row.city)
      );
      if (exactMatch) {
        return { ...row, row_index: idx, board_id: exactMatch.id, matched_name: exactMatch.name, matched_city: exactMatch.city, confidence: 'exact' };
      }

      // 2. Exact name only
      const nameOnly = boards.find(b => normalise(b.name) === normalise(row.board_name));
      if (nameOnly) {
        return { ...row, row_index: idx, board_id: nameOnly.id, matched_name: nameOnly.name, matched_city: nameOnly.city, confidence: 'exact' };
      }

      // 3. Fuzzy match — score by name similarity + city bonus
      const scored = boards.map(b => {
        const nameSim  = similarity(row.board_name, b.name);
        const cityBonus = normalise(b.city) === normalise(row.city) ? 0.25 : 0;
        return { board: b, score: nameSim + cityBonus };
      }).sort((a, b) => b.score - a.score);

      if (scored.length > 0 && scored[0].score >= 0.35) {
        const best = scored[0].board;
        return { ...row, row_index: idx, board_id: best.id, matched_name: best.name, matched_city: best.city, confidence: 'fuzzy' };
      }

      // 4. No match
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
