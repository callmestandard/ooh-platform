'use client';

import { useState, useEffect } from 'react';
import { getAllMarketRates, getRateTrend, type RateTrendPoint } from '@/lib/rate-intelligence';
import { formatNaira } from '@/lib/utils';

type MarketRow = {
  format: string;
  city: string;
  avg: number;
  min: number;
  max: number;
  median: number;
  count: number;
};

const FORMAT_LABELS: Record<string, string> = {
  billboard: 'Billboard',
  unipole: 'Unipole',
  gantry: 'Gantry',
  bridge_panel: 'Bridge Panel',
  wall_drape: 'Wall Drape',
};

function Confidence({ count }: { count: number }) {
  if (count >= 10) return (
    <span style={{ fontSize: '0.625rem', fontWeight: 700, color: '#065F46', background: '#D1FAE5', padding: '2px 7px', borderRadius: 999 }}>High</span>
  );
  if (count >= 5) return (
    <span style={{ fontSize: '0.625rem', fontWeight: 700, color: '#1E40AF', background: '#DBEAFE', padding: '2px 7px', borderRadius: 999 }}>Medium</span>
  );
  return (
    <span style={{ fontSize: '0.625rem', fontWeight: 700, color: '#92400E', background: '#FEF3C7', padding: '2px 7px', borderRadius: 999 }}>Limited</span>
  );
}

function SparkBar({ trend }: { trend: RateTrendPoint[] }) {
  if (trend.length < 2) return <span style={{ fontSize: '0.6875rem', color: '#CBD5E1' }}>—</span>;
  const max = Math.max(...trend.map(t => t.avg));
  const min = Math.min(...trend.map(t => t.avg));
  const range = max - min || 1;
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 24 }}>
      {trend.slice(-8).map((t, i) => {
        const h = Math.max(3, Math.round(((t.avg - min) / range) * 20));
        return (
          <div
            key={i}
            title={`${t.month}: ${formatNaira(t.avg)}`}
            style={{ width: 5, height: h, background: '#1B4F8A', borderRadius: 2, opacity: 0.6 + (i / trend.length) * 0.4 }}
          />
        );
      })}
    </div>
  );
}

