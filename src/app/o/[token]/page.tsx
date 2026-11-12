'use client';

/**
 * A media owner's private page (053), opened from a WhatsApp link with no
 * login. Two jobs: answer buyer requests for their boards, and confirm each
 * week which boards are free. Answers go to our team first, not straight to
 * the buyer.
 */

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { boardFormatLabel } from '@/lib/board-formats';
import { teamWhatsAppLink } from '@/lib/public-links';
import { isStale, sinceText, type OwnerBoardChanges, type OwnerBoardEdit, type OwnerBoardStatus, type OwnerLinkBoard, type OwnerLinkReply, type OwnerLinkRequest, type OwnerLinkView } from '@/lib/owner-links';

type Edit = { status: OwnerBoardStatus; from: string };

const today = () => new Date().toISOString().slice(0, 10);
const fmtDate = (d: string) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const naira = (n: number) => '₦' + Math.round(n).toLocaleString('en-NG');
const months = (a: string, b: string) => Math.max(1, Math.round((new Date(b).getTime() - new Date(a).getTime()) / (30.4 * 86_400_000)));
const asStatus = (s: string): OwnerBoardStatus => (s === 'booked' || s === 'unavailable' ? s : 'available');
const friendly = (m: string) => m.replace(/^.*?ERROR:\s*/, '');
const sizeText = (b: OwnerLinkBoard) => (b.width && b.height ? `${b.width}m × ${b.height}m` : 'Not set');
const litText = (v: boolean | null | undefined) => (v == null ? 'Not set' : v ? 'Lit at night' : 'Not lit');

/** Shrinks a phone photo to at most 1600px so it uploads quickly on mobile data. */
async function shrinkPhoto(file: File): Promise<Blob> {
  try {
    const img = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>(done => canvas.toBlob(done, 'image/jpeg', 0.82));
    return blob ?? file;
  } catch {
    return file;
  }
}

