'use client';

import { useState, useEffect, useRef, useCallback, MouseEvent as RMouseEvent } from 'react';
import Link from 'next/link';

/* ═══════════════════════════════════════════════════════════
   DATA
═══════════════════════════════════════════════════════════ */

const TICKER_ITEMS = [
  { name: 'Admiralty Unipole booked', sub: 'Lekki · ₦680K/mo · just now' },
  { name: 'New board listed in Maitama', sub: 'Abuja · Digital LED · 2m ago' },
  { name: 'Aba Road Gantry — POP verified', sub: 'Port Harcourt · 5m ago' },
  { name: 'Counter-offer accepted', sub: 'Ikeja · ₦495K/mo · 8m ago' },
  { name: 'Media plan exported', sub: 'Lagos campaign · 11m ago' },
];

const PARTNERS = ['Alphabet', 'Optimal', 'Brandlane', 'Northpoint', 'Vantage', 'Meridian', 'Civic'];

const ROTATING_WORDS = ['outdoor advertising', 'every billboard', 'the OOH market', 'the whole deal'];

const ROLES = {
  agencies: {
    label: 'Agencies',
    steps: [
      { ico: 'search', n: '01', title: 'Search boards by city, format & budget', body: 'Filter every OOH surface in Nigeria — from unipoles to bridge panels — by footfall, illumination and rate. Build a shortlist in minutes.', link: 'Browse the marketplace' },
      { ico: 'msg', n: '02', title: 'Send booking requests & negotiate rates', body: 'Message owners, counter-offer and lock availability in one thread. Every term recorded — no scattered WhatsApp chains.', link: 'See negotiations' },
      { ico: 'file', n: '03', title: 'Track campaigns, compliance & invoices', body: 'Generate branded media plans, monitor proof-of-posting and reconcile invoices from a single live dashboard.', link: 'Explore the dashboard' },
    ],
  },
  owners: {
    label: 'Board Owners',
    steps: [
      { ico: 'pin', n: '01', title: 'List your inventory in minutes', body: 'Add boards with location, dimensions, photos and asking rate. Your whole portfolio, discoverable by every agency and brand.', link: 'List a board' },
      { ico: 'msg', n: '02', title: 'Receive booking requests & negotiate', body: 'Field offers, counter and accept deals in-thread. Set availability windows and never double-book a site again.', link: 'See how it works' },
      { ico: 'trend', n: '03', title: 'Get paid & grow occupancy', body: "Automated invoicing and earnings analytics show what's booked, what's open and where your next naira comes from.", link: 'View earnings tools' },
    ],
  },
  brands: {
    label: 'Brands',
    steps: [
      { ico: 'globe', n: '01', title: 'See your campaign on a live map', body: 'Watch every booked board light up across the country in real time — status, location and creative in one birds-eye view.', link: 'See the campaign map' },
      { ico: 'shield', n: '02', title: 'Verify proof-of-posting instantly', body: "Field teams upload geo-tagged photos. You see verification status the moment a board goes up — no waiting, no doubt.", link: 'See compliance' },
      { ico: 'activity', n: '03', title: 'Measure reach, spend & performance', body: 'Footfall-backed impression estimates and budget tracking turn outdoor spend into numbers you can report on.', link: 'See reporting' },
    ],
  },
};

const FEATURES_DATA = [
  { ico: 'map', tone: 'blue', title: 'Billboard Marketplace', body: 'Search, filter and discover every OOH surface in Nigeria — from unipoles to bridge panels — in one searchable map.', tag: 'Discover' },
  { ico: 'msg', tone: 'blue', title: 'Real-time Negotiations', body: 'Message, counter-offer, accept or decline deals — all in one thread. No more lost WhatsApp chains.', tag: 'Negotiate' },
  { ico: 'shield', tone: 'green', title: 'Compliance Tracking', body: 'Field staff submit geo-tagged proof-of-posting on mobile. Clients see verification status in real time.', tag: 'Verify' },
  { ico: 'file', tone: 'blue', title: 'Media Plan PDFs', body: 'Generate branded media plans and MPOs with one click. Impress clients and close deals faster.', tag: 'Export' },
  { ico: 'users', tone: 'green', title: 'Audience Intelligence', body: 'Nigerian city profiles, footfall scoring and a CPM calculator. Plan smarter, spend better.', tag: 'Analyse' },
  { ico: 'trend', tone: 'blue', title: 'Rate Intelligence', body: 'Market-rate benchmarks across formats and cities — so you never leave money on the table.', tag: 'Benchmark' },
];

const PRICING_DATA = [
  { tag: 'Agencies', amount: 'Free', free: true, per: '', featured: false,
    desc: 'Plan, search and pitch — every planning tool, zero monthly fees.',
    feats: ['Unlimited board search', 'Campaign planning tools', 'Audience intelligence', 'AI brief parsing', 'Media plan PDF export'],
    cta: 'Get started' },
  { tag: 'Board Owners', amount: '10%', free: false, per: 'commission on bookings', featured: true, ribbon: 'Most popular',
    desc: 'List for free. Pay only when a booking completes — nothing before.',
    feats: ['List unlimited boards', 'Receive booking requests', 'Negotiation threads', 'Automated invoicing', 'Earnings analytics'],
    cta: 'Start listing' },
  { tag: 'Brands', amount: 'Free', free: true, per: '', featured: false,
    desc: 'Full campaign visibility — track every board you run, live.',
    feats: ['Real-time campaign map', 'Compliance dashboard', 'POP photo verification', 'Budget tracking', 'Performance reports'],
    cta: 'Get started' },
];

const BOARDS_DATA = [
  { loc: 'Victoria Island · Lagos', name: 'Ozumba Gantry',        spec: ['60m × 12m','Illuminated'],  rate: '₦1.2M', per: '/mo', status: 'avail', rating: '4.9', x: 24, y: 38, tone: 'green' },
  { loc: 'Lekki Phase 1 · Lagos',  name: 'Admiralty Unipole',     spec: ['12m × 6m', 'Backlit'],      rate: '₦680K', per: '/mo', status: 'avail', rating: '4.7', x: 58, y: 62, tone: 'blue' },
  { loc: 'Ikeja · Lagos',          name: 'Allen Bridge Panel',    spec: ['18m × 4m', 'Static'],       rate: '₦520K', per: '/mo', status: 'soon',  rating: '4.6', x: 40, y: 22, tone: 'amber' },
  { loc: 'Maitama · Abuja',        name: 'Aminu Kano LED',        spec: ['10m × 5m', 'Digital LED'],  rate: '₦1.8M', per: '/mo', status: 'avail', rating: '5.0', x: 72, y: 30, tone: 'green' },
  { loc: 'GRA · Port Harcourt',    name: 'Aba Road Gantry',       spec: ['40m × 10m','Illuminated'],  rate: '₦940K', per: '/mo', status: 'avail', rating: '4.8', x: 50, y: 78, tone: 'blue' },
  { loc: 'Wuse 2 · Abuja',         name: 'Shehu Shagari 48-Sheet',spec: ['12m × 3m', 'Backlit'],      rate: '₦430K', per: '/mo', status: 'soon',  rating: '4.5', x: 84, y: 54, tone: 'amber' },
];

const WORLD_CITIES = [
  { name: 'Lagos',         tag: 'HQ', x: 50, y: 50, home: true,  delay: 0    },
  { name: 'Abuja',         tag: 'NG', x: 36, y: 27, home: false, delay: 0.25 },
  { name: 'Port Harcourt', tag: 'NG', x: 66, y: 73, home: false, delay: 0.4  },
  { name: 'Accra',         tag: 'GH', x: 22, y: 64, home: false, delay: 0.7  },
  { name: 'Nairobi',       tag: 'KE', x: 74, y: 40, home: false, delay: 0.9  },
  { name: 'Cairo',         tag: 'EG', x: 80, y: 20, home: false, delay: 1.1  },
  { name: 'Johannesburg',  tag: 'ZA', x: 60, y: 82, home: false, delay: 1.3  },
  { name: 'London',        tag: 'UK', x: 28, y: 14, home: false, delay: 1.55 },
  { name: 'New York',      tag: 'US', x: 14, y: 36, home: false, delay: 1.8  },
  { name: 'Dubai',         tag: 'AE', x: 88, y: 58, home: false, delay: 2.0  },
];

/* ═══════════════════════════════════════════════════════════
   HELPERS
═══════════════════════════════════════════════════════════ */

function parseRate(r: string): number {
  const n = parseFloat(r.replace(/[₦,]/g, ''));
  if (r.includes('M')) return n * 1e6;
  if (r.includes('K')) return n * 1e3;
  return n;
}
function fmtBudget(n: number) {
  return n >= 1e6 ? `₦${(n / 1e6).toFixed(1)}M` : `₦${Math.round(n / 1e3)}K`;
}

/* ═══════════════════════════════════════════════════════════
   ICONS  (inline Lucide-style SVG paths)
═══════════════════════════════════════════════════════════ */

const ICO: Record<string, string> = {
  search:   'M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z',
  pin:      'M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z M12 10a1 1 0 1 0 0-2 1 1 0 0 0 0 2',
  filter:   'M22 3H2l8 9.46V19l4 2v-8.54z',
  msg:      'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
  shield:   'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  file:     'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6',
  activity: 'M22 12h-4l-3 9L9 3l-3 9H2',
  trend:    'M23 6l-9.5 9.5-5-5L1 18 M17 6h6v6',
  arrow:    'M5 12h14 M12 5l7 7-7 7',
  check:    'M20 6L9 17l-5-5',
  globe:    'M12 22A10 10 0 1 0 12 2a10 10 0 0 0 0 20z M2 12h20 M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z',
  users:    'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2 M23 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75',
  heart:    'M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z',
  star:     'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z',
  lock:     'M19 11H5a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2z M7 11V7a5 5 0 0 1 10 0v4',
  map:      'M1 6l7-4 8 4 7-4v16l-7 4-8-4-7 4V6 M8 2v16 M16 6v16',
  grid:     'M3 3h7v7H3z M14 3h7v7h-7z M14 14h7v7h-7z M3 14h7v7H3z',
  briefcase:'M20 7H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16',
  sparkles: 'M5 3l1.5 4.5h4L7 10l1.5 4.5L5 12l-3.5 2.5L3 10 0 7.5h4z M19 9l1 3h3l-2.5 1.8L21.5 17 19 15.2 16.5 17l1-3.2L15 12h3z',
  building: 'M3 21h18 M3 10h18 M5 21V10l7-7 7 7v11 M9 21v-6h6v6',
  twitter:  'M23 3a10.9 10.9 0 0 1-3.14 1.53 4.48 4.48 0 0 0-7.86 3v1A10.66 10.66 0 0 1 3 4s-4 9 5 13a11.64 11.64 0 0 1-7 2c9 5 20 0 20-11.5a4.5 4.5 0 0 0-.08-.83A7.72 7.72 0 0 0 23 3z',
  linkedin: 'M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z M2 9h4v12H2z M4 6a2 2 0 1 0 0-4 2 2 0 0 0 0 4',
  instagram:'M17 2H7C4.24 2 2 4.24 2 7v10c0 2.76 2.24 5 5 5h10c2.76 0 5-2.24 5-5V7c0-2.76-2.24-5-5-5z M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z M17.5 6.5h.01',
};

