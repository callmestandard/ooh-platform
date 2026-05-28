'use client';

import { useState, useRef, useCallback } from 'react';
import { supabase } from '@/lib/supabase';

export type CreativeUpload = {
  id: string;
  booking_id: string;
  file_url: string;
  file_name: string;
  file_size: number | null;
  mime_type: string | null;
  status: 'uploaded' | 'approved' | 'changes_requested' | 'printing' | 'live';
  notes: string | null;
  uploaded_by: string;
  created_at: string;
};

type BoardSpec = {
  id: string;
  name: string;
  format: string;
  width: number;   // metres
  height: number;  // metres
  print_width_mm: number | null;
  print_height_mm: number | null;
  illuminated: boolean;
};

type Props = {
  bookingId: string;
  board: BoardSpec;
  existing: CreativeUpload | null;
  onClose: () => void;
  onUploaded: (upload: CreativeUpload) => void;
};

const ACCEPTED_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/tiff', 'image/tif'];
const ACCEPTED_EXT   = '.pdf, .jpg, .jpeg, .png, .tif, .tiff';
const MAX_MB         = 50;

const CREATIVE_STATUS: Record<CreativeUpload['status'], { label: string; color: string; bg: string; dot: string }> = {
  uploaded:          { label: 'Uploaded — awaiting review',   color: '#92400E', bg: '#FFFBEB', dot: '#F59E0B' },
  approved:          { label: 'Approved for print',           color: '#065F46', bg: '#ECFDF5', dot: '#10B981' },
  changes_requested: { label: 'Changes requested',            color: '#7F1D1D', bg: '#FEF2F2', dot: '#EF4444' },
  printing:          { label: 'Sent to printer',              color: '#1E3A8A', bg: '#EFF6FF', dot: '#3B82F6' },
  live:              { label: 'Live on board',                color: '#065F46', bg: '#ECFDF5', dot: '#10B981' },
};

function formatBytes(bytes: number) {
  if (bytes >= 1_000_000) return (bytes / 1_000_000).toFixed(1) + ' MB';
  return Math.round(bytes / 1024) + ' KB';
}

function deriveSpecs(board: BoardSpec) {
  // If explicit print dimensions stored, use them; otherwise derive from display metres
  const pw = board.print_width_mm  ? board.print_width_mm  : Math.round((board.width  || 12) * 1000);
  const ph = board.print_height_mm ? board.print_height_mm : Math.round((board.height ||  4) * 1000);
  const bleed = 50; // standard 50mm bleed
  return { printW: pw, printH: ph, bleed };
}

