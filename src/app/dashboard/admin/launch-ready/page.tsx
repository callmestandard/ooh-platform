'use client';

/**
 * Launch-ready (063): which boards are strong enough to sell first, and what
 * each one is missing. Nothing here changes a board or marks it verified:
 * it only reads the inventory and points at the fix.
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { useDashboardRole } from '@/components/layout/DashboardLayout';
import { withBoardPrivate } from '@/lib/board-private';

type Board = {
  id: string; name: string; address: string | null; city: string | null; area: string | null; format: string | null;
  status: string; owner_id: string | null; media_owner_id: string | null; verification_status: string | null;
  photo_urls: string[] | null; latitude: number | null; longitude: number | null; width: number | null; height: number | null;
  availability_checked_at: string | null; contact_phone?: string | null;
};
type OwnerRow = { id: string; name: string; status: string; link_state: string; contacts: { phone: string; email: string | null }[]; reminder_email: string | null };

type CheckKey = 'name' | 'pin' | 'photo' | 'size' | 'format' | 'place' | 'owner' | 'rate' | 'availability' | 'verified';
const CHECKS: { key: CheckKey; label: string; need: string; gap: string; fix: string }[] = [
  { key: 'name', label: 'Clear name', need: 'Clearer name', gap: 'unclear name', fix: 'The name is very short, just a city, or looks garbled from the import' },
  { key: 'pin', label: 'Map pin', need: 'Map pin', gap: 'pin missing or doubtful', fix: 'No pin, a pin outside Nigeria, or the same pin as another board' },
  { key: 'photo', label: 'Photo', need: 'Photo', gap: 'no photo', fix: 'No photo' },
  { key: 'size', label: 'Size', need: 'Size', gap: 'size missing or doubtful', fix: 'No width and height, or height bigger than width (check it)' },
  { key: 'format', label: 'Format', need: 'Format', gap: 'no format', fix: 'No format set' },
  { key: 'place', label: 'Area & address', need: 'Area & address', gap: 'thin area or address', fix: 'No area, or the address is too thin to find the board' },
  { key: 'owner', label: 'Reachable owner', need: 'Owner contact', gap: 'owner not reachable', fix: 'No owner, or no phone or email for them' },
  { key: 'rate', label: 'Current rate', need: 'Current rate', gap: 'no current rate', fix: 'No owner rate in the last 90 days, and no active owner link to ask for one' },
  { key: 'availability', label: 'Availability', need: 'Availability check', gap: 'availability not checked', fix: 'Not confirmed in 7 days, and no active owner link to confirm it' },
  { key: 'verified', label: 'Verified', need: 'Verification', gap: 'not verified', fix: 'Not verified by our team or the owner yet' },
];
const CITY_WORDS = new Set(['lagos', 'abuja', 'ibadan', 'akure', 'kano', 'port harcourt', 'enugu', 'benin', 'ikeja', 'lekki']);
const DAY = 86400000;

function nameOk(n: string | null) {
  const s = (n ?? '').trim();
  if (s.length < 6) return false;
  if (CITY_WORDS.has(s.toLowerCase())) return false;
  if (/[^\x20-\x7E–—’‘“”]/.test(s)) return false;
  if (/^(page|slide|img|image|untitled)\b/i.test(s) || /\bsince\s+(19|20)\d\d\b/i.test(s)) return false;
  return true;
}

export default function LaunchReadyPage() {
  const role = useDashboardRole();
  const [boards, setBoards] = useState<Board[] | null>(null);
  const [owners, setOwners] = useState<Record<string, OwnerRow>>({});
  const [rated, setRated] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [city, setCity] = useState<'Lagos' | 'all'>('Lagos');
  const [only, setOnly] = useState<CheckKey | null>(null);
  const [now] = useState(() => Date.now());

  useEffect(() => {
    if (role !== 'admin') return;
    (async () => {
      const [b, o, r] = await Promise.all([
        supabase.from('boards').select('id, name, address, city, area, format, status, owner_id, media_owner_id, verification_status, photo_urls, latitude, longitude, width, height, availability_checked_at').neq('status', 'decommissioned').limit(5000),
        supabase.rpc('admin_media_owners'),
        supabase.from('board_owner_rates').select('board_id, updated_at'),
      ]);
      if (b.error || o.error) {
        const m = (b.error ?? o.error)!.message;
        setError(/media_owner_id|admin_media_owners/.test(m) ? 'Run migration 063 in Supabase to switch this page on.' : m);
        setBoards([]);
        return;
      }
      setBoards(await withBoardPrivate((b.data ?? []) as Board[]));
      setOwners(Object.fromEntries(((o.data ?? []) as OwnerRow[]).map(x => [x.id, x])));
      setRated(new Set(((r.data ?? []) as { board_id: string; updated_at: string }[]).filter(x => Date.now() - +new Date(x.updated_at) < 90 * DAY).map(x => x.board_id)));
    })();
  }, [role]);

  const scored = useMemo(() => {
    const list = boards ?? [];
    const pinKey = (b: Board) => `${b.latitude?.toFixed(5)},${b.longitude?.toFixed(5)}`;
    const pinCount = new Map<string, number>();
    list.forEach(b => { if (b.latitude != null) pinCount.set(pinKey(b), (pinCount.get(pinKey(b)) ?? 0) + 1); });
    return list.map(b => {
      const o = b.media_owner_id ? owners[b.media_owner_id] : undefined;
      const linkOn = o?.link_state === 'active' && o.status !== 'suspended' && o.status !== 'rejected';
      const ok: Record<CheckKey, boolean> = {
        name: nameOk(b.name),
        pin: b.latitude != null && b.longitude != null && b.latitude >= 4 && b.latitude <= 14 && b.longitude >= 2.6 && b.longitude <= 14.8 && pinCount.get(pinKey(b)) === 1,
        photo: (b.photo_urls ?? []).length > 0,
        size: !!b.width && !!b.height && b.height <= b.width,
        format: !!b.format?.trim(),
        place: !!b.area?.trim() && (b.address ?? '').trim().length >= 10,
        owner: !!b.owner_id || (!!o && o.status !== 'rejected' && o.status !== 'suspended' && (!!b.contact_phone?.trim() || !!o.reminder_email || o.contacts.some(c => c.phone?.trim() || c.email))),
        rate: rated.has(b.id) || linkOn,
        availability: (!!b.availability_checked_at && now - +new Date(b.availability_checked_at) < 7 * DAY) || linkOn,
        verified: b.verification_status === 'verified' || b.verification_status === 'partner_verified',
      };
      const missing = CHECKS.filter(c => !ok[c.key]).map(c => c.key);
      return { b, ok, missing, score: CHECKS.length - missing.length, owner: o?.name ?? null };
    });
  }, [boards, owners, rated, now]);

  const inCity = scored.filter(x => city === 'all' || (x.b.city ?? '').toLowerCase() === 'lagos');
  const ranked = [...inCity].sort((a, b) => b.score - a.score || Number(b.ok.photo) - Number(a.ok.photo) || a.b.name.localeCompare(b.b.name));
  const top = (only ? ranked.filter(x => !x.ok[only]) : ranked).slice(0, 50);
  const ready = inCity.filter(x => x.missing.length === 0).length;
  const gaps = CHECKS.map(c => ({ ...c, n: inCity.filter(x => !x.ok[c.key]).length }));

  function downloadCsv() {
    const head = ['Board', 'City', 'Area', 'Owner', 'Score', ...CHECKS.map(c => c.label), 'Missing'];
    const rows = ranked.map(x => [x.b.name, x.b.city ?? '', x.b.area ?? '', x.owner ?? '', `${x.score}/${CHECKS.length}`,
      ...CHECKS.map(c => (x.ok[c.key] ? 'yes' : 'no')), x.missing.map(k => CHECKS.find(c => c.key === k)!.need).join('; ')]);
    const csv = [head, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `launch-ready-${city === 'all' ? 'all' : 'lagos'}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  if (role !== 'admin') return <div style={{ padding: 32, color: '#64748B', fontSize: '0.875rem' }}>Admins only.</div>;

  return (
    <div className="lr">
      <style>{CSS}</style>
      <div className="lr-top">
        <div>
          <h1 className="lr-h1">Launch-ready boards</h1>
          <p className="lr-sub">The 50 strongest boards to sell first, and what each one still needs. This page only reads the inventory: it never marks a board verified or fills anything in.</p>
        </div>
        <div className="lr-ctrl">
          <div className="lr-seg" role="tablist" aria-label="City">
            <button type="button" role="tab" aria-selected={city === 'Lagos'} className={city === 'Lagos' ? 'is-on' : ''} onClick={() => setCity('Lagos')}>Lagos</button>
            <button type="button" role="tab" aria-selected={city === 'all'} className={city === 'all' ? 'is-on' : ''} onClick={() => setCity('all')}>All cities</button>
          </div>
          <button type="button" className="lr-btn-2" onClick={downloadCsv} disabled={!ranked.length}>Download CSV</button>
        </div>
      </div>

      {error && <div className="lr-card lr-error">{error}</div>}

      {boards && !error && (
        <>
          <div className="lr-summary">
            <div className="lr-big"><strong>{ready}</strong><span>of {inCity.length} {city === 'all' ? '' : 'Lagos '}boards meet every check</span></div>
            <ul className="lr-gaps" aria-label="What is missing, by check">
              {gaps.map(g => (
                <li key={g.key}>
                  <button type="button" className={`${only === g.key ? 'is-on' : ''}${g.n === 0 ? ' is-done' : ''}`} onClick={() => setOnly(only === g.key ? null : g.key)} title={g.fix} disabled={g.n === 0}>
                    <b>{g.n}</b><span>{g.n === 0 ? `${g.label} ✓` : g.gap}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <div className="lr-card lr-table" data-launch-table>
            <div className="lr-row lr-head">
              <span>#</span><span>Board</span><span>Checks</span><span>Still needed</span>
            </div>
            {top.length === 0 && <div className="lr-row"><span /><span className="lr-muted">No boards.</span></div>}
            {top.map((x, i) => (
              <div key={x.b.id} className={`lr-row${x.missing.length === 0 ? ' is-ready' : ''}`} data-launch-row>
                <span className="lr-rank">{i + 1}</span>
                <span className="lr-board">
                  <span className="lr-thumb">{/* eslint-disable-next-line @next/next/no-img-element */}{x.b.photo_urls?.[0] ? <img src={x.b.photo_urls[0]} alt="" /> : null}</span>
                  <span style={{ minWidth: 0 }}>
                    <strong>{x.b.name}</strong>
                    <em>{[x.b.area, x.b.city].filter(Boolean).join(', ') || 'No area'} · {x.owner ?? 'owner unknown'}</em>
                  </span>
                </span>
                <span className="lr-dots" aria-label={`${x.score} of ${CHECKS.length} checks`}>
                  {CHECKS.map(c => <i key={c.key} className={x.ok[c.key] ? 'is-ok' : ''} title={`${c.label}: ${x.ok[c.key] ? 'yes' : c.fix}`} />)}
                  <b>{x.score}/{CHECKS.length}</b>
                </span>
                <span className="lr-miss">
                  {x.missing.length === 0 ? <b className="lr-ready">Ready to sell</b> : x.missing.map(k => <i key={k} title={CHECKS.find(c => c.key === k)!.fix}>{CHECKS.find(c => c.key === k)!.need}</i>)}
                </span>
              </div>
            ))}
          </div>
          <p className="lr-foot">
            Fix details in the <Link href="/dashboard/admin?tab=inventory">inventory</Link>; owners, contacts and private links on the <Link href="/dashboard/admin/owners">Owners</Link> page.
            “Current rate” and “Availability” also pass when the owner has an active private link, because that is how we ask them.
          </p>
        </>
      )}
      {!boards && !error && <div className="lr-card lr-muted">Loading…</div>}
    </div>
  );
}

