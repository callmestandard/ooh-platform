'use client';

import { createPortal } from 'react-dom';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

const FORMATS: [string, string][] = [
  ['billboard', 'Billboard'], ['unipole', 'Unipole'], ['gantry', 'Gantry'],
  ['led', 'LED / Digital'], ['bridge_panel', 'Bridge Panel'], ['wall_drape', 'Wall Drape'],
];

type Details = {
  name: string; notes: string; address: string; area: string; city: string; state: string;
  format: string; width: string; height: string; illuminated: '' | 'yes' | 'no'; face_count: string;
  contact_name: string; contact_phone: string; rate: string;
};

export type SavedDetails = {
  name: string; address: string | null; area: string | null; city: string | null; state: string | null;
  format: string; illuminated: boolean | null; face_count: number | null; asking_rate: number | null;
};

const toStr = (v: unknown) => (v == null ? '' : String(v));
const numOrNull = (s: string) => { const n = parseFloat(s.replace(/,/g, '')); return Number.isFinite(n) && n > 0 ? n : null; };

/**
 * Fix a published board's details: name, description, address and area,
 * city and state, type, size, lighting, faces, rate and sales contact.
 * The map pin has its own editor (Move pin).
 */
export default function BoardDetailsEditor({ boardId, currentRate, onSaved, onClose }: {
  boardId: string;
  currentRate: number | null;
  onSaved: (d: SavedDetails) => void;
  onClose: () => void;
}) {
  const [d, setD] = useState<Details | null>(null);
  const [orig, setOrig] = useState<Details | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error: err } = await supabase.from('boards')
        .select('name, notes, address, area, city, state, format, width, height, illuminated, face_count, contact_name, contact_phone')
        .eq('id', boardId).single();
      if (cancelled) return;
      if (err || !data) { setError('Could not load this board.'); return; }
      const loaded: Details = {
        name: toStr(data.name), notes: toStr(data.notes), address: toStr(data.address), area: toStr(data.area),
        city: toStr(data.city), state: toStr(data.state), format: toStr(data.format) === 'digital' ? 'led' : toStr(data.format),
        width: toStr(data.width), height: toStr(data.height),
        illuminated: data.illuminated == null ? '' : data.illuminated ? 'yes' : 'no',
        face_count: toStr(data.face_count), contact_name: toStr(data.contact_name), contact_phone: toStr(data.contact_phone),
        rate: currentRate ? String(currentRate) : '',
      };
      setD(loaded);
      setOrig(loaded);
    })();
    return () => { cancelled = true; };
  }, [boardId, currentRate]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const set = (k: keyof Details) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setD(prev => (prev ? { ...prev, [k]: e.target.value } : prev));
  const changed = !!d && !!orig && JSON.stringify(d) !== JSON.stringify(orig);

  async function save() {
    if (!d) return;
    if (!d.name.trim()) { setError('The board needs a name.'); return; }
    if (!d.city.trim()) { setError('The board needs a city.'); return; }
    setSaving(true);
    setError('');
    const faces = parseInt(d.face_count, 10);
    const update = {
      name: d.name.trim().slice(0, 160),
      notes: d.notes.trim() || null,
      address: d.address.trim() || null,
      area: d.area.trim() || null,
      city: d.city.trim(),
      state: d.state.trim() || null,
      format: d.format || 'billboard',
      width: numOrNull(d.width),
      height: numOrNull(d.height),
      illuminated: d.illuminated === '' ? null : d.illuminated === 'yes',
      face_count: Number.isInteger(faces) && faces >= 1 && faces <= 10 ? faces : null,
      contact_name: d.contact_name.trim() || null,
      contact_phone: d.contact_phone.trim() || null,
    };
    const { error: err } = await supabase.from('boards').update(update).eq('id', boardId);
    if (err) { setSaving(false); setError('Could not save. Try again.'); return; }

    // Rates live in a private table; setting asking_rate moves it there.
    const rate = numOrNull(d.rate);
    if (d.rate !== orig?.rate) {
      const { error: rateErr } = rate
        ? await supabase.from('boards').update({ asking_rate: Math.round(rate) }).eq('id', boardId)
        : await supabase.from('board_rates').update({ gross_monthly_rate: null }).eq('board_id', boardId);
      if (rateErr) { setSaving(false); setError('Details saved, but the rate could not be saved. Try again.'); return; }
    }
    setSaving(false);
    onSaved({
      name: update.name, address: update.address, area: update.area, city: update.city, state: update.state,
      format: update.format, illuminated: update.illuminated, face_count: update.face_count,
      asking_rate: d.rate !== orig?.rate ? (rate ? Math.round(rate) : null) : currentRate,
    });
  }

  const label: React.CSSProperties = { display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#475569', marginBottom: 4 };
  const input: React.CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '8px 10px', border: '1px solid #E2E8F0', borderRadius: 8, fontFamily: 'inherit', fontSize: '0.8125rem', color: '#0F172A', background: '#fff' };
  const section: React.CSSProperties = { margin: '18px 0 8px', fontSize: '0.6875rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.07em' };
  const grid: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 };
  const btn: React.CSSProperties = { padding: '8px 14px', borderRadius: 8, border: '1px solid #E2E8F0', background: '#fff', color: '#334155', fontSize: '0.8125rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' };

  // Rendered on <body> so the dashboard's layers (e.g. the mobile top bar) can't cover it.
  return createPortal((
    <div data-details-editor role="dialog" aria-modal="true" aria-label="Edit board details" onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 900, background: 'rgba(15,23,42,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: '#fff', borderRadius: 16, width: 'min(720px, 100%)', maxHeight: 'calc(100vh - 32px)', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 64px rgba(0,0,0,0.3)', fontFamily: "'Inter', sans-serif" }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #F1F5F9', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: '#0F172A' }}>Edit board details</p>
            <p style={{ margin: '2px 0 0', fontSize: '0.75rem', color: '#64748B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{orig?.name ?? 'Loading…'}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', fontSize: 20, color: '#94A3B8', cursor: 'pointer', lineHeight: 1 }}>✕</button>
        </div>

        <div style={{ padding: '4px 20px 8px', overflowY: 'auto' }}>
          {!d ? (
            <p style={{ fontSize: '0.875rem', color: error ? '#DC2626' : '#94A3B8', padding: '2rem 0', textAlign: 'center' }}>{error || 'Loading…'}</p>
          ) : (
            <>
              <p style={section}>About the board</p>
              <label style={label}>Board name
                <input data-field="name" style={{ ...input, marginTop: 4 }} value={d.name} onChange={set('name')} maxLength={160} />
              </label>
              <label style={{ ...label, marginTop: 12 }}>Description <span style={{ fontWeight: 400, color: '#94A3B8' }}>(buyers see this)</span>
                <textarea data-field="notes" style={{ ...input, marginTop: 4, minHeight: 84, resize: 'vertical', lineHeight: 1.5 }} value={d.notes} onChange={set('notes')} maxLength={2000}
                  placeholder="e.g. Faces traffic from Ikeja to Oshodi, clear view from 300 m, lit all night." />
              </label>

              <p style={section}>Location</p>
              <label style={label}>Address / landmark
                <input data-field="address" style={{ ...input, marginTop: 4 }} value={d.address} onChange={set('address')} maxLength={300} placeholder="e.g. Along Eko Bridge by Apongbon" />
              </label>
              <div style={{ ...grid, marginTop: 12 }}>
                <label style={label}>Area<input data-field="area" style={{ ...input, marginTop: 4 }} value={d.area} onChange={set('area')} maxLength={80} placeholder="e.g. Ikeja" /></label>
                <label style={label}>City<input data-field="city" style={{ ...input, marginTop: 4 }} value={d.city} onChange={set('city')} maxLength={80} /></label>
                <label style={label}>State<input data-field="state" style={{ ...input, marginTop: 4 }} value={d.state} onChange={set('state')} maxLength={80} /></label>
              </div>
              <p style={{ margin: '6px 0 0', fontSize: '0.6875rem', color: '#94A3B8' }}>To move the map pin, use “Move pin”.</p>

              <p style={section}>Board</p>
              <div style={grid}>
                <label style={label}>Type
                  <select data-field="format" style={{ ...input, marginTop: 4 }} value={d.format} onChange={set('format')}>
                    {!FORMATS.some(([v]) => v === d.format) && d.format && <option value={d.format}>{d.format}</option>}
                    {FORMATS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </label>
                <label style={label}>Width (m)<input data-field="width" style={{ ...input, marginTop: 4 }} value={d.width} onChange={set('width')} inputMode="decimal" /></label>
                <label style={label}>Height (m)<input data-field="height" style={{ ...input, marginTop: 4 }} value={d.height} onChange={set('height')} inputMode="decimal" /></label>
                <label style={label}>Lit at night
                  <select data-field="illuminated" style={{ ...input, marginTop: 4 }} value={d.illuminated} onChange={set('illuminated')}>
                    <option value="">Not stated</option><option value="yes">Yes</option><option value="no">No</option>
                  </select>
                </label>
                <label style={label}>Faces<input data-field="faces" style={{ ...input, marginTop: 4 }} value={d.face_count} onChange={set('face_count')} inputMode="numeric" /></label>
                <label style={label}>Monthly rate (₦)<input data-field="rate" style={{ ...input, marginTop: 4 }} value={d.rate} onChange={set('rate')} inputMode="numeric" placeholder="Blank = request quote" /></label>
              </div>

              <p style={section}>Sales contact</p>
              <div style={grid}>
                <label style={label}>Contact name<input data-field="contact_name" style={{ ...input, marginTop: 4 }} value={d.contact_name} onChange={set('contact_name')} maxLength={120} /></label>
                <label style={label}>WhatsApp / phone<input data-field="contact_phone" type="tel" style={{ ...input, marginTop: 4 }} value={d.contact_phone} onChange={set('contact_phone')} maxLength={40} /></label>
              </div>
            </>
          )}
        </div>

        {error && d && <p style={{ margin: '8px 20px 0', fontSize: '0.8125rem', color: '#DC2626' }}>{error}</p>}
        <div style={{ padding: '14px 20px 18px', display: 'flex', justifyContent: 'flex-end', gap: 10, borderTop: '1px solid #F1F5F9' }}>
          <button type="button" style={btn} onClick={onClose}>Cancel</button>
          <button type="button" data-save-details disabled={!changed || saving} onClick={save}
            style={{ ...btn, background: '#7C3AED', borderColor: '#7C3AED', color: '#fff', opacity: !changed || saving ? 0.5 : 1, cursor: !changed || saving ? 'default' : 'pointer' }}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  ), document.body);
}