export default function OwnerLinkPage() {
  const { token } = useParams<{ token: string }>();
  const [view, setView] = useState<OwnerLinkView | null>(null);
  const [problem, setProblem] = useState(false);
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedCount, setSavedCount] = useState<number | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.rpc('owner_link_view', { p_token: token });
      if (cancelled) return;
      if (error || !data) setProblem(true);
      else setView(data as OwnerLinkView);
    })();
    return () => { cancelled = true; };
  }, [token]);

  const help = teamWhatsAppLink(view ? `Hello OOH Platform team, this is ${view.owner_name}.` : 'Hello OOH Platform team.');

  if (problem) {
    return (
      <div className="ol"><style>{CSS}</style>
        <div className="ol-missing" data-problem>
          <h1>This link isn&rsquo;t working</h1>
          <p>It may have been replaced with a new one. Message our team and we&rsquo;ll send you the right link.</p>
          {help && <a href={help} className="ol-btn" target="_blank" rel="noopener noreferrer">WhatsApp our team</a>}
        </div>
      </div>
    );
  }

  const boards = view?.boards ?? [];
  const requests = view?.requests ?? [];
  const current = (b: OwnerLinkBoard): Edit => edits[b.id] ?? { status: asStatus(b.status), from: b.available_from ?? '' };
  const changed = boards.filter(b => { const e = edits[b.id]; return e && (e.status !== asStatus(b.status) || (e.status === 'booked' && e.from !== (b.available_from ?? ''))); }).length;
  const stale = boards.filter(b => isStale(b.checked_at)).length;
  const waiting = requests.filter(r => !r.reply).length;
  const missingDate = boards.some(b => { const e = current(b); return e.status === 'booked' && !e.from; });

  function setEdit(b: OwnerLinkBoard, patch: Partial<Edit>) {
    setSavedCount(null);
    setEdits(prev => ({ ...prev, [b.id]: { ...current(b), ...patch } }));
  }

  async function confirmAll() {
    if (missingDate) { setSaveError('Add the date each booked board is free again.'); return; }
    setSaving(true); setSaveError(null);
    const updates = boards.map(b => { const e = current(b); return { id: b.id, status: e.status, available_from: e.status === 'booked' ? e.from : null }; });
    const { data, error } = await supabase.rpc('owner_link_update_boards', { p_token: token, p_updates: updates });
    setSaving(false);
    if (error) { setSaveError(friendly(error.message)); return; }
    const now = new Date().toISOString();
    setView(v => v && { ...v, boards: v.boards.map(b => { const e = current(b); return { ...b, status: e.status, available_from: e.status === 'booked' ? e.from : null, checked_at: now }; }) });
    setEdits({});
    setSavedCount(Number(data) || updates.length);
  }

  function onCorrected(id: string, edit: OwnerBoardEdit) {
    setView(v => v && { ...v, boards: v.boards.map(b => (b.id === id ? { ...b, edit } : b)) });
  }
  const openBoard = boards.find(b => b.id === openId) ?? null;

  function onReplied(id: string, reply: OwnerLinkReply) {
    setView(v => v && { ...v, requests: v.requests.map(r => (r.id === id ? { ...r, reply } : r)) });
  }

  return (
    <div className="ol">
      <style>{CSS}</style>
      <header className="ol-bar">
        <div className="ol-in ol-bar-in">
          <span className="ol-logo">
            <span className="ol-logo-mark"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round"><rect x="3" y="3" width="18" height="5" rx="1.5" /><line x1="6" y1="8" x2="6" y2="21" /><line x1="18" y1="8" x2="18" y2="21" /></svg></span>
            OOH Platform
          </span>
          {help && <a href={help} target="_blank" rel="noopener noreferrer" className="ol-help">Need help?</a>}
        </div>
      </header>

      <main className="ol-in ol-main">
        <p className="ol-eyebrow">{view ? `For ${view.owner_name}` : ' '}</p>
        <h1 className="ol-h1">Keep your boards up to date</h1>
        <p className="ol-sub">Takes about a minute. No login needed. Buyers book boards that show as free, so this brings you more requests.</p>

        {!view ? (
          <div>{[0, 1, 2].map(i => <div key={i} className="ol-skel" />)}</div>
        ) : (
          <>
            <div className="ol-todo">
              <div className={waiting ? 'is-hot' : ''}><strong>{waiting}</strong><span>request{waiting !== 1 ? 's' : ''} to answer</span></div>
              <div className={stale ? 'is-warm' : ''}><strong>{stale}</strong><span>board{stale !== 1 ? 's' : ''} to confirm</span></div>
            </div>

            {requests.length > 0 && (
              <section className="ol-sec" data-requests>
                <h2>Buyer requests</h2>
                <p className="ol-sec-sub">Tell us if the board is free and your price. Our team checks it and replies to the buyer.</p>
                {requests.map(r => <RequestCard key={r.id} token={token} r={r} onReplied={onReplied} />)}
              </section>
            )}

            <section className="ol-sec" data-boards>
              <h2>Your boards ({boards.length})</h2>
              <p className="ol-sec-sub">Is each board free, booked or off right now? Change any that are wrong, then confirm. Tap a board to see its photo or fix its details.</p>
              {boards.length === 0 && <p className="ol-empty">No boards are listed for you yet. Message our team to add them.</p>}
              <ul className="ol-boards">
                {boards.map(b => {
                  const e = current(b);
                  const old = isStale(b.checked_at);
                  return (
                    <li key={b.id} className="ol-board" data-owner-board>
                      <button type="button" className="ol-board-top ol-open" onClick={() => setOpenId(b.id)} aria-label={`See photo and details of ${b.name}`} data-open-board>
                        <span className="ol-thumb">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          {b.photo ? <img src={b.photo} alt="" loading="lazy" /> : <span className="ol-nophoto">No photo</span>}
                        </span>
                        <span style={{ minWidth: 0, flex: 1, display: 'block' }}>
                          <span className="ol-bname">{b.name}</span>
                          <span className="ol-bmeta">{[b.area, b.city].filter(Boolean).join(', ') || '—'} · {boardFormatLabel(b.format)}</span>
                          <span className={`ol-checked${old ? ' is-old' : ''}`}>{b.checked_at ? `Confirmed ${sinceText(b.checked_at)}` : 'Not confirmed yet'}</span>
                          {b.edit?.status === 'pending' && <span className="ol-chip" data-edit-chip>Correction sent · with our team</span>}
                          {b.edit?.status === 'applied' && <span className="ol-chip is-done">Correction applied</span>}
                        </span>
                        <svg className="ol-chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="9 6 15 12 9 18" /></svg>
                      </button>
                      <div className="ol-seg" role="radiogroup" aria-label={`Status of ${b.name}`}>
                        {([['available', 'Free'], ['booked', 'Booked'], ['unavailable', 'Off']] as const).map(([v, t]) => (
                          <button key={v} type="button" role="radio" aria-checked={e.status === v} className={e.status === v ? `is-on is-${v}` : ''}
                            onClick={() => setEdit(b, { status: v })}>{t}</button>
                        ))}
                      </div>
                      {e.status === 'booked' && (
                        <label className="ol-from">
                          <span>Free again from</span>
                          <input type="date" min={today()} value={e.from} onChange={ev => setEdit(b, { from: ev.target.value })} className={!e.from ? 'is-missing' : ''} />
                        </label>
                      )}
                      {e.status === 'unavailable' && <p className="ol-hint">Off means buyers can&rsquo;t request it (for example, under repair or no longer yours).</p>}
                    </li>
                  );
                })}
              </ul>
            </section>

            {boards.length > 0 && (
              <div className="ol-dock">
                <div className="ol-in ol-dock-in">
                  {saveError && <p role="alert" className="ol-err">{saveError}</p>}
                  {savedCount != null && !changed
                    ? <p className="ol-ok" role="status" data-saved>Thank you! {savedCount} board{savedCount !== 1 ? 's' : ''} confirmed.</p>
                    : (
                      <button type="button" className="ol-btn ol-wide" onClick={confirmAll} disabled={saving} data-confirm-all>
                        {saving ? 'Saving…' : changed ? `Save ${changed} change${changed !== 1 ? 's' : ''} and confirm all` : `Confirm all ${boards.length} boards are right`}
                      </button>
                    )}
                </div>
              </div>
            )}
          </>
        )}
      </main>
      {openBoard && <BoardSheet key={openBoard.id} token={token} b={openBoard} onClose={() => setOpenId(null)} onSent={onCorrected} />}
    </div>
  );
}

