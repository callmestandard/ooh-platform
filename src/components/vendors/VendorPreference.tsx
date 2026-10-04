'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  VENDOR_PREFERENCE_LABELS, VENDOR_PREFERENCE_STYLE, boardOwnerAccount, fetchPreferenceFor, setVendorPreference,
  type VendorPreference,
} from '@/lib/vendor-preferences';

/** Small marker shown on a board in a shortlist, planner or map view. */
export function VendorPreferencePill({ preference }: { preference?: VendorPreference | null }) {
  if (!preference) return null;
  const s = VENDOR_PREFERENCE_STYLE[preference];
  return (
    <span data-vendor-pill={preference} style={{ display: 'inline-block', fontSize: '0.625rem', fontWeight: 700, padding: '2px 7px', borderRadius: 999, background: s.bg, color: s.color, whiteSpace: 'nowrap' }}>
      {preference === 'preferred' ? '★ ' : ''}{VENDOR_PREFERENCE_LABELS[preference]}
    </span>
  );
}

/**
 * "N owners excluded" reminder for discovery screens, so an agency never
 * forgets it has filtered inventory out. Renders nothing when there are none.
 */
export function ExcludedOwnersNote({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <Link href="/dashboard/agency/media-partners" data-excluded-note={count}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.75rem', fontWeight: 600, color: '#991B1B', background: '#FEF2F2', border: '1px solid #FECACA', padding: '5px 11px', borderRadius: 999, textDecoration: 'none', whiteSpace: 'nowrap' }}>
      {count} owner{count !== 1 ? 's' : ''} excluded · manage
    </Link>
  );
}

/**
 * Quick action on a board: mark its owner preferred / direct / excluded for
 * this agency. Shown to agencies only; renders nothing if the board has no
 * owner account to hold a preference against.
 */
export function VendorPreferenceControl({ boardId, ownerId, onChange }: { boardId: string; ownerId?: string | null; onChange?: (p: VendorPreference | null) => void }) {
  const [owner, setOwner] = useState<string | null>(ownerId ?? null);
  const [value, setValue] = useState<VendorPreference | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const id = ownerId ?? await boardOwnerAccount(boardId);
      const current = id ? await fetchPreferenceFor(id) : null;
      if (cancelled) return;
      setOwner(id); setValue(current); setReady(true);
    })();
    return () => { cancelled = true; };
  }, [boardId, ownerId]);

  if (!ready || !owner) return null;

  async function choose(next: VendorPreference | null) {
    setError(null);
    const { error } = await setVendorPreference(owner!, next);
    if (error) { setError(error); return; }
    setValue(next);
    onChange?.(next);
  }

  return (
    <div data-vendor-control style={{ marginTop: 10 }}>
      <p style={{ fontSize: '0.625rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 6px' }}>This media owner, for your agency</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {(['preferred', 'direct', 'excluded'] as const).map(p => {
          const on = value === p;
          const s = VENDOR_PREFERENCE_STYLE[p];
          return (
            <button key={p} data-pref={p} onClick={() => choose(on ? null : p)}
              style={{ padding: '5px 10px', borderRadius: 999, border: `1px solid ${on ? s.color : '#E2E8F0'}`, background: on ? s.bg : '#fff', color: on ? s.color : '#475569', fontSize: '0.6875rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
              {on ? '✓ ' : ''}{p === 'excluded' ? (on ? 'Excluded' : 'Exclude') : p === 'direct' ? 'Direct relationship' : 'Preferred'}
            </button>
          );
        })}
      </div>
      {value === 'excluded' && <p style={{ fontSize: '0.6875rem', color: '#991B1B', margin: '6px 0 0' }}>This owner&apos;s boards are hidden from your searches and suggestions. Existing bookings are not affected.</p>}
      {error && <p style={{ fontSize: '0.6875rem', color: '#B91C1C', margin: '6px 0 0' }}>{error}</p>}
    </div>
  );
}
