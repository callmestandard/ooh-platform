import Link from 'next/link';
import type { ReactNode } from 'react';
import AccountNavButtons from '@/components/layout/AccountNavButtons';

// The one brand mark and the one header for every public page, so the
// site reads as a single product.

export function OOHLogo({ height = 28 }: { height?: number }) {
  return (
    <svg width={(height * 160) / 36} height={height} viewBox="0 0 160 36" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="OOH Platform">
      <rect x="0" y="2" width="28" height="18" rx="2" fill="#1B4F8A" />
      <rect x="3" y="5" width="22" height="12" rx="1.5" fill="#fff" />
      <rect x="10" y="20" width="2.5" height="6" fill="#1B4F8A" />
      <rect x="15.5" y="20" width="2.5" height="6" fill="#1B4F8A" />
      <rect x="34" y="6" width="24" height="16" rx="2" fill="#1B4F8A" />
      <rect x="37" y="9" width="18" height="10" rx="1.5" fill="#fff" />
      <rect x="42" y="22" width="2.5" height="6" fill="#1B4F8A" />
      <rect x="47.5" y="22" width="2.5" height="6" fill="#1B4F8A" />
      <rect x="64" y="2" width="4" height="28" rx="2" fill="#1B4F8A" />
      <rect x="80" y="2" width="4" height="28" rx="2" fill="#1B4F8A" />
      <rect x="64" y="13" width="20" height="4" rx="1" fill="#1B4F8A" />
      <circle cx="88" cy="4" r="3" fill="#F59E0B" />
      <text x="98" y="20" fontFamily="Georgia, serif" fontSize="18" fontWeight="700" fill="#0F172A" letterSpacing="-0.5">OOH</text>
      <text x="99" y="30" fontFamily="Arial, sans-serif" fontSize="6.5" fontWeight="400" fill="#94A3B8" letterSpacing="3">PLATFORM</text>
    </svg>
  );
}

const LINKS: { key: string; label: string; href: string }[] = [
  { key: 'boards', label: 'Boards', href: '/marketplace' },
  { key: 'cities', label: 'Cities', href: '/billboards' },
  { key: 'prices', label: 'Prices', href: '/#prices' },
  { key: 'owners', label: 'For media owners', href: '/signup?role=owner' },
];

export default function SiteHeader({ active, right, zIndex = 100 }: {
  /** Which link to highlight. */
  active?: 'boards' | 'cities' | 'prices';
  /** Replaces the Sign in / Get started buttons. */
  right?: ReactNode;
  zIndex?: number;
}) {
  return (
    <header className="site-head" style={{ zIndex }}>
      <style>{`
        .site-head { position: sticky; top: 0; background: rgba(255,255,255,0.94); -webkit-backdrop-filter: blur(12px); backdrop-filter: blur(12px); border-bottom: 1px solid #E8EDF2; font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; }
        .site-head-in { height: 60px; padding: 0 24px; display: flex; align-items: center; justify-content: space-between; gap: 12px; }
        .site-head-left { display: flex; align-items: center; gap: 32px; min-width: 0; }
        .site-head-logo { display: flex; flex-shrink: 0; }
        .site-head-links { display: flex; gap: 22px; }
        .site-head-links a { color: #475569; font-size: 0.875rem; font-weight: 500; text-decoration: none; white-space: nowrap; transition: color .12s; }
        .site-head-links a:hover, .site-head-links a[data-on="true"] { color: #1B4F8A; }
        .site-head-links a[data-on="true"] { font-weight: 600; }
        .site-head-right { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
        @media (max-width: 860px) { .site-head-links { display: none; } }
        @media (max-width: 480px) {
          .site-head-in { padding: 0 16px; }
          .site-head-right a, .site-head-right button { padding-left: 12px !important; padding-right: 12px !important; }
        }
        @media print { .site-head { display: none; } }
      `}</style>
      <div className="site-head-in">
        <div className="site-head-left">
          <Link href="/" className="site-head-logo" aria-label="OOH Platform home"><OOHLogo /></Link>
          <nav className="site-head-links" aria-label="Main">
            {LINKS.map(l => (
              <Link key={l.key} href={l.href} data-on={active === l.key}>{l.label}</Link>
            ))}
          </nav>
        </div>
        <div className="site-head-right">{right ?? <AccountNavButtons />}</div>
      </div>
    </header>
  );
}
