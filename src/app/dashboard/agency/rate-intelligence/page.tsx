'use client';

import { useState, useEffect } from 'react';
import { getAllMarketRates, getRateTrend, getPlatformStats, getNegotiationSpreads, type RateTrendPoint, type NegotiationSpread } from '@/lib/rate-intelligence';
import { formatNaira } from '@/lib/utils';
import { SkeletonGrid } from '@/components/ui/Skeleton';

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
  const [spreads, setSpreads] = useState<Record<string, NegotiationSpread>>({});
  const [platformStats, setPlatformStats] = useState({ totalDeals: 0, uniqueCities: 0, uniqueFormats: 0, uniqueAgencies: 0 });
  const [sortCol, setSortCol] = useState<keyof MarketRow>('avg');
  const [sortAsc, setSortAsc] = useState(false);
  const [filterCity, setFilterCity] = useState('');
  const [filterFormat, setFilterFormat] = useState('');
  // Rate calculator
  const [calcFormat, setCalcFormat] = useState('');
  const [calcCity, setCalcCity] = useState('');
  const [calcAsk, setCalcAsk] = useState('');

  useEffect(() => {
    Promise.all([
      getAllMarketRates(),
      getPlatformStats(),
      getNegotiationSpreads(),
    ]).then(([data, stats, spreadData]) => {
      setRows(data);
      setPlatformStats(stats);
      const spreadMap: Record<string, NegotiationSpread> = {};
      spreadData.forEach(s => { spreadMap[`${s.format}||${s.city}`] = s; });
      setSpreads(spreadMap);
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
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: '1.5rem' }}>
        {[
          { label: 'Closed deals tracked', value: platformStats.totalDeals, accent: '#1B4F8A' },
          { label: 'Agencies contributing', value: platformStats.uniqueAgencies, accent: '#7C3AED' },
          { label: 'Cities covered', value: platformStats.uniqueCities, accent: '#059669' },
          { label: 'Format types', value: platformStats.uniqueFormats, accent: '#D97706' },
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
        <SkeletonGrid cols={3} rows={3} />
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
            gridTemplateColumns: '1.4fr 1fr 1fr 1fr 1fr 80px 90px 80px',
            padding: '10px 20px',
            background: '#F8FAFC',
            borderBottom: '1px solid #F1F5F9',
          }}>
            {([
              ['format', 'Format'],
              ['city', 'City'],
              ['avg', 'Avg agreed'],
              ['min', 'Min'],
              ['max', 'Max'],
              ['count', 'Deals'],
              [null, 'Nego spread'],
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
            const spread = spreads[key];
            const isLimited = row.count < 5;

            return (
              <div
                key={key}
                className="ri-row"
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1.4fr 1fr 1fr 1fr 1fr 80px 90px 80px',
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
                  {spread ? (
                    <div>
                      <span style={{
                        fontSize: '0.8125rem', fontWeight: 700, fontFamily: 'monospace',
                        color: spread.spread_pct < -15 ? '#059669' : spread.spread_pct < -5 ? '#D97706' : '#DC2626',
                      }}>
                        {spread.spread_pct > 0 ? '+' : ''}{spread.spread_pct}%
                      </span>
                      <p style={{ fontSize: '0.5625rem', color: '#94A3B8', margin: '1px 0 0' }}>from asking</p>
                    </div>
                  ) : (
                    <span style={{ fontSize: '0.6875rem', color: '#CBD5E1' }}>—</span>
                  )}
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

      {/* Rate calculator */}
      {rows.length > 0 && (
        <div style={{ marginTop: '1.5rem', background: '#fff', border: '1px solid #E8EDF2', borderRadius: 12, padding: '20px 22px' }}>
          <h2 style={{ fontSize: '0.9375rem', fontWeight: 700, color: '#0F172A', margin: '0 0 4px' }}>Rate position calculator</h2>
          <p style={{ fontSize: '0.75rem', color: '#94A3B8', margin: '0 0 16px' }}>Enter your asking rate to see how it compares to market — and what you can expect to agree at</p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
            <select value={calcFormat} onChange={e => setCalcFormat(e.target.value)}
              style={{ padding: '8px 12px', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: '0.875rem', color: '#374151', outline: 'none', background: '#fff', fontFamily: 'inherit', minWidth: 160 }}>
              <option value="">Select format</option>
              {[...new Set(rows.map(r => r.format))].sort().map(f => <option key={f} value={f}>{FORMAT_LABELS[f] || f}</option>)}
            </select>
            <select value={calcCity} onChange={e => setCalcCity(e.target.value)}
              style={{ padding: '8px 12px', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: '0.875rem', color: '#374151', outline: 'none', background: '#fff', fontFamily: 'inherit', minWidth: 160 }}>
              <option value="">Select city</option>
              {[...new Set(rows.map(r => r.city))].sort().map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <div style={{ position: 'relative' }}>
              <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', fontWeight: 700, color: '#94A3B8', fontSize: '0.875rem' }}>₦</span>
              <input type="number" value={calcAsk} onChange={e => setCalcAsk(e.target.value)}
                placeholder="Your asking rate"
                style={{ padding: '8px 12px 8px 26px', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: '0.875rem', color: '#0F172A', outline: 'none', fontFamily: 'inherit', width: 180 }} />
            </div>
          </div>
          {(() => {
            if (!calcFormat || !calcCity || !calcAsk) return null;
            const marketRow = rows.find(r => r.format === calcFormat && r.city === calcCity);
            const spreadRow = spreads[`${calcFormat}||${calcCity}`];
            if (!marketRow) return (
              <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 8, padding: '12px 14px' }}>
                <p style={{ fontSize: '0.8125rem', color: '#92400E', margin: 0 }}>No market data yet for {FORMAT_LABELS[calcFormat] || calcFormat} in {calcCity}. Close some deals there to build the dataset.</p>
              </div>
            );
            const ask = parseFloat(calcAsk);
            const diffPct = Math.round(((ask - marketRow.avg) / marketRow.avg) * 100);
            const expectedAgreed = spreadRow ? Math.round(ask * (1 + spreadRow.spread_pct / 100)) : null;
            return (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                {[
                  {
                    label: 'vs. market avg',
                    value: `${diffPct > 0 ? '+' : ''}${diffPct}%`,
                    sub: `Market avg: ${formatNaira(marketRow.avg)}`,
                    color: Math.abs(diffPct) <= 10 ? '#059669' : Math.abs(diffPct) <= 25 ? '#D97706' : '#DC2626',
                    bg: Math.abs(diffPct) <= 10 ? '#ECFDF5' : Math.abs(diffPct) <= 25 ? '#FFFBEB' : '#FEF2F2',
                  },
                  {
                    label: 'market range',
                    value: `${formatNaira(marketRow.min)} – ${formatNaira(marketRow.max)}`,
                    sub: `${marketRow.count} closed deals`,
                    color: '#1B4F8A',
                    bg: '#EFF6FF',
                  },
                  {
                    label: 'expected agreed rate',
                    value: expectedAgreed ? formatNaira(expectedAgreed) : '—',
                    sub: spreadRow ? `Based on avg ${spreadRow.spread_pct}% negotiation spread` : 'Not enough spread data',
                    color: '#7C3AED',
                    bg: '#F5F3FF',
                  },
                ].map(s => (
                  <div key={s.label} style={{ background: s.bg, borderRadius: 10, padding: '14px 16px' }}>
                    <p style={{ fontSize: '0.625rem', fontWeight: 700, color: s.color, textTransform: 'uppercase', letterSpacing: '0.07em', margin: '0 0 6px', opacity: 0.8 }}>{s.label}</p>
                    <p style={{ fontSize: '1.125rem', fontWeight: 800, color: s.color, fontFamily: 'monospace', margin: '0 0 3px', letterSpacing: '-0.02em' }}>{s.value}</p>
                    <p style={{ fontSize: '0.6875rem', color: s.color, margin: 0, opacity: 0.65 }}>{s.sub}</p>
                  </div>
                ))}
              </div>
            );
          })()}
        </div>
      )}

      {/* Explainer */}
      <div style={{ marginTop: '1.5rem', background: '#F8FAFC', border: '1px solid #E8EDF2', borderRadius: 10, padding: '14px 18px' }}>
        <p style={{ fontSize: '0.75rem', fontWeight: 700, color: '#0F172A', margin: '0 0 6px' }}>How this works</p>
        <p style={{ fontSize: '0.75rem', color: '#64748B', margin: 0, lineHeight: 1.6 }}>
          Rates are sourced from closed deals across all agencies on the platform (agreed, signed, live, or complete).
          <strong> Negotiation spread</strong> shows the average % difference between the initial offered rate and the final agreed rate — negative means agencies successfully negotiate below asking.
          Confidence is <strong>High</strong> (10+ deals), <strong>Medium</strong> (5–9), or <strong>Limited</strong> ({'<'}5). Use limited-data rows as a directional guide only.
        </p>
      </div>
    </div>
  );
}