export default function CreativeUploadPanel({ bookingId, board, existing, onClose, onUploaded }: Props) {
  const [dragging, setDragging] = useState(false);
  const [file, setFile]         = useState<File | null>(null);
  const [error, setError]       = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress]  = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const specs = deriveSpecs(board);

  function validate(f: File): string | null {
    if (!ACCEPTED_TYPES.includes(f.type) && !f.name.match(/\.(pdf|jpe?g|png|tiff?)$/i)) {
      return `File type not accepted. Use PDF, JPG, PNG or TIFF.`;
    }
    if (f.size > MAX_MB * 1_000_000) return `File too large. Maximum is ${MAX_MB} MB.`;
    return null;
  }

  function pickFile(f: File) {
    const err = validate(f);
    if (err) { setError(err); setFile(null); return; }
    setError(null);
    setFile(f);
  }

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) pickFile(f);
  }, []);

  async function handleUpload() {
    if (!file) return;
    setUploading(true);
    setProgress(10);

    // 1. Upload to Supabase Storage
    const path = `${bookingId}/${Date.now()}-${file.name.replace(/\s+/g, '_')}`;
    const { data: storageData, error: storageErr } = await supabase.storage
      .from('creatives')
      .upload(path, file, { contentType: file.type, upsert: false });

    if (storageErr) {
      setError(`Upload failed: ${storageErr.message}`);
      setUploading(false);
      return;
    }
    setProgress(70);

    // 2. Get public URL
    const { data: { publicUrl } } = supabase.storage.from('creatives').getPublicUrl(storageData.path);
    setProgress(85);

    // 3. Insert creative_uploads row
    const { data: upload, error: dbErr } = await supabase
      .from('creative_uploads')
      .insert({
        booking_id:  bookingId,
        file_url:    publicUrl,
        file_name:   file.name,
        file_size:   file.size,
        mime_type:   file.type,
        status:      'uploaded',
        uploaded_by: 'agency',
      })
      .select()
      .single();

    setProgress(100);

    if (dbErr) {
      setError(`Saved file but database record failed: ${dbErr.message}`);
      setUploading(false);
      return;
    }

    setUploading(false);
    onUploaded(upload as CreativeUpload);
  }

  const statusCfg = existing ? CREATIVE_STATUS[existing.status] : null;

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', justifyContent: 'flex-end' }}>
      {/* Backdrop */}
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(15,23,42,0.5)', backdropFilter: 'blur(2px)' }} onClick={onClose} />

      {/* Panel */}
      <div style={{
        position: 'relative', width: 480, background: '#fff',
        height: '100%', overflowY: 'auto',
        boxShadow: '-8px 0 40px rgba(0,0,0,0.15)',
        fontFamily: "'Inter', -apple-system, sans-serif",
        display: 'flex', flexDirection: 'column',
      }}>
        {/* Header */}
        <div style={{ padding: '20px 24px', borderBottom: '1px solid #F1F5F9', flexShrink: 0, position: 'sticky', top: 0, background: '#fff', zIndex: 1 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <h2 style={{ fontSize: '1rem', fontWeight: 700, color: '#0F172A', margin: '0 0 2px' }}>Artwork upload</h2>
              <p style={{ fontSize: '0.75rem', color: '#94A3B8', margin: 0 }}>{board.name}</p>
            </div>
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8', padding: 4, display: 'flex', borderRadius: 6 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>
        </div>

        <div style={{ padding: '20px 24px', flex: 1 }}>
          {/* Board spec card */}
          <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 10, padding: '14px 16px', marginBottom: 20 }}>
            <p style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.07em', margin: '0 0 10px' }}>Print specifications</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {[
                { label: 'Print size',      value: `${(specs.printW / 1000).toFixed(1)}m × ${(specs.printH / 1000).toFixed(1)}m` },
                { label: 'Bleed',           value: `${specs.bleed}mm all sides` },
                { label: 'Format',          value: `${board.format?.replace('_', ' ')} · ${board.illuminated ? 'Illuminated' : 'Non-illuminated'}` },
                { label: 'Accepted files',  value: 'PDF, TIFF (preferred) · JPG, PNG' },
                { label: 'Min resolution',  value: '72 DPI (OOH standard)' },
                { label: 'Max file size',   value: `${MAX_MB} MB` },
              ].map(({ label, value }) => (
                <div key={label}>
                  <p style={{ fontSize: '0.625rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 2px' }}>{label}</p>
                  <p style={{ fontSize: '0.75rem', color: '#0F172A', fontWeight: 500, margin: 0 }}>{value}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Existing upload status */}
          {existing && statusCfg && (
            <div style={{ background: statusCfg.bg, border: `1px solid ${statusCfg.dot}33`, borderRadius: 10, padding: '12px 14px', marginBottom: 20, display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: statusCfg.dot, marginTop: 3, flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: '0.75rem', fontWeight: 700, color: statusCfg.color, margin: '0 0 2px' }}>{statusCfg.label}</p>
                <p style={{ fontSize: '0.6875rem', color: statusCfg.color, margin: '0 0 4px', opacity: 0.8 }}>{existing.file_name} · {existing.file_size ? formatBytes(existing.file_size) : '—'}</p>
                {existing.notes && <p style={{ fontSize: '0.6875rem', color: statusCfg.color, margin: 0, fontStyle: 'italic' }}>Note: {existing.notes}</p>}
                <a href={existing.file_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: '0.6875rem', fontWeight: 600, color: statusCfg.color, textDecoration: 'underline' }}>
                  View current file ↗
                </a>
              </div>
            </div>
          )}

          {/* Upload area */}
          <p style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#0F172A', margin: '0 0 10px' }}>
            {existing ? 'Upload a replacement' : 'Upload artwork file'}
          </p>

          {/* Drop zone */}
          <div
            onDragOver={e => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            onClick={() => inputRef.current?.click()}
            style={{
              border: `2px dashed ${dragging ? '#1B4F8A' : file ? '#10B981' : error ? '#EF4444' : '#CBD5E1'}`,
              borderRadius: 10, padding: '32px 20px', textAlign: 'center', cursor: 'pointer',
              background: dragging ? '#EFF6FF' : file ? '#F0FDF4' : '#FAFAFA',
              transition: 'all 0.15s',
              marginBottom: 12,
            }}
          >
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPTED_EXT}
              style={{ display: 'none' }}
              onChange={e => { if (e.target.files?.[0]) pickFile(e.target.files[0]); }}
            />
            {file ? (
              <>
                <div style={{ width: 40, height: 40, background: '#ECFDF5', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 10px' }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                </div>
                <p style={{ fontSize: '0.875rem', fontWeight: 600, color: '#065F46', margin: '0 0 3px' }}>{file.name}</p>
                <p style={{ fontSize: '0.75rem', color: '#94A3B8', margin: 0 }}>{formatBytes(file.size)} · Click to change</p>
              </>
            ) : (
              <>
                <div style={{ width: 40, height: 40, background: '#F1F5F9', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 10px' }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/>
                    <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/>
                  </svg>
                </div>
                <p style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0F172A', margin: '0 0 4px' }}>Drop file here or click to browse</p>
                <p style={{ fontSize: '0.75rem', color: '#94A3B8', margin: 0 }}>PDF, TIFF, JPG, PNG · max {MAX_MB} MB</p>
              </>
            )}
          </div>

          {error && <p style={{ fontSize: '0.75rem', color: '#DC2626', margin: '0 0 12px', fontWeight: 500 }}>⚠ {error}</p>}

          {/* Upload progress */}
          {uploading && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: '0.75rem', color: '#64748B' }}>Uploading…</span>
                <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#1B4F8A' }}>{progress}%</span>
              </div>
              <div style={{ height: 4, background: '#E2E8F0', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{ height: '100%', background: '#1B4F8A', borderRadius: 2, width: `${progress}%`, transition: 'width 0.3s ease' }} />
              </div>
            </div>
          )}

          {/* Tips */}
          <div style={{ background: '#EFF6FF', borderRadius: 8, padding: '10px 12px', marginBottom: 20 }}>
            <p style={{ fontSize: '0.6875rem', color: '#1E3A8A', margin: 0, lineHeight: 1.5 }}>
              <strong>Tip:</strong> Always include {specs.bleed}mm bleed. Keep safe zone 100mm from each edge. Colours in CMYK for print, RGB for LED/digital.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: '16px 24px', borderTop: '1px solid #F1F5F9', flexShrink: 0, background: '#fff' }}>
          <button
            onClick={handleUpload}
            disabled={!file || uploading}
            style={{
              width: '100%', padding: '12px', borderRadius: 10, border: 'none',
              background: !file || uploading ? '#E2E8F0' : '#1B4F8A',
              color: !file || uploading ? '#94A3B8' : '#fff',
              fontSize: '0.875rem', fontWeight: 700, cursor: !file || uploading ? 'not-allowed' : 'pointer',
              fontFamily: 'inherit', boxShadow: file && !uploading ? '0 4px 12px rgba(27,79,138,0.25)' : 'none',
              transition: 'all 0.15s',
            }}
          >
            {uploading ? `Uploading… ${progress}%` : existing ? 'Replace artwork' : 'Upload artwork'}
          </button>
          <p style={{ fontSize: '0.6875rem', color: '#94A3B8', textAlign: 'center', margin: '8px 0 0' }}>
            Board owner will be notified to download and print
          </p>
        </div>
      </div>
    </div>
  );
}