function Ico({ n, size = 18, color = 'currentColor', sw = 1.75 }: { n: string; size?: number; color?: string; sw?: number }) {
  const d = ICO[n] || '';
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      {d.split(' M').map((seg, i) => <path key={i} d={i === 0 ? seg : 'M' + seg} />)}
    </svg>
  );
}

/* ═══════════════════════════════════════════════════════════
   HOOKS
═══════════════════════════════════════════════════════════ */

function useCountUp(target: number, duration = 1500, active = false) {
  const [val, setVal] = useState(0);
  useEffect(() => {
    if (!active) return;
    let raf: number;
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = Math.min((now - t0) / duration, 1);
      setVal(Math.round((1 - Math.pow(1 - p, 3)) * target));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration, active]);
  return val;
}

function useInView(threshold = 0.15): [React.RefObject<HTMLDivElement | null>, boolean] {
  const ref = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) setSeen(true); }, { threshold });
    if (ref.current) obs.observe(ref.current);
    return () => obs.disconnect();
  }, [threshold]);
  return [ref, seen];
}

/* ═══════════════════════════════════════════════════════════
   SCROLL PROGRESS
═══════════════════════════════════════════════════════════ */

function ScrollProgress() {
  const [pct, setPct] = useState(0);
  useEffect(() => {
    const onScroll = () => {
      const el = document.documentElement;
      setPct(100 * el.scrollTop / (el.scrollHeight - el.clientHeight));
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, height: 2.5, zIndex: 300,
      width: `${pct}%`,
      background: 'linear-gradient(90deg,#2f6bff,#7b5cff,#2fd27a)',
      boxShadow: '0 0 12px rgba(47,107,255,.7)',
      transition: 'width .08s linear',
      pointerEvents: 'none',
    }} />
  );
}

/* ═══════════════════════════════════════════════════════════
   CITY MAP SVG  (abstract — used in hero + marketplace)
═══════════════════════════════════════════════════════════ */

function CityMapSVG({ h = 340 }: { h?: number }) {
  return (
    <svg viewBox="0 0 500 340" width="100%" height={h} preserveAspectRatio="xMidYMid slice">
      <defs>
        <pattern id="lp-cgrid" width="30" height="30" patternUnits="userSpaceOnUse">
          <path d="M 30 0 L 0 0 0 30" fill="none" stroke="rgba(26,22,15,.04)" strokeWidth="0.6"/>
        </pattern>
      </defs>
      <rect width="500" height="340" fill="url(#lp-cgrid)"/>
      <line x1="0" y1="85"  x2="500" y2="85"  stroke="rgba(26,22,15,.09)" strokeWidth="1.4"/>
      <line x1="0" y1="185" x2="500" y2="185" stroke="rgba(26,22,15,.09)" strokeWidth="1.4"/>
      <line x1="0" y1="260" x2="500" y2="260" stroke="rgba(26,22,15,.06)" strokeWidth="1"/>
      <line x1="105" y1="0" x2="105" y2="340" stroke="rgba(26,22,15,.09)" strokeWidth="1.4"/>
      <line x1="245" y1="0" x2="245" y2="340" stroke="rgba(26,22,15,.09)" strokeWidth="1.4"/>
      <line x1="375" y1="0" x2="375" y2="340" stroke="rgba(26,22,15,.06)" strokeWidth="1"/>
      <path d="M 0 135 Q 120 108 245 140 T 500 118" fill="none" stroke="rgba(26,22,15,.06)" strokeWidth="1.2"/>
      <path d="M 105 185 Q 175 208 245 185 T 375 200" fill="none" stroke="rgba(26,22,15,.05)" strokeWidth="1"/>
      <path d="M 0 295 Q 75 270 155 284 T 305 258 T 460 276 T 500 263" fill="none" stroke="rgba(47,107,255,.25)" strokeWidth="3" strokeLinecap="round"/>
    </svg>
  );
}

/* ═══════════════════════════════════════════════════════════
   MAP PIN
═══════════════════════════════════════════════════════════ */

function MapPin({ x, y, price, tone, active, delay, pulse }: {
  x: number; y: number; price: string; tone: string; active?: boolean; delay?: number; pulse?: boolean;
}) {
  const needleColor = tone === 'green' ? '#2fd27a' : tone === 'amber' ? '#f2b34b' : '#2f6bff';
  const ringColor   = tone === 'green' ? 'rgba(47,210,122,.18)' : tone === 'amber' ? 'rgba(242,179,75,.18)' : 'rgba(47,107,255,.18)';
  return (
    <div style={{
      position: 'absolute',
      left: `${x}%`, top: `${y}%`,
      transform: 'translate(-50%,-100%)',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      cursor: 'pointer', zIndex: 2,
      animation: `lp-pindrop .55s cubic-bezier(.2,.9,.2,1.1) ${delay ?? 0}s both`,
    }}>
      <span style={{
        fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 11, fontWeight: 600,
        background: active ? '#2f6bff' : '#fff',
        color: active ? '#fff' : '#1a1712',
        border: `1px solid ${active ? '#5d8cff' : 'rgba(26,22,15,.16)'}`,
        padding: '3px 7px', borderRadius: 7, whiteSpace: 'nowrap', marginBottom: 4,
        boxShadow: '0 6px 16px -8px rgba(26,22,15,.35)',
        transition: 'all .18s',
      }}>{price}</span>
      <span style={{
        width: 14, height: 14, borderRadius: '50% 50% 50% 0', transform: 'rotate(45deg)',
        background: needleColor, border: '2px solid #fff',
        boxShadow: `0 0 0 4px ${ringColor}`,
        display: 'block',
      }}/>
      {pulse && (
        <span style={{
          position: 'absolute', top: 0, left: '50%', width: 14, height: 14,
          borderRadius: '50%', transform: 'translate(-50%, 18px)',
          background: needleColor,
          animation: 'lp-ping 2.4s ease-out infinite',
        }}/>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   NAV
═══════════════════════════════════════════════════════════ */

function Nav({ scrolled }: { scrolled: boolean }) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <nav className={scrolled || menuOpen ? 'lp-nav lp-nav-scrolled' : 'lp-nav'}>
      <div className="lp-wrap" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 70 }}>
        {/* Brand */}
        <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 11, textDecoration: 'none' }}>
          <span style={{
            width: 32, height: 32, borderRadius: 9, flexShrink: 0,
            background: 'linear-gradient(150deg,#2f6bff,#7b5cff)',
            display: 'grid', placeItems: 'center',
            boxShadow: '0 6px 18px -6px rgba(47,107,255,.8), inset 0 1px 0 rgba(255,255,255,.4)',
            position: 'relative', overflow: 'hidden',
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.9)" strokeWidth="2.5" strokeLinecap="round">
              <rect x="3" y="4" width="18" height="5" rx="1.5"/>
              <line x1="6" y1="9" x2="6" y2="20"/><line x1="18" y1="9" x2="18" y2="20"/>
            </svg>
          </span>
          <span style={{ fontFamily: 'var(--font-archivo, sans-serif)', fontWeight: 800, fontSize: 19, letterSpacing: '-.01em', color: '#1a1712', lineHeight: 1 }}>
            OOH
            <small style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontWeight: 400, fontSize: 10, color: '#756e62', letterSpacing: '.12em', display: 'block', marginTop: -1, textTransform: 'uppercase' }}>Operating System</small>
          </span>
        </Link>

        {/* Center links (desktop) */}
        <div className="lp-nav-links">
          {[['Marketplace','#marketplace'],['How it works','#how'],['Features','#features'],['Pricing','#pricing']].map(([l,h]) => (
            <a key={l} href={h} style={{ fontSize: 14.5, fontWeight: 500, color: '#4a443b', padding: '8px 14px', borderRadius: 9, textDecoration: 'none', transition: 'color .15s, background .15s' }}
              onMouseEnter={e => { (e.target as HTMLElement).style.color='#1a1712'; (e.target as HTMLElement).style.background='rgba(26,22,15,.05)'; }}
              onMouseLeave={e => { (e.target as HTMLElement).style.color='#4a443b'; (e.target as HTMLElement).style.background='transparent'; }}>
              {l}
            </a>
          ))}
        </div>

        {/* Right */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Link href="/auth/login" className="lp-nav-desktop" style={{ fontSize: 14.5, fontWeight: 500, color: '#4a443b', padding: '9px 14px', textDecoration: 'none', borderRadius: 9, transition: 'color .15s' }}>
            Log in
          </Link>
          <Link href="/signup" className="lp-nav-desktop" style={{
            display: 'inline-flex', alignItems: 'center', gap: 7,
            background: '#2f6bff', color: '#fff', borderRadius: 12,
            padding: '10px 18px', fontSize: 14, fontWeight: 600, textDecoration: 'none',
            boxShadow: '0 8px 22px -8px rgba(47,107,255,.7)',
            transition: 'transform .15s, background .15s',
            position: 'relative', overflow: 'hidden',
          }}>
            Start free
            <Ico n="arrow" size={15} color="#fff" sw={2.2}/>
          </Link>
          {/* Hamburger (mobile only) */}
          <button className="lp-hamburger" onClick={() => setMenuOpen(m => !m)} aria-label="Menu">
            <span style={{ width: 20, height: 2, background: '#1a1712', borderRadius: 2, display: 'block', transition: 'transform .2s', transform: menuOpen ? 'translateY(7px) rotate(45deg)' : 'none' }}/>
            <span style={{ width: 20, height: 2, background: '#1a1712', borderRadius: 2, display: 'block', transition: 'opacity .2s', opacity: menuOpen ? 0 : 1 }}/>
            <span style={{ width: 20, height: 2, background: '#1a1712', borderRadius: 2, display: 'block', transition: 'transform .2s', transform: menuOpen ? 'translateY(-7px) rotate(-45deg)' : 'none' }}/>
          </button>
        </div>
      </div>

      {/* Mobile dropdown */}
      {menuOpen && (
        <div className="lp-mob-menu" style={{ display: 'flex', flexDirection: 'column', padding: '4px 20px 20px', borderTop: '1px solid rgba(26,22,15,.08)' }}>
          {[['Marketplace','#marketplace'],['How it works','#how'],['Features','#features'],['Pricing','#pricing']].map(([l,h]) => (
            <a key={l} href={h} onClick={() => setMenuOpen(false)} style={{ fontSize: 16, fontWeight: 500, color: '#1a1712', padding: '13px 0', borderBottom: '1px solid rgba(26,22,15,.06)', textDecoration: 'none' }}>{l}</a>
          ))}
          <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
            <Link href="/auth/login" onClick={() => setMenuOpen(false)} style={{ flex: 1, textAlign: 'center', padding: '13px', borderRadius: 11, border: '1px solid rgba(26,22,15,.16)', fontSize: 15, fontWeight: 600, color: '#1a1712', textDecoration: 'none' }}>Log in</Link>
            <Link href="/signup" onClick={() => setMenuOpen(false)} style={{ flex: 1, textAlign: 'center', padding: '13px', borderRadius: 11, background: '#2f6bff', fontSize: 15, fontWeight: 600, color: '#fff', textDecoration: 'none', boxShadow: '0 8px 22px -8px rgba(47,107,255,.7)' }}>Start free</Link>
          </div>
        </div>
      )}
    </nav>
  );
}

