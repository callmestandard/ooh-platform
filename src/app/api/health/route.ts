import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function GET() {
  const start = Date.now();
  const checks: Record<string, { ok: boolean; latencyMs?: number; error?: string }> = {};

  // DB ping
  try {
    const t = Date.now();
    const { error } = await supabase.from('campaigns').select('id', { count: 'exact', head: true });
    checks.database = error
      ? { ok: false, error: error.message }
      : { ok: true, latencyMs: Date.now() - t };
  } catch (err) {
    checks.database = { ok: false, error: String(err) };
  }

  // Env vars present
  checks.env = {
    ok: !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.ANTHROPIC_API_KEY),
  };

  const allOk = Object.values(checks).every(c => c.ok);
  return NextResponse.json(
    { status: allOk ? 'ok' : 'degraded', checks, uptimeMs: Date.now() - start, ts: new Date().toISOString() },
    { status: allOk ? 200 : 503 }
  );
}
