import { NextRequest, NextResponse } from 'next/server';
import { logAppError } from '@/lib/error-log';
import { rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';

// Browser errors from src/lib/client-errors.ts. Open to everyone (errors
// happen signed out too), so it is capped per visitor and size-limited.
export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
  if (!rateLimit(`client-error:${ip}`, 10)) return new NextResponse(null, { status: 204 });
  const text = await req.text().catch(() => '');
  if (!text || text.length > 4000) return new NextResponse(null, { status: 204 });
  let body: { message?: unknown; path?: unknown; digest?: unknown; detail?: unknown };
  try { body = JSON.parse(text); } catch { return new NextResponse(null, { status: 204 }); }
  if (typeof body.message !== 'string' || !body.message.trim()) return new NextResponse(null, { status: 204 });
  const detail = body.detail && typeof body.detail === 'object' && !Array.isArray(body.detail) ? body.detail as Record<string, unknown> : null;
  await logAppError('client', body.message, {
    path: typeof body.path === 'string' ? body.path : null,
    digest: typeof body.digest === 'string' ? body.digest : null,
    detail,
  });
  return new NextResponse(null, { status: 204 });
}
