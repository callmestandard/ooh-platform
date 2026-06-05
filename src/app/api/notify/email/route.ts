import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  emailPlanSentForApproval,
  emailPlanApproved,
  emailNewBookingRequest,
} from '@/lib/email';

export const runtime = 'nodejs';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

async function getUserEmail(userId: string): Promise<string | null> {
  try {
    const { data: { user } } = await supabase.auth.admin.getUserById(userId);
    return user?.email ?? null;
  } catch {
    return null;
  }
}

async function getProfileName(userId: string): Promise<string> {
  const { data } = await supabase
    .from('profiles')
    .select('full_name, company_name')
    .eq('id', userId)
    .single() as { data: { full_name?: string | null; company_name?: string | null } | null };
  return data?.company_name ?? data?.full_name ?? 'Unknown';
}

export async function POST(req: NextRequest) {
  const body = await req.json() as { type: string; [key: string]: unknown };

  try {
    switch (body.type) {

      case 'plan_sent_for_approval': {
        // Agency sent campaign to client for review
        // body: { type, clientId, agencyId, campaignName, boardCount }
        const { clientId, agencyId, campaignName, boardCount } = body as unknown as {
          clientId: string; agencyId: string; campaignName: string; boardCount: number;
        };
        const [clientEmail, clientName, agencyName] = await Promise.all([
          getUserEmail(clientId),
          getProfileName(clientId),
          getProfileName(agencyId),
        ]);
        if (clientEmail) {
          await emailPlanSentForApproval({ to: clientEmail, clientName, agencyName, campaignName, boardCount });
        }
        break;
      }

      case 'plan_approved': {
        // Client approved all boards
        // body: { type, agencyId, clientId, campaignName, boardCount, campaignId }
        const { agencyId, clientId, campaignName, boardCount, campaignId } = body as unknown as {
          agencyId: string; clientId: string; campaignName: string; boardCount: number; campaignId: string;
        };
        const [agencyEmail, agencyName, clientName] = await Promise.all([
          getUserEmail(agencyId),
          getProfileName(agencyId),
          getProfileName(clientId),
        ]);
        if (agencyEmail) {
          await emailPlanApproved({ to: agencyEmail, agencyName, clientName, campaignName, boardCount, campaignId });
        }
        break;
      }

      case 'booking_request': {
        // Agency made a booking request for a board
        // body: { type, ownerId, agencyId, boardName, campaignName, rate, bookingId }
        const { ownerId, agencyId, boardName, campaignName, rate, bookingId } = body as unknown as {
          ownerId: string; agencyId: string; boardName: string;
          campaignName: string; rate: number; bookingId: string;
        };
        const [ownerEmail, ownerName, agencyName] = await Promise.all([
          getUserEmail(ownerId),
          getProfileName(ownerId),
          getProfileName(agencyId),
        ]);
        if (ownerEmail) {
          await emailNewBookingRequest({ to: ownerEmail, ownerName, boardName, agencyName, campaignName, rate, bookingId });
        }
        break;
      }

      default:
        return NextResponse.json({ error: `Unknown type: ${body.type}` }, { status: 400 });
    }

    return NextResponse.json({ sent: true });
  } catch (err: unknown) {
    console.error('[notify/email]', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
