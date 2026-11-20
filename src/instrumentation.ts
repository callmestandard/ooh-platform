import * as Sentry from '@sentry/nextjs';
import type { Instrumentation } from 'next';

// Runs once when a server starts. Loads Sentry (only does anything when a
// Sentry key is set in Vercel) and records every server error in our own log.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') await import('../sentry.server.config');
  if (process.env.NEXT_RUNTIME === 'edge') await import('../sentry.edge.config');
}

export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  Sentry.captureRequestError(err, request, context);
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const e = err as { message?: string; digest?: string; name?: string };
  const { logAppError } = await import('./lib/error-log');
  await logAppError('server', e?.message || String(err), {
    path: request.path,
    digest: e?.digest ?? null,
    detail: { method: request.method, kind: context.routeType, route: context.routePath, name: e?.name ?? 'Error' },
  });
};
