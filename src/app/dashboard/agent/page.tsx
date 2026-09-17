'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { RoleGuard } from '@/components/layout/RoleGuard';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/components/ui/Toast';
import { computeTrustBadge, TrustBadgePill } from '@/lib/agent-listings';
import { createNotification } from '@/lib/notifications';

type Board = {
  id: string;
  name: string;
  city: string;
  state: string | null;
  format: string;
  asking_rate: number;
};

type Authorization = {
  id: string;
  board_id: string;
  floor_rate: number;
  owner_verified: boolean;
  owner_id: string | null;
  status: 'active' | 'revoked' | 'disputed';
  dispute_notes: string | null;
  created_at: string;
  boards: Board | null;
};

type Listing = {
  id: string;
  board_id: string;
  sell_price: number;
  authorization_id: string;
  status: string;
};

const FORMAT_LABELS: Record<string, string> = {
  billboard: 'Billboard', unipole: 'Unipole', gantry: 'Gantry',
  bridge_panel: 'Bridge Panel', wall_drape: 'Wall Drape', digital: 'Digital/LED', led: 'LED',
};

function formatNaira(n: number | null | undefined) {
  if (!n) return '₦0';
  return '₦' + Number(n).toLocaleString('en-NG');
}

const STATUS_CFG: Record<string, { label: string; bg: string; color: string }> = {
  active:   { label: 'Active',   bg: '#ECFDF5', color: '#065F46' },
  disputed: { label: 'Disputed — pending admin review', bg: '#FEF2F2', color: '#991B1B' },
  revoked:  { label: 'Revoked',  bg: '#F1F5F9', color: '#64748B' },
};

function AgentDashboardContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { toast: showToast } = useToast();
  const tab = (searchParams.get('tab') as 'claims' | 'claim' | 'listings') || 'claims';

  const [userId, setUserId] = useState<string | null>(null);
  const [authorizations, setAuthorizations] = useState<Authorization[]>([]);
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);

  // ── Claim form state ──
  const [boardMode, setBoardMode] = useState<'existing' | 'new'>('existing');
  const [boardQuery, setBoardQuery] = useState('');
  const [boardResults, setBoardResults] = useState<Board[]>([]);
  const [selectedBoardId, setSelectedBoardId] = useState('');
  const [newBoard, setNewBoard] = useState({ name: '', city: '', state: '', format: 'billboard', address: '' });
  const [floorRate, setFloorRate] = useState('');
  const [ownerMode, setOwnerMode] = useState<'unverified' | 'link'>('unverified');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [submittingClaim, setSubmittingClaim] = useState(false);
  const [claimResult, setClaimResult] = useState<{ ok: boolean; message: string } | null>(null);

  // ── Listing form state ──
  const [sellPriceDraft, setSellPriceDraft] = useState<Record<string, string>>({});
  const [savingListing, setSavingListing] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) { setUserId(user.id); load(user.id); }
    });
  }, []);

  async function load(uid: string) {
    setLoading(true);
    const [authRes, listRes] = await Promise.all([
      supabase.from('board_authorizations').select('*, boards(id, name, city, state, format, asking_rate)').eq('agent_id', uid).order('created_at', { ascending: false }),
      supabase.from('listings').select('*').eq('agent_id', uid),
    ]);
    setAuthorizations((authRes.data as Authorization[]) || []);
    setListings((listRes.data as Listing[]) || []);
    setLoading(false);
  }

  // ── Board search for "existing board" mode ──
  useEffect(() => {
    if (boardMode !== 'existing' || boardQuery.trim().length < 2) { setBoardResults([]); return; }
    const t = setTimeout(() => {
      supabase.from('boards').select('id, name, city, state, format, asking_rate')
        .ilike('name', `%${boardQuery.trim()}%`)
        .limit(8)
        .then(({ data }) => setBoardResults((data as Board[]) || []));
    }, 250);
    return () => clearTimeout(t);
  }, [boardQuery, boardMode]);

  async function submitClaim() {
    if (!userId) return;
    const rate = parseFloat(floorRate);
    if (!rate || rate <= 0) { setClaimResult({ ok: false, message: 'Enter a valid floor rate.' }); return; }
    if (boardMode === 'existing' && !selectedBoardId) { setClaimResult({ ok: false, message: 'Select a board first.' }); return; }
    if (boardMode === 'new' && (!newBoard.name.trim() || !newBoard.city.trim())) { setClaimResult({ ok: false, message: 'Board name and city are required.' }); return; }

    setSubmittingClaim(true);
    setClaimResult(null);
    try {
      let boardId = selectedBoardId;

      if (boardMode === 'new') {
        // owner_id left null — the true owner isn't on the platform yet,
        // this board exists only because the agent is bringing it here
        const { data: board, error: boardErr } = await supabase
          .from('boards')
          .insert({
            name: newBoard.name.trim(), city: newBoard.city.trim(), state: newBoard.state.trim() || null,
            format: newBoard.format, address: newBoard.address.trim() || null,
            asking_rate: rate, status: 'available', owner_id: null,
          })
          .select('id')
          .single();
        if (boardErr || !board) throw new Error(boardErr?.message || 'Failed to create board');
        boardId = board.id;
      }

      let ownerId: string | null = null;
      if (ownerMode === 'link') {
        if (!ownerEmail.trim()) throw new Error('Enter the owner\'s email to link their account.');
        const { data: ownerProfile } = await supabase.from('profiles').select('id, role').ilike('email', ownerEmail.trim()).maybeSingle();
        if (!ownerProfile) throw new Error('No platform account found with that email. Use "Owner not on platform yet" instead.');
        if (ownerProfile.role !== 'owner') throw new Error('That account exists but is not registered as a Board Owner.');
        ownerId = ownerProfile.id;
      }

      const { data: authRow, error: authErr } = await supabase
        .from('board_authorizations')
        .insert({
          board_id: boardId, agent_id: userId, floor_rate: rate,
          owner_id: ownerId, owner_verified: false, created_by: userId,
        })
        .select('*')
        .single();

      if (authErr) throw new Error(authErr.message);

      if (authRow.status === 'disputed') {
        setClaimResult({ ok: false, message: 'Another agent already holds an active claim on this board. Both claims have been flagged for admin review — you\'ll be notified once it\'s resolved.' });
      } else {
        if (ownerId) {
          await createNotification({
            recipientRole: 'owner',
            recipientUserId: ownerId,
            type: 'agent_authorization_request',
            title: 'An agent claims to represent you',
            body: `${boardMode === 'new' ? newBoard.name.trim() : boardQuery} — confirm if you actually authorized them to sell this board.`,
            link: '/dashboard/owner/agent-authorizations',
          });
          setClaimResult({ ok: true, message: 'Claim recorded and the owner has been notified to confirm. Until they do, your listing will show "Owner Unverified."' });
        } else {
          setClaimResult({ ok: true, message: 'Claim recorded. You can now create a listing for it under "My Listings".' });
        }
        setFloorRate(''); setSelectedBoardId(''); setBoardQuery(''); setOwnerEmail('');
        setNewBoard({ name: '', city: '', state: '', format: 'billboard', address: '' });
      }
      load(userId);
    } catch (err) {
      setClaimResult({ ok: false, message: err instanceof Error ? err.message : 'Failed to submit claim' });
    } finally {
      setSubmittingClaim(false);
    }
  }

  async function saveListing(auth: Authorization) {
    if (!userId) return;
    const draft = sellPriceDraft[auth.id];
    const price = parseFloat(draft);
    if (!price || price <= 0) { showToast('Enter a valid sell price', 'error'); return; }
    if (price < auth.floor_rate) { showToast(`Sell price can't be below your floor rate of ${formatNaira(auth.floor_rate)}`, 'error'); return; }

    setSavingListing(auth.id);
    const existing = listings.find(l => l.authorization_id === auth.id);
    const payload = { board_id: auth.board_id, agent_id: userId, sell_price: price, authorization_id: auth.id, created_by: userId };
    const { error } = existing
      ? await supabase.from('listings').update({ sell_price: price }).eq('id', existing.id)
      : await supabase.from('listings').insert(payload);

    if (error) {
      // the floor-rate trigger raises here if somehow bypassed client-side
      showToast(error.message, 'error');
    } else {
      showToast(existing ? 'Listing updated' : 'Listing created — now visible in the agency shortlist');
      load(userId);
    }
    setSavingListing(null);
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 300 }}>
        <div style={{ width: 24, height: 24, border: '2px solid #E2E8F0', borderTopColor: '#D97706', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return (
    <div style={{ fontFamily: "'Inter', -apple-system, sans-serif", maxWidth: 880 }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: '1.375rem', fontWeight: 700, color: '#0F172A', margin: '0 0 4px' }}>Agent workspace</h1>
        <p style={{ fontSize: '0.875rem', color: '#64748B', margin: 0 }}>Claim selling rights to boards and manage your listings — your agent status is always visible on every listing you create.</p>
      </div>

      <div style={{ display: 'flex', gap: 4, background: '#F1F5F9', padding: 4, borderRadius: 10, width: 'fit-content', marginBottom: 24 }}>
        {[
          { key: 'claims', label: `My Claims (${authorizations.length})` },
          { key: 'claim', label: '+ Claim a Board' },
          { key: 'listings', label: `My Listings (${listings.length})` },
        ].map(t => (
          <button key={t.key} onClick={() => router.push(`/dashboard/agent?tab=${t.key}`)} style={{
            padding: '7px 16px', borderRadius: 7, border: 'none',
            background: tab === t.key ? '#fff' : 'transparent',
            color: tab === t.key ? '#0F172A' : '#64748B',
            fontSize: '0.8125rem', fontWeight: tab === t.key ? 600 : 400,
            cursor: 'pointer', fontFamily: 'inherit',
            boxShadow: tab === t.key ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
          }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── My Claims ── */}
      {tab === 'claims' && (
        authorizations.length === 0 ? (
          <div style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: 12, padding: '3rem', textAlign: 'center' }}>
            <p style={{ fontSize: '0.875rem', color: '#94A3B8', margin: '0 0 12px' }}>You haven't claimed any boards yet.</p>
            <button onClick={() => router.push('/dashboard/agent?tab=claim')} style={{ background: '#D97706', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 18px', fontSize: '0.8125rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
              Claim your first board
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {authorizations.map(a => {
              const cfg = STATUS_CFG[a.status];
              const listing = listings.find(l => l.authorization_id === a.id);
              const badge = computeTrustBadge({ agent_id: userId }, a);
              return (
                <div key={a.id} style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: 12, padding: '14px 18px' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                    <div>
                      <p style={{ fontSize: '0.9375rem', fontWeight: 700, color: '#0F172A', margin: '0 0 3px' }}>{a.boards?.name || 'Unknown board'}</p>
                      <p style={{ fontSize: '0.75rem', color: '#64748B', margin: '0 0 8px' }}>{a.boards?.city}{a.boards?.format ? ` · ${FORMAT_LABELS[a.boards.format] || a.boards.format}` : ''}</p>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '0.6875rem', fontWeight: 700, color: cfg.color, background: cfg.bg, padding: '3px 9px', borderRadius: 999 }}>{cfg.label}</span>
                        <TrustBadgePill badge={badge} small />
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <p style={{ fontSize: '0.625rem', color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 2px' }}>Floor rate</p>
                      <p style={{ fontSize: '1rem', fontWeight: 700, color: '#0F172A', margin: 0, fontFamily: 'monospace' }}>{formatNaira(a.floor_rate)}</p>
                    </div>
                  </div>
                  {a.status === 'disputed' && a.dispute_notes && (
                    <div style={{ marginTop: 10, background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: '8px 12px' }}>
                      <p style={{ fontSize: '0.75rem', color: '#7F1D1D', margin: 0, whiteSpace: 'pre-line' }}>{a.dispute_notes.trim()}</p>
                    </div>
                  )}
                  {a.status === 'active' && (
                    <div style={{ marginTop: 10 }}>
                      {listing ? (
                        <p style={{ fontSize: '0.75rem', color: '#059669', margin: 0, fontWeight: 600 }}>✓ Listed at {formatNaira(listing.sell_price)}/mo — manage under "My Listings"</p>
                      ) : (
                        <button onClick={() => router.push('/dashboard/agent?tab=listings')} style={{ background: '#FFFBEB', color: '#92400E', border: '1px solid #FDE68A', borderRadius: 7, padding: '6px 12px', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                          Not listed yet — create a listing →
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )
      )}

      {/* ── Claim a Board ── */}
      {tab === 'claim' && (
        <div style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: 12, padding: '22px 24px', maxWidth: 560 }}>
          <div style={{ marginBottom: 18 }}>
            <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, color: '#374151', marginBottom: 8 }}>Which board?</label>
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              {(['existing', 'new'] as const).map(m => (
                <button key={m} onClick={() => setBoardMode(m)} style={{
                  padding: '7px 14px', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.8125rem', fontWeight: 600,
                  border: boardMode === m ? '1.5px solid #D97706' : '1.5px solid #E2E8F0',
                  background: boardMode === m ? '#FFFBEB' : '#fff', color: boardMode === m ? '#92400E' : '#64748B',
                }}>
                  {m === 'existing' ? 'Search existing board' : "+ It doesn't exist yet"}
                </button>
              ))}
            </div>

            {boardMode === 'existing' ? (
              <div style={{ position: 'relative' }}>
                <input
                  value={boardQuery}
                  onChange={e => { setBoardQuery(e.target.value); setSelectedBoardId(''); }}
                  placeholder="Search by board name…"
                  style={{ width: '100%', padding: '9px 12px', border: '1.5px solid #E2E8F0', borderRadius: 8, fontSize: '0.875rem', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }}
                />
                {boardResults.length > 0 && !selectedBoardId && (
                  <div style={{ border: '1px solid #E2E8F0', borderRadius: 8, marginTop: 6, overflow: 'hidden' }}>
                    {boardResults.map(b => (
                      <button key={b.id} onClick={() => { setSelectedBoardId(b.id); setBoardQuery(b.name); setBoardResults([]); }}
                        style={{ display: 'block', width: '100%', textAlign: 'left', padding: '9px 12px', background: '#fff', border: 'none', borderTop: '1px solid #F1F5F9', cursor: 'pointer', fontFamily: 'inherit' }}>
                        <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#0F172A' }}>{b.name}</span>
                        <span style={{ fontSize: '0.75rem', color: '#94A3B8', marginLeft: 6 }}>{b.city} · {formatNaira(b.asking_rate)}/mo asking</span>
                      </button>
                    ))}
                  </div>
                )}
                {selectedBoardId && <p style={{ fontSize: '0.75rem', color: '#059669', margin: '6px 0 0', fontWeight: 600 }}>✓ Board selected</p>}
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <input value={newBoard.name} onChange={e => setNewBoard(p => ({ ...p, name: e.target.value }))} placeholder="Board name *" style={miniInput} />
                <select value={newBoard.format} onChange={e => setNewBoard(p => ({ ...p, format: e.target.value }))} style={miniInput}>
                  {Object.entries(FORMAT_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
                <input value={newBoard.city} onChange={e => setNewBoard(p => ({ ...p, city: e.target.value }))} placeholder="City *" style={miniInput} />
                <input value={newBoard.state} onChange={e => setNewBoard(p => ({ ...p, state: e.target.value }))} placeholder="State" style={miniInput} />
                <input value={newBoard.address} onChange={e => setNewBoard(p => ({ ...p, address: e.target.value }))} placeholder="Address" style={{ ...miniInput, gridColumn: '1 / -1' }} />
              </div>
            )}
          </div>

          <div style={{ marginBottom: 18 }}>
            <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, color: '#374151', marginBottom: 8 }}>
              Floor rate — the minimum you've agreed with the owner *
            </label>
            <input value={floorRate} onChange={e => setFloorRate(e.target.value.replace(/[^0-9]/g, ''))} placeholder="e.g. 800000" style={miniInput} />
            <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: '4px 0 0' }}>You can sell at or above this — the difference is your margin.</p>
          </div>

          <div style={{ marginBottom: 20 }}>
            <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, color: '#374151', marginBottom: 8 }}>Is the real owner on the platform?</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', border: `1.5px solid ${ownerMode === 'unverified' ? '#D97706' : '#E2E8F0'}`, borderRadius: 8, cursor: 'pointer' }}>
                <input type="radio" checked={ownerMode === 'unverified'} onChange={() => setOwnerMode('unverified')} />
                <span style={{ fontSize: '0.8125rem', color: '#374151' }}>Not yet — I'm representing them off-platform <em style={{ color: '#94A3B8' }}>(lower trust badge)</em></span>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', border: `1.5px solid ${ownerMode === 'link' ? '#D97706' : '#E2E8F0'}`, borderRadius: 8, cursor: 'pointer' }}>
                <input type="radio" checked={ownerMode === 'link'} onChange={() => setOwnerMode('link')} />
                <span style={{ fontSize: '0.8125rem', color: '#374151' }}>Yes — link their account by email</span>
              </label>
              {ownerMode === 'link' && (
                <input value={ownerEmail} onChange={e => setOwnerEmail(e.target.value)} placeholder="owner@company.com" style={miniInput} />
              )}
              {ownerMode === 'link' && (
                <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: 0 }}>
                  Linking their account does not itself verify the claim — the badge only upgrades once the owner confirms it themselves.
                </p>
              )}
            </div>
          </div>

          {claimResult && (
            <div style={{ background: claimResult.ok ? '#ECFDF5' : '#FEF2F2', border: `1px solid ${claimResult.ok ? '#A7F3D0' : '#FECACA'}`, borderRadius: 8, padding: '10px 14px', marginBottom: 16 }}>
              <p style={{ fontSize: '0.8125rem', color: claimResult.ok ? '#065F46' : '#7F1D1D', margin: 0 }}>{claimResult.message}</p>
            </div>
          )}

          <button onClick={submitClaim} disabled={submittingClaim} style={{
            width: '100%', padding: '11px', background: submittingClaim ? '#F1F5F9' : '#D97706', color: submittingClaim ? '#94A3B8' : '#fff',
            border: 'none', borderRadius: 8, fontSize: '0.875rem', fontWeight: 700, cursor: submittingClaim ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
          }}>
            {submittingClaim ? 'Submitting…' : 'Submit claim'}
          </button>
        </div>
      )}

      {/* ── My Listings ── */}
      {tab === 'listings' && (
        authorizations.filter(a => a.status === 'active').length === 0 ? (
          <div style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: 12, padding: '3rem', textAlign: 'center' }}>
            <p style={{ fontSize: '0.875rem', color: '#94A3B8', margin: 0 }}>No active claims to list yet — claim a board first.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {authorizations.filter(a => a.status === 'active').map(a => {
              const listing = listings.find(l => l.authorization_id === a.id);
              const badge = computeTrustBadge({ agent_id: userId }, a);
              return (
                <div key={a.id} style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: 12, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 180 }}>
                    <p style={{ fontSize: '0.875rem', fontWeight: 700, color: '#0F172A', margin: '0 0 3px' }}>{a.boards?.name}</p>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <span style={{ fontSize: '0.75rem', color: '#64748B' }}>Floor {formatNaira(a.floor_rate)}</span>
                      <TrustBadgePill badge={badge} small />
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input
                      value={sellPriceDraft[a.id] ?? String(listing?.sell_price ?? '')}
                      onChange={e => setSellPriceDraft(p => ({ ...p, [a.id]: e.target.value.replace(/[^0-9]/g, '') }))}
                      placeholder="Sell price"
                      style={{ ...miniInput, width: 140, marginBottom: 0 }}
                    />
                    <button onClick={() => saveListing(a)} disabled={savingListing === a.id} style={{
                      background: '#1B4F8A', color: '#fff', border: 'none', borderRadius: 7, padding: '9px 16px',
                      fontSize: '0.8125rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
                    }}>
                      {savingListing === a.id ? 'Saving…' : listing ? 'Update' : 'Create listing'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )
      )}
    </div>
  );
}

const miniInput: React.CSSProperties = {
  width: '100%', padding: '9px 12px', border: '1.5px solid #E2E8F0', borderRadius: 8,
  fontSize: '0.875rem', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box', marginBottom: 0,
};

export default function AgentDashboardPage() {
  return (
    <RoleGuard role="agent">
      <Suspense fallback={null}>
        <AgentDashboardContent />
      </Suspense>
    </RoleGuard>
  );
}
