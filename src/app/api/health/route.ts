import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { requireAuth } from '@/lib/require-auth';
import { isAdmin } from '@/lib/quotation-server';
import { emailConfigured } from '@/lib/email';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Public: is the site up and can it reach the database? (for uptime monitors).
// Signed-in admins also get which services are set up, for System health.
export async function GET(req: NextRequest) {
  const start = Date.now();
  const db = getSupabaseAdmin();
  const checks: Record<string, { ok: boolean; latencyMs?: number }> = {};

  try {
    const t = Date.now();
    const { error } = db ? await db.from('boards').select('id', { count: 'exact', head: true }) : { error: true };
    checks.database = { ok: !error, latencyMs: Date.now() - t };
  } catch {
    checks.database = { ok: false };
  }
  checks.config = { ok: !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) };

  const allOk = Object.values(checks).every(c => c.ok);
  const body: Record<string, unknown> = { status: allOk ? 'ok' : 'degraded', checks, ms: Date.now() - start, ts: new Date().toISOString() };

  if (req.headers.get('authorization') && db) {
    const user = await requireAuth(req);
    if (user && (await isAdmin(db, user))) {
      body.setup = {
        email: emailConfigured(),
        alerts_to: process.env.OPS_ALERT_EMAIL ? 'OPS_ALERT_EMAIL' : 'admin accounts',
        cron_secret: !!process.env.CRON_SECRET,
        sentry: !!(process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN),
        mapbox: !!process.env.NEXT_PUBLIC_MAPBOX_TOKEN,
        ai: !!process.env.ANTHROPIC_API_KEY,
        region: process.env.VERCEL_REGION ?? null,
        commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
      };
    }
  }
  return NextResponse.json(body, { status: allOk ? 200 : 503, headers: { 'Cache-Control': 'no-store' } });
}
