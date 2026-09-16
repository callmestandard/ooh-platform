'use client';

import { useCallback, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { getActivityActor, logActivity } from '@/lib/activity-log';
import LocationPinPickerLoader from '@/app/dashboard/owner/post-board/LocationPinPickerLoader';

// ── Constants ─────────────────────────────────────────────────────────────────

const NIGERIAN_CITIES = [
  'Lagos', 'Abuja', 'Port Harcourt', 'Kano', 'Ibadan', 'Benin City', 'Enugu',
  'Aba', 'Warri', 'Onitsha', 'Kaduna', 'Jos', 'Ilorin', 'Calabar', 'Akure',
  'Uyo', 'Osogbo', 'Owerri', 'Maiduguri', 'Zaria', 'Abeokuta', 'Asaba',
  'Umuahia', 'Bauchi', 'Sokoto', 'Yola', 'Makurdi', 'Lokoja', 'Lafia', 'Gusau',
];

const NIGERIA_STATES = [
  'Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa', 'Benue', 'Borno',
  'Cross River', 'Delta', 'Ebonyi', 'Edo', 'Ekiti', 'Enugu', 'FCT - Abuja', 'Gombe',
  'Imo', 'Jigawa', 'Kaduna', 'Kano', 'Katsina', 'Kebbi', 'Kogi', 'Kwara', 'Lagos',
  'Nasarawa', 'Niger', 'Ogun', 'Ondo', 'Osun', 'Oyo', 'Plateau', 'Rivers', 'Sokoto',
  'Taraba', 'Yobe', 'Zamfara',
];

const FORMAT_OPTIONS = [
  { value: 'billboard', label: 'Billboard' },
  { value: 'unipole', label: 'Unipole' },
  { value: 'gantry', label: 'Gantry' },
  { value: 'bridge_panel', label: 'Bridge Panel' },
  { value: 'wall_drape', label: 'Wall Drape' },
  { value: 'digital', label: 'Digital / LED' },
];

const ORIENTATION_OPTIONS = [
  { value: 'landscape', label: 'Landscape' },
  { value: 'portrait', label: 'Portrait' },
  { value: 'square', label: 'Square' },
];

const STATUS_OPTIONS = [
  { value: 'available', label: 'Available' },
  { value: 'booked', label: 'Booked' },
  { value: 'unavailable', label: 'Unavailable' },
  { value: 'decommissioned', label: 'Decommissioned' },
];

export type BoardRecord = {
  id: string;
  name: string;
  partner_name: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  format: string;
  orientation: string | null;
  city: string;
  state: string | null;
  address: string;
  latitude: number | null;
  longitude: number | null;
  width: number | null;
  height: number | null;
  print_width_mm: number | null;
  print_height_mm: number | null;
  face_count: number | null;
  illuminated: boolean | null;
  traffic_count: number | null;
  asking_rate: number;
  status: string;
  notes: string | null;
  photo_urls: string[] | null;
};

type Props = {
  board?: BoardRecord;      // present when editing
  onSaved: (id: string) => void;
  onCancel: () => void;
};

type PhotoItem = { file: File; preview: string; uploading: boolean; url: string | null; error: string | null };

// ── Small form primitives (consistent with post-board/page.tsx) ───────────────

function FieldLabel({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, color: '#374151', marginBottom: 6 }}>
      {children}{required && <span style={{ color: '#EF4444', marginLeft: 2 }}>*</span>}
    </label>
  );
}

function Input({ value, onChange, type = 'text', placeholder, prefix }: {
  value: string; onChange: (v: string) => void; type?: string; placeholder?: string; prefix?: string;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', border: '1.5px solid #E2E8F0', borderRadius: 8, background: '#fff', overflow: 'hidden' }}>
      {prefix && (
        <span style={{ padding: '0 10px 0 12px', fontSize: '0.875rem', fontWeight: 600, color: '#64748B', borderRight: '1px solid #E2E8F0', background: '#F8FAFC', alignSelf: 'stretch', display: 'flex', alignItems: 'center' }}>
          {prefix}
        </span>
      )}
      <input
        type={type} value={value} placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
        style={{ flex: 1, padding: '9px 12px', border: 'none', outline: 'none', fontSize: '0.875rem', fontFamily: 'inherit', color: '#0F172A', background: 'transparent', minWidth: 0 }}
      />
    </div>
  );
}

