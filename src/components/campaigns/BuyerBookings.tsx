'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import {
  type CampaignBooking, stagesOf, headline, fmtDay, signedLinks, uploadArtwork, ARTWORK_ACCEPT,
} from '@/lib/campaign-progress';

// "Your bookings" on My requests: one card per booked board with its real
// progress, the artwork the buyer sent, and install photos once our team has
// approved them. Shows nothing until the buyer has a booking.
export default function BuyerBookings() {
  const [rows, setRows] = useState<CampaignBooking[]>([]);
  const [links, setLinks] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('my_campaign_bookings');
    if (error) { setLoaded(true); return; }
    const list = (data ?? []) as CampaignBooking[];
    setRows(list);
    const [art, proof] = await Promise.all([
      signedLinks('creatives', list.flatMap(b => b.artwork.map(a => a.path))),
      signedLinks('compliance-photos', list.flatMap(b => b.proofs.map(p => p.path))),
    ]);
    setLinks({ ...art, ...proof });
    setLoaded(true);
  }, []);
  useEffect(() => { (async () => { await load(); })(); }, [load]);

  if (!loaded || rows.length === 0) return null;
  return (
    <section className="bb" aria-labelledby="bb-h">
      <style>{BB_CSS}</style>
      <h2 id="bb-h" className="bb-h">Your bookings <span>{rows.length}</span></h2>
      <div className="bb-list">{rows.map(b => <BookingCard key={b.id} b={b} links={links} onChanged={load} />)}</div>
    </section>
  );
}

function BookingCard({ b, links, onChanged }: { b: CampaignBooking; links: Record<string, string>; onChanged: () => Promise<void> }) {
  const stages = stagesOf(b);
  const head = headline(b);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const approvedProofs = b.proofs.filter(p => p.status === 'verified');
  const canSend = ['agreed', 'signed', 'live'].includes(b.status) && !stages[4].done;
  const latestArt = b.artwork[0];

  async function send(f: File | undefined) {
    if (!f) return;
    setBusy(true); setMsg(null);
    const err = await uploadArtwork(b.id, f);
    setBusy(false);
    if (fileRef.current) fileRef.current.value = '';
    if (err) { setMsg({ text: err, bad: true }); return; }
    setMsg({ text: 'Artwork sent. Our team will check it and tell you if anything needs changing.' });
    await onChanged();
  }

  return (
    <article className="bb-card">
      <div className="bb-top">
        {b.board.photo ? <img className="bb-thumb" src={b.board.photo} alt="" /> : <div className="bb-thumb bb-ph" />}
        <div className="bb-id">
          <a href={`/boards/${b.board.id}`} className="bb-name">{b.board.name}</a>
          <p className="bb-meta">{[b.board.area, b.board.city].filter(Boolean).join(', ')}{b.start_date ? ` · ${fmtDay(b.start_date)} – ${fmtDay(b.end_date)}` : ''}{b.campaign.name ? ` · ${b.campaign.name}` : ''}</p>
        </div>
        <span className={`bb-pill ${head.tone}`}>{head.text}</span>
      </div>

      <ol className="bb-steps" aria-label="Progress">
        {stages.map(s => (
          <li key={s.key} className={s.tone} title={s.note}>
            <i aria-hidden>{s.tone === 'done' ? '✓' : s.tone === 'warn' ? '!' : ''}</i>
            <b>{s.label}</b><small>{s.note}</small>
          </li>
        ))}
      </ol>

      <div className="bb-cols">
        <div className="bb-col">
          <h3>Artwork</h3>
          {b.artwork.length === 0 && <p className="bb-muted">{b.confirmed ? 'Send your artwork when it is ready.' : 'You can send artwork now; we print once the booking is confirmed.'}</p>}
          {b.artwork.length > 0 && (
            <ul className="bb-files">{b.artwork.slice(0, 4).map(a => (
              <li key={a.id}>
                <span className="bb-fname">{a.path && links[a.path] ? <a href={links[a.path]} target="_blank" rel="noreferrer">{a.file_name}</a> : a.file_name}</span>
                <span className={`bb-tag ${a.status === 'approved' || a.status === 'printing' || a.status === 'live' ? 'ok' : a.status === 'changes_requested' ? 'warn' : ''}`}>
                  {a.status === 'changes_requested' ? 'Changes needed' : a.status === 'uploaded' ? 'Being checked' : 'Approved'}
                </span>
                {a.status === 'changes_requested' && a.review_note && <p className="bb-note">{a.review_note}</p>}
              </li>))}
            </ul>
          )}
          {canSend && (
            <>
              <input ref={fileRef} type="file" accept={ARTWORK_ACCEPT} hidden onChange={e => send(e.target.files?.[0])} />
              <button type="button" className="bb-btn" disabled={busy} onClick={() => fileRef.current?.click()}>
                {busy ? 'Sending…' : latestArt ? 'Send a new version' : 'Send artwork'}
              </button>
              <p className="bb-fine">JPG, PNG, PDF, TIFF, AI, EPS, PSD, ZIP or MP4, up to 50 MB.</p>
            </>
          )}
          {msg && <p className={`bb-msg${msg.bad ? ' bad' : ''}`} role="status">{msg.text}</p>}
        </div>
        <div className="bb-col">
          <h3>Install photos</h3>
          {approvedProofs.length === 0
            ? <p className="bb-muted">{stages[2].tone === 'now' ? 'A photo has come in from the site. You will see it here once our team has checked it.' : 'Once the ad is up, the installer sends a photo. We check it before showing it here.'}</p>
            : <div className="bb-proofs">{approvedProofs.map(p => (
                <a key={p.id} href={p.path ? links[p.path] : undefined} target="_blank" rel="noreferrer" className="bb-proof">
                  {p.path && links[p.path] ? <img src={links[p.path]} alt={`Install photo, ${fmtDay(p.submitted_at)}`} /> : <span className="bb-ph" />}
                  <small>Taken {fmtDay(p.submitted_at)} · approved {fmtDay(p.reviewed_at)}</small>
                </a>))}
              </div>}
        </div>
      </div>
    </article>
  );
}

