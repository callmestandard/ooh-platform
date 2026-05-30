import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// When a refresh token is invalid (stale session from a previous browser
// session or cleared DB), sign out silently so the error doesn't spam the
// console and the client starts fresh.
if (typeof window !== 'undefined') {
  supabase.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT' || event === 'TOKEN_REFRESHED') return;
  });

  supabase.auth.getSession().then(({ error }) => {
    if (error?.message?.includes('Refresh Token')) {
      supabase.auth.signOut();
    }
  });
}
