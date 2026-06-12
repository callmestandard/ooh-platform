import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';
import Link from 'next/link';
import type { CityMapBoard } from './CityMap';
import CityMap from './CityMapLoader';

export const revalidate = 3600;

// ── Helpers ────────────────────────────────────────────────────────────────

function toSlug(city: string) {
  return city.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function fromSlug(slug: string) {
  return slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function fmtRate(n: number) {
  if (n >= 1_000_000) return '₦' + (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000)     return '₦' + Math.round(n / 1_000) + 'K';
  return '₦' + n.toLocaleString('en-NG');
}

function fmtRateLong(n: number) {
  if (n >= 1_000_000) return '₦' + (n / 1_000_000).toFixed(2).replace(/\.?0+$/, '') + ' million';
  if (n >= 1_000)     return '₦' + Math.round(n / 1_000) + ',000';
  return '₦' + n.toLocaleString('en-NG');
}

const FORMAT_LABELS: Record<string, string> = {
  billboard:    'Billboard',
  unipole:      'Unipole',
  gantry:       'Gantry',
  bridge_panel: 'Bridge Panel',
  wall_drape:   'Wall Drape',
  digital:      'Digital / LED',
  led:          'LED Screen',
};

const FORMAT_COLORS: Record<string, { bg: string; text: string }> = {
  billboard:    { bg: '#EFF6FF', text: '#1D4ED8' },
  unipole:      { bg: '#F5F3FF', text: '#6D28D9' },
  gantry:       { bg: '#ECFDF5', text: '#065F46' },
  bridge_panel: { bg: '#FFF7ED', text: '#C2410C' },
  wall_drape:   { bg: '#FDF2F8', text: '#9D174D' },
  digital:      { bg: '#F0FDF4', text: '#15803D' },
  led:          { bg: '#F0FDF4', text: '#15803D' },
};

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://ooh-platform-xi.vercel.app';

// ── Data layer ─────────────────────────────────────────────────────────────

type DBBoard = {
  id: string;
  name: string;
  address: string;
  format: string;
  asking_rate: number;
  width: number | null;
  height: number | null;
  illuminated: boolean;
  photo_urls: string[] | null;
  latitude: number | null;
  longitude: number | null;
};

function getDB() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

async function fetchCityData(cityName: string) {
  const db = getDB();
  const [boardsRes, allCitiesRes] = await Promise.all([
    db.from('boards')
      .select('id, name, address, format, asking_rate, width, height, illuminated, photo_urls, latitude, longitude')
      .eq('status', 'available')
      .eq('city', cityName)
      .order('asking_rate', { ascending: false })
      .limit(200),
    db.from('boards')
      .select('city, asking_rate')
      .eq('status', 'available')
      .not('city', 'is', null),
  ]);

  const boards: DBBoard[] = boardsRes.data || [];
  const allBoardRows: { city: string; asking_rate: number }[] = allCitiesRes.data || [];

  // aggregate all cities
  const cityMap: Record<string, { count: number; minRate: number }> = {};
  for (const row of allBoardRows) {
    if (!row.city) continue;
    if (!cityMap[row.city]) cityMap[row.city] = { count: 0, minRate: Infinity };
    cityMap[row.city].count++;
    if (row.asking_rate && row.asking_rate < cityMap[row.city].minRate) {
      cityMap[row.city].minRate = row.asking_rate;
    }
  }
  const allCities = Object.entries(cityMap)
    .map(([city, stats]) => ({ city, count: stats.count, minRate: stats.minRate === Infinity ? 0 : stats.minRate }))
    .sort((a, b) => b.count - a.count);

  return { boards, allCities };
}

function computeStats(boards: DBBoard[]) {
  const rates = boards.map(b => b.asking_rate).filter(Boolean);
  const formats = [...new Set(boards.map(b => b.format).filter(Boolean))];
  const formatStats = formats.map(fmt => {
    const fmtBoards = boards.filter(b => b.format === fmt);
    const fmtRates  = fmtBoards.map(b => b.asking_rate).filter(Boolean);
    return {
      format: fmt,
      count:  fmtBoards.length,
      avg:    fmtRates.length ? Math.round(fmtRates.reduce((s, r) => s + r, 0) / fmtRates.length) : 0,
      min:    fmtRates.length ? Math.min(...fmtRates) : 0,
      max:    fmtRates.length ? Math.max(...fmtRates) : 0,
    };
  }).sort((a, b) => b.count - a.count);

  return {
    count:       boards.length,
    minRate:     rates.length ? Math.min(...rates) : 0,
    maxRate:     rates.length ? Math.max(...rates) : 0,
    avgRate:     rates.length ? Math.round(rates.reduce((s, r) => s + r, 0) / rates.length) : 0,
    formats,
    formatStats,
  };
}

// ── generateStaticParams ────────────────────────────────────────────────────

export async function generateStaticParams() {
  const db = getDB();
  const { data } = await db.from('boards').select('city').eq('status', 'available').not('city', 'is', null);
  const cities = [...new Set((data || []).map((r: { city: string }) => r.city).filter(Boolean))];
  return cities.map(city => ({ city: toSlug(city) }));
}

// ── generateMetadata ────────────────────────────────────────────────────────

export async function generateMetadata({ params }: { params: Promise<{ city: string }> }): Promise<Metadata> {
  const { city: slug } = await params;
  const cityName = fromSlug(slug);
  const { boards } = await fetchCityData(cityName);

  if (!boards.length) {
    return { title: 'Billboard Advertising in Nigeria — OOH Platform' };
  }

  const { count, minRate, maxRate, formats } = computeStats(boards);
  const desc = `Browse ${count} OOH advertising locations in ${cityName}. Rates from ${fmtRate(minRate)} to ${fmtRate(maxRate)}/mo. ${formats.map(f => FORMAT_LABELS[f] || f).join(', ')}. Book online in minutes.`;
  const url  = `${BASE_URL}/billboards/${slug}`;

  return {
    title: `Billboard Advertising in ${cityName} — Prices & Locations | OOH Platform`,
    description: desc,
    keywords: [
      `billboard advertising ${cityName}`,
      `OOH advertising ${cityName}`,
      `outdoor advertising ${cityName}`,
      `billboard rental ${cityName}`,
      `unipole ${cityName}`,
      `digital billboard ${cityName}`,
      `advertise in ${cityName}`,
    ],
    alternates: { canonical: url },
    openGraph: {
      title: `Billboard & OOH Advertising in ${cityName}`,
      description: desc,
      url,
      type: 'website',
      siteName: 'OOH Platform',
    },
  };
}

// ── Page ────────────────────────────────────────────────────────────────────

export default async function CityPage({ params }: { params: Promise<{ city: string }> }) {
  const { city: slug } = await params;
  const cityName = fromSlug(slug);
  const { boards, allCities } = await fetchCityData(cityName);

  if (!boards.length) notFound();

  const { count, minRate, maxRate, formatStats, formats } = computeStats(boards);
  const featured = boards.slice(0, 6);
  const mapBoards: CityMapBoard[] = boards
    .filter(b => b.latitude && b.longitude)
    .map(b => ({ id: b.id, name: b.name, format: b.format, asking_rate: b.asking_rate, lat: b.latitude!, lng: b.longitude! }));

  const otherCities = allCities.filter(c => toSlug(c.city) !== slug).slice(0, 20);
  const campaignUrl = `/campaign-builder?city=${encodeURIComponent(cityName)}`;

  const faqs = [
    {
      q: `How much does a billboard cost in ${cityName}?`,
      a: `Billboard advertising in ${cityName} ranges from ${fmtRateLong(minRate)} to ${fmtRateLong(maxRate)} per month, depending on the format, size, location, and illumination. The average rate is around ${fmtRate(Math.round((minRate + maxRate) / 2))} per month. Use our self-service campaign builder to get an instant quote.`,
    },
    {
      q: `How many billboards are available in ${cityName}?`,
      a: `There are currently ${count} available OOH advertising locations in ${cityName} on our platform, spanning ${formats.length} format${formats.length !== 1 ? 's' : ''}: ${formats.map(f => FORMAT_LABELS[f] || f).join(', ')}. Inventory updates in real time as locations are booked or released.`,
    },
    {
      q: `What OOH formats are available in ${cityName}?`,
      a: `${cityName} has ${formats.length} OOH format${formats.length !== 1 ? 's' : ''} available: ${formatStats.map(s => `${FORMAT_LABELS[s.format] || s.format} (${s.count} location${s.count !== 1 ? 's' : ''}, from ${fmtRate(s.min)}/mo)`).join('; ')}. Each format suits different campaign objectives — large billboards for mass reach, unipoles for highway visibility, gantries for traffic convergence points, and LED screens for dynamic digital content.`,
    },
    {
      q: `How do I book a billboard in ${cityName}?`,
      a: `Booking is fully online: use our campaign builder to select your target cities and budget, browse available locations on an interactive map, choose your boards, and submit your plan. Our team reviews and confirms within 24 hours. No agency fees — just a transparent 5% platform discount on all rates.`,
    },
    {
      q: `How long does it take to launch an OOH campaign in ${cityName}?`,
      a: `Most campaigns are live within 5–10 business days of booking confirmation. This covers creative production or upload, site preparation (if required), and installation. Digital screens in ${cityName} can go live in as little as 48 hours once artwork is approved.`,
    },
  ];

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebPage',
        '@id': `${BASE_URL}/billboards/${slug}`,
        name: `Billboard Advertising in ${cityName} — OOH Platform`,
        url:  `${BASE_URL}/billboards/${slug}`,
        description: `Browse ${count} OOH locations in ${cityName}. Rates from ${fmtRate(minRate)}/mo.`,
        breadcrumb: {
          '@type': 'BreadcrumbList',
          itemListElement: [
            { '@type': 'ListItem', position: 1, name: 'Home',       item: BASE_URL },
            { '@type': 'ListItem', position: 2, name: 'Billboards', item: `${BASE_URL}/billboards` },
            { '@type': 'ListItem', position: 3, name: cityName,     item: `${BASE_URL}/billboards/${slug}` },
          ],
        },
      },
      {
        '@type': 'FAQPage',
        mainEntity: faqs.map(f => ({
          '@type': 'Question',
          name: f.q,
          acceptedAnswer: { '@type': 'Answer', text: f.a },
        })),
      },
    ],
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <style>{`
        .city-board-card { transition: box-shadow 0.18s, transform 0.18s; }
        .city-board-card:hover { box-shadow: 0 16px 40px -12px rgba(27,79,138,0.18) !important; transform: translateY(-2px); }
        .city-faq-item summary { cursor: pointer; user-select: none; list-style: none; }
        .city-faq-item summary::-webkit-details-marker { display: none; }
        .city-faq-item[open] summary { color: #1B4F8A; }
        .city-cta-btn { transition: background 0.15s, box-shadow 0.15s; }
        .city-cta-btn:hover { background: #D97706 !important; box-shadow: 0 8px 24px -6px rgba(245,158,11,0.5) !important; }
        .city-nav-link { transition: color 0.12s; }
        .city-nav-link:hover { color: #F59E0B !important; }
        .city-link-pill:hover { background: #1B4F8A !important; color: #fff !important; }
        @media (max-width: 768px) {
          .city-hero-h1  { font-size: 1.75rem !important; }
          .city-map-grid { grid-template-columns: 1fr !important; }
          .city-map-wrap { height: 280px !important; }
          .city-board-grid { grid-template-columns: 1fr !important; }
          .city-stats-strip { flex-wrap: wrap !important; gap: 12px !important; }
          .city-stat-item  { min-width: 140px !important; }
          .city-format-table { font-size: 0.8125rem !important; }
          .city-format-table th, .city-format-table td { padding: 10px 12px !important; }
        }
        @media (max-width: 480px) {
          .city-board-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>

      {/* ── NAV ──────────────────────────────────────────────────────────── */}
      <nav style={{
        position: 'sticky', top: 0, zIndex: 100,
        background: '#0F172A', borderBottom: '1px solid rgba(255,255,255,0.07)',
        padding: '0 24px', height: 60,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <Link href="/" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            width: 28, height: 28, borderRadius: 7,
            background: 'linear-gradient(135deg, #1B4F8A, #3B82F6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <span style={{ color: '#fff', fontSize: 14, fontWeight: 800 }}>O</span>
          </div>
          <span style={{ color: '#fff', fontWeight: 700, fontSize: '0.9375rem', letterSpacing: '-0.02em' }}>
            OOH Platform
          </span>
        </Link>
        <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
          <Link href="/marketplace" className="city-nav-link" style={{ color: '#94A3B8', textDecoration: 'none', fontSize: '0.875rem', fontWeight: 500 }}>
            Marketplace
          </Link>
          <Link href="/billboards" className="city-nav-link" style={{ color: '#94A3B8', textDecoration: 'none', fontSize: '0.875rem', fontWeight: 500 }}>
            Billboards
          </Link>
          <Link
            href={campaignUrl}
            style={{
              background: '#F59E0B', color: '#fff', textDecoration: 'none',
              padding: '7px 16px', borderRadius: 8, fontSize: '0.8125rem', fontWeight: 600,
            }}
          >
            Plan a campaign
          </Link>
        </div>
      </nav>

      {/* ── HERO ──────────────────────────────────────────────────────────── */}
      <div style={{
        background: 'linear-gradient(160deg, #0F172A 0%, #1B4F8A 100%)',
        padding: '56px 24px 52px',
      }}>
        <div style={{ maxWidth: 960, margin: '0 auto' }}>
          {/* Breadcrumb */}
          <nav aria-label="breadcrumb" style={{ marginBottom: 20 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <Link href="/" style={{ color: '#94A3B8', textDecoration: 'none', fontSize: '0.8125rem' }}>Home</Link>
              <span style={{ color: '#475569', fontSize: '0.8125rem' }}>/</span>
              <Link href="/billboards" style={{ color: '#94A3B8', textDecoration: 'none', fontSize: '0.8125rem' }}>Billboards</Link>
              <span style={{ color: '#475569', fontSize: '0.8125rem' }}>/</span>
              <span style={{ color: '#CBD5E1', fontSize: '0.8125rem' }}>{cityName}</span>
            </span>
          </nav>

          <h1 className="city-hero-h1" style={{
            color: '#fff', fontSize: '2.5rem', fontWeight: 800,
            letterSpacing: '-0.04em', lineHeight: 1.15, margin: '0 0 16px',
          }}>
            Billboard &amp; OOH Advertising<br />in {cityName}
          </h1>

          <p style={{
            color: '#94A3B8', fontSize: '1.0625rem', lineHeight: 1.65,
            margin: '0 0 36px', maxWidth: 560,
          }}>
            Browse {count} available OOH locations across {cityName}. Compare rates, check availability, and plan your campaign — all in one place.
          </p>

          {/* Stats strip */}
          <div className="city-stats-strip" style={{
            display: 'flex', alignItems: 'stretch', gap: 0,
            background: 'rgba(255,255,255,0.06)', borderRadius: 14,
            border: '1px solid rgba(255,255,255,0.10)',
            overflow: 'hidden',
          }}>
            {[
              { label: 'Locations',    value: String(count) },
              { label: 'From/month',   value: fmtRate(minRate) },
              { label: 'Up to/month',  value: fmtRate(maxRate) },
              { label: 'Formats',      value: String(formats.length) },
            ].map((stat, i) => (
              <div
                key={stat.label}
                className="city-stat-item"
                style={{
                  flex: 1, padding: '20px 24px',
                  borderLeft: i > 0 ? '1px solid rgba(255,255,255,0.08)' : 'none',
                  minWidth: 140,
                }}
              >
                <div style={{ color: '#fff', fontSize: '1.5rem', fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1 }}>
                  {stat.value}
                </div>
                <div style={{ color: '#64748B', fontSize: '0.75rem', fontWeight: 500, marginTop: 5, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  {stat.label}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── BODY ──────────────────────────────────────────────────────────── */}
      <div style={{ background: '#F8FAFC', minHeight: '60vh' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto', padding: '56px 24px 80px' }}>

          {/* ── Map + Quick CTA ── */}
          <div className="city-map-grid" style={{
            display: 'grid', gridTemplateColumns: '3fr 2fr', gap: 28, marginBottom: 72,
            alignItems: 'start',
          }}>
            {/* Map */}
            <div className="city-map-wrap" style={{ height: 420, borderRadius: 16, overflow: 'hidden', boxShadow: '0 4px 24px rgba(0,0,0,0.10)' }}>
              {mapBoards.length > 0
                ? <CityMap boards={mapBoards} city={cityName} />
                : (
                  <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#E2E8F0', flexDirection: 'column', gap: 8 }}>
                    <span style={{ fontSize: '2rem' }}>🗺️</span>
                    <span style={{ color: '#64748B', fontSize: '0.875rem' }}>Map unavailable — board coordinates not set</span>
                  </div>
                )
              }
            </div>

            {/* Quick info card */}
            <div style={{
              background: '#fff', borderRadius: 16, padding: '28px 24px',
              boxShadow: '0 2px 12px rgba(0,0,0,0.06)', border: '1px solid #E2E8F0',
            }}>
              <h2 style={{ fontSize: '1.125rem', fontWeight: 700, color: '#0F172A', margin: '0 0 8px', letterSpacing: '-0.02em' }}>
                Advertise in {cityName}
              </h2>
              <p style={{ color: '#64748B', fontSize: '0.875rem', lineHeight: 1.6, margin: '0 0 20px' }}>
                {count} locations available right now. Reach your target audience across {cityName}&apos;s key corridors, highways, and commercial hubs.
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 24 }}>
                {[
                  { icon: '📍', label: `${count} available locations` },
                  { icon: '💰', label: `Rates from ${fmtRate(minRate)}/mo` },
                  { icon: '📐', label: `${formats.length} format${formats.length !== 1 ? 's' : ''}: ${formats.slice(0, 3).map(f => FORMAT_LABELS[f] || f).join(', ')}${formats.length > 3 ? ` +${formats.length - 3} more` : ''}` },
                  { icon: '⚡', label: 'Book online, live in 5–10 days' },
                ].map(item => (
                  <div key={item.label} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                    <span style={{ fontSize: '0.9rem', flexShrink: 0, marginTop: 1 }}>{item.icon}</span>
                    <span style={{ color: '#475569', fontSize: '0.8125rem', lineHeight: 1.5 }}>{item.label}</span>
                  </div>
                ))}
              </div>

              <Link
                href={campaignUrl}
                className="city-cta-btn"
                style={{
                  display: 'block', textAlign: 'center', textDecoration: 'none',
                  background: '#F59E0B', color: '#fff', borderRadius: 10,
                  padding: '13px 20px', fontSize: '0.9375rem', fontWeight: 700,
                  boxShadow: '0 8px 20px -6px rgba(245,158,11,0.4)',
                  marginBottom: 10,
                }}
              >
                Plan a campaign in {cityName} →
              </Link>
              <Link href="/marketplace" style={{
                display: 'block', textAlign: 'center', textDecoration: 'none',
                color: '#475569', fontSize: '0.8125rem', padding: '8px',
              }}>
                Browse all boards →
              </Link>
            </div>
          </div>

          {/* ── Format Breakdown ── */}
          {formatStats.length > 0 && (
            <section style={{ marginBottom: 72 }}>
              <h2 style={{ fontSize: '1.375rem', fontWeight: 700, color: '#0F172A', margin: '0 0 6px', letterSpacing: '-0.03em' }}>
                Advertising Formats Available in {cityName}
              </h2>
              <p style={{ color: '#64748B', fontSize: '0.875rem', margin: '0 0 24px', lineHeight: 1.6 }}>
                Compare formats, counts, and rate ranges to find the right inventory for your campaign.
              </p>
              <div style={{ background: '#fff', borderRadius: 14, overflow: 'hidden', border: '1px solid #E2E8F0', boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }}>
                <table className="city-format-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                  <thead>
                    <tr style={{ background: '#F8FAFC', borderBottom: '1px solid #E2E8F0' }}>
                      {['Format', 'Locations', 'Avg Rate/mo', 'Min Rate', 'Max Rate'].map(h => (
                        <th key={h} style={{ textAlign: 'left', padding: '14px 20px', fontWeight: 600, color: '#475569', fontSize: '0.8125rem', letterSpacing: '0.02em', textTransform: 'uppercase' }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {formatStats.map((row, i) => {
                      const fc = FORMAT_COLORS[row.format] || { bg: '#F1F5F9', text: '#475569' };
                      return (
                        <tr key={row.format} style={{ borderBottom: i < formatStats.length - 1 ? '1px solid #F1F5F9' : 'none' }}>
                          <td style={{ padding: '14px 20px' }}>
                            <span style={{
                              display: 'inline-block', padding: '3px 10px', borderRadius: 6,
                              background: fc.bg, color: fc.text, fontSize: '0.8125rem', fontWeight: 600,
                            }}>
                              {FORMAT_LABELS[row.format] || row.format}
                            </span>
                          </td>
                          <td style={{ padding: '14px 20px', color: '#0F172A', fontWeight: 600 }}>{row.count}</td>
                          <td style={{ padding: '14px 20px', color: '#0F172A' }}>{fmtRate(row.avg)}</td>
                          <td style={{ padding: '14px 20px', color: '#475569' }}>{fmtRate(row.min)}</td>
                          <td style={{ padding: '14px 20px', color: '#475569' }}>{fmtRate(row.max)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* ── Featured Boards ── */}
          <section style={{ marginBottom: 72 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, flexWrap: 'wrap', gap: 12 }}>
              <h2 style={{ fontSize: '1.375rem', fontWeight: 700, color: '#0F172A', margin: 0, letterSpacing: '-0.03em' }}>
                Featured OOH Locations in {cityName}
              </h2>
              <Link href={campaignUrl} style={{ color: '#1B4F8A', textDecoration: 'none', fontSize: '0.875rem', fontWeight: 600 }}>
                View all {count} boards →
              </Link>
            </div>
            <p style={{ color: '#64748B', fontSize: '0.875rem', margin: '0 0 24px', lineHeight: 1.6 }}>
              Top-rated locations by premium rate — high-visibility sites across {cityName}.
            </p>

            <div className="city-board-grid" style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: 20,
            }}>
              {featured.map(board => {
                const fc = FORMAT_COLORS[board.format] || { bg: '#F1F5F9', text: '#475569' };
                const photo = board.photo_urls?.[0];
                return (
                  <div
                    key={board.id}
                    className="city-board-card"
                    style={{
                      background: '#fff', borderRadius: 14, overflow: 'hidden',
                      border: '1px solid #E2E8F0', boxShadow: '0 2px 8px rgba(0,0,0,0.05)',
                    }}
                  >
                    {/* Photo / mockup */}
                    <div style={{ height: 160, background: fc.bg, position: 'relative', overflow: 'hidden' }}>
                      {photo
                        ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={photo}
                            alt={board.name}
                            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                          />
                        )
                        : (
                          <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                            <div style={{
                              width: 72, height: 44, borderRadius: 4,
                              background: fc.text + '22',
                              border: `2px solid ${fc.text}`,
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                            }}>
                              <span style={{ color: fc.text, fontSize: '0.625rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                {FORMAT_LABELS[board.format] || board.format}
                              </span>
                            </div>
                          </div>
                        )
                      }
                      {/* Format badge overlay */}
                      <span style={{
                        position: 'absolute', top: 10, left: 10,
                        background: fc.bg, color: fc.text,
                        fontSize: '0.6875rem', fontWeight: 700,
                        padding: '3px 8px', borderRadius: 5,
                        border: `1px solid ${fc.text}22`,
                      }}>
                        {FORMAT_LABELS[board.format] || board.format}
                      </span>
                    </div>

                    {/* Card body */}
                    <div style={{ padding: '14px 16px' }}>
                      <h3 style={{ fontSize: '0.875rem', fontWeight: 700, color: '#0F172A', margin: '0 0 4px', lineHeight: 1.3, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                        {board.name}
                      </h3>
                      <p style={{ color: '#64748B', fontSize: '0.75rem', margin: '0 0 12px', lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                        {board.address}
                      </p>

                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                        <div>
                          <div style={{ color: '#0F172A', fontWeight: 700, fontSize: '0.9375rem', lineHeight: 1 }}>
                            {fmtRate(board.asking_rate)}
                          </div>
                          <div style={{ color: '#94A3B8', fontSize: '0.6875rem', marginTop: 2 }}>per month</div>
                        </div>
                        <Link
                          href={campaignUrl}
                          style={{
                            background: '#EFF6FF', color: '#1D4ED8', textDecoration: 'none',
                            padding: '6px 12px', borderRadius: 7, fontSize: '0.75rem', fontWeight: 600,
                            flexShrink: 0,
                          }}
                        >
                          Book now →
                        </Link>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* ── CTA Banner ── */}
          <section style={{ marginBottom: 72 }}>
            <div style={{
              background: 'linear-gradient(135deg, #0F172A 0%, #1B4F8A 100%)',
              borderRadius: 20, padding: '48px 40px', textAlign: 'center',
            }}>
              <h2 style={{ color: '#fff', fontSize: '1.75rem', fontWeight: 800, letterSpacing: '-0.03em', margin: '0 0 12px' }}>
                Ready to advertise in {cityName}?
              </h2>
              <p style={{ color: '#94A3B8', fontSize: '1rem', margin: '0 0 28px', lineHeight: 1.6 }}>
                Select your locations, set your budget, and submit your plan in under 5 minutes.
                Our team confirms within 24 hours.
              </p>
              <Link
                href={campaignUrl}
                className="city-cta-btn"
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 8,
                  background: '#F59E0B', color: '#fff', textDecoration: 'none',
                  padding: '15px 32px', borderRadius: 12,
                  fontSize: '1rem', fontWeight: 700,
                  boxShadow: '0 12px 28px -8px rgba(245,158,11,0.5)',
                }}
              >
                Plan a campaign in {cityName} →
              </Link>
            </div>
          </section>

          {/* ── FAQ ── */}
          <section style={{ marginBottom: 72 }}>
            <h2 style={{ fontSize: '1.375rem', fontWeight: 700, color: '#0F172A', margin: '0 0 6px', letterSpacing: '-0.03em' }}>
              Billboard Advertising in {cityName} — FAQs
            </h2>
            <p style={{ color: '#64748B', fontSize: '0.875rem', margin: '0 0 28px', lineHeight: 1.6 }}>
              Common questions about OOH advertising in {cityName}.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              {faqs.map((faq, i) => (
                <details
                  key={i}
                  className="city-faq-item"
                  style={{
                    borderTop: '1px solid #E2E8F0',
                    paddingTop: 0,
                  }}
                  open={i === 0}
                >
                  <summary style={{
                    padding: '18px 0', fontWeight: 600, fontSize: '0.9375rem',
                    color: '#0F172A', lineHeight: 1.4,
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
                  }}>
                    {faq.q}
                    <span style={{ color: '#94A3B8', fontSize: '1.25rem', flexShrink: 0 }}>+</span>
                  </summary>
                  <div style={{ paddingBottom: 18 }}>
                    <p style={{ color: '#475569', fontSize: '0.875rem', lineHeight: 1.75, margin: 0 }}>
                      {faq.a}
                    </p>
                  </div>
                </details>
              ))}
              <div style={{ borderTop: '1px solid #E2E8F0' }} />
            </div>
          </section>

          {/* ── Other Cities ── */}
          {otherCities.length > 0 && (
            <section>
              <h2 style={{ fontSize: '1.375rem', fontWeight: 700, color: '#0F172A', margin: '0 0 6px', letterSpacing: '-0.03em' }}>
                OOH Advertising in Other Nigerian Cities
              </h2>
              <p style={{ color: '#64748B', fontSize: '0.875rem', margin: '0 0 20px' }}>
                Expand your reach beyond {cityName} — browse billboard inventory nationwide.
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                {otherCities.map(c => (
                  <Link
                    key={c.city}
                    href={`/billboards/${toSlug(c.city)}`}
                    className="city-link-pill"
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 6,
                      padding: '7px 14px', borderRadius: 8,
                      background: '#fff', border: '1px solid #E2E8F0',
                      color: '#475569', textDecoration: 'none',
                      fontSize: '0.8125rem', fontWeight: 500, transition: 'all 0.15s',
                    }}
                  >
                    {c.city}
                    <span style={{ color: '#94A3B8', fontSize: '0.75rem' }}>({c.count})</span>
                  </Link>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>

      {/* ── FOOTER ── */}
      <footer style={{
        background: '#0F172A', padding: '48px 24px 32px',
        borderTop: '1px solid rgba(255,255,255,0.06)',
      }}>
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 32, marginBottom: 40 }}>
            <div>
              <Link href="/" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <div style={{ width: 28, height: 28, borderRadius: 7, background: 'linear-gradient(135deg, #1B4F8A, #3B82F6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <span style={{ color: '#fff', fontSize: 14, fontWeight: 800 }}>O</span>
                </div>
                <span style={{ color: '#fff', fontWeight: 700, fontSize: '0.9375rem' }}>OOH Platform</span>
              </Link>
              <p style={{ color: '#64748B', fontSize: '0.8125rem', lineHeight: 1.6, maxWidth: 280, margin: 0 }}>
                Nigeria&apos;s largest outdoor advertising marketplace. Connect brands with premium OOH locations nationwide.
              </p>
            </div>
            <div style={{ display: 'flex', gap: 48, flexWrap: 'wrap' }}>
              <div>
                <div style={{ color: '#94A3B8', fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 14 }}>Platform</div>
                {[['Marketplace', '/marketplace'], ['Billboard Locations', '/billboards'], ['Campaign Builder', '/campaign-builder']].map(([label, href]) => (
                  <div key={href} style={{ marginBottom: 10 }}>
                    <Link href={href} style={{ color: '#64748B', textDecoration: 'none', fontSize: '0.875rem' }}>{label}</Link>
                  </div>
                ))}
              </div>
              <div>
                <div style={{ color: '#94A3B8', fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 14 }}>Top Cities</div>
                {otherCities.slice(0, 5).map(c => (
                  <div key={c.city} style={{ marginBottom: 10 }}>
                    <Link href={`/billboards/${toSlug(c.city)}`} style={{ color: '#64748B', textDecoration: 'none', fontSize: '0.875rem' }}>{c.city}</Link>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
            <span style={{ color: '#475569', fontSize: '0.8125rem' }}>© 2026 OOH Platform. All rights reserved.</span>
            <span style={{ color: '#475569', fontSize: '0.8125rem' }}>
              Billboard advertising in {cityName} — {count} locations from {fmtRate(minRate)}/mo
            </span>
          </div>
        </div>
      </footer>
    </>
  );
}
