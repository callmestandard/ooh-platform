'use client';

import { useState } from 'react';
import { useShortlist, toggleShortlist, SHORTLIST_MAX } from '@/lib/shortlist';
import { track } from '@/lib/track';

/**
 * Save a board to the shortlist. `icon` sits on a card photo; `pill` is a
 * labelled button for detail pages.
 */
export default function SaveButton({ boardId, variant = 'icon', name }: { boardId: string; variant?: 'icon' | 'pill'; name?: string }) {
  const saved = useShortlist().includes(boardId);
  const [full, setFull] = useState(false);
  const label = saved ? `Remove ${name ?? 'board'} from shortlist` : `Save ${name ?? 'board'} to shortlist`;

  function onClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const ok = toggleShortlist(boardId);
    if (ok && !saved) track('shortlist_add', boardId);
    setFull(!ok);
    if (!ok) setTimeout(() => setFull(false), 2500);
  }

  const heart = (
    <svg width={variant === 'icon' ? 17 : 16} height={variant === 'icon' ? 17 : 16} viewBox="0 0 24 24" aria-hidden="true"
      fill={saved ? '#E11D48' : 'none'} stroke={saved ? '#E11D48' : 'currentColor'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z" />
    </svg>
  );

  return (
    <>
      <style>{`
        .sl-save { display: inline-flex; align-items: center; justify-content: center; gap: 6px; border: none; cursor: pointer; font-family: inherit; transition: transform .12s, background .15s, box-shadow .15s; }
        .sl-save:active { transform: scale(.92); }
        .sl-save.is-icon { width: 36px; height: 36px; border-radius: 50%; background: rgba(255,255,255,.94); color: #334155; box-shadow: 0 2px 10px rgba(15,23,42,.18); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); }
        .sl-save.is-icon:hover { background: #fff; transform: scale(1.06); }
        .sl-save.is-pill { height: 40px; padding: 0 14px; border-radius: 10px; background: #fff; color: #0F172A; border: 1.5px solid #E2E8F0; font-size: .875rem; font-weight: 600; }
        .sl-save.is-pill:hover { border-color: #CBD5E1; background: #F8FAFC; }
        .sl-save.is-pill.is-saved { border-color: #FECDD3; background: #FFF1F2; color: #9F1239; }
        @keyframes slPop { 0% { transform: scale(1); } 40% { transform: scale(1.25); } 100% { transform: scale(1); } }
        .sl-save.is-saved svg { animation: slPop .3s ease; }
        .sl-full { position: absolute; z-index: 5; white-space: nowrap; font-size: 12px; font-weight: 600; color: #fff; background: #0F172A; padding: 5px 9px; border-radius: 8px; margin-top: 6px; }
      `}</style>
      <span style={{ position: 'relative', display: 'inline-flex' }}>
        <button type="button" className={`sl-save is-${variant}${saved ? ' is-saved' : ''}`} onClick={onClick}
          aria-pressed={saved} aria-label={label} title={saved ? 'Saved to your shortlist' : 'Save to shortlist'} data-save-board>
          {heart}
          {variant === 'pill' && <span>{saved ? 'Saved' : 'Save'}</span>}
        </button>
        {full && <span className="sl-full" role="status" style={{ top: '100%', right: 0 }}>Shortlist is full ({SHORTLIST_MAX})</span>}
      </span>
    </>
  );
}
