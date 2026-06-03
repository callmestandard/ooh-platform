'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';

type Board = {
  id: string;
  name: string;
  format: string;
  address: string;
  city: string;
  state: string;
  width: number | null;
  height: number | null;
  face_count: number | null;
  illuminated: boolean;
  asking_rate: number;
  latitude: number | null;
  longitude: number | null;
  status: string;
  notes: string | null;
  photos: string[] | null;
  contact_phone: string | null;
};

const FORMAT_LABELS: Record<string, string> = {
  billboard: 'Billboard', unipole: 'Unipole', gantry: 'Gantry',
  bridge_panel: 'Bridge Panel', wall_drape: 'Wall Drape',
};

function formatNaira(n: number) {
  if (n >= 1_000_000) return '₦' + (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return '₦' + (n / 1_000).toFixed(0) + 'K';
  return '₦' + n.toLocaleString('en-NG');
}

export default function PublicBoardPage() {
  const { id } = useParams();
  const [board, setBoard] = useState<Board | null>(null);
  const [loading, setLoading] = useState(true);
  const [photoIdx, setPhotoIdx] = useState(0);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!id) return;
    supabase.from('boards').select('*').eq('id', id).single()
      .then(({ data }) => { setBoard(data as Board); setLoading(false); });
  }, [id]);

  function shareBoard() {
    const url = window.location.href;
    if (navigator.share) {
      navigator.share({ title: board?.name, url });
    } else {
      navigator.clipboard.writeText(url).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2500);
      });
    }
  }

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#F8FAFC' }}>
        <div style={{ width: 32, height: 32, border: '2.5px solid #E2E8F0', borderTopColor: '#1B4F8A', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (!board) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, background: '#F8FAFC', fontFamily: "'Inter', sans-serif" }}>
        <p style={{ fontSize: '1rem', color: '#64748B', fontWeight: 500 }}>Board not found</p>
        <a href="/" style={{ fontSize: '0.875rem', color: '#1B4F8A', fontWeight: 600, textDecoration: 'none' }}>← Back to OOH Platform</a>
      </div>
    );
  }

  const photos = (board.photos || []).filter(Boolean);
  const wa = board.contact_phone?.replace(/\D/g, '').replace(/^0/, '234');
  const waMsg = encodeURIComponent(`Hi, I saw your board "${board.name}" on OOH Platform and I'm interested. Can we discuss availability?`);
  const mapsUrl = board.latitude && board.longitude
    ? `https://www.google.com/maps?q=${board.latitude},${board.longitude}`
    : `https://www.google.com/maps/search/${encodeURIComponent(`${board.address}, ${board.city}`)}`;
  const isBooked = board.status === 'booked';

  return (
    <>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        *, *::before, *::after { box-sizing: border-box; }
        body { background: #F8FAFC; margin: 0; }
        .pub-btn { transition: opacity 0.15s, transform 0.15s; }
        .pub-btn:hover { opacity: 0.88; }
        .pub-btn:active { transform: scale(0.98); }
      `}</style>

      <div style={{ fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif", minHeight: '100vh', background: '#F8FAFC' }}>

        {/* ── Sticky header ── */}
        <div style={{
          position: 'sticky', top: 0, zIndex: 100,
          background: 'rgba(255,255,255,0.96)', backdropFilter: 'blur(12px)',
          borderBottom: '1px solid #F1F5F9',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 16px',
        }}>
          <a href="/" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 30, height: 30, background: '#1B4F8A', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round">
                <rect x="3" y="3" width="18" height="5" rx="1.5"/>
                <line x1="6" y1="8" x2="6" y2="21"/>
                <line x1="18" y1="8" x2="18" y2="21"/>
              </svg>
            </div>
            <span style={{ fontSize: '0.9375rem', fontWeight: 800, color: '#0F172A', letterSpacing: '-0.02em' }}>OOH Platform</span>
          </a>
          <a
            href="/auth/login"
            className="pub-btn"
            style={{
              background: '#1B4F8A', color: '#fff', borderRadius: 10,
              padding: '9px 18px', fontSize: '0.8125rem', fontWeight: 700,
              textDecoration: 'none', letterSpacing: '0.01em',
              boxShadow: '0 2px 8px rgba(27,79,138,0.25)',
            }}
          >
            Book this board
          </a>
        </div>

        {/* ── Content ── */}
        <div style={{ maxWidth: 520, margin: '0 auto', paddingBottom: 48 }}>

          {/* Photo hero */}
          <div style={{ position: 'relative', background: '#0F172A', overflow: 'hidden' }}>
            {photos.length > 0 ? (
              <img
                src={photos[photoIdx]}
                alt={board.name}
                style={{ width: '100%', height: 300, objectFit: 'cover', display: 'block' }}
              />
            ) : (
              <div style={{
                width: '100%', height: 300,
                background: 'linear-gradient(135deg, #0F172A 0%, #1B2F4A 50%, #1E3A5F 100%)',
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14,
              }}>
                <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="1.5" strokeLinecap="round">
                  <rect x="3" y="3" width="18" height="5" rx="1.5"/>
                  <line x1="6" y1="8" x2="6" y2="21"/>
                  <line x1="18" y1="8" x2="18" y2="21"/>
                </svg>
                <span style={{ color: 'rgba(255,255,255,0.25)', fontSize: '0.8125rem', fontWeight: 500 }}>No photos uploaded</span>
              </div>
            )}

            {/* Prev / Next arrows */}
            {photos.length > 1 && (
              <>
                <button
                  onClick={() => setPhotoIdx(p => (p - 1 + photos.length) % photos.length)}
                  style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', width: 36, height: 36, borderRadius: '50%', background: 'rgba(0,0,0,0.45)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5"><polyline points="15 18 9 12 15 6"/></svg>
                </button>
                <button
                  onClick={() => setPhotoIdx(p => (p + 1) % photos.length)}
                  style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', width: 36, height: 36, borderRadius: '50%', background: 'rgba(0,0,0,0.45)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5"><polyline points="9 18 15 12 9 6"/></svg>
                </button>
                {/* Dots */}
                <div style={{ position: 'absolute', bottom: 12, left: 0, right: 0, display: 'flex', justifyContent: 'center', gap: 6 }}>
                  {photos.map((_, i) => (
                    <button key={i} onClick={() => setPhotoIdx(i)} style={{
                      width: i === photoIdx ? 20 : 6, height: 6, borderRadius: 99, border: 'none', cursor: 'pointer', padding: 0,
                      background: i === photoIdx ? '#fff' : 'rgba(255,255,255,0.45)',
                      transition: 'all 0.2s',
                    }} />
                  ))}
                </div>
              </>
            )}

            {/* Booked badge */}
            {isBooked && (
              <div style={{ position: 'absolute', top: 14, right: 14, background: 'rgba(239,68,68,0.9)', backdropFilter: 'blur(6px)', color: '#fff', borderRadius: 8, padding: '5px 12px', fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.04em' }}>
                BOOKED
              </div>
            )}

            {/* Photo count chip */}
            {photos.length > 1 && (
              <div style={{ position: 'absolute', top: 14, left: 14, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(6px)', color: '#fff', borderRadius: 8, padding: '4px 10px', fontSize: '0.6875rem', fontWeight: 600 }}>
                {photoIdx + 1} / {photos.length}
              </div>
            )}
          </div>

          {/* ── Name + location ── */}
          <div style={{ background: '#fff', padding: '20px 16px 18px', borderBottom: '1px solid #F1F5F9' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
              <span style={{ background: '#EFF6FF', color: '#1D4ED8', borderRadius: 6, padding: '3px 10px', fontSize: '0.6875rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {FORMAT_LABELS[board.format] || board.format}
              </span>
              {board.illuminated && (
                <span style={{ background: '#FFFBEB', color: '#92400E', borderRadius: 6, padding: '3px 10px', fontSize: '0.6875rem', fontWeight: 700 }}>
                  ✦ Illuminated
                </span>
              )}
              {board.face_count && board.face_count > 1 && (
                <span style={{ background: '#F5F3FF', color: '#5B21B6', borderRadius: 6, padding: '3px 10px', fontSize: '0.6875rem', fontWeight: 700 }}>
                  {board.face_count} faces
                </span>
              )}
            </div>

            <h1 style={{ fontSize: '1.375rem', fontWeight: 800, color: '#0F172A', lineHeight: 1.25, marginBottom: 12, letterSpacing: '-0.025em' }}>
              {board.name}
            </h1>

            <a href={mapsUrl} target="_blank" rel="noopener noreferrer"
              style={{ display: 'inline-flex', alignItems: 'flex-start', gap: 7, textDecoration: 'none', color: '#475569' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" strokeWidth="2" style={{ flexShrink: 0, marginTop: 2 }}>
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
              </svg>
              <span style={{ fontSize: '0.875rem', lineHeight: 1.5 }}>
                {board.address}, {board.city}, {board.state}
                <span style={{ display: 'inline-block', marginLeft: 6, fontSize: '0.75rem', color: '#1B4F8A', fontWeight: 600 }}>View on map ↗</span>
              </span>
            </a>
          </div>

          {/* ── Rate + CTA ── */}
          <div style={{ background: '#fff', padding: '16px', borderBottom: '1px solid #F1F5F9', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
            <div>
              <p style={{ fontSize: '0.625rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 3 }}>Asking rate</p>
              <p style={{ fontSize: '1.625rem', fontWeight: 800, color: '#0F172A', letterSpacing: '-0.03em', lineHeight: 1, fontFamily: "'DM Mono', 'Courier New', monospace" }}>
                {formatNaira(board.asking_rate)}
                <span style={{ fontSize: '0.875rem', fontWeight: 500, color: '#94A3B8', letterSpacing: 0, fontFamily: 'inherit' }}>/mo</span>
              </p>
            </div>
            <a href="/auth/login" className="pub-btn" style={{
              background: isBooked ? '#94A3B8' : '#1B4F8A',
              color: '#fff', borderRadius: 12, padding: '13px 22px',
              fontSize: '0.9375rem', fontWeight: 700, textDecoration: 'none',
              flexShrink: 0, letterSpacing: '0.01em',
              boxShadow: isBooked ? 'none' : '0 4px 16px rgba(27,79,138,0.3)',
              pointerEvents: isBooked ? 'none' : 'auto',
            }}>
              {isBooked ? 'Currently booked' : 'Book this board'}
            </a>
          </div>

          {/* ── Details grid ── */}
          <div style={{ background: '#fff', margin: '8px 0', borderTop: '1px solid #F1F5F9', borderBottom: '1px solid #F1F5F9' }}>
            <p style={{ padding: '14px 16px 0', fontSize: '0.625rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
              Board details
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', padding: '4px 16px 12px' }}>
              {[
                { label: 'Dimensions', value: board.width && board.height ? `${board.width}m × ${board.height}m` : '—' },
                { label: 'Format',     value: FORMAT_LABELS[board.format] || board.format },
                { label: 'Faces',      value: board.face_count ? String(board.face_count) : '1' },
                { label: 'Illuminated', value: board.illuminated ? 'Yes ✦' : 'No' },
                { label: 'City',       value: board.city },
                { label: 'State',      value: board.state },
              ].map(({ label, value }) => (
                <div key={label} style={{ padding: '10px 0', borderBottom: '1px solid #F8FAFC' }}>
                  <p style={{ fontSize: '0.6875rem', color: '#94A3B8', marginBottom: 3 }}>{label}</p>
                  <p style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#0F172A' }}>{value}</p>
                </div>
              ))}
            </div>
          </div>

          {/* ── Notes ── */}
          {board.notes && (
            <div style={{ background: '#fff', padding: '16px', borderBottom: '1px solid #F1F5F9', margin: '0 0 8px' }}>
              <p style={{ fontSize: '0.625rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10 }}>About this board</p>
              <p style={{ fontSize: '0.9375rem', color: '#334155', lineHeight: 1.7, fontStyle: 'italic' }}>"{board.notes}"</p>
            </div>
          )}

          {/* ── Action buttons ── */}
          <div style={{ padding: '8px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {board.contact_phone && (
              <a href={`https://wa.me/${wa}?text=${waMsg}`} target="_blank" rel="noopener noreferrer" className="pub-btn"
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                  background: '#25D366', color: '#fff', borderRadius: 12, padding: '15px',
                  fontSize: '0.9375rem', fontWeight: 700, textDecoration: 'none',
                }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                </svg>
                WhatsApp the owner
              </a>
            )}

            <button onClick={shareBoard} className="pub-btn"
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                background: copied ? '#ECFDF5' : '#fff',
                color: copied ? '#065F46' : '#1B4F8A',
                border: `1.5px solid ${copied ? '#6EE7B7' : '#BFDBFE'}`,
                borderRadius: 12, padding: '14px', fontSize: '0.9375rem', fontWeight: 700,
                cursor: 'pointer', fontFamily: 'inherit', width: '100%',
                transition: 'all 0.2s',
              }}>
              {copied ? (
                <>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                  Link copied!
                </>
              ) : (
                <>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
                  Share this board
                </>
              )}
            </button>
          </div>

          {/* ── Footer ── */}
          <div style={{ padding: '24px 16px 8px', textAlign: 'center' }}>
            <p style={{ fontSize: '0.75rem', color: '#CBD5E1', lineHeight: 1.6 }}>
              Listed on{' '}
              <a href="/" style={{ color: '#1B4F8A', fontWeight: 600, textDecoration: 'none' }}>OOH Platform</a>
              {' '}· Nigeria&rsquo;s outdoor advertising marketplace
            </p>
          </div>

        </div>
      </div>
    </>
  );
}
