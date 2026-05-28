'use client';

import { useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { RoleGuard } from '@/components/layout/RoleGuard';

// ── Types ─────────────────────────────────────────────────────────────────────

type Step = 1 | 2 | 3;

type PhotoItem = {
  file: File;
  preview: string;
  uploading: boolean;
  url: string | null;
  error: string | null;
};

// ── Constants ─────────────────────────────────────────────────────────────────

const NIGERIAN_CITIES = [
  'Lagos', 'Abuja', 'Port Harcourt', 'Kano', 'Ibadan', 'Benin City', 'Enugu',
  'Aba', 'Warri', 'Onitsha', 'Kaduna', 'Jos', 'Ilorin', 'Calabar', 'Akure',
  'Uyo', 'Osogbo', 'Owerri', 'Maiduguri', 'Zaria', 'Abeokuta', 'Asaba',
  'Umuahia', 'Bauchi', 'Sokoto', 'Yola', 'Makurdi', 'Lokoja', 'Lafia', 'Gusau',
];

const NIGERIA_STATES = [
  'Abia','Adamawa','Akwa Ibom','Anambra','Bauchi','Bayelsa','Benue','Borno',
  'Cross River','Delta','Ebonyi','Edo','Ekiti','Enugu','FCT - Abuja','Gombe',
  'Imo','Jigawa','Kaduna','Kano','Katsina','Kebbi','Kogi','Kwara','Lagos',
  'Nasarawa','Niger','Ogun','Ondo','Osun','Oyo','Plateau','Rivers','Sokoto',
  'Taraba','Yobe','Zamfara',
];

const FORMAT_OPTIONS = [
  {
    value: 'billboard',
    label: 'Billboard',
    icon: (
      <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
        <rect x="4" y="6" width="32" height="20" rx="2" fill="currentColor" opacity="0.2"/>
        <rect x="4" y="6" width="32" height="20" rx="2" stroke="currentColor" strokeWidth="2"/>
        <line x1="12" y1="26" x2="12" y2="36" stroke="currentColor" strokeWidth="2"/>
        <line x1="28" y1="26" x2="28" y2="36" stroke="currentColor" strokeWidth="2"/>
        <line x1="8" y1="36" x2="32" y2="36" stroke="currentColor" strokeWidth="2"/>
      </svg>
    ),
    desc: 'Classic roadside billboard',
  },
  {
    value: 'unipole',
    label: 'Unipole',
    icon: (
      <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
        <rect x="8" y="4" width="24" height="14" rx="2" fill="currentColor" opacity="0.2"/>
        <rect x="8" y="4" width="24" height="14" rx="2" stroke="currentColor" strokeWidth="2"/>
        <line x1="20" y1="18" x2="20" y2="38" stroke="currentColor" strokeWidth="3"/>
        <ellipse cx="20" cy="38" rx="8" ry="2" fill="currentColor" opacity="0.3"/>
      </svg>
    ),
    desc: 'Single pole, high visibility',
  },
  {
    value: 'gantry',
    label: 'Gantry',
    icon: (
      <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
        <rect x="8" y="14" width="24" height="12" rx="1" fill="currentColor" opacity="0.2"/>
        <rect x="8" y="14" width="24" height="12" rx="1" stroke="currentColor" strokeWidth="2"/>
        <line x1="8" y1="14" x2="8" y2="36" stroke="currentColor" strokeWidth="2"/>
        <line x1="32" y1="14" x2="32" y2="36" stroke="currentColor" strokeWidth="2"/>
        <line x1="4" y1="36" x2="12" y2="36" stroke="currentColor" strokeWidth="2"/>
        <line x1="28" y1="36" x2="36" y2="36" stroke="currentColor" strokeWidth="2"/>
      </svg>
    ),
    desc: 'Spans across roadway',
  },
  {
    value: 'bridge_panel',
    label: 'Bridge Panel',
    icon: (
      <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
        <path d="M4 20 Q20 8 36 20" stroke="currentColor" strokeWidth="2" fill="none"/>
        <rect x="12" y="20" width="16" height="10" rx="1" fill="currentColor" opacity="0.2"/>
        <rect x="12" y="20" width="16" height="10" rx="1" stroke="currentColor" strokeWidth="2"/>
        <line x1="4" y1="36" x2="36" y2="36" stroke="currentColor" strokeWidth="2"/>
      </svg>
    ),
    desc: 'Mounted on bridge / flyover',
  },
  {
    value: 'wall_drape',
    label: 'Wall Drape',
    icon: (
      <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
        <rect x="6" y="4" width="8" height="36" rx="1" fill="currentColor" opacity="0.15"/>
        <rect x="6" y="4" width="8" height="36" rx="1" stroke="currentColor" strokeWidth="2"/>
        <rect x="14" y="8" width="20" height="26" rx="1" fill="currentColor" opacity="0.2"/>
        <rect x="14" y="8" width="20" height="26" rx="1" stroke="currentColor" strokeWidth="2"/>
      </svg>
    ),
    desc: 'Building facade drape',
  },
];

const RATE_BENCHMARKS: Record<string, { label: string; min: number; max: number }[]> = {
  Lagos: [
    { label: 'VI / Ikoyi / Lekki', min: 2_000_000, max: 8_000_000 },
    { label: 'Lagos Island / Marina', min: 1_500_000, max: 5_000_000 },
    { label: 'Mainland (Ikeja / Surulere)', min: 800_000, max: 2_500_000 },
    { label: 'Outskirts / Satellite towns', min: 350_000, max: 900_000 },
  ],
  Abuja: [
    { label: 'Central Business District', min: 1_500_000, max: 4_000_000 },
    { label: 'Maitama / Asokoro / Garki', min: 1_000_000, max: 3_000_000 },
    { label: 'Wuse / Gwarinpa', min: 600_000, max: 1_800_000 },
  ],
  'Port Harcourt': [
    { label: 'GRA / Trans Amadi', min: 700_000, max: 2_000_000 },
    { label: 'Old GRA / Rumuola', min: 400_000, max: 1_200_000 },
  ],
  Kano: [
    { label: 'City Centre / Sabon Gari', min: 400_000, max: 1_200_000 },
    { label: 'Kano State Highway', min: 200_000, max: 700_000 },
  ],
};

const DEFAULT_BENCHMARK = [
  { label: 'Prime / Highway location', min: 300_000, max: 1_000_000 },
  { label: 'Secondary road', min: 150_000, max: 500_000 },
  { label: 'Residential area', min: 80_000, max: 250_000 },
];

function formatNaira(n: number) {
  if (n >= 1_000_000) return '₦' + (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return '₦' + (n / 1_000).toFixed(0) + 'K';
  return '₦' + n.toLocaleString('en-NG');
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function StepIndicator({ step }: { step: Step }) {
  const steps = [
    { n: 1, label: 'Location' },
    { n: 2, label: 'Board details' },
    { n: 3, label: 'Pricing' },
  ];
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0, marginBottom: '2.5rem' }}>
      {steps.map((s, i) => (
        <div key={s.n} style={{ display: 'flex', alignItems: 'center' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
            <div style={{
              width: 36, height: 36, borderRadius: '50%',
              background: step === s.n ? '#7C3AED' : step > s.n ? '#10B981' : '#E2E8F0',
              color: step >= s.n ? '#fff' : '#94A3B8',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: step > s.n ? '1rem' : '0.875rem', fontWeight: 700,
              transition: 'all 0.2s',
              boxShadow: step === s.n ? '0 0 0 4px rgba(124,58,237,0.15)' : 'none',
            }}>
              {step > s.n ? '✓' : s.n}
            </div>
            <span style={{ fontSize: '0.6875rem', fontWeight: step === s.n ? 700 : 500, color: step === s.n ? '#7C3AED' : step > s.n ? '#10B981' : '#94A3B8', whiteSpace: 'nowrap' }}>
              {s.label}
            </span>
          </div>
          {i < steps.length - 1 && (
            <div style={{ width: 80, height: 2, background: step > s.n ? '#10B981' : '#E2E8F0', margin: '0 8px', marginBottom: 24, transition: 'background 0.3s' }} />
          )}
        </div>
      ))}
    </div>
  );
}

function FieldLabel({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, color: '#374151', marginBottom: 6 }}>
      {children}
      {required && <span style={{ color: '#EF4444', marginLeft: 2 }}>*</span>}
    </label>
  );
}

