'use client';

import { useState, useEffect, useRef } from 'react';
import { useParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { createNotification } from '@/lib/notifications';
import { logActivity } from '@/lib/activity-log';

type BookingInfo = {
  id: string;
  status: string;
  poe_token: string;
  start_date: string;
  end_date: string;
  boards: {
    name: string;
    address: string;
    city: string;
    format: string;
    width: number;
    height: number;
  };
  campaigns: {
    id: string;
    name: string;
    client_name: string;
  };
};

const FORMAT_LABELS: Record<string, string> = {
  billboard: 'Billboard', unipole: 'Unipole', gantry: 'Gantry',
  bridge_panel: 'Bridge Panel', wall_drape: 'Wall Drape',
};

type Step = 'loading' | 'invalid' | 'already_submitted' | 'form' | 'submitting' | 'success';

export default function POEUploadPage() {
  const { token } = useParams();
  const [step, setStep] = useState<Step>('loading');
  const [booking, setBooking] = useState<BookingInfo | null>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [locationError, setLocationError] = useState('');
  const [gettingLocation, setGettingLocation] = useState(false);
  const [submitterName, setSubmitterName] = useState('');
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (token) fetchBooking();
  }, [token]);

  async function fetchBooking() {
    const { data, error } = await supabase
      .from('bookings')
      .select(`
        id, status, poe_token, start_date, end_date,
        boards (name, address, city, format, width, height),
        campaigns (id, name, client_name)
      `)
      .eq('poe_token', token)
      .single();

    if (error || !data) {
      setStep('invalid');
      return;
    }

    // Check if POE already submitted
    const { data: existing } = await supabase
      .from('compliance_checks')
      .select('id, status')
      .eq('booking_id', data.id)
      .eq('status', 'verified')
      .single();

    if (existing) {
      setStep('already_submitted');
      setBooking(data as unknown as BookingInfo);
      return;
    }

    setBooking(data as unknown as BookingInfo);
    setStep('form');
  }

  function handlePhotoSelect(file: File) {
    setPhoto(file);
    const reader = new FileReader();
    reader.onload = e => setPhotoPreview(e.target?.result as string);
    reader.readAsDataURL(file);
    setErrors(e => ({ ...e, photo: '' }));
  }

  async function getLocation() {
    setGettingLocation(true);
    setLocationError('');
    if (!navigator.geolocation) {
      setLocationError('GPS not available on this device');
      setGettingLocation(false);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      pos => {
        setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setGettingLocation(false);
        setErrors(e => ({ ...e, location: '' }));
      },
      err => {
        setLocationError('Could not get your location. Please enable GPS and try again.');
        setGettingLocation(false);
      },
      { enableHighAccuracy: true, timeout: 15000 }
    );
  }

  function validate() {
    const e: Record<string, string> = {};
    if (!photo) e.photo = 'Please take or upload a photo of the board';
    if (!location) e.location = 'GPS location is required to verify the board is live';
    if (!submitterName.trim()) e.name = 'Please enter your name';
    return e;
  }

  async function handleSubmit() {
    const e = validate();
    if (Object.keys(e).length > 0) { setErrors(e); return; }
    if (!booking) return;

    setStep('submitting');

    let photoUrl: string | null = null;

    // Upload photo to Supabase Storage if available
    if (photo) {
      const fileName = `poe/${booking.id}/${Date.now()}_${photo.name}`;
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('compliance-photos')
        .upload(fileName, photo, { upsert: true });

      if (!uploadError && uploadData) {
        const { data: urlData } = supabase.storage
          .from('compliance-photos')
          .getPublicUrl(fileName);
        photoUrl = urlData?.publicUrl || null;
      }
    }

    const { data: newCheck, error: insertError } = await supabase.from('compliance_checks').insert({
      booking_id: booking.id,
      photo_url: photoUrl,
      latitude: location?.lat,
      longitude: location?.lng,
      submitted_at: new Date().toISOString(),
      submitted_by: submitterName,
      submitted_name: submitterName,
      status: 'submitted',
      notes: notes || null,
      device_info: navigator.userAgent,
    }).select('id').single();

    if (insertError) {
      setStep('form');
      setErrors({ submit: 'Failed to submit. Please try again.' });
      return;
    }

    await supabase.from('bookings').update({ status: 'live' }).eq('id', booking.id);

    const campaignId = (booking.campaigns as { id?: string } | null)?.id ?? null;
    await logActivity({
      entityType: 'compliance_check',
      entityId: newCheck!.id,
      campaignId,
      action: 'compliance.submitted',
      summary: `POE submitted for ${booking.boards?.name || 'board'} — ${booking.campaigns?.name || 'campaign'}`,
      actorRole: 'owner',
      actorName: submitterName,
      metadata: { booking_id: booking.id },
    });
    await logActivity({
      entityType: 'booking',
      entityId: booking.id,
      campaignId,
      action: 'booking.status_changed',
      summary: `${booking.boards?.name} marked live after POE submission`,
      actorRole: 'owner',
      actorName: submitterName,
      changes: { status: { from: booking.status, to: 'live' } },
    });

    // Notify the agency that proof has been submitted
    await createNotification({
      recipientRole: 'agency',
      type: 'poe_submitted',
      title: 'POE submitted',
      body: `${booking.boards?.name} — ${booking.campaigns?.name}`,
      link: `/dashboard/agency/compliance`,
    });

    setStep('success');
  }

  // ── Shared styles ──
  const s = {
    page: {
      minHeight: '100vh',
      background: '#F8FAFC',
      fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
      WebkitFontSmoothing: 'antialiased' as const,
    } as React.CSSProperties,
    header: {
      background: '#0F172A',
      padding: '16px 20px',
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
    } as React.CSSProperties,
    container: {
      maxWidth: 480,
      margin: '0 auto',
      padding: '20px 16px 40px',
    } as React.CSSProperties,
    card: {
      background: '#fff',
      border: '1px solid #E8EDF2',
      borderRadius: '14px',
      padding: '20px',
      marginBottom: '12px',
    } as React.CSSProperties,
    label: {
      display: 'block',
      fontSize: '0.8125rem',
      fontWeight: 600,
      color: '#374151',
      marginBottom: '6px',
    } as React.CSSProperties,
    input: {
      width: '100%',
      padding: '11px 14px',
      border: '1px solid #E2E8F0',
      borderRadius: '10px',
      fontSize: '1rem',
      outline: 'none',
      fontFamily: 'inherit',
      boxSizing: 'border-box' as const,
      background: '#fff',
      color: '#0F172A',
    } as React.CSSProperties,
    error: {
      fontSize: '0.75rem',
      color: '#EF4444',
      marginTop: '4px',
      fontWeight: 500,
    } as React.CSSProperties,
    btn: {
      width: '100%',
      padding: '14px',
      borderRadius: '12px',
      border: 'none',
      fontSize: '1rem',
      fontWeight: 700,
      cursor: 'pointer',
      fontFamily: 'inherit',
      transition: 'all 0.15s',
    } as React.CSSProperties,
  };

  // ── Loading ──
  if (step === 'loading') {
    return (
      <div style={{ ...s.page, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ width: 36, height: 36, border: '3px solid #E2E8F0', borderTopColor: '#1B4F8A', borderRadius: '50%', animation: 'spin 0.7s linear infinite', margin: '0 auto 12px' }} />
          <p style={{ fontSize: '0.875rem', color: '#94A3B8', margin: 0 }}>Loading...</p>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      </div>
    );
  }

  // ── Invalid token ──
  if (step === 'invalid') {
    return (
      <div style={s.page}>
        <div style={s.header}>
          <OOHLogoSmall />
        </div>
        <div style={s.container}>
          <div style={{ ...s.card, textAlign: 'center', padding: '40px 20px' }}>
            <div style={{ width: 56, height: 56, background: '#FEF2F2', borderRadius: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#EF4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>
              </svg>
            </div>
            <h2 style={{ fontSize: '1.125rem', fontWeight: 700, color: '#0F172A', margin: '0 0 8px' }}>Invalid link</h2>
            <p style={{ fontSize: '0.875rem', color: '#64748B', margin: 0 }}>
              This link is invalid or has expired. Please contact your agency for a new link.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ── Already submitted ──
  if (step === 'already_submitted') {
    return (
      <div style={s.page}>
        <div style={s.header}>
          <OOHLogoSmall />
        </div>
        <div style={s.container}>
          <div style={{ ...s.card, textAlign: 'center', padding: '40px 20px' }}>
            <div style={{ width: 56, height: 56, background: '#ECFDF5', borderRadius: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            </div>
            <h2 style={{ fontSize: '1.125rem', fontWeight: 700, color: '#0F172A', margin: '0 0 8px' }}>Already submitted</h2>
            <p style={{ fontSize: '0.875rem', color: '#64748B', margin: '0 0 16px' }}>
              Proof of execution for <strong>{booking?.boards?.name}</strong> has already been submitted and verified.
            </p>
            <div style={{ background: '#F8FAFC', borderRadius: '10px', padding: '12px 16px', textAlign: 'left' }}>
              <p style={{ fontSize: '0.75rem', color: '#94A3B8', margin: '0 0 4px' }}>Board</p>
              <p style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0F172A', margin: 0 }}>{booking?.boards?.name}</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Success ──
  if (step === 'success') {
    return (
      <div style={s.page}>
        <div style={s.header}>
          <OOHLogoSmall />
        </div>
        <div style={s.container}>
          <div style={{ ...s.card, textAlign: 'center', padding: '48px 20px' }}>
            <div style={{ width: 72, height: 72, background: '#ECFDF5', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px', border: '3px solid #A7F3D0' }}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            </div>
            <h2 style={{ fontSize: '1.375rem', fontWeight: 800, color: '#0F172A', margin: '0 0 10px', letterSpacing: '-0.02em' }}>
              Proof submitted!
            </h2>
            <p style={{ fontSize: '0.9375rem', color: '#64748B', margin: '0 0 24px', lineHeight: 1.6 }}>
              Your proof of execution for <strong style={{ color: '#0F172A' }}>{booking?.boards?.name}</strong> has been received.
            </p>
            <div style={{ background: '#F8FAFC', borderRadius: '12px', padding: '16px', textAlign: 'left', marginBottom: '20px' }}>
              {[
                { label: 'Board', value: booking?.boards?.name },
                { label: 'Location', value: booking?.boards?.city },
                { label: 'Campaign', value: booking?.campaigns?.name },
                { label: 'Submitted by', value: submitterName },
                { label: 'GPS verified', value: location ? `${location.lat.toFixed(4)}, ${location.lng.toFixed(4)}` : '—' },
              ].map(({ label, value }) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid #F1F5F9' }}>
                  <span style={{ fontSize: '0.8125rem', color: '#94A3B8' }}>{label}</span>
                  <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#0F172A', textAlign: 'right', maxWidth: '55%' }}>{value || '—'}</span>
                </div>
              ))}
            </div>
            <p style={{ fontSize: '0.8125rem', color: '#94A3B8', margin: 0 }}>
              The agency has been notified. You can close this page.
            </p>
          </div>
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  // ── Submitting ──
  if (step === 'submitting') {
    return (
      <div style={{ ...s.page, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ width: 48, height: 48, border: '3px solid #E2E8F0', borderTopColor: '#1B4F8A', borderRadius: '50%', animation: 'spin 0.7s linear infinite', margin: '0 auto 16px' }} />
          <p style={{ fontSize: '1rem', fontWeight: 600, color: '#0F172A', margin: '0 0 4px' }}>Submitting proof...</p>
          <p style={{ fontSize: '0.875rem', color: '#94A3B8', margin: 0 }}>Uploading photo and verifying GPS location</p>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      </div>
    );
  }

  // ── Main form ──
  return (
    <div style={s.page}>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeUp { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }
        input:focus { border-color: #1B4F8A !important; box-shadow: 0 0 0 3px rgba(27,79,138,0.08); }
        textarea:focus { border-color: #1B4F8A !important; box-shadow: 0 0 0 3px rgba(27,79,138,0.08); outline: none; }
      `}</style>

      {/* Header */}
      <div style={s.header}>
        <OOHLogoSmall />
        <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
          <p style={{ fontSize: '0.6875rem', color: 'rgba(255,255,255,0.4)', margin: 0 }}>Proof of execution</p>
          <p style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.7)', margin: 0, fontWeight: 600 }}>Secure upload</p>
        </div>
      </div>

      <div style={s.container}>
        {/* Board info card */}
        <div style={{ ...s.card, background: '#0F172A', border: 'none', animation: 'fadeUp 0.3s ease' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '12px' }}>
            <div>
              <p style={{ fontSize: '0.6875rem', color: 'rgba(255,255,255,0.4)', margin: '0 0 4px', textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 600 }}>Board details</p>
              <h2 style={{ fontSize: '1.0625rem', fontWeight: 700, color: '#F8FAFC', margin: 0, letterSpacing: '-0.01em' }}>
                {booking?.boards?.name}
              </h2>
            </div>
            <span style={{ background: '#1B4F8A', color: '#93C5FD', fontSize: '0.6875rem', fontWeight: 700, padding: '3px 9px', borderRadius: '999px' }}>
              {FORMAT_LABELS[booking?.boards?.format || ''] || booking?.boards?.format}
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            {[
              { label: 'Address', value: booking?.boards?.address },
              { label: 'City', value: booking?.boards?.city },
              { label: 'Campaign', value: booking?.campaigns?.name },
              { label: 'Client', value: booking?.campaigns?.client_name },
            ].map(({ label, value }) => (
              <div key={label}>
                <p style={{ fontSize: '0.6875rem', color: 'rgba(255,255,255,0.35)', margin: '0 0 2px', fontWeight: 600 }}>{label}</p>
                <p style={{ fontSize: '0.8125rem', color: 'rgba(255,255,255,0.8)', margin: 0, fontWeight: 500 }}>{value || '—'}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Instructions */}
        <div style={{ ...s.card, background: '#FFFBEB', border: '1px solid #FDE68A' }}>
          <p style={{ fontSize: '0.8125rem', fontWeight: 700, color: '#92400E', margin: '0 0 6px' }}>
            Before you submit
          </p>
          <ul style={{ margin: 0, paddingLeft: '16px', fontSize: '0.8125rem', color: '#78350F', lineHeight: 1.7 }}>
            <li>Make sure the creative is fully deployed and visible</li>
            <li>Take a clear photo showing the full board face</li>
            <li>Enable GPS on your phone before capturing location</li>
            <li>Submit immediately after deployment — not hours later</li>
          </ul>
        </div>

        {/* Step 1: Photo */}
        <div style={{ ...s.card, animation: 'fadeUp 0.3s ease 0.05s both' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
            <div style={{ width: 24, height: 24, background: '#1B4F8A', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <span style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#fff' }}>1</span>
            </div>
            <label style={{ ...s.label, margin: 0 }}>Take a photo of the board</label>
          </div>

          {photoPreview ? (
            <div style={{ position: 'relative', marginBottom: '10px' }}>
              <img src={photoPreview} alt="Board photo" style={{ width: '100%', borderRadius: '10px', maxHeight: '280px', objectFit: 'cover' }} />
              <button
                onClick={() => { setPhoto(null); setPhotoPreview(null); }}
                style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(0,0,0,0.6)', color: '#fff', border: 'none', borderRadius: '50%', width: 28, height: 28, cursor: 'pointer', fontSize: '0.875rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                ✕
              </button>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              {/* Camera button */}
              <button
                onClick={() => cameraRef.current?.click()}
                style={{ padding: '16px 12px', background: '#0F172A', border: 'none', borderRadius: '12px', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#60A5FA" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                  <circle cx="12" cy="13" r="4"/>
                </svg>
                <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#F8FAFC' }}>Take photo</span>
                <span style={{ fontSize: '0.6875rem', color: 'rgba(255,255,255,0.4)' }}>Use camera</span>
              </button>
              {/* Upload button */}
              <button
                onClick={() => fileRef.current?.click()}
                style={{ padding: '16px 12px', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '12px', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#1B4F8A" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="17 8 12 3 7 8"/>
                  <line x1="12" y1="3" x2="12" y2="15"/>
                </svg>
                <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#0F172A' }}>Upload photo</span>
                <span style={{ fontSize: '0.6875rem', color: '#94A3B8' }}>From gallery</span>
              </button>
            </div>
          )}
          <input ref={cameraRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }}
            onChange={e => e.target.files?.[0] && handlePhotoSelect(e.target.files[0])} />
          <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }}
            onChange={e => e.target.files?.[0] && handlePhotoSelect(e.target.files[0])} />
          {errors.photo && <p style={s.error}>{errors.photo}</p>}
        </div>

        {/* Step 2: GPS */}
        <div style={{ ...s.card, animation: 'fadeUp 0.3s ease 0.1s both' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
            <div style={{ width: 24, height: 24, background: '#1B4F8A', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <span style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#fff' }}>2</span>
            </div>
            <label style={{ ...s.label, margin: 0 }}>Capture your GPS location</label>
          </div>

          {location ? (
            <div style={{ background: '#ECFDF5', border: '1px solid #A7F3D0', borderRadius: '10px', padding: '14px 16px', display: 'flex', alignItems: 'center', gap: '10px' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <polyline points="20 6 9 17 4 12"/>
              </svg>
              <div>
                <p style={{ fontSize: '0.875rem', fontWeight: 700, color: '#065F46', margin: '0 0 2px' }}>Location captured</p>
                <p style={{ fontSize: '0.75rem', color: '#059669', margin: 0, fontFamily: 'monospace' }}>
                  {location.lat.toFixed(5)}, {location.lng.toFixed(5)}
                </p>
              </div>
              <button onClick={() => setLocation(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#94A3B8', cursor: 'pointer', fontSize: '0.875rem' }}>✕</button>
            </div>
          ) : (
            <button
              onClick={getLocation}
              disabled={gettingLocation}
              style={{
                ...s.btn,
                background: gettingLocation ? '#F1F5F9' : '#0F172A',
                color: gettingLocation ? '#94A3B8' : '#F8FAFC',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px',
              }}
            >
              {gettingLocation ? (
                <>
                  <div style={{ width: 18, height: 18, border: '2px solid #CBD5E1', borderTopColor: '#1B4F8A', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
                  Getting your location...
                </>
              ) : (
                <>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10"/>
                    <line x1="12" y1="8" x2="12" y2="12"/>
                    <line x1="12" y1="16" x2="12.01" y2="16"/>
                  </svg>
                  Tap to capture GPS location
                </>
              )}
            </button>
          )}
          {locationError && <p style={{ ...s.error, marginTop: '8px' }}>{locationError}</p>}
          {errors.location && <p style={s.error}>{errors.location}</p>}
        </div>

        {/* Step 3: Your name */}
        <div style={{ ...s.card, animation: 'fadeUp 0.3s ease 0.15s both' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
            <div style={{ width: 24, height: 24, background: '#1B4F8A', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <span style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#fff' }}>3</span>
            </div>
            <label style={{ ...s.label, margin: 0 }}>Your name</label>
          </div>
          <input
            type="text"
            placeholder="e.g. Emeka Okafor"
            value={submitterName}
            onChange={e => { setSubmitterName(e.target.value); setErrors(er => ({ ...er, name: '' })); }}
            style={{ ...s.input, border: `1px solid ${errors.name ? '#EF4444' : '#E2E8F0'}`, fontSize: '1rem' }}
          />
          {errors.name && <p style={s.error}>{errors.name}</p>}
        </div>

        {/* Optional notes */}
        <div style={{ ...s.card, animation: 'fadeUp 0.3s ease 0.2s both' }}>
          <label style={{ ...s.label, display: 'flex', alignItems: 'center', gap: '6px' }}>
            Notes
            <span style={{ fontSize: '0.6875rem', color: '#94A3B8', fontWeight: 400 }}>(optional)</span>
          </label>
          <textarea
            rows={3}
            placeholder="Board condition, any issues, special notes for the agency..."
            value={notes}
            onChange={e => setNotes(e.target.value)}
            style={{ ...s.input, resize: 'none', minHeight: '80px', lineHeight: 1.5 }}
          />
        </div>

        {/* Error */}
        {errors.submit && (
          <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: '10px', padding: '12px 16px', marginBottom: '12px', fontSize: '0.875rem', color: '#7F1D1D', fontWeight: 500 }}>
            {errors.submit}
          </div>
        )}

        {/* Submit button */}
        <button
          onClick={handleSubmit}
          style={{
            ...s.btn,
            background: '#1B4F8A',
            color: '#fff',
            fontSize: '1.0625rem',
            padding: '16px',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px',
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
          Submit proof of execution
        </button>

        <p style={{ textAlign: 'center', fontSize: '0.75rem', color: '#CBD5E1', marginTop: '16px' }}>
          Secured by OOH Platform · Your submission is recorded with timestamp and GPS
        </p>
      </div>
    </div>
  );
}

function OOHLogoSmall() {
  return (
    <svg width="100" height="22" viewBox="0 0 160 36" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="2" width="28" height="18" rx="2" fill="#1B4F8A"/>
      <rect x="3" y="5" width="22" height="12" rx="1.5" fill="#0F172A"/>
      <rect x="10" y="20" width="2.5" height="6" fill="#1B4F8A"/>
      <rect x="15.5" y="20" width="2.5" height="6" fill="#1B4F8A"/>
      <rect x="34" y="6" width="24" height="16" rx="2" fill="#1B4F8A"/>
      <rect x="37" y="9" width="18" height="10" rx="1.5" fill="#0F172A"/>
      <rect x="42" y="22" width="2.5" height="6" fill="#1B4F8A"/>
      <rect x="47.5" y="22" width="2.5" height="6" fill="#1B4F8A"/>
      <rect x="64" y="2" width="4" height="28" rx="2" fill="#1B4F8A"/>
      <rect x="80" y="2" width="4" height="28" rx="2" fill="#1B4F8A"/>
      <rect x="64" y="13" width="20" height="4" rx="1" fill="#1B4F8A"/>
      <circle cx="88" cy="4" r="3" fill="#F59E0B"/>
      <text x="98" y="20" fontFamily="Georgia, serif" fontSize="18" fontWeight="700" fill="#F8FAFC" letterSpacing="-0.5">OOH</text>
      <text x="99" y="30" fontFamily="Arial, sans-serif" fontSize="6.5" fontWeight="400" fill="rgba(255,255,255,0.35)" letterSpacing="3">PLATFORM</text>
    </svg>
  );
}