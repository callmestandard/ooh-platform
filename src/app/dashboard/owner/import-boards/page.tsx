'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/components/ui/Toast';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

const PreviewMap = dynamic(() => import('./PreviewMap'), {
  ssr: false,
  loading: () => (
    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#F8FAFC', borderRadius: 12 }}>
      <div style={{ width: 24, height: 24, border: '2px solid #E2E8F0', borderTopColor: '#1B4F8A', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
    </div>
  ),
});

// ── Types ───────────────────────────────────────────────────────────────────

type Step = 1 | 2 | 3 | 4;

type ImportRow = {
  _id: string;
  name: string;
  address: string;
  city: string;
  state: string;
  format: string;
  format_raw: string;
  width: number | null;
  height: number | null;
  asking_rate: number | null;
  asking_rate_raw: string;
  latitude: number | null;
  longitude: number | null;
  notes: string;
  status: 'ready' | 'warning' | 'skip';
  issues: string[];
  geocoded: boolean;
  geocoding: boolean;
  duplicate: boolean;
  duplicate_of: string;
  selected: boolean;
};

type ExistingBoard = { id: string; name: string; latitude: number | null; longitude: number | null };

// ── Constants ───────────────────────────────────────────────────────────────

const FIELD_DEFS = [
  { field: 'name',         label: 'Board Name',    required: true },
  { field: 'city',         label: 'City',          required: true },
  { field: 'format',       label: 'Format',        required: true },
  { field: 'asking_rate',  label: 'Asking Rate',   required: true },
  { field: 'address',      label: 'Address',       required: false },
  { field: 'state',        label: 'State',         required: false },
  { field: 'width',        label: 'Width (m)',      required: false },
  { field: 'height',       label: 'Height (m)',     required: false },
  { field: 'latitude',     label: 'Latitude',      required: false },
  { field: 'longitude',    label: 'Longitude',     required: false },
  { field: 'notes',        label: 'Notes',         required: false },
];

const FIELD_HINTS: Record<string, string[]> = {
  name:        ['name', 'board name', 'site name', 'title', 'description', 'location name', 'board'],
  address:     ['address', 'location', 'street', 'site address', 'route', 'road'],
  city:        ['city', 'town', 'lga', 'area'],
  state:       ['state', 'region', 'province'],
  format:      ['format', 'type', 'board type', 'media type', 'face type', 'structure'],
  width:       ['width', 'w', 'width m', 'face width', 'breadth', 'w m'],
  height:      ['height', 'h', 'height m', 'face height', 'h m'],
  asking_rate: ['rate', 'price', 'cost', 'monthly rate', 'asking rate', 'amount', 'rental', 'tariff', 'fee', 'naira'],
  latitude:    ['lat', 'latitude', 'y coord', 'gps lat'],
  longitude:   ['lng', 'lon', 'longitude', 'long', 'x coord', 'gps lon'],
  notes:       ['notes', 'remarks', 'comments', 'details', 'info', 'other'],
};

const FORMAT_ALIASES: Record<string, string> = {
  billboard: 'billboard', 'b/b': 'billboard', board: 'billboard',
  unipole: 'unipole', 'uni-pole': 'unipole', 'uni pole': 'unipole', monopole: 'unipole', 'single pole': 'unipole',
  gantry: 'gantry', overhead: 'gantry', gantries: 'gantry',
  'bridge panel': 'bridge_panel', bridge_panel: 'bridge_panel', 'bridge board': 'bridge_panel', bridge: 'bridge_panel', flyover: 'bridge_panel',
  'wall drape': 'wall_drape', wall_drape: 'wall_drape', drape: 'wall_drape', 'wall banner': 'wall_drape', facade: 'wall_drape',
  led: 'led', digital: 'led', dooh: 'led', 'digital billboard': 'led', 'led board': 'led', 'led display': 'led',
};

const VALID_FORMATS = new Set(['billboard', 'unipole', 'gantry', 'bridge_panel', 'wall_drape', 'led']);

// ── Utility functions ───────────────────────────────────────────────────────

let _idCtr = 0;
function uid(): string { return `row_${++_idCtr}_${Math.random().toString(36).slice(2, 7)}`; }

function normalizeFormat(raw: string): string | null {
  if (!raw) return null;
  const key = raw.toLowerCase().trim().replace(/[-_]+/g, ' ');
  if (VALID_FORMATS.has(key.replace(/\s+/g, '_'))) return key.replace(/\s+/g, '_');
  return FORMAT_ALIASES[key] ?? null;
}

function parseRate(raw: unknown): number | null {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'number') return raw > 0 ? Math.round(raw) : null;
  const s = String(raw).replace(/[₦₦,\s]/g, '').toLowerCase();
  const m = s.match(/^([\d.]+)\s*([kmb]?)$/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (isNaN(n) || n <= 0) return null;
  const suffix = m[2];
  if (suffix === 'k') return Math.round(n * 1_000);
  if (suffix === 'm') return Math.round(n * 1_000_000);
  if (suffix === 'b') return Math.round(n * 1_000_000_000);
  return Math.round(n);
}

function parseNumber(raw: unknown): number | null {
  if (raw == null || raw === '') return null;
  const n = parseFloat(String(raw).replace(/[^\d.-]/g, ''));
  return isNaN(n) ? null : n;
}

function normalizeStr(s: string): string {
  return (s || '').toLowerCase().replace(/[^a-z0-9]/g, '').trim();
}

function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6_371_000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function detectColumn(header: string): string | null {
  const h = header.toLowerCase().trim().replace(/[^a-z0-9\s]/g, '');
  for (const [field, hints] of Object.entries(FIELD_HINTS)) {
    for (const hint of hints) {
      if (h === hint || h.includes(hint) || hint.includes(h)) return field;
    }
  }
  return null;
}

function buildAutoMap(headers: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  const used = new Set<string>();
  for (const h of headers) {
    const field = detectColumn(h);
    if (field && !map[field] && !used.has(h)) {
      map[field] = h;
      used.add(h);
    }
  }
  return map;
}

function validateRows(
  rawRows: Record<string, unknown>[],
  colMap: Record<string, string>,
  existing: ExistingBoard[],
): ImportRow[] {
  const get = (row: Record<string, unknown>, field: string): string => {
    const h = colMap[field];
    return h ? String(row[h] ?? '').trim() : '';
  };

  const seenNames = new Map<string, number>(); // normalized name → first row index

  return rawRows.map((row, idx) => {
    const name = get(row, 'name');
    const city = get(row, 'city');
    const format_raw = get(row, 'format');
    const asking_rate_raw = get(row, 'asking_rate');
    const address = get(row, 'address');
    const state = get(row, 'state');
    const notes = get(row, 'notes');

    const format = normalizeFormat(format_raw);
    const asking_rate = parseRate(asking_rate_raw !== '' ? asking_rate_raw : row[colMap['asking_rate'] || '']);
    const width = parseNumber(get(row, 'width'));
    const height = parseNumber(get(row, 'height'));
    const latRaw = get(row, 'latitude');
    const lngRaw = get(row, 'longitude');
    const latitude = latRaw ? parseFloat(latRaw) : null;
    const longitude = lngRaw ? parseFloat(lngRaw) : null;

    const issues: string[] = [];
    if (!name) issues.push('Missing board name');
    if (!city) issues.push('Missing city');
    if (!asking_rate) issues.push('Missing or invalid rate');
    if (!format_raw) issues.push('Missing format');
    else if (!format) issues.push(`Unknown format "${format_raw}" — select manually`);

    // Dedup within file
    const normName = normalizeStr(name);
    let duplicate = false;
    let duplicate_of = '';

    if (normName) {
      const prev = seenNames.get(normName);
      if (prev !== undefined) {
        duplicate = true;
        duplicate_of = `Row ${prev + 1} in this file`;
        issues.push('Duplicate of another row in file');
      } else {
        seenNames.set(normName, idx);
      }
    }

    // Dedup against existing boards
    if (!duplicate && normName) {
      const match = existing.find(b => {
        if (normalizeStr(b.name) !== normName) return false;
        if (latitude && longitude && b.latitude && b.longitude) {
          return haversine(latitude, longitude, b.latitude, b.longitude) < 100;
        }
        return true; // same name, no coords → flag
      });
      if (match) {
        duplicate = true;
        duplicate_of = `Existing board "${match.name}"`;
        issues.push('Possible duplicate of existing board');
      }
    }

    const hasHardMissing = !name || !city || !asking_rate;
    const status: ImportRow['status'] = hasHardMissing ? 'skip' : (issues.length > 0 ? 'warning' : 'ready');

    return {
      _id: uid(),
      name,
      address,
      city,
      state,
      format: format ?? format_raw,
      format_raw,
      width,
      height,
      asking_rate,
      asking_rate_raw,
      latitude: latitude && !isNaN(latitude) ? latitude : null,
      longitude: longitude && !isNaN(longitude) ? longitude : null,
      notes,
      status,
      issues,
      geocoded: false,
      geocoding: false,
      duplicate,
      duplicate_of,
      selected: !hasHardMissing,
    };
  });
}

function fmtRate(n: number | null): string {
  if (!n) return '—';
  if (n >= 1_000_000) return '₦' + (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return '₦' + Math.round(n / 1_000) + 'k';
  return '₦' + n.toLocaleString('en-NG');
}

// ── Stepper ─────────────────────────────────────────────────────────────────

const STEP_LABELS = ['Upload', 'Map columns', 'Review', 'Publish'];

function Stepper({ step }: { step: Step }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '2rem', gap: 0 }}>
      {STEP_LABELS.map((label, i) => {
        const n = (i + 1) as Step;
        const done = step > n;
        const active = step === n;
        return (
          <div key={n} style={{ display: 'flex', alignItems: 'center' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
              <div style={{
                width: 32, height: 32, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontWeight: 700, fontSize: '0.8125rem', fontFamily: 'inherit',
                background: done ? '#10B981' : active ? '#1B4F8A' : '#E2E8F0',
                color: (done || active) ? '#fff' : '#94A3B8',
              }}>
                {done ? '✓' : n}
              </div>
              <span style={{ fontSize: '0.6875rem', fontWeight: active ? 600 : 400, color: active ? '#1B4F8A' : '#94A3B8', whiteSpace: 'nowrap' }}>
                {label}
              </span>
            </div>
            {i < STEP_LABELS.length - 1 && (
              <div style={{ width: 60, height: 2, background: step > n ? '#10B981' : '#E2E8F0', margin: '0 4px', marginBottom: 18 }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export default function ImportBoardsPage() {
  const router = useRouter();
  const { success: toastSuccess, error: toastError } = useToast();

  const [step, setStep] = useState<Step>(1);
  const [parsing, setParsing] = useState(false);
  const [rawHeaders, setRawHeaders] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<Record<string, unknown>[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [colMap, setColMap] = useState<Record<string, string>>({});
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [existingBoards, setExistingBoards] = useState<ExistingBoard[]>([]);
  const [geocodingDone, setGeocodingDone] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishProgress, setPublishProgress] = useState(0);
  const [publishResult, setPublishResult] = useState<{ inserted: number; skipped: ImportRow[] } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editField, setEditField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const geocodeAbort = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load owner's existing boards for dedup
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      const uid = session?.user?.id;
      if (!uid) return;
      supabase.from('boards')
        .select('id, name, latitude, longitude')
        .eq('owner_id', uid)
        .then(({ data }) => setExistingBoards((data as ExistingBoard[]) || []));
    });
  }, []);

  // ── File upload & parse ─────────────────────────────────────────────────

  async function handleFile(file: File) {
    setParsing(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/import-boards/parse', {
        method: 'POST',
        headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
        body: form,
      });
      const data = await res.json();
      if (!res.ok) { toastError(data.error || 'Parse failed'); return; }

      setRawHeaders(data.headers);
      setRawRows(data.rows);
      setTruncated(data.truncated);
      setColMap(buildAutoMap(data.headers));
    } catch {
      toastError('Failed to read file');
    } finally {
      setParsing(false);
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  // ── Step 2 → 3: validate ────────────────────────────────────────────────

  function applyMapping() {
    const required = FIELD_DEFS.filter(f => f.required).map(f => f.field);
    for (const f of required) {
      if (!colMap[f]) { toastError(`Please map the "${FIELD_DEFS.find(d => d.field === f)?.label}" column`); return; }
    }
    const validated = validateRows(rawRows, colMap, existingBoards);
    setRows(validated);
    setStep(3);
    setGeocodingDone(false);
    geocodeAbort.current = false;
    // Start geocoding in background
    runGeocode(validated);
  }

  // ── Geocoding ───────────────────────────────────────────────────────────

  const runGeocode = useCallback(async (initialRows: ImportRow[]) => {
    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    if (!token) return;

    const toGeocode = initialRows.filter(r => r.selected && !r.latitude && !r.longitude && (r.city || r.address));

    for (const row of toGeocode) {
      if (geocodeAbort.current) break;

      setRows(prev => prev.map(r => r._id === row._id ? { ...r, geocoding: true } : r));

      const q = [row.address, row.city, 'Nigeria'].filter(Boolean).join(', ');
      try {
        const res = await fetch(
          `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json?access_token=${token}&country=ng&limit=1&types=address,place,neighborhood`,
        );
        if (res.ok) {
          const data = await res.json();
          const feature = data.features?.[0];
          if (feature) {
            const [lng, lat] = feature.center as [number, number];
            setRows(prev => prev.map(r => r._id === row._id ? { ...r, latitude: lat, longitude: lng, geocoded: true, geocoding: false } : r));
          } else {
            setRows(prev => prev.map(r => r._id === row._id ? { ...r, geocoding: false } : r));
          }
        } else {
          setRows(prev => prev.map(r => r._id === row._id ? { ...r, geocoding: false } : r));
        }
      } catch {
        setRows(prev => prev.map(r => r._id === row._id ? { ...r, geocoding: false } : r));
      }

      // 5 req/sec rate limit
      await new Promise(res => setTimeout(res, 200));
    }
    setGeocodingDone(true);
  }, []);

  // ── Inline editing ─────────────────────────────────────────────────────

  function startEdit(id: string, field: string, value: string) {
    setEditingId(id); setEditField(field); setEditValue(value);
  }

  function commitEdit() {
    if (!editingId || !editField) return;
    setRows(prev => prev.map(r => {
      if (r._id !== editingId) return r;
      const updated = { ...r };
      if (editField === 'name') updated.name = editValue;
      if (editField === 'city') updated.city = editValue;
      if (editField === 'format') {
        updated.format_raw = editValue;
        updated.format = normalizeFormat(editValue) ?? editValue;
      }
      if (editField === 'asking_rate') {
        updated.asking_rate_raw = editValue;
        updated.asking_rate = parseRate(editValue);
      }
      // Re-evaluate status
      const issues: string[] = [];
      if (!updated.name) issues.push('Missing board name');
      if (!updated.city) issues.push('Missing city');
      if (!updated.asking_rate) issues.push('Missing or invalid rate');
      if (!normalizeFormat(updated.format)) issues.push(`Unknown format "${updated.format}"`);
      const hasHard = !updated.name || !updated.city || !updated.asking_rate;
      updated.issues = issues.filter(i => !i.includes('Duplicate'));
      if (r.duplicate) updated.issues.push(`Possible duplicate of ${r.duplicate_of}`);
      updated.status = hasHard ? 'skip' : (updated.issues.length > 0 ? 'warning' : 'ready');
      return updated;
    }));
    setEditingId(null); setEditField(null);
  }

  // ── Publish ─────────────────────────────────────────────────────────────

  async function publish() {
    geocodeAbort.current = true;
    setPublishing(true);
    setPublishProgress(0);

    const selected = rows.filter(r => r.selected && r.status !== 'skip');
    const skipped = rows.filter(r => !r.selected || r.status === 'skip');
    const BATCH = 50;
    let inserted = 0;

    for (let i = 0; i < selected.length; i += BATCH) {
      const batch = selected.slice(i, i + BATCH).map(r => ({
        name: r.name,
        address: r.address,
        city: r.city,
        state: r.state,
        format: normalizeFormat(r.format) || 'billboard',
        width: r.width,
        height: r.height,
        asking_rate: r.asking_rate ?? 0,
        latitude: r.latitude,
        longitude: r.longitude,
        notes: r.notes,
      }));

      try {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch('/api/import-boards', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
          },
          body: JSON.stringify({ rows: batch }),
        });
        const data = await res.json();
        inserted += data.inserted ?? 0;
      } catch { /* batch failed — continue */ }

      setPublishProgress(Math.round(((i + Math.min(BATCH, selected.length - i)) / selected.length) * 100));
    }

    setPublishResult({ inserted, skipped });
    setPublishing(false);
    toastSuccess(`${inserted} boards published successfully`);
  }

  function downloadSkipReport() {
    if (!publishResult) return;
    const lines = [
      'Name,City,Format,Rate,Reason',
      ...publishResult.skipped.map(r =>
        [`"${r.name}"`, `"${r.city}"`, r.format, r.asking_rate ?? '', `"${r.issues.join('; ')}"`].join(',')
      ),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url;
    a.download = 'import-skip-report.csv'; document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
  }

  // ── Derived stats ────────────────────────────────────────────────────────

  const readyCount   = rows.filter(r => r.status === 'ready'   && r.selected).length;
  const warningCount = rows.filter(r => r.status === 'warning' && r.selected).length;
  const skipCount    = rows.filter(r => r.status === 'skip').length;
  const selectedCount = rows.filter(r => r.selected && r.status !== 'skip').length;
  const geocodingCount = rows.filter(r => r.geocoding).length;
  const geocodedCount  = rows.filter(r => r.geocoded).length;
  const needsGeocode   = rows.filter(r => r.selected && !r.latitude && !r.longitude).length;

  const mapBoards = rows
    .filter(r => r.selected && r.status !== 'skip' && r.latitude && r.longitude)
    .map(r => ({
      id: r._id,
      name: r.name,
      city: r.city,
      format: r.format,
      asking_rate: r.asking_rate,
      lat: r.latitude!,
      lng: r.longitude!,
      geocoded: r.geocoded,
      status: r.status as 'ready' | 'warning',
    }));

  // ── Render ───────────────────────────────────────────────────────────────

  const cardStyle: React.CSSProperties = {
    background: '#fff', border: '1px solid #E8EDF2', borderRadius: 16,
    padding: '2rem', boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
  };
  const btnPrimary: React.CSSProperties = {
    padding: '10px 22px', borderRadius: 9, border: 'none',
    background: '#1B4F8A', color: '#fff', fontWeight: 600, fontSize: '0.875rem',
    cursor: 'pointer', fontFamily: 'inherit',
  };
  const btnSecondary: React.CSSProperties = {
    padding: '10px 22px', borderRadius: 9, border: '1px solid #E2E8F0',
    background: '#fff', color: '#374151', fontWeight: 600, fontSize: '0.875rem',
    cursor: 'pointer', fontFamily: 'inherit',
  };

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '0 0 40px' }}>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeUp { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:none; } }
        .imp-row:hover { background: #F8FAFC !important; }
        .imp-cell-edit:hover { background: #EFF6FF; cursor: text; border-radius: 4px; }
      `}</style>

      {/* Header */}
      <div style={{ marginBottom: '1.5rem' }}>
        <button onClick={() => router.push('/dashboard/owner')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8', fontFamily: 'inherit', fontSize: '0.8125rem', display: 'flex', alignItems: 'center', gap: 4, padding: '2px 0', marginBottom: 8 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          My Boards
        </button>
        <h1 style={{ fontSize: '1.375rem', fontWeight: 700, color: '#0F172A', letterSpacing: '-0.025em', margin: '0 0 4px' }}>
          Bulk Board Importer
        </h1>
        <p style={{ fontSize: '0.8125rem', color: '#94A3B8', margin: 0 }}>
          List hundreds of boards in minutes — upload your spreadsheet, map columns, review, and publish.
        </p>
      </div>

      <Stepper step={step} />

      {/* ── Step 1: Upload ──────────────────────────────────────────────── */}
      {step === 1 && (
        <div style={cardStyle}>
          <h2 style={{ fontSize: '1rem', fontWeight: 700, color: '#0F172A', margin: '0 0 4px' }}>Upload your spreadsheet</h2>
          <p style={{ fontSize: '0.8125rem', color: '#64748B', margin: '0 0 20px' }}>
            Supported formats: .xlsx, .xls, .csv · Max 1,000 rows per import
          </p>

          {/* Drop zone */}
          <div
            onDragOver={e => e.preventDefault()}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            style={{
              border: '2px dashed #CBD5E1', borderRadius: 12, padding: '3rem 2rem',
              textAlign: 'center', cursor: 'pointer', background: '#F8FAFC',
              transition: 'border-color 0.15s, background 0.15s',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.borderColor = '#1B4F8A'; (e.currentTarget as HTMLDivElement).style.background = '#EFF6FF'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.borderColor = '#CBD5E1'; (e.currentTarget as HTMLDivElement).style.background = '#F8FAFC'; }}
          >
            <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
            {parsing ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 28, height: 28, border: '3px solid #E2E8F0', borderTopColor: '#1B4F8A', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
                <span style={{ fontSize: '0.875rem', color: '#64748B' }}>Parsing file…</span>
              </div>
            ) : (
              <>
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" strokeWidth="1.5" style={{ marginBottom: 12 }}>
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"/>
                </svg>
                <p style={{ margin: 0, fontWeight: 600, color: '#374151', fontSize: '0.9375rem' }}>
                  {rawRows.length > 0 ? 'Replace file' : 'Drop your file here'}
                </p>
                <p style={{ margin: '4px 0 0', fontSize: '0.8125rem', color: '#94A3B8' }}>or click to browse</p>
              </>
            )}
          </div>

          {/* Template download */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 16 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#64748B" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
            <a href="/api/import-boards/template" style={{ fontSize: '0.8125rem', color: '#1B4F8A', fontWeight: 500, textDecoration: 'none' }}>
              Download blank template (.xlsx)
            </a>
            <span style={{ fontSize: '0.75rem', color: '#94A3B8' }}>— 11 columns, 4 example rows, instructions sheet</span>
          </div>

          {/* Preview of parsed rows */}
          {rawRows.length > 0 && (
            <div style={{ marginTop: 24 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <span style={{ fontSize: '0.875rem', fontWeight: 600, color: '#374151' }}>
                  Preview — {rawRows.length} rows detected {truncated ? '(capped at 1,000)' : ''}
                </span>
              </div>
              <div style={{ overflowX: 'auto', borderRadius: 8, border: '1px solid #E2E8F0' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem' }}>
                  <thead>
                    <tr style={{ background: '#F8FAFC' }}>
                      {rawHeaders.slice(0, 8).map(h => (
                        <th key={h} style={{ padding: '8px 10px', textAlign: 'left', color: '#64748B', fontWeight: 600, borderBottom: '1px solid #E2E8F0', whiteSpace: 'nowrap' }}>{h}</th>
                      ))}
                      {rawHeaders.length > 8 && <th style={{ padding: '8px 10px', color: '#94A3B8' }}>+{rawHeaders.length - 8} more</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {rawRows.slice(0, 5).map((row, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid #F1F5F9' }}>
                        {rawHeaders.slice(0, 8).map(h => (
                          <td key={h} style={{ padding: '7px 10px', color: '#374151', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {String(row[h] ?? '')}
                          </td>
                        ))}
                        {rawHeaders.length > 8 && <td style={{ padding: '7px 10px', color: '#94A3B8' }}>…</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 24 }}>
            <button
              style={{ ...btnPrimary, opacity: rawRows.length === 0 ? 0.4 : 1 }}
              disabled={rawRows.length === 0}
              onClick={() => setStep(2)}
            >
              Map columns →
            </button>
          </div>
        </div>
      )}

      {/* ── Step 2: Column Mapping ──────────────────────────────────────── */}
      {step === 2 && (
        <div style={cardStyle}>
          <h2 style={{ fontSize: '1rem', fontWeight: 700, color: '#0F172A', margin: '0 0 4px' }}>Map your columns</h2>
          <p style={{ fontSize: '0.8125rem', color: '#64748B', margin: '0 0 20px' }}>
            Tell us which of your spreadsheet columns maps to each board field. We auto-detected likely matches — correct any that are wrong.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {FIELD_DEFS.map(def => (
              <div key={def.field} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', alignItems: 'center', gap: 12, padding: '10px 14px', background: '#F8FAFC', borderRadius: 8 }}>
                <div>
                  <span style={{ fontWeight: 600, fontSize: '0.8125rem', color: '#374151' }}>{def.label}</span>
                  {def.required && <span style={{ marginLeft: 6, fontSize: '0.6875rem', color: '#DC2626', fontWeight: 600 }}>required</span>}
                </div>
                <select
                  value={colMap[def.field] || ''}
                  onChange={e => setColMap(prev => ({ ...prev, [def.field]: e.target.value }))}
                  style={{
                    padding: '7px 10px', borderRadius: 7, border: `1px solid ${!colMap[def.field] && def.required ? '#FCA5A5' : '#E2E8F0'}`,
                    fontSize: '0.8125rem', color: colMap[def.field] ? '#0F172A' : '#94A3B8',
                    background: '#fff', fontFamily: 'inherit', cursor: 'pointer',
                  }}
                >
                  <option value="">— skip this field —</option>
                  {rawHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                </select>
                {colMap[def.field] ? (
                  <span style={{ color: '#10B981', fontWeight: 700, fontSize: '1rem' }}>✓</span>
                ) : (
                  <span style={{ color: def.required ? '#FCA5A5' : '#CBD5E1', fontSize: '1rem' }}>○</span>
                )}
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 24 }}>
            <button style={btnSecondary} onClick={() => setStep(1)}>← Back</button>
            <button style={btnPrimary} onClick={applyMapping}>Validate & Review →</button>
          </div>
        </div>
      )}

      {/* ── Step 3: Review ──────────────────────────────────────────────── */}
      {step === 3 && (
        <div style={{ animation: 'fadeUp 0.2s ease' }}>
          {/* Summary bar */}
          <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
            {[
              { label: 'Ready', count: readyCount, color: '#10B981', bg: '#ECFDF5' },
              { label: 'Needs attention', count: warningCount, color: '#D97706', bg: '#FFFBEB' },
              { label: 'Will skip', count: skipCount, color: '#EF4444', bg: '#FEF2F2' },
            ].map(s => (
              <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', borderRadius: 8, background: s.bg }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: s.color, display: 'inline-block' }} />
                <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: s.color }}>{s.count}</span>
                <span style={{ fontSize: '0.8125rem', color: '#64748B' }}>{s.label}</span>
              </div>
            ))}
            {geocodingCount > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', borderRadius: 8, background: '#EFF6FF' }}>
                <div style={{ width: 12, height: 12, border: '2px solid #BFDBFE', borderTopColor: '#1B4F8A', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
                <span style={{ fontSize: '0.8125rem', color: '#1B4F8A' }}>Geocoding {geocodedCount}/{needsGeocode + geocodedCount}</span>
              </div>
            )}
            {geocodingDone && geocodedCount > 0 && (
              <div style={{ padding: '8px 14px', borderRadius: 8, background: '#FFFBEB', fontSize: '0.8125rem', color: '#92400E' }}>
                ⚠ {geocodedCount} geocoded — verify pins on the map
              </div>
            )}
          </div>

          {/* Table */}
          <div style={{ ...cardStyle, padding: 0, overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto', maxHeight: 520, overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' }}>
                <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
                  <tr style={{ background: '#F8FAFC', borderBottom: '1px solid #E2E8F0' }}>
                    <th style={{ padding: '10px 12px', width: 36 }}>
                      <input type="checkbox"
                        checked={rows.filter(r => r.status !== 'skip').every(r => r.selected)}
                        onChange={e => setRows(prev => prev.map(r => r.status === 'skip' ? r : { ...r, selected: e.target.checked }))}
                      />
                    </th>
                    <th style={{ padding: '10px 8px', textAlign: 'left', color: '#64748B', fontWeight: 600, width: 36 }}>St</th>
                    <th style={{ padding: '10px 8px', textAlign: 'left', color: '#64748B', fontWeight: 600 }}>Name</th>
                    <th style={{ padding: '10px 8px', textAlign: 'left', color: '#64748B', fontWeight: 600 }}>City</th>
                    <th style={{ padding: '10px 8px', textAlign: 'left', color: '#64748B', fontWeight: 600 }}>Format</th>
                    <th style={{ padding: '10px 8px', textAlign: 'left', color: '#64748B', fontWeight: 600 }}>Rate</th>
                    <th style={{ padding: '10px 8px', textAlign: 'left', color: '#64748B', fontWeight: 600 }}>Coords</th>
                    <th style={{ padding: '10px 8px', textAlign: 'left', color: '#64748B', fontWeight: 600 }}>Issues</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(row => {
                    const statusColor = row.status === 'ready' ? '#10B981' : row.status === 'warning' ? '#D97706' : '#EF4444';
                    const isEditing = editingId === row._id;
                    return (
                      <tr
                        key={row._id}
                        className="imp-row"
                        style={{
                          borderBottom: '1px solid #F1F5F9',
                          opacity: row.status === 'skip' || !row.selected ? 0.5 : 1,
                          background: row.duplicate ? '#FFFBEB' : undefined,
                        }}
                      >
                        <td style={{ padding: '8px 12px' }}>
                          <input
                            type="checkbox"
                            checked={row.selected && row.status !== 'skip'}
                            disabled={row.status === 'skip'}
                            onChange={e => setRows(prev => prev.map(r => r._id === row._id ? { ...r, selected: e.target.checked } : r))}
                          />
                        </td>
                        <td style={{ padding: '8px' }}>
                          <span title={row.status} style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: statusColor }} />
                        </td>
                        {/* Editable: name */}
                        <td style={{ padding: '8px', maxWidth: 180 }} className="imp-cell-edit">
                          {isEditing && editField === 'name' ? (
                            <input autoFocus value={editValue} onChange={e => setEditValue(e.target.value)} onBlur={commitEdit} onKeyDown={e => e.key === 'Enter' && commitEdit()}
                              style={{ width: '100%', border: '1px solid #1B4F8A', borderRadius: 4, padding: '2px 6px', fontSize: '0.8125rem', fontFamily: 'inherit' }} />
                          ) : (
                            <span onClick={() => startEdit(row._id, 'name', row.name)} style={{ cursor: 'text' }}
                              title={row.name}>{row.name || <em style={{ color: '#EF4444' }}>missing</em>}</span>
                          )}
                        </td>
                        {/* Editable: city */}
                        <td style={{ padding: '8px' }} className="imp-cell-edit">
                          {isEditing && editField === 'city' ? (
                            <input autoFocus value={editValue} onChange={e => setEditValue(e.target.value)} onBlur={commitEdit} onKeyDown={e => e.key === 'Enter' && commitEdit()}
                              style={{ width: '100%', border: '1px solid #1B4F8A', borderRadius: 4, padding: '2px 6px', fontSize: '0.8125rem', fontFamily: 'inherit' }} />
                          ) : (
                            <span onClick={() => startEdit(row._id, 'city', row.city)} style={{ cursor: 'text' }}>
                              {row.city || <em style={{ color: '#EF4444' }}>missing</em>}</span>
                          )}
                        </td>
                        {/* Editable: format */}
                        <td style={{ padding: '8px' }}>
                          {isEditing && editField === 'format' ? (
                            <select autoFocus value={editValue}
                              onChange={e => { setEditValue(e.target.value); setTimeout(commitEdit, 0); }}
                              onBlur={commitEdit}
                              style={{ border: '1px solid #1B4F8A', borderRadius: 4, padding: '2px 6px', fontSize: '0.8125rem', fontFamily: 'inherit' }}>
                              {['billboard', 'unipole', 'gantry', 'bridge_panel', 'wall_drape', 'led'].map(f => <option key={f}>{f}</option>)}
                            </select>
                          ) : (
                            <span
                              onClick={() => startEdit(row._id, 'format', row.format)}
                              style={{
                                cursor: 'text', padding: '2px 6px', borderRadius: 4,
                                background: VALID_FORMATS.has(row.format) ? '#EFF6FF' : '#FEF2F2',
                                color: VALID_FORMATS.has(row.format) ? '#1B4F8A' : '#EF4444',
                                fontSize: '0.75rem', fontWeight: 500,
                              }}
                            >
                              {row.format || <em>missing</em>}
                            </span>
                          )}
                        </td>
                        {/* Editable: rate */}
                        <td style={{ padding: '8px' }} className="imp-cell-edit">
                          {isEditing && editField === 'asking_rate' ? (
                            <input autoFocus value={editValue} onChange={e => setEditValue(e.target.value)} onBlur={commitEdit} onKeyDown={e => e.key === 'Enter' && commitEdit()}
                              style={{ width: 90, border: '1px solid #1B4F8A', borderRadius: 4, padding: '2px 6px', fontSize: '0.8125rem', fontFamily: 'inherit' }} />
                          ) : (
                            <span onClick={() => startEdit(row._id, 'asking_rate', row.asking_rate_raw)} style={{ cursor: 'text', fontWeight: 500, color: row.asking_rate ? '#374151' : '#EF4444' }}>
                              {row.asking_rate ? fmtRate(row.asking_rate) : <em>missing</em>}
                            </span>
                          )}
                        </td>
                        {/* Coords / geocoding */}
                        <td style={{ padding: '8px', fontSize: '0.75rem', color: '#94A3B8' }}>
                          {row.geocoding ? (
                            <div style={{ width: 12, height: 12, border: '2px solid #E2E8F0', borderTopColor: '#1B4F8A', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
                          ) : row.latitude && row.longitude ? (
                            <span style={{ color: row.geocoded ? '#D97706' : '#10B981' }} title={row.geocoded ? 'Geocoded — verify pin' : 'GPS coords'}>
                              {row.geocoded ? '⚠ geo' : '✓ gps'}
                            </span>
                          ) : (
                            <span style={{ color: '#CBD5E1' }}>none</span>
                          )}
                        </td>
                        {/* Issues */}
                        <td style={{ padding: '8px', maxWidth: 200, fontSize: '0.75rem', color: '#94A3B8' }}>
                          {row.issues.length > 0 ? (
                            <span title={row.issues.join('; ')} style={{ color: row.status === 'skip' ? '#EF4444' : '#D97706' }}>
                              {row.issues[0]}{row.issues.length > 1 ? ` +${row.issues.length - 1}` : ''}
                            </span>
                          ) : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <p style={{ fontSize: '0.75rem', color: '#94A3B8', marginTop: 8 }}>
            Click any cell to edit inline. Amber rows need attention but will still be imported.
          </p>

          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 20 }}>
            <button style={btnSecondary} onClick={() => { geocodeAbort.current = true; setStep(2); }}>← Back</button>
            <button style={{ ...btnPrimary, opacity: selectedCount === 0 ? 0.4 : 1 }} disabled={selectedCount === 0} onClick={() => setStep(4)}>
              Preview map & publish ({selectedCount} boards) →
            </button>
          </div>
        </div>
      )}

      {/* ── Step 4: Preview + Publish ───────────────────────────────────── */}
      {step === 4 && (
        <div style={{ animation: 'fadeUp 0.2s ease' }}>
          <div style={{ ...cardStyle, marginBottom: 16 }}>
            <h2 style={{ fontSize: '1rem', fontWeight: 700, color: '#0F172A', margin: '0 0 4px' }}>
              Sanity-check locations
            </h2>
            <p style={{ fontSize: '0.8125rem', color: '#64748B', margin: '0 0 16px' }}>
              {mapBoards.length > 0
                ? `${mapBoards.length} of ${selectedCount} boards have coordinates. Yellow rings = geocoded from address — verify they look correct.`
                : 'No boards have coordinates yet. You can still publish — owners can set coordinates after publishing.'
              }
            </p>
            <div style={{ height: 400, borderRadius: 12, overflow: 'hidden', border: '1px solid #E2E8F0' }}>
              <PreviewMap boards={mapBoards} />
            </div>
            {geocodedCount > 0 && (
              <div style={{ marginTop: 12, padding: '10px 14px', borderRadius: 8, background: '#FFFBEB', fontSize: '0.8125rem', color: '#92400E' }}>
                ⚠ <strong>{geocodedCount} boards</strong> were geocoded from their address. Their map pins may not be perfectly accurate — edit coordinates after publishing if needed.
              </div>
            )}
          </div>

          {/* Publish summary card */}
          {!publishResult && (
            <div style={{ ...cardStyle }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
                <div>
                  <p style={{ fontWeight: 700, color: '#0F172A', margin: '0 0 4px', fontSize: '0.9375rem' }}>
                    Ready to publish {selectedCount} boards
                  </p>
                  <p style={{ fontSize: '0.8125rem', color: '#64748B', margin: 0 }}>
                    {readyCount + warningCount} will be inserted · {skipCount} will be skipped · status set to "available"
                  </p>
                </div>
                <div style={{ display: 'flex', gap: 10 }}>
                  <button style={btnSecondary} onClick={() => setStep(3)}>← Review</button>
                  <button style={{ ...btnPrimary, background: '#0D6B3E' }} disabled={publishing} onClick={() => setShowConfirm(true)}>
                    {publishing ? 'Publishing…' : `Publish ${selectedCount} boards →`}
                  </button>
                </div>
              </div>
              {publishing && (
                <div style={{ marginTop: 16 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: '0.8125rem', color: '#64748B' }}>
                    <span>Inserting boards…</span>
                    <span>{publishProgress}%</span>
                  </div>
                  <div style={{ height: 8, background: '#E2E8F0', borderRadius: 4, overflow: 'hidden' }}>
                    <div style={{ height: '100%', background: '#1B4F8A', borderRadius: 4, width: `${publishProgress}%`, transition: 'width 0.3s ease' }} />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Post-publish result */}
          {publishResult && (
            <div style={{ ...cardStyle, borderColor: '#A7F3D0' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                <div style={{ width: 44, height: 44, borderRadius: '50%', background: '#ECFDF5', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>
                </div>
                <div>
                  <p style={{ fontWeight: 700, color: '#065F46', margin: '0 0 2px' }}>
                    {publishResult.inserted} boards published!
                  </p>
                  <p style={{ fontSize: '0.8125rem', color: '#64748B', margin: 0 }}>
                    {publishResult.skipped.length > 0
                      ? `${publishResult.skipped.length} rows were skipped — download the report below.`
                      : 'All selected boards were imported successfully.'}
                  </p>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <button style={{ ...btnPrimary }} onClick={() => router.push('/dashboard/owner')}>
                  View my boards →
                </button>
                {publishResult.skipped.length > 0 && (
                  <button style={btnSecondary} onClick={downloadSkipReport}>
                    Download skip report ({publishResult.skipped.length} rows)
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Confirm dialog */}
      <ConfirmDialog
        open={showConfirm}
        title={`Publish ${selectedCount} boards?`}
        description={`This will add ${selectedCount} boards to your inventory with status "available". Agencies can see them immediately. ${skipCount > 0 ? `${skipCount} invalid rows will be skipped.` : ''}`}
        confirmLabel={`Publish ${selectedCount} boards`}
        loading={publishing}
        onConfirm={() => { setShowConfirm(false); publish(); }}
        onCancel={() => setShowConfirm(false)}
      />
    </div>
  );
}
