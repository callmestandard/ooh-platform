'use client';

import { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { supabase } from '@/lib/supabase';
import type { CreativeUpload } from '@/components/creatives/CreativeUploadPanel';

const CreativeUploadPanel = dynamic(() => import('@/components/creatives/CreativeUploadPanel'), { ssr: false });

// ── Types ─────────────────────────────────────────────────────────────────────

type Campaign = { id: string; name: string; client_name: string | null; status: string };

type Booking = {
  id: string;
  campaign_id: string;
  status: string;
  offered_rate: number;
  start_date: string;
  end_date: string;
  boards: {
    id: string;
    name: string;
    city: string;
    state: string | null;
    format: string;
    width: number | null;
    height: number | null;
    illuminated: boolean;
  };
  campaigns: { name: string; client_name: string | null };
  creative?: CreativeUpload | null;
};

type ViewMode = 'grid' | 'list';

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUS_CFG: Record<string, { label: string; color: string; bg: string; dot: string }> = {
  uploaded:          { label: 'Awaiting review',   color: '#92400E', bg: '#FFFBEB', dot: '#F59E0B' },
  approved:          { label: 'Approved',           color: '#065F46', bg: '#ECFDF5', dot: '#10B981' },
  changes_requested: { label: 'Changes requested',  color: '#7F1D1D', bg: '#FEF2F2', dot: '#EF4444' },
  printing:          { label: 'Sent to printer',    color: '#1E3A8A', bg: '#EFF6FF', dot: '#3B82F6' },
  live:              { label: 'Live',               color: '#065F46', bg: '#ECFDF5', dot: '#10B981' },
  missing:           { label: 'No artwork',         color: '#475569', bg: '#F1F5F9', dot: '#94A3B8' },
};

const FORMAT_LABELS: Record<string, string> = {
  billboard: 'Billboard', unipole: 'Unipole', gantry: 'Gantry',
  bridge_panel: 'Bridge Panel', wall_drape: 'Wall Drape',
};

function formatBytes(bytes: number) {
  if (bytes >= 1_000_000) return (bytes / 1_000_000).toFixed(1) + ' MB';
  return Math.round(bytes / 1024) + ' KB';
}

function timeAgo(d: string) {
  const secs = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (secs < 60) return 'just now';
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

// ── Billboard mockup ──────────────────────────────────────────────────────────

function BillboardMockup({ imageUrl, format, name, city }: { imageUrl?: string | null; format: string; name: string; city: string }) {
  const isLandscape = !['unipole', 'wall_drape'].includes(format);
  return (
    <div style={{ position: 'relative', display: 'inline-flex', flexDirection: 'column', alignItems: 'center' }}>
      {/* Structure pole/base */}
      <div style={{
        width: isLandscape ? 280 : 160,
        height: isLandscape ? 140 : 220,
        background: imageUrl ? 'transparent' : '#E2E8F0',
        border: '3px solid #94A3B8',
        borderRadius: 4,
        overflow: 'hidden',
        position: 'relative',
        boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
      }}>
        {imageUrl ? (
          <img src={imageUrl} alt={name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 8 }}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#CBD5E1" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>
            </svg>
            <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: 0, textAlign: 'center', padding: '0 8px' }}>No artwork uploaded</p>
          </div>
        )}
        {/* Screen glare overlay */}
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '30%', background: 'linear-gradient(135deg, rgba(255,255,255,0.15) 0%, transparent 100%)', pointerEvents: 'none' }} />
      </div>
      {/* Pole */}
      {isLandscape && (
        <div style={{ width: 8, height: 32, background: '#64748B', borderRadius: '0 0 2px 2px' }} />
      )}
      {/* Label */}
      <div style={{ marginTop: 8, textAlign: 'center' }}>
        <p style={{ fontSize: '0.75rem', fontWeight: 600, color: '#0F172A', margin: '0 0 1px' }}>{name}</p>
        <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: 0 }}>{city} · {FORMAT_LABELS[format] || format}</p>
      </div>
    </div>
  );
}

// ── Creative card ─────────────────────────────────────────────────────────────

