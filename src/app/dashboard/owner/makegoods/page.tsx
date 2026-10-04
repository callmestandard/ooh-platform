'use client';

import { useEffect, useState } from 'react';
import { useDashboardRole } from '@/components/layout/DashboardLayout';
import MakegoodCard from '@/components/makegoods/MakegoodCard';
import { label, card, h1, sub, page, errorBox, ghostBtn } from '@/components/owner/ui';
import { listMakegoods, isUnresolved, type Makegood } from '@/lib/makegoods';

// Owner side: what agencies have recorded as promised against this owner's
// boards. The owner (or the board's marketer) can mark one delivered and add
// a note; anything else is the agency's to change.
export default function OwnerMakegoodsPage() {
  const role = useDashboardRole();
  const [makegoods, setMakegoods] = useState<Makegood[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  async function load() {
    const { makegoods, error } = await listMakegoods();
    setMakegoods(makegoods);
    setError(error);
    setLoading(false);
  }
  useEffect(() => { if (role === 'owner' || role === 'marketer') (async () => { await load(); })(); }, [role]);

  if (role !== 'owner' && role !== 'marketer') return <div style={page}><p style={{ color: '#64748B', fontSize: '0.875rem' }}>This page is for board owners and their team.</p></div>;

  const open = makegoods.filter(isUnresolved);
  const shown = showAll ? makegoods : open;

  return (
    <div style={page}>
      <h1 style={h1}>Makegoods</h1>
      <p style={sub}>What you have promised agencies when one of your boards fell through or under-delivered. Mark each one delivered when it is done, so the agency can see it.</p>
      {error && <div style={errorBox}>{error}</div>}
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ ...label, margin: 0, flex: 1 }}>{showAll ? `All (${makegoods.length})` : `Outstanding (${open.length})`}</span>
          <button style={ghostBtn} onClick={() => setShowAll(v => !v)}>{showAll ? 'Show outstanding only' : 'Show all'}</button>
        </div>
        {loading ? <p style={{ fontSize: '0.8125rem', color: '#94A3B8', margin: '10px 0 0' }}>Loading…</p>
          : shown.length === 0 ? <p style={{ fontSize: '0.8125rem', color: '#94A3B8', margin: '10px 0 0' }}>{showAll ? 'Nothing recorded against your boards.' : 'Nothing outstanding.'}</p>
          : shown.map(m => <MakegoodCard key={m.id} makegood={m} side="owner" onChanged={load} />)}
      </div>
    </div>
  );
}