/* ═══════════════════════════════════════════════════════════
   HERO
═══════════════════════════════════════════════════════════ */

function LiveTicker() {
  const [idx, setIdx] = useState(0);
  const [anim, setAnim] = useState(false);
  useEffect(() => {
    const t = setInterval(() => {
      setAnim(false);
      setTimeout(() => { setIdx(i => (i + 1) % TICKER_ITEMS.length); setAnim(true); }, 50);
    }, 3000);
    setAnim(true);
    return () => clearInterval(t);
  }, []);
  const item = TICKER_ITEMS[idx];
  return (
    <div style={{
      position: 'absolute', left: 14, bottom: 14, zIndex: 6, maxWidth: 250,
      display: 'flex', alignItems: 'center', gap: 10,
      background: 'rgba(255,255,255,.92)', border: '1px solid rgba(26,22,15,.14)',
      backdropFilter: 'blur(10px)', borderRadius: 12, padding: '9px 13px 9px 11px',
      boxShadow: '0 8px 24px -12px rgba(26,22,15,.3)',
      animation: anim ? 'lp-tickin .5s cubic-bezier(.2,.8,.2,1)' : 'none',
    }}>
      <span style={{ width: 9, height: 9, borderRadius: '50%', flexShrink: 0, background: '#2fd27a', boxShadow: '0 0 0 4px rgba(47,210,122,.18)', position: 'relative' }}>
        <span style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: '#2fd27a', animation: 'lp-ping 2s ease-out infinite' }}/>
      </span>
      <span style={{ minWidth: 0 }}>
        <b style={{ fontSize: 12.5, fontWeight: 700, display: 'block', lineHeight: 1.2, color: '#1a1712' }}>{item.name}</b>
        <small style={{ fontSize: 11, color: '#756e62', fontFamily: 'var(--font-geist-mono,monospace)', letterSpacing: '.02em' }}>{item.sub}</small>
      </span>
    </div>
  );
}

function Hero() {
  const [wordIdx, setWordIdx] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setWordIdx(i => (i + 1) % ROTATING_WORDS.length), 2400);
    return () => clearInterval(t);
  }, []);

  return (
    <section style={{ padding: '70px 0 90px', overflow: 'hidden', position: 'relative' }}>
      {/* Subtle background warmth */}
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 0,
        background: 'radial-gradient(100% 70% at 70% -10%, rgba(47,107,255,.06), transparent 55%)' }}/>

      <div className="lp-wrap lp-hero-grid">
        {/* ── Left: copy ── */}
        <div style={{ position: 'relative', zIndex: 2 }}>
          {/* Badge */}
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            fontFamily: 'var(--font-geist-mono,monospace)', fontSize: 11.5, letterSpacing: '.14em',
            textTransform: 'uppercase', fontWeight: 500, color: '#2f6bff',
            padding: '7px 13px 7px 11px', borderRadius: 999,
            background: 'rgba(47,107,255,.10)', border: '1px solid rgba(47,107,255,.28)',
            marginBottom: 22,
          }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#2f6bff', boxShadow: '0 0 0 4px rgba(47,107,255,.18)' }}/>
            Nigeria&apos;s OOH Operating System
          </div>

          {/* H1 with rotating word */}
          <h1 style={{
            fontFamily: 'var(--font-archivo, sans-serif)',
            fontWeight: 800,
            fontSize: 'clamp(40px,5.4vw,68px)',
            lineHeight: .98,
            letterSpacing: '-.032em',
            color: '#1a1712',
            margin: '0 0 0',
            textWrap: 'balance',
          }}>
            The platform that runs{' '}
            <span style={{ display: 'inline-flex', position: 'relative', verticalAlign: 'bottom', overflow: 'hidden', height: '1.05em' }}>
              <span style={{
                display: 'inline-flex', flexDirection: 'column',
                transition: 'transform .62s cubic-bezier(.7,0,.2,1)',
                transform: `translateY(-${wordIdx * 1.05}em)`,
              }}>
                {ROTATING_WORDS.map(w => (
                  <span key={w} style={{ height: '1.05em', lineHeight: 1.05, whiteSpace: 'nowrap', color: '#2f6bff' }}>{w}</span>
                ))}
              </span>
            </span>
          </h1>

          {/* Subhead */}
          <p style={{ marginTop: 22, fontSize: 19, color: '#4a443b', maxWidth: 480, lineHeight: 1.55 }}>
            Billboard owners list space. Agencies plan and book campaigns. Brands track results in real time. One platform — the whole transaction.
          </p>

          {/* CTAs */}
          <div style={{ marginTop: 32, display: 'flex', gap: 13, flexWrap: 'wrap' }}>
            <Link href="/signup" style={{
              display: 'inline-flex', alignItems: 'center', gap: 9,
              background: '#2f6bff', color: '#fff', borderRadius: 13,
              padding: '16px 26px', fontSize: 16, fontWeight: 600, textDecoration: 'none',
              boxShadow: '0 12px 30px -10px rgba(47,107,255,.6), inset 0 1px 0 rgba(255,255,255,.25)',
              position: 'relative', overflow: 'hidden',
            }}>
              Start for free
              <Ico n="arrow" size={17} color="#fff" sw={2}/>
            </Link>
            <Link href="/marketplace" style={{
              display: 'inline-flex', alignItems: 'center', gap: 9,
              background: '#fff', color: '#1a1712',
              border: '1px solid rgba(26,22,15,.16)', borderRadius: 13,
              padding: '16px 26px', fontSize: 16, fontWeight: 600, textDecoration: 'none',
              boxShadow: '0 1px 0 rgba(26,22,15,.04)',
            }}>
              ⊞ Browse boards
            </Link>
          </div>

          {/* Meta */}
          <div style={{ marginTop: 30, display: 'flex', alignItems: 'center', gap: 18, color: '#756e62', fontSize: 13.5 }}>
            <div style={{ display: 'flex' }}>
              {[['AD','#2f6bff'],['BO','#7b5cff'],['BR','#2fd27a']].map(([lbl,clr],i) => (
                <span key={lbl} style={{
                  width: 30, height: 30, borderRadius: '50%',
                  background: clr, display: 'grid', placeItems: 'center',
                  fontSize: 10, fontWeight: 700, color: '#fff',
                  border: '2px solid #f6f4ef', marginLeft: i > 0 ? -9 : 0,
                }}>{lbl}</span>
              ))}
            </div>
            <span>Agencies, board owners &amp; brands already on the platform</span>
          </div>
        </div>

        {/* ── Right: map visual ── */}
        <div className="lp-hero-visual" style={{ position: 'relative', zIndex: 1, minHeight: 480 }}>
          {/* Floating stat chips */}
          <div style={{ position: 'absolute', left: -16, top: -14, zIndex: 6, display: 'flex', gap: 10 }} className="lp-float-a lp-hero-chips">
            {[{ v: '143', l: 'boards live', tone: 'b' }, { v: '28', l: 'active deals', tone: 'g' }].map(({ v, l, tone }) => (
              <div key={l} style={{
                background: '#fff', border: '1px solid rgba(26,22,15,.14)',
                borderRadius: 13, padding: '11px 14px',
                boxShadow: '0 18px 44px -26px rgba(26,22,15,.30)', minWidth: 84,
              }}>
                <b style={{ fontFamily: 'var(--font-archivo,sans-serif)', fontWeight: 800, fontSize: 21, display: 'block', lineHeight: 1, color: tone === 'b' ? '#5d8cff' : '#2fd27a' }}>{v}</b>
                <small style={{ fontSize: 10.5, color: '#756e62', marginTop: 5, display: 'block' }}>{l}</small>
              </div>
            ))}
          </div>

          {/* Map panel */}
          <div style={{
            borderRadius: 24, overflow: 'hidden',
            background: 'linear-gradient(160deg,#eef1f6,#e6eaf1)',
            border: '1px solid rgba(26,22,15,.14)',
            boxShadow: '0 34px 70px -34px rgba(26,22,15,.28)',
          }} className="lp-float-b">
            {/* Toolbar */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '13px 14px', borderBottom: '1px solid rgba(26,22,15,.10)', background: '#fff' }}>
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 9, background: '#faf8f3', border: '1px solid rgba(26,22,15,.10)', borderRadius: 9, padding: '8px 12px', color: '#756e62', fontSize: 13 }}>
                <Ico n="search" size={15} color="#756e62"/>
                Search Lagos, Abuja, Port Harcourt…
              </div>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 600, padding: '8px 11px', borderRadius: 9, background: '#fff', border: '1px solid rgba(26,22,15,.10)', color: '#4a443b' }}>
                <Ico n="filter" size={13} color="#4a443b"/>
                Filters
              </div>
            </div>
            {/* Map canvas */}
            <div style={{ position: 'relative', height: 340, overflow: 'hidden' }}>
              <CityMapSVG h={340}/>
              {BOARDS_DATA.map((b, i) => (
                <MapPin key={b.name} x={b.x} y={b.y} price={b.rate} tone={b.tone} delay={i * 0.1} pulse={i === 0}/>
              ))}
              <LiveTicker/>
            </div>
          </div>

          {/* Featured board card */}
          <div className="lp-hero-board" style={{
            position: 'absolute', width: 268, right: -18, bottom: -22, zIndex: 5,
            background: '#fff', border: '1px solid rgba(26,22,15,.14)',
            borderRadius: 16, overflow: 'hidden',
            boxShadow: '0 34px 70px -34px rgba(26,22,15,.28)',
          }}>
            <div style={{ height: 124, position: 'relative', background: 'linear-gradient(150deg,#e7ebf2,#dde2ec)' }}>
              <div style={{ position: 'absolute', inset: 0, opacity: 1, background: 'repeating-linear-gradient(135deg,rgba(26,22,15,.045) 0 10px,transparent 10px 20px)' }}/>
              <span style={{ position: 'absolute', left: 12, bottom: 10, fontFamily: 'var(--font-geist-mono,monospace)', fontSize: 10, color: 'rgba(26,22,15,.4)', letterSpacing: '.08em' }}>[ board photo ]</span>
              <div style={{
                position: 'absolute', top: 11, left: 11,
                display: 'flex', alignItems: 'center', gap: 6,
                fontFamily: 'var(--font-geist-mono,monospace)', fontSize: 10, fontWeight: 600,
                letterSpacing: '.1em', textTransform: 'uppercase',
                background: 'rgba(47,210,122,.14)', border: '1px solid rgba(47,210,122,.3)', color: '#2fd27a',
                padding: '4px 8px', borderRadius: 999, backdropFilter: 'blur(4px)',
              }}>
                <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#2fd27a', animation: 'lp-blink 1.6s infinite' }}/>
                Live
              </div>
            </div>
            <div style={{ padding: '13px 14px 15px' }}>
              <div style={{ fontFamily: 'var(--font-geist-mono,monospace)', fontSize: 10.5, color: '#2f6bff', letterSpacing: '.1em', textTransform: 'uppercase' }}>Victoria Island · Lagos</div>
              <h4 style={{ fontFamily: 'var(--font-archivo,sans-serif)', fontWeight: 700, fontSize: 18, marginTop: 5, letterSpacing: '-.01em', color: '#1a1712' }}>Ozumba Gantry</h4>
              <div style={{ color: '#756e62', fontSize: 12.5, marginTop: 3 }}>60m × 12m Gantry · Illuminated</div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 13, paddingTop: 12, borderTop: '1px solid rgba(26,22,15,.10)' }}>
                <div>
                  <small style={{ fontFamily: 'var(--font-geist-mono,monospace)', fontSize: 9.5, color: '#756e62', letterSpacing: '.1em', textTransform: 'uppercase', display: 'block' }}>Rate</small>
                  <b style={{ fontFamily: 'var(--font-archivo,sans-serif)', fontSize: 19, fontWeight: 800, color: '#1a1712' }}>₦1.2M<span style={{ fontSize: 12, color: '#756e62', fontWeight: 500 }}>/mo</span></b>
                </div>
                <Link href="/signup" style={{ background: '#2f6bff', color: '#fff', borderRadius: 10, padding: '8px 14px', fontSize: 12.5, fontWeight: 700, textDecoration: 'none', boxShadow: '0 6px 16px -6px rgba(47,107,255,.6)' }}>
                  Book now
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════
   STATS BAR
