import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';
import { fetchGuidePrices, guideText, type GuidePrice } from '@/lib/guide-prices';
import Link from 'next/link';
import type { CityMapBoard } from './CityMap';
import CityMap from './CityMapLoader';
import RequirePlatformAuth from '@/components/layout/RequirePlatformAuth';
import { VerificationBadge } from '@/lib/board-verification';
import { boardPath, citySlug as toSlug } from '@/lib/public-links';
import { displayName } from '@/lib/display-name';
import PricingFaqList, { pricingFaqs, faqJsonLd } from '@/components/PricingFaq';
import WhatsAppButton from '@/components/WhatsAppButton';
import SaveButton from '@/components/shortlist/SaveButton';
import ShortlistTray from '@/components/shortlist/ShortlistTray';

export const revalidate = 3600;

// ── Helpers ────────────────────────────────────────────────────────────────

function fromSlug(slug: string) {
  return slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function fmtRate(n: number) {

  if (!n) return 'on request'; // rates are private unless the owner opens them (migration 035)
  if (n >= 1_000_000) return '₦' + (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000)     return '₦' + Math.round(n / 1_000) + 'K';
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
  illuminated: boolean | null;
  area: string | null;
  state: string | null;
  verification_status: string | null;
  photo_urls: string[] | null;
  latitude: number | null;
  longitude: number | null;
  guide?: GuidePrice | null;
};

function getDB() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

async function fetchCityData(slug: string) {
  const db = getDB();
  const allCitiesRes = await db.from('boards')
    .select('id, city')
    .eq('status', 'available')
    .not('city', 'is', null);
  // Exact rates are private; buyers see rounded guide ranges (migration 051).
  const guides = await fetchGuidePrices((allCitiesRes.data || []).map(r => r.id as string), db);
  // Find the city by its slug, so "benin-city" finds "Benin City".
  const cityName = (allCitiesRes.data || []).map(r => r.city as string).find(c => c && toSlug(c) === slug) ?? fromSlug(slug);
  const boardsRes = await db.from('boards')
    .select('id, name, address, area, state, format, asking_rate, width, height, illuminated, photo_urls, latitude, longitude, verification_status')
    .eq('status', 'available')
    .eq('city', cityName)
    .order('verification_status', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(200);

  const boards: DBBoard[] = (boardsRes.data || []).map(b => ({ ...b, guide: guides[b.id] ?? null }));
  const allBoardRows: { id: string; city: string }[] = allCitiesRes.data || [];

  // aggregate all cities
  const cityMap: Record<string, { count: number; minRate: number }> = {};
  for (const row of allBoardRows) {
    if (!row.city) continue;
    if (!cityMap[row.city]) cityMap[row.city] = { count: 0, minRate: Infinity };
    cityMap[row.city].count++;
    const low = guides[row.id]?.low;
    if (low && low < cityMap[row.city].minRate) cityMap[row.city].minRate = low;
  }
  const allCities = Object.entries(cityMap)
    .map(([city, stats]) => ({ city, count: stats.count, minRate: stats.minRate === Infinity ? 0 : stats.minRate }))
    .sort((a, b) => b.count - a.count);

  return { cityName, boards, allCities };
}

function computeStats(boards: DBBoard[]) {
  const lows  = (list: DBBoard[]) => list.map(b => b.guide?.low ?? 0).filter(Boolean);
  const highs = (list: DBBoard[]) => list.map(b => b.guide?.high ?? 0).filter(Boolean);
  const typical = (list: DBBoard[]) => {
    const mids = list.filter(b => b.guide).map(b => (b.guide!.low + b.guide!.high) / 2);
    return mids.length ? Math.round(mids.reduce((t, m) => t + m, 0) / mids.length / 50_000) * 50_000 : 0;
  };
  const rates = lows(boards);
  const formats = [...new Set(boards.map(b => b.format).filter(Boolean))];
  const formatStats = formats.map(fmt => {
    const fmtBoards = boards.filter(b => b.format === fmt);
    const fl = lows(fmtBoards), fh = highs(fmtBoards);
    return {
      format: fmt,
      count:  fmtBoards.length,
      avg:    typical(fmtBoards),
      min:    fl.length ? Math.min(...fl) : 0,
      max:    fh.length ? Math.max(...fh) : 0,
    };
  }).sort((a, b) => b.count - a.count);

  return {
    count:       boards.length,
    minRate:     rates.length ? Math.min(...rates) : 0,
    maxRate:     highs(boards).length ? Math.max(...highs(boards)) : 0,
    avgRate:     typical(boards),
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
  const { cityName, boards } = await fetchCityData(slug);

  if (!boards.length) {
    return { title: 'Billboard Advertising in Nigeria — OOH Platform' };
  }

  const { count, minRate, maxRate, formats } = computeStats(boards);
  const desc = `${count} billboard${count === 1 ? '' : 's'} for advertising in ${cityName}, listed by their media owners: ${formats.map(f => FORMAT_LABELS[f] || f).join(', ')}. ${minRate ? `Guide prices from ${fmtRate(minRate)} to ${fmtRate(maxRate)}/mo.` : 'See photos and locations, then request a price from the owner.'}`;
  const url  = `${BASE_URL}/billboards/${slug}`;

  return {
    title: { absolute: `Billboard Advertising in ${cityName}: Prices & Locations | OOH Platform` },
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
  const { cityName, boards, allCities } = await fetchCityData(slug);

  if (!boards.length) notFound();

  const { count, minRate, formatStats, formats } = computeStats(boards);
  const anyRates = formatStats.some(f => f.avg > 0);
  const areaCount = new Set(boards.map(b => (b.area ?? '').trim()).filter(Boolean)).size;
  const verifiedCount = boards.filter(b => b.verification_status && b.verification_status !== 'pending').length;
  const mapBoards: CityMapBoard[] = boards
    .filter(b => b.latitude && b.longitude)
    .map(b => ({ id: b.id, name: b.name, format: b.format, price: b.guide ? `${guideText(b.guide)}/mo guide` : null, lat: b.latitude!, lng: b.longitude! }));

  const otherCities = allCities.filter(c => toSlug(c.city) !== slug).slice(0, 20);
  const campaignUrl = `/marketplace?q=${encodeURIComponent(cityName)}`;

  const faqs = [
    {
      q: `How many billboards are available in ${cityName}?`,
      a: `There are ${count} billboard${count !== 1 ? 's' : ''} available in ${cityName} right now, listed by their media owners: ${formatStats.map(f => `${f.count} ${(FORMAT_LABELS[f.format] || f.format).toLowerCase()}${f.count !== 1 ? 's' : ''}`).join(', ')}. New boards are added as more owners list with us.`,
    },
    {
      q: `How do I book a billboard in ${cityName}?`,
      a: `Choose a board on this page and press Request this location. Add your dates, and the media owner replies with availability and a price. You can accept the quote or make an offer. Once you agree, our team contacts you and the owner to complete the booking.`,
    },
    ...pricingFaqs(cityName),
  ];

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebPage',
        '@id': `${BASE_URL}/billboards/${slug}`,
        name: `Billboard Advertising in ${cityName} — OOH Platform`,
        url:  `${BASE_URL}/billboards/${slug}`,
        description: `${count} billboards in ${cityName}, listed by their media owners.`,
        breadcrumb: {
          '@type': 'BreadcrumbList',
          itemListElement: [
            { '@type': 'ListItem', position: 1, name: 'Home',       item: BASE_URL },
            { '@type': 'ListItem', position: 2, name: 'Billboards', item: `${BASE_URL}/billboards` },
            { '@type': 'ListItem', position: 3, name: cityName,     item: `${BASE_URL}/billboards/${slug}` },
          ],
        },
      },
      faqJsonLd(faqs),
    ],
  };

  return (
    <RequirePlatformAuth>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <style>{`
        .city-board-card { transition: box-shadow 0.18s, transform 0.18s; }
        .city-board-card:hover { box-shadow: 0 16px 40px -12px rgba(27,79,138,0.18) !important; transform: translateY(-2px); }
        .city-cta-btn { transition: background 0.15s, box-shadow 0.15s; }
        .city-cta-btn:hover { background: #D97706 !important; box-shadow: 0 8px 24px -6px rgba(245,158,11,0.5) !important; }
        .city-nav-link { transition: color 0.12s; }
        .city-nav-link:hover { color: #F59E0B !important; }
        .city-link-pill:hover { background: #1B4F8A !important; color: #fff !important; }
        @media (max-width: 768px) {
          .city-hero-h1  { font-size: 1.75rem !important; }
          .city-nav-cities { display: none !important; }
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <Link href="/billboards" className="city-nav-link city-nav-cities" style={{ color: '#94A3B8', textDecoration: 'none', fontSize: '0.875rem', fontWeight: 500 }}>
            All cities
          </Link>
          <Link href="/signup?role=owner" className="city-nav-link city-nav-cities" style={{ color: '#94A3B8', textDecoration: 'none', fontSize: '0.875rem', fontWeight: 500 }}>
            List your boards
          </Link>
          <Link
            href={campaignUrl}
            style={{
              background: '#F59E0B', color: '#fff', textDecoration: 'none',
              padding: '7px 16px', borderRadius: 8, fontSize: '0.8125rem', fontWeight: 600, whiteSpace: 'nowrap',
            }}
          >
            Find a board
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
            {count} billboard{count !== 1 ? 's' : ''} in {cityName}, listed by the media owners who own them. See each board&apos;s photos and location, then request a price and availability from the owner.
          </p>

          {/* Stats strip */}
          <div className="city-stats-strip" style={{
            display: 'flex', alignItems: 'stretch', gap: 0,
            background: 'rgba(255,255,255,0.06)', borderRadius: 14,
            border: '1px solid rgba(255,255,255,0.10)',
            overflow: 'hidden',
          }}>
            {[
              { label: 'Boards',       value: String(count) },
              { label: 'Formats',      value: String(formats.length) },
              ...(minRate
                ? [{ label: 'Guide from/month', value: fmtRate(minRate) }]
                : areaCount ? [{ label: 'Areas', value: String(areaCount) }] : []),
              ...(verifiedCount ? [{ label: 'Verified', value: String(verifiedCount) }] : []),
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
                {count} board{count !== 1 ? 's' : ''}{' '}available now. Each price is set by the board&apos;s owner: request a board and they reply with a quote.
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 24 }}>
                {[
                  { icon: '📍', label: `${count} board${count !== 1 ? 's' : ''} with photos and locations` },
                  { icon: '📐', label: `${formats.length} format${formats.length !== 1 ? 's' : ''}: ${formats.slice(0, 3).map(f => FORMAT_LABELS[f] || f).join(', ')}${formats.length > 3 ? ` +${formats.length - 3} more` : ''}` },
                  { icon: '💬', label: minRate ? `Guide prices from ${fmtRate(minRate)}/mo; owners confirm the final price` : 'Prices set by owners, quoted on request' },
                  { icon: '🤝', label: 'Our team completes the booking with you' },
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
                Browse boards in {cityName} →
              </Link>
              <Link href="/marketplace" style={{
                display: 'block', textAlign: 'center', textDecoration: 'none',
                color: '#475569', fontSize: '0.8125rem', padding: '8px',
              }}>
                Search all of Nigeria →
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
                {anyRates ? 'Compare formats, counts and rate ranges.' : 'How many of each kind of board you can book here.'}
              </p>
              <div style={{ background: '#fff', borderRadius: 14, overflow: 'hidden', border: '1px solid #E2E8F0', boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }}>
                <table className="city-format-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                  <thead>
                    <tr style={{ background: '#F8FAFC', borderBottom: '1px solid #E2E8F0' }}>
                      {(anyRates ? ['Format', 'Boards', 'Typical guide/mo', 'Guide low', 'Guide high'] : ['Format', 'Boards']).map(h => (
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
                          {anyRates && <>
                            <td style={{ padding: '14px 20px', color: '#0F172A' }}>{fmtRate(row.avg)}</td>
                            <td style={{ padding: '14px 20px', color: '#475569' }}>{fmtRate(row.min)}</td>
                            <td style={{ padding: '14px 20px', color: '#475569' }}>{fmtRate(row.max)}</td>
                          </>}
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
                {count > 1 ? `All ${count} billboards` : 'Billboard'} in {cityName}
              </h2>
              <Link href={`${campaignUrl}&view=map`} style={{ color: '#1B4F8A', textDecoration: 'none', fontSize: '0.875rem', fontWeight: 600 }}>
                Filter on the map →
              </Link>
            </div>
            <p style={{ color: '#64748B', fontSize: '0.875rem', margin: '0 0 24px', lineHeight: 1.6 }}>
              Open a board to see its photos, size and exact location, and to request it for your dates.
            </p>

            <div className="city-board-grid" style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: 20,
            }}>
              {boards.map(board => {
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
                      <span style={{ position: 'absolute', top: 10, right: 10, zIndex: 2 }}>
                        <SaveButton boardId={board.id} name={board.name} />
                      </span>
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
                        {displayName(board.name)}
                      </h3>
                      <p style={{ color: '#64748B', fontSize: '0.75rem', margin: '0 0 12px', lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                        {[board.address, board.area].filter(Boolean).join(', ') || 'Information unavailable'}
                      </p>
                      <div style={{ marginBottom: 10 }}><VerificationBadge status={board.verification_status} small /></div>

                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                        <div>
                          <div style={{ color: '#0F172A', fontWeight: 700, fontSize: '0.9375rem', lineHeight: 1 }}>
                            {board.guide ? guideText(board.guide) : 'Price on request'}
                          </div>
                          {!!board.guide && <div style={{ color: '#94A3B8', fontSize: '0.6875rem', marginTop: 2 }}>per month · guide</div>}
                        </div>
                        <Link
                          href={boardPath({ id: board.id, name: board.name, city: cityName })}
                          style={{
                            background: '#EFF6FF', color: '#1D4ED8', textDecoration: 'none',
                            padding: '6px 12px', borderRadius: 7, fontSize: '0.75rem', fontWeight: 600,
                            flexShrink: 0,
                          }}
                        >
                          View board →
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
                Pick a board and send your dates. The media owner replies with a price, and our team completes the booking with you.
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
                Browse boards in {cityName} →
              </Link>
            </div>
          </section>

          {/* ── For media owners ── */}
          <section data-owner-invite style={{ marginBottom: 72 }}>
            <div style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 16, padding: '24px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap' }}>
              <div style={{ maxWidth: 620 }}>
                <h2 style={{ fontSize: '1.125rem', fontWeight: 700, color: '#0F172A', margin: '0 0 6px', letterSpacing: '-0.02em' }}>
                  Own billboards in {cityName}?
                </h2>
                <p style={{ color: '#64748B', fontSize: '0.875rem', lineHeight: 1.6, margin: 0 }}>
                  List them for free. Buyers request your boards for their dates, you reply with your price, and our team helps close the booking. You stay in control of your rates.
                </p>
              </div>
              <Link href="/signup?role=owner" style={{ background: '#0F172A', color: '#fff', textDecoration: 'none', padding: '11px 18px', borderRadius: 10, fontSize: '0.875rem', fontWeight: 600, whiteSpace: 'nowrap' }}>
                List your boards →
              </Link>
            </div>
          </section>

          {/* ── FAQ ── */}
          <section style={{ marginBottom: 72 }}>
            <h2 style={{ fontSize: '1.375rem', fontWeight: 700, color: '#0F172A', margin: '0 0 6px', letterSpacing: '-0.03em' }}>
              Billboard Advertising in {cityName} — FAQs
            </h2>
            <p style={{ color: '#64748B', fontSize: '0.875rem', margin: '0 0 28px', lineHeight: 1.6 }}>
              Prices, extra costs and how booking works in {cityName}.
            </p>
            <PricingFaqList faqs={faqs} />
          </section>

          {/* ── Other Cities ── */}
          {otherCities.length > 0 && (
            <section>
              <h2 style={{ fontSize: '1.375rem', fontWeight: 700, color: '#0F172A', margin: '0 0 6px', letterSpacing: '-0.03em' }}>
                OOH Advertising in Other Nigerian Cities
              </h2>
              <p style={{ color: '#64748B', fontSize: '0.875rem', margin: '0 0 20px' }}>
                Billboards listed by media owners in other cities.
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
                Billboards across Nigeria, listed by the media owners who own them.
              </p>
            </div>
            <div style={{ display: 'flex', gap: 48, flexWrap: 'wrap' }}>
              <div>
                <div style={{ color: '#94A3B8', fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 14 }}>Platform</div>
                {[['Find a board', '/marketplace'], ['Billboards by city', '/billboards'], ['List your boards', '/signup?role=owner']].map(([label, href]) => (
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
              Billboard advertising in {cityName}: {count} board{count !== 1 ? 's' : ''}{minRate ? ` from ${fmtRate(minRate)}/mo (guide)` : ''}
            </span>
          </div>
        </div>
      </footer>
      <WhatsAppButton message={`Hi, I'm looking for billboards in ${cityName}. Can you help?`} />
      <ShortlistTray />
    </RequirePlatformAuth>
  );
}
