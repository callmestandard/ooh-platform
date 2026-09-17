'use client';

import { useEffect, useState } from 'react';
import { RoleGuard } from '@/components/layout/RoleGuard';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/components/ui/Toast';
import { createNotification } from '@/lib/notifications';

type Claim = {
  id: string;
  board_id: string;
  agent_id: string;
  floor_rate: number;
  status: 'active' | 'revoked' | 'disputed';
  created_at: string;
  boards: { name: string; city: string; format: string } | null;
  agent: { full_name: string | null; company_name: string | null; email: string | null } | null;
};

const FORMAT_LABELS: Record<string, string> = {
  billboard: 'Billboard', unipole: 'Unipole', gantry: 'Gantry',
  bridge_panel: 'Bridge Panel', wall_drape: 'Wall Drape', digital: 'Digital/LED', led: 'LED',
};

function formatNaira(n: number | null | undefined) {
  if (!n) return '₦0';
  return '₦' + Number(n).toLocaleString('en-NG');
}

function AgentAuthorizationsContent() {
  const { toast: showToast } = useToast();
  const [userId, setUserId] = useState<string | null>(null);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [loading, setLoading] = useState(true);
  const [resolving, setResolving] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) { setUserId(user.id); load(user.id); }
    });
  }, []);

  async function load(uid: string) {
    setLoading(true);
    const { data } = await supabase
      .from('board_authorizations')
      .select('id, board_id, agent_id, floor_rate, status, created_at, boards(name, city, format), agent:agent_id(full_name, company_name, email)')
      .eq('owner_id', uid)
      .eq('owner_verified', false)
      .eq('status', 'active')
      .order('created_at', { ascending: false });
    setClaims((data as unknown as Claim[]) || []);
    setLoading(false);
  }

  async function respond(claim: Claim, approve: boolean) {
    if (!userId) return;
    setResolving(claim.id);

    const { error } = approve
      ? await supabase.from('board_authorizations').update({ owner_verified: true }).eq('id', claim.id)
      : await supabase.from('board_authorizations').update({ status: 'revoked', dispute_notes: `[owner] Denied on ${new Date().toISOString()}` }).eq('id', claim.id);

    if (error) {
      showToast('Failed to respond: ' + error.message, 'error');
      setResolving(null);
      return;
    }

    await createNotification({
      recipientRole: 'agent',
      recipientUserId: claim.agent_id,
      type: 'agent_authorization_resolved',
      title: approve ? 'Authorization confirmed' : 'Authorization denied',
      body: `${claim.boards?.name || 'Your claim'} — ${approve ? 'the owner confirmed you represent them' : 'the owner denied this claim'}`,
      link: '/dashboard/agent',
    });

    setClaims(prev => prev.filter(c => c.id !== claim.id));
    showToast(approve ? 'Confirmed — their listings now show "Owner Verified"' : 'Denied and revoked');
    setResolving(null);
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 300 }}>
        <div style={{ width: 24, height: 24, border: '2px solid #E2E8F0', borderTopColor: '#7C3AED', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return (
    <div style={{ fontFamily: "'Inter', -apple-system, sans-serif", maxWidth: 680 }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: '1.375rem', fontWeight: 700, color: '#0F172A', margin: '0 0 4px' }}>Agent authorization requests</h1>
        <p style={{ fontSize: '0.875rem', color: '#64748B', margin: 0 }}>
          Someone claiming to be an agent linked your account to one of your boards. Confirm only if you actually authorized them to sell it — this is what upgrades their listing from "Owner Unverified" to "Owner Verified."
        </p>
      </div>

      {claims.length === 0 ? (
        <div style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: 12, padding: '3rem', textAlign: 'center' }}>
          <p style={{ fontSize: '0.875rem', color: '#94A3B8', margin: 0 }}>No pending requests.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {claims.map(c => (
            <div key={c.id} style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: 12, padding: '16px 20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
                <div>
                  <p style={{ fontSize: '0.9375rem', fontWeight: 700, color: '#0F172A', margin: '0 0 3px' }}>{c.boards?.name || 'Unknown board'}</p>
                  <p style={{ fontSize: '0.75rem', color: '#64748B', margin: 0 }}>
                    {c.boards?.city}{c.boards?.format ? ` · ${FORMAT_LABELS[c.boards.format] || c.boards.format}` : ''}
                  </p>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <p style={{ fontSize: '0.625rem', color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 2px' }}>Floor rate they set</p>
                  <p style={{ fontSize: '1rem', fontWeight: 700, color: '#0F172A', margin: 0, fontFamily: 'monospace' }}>{formatNaira(c.floor_rate)}</p>
                </div>
              </div>
              <div style={{ background: '#F8FAFC', borderRadius: 8, padding: '10px 14px', marginBottom: 12 }}>
                <p style={{ fontSize: '0.6875rem', color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 3px' }}>Claiming to be your agent</p>
                <p style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#0F172A', margin: '0 0 2px' }}>{c.agent?.company_name || c.agent?.full_name || 'Unknown'}</p>
                <p style={{ fontSize: '0.75rem', color: '#64748B', margin: 0 }}>{c.agent?.email}</p>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={() => respond(c, true)}
                  disabled={resolving === c.id}
                  style={{ flex: 1, padding: '9px', background: '#ECFDF5', color: '#065F46', border: '1px solid #A7F3D0', borderRadius: 8, fontSize: '0.8125rem', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}
                >
                  ✓ Yes, this is my agent
                </button>
                <button
                  onClick={() => respond(c, false)}
                  disabled={resolving === c.id}
                  style={{ flex: 1, padding: '9px', background: '#FEF2F2', color: '#7F1D1D', border: '1px solid #FECACA', borderRadius: 8, fontSize: '0.8125rem', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}
                >
                  ✕ No, deny this
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function AgentAuthorizationsPage() {
  return (
    <RoleGuard role="owner">
      <AgentAuthorizationsContent />
    </RoleGuard>
  );
}
