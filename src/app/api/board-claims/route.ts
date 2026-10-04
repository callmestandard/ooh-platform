import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, unauthorized } from '@/lib/require-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export const runtime = 'nodejs';

// Claims waiting on the caller: ownership claims filed against boards the
// caller registered. The claimant is an owner account whose profile the
// registering agency cannot read under RLS, so this route (service role)
// adds just the claimant company name and phone — enough to judge the claim.
// It returns claims ONLY for boards created by the caller.
export async function GET(req: NextRequest) {
  const user = await requireAuth(req);
  if (!user) return unauthorized();
  const admin = getSupabaseAdmin();
  if (!admin) return NextResponse.json({ error: 'Not available' }, { status: 500 });

  const { data: boards } = await admin.from('boards').select('id, name, city, partner_name').eq('created_by', user.id);
  const ids = (boards ?? []).map(b => b.id);
  if (ids.length === 0) return NextResponse.json({ claims: [] });

  const { data: claims } = await admin.from('board_claims').select('id, board_id, claimant_id, status, created_at').in('board_id', ids).order('created_at', { ascending: false });
  const claimantIds = [...new Set((claims ?? []).map(c => c.claimant_id))];
  const { data: profiles } = claimantIds.length
    ? await admin.from('profiles').select('id, company_name, full_name, phone').in('id', claimantIds)
    : { data: [] };

  return NextResponse.json({
    claims: (claims ?? []).map(c => {
      const b = boards!.find(x => x.id === c.board_id);
      const p = (profiles ?? []).find(x => x.id === c.claimant_id);
      return {
        id: c.id, status: c.status, created_at: c.created_at,
        board: { id: c.board_id, name: b?.name ?? 'Board', city: b?.city ?? null, partner_name: b?.partner_name ?? null },
        claimant: { name: p?.company_name || p?.full_name || 'Board owner', phone: p?.phone ?? null },
      };
    }),
  });
}
