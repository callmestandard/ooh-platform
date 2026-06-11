'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { supabase } from '@/lib/supabase';
import { authedFetch } from '@/lib/api';
import { useToast } from '@/components/ui/Toast';

const MapView = dynamic(() => import('./MapView'), {
  ssr: false,
  loading: () => (
    <div style={{ height: 480, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#F8FAFC', borderRadius: 14, border: '1px solid #E2E8F0', gap: 12 }}>
      <div style={{ width: 28, height: 28, border: '3px solid #E2E8F0', borderTopColor: '#1B4F8A', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
      <span style={{ fontSize: '0.875rem', color: '#94A3B8', fontWeight: 500 }}>Loading map…</span>
    </div>
  ),
});

// ── Types ──────────────────────────────────────────────────────────────────────

type Board = {
  id: string;
  name: string;
  format: string;
  address: string;
  city: string;
  state: string;
  width: number | null;
  height: number | null;
  asking_rate: number;
  face_count: number;
  illuminated: boolean;
  status: string;
  photo_urls: string[] | null;
  latitude: number | null;
  longitude: number | null;
  notes: string | null;
  contact_phone: string | null;
  available_from: string | null;
  created_at: string;
  owner_id?: string | null;
};

// ── Constants ──────────────────────────────────────────────────────────────────

const FORMAT_LABELS: Record<string, string> = {
  billboard: 'Billboard', unipole: 'Unipole', gantry: 'Gantry',
  bridge_panel: 'Bridge Panel', wall_drape: 'Wall Drape', digital: 'Digital',
};

const FORMAT_COLORS: Record<string, { bg: string; text: string }> = {
  billboard:    { bg: '#EFF6FF', text: '#1D4ED8' },
  unipole:      { bg: '#F5F3FF', text: '#6D28D9' },
  gantry:       { bg: '#ECFDF5', text: '#065F46' },
  bridge_panel: { bg: '#FFF7ED', text: '#C2410C' },
  wall_drape:   { bg: '#FDF2F8', text: '#9D174D' },
  digital:      { bg: '#F0FDF4', text: '#15803D' },
};

const NIGERIAN_CITIES = [
  'Lagos', 'Abuja', 'Port Harcourt', 'Kano', 'Ibadan', 'Enugu',
  'Warri', 'Kaduna', 'Benin City', 'Onitsha', 'Aba', 'Jos',
  'Ilorin', 'Uyo', 'Calabar', 'Abeokuta', 'Owerri', 'Asaba',
  'Victoria Island', 'Lekki', 'Ikeja', 'Surulere', 'Wuse', 'Maitama',
];

const HIGH_TRAFFIC_CITIES = ['Lagos', 'Abuja', 'Victoria Island', 'Lekki', 'Ikeja', 'Maitama', 'Port Harcourt'];
const PREMIUM_FORMATS = ['gantry', 'unipole', 'digital'];

// TODO: Audience/demographic filter — requires location-intel table (audience_segments) which doesn't exist yet.
// When location-intel is live, add filter chips here for Commuters, Shoppers, Residents, etc.

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtNaira(n?: number | null) {
  if (!n) return '₦0';
  if (n >= 1_000_000) return '₦' + (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000)     return '₦' + (n / 1_000).toFixed(0) + 'K';
  return '₦' + n.toLocaleString('en-NG');
}

function getPhotos(b: Board): string[] {
  return Array.isArray(b.photo_urls) ? b.photo_urls.filter(Boolean) : [];
}

function impactTags(b: Board): { label: string; color: string; bg: string }[] {
  const tags: { label: string; color: string; bg: string }[] = [];
  if (HIGH_TRAFFIC_CITIES.includes(b.city)) tags.push({ label: 'High traffic area', color: '#065F46', bg: '#ECFDF5' });
  if (PREMIUM_FORMATS.includes(b.format)) tags.push({ label: 'Premium format', color: '#3730A3', bg: '#F5F3FF' });
  if (b.illuminated) tags.push({ label: '24hr visibility', color: '#92400E', bg: '#FFFBEB' });
  if (b.width && b.height && b.width * b.height > 40) tags.push({ label: 'Large surface area', color: '#1E3A8A', bg: '#EFF6FF' });
  if ((b.face_count || 1) > 1) tags.push({ label: `${b.face_count} sided`, color: '#9D174D', bg: '#FDF2F8' });
  return tags;
}

// ── SVG Mockup fallback ────────────────────────────────────────────────────────

function BoardMockup({ format, width = 120, height = 72 }: { format: string; width?: number; height?: number }) {
  const isPortrait = format === 'unipole';
  const W = isPortrait ? 56 : 90;
  const H = isPortrait ? 84 : 54;
  const color = FORMAT_COLORS[format]?.text || '#1B4F8A';
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <rect x={(width - W) / 2} y={4} width={W} height={H} rx="3" fill={color} opacity="0.12" />
      <rect x={(width - W) / 2} y={4} width={W} height={H} rx="3" fill="none" stroke={color} strokeWidth="1.5" />
      <rect x={(width - W) / 2 + 4} y={8} width={W - 8} height={H - 8} rx="2" fill={color} opacity="0.08" />
      <rect x={width / 2 - 4} y={H + 4} width={8} height={20} rx="2" fill={color} opacity="0.25" />
      <rect x={(width - 40) / 2} y={H + 24} width={40} height={4} rx="2" fill={color} opacity="0.15" />
      <text x={width / 2} y={H / 2 + 8} textAnchor="middle" fontSize="8" fill={color} fontFamily="inherit" fontWeight="600">
        {(FORMAT_LABELS[format] || format).toUpperCase()}
      </text>
    </svg>
  );
}

// ── Board Card ─────────────────────────────────────────────────────────────────

function BoardCard({ board, onViewDetail, isShortlisted, onToggleShortlist, marketAvg }: {
  board: Board;
  onViewDetail: (b: Board) => void;
  isShortlisted: boolean;
  onToggleShortlist: (id: string) => void;
  marketAvg?: number;
}) {
  const fc = FORMAT_COLORS[board.format] || { bg: '#F8FAFC', text: '#64748B' };
  const photos = getPhotos(board);
  const tags = impactTags(board);
  const priceDiff = marketAvg ? Math.round(((board.asking_rate - marketAvg) / marketAvg) * 100) : null;

  return (
    <div
      onClick={() => onViewDetail(board)}
      style={{
        background: '#fff', border: '1px solid #E8EDF2', borderRadius: 14,
        overflow: 'hidden', cursor: 'pointer', transition: 'all 0.15s',
        display: 'flex', flexDirection: 'column',
      }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLElement).style.boxShadow = '0 8px 32px rgba(0,0,0,0.12)';
        (e.currentTarget as HTMLElement).style.borderColor = '#C7D2FE';
        (e.currentTarget as HTMLElement).style.transform = 'translateY(-3px)';
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLElement).style.boxShadow = 'none';
        (e.currentTarget as HTMLElement).style.borderColor = '#E8EDF2';
        (e.currentTarget as HTMLElement).style.transform = 'none';
      }}
    >
      {/* Photo area */}
      <div style={{ height: 200, background: fc.bg, position: 'relative', overflow: 'hidden', flexShrink: 0 }}>
        {photos.length > 0 ? (
          <img src={photos[0]} alt={board.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <BoardMockup format={board.format} width={200} height={160} />
          </div>
        )}

        {/* Overlays */}
        <div style={{ position: 'absolute', top: 10, left: 10, display: 'flex', flexDirection: 'column', gap: 5 }}>
          <div style={{
            background: board.status === 'available' ? '#10B981' : '#94A3B8',
            color: '#fff', fontSize: '0.625rem', fontWeight: 700,
            padding: '3px 9px', borderRadius: 999, display: 'flex', alignItems: 'center', gap: 4,
            boxShadow: '0 1px 4px rgba(0,0,0,0.2)',
          }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'rgba(255,255,255,0.7)' }} />
            {board.status === 'available' ? 'Available' : 'Booked'}
          </div>
        </div>

        <div style={{ position: 'absolute', top: 10, right: 10, display: 'flex', flexDirection: 'column', gap: 5, alignItems: 'flex-end' }}>
          <div style={{
            background: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(4px)',
            color: fc.text, fontSize: '0.625rem', fontWeight: 700,
            padding: '3px 8px', borderRadius: 999, border: `1px solid ${fc.text}22`,
          }}>
            {FORMAT_LABELS[board.format] || board.format}
          </div>
          {photos.length > 1 && (
            <div style={{
              background: 'rgba(15,23,42,0.65)', backdropFilter: 'blur(4px)',
              color: '#fff', fontSize: '0.5625rem', fontWeight: 700,
              padding: '3px 7px', borderRadius: 999, display: 'flex', alignItems: 'center', gap: 3,
            }}>
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
              {photos.length} photos
            </div>
          )}
        </div>

        {/* Bottom gradient for text legibility */}
        {photos.length > 0 && (
          <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 60, background: 'linear-gradient(to top, rgba(15,23,42,0.5), transparent)' }} />
        )}

        {board.illuminated && (
          <div style={{ position: 'absolute', bottom: 10, left: 10, background: '#FFFBEB', border: '1px solid #FDE68A', color: '#92400E', fontSize: '0.5625rem', fontWeight: 700, padding: '2px 7px', borderRadius: 999 }}>
            💡 Illuminated
          </div>
        )}
        {/* Shortlist button */}
        <button
          onClick={e => { e.stopPropagation(); onToggleShortlist(board.id); }}
          title={isShortlisted ? 'Remove from shortlist' : 'Save to shortlist'}
          style={{ position: 'absolute', bottom: 10, right: 10, width: 30, height: 30, borderRadius: '50%', background: isShortlisted ? '#FEF08A' : 'rgba(255,255,255,0.85)', backdropFilter: 'blur(4px)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 1px 4px rgba(0,0,0,0.15)', transition: 'all 0.15s' }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill={isShortlisted ? '#CA8A04' : 'none'} stroke={isShortlisted ? '#CA8A04' : '#64748B'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
          </svg>
        </button>
      </div>

      {/* Card body */}
      <div style={{ padding: '14px 16px', flex: 1, display: 'flex', flexDirection: 'column' }}>
        <p style={{ fontSize: '0.9375rem', fontWeight: 700, color: '#0F172A', margin: '0 0 3px', lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const }}>
          {board.name}
        </p>
        <p style={{ fontSize: '0.75rem', color: '#64748B', margin: '0 0 10px', display: 'flex', alignItems: 'center', gap: 4 }}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
          {[board.address, board.city].filter(Boolean).join(', ')}
        </p>

        {/* Impact tags */}
        {tags.length > 0 && (
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 10 }}>
            {tags.slice(0, 2).map(t => (
              <span key={t.label} style={{ fontSize: '0.5625rem', fontWeight: 700, color: t.color, background: t.bg, padding: '2px 7px', borderRadius: 999 }}>
                {t.label}
              </span>
            ))}
          </div>
        )}

        {/* Specs row */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
          {board.width && board.height && (
            <span style={{ fontSize: '0.6875rem', background: '#F8FAFC', border: '1px solid #E2E8F0', color: '#475569', padding: '2px 8px', borderRadius: 6, fontWeight: 500 }}>
              {board.width}×{board.height}m
            </span>
          )}
          {(board.face_count || 1) > 1 && (
            <span style={{ fontSize: '0.6875rem', background: '#F8FAFC', border: '1px solid #E2E8F0', color: '#475569', padding: '2px 8px', borderRadius: 6, fontWeight: 500 }}>
              {board.face_count} faces
            </span>
          )}
        </div>

        <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 8 }}>
          <div>
            <p style={{ fontSize: '1.25rem', fontWeight: 800, color: '#0F172A', margin: 0, fontFamily: 'monospace', letterSpacing: '-0.02em' }}>
              {fmtNaira(board.asking_rate)}
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 2 }}>
              <p style={{ fontSize: '0.625rem', color: '#94A3B8', margin: 0 }}>asking / month</p>
              {priceDiff !== null && Math.abs(priceDiff) > 5 && (
                <span style={{ fontSize: '0.5625rem', fontWeight: 700, padding: '1px 5px', borderRadius: 4,
                  background: priceDiff < 0 ? '#ECFDF5' : '#FEF2F2',
                  color: priceDiff < 0 ? '#065F46' : '#991B1B',
                }}>
                  {priceDiff < 0 ? `${Math.abs(priceDiff)}% below avg` : `${priceDiff}% above avg`}
                </span>
              )}
            </div>
          </div>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 5,
            background: '#F5F3FF', color: '#7C3AED',
            padding: '7px 12px', borderRadius: 8,
            fontSize: '0.75rem', fontWeight: 700,
          }}>
            View board
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 18 15 12 9 6"/></svg>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Photo Gallery ──────────────────────────────────────────────────────────────

