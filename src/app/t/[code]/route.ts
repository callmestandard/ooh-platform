import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

function detectDevice(ua: string): 'mobile' | 'tablet' | 'desktop' {
  if (/tablet|ipad|playbook|silk/i.test(ua)) return 'tablet';
  if (/mobile|iphone|ipod|android|blackberry|opera mini|iemobile/i.test(ua)) return 'mobile';
  return 'desktop';
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params;

  const { data: link } = await supabase
    .from('tracking_links')
    .select('id, target_url')
    .eq('short_code', code)
    .single();

  if (!link) {
    return NextResponse.redirect(new URL('/', req.url));
  }

  const ua = req.headers.get('user-agent') || '';

  // Log the scan (fire-and-forget — don't block the redirect)
  supabase.from('tracking_events').insert({
    tracking_link_id: link.id,
    device_type: detectDevice(ua),
    user_agent: ua.slice(0, 300),
  }).then(() => {});

  return NextResponse.redirect(link.target_url, { status: 302 });
}
