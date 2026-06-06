'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

// ── Types ──────────────────────────────────────────────────────────────────

type Board = {
  id: string;
  name: string;
  address: string;
  city: string;
  state: string;
  format: string;
  asking_rate: number;
  width: number;
  height: number;
  illuminated: boolean;
  face_count: number;
  status: 'available' | 'booked' | 'maintenance';
};

// ── Constants ──────────────────────────────────────────────────────────────

const FORMAT_LABELS: Record<string, string> = {
  billboard:    'Billboard',
  unipole:      'Unipole',
  gantry:       'Gantry',
  bridge_panel: 'Bridge Panel',
  wall_drape:   'Wall Drape',
  led:          'LED Screen',
};

const NIGERIAN_STATES = [
  'Lagos', 'Abuja', 'Rivers', 'Kano', 'Ogun', 'Oyo', 'Delta', 'Anambra',
  'Enugu', 'Kaduna', 'Kwara', 'Cross River',
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
    available:   { label: 'Available',   color: '#059669', bg: '#ECFDF5' },
    booked:      { label: 'Booked',      color: '#3B82F6', bg: '#EFF6FF' },
    maintenance: { label: 'Maintenance', color: '#D97706', bg: '#FFFBEB' },
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
        {/* Mockup header */}
        <div style={{ background: '#F8FAFC', padding: '24px 24px 0', borderBottom: '1px solid #F1F5F9' }}>
          <div style={{ maxWidth: 300, margin: '0 auto' }}>
            <BoardMockup format={board.format} illuminated={board.illuminated} status={board.status} />
          </div>
        </div>

        {/* Content */}
        <div style={{ padding: 24 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 }}>
            <div>
              <h2 style={{ fontSize: '1.125rem', fontWeight: 700, color: '#0F172A', margin: '0 0 4px', letterSpacing: '-0.02em' }}>
                {board.name}
              </h2>
              <p style={{ fontSize: '0.8125rem', color: '#64748B', margin: 0 }}>{board.address}</p>
            </div>
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8', padding: 4, marginTop: -4 }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 20 }}>
            {[
              { label: 'Format',      value: FORMAT_LABELS[board.format] ?? board.format },
              { label: 'Dimensions',  value: `${board.width}m × ${board.height}m` },
              { label: 'Location',    value: `${board.city}, ${board.state}` },
              { label: 'Faces',       value: board.face_count === 1 ? 'Single face' : `${board.face_count} faces` },
              { label: 'Illuminated', value: board.illuminated ? 'Yes — backlit' : 'No' },
              { label: 'Monthly rate', value: formatNaira(board.asking_rate) },
            ].map(({ label, value }) => (
              <div key={label} style={{ background: '#F8FAFC', borderRadius: 10, padding: '10px 14px' }}>
                <p style={{ fontSize: '0.6875rem', color: '#94A3B8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 3px' }}>{label}</p>
                <p style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0F172A', margin: 0 }}>{value}</p>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 16 }}>
            <StatusBadge status={board.status} />
          </div>

          {board.status === 'available' ? (
            <button
              onClick={onRequestQuote}
              style={{
                width: '100%', padding: '12px', background: '#1B4F8A', color: '#fff',
                border: 'none', borderRadius: 10, fontSize: '0.9375rem', fontWeight: 600,
                cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              Request a quote — {formatNaira(board.asking_rate)}/mo
            </button>
          ) : (
            <div style={{ background: '#F8FAFC', borderRadius: 10, padding: '12px 16px', textAlign: 'center' }}>
              <p style={{ fontSize: '0.875rem', color: '#64748B', margin: 0 }}>
                {board.status === 'booked' ? 'This board is currently booked. Join waitlist →' : 'Under maintenance — check back soon.'}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────

export default function MarketplacePage() {
  const router = useRouter();
  const [boards, setBoards]         = useState<Board[]>([]);
  const [loading, setLoading]       = useState(true);
  const [search, setSearch]         = useState('');
  const [stateFilter, setStateFilter]   = useState('all');
  const [formatFilter, setFormatFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('available');
  const [priceMax, setPriceMax]     = useState(10_000_000);
  const [selected, setSelected]     = useState<Board | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('boards')
        .select('id, name, address, city, state, format, asking_rate, width, height, illuminated, face_count, status')
        .order('created_at', { ascending: false });

      setBoards((data as Board[]) || []);
      setLoading(false);
    }
    load();
  }, []);

  const filtered = useMemo(() => {
    return boards.filter(b => {
      if (statusFilter !== 'all' && b.status !== statusFilter) return false;
      if (stateFilter !== 'all' && b.state !== stateFilter) return false;
      if (formatFilter !== 'all' && b.format !== formatFilter) return false;
      if (b.asking_rate > priceMax) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!b.name.toLowerCase().includes(q) && !b.address.toLowerCase().includes(q) && !b.city.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [boards, statusFilter, stateFilter, formatFilter, priceMax, search]);

  const availableCount = boards.filter(b => b.status === 'available').length;
  const states = ['all', ...Array.from(new Set(boards.map(b => b.state))).sort()];
  const formats = ['all', ...Array.from(new Set(boards.map(b => b.format))).sort()];

  function handleQuote() {
    setSelected(null);
    router.push('/auth/login?from=marketplace');
  }

  return (
    <div style={{ minHeight: '100vh', background: '#F8FAFC', fontFamily: "'Inter', -apple-system, sans-serif" }}>
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
      `}</style>

      {/* ── Navbar ── */}
      <nav style={{
        position: 'sticky', top: 0, zIndex: 100,
        background: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(12px)',
        borderBottom: '1px solid #E8EDF2',
        padding: '0 24px', height: 60,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 32 }}>
          <button onClick={() => router.push('/')} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex' }}>
            <Logo />
          </button>
          <div style={{ display: 'flex', gap: 20 }}>
            <a className="nav-link" href="#" style={{ color: '#1B4F8A', fontWeight: 600, fontSize: '0.875rem', textDecoration: 'none' }}>Marketplace</a>
            <a className="nav-link" href="#how" style={{ textDecoration: 'none' }}>How it works</a>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button
            onClick={() => router.push('/')}
            style={{ padding: '8px 16px', background: 'none', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: '0.875rem', fontWeight: 500, color: '#0F172A', cursor: 'pointer', fontFamily: 'inherit' }}
          >
            Sign in
          </button>
          <button
            onClick={() => router.push('/')}
            style={{ padding: '8px 16px', background: '#1B4F8A', color: '#fff', border: 'none', borderRadius: 8, fontSize: '0.875rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
          >
            Get started
          </button>
        </div>
      </nav>

      {/* ── Hero ── */}
      <div style={{
        background: 'linear-gradient(135deg, #0F172A 0%, #1B4F8A 100%)',
        padding: '52px 24px 40px',
      }}>
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
            Browse {boards.length}+ OOH locations across Nigeria. Filter by city, format, and budget — then request a quote in seconds.
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
                onClick={() => setStateFilter(city === 'Port Harcourt' ? 'Rivers' : city === 'Ibadan' ? 'Oyo' : city)}
                style={{
                  padding: '6px 14px', borderRadius: 999, fontSize: '0.8125rem', fontWeight: 500,
                  background: (stateFilter === city || (city === 'Port Harcourt' && stateFilter === 'Rivers') || (city === 'Ibadan' && stateFilter === 'Oyo'))
                    ? '#fff' : 'rgba(255,255,255,0.12)',
                  color: (stateFilter === city || (city === 'Port Harcourt' && stateFilter === 'Rivers') || (city === 'Ibadan' && stateFilter === 'Oyo'))
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
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '32px 24px' }}>
        {/* Toolbar */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, gap: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <p style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0F172A', margin: 0 }}>
              {loading ? 'Loading...' : `${filtered.length} board${filtered.length !== 1 ? 's' : ''}`}
            </p>
            {!loading && filtered.length !== boards.length && (
              <span style={{ fontSize: '0.75rem', color: '#94A3B8' }}>of {boards.length} total</span>
            )}
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {/* Status quick filter */}
            {['available', 'all'].map(s => (
              <button
                key={s}
                className="filter-pill"
                onClick={() => setStatusFilter(s)}
                style={{
                  padding: '6px 14px', borderRadius: 999, fontSize: '0.8125rem', fontWeight: 500,
                  background: statusFilter === s ? '#1B4F8A' : '#fff',
                  color: statusFilter === s ? '#fff' : '#64748B',
                  border: `1px solid ${statusFilter === s ? '#1B4F8A' : '#E2E8F0'}`,
                }}
              >
                {s === 'available' ? 'Available only' : 'All boards'}
              </button>
            ))}

            {/* Format select */}
            <select
              value={formatFilter}
              onChange={e => setFormatFilter(e.target.value)}
              style={{
                padding: '6px 10px', borderRadius: 8, border: '1px solid #E2E8F0',
                fontSize: '0.8125rem', color: '#374151', background: '#fff',
                fontFamily: 'inherit', cursor: 'pointer', outline: 'none',
              }}
            >
              <option value="all">All formats</option>
              {formats.filter(f => f !== 'all').map(f => (
                <option key={f} value={f}>{FORMAT_LABELS[f] ?? f}</option>
              ))}
            </select>

            {/* State select */}
            <select
              value={stateFilter}
              onChange={e => setStateFilter(e.target.value)}
              style={{
                padding: '6px 10px', borderRadius: 8, border: '1px solid #E2E8F0',
                fontSize: '0.8125rem', color: '#374151', background: '#fff',
                fontFamily: 'inherit', cursor: 'pointer', outline: 'none',
              }}
            >
              <option value="all">All states</option>
              {NIGERIAN_STATES.map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
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
                  OOH Platform is Nigeria's billboard marketplace. Board owners list their inventory here; agencies browse and make offers.
                </p>
                <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
                  <a href="/auth/login" style={{ padding: '10px 22px', background: '#1B4F8A', color: '#fff', border: 'none', borderRadius: 8, fontSize: '0.875rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', textDecoration: 'none' }}>
                    Sign in as agency →
                  </a>
                  <a href="/auth/login?role=owner" style={{ padding: '10px 22px', background: '#fff', color: '#1B4F8A', border: '1.5px solid #1B4F8A', borderRadius: 8, fontSize: '0.875rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', textDecoration: 'none' }}>
                    List your board
                  </a>
                </div>
              </>
            ) : (
              <>
                <p style={{ fontSize: '1rem', fontWeight: 600, color: '#0F172A', margin: '0 0 6px' }}>No boards match your filters</p>
                <p style={{ fontSize: '0.875rem', color: '#64748B', margin: '0 0 20px' }}>Try adjusting your search or clearing filters</p>
                <button
                  onClick={() => { setSearch(''); setStateFilter('all'); setFormatFilter('all'); setStatusFilter('available'); }}
                  style={{ padding: '8px 18px', background: '#1B4F8A', color: '#fff', border: 'none', borderRadius: 8, fontSize: '0.875rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
                >
                  Clear all filters
                </button>
              </>
            )}
          </div>
        )}

        {/* Grid */}
        {!loading && filtered.length > 0 && (
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
                {/* Mockup */}
                <div style={{ background: '#F8FAFC', padding: '20px 24px 10px', borderBottom: '1px solid #F1F5F9' }}>
                  <BoardMockup format={board.format} illuminated={board.illuminated} status={board.status} />
                </div>

                {/* Info */}
                <div style={{ padding: '14px 16px' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
                    <div>
                      <p style={{ fontSize: '0.9375rem', fontWeight: 700, color: '#0F172A', margin: '0 0 3px', lineHeight: 1.3 }}>{board.name}</p>
                      <p style={{ fontSize: '0.75rem', color: '#94A3B8', margin: 0 }}>{board.city}, {board.state}</p>
                    </div>
                    <StatusBadge status={board.status} />
                  </div>

                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
                    <span style={{ fontSize: '0.6875rem', fontWeight: 600, color: '#1B4F8A', background: '#EFF6FF', padding: '2px 8px', borderRadius: 999 }}>
                      {FORMAT_LABELS[board.format] ?? board.format}
                    </span>
                    <span style={{ fontSize: '0.6875rem', fontWeight: 600, color: '#64748B', background: '#F1F5F9', padding: '2px 8px', borderRadius: 999 }}>
                      {board.width}m × {board.height}m
                    </span>
                    {board.illuminated && (
                      <span style={{ fontSize: '0.6875rem', fontWeight: 600, color: '#D97706', background: '#FFFBEB', padding: '2px 8px', borderRadius: 999 }}>
                        Illuminated
                      </span>
                    )}
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                      <p style={{ fontSize: '1.125rem', fontWeight: 800, color: '#1B4F8A', fontFamily: 'monospace', margin: 0, letterSpacing: '-0.02em' }}>
                        {formatNaira(board.asking_rate)}
                      </p>
                      <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: 0 }}>per month</p>
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
              No cold calls. No site visits. No spreadsheets.
            </p>
            <div className="resp-grid-3" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, maxWidth: 640, margin: '0 auto 36px', textAlign: 'left' }}>
              {[
                { num: '01', title: 'Browse & filter', body: 'Find boards by city, format, size, and budget on one page.' },
                { num: '02', title: 'Request a quote', body: 'Submit your campaign dates and budget. Owner responds in 24h.' },
                { num: '03', title: 'Go live', body: 'Sign digitally, upload creatives, and track compliance in real time.' },
              ].map(({ num, title, body }) => (
                <div key={num} style={{ background: 'rgba(255,255,255,0.05)', borderRadius: 12, padding: '16px' }}>
                  <p style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#F59E0B', margin: '0 0 8px', letterSpacing: '0.06em' }}>{num}</p>
                  <p style={{ fontSize: '0.9375rem', fontWeight: 700, color: '#fff', margin: '0 0 6px' }}>{title}</p>
                  <p style={{ fontSize: '0.8125rem', color: 'rgba(255,255,255,0.45)', margin: 0, lineHeight: 1.5 }}>{body}</p>
                </div>
              ))}
            </div>
            <button
              onClick={() => router.push('/')}
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
    </div>
  );
}
