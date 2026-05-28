/**
 * Supabase Auth helpers for OOH Platform.
 *
 * ── Required database setup ──────────────────────────────────────────────────
 * Run this SQL once in the Supabase SQL editor to create the profiles table
 * and a trigger that auto-populates it on every new sign-up:
 *
 *   create table if not exists public.profiles (
 *     id           uuid references auth.users(id) on delete cascade primary key,
 *     role         text not null check (role in ('agency', 'client', 'owner')),
 *     full_name    text,
 *     company_name text,
 *     created_at   timestamptz default now()
 *   );
 *
 *   alter table public.profiles enable row level security;
 *
 *   create policy "Users can read own profile"
 *     on public.profiles for select
 *     using (auth.uid() = id);
 *
 *   create policy "Users can update own profile"
 *     on public.profiles for update
 *     using (auth.uid() = id);
 *
 * ── Demo accounts ─────────────────────────────────────────────────────────────
 * Create these three users in Authentication → Users, then insert rows into
 * public.profiles manually (or via the trigger below):
 *
 *   insert into public.profiles (id, role, full_name, company_name) values
 *     ('<agency-user-uuid>',  'agency', 'Alex Okonkwo',  'OOH Media Agency'),
 *     ('<client-user-uuid>',  'client', 'MTN Nigeria',   'MTN Nigeria'),
 *     ('<owner-user-uuid>',   'owner',  'Alhaji Sule',   'Sule Outdoor Ltd');
 *
 * ── Optional trigger (auto-creates profile from user_metadata on sign-up) ────
 *
 *   create or replace function public.handle_new_user()
 *   returns trigger language plpgsql security definer as $$
 *   begin
 *     insert into public.profiles (id, role, full_name, company_name)
 *     values (
 *       new.id,
 *       coalesce(new.raw_user_meta_data->>'role', 'agency'),
 *       new.raw_user_meta_data->>'full_name',
 *       new.raw_user_meta_data->>'company_name'
 *     )
 *     on conflict (id) do nothing;
 *     return new;
 *   end;
 *   $$;
 *
 *   create or replace trigger on_auth_user_created
 *     after insert on auth.users
 *     for each row execute procedure public.handle_new_user();
 */

import { supabase } from './supabase';
import type { DemoRole } from './constants';

export type UserProfile = {
  id: string;
  role: DemoRole;
  full_name: string | null;
  company_name: string | null;
  email: string;
};

/** Credentials for the seeded demo accounts. */
export const DEMO_CREDENTIALS: Record<DemoRole, { email: string; password: string }> = {
  agency: { email: 'agency@demo.oohplatform.com', password: 'oohplatform2026' },
  client: { email: 'client@demo.oohplatform.com', password: 'oohplatform2026' },
  owner:  { email: 'owner@demo.oohplatform.com',  password: 'oohplatform2026' },
  admin:  { email: 'admin@demo.oohplatform.com',  password: 'oohplatform2026' },
};

export async function signInWithEmail(email: string, password: string) {
  return supabase.auth.signInWithPassword({ email, password });
}

/** Returns the current Supabase session, or null if not signed in. */
export async function getSession() {
  const { data: { session } } = await supabase.auth.getSession();
  return session;
}

/**
 * Returns the profile for the currently signed-in user.
 * Returns null if there is no session, or if the profiles table has no row yet.
 */
export async function getCurrentProfile(): Promise<UserProfile | null> {
  const session = await getSession();
  if (!session?.user) return null;

  const { data } = await supabase
    .from('profiles')
    .select('id, role, full_name, company_name')
    .eq('id', session.user.id)
    .single();

  if (!data) {
    // Session exists but no profile row — check user_metadata as fallback
    // (useful right after sign-up before the trigger fires)
    const metaRole = session.user.user_metadata?.role as DemoRole | undefined;
    if (metaRole === 'agency' || metaRole === 'client' || metaRole === 'owner' || metaRole === 'admin') {
      return {
        id: session.user.id,
        role: metaRole,
        full_name: session.user.user_metadata?.full_name ?? null,
        company_name: session.user.user_metadata?.company_name ?? null,
        email: session.user.email ?? '',
      };
    }
    return null;
  }

  return {
    ...(data as { id: string; role: DemoRole; full_name: string | null; company_name: string | null }),
    email: session.user.email ?? '',
  };
}

export async function signOut() {
  return supabase.auth.signOut();
}
