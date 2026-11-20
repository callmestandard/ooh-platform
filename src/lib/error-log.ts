import { getSupabaseAdmin } from '@/lib/supabase-admin';

// Our own error log (065: app_errors), so failures are recorded even without
// Sentry. Server only. Never throws. Personal details and link tokens are
// blanked out before anything is stored.

export type ErrorSource = 'server' | 'client' | 'cron' | 'api';

export function scrub(s: string | null | undefined, max = 500): string {
  return String(s ?? '')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]')
    .replace(/(\/(?:poe|o|share|p)\/)[^/?#\s]+/g, '$1[token]')
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, '[token]')
    .replace(/\+?\d[\d\s-]{9,}\d/g, '[number]')
    .slice(0, max);
}

export async function logAppError(source: ErrorSource, message: string, opts: {
  path?: string | null; digest?: string | null; detail?: Record<string, unknown> | null; userId?: string | null;
} = {}) {
  try {
    const db = getSupabaseAdmin();
    if (!db) return;
    // Up to 12 short fields; text is scrubbed, numbers and true/false kept as they are.
    const detail = opts.detail
      ? Object.fromEntries(Object.entries(opts.detail).slice(0, 12).map(([k, v]) => [
          k.slice(0, 40),
          typeof v === 'number' || typeof v === 'boolean' ? v : scrub(typeof v === 'string' ? v : JSON.stringify(v), 300),
        ]))
      : null;
    const { error } = await db.from('app_errors').insert({
      source, message: scrub(message) || 'Unknown error', path: opts.path ? scrub(opts.path, 300) : null,
      digest: opts.digest ? String(opts.digest).slice(0, 100) : null, detail, user_id: opts.userId ?? null,
    });
    if (error && !/does not exist|schema cache/.test(error.message)) console.error('[app_errors]', error.message);
  } catch (e) {
    console.error('[app_errors] could not log', e);
  }
}

/** Records a scheduled-job run (065: cron_runs). Never throws. */
export async function logCronRun(job: string, ok: boolean, summary: Record<string, unknown>) {
  try {
    const db = getSupabaseAdmin();
    if (!db) return;
    const { error } = await db.rpc('log_cron_run', { p_job: job, p_ok: ok, p_summary: summary });
    if (error && !/does not exist|schema cache|function/.test(error.message)) console.error('[cron_runs]', error.message);
  } catch (e) {
    console.error('[cron_runs] could not log', e);
  }
}
