import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, unauthorized } from '@/lib/require-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { logActivity } from '@/lib/activity-log';
import { emailNewBookingRequest } from '@/lib/email';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const user = await requireAuth(req);
  if (!user) return unauthorized();

  const body = await req.json() as {
    campaignName: string;
    budget: number;
    durationMonths: number;
    boardIds: string[];
  };

  const { campaignName, budget, durationMonths, boardIds } = body;

  if (!boardIds?.length) {
    return NextResponse.json({ error: 'No boards selected' }, { status: 400 });
  }

  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });

  // Fetch board details server-side (authoritative rates + owner info)
  const { data: boards, error: boardsErr } = await db
    .from('boards')
    .select('id, name, asking_rate, owner_id, city, format')
    .in('id', boardIds);

  if (boardsErr || !boards) {
    return NextResponse.json({ error: 'Failed to fetch board data' }, { status: 500 });
  }

  // Rates are private (migration 035) and no longer on the boards row. Use a
  // board's rate only if THIS user is allowed to see it; any other board is
  // submitted as a quote request with no amount — never a ₦0 offer.
  const rateByBoard: Record<string, number> = {};
  await Promise.all(boards.map(async b => {
    const { data: canSee } = await db.rpc('can_see_board_rate', { p_board_id: b.id, p_uid: user.id });
    if (!canSee) return;
    const { data: r } = await db.from('board_rates').select('gross_monthly_rate').eq('board_id', b.id).maybeSingle();
    if (r?.gross_monthly_rate && Number(r.gross_monthly_rate) > 0) rateByBoard[b.id] = Number(r.gross_monthly_rate);
  }));
  const offerFor = (boardId: string): number | null => (rateByBoard[boardId] ? Math.round(rateByBoard[boardId] * 0.95) : null);

  // Compute campaign dates
  const start = new Date();
  const end   = new Date(start);
  end.setMonth(end.getMonth() + durationMonths);
  const startDate = start.toISOString().split('T')[0];
  const endDate   = end.toISOString().split('T')[0];

  // The submitter is both the plan's owner (agency_id — needed for the
  // update/delete RLS policies) and the brand it's for (client_id — this is
  // what /dashboard/client, where the user lands next, actually queries by).
  const { data: submitterProfile } = await db
    .from('profiles')
    .select('full_name, company_name, role')
    .eq('id', user.id)
    .single() as { data: { full_name?: string; company_name?: string; role?: string } | null };

  const clientName = submitterProfile?.company_name || submitterProfile?.full_name
    || user.email?.split('@')[0] || 'Self-service';

  // Create campaign
  const { data: campaign, error: campErr } = await db
    .from('campaigns')
    .insert({
      name:         campaignName,
      client_name:  clientName,
      status:       'submitted',
      agency_id:    user.id,
      client_id:    user.id,
      total_budget: budget,
      start_date:   startDate,
      end_date:     endDate,
    })
    .select('id')
    .single();

  if (campErr || !campaign) {
    return NextResponse.json({ error: campErr?.message || 'Failed to create campaign' }, { status: 500 });
  }

  // Create bookings — offered_rate is 5% below a visible asking rate, or empty for a quote request
  const bookingRows = boards.map(b => ({
    board_id:        b.id,
    campaign_id:     campaign.id,
    offered_rate:    offerFor(b.id),
    notes:           offerFor(b.id) === null ? 'Quote request — no offer made; please reply with your rate' : null,
    start_date:      startDate,
    end_date:        endDate,
    duration_months: durationMonths,
    status:          'pending',
  }));

  const { data: bookings, error: bookErr } = await db
    .from('bookings')
    .insert(bookingRows)
    .select('id, board_id');

  if (bookErr) {
    return NextResponse.json({ error: bookErr.message }, { status: 500 });
  }

  // Activity log
  await logActivity(
    {
      entityType: 'campaign',
      entityId:   campaign.id,
      action:     'campaign.submitted',
      summary:    `Self-service campaign "${campaignName}" submitted with ${boards.length} boards`,
      actorId:    user.id,
      actorRole:  submitterProfile?.role || 'client',
      campaignId: campaign.id,
      metadata:   { boardCount: boards.length, budget, durationMonths, source: 'campaign-builder' },
    },
    db,
  );

  // Notify each unique board owner (fire-and-forget)
  const uniqueOwnerIds = [...new Set(boards.map(b => b.owner_id).filter(Boolean))] as string[];
  let ownerCount = 0;

  await Promise.allSettled(
    uniqueOwnerIds.map(async (ownerId) => {
      try {
        const { data: { user: ownerUser } } = await db.auth.admin.getUserById(ownerId);
        const ownerEmail = ownerUser?.email;
        if (!ownerEmail) return;

        const { data: profile } = await db
          .from('profiles')
          .select('full_name, company_name')
          .eq('id', ownerId)
          .single() as { data: { full_name?: string; company_name?: string } | null };

        const ownerName = profile?.company_name || profile?.full_name || 'Board Owner';

        const ownerBoard = boards.find(b => b.owner_id === ownerId)!;
        const booking    = bookings?.find(bk => bk.board_id === ownerBoard.id);

        await emailNewBookingRequest({
          to:           ownerEmail,
          ownerName,
          boardName:    ownerBoard.name,
          agencyName:   clientName,
          campaignName,
          rate:         offerFor(ownerBoard.id),
          bookingId:    booking?.id || campaign.id,
        });
        ownerCount++;
      } catch (e) {
        console.error('[campaign-builder/submit] owner notify failed:', ownerId, e);
      }
    }),
  );

  const quoteRequests = boards.filter(b => offerFor(b.id) === null).length;
  return NextResponse.json({ campaignId: campaign.id, boardCount: boards.length, ownerCount, quoteRequests });
}
