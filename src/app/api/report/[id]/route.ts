import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';

// Serves the public "Share Report" link (report/[id]/page.tsx) — intentionally
// viewable without login, so it uses the service role key server-side and
// returns only the specific fields the report needs, rather than letting the
// browser query campaigns/bookings/profiles directly (which now require
// auth+ownership per migration 012).
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const { data: camp } = await supabase
    .from('campaigns')
    .select('id, name, client_name, status, start_date, end_date, total_budget, objective, target_cities, plan_notes, agency_id')
    .eq('id', id)
    .single();

  if (!camp) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  let agencyBranding = null;
  if (camp.agency_id) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name, company_name, brand_logo_url, brand_accent_color, brand_tagline, brand_website')
      .eq('id', camp.agency_id)
      .single();
    if (profile) {
      agencyBranding = {
        name: profile.company_name || profile.full_name || 'Your Agency',
        logoUrl: profile.brand_logo_url || null,
        accentColor: profile.brand_accent_color || '#1B4F8A',
        tagline: profile.brand_tagline || null,
        website: profile.brand_website || null,
      };
    }
  }

  const { data: bookData } = await supabase
    .from('bookings')
    .select('id, status, offered_rate, agreed_rate, start_date, end_date, duration_months, boards(name, address, city, state, format, illuminated, face_count, width, height)')
    .eq('campaign_id', id)
    .order('created_at');

  const bookings = bookData || [];
  const bookingIds = bookings.map(b => b.id);

  const { data: compliance } = bookingIds.length
    ? await supabase.from('compliance_checks').select('id, booking_id, status, submitted_at, photo_url, notes, submitted_by').in('booking_id', bookingIds)
    : { data: [] };

  return NextResponse.json({
    campaign: camp,
    agencyBranding,
    bookings,
    compliance: compliance || [],
  });
}
