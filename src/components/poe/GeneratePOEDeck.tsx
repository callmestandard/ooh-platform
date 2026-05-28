'use client';

import { useState } from 'react';

type Props = {
  campaignId: string;
  campaignName: string;
  clientName: string;
  boardCount: number;
  poeCount: number;
};

export default function GeneratePOEDeck({ campaignId, campaignName, clientName, boardCount, poeCount }: Props) {
  const [loading, setLoading] = useState<'pdf' | 'pptx' | null>(null);
  const [error, setError] = useState('');

  async function generate(format: 'pdf' | 'pptx') {
    setLoading(format);
    setError('');
    try {
      const res = await fetch('/api/poe-deck', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaignId, format }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to generate');
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `POE_${campaignName.replace(/\s+/g, '_')}.${format === 'pptx' ? 'pptx' : 'pdf'}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(null);
    }
  }

  const ready = poeCount > 0;
  const allDone = poeCount === boardCount && boardCount > 0;

  return (
    <div style={{ fontFamily: "'Inter', -apple-system, sans-serif" }}>
      {/* Status indicator */}
      <div style={{
        background: allDone ? '#ECFDF5' : ready ? '#FFFBEB' : '#F8FAFC',
        border: `1px solid ${allDone ? '#A7F3D0' : ready ? '#FDE68A' : '#E2E8F0'}`,
        borderRadius: '10px',
        padding: '12px 16px',
        marginBottom: '10px',
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
      }}>
        <div style={{
          width: 32, height: 32, borderRadius: '50%',
          background: allDone ? '#10B981' : ready ? '#F59E0B' : '#E2E8F0',
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
          {allDone ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={ready ? '#92400E' : '#94A3B8'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
          )}
        </div>
        <div>
          <p style={{ fontSize: '0.8125rem', fontWeight: 700, color: '#0F172A', margin: '0 0 2px' }}>
            {allDone ? 'All POE submitted — ready to generate' : `${poeCount} of ${boardCount} boards have POE`}
          </p>
          <p style={{ fontSize: '0.75rem', color: '#64748B', margin: 0 }}>
            {allDone
              ? 'Generate the branded POE deck for the client now'
              : poeCount === 0
              ? 'Send POE upload links to media partners to get started'
              : `${boardCount - poeCount} board${boardCount - poeCount !== 1 ? 's' : ''} still pending proof of execution`}
          </p>
        </div>
      </div>

      {/* Generate buttons */}
      {ready && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
          {/* PDF */}
          <button
            onClick={() => generate('pdf')}
            disabled={!!loading}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '7px',
              padding: '11px 14px',
              background: loading === 'pdf' ? '#F1F5F9' : '#1B4F8A',
              color: loading === 'pdf' ? '#94A3B8' : '#fff',
              border: 'none', borderRadius: '9px',
              fontSize: '0.8125rem', fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer',
              fontFamily: 'inherit', transition: 'all 0.15s',
            }}
          >
            {loading === 'pdf' ? (
              <div style={{ width: 14, height: 14, border: '2px solid #CBD5E1', borderTopColor: '#1B4F8A', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
                <line x1="16" y1="13" x2="8" y2="13"/>
                <line x1="16" y1="17" x2="8" y2="17"/>
                <polyline points="10 9 9 9 8 9"/>
              </svg>
            )}
            {loading === 'pdf' ? 'Generating...' : 'Download PDF'}
          </button>

          {/* PPTX */}
          <button
            onClick={() => generate('pptx')}
            disabled={!!loading}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '7px',
              padding: '11px 14px',
              background: loading === 'pptx' ? '#F1F5F9' : '#fff',
              color: loading === 'pptx' ? '#94A3B8' : '#1B4F8A',
              border: '1px solid #BFDBFE', borderRadius: '9px',
              fontSize: '0.8125rem', fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer',
              fontFamily: 'inherit', transition: 'all 0.15s',
            }}
          >
            {loading === 'pptx' ? (
              <div style={{ width: 14, height: 14, border: '2px solid #BFDBFE', borderTopColor: '#1B4F8A', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
                <line x1="8" y1="21" x2="16" y2="21"/>
                <line x1="12" y1="17" x2="12" y2="21"/>
              </svg>
            )}
            {loading === 'pptx' ? 'Generating...' : 'Download PPTX'}
          </button>
        </div>
      )}

      {!ready && (
        <div style={{ textAlign: 'center', padding: '8px', fontSize: '0.75rem', color: '#94A3B8' }}>
          Buttons will appear once at least one board has submitted POE
        </div>
      )}

      {error && (
        <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: '8px', padding: '10px 12px', marginTop: '8px', fontSize: '0.8125rem', color: '#7F1D1D', fontWeight: 500 }}>
          {error}
        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}