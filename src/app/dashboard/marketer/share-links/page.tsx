'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { input, label, card, h1, sub, page, errorBox, okBox, btn, ghostBtn, fmtDate } from '@/components/owner/ui';
import { boardFormatLabel } from '@/lib/board-formats';
import {
  fetchMyCompany, listCompanyBoards, listShareLinks, createShareLink, revokeShareLink, shareUrl,
  type MyCompany, type TeamBoard, type ShareLink,
} from '@/lib/owner-team';

export default function ShareLinksPage() {
  const [company, setCompany] = useState<MyCompany | null>(null);
  const [boards, setBoards] = useState<TeamBoard[]>([]);
  const [links, setLinks] = useState<ShareLink[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [title, setTitle] = useState('');
  const [days, setDays] = useState('7');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [now] = useState(() => Date.now());

  useEffect(() => {
    (async () => {
      const [{ data: { session } }, c] = await Promise.all([supabase.auth.getSession(), fetchMyCompany()]);
      setCompany(c);
      if (c) {
        const [b, l] = await Promise.all([listCompanyBoards(c, session?.user.id ?? ''), listShareLinks()]);
        setBoards(b.filter(x => x.status === 'available'));
        setLinks(l);
      }
      setLoading(false);
    })();
  }, []);

  if (loading) return <div style={page}><p style={{ color: '#94A3B8', fontSize: '0.875rem' }}>Loading…</p></div>;
  if (!company) return <div style={page}><p style={{ color: '#64748B', fontSize: '0.875rem' }}>Share links are for board owners and their marketers.</p></div>;

  const nDays = Math.min(90, Math.max(1, Math.floor(Number(days) || 7)));
  const boardName = (id: string) => boards.find(b => b.id === id)?.name ?? 'Board';

  async function copy(token: string) {
    await navigator.clipboard.writeText(shareUrl(token));
    setCopied(token);
    setTimeout(() => setCopied(null), 2000);
  }

  async function handleCreate() {
    setSaving(true); setError(null); setNotice(null);
    const { link, error } = await createShareLink({ title, boardIds: [...picked], days: nDays });
    setSaving(false);
    if (error || !link) { setError(error ?? 'Could not create the link'); return; }
    setPicked(new Set()); setTitle('');
    setLinks(await listShareLinks());
    await copy(link.token);
    setNotice('Link created and copied — paste it into WhatsApp.');
  }

  const state = (l: ShareLink) => (l.revoked_at ? 'Withdrawn' : new Date(l.expires_at).getTime() < now ? 'Expired' : 'Live');

  return (
    <div style={page}>
      <h1 style={h1}>Share links</h1>
      <p style={sub}>Pick available boards and send a client one link showing their photo, location, format, size and free dates. A rate appears only on boards whose rate the owner has opened to all verified agencies; otherwise it says “Contact for rate”.</p>
      {error && <div style={errorBox}>{error}</div>}
      {notice && <div style={okBox} data-notice>{notice}</div>}

      <div style={card}>
        <span style={label}>New link — your available boards</span>
        {boards.length === 0 ? <p style={{ fontSize: '0.8125rem', color: '#94A3B8', margin: 0 }}>You have no available boards to share.</p> : (
          <>
            <div style={{ maxHeight: 300, overflowY: 'auto', border: '1px solid #F1F5F9', borderRadius: 8, marginBottom: 12 }}>
              {boards.map(b => (
                <label key={b.id} data-board={b.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderBottom: '1px solid #F1F5F9', cursor: 'pointer' }}>
                  <input type="checkbox" checked={picked.has(b.id)} onChange={() => setPicked(p => { const n = new Set(p); if (n.has(b.id)) n.delete(b.id); else n.add(b.id); return n; })} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, color: '#0F172A' }}>{b.name}</span>
                    <span style={{ display: 'block', fontSize: '0.6875rem', color: '#94A3B8' }}>{b.city ?? '—'} · {boardFormatLabel(b.format)}{b.width && b.height ? ` · ${b.width}×${b.height}` : ''}</span>
                  </span>
                </label>
              ))}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'end' }}>
              <div style={{ flex: '1 1 220px' }}><span style={label}>Title (optional, shown to the client)</span><input style={input} value={title} onChange={e => setTitle(e.target.value)} aria-label="Title" /></div>
              <div style={{ width: 130 }}><span style={label}>Expires in (days)</span><input style={input} type="number" min={1} max={90} value={days} onChange={e => setDays(e.target.value)} aria-label="Expires in days" /></div>
              <button style={btn(picked.size > 0 && !saving)} disabled={picked.size === 0 || saving} onClick={handleCreate}>
                {saving ? 'Creating…' : `Create link for ${picked.size} board${picked.size !== 1 ? 's' : ''}`}
              </button>
            </div>
          </>
        )}
      </div>

      <div style={card}>
        <span style={label}>Your links</span>
        {links.length === 0 ? <p style={{ fontSize: '0.8125rem', color: '#94A3B8', margin: 0 }}>No links yet.</p> : links.map(l => {
          const s = state(l);
          return (
            <div key={l.id} data-link={l.id} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, padding: '11px 0', borderTop: '1px solid #F1F5F9', opacity: s === 'Live' ? 1 : 0.6 }}>
              <div style={{ flex: '1 1 240px', minWidth: 0 }}>
                <p style={{ fontSize: '0.8125rem', fontWeight: 700, color: '#0F172A', margin: 0 }}>{l.title || l.board_ids.map(boardName).join(', ')}</p>
                <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: '2px 0 0' }}>
                  {l.board_ids.length} board{l.board_ids.length !== 1 ? 's' : ''} · {s === 'Live' ? `expires ${fmtDate(l.expires_at)}` : s}
                </p>
              </div>
              <span data-opens={l.open_count} style={{ fontSize: '0.75rem', color: l.open_count > 0 ? '#065F46' : '#94A3B8', fontWeight: 600 }}>
                {l.open_count > 0 ? `Opened ${l.open_count}× · last ${new Date(l.last_opened_at!).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : 'Not opened yet'}
              </span>
              {s === 'Live' && (
                <>
                  <button style={ghostBtn} onClick={() => copy(l.token)}>{copied === l.token ? 'Copied!' : 'Copy link'}</button>
                  <a style={{ ...ghostBtn, textDecoration: 'none', color: '#15803D' }} target="_blank" rel="noopener noreferrer"
                    href={`https://wa.me/?text=${encodeURIComponent((l.title ? l.title + ' — ' : 'Available boards: ') + shareUrl(l.token))}`}>WhatsApp</a>
                  <button style={{ ...ghostBtn, color: '#EF4444' }} onClick={async () => { const r = await revokeShareLink(l.id); if (r.error) setError(r.error); else setLinks(await listShareLinks()); }}>Withdraw</button>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
