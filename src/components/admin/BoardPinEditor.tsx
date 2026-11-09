'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import LocationPinPickerLoader from '@/app/dashboard/owner/post-board/LocationPinPickerLoader';
import LocationSearch from '@/app/dashboard/owner/post-board/LocationSearch';

/**
 * Move a published board's map pin: search a place or GPS, click the map,
 * or drag the pin. Saves straight to the board.
 */
export default function BoardPinEditor({ board, onSaved, onClose }: {
  board: { id: string; name: string; address: string | null; city: string | null; latitude: number | null; longitude: number | null };
  onSaved: (lat: number | null, lng: number | null) => void;
  onClose: () => void;
}) {
  const [lat, setLat] = useState<number | null>(board.latitude);
  const [lng, setLng] = useState<number | null>(board.longitude);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const changed = lat !== board.latitude || lng !== board.longitude;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function save() {
    setSaving(true);
    setError('');
    const { error: err } = await supabase.from('boards').update({ latitude: lat, longitude: lng }).eq('id', board.id);
    setSaving(false);
    if (err) { setError('Could not save the pin. Try again.'); return; }
    onSaved(lat, lng);
  }

  const btn: React.CSSProperties = { padding: '8px 14px', borderRadius: 8, border: '1px solid #E2E8F0', background: '#fff', color: '#334155', fontSize: '0.8125rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' };

  return (
    <div data-pin-editor role="dialog" aria-modal="true" aria-label={`Move pin: ${board.name}`} onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 900, background: 'rgba(15,23,42,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: '#fff', borderRadius: 16, width: 'min(760px, 100%)', maxHeight: 'calc(100vh - 32px)', overflow: 'auto', boxShadow: '0 24px 64px rgba(0,0,0,0.3)', fontFamily: "'Inter', sans-serif" }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #F1F5F9', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: '#0F172A' }}>Move the map pin</p>
            <p style={{ margin: '2px 0 0', fontSize: '0.75rem', color: '#64748B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {board.name}{board.address && board.address !== board.name ? ` · ${board.address}` : ''}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', fontSize: 20, color: '#94A3B8', cursor: 'pointer', lineHeight: 1 }}>✕</button>
        </div>

        <div style={{ padding: '16px 20px 0' }}>
          <LocationSearch city={board.city ?? undefined} onPick={({ lat: la, lng: lo }) => { setLat(la); setLng(lo); }} />
        </div>
        <div style={{ padding: '12px 20px 0' }}>
          <LocationPinPickerLoader
            lat={lat}
            lng={lng}
            city={board.city ?? ''}
            onChange={(la, lo) => { setLat(la); setLng(lo); }}
            onClear={() => { setLat(null); setLng(null); }}
          />
          <p data-pin-coords style={{ margin: '8px 0 0', fontSize: '0.75rem', color: '#64748B' }}>
            {lat !== null && lng !== null
              ? <>Pin at <span style={{ fontFamily: 'monospace', color: '#0F172A' }}>{lat.toFixed(6)}, {lng.toFixed(6)}</span>. Search above, tap the map, or drag the pin.</>
              : 'No pin yet. Search above or tap the map where the board stands.'}
          </p>
        </div>

        {error && <p style={{ margin: '10px 20px 0', fontSize: '0.8125rem', color: '#DC2626' }}>{error}</p>}
        <div style={{ padding: '16px 20px 18px', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button type="button" style={btn} onClick={onClose}>Cancel</button>
          <button type="button" data-save-pin disabled={!changed || saving} onClick={save}
            style={{ ...btn, background: '#7C3AED', borderColor: '#7C3AED', color: '#fff', opacity: !changed || saving ? 0.5 : 1, cursor: !changed || saving ? 'default' : 'pointer' }}>
            {saving ? 'Saving…' : 'Save pin'}
          </button>
        </div>
      </div>
    </div>
  );
}
