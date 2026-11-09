'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import PhotoCropper from './PhotoCropper';

/**
 * Manage a published board's photos: crop/rotate/replace any of them, remove one,
 * add a new one, or make one the cover (first photo). Saves straight to the board.
 */
export default function BoardPhotosEditor({ boardId, boardName, photos, onChange, onClose }: {
  boardId: string;
  boardName: string;
  photos: string[];
  onChange: (photos: string[]) => void;
  onClose: () => void;
}) {
  const [list, setList] = useState<string[]>(photos);
  const [editing, setEditing] = useState<number | 'new' | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && editing === null) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editing, onClose]);

  async function persist(next: string[]) {
    const { error: err } = await supabase.from('boards').update({ photo_urls: next }).eq('id', boardId);
    if (err) throw err;
    setList(next);
    onChange(next);
  }

  async function savePhoto(blob: Blob) {
    const slot = editing;
    setEditing(null);
    setBusy(true);
    setError('');
    try {
      const path = `boards/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
      const { data: up, error: upErr } = await supabase.storage.from('board-photos').upload(path, blob, { contentType: 'image/jpeg', cacheControl: '3600', upsert: false });
      if (upErr || !up) throw upErr ?? new Error('upload failed');
      const url = supabase.storage.from('board-photos').getPublicUrl(up.path).data.publicUrl;
      const next = slot === 'new' || slot === null ? [...list, url] : list.map((u, i) => (i === slot ? url : u));
      await persist(next);
    } catch {
      setError('Could not save the photo. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  async function run(next: string[]) {
    setBusy(true);
    setError('');
    try { await persist(next); } catch { setError('Could not update the photos. Try again.'); } finally { setBusy(false); setConfirmRemove(null); }
  }

  const btn: React.CSSProperties = { padding: '5px 10px', borderRadius: 6, border: '1px solid #E2E8F0', background: '#fff', color: '#334155', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' };

  return (
    <>
      <div data-board-photos role="dialog" aria-modal="true" aria-label={`Photos: ${boardName}`} onClick={onClose}
        style={{ position: 'fixed', inset: 0, zIndex: 900, background: 'rgba(15,23,42,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
        <div onClick={e => e.stopPropagation()}
          style={{ background: '#fff', borderRadius: 16, width: 'min(760px, 100%)', maxHeight: 'calc(100vh - 32px)', overflow: 'auto', boxShadow: '0 24px 64px rgba(0,0,0,0.3)', fontFamily: "'Inter', sans-serif" }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid #F1F5F9', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
            <div style={{ minWidth: 0 }}>
              <p style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: '#0F172A' }}>Board photos</p>
              <p style={{ margin: '2px 0 0', fontSize: '0.75rem', color: '#64748B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{boardName}</p>
            </div>
            <button type="button" onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', fontSize: 20, color: '#94A3B8', cursor: 'pointer', lineHeight: 1 }}>✕</button>
          </div>

          <div style={{ padding: 20, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 14 }}>
            {list.map((url, i) => (
              <div key={url} data-photo-tile style={{ border: '1px solid #E2E8F0', borderRadius: 10, overflow: 'hidden', background: '#F8FAFC' }}>
                <button type="button" onClick={() => setEditing(i)} disabled={busy} title="Crop, rotate or replace"
                  style={{ padding: 0, border: 'none', background: '#0F172A', cursor: 'pointer', display: 'block', width: '100%', position: 'relative', lineHeight: 0 }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt={`Photo ${i + 1}`} style={{ width: '100%', aspectRatio: '3 / 2', objectFit: 'cover', display: 'block' }} />
                  {i === 0 && <span style={{ position: 'absolute', top: 8, left: 8, background: '#7C3AED', color: '#fff', fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 999, lineHeight: 1.6 }}>Cover</span>}
                </button>
                <div style={{ padding: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {confirmRemove === i ? (
                    <>
                      <span style={{ fontSize: '0.75rem', color: '#B91C1C', alignSelf: 'center', marginRight: 'auto' }}>Remove this photo?</span>
                      <button type="button" style={{ ...btn, background: '#DC2626', borderColor: '#DC2626', color: '#fff' }} disabled={busy} onClick={() => run(list.filter((_, j) => j !== i))}>Remove</button>
                      <button type="button" style={btn} onClick={() => setConfirmRemove(null)}>Keep</button>
                    </>
                  ) : (
                    <>
                      <button type="button" data-edit-photo style={{ ...btn, color: '#6D28D9', borderColor: '#DDD6FE' }} disabled={busy} onClick={() => setEditing(i)}>Edit</button>
                      {i > 0 && <button type="button" style={btn} disabled={busy} onClick={() => run([url, ...list.filter((_, j) => j !== i)])}>Make cover</button>}
                      <button type="button" style={{ ...btn, color: '#DC2626', borderColor: '#FECACA', marginLeft: 'auto' }} disabled={busy} onClick={() => setConfirmRemove(i)}>Remove</button>
                    </>
                  )}
                </div>
              </div>
            ))}
            <button type="button" data-add-photo onClick={() => setEditing('new')} disabled={busy}
              style={{ border: '1.5px dashed #CBD5E1', borderRadius: 10, background: '#F8FAFC', color: '#475569', fontSize: '0.8125rem', fontWeight: 600, cursor: 'pointer', minHeight: 150, fontFamily: 'inherit' }}>
              + Add photo
            </button>
          </div>

          <div style={{ padding: '0 20px 18px', fontSize: '0.75rem', color: error ? '#DC2626' : '#64748B' }}>
            {error || (busy ? 'Saving…' : 'Tap a photo to crop, rotate or replace it. Changes save straight away and buyers see them.')}
          </div>
        </div>
      </div>

      {editing !== null && (
        <PhotoCropper
          src={editing === 'new' ? null : list[editing] ?? null}
          title={boardName}
          onSave={savePhoto}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}
