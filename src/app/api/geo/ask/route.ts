import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';
import { requireAuth, unauthorized } from '@/lib/require-auth';
import { rateLimit, rateLimitResponse } from '@/lib/rate-limit';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';
import { ASK_MODEL, runAsk, type AskResult } from '@/lib/geo/ask-core';
import { ASK_TOOLS, createToolExecutor } from '@/lib/geo/ask-tools';

export const runtime = 'nodejs';
export const maxDuration = 120;

const MAX_QUESTION_LENGTH = 500;

/**
 * "Ask the map": answers a question about the market data. The model only
 * chooses lookups and words the figures they return; src/lib/geo/ask-core.ts
 * refuses unsupported topics and rejects any answer with a number that did
 * not come from a lookup. Every question, lookup and outcome is logged.
 */
export async function POST(req: NextRequest) {
  const user = await requireAuth(req);
  if (!user) return unauthorized();
  if (!rateLimit(`geo-ask:${user.id}`)) return rateLimitResponse();

  const body = await req.json().catch(() => null);
  const question = typeof body?.question === 'string' ? body.question.trim() : '';
  if (!question) return NextResponse.json({ error: 'Ask a question.' }, { status: 400 });
  if (question.length > MAX_QUESTION_LENGTH) return NextResponse.json({ error: `Keep the question under ${MAX_QUESTION_LENGTH} characters.` }, { status: 400 });

  const apiKey = process.env.ANTHROPIC_API_KEY;

  // Lookups run as the asking user, so row-level security decides what they can see.
  const token = req.headers.get('authorization')!.slice(7);
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  });

  const started = Date.now();
  let result: AskResult;
  try {
    // A key that is not tied to one workspace must name the workspace on every request.
    const workspaceId = process.env.ANTHROPIC_WORKSPACE_ID;
    const client = apiKey
      ? new Anthropic({ apiKey, ...(workspaceId ? { defaultHeaders: { 'anthropic-workspace-id': workspaceId } } : {}) })
      : null;
    result = await runAsk({
      question,
      tools: ASK_TOOLS,
      executeTool: createToolExecutor({ supabase, origin: new URL(req.url).origin }),
      // Unsupported questions are refused before this is ever called, so they work without a key.
      createMessage: params => {
        if (!client) throw new MissingKeyError();
        return client.messages.create(params);
      },
    });
  } catch (err) {
    if (err instanceof MissingKeyError) {
      return NextResponse.json({ error: 'Ask the map is not configured: ANTHROPIC_API_KEY is not set on the server.' }, { status: 503 });
    }
    const message =
      err instanceof Anthropic.RateLimitError ? 'The answering service is busy. Try again in a moment.'
      : err instanceof Anthropic.AuthenticationError ? 'Ask the map is misconfigured: the API key was rejected.'
      : err instanceof Anthropic.APIConnectionError ? 'The answering service could not be reached.'
      : err instanceof Anthropic.APIError ? `The answering service returned an error (${err.status}).`
      : 'The question could not be answered because of a server error.';
    logger.error('geo-ask failed', { route: '/api/geo/ask', userId: user.id, error: err instanceof Error ? err.message : String(err) });
    result = { status: 'error', statements: [], reason: message, suggestion: '', sources: [], tool_calls: [], attempts: 0, rejected: [] };
  }

  // Audit trail. Best effort: a logging failure is reported, never hidden, but does not withhold the answer.
  const admin = getSupabaseAdmin();
  const { error: logError } = admin
    ? await admin.from('geo_ask_log').insert({
        user_id: user.id,
        question,
        status: result.status,
        tool_calls: result.tool_calls,
        answer: { statements: result.statements, reason: result.reason, suggestion: result.suggestion, sources: result.sources },
        rejected: result.rejected,
        attempts: result.attempts,
        model: ASK_MODEL,
        duration_ms: Date.now() - started,
      })
    : { error: { message: 'no service-role client' } };
  if (logError) logger.error('geo-ask audit log failed', { route: '/api/geo/ask', userId: user.id, error: logError.message });

  return NextResponse.json({ ...result, logged: !logError });
}

class MissingKeyError extends Error {}

/** Whether free-text questions are available. The page hides the question box when they are not. */
export async function GET() {
  return NextResponse.json({ configured: !!process.env.ANTHROPIC_API_KEY });
}
