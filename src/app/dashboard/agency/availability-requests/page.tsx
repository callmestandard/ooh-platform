'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useDashboardRole } from '@/components/layout/DashboardLayout';
import { FORMAT_GROUPS, boardFormatLabel } from '@/lib/board-formats';
import {
  sendAvailabilityRequest, listAgencyRequests, fetchRequestResponses, setRequestStatus, acceptResponses,
  type AvailabilityRequest, type AvailabilityRecipient, type AvailabilityResponse, type UnreachedBoard,
} from '@/lib/availability-requests';

type RequestRow = AvailabilityRequest & { recipients: AvailabilityRecipient[] };
type CampaignOption = { id: string; name: string; status: string };

const naira = (n: number) => '₦' + Math.round(n).toLocaleString('en-NG');
const fmtDate = (d: string) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

const input: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: 8,
  border: '1px solid #E2E8F0', fontSize: '0.8125rem', color: '#0F172A', background: '#fff', fontFamily: 'inherit', outline: 'none',
};
const label: React.CSSProperties = { fontSize: '0.6875rem', fontWeight: 600, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4, display: 'block' };
const card: React.CSSProperties = { background: '#fff', border: '1px solid #E2E8F0', borderRadius: 12, padding: 20 };
const primaryBtn = (enabled: boolean): React.CSSProperties => ({
  padding: '8px 18px', borderRadius: 8, border: 'none', fontSize: '0.8125rem', fontWeight: 600, fontFamily: 'inherit',
  background: enabled ? '#1B4F8A' : '#F1F5F9', color: enabled ? '#fff' : '#94A3B8', cursor: enabled ? 'pointer' : 'not-allowed',
});

const emptyForm = { title: '', cities: '', formatKeys: [] as string[], startDate: '', endDate: '', budget: '', notes: '' };