export default function RateIntelligencePage() {
  const [rows, setRows] = useState<MarketRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [trends, setTrends] = useState<Record<string, RateTrendPoint[]>>({});
  const [sortCol, setSortCol] = useState<keyof MarketRow>('avg');
  const [sortAsc, setSortAsc] = useState(false);
  const [filterCity, setFilterCity] = useState('');
  const [filterFormat, setFilterFormat] = useState('');

  useEffect(() => {
    getAllMarketRates().then(data => {
      setRows(data);
      setLoading(false);
      data.forEach(row => {
        getRateTrend(row.format, row.city, 12).then(trend => {
          setTrends(prev => ({ ...prev, [`${row.format}||${row.city}`]: trend }));
        });
      });
    });
  }, []);

  const cities = [...new Set(rows.map(r => r.city))].sort();
  const formats = [...new Set(rows.map(r => r.format))].sort();

  const filtered = rows.filter(r =>
    (!filterCity || r.city === filterCity) &&
    (!filterFormat || r.format === filterFormat)
  );

  const sorted = [...filtered].sort((a, b) => {
    const v = sortAsc ? 1 : -1;
    if (typeof a[sortCol] === 'number') return ((a[sortCol] as number) - (b[sortCol] as number)) * v;
    return String(a[sortCol]).localeCompare(String(b[sortCol])) * v;
  });

  function toggleSort(col: keyof MarketRow) {
    if (sortCol === col) setSortAsc(a => !a);
    else { setSortCol(col); setSortAsc(false); }
  }

  const totalDeals = rows.reduce((s, r) => s + r.count, 0);
  const uniqueFormats = new Set(rows.map(r => r.format)).size;
  const uniqueCities = new Set(rows.map(r => r.city)).size;

  const SortArrow = ({ col }: { col: keyof MarketRow }) => (
    <span style={{ marginLeft: 3, opacity: sortCol === col ? 1 : 0.3, fontSize: '0.5625rem' }}>
      {sortCol === col ? (sortAsc ? '▲' : '▼') : '⇅'}
    </span>
  );

  return (
    <div style={{ fontFamily: "'Inter', -apple-system, sans-serif" }}>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeUp { from { opacity:0; transform:translateY(5px); } to { opacity:1; transform:translateY(0); } }
        .ri-row:hover { background: #F5F8FF !important; }
        .ri-th { cursor: pointer; user-select: none; }
        .ri-th:hover { color: #1B4F8A !important; }
      `}</style>

      {/* Header */}
      <div style={{ marginBottom: '1.75rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
          <h1 style={{ fontSize: '1.375rem', fontWeight: 700, color: '#0F172A', letterSpacing: '-0.025em', margin: 0 }}>
            Rate Intelligence
          </h1>
          <span style={{ background: '#EFF6FF', color: '#1E40AF', border: '1px solid #BFDBFE', borderRadius: '999px', padding: '2px 10px', fontSize: '0.6875rem', fontWeight: 700 }}>
            BETA
          </span>
        </div>
        <p style={{ fontSize: '0.8125rem', color: '#94A3B8', margin: 0 }}>
          Agreed rates from closed deals · helps you price and negotiate smarter
        </p>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: '1.5rem' }}>
        {[
          { label: 'Closed deals tracked', value: totalDeals, accent: '#1B4F8A' },
          { label: 'Format types', value: uniqueFormats, accent: '#D97706' },
          { label: 'Cities covered', value: uniqueCities, accent: '#059669' },
        ].map(({ label, value, accent }) => (
          <div key={label} style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: '10px', padding: '14px 16px' }}>
            <p style={{ fontSize: '0.625rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.07em', margin: '0 0 6px' }}>{label}</p>
            <span style={{ fontSize: '1.625rem', fontWeight: 700, color: accent, fontFamily: 'monospace', letterSpacing: '-0.02em' }}>{value}</span>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: '1.25rem', flexWrap: 'wrap' }}>
        <select
          value={filterCity}
          onChange={e => setFilterCity(e.target.value)}
          style={{ padding: '7px 12px', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: '0.8125rem', color: '#374151', outline: 'none', background: '#fff', fontFamily: 'inherit' }}
        >
          <option value="">All cities</option>
          {cities.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select
          value={filterFormat}
          onChange={e => setFilterFormat(e.target.value)}
          style={{ padding: '7px 12px', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: '0.8125rem', color: '#374151', outline: 'none', background: '#fff', fontFamily: 'inherit' }}
        >
          <option value="">All formats</option>
          {formats.map(f => <option key={f} value={f}>{FORMAT_LABELS[f] || f}</option>)}
        </select>
        {(filterCity || filterFormat) && (
          <button
            onClick={() => { setFilterCity(''); setFilterFormat(''); }}
            style={{ padding: '7px 12px', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: '0.8125rem', color: '#64748B', background: '#F8FAFC', cursor: 'pointer', fontFamily: 'inherit' }}
          >
            Clear
          </button>
        )}
      </div>

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '5rem 0' }}>
          <div style={{ width: 28, height: 28, border: '2px solid #E2E8F0', borderTopColor: '#1B4F8A', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
        </div>
      ) : rows.length === 0 ? (
        <div style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: 12, padding: '4rem 2rem', textAlign: 'center' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: 12 }}>📊</div>
          <p style={{ fontSize: '1rem', fontWeight: 600, color: '#0F172A', margin: '0 0 6px' }}>No transaction data yet</p>
          <p style={{ fontSize: '0.8125rem', color: '#94A3B8', margin: 0 }}>
            Rate intelligence builds automatically as deals are agreed and closed.
            <br />Start closing bookings to see market rates appear here.
          </p>
        </div>
      ) : (
        <div style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: 12, overflow: 'hidden' }}>
          {/* Table header */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1.4fr 1fr 1fr 1fr 1fr 80px 80px',
            padding: '10px 20px',
            background: '#F8FAFC',
            borderBottom: '1px solid #F1F5F9',
          }}>
            {([
              ['format', 'Format'],
              ['city', 'City'],
              ['avg', 'Avg rate'],
              ['min', 'Min'],
              ['max', 'Max'],
              ['count', 'Deals'],
              [null, 'Trend'],
            ] as [keyof MarketRow | null, string][]).map(([col, label]) => (
              <span
                key={label}
                className={col ? 'ri-th' : ''}
                onClick={col ? () => toggleSort(col) : undefined}
                style={{ fontSize: '0.625rem', fontWeight: 700, color: sortCol === col ? '#1B4F8A' : '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.07em' }}
              >
                {label}{col && <SortArrow col={col} />}
              </span>
            ))}
          </div>

          {sorted.length === 0 ? (
            <div style={{ padding: '3rem 2rem', textAlign: 'center', color: '#94A3B8', fontSize: '0.875rem' }}>
              No data matches your filters.
            </div>
          ) : sorted.map((row, i) => {
            const key = `${row.format}||${row.city}`;
            const trend = trends[key] || [];
            const isLimited = row.count < 5;

            return (
              <div
                key={key}
                className="ri-row"
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1.4fr 1fr 1fr 1fr 1fr 80px 80px',
                  padding: '13px 20px',
                  alignItems: 'center',
                  borderBottom: i < sorted.length - 1 ? '1px solid #F8FAFC' : 'none',
                  animation: 'fadeUp 0.2s ease forwards',
                  animationDelay: `${i * 0.03}s`,
                  opacity: 0,
                  background: isLimited ? '#FFFDF0' : '#fff',
                  transition: 'background 0.1s',
                }}
              >
                <div>
                  <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#0F172A' }}>
                    {FORMAT_LABELS[row.format] || row.format}
                  </span>
                </div>
                <div>
                  <span style={{ fontSize: '0.8125rem', color: '#374151' }}>{row.city}</span>
                </div>
                <div>
                  <span style={{ fontSize: '0.9375rem', fontWeight: 700, color: '#1B4F8A', fontFamily: 'monospace' }}>
                    {formatNaira(row.avg)}
                  </span>
                </div>
                <div>
                  <span style={{ fontSize: '0.8125rem', color: '#64748B', fontFamily: 'monospace' }}>{formatNaira(row.min)}</span>
                </div>
                <div>
                  <span style={{ fontSize: '0.8125rem', color: '#64748B', fontFamily: 'monospace' }}>{formatNaira(row.max)}</span>
                </div>
                <div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#0F172A', fontFamily: 'monospace' }}>{row.count}</span>
                    <Confidence count={row.count} />
                  </div>
                </div>
                <div>
                  <SparkBar trend={trend} />
                </div>
              </div>
            );
          })}

          <div style={{ padding: '10px 20px', borderTop: '1px solid #F1F5F9', background: '#FAFBFC' }}>
            <span style={{ fontSize: '0.75rem', color: '#94A3B8' }}>
              Showing {sorted.length} of {rows.length} format × city combination{rows.length !== 1 ? 's' : ''}
              {' · '}Rows with <span style={{ background: '#FEF9C3', padding: '0 4px', borderRadius: 3 }}>yellow</span> background have limited data ({'<'}5 deals)
            </span>
          </div>
        </div>
      )}

      {/* Explainer */}
      <div style={{ marginTop: '1.5rem', background: '#F8FAFC', border: '1px solid #E8EDF2', borderRadius: 10, padding: '14px 18px' }}>
        <p style={{ fontSize: '0.75rem', fontWeight: 700, color: '#0F172A', margin: '0 0 6px' }}>How this works</p>
        <p style={{ fontSize: '0.75rem', color: '#64748B', margin: 0, lineHeight: 1.6 }}>
          Rates are sourced exclusively from bookings where both parties agreed on a final price
          (status: agreed, signed, live, or complete). The asking rate is not used — only the negotiated
          outcome. Confidence is <strong>High</strong> (10+ deals), <strong>Medium</strong> (5–9), or <strong>Limited</strong> ({'<'}5).
          Use limited-data rows as a directional guide only.
        </p>
      </div>
    </div>
  );
}
