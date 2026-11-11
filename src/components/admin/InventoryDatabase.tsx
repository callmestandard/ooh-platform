'use client';

/**
 * Admin Board Inventory as a database: one page with a "needs attention"
 * strip, four views of the same boards (Table, Gallery, Board, Map), filters,
 * sorting, inline status/verification menus, a side panel per board and bulk
 * actions. Data and saving stay in the admin page; this component only shows
 * the boards and calls back.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { VERIFICATION_META, verificationOf, formatVerifiedDate, type VerificationStatus } from '@/lib/board-verification';
import { boardFormatLabel } from '@/lib/board-formats';
import { formatNaira } from '@/lib/utils';
import { boardPath } from '@/lib/public-links';
import { displayName } from '@/lib/display-name';
import type { MapBoard } from '@/app/marketplace/MarketplaceMap';

const MarketplaceMap = dynamic(() => import('@/app/marketplace/MarketplaceMap'), {
  ssr: false,
  loading: () => <div className="invdb-map-loading"><span className="invdb-spinner" /></div>,
});

export type InvStatus = 'available' | 'booked' | 'unavailable' | 'decommissioned';

export type InvBoard = {
  id: string;
  name: string;
  address: string | null;
  city: string;
  state: string | null;
  area: string | null;
  format: string;
  asking_rate: number;
  status: InvStatus;
  owner_id: string | null;
  created_at: string;
  verification_status: string | null;
  last_verified_at: string | null;
  source: string | null;
  photo_urls: string[] | null;
  latitude: number | null;
  longitude: number | null;
  width?: number | null;
  height?: number | null;
  illuminated?: boolean | null;
};

type Props = {
  boards: InvBoard[];
  ownerOf: (b: InvBoard) => { name: string | null; hasAccount: boolean };
  brandOf: (b: InvBoard) => { brand: string | null; ends_on: string | null } | undefined;
  onStatus: (b: InvBoard, next: Exclude<InvStatus, 'booked'>) => Promise<void> | void;
  onVerification: (b: InvBoard, next: VerificationStatus) => Promise<void> | void;
  onEditDetails: (b: InvBoard) => void;
  onEditPhotos: (b: InvBoard) => void;
  onMovePin: (b: InvBoard) => void;
  onDelete: (b: InvBoard) => void;
};

// ── Options ────────────────────────────────────────────────────────────────

const STATUS_META: Record<InvStatus, { label: string; dot: string; bg: string; color: string }> = {
  available:      { label: 'Available',      dot: '#22C55E', bg: '#EEFBF3', color: '#166534' },
  booked:         { label: 'Booked',         dot: '#3B82F6', bg: '#EFF5FF', color: '#1E40AF' },
  unavailable:    { label: 'Unavailable',    dot: '#F59E0B', bg: '#FFF8EB', color: '#92400E' },
  decommissioned: { label: 'Decommissioned', dot: '#A1A1AA', bg: '#F4F4F5', color: '#52525B' },
};
const STATUSES: InvStatus[] = ['available', 'booked', 'unavailable', 'decommissioned'];
const VERIFICATIONS: VerificationStatus[] = ['pending', 'verified', 'partner_verified'];
const VER_DOT: Record<VerificationStatus, string> = { pending: '#A1A1AA', verified: '#2563EB', partner_verified: '#059669' };

type Issue = 'photo' | 'pin' | 'rate' | 'owner' | 'pending';
const ISSUES: { key: Issue; label: string; done: string; hint: string }[] = [
  { key: 'photo',   label: 'No photo',      done: 'All have photos',  hint: 'Buyers skip boards without a photo' },
  { key: 'pin',     label: 'No map pin',    done: 'All pinned',       hint: 'Not shown on the map' },
  { key: 'rate',    label: 'No rate',       done: 'All priced',       hint: 'Buyers see “Request quote”' },
  { key: 'owner',   label: 'Owner unknown', done: 'All owners known', hint: 'No owner account or name' },
  { key: 'pending', label: 'Not verified',  done: 'All verified',     hint: 'Owner hasn’t confirmed yet' },
];

type View = 'table' | 'gallery' | 'board' | 'map';
type SortKey = 'newest' | 'oldest' | 'name' | 'rate_desc' | 'rate_asc' | 'city';
type GroupBy = 'status' | 'verification' | 'city' | 'source';
type FilterKey = 'status' | 'verification' | 'city' | 'format' | 'source';

const SORTS: { key: SortKey; label: string }[] = [
  { key: 'newest', label: 'Newest first' },
  { key: 'oldest', label: 'Oldest first' },
  { key: 'name', label: 'Name A–Z' },
  { key: 'city', label: 'City A–Z' },
  { key: 'rate_desc', label: 'Rate: high to low' },
  { key: 'rate_asc', label: 'Rate: low to high' },
];
const GROUPS: { key: GroupBy; label: string }[] = [
  { key: 'status', label: 'Status' },
  { key: 'verification', label: 'Verification' },
  { key: 'city', label: 'City' },
  { key: 'source', label: 'Source' },
];
const FILTER_LABELS: Record<FilterKey, string> = { status: 'Status', verification: 'Verification', city: 'City', format: 'Format', source: 'Source' };

const PREFS_KEY = 'ooh_inventory_prefs_v1';
type Prefs = { view: View; sort: SortKey; groupBy: GroupBy };

function readPrefs(): Prefs {
  const fallback: Prefs = { view: 'table', sort: 'newest', groupBy: 'status' };
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) return { ...fallback, ...(JSON.parse(raw) as Partial<Prefs>) };
  } catch {}
  // Phones start on the gallery; a wide table is hard to read there.
  return window.innerWidth < 700 ? { ...fallback, view: 'gallery' } : fallback;
}

function hasIssue(b: InvBoard, issue: Issue, ownerOf: Props['ownerOf']): boolean {
  switch (issue) {
    case 'photo': return !b.photo_urls?.length;
    case 'pin': return b.latitude == null || b.longitude == null;
    case 'rate': return !b.asking_rate;
    case 'owner': return !b.owner_id && !ownerOf(b).name;
    case 'pending': return verificationOf(b) === 'pending';
  }
}

function filterValue(b: InvBoard, key: FilterKey): string {
  switch (key) {
    case 'status': return b.status;
    case 'verification': return verificationOf(b);
    case 'city': return b.city || '—';
    case 'format': return b.format === 'led' ? 'digital' : b.format;
    case 'source': return b.source || 'Manual';
  }
}

function filterLabel(key: FilterKey, value: string): string {
  if (key === 'status') return STATUS_META[value as InvStatus]?.label ?? value;
  if (key === 'verification') return VERIFICATION_META[value as VerificationStatus]?.label ?? value;
  if (key === 'format') return boardFormatLabel(value);
  if (key === 'source') return shortSource(value);
  return value;
}

/** Deck file names are long ("GEMS COMMUNICATIONS AVAILABLE PAN NIGERIA SITES 14 OCTOBER 2026 (deck)"). */
function shortSource(s: string | null): string {
  if (!s) return 'Manual';
  const clean = s.replace(/\s*\((deck|pdf|pptx)\)\s*$/i, '').replace(/\s+\(\d+\)/g, '').trim();
  const words = clean.split(/\s+/);
  const short = words.slice(0, 3).join(' ');
  const title = short.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
  return words.length > 3 ? `${title}…` : title;
}

