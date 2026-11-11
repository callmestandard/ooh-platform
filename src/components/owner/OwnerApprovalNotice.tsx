'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

/**
 * Tells a media owner that new boards show as "Pending verification" until
 * our team approves their company (migration 050). Hidden once approved,
 * for admins, and while loading.
 */
export default function OwnerApprovalNotice({ style }: { style?: React.CSSProperties }) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const { data: me } = await supabase.from('profiles').select('role').eq('id', session.user.id).maybeSingle();
      if ((me as { role?: string } | null)?.role === 'admin') return;
      const { data: company } = await supabase.rpc('owner_company_of', { p_uid: session.user.id });
      if (!company) return;
      const { data, error } = await supabase.from('owner_approvals').select('owner_id').eq('owner_id', company as string).maybeSingle();
      if (!cancelled && !error && !data) setShow(true);
    })();
    return () => { cancelled = true; };
  }, []);

  if (!show) return null;
  return (
    <div data-owner-approval-notice role="status" style={{
      display: 'flex', gap: 12, alignItems: 'flex-start', background: '#FFFBEB', border: '1px solid #FDE68A',
      borderRadius: 14, padding: '12px 16px', marginBottom: 16, ...style,
    }}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#B45309" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }}>
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      </svg>
      <div>
        <p style={{ margin: '0 0 2px', fontSize: '0.875rem', fontWeight: 700, color: '#78350F' }}>Your company is being checked</p>
        <p style={{ margin: 0, fontSize: '0.8125rem', color: '#92400E', lineHeight: 1.5 }}>
          Buyers can already find and request your boards. They show as &ldquo;Pending verification&rdquo; until our team confirms your company, then they switch to &ldquo;Partner verified&rdquo; on their own.
        </p>
      </div>
    </div>
  );
}
