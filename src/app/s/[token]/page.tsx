'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { boardFormatLabel } from '@/lib/board-formats';

// Public, read-only page for one quick-share availability link. Everything it
// shows comes from /api/share/[token], which returns only the boards on this
// link and only the fields a prospect should see.

type SharedBoard = {
  id: string; name: string; address: string | null; city: string | null; state: string | null; format: string | null;
  width: number | null; height: number | null; illuminated: boolean | null; face_count: number | null;
  photo: string | null; available: boolean; booked: { start: string; end: string }[]; rate: number | null;
};
type Shared = { title: string | null; company: string | null; expires_at: string; boards: SharedBoard[] };

const fmtDate = (d: string) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const field: React.CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 8, border: '1px solid #CBD5E1', fontSize: '0.9375rem', fontFamily: 'inherit', marginBottom: 8 };

export default function SharedBoardsPage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<Shared | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [requestFor, setRequestFor] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', company: '', contact: '', message: '' });
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<Set<string>>(new Set());
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const res = await fetch(`/api/share/${token}`);
      const json = await res.json().catch(() => ({}));
      if (res.ok) setData(json as Shared);
      else setProblem(res.status === 410 ? 'This link has expired or been withdrawn. Ask the person who sent it for a new one.' : 'This link is not valid.');
    })();
  }, [token]);

  async function send(boardId: string) {
    setSending(true); setFormError(null);
    const res = await fetch(`/api/share/${token}/request`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ boardId, ...form }) });
    setSending(false);
    if (!res.ok) { setFormError((await res.json().catch(() => ({}))).error ?? 'Could not send your request'); return; }
    setSent(s => new Set(s).add(boardId));
    setRequestFor(null);
  }

  return (
    <div style={{ minHeight: '100vh', background: '#F8FAFC', fontFamily: "'Inter', sans-serif", color: '#0F172A' }}>
      <header style={{ background: 'linear-gradient(160deg, #0F172A 0%, #1B4F8A 100%)', padding: '28px 16px' }}>
        <div style={{ maxWidth: 720, margin: '0 auto' }}>
          <p style={{ color: '#F59E0B', fontSize: '0.6875rem', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', margin: '0 0 6px' }}>{data?.company ?? 'Available boards'}</p>
          <h1 style={{ color: '#fff', fontSize: '1.5rem', fontWeight: 800, letterSpacing: '-0.02em', margin: 0 }}>{data?.title || 'Boards available for your campaign'}</h1>
          {data && <p style={{ color: '#CBD5E1', fontSize: '0.8125rem', margin: '6px 0 0' }}>{data.boards.length} board{data.boards.length !== 1 ? 's' : ''} · link valid until {fmtDate(data.expires_at)}</p>}
        </div>
      </header>

      <main style={{ maxWidth: 720, margin: '0 auto', padding: '20px 16px 48px' }}>
        {problem && <p data-problem style={{ fontSize: '0.9375rem', color: '#64748B', textAlign: 'center', padding: '48px 0' }}>{problem}</p>}
        {!data && !problem && <p style={{ fontSize: '0.9375rem', color: '#94A3B8', textAlign: 'center', padding: '48px 0' }}>Loading…</p>}

        {data?.boards.map(b => (
          <article key={b.id} data-board={b.id} style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 14, overflow: 'hidden', marginBottom: 16 }}>
            {b.photo
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={b.photo} alt={b.name} style={{ width: '100%', height: 220, objectFit: 'cover', display: 'block', background: '#0F172A' }} />
              : <div style={{ height: 120, background: '#E2E8F0', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94A3B8', fontSize: '0.8125rem' }}>No photo yet</div>}
            <div style={{ padding: '16px 18px' }}>
              <h2 style={{ fontSize: '1.0625rem', fontWeight: 800, margin: '0 0 4px' }}>{b.name}</h2>
              <p style={{ fontSize: '0.875rem', color: '#475569', margin: '0 0 10px' }}>{[b.address, b.city, b.state].filter(Boolean).join(', ')}</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
                {[boardFormatLabel(b.format), b.width && b.height ? `${b.width} × ${b.height}` : null, b.face_count ? `${b.face_count} face${b.face_count !== 1 ? 's' : ''}` : null, b.illuminated ? 'Illuminated' : null]
                  .filter(Boolean).map(t => <span key={t} style={{ fontSize: '0.75rem', fontWeight: 600, padding: '3px 10px', borderRadius: 999, background: '#F1F5F9', color: '#334155' }}>{t}</span>)}
              </div>
              <p style={{ fontSize: '0.8125rem', color: '#334155', margin: '0 0 4px' }}>
                <strong>Availability:</strong>{' '}
                {b.booked.length === 0 ? 'Available now' : `Booked ${b.booked.map(r => `${fmtDate(r.start)} – ${fmtDate(r.end)}`).join('; ')} — free outside those dates`}
              </p>
              <p data-rate style={{ fontSize: '0.9375rem', fontWeight: 800, color: '#1B4F8A', margin: '8px 0 14px' }}>
                {b.rate ? `₦${Math.round(b.rate).toLocaleString('en-NG')} per month` : 'Contact for rate'}
              </p>

              {sent.has(b.id) ? (
                <p style={{ fontSize: '0.875rem', color: '#15803D', fontWeight: 600, margin: 0 }}>Request sent — you&apos;ll be contacted shortly.</p>
              ) : requestFor === b.id ? (
                <div>
                  <input style={field} placeholder="Your name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} aria-label="Your name" />
                  <input style={field} placeholder="Company (optional)" value={form.company} onChange={e => setForm(f => ({ ...f, company: e.target.value }))} aria-label="Company" />
                  <input style={field} placeholder="Phone or email" value={form.contact} onChange={e => setForm(f => ({ ...f, contact: e.target.value }))} aria-label="Phone or email" />
                  <textarea style={{ ...field, resize: 'vertical' }} rows={2} placeholder="Dates or anything else (optional)" value={form.message} onChange={e => setForm(f => ({ ...f, message: e.target.value }))} aria-label="Message" />
                  {formError && <p style={{ fontSize: '0.8125rem', color: '#B91C1C', margin: '0 0 8px' }}>{formError}</p>}
                  <button onClick={() => send(b.id)} disabled={sending || !form.name.trim() || !form.contact.trim()}
                    style={{ width: '100%', padding: 12, borderRadius: 10, border: 'none', background: form.name.trim() && form.contact.trim() ? '#1B4F8A' : '#CBD5E1', color: '#fff', fontSize: '0.9375rem', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                    {sending ? 'Sending…' : 'Send request'}
                  </button>
                </div>
              ) : (
                <button onClick={() => setRequestFor(b.id)} style={{ width: '100%', padding: 12, borderRadius: 10, border: 'none', background: '#1B4F8A', color: '#fff', fontSize: '0.9375rem', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                  Request this board
                </button>
              )}
            </div>
          </article>
        ))}
      </main>
    </div>
  );
}