/** A board opened from the list: its photos and details, and a form to correct them. */
function BoardSheet({ token, b, onClose, onSent }: { token: string; b: OwnerLinkBoard; onClose: () => void; onSent: (id: string, edit: OwnerBoardEdit) => void }) {
  const photos = b.photos?.length ? b.photos : b.photo ? [b.photo] : [];
  const waiting = b.edit?.status === 'pending' ? b.edit : null;
  const [at, setAt] = useState(0);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(waiting?.changes.name ?? b.name);
  const [area, setArea] = useState(waiting?.changes.area ?? b.area ?? '');
  const [address, setAddress] = useState(waiting?.changes.address ?? b.address ?? '');
  const [width, setWidth] = useState(String(waiting?.changes.width ?? b.width ?? ''));
  const [height, setHeight] = useState(String(waiting?.changes.height ?? b.height ?? ''));
  const lit0 = waiting?.changes.illuminated ?? b.illuminated;
  const [lit, setLit] = useState<'' | 'yes' | 'no'>(lit0 == null ? '' : lit0 ? 'yes' : 'no');
  const [note, setNote] = useState(waiting?.note ?? '');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  function pick(f: File | undefined) {
    if (!f) return;
    if (!f.type.startsWith('image/')) { setErr('Choose a photo.'); return; }
    setErr(null);
    setFile(f);
    setPreview(URL.createObjectURL(f));
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (name.trim().length < 2) { setErr('Add the board name.'); return; }
    setBusy(true); setErr(null);

    let photoUrl: string | null = waiting?.photo_url ?? null;
    if (file) {
      const body = new FormData();
      body.append('token', token);
      body.append('boardId', b.id);
      body.append('file', new File([await shrinkPhoto(file)], 'photo.jpg', { type: 'image/jpeg' }));
      const res = await fetch('/api/owner-link/photo', { method: 'POST', body }).catch(() => null);
      const json = await res?.json().catch(() => ({}));
      if (!res?.ok || !json?.url) { setBusy(false); setErr(json?.error ?? 'The photo could not be sent. Check your connection and try again.'); return; }
      photoUrl = json.url as string;
    }

    const changes: Record<string, unknown> = { name, area, address, width, height };
    if (lit) changes.illuminated = lit === 'yes';
    const { error } = await supabase.rpc('owner_link_suggest_edit', { p_token: token, p_board_id: b.id, p_changes: changes, p_photo_url: photoUrl, p_note: note });
    setBusy(false);
    if (error) {
      setErr(error.message.includes('owner_link_suggest_edit') ? 'Corrections are not switched on yet. Please message our team.' : friendly(error.message));
      return;
    }
    // What we show back is what differs from the listing.
    const diff: OwnerBoardChanges = {};
    if (name.trim() !== b.name) diff.name = name.trim();
    if (area.trim() !== (b.area ?? '')) diff.area = area.trim();
    if (address.trim() && address.trim() !== (b.address ?? '')) diff.address = address.trim();
    if (Number(width) > 0 && Number(width) !== Number(b.width)) diff.width = Number(width);
    if (Number(height) > 0 && Number(height) !== Number(b.height)) diff.height = Number(height);
    if (lit && (lit === 'yes') !== b.illuminated) diff.illuminated = lit === 'yes';
    onSent(b.id, { changes: diff, photo_url: photoUrl, note: note.trim() || null, status: 'pending' });
    setDone(true);
    setEditing(false);
  }

  const shown = preview ?? (editing && waiting?.photo_url ? waiting.photo_url : photos[at]);

  return (
    <div className="ol-sheet-bg" onClick={e => { if (e.target === e.currentTarget) onClose(); }} data-board-sheet>
      <div className="ol-sheet" role="dialog" aria-modal="true" aria-label={b.name}>
        <div className="ol-sheet-photo">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {shown ? <img src={shown} alt={b.name} /> : <span className="ol-nophoto is-big">No photo yet</span>}
          <button type="button" className="ol-x" onClick={onClose} aria-label="Close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" /></svg>
          </button>
          {editing && (
            <label className="ol-photo-btn">
              <input type="file" accept="image/*" onChange={e => pick(e.target.files?.[0])} data-photo-input />
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" /></svg>
              {preview || waiting?.photo_url ? 'Choose another photo' : shown ? 'Change photo' : 'Add a photo'}
            </label>
          )}
        </div>
        {!editing && photos.length > 1 && (
          <div className="ol-thumbs">
            {photos.map((src, i) => (
              <button key={src + i} type="button" className={i === at ? 'is-on' : ''} onClick={() => setAt(i)} aria-label={`Photo ${i + 1}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt="" loading="lazy" />
              </button>
            ))}
          </div>
        )}

        <div className="ol-sheet-body">
          {!editing ? (
            <>
              <h2 className="ol-sheet-h">{b.name}</h2>
              <p className="ol-bmeta" style={{ marginTop: 4 }}>{[b.area, b.city].filter(Boolean).join(', ') || '—'} · {boardFormatLabel(b.format)}</p>

              {(done || waiting) && (
                <p className="ol-sent" role="status" data-edit-sent>
                  <strong>Correction sent.</strong> Our team will check it, then buyers will see it.
                </p>
              )}
              {b.edit?.status === 'applied' && !done && <p className="ol-sent is-done">Your last correction was applied. Thank you.</p>}

              <dl className="ol-facts">
                <div><dt>Address</dt><dd>{b.address || 'Not set'}</dd></div>
                <div><dt>Size</dt><dd>{sizeText(b)}</dd></div>
                <div><dt>Lighting</dt><dd>{litText(b.illuminated)}</dd></div>
                <div><dt>Photos</dt><dd>{photos.length || 'None'}</dd></div>
              </dl>

              <button type="button" className="ol-btn-2 ol-wide" onClick={() => { setDone(false); setEditing(true); }} data-edit-board>
                {waiting || done ? 'Change your correction' : 'Fix details or change the photo'}
              </button>
            </>
          ) : (
            <form onSubmit={send}>
              <h2 className="ol-sheet-h" style={{ marginBottom: 12 }}>Fix this board</h2>
              <label className="ol-lbl" htmlFor="ed-name">Board name</label>
              <input id="ed-name" className="ol-field" value={name} maxLength={200} onChange={e => setName(e.target.value)} />
              <label className="ol-lbl" htmlFor="ed-area">Area</label>
              <input id="ed-area" className="ol-field" value={area} maxLength={120} onChange={e => setArea(e.target.value)} placeholder="e.g. Ikeja" />
              <label className="ol-lbl" htmlFor="ed-address">Address or landmark</label>
              <input id="ed-address" className="ol-field" value={address} maxLength={300} onChange={e => setAddress(e.target.value)} placeholder="e.g. Allen Avenue, by the roundabout" />
              <div className="ol-2">
                <div><label className="ol-lbl" htmlFor="ed-w">Width (m)</label><input id="ed-w" className="ol-field" inputMode="decimal" value={width} onChange={e => setWidth(e.target.value.replace(/[^\d.]/g, ''))} /></div>
                <div><label className="ol-lbl" htmlFor="ed-h">Height (m)</label><input id="ed-h" className="ol-field" inputMode="decimal" value={height} onChange={e => setHeight(e.target.value.replace(/[^\d.]/g, ''))} /></div>
              </div>
              <span className="ol-lbl">Lit at night?</span>
              <div className="ol-choice">
                <button type="button" className={lit === 'yes' ? 'is-pick' : ''} onClick={() => setLit('yes')} aria-pressed={lit === 'yes'}>Yes</button>
                <button type="button" className={lit === 'no' ? 'is-pick' : ''} onClick={() => setLit('no')} aria-pressed={lit === 'no'}>No</button>
              </div>
              <label className="ol-lbl" htmlFor="ed-note">Anything else we should fix? (optional)</label>
              <input id="ed-note" className="ol-field" value={note} maxLength={500} onChange={e => setNote(e.target.value)} placeholder="e.g. the map pin is on the wrong side of the road" />
              {err && <p role="alert" className="ol-err">{err}</p>}
              <button type="submit" className="ol-btn ol-wide" disabled={busy} data-send-edit>{busy ? 'Sending…' : 'Send to our team'}</button>
              <button type="button" className="ol-link ol-cancel" onClick={() => { setEditing(false); setErr(null); }} disabled={busy}>Cancel</button>
              <p className="ol-hint" style={{ textAlign: 'center' }}>Our team checks every correction before buyers see it.</p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

function RequestCard({ token, r, onReplied }: { token: string; r: OwnerLinkRequest; onReplied: (id: string, reply: OwnerLinkReply) => void }) {
  const [editing, setEditing] = useState(!r.reply);
  const [avail, setAvail] = useState<boolean | null>(r.reply ? r.reply.available : null);
  const [rate, setRate] = useState(r.reply?.quoted_rate ? String(r.reply.quoted_rate) : '');
  const [from, setFrom] = useState(r.reply?.available_from ?? r.start_date);
  const [to, setTo] = useState(r.reply?.available_to ?? r.end_date);
  const [cond, setCond] = useState(r.reply?.conditions ?? '');
  const [note, setNote] = useState(r.reply?.note ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const sent = r.reply?.status === 'sent';

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (avail == null) { setErr('Choose available or not available.'); return; }
    if (avail && !(Number(rate) > 0)) { setErr('Add your price per month.'); return; }
    setBusy(true); setErr(null);
    const { error } = await supabase.rpc('owner_link_reply', {
      p_token: token, p_request_id: r.id, p_available: avail, p_rate: avail ? Number(rate) : null,
      p_from: avail ? from || null : null, p_to: avail ? to || null : null, p_conditions: cond, p_note: note,
    });
    setBusy(false);
    if (error) { setErr(friendly(error.message)); return; }
    onReplied(r.id, { available: avail, quoted_rate: avail ? Number(rate) : null, available_from: avail ? from : null, available_to: avail ? to : null, conditions: cond || null, note: note || null, status: 'pending' });
    setEditing(false);
  }

  return (
    <article className={`ol-req${r.reply ? '' : ' is-new'}`} data-owner-request>
      <div className="ol-req-head">
        <span className="ol-thumb is-sm">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {r.photo ? <img src={r.photo} alt="" loading="lazy" /> : null}
        </span>
        <div style={{ minWidth: 0 }}>
          <p className="ol-bname">{r.board_name}</p>
          <p className="ol-bmeta"><strong>{r.company}</strong> wants it {fmtDate(r.start_date)} – {fmtDate(r.end_date)} ({months(r.start_date, r.end_date)} month{months(r.start_date, r.end_date) !== 1 ? 's' : ''})</p>
        </div>
      </div>
      {(r.message || r.extra) && (
        <p className="ol-msg">{r.message}{r.extra ? <><br /><strong>Also:</strong> {r.extra}</> : null}</p>
      )}

      {!editing && r.reply ? (
        <div className={`ol-answer${sent ? ' is-sent' : ''}`}>
          <p>
            <strong>{r.reply.available ? `Available${r.reply.quoted_rate ? ` · ${naira(r.reply.quoted_rate)} per month` : ''}` : 'Not available'}</strong>
            <span>{sent ? 'Sent to the buyer' : r.reply.status === 'dismissed' ? 'Our team will call you about this' : 'With our team, who will reply to the buyer'}</span>
          </p>
          {!sent && <button type="button" className="ol-link" onClick={() => setEditing(true)}>Change</button>}
        </div>
      ) : (
        <form onSubmit={send} className="ol-form">
          <div className="ol-choice">
            <button type="button" className={avail === true ? 'is-yes' : ''} onClick={() => setAvail(true)} aria-pressed={avail === true}>Available</button>
            <button type="button" className={avail === false ? 'is-no' : ''} onClick={() => setAvail(false)} aria-pressed={avail === false}>Not available</button>
          </div>
          {avail && (
            <>
              <label className="ol-lbl" htmlFor={`rate-${r.id}`}>Your price per month (₦)</label>
              <input id={`rate-${r.id}`} inputMode="numeric" value={rate} onChange={e => setRate(e.target.value.replace(/[^\d]/g, ''))} placeholder="e.g. 1500000" className="ol-field" />
              {Number(rate) > 0 && <p className="ol-hint" style={{ marginTop: -4 }}>{naira(Number(rate))} per month</p>}
              <div className="ol-2">
                <div><label className="ol-lbl" htmlFor={`f-${r.id}`}>Free from</label><input id={`f-${r.id}`} type="date" value={from} onChange={e => setFrom(e.target.value)} className="ol-field" /></div>
                <div><label className="ol-lbl" htmlFor={`t-${r.id}`}>Until</label><input id={`t-${r.id}`} type="date" value={to} min={from} onChange={e => setTo(e.target.value)} className="ol-field" /></div>
              </div>
              <label className="ol-lbl" htmlFor={`c-${r.id}`}>Terms (optional)</label>
              <input id={`c-${r.id}`} value={cond} maxLength={500} onChange={e => setCond(e.target.value)} placeholder="e.g. printing not included, 3 months minimum" className="ol-field" />
            </>
          )}
          {avail !== null && (
            <>
              <label className="ol-lbl" htmlFor={`n-${r.id}`}>Note for our team (optional)</label>
              <input id={`n-${r.id}`} value={note} maxLength={1000} onChange={e => setNote(e.target.value)} placeholder={avail ? 'Anything we should know' : 'e.g. booked until March'} className="ol-field" />
            </>
          )}
          {err && <p role="alert" className="ol-err">{err}</p>}
          <button type="submit" className="ol-btn ol-wide" disabled={busy || avail == null}>{busy ? 'Sending…' : 'Send answer'}</button>
        </form>
      )}
    </article>
  );
}

const CSS = `
.ol { min-height: 100vh; background: #F8FAFC; color: #0F172A; font-family: 'Inter', system-ui, sans-serif; padding-bottom: 110px; }
.ol-in { max-width: 640px; margin: 0 auto; padding-left: 16px; padding-right: 16px; box-sizing: border-box; width: 100%; }
.ol-bar { background: #fff; border-bottom: 1px solid #E2E8F0; }
.ol-bar-in { display: flex; align-items: center; justify-content: space-between; height: 54px; }
.ol-logo { display: flex; align-items: center; gap: 8px; font-weight: 800; font-size: .875rem; letter-spacing: -.01em; }
.ol-logo-mark { width: 26px; height: 26px; border-radius: 7px; background: #1B4F8A; display: grid; place-items: center; }
.ol-help { font-size: .8125rem; font-weight: 600; color: #15803D; text-decoration: none; padding: 7px 12px; border-radius: 999px; background: #F0FDF4; border: 1px solid #BBF7D0; }
.ol-main { padding-top: 22px; }
.ol-eyebrow { font-size: .75rem; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; color: #1B4F8A; margin: 0 0 6px; }
.ol-h1 { font-size: 1.625rem; font-weight: 800; letter-spacing: -.025em; line-height: 1.15; margin: 0; color: #0F172A; }
.ol-sub { font-size: .9375rem; color: #64748B; line-height: 1.55; margin: 8px 0 18px; }
.ol-todo { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 24px; }
.ol-todo div { background: #fff; border: 1px solid #E2E8F0; border-radius: 14px; padding: 12px 14px; display: flex; flex-direction: column; gap: 2px; }
.ol-todo strong { font-size: 1.5rem; font-weight: 800; letter-spacing: -.02em; color: #94A3B8; }
.ol-todo span { font-size: .8125rem; color: #64748B; }
.ol-todo .is-hot { border-color: #FECDD3; background: #FFF1F2; } .ol-todo .is-hot strong { color: #E11D48; }
.ol-todo .is-warm { border-color: #FDE68A; background: #FFFBEB; } .ol-todo .is-warm strong { color: #B45309; }
.ol-sec { margin-bottom: 28px; }
.ol-sec h2 { font-size: 1.0625rem; font-weight: 800; letter-spacing: -.015em; margin: 0; }
.ol-sec-sub { font-size: .8125rem; color: #64748B; margin: 4px 0 12px; line-height: 1.5; }
.ol-req { background: #fff; border: 1px solid #E2E8F0; border-radius: 16px; padding: 14px; margin-bottom: 10px; }
.ol-req.is-new { border-color: #FDA4AF; box-shadow: 0 0 0 3px #FFF1F2; }
.ol-req-head, .ol-board-top { display: flex; gap: 12px; align-items: center; }
.ol-thumb { width: 64px; height: 64px; border-radius: 10px; background: #EEF2F7; overflow: hidden; flex-shrink: 0; display: block; }
.ol-thumb.is-sm { width: 52px; height: 52px; }
.ol-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.ol-open { width: 100%; background: none; border: none; padding: 0; margin: 0; font: inherit; color: inherit; text-align: left; cursor: pointer; border-radius: 10px; }
.ol-open:focus-visible { outline: 2px solid #1B4F8A; outline-offset: 3px; }
.ol-open .ol-bname, .ol-open .ol-bmeta, .ol-open .ol-checked { display: block; }
.ol-open .ol-bname { display: -webkit-box; }
.ol-chev { color: #CBD5E1; flex-shrink: 0; }
.ol-nophoto { width: 100%; height: 100%; display: grid; place-items: center; font-size: .625rem; font-weight: 600; color: #94A3B8; text-align: center; }
.ol-nophoto.is-big { font-size: .875rem; }
.ol-chip { display: inline-block; margin-top: 6px; font-size: .6875rem; font-weight: 700; color: #1D4ED8; background: #DBEAFE; border-radius: 999px; padding: 3px 9px; }
.ol-chip.is-done { color: #047857; background: #D1FAE5; }
.ol-sheet-bg { position: fixed; inset: 0; z-index: 100; background: rgba(15,23,42,.55); display: flex; align-items: flex-end; justify-content: center; }
.ol-sheet { background: #fff; width: 100%; max-width: 560px; max-height: 92vh; overflow-y: auto; border-radius: 20px 20px 0 0; animation: olUp .22s ease; overscroll-behavior: contain; }
@keyframes olUp { from { transform: translateY(24px); opacity: 0; } to { transform: none; opacity: 1; } }
.ol-sheet-photo { position: relative; aspect-ratio: 4 / 3; background: #0F172A; display: grid; place-items: center; }
.ol-sheet-photo img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; display: block; }
.ol-sheet-photo .ol-nophoto { color: rgba(255,255,255,.55); }
.ol-x { position: absolute; top: 12px; right: 12px; width: 38px; height: 38px; border-radius: 50%; border: none; background: rgba(255,255,255,.94); color: #0F172A; display: grid; place-items: center; cursor: pointer; box-shadow: 0 2px 10px rgba(15,23,42,.25); }
.ol-photo-btn { position: absolute; left: 50%; bottom: 14px; transform: translateX(-50%); display: inline-flex; align-items: center; gap: 8px; height: 42px; padding: 0 16px; border-radius: 999px; background: rgba(255,255,255,.96); color: #0F172A; font-size: .875rem; font-weight: 700; cursor: pointer; white-space: nowrap; box-shadow: 0 4px 14px rgba(15,23,42,.3); }
.ol-photo-btn input { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
.ol-photo-btn:focus-within { outline: 2px solid #1B4F8A; outline-offset: 2px; }
.ol-thumbs { display: flex; gap: 8px; padding: 10px 16px 0; overflow-x: auto; }
.ol-thumbs button { width: 60px; height: 44px; border-radius: 8px; overflow: hidden; padding: 0; border: 2px solid transparent; background: #EEF2F7; flex-shrink: 0; cursor: pointer; }
.ol-thumbs button.is-on { border-color: #1B4F8A; }
.ol-thumbs img { width: 100%; height: 100%; object-fit: cover; display: block; }
.ol-sheet-body { padding: 16px 16px calc(20px + env(safe-area-inset-bottom)); }
.ol-sheet-h { font-size: 1.125rem; font-weight: 800; letter-spacing: -.015em; line-height: 1.3; margin: 0; }
.ol-facts { margin: 14px 0 16px; display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.ol-facts div { background: #F8FAFC; border: 1px solid #EEF2F7; border-radius: 12px; padding: 9px 12px; min-width: 0; }
.ol-facts div:first-child { grid-column: 1 / -1; }
.ol-facts dt { font-size: .6875rem; font-weight: 600; color: #64748B; }
.ol-facts dd { margin: 2px 0 0; font-size: .875rem; font-weight: 600; overflow-wrap: anywhere; }
.ol-sent { margin: 12px 0 0; font-size: .8125rem; line-height: 1.5; color: #1E3A8A; background: #EFF6FF; border: 1px solid #BFDBFE; border-radius: 12px; padding: 10px 12px; }
.ol-sent.is-done { color: #065F46; background: #ECFDF5; border-color: #A7F3D0; }
.ol-btn-2 { display: inline-flex; align-items: center; justify-content: center; height: 48px; padding: 0 20px; border-radius: 12px; background: #fff; color: #1B4F8A; border: 1.5px solid #BFDBFE; font-family: inherit; font-size: .9375rem; font-weight: 700; cursor: pointer; }
.ol-choice .is-pick { background: #1B4F8A; border-color: #1B4F8A; color: #fff; }
.ol-cancel { display: block; margin: 12px auto 0; font-size: .875rem; }
@media (min-width: 640px) {
  .ol-sheet-bg { align-items: center; padding: 24px; }
  .ol-sheet { border-radius: 20px; }
}
.ol-bname { font-weight: 700; font-size: .9375rem; margin: 0; line-height: 1.3; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.ol-bmeta { font-size: .8125rem; color: #475569; margin: 3px 0 0; line-height: 1.4; }
.ol-bmeta strong { color: #0F172A; }
.ol-msg { font-size: .875rem; color: #334155; background: #F8FAFC; border-radius: 10px; padding: 10px 12px; margin: 12px 0 0; line-height: 1.5; white-space: pre-wrap; }
.ol-form { margin-top: 12px; }
.ol-choice { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 12px; }
.ol-choice button { height: 46px; border-radius: 12px; border: 1.5px solid #E2E8F0; background: #fff; font-family: inherit; font-size: .9375rem; font-weight: 700; color: #334155; cursor: pointer; }
.ol-choice .is-yes { background: #059669; border-color: #059669; color: #fff; }
.ol-choice .is-no { background: #DC2626; border-color: #DC2626; color: #fff; }
.ol-lbl { display: block; font-size: .75rem; font-weight: 600; color: #334155; margin: 0 0 4px; }
.ol-field { width: 100%; box-sizing: border-box; height: 44px; padding: 0 12px; border-radius: 10px; border: 1px solid #CBD5E1; font-size: 1rem; font-family: inherit; color: #0F172A; background: #fff; margin-bottom: 10px; }
.ol-field:focus { outline: none; border-color: #1B4F8A; box-shadow: 0 0 0 3px rgba(27,79,138,.12); }
.ol-2 { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 8px; }
.ol-2 > div { min-width: 0; }
.ol-field[type=date] { min-width: 0; -webkit-appearance: none; appearance: none; font-size: .9375rem; padding: 0 8px; }
.ol-hint { font-size: .75rem; color: #64748B; margin: 8px 0 0; line-height: 1.45; }
.ol-err { font-size: .8125rem; color: #B91C1C; background: #FEF2F2; border: 1px solid #FECACA; border-radius: 10px; padding: 8px 10px; margin: 0 0 10px; }
.ol-btn { display: inline-flex; align-items: center; justify-content: center; height: 48px; padding: 0 20px; border-radius: 12px; background: #1B4F8A; color: #fff; border: none; font-family: inherit; font-size: .9375rem; font-weight: 700; cursor: pointer; text-decoration: none; }
.ol-btn:disabled { opacity: .6; cursor: default; }
.ol-wide { width: 100%; }
.ol-link { background: none; border: none; padding: 0; font: inherit; font-weight: 700; color: #1B4F8A; cursor: pointer; font-size: .8125rem; }
.ol-answer { margin-top: 12px; display: flex; align-items: center; justify-content: space-between; gap: 12px; background: #EFF6FF; border: 1px solid #BFDBFE; border-radius: 12px; padding: 10px 12px; }
.ol-answer.is-sent { background: #ECFDF5; border-color: #A7F3D0; }
.ol-answer p { margin: 0; display: flex; flex-direction: column; gap: 2px; font-size: .875rem; }
.ol-answer span { font-size: .75rem; color: #64748B; }
.ol-boards { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
.ol-board { background: #fff; border: 1px solid #E2E8F0; border-radius: 16px; padding: 12px; }
.ol-checked { font-size: .75rem; color: #059669; margin: 4px 0 0; font-weight: 600; }
.ol-checked.is-old { color: #B45309; }
.ol-seg { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; background: #F1F5F9; border-radius: 12px; padding: 4px; margin-top: 12px; }
.ol-seg button { height: 40px; border: none; border-radius: 9px; background: none; font-family: inherit; font-size: .875rem; font-weight: 600; color: #64748B; cursor: pointer; }
.ol-seg .is-on { background: #fff; box-shadow: 0 1px 3px rgba(15,23,42,.14); }
.ol-seg .is-on.is-available { color: #047857; } .ol-seg .is-on.is-booked { color: #B45309; } .ol-seg .is-on.is-unavailable { color: #B91C1C; }
.ol-from { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 10px; font-size: .8125rem; font-weight: 600; color: #334155; }
.ol-from input { height: 40px; border-radius: 10px; border: 1px solid #CBD5E1; padding: 0 10px; font-family: inherit; font-size: .9375rem; }
.ol-from input.is-missing { border-color: #F59E0B; box-shadow: 0 0 0 3px #FEF3C7; }
.ol-empty { font-size: .875rem; color: #64748B; }
.ol-dock { position: fixed; left: 0; right: 0; bottom: 0; z-index: 50; background: rgba(255,255,255,.96); backdrop-filter: blur(12px); border-top: 1px solid #E2E8F0; padding: 12px 0 calc(12px + env(safe-area-inset-bottom)); }
.ol-ok { margin: 0; text-align: center; font-weight: 700; color: #047857; background: #ECFDF5; border-radius: 12px; padding: 14px; font-size: .9375rem; }
.ol-skel { height: 120px; border-radius: 16px; margin-bottom: 10px; background: linear-gradient(90deg, #EEF2F7 0%, #F8FAFC 50%, #EEF2F7 100%); background-size: 200% 100%; animation: olSk 1.2s infinite; }
@keyframes olSk { from { background-position: 200% 0; } to { background-position: -200% 0; } }
.ol-missing { max-width: 420px; margin: 18vh auto 0; text-align: center; padding: 0 16px; }
.ol-missing h1 { font-size: 1.375rem; font-weight: 800; margin: 0 0 8px; }
.ol-missing p { color: #64748B; margin: 0 0 18px; line-height: 1.55; }
`;
