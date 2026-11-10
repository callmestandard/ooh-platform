'use client';

import { createPortal } from 'react-dom';
import { useEffect, useRef, useState } from 'react';

type Box = { x: number; y: number; w: number; h: number }; // fractions of the image, 0–1
type Drag = { mode: 'move' | 'nw' | 'ne' | 'sw' | 'se'; startX: number; startY: number; box: Box };

const FULL: Box = { x: 0, y: 0, w: 1, h: 1 };
const MIN = 0.06;
const OUT_MAX_PX = 1600;

async function loadImage(src: string): Promise<HTMLImageElement> {
  const img = new Image();
  // Stored photos come from another host; without this the canvas can't be saved.
  if (!src.startsWith('blob:') && !src.startsWith('data:')) img.crossOrigin = 'anonymous';
  img.src = src;
  await img.decode();
  return img;
}

function toBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((res, rej) => canvas.toBlob(b => (b ? res(b) : rej(new Error('Could not save the photo'))), 'image/jpeg', 0.88));
}

/**
 * Crop, rotate or replace a board photo so the board is properly in frame.
 * Works with a mouse or a finger. Saves a JPEG of at most 1600px.
 */
export default function PhotoCropper({ src, title, onSave, onRemove, onClose }: {
  src: string | null;
  title: string;
  onSave: (blob: Blob) => void;
  onRemove?: () => void;
  onClose: () => void;
}) {
  const [imgSrc, setImgSrc] = useState<string | null>(src);
  const [box, setBox] = useState<Box>(FULL);
  const [rotation, setRotation] = useState(0); // 0, 90, 180, 270
  const [rotated, setRotated] = useState<{ src: string; rotation: number; url: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const frame = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const madeUrls = useRef<string[]>([]);

  // The image shown is the source turned by `rotation`, so cropping always works on what you see.
  const preview = !imgSrc ? null
    : rotation === 0 ? imgSrc
    : rotated && rotated.src === imgSrc && rotated.rotation === rotation ? rotated.url
    : null;

  useEffect(() => {
    let cancelled = false;
    if (!imgSrc || rotation === 0) return;
    (async () => {
      const img = await loadImage(imgSrc);
      const c = document.createElement('canvas');
      const side = rotation % 180 !== 0;
      c.width = side ? img.naturalHeight : img.naturalWidth;
      c.height = side ? img.naturalWidth : img.naturalHeight;
      const ctx = c.getContext('2d')!;
      ctx.translate(c.width / 2, c.height / 2);
      ctx.rotate((rotation * Math.PI) / 180);
      ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
      const url = URL.createObjectURL(await toBlob(c));
      madeUrls.current.push(url);
      if (!cancelled) setRotated({ src: imgSrc, rotation, url });
    })().catch(() => setError('Could not rotate this photo'));
    return () => { cancelled = true; };
  }, [imgSrc, rotation]);

  useEffect(() => () => { madeUrls.current.forEach(u => URL.revokeObjectURL(u)); }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function start(mode: Drag['mode'], e: React.PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    drag.current = { mode, startX: e.clientX, startY: e.clientY, box };
  }

  function move(e: React.PointerEvent) {
    const d = drag.current;
    const el = frame.current;
    if (!d || !el) return;
    const r = el.getBoundingClientRect();
    const dx = (e.clientX - d.startX) / r.width;
    const dy = (e.clientY - d.startY) / r.height;
    let { x, y, w, h } = d.box;
    if (d.mode === 'move') {
      x = Math.min(Math.max(0, x + dx), 1 - w);
      y = Math.min(Math.max(0, y + dy), 1 - h);
    } else {
      const right = x + w, bottom = y + h;
      if (d.mode.includes('w')) { x = Math.min(Math.max(0, x + dx), right - MIN); w = right - x; }
      if (d.mode.includes('e')) { w = Math.min(Math.max(MIN, w + dx), 1 - x); }
      if (d.mode.includes('n')) { y = Math.min(Math.max(0, y + dy), bottom - MIN); h = bottom - y; }
      if (d.mode.includes('s')) { h = Math.min(Math.max(MIN, h + dy), 1 - y); }
    }
    setBox({ x, y, w, h });
  }

  function end() { drag.current = null; }

  function replace(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith('image/')) { setError('Choose a photo (JPG, PNG or WEBP)'); return; }
    const url = URL.createObjectURL(file);
    madeUrls.current.push(url);
    setError('');
    setRotation(0);
    setBox(FULL);
    setImgSrc(url);
  }

  async function save() {
    if (!preview) return;
    setSaving(true);
    setError('');
    try {
      const img = await loadImage(preview);
      const sx = Math.round(box.x * img.naturalWidth), sy = Math.round(box.y * img.naturalHeight);
      const sw = Math.max(1, Math.round(box.w * img.naturalWidth)), sh = Math.max(1, Math.round(box.h * img.naturalHeight));
      const scale = Math.min(1, OUT_MAX_PX / Math.max(sw, sh));
      const c = document.createElement('canvas');
      c.width = Math.round(sw * scale);
      c.height = Math.round(sh * scale);
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
      onSave(await toBlob(c));
    } catch {
      setError('Could not save the photo. Try again.');
      setSaving(false);
    }
  }

  const handle = (pos: 'nw' | 'ne' | 'sw' | 'se'): React.CSSProperties => ({
    position: 'absolute', width: 22, height: 22, background: '#fff', border: '2px solid #7C3AED', borderRadius: 6,
    touchAction: 'none', cursor: pos === 'nw' || pos === 'se' ? 'nwse-resize' : 'nesw-resize',
    ...(pos.includes('n') ? { top: -11 } : { bottom: -11 }),
    ...(pos.includes('w') ? { left: -11 } : { right: -11 }),
  });
  const btn: React.CSSProperties = { padding: '8px 14px', borderRadius: 8, border: '1px solid #E2E8F0', background: '#fff', color: '#334155', fontSize: '0.8125rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' };
  const cropped = box.x > 0.001 || box.y > 0.001 || box.w < 0.999 || box.h < 0.999;

  // Rendered on <body> so the dashboard's layers (e.g. the mobile top bar) can't cover it.
  return createPortal((
    <div data-photo-cropper role="dialog" aria-modal="true" aria-label={`Edit photo: ${title}`}
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(15,23,42,0.72)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: '#fff', borderRadius: 16, width: 'min(920px, 100%)', maxHeight: 'calc(100vh - 32px)', overflow: 'auto', boxShadow: '0 24px 64px rgba(0,0,0,0.3)', fontFamily: "'Inter', sans-serif" }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #F1F5F9', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: '#0F172A' }}>Frame the board</p>
            <p style={{ margin: '2px 0 0', fontSize: '0.75rem', color: '#64748B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', fontSize: 20, color: '#94A3B8', cursor: 'pointer', lineHeight: 1 }}>✕</button>
        </div>

        <div style={{ padding: 20, background: '#0F172A', display: 'flex', justifyContent: 'center' }}>
          {preview ? (
            <div ref={frame} onPointerMove={move} onPointerUp={end} onPointerCancel={end}
              style={{ position: 'relative', display: 'inline-block', lineHeight: 0, touchAction: 'none', userSelect: 'none' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={preview} alt="" draggable={false} crossOrigin={preview.startsWith('blob:') ? undefined : 'anonymous'} style={{ maxWidth: '100%', maxHeight: '58vh', display: 'block' }} />
              {/* Shade outside the crop box */}
              <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', background: 'rgba(0,0,0,0.55)', clipPath: `polygon(0 0, 100% 0, 100% 100%, 0 100%, 0 ${box.y * 100}%, ${box.x * 100}% ${box.y * 100}%, ${box.x * 100}% ${(box.y + box.h) * 100}%, ${(box.x + box.w) * 100}% ${(box.y + box.h) * 100}%, ${(box.x + box.w) * 100}% ${box.y * 100}%, 0 ${box.y * 100}%)` }} />
              <div data-crop-box onPointerDown={e => start('move', e)}
                style={{ position: 'absolute', left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.w * 100}%`, height: `${box.h * 100}%`, border: '2px solid #fff', boxShadow: '0 0 0 1px rgba(124,58,237,0.9)', cursor: 'move', touchAction: 'none',
                  backgroundImage: 'linear-gradient(rgba(255,255,255,0.35) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.35) 1px, transparent 1px)', backgroundSize: '33.33% 33.33%', backgroundPosition: '-1px -1px' }}>
                {(['nw', 'ne', 'sw', 'se'] as const).map(pos => (
                  <span key={pos} data-handle={pos} onPointerDown={e => start(pos, e)} style={handle(pos)} />
                ))}
              </div>
            </div>
          ) : (
            <div style={{ color: '#CBD5E1', fontSize: '0.875rem', padding: '3rem 1rem', textAlign: 'center', lineHeight: 1.6 }}>
              {imgSrc ? 'Rotating…' : <>No photo for this board yet.<br />Choose one with “Replace photo”.</>}
            </div>
          )}
        </div>

        <div style={{ padding: '14px 20px', display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', borderBottom: '1px solid #F1F5F9' }}>
          <button type="button" style={btn} disabled={!preview} onClick={() => { setRotation(r => (r + 90) % 360); setBox(FULL); }}>↻ Rotate</button>
          <button type="button" style={{ ...btn, opacity: cropped ? 1 : 0.5 }} disabled={!cropped} onClick={() => setBox(FULL)}>Reset crop</button>
          <button type="button" style={btn} onClick={() => fileRef.current?.click()}>Replace photo</button>
          <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={e => { replace(e.target.files?.[0]); e.target.value = ''; }} />
          {onRemove && src && (
            <button type="button" style={{ ...btn, color: '#DC2626', borderColor: '#FECACA' }} onClick={onRemove}>Remove photo</button>
          )}
          <span style={{ fontSize: '0.75rem', color: '#64748B', flexBasis: '100%' }}>Drag the box or its corners so only the board shows.</span>
        </div>

        {error && <p style={{ margin: '10px 20px 0', fontSize: '0.8125rem', color: '#DC2626' }}>{error}</p>}
        <div style={{ padding: '14px 20px 18px', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button type="button" style={btn} onClick={onClose}>Cancel</button>
          <button type="button" data-save-photo disabled={!preview || saving} onClick={save}
            style={{ ...btn, background: '#7C3AED', borderColor: '#7C3AED', color: '#fff', opacity: !preview || saving ? 0.6 : 1 }}>
            {saving ? 'Saving…' : 'Save photo'}
          </button>
        </div>
      </div>
    </div>
  ), document.body);
}
