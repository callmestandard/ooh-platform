import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { requireAuth, unauthorized } from '@/lib/require-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { rateLimit, rateLimitResponse } from '@/lib/rate-limit';

export const runtime = 'nodejs';

// Creates a login for a new team member of the caller's owner company and
// returns a one-time "set your password" link for the owner to pass on (by
// email or WhatsApp). Needs the service role because it creates an auth
// user; the caller must be the owner or one of the owner's team admins, and
// the DB trigger on owner_team_members refuses unverified owner companies.
export async function POST(req: NextRequest) {
  const user = await requireAuth(req);
  if (!user) return unauthorized();
  if (!rateLimit(`team-invite:${user.id}`, 10, 60 * 60_000)) return rateLimitResponse();
  const admin = getSupabaseAdmin();
  if (!admin) return NextResponse.json({ error: 'Server is not configured for invites' }, { status: 500 });

  const body = await req.json().catch(() => ({}));
  const name = String(body.name ?? '').trim();
  const email = String(body.email ?? '').trim().toLowerCase();
  const phone = String(body.phone ?? '').trim();
  const role = body.role === 'admin' ? 'admin' : 'marketer';
  if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: 'A name and a valid email address are required (the email is their login)' }, { status: 400 });
  }

  const { data: ownerId } = await admin.rpc('owner_company_of', { p_uid: user.id });
  const { data: isAdmin } = ownerId ? await admin.rpc('is_owner_admin', { p_owner_id: ownerId, p_uid: user.id }) : { data: false };
  if (!ownerId || !isAdmin) return NextResponse.json({ error: 'Only the owner or an owner admin can invite team members' }, { status: 403 });
  const { data: verified } = await admin.rpc('is_verified_company', { p_uid: ownerId });
  if (!verified) return NextResponse.json({ error: 'Add your company CAC and TIN numbers in Settings before inviting team members' }, { status: 400 });

  const created = await admin.auth.admin.createUser({
    email, email_confirm: true, password: randomBytes(24).toString('base64url'),
    user_metadata: { role: 'marketer', full_name: name },
  });
  if (created.error || !created.data.user) {
    const taken = /already|registered|exists/i.test(created.error?.message ?? '');
    return NextResponse.json({ error: taken ? 'That email already has an account on the platform' : created.error?.message ?? 'Could not create the account' }, { status: 400 });
  }
  const memberId = created.data.user.id;

  const profile = await admin.from('profiles').upsert({ id: memberId, role: 'marketer', full_name: name, email, phone: phone || null });
  const member = profile.error ? profile : await admin.from('owner_team_members').insert({
    owner_id: ownerId, member_profile_id: memberId, member_name: name, role, invited_email: email, invited_phone: phone || null,
  });
  if (profile.error || member.error) {
    await admin.auth.admin.deleteUser(memberId); // don't leave a login that belongs to no company
    return NextResponse.json({ error: (profile.error ?? member.error)!.message }, { status: 400 });
  }

  const origin = process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin;
  const link = await admin.auth.admin.generateLink({ type: 'recovery', email, options: { redirectTo: `${origin}/reset-password` } });
  return NextResponse.json({ memberId, inviteLink: link.data?.properties?.action_link ?? null });
}