function Input({ value, onChange, type = 'text', placeholder, required, prefix }: {
  value: string; onChange: (v: string) => void; type?: string;
  placeholder?: string; required?: boolean; prefix?: string;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center', border: `1px solid ${focused ? '#7C3AED' : '#E2E8F0'}`, borderRadius: 8, background: '#fff', transition: 'border-color 0.15s', overflow: 'hidden' }}>
      {prefix && (
        <span style={{ padding: '0 10px 0 12px', fontSize: '0.875rem', fontWeight: 600, color: '#64748B', borderRight: '1px solid #E2E8F0', background: '#F8FAFC', alignSelf: 'stretch', display: 'flex', alignItems: 'center', whiteSpace: 'nowrap' }}>
          {prefix}
        </span>
      )}
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{ flex: 1, padding: '10px 12px', border: 'none', outline: 'none', fontSize: '0.9375rem', fontFamily: 'inherit', color: '#0F172A', background: 'transparent', minWidth: 0 }}
      />
    </div>
  );
}

function Select({ value, onChange, options, placeholder }: {
  value: string; onChange: (v: string) => void;
  options: { value: string; label: string }[]; placeholder?: string;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <div style={{ position: 'relative', border: `1px solid ${focused ? '#7C3AED' : '#E2E8F0'}`, borderRadius: 8, background: '#fff', transition: 'border-color 0.15s', overflow: 'hidden' }}>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{ width: '100%', padding: '10px 36px 10px 12px', border: 'none', outline: 'none', fontSize: '0.9375rem', fontFamily: 'inherit', color: value ? '#0F172A' : '#94A3B8', background: 'transparent', appearance: 'none', cursor: 'pointer' }}
      >
        {placeholder && <option value="">{placeholder}</option>}
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <svg style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="6 9 12 15 18 9"/>
      </svg>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

function PostBoardContent() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<string | null>(null); // board id after success

  // Step 1: Location
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [address, setAddress] = useState('');
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [locating, setLocating] = useState(false);

  // Step 2: Board details
  const [format, setFormat] = useState('billboard');
  const [width, setWidth] = useState('');
  const [height, setHeight] = useState('');
  const [faceCount, setFaceCount] = useState(1);
  const [illuminated, setIlluminated] = useState(false);
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Step 3: Pricing
  const [boardName, setBoardName] = useState('');
  const [askingRate, setAskingRate] = useState('');
  const [availableFrom, setAvailableFrom] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');
  const [contactPhone, setContactPhone] = useState('');

  const [error, setError] = useState('');

  // ── GPS location ────────────────────────────────────────────────────────────

  function useMyLocation() {
    if (!navigator.geolocation) {
      setError('Geolocation is not supported by your browser');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      pos => {
        setLatitude(String(pos.coords.latitude.toFixed(6)));
        setLongitude(String(pos.coords.longitude.toFixed(6)));
        setLocating(false);
      },
      () => {
        setError('Could not get your location. Please enter coordinates manually or skip.');
        setLocating(false);
      },
    );
  }

  // ── Photo upload ────────────────────────────────────────────────────────────

  const handlePhotoSelect = useCallback(async (files: FileList | null) => {
    if (!files) return;
    const newPhotos: PhotoItem[] = [];
    for (let i = 0; i < Math.min(files.length, 5 - photos.length); i++) {
      const file = files[i];
      if (!file.type.startsWith('image/')) continue;
      const preview = URL.createObjectURL(file);
      newPhotos.push({ file, preview, uploading: true, url: null, error: null });
    }
    setPhotos(prev => [...prev, ...newPhotos]);

    // Upload each to Supabase Storage
    for (let i = 0; i < newPhotos.length; i++) {
      const item = newPhotos[i];
      const ext = item.file.name.split('.').pop() || 'jpg';
      const path = `boards/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { data, error: uploadError } = await supabase.storage
        .from('board-photos')
        .upload(path, item.file, { cacheControl: '3600', upsert: false });

      const url = data
        ? supabase.storage.from('board-photos').getPublicUrl(data.path).data.publicUrl
        : null;

      setPhotos(prev =>
        prev.map(p =>
          p.preview === item.preview
            ? { ...p, uploading: false, url, error: uploadError ? uploadError.message : null }
            : p
        )
      );
    }
  }, [photos.length]);

  function removePhoto(preview: string) {
    setPhotos(prev => {
      const removed = prev.find(p => p.preview === preview);
      if (removed) URL.revokeObjectURL(removed.preview);
      return prev.filter(p => p.preview !== preview);
    });
  }

  // ── Drag & drop ──────────────────────────────────────────────────────────────

  const [dragging, setDragging] = useState(false);

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    setDragging(true);
  }

  function handleDragLeave() {
    setDragging(false);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    handlePhotoSelect(e.dataTransfer.files);
  }

  // ── Navigation ───────────────────────────────────────────────────────────────

  function nextStep() {
    setError('');
    if (step === 1) {
      if (!city) { setError('Please select a city'); return; }
      if (!address) { setError('Please enter a street address'); return; }
      setStep(2);
    } else if (step === 2) {
      if (!format) { setError('Please select a board format'); return; }
      if (!width || !height) { setError('Please enter the board dimensions'); return; }
      setStep(3);
    }
  }

  function prevStep() {
    setError('');
    setStep(prev => Math.max(1, prev - 1) as Step);
  }

  // ── Auto-name board from city + format ───────────────────────────────────────

  function autoName() {
    if (boardName) return;
    const fmt = FORMAT_OPTIONS.find(f => f.value === format)?.label || 'Board';
    if (city) setBoardName(`${city} ${fmt}`);
  }

  // ── Submit ───────────────────────────────────────────────────────────────────

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!boardName) { setError('Please give your board a name'); return; }
    if (!askingRate || isNaN(Number(askingRate))) { setError('Please enter a valid monthly rate'); return; }

    setSubmitting(true);

    const uploadedPhotos = photos.filter(p => p.url).map(p => p.url as string);

    const payload = {
      name: boardName.trim(),
      format,
      address: address.trim(),
      city,
      state: state || null,
      width: width ? parseFloat(width) : null,
      height: height ? parseFloat(height) : null,
      face_count: faceCount,
      illuminated,
      asking_rate: parseFloat(askingRate),
      latitude: latitude ? parseFloat(latitude) : null,
      longitude: longitude ? parseFloat(longitude) : null,
      status: 'available',
      available_from: availableFrom || null,
      notes: notes.trim() || null,
      contact_phone: contactPhone.trim() || null,
      photo_urls: uploadedPhotos.length > 0 ? uploadedPhotos : null,
    };

    const { data, error: insertError } = await supabase
      .from('boards')
      .insert(payload)
      .select('id')
      .single();

    setSubmitting(false);

    if (insertError) {
      setError(insertError.message);
      return;
    }

    setDone(data.id);
  }

  // ── Benchmarks for selected city ─────────────────────────────────────────────

  const benchmarks = RATE_BENCHMARKS[city] || DEFAULT_BENCHMARK;

  // ── Success screen ────────────────────────────────────────────────────────────

  if (done) {
    return (
      <div style={{ maxWidth: 560, margin: '0 auto', textAlign: 'center', padding: '3rem 0' }}>
        <div style={{ width: 80, height: 80, borderRadius: '50%', background: '#ECFDF5', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 24px', fontSize: '2.5rem' }}>
          ✓
        </div>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#0F172A', margin: '0 0 8px', letterSpacing: '-0.025em' }}>
          Board listed successfully!
        </h1>
        <p style={{ fontSize: '0.9375rem', color: '#64748B', margin: '0 0 32px', lineHeight: 1.6 }}>
          Your board is now live in the marketplace. Agencies across Nigeria can discover and make offers on it.
        </p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button
            onClick={() => router.push('/dashboard/owner')}
            style={{ background: '#7C3AED', color: '#fff', border: 'none', padding: '12px 28px', borderRadius: 10, fontSize: '0.9375rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
          >
            View My Boards
          </button>
          <button
            onClick={() => {
              setStep(1);
              setDone(null);
              setCity(''); setState(''); setAddress(''); setLatitude(''); setLongitude('');
              setFormat('billboard'); setWidth(''); setHeight(''); setFaceCount(1); setIlluminated(false); setPhotos([]);
              setBoardName(''); setAskingRate(''); setNotes('');
            }}
            style={{ background: '#fff', color: '#7C3AED', border: '1.5px solid #7C3AED', padding: '12px 28px', borderRadius: 10, fontSize: '0.9375rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
          >
            + Post Another Board
          </button>
        </div>

        {/* Tips */}
        <div style={{ background: '#F5F3FF', border: '1px solid #DDD6FE', borderRadius: 12, padding: '20px 24px', marginTop: 32, textAlign: 'left' }}>
          <p style={{ fontSize: '0.875rem', fontWeight: 700, color: '#5B21B6', margin: '0 0 10px' }}>Tips to get more enquiries</p>
          <ul style={{ margin: 0, padding: '0 0 0 18px', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {[
              'Add photos — listings with photos get 3× more offers',
              'Set a competitive asking rate (agencies expect to negotiate down 10–20%)',
              'Keep your WhatsApp or phone number in the description so agencies can call',
              'Update your board status to "Maintenance" when it\'s not available',
            ].map(tip => (
              <li key={tip} style={{ fontSize: '0.8125rem', color: '#6D28D9', lineHeight: 1.5 }}>{tip}</li>
            ))}
          </ul>
        </div>
      </div>
    );
  }

  // ── Wizard ────────────────────────────────────────────────────────────────────

  return (
    <div style={{ fontFamily: "'Inter', -apple-system, sans-serif" }}>
      <style>{`
        @keyframes fadeUp { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }
        .step-enter { animation: fadeUp 0.25s ease forwards; }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>

      {/* Page header */}
      <div style={{ marginBottom: '2rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
          <button
            onClick={() => router.push('/dashboard/owner')}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8', padding: '2px 0', fontFamily: 'inherit', fontSize: '0.8125rem', display: 'flex', alignItems: 'center', gap: 4 }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
            My Boards
          </button>
        </div>
        <h1 style={{ fontSize: '1.375rem', fontWeight: 700, color: '#0F172A', letterSpacing: '-0.025em', margin: '0 0 4px' }}>
          Post a board for rent
        </h1>
        <p style={{ fontSize: '0.8125rem', color: '#94A3B8', margin: 0 }}>
          List your OOH space and start receiving offers from agencies
        </p>
      </div>

      {/* Card container */}
      <div style={{ maxWidth: 660, margin: '0 auto' }}>
        <StepIndicator step={step} />

        <div style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: 16, padding: '2rem', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>

          {/* ── Step 1: Location ── */}
          {step === 1 && (
            <div className="step-enter">
              <div style={{ marginBottom: '1.5rem' }}>
                <h2 style={{ fontSize: '1.0625rem', fontWeight: 700, color: '#0F172A', margin: '0 0 4px' }}>Where is your board?</h2>
                <p style={{ fontSize: '0.8125rem', color: '#94A3B8', margin: 0 }}>Agencies search by location — be as precise as possible</p>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                {/* City */}
                <div>
                  <FieldLabel required>City</FieldLabel>
                  <Select
                    value={city}
                    onChange={v => { setCity(v); setError(''); }}
                    placeholder="Select city..."
                    options={NIGERIAN_CITIES.map(c => ({ value: c, label: c }))}
                  />
                </div>

                {/* State */}
                <div>
                  <FieldLabel>State</FieldLabel>
                  <Select
                    value={state}
                    onChange={setState}
                    placeholder="Select state..."
                    options={NIGERIA_STATES.map(s => ({ value: s, label: s }))}
                  />
                </div>

                {/* Street address */}
                <div>
                  <FieldLabel required>Street address / landmark</FieldLabel>
                  <Input
                    value={address}
                    onChange={v => { setAddress(v); setError(''); }}
                    placeholder="e.g. Along Eko Bridge, opposite GTBank HQ"
                  />
                  <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: '4px 0 0' }}>
                    Include a nearby landmark so agencies can locate it easily
                  </p>
                </div>

                {/* GPS */}
                <div style={{ background: '#F8FAFC', border: '1px dashed #E2E8F0', borderRadius: 10, padding: '14px 16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                    <div>
                      <p style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#374151', margin: '0 0 2px' }}>GPS coordinates (optional)</p>
                      <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: 0 }}>Helps show your board on the map for agencies</p>
                    </div>
                    <button
                      type="button"
                      onClick={useMyLocation}
                      disabled={locating}
                      style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#7C3AED', color: '#fff', border: 'none', padding: '8px 14px', borderRadius: 8, fontSize: '0.75rem', fontWeight: 600, cursor: locating ? 'default' : 'pointer', fontFamily: 'inherit', opacity: locating ? 0.7 : 1 }}
                    >
                      {locating ? (
                        <div style={{ width: 12, height: 12, border: '2px solid rgba(255,255,255,0.4)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
                      ) : (
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>
                        </svg>
                      )}
                      {locating ? 'Locating...' : 'Use my location'}
                    </button>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <div>
                      <label style={{ fontSize: '0.6875rem', fontWeight: 600, color: '#64748B', display: 'block', marginBottom: 4 }}>Latitude</label>
                      <Input value={latitude} onChange={setLatitude} placeholder="e.g. 6.524379" type="number" />
                    </div>
                    <div>
                      <label style={{ fontSize: '0.6875rem', fontWeight: 600, color: '#64748B', display: 'block', marginBottom: 4 }}>Longitude</label>
                      <Input value={longitude} onChange={setLongitude} placeholder="e.g. 3.379206" type="number" />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── Step 2: Board details ── */}
          {step === 2 && (
            <div className="step-enter">
              <div style={{ marginBottom: '1.5rem' }}>
                <h2 style={{ fontSize: '1.0625rem', fontWeight: 700, color: '#0F172A', margin: '0 0 4px' }}>Tell us about your board</h2>
                <p style={{ fontSize: '0.8125rem', color: '#94A3B8', margin: 0 }}>Format, size, and photos help agencies make better offers</p>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
                {/* Format visual picker */}
                <div>
                  <FieldLabel required>Board format</FieldLabel>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8 }}>
                    {FORMAT_OPTIONS.map(opt => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setFormat(opt.value)}
                        style={{
                          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
                          padding: '14px 8px',
                          border: `2px solid ${format === opt.value ? '#7C3AED' : '#E2E8F0'}`,
                          borderRadius: 10,
                          background: format === opt.value ? '#F5F3FF' : '#fff',
                          cursor: 'pointer',
                          color: format === opt.value ? '#7C3AED' : '#64748B',
                          transition: 'all 0.15s',
                          fontFamily: 'inherit',
                        }}
                      >
                        {opt.icon}
                        <span style={{ fontSize: '0.625rem', fontWeight: 700, textAlign: 'center', lineHeight: 1.3 }}>{opt.label}</span>
                      </button>
                    ))}
                  </div>
                  {format && (
                    <p style={{ fontSize: '0.75rem', color: '#7C3AED', margin: '6px 0 0', fontWeight: 500 }}>
                      {FORMAT_OPTIONS.find(f => f.value === format)?.desc}
                    </p>
                  )}
                </div>

                {/* Dimensions */}
                <div>
                  <FieldLabel required>Dimensions (metres)</FieldLabel>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 8, alignItems: 'center' }}>
                    <Input value={width} onChange={setWidth} placeholder="Width" type="number" />
                    <span style={{ fontSize: '1.25rem', color: '#94A3B8', fontWeight: 300, textAlign: 'center' }}>×</span>
                    <Input value={height} onChange={setHeight} placeholder="Height" type="number" />
                  </div>
                  {width && height && (
                    <p style={{ fontSize: '0.75rem', color: '#64748B', margin: '5px 0 0' }}>
                      {width}m × {height}m = {(parseFloat(width) * parseFloat(height)).toFixed(1)} m²
                    </p>
                  )}
                </div>

                {/* Face count + Illuminated */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                  <div>
                    <FieldLabel>Number of faces</FieldLabel>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {[1, 2, 3, 4].map(n => (
                        <button
                          key={n}
                          type="button"
                          onClick={() => setFaceCount(n)}
                          style={{
                            flex: 1, padding: '9px 0',
                            border: `2px solid ${faceCount === n ? '#7C3AED' : '#E2E8F0'}`,
                            borderRadius: 8,
                            background: faceCount === n ? '#F5F3FF' : '#fff',
                            color: faceCount === n ? '#7C3AED' : '#64748B',
                            fontSize: '0.9375rem', fontWeight: 700,
                            cursor: 'pointer', fontFamily: 'inherit',
                            transition: 'all 0.15s',
                          }}
                        >
                          {n}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <FieldLabel>Illuminated?</FieldLabel>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {[{ v: true, label: 'Yes — lit' }, { v: false, label: 'No' }].map(opt => (
                        <button
                          key={String(opt.v)}
                          type="button"
                          onClick={() => setIlluminated(opt.v)}
                          style={{
                            flex: 1, padding: '9px 0',
                            border: `2px solid ${illuminated === opt.v ? '#7C3AED' : '#E2E8F0'}`,
                            borderRadius: 8,
                            background: illuminated === opt.v ? '#F5F3FF' : '#fff',
                            color: illuminated === opt.v ? '#7C3AED' : '#64748B',
                            fontSize: '0.75rem', fontWeight: 600,
                            cursor: 'pointer', fontFamily: 'inherit',
                            transition: 'all 0.15s',
                          }}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Photo upload */}
                <div>
                  <FieldLabel>Photos (up to 5)</FieldLabel>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    style={{ display: 'none' }}
                    onChange={e => handlePhotoSelect(e.target.files)}
                  />

                  {/* Drop zone */}
                  {photos.length < 5 && (
                    <div
                      onClick={() => fileInputRef.current?.click()}
                      onDragOver={handleDragOver}
                      onDragLeave={handleDragLeave}
                      onDrop={handleDrop}
                      style={{
                        border: `2px dashed ${dragging ? '#7C3AED' : '#E2E8F0'}`,
                        borderRadius: 10,
                        padding: '28px 20px',
                        textAlign: 'center',
                        cursor: 'pointer',
                        background: dragging ? '#F5F3FF' : '#FAFBFF',
                        transition: 'all 0.15s',
                        marginBottom: photos.length > 0 ? 12 : 0,
                      }}
                    >
                      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke={dragging ? '#7C3AED' : '#94A3B8'} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ margin: '0 auto 8px', display: 'block' }}>
                        <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/>
                        <polyline points="21 15 16 10 5 21"/>
                      </svg>
                      <p style={{ fontSize: '0.875rem', fontWeight: 600, color: dragging ? '#7C3AED' : '#374151', margin: '0 0 2px' }}>
                        {dragging ? 'Drop photos here' : 'Click to upload photos'}
                      </p>
                      <p style={{ fontSize: '0.75rem', color: '#94A3B8', margin: 0 }}>
                        PNG, JPG, WEBP · Max 10MB each · {5 - photos.length} remaining
                      </p>
                    </div>
                  )}

                  {/* Photo thumbnails */}
                  {photos.length > 0 && (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8 }}>
                      {photos.map(p => (
                        <div key={p.preview} style={{ position: 'relative', aspectRatio: '1', borderRadius: 8, overflow: 'hidden', border: '1px solid #E2E8F0' }}>
                          <img src={p.preview} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          {p.uploading && (
                            <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              <div style={{ width: 18, height: 18, border: '2px solid rgba(255,255,255,0.4)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
                            </div>
                          )}
                          {p.error && (
                            <div style={{ position: 'absolute', inset: 0, background: 'rgba(239,68,68,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              <span style={{ fontSize: '0.5625rem', color: '#fff', fontWeight: 700, textAlign: 'center', padding: '0 4px' }}>Upload failed</span>
                            </div>
                          )}
                          {!p.uploading && (
                            <button
                              type="button"
                              onClick={() => removePhoto(p.preview)}
                              style={{ position: 'absolute', top: 3, right: 3, width: 18, height: 18, borderRadius: '50%', background: 'rgba(0,0,0,0.6)', color: '#fff', border: 'none', cursor: 'pointer', fontSize: '0.625rem', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}
                            >
                              ×
                            </button>
                          )}
                          {p.url && (
                            <div style={{ position: 'absolute', bottom: 3, left: 3, width: 6, height: 6, borderRadius: '50%', background: '#10B981' }} />
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: '6px 0 0' }}>
                    Listings with photos get 3× more enquiries from agencies
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* ── Step 3: Pricing ── */}
          {step === 3 && (
            <form onSubmit={handleSubmit} className="step-enter">
              <div style={{ marginBottom: '1.5rem' }}>
                <h2 style={{ fontSize: '1.0625rem', fontWeight: 700, color: '#0F172A', margin: '0 0 4px' }}>Set your asking price</h2>
                <p style={{ fontSize: '0.8125rem', color: '#94A3B8', margin: 0 }}>Agencies will see this and make counter-offers</p>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                {/* Board name */}
                <div>
                  <FieldLabel required>Board name / title</FieldLabel>
                  <Input
                    value={boardName}
                    onChange={setBoardName}
                    placeholder={`e.g. ${city || 'Lagos'} ${FORMAT_OPTIONS.find(f => f.value === format)?.label || 'Billboard'} — Lekki-Epe Expressway`}
                    required
                  />
                  {!boardName && city && (
                    <button type="button" onClick={autoName} style={{ fontSize: '0.6875rem', color: '#7C3AED', fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', marginTop: 4, padding: 0, fontFamily: 'inherit' }}>
                      Auto-fill name →
                    </button>
                  )}
                </div>

                {/* WhatsApp / contact phone */}
                <div>
                  <FieldLabel>Your WhatsApp / phone number</FieldLabel>
                  <Input
                    value={contactPhone}
                    onChange={setContactPhone}
                    placeholder="e.g. 08012345678"
                    type="tel"
                  />
                  <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: '4px 0 0' }}>
                    Agencies will use this to WhatsApp or call you directly about the board
                  </p>
                </div>

                {/* Monthly rate */}
                <div>
                  <FieldLabel required>Monthly asking rate (₦)</FieldLabel>
                  <Input value={askingRate} onChange={setAskingRate} placeholder="e.g. 1500000" type="number" prefix="₦" />

                  {/* Rate benchmarks */}
                  <div style={{ background: '#F8FAFC', border: '1px solid #E8EDF2', borderRadius: 8, padding: '12px 14px', marginTop: 10 }}>
                    <p style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#374151', margin: '0 0 8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      {city || 'Nigerian'} market rates (monthly)
                    </p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                      {benchmarks.map(b => (
                        <div key={b.label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                          <span style={{ fontSize: '0.75rem', color: '#64748B' }}>{b.label}</span>
                          <button
                            type="button"
                            onClick={() => setAskingRate(String(Math.round((b.min + b.max) / 2)))}
                            style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#7C3AED', background: '#F5F3FF', border: 'none', padding: '3px 8px', borderRadius: 5, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}
                          >
                            {formatNaira(b.min)} – {formatNaira(b.max)}
                          </button>
                        </div>
                      ))}
                    </div>
                    <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: '8px 0 0' }}>
                      Click a range to pre-fill the midpoint · Agencies typically negotiate 10–25% below asking
                    </p>
                  </div>
                </div>

                {/* Available from */}
                <div>
                  <FieldLabel>Available from</FieldLabel>
                  <Input value={availableFrom} onChange={setAvailableFrom} type="date" />
                </div>

                {/* Description */}
                <div>
                  <FieldLabel>Additional notes (optional)</FieldLabel>
                  <div style={{ border: '1px solid #E2E8F0', borderRadius: 8, overflow: 'hidden', transition: 'border-color 0.15s' }}
                    onFocus={e => (e.currentTarget.style.borderColor = '#7C3AED')}
                    onBlur={e => (e.currentTarget.style.borderColor = '#E2E8F0')}
                  >
                    <textarea
                      value={notes}
                      onChange={e => setNotes(e.target.value)}
                      placeholder="Any extra details agencies should know: traffic count, visibility range, nearby brands, contact for site visit..."
                      rows={4}
                      style={{ width: '100%', padding: '10px 12px', border: 'none', outline: 'none', fontSize: '0.875rem', fontFamily: 'inherit', color: '#0F172A', background: '#fff', resize: 'vertical', boxSizing: 'border-box' }}
                    />
                  </div>
                </div>

                {/* Summary card */}
                {boardName && askingRate && (
                  <div style={{ background: 'linear-gradient(135deg, #F5F3FF 0%, #EFF6FF 100%)', border: '1px solid #DDD6FE', borderRadius: 12, padding: '16px 18px' }}>
                    <p style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#7C3AED', textTransform: 'uppercase', letterSpacing: '0.07em', margin: '0 0 10px' }}>Your listing preview</p>
                    <p style={{ fontSize: '1rem', fontWeight: 700, color: '#0F172A', margin: '0 0 4px' }}>{boardName}</p>
                    <p style={{ fontSize: '0.8125rem', color: '#475569', margin: '0 0 10px' }}>
                      {FORMAT_OPTIONS.find(f => f.value === format)?.label} · {width}×{height}m · {faceCount} face{faceCount > 1 ? 's' : ''} · {illuminated ? 'Illuminated' : 'Not illuminated'}
                    </p>
                    <p style={{ fontSize: '0.8125rem', color: '#64748B', margin: '0 0 6px' }}>
                      📍 {address}, {city}{state ? `, ${state}` : ''}
                    </p>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                      <span style={{ fontSize: '1.375rem', fontWeight: 800, color: '#7C3AED', fontFamily: 'monospace' }}>
                        {formatNaira(parseFloat(askingRate) || 0)}
                      </span>
                      <span style={{ fontSize: '0.8125rem', color: '#94A3B8' }}>/month asking</span>
                    </div>
                    {photos.filter(p => p.url).length > 0 && (
                      <p style={{ fontSize: '0.6875rem', color: '#10B981', fontWeight: 600, margin: '6px 0 0' }}>
                        ✓ {photos.filter(p => p.url).length} photo{photos.filter(p => p.url).length > 1 ? 's' : ''} attached
                      </p>
                    )}
                  </div>
                )}
              </div>
            </form>
          )}

          {/* ── Error message ── */}
          {error && (
            <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: '10px 14px', marginTop: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#EF4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              <p style={{ fontSize: '0.8125rem', color: '#991B1B', margin: 0, fontWeight: 500 }}>{error}</p>
            </div>
          )}

          {/* ── Footer navigation ── */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '2rem', paddingTop: '1.25rem', borderTop: '1px solid #F1F5F9' }}>
            {step > 1 ? (
              <button
                type="button"
                onClick={prevStep}
                style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: '1.5px solid #E2E8F0', color: '#64748B', padding: '10px 20px', borderRadius: 10, fontSize: '0.875rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="15 18 9 12 15 6"/>
                </svg>
                Back
              </button>
            ) : (
              <span />
            )}

            {step < 3 ? (
              <button
                type="button"
                onClick={nextStep}
                style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#7C3AED', color: '#fff', border: 'none', padding: '10px 24px', borderRadius: 10, fontSize: '0.875rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
              >
                Continue
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 18 15 12 9 6"/>
                </svg>
              </button>
            ) : (
              <button
                type="submit"
                onClick={handleSubmit}
                disabled={submitting}
                style={{ display: 'flex', alignItems: 'center', gap: 8, background: submitting ? '#A78BFA' : '#7C3AED', color: '#fff', border: 'none', padding: '11px 28px', borderRadius: 10, fontSize: '0.9375rem', fontWeight: 700, cursor: submitting ? 'default' : 'pointer', fontFamily: 'inherit', boxShadow: '0 2px 8px rgba(124,58,237,0.25)' }}
              >
                {submitting ? (
                  <>
                    <div style={{ width: 14, height: 14, border: '2px solid rgba(255,255,255,0.4)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
                    Listing board...
                  </>
                ) : (
                  <>
                    List my board
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                  </>
                )}
              </button>
            )}
          </div>
        </div>

        {/* Progress note */}
        <p style={{ textAlign: 'center', fontSize: '0.6875rem', color: '#CBD5E1', margin: '12px 0 0' }}>
          Step {step} of 3 · Your progress is saved as you go
        </p>
      </div>
    </div>
  );
}

export default function PostBoardPage() {
  return (
    <RoleGuard role="owner">
      <PostBoardContent />
    </RoleGuard>
  );
}
