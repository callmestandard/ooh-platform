'use client';

import { useEffect, useState } from 'react';
import { compact, loadAllIntel, type BoardIntel, type PlaceCategory } from '@/lib/intel';
import { verificationOf, VERIFICATION_META } from '@/lib/board-verification';
import { boardFormatLabel } from '@/lib/board-formats';

export type CompareBoard = {
  id: string; name: string; format: string | null; width: number | null; height: number | null;
  verification_status: string | null; latitude: number | null; longitude: number | null;
};

type Row = { label: string; get: (i: BoardIntel | undefined, b: CompareBoard) => number | string | null; best?: boolean; group?: string };

const place = (c: PlaceCategory, r: '500m' | '1km') => (i: BoardIntel | undefined) => {
  const p = r === '500m' ? i?.places_500m : i?.places_1km;
  return p == null ? null : p[c] ?? 0;
};

const ROWS: Row[] = [
  { group: 'Board', label: 'Format', get: (_, b) => (b.format ? boardFormatLabel(b.format) : null) },
  { label: 'Size', get: (_, b) => (b.width && b.height ? `${b.width}m × ${b.height}m` : null) },
  { label: 'Verified', get: (_, b) => (verificationOf(b) === 'pending' ? 'Not yet' : VERIFICATION_META[verificationOf(b)].label) },
  { group: 'Estimated residents', label: 'Within 500 m', get: i => i?.pop_500m ?? null, best: true },
  { label: 'Within 1 km', get: i => i?.pop_1km ?? null, best: true },
  { label: 'Within 2 km', get: i => i?.pop_2km ?? null, best: true },
  { group: 'Mapped places within 1 km', label: 'Malls', get: place('mall', '1km'), best: true },
  { label: 'Banks', get: place('bank', '1km'), best: true },
  { label: 'Places to eat', get: place('restaurant', '1km'), best: true },
  { label: 'Hotels', get: place('hotel', '1km'), best: true },
  { label: 'Offices', get: place('office', '1km'), best: true },
  { group: 'Traffic', label: 'Traffic level', get: i => i?.traffic_level?.replace('_', ' ') ?? null },
];

/** Shortlisted boards side by side: board facts, residents nearby, mapped places. */
export default function CompareBoards({ boards }: { boards: CompareBoard[] }) {
  const [intel, setIntel] = useState<Map<string, BoardIntel> | null>(null);
  useEffect(() => { loadAllIntel().then(setIntel); }, []);

  return (
    <div className="cb" data-compare>
      <style>{CSS}</style>
      <div className="cb-scroll">
        <table>
          <thead>
            <tr>
              <th scope="col" className="cb-corner"><span className="cb-sr">Measure</span></th>
              {boards.map(b => <th key={b.id} scope="col"><a href={`/boards/${b.id}`}>{b.name}</a></th>)}
            </tr>
          </thead>
          <tbody>
            {ROWS.map(r => {
              const vals = boards.map(b => (intel ? r.get(intel.get(b.id), b) : r.get(undefined, b)));
              const nums = vals.filter((v): v is number => typeof v === 'number');
              const top = r.best && nums.length > 1 ? Math.max(...nums) : null;
              return [
                r.group ? <tr key={`${r.label}-g`} className="cb-group"><th colSpan={boards.length + 1} scope="colgroup">{r.group}</th></tr> : null,
                <tr key={r.label}>
                  <th scope="row">{r.label}</th>
                  {vals.map((v, k) => (
                    <td key={boards[k].id} className={top != null && v === top && top > 0 ? 'cb-best' : undefined}>
                      {v == null ? <span className="cb-na">{intel || !r.best ? '—' : '…'}</span> : typeof v === 'number' ? (r.label.startsWith('Within') ? compact(v) : v) : <span style={{ textTransform: r.group === 'Traffic' ? 'capitalize' : undefined }}>{v}</span>}
                    </td>
                  ))}
                </tr>,
              ];
            })}
          </tbody>
        </table>
      </div>
      <p className="cb-note">Residents: WorldPop 2020 estimate of people living nearby, not traffic. Places: OpenStreetMap, may be incomplete. — means not available. Traffic data is not connected yet.</p>
    </div>
  );
}

const CSS = `
.cb { border: 1px solid #E2E8F0; border-radius: 16px; background: #fff; margin-bottom: 16px; overflow: hidden; }
.cb-scroll { overflow-x: auto; }
.cb table { border-collapse: collapse; width: 100%; min-width: 520px; font-size: .8125rem; }
.cb th, .cb td { padding: 8px 12px; text-align: right; border-bottom: 1px solid #F1F5F9; white-space: nowrap; }
.cb thead th { position: sticky; top: 0; background: #fff; font-weight: 700; color: #0F172A; vertical-align: bottom; white-space: normal; min-width: 120px; max-width: 180px; }
.cb thead th a { color: inherit; text-decoration: none; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.cb thead th a:hover { color: #1B4F8A; }
.cb tbody th { text-align: left; font-weight: 500; color: #475569; position: sticky; left: 0; background: #fff; }
.cb-corner { left: 0; z-index: 1; }
.cb td { font-variant-numeric: tabular-nums; color: #0F172A; font-weight: 500; }
.cb-best { font-weight: 800 !important; }
.cb-group th { text-align: left !important; font-size: .6875rem; font-weight: 700 !important; color: #94A3B8 !important; text-transform: uppercase; letter-spacing: .06em; padding-top: 14px; background: #fff; }
.cb-na { color: #CBD5E1; }
.cb-note { margin: 0; padding: 10px 14px; font-size: .6875rem; color: #64748B; background: #F8FAFC; line-height: 1.5; }
.cb-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
`;
