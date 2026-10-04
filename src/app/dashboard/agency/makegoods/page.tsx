'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useDashboardRole } from '@/components/layout/DashboardLayout';
import MakegoodCard from '@/components/makegoods/MakegoodCard';
import { input, label, card, h1, sub, page, errorBox, okBox, btn, ghostBtn, naira } from '@/components/owner/ui';
import {
  listMakegoods, createMakegood, isUnresolved, isOverdue, isUnappliedCredit,
  MAKEGOOD_REASON_LABELS, MAKEGOOD_REMEDY_LABELS,
  type Makegood, type MakegoodReason, type MakegoodRemedy,
} from '@/lib/makegoods';

type BookingOption = { id: string; label: string };
const emptyForm = { bookingId: '', reason: 'late_posting' as MakegoodReason, remedy: 'extension' as MakegoodRemedy, detail: '', value: '', dueBy: '', notes: '' };

export default function AgencyMakegoodsPage() {
  const role = useDashboardRole();
  const [makegoods, setMakegoods] = useState<Makegood[]>([]);
  const [bookings, setBookings] = useState<BookingOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  async function load() {
    const { makegoods, error } = await listMakegoods();
    setMakegoods(makegoods);
    setError(error);
    setLoading(false);
  }

  useEffect(() => {
    if (role !== 'agency') return;
    (async () => {
      await load();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const { data } = await supabase
        .from('bookings')
        .select('id, status, boards(name), campaigns!inner(name, agency_id)')
        .eq('campaigns.agency_id', session.user.id)
        .in('status', ['agreed', 'signed', 'live', 'completed', 'needs_replacement', 'replaced'])
        .order('created_at', { ascending: false })
        .limit(300);
      setBookings(((data ?? []) as unknown as { id: string; boards: { name: string } | null; campaigns: { name: string } | null }[])
        .map(b => ({ id: b.id, label: `${b.boards?.name ?? 'Board'} — ${b.campaigns?.name ?? 'Campaign'}` })));
    })();
  }, [role]);

  async function handleCreate() {
    setSaving(true); setError(null); setNotice(null);
    const { error } = await createMakegood({
      bookingId: form.bookingId, reason: form.reason, remedy: form.remedy, detail: form.detail,
      value: form.remedy === 'credit' ? Number(form.value) || null : null, dueBy: form.dueBy || null, notes: form.notes,
    });
    setSaving(false);
    if (error) { setError(error); return; }
    setForm(emptyForm);
    setNotice('Makegood recorded. The owner has been notified.');
    await load();
  }

  if (role !== 'agency') return <div style={page}><p style={{ color: '#64748B', fontSize: '0.875rem' }}>Makegoods are tracked from agency accounts.</p></div>;

  const open = makegoods.filter(isUnresolved);
  const overdue = open.filter(m => isOverdue(m));
  const credits = makegoods.filter(isUnappliedCredit);
  const shown = showAll ? makegoods : open;
  const needsValue = form.remedy === 'credit';
  const canCreate = !!form.bookingId && (!needsValue || Number(form.value) > 0);

  return (
    <div style={page}>
      <h1 style={h1}>Makegoods</h1>
      <p style={sub}>
        What an owner has promised when a board fell through or under-delivered — a replacement, extra weeks or a credit — and whether it has been delivered.
        This is a record only: it never changes a negotiated rate, an invoice or an MPO.
      </p>
      {error && <div style={errorBox}>{error}</div>}
      {notice && <div style={okBox} data-notice>{notice}</div>}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        {[
          { n: open.length, t: 'open', c: '#92400E', bg: '#FFFBEB' },
          { n: overdue.length, t: 'overdue', c: '#991B1B', bg: '#FEF2F2' },
          { n: credits.length, t: `credit${credits.length !== 1 ? 's' : ''} to apply · ${naira(credits.reduce((s, m) => s + (m.promised_value ?? 0), 0))}`, c: '#1E3A8A', bg: '#EFF6FF' },
        ].map(x => (
          <div key={x.t} style={{ padding: '10px 16px', borderRadius: 10, background: x.bg, color: x.c, fontSize: '0.8125rem', fontWeight: 700 }}>{x.n} {x.t}</div>
        ))}
      </div>

      <div style={card}>
        <span style={{ ...label, marginBottom: 12 }}>Record a makegood</span>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
          <div style={{ gridColumn: '1 / -1' }}>
            <span style={label}>Plan line</span>
            <select style={input} value={form.bookingId} onChange={e => setForm(f => ({ ...f, bookingId: e.target.value }))} aria-label="Plan line">
              <option value="">{bookings.length ? 'Choose the booking it relates to…' : 'No confirmed bookings yet'}</option>
              {bookings.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}
            </select>
          </div>
          <div>
            <span style={label}>What went wrong</span>
            <select style={input} value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value as MakegoodReason }))} aria-label="Reason">
              {(Object.keys(MAKEGOOD_REASON_LABELS) as MakegoodReason[]).map(r => <option key={r} value={r}>{MAKEGOOD_REASON_LABELS[r]}</option>)}
            </select>
          </div>
          <div>
            <span style={label}>What the owner promised</span>
            <select style={input} value={form.remedy} onChange={e => setForm(f => ({ ...f, remedy: e.target.value as MakegoodRemedy }))} aria-label="Remedy">
              {(Object.keys(MAKEGOOD_REMEDY_LABELS) as MakegoodRemedy[]).map(r => <option key={r} value={r}>{MAKEGOOD_REMEDY_LABELS[r]}</option>)}
            </select>
          </div>
          {needsValue && (
            <div><span style={label}>Credit amount ₦</span><input style={input} type="number" min={0} value={form.value} onChange={e => setForm(f => ({ ...f, value: e.target.value }))} aria-label="Credit amount" /></div>
          )}
          <div><span style={label}>Due by (optional)</span><input style={input} type="date" value={form.dueBy} onChange={e => setForm(f => ({ ...f, dueBy: e.target.value }))} aria-label="Due by" /></div>
          <div style={{ gridColumn: '1 / -1' }}><span style={label}>Detail (e.g. “2 extra weeks”, “board at Ojota”)</span><input style={input} value={form.detail} onChange={e => setForm(f => ({ ...f, detail: e.target.value }))} aria-label="Detail" /></div>
          <div style={{ gridColumn: '1 / -1' }}><span style={label}>Your notes (the owner can read these but not change them)</span><input style={input} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} aria-label="Notes" /></div>
        </div>
        <button style={{ ...btn(canCreate && !saving, '#1B4F8A'), marginTop: 12 }} disabled={!canCreate || saving} onClick={handleCreate}>{saving ? 'Saving…' : 'Record makegood'}</button>
        {needsValue && <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: '8px 0 0' }}>A credit is recorded as an amount only. No rate or invoice is changed — it is flagged for you to apply.</p>}
      </div>

      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ ...label, margin: 0, flex: 1 }}>{showAll ? `All makegoods (${makegoods.length})` : `Open makegoods (${open.length})`}</span>
          <button style={ghostBtn} onClick={() => setShowAll(v => !v)}>{showAll ? 'Show open only' : 'Show all'}</button>
        </div>
        {loading ? <p style={{ fontSize: '0.8125rem', color: '#94A3B8', margin: '10px 0 0' }}>Loading…</p>
          : shown.length === 0 ? <p style={{ fontSize: '0.8125rem', color: '#94A3B8', margin: '10px 0 0' }}>{showAll ? 'No makegoods recorded yet.' : 'Nothing outstanding.'}</p>
          : shown.map(m => <MakegoodCard key={m.id} makegood={m} side="agency" onChanged={load} />)}
      </div>
    </div>
  );
}
