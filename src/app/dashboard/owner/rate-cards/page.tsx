'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { input, label, card, h1, sub, page, errorBox, okBox, btn, ghostBtn, fmtDate } from '@/components/owner/ui';
import { boardFormatLabel } from '@/lib/board-formats';
import { RATE_VISIBILITY_LABELS, type RateVisibility } from '@/lib/board-rates';
import {
  fetchMyCompany, listTeam, listCompanyBoards, updateBoardTeamFields, fetchRateCards, saveRateCard,
  listBookedRanges, addBookedRange, removeBookedRange, setDefaultRateVisibility,
  listApprovedAgencies, approveAgencyByEmail, removeApprovedAgency,
  type MyCompany, type TeamMember, type TeamBoard, type RateCard, type BookedRange,
} from '@/lib/owner-team';

type Draft = { monthly: string; annual: string; production: string; maxDiscount: string };
const VIS: RateVisibility[] = ['hidden', 'approved_agencies', 'all_verified_agencies'];
const num = (s: string) => (s.trim() === '' ? null : Number(s));
const toDraft = (c?: RateCard): Draft => ({
  monthly: c?.gross_monthly_rate != null ? String(c.gross_monthly_rate) : '', annual: c?.gross_annual_rate != null ? String(c.gross_annual_rate) : '',
  production: c?.production_cost != null ? String(c.production_cost) : '', maxDiscount: c?.max_discount_pct != null ? String(c.max_discount_pct) : '',
});

