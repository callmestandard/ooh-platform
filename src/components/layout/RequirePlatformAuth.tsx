'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { supabase } from '@/lib/supabase';

// Gates a page behind an authenticated session. Unlike RoleGuard (which
// picks between agency/client/owner dashboards) this just asks "is anyone
// signed in at all" — for public-facing pages (marketplace, self-serve
// campaign builder, city SEO pages) that aren't ready to be open to
// anonymous visitors yet. Controlled by NEXT_PUBLIC_GATE_PUBLIC_PAGES so
// it's a one-line flip to reopen later.
export default function RequirePlatformAuth({ children }: { children: React.ReactNode }) {
  const gateEnabled = process.env.NEXT_PUBLIC_GATE_PUBLIC_PAGES !== 'false';
  const router = useRouter();
  const pathname = usePathname();
  const [status, setStatus] = useState<'checking' | 'authed' | 'anon'>(gateEnabled ? 'checking' : 'authed');

  useEffect(() => {
    if (!gateEnabled) return;
    let cancelled = false;
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (cancelled) return;
      if (session) {
        setStatus('authed');
      } else {
        setStatus('anon');
        router.replace(`/auth/login?redirect=${encodeURIComponent(pathname || '/')}`);
      }
    });
    return () => { cancelled = true; };
  }, [gateEnabled, router, pathname]);

  if (!gateEnabled || status === 'authed') return <>{children}</>;

  return (
    <div style={{ display: 'flex', minHeight: '60vh', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: 200, height: 32, borderRadius: 8, background: '#F1F5F9' }} />
    </div>
  );
}