export const BB_CSS = `
.bb { margin: 0 0 22px; }
.bb-h { font-size: .9375rem; font-weight: 700; margin: 0 0 10px; color: #0F172A; display: flex; align-items: center; gap: 8px; }
.bb-h span { font-size: .75rem; font-weight: 600; color: #475569; background: #E2E8F0; border-radius: 999px; padding: 1px 8px; }
.bb-list { display: grid; gap: 12px; }
.bb-card { background: #fff; border: 1px solid #E2E8F0; border-radius: 14px; padding: 16px; }
.bb-top { display: flex; gap: 12px; align-items: center; }
.bb-thumb { width: 56px; height: 42px; border-radius: 8px; object-fit: cover; flex: none; background: #F1F5F9; }
.bb-ph { background: linear-gradient(135deg, #F1F5F9, #E2E8F0); display: block; }
.bb-id { min-width: 0; flex: 1; }
.bb-name { font-weight: 700; color: #0F172A; text-decoration: none; font-size: .9375rem; }
.bb-name:hover { text-decoration: underline; }
.bb-meta { margin: 2px 0 0; font-size: .8125rem; color: #64748B; }
.bb-pill { font-size: .75rem; font-weight: 600; border-radius: 999px; padding: 4px 10px; white-space: nowrap; flex: none; }
.bb-pill.done { background: #ECFDF5; color: #047857; } .bb-pill.now { background: #EFF6FF; color: #1D4ED8; } .bb-pill.warn { background: #FFF7ED; color: #C2410C; }
.bb-steps { list-style: none; margin: 16px 0 0; padding: 0; display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px; }
.bb-steps li { display: grid; grid-template-columns: 18px 1fr; column-gap: 6px; align-items: start; padding-top: 10px; border-top: 3px solid #E2E8F0; }
.bb-steps li.done { border-color: #10B981; } .bb-steps li.now { border-color: #3B82F6; } .bb-steps li.warn { border-color: #F97316; }
.bb-steps i { grid-row: span 2; width: 18px; height: 18px; border-radius: 50%; display: grid; place-items: center; font-style: normal; font-size: .6875rem; font-weight: 700; background: #F1F5F9; color: #fff; }
.bb-steps li.done i { background: #10B981; } .bb-steps li.now i { background: #fff; box-shadow: inset 0 0 0 2px #3B82F6; } .bb-steps li.warn i { background: #F97316; }
.bb-steps b { font-size: .75rem; color: #0F172A; } .bb-steps li.todo b { color: #94A3B8; }
.bb-steps small { font-size: .6875rem; color: #64748B; line-height: 1.35; }
.bb-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 16px; padding-top: 14px; border-top: 1px solid #F1F5F9; }
.bb-col h3 { font-size: .75rem; text-transform: uppercase; letter-spacing: .06em; color: #64748B; margin: 0 0 8px; font-weight: 600; }
.bb-muted { font-size: .8125rem; color: #64748B; margin: 0 0 10px; line-height: 1.5; }
.bb-files { list-style: none; margin: 0 0 10px; padding: 0; display: grid; gap: 6px; }
.bb-files li { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; font-size: .8125rem; }
.bb-fname { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 70%; }
.bb-fname a { color: #1B4F8A; }
.bb-tag { font-size: .6875rem; font-weight: 600; border-radius: 6px; padding: 2px 6px; background: #EFF6FF; color: #1D4ED8; }
.bb-tag.ok { background: #ECFDF5; color: #047857; } .bb-tag.warn { background: #FFF7ED; color: #C2410C; }
.bb-note { flex-basis: 100%; margin: 0; font-size: .75rem; color: #9A3412; }
.bb-btn { border: 1px solid #1B4F8A; background: #1B4F8A; color: #fff; border-radius: 9px; padding: 8px 14px; font: inherit; font-size: .8125rem; font-weight: 600; cursor: pointer; }
.bb-btn:disabled { opacity: .6; cursor: default; }
.bb-fine { font-size: .6875rem; color: #94A3B8; margin: 6px 0 0; }
.bb-msg { font-size: .8125rem; color: #047857; margin: 8px 0 0; } .bb-msg.bad { color: #B91C1C; }
.bb-proofs { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 8px; }
.bb-proof { text-decoration: none; color: inherit; }
.bb-proof img, .bb-proof .bb-ph { width: 100%; aspect-ratio: 4 / 3; object-fit: cover; border-radius: 8px; display: block; }
.bb-proof small { font-size: .6875rem; color: #64748B; }
@media (max-width: 640px) {
  .bb-top { flex-wrap: wrap; row-gap: 8px; } .bb-id { flex: 1 1 calc(100% - 68px); } .bb-pill { order: 3; margin-left: 68px; white-space: normal; }
  .bb-steps { grid-template-columns: 1fr; gap: 0; }
  .bb-steps li { border-top: 0; border-left: 3px solid #E2E8F0; padding: 4px 0 8px 10px; }
  .bb-steps li.done { border-color: #10B981; } .bb-steps li.now { border-color: #3B82F6; } .bb-steps li.warn { border-color: #F97316; }
  .bb-cols { grid-template-columns: 1fr; }
}
`;