function timeAgo(d: string) {
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function placeText(b: InvBoard) {
  const area = b.area && b.area.length <= 40 ? b.area : '';
  const parts = [area, b.city, b.state].map(p => (p ?? '').trim()).filter(Boolean);
  return parts.filter((p, i) => parts.findIndex(q => q.toLowerCase() === p.toLowerCase()) === i).join(', ') || '—';
}

// ── Small pieces ───────────────────────────────────────────────────────────

const I = {
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z M21 21l-4.35-4.35',
  table: 'M3 5h18v14H3z M3 10h18 M9 10v9',
  gallery: 'M4 4h7v7H4z M13 4h7v7h-7z M4 13h7v7H4z M13 13h7v7h-7z',
  board: 'M4 4h4v16H4z M10 4h4v10h-4z M16 4h4v13h-4z',
  map: 'M1 6l7-4 8 4 7-4v16l-7 4-8-4-7 4V6 M8 2v16 M16 6v16',
  filter: 'M3 5h18 M6 12h12 M10 19h4',
  sort: 'M7 4v16 M3 8l4-4 4 4 M17 20V4 M13 16l4 4 4-4',
  group: 'M3 6h18 M3 12h12 M3 18h6',
  plus: 'M12 5v14 M5 12h14',
  close: 'M18 6 6 18 M6 6l12 12',
  chevUp: 'M18 15l-6-6-6 6',
  chevDown: 'M6 9l6 6 6-6',
  check: 'M20 6 9 17l-5-5',
  photo: 'M3 5h18v14H3z M8.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z M21 15l-5-5L5 19',
  pin: 'M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12z M12 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  edit: 'M12 20h9 M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
  trash: 'M3 6h18 M8 6V4h8v2 M19 6l-1 14H6L5 6',
  external: 'M14 3h7v7 M10 14 21 3 M21 14v7H3V3h7',
  status: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M12 6v6l4 2',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  place: 'M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12z',
  format: 'M4 4h16v10H4z M12 14v6 M8 20h8',
  money: 'M12 1v22 M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6',
  person: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2 M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  source: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M12 6v6l4 2',
  size: 'M21 3H3v18 M21 3v18H3 M7 17l10-10',
  megaphone: 'M3 11v2a1 1 0 0 0 1 1h3l5 4V6L7 10H4a1 1 0 0 0-1 1z M16 8a5 5 0 0 1 0 8',
};

function Ico({ d, size = 15, stroke = 1.8 }: { d: string; size?: number; stroke?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

function StatusPill({ status }: { status: InvStatus }) {
  const m = STATUS_META[status];
  return <span className="invdb-pill" style={{ background: m.bg, color: m.color }}><span className="invdb-dot" style={{ background: m.dot }} />{m.label}</span>;
}

function VerPill({ v }: { v: VerificationStatus }) {
  const m = VERIFICATION_META[v];
  return <span className="invdb-pill" style={{ background: m.bg, color: m.color }}><span className="invdb-dot" style={{ background: VER_DOT[v] }} />{m.short}</span>;
}

/** A floating menu anchored to a button; fixed-positioned so tables that scroll can't clip it. */
function Popover({ anchor, onClose, children, width = 240, align = 'left' }: {
  anchor: HTMLElement | null; onClose: () => void; children: React.ReactNode; width?: number; align?: 'left' | 'right';
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!anchor) return;
    const r = anchor.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    let left = align === 'right' ? r.right - width : r.left;
    left = Math.max(8, Math.min(left, vw - width - 8));
    const h = ref.current?.offsetHeight ?? 200;
    const top = r.bottom + 6 + h > vh - 8 ? Math.max(8, r.top - 6 - h) : r.bottom + 6;
    // Positioning needs the menu's measured height, so it has to happen after layout.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPos({ top, left });
  }, [anchor, width, align]);

  useEffect(() => {
    const down = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchor?.contains(t)) return;
      onClose();
    };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    const scroll = (e: Event) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key, true);
    window.addEventListener('scroll', scroll, true);
    window.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('mousedown', down);
      document.removeEventListener('keydown', key, true);
      window.removeEventListener('scroll', scroll, true);
      window.removeEventListener('resize', onClose);
    };
  }, [anchor, onClose]);

  return (
    <div ref={ref} className="invdb-pop" role="menu" style={{ width, top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}>
      {children}
    </div>
  );
}

/** A pill that opens a menu of options (Notion's select property). */
function SelectCell<T extends string>({ value, options, render, onChange, disabled, title, isDisabled }: {
  value: T; options: T[]; render: (v: T) => React.ReactNode; onChange: (v: T) => void;
  disabled?: boolean; title?: string; isDisabled?: (v: T) => string | null;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const close = useCallback(() => setAnchor(null), []);
  if (disabled) return <span title={title} className="invdb-select is-static">{render(value)}</span>;
  return (
    <>
      <button type="button" className={`invdb-select${anchor ? ' is-open' : ''}`} title={title}
        onClick={e => { e.stopPropagation(); setAnchor(anchor ? null : e.currentTarget); }}>
        {render(value)}
        <span className="invdb-select-chev"><Ico d={I.chevDown} size={12} stroke={2.2} /></span>
      </button>
      {anchor && (
        <Popover anchor={anchor} onClose={close} width={230}>
          {options.map(o => {
            const why = isDisabled?.(o) ?? null;
            return (
              <button key={o} type="button" role="menuitemradio" aria-checked={o === value} disabled={!!why} title={why ?? undefined}
                className="invdb-menu-item" onClick={e => { e.stopPropagation(); close(); if (o !== value) onChange(o); }}>
                {render(o)}
                {why ? <span className="invdb-menu-note">{why}</span> : o === value ? <span className="invdb-menu-check"><Ico d={I.check} size={14} stroke={2.4} /></span> : null}
              </button>
            );
          })}
        </Popover>
      )}
    </>
  );
}

function Thumb({ b, size = 'sm', onAdd }: { b: InvBoard; size?: 'sm' | 'card'; onAdd?: () => void }) {
  const src = b.photo_urls?.[0];
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt="" loading={size === 'sm' ? 'eager' : 'lazy'} decoding="async" className={size === 'sm' ? 'invdb-thumb' : 'invdb-cover-img'} />;
  }
  return (
    <span className={size === 'sm' ? 'invdb-thumb is-empty' : 'invdb-cover-empty'}
      onClick={onAdd ? e => { e.stopPropagation(); onAdd(); } : undefined}
      role={onAdd ? 'button' : undefined} title={onAdd ? 'Add a photo' : undefined}>
      <Ico d={I.photo} size={size === 'sm' ? 14 : 22} stroke={1.6} />
      {size === 'card' && onAdd && <span>Add photo</span>}
    </span>
  );
}

// ── Main ───────────────────────────────────────────────────────────────────