export default function AgencyAvailabilityRequestsPage() {
  const role = useDashboardRole();
  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const [openId, setOpenId] = useState<string | null>(null);
  const [responses, setResponses] = useState<AvailabilityResponse[]>([]);
  const [unreached, setUnreached] = useState<UnreachedBoard[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [campaigns, setCampaigns] = useState<CampaignOption[]>([]);
  const [campaignId, setCampaignId] = useState('');
  const [accepting, setAccepting] = useState(false);

  async function refresh() {
    const { requests, error } = await listAgencyRequests();
    setRequests(requests);
    setError(error);
    setLoading(false);
  }

  useEffect(() => {
    if (role !== 'agency') return;
    (async () => {
      await refresh();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const { data } = await supabase.from('campaigns').select('id, name, status').eq('agency_id', session.user.id).order('created_at', { ascending: false });
      setCampaigns((data ?? []) as CampaignOption[]);
    })();
  }, [role]);

  const cities = form.cities.split(',').map(c => c.trim()).filter(Boolean);
  const canSend = form.title.trim() && cities.length > 0 && form.startDate && form.endDate && form.endDate >= form.startDate;

  async function handleSend() {
    setSending(true);
    setNotice(null);
    setError(null);
    const formats = FORMAT_GROUPS.filter(g => form.formatKeys.includes(g.key)).flatMap(g => g.formats as string[]);
    const { id, error } = await sendAvailabilityRequest({
      title: form.title, cities, formats, startDate: form.startDate, endDate: form.endDate,
      budget: Number(form.budget) > 0 ? Number(form.budget) : null, notes: form.notes,
    });
    setSending(false);
    if (error || !id) { setError('Could not send — ' + (error ?? 'unknown error')); return; }
    setForm(emptyForm);
    await refresh();
    await openRequest(id);
    setNotice('Request sent.');
  }

  async function openRequest(id: string) {
    setOpenId(id);
    setDetailLoading(true);
    setPicked(new Set());
    const { responses, unreached, error } = await fetchRequestResponses(id);
    setResponses(responses);
    setUnreached(unreached);
    if (error) setError(error);
    setDetailLoading(false);
  }

  const open = requests.find(r => r.id === openId) ?? null;
  const ownerName = useMemo(() => {
    const m = new Map<string, string>();
    open?.recipients.forEach(r => m.set(r.owner_id, r.owner_name ?? 'Board owner'));
    return m;
  }, [open]);
  const pickable = responses.filter(r => r.available && !r.accepted_booking_id);

  async function handleAccept() {
    if (!open || !campaignId) return;
    setAccepting(true);
    setError(null);
    const chosen = pickable.filter(r => picked.has(r.id));
    const { created, error } = await acceptResponses(open, chosen, campaignId);
    setAccepting(false);
    if (error) setError(`Added ${created} of ${chosen.length} — ${error}`);
    else setNotice(`${created} board${created !== 1 ? 's' : ''} added to the campaign as pending bookings.`);
    await openRequest(open.id);
  }

  async function toggleStatus(r: RequestRow) {
    const { error } = await setRequestStatus(r.id, r.status === 'open' ? 'closed' : 'open');
    if (error) setError(error); else await refresh();
  }

  if (role !== 'agency') {
    return <div style={{ padding: 32, color: '#64748B', fontSize: '0.875rem' }}>Availability requests are sent from agency accounts.</div>;
  }

  return (
    <div style={{ maxWidth: 1040, margin: '0 auto', padding: '8px 0 48px', fontFamily: 'inherit' }}>
      <h1 style={{ fontSize: '1.375rem', fontWeight: 800, color: '#0F172A', margin: '0 0 4px', letterSpacing: '-0.02em' }}>Availability requests</h1>
      <p style={{ fontSize: '0.875rem', color: '#64748B', margin: '0 0 20px', maxWidth: 680 }}>
        Ask every board owner with matching inventory at once. Each owner answers per board — available or not, with a rate — and the replies land here.
      </p>

      {error && <div style={{ ...card, borderColor: '#FECACA', background: '#FEF2F2', color: '#B91C1C', fontSize: '0.8125rem', marginBottom: 16 }}>{error}</div>}
      {notice && <div data-notice style={{ ...card, borderColor: '#BBF7D0', background: '#F0FDF4', color: '#15803D', fontSize: '0.8125rem', marginBottom: 16 }}>{notice}</div>}

      {/* ── New request ── */}
      <div style={{ ...card, marginBottom: 16 }}>
        <span style={{ ...label, marginBottom: 12 }}>New request</span>
        <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 12, marginBottom: 12 }}>
          <div>
            <span style={label}>Title</span>
            <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g. Q1 telecom launch — Lagos & Abuja" style={input} aria-label="Title" />
          </div>
          <div>
            <span style={label}>Cities (comma-separated)</span>
            <input value={form.cities} onChange={e => setForm(f => ({ ...f, cities: e.target.value }))} placeholder="Lagos, Abuja" style={input} aria-label="Cities" />
          </div>
        </div>
        <span style={label}>Formats (none ticked = any format)</span>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          {FORMAT_GROUPS.map(g => {
            const on = form.formatKeys.includes(g.key);
            return (
              <button key={g.key} data-format={g.key} onClick={() => setForm(f => ({ ...f, formatKeys: on ? f.formatKeys.filter(k => k !== g.key) : [...f.formatKeys, g.key] }))}
                style={{ padding: '6px 12px', borderRadius: 999, border: `1px solid ${on ? '#1B4F8A' : '#E2E8F0'}`, background: on ? '#EFF6FF' : '#fff', color: on ? '#1B4F8A' : '#475569', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                {g.label}
              </button>
            );
          })}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
          <div>
            <span style={label}>Start date</span>
            <input type="date" value={form.startDate} onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))} style={input} aria-label="Start date" />
          </div>
          <div>
            <span style={label}>End date</span>
            <input type="date" value={form.endDate} onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))} style={input} aria-label="End date" />
          </div>
          <div>
            <span style={label}>Budget ₦ (optional, shown to owners)</span>
            <input type="number" min={0} value={form.budget} onChange={e => setForm(f => ({ ...f, budget: e.target.value }))} style={input} aria-label="Budget" />
          </div>
        </div>
        <span style={label}>Notes to owners (optional)</span>
        <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} style={{ ...input, resize: 'vertical', marginBottom: 12 }} aria-label="Notes" />
        <button onClick={handleSend} disabled={!canSend || sending} style={primaryBtn(!!canSend && !sending)}>
          {sending ? 'Sending…' : 'Send to all matching owners'}
        </button>
      </div>

      {/* ── Sent requests ── */}
      <div style={card}>
        <span style={label}>Sent requests</span>
        {loading ? (
          <p style={{ fontSize: '0.8125rem', color: '#94A3B8', margin: 0 }}>Loading…</p>
        ) : requests.length === 0 ? (
          <p style={{ fontSize: '0.8125rem', color: '#94A3B8', margin: 0 }}>No requests sent yet.</p>
        ) : requests.map(r => {
          const responded = r.recipients.filter(x => x.responded_at).length;
          const isOpen = openId === r.id;
          return (
            <div key={r.id} data-request={r.id} style={{ borderTop: '1px solid #F1F5F9', padding: '12px 0' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: '0.875rem', fontWeight: 700, color: '#0F172A', margin: 0 }}>
                    {r.title}
                    {r.status === 'closed' && <span style={{ marginLeft: 8, fontSize: '0.625rem', fontWeight: 700, color: '#64748B', background: '#F1F5F9', padding: '2px 7px', borderRadius: 999 }}>CLOSED</span>}
                  </p>
                  <p style={{ fontSize: '0.75rem', color: '#64748B', margin: '2px 0 0' }}>
                    {r.cities.join(', ')} · {r.formats.length ? [...new Set(r.formats.map(boardFormatLabel))].join(', ') : 'Any format'} · {fmtDate(r.start_date)} → {fmtDate(r.end_date)}
                    {r.budget ? ` · budget ${naira(r.budget)}` : ''}
                  </p>
                </div>
                <span data-responded style={{ fontSize: '0.75rem', fontWeight: 700, color: r.recipients.length === 0 ? '#B45309' : '#1B4F8A', flexShrink: 0 }}>
                  {r.recipients.length === 0 ? 'No owners matched' : `${responded} of ${r.recipients.length} owners replied`}
                </span>
                <button onClick={() => (isOpen ? setOpenId(null) : openRequest(r.id))} style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid #E2E8F0', background: '#fff', color: '#1B4F8A', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600, fontFamily: 'inherit' }}>
                  {isOpen ? 'Hide' : 'View replies'}
                </button>
                <button onClick={() => toggleStatus(r)} style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid #E2E8F0', background: '#fff', color: '#64748B', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600, fontFamily: 'inherit' }}>
                  {r.status === 'open' ? 'Close' : 'Reopen'}
                </button>
              </div>

              {isOpen && (
                <div style={{ marginTop: 12, padding: 14, background: '#F8FAFC', borderRadius: 10 }}>
                  {detailLoading ? <p style={{ fontSize: '0.8125rem', color: '#94A3B8', margin: 0 }}>Loading replies…</p> : (
                    <>
                      <span style={label}>Owners asked</span>
                      {r.recipients.length === 0 ? (
                        <p style={{ fontSize: '0.8125rem', color: '#64748B', margin: '0 0 12px' }}>No owner with a platform account has a matching board.</p>
                      ) : (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
                          {r.recipients.map(x => (
                            <span key={x.id} style={{ fontSize: '0.75rem', padding: '4px 10px', borderRadius: 999, background: x.responded_at ? '#D1FAE5' : '#fff', color: x.responded_at ? '#065F46' : '#64748B', border: '1px solid ' + (x.responded_at ? '#A7F3D0' : '#E2E8F0') }}>
                              {x.owner_name ?? 'Board owner'} · {x.board_count} board{x.board_count !== 1 ? 's' : ''} · {x.responded_at ? 'replied' : 'waiting'}
                            </span>
                          ))}
                        </div>
                      )}

                      <span style={label}>Replies</span>
                      {responses.length === 0 ? (
                        <p style={{ fontSize: '0.8125rem', color: '#94A3B8', margin: '0 0 12px' }}>No replies yet.</p>
                      ) : (
                        <div style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 8, marginBottom: 12 }}>
                          {responses.map(resp => (
                            <label key={resp.id} data-response={resp.board_id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderBottom: '1px solid #F1F5F9', cursor: resp.available && !resp.accepted_booking_id ? 'pointer' : 'default' }}>
                              <input type="checkbox" disabled={!resp.available || !!resp.accepted_booking_id} checked={picked.has(resp.id)}
                                onChange={() => setPicked(prev => { const n = new Set(prev); if (n.has(resp.id)) n.delete(resp.id); else n.add(resp.id); return n; })} />
                              <span style={{ flex: 1, minWidth: 0 }}>
                                <span style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, color: '#0F172A' }}>{resp.boards?.name ?? 'Board'}</span>
                                <span style={{ display: 'block', fontSize: '0.6875rem', color: '#94A3B8' }}>
                                  {ownerName.get(resp.owner_id) ?? 'Board owner'} · {resp.boards?.city ?? '—'} · {boardFormatLabel(resp.boards?.format)}
                                  {resp.note ? ` · “${resp.note}”` : ''}
                                </span>
                              </span>
                              <span style={{ fontSize: '0.6875rem', fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: resp.available ? '#D1FAE5' : '#FEE2E2', color: resp.available ? '#065F46' : '#991B1B', flexShrink: 0 }}>
                                {resp.accepted_booking_id ? 'Added to campaign' : resp.available ? 'Available' : 'Not available'}
                              </span>
                              <span style={{ width: 110, textAlign: 'right', fontSize: '0.8125rem', fontWeight: 700, color: '#1B4F8A', fontFamily: "'JetBrains Mono', monospace", flexShrink: 0 }}>
                                {resp.quoted_rate ? `${naira(resp.quoted_rate)}/mo` : resp.available ? 'no rate' : '—'}
                              </span>
                            </label>
                          ))}
                        </div>
                      )}

                      {pickable.length > 0 && (
                        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12 }}>
                          <select value={campaignId} onChange={e => setCampaignId(e.target.value)} style={{ ...input, maxWidth: 320 }} aria-label="Campaign">
                            <option value="">{campaigns.length ? 'Add ticked boards to campaign…' : 'No campaigns yet — create one first'}</option>
                            {campaigns.map(c => <option key={c.id} value={c.id}>{c.name} ({c.status})</option>)}
                          </select>
                          <button onClick={handleAccept} disabled={!campaignId || picked.size === 0 || accepting} style={primaryBtn(!!campaignId && picked.size > 0 && !accepting)}>
                            {accepting ? 'Adding…' : `Add ${picked.size} as pending booking${picked.size !== 1 ? 's' : ''}`}
                          </button>
                        </div>
                      )}

                      {unreached.length > 0 && (
                        <>
                          <span style={label}>Matching boards with no owner account — not asked, contact directly</span>
                          <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 8 }}>
                            {unreached.map(b => (
                              <div key={b.board_id} style={{ display: 'flex', gap: 10, padding: '8px 12px', borderBottom: '1px solid #FEF3C7', fontSize: '0.75rem', color: '#78350F' }}>
                                <span style={{ flex: 1, fontWeight: 600 }}>{b.name}</span>
                                <span>{b.city ?? '—'} · {boardFormatLabel(b.format)}</span>
                                <span style={{ width: 200, textAlign: 'right' }}>{[b.contact_name, b.contact_phone].filter(Boolean).join(' · ') || 'no contact on record'}</span>
                              </div>
                            ))}
                          </div>
                        </>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
