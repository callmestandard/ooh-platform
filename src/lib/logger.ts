import * as Sentry from '@sentry/nextjs';

type Level = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  level: Level;
  msg: string;
  route?: string;
  userId?: string;
  durationMs?: number;
  statusCode?: number;
  [key: string]: unknown;
}

function log(entry: LogEntry) {
  const line = JSON.stringify({ ts: new Date().toISOString(), env: process.env.NODE_ENV, ...entry });
  if (entry.level === 'error') {
    console.error(line);
    if (process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN) {
      Sentry.captureMessage(entry.msg, { level: 'error', extra: entry });
    }
  } else if (entry.level === 'warn') {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  debug: (msg: string, ctx?: Record<string, unknown>) => log({ level: 'debug', msg, ...ctx }),
  info:  (msg: string, ctx?: Record<string, unknown>) => log({ level: 'info',  msg, ...ctx }),
  warn:  (msg: string, ctx?: Record<string, unknown>) => log({ level: 'warn',  msg, ...ctx }),
  error: (msg: string, ctx?: Record<string, unknown>) => log({ level: 'error', msg, ...ctx }),

  /** Wrap an API handler with request timing and error logging */
  apiHandler: <T>(
    route: string,
    handler: () => Promise<T>
  ): Promise<T> => {
    const start = Date.now();
    return handler().then(
      result => {
        log({ level: 'info', msg: 'api_ok', route, durationMs: Date.now() - start });
        return result;
      },
      err => {
        log({ level: 'error', msg: 'api_error', route, durationMs: Date.now() - start, error: String(err) });
        if (process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN) {
          Sentry.captureException(err, { extra: { route, durationMs: Date.now() - start } });
        }
        throw err;
      }
    );
  },
};
