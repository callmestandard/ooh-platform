import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, unauthorized } from '@/lib/require-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export const runtime = 'nodejs';

// An owner approves agencies (by the agency login email) to see rates on
// boards set to "approved agencies". Owners have no read access to agency
// profiles, so the lookup runs here with the service role and returns only
// the agency display name.
async function ownerAdminOf(userId: string) {
  const admin = getSupabaseAdmin();
  if (!admin) return { admin: null, ownerId: null };
  const { data: ownerId } = await admin.rpc('owner_company_of', { p_uid: userId });
  const { data: ok } = ownerId ? await admin.rpc('is_owner_admin', { p_owner_id: ownerId, p_uid: userId }) : { data: false };
  return { admin, ownerId: ok ? (ownerId as string) : null };
}

export async function GET(req: NextRequest) {
  const user = await requireAuth(req);
  if (!user) return unauthorized();
  const { admin, ownerId } = await ownerAdminOf(user.id);
  if (!admin || !ownerId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const { data: rows } = await admin.from('owner_approved_agencies').select('agency_id').eq('owner_id', ownerId);
  const ids = (rows ?? []).map(r => r.agency_id);
  const { data: profiles } = ids.length ? await admin.from('profiles').select('id, company_name, full_name').in('id', ids) : { data: [] };
  return NextResponse.json({ agencies: (profiles ?? []).map(p => ({ agency_id: p.id, name: p.company_name || p.full_name || 'Agency' })) });
}

export async function POST(req: NextRequest) {
  const user = await requireAuth(req);
  if (!user) return unauthorized();
  const { admin, ownerId } = await ownerAdminOf(user.id);
  if (!admin || !ownerId) return NextResponse.json({ error: 'Only the owner or an owner admin can approve agencies' }, { status: 403 });
  const email = String((await req.json().catch(() => ({}))).email ?? '').trim().toLowerCase();
  if (!email) return NextResponse.json({ error: 'Enter the login email of the agency' }, { status: 400 });
  const { data: agency } = await admin.from('profiles').select('id').eq('role', 'agency').ilike('email', email).maybeSingle();
  if (!agency) return NextResponse.json({ error: 'No agency account uses that email' }, { status: 404 });
  const { error } = await admin.from('owner_approved_agencies').upsert({ owner_id: ownerId, agency_id: agency.id });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
