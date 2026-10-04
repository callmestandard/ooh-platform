'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import LocationPinPickerLoader from '@/app/dashboard/owner/post-board/LocationPinPickerLoader';
import { BOARD_FORMATS } from '@/lib/board-formats';
import { MAPBOX_TOKEN } from '@/components/map/ooh-map-shared';
import { fetchMyCompany, type MyCompany } from '@/lib/owner-team';

// Add one board while standing in front of it: pin, photo, format, size, rate.
// Only the pin and the format are required — everything else can be filled in
// later from the boards list. Built for a phone: one column, large targets.

const field: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '12px 14px', borderRadius: 10, border: '1px solid #CBD5E1',
  fontSize: '1rem', fontFamily: 'inherit', background: '#fff', color: '#0F172A', outline: 'none',
};
const lab: React.CSSProperties = { display: 'block', fontSize: '0.8125rem', fontWeight: 600, color: '#334155', margin: '16px 0 6px' };
const FORMATS = BOARD_FORMATS.filter(f => f.value !== 'led'); // 'led' is the importer's spelling of 'digital'

type Place = { address: string | null; city: string | null; state: string | null };

/** What is at this pin, so the marketer doesn't have to type an address. */
async function reverseGeocode(lat: number, lng: number): Promise<Place> {
  if (!MAPBOX_TOKEN) return { address: null, city: null, state: null };
  try {
    const res = await fetch(`https://api.mapbox.com/search/geocode/v6/reverse?longitude=${lng}&latitude=${lat}&country=ng&access_token=${MAPBOX_TOKEN}`);
    const f = (await res.json()).features?.[0]?.properties;
    const ctx = f?.context ?? {};
    return {
      address: f?.full_address ?? f?.name ?? null,
      city: ctx.place?.name ?? ctx.locality?.name ?? ctx.district?.name ?? null,
      state: ctx.region?.name ?? null,
    };
  } catch { return { address: null, city: null, state: null }; }
}

