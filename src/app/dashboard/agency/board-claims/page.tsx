'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { authedFetch } from '@/lib/api';
import { card, h1, sub, page, label, errorBox, okBox, btn, ghostBtn, fmtDate } from '@/components/owner/ui';

type Claim = {
  id: string; status: 'pending' | 'approved' | 'rejected'; created_at: string;
  board: { id: string; name: string; city: string | null; partner_name: string | null };
  claimant: { name: string; phone: string | null };
};

// Boards this account registered on behalf of an owner who wasn't on the
// platform. When that owner signs up and claims a board, it is confirmed here.
export default function BoardClaimsPage() {
  const [claims, setClaims] = useState<Claim[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function load() {
    const res = await authedFetch('/api/board-claims');
    if (res.ok) setClaims((await res.json()).claims ?? []); else setError('Could not load claims');
    setLoading(false);
  }
  useEffect(() => { (async () => { await load(); })(); }, []);

  async function decide(c: Claim, approve: boolean) {
    setError(null); setNotice(null);
    const { error } = await supabase.rpc('decide_board_claim', { p_claim_id: c.id, p_approve: approve });
    if (error) { setError(error.message); return; }
    setNotice(approve ? `${c.board.name} now belongs to ${c.claimant.name}. They manage its rate and requests from here on.` : 'Claim rejected.');
    await load();
  }

  const pending = claims.filter(c => c.status === 'pending');
  const decided = claims.filter(c => c.status !== 'pending');

  return (
    <div style={page}>
      <h1 style={h1}>Board claims</h1>
      <p style={sub}>Owners claiming boards you registered for them. Confirming a claim hands the board to the owner: they take over its rate card and incoming requests, and the rate becomes private to them.</p>
      {error && <div style={errorBox}>{error}</div>}
      {notice && <div style={okBox} data-notice>{notice}</div>}

      <div style={card}>
        <span style={label}>Waiting for you ({pending.length})</span>
        {loading ? <p style={{ fontSize: '0.8125rem', color: '#94A3B8', margin: 0 }}>Loading…</p>
          : pending.length === 0 ? <p style={{ fontSize: '0.8125rem', color: '#94A3B8', margin: 0 }}>No claims waiting.</p>
          : pending.map(c => (
            <div key={c.id} data-claim={c.id} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, padding: '12px 0', borderTop: '1px solid #F1F5F9' }}>
              <div style={{ flex: '1 1 260px', minWidth: 0 }}>
                <p style={{ fontSize: '0.875rem', fontWeight: 700, color: '#0F172A', margin: 0 }}>{c.board.name}</p>
                <p style={{ fontSize: '0.75rem', color: '#64748B', margin: '2px 0 0' }}>
                  {c.board.city ?? '—'} · you recorded the owner as “{c.board.partner_name ?? 'not recorded'}”
                </p>
                <p style={{ fontSize: '0.75rem', color: '#334155', margin: '4px 0 0' }}>
                  Claimed by <strong>{c.claimant.name}</strong>{c.claimant.phone ? ` · ${c.claimant.phone}` : ''} on {fmtDate(c.created_at)}
                </p>
              </div>
              <button style={btn(true, '#1B4F8A')} onClick={() => decide(c, true)}>Confirm — it&apos;s theirs</button>
              <button style={{ ...ghostBtn, color: '#EF4444' }} onClick={() => decide(c, false)}>Reject</button>
            </div>
          ))}
      </div>

      {decided.length > 0 && (
        <div style={card}>
          <span style={label}>Decided</span>
          {decided.map(c => (
            <div key={c.id} style={{ display: 'flex', gap: 10, padding: '8px 0', borderTop: '1px solid #F1F5F9', fontSize: '0.8125rem', color: '#475569' }}>
              <span style={{ flex: 1 }}>{c.board.name} — {c.claimant.name}</span>
              <span style={{ fontWeight: 700, color: c.status === 'approved' ? '#15803D' : '#B91C1C' }}>{c.status === 'approved' ? 'Confirmed' : 'Rejected'}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
