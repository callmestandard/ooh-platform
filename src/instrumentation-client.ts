import * as Sentry from '@sentry/nextjs';
import { reportClientError } from '@/lib/client-errors';

// Runs in the browser before the app starts (replaces sentry.client.config.ts).
// Sentry only starts when NEXT_PUBLIC_SENTRY_DSN is set; our own error log works without it.
if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment: process.env.NODE_ENV,
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
    replaysOnErrorSampleRate: 1.0,
    replaysSessionSampleRate: 0.05,
    integrations: [Sentry.replayIntegration({ maskAllText: true, blockAllMedia: false })],
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;

if (typeof window !== 'undefined') {
  // Only errors from our own scripts, not browser extensions or other sites.
  window.addEventListener('error', e => {
    if (!e.filename || !e.filename.startsWith(window.location.origin)) return;
    reportClientError(e.message, { kind: 'error', file: e.filename.replace(window.location.origin, ''), line: e.lineno });
  });
  window.addEventListener('unhandledrejection', e => {
    const r = e.reason as { message?: string; stack?: string } | undefined;
    const msg = r?.message ?? String(e.reason);
    if (r?.stack && !r.stack.includes(window.location.origin)) return;
    reportClientError(msg, { kind: 'promise' });
  });
}
