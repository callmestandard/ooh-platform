import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';

// Public, no-login POE upload flow (poe/[token]/page.tsx) — a field rep opens
// this link on their phone with no account. Uses the service role key
// server-side and looks the booking up by its poe_token, since bookings now
// require auth+ownership under RLS (migration 012) and an anonymous field
// rep has neither.
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const { data: booking, error } = await supabase
    .from('bookings')
    .select(`
      id, status, poe_token, start_date, end_date,
      boards (name, address, city, format, width, height),
      campaigns (id, name, client_name)
    `)
    .eq('poe_token', token)
    .single();

  if (error || !booking) {
    return NextResponse.json({ status: 'invalid' });
  }

  const { data: existing } = await supabase
    .from('compliance_checks')
    .select('id, status')
    .eq('booking_id', booking.id)
    .eq('status', 'verified')
    .single();

  if (existing) {
    return NextResponse.json({ status: 'already_submitted', booking });
  }

  return NextResponse.json({ status: 'ok', booking });
}
