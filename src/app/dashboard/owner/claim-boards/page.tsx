'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useDashboardRole } from '@/components/layout/DashboardLayout';
import { boardFormatLabel } from '@/lib/board-formats';
import { input, card, h1, sub, page, label, errorBox, okBox, btn } from '@/components/owner/ui';

type Unowned = { id: string; name: string; city: string | null; address: string | null; format: string | null; partner_name: string | null; contact_phone: string | null };
type MyClaim = { id: string; board_id: string; status: 'pending' | 'approved' | 'rejected' };

// An owner who has just joined finds boards an agency already registered in
// their name, and claims them. The agency that registered each board (or a
// platform admin) confirms the claim before ownership changes hands.
export default function ClaimBoardsPage() {
  const role = useDashboardRole();
  const [company, setCompany] = useState('');
  const [query, setQuery] = useState('');
  const [boards, setBoards] = useState<Unowned[]>([]);
  const [claims, setClaims] = useState<MyClaim[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function search(q: string) {
    const term = q.trim().replace(/[%,()]/g, ' ');
    if (term.length < 3) { setBoards([]); return; }
    const { data, error } = await supabase
      .from('boards')
      .select('id, name, city, address, format, partner_name, contact_phone')
      .is('owner_id', null)
      .or(`partner_name.ilike.%${term}%,name.ilike.%${term}%`)
      .order('name')
      .limit(100);
    if (error) setError(error.message);
    setBoards((data ?? []) as Unowned[]);
  }

  async function loadClaims() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    const { data } = await supabase.from('board_claims').select('id, board_id, status').eq('claimant_id', session.user.id);
    setClaims((data ?? []) as MyClaim[]);
  }

  useEffect(() => {
    if (role !== 'owner') return;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        const { data } = await supabase.from('profiles').select('company_name, full_name').eq('id', session.user.id).maybeSingle();
        const name = (data as { company_name?: string; full_name?: string } | null)?.company_name || '';
        setCompany(name); setQuery(name);
        await Promise.all([search(name), loadClaims()]);
      }
      setLoading(false);
    })();
  }, [role]);

  async function claim(b: Unowned) {
    setError(null); setNotice(null);
    const { error } = await supabase.from('board_claims').insert({ board_id: b.id });
    if (error) { setError(/duplicate/i.test(error.message) ? 'You have already claimed this board.' : error.message); return; }
    setNotice(`Claim sent for ${b.name}. The agency that registered it will be asked to confirm.`);
    await loadClaims();
  }

  if (role !== 'owner') return <div style={page}><p style={{ color: '#64748B', fontSize: '0.875rem' }}>Claiming boards is for board owner accounts.</p></div>;

  const statusOf = (id: string) => claims.find(c => c.board_id === id)?.status;

  return (
    <div style={page}>
      <h1 style={h1}>Claim your boards</h1>
      <p style={sub}>An agency may already have registered some of your boards before you joined. Find them here and claim them. Once the agency confirms, the board moves to your account and its rate becomes yours to control.</p>
      {error && <div style={errorBox}>{error}</div>}
      {notice && <div style={okBox} data-notice>{notice}</div>}

      <div style={card}>
        <span style={label}>Search unclaimed boards by your company name or the board name</span>
        <div style={{ display: 'flex', gap: 8, maxWidth: 520 }}>
          <input style={input} value={query} onChange={e => setQuery(e.target.value)} placeholder={company || 'Company name'} aria-label="Search" onKeyDown={e => { if (e.key === 'Enter') search(query); }} />
          <button style={btn(query.trim().length >= 3)} disabled={query.trim().length < 3} onClick={() => search(query)}>Search</button>
        </div>
      </div>

      <div style={card}>
        <span style={label}>Unclaimed boards matching “{query.trim() || '…'}” ({boards.length})</span>
        {loading ? <p style={{ fontSize: '0.8125rem', color: '#94A3B8', margin: 0 }}>Loading…</p>
          : boards.length === 0 ? <p style={{ fontSize: '0.8125rem', color: '#94A3B8', margin: 0 }}>No unclaimed boards match. Try a different spelling of your company name.</p>
          : boards.map(b => {
            const st = statusOf(b.id);
            return (
              <div key={b.id} data-board={b.id} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, padding: '11px 0', borderTop: '1px solid #F1F5F9' }}>
                <div style={{ flex: '1 1 260px', minWidth: 0 }}>
                  <p style={{ fontSize: '0.875rem', fontWeight: 700, color: '#0F172A', margin: 0 }}>{b.name}</p>
                  <p style={{ fontSize: '0.75rem', color: '#64748B', margin: '2px 0 0' }}>
                    {[b.address, b.city].filter(Boolean).join(', ') || '—'} · {boardFormatLabel(b.format)} · recorded owner: {b.partner_name ?? 'not recorded'}
                  </p>
                </div>
                {st === 'pending' ? <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#92400E' }}>Waiting for confirmation</span>
                  : st === 'rejected' ? <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#B91C1C' }}>Claim rejected</span>
                  : <button style={btn()} onClick={() => claim(b)}>This is my board</button>}
              </div>
            );
          })}
      </div>
    </div>
  );
}
