'use client';

import Link from 'next/link';
import { useShortlist } from '@/lib/shortlist';

/**
 * Floating "Shortlist (n)" pill, bottom-left (the team WhatsApp button sits
 * bottom-right). Hidden while the shortlist is empty.
 */
export default function ShortlistTray({ bottom = 20, mobileBottom }: { bottom?: number; mobileBottom?: number }) {
  const ids = useShortlist();
  if (ids.length === 0) return null;
  return (
    <>
      <style>{`
        .sl-tray { position: fixed; left: 20px; z-index: 900; display: flex; align-items: center; gap: 10px; text-decoration: none;
          background: rgba(15,23,42,.94); color: #fff; border-radius: 999px; padding: 8px 16px 8px 8px; bottom: var(--sl-bottom);
          font: 600 14px/1 'Inter', system-ui, sans-serif; box-shadow: 0 14px 34px -10px rgba(15,23,42,.55);
          backdrop-filter: blur(16px) saturate(180%); -webkit-backdrop-filter: blur(16px) saturate(180%);
          animation: slTrayIn .3s cubic-bezier(.2,.9,.3,1.15); transition: transform .15s; }
        .sl-tray:hover { transform: translateY(-2px); }
        .sl-tray-count { display: inline-flex; align-items: center; justify-content: center; min-width: 30px; height: 30px; padding: 0 8px; border-radius: 999px; background: #E11D48; font-size: 13px; font-weight: 700; }
        .sl-tray-arrow { color: #94A3B8; font-weight: 500; }
        @keyframes slTrayIn { from { opacity: 0; transform: translateY(12px) scale(.96); } to { opacity: 1; transform: none; } }
        @media (max-width: 900px) { .sl-tray { bottom: var(--sl-bottom-m, var(--sl-bottom)); left: 14px; } }
        @media print { .sl-tray { display: none; } }
      `}</style>
      <Link href="/shortlist" className="sl-tray" data-shortlist-tray
        style={{ '--sl-bottom': `${bottom}px`, ...(mobileBottom != null ? { '--sl-bottom-m': `${mobileBottom}px` } : {}) } as React.CSSProperties}>
        <span className="sl-tray-count">{ids.length}</span>
        <span>Shortlist</span>
        <span className="sl-tray-arrow" aria-hidden="true">→</span>
      </Link>
    </>
  );
}
