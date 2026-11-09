'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useDashboardRole } from '@/components/layout/DashboardLayout';

// Owners claiming boards that were listed without an owner account (035).
// Approving hands the board to the claimant's company; other pending claims
// on the same board are rejected automatically (decide_board_claim).

type Claim = {
  id: string; board_id: string; claimant_id: string; status: 'pending' | 'approved' | 'rejected';
  created_at: string; decided_at: string | null;
  board: { id: string; name: string; city: string | null; area: string | null; address: string | null; owner_id: string | null } | null;
};
type Profile = { id: string; full_name: string | null; company_name: string | null; email: string | null; phone?: string | null };

const card: React.CSSProperties = { background: '#fff', border: '1px solid #E2E8F0', borderRadius: 12 };
const fmtDate = (d: string) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

export default function AdminClaimsPage() {
  const role = useDashboardRole();
  const [claims, setClaims] = useState<Claim[]>([]);
  const [people, setPeople] = useState<Record<string, Profile>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [showDecided, setShowDecided] = useState(false);

  async function refresh() {
    const { data, error } = await supabase
      .from('board_claims')
      .select('id, board_id, claimant_id, status, created_at, decided_at, board:boards(id, name, city, area, address, owner_id)')
      .order('created_at', { ascending: false })
      .limit(300);
    if (error) { setError(error.message); setLoading(false); return; }
    const rows = (data ?? []) as unknown as Claim[];
    setClaims(rows);
    const ids = [...new Set(rows.map(c => c.claimant_id))];
    if (ids.length) {
      const { data: p } = await supabase.from('profiles').select('id, full_name, company_name, email').in('id', ids);
      setPeople(Object.fromEntries(((p ?? []) as Profile[]).map(x => [x.id, x])));
    }
    setError(null);
    setLoading(false);
  }

  useEffect(() => {
    if (role !== 'admin') return;
    (async () => { await refresh(); })();
  }, [role]);

  async function decide(c: Claim, approve: boolean) {
    setBusy(c.id + (approve ? ':y' : ':n'));
    setError(null);
    const { error } = await supabase.rpc('decide_board_claim', { p_claim_id: c.id, p_approve: approve });
    if (!error) {
      await supabase.from('notifications').insert({
        recipient_role: 'owner', recipient_user_id: c.claimant_id, type: approve ? 'claim_approved' : 'claim_rejected',
        title: approve ? `Your claim was approved: ${c.board?.name ?? 'board'}` : `Your claim was not approved: ${c.board?.name ?? 'board'}`,
        body: approve ? 'The board is now in your inventory.' : 'Contact our team if you think this is a mistake.',
        link: approve ? '/dashboard/owner' : '/dashboard/owner/claim-boards',
      });
    }
    setBusy(null);
    if (error) { setError(error.message); return; }
    await refresh();
  }

  if (role !== 'admin') return <div style={{ padding: 32, color: '#64748B', fontSize: '0.875rem' }}>Admins only.</div>;

  const pending = claims.filter(c => c.status === 'pending');
  const decided = claims.filter(c => c.status !== 'pending');
  const rivals = (c: Claim) => pending.filter(x => x.board_id === c.board_id && x.id !== c.id).length;

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '8px 0 48px' }}>
      <h1 style={{ fontSize: '1.375rem', fontWeight: 800, color: '#0F172A', margin: '0 0 4px', letterSpacing: '-0.02em' }}>Board claims</h1>
      <p style={{ fontSize: '0.875rem', color: '#64748B', margin: '0 0 18px', maxWidth: 640 }}>
        Media owners asking to take over boards we listed for them. Check they really own the site (call them, ask for proof) before approving. Approving moves the board into their inventory and marks it partner verified.
      </p>
      {error && <div style={{ ...card, padding: 14, borderColor: '#FECACA', background: '#FEF2F2', color: '#B91C1C', fontSize: '0.8125rem', marginBottom: 14 }}>{error}</div>}

      {loading ? <div style={{ ...card, padding: 24, color: '#94A3B8', fontSize: '0.875rem' }}>Loading…</div> : (
        <>
          <div style={{ ...card, padding: pending.length ? 0 : 24 }}>
            {pending.length === 0 ? <p style={{ fontSize: '0.875rem', color: '#64748B', margin: 0 }}>No claims waiting.</p> : pending.map((c, i) => {
              const p = people[c.claimant_id];
              return (
                <div key={c.id} data-claim={c.id} style={{ padding: 16, borderTop: i ? '1px solid #F1F5F9' : 'none', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 220 }}>
                    <a href={`/boards/${c.board_id}`} target="_blank" rel="noopener noreferrer" style={{ fontSize: '0.9375rem', fontWeight: 700, color: '#0F172A', textDecoration: 'none' }}>{c.board?.name ?? 'Board'}</a>
                    <p style={{ fontSize: '0.75rem', color: '#64748B', margin: '2px 0 0' }}>{[c.board?.address, c.board?.area, c.board?.city].filter(Boolean).join(', ')}</p>
                    <p style={{ fontSize: '0.8125rem', color: '#0F172A', margin: '6px 0 0' }}>
                      <strong>{p?.company_name || p?.full_name || 'Unknown account'}</strong>
                      {p?.email && <> · <a href={`mailto:${p.email}`} style={{ color: '#1B4F8A' }}>{p.email}</a></>}
                      <span style={{ color: '#94A3B8' }}> · claimed {fmtDate(c.created_at)}</span>
                    </p>
                    {c.board?.owner_id && <p style={{ fontSize: '0.75rem', color: '#B91C1C', margin: '4px 0 0', fontWeight: 600 }}>This board already has an owner — approving will fail.</p>}
                    {rivals(c) > 0 && <p style={{ fontSize: '0.75rem', color: '#92400E', margin: '4px 0 0', fontWeight: 600 }}>{rivals(c)} other claim{rivals(c) > 1 ? 's' : ''} on this board — approving this one rejects the others.</p>}
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => decide(c, true)} disabled={!!busy} style={{ padding: '7px 14px', borderRadius: 8, border: 'none', background: '#10B981', color: '#fff', fontSize: '0.75rem', fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer' }}>{busy === c.id + ':y' ? 'Approving…' : 'Approve'}</button>
                    <button onClick={() => decide(c, false)} disabled={!!busy} style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid #CBD5E1', background: '#fff', color: '#B91C1C', fontSize: '0.75rem', fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer' }}>{busy === c.id + ':n' ? 'Rejecting…' : 'Reject'}</button>
                  </div>
                </div>
              );
            })}
          </div>

          {decided.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <button onClick={() => setShowDecided(v => !v)} style={{ background: 'none', border: 'none', color: '#1B4F8A', fontSize: '0.8125rem', fontWeight: 600, cursor: 'pointer', padding: 0, fontFamily: 'inherit' }}>
                {showDecided ? 'Hide' : 'Show'} decided claims ({decided.length})
              </button>
              {showDecided && (
                <div style={{ ...card, marginTop: 8 }}>
                  {decided.map((c, i) => {
                    const p = people[c.claimant_id];
                    return (
                      <div key={c.id} style={{ padding: '10px 16px', borderTop: i ? '1px solid #F1F5F9' : 'none', fontSize: '0.8125rem', color: '#334155', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 700, color: c.status === 'approved' ? '#065F46' : '#991B1B' }}>{c.status === 'approved' ? 'Approved' : 'Rejected'}</span>
                        <span>{c.board?.name ?? 'Board'}</span>
                        <span style={{ color: '#64748B' }}>· {p?.company_name || p?.full_name || 'Unknown'}{c.decided_at ? ` · ${fmtDate(c.decided_at)}` : ''}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
