import { NextResponse } from 'next/server';
import * as XLSX from 'xlsx';

export async function GET() {
  const wb = XLSX.utils.book_new();

  const instructions: (string | number | null)[][] = [
    ['OOH Platform — Bulk Board Import Template'],
    [null],
    ['HOW TO USE:'],
    ['1. Fill in the "Boards" sheet — each row = one board'],
    ['2. Columns marked * are required'],
    ['3. Save as .xlsx or .csv and upload in the Board Importer'],
    [null],
    ['COLUMN GUIDE:', null],
    ['Name*', 'Board name — be descriptive (e.g. "Lekki Phase 1 Unipole, Chevron Roundabout")'],
    ['Address', 'Street address or landmark description'],
    ['City*', 'City (e.g. Lagos, Abuja, Port Harcourt, Kano)'],
    ['State', 'State (e.g. Lagos State, FCT, Rivers State)'],
    ['Format*', 'One of: billboard, unipole, gantry, bridge_panel, wall_drape, led'],
    ['Width (m)', 'Face width in metres — numeric only (e.g. 6)'],
    ['Height (m)', 'Face height in metres — numeric only (e.g. 3)'],
    ['Rate (₦)*', 'Monthly asking rate — number only, e.g. 850000 or 1.2M or 850k'],
    ['Latitude', 'GPS latitude — optional, we geocode from address if missing'],
    ['Longitude', 'GPS longitude — optional'],
    ['Notes', 'Notes visible to agencies browsing your board'],
    [null],
    ['* = required field'],
    [null],
    ['FORMAT VALUES (copy exactly):'],
    ['billboard', 'Classic roadside billboard'],
    ['unipole', 'Single-pole, high-visibility'],
    ['gantry', 'Spans across roadway'],
    ['bridge_panel', 'Mounted on bridge or flyover'],
    ['wall_drape', 'Building facade / wall banner'],
    ['led', 'Digital LED / DOOH display'],
  ];

  const wsInstr = XLSX.utils.aoa_to_sheet(instructions);
  wsInstr['!cols'] = [{ wch: 18 }, { wch: 72 }];
  XLSX.utils.book_append_sheet(wb, wsInstr, 'Instructions');

  const headers = ['Name', 'Address', 'City', 'State', 'Format', 'Width (m)', 'Height (m)', 'Rate (₦)', 'Latitude', 'Longitude', 'Notes'];
  const examples = [
    ['Lekki-Epe Expressway Unipole', 'Chevron Roundabout, Lekki Phase 1', 'Lagos', 'Lagos State', 'unipole', 4, 3, 850000, '', '', 'Illuminated, high traffic volume'],
    ['Wuse II Billboard', 'Plot 12, Adetokunbo Ademola Crescent, Wuse II', 'Abuja', 'FCT', 'billboard', 6, 3, 1200000, '', '', ''],
    ['Airport Road Gantry', 'Muritala Muhammed Airport Road, Ikeja', 'Lagos', 'Lagos State', 'gantry', 12, 3, 1800000, 6.5775, 3.3212, 'Both-sided face'],
    ['Trans Amadi LED', 'Trans Amadi Industrial Layout, PH', 'Port Harcourt', 'Rivers State', 'led', 4, 3, 600000, '', '', 'Digital, 24h illuminated'],
  ];

  const ws = XLSX.utils.aoa_to_sheet([headers, ...examples]);
  ws['!cols'] = [
    { wch: 38 }, { wch: 38 }, { wch: 16 }, { wch: 16 },
    { wch: 14 }, { wch: 10 }, { wch: 10 }, { wch: 14 },
    { wch: 12 }, { wch: 12 }, { wch: 32 },
  ];
  ws['!freeze'] = { xSplit: 0, ySplit: 1 };
  XLSX.utils.book_append_sheet(wb, ws, 'Boards');

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  return new NextResponse(buf, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="ooh-platform-board-import-template.xlsx"',
      'Content-Length': String(buf.length),
    },
  });
}
