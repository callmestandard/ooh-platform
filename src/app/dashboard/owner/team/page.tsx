'use client';

import { useEffect, useMemo, useState } from 'react';
import { input, label, card, h1, sub, page, errorBox, okBox, btn, ghostBtn, naira } from '@/components/owner/ui';
import {
  fetchMyCompany, listTeam, inviteTeamMember, updateTeamMember, listTargets, saveTarget, listTeamBookings,
  progressFor, currentPeriod, isOpen, dealValue,
  type MyCompany, type TeamMember, type MarketerTarget, type TeamBooking,
} from '@/lib/owner-team';

type PeriodKind = 'week' | 'month';

export default function OwnerTeamPage() {
  const [company, setCompany] = useState<MyCompany | null>(null);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [targets, setTargets] = useState<MarketerTarget[]>([]);
  const [bookings, setBookings] = useState<TeamBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [invite, setInvite] = useState({ name: '', email: '', phone: '', role: 'marketer' as 'admin' | 'marketer' });
  const [inviting, setInviting] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);

  const [kind, setKind] = useState<PeriodKind>('week');
  const period = useMemo(() => currentPeriod(kind), [kind]);
  const [targetDraft, setTargetDraft] = useState<Record<string, { value: string; count: string }>>({});

  async function refresh(c: MyCompany) {
    const [team, t, b] = await Promise.all([listTeam(c.owner_id), listTargets(c.owner_id), listTeamBookings(c.owner_id)]);
    setMembers(team.members);
    setTargets(t);
    setBookings(b);
    if (team.error) setError(team.error);
  }

  useEffect(() => {
    (async () => {
      const c = await fetchMyCompany();
      setCompany(c);
      if (c && c.team_role !== 'marketer') await refresh(c);
      setLoading(false);
    })();
  }, []);

  if (loading) return <div style={page}><p style={{ color: '#94A3B8', fontSize: '0.875rem' }}>Loading…</p></div>;
  if (!company || company.team_role === 'marketer') {
    return <div style={page}><p style={{ color: '#64748B', fontSize: '0.875rem' }}>Team management is for the board owner and owner admins.</p></div>;
  }

  async function handleInvite() {
    setInviting(true); setError(null); setNotice(null); setInviteLink(null);
    const { inviteLink, error } = await inviteTeamMember(invite);
    setInviting(false);
    if (error) { setError(error); return; }
    setInviteLink(inviteLink);
    setNotice(`${invite.name} has been added. Send them the link below so they can set a password and sign in.`);
    setInvite({ name: '', email: '', phone: '', role: 'marketer' });
    await refresh(company!);
  }

  async function patch(m: TeamMember, p: Parameters<typeof updateTeamMember>[1]) {
    setError(null);
    const { error } = await updateTeamMember(m.id, p);
    if (error) setError(error); else await refresh(company!);
  }

  async function handleSaveTarget(m: TeamMember) {
    const d = targetDraft[m.member_profile_id];
    if (!d) return;
    const { error } = await saveTarget({
      owner_id: company!.owner_id, marketer_id: m.member_profile_id, period_start: period.start, period_end: period.end,
      target_value: Number(d.value) || 0, target_count: Math.floor(Number(d.count) || 0),
    });
    if (error) setError(error); else { setNotice('Target saved.'); await refresh(company!); }
  }

  const marketers = members.filter(m => m.role === 'marketer');

  return (
    <div style={page}>
      <h1 style={h1}>Team &amp; targets</h1>
      <p style={sub}>Your marketers get their own login, see only the boards and requests assigned to them, and are credited automatically when a deal they handle is confirmed.</p>

      {error && <div style={errorBox}>{error}</div>}
      {notice && <div style={okBox} data-notice>{notice}</div>}
      {!company.verified && (
        <div style={{ ...card, borderColor: '#FDE68A', background: '#FFFBEB', color: '#78350F', fontSize: '0.8125rem' }}>
          Add your company CAC and TIN numbers in Settings before inviting team members. Marketers don&apos;t need their own KYC, but they must belong to a verified company.
        </div>
      )}

      {/* ── Invite ── */}
      <div style={card}>
        <span style={{ ...label, marginBottom: 12 }}>Invite a team member</span>
        <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1.4fr 1fr 0.8fr auto', gap: 10, alignItems: 'end' }}>
          <div><span style={label}>Name</span><input style={input} value={invite.name} onChange={e => setInvite(v => ({ ...v, name: e.target.value }))} aria-label="Name" /></div>
          <div><span style={label}>Email (their login)</span><input style={input} type="email" value={invite.email} onChange={e => setInvite(v => ({ ...v, email: e.target.value }))} aria-label="Email" /></div>
          <div><span style={label}>Phone (optional)</span><input style={input} value={invite.phone} onChange={e => setInvite(v => ({ ...v, phone: e.target.value }))} aria-label="Phone" /></div>
          <div>
            <span style={label}>Role</span>
            <select style={input} value={invite.role} onChange={e => setInvite(v => ({ ...v, role: e.target.value as 'admin' | 'marketer' }))} aria-label="Role">
              <option value="marketer">Marketer</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <button style={btn(!!invite.name.trim() && !!invite.email.trim() && !inviting && company.verified)} disabled={!invite.name.trim() || !invite.email.trim() || inviting || !company.verified} onClick={handleInvite}>
            {inviting ? 'Adding…' : 'Add to team'}
          </button>
        </div>
        {inviteLink && (
          <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
            <input style={{ ...input, fontFamily: 'monospace', fontSize: '0.6875rem' }} readOnly value={inviteLink} aria-label="Invite link" onFocus={e => e.target.select()} />
            <button style={ghostBtn} onClick={() => navigator.clipboard.writeText(inviteLink)}>Copy link</button>
          </div>
        )}
        <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: '10px 0 0' }}>The link lets them set their own password. It works once — send it by email or WhatsApp.</p>
      </div>

      {/* ── Members ── */}
      <div style={card}>
        <span style={label}>Team members</span>
        {members.length === 0 ? <p style={{ fontSize: '0.8125rem', color: '#94A3B8', margin: 0 }}>Nobody on your team yet.</p> : members.map(m => (
          <div key={m.id} data-member={m.member_profile_id} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, padding: '12px 0', borderTop: '1px solid #F1F5F9', opacity: m.active ? 1 : 0.55 }}>
            <div style={{ flex: '1 1 180px', minWidth: 0 }}>
              <p style={{ fontSize: '0.875rem', fontWeight: 700, color: '#0F172A', margin: 0 }}>{m.member_name ?? m.invited_email}{!m.active && ' (deactivated)'}</p>
              <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: '2px 0 0' }}>{m.invited_email}{m.invited_phone ? ` · ${m.invited_phone}` : ''}</p>
            </div>
            <select style={{ ...input, width: 110 }} value={m.role} onChange={e => patch(m, { role: e.target.value as 'admin' | 'marketer' })} aria-label="Role">
              <option value="marketer">Marketer</option>
              <option value="admin">Admin</option>
            </select>
            <label style={{ fontSize: '0.75rem', color: '#475569', display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <input type="checkbox" checked={m.can_see_floor_rates} onChange={e => patch(m, { can_see_floor_rates: e.target.checked })} /> Can see floor rates
            </label>
            <div style={{ width: 150 }}>
              <input style={input} placeholder="Territory cities" defaultValue={m.territory_cities.join(', ')} aria-label="Territory cities"
                onBlur={e => patch(m, { territory_cities: e.target.value.split(',').map(c => c.trim()).filter(Boolean) })} />
            </div>
            <div style={{ width: 96 }}>
              <input style={input} type="number" min={0} max={100} placeholder="Comm. %" defaultValue={m.commission_rate ?? ''} aria-label="Commission rate (record only)"
                onBlur={e => patch(m, { commission_rate: e.target.value === '' ? null : Number(e.target.value) })} />
            </div>
            <button style={{ ...ghostBtn, color: m.active ? '#EF4444' : '#15803D' }} onClick={() => patch(m, { active: !m.active })}>{m.active ? 'Deactivate' : 'Reactivate'}</button>
          </div>
        ))}
        <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: '10px 0 0' }}>
          Deactivating a marketer signs their boards and open requests back to you straight away. Commission % is for your own records — the platform never pays commission.
        </p>
      </div>

      {/* ── Performance ── */}
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <span style={{ ...label, margin: 0, flex: 1 }}>Performance — {period.start} to {period.end}</span>
          {(['week', 'month'] as const).map(k => (
            <button key={k} style={{ ...ghostBtn, background: kind === k ? '#7C3AED' : '#fff', color: kind === k ? '#fff' : '#475569' }} onClick={() => setKind(k)}>This {k}</button>
          ))}
        </div>
        {marketers.length === 0 ? <p style={{ fontSize: '0.8125rem', color: '#94A3B8', margin: 0 }}>Invite a marketer to see their performance here.</p> : marketers.map(m => {
          const target = targets.find(t => t.marketer_id === m.member_profile_id && t.period_start === period.start && t.period_end === period.end);
          const done = progressFor(bookings, m.member_profile_id, period.start, period.end);
          const pipeline = bookings.filter(b => isOpen(b) && b.boards?.assigned_marketer_id === m.member_profile_id);
          const draft = targetDraft[m.member_profile_id] ?? { value: target ? String(target.target_value) : '', count: target ? String(target.target_count) : '' };
          const pct = target && target.target_value > 0 ? Math.min(100, Math.round((done.value / target.target_value) * 100)) : null;
          return (
            <div key={m.id} data-performance={m.member_profile_id} style={{ borderTop: '1px solid #F1F5F9', padding: '12px 0' }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 14 }}>
                <p style={{ flex: '1 1 160px', fontSize: '0.875rem', fontWeight: 700, color: '#0F172A', margin: 0 }}>{m.member_name ?? m.invited_email}</p>
                <span style={{ fontSize: '0.75rem', color: '#475569' }}><strong>{done.count}</strong> closed · <strong>{naira(done.value)}</strong></span>
                <span style={{ fontSize: '0.75rem', color: '#475569' }}>{pipeline.length} open · {naira(pipeline.reduce((s, b) => s + (b.offered_rate ?? 0) * Math.max(1, b.duration_months ?? 1), 0))} pipeline</span>
                <input style={{ ...input, width: 130 }} type="number" min={0} placeholder="Target ₦" value={draft.value} aria-label="Target value"
                  onChange={e => setTargetDraft(d => ({ ...d, [m.member_profile_id]: { ...draft, value: e.target.value } }))} />
                <input style={{ ...input, width: 90 }} type="number" min={0} placeholder="Deals" value={draft.count} aria-label="Target deal count"
                  onChange={e => setTargetDraft(d => ({ ...d, [m.member_profile_id]: { ...draft, count: e.target.value } }))} />
                <button style={ghostBtn} onClick={() => handleSaveTarget(m)}>Set target</button>
              </div>
              {target && (
                <div style={{ marginTop: 8 }}>
                  <div style={{ height: 6, background: '#F1F5F9', borderRadius: 99, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${pct ?? 0}%`, background: '#7C3AED' }} />
                  </div>
                  <p style={{ fontSize: '0.6875rem', color: '#64748B', margin: '4px 0 0' }}>
                    {naira(done.value)} of {naira(target.target_value)}{pct !== null ? ` (${pct}%)` : ''} · {done.count} of {target.target_count} deals
                  </p>
                </div>
              )}
              {done.deals.length > 0 && (
                <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: '6px 0 0' }}>
                  Closed: {done.deals.map(b => `${b.boards?.name ?? 'Board'} (${naira(dealValue(b))})`).join(' · ')}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
