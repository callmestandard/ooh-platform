'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { roleHome } from '@/lib/mvp';

// Header buttons for public pages: "Sign in / Get started" for visitors,
// a link back to their own area for signed-in users.
export default function AccountNavButtons() {
  const [me, setMe] = useState<{ role: string } | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { if (!cancelled) setMe(null); return; }
      const { data } = await supabase.from('profiles').select('role').eq('id', session.user.id).maybeSingle();
      if (!cancelled) setMe(data ? { role: (data as { role: string }).role } : null);
    })();
    return () => { cancelled = true; };
  }, []);

  const base: React.CSSProperties = { padding: '8px 16px', borderRadius: 8, fontSize: '0.875rem', cursor: 'pointer', fontFamily: 'inherit', textDecoration: 'none', whiteSpace: 'nowrap' };
  const plain: React.CSSProperties = { ...base, background: 'none', border: '1px solid #E2E8F0', fontWeight: 500, color: '#0F172A' };
  const primary: React.CSSProperties = { ...base, background: '#1B4F8A', color: '#fff', border: 'none', fontWeight: 600 };

  if (me === undefined) return <div style={{ width: 160 }} />;
  if (me) {
    return (
      <a href={roleHome(me.role)} style={primary} data-account-link>
        {me.role === 'agency' ? 'My requests' : 'My dashboard'}
      </a>
    );
  }
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
      <a href="/auth/login" style={plain}>Sign in</a>
      <a href="/signup" style={primary}>Get started</a>
    </div>
  );
}
