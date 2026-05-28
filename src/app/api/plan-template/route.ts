import { NextResponse } from 'next/server';
import * as XLSX from 'xlsx';

export async function GET() {
  const wb = XLSX.utils.book_new();

  // ── Instructions sheet ──────────────────────────────────────────────────
  const instructions = [
    ['OOH Platform — Media Plan Import Template'],
    [''],
    ['HOW TO USE THIS TEMPLATE:'],
    ['1. Fill in the "Media Plan" sheet with your board details'],
    ['2. Each row = one board in your plan'],
    ['3. Board Name + City are used to match boards in the system'],
    ['4. Save as .xlsx and upload in the Campaign Planner'],
    [''],
    ['COLUMN GUIDE:'],
    ['Board Name*',     'Required. The name of the billboard/board as listed in the system'],
    ['City*',           'Required. City where the board is located (e.g. Lagos, Abuja)'],
    ['State',           'Optional. State (e.g. Lagos State, FCT)'],
    ['Format',          'Optional. billboard, unipole, gantry, bridge_panel, wall_drape'],
    ['Start Date*',     'Required. Format: DD/MM/YYYY or YYYY-MM-DD'],
    ['End Date*',       'Required. Format: DD/MM/YYYY or YYYY-MM-DD'],
    ['Offered Rate (₦)','Optional. Monthly rate you are offering (number only, no ₦ symbol)'],
    ['Notes',           'Optional. Any special instructions for this board'],
    [''],
    ['* = required field'],
  ];
  const wsInstr = XLSX.utils.aoa_to_sheet(instructions);
  wsInstr['!cols'] = [{ wch: 22 }, { wch: 65 }];
  XLSX.utils.book_append_sheet(wb, wsInstr, 'Instructions');

  // ── Media Plan sheet ────────────────────────────────────────────────────
  const headers = ['Board Name', 'City', 'State', 'Format', 'Start Date', 'End Date', 'Offered Rate (₦)', 'Notes'];
  const examples = [
    ['Lekki-Epe Expressway Unipole', 'Lagos', 'Lagos State', 'unipole', '01/07/2026', '31/08/2026', '450000', 'Near Chevron roundabout'],
    ['Airport Road Gantry', 'Lagos', 'Lagos State', 'gantry', '01/07/2026', '31/08/2026', '600000', ''],
    ['Wuse II Billboard', 'Abuja', 'FCT', 'billboard', '01/07/2026', '31/08/2026', '350000', ''],
  ];

  const wsData = [headers, ...examples];
  const ws = XLSX.utils.aoa_to_sheet(wsData);

  // Column widths
  ws['!cols'] = [
    { wch: 34 }, // Board Name
    { wch: 16 }, // City
    { wch: 16 }, // State
    { wch: 14 }, // Format
    { wch: 14 }, // Start Date
    { wch: 14 }, // End Date
    { wch: 18 }, // Rate
    { wch: 36 }, // Notes
  ];

  // Header row style hint (xlsx doesn't support full styling without xlsx-style, just freeze header)
  ws['!freeze'] = { xSplit: 0, ySplit: 1 };

  XLSX.utils.book_append_sheet(wb, ws, 'Media Plan');

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  return new NextResponse(buf, {
    status: 200,
    headers: {
      'Content-Type':        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="ooh-platform-media-plan-template.xlsx"',
      'Content-Length':      buf.length.toString(),
    },
  });
}