export default function RateCardsPage() {
  const [company, setCompany] = useState<MyCompany | null>(null);
  const [userId, setUserId] = useState('');
  const [boards, setBoards] = useState<TeamBoard[]>([]);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [ranges, setRanges] = useState<BookedRange[]>([]);
  const [rangeDraft, setRangeDraft] = useState<Record<string, { start: string; end: string; note: string }>>({});
  const [defaultVis, setDefaultVis] = useState<RateVisibility>('hidden');
  const [agencies, setAgencies] = useState<{ agency_id: string; name: string }[]>([]);
  const [agencyEmail, setAgencyEmail] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function refresh(c: MyCompany, uid: string) {
    const b = await listCompanyBoards(c, uid);
    const ids = b.map(x => x.id);
    const [cards, r] = await Promise.all([fetchRateCards(ids), listBookedRanges(ids)]);
    setBoards(b);
    setDrafts(Object.fromEntries(b.map(x => [x.id, toDraft(cards[x.id])])));
    setRanges(r);
  }

  useEffect(() => {
    (async () => {
      const [{ data: { session } }, c] = await Promise.all([supabase.auth.getSession(), fetchMyCompany()]);
      setCompany(c);
      const uid = session?.user.id ?? '';
      setUserId(uid);
      if (c) {
        await refresh(c, uid);
        if (c.team_role !== 'marketer') {
          const [team, appr, prof] = await Promise.all([
            listTeam(c.owner_id), listApprovedAgencies(c.owner_id),
            supabase.from('profiles').select('default_rate_visibility').eq('id', c.owner_id).maybeSingle(),
          ]);
          setMembers(team.members.filter(m => m.active));
          setAgencies(appr);
          setDefaultVis(((prof.data as { default_rate_visibility?: RateVisibility } | null)?.default_rate_visibility) ?? 'hidden');
        }
      }
      setLoading(false);
    })();
  }, []);

  if (loading) return <div style={page}><p style={{ color: '#94A3B8', fontSize: '0.875rem' }}>Loading…</p></div>;
  if (!company) return <div style={page}><p style={{ color: '#64748B', fontSize: '0.875rem' }}>Rate cards are managed by board owners and their team.</p></div>;

  const isAdmin = company.team_role !== 'marketer';
  const act = async (fn: () => Promise<{ error: string | null }>, ok?: string) => {
    setError(null); setNotice(null);
    const { error } = await fn();
    if (error) setError(error); else { if (ok) setNotice(ok); await refresh(company, userId); }
  };

  return (
    <div style={page}>
      <h1 style={h1}>Rates &amp; assignment</h1>
      <p style={sub}>
        Rates are private. Nobody outside your company sees a board&apos;s rate unless you choose to show it, and the maximum discount is visible only to you and marketers you allow.
      </p>
      {error && <div style={errorBox}>{error}</div>}
      {notice && <div style={okBox} data-notice>{notice}</div>}

      {isAdmin && (
        <div style={card}>
          <span style={{ ...label, marginBottom: 10 }}>Who can see your rates by default</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 6 }}>
            {VIS.map(v => (
              <button key={v} data-default-vis={v} disabled={company.team_role !== 'owner'}
                onClick={() => act(async () => { const r = await setDefaultRateVisibility(company.owner_id, v); if (!r.error) setDefaultVis(v); return r; }, 'Default updated.')}
                style={{ ...ghostBtn, background: defaultVis === v ? '#7C3AED' : '#fff', color: defaultVis === v ? '#fff' : '#475569' }}>
                {RATE_VISIBILITY_LABELS[v]}
              </button>
            ))}
          </div>
          <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: '0 0 14px' }}>Applies to every board that doesn&apos;t have its own setting below. Only the owner account can change the default.</p>

          <span style={label}>Approved agencies</span>
          {agencies.length === 0 ? <p style={{ fontSize: '0.8125rem', color: '#94A3B8', margin: '0 0 8px' }}>No agencies approved yet.</p> : agencies.map(a => (
            <div key={a.agency_id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', borderTop: '1px solid #F1F5F9', fontSize: '0.8125rem' }}>
              <span style={{ flex: 1 }}>{a.name}</span>
              <button style={{ ...ghostBtn, color: '#EF4444' }} onClick={async () => { const r = await removeApprovedAgency(company.owner_id, a.agency_id); if (r.error) setError(r.error); else setAgencies(await listApprovedAgencies(company.owner_id)); }}>Remove</button>
            </div>
          ))}
          <div style={{ display: 'flex', gap: 8, marginTop: 8, maxWidth: 460 }}>
            <input style={input} type="email" placeholder="Agency login email" value={agencyEmail} onChange={e => setAgencyEmail(e.target.value)} aria-label="Agency email" />
            <button style={btn(!!agencyEmail.trim())} disabled={!agencyEmail.trim()} onClick={async () => {
              setError(null);
              const r = await approveAgencyByEmail(agencyEmail);
              if (r.error) setError(r.error); else { setAgencyEmail(''); setAgencies(await listApprovedAgencies(company.owner_id)); }
            }}>Approve</button>
          </div>
        </div>
      )}

      <div style={card}>
        <span style={label}>{isAdmin ? 'All boards' : 'Boards assigned to you'}</span>
        {boards.length === 0 ? <p style={{ fontSize: '0.8125rem', color: '#94A3B8', margin: 0 }}>No boards yet.</p> : boards.map(b => {
          const d = drafts[b.id] ?? toDraft();
          const open = openId === b.id;
          const boardRanges = ranges.filter(r => r.board_id === b.id);
          const rd = rangeDraft[b.id] ?? { start: '', end: '', note: '' };
          const setD = (p: Partial<Draft>) => setDrafts(prev => ({ ...prev, [b.id]: { ...d, ...p } }));
          return (
            <div key={b.id} data-board={b.id} style={{ borderTop: '1px solid #F1F5F9', padding: '12px 0' }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
                <div style={{ flex: '1 1 200px', minWidth: 0 }}>
                  <p style={{ fontSize: '0.875rem', fontWeight: 700, color: '#0F172A', margin: 0 }}>{b.name}</p>
                  <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: '2px 0 0' }}>
                    {b.city ?? '—'} · {boardFormatLabel(b.format)} · {d.monthly ? `₦${Number(d.monthly).toLocaleString('en-NG')}/mo` : 'no rate set'}
                  </p>
                </div>
                {isAdmin && (
                  <>
                    <select style={{ ...input, width: 170 }} value={b.assigned_marketer_id ?? ''} aria-label="Assigned marketer"
                      onChange={e => act(() => updateBoardTeamFields(b.id, { assigned_marketer_id: e.target.value || null }), 'Assignment updated.')}>
                      <option value="">Unassigned (comes to you)</option>
                      {members.map(m => <option key={m.member_profile_id} value={m.member_profile_id}>{m.member_name ?? m.invited_email}</option>)}
                    </select>
                    <select style={{ ...input, width: 210 }} value={b.rate_visibility ?? ''} aria-label="Rate visibility"
                      onChange={e => act(() => updateBoardTeamFields(b.id, { rate_visibility: (e.target.value || null) as RateVisibility | null }), 'Visibility updated.')}>
                      <option value="">Use default ({RATE_VISIBILITY_LABELS[defaultVis]})</option>
                      {VIS.map(v => <option key={v} value={v}>{RATE_VISIBILITY_LABELS[v]}</option>)}
                    </select>
                  </>
                )}
                <button style={ghostBtn} onClick={() => setOpenId(open ? null : b.id)}>{open ? 'Close' : 'Rate card'}</button>
              </div>

              {open && (
                <div style={{ marginTop: 12, padding: 14, background: '#F8FAFC', borderRadius: 10 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginBottom: 10 }}>
                    <div><span style={label}>Gross monthly rate ₦</span><input style={input} type="number" min={0} disabled={!isAdmin} value={d.monthly} onChange={e => setD({ monthly: e.target.value })} aria-label="Gross monthly rate" /></div>
                    <div><span style={label}>Gross annual rate ₦ (optional)</span><input style={input} type="number" min={0} disabled={!isAdmin} value={d.annual} onChange={e => setD({ annual: e.target.value })} aria-label="Gross annual rate" /></div>
                    <div><span style={label}>Production cost ₦ (separate)</span><input style={input} type="number" min={0} disabled={!isAdmin} value={d.production} onChange={e => setD({ production: e.target.value })} aria-label="Production cost" /></div>
                    {company.can_see_floor_rates && (
                      <div><span style={label}>Max discount % (private)</span><input style={input} type="number" min={0} max={100} disabled={!isAdmin} value={d.maxDiscount} onChange={e => setD({ maxDiscount: e.target.value })} aria-label="Maximum discount percent" /></div>
                    )}
                  </div>
                  {isAdmin && (
                    <button style={btn()} onClick={() => act(() => saveRateCard(b.id, {
                      gross_monthly_rate: num(d.monthly), gross_annual_rate: num(d.annual), production_cost: num(d.production), max_discount_pct: num(d.maxDiscount),
                    }), 'Rate card saved.')}>Save rate card</button>
                  )}

                  <span style={{ ...label, marginTop: 16 }}>Dates already booked (deals done outside the platform)</span>
                  {boardRanges.length === 0 ? <p style={{ fontSize: '0.75rem', color: '#94A3B8', margin: '0 0 8px' }}>None recorded.</p> : boardRanges.map(r => (
                    <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: '0.75rem', color: '#334155', padding: '4px 0' }}>
                      <span style={{ flex: 1 }}>{fmtDate(r.start_date)} → {fmtDate(r.end_date)}{r.note ? ` · ${r.note}` : ''}</span>
                      <button style={{ ...ghostBtn, color: '#EF4444' }} onClick={() => act(() => removeBookedRange(r.id))}>Remove</button>
                    </div>
                  ))}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                    <input style={{ ...input, width: 150 }} type="date" value={rd.start} onChange={e => setRangeDraft(p => ({ ...p, [b.id]: { ...rd, start: e.target.value } }))} aria-label="Booked from" />
                    <input style={{ ...input, width: 150 }} type="date" value={rd.end} onChange={e => setRangeDraft(p => ({ ...p, [b.id]: { ...rd, end: e.target.value } }))} aria-label="Booked until" />
                    <input style={{ ...input, flex: '1 1 140px' }} placeholder="Note (optional)" value={rd.note} onChange={e => setRangeDraft(p => ({ ...p, [b.id]: { ...rd, note: e.target.value } }))} aria-label="Note" />
                    <button style={ghostBtn} disabled={!rd.start || !rd.end || rd.end < rd.start}
                      onClick={() => act(async () => { const r = await addBookedRange(b.id, rd.start, rd.end, rd.note); if (!r.error) setRangeDraft(p => ({ ...p, [b.id]: { start: '', end: '', note: '' } })); return r; })}>Add dates</button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
