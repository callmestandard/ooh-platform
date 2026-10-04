import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '@/lib/require-auth';
import { rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';

// Records one "open" of the public shared report (report/[id]/page.tsx) so
// the agency can see whether its client looked at the plan. Written with the
// service role because proposal_views has no insert policy (migration 033) —
// opens can't be forged straight from the browser.
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

function detectDevice(ua: string): 'mobile' | 'tablet' | 'desktop' {
  if (/tablet|ipad|playbook|silk/i.test(ua)) return 'tablet';
  if (/mobile|iphone|ipod|android|blackberry|opera mini|iemobile/i.test(ua)) return 'mobile';
  return 'desktop';
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const { data: camp } = await supabase.from('campaigns').select('id, agency_id, client_id').eq('id', id).single();
  if (!camp) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // The agency checking its own link is not a client open.
  const user = await requireAuth(req);
  if (user && user.id === camp.agency_id) return NextResponse.json({ counted: false, reason: 'own' });

  // A refresh or a re-open within 30 minutes from the same visitor is one open.
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (!rateLimit(`report-view:${id}:${user?.id ?? ip}`, 1, 30 * 60_000)) {
    return NextResponse.json({ counted: false, reason: 'recent' });
  }

  const { error } = await supabase.from('proposal_views').insert({
    campaign_id: id,
    viewer_kind: !user ? 'anonymous' : user.id === camp.client_id ? 'client' : 'other',
    device: detectDevice(req.headers.get('user-agent') || ''),
  });
  if (error) return NextResponse.json({ counted: false, reason: 'error' }, { status: 500 });

  return NextResponse.json({ counted: true });
}
