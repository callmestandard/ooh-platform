import type { Metadata } from 'next';
import { createClient } from '@supabase/supabase-js';
import Link from 'next/link';

export const revalidate = 3600;

export const metadata: Metadata = {
  title: 'Billboard & OOH Advertising Locations in Nigeria | OOH Platform',
  description: 'Browse billboard and outdoor advertising locations across every major Nigerian city. Compare rates, formats, and availability. Book your campaign online.',
  keywords: ['billboard advertising Nigeria', 'OOH advertising Nigeria', 'outdoor advertising Nigeria', 'billboard locations Nigeria', 'buy billboard space Nigeria'],
  alternates: {
    canonical: `${process.env.NEXT_PUBLIC_APP_URL || 'https://ooh-platform-xi.vercel.app'}/billboards`,
  },
  openGraph: {
    title: 'Billboard Advertising Locations in Nigeria — OOH Platform',
    description: 'Browse OOH advertising inventory across every major Nigerian city. Compare rates and book online.',
    type: 'website',
  },
};

// ── Helpers ────────────────────────────────────────────────────────────────

function toSlug(city: string) {
  return city.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function fmtRate(n: number) {
  if (n >= 1_000_000) return '₦' + (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000)     return '₦' + Math.round(n / 1_000) + 'K';
  return '₦' + n.toLocaleString('en-NG');
}

const FORMAT_LABELS: Record<string, string> = {
  billboard: 'Billboard', unipole: 'Unipole', gantry: 'Gantry',
  bridge_panel: 'Bridge Panel', wall_drape: 'Wall Drape', digital: 'Digital', led: 'LED',
};

// ── Data ───────────────────────────────────────────────────────────────────

type CityRow = {
  city:     string;
  count:    number;
  minRate:  number;
  maxRate:  number;
  formats:  string[];
};

async function fetchCities(): Promise<CityRow[]> {
  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
  const { data } = await db
    .from('boards')
    .select('city, asking_rate, format')
    .eq('status', 'available')
    .not('city', 'is', null);

  if (!data?.length) return [];

  const map: Record<string, { rates: number[]; formats: Set<string> }> = {};
  for (const row of data as { city: string; asking_rate: number; format: string }[]) {
    if (!row.city) continue;
    if (!map[row.city]) map[row.city] = { rates: [], formats: new Set() };
    if (row.asking_rate) map[row.city].rates.push(row.asking_rate);
    if (row.format)      map[row.city].formats.add(row.format);
  }

  return Object.entries(map)
    .map(([city, { rates, formats }]) => ({
      city,
      count:   rates.length,
      minRate: rates.length ? Math.min(...rates) : 0,
      maxRate: rates.length ? Math.max(...rates) : 0,
      formats: [...formats],
    }))
    .sort((a, b) => b.count - a.count);
}

// ── Page ───────────────────────────────────────────────────────────────────

export default async function BillboardsIndexPage() {
  const cities = await fetchCities();
  const totalBoards = cities.reduce((s, c) => s + c.count, 0);
  const totalCities = cities.length;

  return (
    <>
      <style>{`
        .city-card { transition: box-shadow 0.18s, transform 0.18s; }
        .city-card:hover { box-shadow: 0 16px 40px -12px rgba(27,79,138,0.16) !important; transform: translateY(-2px); }
        .city-card:hover .city-card-cta { color: #1B4F8A !important; }
        .idx-nav-link { transition: color 0.12s; }
        .idx-nav-link:hover { color: #F59E0B !important; }
        @media (max-width: 900px) {
          .idx-city-grid { grid-template-columns: repeat(2, 1fr) !important; }
        }
        @media (max-width: 560px) {
          .idx-city-grid { grid-template-columns: 1fr !important; }
          .idx-hero-h1   { font-size: 1.75rem !important; }
        }
      `}</style>

      {/* ── NAV ── */}
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
          <span style={{ color: '#fff', fontWeight: 700, fontSize: '0.9375rem', letterSpacing: '-0.02em' }}>OOH Platform</span>
        </Link>
        <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
          <Link href="/marketplace" className="idx-nav-link" style={{ color: '#94A3B8', textDecoration: 'none', fontSize: '0.875rem', fontWeight: 500 }}>
            Marketplace
          </Link>
          <Link href="/campaign-builder" style={{
            background: '#F59E0B', color: '#fff', textDecoration: 'none',
            padding: '7px 16px', borderRadius: 8, fontSize: '0.8125rem', fontWeight: 600,
          }}>
            Plan a campaign
          </Link>
        </div>
      </nav>

      {/* ── HERO ── */}
      <div style={{
        background: 'linear-gradient(160deg, #0F172A 0%, #1B4F8A 100%)',
        padding: '60px 24px 56px',
      }}>
        <div style={{ maxWidth: 800, margin: '0 auto', textAlign: 'center' }}>
          <div style={{
            display: 'inline-block', padding: '5px 14px', borderRadius: 20,
            background: 'rgba(245,158,11,0.15)', border: '1px solid rgba(245,158,11,0.3)',
            color: '#F59E0B', fontSize: '0.8125rem', fontWeight: 600, marginBottom: 20,
          }}>
            {totalBoards} locations across {totalCities} cities
          </div>
          <h1 className="idx-hero-h1" style={{
            color: '#fff', fontSize: '2.5rem', fontWeight: 800,
            letterSpacing: '-0.04em', lineHeight: 1.15, margin: '0 0 16px',
          }}>
            Billboard &amp; OOH Advertising<br />Locations in Nigeria
          </h1>
          <p style={{
            color: '#94A3B8', fontSize: '1.0625rem', lineHeight: 1.65,
            margin: '0 0 32px', maxWidth: 560, marginLeft: 'auto', marginRight: 'auto',
          }}>
            Nigeria&apos;s largest outdoor advertising marketplace. Browse inventory in every major city, compare rates, and book your campaign online.
          </p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link href="/campaign-builder" style={{
              background: '#F59E0B', color: '#fff', textDecoration: 'none',
              padding: '13px 28px', borderRadius: 10, fontSize: '0.9375rem', fontWeight: 700,
              boxShadow: '0 10px 24px -6px rgba(245,158,11,0.45)',
            }}>
              Plan a campaign →
            </Link>
            <Link href="/marketplace" style={{
              background: 'rgba(255,255,255,0.08)', color: '#CBD5E1', textDecoration: 'none',
              padding: '13px 28px', borderRadius: 10, fontSize: '0.9375rem', fontWeight: 600,
              border: '1px solid rgba(255,255,255,0.12)',
            }}>
              Browse marketplace
            </Link>
          </div>
        </div>
      </div>

      {/* ── CITY GRID ── */}
      <div style={{ background: '#F8FAFC', minHeight: '50vh' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto', padding: '56px 24px 80px' }}>

          {cities.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '80px 0', color: '#94A3B8' }}>
              <div style={{ fontSize: '2.5rem', marginBottom: 16 }}>🏙️</div>
              <p style={{ fontSize: '1rem' }}>No locations available yet. Check back soon.</p>
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28, flexWrap: 'wrap', gap: 12 }}>
                <div>
                  <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#0F172A', margin: '0 0 4px', letterSpacing: '-0.02em' }}>
                    Browse by City
                  </h2>
                  <p style={{ color: '#64748B', fontSize: '0.875rem', margin: 0 }}>
                    {totalCities} cities · {totalBoards} total locations
                  </p>
                </div>
              </div>

              <div className="idx-city-grid" style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: 20,
              }}>
                {cities.map((c, i) => (
                  <Link
                    key={c.city}
                    href={`/billboards/${toSlug(c.city)}`}
                    className="city-card"
                    style={{
                      display: 'block', textDecoration: 'none',
                      background: '#fff', borderRadius: 14,
                      border: '1px solid #E2E8F0',
                      boxShadow: '0 2px 8px rgba(0,0,0,0.05)',
                      overflow: 'hidden',
                    }}
                  >
                    {/* Colour bar — ranked by city size */}
                    <div style={{
                      height: 4,
                      background: i === 0
                        ? 'linear-gradient(90deg, #1B4F8A, #3B82F6)'
                        : i < 3
                          ? 'linear-gradient(90deg, #7C3AED, #A78BFA)'
                          : i < 10
                            ? 'linear-gradient(90deg, #059669, #34D399)'
                            : '#E2E8F0',
                    }} />

                    <div style={{ padding: '18px 20px 20px' }}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 12 }}>
                        <div>
                          <h3 style={{ fontSize: '1rem', fontWeight: 700, color: '#0F172A', margin: '0 0 4px', letterSpacing: '-0.02em' }}>
                            {c.city}
                          </h3>
                          <span style={{ color: '#64748B', fontSize: '0.8125rem' }}>
                            {c.count} location{c.count !== 1 ? 's' : ''}
                          </span>
                        </div>
                        <span style={{
                          fontSize: '0.6875rem', fontWeight: 700, padding: '3px 8px', borderRadius: 5,
                          background: '#F0FDF4', color: '#15803D',
                        }}>
                          Available
                        </span>
                      </div>

                      {/* Rate range */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
                        <span style={{ color: '#475569', fontSize: '0.8125rem' }}>From</span>
                        <span style={{ color: '#0F172A', fontWeight: 700, fontSize: '0.9375rem' }}>{fmtRate(c.minRate)}</span>
                        <span style={{ color: '#94A3B8', fontSize: '0.8125rem' }}>to {fmtRate(c.maxRate)}/mo</span>
                      </div>

                      {/* Format pills */}
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 16 }}>
                        {c.formats.slice(0, 4).map(fmt => (
                          <span key={fmt} style={{
                            fontSize: '0.6875rem', fontWeight: 500,
                            padding: '2px 7px', borderRadius: 4,
                            background: '#F1F5F9', color: '#475569',
                          }}>
                            {FORMAT_LABELS[fmt] || fmt}
                          </span>
                        ))}
                        {c.formats.length > 4 && (
                          <span style={{ fontSize: '0.6875rem', color: '#94A3B8', padding: '2px 4px' }}>
                            +{c.formats.length - 4} more
                          </span>
                        )}
                      </div>

                      <div className="city-card-cta" style={{ color: '#94A3B8', fontSize: '0.8125rem', fontWeight: 600, transition: 'color 0.15s' }}>
                        View all boards →
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── FOOTER ── */}
      <footer style={{
        background: '#0F172A', padding: '40px 24px 28px',
        borderTop: '1px solid rgba(255,255,255,0.06)',
      }}>
        <div style={{ maxWidth: 1100, margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
          <Link href="/" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 24, height: 24, borderRadius: 6, background: 'linear-gradient(135deg, #1B4F8A, #3B82F6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ color: '#fff', fontSize: 12, fontWeight: 800 }}>O</span>
            </div>
            <span style={{ color: '#94A3B8', fontWeight: 600, fontSize: '0.875rem' }}>OOH Platform</span>
          </Link>
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            {[['Marketplace', '/marketplace'], ['Campaign Builder', '/campaign-builder'], ['Sign in', '/auth/login']].map(([label, href]) => (
              <Link key={href} href={href} style={{ color: '#64748B', textDecoration: 'none', fontSize: '0.8125rem' }}>{label}</Link>
            ))}
          </div>
          <span style={{ color: '#475569', fontSize: '0.8125rem' }}>© 2026 OOH Platform</span>
        </div>
      </footer>
    </>
  );
}