export default function QuickAddBoardPage() {
  const [company, setCompany] = useState<MyCompany | null>(null);
  const [loading, setLoading] = useState(true);
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [place, setPlace] = useState<Place>({ address: null, city: null, state: null });
  const [locating, setLocating] = useState(false);
  const [photo, setPhoto] = useState<File | null>(null);
  const [format, setFormat] = useState('');
  const [name, setName] = useState('');
  const [width, setWidth] = useState('');
  const [height, setHeight] = useState('');
  const [rate, setRate] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedName, setSavedName] = useState<string | null>(null);

  useEffect(() => { (async () => { setCompany(await fetchMyCompany()); setLoading(false); })(); }, []);

  async function setPin(la: number, ln: number) {
    setLat(la); setLng(ln); setError(null);
    setPlace(await reverseGeocode(la, ln));
  }

  function locateMe() {
    if (!navigator.geolocation) { setError('This device cannot share its location — tap the map to place the pin instead.'); return; }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      pos => { setLocating(false); setPin(pos.coords.latitude, pos.coords.longitude); },
      () => { setLocating(false); setError('Could not get your location — tap the map to place the pin instead.'); },
      { enableHighAccuracy: true, timeout: 15000 },
    );
  }

  async function save() {
    if (lat == null || lng == null || !format || !company) return;
    setSaving(true); setError(null);

    let photoUrls: string[] | null = null;
    if (photo) {
      const ext = photo.name.split('.').pop() || 'jpg';
      const path = `boards/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const up = await supabase.storage.from('board-photos').upload(path, photo, { cacheControl: '3600', upsert: false });
      if (up.error) { setSaving(false); setError('The photo did not upload (' + up.error.message + '). Try again, or save without it and add it later.'); return; }
      photoUrls = [supabase.storage.from('board-photos').getPublicUrl(up.data.path).data.publicUrl];
    }

    const label = FORMATS.find(f => f.value === format)?.label ?? 'Board';
    const boardName = name.trim() || `${label} — ${place.city ?? 'new site'}`;
    const { error: insertError } = await supabase.from('boards').insert({
      owner_id: company.owner_id,
      name: boardName,
      format,
      latitude: lat,
      longitude: lng,
      address: place.address ?? `Pinned at ${lat.toFixed(5)}, ${lng.toFixed(5)}`,
      city: place.city,
      state: place.state,
      width: Number(width) > 0 ? Number(width) : null,
      height: Number(height) > 0 ? Number(height) : null,
      // moved to the private rate card by the database (migration 035)
      asking_rate: Number(rate) > 0 ? Number(rate) : null,
      photo_urls: photoUrls,
      status: 'available',
    });
    setSaving(false);
    if (insertError) { setError('Could not save the board — ' + insertError.message); return; }

    setSavedName(boardName);
    setLat(null); setLng(null); setPlace({ address: null, city: null, state: null });
    setPhoto(null); setFormat(''); setName(''); setWidth(''); setHeight(''); setRate('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  if (loading) return <p style={{ padding: 24, color: '#94A3B8', fontSize: '0.875rem' }}>Loading…</p>;
  if (!company) return <p style={{ padding: 24, color: '#64748B', fontSize: '0.875rem' }}>Quick add is for board owners and their team.</p>;

  const ready = lat != null && lng != null && !!format;

  return (
    <div style={{ maxWidth: 520, margin: '0 auto', padding: '4px 0 24px', fontFamily: 'inherit' }}>
      <h1 style={{ fontSize: '1.375rem', fontWeight: 800, color: '#0F172A', margin: '0 0 4px', letterSpacing: '-0.02em' }}>Quick add a board</h1>
      <p style={{ fontSize: '0.875rem', color: '#64748B', margin: '0 0 12px' }}>Pin it and pick a format. The rest is optional and can be completed later.</p>

      {savedName && (
        <div data-saved style={{ padding: '12px 14px', borderRadius: 10, background: '#F0FDF4', border: '1px solid #BBF7D0', color: '#15803D', fontSize: '0.875rem', marginBottom: 12 }}>
          <strong>{savedName}</strong> saved. Add another below, or <Link href="/dashboard/owner/rate-cards" style={{ color: '#15803D', fontWeight: 700 }}>complete its details</Link>.
        </div>
      )}
      {error && <div style={{ padding: '12px 14px', borderRadius: 10, background: '#FEF2F2', border: '1px solid #FECACA', color: '#B91C1C', fontSize: '0.875rem', marginBottom: 12 }}>{error}</div>}

      <span style={{ ...lab, marginTop: 4 }}>1. Where is it? <span style={{ color: '#EF4444' }}>*</span></span>
      <button onClick={locateMe} disabled={locating}
        style={{ width: '100%', padding: 14, borderRadius: 10, border: 'none', background: '#7C3AED', color: '#fff', fontSize: '1rem', fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer', marginBottom: 8 }}>
        {locating ? 'Finding you…' : '📍 Use my current location'}
      </button>
      <LocationPinPickerLoader lat={lat} lng={lng} city={place.city ?? ''} onChange={setPin} onClear={() => { setLat(null); setLng(null); setPlace({ address: null, city: null, state: null }); }} />
      {place.address && <p style={{ fontSize: '0.8125rem', color: '#475569', margin: '6px 0 0' }}>{place.address}</p>}

      <span style={lab}>2. Photo</span>
      <input type="file" accept="image/*" capture="environment" onChange={e => setPhoto(e.target.files?.[0] ?? null)} style={{ ...field, padding: 10 }} aria-label="Photo" />

      <span style={lab}>3. Format <span style={{ color: '#EF4444' }}>*</span></span>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {FORMATS.map(f => (
          <button key={f.value} data-format={f.value} onClick={() => setFormat(f.value)}
            style={{ padding: '13px 8px', borderRadius: 10, border: `2px solid ${format === f.value ? '#7C3AED' : '#E2E8F0'}`, background: format === f.value ? '#F5F3FF' : '#fff', color: format === f.value ? '#5B21B6' : '#334155', fontSize: '0.9375rem', fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer' }}>
            {f.label}
          </button>
        ))}
      </div>

      <span style={lab}>4. Size (optional)</span>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <input style={field} type="number" inputMode="decimal" min={0} placeholder="Width" value={width} onChange={e => setWidth(e.target.value)} aria-label="Width" />
        <input style={field} type="number" inputMode="decimal" min={0} placeholder="Height" value={height} onChange={e => setHeight(e.target.value)} aria-label="Height" />
      </div>

      <span style={lab}>5. Monthly rate ₦ (optional — private until the owner chooses to show it)</span>
      <input style={field} type="number" inputMode="numeric" min={0} placeholder="e.g. 500000" value={rate} onChange={e => setRate(e.target.value)} aria-label="Monthly rate" />

      <span style={lab}>Name (optional)</span>
      <input style={field} placeholder="e.g. Ikeja Under-Bridge, facing Allen" value={name} onChange={e => setName(e.target.value)} aria-label="Board name" />

      <div style={{ position: 'sticky', bottom: 0, margin: '20px -4px 0', padding: '12px 4px', background: 'rgba(248,250,252,0.97)', borderTop: '1px solid #E2E8F0', zIndex: 20 }}>
        <button onClick={save} disabled={!ready || saving}
          style={{ display: 'block', width: '100%', maxWidth: 520, margin: '0 auto', padding: 15, borderRadius: 12, border: 'none', background: ready ? '#7C3AED' : '#CBD5E1', color: '#fff', fontSize: '1.0625rem', fontWeight: 800, fontFamily: 'inherit', cursor: ready ? 'pointer' : 'not-allowed' }}>
          {saving ? 'Saving…' : ready ? 'Save board' : 'Place the pin and pick a format'}
        </button>
      </div>
    </div>
  );
}
