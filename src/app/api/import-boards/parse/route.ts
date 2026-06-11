import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { requireAuth, unauthorized } from '@/lib/require-auth';

export const runtime = 'nodejs';

const MAX_ROWS = 1000;

export async function POST(req: NextRequest) {
  const user = await requireAuth(req);
  if (!user) return unauthorized();

  try {
    const form = await req.formData();
    const file = form.get('file') as File | null;
    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });

    const ext = file.name.split('.').pop()?.toLowerCase();
    if (!['xlsx', 'xls', 'csv'].includes(ext || '')) {
      return NextResponse.json({ error: 'Only .xlsx, .xls, or .csv files are supported' }, { status: 400 });
    }

    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'buffer', cellDates: false, sheetStubs: true });

    const sheetName = wb.SheetNames[0];
    const ws = wb.Sheets[sheetName];
    if (!ws) return NextResponse.json({ error: 'Workbook appears to be empty' }, { status: 400 });

    const allRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
      defval: '',
      raw: true,
      blankrows: false,
    });

    // Filter rows where all values are blank
    const rows = allRows
      .filter(row => Object.values(row).some(v => String(v ?? '').trim() !== ''))
      .slice(0, MAX_ROWS);

    if (rows.length === 0) {
      return NextResponse.json(
        { error: 'No data rows found. Ensure your file has column headers in row 1 and data below.' },
        { status: 400 },
      );
    }

    const headers = Object.keys(rows[0]);
    const totalBeforeTrunc = allRows.filter(row => Object.values(row).some(v => String(v ?? '').trim() !== '')).length;

    return NextResponse.json({
      headers,
      rows,
      total: rows.length,
      truncated: totalBeforeTrunc > MAX_ROWS,
    });
  } catch (err) {
    console.error('[import-boards/parse]', err);
    return NextResponse.json({ error: 'Failed to parse file. Ensure it is a valid .xlsx or .csv.' }, { status: 500 });
  }
}