const CSS = `
.lr { max-width: 1120px; margin: 0 auto; padding: 8px 0 48px; color: #0F172A; }
.lr-top { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; flex-wrap: wrap; margin-bottom: 16px; }
.lr-h1 { font-size: 1.375rem; font-weight: 800; margin: 0 0 4px; letter-spacing: -.02em; }
.lr-sub { font-size: .875rem; color: #64748B; margin: 0; max-width: 620px; line-height: 1.55; }
.lr-ctrl { display: flex; gap: 8px; align-items: center; }
.lr-seg { display: inline-flex; background: #F1F5F9; border-radius: 10px; padding: 3px; }
.lr-seg button { height: 30px; border: none; background: none; border-radius: 8px; padding: 0 12px; font-family: inherit; font-size: .8125rem; font-weight: 600; color: #475569; cursor: pointer; }
.lr-seg button.is-on { background: #fff; color: #0F172A; box-shadow: 0 1px 2px rgba(15,23,42,.08); }
.lr-btn-2 { height: 36px; border-radius: 9px; background: #fff; color: #334155; border: 1px solid #E2E8F0; font-family: inherit; font-size: .8125rem; font-weight: 600; padding: 0 12px; cursor: pointer; }
.lr-card { background: #fff; border: 1px solid #E2E8F0; border-radius: 14px; padding: 14px 16px; }
.lr-error { border-color: #FECACA; background: #FEF2F2; color: #B91C1C; font-size: .8125rem; }
.lr-muted { color: #94A3B8; font-size: .8125rem; }
.lr-summary { display: grid; grid-template-columns: 220px minmax(0, 1fr); gap: 12px; margin-bottom: 14px; }
.lr-big { background: #fff; border: 1px solid #E2E8F0; border-radius: 14px; padding: 14px 16px; display: flex; flex-direction: column; justify-content: center; gap: 2px; }
.lr-big strong { font-size: 2rem; font-weight: 800; letter-spacing: -.03em; color: #047857; font-variant-numeric: tabular-nums; line-height: 1.1; }
.lr-big span { font-size: .8125rem; color: #64748B; }
.lr-gaps { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 8px; }
.lr-gaps button { width: 100%; height: 100%; text-align: left; background: #fff; border: 1px solid #E2E8F0; border-radius: 12px; padding: 8px 10px; font-family: inherit; cursor: pointer; display: flex; flex-direction: column; gap: 1px; }
.lr-gaps button b { font-size: 1.125rem; font-weight: 800; color: #B45309; font-variant-numeric: tabular-nums; }
.lr-gaps button span { font-size: .6875rem; color: #475569; font-weight: 500; }
.lr-gaps button.is-on { background: #EFF5FC; border-color: #BFD3EA; box-shadow: 0 0 0 3px rgba(27,79,138,.08); }
.lr-gaps button.is-done { cursor: default; } .lr-gaps button.is-done b { color: #16A34A; }
.lr-table { padding: 0; overflow: hidden; }
.lr-row { display: grid; grid-template-columns: 36px minmax(0, 1fr) 190px minmax(0, 300px); gap: 12px; align-items: center; padding: 9px 16px; border-top: 1px solid #F1F5F9; font-size: .8125rem; }
.lr-head { border-top: none; background: #F8FAFC; font-size: .6875rem; font-weight: 700; color: #64748B; text-transform: uppercase; letter-spacing: .05em; }
.lr-row.is-ready { background: #F7FDF9; }
.lr-rank { color: #94A3B8; font-weight: 700; font-variant-numeric: tabular-nums; }
.lr-board { display: flex; gap: 10px; align-items: center; min-width: 0; }
.lr-board strong { display: block; font-size: .8125rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lr-board em { display: block; font-style: normal; font-size: .75rem; color: #64748B; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lr-thumb { width: 40px; height: 40px; border-radius: 8px; background: #EEF2F7; overflow: hidden; flex-shrink: 0; }
.lr-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.lr-dots { display: flex; gap: 3px; align-items: center; }
.lr-dots i { width: 10px; height: 10px; border-radius: 3px; background: #E2E8F0; }
.lr-dots i.is-ok { background: #16A34A; }
.lr-dots b { margin-left: 6px; font-size: .75rem; color: #334155; font-variant-numeric: tabular-nums; }
.lr-miss { display: flex; gap: 4px; flex-wrap: wrap; }
.lr-miss i { font-style: normal; font-size: .6875rem; font-weight: 600; padding: 2px 7px; border-radius: 999px; background: #FEF3C7; color: #92400E; white-space: nowrap; }
.lr-ready { color: #047857; font-size: .75rem; }
.lr-foot { font-size: .75rem; color: #64748B; margin: 10px 2px 0; line-height: 1.6; }
.lr-foot a { color: #1B4F8A; font-weight: 600; }
@media (max-width: 900px) {
  .lr-summary { grid-template-columns: minmax(0, 1fr); }
  .lr-gaps { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .lr-head { display: none; }
  .lr-row { grid-template-columns: 28px minmax(0, 1fr); gap: 6px 10px; }
  .lr-dots, .lr-miss { grid-column: 2; }
}
`;
