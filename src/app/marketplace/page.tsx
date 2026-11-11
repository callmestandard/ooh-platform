'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { supabase } from '@/lib/supabase';
import { attachVisibleRates } from '@/lib/board-rates';
import { attachGuidePrices, guideText, GUIDE_NOTE, type GuidePrice } from '@/lib/guide-prices';
import RequirePlatformAuth from '@/components/layout/RequirePlatformAuth';
import AccountNavButtons from '@/components/layout/AccountNavButtons';
import { computeTrustBadge, TrustBadgePill, type TrustBadge } from '@/lib/agent-listings';
import { VerificationBadge, dimensionsText, illuminationText, locationText, verificationOf, UNKNOWN } from '@/lib/board-verification';
import { FORMAT_GROUPS, formatGroup } from '@/lib/board-formats';
import { MVP_MODE } from '@/lib/mvp';
import { boardPath } from '@/lib/public-links';
import { displayName } from '@/lib/display-name';
import WhatsAppButton from '@/components/WhatsAppButton';
import type { MapBoard } from './MarketplaceMap';

const MarketplaceMap = dynamic(() => import('./MarketplaceMap'), {
  ssr: false,
  loading: () => (
    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#F1F5F9' }}>
      <div style={{ width: 24, height: 24, border: '2px solid #E2E8F0', borderTopColor: '#1B4F8A', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
    </div>
  ),
});

// ── Types ──────────────────────────────────────────────────────────────────

type Board = {
  id: string;
  name: string;
  address: string;
  city: string;
  state: string;
  format: string;
  asking_rate: number | null;
  width: number | null;
  height: number | null;
  illuminated: boolean | null;
  face_count: number | null;
  status: 'available' | 'booked' | 'unavailable' | 'decommissioned';
  photo_urls: string[] | null;
  area: string | null;
  verification_status: string | null;
  latitude: number | null;
  longitude: number | null;
  activeListing?: { id: string; sell_price: number; badge: TrustBadge } | null;
  guide?: GuidePrice | null;
};

/** The price an agency actually pays: the agent's sell price when the
 * board has an active listing, otherwise the owner's own asking rate. */
function effectiveRate(board: Board): number | null {
  return board.activeListing ? board.activeListing.sell_price : (board.asking_rate || null);
}

/** The rate as shown to buyers: exact when they may see it, else the guide range, else on request. */
function rateText(board: Board): string {
  const r = effectiveRate(board);
  if (r) return formatNaira(r);
  return board.guide ? guideText(board.guide) : 'Request quote';
}

/** True when a monthly figure (exact or guide) is shown. */
function hasPrice(board: Board): boolean {
  return !!effectiveRate(board) || !!board.guide;
}

/** "per month" or "per month · guide". */
function priceSub(board: Board): string {
  return effectiveRate(board) ? 'per month' : 'per month · guide price';
}

// ── Constants ──────────────────────────────────────────────────────────────

const FORMAT_LABELS: Record<string, string> = {
  billboard:    'Billboard',
  unipole:      'Unipole',
  gantry:       'Gantry',
  bridge_panel: 'Bridge Panel',
  wall_drape:   'Wall Drape',
  led:          'LED Screen',
};

// Abuja's boards are saved under the state "FCT".
const stateLabel = (st: string) => (st === 'FCT' ? 'Abuja (FCT)' : st);
const QUICK_CITY_STATE: Record<string, string> = { Abuja: 'FCT', 'Port Harcourt': 'Rivers', Ibadan: 'Oyo' };

const DIGITAL_FORMATS = ['digital', 'led'];

const VERIFICATION_FILTERS = [
  { value: 'all',              label: 'Any verification' },
  { value: 'any_verified',     label: 'Verified or partner' },
  { value: 'partner_verified', label: 'Partner verified' },
  { value: 'verified',         label: 'Verified' },
  { value: 'pending',          label: 'Pending verification' },
];

const BUDGET_BANDS = [
  { label: 'Any budget',      value: Infinity },
  { label: 'Under ₦500K/mo',  value: 500_000 },
  { label: 'Under ₦1M/mo',    value: 1_000_000 },
  { label: 'Under ₦3M/mo',    value: 3_000_000 },
  { label: 'Under ₦5M/mo',    value: 5_000_000 },
  { label: 'Under ₦10M/mo',   value: 10_000_000 },
];


// ── Helpers ────────────────────────────────────────────────────────────────

function formatNaira(n: number) {
  if (n >= 1_000_000) return `₦${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)    return `₦${(n / 1_000).toFixed(0)}K`;
  return `₦${n.toLocaleString()}`;
}

function BoardMockup({ format, illuminated, status }: { format: string; illuminated: boolean; status: string }) {
  const accent = status === 'available' ? '#1B4F8A' : status === 'booked' ? '#3B82F6' : '#94A3B8';
  const isLed = format === 'led';

  if (format === 'unipole') {
    return (
      <svg viewBox="0 0 200 140" width="100%" style={{ display: 'block' }}>
        <rect x="60" y="10" width="80" height="50" rx="3" fill={isLed ? '#0F172A' : '#E8EDF5'} stroke={accent} strokeWidth="2"/>
        {isLed && <rect x="63" y="13" width="74" height="44" rx="1" fill={accent} opacity="0.15"/>}
        <rect x="64" y="15" width="72" height="40" rx="1" fill={isLed ? '#1e293b' : '#F8FAFC'}/>
        {isLed
          ? <text x="100" y="40" textAnchor="middle" fontSize="10" fill={accent} fontWeight="700">LED</text>
          : <rect x="70" y="22" width="60" height="26" rx="1" fill={accent} opacity="0.08"/>
        }
        <line x1="100" y1="60" x2="100" y2="130" stroke="#CBD5E1" strokeWidth="3"/>
        <ellipse cx="100" cy="130" rx="20" ry="4" fill="#E2E8F0"/>
        {illuminated && <circle cx="155" cy="12" r="5" fill="#F59E0B" opacity="0.8"/>}
      </svg>
    );
  }

  if (format === 'gantry') {
    return (
      <svg viewBox="0 0 200 140" width="100%" style={{ display: 'block' }}>
        <rect x="20" y="30" width="160" height="60" rx="3" fill={isLed ? '#0F172A' : '#E8EDF5'} stroke={accent} strokeWidth="2"/>
        <rect x="24" y="34" width="152" height="52" rx="1" fill={isLed ? '#1e293b' : '#F8FAFC'}/>
        {isLed
          ? <text x="100" y="64" textAnchor="middle" fontSize="12" fill={accent} fontWeight="700">LED GANTRY</text>
          : <rect x="30" y="40" width="140" height="40" rx="1" fill={accent} opacity="0.08"/>
        }
        <line x1="30" y1="90" x2="30" y2="130" stroke="#CBD5E1" strokeWidth="4"/>
        <line x1="170" y1="90" x2="170" y2="130" stroke="#CBD5E1" strokeWidth="4"/>
        {illuminated && <><circle cx="45" cy="28" r="4" fill="#F59E0B" opacity="0.8"/><circle cx="155" cy="28" r="4" fill="#F59E0B" opacity="0.8"/></>}
      </svg>
    );
  }

  if (format === 'bridge_panel') {
    return (
      <svg viewBox="0 0 200 140" width="100%" style={{ display: 'block' }}>
        <line x1="10" y1="70" x2="190" y2="70" stroke="#CBD5E1" strokeWidth="6"/>
        <rect x="50" y="40" width="100" height="45" rx="2" fill={accent} opacity="0.12" stroke={accent} strokeWidth="1.5"/>
        <rect x="53" y="43" width="94" height="39" rx="1" fill="#F8FAFC"/>
        <rect x="58" y="48" width="84" height="29" rx="1" fill={accent} opacity="0.08"/>
        <line x1="50" y1="40" x2="50" y2="85" stroke={accent} strokeWidth="1.5"/>
        <line x1="150" y1="40" x2="150" y2="85" stroke={accent} strokeWidth="1.5"/>
        {illuminated && <rect x="50" y="38" width="100" height="2" rx="1" fill="#F59E0B" opacity="0.7"/>}
      </svg>
    );
  }

  if (format === 'wall_drape') {
    return (
      <svg viewBox="0 0 200 140" width="100%" style={{ display: 'block' }}>
        <rect x="20" y="10" width="160" height="110" rx="0" fill="#E2E8F0"/>
        <rect x="24" y="14" width="152" height="102" rx="0" fill="#F8FAFC"/>
        <rect x="28" y="18" width="144" height="94" rx="0" fill={accent} opacity="0.07"/>
        <line x1="20" y1="10" x2="20" y2="120" stroke="#CBD5E1" strokeWidth="2"/>
        <line x1="180" y1="10" x2="180" y2="120" stroke="#CBD5E1" strokeWidth="2"/>
        {[0,1,2,3,4].map(i => (
          <line key={i} x1={24 + i * 16} y1="10" x2={24 + i * 16} y2="14" stroke="#94A3B8" strokeWidth="1" strokeDasharray="2 2"/>
        ))}
      </svg>
    );
  }

  // Default: billboard
  return (
    <svg viewBox="0 0 200 140" width="100%" style={{ display: 'block' }}>
      <rect x="20" y="15" width="160" height="80" rx="4" fill={isLed ? '#0F172A' : '#E8EDF5'} stroke={accent} strokeWidth="2"/>
      <rect x="24" y="19" width="152" height="72" rx="2" fill={isLed ? '#1e293b' : '#F8FAFC'}/>
      {isLed
        ? <text x="100" y="60" textAnchor="middle" fontSize="12" fill={accent} fontWeight="700">LED</text>
        : <rect x="30" y="25" width="140" height="60" rx="2" fill={accent} opacity="0.08"/>
      }
      <line x1="80" y1="95" x2="80" y2="130" stroke="#CBD5E1" strokeWidth="3"/>
      <line x1="120" y1="95" x2="120" y2="130" stroke="#CBD5E1" strokeWidth="3"/>
      <line x1="70" y1="130" x2="130" y2="130" stroke="#CBD5E1" strokeWidth="2"/>
      {illuminated && <><circle cx="25" cy="18" r="4" fill="#F59E0B" opacity="0.8"/><circle cx="175" cy="18" r="4" fill="#F59E0B" opacity="0.8"/></>}
    </svg>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cfg: Record<string, { label: string; color: string; bg: string }> = {
    available:      { label: 'Available',      color: '#059669', bg: '#ECFDF5' },
    booked:         { label: 'Booked',         color: '#3B82F6', bg: '#EFF6FF' },
    unavailable:    { label: 'Unavailable',    color: '#D97706', bg: '#FFFBEB' },
    decommissioned: { label: 'Decommissioned', color: '#475569', bg: '#F1F5F9' },
  };
  const { label, color, bg } = cfg[status] ?? cfg.available;
  return (
    <span style={{
      fontSize: '0.6875rem', fontWeight: 700, color, background: bg,
      padding: '3px 8px', borderRadius: 999,
      display: 'inline-flex', alignItems: 'center', gap: 4,
    }}>
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: color, display: 'inline-block' }} />
      {label}
    </span>
  );
}

// ── Nav ────────────────────────────────────────────────────────────────────

function Logo() {
  return (
    <svg width="120" height="28" viewBox="0 0 160 36" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="2" width="28" height="18" rx="2" fill="#1B4F8A"/>
      <rect x="3" y="5" width="22" height="12" rx="1.5" fill="#fff"/>
      <rect x="10" y="20" width="2.5" height="6" fill="#1B4F8A"/>
      <rect x="15.5" y="20" width="2.5" height="6" fill="#1B4F8A"/>
      <rect x="34" y="6" width="24" height="16" rx="2" fill="#1B4F8A"/>
      <rect x="37" y="9" width="18" height="10" rx="1.5" fill="#fff"/>
      <rect x="42" y="22" width="2.5" height="6" fill="#1B4F8A"/>
      <rect x="47.5" y="22" width="2.5" height="6" fill="#1B4F8A"/>
      <rect x="64" y="2" width="4" height="28" rx="2" fill="#1B4F8A"/>
      <rect x="80" y="2" width="4" height="28" rx="2" fill="#1B4F8A"/>
      <rect x="64" y="13" width="20" height="4" rx="1" fill="#1B4F8A"/>
      <circle cx="88" cy="4" r="3" fill="#F59E0B"/>
      <text x="98" y="20" fontFamily="Georgia, serif" fontSize="18" fontWeight="700" fill="#0F172A" letterSpacing="-0.5">OOH</text>
      <text x="99" y="30" fontFamily="Arial, sans-serif" fontSize="6.5" fontWeight="400" fill="#94A3B8" letterSpacing="3">PLATFORM</text>
    </svg>
  );
}

// ── Detail Modal ───────────────────────────────────────────────────────────

function BoardModal({ board, onClose, onRequestQuote }: { board: Board; onClose: () => void; onRequestQuote: () => void }) {
  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(15,23,42,0.5)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: '#fff', borderRadius: 20, width: '100%', maxWidth: 560,
        boxShadow: '0 24px 60px rgba(0,0,0,0.18)',
        overflow: 'hidden', animation: 'modalIn 0.2s ease',
      }}>
        {/* Photo / Mockup header */}
        {board.photo_urls?.[0] ? (
          <div style={{ height: 200, overflow: 'hidden', background: '#0F172A' }}>
            <img src={board.photo_urls[0]} alt={board.name} style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: 0.9 }} />
          </div>
        ) : (
          <div style={{ background: '#F8FAFC', padding: '24px 24px 0', borderBottom: '1px solid #F1F5F9' }}>
            <div style={{ maxWidth: 300, margin: '0 auto' }}>
              <BoardMockup format={board.format} illuminated={!!board.illuminated} status={board.status} />
            </div>
          </div>
        )}

        {/* Content */}
        <div style={{ padding: 24 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 }}>
            <div>
              <h2 style={{ fontSize: '1.125rem', fontWeight: 700, color: '#0F172A', margin: '0 0 4px', letterSpacing: '-0.02em' }}>
                {displayName(board.name)}
              </h2>
              <p style={{ fontSize: '0.8125rem', color: '#64748B', margin: 0 }}>{locationText(board)}</p>
            </div>
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8', padding: 4, marginTop: -4 }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 20 }}>
            {[
              { label: 'Format',       value: FORMAT_LABELS[board.format] ?? board.format ?? UNKNOWN },
              { label: 'Dimensions',   value: dimensionsText(board.width, board.height) },
              { label: 'Area',         value: board.area || UNKNOWN },
              { label: 'City',         value: board.city || UNKNOWN },
              { label: 'Illumination', value: illuminationText(board.illuminated) },
              { label: effectiveRate(board) || !board.guide ? 'Monthly rate' : 'Guide price / month', value: rateText(board) },
            ].map(({ label, value }) => (
              <div key={label} style={{ background: '#F8FAFC', borderRadius: 10, padding: '10px 14px' }}>
                <p style={{ fontSize: '0.6875rem', color: '#94A3B8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 3px' }}>{label}</p>
                <p style={{ fontSize: value === UNKNOWN ? '0.8125rem' : '0.875rem', fontWeight: value === UNKNOWN ? 500 : 600, color: value === UNKNOWN ? '#94A3B8' : '#0F172A', margin: 0 }}>{value}</p>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
            <StatusBadge status={board.status} />
            <VerificationBadge status={board.verification_status} small />
            {board.activeListing && <TrustBadgePill badge={board.activeListing.badge} small />}
          </div>

          {board.status === 'available' ? (
            <a
              href={boardPath(board)}
              style={{
                display: 'block', width: '100%', padding: '12px', background: '#1B4F8A', color: '#fff',
                border: 'none', borderRadius: 10, fontSize: '0.9375rem', fontWeight: 600,
                cursor: 'pointer', fontFamily: 'inherit', textDecoration: 'none', textAlign: 'center',
                boxSizing: 'border-box',
              }}
            >
              View &amp; request this location{hasPrice(board) ? ` — ${rateText(board)}/mo` : ''}
            </a>
          ) : board.status === 'booked' ? (
            <button
              onClick={onRequestQuote}
              style={{
                display: 'block', width: '100%', padding: '12px', background: '#fff', color: '#1B4F8A',
                border: '1.5px solid #BFDBFE', borderRadius: 10, fontSize: '0.9375rem', fontWeight: 600,
                cursor: 'pointer', fontFamily: 'inherit', textAlign: 'center', boxSizing: 'border-box',
              }}
            >
              Currently booked — request future dates →
            </button>
          ) : (
            <div style={{ background: '#F8FAFC', borderRadius: 10, padding: '12px 16px', textAlign: 'center' }}>
              <p style={{ fontSize: '0.875rem', color: '#64748B', margin: 0 }}>
                Currently unavailable — check back soon.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────

function MarketplaceContent() {
  const router = useRouter();
  const [boards, setBoards]         = useState<Board[]>([]);
  const [loading, setLoading]       = useState(true);
  const [search, setSearch]         = useState('');
  const [stateFilter, setStateFilter]   = useState('all');
  const [formatFilter, setFormatFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('available');
  const [priceMax, setPriceMax]     = useState(Infinity);
  const [areaFilter, setAreaFilter] = useState('all');
  const [kindFilter, setKindFilter] = useState<'all' | 'static' | 'digital'>('all');
  const [verifyFilter, setVerifyFilter] = useState('all');
  const [view, setView]             = useState<'grid' | 'map'>('grid');
  const [selected, setSelected]     = useState<Board | null>(null);

  // Deep links: /marketplace?format=unipole (formats guide), ?state=Oyo and
  // ?q=Ibadan (homepage and city pages), ?view=map
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const f = q.get('format');
    if (f) setFormatFilter(f);
    const st = q.get('state');
    if (st) setStateFilter(st);
    const text = q.get('q');
    if (text) setSearch(text);
    if (q.get('view') === 'map') setView('map');
  }, []);

  function changeView(v: 'grid' | 'map') {
    setView(v);
    const url = new URL(window.location.href);
    if (v === 'map') url.searchParams.set('view', 'map'); else url.searchParams.delete('view');
    window.history.replaceState(null, '', url);
  }

  function changeState(st: string) {
    setStateFilter(st);
    setAreaFilter('all');
  }

  function clearFilters() {
    setSearch(''); setStateFilter('all'); setAreaFilter('all'); setFormatFilter('all');
    setKindFilter('all'); setVerifyFilter('all'); setStatusFilter('available'); setPriceMax(Infinity);
  }

  useEffect(() => {
    async function load() {
      const [{ data }, { data: listingsData }] = await Promise.all([
        supabase
          .from('boards')
          .select('id, name, address, city, state, area, format, asking_rate, width, height, illuminated, face_count, status, photo_urls, verification_status, latitude, longitude')
          .order('created_at', { ascending: false }),
        supabase.from('listings').select('id, board_id, sell_price, agent_id, board_authorizations(owner_verified)').eq('status', 'active'),
      ]);

      const listingsByBoard = new Map<string, any>();
      (listingsData || []).forEach((l: any) => { if (!listingsByBoard.has(l.board_id)) listingsByBoard.set(l.board_id, l); });

      const withBadges = ((data as Board[]) || []).map(b => {
        const l = listingsByBoard.get(b.id);
        if (!l) return b;
        const badge = computeTrustBadge({ agent_id: l.agent_id }, l.board_authorizations);
        return { ...b, activeListing: { id: l.id, sell_price: l.sell_price, badge } };
      });

      setBoards(await attachGuidePrices(await attachVisibleRates(withBadges)));
      setLoading(false);
    }
    load();
  }, []);

  const filtered = useMemo(() => {
    return boards.filter(b => {
      if (statusFilter !== 'all' && b.status !== statusFilter) return false;
      if (stateFilter !== 'all' && b.state !== stateFilter) return false;
      if (areaFilter !== 'all' && (b.area ?? '').trim() !== areaFilter) return false;
      if (formatFilter !== 'all') {
        const group = formatGroup(formatFilter);
        if (group ? !(group.formats as readonly string[]).includes(b.format) : b.format !== formatFilter) return false;
      }
      if (kindFilter !== 'all' && DIGITAL_FORMATS.includes(b.format) !== (kindFilter === 'digital')) return false;
      if (verifyFilter !== 'all') {
        const v = verificationOf(b);
        if (verifyFilter === 'any_verified' ? v === 'pending' : v !== verifyFilter) return false;
      }
      if ((effectiveRate(b) ?? 0) > priceMax) return false;
      if (search) {
        const q = search.toLowerCase();
        if (![b.name, b.address, b.city, b.area].some(t => (t ?? '').toLowerCase().includes(q))) return false;
      }
      return true;
    });
  }, [boards, statusFilter, stateFilter, areaFilter, formatFilter, kindFilter, verifyFilter, priceMax, search]);

  // States come from the listings themselves, busiest first.
  const stateOptions = useMemo(() => {
    const n = new Map<string, number>();
    boards.forEach(b => { const st = (b.state ?? '').trim(); if (st) n.set(st, (n.get(st) ?? 0) + 1); });
    if (stateFilter !== 'all' && !n.has(stateFilter)) n.set(stateFilter, 0); // keep a deep-linked state selectable
    return [...n.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([st]) => st);
  }, [boards, stateFilter]);

  // Areas come from the listings themselves, narrowed to the chosen state.
  const areas = useMemo(() => Array.from(new Set(
    boards.filter(b => stateFilter === 'all' || b.state === stateFilter).map(b => (b.area ?? '').trim()).filter(Boolean),
  )).sort(), [boards, stateFilter]);

  const mapBoards: MapBoard[] = useMemo(() => filtered
    .filter(b => typeof b.latitude === 'number' && typeof b.longitude === 'number')
    .map(b => ({
      id: b.id, name: b.name, area: b.area, city: b.city, format: b.format, photo_urls: b.photo_urls,
      verification_status: b.verification_status, latitude: b.latitude as number, longitude: b.longitude as number,
      rate: rateText(b), perMonth: hasPrice(b), guide: !effectiveRate(b) && !!b.guide,
    })), [filtered]);
  const unmapped = filtered.length - mapBoards.length;

  const filtersActive = !!search || stateFilter !== 'all' || areaFilter !== 'all' || formatFilter !== 'all'
    || kindFilter !== 'all' || verifyFilter !== 'all' || statusFilter !== 'available' || priceMax !== Infinity;

  const availableCount = boards.filter(b => b.status === 'available').length;

  // Booked boards can still be requested for future dates.
  function handleQuote() {
    const b = selected;
    setSelected(null);
    if (b) router.push(`${boardPath(b)}?request=1`);
  }

  return (
    <div style={{ minHeight: '100vh', flexShrink: 0, background: '#F8FAFC', fontFamily: "'Inter', -apple-system, sans-serif" }}>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes modalIn { from { opacity:0; transform:translateY(12px) scale(0.97); } to { opacity:1; transform:none; } }
        @keyframes fadeUp { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:translateY(0); } }
        .board-card { transition: box-shadow 0.18s, transform 0.18s; cursor: pointer; }
        .board-card:hover { box-shadow: 0 8px 24px rgba(27,79,138,0.12) !important; transform: translateY(-2px); }
        .filter-pill { transition: all 0.15s; cursor: pointer; border: none; font-family: inherit; }
        .filter-pill:hover { opacity: 0.85; }
        .nav-link { color: #64748B; text-decoration: none; font-size: 0.875rem; font-weight: 500; transition: color 0.15s; }
        .nav-link:hover { color: #0F172A; }
        .mk-select { padding: 7px 26px 7px 10px; border-radius: 8px; border: 1px solid #E2E8F0; font-size: 0.8125rem; color: #374151;
          background: #fff url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%2394A3B8' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E") no-repeat right 10px center;
          appearance: none; -webkit-appearance: none; font-family: inherit; cursor: pointer; outline: none; max-width: 100%; }
        .mk-select:focus { border-color: #1B4F8A; box-shadow: 0 0 0 3px rgba(27,79,138,0.1); }
        .mk-select.on { border-color: #1B4F8A; color: #1B4F8A; font-weight: 600; background-color: #EFF6FF; }
        .mk-select:disabled { opacity: 0.5; cursor: not-allowed; }
        .mk-seg { display: inline-flex; background: #fff; border: 1px solid #E2E8F0; border-radius: 10px; padding: 3px; gap: 2px; }
        .mk-seg button { border: none; background: none; font-family: inherit; font-size: 0.8125rem; font-weight: 500; color: #64748B;
          padding: 5px 12px; border-radius: 7px; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; transition: all 0.15s; }
        .mk-seg button:hover { color: #0F172A; }
        .mk-seg button.on { background: #1B4F8A; color: #fff; box-shadow: 0 1px 3px rgba(27,79,138,0.3); }
        .mk-map { height: min(72vh, 680px); }
        @media (max-width: 640px) {
          nav { padding: 0 16px !important; }
          .mk-nav-links { display: none !important; }
          .mk-hero { padding: 36px 16px 28px !important; }
          .mk-hero h1 { font-size: 1.875rem !important; }
          .mk-body { padding: 24px 16px !important; }
          .mk-filters .mk-select { flex: 1 1 calc(50% - 4px); }
          .mk-map { height: 64vh; }
        }
      `}</style>

      {/* ── Navbar ── */}
      <nav style={{
        position: 'sticky', top: 0, zIndex: 100,
        background: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(12px)',
        borderBottom: '1px solid #E8EDF2',
        padding: '0 24px', height: 60, gap: 12,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div className="mk-nav" style={{ display: 'flex', alignItems: 'center', gap: 32, minWidth: 0 }}>
          <button onClick={() => router.push('/')} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex' }}>
            <Logo />
          </button>
          <div className="mk-nav-links" style={{ display: 'flex', gap: 20 }}>
            <a className="nav-link" href="#" style={{ color: '#1B4F8A', fontWeight: 600, fontSize: '0.875rem', textDecoration: 'none' }}>Marketplace</a>
            <a className="nav-link" href="#how" style={{ textDecoration: 'none' }}>How it works</a>
          </div>
        </div>
        <AccountNavButtons />
      </nav>

      {/* ── Hero ── */}
      <div style={{
        background: 'linear-gradient(135deg, #0F172A 0%, #1B4F8A 100%)',
        padding: '52px 24px 40px',
      }} className="mk-hero">
        <div style={{ maxWidth: 900, margin: '0 auto' }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            background: 'rgba(255,255,255,0.1)', borderRadius: 999, padding: '4px 12px', marginBottom: 20,
          }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#F59E0B' }} />
            <span style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.7)', fontWeight: 500 }}>{availableCount} boards available now</span>
          </div>
          <h1 style={{
            fontSize: '2.5rem', fontWeight: 800, color: '#fff',
            letterSpacing: '-0.04em', lineHeight: 1.1, margin: '0 0 14px',
          }}>
            Find the perfect billboard<br />for your campaign
          </h1>
          <p style={{ fontSize: '1rem', color: 'rgba(255,255,255,0.55)', margin: '0 0 32px', maxWidth: 480, lineHeight: 1.6 }}>
            Browse {boards.length}+ OOH locations across Nigeria. Filter by area, format and verification, see them on a map, then request a quote in seconds.
          </p>

          {/* Search bar */}
          <div style={{ position: 'relative', maxWidth: 540 }}>
            <svg style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: '#94A3B8' }} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input
              type="text"
              placeholder="Search by name, city, or address..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{
                width: '100%', padding: '14px 14px 14px 44px',
                background: '#fff', border: 'none', borderRadius: 12,
                fontSize: '0.9375rem', color: '#0F172A', outline: 'none',
                fontFamily: 'inherit', boxSizing: 'border-box',
                boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
              }}
            />
          </div>

          {/* Quick city filters */}
          <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
            {['all', 'Lagos', 'Abuja', 'Port Harcourt', 'Kano', 'Ibadan'].map(city => (
              <button
                key={city}
                className="filter-pill"
                onClick={() => changeState(QUICK_CITY_STATE[city] ?? city)}
                style={{
                  padding: '6px 14px', borderRadius: 999, fontSize: '0.8125rem', fontWeight: 500,
                  background: (stateFilter === (QUICK_CITY_STATE[city] ?? city))
                    ? '#fff' : 'rgba(255,255,255,0.12)',
                  color: (stateFilter === (QUICK_CITY_STATE[city] ?? city))
                    ? '#1B4F8A' : 'rgba(255,255,255,0.7)',
                }}
              >
                {city === 'all' ? 'All cities' : city}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="mk-body" style={{ maxWidth: 1100, margin: '0 auto', padding: '32px 24px' }}>

        {/* Campaign builder CTA (not part of the MVP request flow) */}
        {!MVP_MODE && <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
          background: 'linear-gradient(135deg, #1B4F8A 0%, #0EA5E9 100%)',
          borderRadius: 14, padding: '18px 24px', marginBottom: 24, flexWrap: 'wrap',
        }}>
          <div>
            <p style={{ fontSize: '0.9375rem', fontWeight: 700, color: '#fff', margin: '0 0 4px' }}>Ready to plan your campaign?</p>
            <p style={{ fontSize: '0.8125rem', color: 'rgba(255,255,255,0.7)', margin: 0 }}>Use our self-service builder — pick boards, get a quote, and submit in minutes.</p>
          </div>
          <a href="/campaign-builder" style={{
            padding: '10px 22px', background: '#F59E0B', color: '#fff', borderRadius: 10,
            fontSize: '0.875rem', fontWeight: 700, textDecoration: 'none', whiteSpace: 'nowrap',
            boxShadow: '0 4px 14px -4px rgba(245,158,11,0.6)',
          }}>
            Plan a campaign →
          </a>
        </div>}

        {/* Toolbar */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, gap: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
            <p data-result-count style={{ fontSize: '0.9375rem', fontWeight: 700, color: '#0F172A', margin: 0 }}>
              {loading ? 'Loading...' : `${filtered.length} board${filtered.length !== 1 ? 's' : ''}`}
            </p>
            {!loading && filtered.length !== boards.length && (
              <span style={{ fontSize: '0.75rem', color: '#94A3B8' }}>of {boards.length} total</span>
            )}
            {filtersActive && (
              <button onClick={clearFilters} style={{ background: 'none', border: 'none', padding: 0, color: '#1B4F8A', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                Clear filters
              </button>
            )}
          </div>

          <div className="mk-seg" role="tablist" aria-label="View">
            <button role="tab" aria-selected={view === 'grid'} className={view === 'grid' ? 'on' : ''} onClick={() => changeView('grid')} data-view="grid">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
              Grid
            </button>
            <button role="tab" aria-selected={view === 'map'} className={view === 'map' ? 'on' : ''} onClick={() => changeView('map')} data-view="map">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg>
              Map
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="mk-filters" style={{
          display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 20,
          background: '#fff', border: '1px solid #E8EDF2', borderRadius: 14, padding: 10,
          boxShadow: '0 1px 4px rgba(0,0,0,0.03)',
        }}>
          <div className="mk-seg" aria-label="Availability">
            {(['available', 'all'] as const).map(st => (
              <button key={st} className={statusFilter === st ? 'on' : ''} onClick={() => setStatusFilter(st)}>
                {st === 'available' ? 'Available' : 'All'}
              </button>
            ))}
          </div>
          <div className="mk-seg" aria-label="Static or digital" data-filter="kind">
            {(['all', 'static', 'digital'] as const).map(k => (
              <button key={k} className={kindFilter === k ? 'on' : ''} onClick={() => setKindFilter(k)}>
                {k === 'all' ? 'All' : k === 'static' ? 'Static' : 'Digital'}
              </button>
            ))}
          </div>

          <select aria-label="State" className={`mk-select${stateFilter !== 'all' ? ' on' : ''}`} value={stateFilter} onChange={e => changeState(e.target.value)}>
            <option value="all">All states</option>
            {stateOptions.map(st => <option key={st} value={st}>{stateLabel(st)}</option>)}
          </select>
          <select aria-label="Area" data-filter="area" className={`mk-select${areaFilter !== 'all' ? ' on' : ''}`} value={areaFilter} onChange={e => setAreaFilter(e.target.value)} disabled={areas.length === 0}>
            <option value="all">{areas.length === 0 ? 'No areas listed' : 'All areas'}</option>
            {areas.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
          <select aria-label="Format" className={`mk-select${formatFilter !== 'all' ? ' on' : ''}`} value={formatFilter} onChange={e => setFormatFilter(e.target.value)}>
            <option value="all">All formats</option>
            {FORMAT_GROUPS.map(g => <option key={g.key} value={g.key}>{g.label}</option>)}
          </select>
          <select aria-label="Verification" data-filter="verification" className={`mk-select${verifyFilter !== 'all' ? ' on' : ''}`} value={verifyFilter} onChange={e => setVerifyFilter(e.target.value)}>
            {VERIFICATION_FILTERS.map(v => <option key={v.value} value={v.value}>{v.label}</option>)}
          </select>
          {/* Most rates are private in MVP ("Request quote"), so a budget filter would mislead. */}
          {!MVP_MODE && <select aria-label="Budget" className={`mk-select${priceMax !== Infinity ? ' on' : ''}`} value={priceMax === Infinity ? '' : priceMax} onChange={e => setPriceMax(e.target.value ? Number(e.target.value) : Infinity)}>
            {BUDGET_BANDS.map(b => (
              <option key={b.label} value={b.value === Infinity ? '' : b.value}>{b.label}</option>
            ))}
          </select>}
        </div>

        {/* Loading */}
        {loading && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '80px 0' }}>
            <div style={{ width: 28, height: 28, border: '2px solid #E2E8F0', borderTopColor: '#1B4F8A', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
          </div>
        )}

        {/* Empty */}
        {!loading && filtered.length === 0 && (
          <div style={{ textAlign: 'center', padding: '80px 0' }}>
            <div style={{ width: 56, height: 56, borderRadius: 14, background: '#F1F5F9', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
            </div>
            {boards.length === 0 ? (
              <>
                <p style={{ fontSize: '1rem', fontWeight: 600, color: '#0F172A', margin: '0 0 6px' }}>No boards listed yet</p>
                <p style={{ fontSize: '0.875rem', color: '#64748B', margin: '0 0 24px', maxWidth: 360, marginLeft: 'auto', marginRight: 'auto', lineHeight: 1.6 }}>
                  OOH Platform is Nigeria's billboard marketplace. Media owners list their locations here; buyers request them and get a quote.
                </p>
                <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
                  <a href="/signup?role=agency" style={{ padding: '10px 22px', background: '#1B4F8A', color: '#fff', border: 'none', borderRadius: 8, fontSize: '0.875rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', textDecoration: 'none' }}>
                    Create a buyer account →
                  </a>
                  <a href="/signup?role=owner" style={{ padding: '10px 22px', background: '#fff', color: '#1B4F8A', border: '1.5px solid #1B4F8A', borderRadius: 8, fontSize: '0.875rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', textDecoration: 'none' }}>
                    List your board
                  </a>
                </div>
              </>
            ) : (
              <>
                <p style={{ fontSize: '1rem', fontWeight: 600, color: '#0F172A', margin: '0 0 6px' }}>No boards match your filters</p>
                <p style={{ fontSize: '0.875rem', color: '#64748B', margin: '0 0 20px' }}>Try adjusting your search or clearing filters</p>
                <button
                  onClick={clearFilters}
                  style={{ padding: '8px 18px', background: '#1B4F8A', color: '#fff', border: 'none', borderRadius: 8, fontSize: '0.875rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
                >
                  Clear all filters
                </button>
              </>
            )}
          </div>
        )}

        {/* Map */}
        {!loading && filtered.length > 0 && view === 'map' && (
          <div data-marketplace-map>
            <div className="mk-map" style={{ borderRadius: 16, overflow: 'hidden', border: '1px solid #E8EDF2', boxShadow: '0 1px 4px rgba(0,0,0,0.04)', background: '#F1F5F9' }}>
              <MarketplaceMap boards={mapBoards} onOpen={id => setSelected(filtered.find(b => b.id === id) ?? null)} />
            </div>
            {unmapped > 0 && (
              <p style={{ fontSize: '0.8125rem', color: '#64748B', margin: '12px 2px 0' }}>
                {unmapped} board{unmapped !== 1 ? 's' : ''} {unmapped !== 1 ? "don't" : "doesn't"} have a map location yet.{' '}
                <button onClick={() => changeView('grid')} style={{ background: 'none', border: 'none', padding: 0, color: '#1B4F8A', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', fontSize: 'inherit' }}>
                  See all in the grid →
                </button>
              </p>
            )}
          </div>
        )}

        {/* Grid */}
        {!loading && filtered.length > 0 && view === 'grid' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))', gap: 16 }}>
            {filtered.map((board, i) => (
              <div
                key={board.id}
                className="board-card"
                onClick={() => setSelected(board)}
                style={{
                  background: '#fff', border: '1px solid #E8EDF2', borderRadius: 16,
                  overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
                  animation: `fadeUp 0.25s ease ${i * 0.03}s both`,
                }}
              >
                {/* Photo when we have one, otherwise the format illustration */}
                {board.photo_urls?.[0] ? (
                  <div style={{ height: 170, overflow: 'hidden', background: '#0F172A', borderBottom: '1px solid #F1F5F9' }}>
                    <img src={board.photo_urls[0]} alt={board.name} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                  </div>
                ) : (
                  <div style={{ background: '#F8FAFC', padding: '20px 24px 10px', borderBottom: '1px solid #F1F5F9' }}>
                    <BoardMockup format={board.format} illuminated={!!board.illuminated} status={board.status} />
                  </div>
                )}

                {/* Info */}
                <div style={{ padding: '14px 16px' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
                    <div>
                      <p style={{ fontSize: '0.9375rem', fontWeight: 700, color: '#0F172A', margin: '0 0 3px', lineHeight: 1.3 }}>{displayName(board.name)}</p>
                      <p style={{ fontSize: '0.75rem', color: '#94A3B8', margin: 0 }}>{[board.area, board.city].filter(Boolean).join(', ') || UNKNOWN}</p>
                    </div>
                    <StatusBadge status={board.status} />
                  </div>

                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
                    <span style={{ fontSize: '0.6875rem', fontWeight: 600, color: '#1B4F8A', background: '#EFF6FF', padding: '2px 8px', borderRadius: 999 }}>
                      {FORMAT_LABELS[board.format] ?? board.format}
                    </span>
                    {board.width && board.height ? (
                      <span style={{ fontSize: '0.6875rem', fontWeight: 600, color: '#64748B', background: '#F1F5F9', padding: '2px 8px', borderRadius: 999 }}>
                        {board.width}m × {board.height}m
                      </span>
                    ) : null}
                    {board.illuminated && (
                      <span style={{ fontSize: '0.6875rem', fontWeight: 600, color: '#D97706', background: '#FFFBEB', padding: '2px 8px', borderRadius: 999 }}>
                        Illuminated
                      </span>
                    )}
                    <VerificationBadge status={board.verification_status} small />
                    {board.activeListing && <TrustBadgePill badge={board.activeListing.badge} small />}
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                      <p style={{ fontSize: '1.125rem', fontWeight: 800, color: '#1B4F8A', margin: 0, letterSpacing: '-0.02em' }}>
                        {rateText(board)}
                      </p>
                      {hasPrice(board) ? <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: 0 }} title={effectiveRate(board) ? undefined : GUIDE_NOTE}>{priceSub(board)}</p> : null}
                    </div>
                    {board.status === 'available' && (
                      <button
                        onClick={e => { e.stopPropagation(); setSelected(board); }}
                        style={{
                          padding: '7px 14px', background: '#1B4F8A', color: '#fff',
                          border: 'none', borderRadius: 8, fontSize: '0.8125rem', fontWeight: 600,
                          cursor: 'pointer', fontFamily: 'inherit',
                        }}
                      >
                        View details
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Footer CTA */}
        {!loading && (
          <div id="how" style={{
            marginTop: 60, background: '#0F172A', borderRadius: 20,
            padding: '40px 32px', textAlign: 'center',
          }}>
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              background: 'rgba(255,255,255,0.08)', borderRadius: 999, padding: '4px 12px', marginBottom: 20,
            }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#F59E0B' }} />
              <span style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.6)', fontWeight: 500 }}>How it works</span>
            </div>
            <h2 style={{ fontSize: '1.75rem', fontWeight: 800, color: '#fff', letterSpacing: '-0.03em', margin: '0 0 14px' }}>
              Book outdoor advertising in 3 steps
            </h2>
            <p style={{ fontSize: '0.9375rem', color: 'rgba(255,255,255,0.45)', margin: '0 auto 36px', maxWidth: 440 }}>
              {MVP_MODE ? 'No cold calls. No scattered WhatsApp chains.' : 'No cold calls. No site visits. No spreadsheets.'}
            </p>
            <div className="resp-grid-3" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, maxWidth: 640, margin: '0 auto 36px', textAlign: 'left' }}>
              {(MVP_MODE ? [
                { num: '01', title: 'Browse & filter', body: 'Find boards by area, format and verification — in a grid or on the map.' },
                { num: '02', title: 'Request availability', body: 'Pick your dates. The media owner replies with availability and a price.' },
                { num: '03', title: 'Agree and book', body: 'Negotiate in one thread. Once you accept, our team completes the booking with you.' },
              ] : [
                { num: '01', title: 'Browse & filter', body: 'Find boards by city, format, size, and budget on one page.' },
                { num: '02', title: 'Request a quote', body: 'Submit your campaign dates and budget. Owner responds in 24h.' },
                { num: '03', title: 'Go live', body: 'Sign digitally, upload creatives, and track compliance in real time.' },
              ]).map(({ num, title, body }) => (
                <div key={num} style={{ background: 'rgba(255,255,255,0.05)', borderRadius: 12, padding: '16px' }}>
                  <p style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#F59E0B', margin: '0 0 8px', letterSpacing: '0.06em' }}>{num}</p>
                  <p style={{ fontSize: '0.9375rem', fontWeight: 700, color: '#fff', margin: '0 0 6px' }}>{title}</p>
                  <p style={{ fontSize: '0.8125rem', color: 'rgba(255,255,255,0.45)', margin: 0, lineHeight: 1.5 }}>{body}</p>
                </div>
              ))}
            </div>
            <button
              onClick={() => router.push(MVP_MODE ? '/signup?role=agency' : '/signup')}
              style={{
                padding: '12px 28px', background: '#1B4F8A', color: '#fff',
                border: 'none', borderRadius: 10, fontSize: '0.9375rem', fontWeight: 700,
                cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              Create a free account →
            </button>
          </div>
        )}
      </div>

      {/* Board detail modal */}
      {selected && (
        <BoardModal board={selected} onClose={() => setSelected(null)} onRequestQuote={handleQuote} />
      )}
      {!selected && <WhatsAppButton message="Hi, I'm looking at billboards on OOH Platform and I'd like some help choosing." />}
    </div>
  );
}

export default function MarketplacePage() {
  return (
    <RequirePlatformAuth>
      <MarketplaceContent />
    </RequirePlatformAuth>
  );
}