function PhotoGallery({ photos, boardName }: { photos: string[]; boardName: string }) {
  const [active, setActive] = useState(0);

  if (photos.length === 0) return null;

  return (
    <div>
      {/* Main photo */}
      <div style={{ position: 'relative', height: 280, background: '#0F172A', overflow: 'hidden' }}>
        <img
          key={active}
          src={photos[active]}
          alt={`${boardName} photo ${active + 1}`}
          style={{ width: '100%', height: '100%', objectFit: 'cover', animation: 'photoFade 0.2s ease' }}
        />
        {/* Counter */}
        <div style={{ position: 'absolute', bottom: 12, right: 12, background: 'rgba(15,23,42,0.7)', color: '#fff', fontSize: '0.6875rem', fontWeight: 700, padding: '4px 10px', borderRadius: 999, backdropFilter: 'blur(4px)' }}>
          {active + 1} / {photos.length}
        </div>
        {/* Prev / Next arrows */}
        {photos.length > 1 && (
          <>
            <button
              onClick={() => setActive(a => (a - 1 + photos.length) % photos.length)}
              style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', width: 32, height: 32, borderRadius: '50%', background: 'rgba(255,255,255,0.85)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#0F172A" strokeWidth="2.5"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
            <button
              onClick={() => setActive(a => (a + 1) % photos.length)}
              style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', width: 32, height: 32, borderRadius: '50%', background: 'rgba(255,255,255,0.85)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#0F172A" strokeWidth="2.5"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
          </>
        )}
      </div>
      {/* Thumbnails */}
      {photos.length > 1 && (
        <div style={{ display: 'flex', gap: 4, padding: '6px', background: '#0F172A' }}>
          {photos.map((p, i) => (
            <button
              key={p}
              onClick={() => setActive(i)}
              style={{
                width: 52, height: 36, borderRadius: 4, overflow: 'hidden', border: `2px solid ${active === i ? '#fff' : 'transparent'}`,
                padding: 0, cursor: 'pointer', flexShrink: 0, transition: 'border-color 0.15s',
              }}
            >
              <img src={p} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: active === i ? 1 : 0.55 }} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Location Map ───────────────────────────────────────────────────────────────

function LocationMap({ lat, lng, label }: { lat: number; lng: number; label: string }) {
  const bbox = `${lng - 0.008},${lat - 0.005},${lng + 0.008},${lat + 0.005}`;
  const src = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat},${lng}`;
  return (
    <div style={{ border: '1px solid #E2E8F0', borderRadius: 10, overflow: 'hidden', marginBottom: 16 }}>
      <div style={{ padding: '8px 12px', background: '#F8FAFC', borderBottom: '1px solid #E2E8F0', display: 'flex', alignItems: 'center', gap: 6 }}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#7C3AED" strokeWidth="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
        <span style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#374151' }}>Exact location</span>
        <span style={{ fontSize: '0.625rem', color: '#94A3B8', marginLeft: 'auto' }}>{lat.toFixed(4)}, {lng.toFixed(4)}</span>
      </div>
      <iframe
        src={src}
        title={`Map: ${label}`}
        width="100%"
        height="180"
        style={{ display: 'block', border: 'none' }}
        loading="lazy"
      />
      <a
        href={`https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}&zoom=16`}
        target="_blank"
        rel="noopener noreferrer"
        style={{ display: 'block', textAlign: 'center', padding: '6px', background: '#F8FAFC', fontSize: '0.6875rem', color: '#1B4F8A', fontWeight: 600, textDecoration: 'none', borderTop: '1px solid #E2E8F0' }}
      >
        Open in Google Maps / OpenStreetMap ↗
      </a>
    </div>
  );
}

// ── Main page component ────────────────────────────────────────────────────────

export default function MarketplacePage() {
  const router = useRouter();
  const [boards, setBoards]           = useState<Board[]>([]);
  const [loading, setLoading]         = useState(true);
  const [search, setSearch]           = useState('');
  const [cityFilter, setCityFilter]   = useState('');
  const [formatFilter, setFormatFilter] = useState('');
  const [maxPrice, setMaxPrice]       = useState('');
  const [sortBy, setSortBy]           = useState('newest');
  const [showAvailOnly, setShowAvailOnly] = useState(true);
  const [viewMode, setViewMode]       = useState<'grid' | 'map'>('grid');
  const [detail, setDetail]           = useState<Board | null>(null);
  const [offerBoard, setOfferBoard]   = useState<Board | null>(null);
  const [campaigns, setCampaigns]     = useState<{ id: string; name: string }[]>([]);
  const [offerForm, setOfferForm]     = useState({ campaign_id: '', offered_rate: '', start_date: '', end_date: '', notes: '' });
  const [submitting, setSubmitting]   = useState(false);
  const { toast: showToast } = useToast();
  const [campaignStart, setCampaignStart] = useState('');
  const [campaignEnd, setCampaignEnd]     = useState('');
  const [bookedBoardIds, setBookedBoardIds] = useState<Set<string>>(new Set());
  const [shortlist, setShortlist]     = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem('ooh_shortlist') || '[]')); } catch { return new Set(); }
  });
  const [showShortlistOnly, setShowShortlistOnly] = useState(false);

  useEffect(() => {
    supabase
      .from('boards')
      .select('id, name, format, address, city, state, width, height, asking_rate, face_count, illuminated, status, photo_urls, latitude, longitude, notes, contact_phone, available_from, created_at')
      .order('created_at', { ascending: false })
      .limit(300)
      .then(({ data }) => { setBoards((data as Board[]) || []); setLoading(false); });

    supabase.from('campaigns').select('id, name').order('created_at', { ascending: false }).limit(50)
      .then(({ data }) => setCampaigns((data as { id: string; name: string }[]) || []));
  }, []);

  useEffect(() => {
    if (!campaignStart || !campaignEnd) { setBookedBoardIds(new Set()); return; }
    supabase
      .from('bookings')
      .select('board_id')
      .in('status', ['agreed', 'signed', 'live'])
      .lte('start_date', campaignEnd)
      .gte('end_date', campaignStart)
      .then(({ data }) => {
        setBookedBoardIds(new Set((data || []).map((b: { board_id: string }) => b.board_id).filter(Boolean)));
      });
  }, [campaignStart, campaignEnd]);

  function toggleShortlist(id: string) {
    setShortlist(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      localStorage.setItem('ooh_shortlist', JSON.stringify([...next]));
      return next;
    });
  }

  const formatAvg = useMemo(() => {
    const totals: Record<string, number> = {};
    const counts: Record<string, number> = {};
    boards.forEach(b => {
      totals[b.format] = (totals[b.format] || 0) + b.asking_rate;
      counts[b.format] = (counts[b.format] || 0) + 1;
    });
    const avg: Record<string, number> = {};
    Object.keys(totals).forEach(f => { avg[f] = Math.round(totals[f] / (counts[f] || 1)); });
    return avg;
  }, [boards]);

  const filtered = useMemo(() => boards
    .filter(b => {
      if (showAvailOnly && b.status !== 'available') return false;
      if (cityFilter && b.city?.toLowerCase() !== cityFilter.toLowerCase()) return false;
      if (formatFilter && b.format !== formatFilter) return false;
      if (maxPrice && b.asking_rate > parseInt(maxPrice)) return false;
      if (campaignStart && campaignEnd && bookedBoardIds.has(b.id)) return false;
      if (showShortlistOnly && !shortlist.has(b.id)) return false;
if (search) {
        const q = search.toLowerCase();
        return b.name.toLowerCase().includes(q) || b.city?.toLowerCase().includes(q) || b.address?.toLowerCase().includes(q);
      }
      return true;
    })
    .sort((a, b) => {
      if (sortBy === 'price_lo') return (a.asking_rate || 0) - (b.asking_rate || 0);
      if (sortBy === 'price_hi') return (b.asking_rate || 0) - (a.asking_rate || 0);
      return 0;
    }),
  [boards, showAvailOnly, cityFilter, formatFilter, maxPrice, campaignStart, campaignEnd, bookedBoardIds, showShortlistOnly, shortlist, search, sortBy]);

  async function submitOffer() {
    if (!offerBoard || !offerForm.offered_rate) return;
    setSubmitting(true);
    try {
      let campaignId = offerForm.campaign_id;
      if (!campaignId) {
        const { data: camp } = await supabase.from('campaigns').insert({
          name: `Marketplace — ${offerBoard.name}`,
          client_name: 'TBD', status: 'draft',
          total_budget: parseFloat(offerForm.offered_rate) || 0,
          start_date: offerForm.start_date || null,
          end_date: offerForm.end_date || null,
        }).select('id').single();
        campaignId = camp?.id || '';
      }
      const { data: booking, error } = await supabase.from('bookings').insert({
        board_id: offerBoard.id,
        campaign_id: campaignId || null,
        offered_rate: parseFloat(offerForm.offered_rate),
        start_date: offerForm.start_date || null,
        end_date: offerForm.end_date || null,
        notes: offerForm.notes || null,
        status: 'pending',
      }).select('id').single();
      if (error) throw error;
      showToast('Offer sent! Heading to negotiations…');
      // Fire-and-forget email to board owner
      if (booking?.id && offerBoard.owner_id) {
        const { data: { user: agencyUser } } = await supabase.auth.getUser();
        if (agencyUser) {
          authedFetch('/api/notify/email', {
            method: 'POST',
            body: JSON.stringify({
              type: 'booking_request',
              ownerId: offerBoard.owner_id,
              agencyId: agencyUser.id,
              boardName: offerBoard.name,
              campaignName: offerForm.campaign_id ? (campaigns.find(c => c.id === offerForm.campaign_id)?.name ?? 'New campaign') : 'New campaign',
              rate: parseFloat(offerForm.offered_rate),
              bookingId: booking.id,
            }),
          }).catch(() => {});
        }
      }
      setOfferBoard(null);
      setOfferForm({ campaign_id: '', offered_rate: '', start_date: '', end_date: '', notes: '' });
      setTimeout(() => router.push(`/dashboard/agency/negotiations/${booking?.id}`), 1200);
    } catch {
      showToast('Failed to send offer — please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  const cities = [...new Set(boards.map(b => b.city).filter(Boolean))].sort();

  // WhatsApp message builder
  function buildWhatsAppMsg(b: Board) {
    const lines = [
      `Hi, I found your board listing on OOH Platform and I'm interested.`,
      ``,
      `*Board:* ${b.name}`,
      `*Location:* ${[b.address, b.city].filter(Boolean).join(', ')}`,
      `*Format:* ${FORMAT_LABELS[b.format] || b.format}`,
      b.width && b.height ? `*Size:* ${b.width}m × ${b.height}m` : '',
      `*Asking rate:* ${fmtNaira(b.asking_rate)}/month`,
      ``,
      `Can we discuss the availability and pricing?`,
    ].filter(l => l !== undefined);
    return encodeURIComponent(lines.join('\n'));
  }

  return (
    <div style={{ fontFamily: "'Inter', -apple-system, sans-serif", minHeight: '100vh', background: '#F8FAFC' }}>
      <style>{`
        @keyframes fadeIn   { from { opacity:0; transform:translateY(8px)  } to { opacity:1; transform:none } }
        @keyframes slideIn  { from { opacity:0; transform:translateX(32px) } to { opacity:1; transform:none } }
        @keyframes spin     { to { transform: rotate(360deg); } }
        @keyframes photoFade { from { opacity: 0.6 } to { opacity: 1 } }
        * { box-sizing: border-box; }
      `}</style>

      {/* ── Hero ── */}
      <div style={{ background: 'linear-gradient(135deg, #0F172A 0%, #1E293B 100%)', padding: '32px 0 28px', marginBottom: 24 }}>
        <div style={{ maxWidth: 1100, margin: '0 auto', padding: '0 24px' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20, gap: 16 }}>
            <div>
              <h1 style={{ fontSize: '1.625rem', fontWeight: 800, color: '#fff', margin: '0 0 5px', letterSpacing: '-0.03em' }}>
                Find billboard space across Nigeria
              </h1>
              <p style={{ fontSize: '0.875rem', color: 'rgba(255,255,255,0.5)', margin: 0 }}>
                Browse real board photos · compare locations · negotiate directly with owners
              </p>
            </div>
            <div style={{ flexShrink: 0, textAlign: 'right' }}>
              <p style={{ fontSize: '2rem', fontWeight: 800, color: '#10B981', margin: '0 0 2px', fontFamily: 'monospace', letterSpacing: '-0.04em' }}>
                {boards.filter(b => b.status === 'available').length}
              </p>
              <p style={{ fontSize: '0.6875rem', color: 'rgba(255,255,255,0.4)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', margin: 0 }}>
                boards available
              </p>
            </div>
          </div>

          {/* Search row */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <div style={{ flex: 1, position: 'relative' }}>
              <svg style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: '#94A3B8', pointerEvents: 'none' }} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search by board name, area, or landmark…"
                style={{ width: '100%', padding: '13px 14px 13px 44px', borderRadius: 10, border: 'none', background: '#fff', fontSize: '0.9375rem', color: '#0F172A', fontFamily: 'inherit', outline: 'none', boxShadow: '0 2px 16px rgba(0,0,0,0.15)' }}
              />
            </div>
            <select
              value={cityFilter}
              onChange={e => setCityFilter(e.target.value)}
              style={{ padding: '13px 16px', borderRadius: 10, border: 'none', background: '#fff', fontSize: '0.875rem', color: cityFilter ? '#0F172A' : '#64748B', fontFamily: 'inherit', outline: 'none', minWidth: 170, boxShadow: '0 2px 16px rgba(0,0,0,0.15)', cursor: 'pointer' }}
            >
              <option value="">All cities</option>
              {cities.map(c => <option key={c} value={c}>{c}</option>)}
              {NIGERIAN_CITIES.filter(c => !cities.includes(c)).map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          {/* Campaign window filter */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10, padding: '8px 14px' }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="2" strokeLinecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
              <span style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.5)', fontWeight: 600, whiteSpace: 'nowrap' }}>Campaign window:</span>
              <input type="date" value={campaignStart} onChange={e => setCampaignStart(e.target.value)}
                style={{ padding: '4px 8px', borderRadius: 6, border: 'none', background: 'rgba(255,255,255,0.12)', color: campaignStart ? '#fff' : 'rgba(255,255,255,0.35)', fontSize: '0.8125rem', fontFamily: 'inherit', outline: 'none' }} />
              <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: '0.75rem' }}>→</span>
              <input type="date" value={campaignEnd} min={campaignStart} onChange={e => setCampaignEnd(e.target.value)}
                style={{ padding: '4px 8px', borderRadius: 6, border: 'none', background: 'rgba(255,255,255,0.12)', color: campaignEnd ? '#fff' : 'rgba(255,255,255,0.35)', fontSize: '0.8125rem', fontFamily: 'inherit', outline: 'none' }} />
              {(campaignStart || campaignEnd) && (
                <button onClick={() => { setCampaignStart(''); setCampaignEnd(''); }} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', cursor: 'pointer', fontSize: '0.75rem', padding: 0 }}>✕</button>
              )}
            </div>
            {campaignStart && campaignEnd && bookedBoardIds.size > 0 && (
              <span style={{ fontSize: '0.6875rem', color: '#FCA5A5', fontWeight: 600 }}>
                {bookedBoardIds.size} board{bookedBoardIds.size !== 1 ? 's' : ''} already booked in this window — hidden
              </span>
            )}
            {shortlist.size > 0 && (
              <button
                onClick={() => setShowShortlistOnly(v => !v)}
                style={{ display: 'flex', alignItems: 'center', gap: 6, background: showShortlistOnly ? '#FEF08A' : 'rgba(255,255,255,0.08)', border: `1px solid ${showShortlistOnly ? '#CA8A04' : 'rgba(255,255,255,0.12)'}`, borderRadius: 10, padding: '8px 14px', color: showShortlistOnly ? '#713F12' : 'rgba(255,255,255,0.6)', fontSize: '0.75rem', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill={showShortlistOnly ? '#CA8A04' : 'none'} stroke={showShortlistOnly ? '#CA8A04' : 'currentColor'} strokeWidth="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
                Shortlist ({shortlist.size})
              </button>
            )}
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '0 24px 48px' }}>

        {/* ── Filter bar ── */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 20, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {[{ value: '', label: 'All types' }, ...Object.entries(FORMAT_LABELS).map(([v, l]) => ({ value: v, label: l }))].map(opt => (
              <button
                key={opt.value}
                onClick={() => setFormatFilter(opt.value)}
                style={{
                  padding: '6px 13px', borderRadius: 999,
                  border: `1.5px solid ${formatFilter === opt.value ? '#1B4F8A' : '#E2E8F0'}`,
                  background: formatFilter === opt.value ? '#EFF6FF' : '#fff',
                  color: formatFilter === opt.value ? '#1B4F8A' : '#64748B',
                  fontSize: '0.75rem', fontWeight: formatFilter === opt.value ? 700 : 500,
                  cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.12s',
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: '0.8125rem', color: '#64748B', fontWeight: 500, whiteSpace: 'nowrap' }}>
              <input type="checkbox" checked={showAvailOnly} onChange={e => setShowAvailOnly(e.target.checked)} style={{ accentColor: '#10B981', width: 14, height: 14 }} />
              Available only
            </label>
            {viewMode === 'grid' && (
              <>
                <div style={{ position: 'relative' }}>
                  <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#94A3B8', fontSize: '0.8125rem', fontWeight: 600 }}>₦</span>
                  <input type="number" value={maxPrice} onChange={e => setMaxPrice(e.target.value)} placeholder="Max price"
                    style={{ padding: '7px 10px 7px 24px', borderRadius: 8, border: '1.5px solid #E2E8F0', fontSize: '0.8125rem', color: '#0F172A', fontFamily: 'inherit', width: 130, outline: 'none' }} />
                </div>
                <select value={sortBy} onChange={e => setSortBy(e.target.value)}
                  style={{ padding: '7px 12px', borderRadius: 8, border: '1.5px solid #E2E8F0', fontSize: '0.8125rem', color: '#0F172A', fontFamily: 'inherit', outline: 'none', background: '#fff', cursor: 'pointer' }}>
                  <option value="newest">Newest first</option>
                  <option value="price_lo">Price: Low → High</option>
                  <option value="price_hi">Price: High → Low</option>
                </select>
              </>
            )}

            {/* View toggle */}
            <div style={{ display: 'flex', background: '#F1F5F9', borderRadius: 8, padding: 3, gap: 2, flexShrink: 0 }}>
              {([
                { mode: 'grid', icon: (
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
                ), label: 'Grid' },
                { mode: 'map', icon: (
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg>
                ), label: 'Map' },
              ] as { mode: 'grid' | 'map'; icon: React.ReactNode; label: string }[]).map(({ mode, icon, label }) => (
                <button
                  key={mode}
                  onClick={() => setViewMode(mode)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 5,
                    padding: '6px 12px', borderRadius: 6, border: 'none',
                    background: viewMode === mode ? '#fff' : 'transparent',
                    color: viewMode === mode ? '#0F172A' : '#94A3B8',
                    fontWeight: 700, fontSize: '0.75rem',
                    cursor: 'pointer', fontFamily: 'inherit',
                    boxShadow: viewMode === mode ? '0 1px 4px rgba(0,0,0,0.08)' : 'none',
                    transition: 'all 0.12s',
                  }}
                >
                  {icon}
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <p style={{ fontSize: '0.8125rem', color: '#64748B', margin: 0, fontWeight: 500 }}>
            {loading ? 'Loading boards…' : `${filtered.length} board${filtered.length !== 1 ? 's' : ''} found${cityFilter ? ` in ${cityFilter}` : ''}${formatFilter ? ` · ${FORMAT_LABELS[formatFilter]}` : ''}`}
          </p>
          {viewMode === 'map' && !loading && (
            <p style={{ fontSize: '0.75rem', color: '#94A3B8', margin: 0 }}>
              {filtered.filter(b => b.latitude != null).length} of {filtered.length} boards have GPS — click a pin to view details
            </p>
          )}
        </div>

        {/* ── Map view ── */}
        {viewMode === 'map' && !loading && (
          <MapView boards={filtered} onSelectBoard={setDetail} />
        )}

        {/* ── Grid view ── */}
        {viewMode === 'grid' && (
          loading ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '5rem', gap: 12 }}>
              <div style={{ width: 28, height: 28, border: '3px solid #E2E8F0', borderTopColor: '#1B4F8A', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
              <span style={{ fontSize: '0.875rem', color: '#94A3B8' }}>Loading marketplace…</span>
            </div>
          ) : filtered.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '5rem 0' }}>
              <div style={{ fontSize: '3rem', marginBottom: 12 }}>🔍</div>
              <p style={{ fontSize: '1rem', fontWeight: 600, color: '#0F172A', margin: '0 0 6px' }}>No boards found</p>
              <p style={{ fontSize: '0.875rem', color: '#94A3B8', margin: '0 0 20px' }}>Try a different city or remove some filters.</p>
              <button onClick={() => { setSearch(''); setCityFilter(''); setFormatFilter(''); setMaxPrice(''); setShowAvailOnly(false); }}
                style={{ background: '#1B4F8A', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 20px', fontSize: '0.875rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                Clear all filters
              </button>
            </div>
          ) : (
            <div className="resp-grid-3" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 18, animation: 'fadeIn 0.25s both' }}>
              {filtered.map(b => (
                <BoardCard key={b.id} board={b} onViewDetail={setDetail}
                  isShortlisted={shortlist.has(b.id)}
                  onToggleShortlist={toggleShortlist}
                  marketAvg={formatAvg[b.format]}
                />
              ))}
            </div>
          )
        )}
      </div>

      {/* ── Board Detail Panel ── */}
      {detail && (() => {
        const photos = getPhotos(detail);
        const tags = impactTags(detail);
        const hasMap = detail.latitude != null && detail.longitude != null;
        const phone = detail.contact_phone?.replace(/\s/g, '').replace(/^0/, '234');

        return (
          <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex' }}>
            <div style={{ position: 'absolute', inset: 0, background: 'rgba(15,23,42,0.6)', backdropFilter: 'blur(4px)' }} onClick={() => setDetail(null)} />
            <div style={{
              position: 'absolute', right: 0, top: 0, bottom: 0, width: 540,
              background: '#fff', boxShadow: '-8px 0 40px rgba(0,0,0,0.18)',
              display: 'flex', flexDirection: 'column', animation: 'slideIn 0.25s both', overflow: 'hidden',
            }}>
              {/* ── Top visual: photo gallery + map side by side ── */}
              <div style={{ display: 'flex', height: 260, flexShrink: 0, overflow: 'hidden', background: '#0F172A' }}>
                {/* Left: board photos */}
                <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
                  {photos.length > 0 ? (
                    <PhotoGallery photos={photos} boardName={detail.name} />
                  ) : (
                    <div style={{ height: '100%', background: FORMAT_COLORS[detail.format]?.bg || '#F8FAFC', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                      <BoardMockup format={detail.format} width={180} height={140} />
                      <p style={{ fontSize: '0.6875rem', fontWeight: 600, color: '#94A3B8', margin: 0 }}>No photos uploaded yet</p>
                    </div>
                  )}
                  {/* Photo label overlay */}
                  <div style={{ position: 'absolute', bottom: 8, left: 8, background: 'rgba(15,23,42,0.7)', color: '#fff', fontSize: '0.5625rem', fontWeight: 700, padding: '3px 8px', borderRadius: 999, backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', gap: 4 }}>
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                    Board photo
                  </div>
                </div>

                {/* Divider */}
                <div style={{ width: 2, background: '#0F172A', flexShrink: 0 }} />

                {/* Right: location map */}
                <div style={{ flex: 1, position: 'relative', overflow: 'hidden', background: '#E8EDF2' }}>
                  {hasMap ? (
                    <>
                      <iframe
                        src={`https://www.openstreetmap.org/export/embed.html?bbox=${detail.longitude! - 0.007},${detail.latitude! - 0.005},${detail.longitude! + 0.007},${detail.latitude! + 0.005}&layer=mapnik&marker=${detail.latitude},${detail.longitude}`}
                        title="Board location"
                        width="100%"
                        height="100%"
                        style={{ display: 'block', border: 'none' }}
                        loading="lazy"
                      />
                      {/* Map label overlay */}
                      <div style={{ position: 'absolute', bottom: 8, left: 8, background: 'rgba(15,23,42,0.7)', color: '#fff', fontSize: '0.5625rem', fontWeight: 700, padding: '3px 8px', borderRadius: 999, backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', gap: 4, pointerEvents: 'none' }}>
                        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                        Surroundings
                      </div>
                      <a
                        href={`https://www.openstreetmap.org/?mlat=${detail.latitude}&mlon=${detail.longitude}&zoom=17`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ position: 'absolute', bottom: 8, right: 8, background: 'rgba(255,255,255,0.9)', color: '#1B4F8A', fontSize: '0.5625rem', fontWeight: 700, padding: '3px 8px', borderRadius: 999, textDecoration: 'none', backdropFilter: 'blur(4px)' }}
                      >
                        Open map ↗
                      </a>
                    </>
                  ) : (
                    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 16 }}>
                      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" strokeWidth="1.5"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                      <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: 0, textAlign: 'center' }}>
                        No GPS coordinates<br />Owner hasn't pinned this board yet
                      </p>
                      <p style={{ fontSize: '0.625rem', color: '#CBD5E1', margin: 0, textAlign: 'center' }}>{detail.address}, {detail.city}</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Close button */}
              <button
                onClick={() => setDetail(null)}
                style={{ position: 'absolute', top: 12, right: 12, width: 32, height: 32, borderRadius: '50%', background: 'rgba(255,255,255,0.9)', backdropFilter: 'blur(4px)', border: 'none', cursor: 'pointer', fontSize: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px rgba(0,0,0,0.15)', zIndex: 10 }}>
                ✕
              </button>

              {/* Scrollable content */}
              <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
                {/* Header */}
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 6 }}>
                  <h2 style={{ fontSize: '1.1875rem', fontWeight: 800, color: '#0F172A', margin: 0, letterSpacing: '-0.02em', lineHeight: 1.3, flex: 1 }}>
                    {detail.name}
                  </h2>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <p style={{ fontSize: '1.625rem', fontWeight: 800, color: '#0F172A', margin: 0, fontFamily: 'monospace', letterSpacing: '-0.03em' }}>
                      {fmtNaira(detail.asking_rate)}
                    </p>
                    <p style={{ fontSize: '0.625rem', color: '#94A3B8', margin: 0 }}>asking / month</p>
                  </div>
                </div>

                <p style={{ fontSize: '0.8125rem', color: '#64748B', margin: '0 0 14px', display: 'flex', alignItems: 'center', gap: 5 }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#7C3AED" strokeWidth="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                  {[detail.address, detail.city, detail.state].filter(Boolean).join(', ')}
                </p>

                {/* Status pill */}
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: detail.status === 'available' ? '#ECFDF5' : '#F1F5F9', color: detail.status === 'available' ? '#065F46' : '#64748B', padding: '4px 10px', borderRadius: 999, fontSize: '0.6875rem', fontWeight: 700, marginBottom: 16 }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: detail.status === 'available' ? '#10B981' : '#94A3B8' }} />
                  {detail.status === 'available' ? 'Available now' : 'Currently booked'}
                  {detail.available_from && detail.status !== 'available' && (
                    <span style={{ marginLeft: 4, opacity: 0.7 }}>· from {new Date(detail.available_from).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' })}</span>
                  )}
                </div>

                {/* Impact tags */}
                {tags.length > 0 && (
                  <div style={{ marginBottom: 16 }}>
                    <p style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.07em', margin: '0 0 8px' }}>Why this board</p>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {tags.map(t => (
                        <span key={t.label} style={{ fontSize: '0.6875rem', fontWeight: 700, color: t.color, background: t.bg, padding: '4px 10px', borderRadius: 999 }}>
                          {t.label}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Specs grid */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
                  {[
                    { label: 'Format',   value: FORMAT_LABELS[detail.format] || detail.format },
                    { label: 'Size',     value: detail.width && detail.height ? `${detail.width}m × ${detail.height}m = ${(detail.width * detail.height).toFixed(0)} m²` : '—' },
                    { label: 'Faces',    value: String(detail.face_count || 1) },
                    { label: 'Lighting', value: detail.illuminated ? '💡 Illuminated (24hr)' : 'Not illuminated' },
                    { label: 'City',     value: [detail.city, detail.state].filter(Boolean).join(', ') || '—' },
                    { label: 'Photos',   value: photos.length > 0 ? `${photos.length} photo${photos.length > 1 ? 's' : ''} available` : 'No photos — contact owner' },
                  ].map(({ label, value }) => (
                    <div key={label} style={{ background: '#F8FAFC', border: '1px solid #F1F5F9', borderRadius: 8, padding: '10px 12px' }}>
                      <p style={{ fontSize: '0.5625rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 3px' }}>{label}</p>
                      <p style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#0F172A', margin: 0, lineHeight: 1.4 }}>{value}</p>
                    </div>
                  ))}
                </div>

                {/* Notes / description */}
                {detail.notes && (
                  <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 10, padding: '12px 14px', marginBottom: 16 }}>
                    <p style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#92400E', textTransform: 'uppercase', letterSpacing: '0.07em', margin: '0 0 6px' }}>Owner notes</p>
                    <p style={{ fontSize: '0.8125rem', color: '#78350F', margin: 0, lineHeight: 1.6 }}>{detail.notes}</p>
                  </div>
                )}

                {/* ── Contact & Offer section ── */}
                <div style={{ borderTop: '1px solid #F1F5F9', paddingTop: 16 }}>
                  <p style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.07em', margin: '0 0 10px' }}>
                    How to proceed
                  </p>

                  {detail.status === 'available' ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {/* Make Offer — primary */}
                      <button
                        onClick={() => { setOfferBoard(detail); setDetail(null); }}
                        style={{ width: '100%', padding: '14px', borderRadius: 10, border: 'none', background: '#1B4F8A', color: '#fff', fontSize: '0.9375rem', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', boxShadow: '0 4px 16px rgba(27,79,138,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"/><path d="M8 12h8M12 8v8"/></svg>
                        Make an offer on the platform →
                      </button>

                      {/* Divider */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ flex: 1, height: 1, background: '#E2E8F0' }} />
                        <span style={{ fontSize: '0.6875rem', color: '#94A3B8', fontWeight: 500 }}>or contact directly</span>
                        <div style={{ flex: 1, height: 1, background: '#E2E8F0' }} />
                      </div>

                      {/* WhatsApp + Call row */}
                      <div style={{ display: 'grid', gridTemplateColumns: phone ? '1fr 1fr' : '1fr', gap: 8 }}>
                        {phone && (
                          <a
                            href={`https://wa.me/${phone}?text=${buildWhatsAppMsg(detail)}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '12px', borderRadius: 10, background: '#25D366', color: '#fff', textDecoration: 'none', fontSize: '0.875rem', fontWeight: 700, fontFamily: 'inherit' }}
                          >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                            WhatsApp owner
                          </a>
                        )}
                        {phone && (
                          <a
                            href={`tel:${detail.contact_phone}`}
                            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '12px', borderRadius: 10, background: '#F1F5F9', color: '#0F172A', textDecoration: 'none', fontSize: '0.875rem', fontWeight: 700, fontFamily: 'inherit', border: '1.5px solid #E2E8F0' }}
                          >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.6 1.36h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 9a16 16 0 0 0 6.1 6.1l.91-.91a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
                            Call owner
                          </a>
                        )}
                        {!phone && (
                          <div style={{ padding: '12px', borderRadius: 10, background: '#F8FAFC', border: '1px dashed #E2E8F0', textAlign: 'center' }}>
                            <p style={{ fontSize: '0.75rem', color: '#94A3B8', margin: 0 }}>No phone number listed — use platform offer to contact the owner</p>
                          </div>
                        )}
                      </div>

                      <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: '2px 0 0', textAlign: 'center' }}>
                        Platform offers are tracked, negotiable, and come with a contract when agreed
                      </p>
                    </div>
                  ) : (
                    <div>
                      <div style={{ padding: '14px', borderRadius: 10, background: '#F8FAFC', border: '1px solid #E2E8F0', textAlign: 'center', marginBottom: 10 }}>
                        <p style={{ fontSize: '0.875rem', color: '#94A3B8', margin: '0 0 4px', fontWeight: 600 }}>This board is currently booked</p>
                        {detail.available_from && (
                          <p style={{ fontSize: '0.75rem', color: '#64748B', margin: 0 }}>
                            Expected availability from {new Date(detail.available_from).toLocaleDateString('en-NG', { day: 'numeric', month: 'long', year: 'numeric' })}
                          </p>
                        )}
                      </div>
                      {phone && (
                        <a
                          href={`https://wa.me/${phone}?text=${buildWhatsAppMsg(detail)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '12px', borderRadius: 10, background: '#25D366', color: '#fff', textDecoration: 'none', fontSize: '0.875rem', fontWeight: 700, fontFamily: 'inherit' }}
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                          WhatsApp about future availability
                        </a>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Make Offer Modal ── */}
      {offerBoard && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
          onClick={e => { if (e.target === e.currentTarget) setOfferBoard(null); }}>
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(15,23,42,0.65)', backdropFilter: 'blur(5px)' }} onClick={() => setOfferBoard(null)} />
          <div style={{ position: 'relative', background: '#fff', borderRadius: 16, width: '100%', maxWidth: 500, boxShadow: '0 24px 60px rgba(0,0,0,0.22)', animation: 'fadeIn 0.2s both', overflow: 'hidden' }}>
            {/* Header */}
            <div style={{ background: '#0F172A', padding: '18px 24px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <p style={{ fontSize: '0.625rem', color: 'rgba(255,255,255,0.4)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 3px' }}>Make an offer</p>
                  <p style={{ fontSize: '1rem', fontWeight: 700, color: '#fff', margin: '0 0 2px' }}>{offerBoard.name}</p>
                  <p style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.5)', margin: 0 }}>
                    {offerBoard.city} · Asking {fmtNaira(offerBoard.asking_rate)}/month
                  </p>
                </div>
                <button onClick={() => setOfferBoard(null)} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', cursor: 'pointer', fontSize: '20px', padding: 0, lineHeight: 1, marginTop: 2 }}>✕</button>
              </div>
            </div>

            <div style={{ padding: '22px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Campaign */}
              <div>
                <label style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>Link to campaign (optional)</label>
                <select value={offerForm.campaign_id} onChange={e => setOfferForm(f => ({ ...f, campaign_id: e.target.value }))}
                  style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1.5px solid #E2E8F0', fontSize: '0.875rem', color: '#0F172A', fontFamily: 'inherit', outline: 'none', background: '#fff' }}>
                  <option value="">— Create a new campaign automatically —</option>
                  {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>

              {/* Rate */}
              <div>
                <label style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>
                  Your offer (₦/month) *
                  <span style={{ fontSize: '0.6875rem', fontWeight: 400, color: '#94A3B8', marginLeft: 8 }}>Asking: {fmtNaira(offerBoard.asking_rate)}</span>
                </label>
                <div style={{ position: 'relative' }}>
                  <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#94A3B8', fontWeight: 700, fontSize: '0.9375rem' }}>₦</span>
                  <input type="number" value={offerForm.offered_rate} onChange={e => setOfferForm(f => ({ ...f, offered_rate: e.target.value }))}
                    placeholder={String(offerBoard.asking_rate)}
                    style={{ width: '100%', padding: '10px 12px 10px 28px', borderRadius: 8, border: '1.5px solid #E2E8F0', fontSize: '1rem', fontWeight: 700, color: '#0F172A', fontFamily: 'monospace', outline: 'none', boxSizing: 'border-box' }} />
                </div>
                {offerForm.offered_rate && parseFloat(offerForm.offered_rate) < offerBoard.asking_rate && (
                  <p style={{ fontSize: '0.6875rem', color: '#92400E', margin: '5px 0 0', background: '#FFFBEB', padding: '5px 8px', borderRadius: 6 }}>
                    Your offer is {Math.round((1 - parseFloat(offerForm.offered_rate) / offerBoard.asking_rate) * 100)}% below asking — the owner may counter.
                  </p>
                )}
              </div>

              {/* Dates */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>Start date</label>
                  <input type="date" value={offerForm.start_date} onChange={e => setOfferForm(f => ({ ...f, start_date: e.target.value }))}
                    style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1.5px solid #E2E8F0', fontSize: '0.875rem', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }} />
                </div>
                <div>
                  <label style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>End date</label>
                  <input type="date" value={offerForm.end_date} onChange={e => setOfferForm(f => ({ ...f, end_date: e.target.value }))}
                    style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1.5px solid #E2E8F0', fontSize: '0.875rem', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }} />
                </div>
              </div>

              {/* Notes */}
              <div>
                <label style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>Message to board owner (optional)</label>
                <textarea value={offerForm.notes} onChange={e => setOfferForm(f => ({ ...f, notes: e.target.value }))}
                  placeholder="Tell the owner about your campaign, brand, or any special requirements…"
                  rows={3}
                  style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1.5px solid #E2E8F0', fontSize: '0.875rem', fontFamily: 'inherit', resize: 'vertical', outline: 'none', boxSizing: 'border-box', color: '#0F172A' }} />
              </div>

              <button
                onClick={submitOffer}
                disabled={submitting || !offerForm.offered_rate}
                style={{
                  width: '100%', padding: '13px', borderRadius: 10, border: 'none',
                  background: submitting || !offerForm.offered_rate ? '#94A3B8' : '#1B4F8A',
                  color: '#fff', fontSize: '0.9375rem', fontWeight: 700,
                  cursor: submitting || !offerForm.offered_rate ? 'not-allowed' : 'pointer',
                  fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  boxShadow: submitting || !offerForm.offered_rate ? 'none' : '0 4px 16px rgba(27,79,138,0.3)',
                }}
              >
                {submitting
                  ? <><span style={{ display: 'inline-block', width: 16, height: 16, border: '2px solid rgba(255,255,255,0.4)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} /> Sending offer…</>
                  : 'Send offer & start negotiation →'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