═══════════════════════════════════════════════════════════ */

function StatCell({ prefix = '', target, suffix = '', label, tone, first = false }: { prefix?: string; target: number; suffix?: string; label: string; tone: 'green'|'blue'|'plain'; first?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [go, setGo] = useState(false);
  const val = useCountUp(target, 1500, go);
  useEffect(() => {
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) setGo(true); }, { threshold: 0.4 });
    if (ref.current) obs.observe(ref.current);
    return () => obs.disconnect();
  }, []);
  const c = tone === 'green' ? '#2fd27a' : tone === 'blue' ? '#5d8cff' : '#1a1712';
  return (
    <div ref={ref} style={{ padding: '34px 24px', textAlign: 'center', borderLeft: first ? 'none' : '1px solid rgba(26,22,15,.10)' }}>
      <b style={{ fontFamily: 'var(--font-archivo,sans-serif)', fontWeight: 800, fontSize: 'clamp(28px,3.4vw,42px)', letterSpacing: '-.02em', display: 'block', color: c }}>{prefix}{val.toLocaleString()}{suffix}</b>
      <small style={{ display: 'block', marginTop: 7, color: '#756e62', fontSize: 13.5 }}>{label}</small>
    </div>
  );
}

function StatsBar() {
  return (
    <section style={{ borderBlock: '1px solid rgba(26,22,15,.10)', background: '#fff' }}>
      <div className="lp-wrap lp-statsbar-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)' }}>
        <StatCell prefix="₦" target={100} suffix="B+" label="Nigerian OOH market value" tone="green" first/>
        <StatCell target={143} label="Billboard locations indexed" tone="blue"/>
        <StatCell target={12} label="Cities covered" tone="blue"/>
        <StatCell target={3} label="User roles, one platform" tone="plain"/>
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════
   TRUST WALL
═══════════════════════════════════════════════════════════ */

function TrustWall() {
  const logos = [...PARTNERS, ...PARTNERS];
  return (
    <section style={{ padding: '56px 0' }}>
      <p style={{ textAlign: 'center', color: '#756e62', fontSize: 13.5, marginBottom: 30 }}>
        Trusted by agencies, board owners and brands across Nigeria
      </p>
      <div style={{ position: 'relative', overflow: 'hidden', WebkitMaskImage: 'linear-gradient(90deg,transparent,#000 12%,#000 88%,transparent)', maskImage: 'linear-gradient(90deg,transparent,#000 12%,#000 88%,transparent)' }}
        onMouseEnter={e => (e.currentTarget.querySelector('.lp-marquee-track') as HTMLElement | null)?.style.setProperty('animation-play-state','paused')}
        onMouseLeave={e => (e.currentTarget.querySelector('.lp-marquee-track') as HTMLElement | null)?.style.setProperty('animation-play-state','running')}>
        <div className="lp-marquee-track" style={{ display: 'flex', width: 'max-content', animation: 'lp-marquee 34s linear infinite', gap: 0 }}>
          {logos.map((name, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '0 32px', opacity: .55, filter: 'grayscale(1)', flexShrink: 0, transition: 'opacity .2s' }}>
              <span style={{ width: 26, height: 26, borderRadius: 7, background: '#efece4', display: 'grid', placeItems: 'center', fontFamily: 'var(--font-archivo,sans-serif)', fontWeight: 800, fontSize: 13, color: '#4a443b' }}>{name[0]}</span>
              <span style={{ fontFamily: 'var(--font-archivo,sans-serif)', fontWeight: 700, fontSize: 17, letterSpacing: '-.01em', color: '#4a443b' }}>{name}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════
   HOW IT WORKS
═══════════════════════════════════════════════════════════ */

function HowItWorks() {
  const [tab, setTab] = useState<'agencies'|'owners'|'brands'>('agencies');
  const [ref, inView] = useInView();
  const tabKeys = ['agencies','owners','brands'] as const;
  const tabLabels: Record<typeof tabKeys[number], string> = { agencies: 'Agencies', owners: 'Board Owners', brands: 'Brands' };
  const tabIcos: Record<typeof tabKeys[number], string> = { agencies: 'briefcase', owners: 'building', brands: 'sparkles' };
  const role = ROLES[tab];

  return (
    <section id="how" style={{ padding: '92px 0', background: '#f6f4ef' }}>
      <div className="lp-wrap">
        <div ref={ref} className={`lp-section-head${inView ? ' lp-in' : ''}`}>
          <span className="lp-eyebrow">How it works</span>
          <h2>Built for everyone in OOH</h2>
          <p>Whether you own billboards, buy media space, or approve campaign spend — OOH has a workspace built for you.</p>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: 7, marginBottom: 46, flexWrap: 'wrap' }}>
          {tabKeys.map(k => (
            <button key={k} onClick={() => setTab(k)} style={{
              display: 'flex', alignItems: 'center', gap: 9,
              padding: '11px 20px', borderRadius: 12, fontWeight: 600, fontSize: 15,
              border: '1px solid transparent',
              background: tab === k ? '#2f6bff' : 'transparent',
              color: tab === k ? '#fff' : '#756e62',
              boxShadow: tab === k ? '0 12px 28px -12px rgba(47,107,255,.8)' : 'none',
              cursor: 'pointer', transition: 'all .18s',
              fontFamily: 'inherit',
            }}>
              <Ico n={tabIcos[k]} size={17} color={tab === k ? '#fff' : '#756e62'}/>
              {tabLabels[k]}
            </button>
          ))}
        </div>

        {/* Steps */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 22 }} className="lp-steps-grid">
          {role.steps.map((s) => (
            <div key={s.n} style={{
              position: 'relative', background: '#fff', border: '1px solid rgba(26,22,15,.10)',
              borderRadius: 16, padding: '26px 24px 28px', overflow: 'hidden',
              transition: 'transform .2s, border-color .2s',
              boxShadow: '0 1px 0 rgba(26,22,15,.03)',
            }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.transform = 'translateY(-4px)'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(47,107,255,.30)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = ''; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(26,22,15,.10)'; }}>
              <div style={{ position: 'absolute', top: 0, left: 24, right: 24, height: 3, borderRadius: '0 0 3px 3px', background: 'linear-gradient(90deg,#2f6bff,transparent)' }}/>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
                <div style={{ width: 46, height: 46, borderRadius: 12, background: 'rgba(47,107,255,.10)', border: '1px solid rgba(47,107,255,.28)', display: 'grid', placeItems: 'center' }}>
                  <Ico n={s.ico} size={21} color="#2f6bff"/>
                </div>
                <span style={{ fontFamily: 'var(--font-geist-mono,monospace)', fontSize: 13, color: '#a59d8f', fontWeight: 600 }}>{s.n}</span>
              </div>
              <h4 style={{ fontFamily: 'var(--font-archivo,sans-serif)', fontWeight: 700, fontSize: 19, letterSpacing: '-.01em', color: '#1a1712' }}>{s.title}</h4>
              <p style={{ color: '#756e62', fontSize: 14.5, marginTop: 9, lineHeight: 1.55 }}>{s.body}</p>
              <a href="/signup" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 16, color: '#2f6bff', fontWeight: 600, fontSize: 13.5, textDecoration: 'none' }}>
                {s.link}
                <Ico n="arrow" size={14} color="#2f6bff"/>
              </a>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════
   MARKETPLACE PREVIEW
═══════════════════════════════════════════════════════════ */

function Marketplace() {
  const [city, setCity]     = useState('All Nigeria');
  const [format, setFormat] = useState<string|null>(null);
  const [budget, setBudget] = useState(1_500_000);
  const [view, setView]     = useState<'grid'|'map'>('grid');
  const [ref, inView] = useInView();

  const cities  = ['All Nigeria','Lagos','Abuja','Port Harcourt'];
  const formats = ['Gantry','Unipole','Bridge Panel','LED','48 Sheet'];

  const matches = BOARDS_DATA.filter(b => {
    const cityOk   = city === 'All Nigeria' || b.loc.includes(city);
    const fmtOk    = !format || b.name.toLowerCase().includes(format.toLowerCase()) || b.name.toLowerCase().includes(format.replace(' ', '-').toLowerCase());
    const budgetOk = parseRate(b.rate) <= budget;
    return cityOk && fmtOk && budgetOk;
  });

  return (
    <section id="marketplace" style={{ padding: '92px 0', background: '#fff' }}>
      <div className="lp-wrap">
        <div ref={ref} className={`lp-section-head${inView ? ' lp-in' : ''}`}>
          <span className="lp-eyebrow">Marketplace</span>
          <h2>A birds-eye view of the entire OOH market</h2>
          <p>Explore inventory, compare opportunities and plan with confidence — every billboard in Nigeria, in one searchable place.</p>
        </div>

        {/* Shell */}
        <div style={{ display: 'grid', gridTemplateColumns: '340px 1fr', background: '#fff', border: '1px solid rgba(26,22,15,.14)', borderRadius: 24, overflow: 'hidden', boxShadow: '0 34px 70px -34px rgba(26,22,15,.28)' }} className="lp-market-shell">
          {/* Sidebar */}
          <div style={{ padding: 22, borderRight: '1px solid rgba(26,22,15,.10)', background: '#faf8f3' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
              <h5 style={{ fontFamily: 'var(--font-archivo,sans-serif)', fontWeight: 700, fontSize: 16, color: '#1a1712' }}>Filters</h5>
              <span style={{ fontFamily: 'var(--font-geist-mono,monospace)', fontSize: 11, color: '#756e62' }}>{matches.length} boards</span>
            </div>

            {/* City */}
            <div style={{ marginBottom: 20 }}>
              <label style={{ fontSize: 11.5, fontFamily: 'var(--font-geist-mono,monospace)', letterSpacing: '.12em', textTransform: 'uppercase', color: '#756e62', display: 'block', marginBottom: 10 }}>City</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
                {cities.map(c => (
                  <button key={c} onClick={() => setCity(c)} style={{
                    fontSize: 13, fontWeight: 600, padding: '7px 12px', borderRadius: 9,
                    border: '1px solid', cursor: 'pointer', fontFamily: 'inherit',
                    transition: 'all .15s',
                    background: city === c ? 'rgba(47,107,255,.10)' : '#fff',
                    borderColor: city === c ? 'rgba(47,107,255,.30)' : 'rgba(26,22,15,.10)',
                    color: city === c ? '#2f6bff' : '#4a443b',
                  }}>{c}</button>
                ))}
              </div>
            </div>

            {/* Format */}
            <div style={{ marginBottom: 20 }}>
              <label style={{ fontSize: 11.5, fontFamily: 'var(--font-geist-mono,monospace)', letterSpacing: '.12em', textTransform: 'uppercase', color: '#756e62', display: 'block', marginBottom: 10 }}>Format</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
                {formats.map(f => (
                  <button key={f} onClick={() => setFormat(format === f ? null : f)} style={{
                    fontSize: 13, fontWeight: 600, padding: '7px 12px', borderRadius: 9,
                    border: '1px solid', cursor: 'pointer', fontFamily: 'inherit',
                    transition: 'all .15s',
                    background: format === f ? 'rgba(47,107,255,.10)' : '#fff',
                    borderColor: format === f ? 'rgba(47,107,255,.30)' : 'rgba(26,22,15,.10)',
                    color: format === f ? '#2f6bff' : '#4a443b',
                  }}>{f}</button>
                ))}
              </div>
            </div>

            {/* Budget */}
            <div>
              <label style={{ fontSize: 11.5, fontFamily: 'var(--font-geist-mono,monospace)', letterSpacing: '.12em', textTransform: 'uppercase', color: '#756e62', display: 'block', marginBottom: 10 }}>Max monthly budget</label>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, color: '#4a443b', marginBottom: 9, fontFamily: 'var(--font-geist-mono,monospace)' }}>
                <span>₦300K</span><span>{fmtBudget(budget)}</span>
              </div>
              <input type="range" min={300_000} max={2_000_000} step={50_000} value={budget}
                onChange={e => setBudget(Number(e.target.value))}
                style={{ width: '100%', height: 5, borderRadius: 5, background: `linear-gradient(90deg,#2f6bff ${(budget-300_000)/(2_000_000-300_000)*100}%,#efece4 0)`, outline: 'none', WebkitAppearance: 'none', cursor: 'pointer' }}
              />
              <div style={{ marginTop: 6, fontSize: 13, color: '#756e62' }}>
                Showing <b style={{ color: '#1a1712' }}>{matches.length}</b> of {BOARDS_DATA.length} boards
              </div>
            </div>
          </div>

          {/* Main */}
          <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid rgba(26,22,15,.10)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9, fontWeight: 600, fontSize: 14.5, color: '#1a1712' }}>
                <Ico n="map" size={16} color="#2f6bff"/>
                {matches.length} boards match your search
              </div>
              <div style={{ display: 'flex', gap: 4, background: '#faf8f3', border: '1px solid rgba(26,22,15,.10)', borderRadius: 9, padding: 3 }}>
                {[['grid','Grid'],['map','Map']].map(([v,l]) => (
                  <button key={v} onClick={() => setView(v as 'grid'|'map')} style={{
                    fontSize: 12.5, fontWeight: 600, padding: '6px 12px', borderRadius: 7,
                    background: view === v ? '#fff' : 'transparent',
                    color: view === v ? '#1a1712' : '#756e62',
                    border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                    boxShadow: view === v ? '0 1px 2px rgba(26,22,15,.12)' : 'none',
                    transition: 'all .15s',
                  }}>
                    <Ico n={v === 'grid' ? 'grid' : 'map'} size={13} color={view === v ? '#1a1712' : '#756e62'}/>{' '}{l}
                  </button>
                ))}
              </div>
            </div>

            {view === 'grid' ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 16, padding: 20 }} className="lp-results-grid">
                {matches.length === 0 && (
                  <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: '48px 24px', color: '#756e62' }}>No boards match your filters</div>
                )}
                {matches.map(b => (
                  <div key={b.name} style={{ background: '#fff', border: '1px solid rgba(26,22,15,.10)', borderRadius: 14, overflow: 'hidden', transition: 'transform .2s, border-color .2s, box-shadow .2s' }}
                    onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.transform='translateY(-4px)'; el.style.borderColor='rgba(47,107,255,.30)'; el.style.boxShadow='0 18px 44px -26px rgba(26,22,15,.30)'; }}
                    onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.transform=''; el.style.borderColor='rgba(26,22,15,.10)'; el.style.boxShadow=''; }}>
                    <div style={{ height: 120, position: 'relative', background: 'linear-gradient(150deg,#e7ebf2,#dde2ec)' }}>
                      <div style={{ position: 'absolute', inset: 0, background: 'repeating-linear-gradient(135deg,rgba(26,22,15,.045) 0 9px,transparent 9px 18px)', opacity: 1 }}/>
                      <span style={{ position: 'absolute', top: 10, left: 10, fontFamily: 'var(--font-geist-mono,monospace)', fontSize: 9.5, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase', padding: '4px 8px', borderRadius: 999, backdropFilter: 'blur(4px)', ...(b.status === 'avail' ? { background: 'rgba(47,210,122,.14)', border: '1px solid rgba(47,210,122,.3)', color: '#1a8a5a' } : { background: 'rgba(242,179,75,.14)', border: '1px solid rgba(242,179,75,.3)', color: '#a06b1a' }) }}>
                        {b.status === 'avail' ? 'Available' : 'Booking soon'}
                      </span>
                      <span style={{ position: 'absolute', top: 9, right: 9, width: 28, height: 28, borderRadius: 8, background: 'rgba(255,255,255,.8)', border: '1px solid rgba(26,22,15,.12)', display: 'grid', placeItems: 'center' }}>
                        <Ico n="heart" size={14} color="#756e62"/>
                      </span>
                      <span style={{ position: 'absolute', left: 10, bottom: 8, fontFamily: 'var(--font-geist-mono,monospace)', fontSize: 9, color: 'rgba(26,22,15,.4)', letterSpacing: '.06em' }}>[ board photo ]</span>
                    </div>
                    <div style={{ padding: '12px 13px 14px' }}>
                      <div style={{ fontFamily: 'var(--font-geist-mono,monospace)', fontSize: 9.5, color: '#2f6bff', letterSpacing: '.09em', textTransform: 'uppercase' }}>{b.loc}</div>
                      <h5 style={{ fontFamily: 'var(--font-archivo,sans-serif)', fontWeight: 700, fontSize: 15.5, marginTop: 4, letterSpacing: '-.01em', color: '#1a1712' }}>{b.name}</h5>
                      <div style={{ color: '#756e62', fontSize: 12, marginTop: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
                        {b.spec[0]}<span style={{ width: 3, height: 3, borderRadius: '50%', background: '#a59d8f', display: 'inline-block' }}/>{b.spec[1]}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 11, paddingTop: 11, borderTop: '1px solid rgba(26,22,15,.08)' }}>
                        <b style={{ fontFamily: 'var(--font-archivo,sans-serif)', fontSize: 16, fontWeight: 800, color: '#1a1712' }}>{b.rate}<span style={{ fontSize: 11, color: '#756e62', fontWeight: 500 }}>{b.per}</span></b>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: '#4a443b' }}>
                          <Ico n="star" size={13} color="#f2b34b"/>
                          {b.rating}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ position: 'relative', flex: 1, minHeight: 360, overflow: 'hidden', background: 'linear-gradient(160deg,#eef1f6,#e6eaf1)' }}>
                <CityMapSVG h={360}/>
                {matches.map((b, i) => (
                  <MapPin key={b.name} x={b.x} y={b.y} price={b.rate} tone={b.tone} delay={i * 0.08}/>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════
   AMBITION
═══════════════════════════════════════════════════════════ */

function Ambition() {
  const [ref, inView] = useInView(0.1);
  return (
    <section style={{ padding: '110px 0 120px', overflow: 'hidden', background: '#f6f4ef' }}>
      <div className="lp-wrap">
        <div ref={ref} className={`lp-section-head${inView ? ' lp-in' : ''}`}>
          <span className="lp-eyebrow">The mission</span>
          <h2>Built for the world. <span style={{ color: '#2f6bff' }}>Starting in Nigeria.</span></h2>
          <p>The infrastructure layer for out-of-home advertising — proven in Africa&apos;s biggest market, built to run on every street in the world.</p>
        </div>

        {/* Orbit */}
        <div style={{ position: 'relative', maxWidth: 920, margin: '64px auto 0', aspectRatio: '1000/560' }}>
          <svg viewBox="0 0 1000 560" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
            {/* Rings */}
            <ellipse cx="500" cy="280" rx="110" ry="75" fill="none" stroke="rgba(26,22,15,.06)" strokeWidth="1"/>
            <ellipse cx="500" cy="280" rx="230" ry="158" fill="none" stroke="rgba(26,22,15,.06)" strokeWidth="1"/>
            <ellipse cx="500" cy="280" rx="420" ry="264" fill="none" stroke="rgba(26,22,15,.06)" strokeWidth="1"/>
            {/* Connection lines */}
            {WORLD_CITIES.filter(c => !c.home).map(c => {
              const cx = c.x * 10, cy = c.y * 5.6;
              return (
                <g key={c.name}>
                  <line x1="500" y1="280" x2={cx} y2={cy} stroke="rgba(26,22,15,.10)" strokeWidth="1" fill="none"/>
                  <line x1="500" y1="280" x2={cx} y2={cy} stroke="#2f6bff" strokeWidth="1.6" fill="none"
                    strokeDasharray="2 12" strokeLinecap="round"
                    style={{ animation: 'lp-flow 1.4s linear infinite', animationDelay: `${c.delay}s`, opacity: .85 }}/>
                </g>
              );
            })}
          </svg>

          {/* Ripple pulses */}
          {[0, 1.5, 3].map(d => (
            <div key={d} style={{
              position: 'absolute', left: '50%', top: '50%',
              width: 46, height: 46, borderRadius: '50%',
              border: '1px solid rgba(47,107,255,.28)',
              transform: 'translate(-50%,-50%)',
              animation: `lp-orbpulse 4.5s ease-out ${d}s infinite`,
              pointerEvents: 'none',
            }}/>
          ))}

          {/* City chips */}
          {WORLD_CITIES.map(c => (
            <div key={c.name} style={{
              position: 'absolute',
              left: `${c.x}%`, top: `${c.y}%`,
              transform: 'translate(-50%,-50%)',
              display: 'flex', alignItems: 'center', gap: 8,
              padding: c.home ? '11px 17px' : '7px 12px',
              borderRadius: 999,
              background: c.home ? 'linear-gradient(150deg,#2f6bff,#7b5cff)' : '#fff',
              border: c.home ? 'none' : '1px solid rgba(26,22,15,.14)',
              fontSize: c.home ? 14 : 12.5, fontWeight: 600, whiteSpace: 'nowrap',
              color: c.home ? '#fff' : '#1a1712',
              boxShadow: c.home ? '0 16px 40px -12px rgba(47,107,255,.85)' : '0 18px 44px -26px rgba(26,22,15,.30)',
              zIndex: c.home ? 3 : 1,
              animation: `lp-chipin .6s cubic-bezier(.2,.8,.2,1) ${c.delay}s forwards`,
              opacity: 0,
            }}>
              <span style={{
                width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                background: c.home ? '#fff' : '#5d8cff',
                boxShadow: c.home ? '0 0 0 5px rgba(255,255,255,.22)' : '0 0 0 4px rgba(47,107,255,.16)',
              }}/>
              <span>{c.name}</span>
              {!c.home && <small style={{ color: '#756e62', fontFamily: 'var(--font-geist-mono,monospace)', fontSize: 10 }}>{c.tag}</small>}
              {c.home && <small style={{ color: 'rgba(255,255,255,.75)', fontFamily: 'var(--font-geist-mono,monospace)', fontSize: 10 }}>HQ</small>}
            </div>
          ))}
        </div>

        {/* Footer stats */}
        <div style={{ textAlign: 'center', marginTop: 64, display: 'flex', gap: 38, justifyContent: 'center', flexWrap: 'wrap' }}>
          {[{ v: '12', l: 'Cities live today' }, { v: '3', l: 'Countries in pilot' }, { v: '2030', l: 'On every continent' }].map(({ v, l }) => (
            <div key={l} style={{ textAlign: 'center' }}>
              <b style={{ fontFamily: 'var(--font-archivo,sans-serif)', fontWeight: 800, fontSize: 30, display: 'block', color: '#1a1712' }}>{v}</b>
              <small style={{ color: '#756e62', fontSize: 13 }}>{l}</small>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════
   FEATURES
═══════════════════════════════════════════════════════════ */

function Features() {
  const [ref, inView] = useInView();
  const onMove = useCallback((e: RMouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.setProperty('--mx', `${e.clientX - r.left}px`);
    e.currentTarget.style.setProperty('--my', `${e.clientY - r.top}px`);
  }, []);

  return (
    <section id="features" style={{ padding: '92px 0', background: '#fff' }}>
      <div className="lp-wrap">
        <div ref={ref} className={`lp-section-head${inView ? ' lp-in' : ''}`}>
          <span className="lp-eyebrow">Features</span>
          <h2>Everything OOH needs — nothing it doesn&apos;t</h2>
          <p>The full transaction, end to end. Discover inventory, negotiate deals, verify posting and report on spend — without leaving the platform.</p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 20 }} className="lp-feat-grid">
          {FEATURES_DATA.map(f => (
            <div key={f.title} onMouseMove={onMove} style={{
              position: 'relative', background: '#fff',
              border: '1px solid rgba(26,22,15,.10)',
              borderRadius: 16, padding: '28px 26px 30px', overflow: 'hidden',
              transition: 'transform .2s, border-color .2s',
              boxShadow: '0 1px 0 rgba(26,22,15,.03)',
              cursor: 'default',
              '--mx': '80%', '--my': '0%',
            } as React.CSSProperties}
              onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.transform='translateY(-5px)'; el.style.borderColor=f.tone==='green'?'rgba(47,210,122,.30)':'rgba(47,107,255,.30)'; }}
              onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.transform=''; el.style.borderColor='rgba(26,22,15,.10)'; }}>
              {/* Cursor glow overlay */}
              <div style={{
                position: 'absolute', inset: 0, opacity: 0, transition: 'opacity .3s', pointerEvents: 'none',
                background: `radial-gradient(220px 220px at var(--mx) var(--my), ${f.tone==='green'?'rgba(47,210,122,.12)':'rgba(47,107,255,.12)'}, transparent 65%)`,
              }} className="lp-feat-glow"/>
              <div style={{
                width: 50, height: 50, borderRadius: 13, marginBottom: 20,
                display: 'grid', placeItems: 'center',
                background: 'linear-gradient(150deg,#fff,#faf8f3)',
                border: '1px solid rgba(26,22,15,.14)',
                color: f.tone === 'green' ? '#2fd27a' : '#2f6bff',
                position: 'relative', zIndex: 1,
              }}>
                <Ico n={f.ico} size={23} color={f.tone === 'green' ? '#2fd27a' : '#2f6bff'}/>
              </div>
              <h4 style={{ fontFamily: 'var(--font-archivo,sans-serif)', fontWeight: 700, fontSize: 19, letterSpacing: '-.01em', color: '#1a1712', position: 'relative', zIndex: 1 }}>{f.title}</h4>
              <p style={{ color: '#756e62', fontSize: 14.5, marginTop: 10, position: 'relative', zIndex: 1, lineHeight: 1.55 }}>{f.body}</p>
              <div style={{ marginTop: 16, fontFamily: 'var(--font-geist-mono,monospace)', fontSize: 11, letterSpacing: '.1em', textTransform: 'uppercase', color: f.tone === 'green' ? '#2fd27a' : '#2f6bff', display: 'flex', alignItems: 'center', gap: 7, position: 'relative', zIndex: 1 }}>
                <span style={{ width: 4, height: 4, borderRadius: '50%', background: 'currentColor', display: 'inline-block' }}/>
                {f.tag}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════
   PRICING
═══════════════════════════════════════════════════════════ */

function Pricing() {
  const [ref, inView] = useInView();
  return (
    <section id="pricing" style={{ padding: '92px 0', background: '#f6f4ef' }}>
      <div className="lp-wrap">
        <div ref={ref} className={`lp-section-head${inView ? ' lp-in' : ''}`}>
          <span className="lp-eyebrow">Pricing</span>
          <h2>Simple, transparent pricing</h2>
          <p>We take a 10% commission on completed bookings. No monthly fees, no hidden charges.</p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 20, maxWidth: 980, margin: '0 auto', alignItems: 'stretch' }} className="lp-price-grid">
          {PRICING_DATA.map(plan => {
            const isFeat = plan.featured;
            return (
              <div key={plan.tag} className={isFeat ? 'lp-feat-plan' : undefined} style={{
                background: isFeat ? 'linear-gradient(165deg,#211d16,#14110b)' : '#fff',
                border: isFeat ? '1px solid transparent' : '1px solid rgba(26,22,15,.10)',
                borderRadius: 24, padding: '32px 28px 30px',
                display: 'flex', flexDirection: 'column', position: 'relative',
                boxShadow: isFeat ? '0 34px 70px -28px rgba(26,22,15,.55)' : '0 18px 44px -26px rgba(26,22,15,.28)',
                transform: isFeat ? 'translateY(-12px)' : 'none',
                transition: 'transform .2s',
              }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.transform = isFeat ? 'translateY(-16px)' : 'translateY(-4px)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = isFeat ? 'translateY(-12px)' : 'none'; }}>
                {isFeat && (
                  <div style={{ position: 'absolute', top: -12, left: '50%', transform: 'translateX(-50%)', fontFamily: 'var(--font-geist-mono,monospace)', fontSize: 10.5, fontWeight: 600, letterSpacing: '.12em', textTransform: 'uppercase', background: '#2f6bff', color: '#fff', padding: '5px 13px', borderRadius: 999, boxShadow: '0 8px 20px -8px rgba(47,107,255,.9)', whiteSpace: 'nowrap' }}>
                    {plan.ribbon}
                  </div>
                )}
                <div style={{ fontFamily: 'var(--font-geist-mono,monospace)', fontSize: 11, letterSpacing: '.16em', textTransform: 'uppercase', color: isFeat ? '#5d8cff' : '#756e62', fontWeight: 600 }}>{plan.tag}</div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, margin: '18px 0 4px' }}>
                  <b style={{ fontFamily: 'var(--font-archivo,sans-serif)', fontWeight: 800, fontSize: 48, letterSpacing: '-.03em', color: isFeat ? '#fff' : plan.free ? '#2fd27a' : '#1a1712' }}>{plan.amount}</b>
                  {plan.per && <span style={{ color: isFeat ? 'rgba(255,255,255,.5)' : '#756e62', fontSize: 14 }}>{plan.per}</span>}
                </div>
                <p style={{ color: isFeat ? 'rgba(255,255,255,.6)' : '#756e62', fontSize: 14, minHeight: 40 }}>{plan.desc}</p>
                <ul style={{ listStyle: 'none', margin: '22px 0 26px', display: 'flex', flexDirection: 'column', gap: 13 }}>
                  {plan.feats.map(feat => (
                    <li key={feat} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 14.5, color: isFeat ? 'rgba(255,255,255,.75)' : '#4a443b' }}>
                      <Ico n="check" size={17} color="#2fd27a" sw={2.5}/>
                      {feat}
                    </li>
                  ))}
                </ul>
                <Link href="/signup" style={{
                  display: 'block', textAlign: 'center', marginTop: 'auto',
                  background: isFeat ? '#2f6bff' : 'rgba(47,107,255,.08)',
                  color: isFeat ? '#fff' : '#2f6bff',
                  borderRadius: 12, padding: 11, fontSize: 14.5, fontWeight: 700,
                  textDecoration: 'none',
                  boxShadow: isFeat ? '0 4px 16px rgba(47,107,255,.4)' : 'none',
                  border: isFeat ? 'none' : '1px solid rgba(47,107,255,.20)',
                }}>{plan.cta}</Link>
              </div>
            );
          })}
        </div>

        <p style={{ textAlign: 'center', marginTop: 34, color: '#756e62', fontSize: 14 }}>
          Questions about enterprise volume or agency partnerships?{' '}
          <a href="mailto:hello@oohplatform.ng" style={{ color: '#1a1712', fontWeight: 600, borderBottom: '1px solid rgba(26,22,15,.20)' }}>Talk to our team →</a>
        </p>
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════
   FINAL CTA
═══════════════════════════════════════════════════════════ */

function FinalCTA() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (email.includes('@')) { setSent(true); }
  };

  return (
    <section style={{ padding: '40px 0 100px', background: '#fff' }}>
      <div className="lp-wrap">
        {/* Ink slab */}
        <div className="lp-cta-inner" style={{
          position: 'relative', overflow: 'hidden',
          borderRadius: 24, padding: '70px 56px',
          background: 'linear-gradient(160deg,#211d16 0%,#14110b 70%)',
          textAlign: 'center',
        }}>
          {/* Glow */}
          <div style={{ position: 'absolute', top: '50%', left: '50%', width: 600, height: 400, transform: 'translate(-50%,-50%)', background: 'radial-gradient(circle,rgba(47,107,255,.18),transparent 65%)', pointerEvents: 'none' }}/>

          <div style={{ position: 'relative', zIndex: 2 }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontFamily: 'var(--font-geist-mono,monospace)', fontSize: 11, letterSpacing: '.14em', textTransform: 'uppercase', color: '#5d8cff', background: 'rgba(47,107,255,.12)', border: '1px solid rgba(47,107,255,.25)', padding: '6px 13px', borderRadius: 999, marginBottom: 24 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#2fd27a' }}/>
              Free to start
            </div>

            <h2 style={{ fontFamily: 'var(--font-archivo,sans-serif)', fontWeight: 800, fontSize: 'clamp(30px,4vw,48px)', letterSpacing: '-.025em', lineHeight: 1.02, color: '#fff', marginBottom: 18 }}>
              Start running outdoor advertising<br/>the modern way
            </h2>

            <p style={{ color: 'rgba(255,255,255,.65)', fontSize: 18, maxWidth: 520, margin: '0 auto 32px', lineHeight: 1.55 }}>
              Join the platform connecting Nigeria&apos;s billboard owners, agencies and brands — one transaction at a time.
            </p>

            {sent ? (
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10, background: 'rgba(47,210,122,.14)', border: '1px solid rgba(47,210,122,.3)', color: '#2fd27a', borderRadius: 12, padding: '14px 24px', fontSize: 15, fontWeight: 600 }}>
                <Ico n="check" size={18} color="#2fd27a" sw={2.5}/>
                You&apos;re on the list — we&apos;ll be in touch!
              </div>
            ) : (
              <form onSubmit={handleSubmit} style={{ display: 'flex', gap: 10, maxWidth: 480, margin: '0 auto', flexWrap: 'wrap', justifyContent: 'center' }}>
                <input
                  type="email" value={email} onChange={e => setEmail(e.target.value)}
                  placeholder="Your work email"
                  required
                  style={{ flex: 1, minWidth: 200, background: 'rgba(255,255,255,.07)', border: '1px solid rgba(255,255,255,.16)', borderRadius: 12, padding: '15px 18px', color: '#fff', fontSize: 15, fontFamily: 'inherit', outline: 'none' }}
                />
                <button type="submit" style={{ background: '#2f6bff', color: '#fff', border: 'none', borderRadius: 12, padding: '15px 22px', fontSize: 15, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', boxShadow: '0 8px 22px -8px rgba(47,107,255,.7)', whiteSpace: 'nowrap' }}>
                  Get started →
                </button>
              </form>
            )}

            <p style={{ marginTop: 16, fontSize: 13, color: 'rgba(255,255,255,.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              <Ico n="lock" size={14} color="#2fd27a"/>
              No card required · Free for agencies and brands
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════
   FOOTER
═══════════════════════════════════════════════════════════ */

function Footer() {
  return (
    <footer style={{ borderTop: '1px solid rgba(26,22,15,.10)', padding: '60px 0 40px', background: '#f6f4ef' }}>
      <div className="lp-wrap">
        <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr 1fr 1fr', gap: 40 }} className="lp-foot-grid">
          {/* Brand */}
          <div>
            <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 11, textDecoration: 'none', marginBottom: 16 }}>
              <span style={{ width: 30, height: 30, borderRadius: 8, background: 'linear-gradient(150deg,#2f6bff,#7b5cff)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.9)" strokeWidth="2.5" strokeLinecap="round">
                  <rect x="3" y="4" width="18" height="5" rx="1.5"/><line x1="6" y1="9" x2="6" y2="20"/><line x1="18" y1="9" x2="18" y2="20"/>
                </svg>
              </span>
              <span style={{ fontFamily: 'var(--font-archivo,sans-serif)', fontWeight: 800, fontSize: 17, letterSpacing: '-.01em', color: '#1a1712' }}>OOH</span>
            </Link>
            <p style={{ color: '#756e62', fontSize: 14, maxWidth: 280, lineHeight: 1.6 }}>
              Nigeria&apos;s operating system for out-of-home advertising. List, plan, book and verify — all in one place.
            </p>
          </div>

          {/* Product */}
          <div>
            <h6 style={{ fontFamily: 'var(--font-geist-mono,monospace)', fontSize: 11, letterSpacing: '.14em', textTransform: 'uppercase', color: '#756e62', marginBottom: 16, fontWeight: 600 }}>Product</h6>
            {['Marketplace','For agencies','For board owners','For brands','Pricing'].map(l => (
              <a key={l} href="/signup" style={{ display: 'block', color: '#4a443b', fontSize: 14, marginBottom: 11, textDecoration: 'none', transition: 'color .15s' }}
                onMouseEnter={e => (e.target as HTMLElement).style.color='#1a1712'}
                onMouseLeave={e => (e.target as HTMLElement).style.color='#4a443b'}>{l}</a>
            ))}
          </div>

          {/* Company */}
          <div>
            <h6 style={{ fontFamily: 'var(--font-geist-mono,monospace)', fontSize: 11, letterSpacing: '.14em', textTransform: 'uppercase', color: '#756e62', marginBottom: 16, fontWeight: 600 }}>Company</h6>
            {['About','Careers','Blog','Contact'].map(l => (
              <a key={l} href="/signup" style={{ display: 'block', color: '#4a443b', fontSize: 14, marginBottom: 11, textDecoration: 'none', transition: 'color .15s' }}
                onMouseEnter={e => (e.target as HTMLElement).style.color='#1a1712'}
                onMouseLeave={e => (e.target as HTMLElement).style.color='#4a443b'}>{l}</a>
            ))}
          </div>

          {/* Resources */}
          <div>
            <h6 style={{ fontFamily: 'var(--font-geist-mono,monospace)', fontSize: 11, letterSpacing: '.14em', textTransform: 'uppercase', color: '#756e62', marginBottom: 16, fontWeight: 600 }}>Resources</h6>
            {['OOH rate guide','City profiles','Help center','API docs'].map(l => (
              <a key={l} href="/signup" style={{ display: 'block', color: '#4a443b', fontSize: 14, marginBottom: 11, textDecoration: 'none', transition: 'color .15s' }}
                onMouseEnter={e => (e.target as HTMLElement).style.color='#1a1712'}
                onMouseLeave={e => (e.target as HTMLElement).style.color='#4a443b'}>{l}</a>
            ))}
          </div>
        </div>

        {/* Bottom bar */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 48, paddingTop: 24, borderTop: '1px solid rgba(26,22,15,.10)', color: '#756e62', fontSize: 13, flexWrap: 'wrap', gap: 16 }}>
          <span>© 2026 OOH Platform. Built for Nigerian out-of-home.</span>
          <div style={{ display: 'flex', gap: 10 }}>
            {[
              { n: 'twitter', href: '#' },
              { n: 'linkedin', href: '#' },
              { n: 'instagram', href: '#' },
            ].map(({ n, href }) => (
              <a key={n} href={href} style={{ width: 34, height: 34, borderRadius: 9, border: '1px solid rgba(26,22,15,.10)', display: 'grid', placeItems: 'center', color: '#4a443b', textDecoration: 'none', transition: 'all .15s' }}
                onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.background='rgba(26,22,15,.05)'; el.style.color='#1a1712'; }}
                onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.background=''; el.style.color='#4a443b'; }}>
                <Ico n={n} size={16} color="currentColor"/>
              </a>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}

/* ═══════════════════════════════════════════════════════════
   ROOT
═══════════════════════════════════════════════════════════ */

export default function LandingPage() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  /* Reveal observer */
  useEffect(() => {
    const obs = new IntersectionObserver(
      entries => entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('lp-in'); }),
      { threshold: 0.1, rootMargin: '0px 0px -50px 0px' },
    );
    document.querySelectorAll('.lp-reveal').forEach(el => obs.observe(el));
    return () => obs.disconnect();
  }, []);

  return (
    <div className="ooh-lp">
      <style>{`
        /* ── Layout ── */
        .ooh-lp { font-family: var(--font-hanken,"Hanken Grotesk",system-ui,sans-serif); background:#f6f4ef; color:#1a1712; overflow-x:hidden; line-height:1.55; }
        .lp-wrap { width:100%; max-width:1200px; margin:0 auto; padding-inline:40px; }
        .lp-section-head { text-align:center; max-width:660px; margin:0 auto 56px; opacity:0; transform:translateY(22px); transition:opacity .7s cubic-bezier(.2,.7,.2,1),transform .7s cubic-bezier(.2,.7,.2,1); }
        .lp-section-head.lp-in { opacity:1; transform:none; }
        .lp-eyebrow { font-family:var(--font-geist-mono,monospace); font-size:12px; letter-spacing:.22em; text-transform:uppercase; color:#5d8cff; font-weight:500; }
        .lp-section-head h2 { font-family:var(--font-archivo,sans-serif); font-weight:800; letter-spacing:-.022em; font-size:clamp(30px,4vw,46px); line-height:1.04; margin-top:16px; text-wrap:balance; color:#1a1712; }
        .lp-section-head p { margin-top:18px; color:#756e62; font-size:18px; }

        /* ── Nav links (hidden on mobile) ── */
        .lp-nav-links { display:flex; align-items:center; gap:4px; }
        .lp-nav-desktop { display:inline-flex; }

        /* ── Hero grid ── */
        .lp-hero-grid { display:grid; grid-template-columns:1.04fr 1fr; gap:56px; align-items:center; }

        /* ── Steps grid ── */
        .lp-steps-grid { grid-template-columns:repeat(3,1fr)!important; }

        /* ── Market shell ── */
        .lp-market-shell { grid-template-columns:340px 1fr!important; }
        .lp-results-grid { grid-template-columns:repeat(2,1fr)!important; }

        /* ── Feat grid ── */
        .lp-feat-grid { grid-template-columns:repeat(3,1fr)!important; }
        .lp-feat-grid > div:hover .lp-feat-glow { opacity:1!important; }

        /* ── Pricing grid ── */
        .lp-price-grid { grid-template-columns:repeat(3,1fr)!important; }

        /* ── Footer grid ── */
        .lp-foot-grid { grid-template-columns:1.6fr 1fr 1fr 1fr!important; }

        /* ── Reveal ── */
        .lp-reveal { opacity:0; transform:translateY(22px); transition:opacity .7s cubic-bezier(.2,.7,.2,1),transform .7s cubic-bezier(.2,.7,.2,1); }
        .lp-reveal.lp-in,.lp-in { opacity:1; transform:none; }

        /* ── Float anims (hero visual) ── */
        .lp-float-a { animation:lp-floatA 7s ease-in-out infinite; }
        .lp-float-b { animation:lp-floatB 9s ease-in-out infinite; }
        @keyframes lp-floatA { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-9px)} }
        @keyframes lp-floatB { 0%,100%{transform:translateY(0)} 50%{transform:translateY(7px)} }

        /* ── Map pin drop ── */
        @keyframes lp-pindrop { 0%{opacity:0;transform:translate(-50%,-190%)} 60%{opacity:1} 100%{opacity:1;transform:translate(-50%,-100%)} }

        /* ── Ping pulse ── */
        @keyframes lp-ping { 0%{transform:translate(-50%,2px) scale(.6);opacity:.6} 70%,100%{transform:translate(-50%,2px) scale(3.4);opacity:0} }

        /* ── Blink (live badge) ── */
        @keyframes lp-blink { 50%{opacity:.2} }

        /* ── Ticker ── */
        @keyframes lp-tickin { from{opacity:0;transform:translateY(10px) scale(.96)} to{opacity:1;transform:none} }

        /* ── Marquee ── */
        @keyframes lp-marquee { from{transform:translateX(0)} to{transform:translateX(-50%)} }

        /* ── Orbit flow ── */
        @keyframes lp-flow { to{stroke-dashoffset:-28} }

        /* ── Orbit ripple ── */
        @keyframes lp-orbpulse { 0%{transform:translate(-50%,-50%) scale(.3);opacity:.85} 100%{transform:translate(-50%,-50%) scale(15);opacity:0} }

        /* ── City chip in ── */
        @keyframes lp-chipin { from{opacity:0;transform:translate(-50%,-50%) scale(.7)} to{opacity:1;transform:translate(-50%,-50%) scale(1)} }

        /* ── Shine on primary btn ── */
        @keyframes lp-shine { 0%,55%{left:-130%} 78%,100%{left:170%} }

        /* ── Range thumb ── */
        input[type=range].lp-rng{-webkit-appearance:none;width:100%;height:5px;border-radius:5px;outline:none;cursor:pointer}
        input[type=range].lp-rng::-webkit-slider-thumb{-webkit-appearance:none;width:17px;height:17px;border-radius:50%;background:#2f6bff;border:2px solid #fff;cursor:pointer;box-shadow:0 3px 8px rgba(0,0,0,.2)}

        /* ── Mobile nav ── */
        .lp-hamburger { display:none; flex-direction:column; justify-content:center; gap:5px; padding:8px; background:none; border:none; cursor:pointer; }
        .lp-mob-menu  { display:none; }

        /* ── Responsive 980px ── */
        @media(max-width:980px){
          .lp-hero-grid{grid-template-columns:1fr!important;gap:48px}
          .lp-market-shell{grid-template-columns:1fr!important}
          .lp-market-shell > div:first-child{border-right:none!important;border-bottom:1px solid rgba(26,22,15,.10)}
          .lp-nav-links{display:none!important}
          .lp-nav-desktop{display:none!important}
          .lp-hamburger{display:flex!important}
          .lp-foot-grid{grid-template-columns:1fr 1fr!important;gap:32px}
          .lp-foot-grid > div:first-child{grid-column:1/-1}
        }

        /* ── Responsive 720px ── */
        @media(max-width:720px){
          .lp-wrap{padding-inline:20px}

          /* Hero */
          .lp-hero-grid{gap:32px!important}
          .lp-hero-visual{min-height:280px!important}
          .lp-hero-chips{display:none!important}
          .lp-hero-board{display:none!important}

          /* Stats bar 2×2 */
          .lp-statsbar-grid{grid-template-columns:1fr 1fr!important}
          .lp-statsbar-grid > div:nth-child(odd){border-left:none!important}
          .lp-statsbar-grid > div:nth-child(n+3){border-top:1px solid rgba(26,22,15,.10)!important}

          /* Section heads */
          .lp-section-head{margin-bottom:32px!important}
          .lp-section-head p{font-size:16px!important}

          /* How / Features / Steps */
          .lp-steps-grid{grid-template-columns:1fr!important}
          .lp-feat-grid{grid-template-columns:1fr!important}
          .lp-results-grid{grid-template-columns:1fr!important}

          /* Pricing */
          .lp-price-grid{grid-template-columns:1fr!important;max-width:420px;margin:0 auto}
          .lp-feat-plan{transform:none!important}

          /* CTA box */
          .lp-cta-inner{padding:44px 22px!important}

          /* Footer */
          .lp-foot-grid{grid-template-columns:1fr 1fr!important}

          /* Ambition chips — smaller on tiny screens */
          .lp-city-chip{font-size:11px!important;padding:5px 9px!important}
          .lp-city-chip small{display:none!important}
        }

        /* ── Reduced motion ── */
        @media(prefers-reduced-motion:reduce){
          .lp-float-a,.lp-float-b,.lp-marquee-track,.lp-reveal{animation:none!important;transition:none!important;opacity:1!important;transform:none!important}
          .lp-section-head{opacity:1!important;transform:none!important}
        }

        /* ── Nav ── */
        .lp-nav{
          position:sticky;top:0;z-index:100;
          transition:background .3s,border-color .3s,box-shadow .3s,backdrop-filter .3s;
          border-bottom:1px solid transparent;
        }
        .lp-nav-scrolled{
          background:rgba(246,244,239,0.96);
          backdrop-filter:blur(18px) saturate(140%);
          border-bottom-color:rgba(26,22,15,.10);
          box-shadow:0 6px 20px -16px rgba(26,22,15,0.5);
        }
        @media(prefers-color-scheme:dark){
          .lp-nav-scrolled{
            background:rgba(6,8,15,0.95);
            border-bottom-color:rgba(255,255,255,.07);
            box-shadow:0 6px 20px -16px rgba(0,0,0,0.7);
          }
        }
      `}</style>

      <ScrollProgress/>
      <Nav scrolled={scrolled}/>
      <Hero/>
      <StatsBar/>
      <TrustWall/>
      <HowItWorks/>
      <Marketplace/>
      <Ambition/>
      <Features/>
      <Pricing/>
      <FinalCTA/>
      <Footer/>
    </div>
  );
}
