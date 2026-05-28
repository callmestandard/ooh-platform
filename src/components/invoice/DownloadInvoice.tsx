'use client';

import { useState } from 'react';

type Props = {
  bookingId: string;
  label?: string;
  type?: 'agency' | 'owner';
  variant?: 'button' | 'inline';
};

export default function DownloadInvoice({ bookingId, label, type = 'agency', variant = 'button' }: Props) {
  const [loading, setLoading] = useState(false);

  async function handleDownload() {
    setLoading(true);
    try {
      const res = await fetch(`/api/invoice?bookingId=${bookingId}&type=${type}`);
      if (!res.ok) throw new Error('Failed to generate invoice');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const filename = res.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1] || `invoice-${bookingId.slice(0, 8)}.pdf`;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error(e);
      alert('Could not generate invoice. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  if (variant === 'inline') {
    return (
      <button
        onClick={handleDownload}
        disabled={loading}
        title="Download invoice PDF"
        style={{
          background: '#EFF6FF', border: 'none', cursor: loading ? 'wait' : 'pointer',
          color: loading ? '#CBD5E1' : '#1B4F8A', fontSize: '0.6875rem',
          fontWeight: 700, fontFamily: 'inherit', padding: '3px 8px',
          borderRadius: 5, display: 'inline-flex', alignItems: 'center', gap: 4,
          whiteSpace: 'nowrap',
        }}
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="7 10 12 15 17 10"/>
          <line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
        {loading ? '…' : (label || 'Invoice')}
      </button>
    );
  }

  return (
    <button
      onClick={handleDownload}
      disabled={loading}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 8,
        padding: '9px 18px', borderRadius: 9, border: '1.5px solid #E2E8F0',
        background: loading ? '#F8FAFC' : '#fff', color: loading ? '#94A3B8' : '#0F172A',
        fontSize: '0.8125rem', fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer',
        fontFamily: 'inherit', transition: 'all 0.15s',
        boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
      }}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
        <polyline points="7 10 12 15 17 10"/>
        <line x1="12" y1="15" x2="12" y2="3"/>
      </svg>
      {loading ? 'Generating…' : (label || 'Download invoice')}
    </button>
  );
}