function CreativeCard({ booking, onUpload, onPreview }: {
  booking: Booking;
  onUpload: (b: Booking) => void;
  onPreview: (url: string) => void;
}) {
  const creative = booking.creative;
  const status = creative ? creative.status : 'missing';
  const cfg = STATUS_CFG[status] || STATUS_CFG.missing;
  const isImage = creative?.mime_type?.startsWith('image/');

  return (
    <div style={{
      background: '#fff', border: '1px solid #E8EDF2', borderRadius: 12, overflow: 'hidden',
      transition: 'box-shadow 0.15s', borderTop: `3px solid ${cfg.dot}`,
    }}
      onMouseEnter={e => (e.currentTarget as HTMLElement).style.boxShadow = '0 4px 16px rgba(0,0,0,0.08)'}
      onMouseLeave={e => (e.currentTarget as HTMLElement).style.boxShadow = 'none'}
    >
      {/* Preview area */}
      <div style={{ height: 140, background: '#F8FAFC', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', overflow: 'hidden' }}>
        {creative && isImage ? (
          <>
            <img
              src={creative.file_url}
              alt={creative.file_name}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
            <button
              onClick={() => onPreview(creative.file_url)}
              style={{
                position: 'absolute', inset: 0, background: 'rgba(15,23,42,0)', border: 'none', cursor: 'zoom-in',
                display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background 0.15s',
              }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'rgba(15,23,42,0.45)'}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'rgba(15,23,42,0)'}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0 }}
                onMouseEnter={e => (e.currentTarget as SVGElement).style.opacity = '1'}
              >
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                <line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/>
              </svg>
            </button>
          </>
        ) : creative ? (
          <div style={{ textAlign: 'center' }}>
            <div style={{ width: 48, height: 48, background: '#EFF6FF', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 8px' }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#1B4F8A" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
              </svg>
            </div>
            <p style={{ fontSize: '0.75rem', fontWeight: 600, color: '#1B4F8A', margin: '0 0 2px' }}>PDF Artwork</p>
            <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: 0 }}>{creative.file_name}</p>
          </div>
        ) : (
          <div style={{ textAlign: 'center' }}>
            <div style={{ width: 48, height: 48, background: '#F1F5F9', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 8px' }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>
              </svg>
            </div>
            <p style={{ fontSize: '0.75rem', color: '#94A3B8', margin: 0 }}>No artwork yet</p>
          </div>
        )}
      </div>

      {/* Card body */}
      <div style={{ padding: '12px 14px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: '0.875rem', fontWeight: 700, color: '#0F172A', margin: '0 0 2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {booking.boards?.name}
            </p>
            <p style={{ fontSize: '0.75rem', color: '#94A3B8', margin: 0 }}>
              {booking.boards?.city}{booking.boards?.state ? `, ${booking.boards.state}` : ''} · {FORMAT_LABELS[booking.boards?.format] || booking.boards?.format}
            </p>
          </div>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: cfg.bg, color: cfg.color, padding: '3px 8px', borderRadius: 999, fontSize: '0.625rem', fontWeight: 700, flexShrink: 0, whiteSpace: 'nowrap' }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: cfg.dot }} />
            {cfg.label}
          </span>
        </div>

        {creative && (
          <div style={{ background: '#F8FAFC', borderRadius: 7, padding: '8px 10px', marginBottom: 10, fontSize: '0.6875rem', color: '#64748B' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>{creative.file_name.length > 24 ? creative.file_name.slice(0, 24) + '…' : creative.file_name}</span>
              <span>{creative.file_size ? formatBytes(creative.file_size) : '—'}</span>
            </div>
            <div style={{ color: '#94A3B8', marginTop: 2 }}>Uploaded {timeAgo(creative.created_at)}</div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 6 }}>
          <button
            onClick={() => onUpload(booking)}
            style={{
              flex: 1, padding: '8px 0', border: '1px solid #E2E8F0',
              borderRadius: 7, fontSize: '0.8125rem', fontWeight: 600,
              background: creative ? '#F8FAFC' : '#1B4F8A',
              color: creative ? '#0F172A' : '#fff',
              cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.15s',
            }}
            onMouseEnter={e => {
              const el = e.currentTarget as HTMLElement;
              if (!creative) el.style.background = '#163E6D';
              else { el.style.background = '#F1F5F9'; el.style.borderColor = '#CBD5E1'; }
            }}
            onMouseLeave={e => {
              const el = e.currentTarget as HTMLElement;
              if (!creative) el.style.background = '#1B4F8A';
              else { el.style.background = '#F8FAFC'; el.style.borderColor = '#E2E8F0'; }
            }}
          >
            {creative ? 'Replace artwork' : 'Upload artwork'}
          </button>
          {creative && (
            <a
              href={creative.file_url}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                padding: '8px 12px', border: '1px solid #E2E8F0', borderRadius: 7,
                fontSize: '0.8125rem', fontWeight: 600, color: '#1B4F8A',
                background: '#fff', cursor: 'pointer', textDecoration: 'none',
                display: 'flex', alignItems: 'center', gap: 4,
              }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
              </svg>
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

// ── List row ──────────────────────────────────────────────────────────────────

function CreativeRow({ booking, onUpload, onPreview }: { booking: Booking; onUpload: (b: Booking) => void; onPreview: (url: string) => void }) {
  const creative = booking.creative;
  const status = creative ? creative.status : 'missing';
  const cfg = STATUS_CFG[status] || STATUS_CFG.missing;
  const isImage = creative?.mime_type?.startsWith('image/');

  return (
    <tr
      style={{ borderBottom: '1px solid #F8FAFC', transition: 'background 0.1s' }}
      onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = '#FAFBFF'}
      onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
    >
      {/* Thumbnail */}
      <td style={{ padding: '10px 16px' }}>
        <div style={{ width: 56, height: 36, borderRadius: 6, overflow: 'hidden', background: '#F1F5F9', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {creative && isImage ? (
            <img src={creative.file_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', cursor: 'zoom-in' }} onClick={() => onPreview(creative.file_url)} />
          ) : creative ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#CBD5E1" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>
            </svg>
          )}
        </div>
      </td>
      <td style={{ padding: '10px 8px 10px 0' }}>
        <p style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0F172A', margin: '0 0 2px' }}>{booking.boards?.name}</p>
        <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: 0 }}>{booking.boards?.city} · {FORMAT_LABELS[booking.boards?.format] || booking.boards?.format}</p>
      </td>
      <td style={{ padding: '10px 16px' }}>
        <p style={{ fontSize: '0.8125rem', color: '#475569', margin: 0 }}>{booking.campaigns?.name}</p>
      </td>
      <td style={{ padding: '10px 16px', fontSize: '0.8125rem', color: '#94A3B8', whiteSpace: 'nowrap' }}>
        {creative ? creative.file_name.slice(0, 20) + (creative.file_name.length > 20 ? '…' : '') : '—'}
      </td>
      <td style={{ padding: '10px 16px' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: cfg.bg, color: cfg.color, padding: '3px 9px', borderRadius: 999, fontSize: '0.6875rem', fontWeight: 600, whiteSpace: 'nowrap' }}>
          <span style={{ width: 5, height: 5, borderRadius: '50%', background: cfg.dot }} />
          {cfg.label}
        </span>
      </td>
      <td style={{ padding: '10px 16px', fontSize: '0.75rem', color: '#94A3B8', whiteSpace: 'nowrap' }}>
        {creative ? timeAgo(creative.created_at) : '—'}
      </td>
      <td style={{ padding: '10px 16px' }}>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            onClick={() => onUpload(booking)}
            style={{ padding: '5px 12px', background: creative ? '#F8FAFC' : '#1B4F8A', color: creative ? '#0F172A' : '#fff', border: `1px solid ${creative ? '#E2E8F0' : 'transparent'}`, borderRadius: 6, fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}
          >
            {creative ? 'Replace' : 'Upload'}
          </button>
          {creative && (
            <a href={creative.file_url} target="_blank" rel="noopener noreferrer"
              style={{ padding: '5px 10px', background: '#EFF6FF', color: '#1B4F8A', border: 'none', borderRadius: 6, fontSize: '0.75rem', fontWeight: 600, textDecoration: 'none', display: 'flex', alignItems: 'center' }}>
              View
            </a>
          )}
        </div>
      </td>
    </tr>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function CreativesPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCampaign, setSelectedCampaign] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [uploadTarget, setUploadTarget] = useState<Booking | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [previewBooking, setPreviewBooking] = useState<Booking | null>(null);

  useEffect(() => { fetchData(); }, []);

  async function fetchData() {
    const [campRes, bookRes] = await Promise.all([
      supabase.from('campaigns').select('id, name, client_name, status').order('created_at', { ascending: false }),
      supabase.from('bookings')
        .select('id, campaign_id, status, offered_rate, start_date, end_date, boards(id, name, city, state, format, width, height, illuminated), campaigns(name, client_name)')
        .order('created_at', { ascending: false }),
    ]);

    const campList = (campRes.data as Campaign[]) || [];
    const bookList = (bookRes.data as unknown as Booking[]) || [];

    setCampaigns(campList);

    // Fetch creatives for all bookings
    if (bookList.length > 0) {
      const { data: creativeData } = await supabase
        .from('creative_uploads')
        .select('*')
        .in('booking_id', bookList.map(b => b.id))
        .order('created_at', { ascending: false });

      const creativeMap: Record<string, CreativeUpload> = {};
      (creativeData || []).forEach((c: CreativeUpload) => {
        if (!creativeMap[c.booking_id]) creativeMap[c.booking_id] = c;
      });

      setBookings(bookList.map(b => ({ ...b, creative: creativeMap[b.id] || null })));
    } else {
      setBookings([]);
    }

    setLoading(false);
  }

  function handleUploaded(upload: CreativeUpload) {
    setBookings(prev => prev.map(b => b.id === upload.booking_id ? { ...b, creative: upload } : b));
    setUploadTarget(null);
  }

  // Filtered bookings
  const filtered = bookings.filter(b => {
    if (selectedCampaign !== 'all' && b.campaign_id !== selectedCampaign) return false;
    if (selectedStatus === 'missing' && b.creative) return false;
    if (selectedStatus !== 'all' && selectedStatus !== 'missing' && b.creative?.status !== selectedStatus) return false;
    return true;
  });

  const missingCount = bookings.filter(b => !b.creative).length;
  const approvedCount = bookings.filter(b => b.creative?.status === 'approved').length;
  const pendingCount = bookings.filter(b => b.creative?.status === 'uploaded').length;
  const changesCount = bookings.filter(b => b.creative?.status === 'changes_requested').length;

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '50vh' }}>
        <div style={{ width: 28, height: 28, border: '2px solid #E2E8F0', borderTopColor: '#1B4F8A', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return (
    <div style={{ fontFamily: "'Inter', -apple-system, sans-serif" }}>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeUp { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:translateY(0); } }
      `}</style>

      {/* Lightbox */}
      {lightbox && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => setLightbox(null)}
        >
          <img src={lightbox} alt="Creative preview" style={{ maxWidth: '90vw', maxHeight: '90vh', objectFit: 'contain', borderRadius: 8, boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }} />
          <button
            onClick={() => setLightbox(null)}
            style={{ position: 'absolute', top: 20, right: 20, background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff', width: 40, height: 40, borderRadius: '50%', cursor: 'pointer', fontSize: '1.125rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Billboard preview panel */}
      {previewBooking && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex' }}>
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(15,23,42,0.5)' }} onClick={() => setPreviewBooking(null)} />
          <div style={{ position: 'relative', width: 480, background: '#fff', height: '100%', marginLeft: 'auto', overflowY: 'auto', boxShadow: '-8px 0 40px rgba(0,0,0,0.15)', fontFamily: 'inherit', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '20px 24px', borderBottom: '1px solid #F1F5F9', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ fontSize: '1rem', fontWeight: 700, color: '#0F172A', margin: '0 0 2px' }}>Billboard preview</h3>
                <p style={{ fontSize: '0.75rem', color: '#94A3B8', margin: 0 }}>{previewBooking.boards?.name}</p>
              </div>
              <button onClick={() => setPreviewBooking(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8', padding: 4 }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div style={{ flex: 1, padding: '32px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 24, background: '#F8FAFC' }}>
              <BillboardMockup
                imageUrl={previewBooking.creative?.file_url}
                format={previewBooking.boards?.format}
                name={previewBooking.boards?.name}
                city={previewBooking.boards?.city}
              />
              <div style={{ width: '100%', background: '#fff', border: '1px solid #E8EDF2', borderRadius: 12, padding: '16px 20px' }}>
                <p style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.07em', margin: '0 0 12px' }}>Board details</p>
                {[
                  { label: 'Format', value: FORMAT_LABELS[previewBooking.boards?.format] || previewBooking.boards?.format },
                  { label: 'Location', value: `${previewBooking.boards?.city}${previewBooking.boards?.state ? `, ${previewBooking.boards.state}` : ''}` },
                  { label: 'Campaign', value: previewBooking.campaigns?.name },
                  { label: 'Artwork status', value: STATUS_CFG[previewBooking.creative?.status || 'missing']?.label },
                ].map(({ label, value }) => (
                  <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid #F8FAFC' }}>
                    <span style={{ fontSize: '0.8125rem', color: '#94A3B8' }}>{label}</span>
                    <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#0F172A' }}>{value}</span>
                  </div>
                ))}
              </div>
              <button
                onClick={() => { setPreviewBooking(null); setUploadTarget(previewBooking); }}
                style={{ width: '100%', padding: '12px', background: '#1B4F8A', color: '#fff', border: 'none', borderRadius: 10, fontSize: '0.875rem', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}
              >
                {previewBooking.creative ? 'Replace artwork' : 'Upload artwork'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Upload panel */}
      {uploadTarget && (
        <CreativeUploadPanel
          bookingId={uploadTarget.id}
          board={{
            id: uploadTarget.boards?.id || uploadTarget.id,
            name: uploadTarget.boards?.name || 'Unknown board',
            format: uploadTarget.boards?.format || 'billboard',
            width: uploadTarget.boards?.width || 12,
            height: uploadTarget.boards?.height || 4,
            print_width_mm: null,
            print_height_mm: null,
            illuminated: uploadTarget.boards?.illuminated || false,
          }}
          existing={uploadTarget.creative || null}
          onClose={() => setUploadTarget(null)}
          onUploaded={handleUploaded}
        />
      )}

      {/* Page header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1.75rem' }}>
        <div>
          <h1 style={{ fontSize: '1.375rem', fontWeight: 700, color: '#0F172A', letterSpacing: '-0.025em', margin: '0 0 4px' }}>Creative management</h1>
          <p style={{ fontSize: '0.8125rem', color: '#94A3B8', margin: 0 }}>Upload and manage ad artwork for every booked billboard.</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {/* View toggle */}
          <div style={{ display: 'flex', background: '#F1F5F9', borderRadius: 8, padding: 3 }}>
            {(['grid', 'list'] as ViewMode[]).map(mode => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                style={{
                  padding: '5px 10px', borderRadius: 6, border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                  background: viewMode === mode ? '#fff' : 'transparent',
                  color: viewMode === mode ? '#0F172A' : '#64748B',
                  boxShadow: viewMode === mode ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                  display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.8125rem', fontWeight: viewMode === mode ? 600 : 400,
                }}
              >
                {mode === 'grid' ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
                  </svg>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/>
                    <line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>
                  </svg>
                )}
                {mode.charAt(0).toUpperCase() + mode.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* KPI summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: '1.5rem' }}>
        {[
          { label: 'Total boards', value: bookings.length, sub: 'Across all campaigns', bar: '#1B4F8A', filter: 'all' },
          { label: 'Missing artwork', value: missingCount, sub: 'Need upload', bar: '#EF4444', filter: 'missing' },
          { label: 'Awaiting review', value: pendingCount, sub: 'Pending approval', bar: '#F59E0B', filter: 'uploaded' },
          { label: 'Approved', value: approvedCount, sub: 'Ready to print', bar: '#10B981', filter: 'approved' },
        ].map(card => (
          <button
            key={card.filter}
            onClick={() => setSelectedStatus(selectedStatus === card.filter ? 'all' : card.filter)}
            style={{
              background: selectedStatus === card.filter ? '#F8FAFC' : '#fff',
              border: `1px solid ${selectedStatus === card.filter ? card.bar : '#E8EDF2'}`,
              borderRadius: 12, padding: '16px 18px', textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit',
              outline: 'none', transition: 'all 0.15s',
            }}
          >
            <p style={{ fontSize: '0.6875rem', fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.07em', margin: '0 0 8px' }}>{card.label}</p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ display: 'block', width: 3, height: 26, background: card.bar, borderRadius: 2 }} />
              <span style={{ fontSize: '1.75rem', fontWeight: 800, color: '#0F172A', fontFamily: 'monospace', letterSpacing: '-0.03em' }}>{card.value}</span>
            </div>
            <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: '4px 0 0' }}>{card.sub}</p>
          </button>
        ))}
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, marginBottom: '1.25rem', alignItems: 'center' }}>
        <select
          value={selectedCampaign}
          onChange={e => setSelectedCampaign(e.target.value)}
          style={{ padding: '7px 12px', border: '1.5px solid #E2E8F0', borderRadius: 8, fontSize: '0.8125rem', color: '#0F172A', outline: 'none', background: '#fff', fontFamily: 'inherit', cursor: 'pointer', minWidth: 200 }}
        >
          <option value="all">All campaigns</option>
          {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>

        <div style={{ display: 'flex', gap: 4, background: '#F1F5F9', padding: 3, borderRadius: 8 }}>
          {[
            { key: 'all', label: `All (${bookings.length})` },
            { key: 'missing', label: `Missing (${missingCount})` },
            { key: 'uploaded', label: `Pending (${pendingCount})` },
            { key: 'approved', label: `Approved (${approvedCount})` },
            { key: 'changes_requested', label: `Changes (${changesCount})` },
          ].map(f => (
            <button
              key={f.key}
              onClick={() => setSelectedStatus(f.key)}
              style={{
                padding: '5px 12px', borderRadius: 6, border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                background: selectedStatus === f.key ? '#fff' : 'transparent',
                color: selectedStatus === f.key ? '#0F172A' : '#64748B',
                fontSize: '0.8125rem', fontWeight: selectedStatus === f.key ? 600 : 400,
                boxShadow: selectedStatus === f.key ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
              }}
            >
              {f.label}
            </button>
          ))}
        </div>

        <p style={{ fontSize: '0.8125rem', color: '#94A3B8', margin: '0 0 0 auto' }}>
          Showing {filtered.length} of {bookings.length} boards
        </p>
      </div>

      {/* Changes needed alert */}
      {changesCount > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 10, padding: '12px 16px', marginBottom: '1.25rem' }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#DC2626" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          <p style={{ fontSize: '0.875rem', fontWeight: 600, color: '#991B1B', margin: 0 }}>
            {changesCount} artwork{changesCount > 1 ? 's' : ''} need changes — review the board owner&apos;s feedback and re-upload.
          </p>
          <button onClick={() => setSelectedStatus('changes_requested')} style={{ marginLeft: 'auto', fontSize: '0.75rem', fontWeight: 600, color: '#DC2626', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
            View flagged →
          </button>
        </div>
      )}

      {/* Empty state */}
      {filtered.length === 0 && (
        <div style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: 14, padding: '5rem', textAlign: 'center' }}>
          {bookings.length === 0 ? (
            <>
              <div style={{ width: 56, height: 56, background: '#F1F5F9', borderRadius: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>
                </svg>
              </div>
              <p style={{ fontSize: '1rem', fontWeight: 700, color: '#0F172A', margin: '0 0 6px' }}>No bookings yet</p>
              <p style={{ fontSize: '0.8125rem', color: '#94A3B8', margin: 0 }}>Book boards in the Boards Map or Campaign Planner to start uploading artwork.</p>
            </>
          ) : (
            <>
              <p style={{ fontSize: '1rem', fontWeight: 700, color: '#0F172A', margin: '0 0 6px' }}>No results</p>
              <p style={{ fontSize: '0.8125rem', color: '#94A3B8', margin: '0 0 16px' }}>Try a different filter.</p>
              <button onClick={() => { setSelectedCampaign('all'); setSelectedStatus('all'); }} style={{ background: '#1B4F8A', color: '#fff', border: 'none', padding: '8px 18px', borderRadius: 8, fontSize: '0.8125rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                Clear filters
              </button>
            </>
          )}
        </div>
      )}

      {/* Grid view */}
      {viewMode === 'grid' && filtered.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 14 }}>
          {filtered.map((booking, i) => (
            <div key={booking.id} style={{ animation: `fadeUp 0.2s ease ${i * 0.03}s both` }}>
              <CreativeCard
                booking={booking}
                onUpload={setUploadTarget}
                onPreview={setLightbox}
              />
            </div>
          ))}
        </div>
      )}

      {/* List view */}
      {viewMode === 'list' && filtered.length > 0 && (
        <div style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: 12, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#F8FAFC' }}>
                {['', 'Board', 'Campaign', 'File', 'Status', 'Uploaded', 'Action'].map(h => (
                  <th key={h} style={{ padding: '10px 16px', fontSize: '0.6875rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.07em', textAlign: 'left', borderBottom: '1px solid #F1F5F9', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((booking, i) => (
                <CreativeRow key={booking.id} booking={booking} onUpload={setUploadTarget} onPreview={setLightbox} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
