'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';
import Link from 'next/link';
import { reportClientError } from '@/lib/client-errors';

// Shown when a page fails to load. The error is recorded for our team.
export default function PageError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    Sentry.captureException(error);
    reportClientError(error.message || 'Page failed to load', { kind: 'page' }, error.digest);
  }, [error]);

  return (
    <div style={{ minHeight: '60vh', display: 'grid', placeItems: 'center', padding: '32px 16px' }}>
      <div style={{ maxWidth: 420, textAlign: 'center' }}>
        <h1 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#0F172A', margin: '0 0 8px' }}>This page didn&apos;t load</h1>
        <p style={{ fontSize: '.9375rem', color: '#64748B', margin: '0 0 20px', lineHeight: 1.55 }}>
          Something went wrong on our side. It has been recorded. Try again, or go back to the home page.
        </p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button onClick={reset} style={{ background: '#1B4F8A', color: '#fff', border: 0, borderRadius: 10, padding: '10px 18px', fontSize: '.875rem', fontWeight: 600, cursor: 'pointer' }}>Try again</button>
          <Link href="/" style={{ border: '1px solid #CBD5E1', color: '#0F172A', borderRadius: 10, padding: '10px 18px', fontSize: '.875rem', fontWeight: 600, textDecoration: 'none' }}>Home</Link>
        </div>
        {error.digest && <p style={{ fontSize: '.75rem', color: '#94A3B8', marginTop: 16 }}>Reference: {error.digest}</p>}
      </div>
    </div>
  );
}
