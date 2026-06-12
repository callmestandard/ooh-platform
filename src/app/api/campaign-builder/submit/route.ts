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

  // Compute campaign dates
  const start = new Date();
  const end   = new Date(start);
  end.setMonth(end.getMonth() + durationMonths);
  const startDate = start.toISOString().split('T')[0];
  const endDate   = end.toISOString().split('T')[0];

  // Create campaign
  const { data: campaign, error: campErr } = await db
    .from('campaigns')
    .insert({
      name:         campaignName,
      client_name:  user.email?.split('@')[0] || 'Self-service',
      status:       'submitted',
      agency_id:    user.id,
      total_budget: budget,
      start_date:   startDate,
      end_date:     endDate,
    })
    .select('id')
    .single();

  if (campErr || !campaign) {
    return NextResponse.json({ error: campErr?.message || 'Failed to create campaign' }, { status: 500 });
  }

  // Create bookings — offered_rate is 5% below asking
  const bookingRows = boards.map(b => ({
    board_id:        b.id,
    campaign_id:     campaign.id,
    offered_rate:    Math.round((b.asking_rate || 0) * 0.95),
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
      actorRole:  'agency',
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
          agencyName:   user.email?.split('@')[0] || 'A client',
          campaignName,
          rate:         Math.round((ownerBoard.asking_rate || 0) * 0.95),
          bookingId:    booking?.id || campaign.id,
        });
        ownerCount++;
      } catch (e) {
        console.error('[campaign-builder/submit] owner notify failed:', ownerId, e);
      }
    }),
  );

  return NextResponse.json({ campaignId: campaign.id, boardCount: boards.length, ownerCount });
}
