'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { card, h1, sub, page, label, ghostBtn, naira, fmtDate } from '@/components/owner/ui';
import { boardFormatLabel } from '@/lib/board-formats';
import {
  fetchMyCompany, listCompanyBoards, listTeamBookings, listMyTargets, listShareLeads, markLeadHandled,
  progressFor, currentPeriod, isConfirmed, dealValue,
  type MyCompany, type TeamBoard, type TeamBooking, type MarketerTarget, type ShareLead,
} from '@/lib/owner-team';

export default function MarketerDeskPage() {
  const [company, setCompany] = useState<MyCompany | null>(null);
  const [userId, setUserId] = useState('');
  const [boards, setBoards] = useState<TeamBoard[]>([]);
  const [bookings, setBookings] = useState<TeamBooking[]>([]);
  const [targets, setTargets] = useState<MarketerTarget[]>([]);
  const [leads, setLeads] = useState<ShareLead[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const [{ data: { session } }, c] = await Promise.all([supabase.auth.getSession(), fetchMyCompany()]);
      const uid = session?.user.id ?? '';
      setUserId(uid);
      setCompany(c);
      if (c) {
        const [b, bk, t, l] = await Promise.all([listCompanyBoards(c, uid), listTeamBookings(c.owner_id), listMyTargets(), listShareLeads()]);
        setBoards(b); setBookings(bk); setTargets(t); setLeads(l);
      }
      setLoading(false);
    })();
  }, []);

  const week = useMemo(() => currentPeriod('week'), []);
  const today = new Date().toISOString().slice(0, 10);
  // The target that covers today, preferring the shortest period (a week over a month).
  const target = useMemo(() => targets
    .filter(t => t.period_start <= today && t.period_end >= today)
    .sort((a, b) => (new Date(a.period_end).getTime() - new Date(a.period_start).getTime()) - (new Date(b.period_end).getTime() - new Date(b.period_start).getTime()))[0] ?? null, [targets, today]);
  const period = target ? { start: target.period_start, end: target.period_end } : week;

  if (loading) return <div style={page}><p style={{ color: '#94A3B8', fontSize: '0.875rem' }}>Loading…</p></div>;
  if (!company) {
    return <div style={page}><h1 style={h1}>My desk</h1><p style={sub}>Your account isn&apos;t linked to an active owner team. Ask the board owner who invited you to reactivate you.</p></div>;
  }

  const myBoardIds = new Set(boards.map(b => b.id));
  const mine = bookings.filter(b => myBoardIds.has(b.board_id) || b.closed_by_marketer_id === userId);
  const done = progressFor(bookings, userId, period.start, period.end);
  const pending = mine.filter(b => b.status === 'pending');
  const negotiating = mine.filter(b => b.status === 'negotiating');
  const busy = new Set(mine.filter(b => isConfirmed(b) && b.start_date && b.end_date && b.start_date <= week.end && b.end_date >= week.start).map(b => b.board_id));
  const availableNow = boards.filter(b => b.status === 'available' && !busy.has(b.id));
  const recent = bookings.filter(b => b.closed_by_marketer_id === userId && isConfirmed(b)).slice(0, 8);
  const newLeads = leads.filter(l => l.status === 'new');
  const pct = (a: number, b: number) => (b > 0 ? Math.min(100, Math.round((a / b) * 100)) : 0);

  const row = (b: TeamBooking) => (
    <Link key={b.id} href={`/dashboard/owner/negotiations/${b.id}`} data-booking={b.id}
      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderTop: '1px solid #F1F5F9', textDecoration: 'none', color: 'inherit' }}>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, color: '#0F172A' }}>{b.boards?.name ?? 'Board'}</span>
        <span style={{ display: 'block', fontSize: '0.6875rem', color: '#94A3B8' }}>{b.boards?.city ?? '—'} · {b.start_date ? fmtDate(b.start_date) : '—'} → {b.end_date ? fmtDate(b.end_date) : '—'}</span>
      </span>
      <span style={{ fontSize: '0.8125rem', fontWeight: 700, color: '#7C3AED', fontFamily: "'JetBrains Mono', monospace" }}>{b.agreed_rate ?? b.offered_rate ? `${naira(b.agreed_rate ?? b.offered_rate)}/mo` : 'Quote requested'}</span>
    </Link>
  );
  const empty = (t: string) => <p style={{ fontSize: '0.8125rem', color: '#94A3B8', margin: 0 }}>{t}</p>;

  return (
    <div style={page}>
      <h1 style={h1}>My desk</h1>
      <p style={sub}>{company.company_name ?? 'Your company'} · {company.team_role === 'admin' ? 'Team admin' : 'Marketer'}</p>

      {/* ── Target ── */}
      <div style={{ ...card, borderLeft: '4px solid #7C3AED' }} data-target>
        <span style={label}>{target ? `Target · ${fmtDate(period.start)} – ${fmtDate(period.end)}` : `This week · ${fmtDate(period.start)} – ${fmtDate(period.end)}`}</span>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          {[
            { title: 'Value closed', done: naira(done.value), of: target ? naira(target.target_value) : null, p: target ? pct(done.value, target.target_value) : 0 },
            { title: 'Deals closed', done: String(done.count), of: target ? String(target.target_count) : null, p: target ? pct(done.count, target.target_count) : 0 },
          ].map(x => (
            <div key={x.title}>
              <p style={{ fontSize: '0.6875rem', color: '#64748B', margin: '0 0 2px', fontWeight: 600 }}>{x.title}</p>
              <p style={{ fontSize: '1.375rem', fontWeight: 800, color: '#0F172A', margin: 0, fontFamily: "'JetBrains Mono', monospace" }}>
                {x.done}{x.of && <span style={{ fontSize: '0.8125rem', color: '#94A3B8', fontWeight: 500 }}> of {x.of}</span>}
              </p>
              {x.of && <div style={{ height: 6, background: '#F1F5F9', borderRadius: 99, overflow: 'hidden', marginTop: 6 }}><div style={{ height: '100%', width: `${x.p}%`, background: '#7C3AED' }} /></div>}
            </div>
          ))}
        </div>
        {!target && <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: '10px 0 0' }}>No target has been set for you for this period.</p>}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
        <div style={{ ...card, marginBottom: 0 }} data-section="requests">
          <span style={label}>Open requests ({pending.length})</span>
          {pending.length === 0 ? empty('No new booking requests.') : pending.map(row)}
        </div>
        <div style={{ ...card, marginBottom: 0 }} data-section="negotiations">
          <span style={label}>Negotiations in progress ({negotiating.length})</span>
          {negotiating.length === 0 ? empty('Nothing being negotiated.') : negotiating.map(row)}
        </div>
        <div style={{ ...card, marginBottom: 0 }} data-section="available">
          <span style={label}>Your boards still available this week ({availableNow.length})</span>
          {availableNow.length === 0 ? empty(boards.length ? 'All your boards are taken this week.' : 'No boards are assigned to you yet.') : availableNow.map(b => (
            <div key={b.id} style={{ padding: '8px 0', borderTop: '1px solid #F1F5F9' }}>
              <p style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#0F172A', margin: 0 }}>{b.name}</p>
              <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: '2px 0 0' }}>{b.city ?? '—'} · {boardFormatLabel(b.format)}</p>
            </div>
          ))}
          {availableNow.length > 0 && <Link href="/dashboard/marketer/share-links" style={{ ...ghostBtn, display: 'inline-block', marginTop: 10, textDecoration: 'none', color: '#7C3AED' }}>Share these with a client →</Link>}
        </div>
        <div style={{ ...card, marginBottom: 0 }} data-section="closed">
          <span style={label}>Recent closed deals</span>
          {recent.length === 0 ? empty('No closed deals yet.') : recent.map(b => (
            <div key={b.id} style={{ display: 'flex', gap: 10, padding: '8px 0', borderTop: '1px solid #F1F5F9', alignItems: 'center' }}>
              <span style={{ flex: 1, fontSize: '0.8125rem', fontWeight: 600, color: '#0F172A' }}>{b.boards?.name ?? 'Board'}</span>
              <span style={{ fontSize: '0.6875rem', color: '#94A3B8' }}>{b.confirmed_at ? fmtDate(b.confirmed_at) : ''}</span>
              <span style={{ fontSize: '0.8125rem', fontWeight: 700, color: '#065F46', fontFamily: "'JetBrains Mono', monospace" }}>{naira(dealValue(b))}</span>
            </div>
          ))}
        </div>
      </div>

      {newLeads.length > 0 && (
        <div style={{ ...card, marginTop: 16 }} data-section="leads">
          <span style={label}>Enquiries from your share links ({newLeads.length})</span>
          {newLeads.map(l => (
            <div key={l.id} style={{ display: 'flex', gap: 10, padding: '9px 0', borderTop: '1px solid #F1F5F9', alignItems: 'center' }}>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, color: '#0F172A' }}>{l.name}{l.company ? ` · ${l.company}` : ''} — {l.boards?.name ?? 'a board'}</span>
                <span style={{ display: 'block', fontSize: '0.6875rem', color: '#64748B' }}>{l.contact}{l.message ? ` · “${l.message}”` : ''}</span>
              </span>
              <button style={ghostBtn} onClick={async () => { await markLeadHandled(l.id); setLeads(await listShareLeads()); }}>Mark handled</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
