'use client';

import { useEffect, useRef, useState } from 'react';

export type ReviewItem = {
  id: string;            // the board row
  url: string | null;    // its photo, if any
  title: string;         // board name
  subtitle: string;      // slide number, address, city
  details: string[];     // format, size, rate…
  included: boolean;     // will be published
};

/**
 * Walk through every board's photo before publishing: check it, fix it
 * (crop / rotate / replace), approve it, or leave the board out.
 * Keys: ← → to move, Enter to approve and go on, E to edit.
 */
export default function PhotoReview({ items, approved, startAt = 0, paused, onApprove, onEdit, onToggleInclude, onClose }: {
  items: ReviewItem[];
  approved: Set<string>;
  startAt?: number;
  paused: boolean;       // another dialog (the cropper) is open on top
  onApprove: (id: string) => void;
  onEdit: (item: ReviewItem) => void;
  onToggleInclude: (id: string, include: boolean) => void;
  onClose: () => void;
}) {
  const [i, setI] = useState(Math.min(startAt, Math.max(0, items.length - 1)));
  const strip = useRef<HTMLDivElement>(null);
  const item = items[i];
  const done = items.filter(it => approved.has(it.id)).length;
  const next = () => setI(n => Math.min(items.length - 1, n + 1));
  const prev = () => setI(n => Math.max(0, n - 1));

  function approveAndNext() {
    if (!item) return;
    onApprove(item.id);
    // Go to the next photo not yet checked, else just the next one.
    const after = items.findIndex((it, k) => k > i && !approved.has(it.id) && it.id !== item.id);
    if (after >= 0) setI(after); else if (i < items.length - 1) next();
  }

  useEffect(() => {
    if (paused) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') next();
      else if (e.key === 'ArrowLeft') prev();
      else if (e.key === 'Enter') { e.preventDefault(); approveAndNext(); }
      else if (e.key.toLowerCase() === 'e' && item) onEdit(item);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Keep the current thumbnail in view.
  useEffect(() => {
    strip.current?.querySelector<HTMLElement>(`[data-thumb="${i}"]`)?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  }, [i]);

  if (!item) return null;
  const isApproved = approved.has(item.id);
  const btn: React.CSSProperties = { padding: '9px 14px', borderRadius: 8, border: '1px solid #E2E8F0', background: '#fff', color: '#334155', fontSize: '0.8125rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' };

  return (
    <div data-photo-review role="dialog" aria-modal="true" aria-label="Check the photos"
      style={{ position: 'fixed', inset: 0, zIndex: 950, background: 'rgba(15,23,42,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12 }}>
      <div style={{ background: '#fff', borderRadius: 16, width: 'min(1040px, 100%)', maxHeight: 'calc(100vh - 24px)', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 24px 64px rgba(0,0,0,0.35)', fontFamily: "'Inter', sans-serif" }}>
        {/* Header: progress */}
        <div style={{ padding: '14px 18px', borderBottom: '1px solid #F1F5F9', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: '#0F172A' }}>
              Check the photos <span style={{ fontWeight: 500, color: '#64748B', fontSize: '0.875rem' }}>· {i + 1} of {items.length}</span>
            </p>
            <div style={{ marginTop: 6, height: 5, background: '#F1F5F9', borderRadius: 999, overflow: 'hidden', maxWidth: 320 }}>
              <div data-review-progress style={{ width: `${(done / items.length) * 100}%`, height: '100%', background: '#10B981', transition: 'width .2s' }} />
            </div>
            <p style={{ margin: '4px 0 0', fontSize: '0.6875rem', color: '#64748B' }}>{done} of {items.length} checked</p>
          </div>
          <button type="button" onClick={onClose} style={{ ...btn, padding: '7px 12px' }}>Done</button>
        </div>

        {/* Photo */}
        <div style={{ position: 'relative', background: '#0F172A', flex: '1 1 auto', minHeight: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
          {item.url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img data-review-photo src={item.url} alt={item.title} style={{ maxWidth: '100%', maxHeight: '52vh', display: 'block', objectFit: 'contain', opacity: item.included ? 1 : 0.35 }} />
          ) : (
            <div style={{ color: '#CBD5E1', fontSize: '0.875rem', padding: '4rem 1rem', textAlign: 'center' }}>
              No photo for this board.<br />
              <button type="button" onClick={() => onEdit(item)} style={{ ...btn, marginTop: 12 }}>+ Add a photo</button>
            </div>
          )}
          {isApproved && (
            <span style={{ position: 'absolute', top: 12, left: 12, background: '#10B981', color: '#fff', fontSize: 12, fontWeight: 700, padding: '4px 10px', borderRadius: 999 }}>✓ Checked</span>
          )}
          {!item.included && (
            <span style={{ position: 'absolute', top: 12, right: 12, background: '#DC2626', color: '#fff', fontSize: 12, fontWeight: 700, padding: '4px 10px', borderRadius: 999 }}>Left out</span>
          )}
          <button type="button" aria-label="Previous photo" onClick={prev} disabled={i === 0}
            style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', width: 40, height: 40, borderRadius: '50%', border: 'none', background: 'rgba(255,255,255,0.9)', fontSize: 18, cursor: i === 0 ? 'default' : 'pointer', opacity: i === 0 ? 0.3 : 1 }}>‹</button>
          <button type="button" aria-label="Next photo" onClick={next} disabled={i === items.length - 1}
            style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', width: 40, height: 40, borderRadius: '50%', border: 'none', background: 'rgba(255,255,255,0.9)', fontSize: 18, cursor: i === items.length - 1 ? 'default' : 'pointer', opacity: i === items.length - 1 ? 0.3 : 1 }}>›</button>
        </div>

        {/* Board details + actions */}
        <div style={{ padding: '12px 18px', borderTop: '1px solid #F1F5F9' }}>
          <p data-review-title style={{ margin: 0, fontSize: '0.9375rem', fontWeight: 700, color: '#0F172A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.title || 'Untitled board'}</p>
          <p style={{ margin: '2px 0 0', fontSize: '0.75rem', color: '#64748B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.subtitle}</p>
          {item.details.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
              {item.details.map(d => <span key={d} style={{ fontSize: '0.6875rem', fontWeight: 600, color: '#475569', background: '#F1F5F9', padding: '2px 8px', borderRadius: 999 }}>{d}</span>)}
            </div>
          )}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12, alignItems: 'center' }}>
            <button type="button" data-review-edit style={{ ...btn, color: '#6D28D9', borderColor: '#DDD6FE' }} onClick={() => onEdit(item)}>
              {item.url ? '✂ Crop, rotate or replace' : '+ Add photo'}
            </button>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8125rem', color: '#334155', cursor: 'pointer' }}>
              <input type="checkbox" checked={item.included} onChange={e => onToggleInclude(item.id, e.target.checked)} />
              Publish this board
            </label>
            <span style={{ flex: 1 }} />
            <button type="button" data-review-approve onClick={approveAndNext}
              style={{ ...btn, background: '#10B981', borderColor: '#10B981', color: '#fff' }}>
              {isApproved ? '✓ Checked · next' : 'Looks good → next'}
            </button>
          </div>
        </div>

        {/* Thumbnails */}
        <div ref={strip} style={{ display: 'flex', gap: 6, padding: '10px 18px 14px', overflowX: 'auto', borderTop: '1px solid #F1F5F9', background: '#F8FAFC' }}>
          {items.map((it, k) => (
            <button key={it.id} type="button" data-thumb={k} onClick={() => setI(k)} title={it.title}
              style={{ position: 'relative', flexShrink: 0, width: 72, height: 48, padding: 0, borderRadius: 6, overflow: 'hidden', cursor: 'pointer', background: '#E2E8F0',
                border: k === i ? '2px solid #7C3AED' : '2px solid transparent', opacity: it.included ? 1 : 0.4 }}>
              {it.url
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={it.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                : <span style={{ fontSize: 10, color: '#64748B' }}>No photo</span>}
              {approved.has(it.id) && (
                <span style={{ position: 'absolute', right: 3, bottom: 3, width: 16, height: 16, borderRadius: '50%', background: '#10B981', color: '#fff', fontSize: 10, lineHeight: '16px', textAlign: 'center', fontWeight: 700 }}>✓</span>
              )}
            </button>
          ))}
        </div>
        <p style={{ margin: 0, padding: '0 18px 12px', fontSize: '0.6875rem', color: '#94A3B8', background: '#F8FAFC' }} className="review-keys">
          Keyboard: ← → to move · Enter = looks good · E = edit
        </p>
      </div>
    </div>
  );
}
