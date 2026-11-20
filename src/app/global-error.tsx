'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';
import { reportClientError } from '@/lib/client-errors';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
    reportClientError(error.message || 'App failed to load', { kind: 'global' }, error.digest);
  }, [error]);

  return (
    <html lang="en">
      <body style={{ fontFamily: 'sans-serif', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', margin: 0, background: '#f9fafb' }}>
        <div style={{ textAlign: 'center', padding: '2rem' }}>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 600, color: '#111827' }}>Something went wrong</h1>
          <p style={{ color: '#6b7280', margin: '0.5rem 0 1.5rem' }}>Something went wrong on our side. It has been recorded.</p>
          <button
            onClick={reset}
            style={{ background: '#1B4F8A', color: '#fff', border: 'none', borderRadius: '0.5rem', padding: '0.625rem 1.5rem', cursor: 'pointer', fontSize: '0.875rem' }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
