import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';

// Completes the public POE submission: inserts the compliance_checks row and
// marks the booking live, both server-side with the service role key — the
// anonymous field rep submitting this has no auth.uid() for RLS to match
// against bookings_update (migration 012), so this can't go through the
// browser client directly anymore.
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const body = await req.json();
  const { photoUrl, latitude, longitude, submitterName, notes, deviceInfo } = body;

  const { data: booking, error: bookingError } = await supabase
    .from('bookings')
    .select('id, status')
    .eq('poe_token', token)
    .single();

  if (bookingError || !booking) {
    return NextResponse.json({ error: 'Invalid or expired link' }, { status: 404 });
  }

  const { data: newCheck, error: insertError } = await supabase.from('compliance_checks').insert({
    booking_id: booking.id,
    photo_url: photoUrl || null,
    latitude,
    longitude,
    submitted_at: new Date().toISOString(),
    submitted_by: submitterName,
    submitted_name: submitterName,
    status: 'submitted',
    notes: notes || null,
    device_info: deviceInfo || null,
  }).select('id').single();

  if (insertError || !newCheck) {
    return NextResponse.json({ error: 'Failed to submit' }, { status: 500 });
  }

  const prevStatus = booking.status;
  await supabase.from('bookings').update({ status: 'live' }).eq('id', booking.id);

  return NextResponse.json({ complianceCheckId: newCheck.id, previousStatus: prevStatus });
}
