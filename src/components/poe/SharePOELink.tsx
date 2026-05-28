'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabase';

type Props = {
  bookingId: string;
  boardName: string;
  variant?: 'button' | 'inline';
};

export default function SharePOELink({ bookingId, boardName, variant = 'button' }: Props) {
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [link, setLink] = useState('');

  async function generateAndShare() {
    setLoading(true);

    // Get the poe_token for this booking
    let { data, error } = await supabase
      .from('bookings')
      .select('poe_token')
      .eq('id', bookingId)
      .single();

    if (error) {
      setLoading(false);
      return;
    }

    // Generate and persist a token if one doesn't exist yet
    if (!data?.poe_token) {
      const newToken = crypto.randomUUID();
      const { error: updateError } = await supabase
        .from('bookings')
        .update({ poe_token: newToken })
        .eq('id', bookingId);
      if (updateError) {
        setLoading(false);
        return;
      }
      data = { poe_token: newToken };
    }

    const url = `${window.location.origin}/poe/${data.poe_token}`;
    setLink(url);

    // Try to copy to clipboard
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    } catch {
      // Clipboard failed — show the link manually
    }

    setLoading(false);
  }

  function shareOnWhatsApp() {
    if (!link) return;
    const msg = encodeURIComponent(
      `Hi! Please submit your proof of execution (POE) for *${boardName}* using this link:\n\n${link}\n\nTake a clear photo of the board and capture your GPS location. Thank you.`
    );
    window.open(`https://wa.me/?text=${msg}`, '_blank');
  }

  if (variant === 'inline') {
    return (
      <div style={{ fontFamily: "'Inter', -apple-system, sans-serif" }}>
        {!link ? (
          <button
            onClick={generateAndShare}
            disabled={loading}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '6px',
              background: '#ECFDF5', color: '#065F46',
              border: '1px solid #A7F3D0', borderRadius: '7px',
              padding: '6px 12px', fontSize: '0.75rem', fontWeight: 600,
              cursor: loading ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
            }}
          >
            {loading ? (
              <div style={{ width: 12, height: 12, border: '2px solid #A7F3D0', borderTopColor: '#10B981', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
            ) : (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
              </svg>
            )}
            {loading ? 'Generating...' : 'Get POE link'}
          </button>
        ) : (
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              onClick={shareOnWhatsApp}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '5px',
                background: '#25D366', color: '#fff',
                border: 'none', borderRadius: '7px',
                padding: '6px 12px', fontSize: '0.75rem', fontWeight: 600,
                cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
              Share on WhatsApp
            </button>
            <button
              onClick={async () => { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '5px',
                background: copied ? '#ECFDF5' : '#F8FAFC',
                color: copied ? '#065F46' : '#475569',
                border: `1px solid ${copied ? '#A7F3D0' : '#E2E8F0'}`,
                borderRadius: '7px', padding: '6px 10px',
                fontSize: '0.75rem', fontWeight: 600,
                cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              {copied ? '✓ Copied' : 'Copy link'}
            </button>
          </div>
        )}
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  // Full button variant
  return (
    <div style={{ fontFamily: "'Inter', -apple-system, sans-serif" }}>
      {!link ? (
        <button
          onClick={generateAndShare}
          disabled={loading}
          style={{
            display: 'flex', alignItems: 'center', gap: '8px',
            background: '#1B4F8A', color: '#fff',
            border: 'none', borderRadius: '9px',
            padding: '10px 18px', fontSize: '0.8125rem', fontWeight: 600,
            cursor: loading ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
            width: '100%', justifyContent: 'center',
          }}
        >
          {loading ? (
            <div style={{ width: 16, height: 16, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
            </svg>
          )}
          {loading ? 'Generating link...' : 'Generate POE upload link'}
        </button>
      ) : (
        <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '10px', padding: '14px' }}>
          <p style={{ fontSize: '0.75rem', fontWeight: 600, color: '#374151', margin: '0 0 8px' }}>
            POE link ready — share with media partner:
          </p>
          <div style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: '7px', padding: '8px 12px', marginBottom: '10px', wordBreak: 'break-all' }}>
            <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: 0, fontFamily: 'monospace' }}>{link}</p>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={shareOnWhatsApp}
              style={{
                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                background: '#25D366', color: '#fff', border: 'none', borderRadius: '8px',
                padding: '10px', fontSize: '0.8125rem', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
              Share on WhatsApp
            </button>
            <button
              onClick={async () => { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
              style={{
                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                background: copied ? '#ECFDF5' : '#fff',
                color: copied ? '#065F46' : '#475569',
                border: `1px solid ${copied ? '#A7F3D0' : '#E2E8F0'}`,
                borderRadius: '8px', padding: '10px',
                fontSize: '0.8125rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              {copied ? '✓ Copied!' : 'Copy link'}
            </button>
          </div>
        </div>
      )}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}