export default function InventoryDatabase(props: Props) {
  const { boards, ownerOf, brandOf, onStatus, onVerification, onEditDetails, onEditPhotos, onMovePin, onDelete } = props;

  const [prefs] = useState(readPrefs);
  const [view, setView] = useState<View>(prefs.view);
  const [sort, setSort] = useState<SortKey>(prefs.sort);
  const [groupBy, setGroupBy] = useState<GroupBy>(prefs.groupBy);
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<Record<FilterKey, string[]>>({ status: [], verification: [], city: [], format: [], source: [] });
  const [issue, setIssue] = useState<Issue | null>(null);
  const [peekId, setPeekId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<{ kind: 'filter' | 'sort' | 'group'; anchor: HTMLElement } | null>(null);
  const [filterSection, setFilterSection] = useState<FilterKey>('status');
  const [bulkBusy, setBulkBusy] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropCol, setDropCol] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Remember the view, sort and grouping for this browser.
  useEffect(() => {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify({ view, sort, groupBy } satisfies Prefs)); } catch {}
  }, [view, sort, groupBy]);

  // "/" jumps to search, like Notion and most Apple apps' ⌘F.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable;
      if (e.key === '/' && !typing) { e.preventDefault(); searchRef.current?.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Counts for the attention strip.
  const issueCounts = useMemo(() => {
    const c = { photo: 0, pin: 0, rate: 0, owner: 0, pending: 0 } as Record<Issue, number>;
    for (const b of boards) for (const { key } of ISSUES) if (hasIssue(b, key, ownerOf)) c[key]++;
    return c;
  }, [boards, ownerOf]);
  const complete = useMemo(
    () => boards.filter(b => !(['photo', 'pin', 'owner'] as Issue[]).some(k => hasIssue(b, k, ownerOf))).length,
    [boards, ownerOf],
  );
  const quality = boards.length ? Math.round((complete / boards.length) * 100) : 0;

  // Options shown in the filter menu, with counts.
  const filterOptions = useMemo(() => {
    const out = {} as Record<FilterKey, { value: string; count: number }[]>;
    (Object.keys(FILTER_LABELS) as FilterKey[]).forEach(k => {
      const counts = new Map<string, number>();
      boards.forEach(b => { const v = filterValue(b, k); counts.set(v, (counts.get(v) ?? 0) + 1); });
      let list = [...counts.entries()].map(([value, count]) => ({ value, count }));
      if (k === 'status') list = STATUSES.map(s => ({ value: s as string, count: counts.get(s) ?? 0 }));
      else if (k === 'verification') list = VERIFICATIONS.map(s => ({ value: s as string, count: counts.get(s) ?? 0 }));
      else list.sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
      out[k] = list;
    });
    return out;
  }, [boards]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = boards.filter(b => {
      if (q) {
        const hay = [b.name, b.address, b.area, b.city, b.state, b.source, ownerOf(b).name, brandOf(b)?.brand].filter(Boolean).join(' ').toLowerCase();
        if (!q.split(/\s+/).every(w => hay.includes(w))) return false;
      }
      for (const k of Object.keys(filters) as FilterKey[]) {
        if (filters[k].length && !filters[k].includes(filterValue(b, k))) return false;
      }
      if (issue && !hasIssue(b, issue, ownerOf)) return false;
      return true;
    });
    const by: Record<SortKey, (a: InvBoard, b: InvBoard) => number> = {
      newest: (a, b) => b.created_at.localeCompare(a.created_at),
      oldest: (a, b) => a.created_at.localeCompare(b.created_at),
      name: (a, b) => a.name.localeCompare(b.name),
      city: (a, b) => (a.city || '').localeCompare(b.city || '') || a.name.localeCompare(b.name),
      rate_desc: (a, b) => (b.asking_rate || 0) - (a.asking_rate || 0),
      rate_asc: (a, b) => (a.asking_rate || Infinity) - (b.asking_rate || Infinity),
    };
    return list.sort(by[sort]);
  }, [boards, query, filters, issue, sort, ownerOf, brandOf]);

  const activeFilterCount = Object.values(filters).reduce((t, v) => t + v.length, 0) + (issue ? 1 : 0);
  const clearAll = () => { setFilters({ status: [], verification: [], city: [], format: [], source: [] }); setIssue(null); setQuery(''); };
  const toggleFilter = (k: FilterKey, v: string) =>
    setFilters(f => ({ ...f, [k]: f[k].includes(v) ? f[k].filter(x => x !== v) : [...f[k], v] }));

  // Selections only count while the board is on screen (filters can hide it; it can be deleted).
  const selectedShown = useMemo(() => new Set(shown.filter(b => selected.has(b.id)).map(b => b.id)), [shown, selected]);

  const peekIndex = peekId ? shown.findIndex(b => b.id === peekId) : -1;
  const peek = peekId ? boards.find(b => b.id === peekId) ?? null : null;

  const allSelected = shown.length > 0 && selectedShown.size === shown.length;
  const toggleOne = (id: string) => setSelected(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  async function bulk(action: { status?: Exclude<InvStatus, 'booked'>; verification?: VerificationStatus }) {
    setBulkBusy(true);
    const targets = boards.filter(b => selectedShown.has(b.id));
    for (const b of targets) {
      if (action.status && b.status !== 'booked' && b.status !== action.status) await onStatus(b, action.status);
      if (action.verification && verificationOf(b) !== action.verification) await onVerification(b, action.verification);
    }
    setBulkBusy(false);
    setSelected(new Set());
  }

  // ── Columns for the Board view ──
  const groupColumns = useMemo(() => {
    let keys: string[];
    if (groupBy === 'status') keys = STATUSES;
    else if (groupBy === 'verification') keys = VERIFICATIONS;
    else {
      const counts = new Map<string, number>();
      shown.forEach(b => { const v = filterValue(b, groupBy); counts.set(v, (counts.get(v) ?? 0) + 1); });
      keys = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
    }
    return keys.map(k => ({ key: k, boards: shown.filter(b => filterValue(b, groupBy) === k) }));
  }, [groupBy, shown]);
  const canDrop = groupBy === 'status' || groupBy === 'verification';

  function dropInto(col: string) {
    const b = boards.find(x => x.id === dragId);
    setDragId(null); setDropCol(null);
    if (!b) return;
    if (groupBy === 'status') {
      if (col === 'booked' || b.status === 'booked' || b.status === col) return;
      onStatus(b, col as Exclude<InvStatus, 'booked'>);
    } else if (groupBy === 'verification') {
      if (col === 'partner_verified' && !b.owner_id) return;
      if (verificationOf(b) !== col) onVerification(b, col as VerificationStatus);
    }
  }

  const statusCell = (b: InvBoard) => (
    <SelectCell<InvStatus>
      value={b.status}
      options={['available', 'unavailable', 'decommissioned']}
      render={s => <StatusPill status={s} />}
      disabled={b.status === 'booked'}
      title={b.status === 'booked' ? 'Booked through a deal. It frees up when the booking ends.' : undefined}
      onChange={s => onStatus(b, s as Exclude<InvStatus, 'booked'>)}
    />
  );
  const verCell = (b: InvBoard) => (
    <SelectCell<VerificationStatus>
      value={verificationOf(b)}
      options={VERIFICATIONS}
      render={v => <VerPill v={v} />}
      isDisabled={v => v === 'partner_verified' && !b.owner_id ? 'Needs an owner account' : null}
      onChange={v => onVerification(b, v)}
    />
  );
  const rateText = (b: InvBoard) => b.asking_rate
    ? <span className="invdb-rate">{formatNaira(b.asking_rate)}<small>/mo</small></span>
    : <span className="invdb-muted">Request quote</span>;
  const ownerName = (b: InvBoard) => {
    const o = ownerOf(b);
    if (!o.name && !b.owner_id) return <span className="invdb-warn">Unknown</span>;
    return <span title={o.hasAccount ? 'Has an owner account' : 'No owner account yet'}>{o.name || 'Account'}</span>;
  };
  const ownerText = (b: InvBoard) => {
    const o = ownerOf(b);
    if (!o.name && !b.owner_id) return <span className="invdb-warn">Unknown</span>;
    return <span title={o.hasAccount ? 'Has an owner account' : 'No owner account yet'}>{o.name || 'Account'}{!o.hasAccount && <span className="invdb-muted invdb-owner-note"> · no account</span>}</span>;
  };

  const mapBoards: MapBoard[] = useMemo(() => shown
    .filter(b => b.latitude != null && b.longitude != null)
    .map(b => ({
      id: b.id, name: b.name, area: b.area, city: b.city, format: b.format, photo_urls: b.photo_urls,
      verification_status: b.verification_status, latitude: b.latitude!, longitude: b.longitude!,
      rate: b.asking_rate ? formatNaira(b.asking_rate) : 'Request quote', perMonth: !!b.asking_rate,
    })), [shown]);

  return (
    <div className="invdb">
      <style>{CSS}</style>

      {/* ── Title ── */}
      <header className="invdb-head">
        <div>
          <p className="invdb-eyebrow">Admin</p>
          <h1 className="invdb-title">Board Inventory</h1>
          <p className="invdb-sub">
            {boards.length} boards · {boards.filter(b => b.status === 'available').length} available · {boards.filter(b => b.status === 'booked').length} booked
          </p>
        </div>
        <div className="invdb-head-actions">
          <a href="/dashboard/admin/import-boards" className="invdb-btn">Import deck</a>
          <a href="/dashboard/admin/post-board" className="invdb-btn is-primary"><Ico d={I.plus} size={14} stroke={2.4} />New board</a>
        </div>
      </header>

      {/* ── Needs attention ── */}
      <section className="invdb-health" aria-label="Listing quality">
        <div className="invdb-quality">
          <svg width="52" height="52" viewBox="0 0 52 52" aria-hidden="true">
            <circle cx="26" cy="26" r="22" fill="none" stroke="#EEF0F3" strokeWidth="5" />
            <circle cx="26" cy="26" r="22" fill="none" stroke={quality >= 80 ? '#22C55E' : quality >= 50 ? '#1B4F8A' : '#F59E0B'} strokeWidth="5"
              strokeLinecap="round" strokeDasharray={`${(quality / 100) * 138.2} 138.2`} transform="rotate(-90 26 26)" style={{ transition: 'stroke-dasharray .6s ease' }} />
          </svg>
          <div>
            <p className="invdb-quality-num">{quality}%</p>
            <p className="invdb-quality-label" title="Has a photo, a map pin and a known owner">listings complete</p>
          </div>
        </div>
        <div className="invdb-issues">
          {ISSUES.map(({ key, label, done, hint }) => {
            const n = issueCounts[key];
            const on = issue === key;
            return (
              <button key={key} type="button" className={`invdb-issue${on ? ' is-on' : ''}${n === 0 ? ' is-done' : ''}`}
                onClick={() => setIssue(on ? null : key)} title={hint} aria-pressed={on} disabled={n === 0 && !on}>
                <span className="invdb-issue-num">{n === 0 ? <Ico d={I.check} size={16} stroke={2.4} /> : n}</span>
                <span className="invdb-issue-label">{n === 0 ? done : label}</span>
              </button>
            );
          })}
        </div>
      </section>

      {/* ── Toolbar ── */}
      <div className="invdb-toolbar">
        <div className="invdb-views" role="tablist" aria-label="View">
          {([['table', 'Table', I.table], ['gallery', 'Gallery', I.gallery], ['board', 'Board', I.board], ['map', 'Map', I.map]] as [View, string, string][]).map(([k, label, d]) => (
            <button key={k} role="tab" aria-selected={view === k} className={`invdb-view${view === k ? ' is-on' : ''}`} onClick={() => setView(k)}>
              <Ico d={d} size={14} /> <span>{label}</span>
            </button>
          ))}
        </div>
        <div className="invdb-tools">
          <label className="invdb-search">
            <Ico d={I.search} size={14} />
            <input ref={searchRef} value={query} onChange={e => setQuery(e.target.value)} placeholder="Search boards…" aria-label="Search boards" />
            {query ? <button type="button" onClick={() => setQuery('')} aria-label="Clear search"><Ico d={I.close} size={12} stroke={2.4} /></button> : <kbd>/</kbd>}
          </label>
          <button type="button" className={`invdb-tool${activeFilterCount ? ' is-active' : ''}`} onClick={e => setMenu({ kind: 'filter', anchor: e.currentTarget })}>
            <Ico d={I.filter} size={14} /> Filter{activeFilterCount ? <span className="invdb-count">{activeFilterCount}</span> : null}
          </button>
          <button type="button" className="invdb-tool" onClick={e => setMenu({ kind: 'sort', anchor: e.currentTarget })}>
            <Ico d={I.sort} size={14} /> <span className="invdb-tool-text">{SORTS.find(s => s.key === sort)?.label}</span>
          </button>
          {view === 'board' && (
            <button type="button" className="invdb-tool" onClick={e => setMenu({ kind: 'group', anchor: e.currentTarget })}>
              <Ico d={I.group} size={14} /> <span className="invdb-tool-text">By {GROUPS.find(g => g.key === groupBy)?.label.toLowerCase()}</span>
            </button>
          )}
        </div>
      </div>

      {/* Active filter chips */}
      {activeFilterCount > 0 && (
        <div className="invdb-chips">
          {issue && <button type="button" className="invdb-chip" onClick={() => setIssue(null)}>{ISSUES.find(x => x.key === issue)?.label}<Ico d={I.close} size={11} stroke={2.4} /></button>}
          {(Object.keys(filters) as FilterKey[]).flatMap(k => filters[k].map(v => (
            <button key={k + v} type="button" className="invdb-chip" onClick={() => toggleFilter(k, v)}>
              <span className="invdb-muted">{FILTER_LABELS[k]}:</span> {filterLabel(k, v)}<Ico d={I.close} size={11} stroke={2.4} />
            </button>
          )))}
          <button type="button" className="invdb-chip-clear" onClick={clearAll}>Clear all</button>
          <span className="invdb-chips-count">{shown.length} of {boards.length}</span>
        </div>
      )}

      {/* Menus */}
      {menu?.kind === 'sort' && (
        <Popover anchor={menu.anchor} onClose={() => setMenu(null)} width={210}>
          <p className="invdb-menu-title">Sort by</p>
          {SORTS.map(s => (
            <button key={s.key} type="button" className="invdb-menu-item" onClick={() => { setSort(s.key); setMenu(null); }}>
              {s.label}{sort === s.key && <span className="invdb-menu-check"><Ico d={I.check} size={14} stroke={2.4} /></span>}
            </button>
          ))}
        </Popover>
      )}
      {menu?.kind === 'group' && (
        <Popover anchor={menu.anchor} onClose={() => setMenu(null)} width={200}>
          <p className="invdb-menu-title">Group by</p>
          {GROUPS.map(g => (
            <button key={g.key} type="button" className="invdb-menu-item" onClick={() => { setGroupBy(g.key); setMenu(null); }}>
              {g.label}{groupBy === g.key && <span className="invdb-menu-check"><Ico d={I.check} size={14} stroke={2.4} /></span>}
            </button>
          ))}
        </Popover>
      )}
      {menu?.kind === 'filter' && (
        <Popover anchor={menu.anchor} onClose={() => setMenu(null)} width={380} align="right">
          <div className="invdb-filter">
            <div className="invdb-filter-nav">
              {(Object.keys(FILTER_LABELS) as FilterKey[]).map(k => (
                <button key={k} type="button" className={`invdb-filter-tab${filterSection === k ? ' is-on' : ''}`} onClick={() => setFilterSection(k)}>
                  {FILTER_LABELS[k]}{filters[k].length ? <span className="invdb-count">{filters[k].length}</span> : null}
                </button>
              ))}
            </div>
            <div className="invdb-filter-list">
              {filterOptions[filterSection].map(({ value, count }) => {
                const on = filters[filterSection].includes(value);
                return (
                  <label key={value} className="invdb-filter-opt">
                    <input type="checkbox" checked={on} onChange={() => toggleFilter(filterSection, value)} />
                    <span className="invdb-filter-name">
                      {filterSection === 'status' ? <StatusPill status={value as InvStatus} />
                        : filterSection === 'verification' ? <VerPill v={value as VerificationStatus} />
                        : filterLabel(filterSection, value)}
                    </span>
                    <span className="invdb-muted">{count}</span>
                  </label>
                );
              })}
            </div>
          </div>
        </Popover>
      )}

      {/* ── Views ── */}
      {shown.length === 0 ? (
        <div className="invdb-empty">
          <p className="invdb-empty-title">{boards.length ? 'No boards match' : 'No boards yet'}</p>
          <p className="invdb-muted">{boards.length ? 'Try fewer filters or a different search.' : 'Add a board or import an owner’s deck to get started.'}</p>
          {boards.length ? <button type="button" className="invdb-btn" onClick={clearAll}>Clear filters</button>
            : <a href="/dashboard/admin/post-board" className="invdb-btn is-primary">New board</a>}
        </div>
      ) : view === 'table' ? (
        <div className="invdb-table-wrap">
          <div className="invdb-table-scroll">
          <table className="invdb-table">
            <thead>
              <tr>
                <th className="invdb-sticky">
                  <span className="invdb-th-main">
                    <input type="checkbox" aria-label="Select all" checked={allSelected}
                      onChange={() => setSelected(allSelected ? new Set() : new Set(shown.map(b => b.id)))} />
                    <Ico d={I.format} size={13} /> Board
                  </span>
                </th>
                <th><Ico d={I.status} size={13} /> Status</th>
                <th><Ico d={I.shield} size={13} /> Verification</th>
                <th><Ico d={I.place} size={13} /> Location</th>
                <th><Ico d={I.format} size={13} /> Format</th>
                <th className="is-num"><Ico d={I.money} size={13} /> Rate</th>
                <th><Ico d={I.person} size={13} /> Owner</th>
                <th><Ico d={I.source} size={13} /> Source</th>
                <th><Ico d={I.clock} size={13} /> Added</th>
              </tr>
            </thead>
            <tbody>
              {shown.map(b => (
                <tr key={b.id} className={`${selected.has(b.id) ? 'is-selected' : ''}${peekId === b.id ? ' is-peek' : ''}`} onClick={() => setPeekId(b.id)}>
                  <td className="invdb-sticky">
                    <div className="invdb-cell-main">
                      <input type="checkbox" aria-label={`Select ${b.name}`} checked={selected.has(b.id)}
                        onClick={e => e.stopPropagation()} onChange={() => toggleOne(b.id)} />
                      <Thumb b={b} onAdd={() => onEditPhotos(b)} />
                      <div className="invdb-name-wrap">
                        <span className="invdb-name" title={b.name}>{displayName(b.name)}</span>
                        <span className="invdb-addr">{b.address ? displayName(b.address) : placeText(b)}</span>
                      </div>
                      <span className="invdb-open">Open</span>
                    </div>
                  </td>
                  <td onClick={e => e.stopPropagation()}>{statusCell(b)}</td>
                  <td onClick={e => e.stopPropagation()}>{verCell(b)}</td>
                  <td>
                    <span className="invdb-place">{placeText(b)}</span>
                    {b.latitude == null && <span className="invdb-warn invdb-sub-line">No map pin</span>}
                  </td>
                  <td><span className="invdb-tag">{boardFormatLabel(b.format)}</span></td>
                  <td className="is-num">{rateText(b)}</td>
                  <td className="invdb-owner">{ownerName(b)}</td>
                  <td><span className="invdb-muted" title={b.source ?? undefined}>{shortSource(b.source)}</span></td>
                  <td><span className="invdb-muted">{timeAgo(b.created_at)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          <div className="invdb-foot">
            <span>{shown.length} {shown.length === 1 ? 'board' : 'boards'}{shown.length !== boards.length ? ` of ${boards.length}` : ''}</span>
            <span>Click a row to open it · Press / to search</span>
          </div>
        </div>
      ) : view === 'gallery' ? (
        <div className="invdb-gallery">
          {shown.map(b => (
            <article key={b.id} className={`invdb-card${selected.has(b.id) ? ' is-selected' : ''}`} onClick={() => setPeekId(b.id)} tabIndex={0}
              onKeyDown={e => { if (e.key === 'Enter') setPeekId(b.id); }}>
              <div className="invdb-cover">
                <Thumb b={b} size="card" onAdd={() => onEditPhotos(b)} />
                <input type="checkbox" className="invdb-card-check" aria-label={`Select ${b.name}`} checked={selected.has(b.id)}
                  onClick={e => e.stopPropagation()} onChange={() => toggleOne(b.id)} />
                {(b.photo_urls?.length ?? 0) > 1 && <span className="invdb-cover-count">{b.photo_urls!.length} photos</span>}
              </div>
              <div className="invdb-card-body">
                <p className="invdb-name">{displayName(b.name)}</p>
                <p className="invdb-addr">{placeText(b)}</p>
                <div className="invdb-card-pills"><StatusPill status={b.status} /><VerPill v={verificationOf(b)} /></div>
                <div className="invdb-card-foot">
                  <span className="invdb-tag">{boardFormatLabel(b.format)}</span>
                  {rateText(b)}
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : view === 'board' ? (
        <div className="invdb-kanban">
          {groupColumns.map(col => {
            const meta = groupBy === 'status' ? STATUS_META[col.key as InvStatus] : null;
            const vmeta = groupBy === 'verification' ? col.key as VerificationStatus : null;
            const blocked = groupBy === 'status' && col.key === 'booked';
            return (
              <div key={col.key}
                className={`invdb-col${dropCol === col.key && canDrop && !blocked ? ' is-drop' : ''}`}
                onDragOver={e => { if (canDrop && dragId && !blocked) { e.preventDefault(); setDropCol(col.key); } }}
                onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropCol(null); }}
                onDrop={e => { e.preventDefault(); dropInto(col.key); }}>
                <div className="invdb-col-head">
                  {meta ? <StatusPill status={col.key as InvStatus} /> : vmeta ? <VerPill v={vmeta} />
                    : <span className="invdb-col-name">{groupBy === 'source' ? shortSource(col.key === 'Manual' ? null : col.key) : col.key}</span>}
                  <span className="invdb-muted">{col.boards.length}</span>
                </div>
                <div className="invdb-col-body">
                  {col.boards.map(b => (
                    <div key={b.id} className={`invdb-kcard${dragId === b.id ? ' is-dragging' : ''}`}
                      draggable={canDrop && !(groupBy === 'status' && b.status === 'booked')}
                      onDragStart={e => { setDragId(b.id); e.dataTransfer.effectAllowed = 'move'; }}
                      onDragEnd={() => { setDragId(null); setDropCol(null); }}
                      onClick={() => setPeekId(b.id)} tabIndex={0} onKeyDown={e => { if (e.key === 'Enter') setPeekId(b.id); }}>
                      {b.photo_urls?.[0] && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={b.photo_urls[0]} alt="" loading="lazy" className="invdb-kcard-img" draggable={false} />
                      )}
                      <p className="invdb-name">{displayName(b.name)}</p>
                      <p className="invdb-addr">{placeText(b)}</p>
                      <div className="invdb-kcard-foot">
                        <span className="invdb-tag">{boardFormatLabel(b.format)}</span>
                        {rateText(b)}
                      </div>
                    </div>
                  ))}
                  {col.boards.length === 0 && <p className="invdb-col-empty">{canDrop && !blocked ? 'Drop a board here' : 'None'}</p>}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="invdb-map">
          <MarketplaceMap boards={mapBoards} onOpen={id => setPeekId(id)} />
          {shown.length > mapBoards.length && (
            <button type="button" className="invdb-map-note" onClick={() => setIssue('pin')}>
              {shown.length - mapBoards.length} {shown.length - mapBoards.length === 1 ? 'board has' : 'boards have'} no pin · Show them
            </button>
          )}
        </div>
      )}

      {/* ── Bulk bar ── */}
      {selectedShown.size > 0 && (
        <div className="invdb-bulk" role="toolbar" aria-label="Bulk actions">
          <span className="invdb-bulk-count">{selectedShown.size} selected</span>
          <span className="invdb-bulk-sep" />
          <button type="button" disabled={bulkBusy} onClick={() => bulk({ verification: 'verified' })}>Mark verified</button>
          <button type="button" disabled={bulkBusy} onClick={() => bulk({ verification: 'pending' })}>Mark pending</button>
          <button type="button" disabled={bulkBusy} onClick={() => bulk({ status: 'available' })}>Available</button>
          <button type="button" disabled={bulkBusy} onClick={() => bulk({ status: 'unavailable' })}>Unavailable</button>
          <button type="button" className="invdb-bulk-x" onClick={() => setSelected(new Set())} aria-label="Clear selection"><Ico d={I.close} size={14} stroke={2.2} /></button>
        </div>
      )}

      {/* ── Side peek ── */}
      {peek && (
        <Peek
          b={peek}
          index={peekIndex}
          total={shown.length}
          onPrev={peekIndex > 0 ? () => setPeekId(shown[peekIndex - 1].id) : undefined}
          onNext={peekIndex >= 0 && peekIndex < shown.length - 1 ? () => setPeekId(shown[peekIndex + 1].id) : undefined}
          onClose={() => setPeekId(null)}
          statusCell={statusCell(peek)}
          verCell={verCell(peek)}
          owner={ownerText(peek)}
          brand={brandOf(peek)}
          onEditDetails={() => onEditDetails(peek)}
          onEditPhotos={() => onEditPhotos(peek)}
          onMovePin={() => onMovePin(peek)}
          onDelete={() => onDelete(peek)}
        />
      )}
    </div>
  );
}

// ── Side peek ──────────────────────────────────────────────────────────────

function Row({ icon, label, children }: { icon: string; label: string; children: React.ReactNode }) {
  return (
    <div className="invdb-prop">
      <span className="invdb-prop-label"><Ico d={icon} size={14} />{label}</span>
      <div className="invdb-prop-value">{children}</div>
    </div>
  );
}

function Peek({ b, index, total, onPrev, onNext, onClose, statusCell, verCell, owner, brand, onEditDetails, onEditPhotos, onMovePin, onDelete }: {
  b: InvBoard; index: number; total: number; onPrev?: () => void; onNext?: () => void; onClose: () => void;
  statusCell: React.ReactNode; verCell: React.ReactNode; owner: React.ReactNode;
  brand: { brand: string | null; ends_on: string | null } | undefined;
  onEditDetails: () => void; onEditPhotos: () => void; onMovePin: () => void; onDelete: () => void;
}) {
  const [photoAt, setPhotoAt] = useState<{ id: string; i: number }>({ id: b.id, i: 0 });
  const photo = photoAt.id === b.id ? photoAt.i : 0;
  const setPhoto = (i: number) => setPhotoAt({ id: b.id, i });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return;
      // Leave keys alone while a dialog (editor, delete confirm) is open over the panel.
      if (document.querySelector('[role="dialog"]:not(.invdb-peek)')) return;
      if (e.key === 'Escape') onClose();
      else if ((e.key === 'ArrowUp' || e.key === 'k') && onPrev) { e.preventDefault(); onPrev(); }
      else if ((e.key === 'ArrowDown' || e.key === 'j') && onNext) { e.preventDefault(); onNext(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, onPrev, onNext]);

  const photos = b.photo_urls ?? [];
  const ends = brand?.ends_on ? new Date(brand.ends_on + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : null;
  const over = brand?.ends_on ? brand.ends_on < new Date().toISOString().slice(0, 10) : false;
  const size = b.width && b.height ? `${b.width}m × ${b.height}m` : null;

  return (
    <>
      <div className="invdb-scrim" onClick={onClose} />
      <aside className="invdb-peek" role="dialog" aria-modal="false" aria-label={b.name}>
        <div className="invdb-peek-bar">
          <div className="invdb-peek-nav">
            <button type="button" onClick={onPrev} disabled={!onPrev} aria-label="Previous board" title="Previous (↑)"><Ico d={I.chevUp} size={16} stroke={2} /></button>
            <button type="button" onClick={onNext} disabled={!onNext} aria-label="Next board" title="Next (↓)"><Ico d={I.chevDown} size={16} stroke={2} /></button>
            {index >= 0 && <span className="invdb-muted">{index + 1} of {total}</span>}
          </div>
          <div className="invdb-peek-nav">
            <a href={boardPath(b)} target="_blank" rel="noopener noreferrer" className="invdb-icon-btn" title="Open public page"><Ico d={I.external} size={15} /></a>
            <button type="button" className="invdb-icon-btn" onClick={onClose} aria-label="Close" title="Close (Esc)"><Ico d={I.close} size={16} stroke={2} /></button>
          </div>
        </div>

        <div className="invdb-peek-scroll">
          <div className="invdb-peek-cover">
            {photos.length ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photos[Math.min(photo, photos.length - 1)]} alt={b.name} />
                {photos.length > 1 && (
                  <div className="invdb-peek-dots">
                    {photos.map((_, i) => <button key={i} type="button" aria-label={`Photo ${i + 1}`} className={i === photo ? 'is-on' : ''} onClick={() => setPhoto(i)} />)}
                  </div>
                )}
                <button type="button" className="invdb-peek-photo-btn" onClick={onEditPhotos}>Edit photos</button>
              </>
            ) : (
              <button type="button" className="invdb-peek-nophoto" onClick={onEditPhotos}>
                <Ico d={I.photo} size={26} stroke={1.5} /><span>Add a photo</span>
              </button>
            )}
          </div>

          <div className="invdb-peek-body">
            <h2 className="invdb-peek-title">{displayName(b.name)}</h2>
            <p className="invdb-peek-addr">{b.address ? displayName(b.address) : placeText(b)}</p>

            <div className="invdb-props">
              <Row icon={I.status} label="Status">{statusCell}</Row>
              <Row icon={I.shield} label="Verification">
                {verCell}
                <span className="invdb-muted invdb-prop-note">{formatVerifiedDate(b.last_verified_at) ? `Checked ${formatVerifiedDate(b.last_verified_at)}` : 'Never checked'}</span>
              </Row>
              <Row icon={I.place} label="Location">{placeText(b)}</Row>
              <Row icon={I.pin} label="Map pin">
                {b.latitude != null && b.longitude != null
                  ? <span className="invdb-mono">{b.latitude.toFixed(5)}, {b.longitude.toFixed(5)}</span>
                  : <span className="invdb-warn">Not set</span>}
                <button type="button" className="invdb-link" onClick={onMovePin}>{b.latitude != null ? 'Move' : 'Add pin'}</button>
              </Row>
              <Row icon={I.format} label="Format">{boardFormatLabel(b.format)}</Row>
              <Row icon={I.size} label="Size">{size ?? <span className="invdb-muted">Not listed</span>}</Row>
              <Row icon={I.money} label="Rate">{b.asking_rate ? <span className="invdb-rate">{formatNaira(b.asking_rate)}<small>/mo</small></span> : <span className="invdb-muted">Not set · buyers see “Request quote”</span>}</Row>
              <Row icon={I.person} label="Owner">{owner}</Row>
              {brand && <Row icon={I.megaphone} label="Now showing">{brand.brand || 'A campaign'}{ends ? <span className="invdb-muted"> · {over ? 'ended' : 'ends'} {ends}</span> : null}</Row>}
              <Row icon={I.source} label="Source"><span className="invdb-wrap">{b.source ? displayName(b.source) : 'Added by hand'}</span></Row>
              <Row icon={I.clock} label="Added">{new Date(b.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</Row>
            </div>
          </div>
        </div>

        <div className="invdb-peek-actions">
          <button type="button" className="invdb-btn is-primary" onClick={onEditDetails}><Ico d={I.edit} size={14} />Edit details</button>
          <button type="button" className="invdb-btn" onClick={onEditPhotos}><Ico d={I.photo} size={14} />Photos</button>
          <button type="button" className="invdb-btn" onClick={onMovePin}><Ico d={I.pin} size={14} />Pin</button>
          <button type="button" className="invdb-btn is-danger" onClick={onDelete} aria-label={`Delete ${b.name}`}><Ico d={I.trash} size={14} /></button>
        </div>
      </aside>
    </>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────

const CSS = `
.invdb { --ink:#0B1220; --ink2:#3F4A5A; --mute:#8A94A6; --line:#ECEEF2; --line2:#F3F4F7; --bg:#F7F8FA; --brand:#1B4F8A; --brand-soft:#EEF4FB;
  font-family:'Inter',-apple-system,BlinkMacSystemFont,'SF Pro Text',system-ui,sans-serif; color:var(--ink); -webkit-font-smoothing:antialiased; }
.invdb *, .invdb *::before, .invdb *::after { box-sizing:border-box; }
.invdb button { font-family:inherit; }
.invdb-muted { color:var(--mute); }
.invdb-warn { color:#B45309; }
.invdb-mono { font-variant-numeric:tabular-nums; font-feature-settings:'tnum'; }

.invdb-head { display:flex; align-items:flex-end; justify-content:space-between; gap:16px; margin:4px 0 20px; flex-wrap:wrap; }
.invdb-eyebrow { margin:0 0 4px; font-size:12px; font-weight:600; color:var(--mute); letter-spacing:.02em; }
.invdb-title { margin:0; font-size:30px; line-height:1.1; font-weight:700; letter-spacing:-.025em; }
.invdb-sub { margin:6px 0 0; font-size:14px; color:var(--mute); }
.invdb-head-actions { display:flex; gap:8px; }

.invdb-btn { display:inline-flex; align-items:center; justify-content:center; gap:6px; height:36px; padding:0 14px; border-radius:10px; border:1px solid var(--line);
  background:#fff; color:var(--ink); font-size:13.5px; font-weight:600; text-decoration:none; cursor:pointer; white-space:nowrap;
  transition:background .15s, border-color .15s, box-shadow .15s, transform .1s; box-shadow:0 1px 1px rgba(16,24,40,.03); }
.invdb-btn:hover { background:#FAFAFB; border-color:#E1E4EA; }
.invdb-btn:active { transform:scale(.98); }
.invdb-btn.is-primary { background:var(--brand); border-color:var(--brand); color:#fff; box-shadow:0 1px 2px rgba(27,79,138,.25), inset 0 1px 0 rgba(255,255,255,.12); }
.invdb-btn.is-primary:hover { background:#174576; }
.invdb-btn.is-danger { color:#B42318; }
.invdb-btn.is-danger:hover { background:#FEF3F2; border-color:#FECDCA; }

/* Attention strip */
.invdb-health { display:flex; align-items:stretch; gap:12px; margin-bottom:18px; }
.invdb-quality { display:flex; align-items:center; gap:12px; padding:12px 18px 12px 14px; background:#fff; border:1px solid var(--line); border-radius:16px; flex-shrink:0; }
.invdb-quality-num { margin:0; font-size:22px; font-weight:700; letter-spacing:-.02em; line-height:1.1; font-variant-numeric:tabular-nums; }
.invdb-quality-label { margin:2px 0 0; font-size:12px; color:var(--mute); }
.invdb-issues { flex:1; display:grid; grid-template-columns:repeat(5,minmax(0,1fr)); gap:8px; }
.invdb-issue { display:flex; flex-direction:column; align-items:flex-start; justify-content:center; gap:3px; padding:10px 14px; background:#fff; border:1px solid var(--line);
  border-radius:14px; cursor:pointer; text-align:left; transition:border-color .15s, background .15s, box-shadow .15s; min-width:0; }
.invdb-issue:hover:not(:disabled) { border-color:#D9DEE6; box-shadow:0 2px 8px -4px rgba(16,24,40,.12); }
.invdb-issue.is-on { background:var(--brand-soft); border-color:#BFD3EA; box-shadow:0 0 0 3px rgba(27,79,138,.08); }
.invdb-issue:disabled { cursor:default; }
.invdb-issue-num { font-size:20px; font-weight:700; letter-spacing:-.02em; color:#B45309; line-height:1.15; font-variant-numeric:tabular-nums; display:flex; align-items:center; min-height:23px; }
.invdb-issue.is-done .invdb-issue-num { color:#16A34A; }
.invdb-issue.is-done .invdb-issue-label { color:var(--mute); }
.invdb-issue.is-on .invdb-issue-num { color:var(--brand); }
.invdb-issue-label { font-size:12.5px; color:var(--ink2); font-weight:500; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:100%; }

/* Toolbar */
.invdb-toolbar { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:0 0 12px; border-bottom:1px solid var(--line); margin-bottom:14px; flex-wrap:wrap; }
.invdb-views { display:inline-flex; padding:3px; background:#EFF1F4; border-radius:11px; gap:2px; }
.invdb-view { display:inline-flex; align-items:center; gap:6px; height:30px; padding:0 12px; border:none; border-radius:8px; background:transparent; color:#5B6576;
  font-size:13px; font-weight:500; cursor:pointer; transition:background .15s, color .15s, box-shadow .15s; }
.invdb-view:hover { color:var(--ink); }
.invdb-view.is-on { background:#fff; color:var(--ink); font-weight:600; box-shadow:0 1px 3px rgba(16,24,40,.1), 0 0 0 .5px rgba(16,24,40,.04); }
.invdb-tools { display:flex; align-items:center; gap:6px; flex-wrap:wrap; }
.invdb-search { display:flex; align-items:center; gap:7px; height:34px; padding:0 10px; width:260px; border-radius:10px; background:#fff; border:1px solid var(--line); color:var(--mute);
  transition:border-color .15s, box-shadow .15s; }
.invdb-search:focus-within { border-color:#9DB9DA; box-shadow:0 0 0 3px rgba(27,79,138,.1); }
.invdb-search input { flex:1; min-width:0; border:none; outline:none; background:transparent; font:inherit; font-size:13.5px; color:var(--ink); }
.invdb-search input::placeholder { color:#A3ACBA; }
.invdb-search kbd { font:600 11px/1 inherit; color:#A3ACBA; border:1px solid var(--line); border-radius:5px; padding:3px 6px; }
.invdb-search button { display:flex; border:none; background:#EEF0F3; color:var(--ink2); border-radius:50%; width:18px; height:18px; align-items:center; justify-content:center; cursor:pointer; padding:0; }
.invdb-tool { display:inline-flex; align-items:center; gap:6px; height:34px; padding:0 11px; border-radius:10px; border:1px solid transparent; background:transparent; color:var(--ink2);
  font-size:13px; font-weight:500; cursor:pointer; white-space:nowrap; transition:background .15s; }
.invdb-tool:hover { background:#EFF1F4; }
.invdb-tool.is-active { color:var(--brand); background:var(--brand-soft); }
.invdb-count { display:inline-flex; align-items:center; justify-content:center; min-width:18px; height:18px; padding:0 5px; border-radius:9px; background:var(--brand); color:#fff; font-size:11px; font-weight:700; }

.invdb-chips { display:flex; align-items:center; gap:6px; flex-wrap:wrap; margin:-4px 0 14px; }
.invdb-chip { display:inline-flex; align-items:center; gap:5px; height:28px; padding:0 8px 0 10px; border-radius:8px; border:1px solid #D6E2F0; background:var(--brand-soft); color:var(--brand);
  font-size:12.5px; font-weight:500; cursor:pointer; }
.invdb-chip:hover { background:#E3ECF7; }
.invdb-chip-clear { border:none; background:none; color:var(--mute); font-size:12.5px; font-weight:500; cursor:pointer; padding:0 6px; }
.invdb-chip-clear:hover { color:var(--ink); }
.invdb-chips-count { margin-left:auto; font-size:12.5px; color:var(--mute); }

/* Pills and selects */
.invdb-pill { display:inline-flex; align-items:center; gap:6px; height:22px; padding:0 9px 0 8px; border-radius:6px; font-size:12px; font-weight:500; white-space:nowrap; }
.invdb-dot { width:7px; height:7px; border-radius:50%; flex-shrink:0; }
.invdb-select { display:inline-flex; align-items:center; gap:2px; border:none; background:transparent; padding:3px 4px 3px 3px; margin:-3px -4px -3px -3px; border-radius:8px; cursor:pointer; transition:background .12s; }
.invdb-select:hover, .invdb-select.is-open { background:#EFF1F4; }
.invdb-select.is-static { cursor:default; }
.invdb-select-chev { display:flex; color:#A3ACBA; opacity:0; transition:opacity .12s; }
.invdb-select:hover .invdb-select-chev, .invdb-select.is-open .invdb-select-chev { opacity:1; }
@media (hover:none) { .invdb-select-chev { opacity:1; } .invdb-search kbd { display:none; } }
.invdb-tag { display:inline-block; font-size:12px; font-weight:500; color:var(--ink2); background:#F1F3F6; padding:2px 8px; border-radius:6px; white-space:nowrap; }
.invdb-rate { font-weight:600; font-variant-numeric:tabular-nums; letter-spacing:-.01em; white-space:nowrap; }
.invdb-rate small { font-size:11px; font-weight:400; color:var(--mute); margin-left:1px; }

/* Popovers */
.invdb-pop { position:fixed; z-index:1300; background:rgba(255,255,255,.98); backdrop-filter:blur(20px) saturate(180%); -webkit-backdrop-filter:blur(20px) saturate(180%);
  border:1px solid rgba(16,24,40,.08); border-radius:12px; padding:5px; box-shadow:0 12px 32px -8px rgba(16,24,40,.22), 0 2px 6px rgba(16,24,40,.06);
  animation:invdbPop .14s cubic-bezier(.2,.9,.3,1.2); font-family:'Inter',-apple-system,system-ui,sans-serif; }
@keyframes invdbPop { from { opacity:0; transform:translateY(-4px) scale(.98); } to { opacity:1; transform:none; } }
.invdb-menu-title { margin:4px 8px 6px; font-size:11px; font-weight:600; color:#8A94A6; text-transform:uppercase; letter-spacing:.06em; }
.invdb-menu-item { display:flex; align-items:center; gap:8px; width:100%; min-height:34px; padding:5px 8px; border:none; background:transparent; border-radius:7px;
  font:inherit; font-size:13.5px; color:#0B1220; cursor:pointer; text-align:left; }
.invdb-menu-item:hover:not(:disabled) { background:#F1F3F6; }
.invdb-menu-item:disabled { opacity:.5; cursor:not-allowed; }
.invdb-menu-check { margin-left:auto; display:flex; color:#1B4F8A; }
.invdb-menu-note { margin-left:auto; font-size:11px; color:#8A94A6; }
.invdb-filter { display:flex; min-height:220px; max-height:360px; }
.invdb-filter-nav { width:128px; flex-shrink:0; border-right:1px solid #F0F1F4; padding-right:5px; display:flex; flex-direction:column; gap:1px; }
.invdb-filter-tab { display:flex; align-items:center; justify-content:space-between; height:32px; padding:0 8px; border:none; background:transparent; border-radius:7px; font:inherit; font-size:13px; color:#3F4A5A; cursor:pointer; text-align:left; }
.invdb-filter-tab:hover { background:#F5F6F8; }
.invdb-filter-tab.is-on { background:#EEF4FB; color:#1B4F8A; font-weight:600; }
.invdb-filter-list { flex:1; overflow-y:auto; padding-left:5px; }
.invdb-filter-opt { display:flex; align-items:center; gap:9px; min-height:32px; padding:4px 8px; border-radius:7px; cursor:pointer; font-size:13px; color:#0B1220; }
.invdb-filter-opt:hover { background:#F5F6F8; }
.invdb-filter-opt input { accent-color:#1B4F8A; width:15px; height:15px; margin:0; }
.invdb-filter-name { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }

/* Table */
.invdb-table-wrap { background:#fff; border:1px solid var(--line); border-radius:16px; overflow:hidden; box-shadow:0 1px 2px rgba(16,24,40,.03); }
.invdb-table-scroll { overflow-x:auto; }
.invdb-table { width:100%; border-collapse:separate; border-spacing:0; font-size:13.5px; }
.invdb-table thead th { position:sticky; top:0; z-index:2; background:#FBFBFC; text-align:left; font-size:12px; font-weight:500; color:var(--mute); padding:0 14px; height:38px;
  border-bottom:1px solid var(--line); white-space:nowrap; }
.invdb-table thead th svg { vertical-align:-2px; margin-right:4px; opacity:.75; }
.invdb-table th.is-num, .invdb-table td.is-num { text-align:right; }
.invdb-table tbody td { padding:0 14px; height:58px; border-bottom:1px solid var(--line2); white-space:nowrap; vertical-align:middle; color:var(--ink2); background:#fff; transition:background .1s; }
.invdb-table tbody tr { cursor:pointer; }
.invdb-table tbody tr:last-child td { border-bottom:none; }
.invdb-table tbody tr:hover td { background:#FAFBFC; }
.invdb-table tbody tr.is-selected td { background:#F3F7FC; }
.invdb-table tbody tr.is-peek td { background:#EEF4FB; }
.invdb-sticky { position:sticky; left:0; z-index:1; min-width:320px; max-width:380px; box-shadow:1px 0 0 var(--line2); }
.invdb-table thead th.invdb-sticky { z-index:3; }
.invdb-th-main { display:inline-flex; align-items:center; gap:10px; }
.invdb-th-main input, .invdb-cell-main input { accent-color:var(--brand); width:15px; height:15px; margin:0; cursor:pointer; flex-shrink:0; }
.invdb-cell-main { display:flex; align-items:center; gap:10px; min-width:0; }
.invdb-thumb { width:44px; height:34px; border-radius:7px; object-fit:cover; flex-shrink:0; display:block; background:#F1F3F6; box-shadow:inset 0 0 0 1px rgba(16,24,40,.06); }
.invdb-thumb.is-empty { display:flex; align-items:center; justify-content:center; color:#B6BDC9; border:1px dashed #D5DAE2; background:#FAFBFC; box-shadow:none; cursor:pointer; transition:color .15s, border-color .15s; }
.invdb-thumb.is-empty:hover { color:var(--brand); border-color:#9DB9DA; }
.invdb-name-wrap { display:flex; flex-direction:column; min-width:0; flex:1; }
.invdb-name { font-weight:600; color:var(--ink); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; margin:0; font-size:13.5px; letter-spacing:-.005em; }
.invdb-addr { font-size:12px; color:var(--mute); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; margin:1px 0 0; }
.invdb-open { flex-shrink:0; font-size:11.5px; font-weight:600; color:var(--ink2); background:#fff; border:1px solid var(--line); border-radius:6px; padding:3px 8px; opacity:0; transition:opacity .12s;
  box-shadow:0 1px 2px rgba(16,24,40,.06); }
.invdb-table tbody tr:hover .invdb-open { opacity:1; }
.invdb-place { display:block; max-width:220px; overflow:hidden; text-overflow:ellipsis; }
.invdb-sub-line { display:block; font-size:11.5px; margin-top:1px; }
.invdb-owner { max-width:240px; overflow:hidden; text-overflow:ellipsis; }
.invdb-owner .invdb-owner-note { font-size:12px; }
.invdb-foot { display:flex; justify-content:space-between; gap:12px; padding:10px 16px; border-top:1px solid var(--line); background:#FBFBFC; font-size:12px; color:var(--mute); }

/* Gallery */
.invdb-gallery { display:grid; grid-template-columns:repeat(auto-fill,minmax(250px,1fr)); gap:16px; }
.invdb-card { background:#fff; border:1px solid var(--line); border-radius:16px; overflow:hidden; cursor:pointer; outline:none;
  transition:transform .2s cubic-bezier(.2,.8,.2,1), box-shadow .2s, border-color .2s; box-shadow:0 1px 2px rgba(16,24,40,.03); }
.invdb-card:hover, .invdb-card:focus-visible { transform:translateY(-2px); box-shadow:0 12px 28px -12px rgba(16,24,40,.22); border-color:#E1E4EA; }
.invdb-card.is-selected { border-color:#9DB9DA; box-shadow:0 0 0 3px rgba(27,79,138,.12); }
.invdb-cover { position:relative; aspect-ratio:4/3; background:#F3F4F7; }
.invdb-cover-img { width:100%; height:100%; object-fit:cover; display:block; }
.invdb-cover-empty { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:6px; color:#A3ACBA; font-size:12.5px; font-weight:500; cursor:pointer;
  background:repeating-linear-gradient(135deg,#F6F7F9 0 10px,#F2F3F6 10px 20px); transition:color .15s; }
.invdb-cover-empty:hover { color:var(--brand); }
.invdb-card-check { position:absolute; top:10px; left:10px; width:18px; height:18px; margin:0; accent-color:var(--brand); cursor:pointer; opacity:0; transition:opacity .15s; }
.invdb-card:hover .invdb-card-check, .invdb-card-check:checked, .invdb-card:focus-within .invdb-card-check { opacity:1; }
@media (hover:none) { .invdb-card-check { opacity:1; } }
.invdb-cover-count { position:absolute; right:10px; bottom:10px; font-size:11px; font-weight:600; color:#fff; background:rgba(11,18,32,.55); backdrop-filter:blur(8px); -webkit-backdrop-filter:blur(8px); padding:3px 8px; border-radius:999px; }
.invdb-card-body { padding:12px 14px 14px; }
.invdb-card-body .invdb-name { font-size:14.5px; }
.invdb-card-pills { display:flex; gap:6px; flex-wrap:wrap; margin:10px 0; }
.invdb-card-foot .invdb-muted, .invdb-kcard-foot .invdb-muted { white-space:nowrap; }
.invdb-card-foot { display:flex; align-items:center; justify-content:space-between; gap:8px; padding-top:10px; border-top:1px solid var(--line2); }

/* Board (kanban) */
.invdb-kanban { display:flex; gap:14px; overflow-x:auto; padding-bottom:12px; align-items:flex-start; scroll-snap-type:x proximity; }
.invdb-col { flex:0 0 290px; min-width:0; width:290px; background:#F4F5F7; border-radius:16px; padding:10px; scroll-snap-align:start; transition:background .15s, box-shadow .15s; border:1px solid transparent; }
.invdb-col.is-drop { background:var(--brand-soft); border-color:#BFD3EA; }
.invdb-col-head { display:flex; align-items:center; justify-content:space-between; gap:8px; padding:2px 4px 10px; font-size:13px; }
.invdb-col-name { font-weight:600; color:var(--ink); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.invdb-col-body { display:flex; flex-direction:column; gap:8px; max-height:68vh; overflow-y:auto; margin:0 -4px; padding:0 4px 2px; }
.invdb-kcard { background:#fff; border-radius:12px; padding:10px 12px; cursor:pointer; box-shadow:0 1px 2px rgba(16,24,40,.06), 0 0 0 1px rgba(16,24,40,.04); outline:none;
  transition:box-shadow .15s, transform .15s, opacity .15s; }
.invdb-kcard:hover, .invdb-kcard:focus-visible { box-shadow:0 6px 16px -8px rgba(16,24,40,.25), 0 0 0 1px rgba(16,24,40,.06); }
.invdb-kcard[draggable="true"] { cursor:grab; }
.invdb-kcard.is-dragging { opacity:.4; transform:rotate(1.5deg); }
.invdb-kcard-img { width:calc(100% + 24px); max-width:none; height:120px; object-fit:cover; display:block; margin:-10px -12px 10px; border-radius:12px 12px 0 0; }
.invdb-kcard-foot { display:flex; align-items:center; justify-content:space-between; gap:8px; margin-top:8px; }
.invdb-col-empty { margin:0; padding:18px 0; text-align:center; font-size:12.5px; color:#A3ACBA; border:1.5px dashed #DCE0E6; border-radius:12px; }

/* Map */
.invdb-map { position:relative; height:min(72vh,720px); min-height:420px; border-radius:16px; overflow:hidden; border:1px solid var(--line); }
.invdb-map-loading { height:100%; display:flex; align-items:center; justify-content:center; background:#F3F4F7; }
.invdb-spinner { width:22px; height:22px; border:2px solid #E2E8F0; border-top-color:#1B4F8A; border-radius:50%; animation:invdbSpin .7s linear infinite; }
@keyframes invdbSpin { to { transform:rotate(360deg); } }
.invdb-map-note { position:absolute; top:12px; right:12px; z-index:5; border:1px solid rgba(16,24,40,.08); background:rgba(255,255,255,.94); backdrop-filter:blur(12px); -webkit-backdrop-filter:blur(12px);
  border-radius:10px; padding:8px 12px; font-size:12.5px; font-weight:500; color:#92400E; cursor:pointer; box-shadow:0 4px 12px -4px rgba(16,24,40,.15); }

/* Empty */
.invdb-empty { display:flex; flex-direction:column; align-items:center; gap:8px; padding:72px 16px; background:#fff; border:1px solid var(--line); border-radius:16px; text-align:center; }
.invdb-empty p { margin:0; font-size:14px; }
.invdb-empty-title { font-size:16px !important; font-weight:600; color:var(--ink); }
.invdb-empty .invdb-btn { margin-top:8px; }

/* Bulk bar */
.invdb-bulk { position:fixed; left:50%; bottom:24px; transform:translateX(-50%); z-index:1100; display:flex; align-items:center; gap:2px; padding:6px 6px 6px 16px;
  background:rgba(17,24,39,.92); backdrop-filter:blur(20px) saturate(180%); -webkit-backdrop-filter:blur(20px) saturate(180%); color:#fff; border-radius:14px;
  box-shadow:0 18px 40px -12px rgba(0,0,0,.45); animation:invdbUp .22s cubic-bezier(.2,.9,.3,1.1); max-width:calc(100vw - 32px); overflow-x:auto; }
@keyframes invdbUp { from { opacity:0; transform:translate(-50%,10px); } to { opacity:1; transform:translate(-50%,0); } }
.invdb-bulk-count { font-size:13px; font-weight:600; white-space:nowrap; }
.invdb-bulk-sep { width:1px; height:18px; background:rgba(255,255,255,.18); margin:0 8px; flex-shrink:0; }
.invdb-bulk button { height:32px; padding:0 11px; border:none; border-radius:9px; background:transparent; color:#E5E7EB; font-size:13px; font-weight:500; cursor:pointer; white-space:nowrap; }
.invdb-bulk button:hover:not(:disabled) { background:rgba(255,255,255,.1); color:#fff; }
.invdb-bulk button:disabled { opacity:.5; cursor:wait; }
.invdb-bulk .invdb-bulk-x { display:flex; align-items:center; justify-content:center; width:32px; padding:0; margin-left:4px; }

/* Side peek */
.invdb-scrim { position:fixed; inset:0; z-index:1150; background:rgba(11,18,32,.12); animation:invdbFade .2s ease; }
@keyframes invdbFade { from { opacity:0; } to { opacity:1; } }
.invdb-peek { position:fixed; top:0; right:0; bottom:0; z-index:1200; width:min(500px,100vw); background:#fff; display:flex; flex-direction:column;
  box-shadow:-24px 0 60px -20px rgba(16,24,40,.28), -1px 0 0 rgba(16,24,40,.06); animation:invdbSlide .28s cubic-bezier(.2,.9,.25,1); font-family:'Inter',-apple-system,system-ui,sans-serif; }
@keyframes invdbSlide { from { transform:translateX(24px); opacity:0; } to { transform:none; opacity:1; } }
.invdb-peek-bar { display:flex; align-items:center; justify-content:space-between; height:52px; padding:0 12px; border-bottom:1px solid var(--line2); flex-shrink:0; }
.invdb-peek-nav { display:flex; align-items:center; gap:4px; font-size:12.5px; }
.invdb-peek-nav > button, .invdb-icon-btn { display:inline-flex; align-items:center; justify-content:center; width:32px; height:32px; border:none; border-radius:8px; background:transparent; color:var(--ink2); cursor:pointer; text-decoration:none; }
.invdb-peek-nav > button:hover:not(:disabled), .invdb-icon-btn:hover { background:#F1F3F6; color:var(--ink); }
.invdb-peek-nav > button:disabled { opacity:.3; cursor:default; }
.invdb-peek-nav .invdb-muted { margin-left:4px; font-variant-numeric:tabular-nums; }
.invdb-peek-scroll { flex:1; overflow-y:auto; }
.invdb-peek-cover { position:relative; aspect-ratio:16/10; background:#F3F4F7; }
.invdb-peek-cover img { width:100%; height:100%; object-fit:cover; display:block; }
.invdb-peek-dots { position:absolute; left:50%; bottom:12px; transform:translateX(-50%); display:flex; gap:6px; padding:5px 8px; border-radius:999px; background:rgba(11,18,32,.35); backdrop-filter:blur(8px); -webkit-backdrop-filter:blur(8px); }
.invdb-peek-dots button { width:7px; height:7px; border-radius:50%; border:none; padding:0; background:rgba(255,255,255,.5); cursor:pointer; }
.invdb-peek-dots button.is-on { background:#fff; }
.invdb-peek-photo-btn { position:absolute; top:12px; right:12px; border:none; border-radius:9px; padding:7px 11px; font-size:12.5px; font-weight:600; color:var(--ink);
  background:rgba(255,255,255,.9); backdrop-filter:blur(10px); -webkit-backdrop-filter:blur(10px); cursor:pointer; box-shadow:0 2px 8px rgba(16,24,40,.12); }
.invdb-peek-nophoto { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:8px; border:none; cursor:pointer; color:#A3ACBA; font-size:13.5px; font-weight:500;
  background:repeating-linear-gradient(135deg,#F6F7F9 0 12px,#F2F3F6 12px 24px); }
.invdb-peek-nophoto:hover { color:var(--brand); }
.invdb-peek-body { padding:22px 24px 28px; }
.invdb-peek-title { margin:0; font-size:24px; line-height:1.2; font-weight:700; letter-spacing:-.02em; color:var(--ink); }
.invdb-peek-addr { margin:6px 0 20px; font-size:14px; color:var(--mute); line-height:1.5; }
.invdb-props { display:flex; flex-direction:column; }
.invdb-prop { display:grid; grid-template-columns:130px 1fr; align-items:center; gap:12px; min-height:40px; padding:4px 0; border-top:1px solid var(--line2); font-size:13.5px; }
.invdb-prop-label { display:flex; align-items:center; gap:8px; color:var(--mute); }
.invdb-prop-value { display:flex; align-items:center; gap:8px; flex-wrap:wrap; color:var(--ink); min-width:0; }
.invdb-prop-note { font-size:12px; }
.invdb-wrap { overflow-wrap:anywhere; }
.invdb-link { border:none; background:none; padding:0; font-size:13px; font-weight:600; color:var(--brand); cursor:pointer; }
.invdb-link:hover { text-decoration:underline; }
.invdb-peek-actions { display:flex; gap:8px; padding:12px 16px calc(12px + env(safe-area-inset-bottom)); border-top:1px solid var(--line2); background:#fff; flex-shrink:0; }
.invdb-peek-actions .invdb-btn.is-primary { flex:1; }

/* Small screens */
@media (max-width: 1100px) {
  .invdb-health { flex-direction:column; }
  .invdb-quality { align-self:stretch; }
}
@media (max-width: 760px) {
  .invdb-title { font-size:26px; }
  .invdb-head-actions { width:100%; }
  .invdb-head-actions .invdb-btn { flex:1; }
  .invdb-issues { display:flex; overflow-x:auto; scroll-snap-type:x proximity; margin:0 -16px; padding:0 16px 2px; scrollbar-width:none; }
  .invdb-issues::-webkit-scrollbar { display:none; }
  .invdb-issue { flex:0 0 auto; min-width:120px; scroll-snap-align:start; }
  .invdb-toolbar { flex-direction:column; align-items:stretch; }
  .invdb-views { display:grid; grid-template-columns:repeat(4,1fr); }
  .invdb-view { justify-content:center; padding:0 6px; }
  .invdb-search { width:auto; flex:1 1 100%; }
  .invdb-tool-text { display:none; }
  .invdb-gallery { grid-template-columns:repeat(auto-fill,minmax(160px,1fr)); gap:10px; }
  .invdb-card-body { padding:10px 11px 12px; }
  .invdb-card-body .invdb-name { font-size:13.5px; }
  .invdb-card-pills .invdb-pill:nth-child(2) { display:none; }
  .invdb-card-foot .invdb-tag { display:none; }
  .invdb-card-foot { justify-content:flex-end; }
  .invdb-quality { padding:10px 14px; }
  .invdb-quality svg { width:40px; height:40px; }
  .invdb-quality-num { font-size:19px; }
  .invdb-col { flex-basis:78vw; }
  .invdb-sticky { min-width:240px; max-width:260px; }
  .invdb-foot span:last-child { display:none; }
  .invdb-prop { grid-template-columns:110px 1fr; }
  .invdb-peek-body { padding:18px 18px 24px; }
  .invdb-bulk { bottom:16px; }
  .invdb-chips-count { width:100%; margin-left:0; }
}
`;