function Select({ value, onChange, options, placeholder }: {
  value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; placeholder?: string;
}) {
  return (
    <div style={{ border: '1.5px solid #E2E8F0', borderRadius: 8, background: '#fff' }}>
      <select
        value={value} onChange={e => onChange(e.target.value)}
        style={{ width: '100%', padding: '9px 12px', border: 'none', outline: 'none', fontSize: '0.875rem', fontFamily: 'inherit', color: value ? '#0F172A' : '#94A3B8', background: 'transparent', appearance: 'none', cursor: 'pointer' }}
      >
        {placeholder && <option value="">{placeholder}</option>}
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <p style={{ fontSize: '0.75rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 12px' }}>{title}</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>{children}</div>
    </div>
  );
}

const ROW: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 };

export default function BoardForm({ board, onSaved, onCancel }: Props) {
  const isEdit = !!board;

  const [name, setName] = useState(board?.name || '');
  const [partnerName, setPartnerName] = useState(board?.partner_name || '');
  const [contactName, setContactName] = useState(board?.contact_name || '');
  const [contactPhone, setContactPhone] = useState(board?.contact_phone || '');
  const [format, setFormat] = useState(board?.format || 'billboard');
  const [orientation, setOrientation] = useState(board?.orientation || 'landscape');
  const [city, setCity] = useState(board?.city || '');
  const [state, setState] = useState(board?.state || '');
  const [address, setAddress] = useState(board?.address || '');
  const [latitude, setLatitude] = useState(board?.latitude != null ? String(board.latitude) : '');
  const [longitude, setLongitude] = useState(board?.longitude != null ? String(board.longitude) : '');
  const [width, setWidth] = useState(board?.width != null ? String(board.width) : '');
  const [height, setHeight] = useState(board?.height != null ? String(board.height) : '');
  const [printWidthMm, setPrintWidthMm] = useState(board?.print_width_mm != null ? String(board.print_width_mm) : '');
  const [printHeightMm, setPrintHeightMm] = useState(board?.print_height_mm != null ? String(board.print_height_mm) : '');
  const [faceCount, setFaceCount] = useState(board?.face_count ?? 1);
  const [illuminated, setIlluminated] = useState(board?.illuminated ?? false);
  const [trafficCount, setTrafficCount] = useState(board?.traffic_count != null ? String(board.traffic_count) : '');
  const [askingRate, setAskingRate] = useState(board?.asking_rate != null ? String(board.asking_rate) : '');
  const [status, setStatus] = useState(board?.status || 'available');
  const [notes, setNotes] = useState(board?.notes || '');
  const [photos, setPhotos] = useState<PhotoItem[]>(
    (board?.photo_urls || []).map(url => ({ file: null as unknown as File, preview: url, uploading: false, url, error: null }))
  );
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handlePhotoSelect = useCallback(async (files: FileList | null) => {
    if (!files) return;
    const newPhotos: PhotoItem[] = [];
    for (let i = 0; i < Math.min(files.length, 5 - photos.length); i++) {
      const file = files[i];
      if (!file.type.startsWith('image/')) continue;
      newPhotos.push({ file, preview: URL.createObjectURL(file), uploading: true, url: null, error: null });
    }
    setPhotos(prev => [...prev, ...newPhotos]);
    for (const item of newPhotos) {
      const ext = item.file.name.split('.').pop() || 'jpg';
      const path = `boards/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { data, error: uploadError } = await supabase.storage.from('board-photos').upload(path, item.file, { cacheControl: '3600', upsert: false });
      const url = data ? supabase.storage.from('board-photos').getPublicUrl(data.path).data.publicUrl : null;
      setPhotos(prev => prev.map(p => p.preview === item.preview ? { ...p, uploading: false, url, error: uploadError ? uploadError.message : null } : p));
    }
  }, [photos.length]);

  function removePhoto(preview: string) {
    setPhotos(prev => prev.filter(p => p.preview !== preview));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!name.trim()) { setError('Board name is required'); return; }
    if (!city) { setError('Select a city'); return; }
    if (!address.trim()) { setError('Street address is required'); return; }
    if (!askingRate || isNaN(Number(askingRate))) { setError('Enter a valid monthly rate'); return; }

    setSaving(true);

    const uploadedPhotos = photos.filter(p => p.url).map(p => p.url as string);
    const payload = {
      name: name.trim(),
      partner_name: partnerName.trim() || null,
      contact_name: contactName.trim() || null,
      contact_phone: contactPhone.trim() || null,
      format,
      orientation: orientation || null,
      city,
      state: state || null,
      address: address.trim(),
      latitude: latitude ? parseFloat(latitude) : null,
      longitude: longitude ? parseFloat(longitude) : null,
      width: width ? parseFloat(width) : null,
      height: height ? parseFloat(height) : null,
      print_width_mm: printWidthMm ? parseFloat(printWidthMm) : null,
      print_height_mm: printHeightMm ? parseFloat(printHeightMm) : null,
      face_count: faceCount,
      illuminated,
      traffic_count: trafficCount ? parseInt(trafficCount, 10) : null,
      asking_rate: parseFloat(askingRate),
      notes: notes.trim() || null,
      photo_urls: uploadedPhotos.length > 0 ? uploadedPhotos : null,
    };

    const actor = await getActivityActor();

    if (isEdit && board) {
      const { error: updateError } = await supabase.from('boards').update(payload).eq('id', board.id);
      setSaving(false);
      if (updateError) { setError(updateError.message); return; }

      if (status !== board.status) {
        await supabase.from('boards').update({ status }).eq('id', board.id);
        await logActivity({
          entityType: 'board', entityId: board.id, action: 'board.status_changed',
          summary: `${name.trim()} marked ${status}`,
          ...actor, changes: { status: { from: board.status, to: status } },
        });
      }
      await logActivity({
        entityType: 'board', entityId: board.id, action: 'board.updated',
        summary: `${name.trim()} details updated`, ...actor,
      });
      onSaved(board.id);
    } else {
      const { data, error: insertError } = await supabase.from('boards').insert({ ...payload, status: 'available' }).select('id').single();
      setSaving(false);
      if (insertError) { setError(insertError.message); return; }
      await logActivity({
        entityType: 'board', entityId: data.id, action: 'board.created',
        summary: `${name.trim()} added to inventory`, ...actor,
      });
      onSaved(data.id);
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ maxWidth: 640 }}>
      <Section title="Board & partner">
        <div>
          <FieldLabel required>Board name</FieldLabel>
          <Input value={name} onChange={setName} placeholder="e.g. Lekki-Epe Expressway Unipole" />
        </div>
        <div style={ROW}>
          <div>
            <FieldLabel>Media partner (company) name</FieldLabel>
            <Input value={partnerName} onChange={setPartnerName} placeholder="e.g. Alaba Outdoor Media" />
          </div>
          <div>
            <FieldLabel>Sales contact name</FieldLabel>
            <Input value={contactName} onChange={setContactName} placeholder="e.g. Chidi Okafor" />
          </div>
        </div>
        <div>
          <FieldLabel>Contact phone / WhatsApp / SMS</FieldLabel>
          <Input value={contactPhone} onChange={setContactPhone} placeholder="e.g. 08012345678" type="tel" />
        </div>
      </Section>

      <Section title="Location">
        <div style={ROW}>
          <div>
            <FieldLabel required>City</FieldLabel>
            <Select value={city} onChange={setCity} placeholder="Select city..." options={NIGERIAN_CITIES.map(c => ({ value: c, label: c }))} />
          </div>
          <div>
            <FieldLabel>State</FieldLabel>
            <Select value={state} onChange={setState} placeholder="Select state..." options={NIGERIA_STATES.map(s => ({ value: s, label: s }))} />
          </div>
        </div>
        <div>
          <FieldLabel required>Street address / landmark</FieldLabel>
          <Input value={address} onChange={setAddress} placeholder="e.g. Opposite Lekki Phase 1 Gate" />
        </div>
        <div>
          <FieldLabel>Pin on map</FieldLabel>
          <LocationPinPickerLoader
            lat={latitude ? parseFloat(latitude) : null}
            lng={longitude ? parseFloat(longitude) : null}
            city={city}
            onChange={(la, lo) => { setLatitude(la.toFixed(6)); setLongitude(lo.toFixed(6)); }}
            onClear={() => { setLatitude(''); setLongitude(''); }}
          />
        </div>
      </Section>

      <Section title="Specs">
        <div style={ROW}>
          <div>
            <FieldLabel>Format</FieldLabel>
            <Select value={format} onChange={setFormat} options={FORMAT_OPTIONS} />
          </div>
          <div>
            <FieldLabel>Orientation</FieldLabel>
            <Select value={orientation} onChange={setOrientation} options={ORIENTATION_OPTIONS} />
          </div>
        </div>
        <div style={ROW}>
          <div>
            <FieldLabel>Physical size — width × height (m)</FieldLabel>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 8, alignItems: 'center' }}>
              <Input value={width} onChange={setWidth} type="number" placeholder="Width" />
              <span style={{ color: '#94A3B8' }}>×</span>
              <Input value={height} onChange={setHeight} type="number" placeholder="Height" />
            </div>
          </div>
          <div>
            <FieldLabel>Print / material size — mm</FieldLabel>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 8, alignItems: 'center' }}>
              <Input value={printWidthMm} onChange={setPrintWidthMm} type="number" placeholder="Width" />
              <span style={{ color: '#94A3B8' }}>×</span>
              <Input value={printHeightMm} onChange={setPrintHeightMm} type="number" placeholder="Height" />
            </div>
          </div>
        </div>
        <div style={ROW}>
          <div>
            <FieldLabel>Number of faces</FieldLabel>
            <div style={{ display: 'flex', gap: 6 }}>
              {[1, 2, 3, 4].map(n => (
                <button key={n} type="button" onClick={() => setFaceCount(n)}
                  style={{ flex: 1, padding: '8px 0', border: `1.5px solid ${faceCount === n ? '#1B4F8A' : '#E2E8F0'}`, borderRadius: 8, background: faceCount === n ? '#EFF6FF' : '#fff', color: faceCount === n ? '#1B4F8A' : '#64748B', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                  {n}
                </button>
              ))}
            </div>
          </div>
          <div>
            <FieldLabel>Illuminated?</FieldLabel>
            <div style={{ display: 'flex', gap: 6 }}>
              {[{ v: true, label: 'Yes' }, { v: false, label: 'No' }].map(opt => (
                <button key={String(opt.v)} type="button" onClick={() => setIlluminated(opt.v)}
                  style={{ flex: 1, padding: '8px 0', border: `1.5px solid ${illuminated === opt.v ? '#1B4F8A' : '#E2E8F0'}`, borderRadius: 8, background: illuminated === opt.v ? '#EFF6FF' : '#fff', color: illuminated === opt.v ? '#1B4F8A' : '#64748B', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div>
          <FieldLabel>Estimated daily traffic count (optional)</FieldLabel>
          <Input value={trafficCount} onChange={setTrafficCount} type="number" placeholder="e.g. 45000" />
        </div>
      </Section>

      <Section title="Rate & status">
        <div style={ROW}>
          <div>
            <FieldLabel required>Monthly rate (₦)</FieldLabel>
            <Input value={askingRate} onChange={setAskingRate} type="number" prefix="₦" placeholder="e.g. 850000" />
          </div>
          {isEdit && (
            <div>
              <FieldLabel>Status</FieldLabel>
              <Select value={status} onChange={setStatus} options={STATUS_OPTIONS} />
            </div>
          )}
        </div>
        <div>
          <FieldLabel>Notes</FieldLabel>
          <textarea
            value={notes} onChange={e => setNotes(e.target.value)} rows={3}
            placeholder="Traffic notes, negotiation context, access details..."
            style={{ width: '100%', padding: '9px 12px', border: '1.5px solid #E2E8F0', borderRadius: 8, fontSize: '0.875rem', fontFamily: 'inherit', color: '#0F172A', resize: 'vertical', boxSizing: 'border-box' }}
          />
        </div>
      </Section>

      <Section title="Photos">
        <input ref={fileInputRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={e => handlePhotoSelect(e.target.files)} />
        {photos.length < 5 && (
          <div onClick={() => fileInputRef.current?.click()}
            style={{ border: '2px dashed #E2E8F0', borderRadius: 10, padding: '20px', textAlign: 'center', cursor: 'pointer', background: '#FAFBFF' }}>
            <p style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#374151', margin: 0 }}>Click to upload photos</p>
            <p style={{ fontSize: '0.75rem', color: '#94A3B8', margin: '2px 0 0' }}>{5 - photos.length} remaining</p>
          </div>
        )}
        {photos.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8 }}>
            {photos.map(p => (
              <div key={p.preview} style={{ position: 'relative', aspectRatio: '1', borderRadius: 8, overflow: 'hidden', border: '1px solid #E2E8F0' }}>
                <img src={p.preview} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                {!p.uploading && (
                  <button type="button" onClick={() => removePhoto(p.preview)}
                    style={{ position: 'absolute', top: 3, right: 3, width: 18, height: 18, borderRadius: '50%', background: 'rgba(0,0,0,0.6)', color: '#fff', border: 'none', cursor: 'pointer', fontSize: '0.625rem' }}>×</button>
                )}
              </div>
            ))}
          </div>
        )}
      </Section>

      {error && (
        <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: '10px 14px', marginBottom: 16 }}>
          <p style={{ fontSize: '0.8125rem', color: '#991B1B', margin: 0 }}>{error}</p>
        </div>
      )}

      <div style={{ display: 'flex', gap: 10 }}>
        <button type="submit" disabled={saving}
          style={{ background: saving ? '#94A3B8' : '#1B4F8A', color: '#fff', border: 'none', padding: '11px 24px', borderRadius: 10, fontSize: '0.875rem', fontWeight: 700, cursor: saving ? 'default' : 'pointer', fontFamily: 'inherit' }}>
          {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Add board to inventory'}
        </button>
        <button type="button" onClick={onCancel}
          style={{ background: '#fff', color: '#64748B', border: '1.5px solid #E2E8F0', padding: '11px 24px', borderRadius: 10, fontSize: '0.875rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
          Cancel
        </button>
      </div>
    </form>
  );
}
