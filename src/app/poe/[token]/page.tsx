'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';

// Install link: an installer (no account) sends a photo of the board once the
// ad is up. The photo goes into private storage; our team checks it before
// the buyer sees it or the booking is shown as live.

type View = {
  status: string; start_date: string | null; end_date: string | null; campaign: string | null;
  board: { name: string; address: string | null; area: string | null; city: string | null; format: string | null;
           width: number | null; height: number | null; latitude: number | null; longitude: number | null };
  artwork: { id: string; file_name: string; mime_type: string | null; url: string | null }[];
  proofs: { status: 'submitted' | 'verified' | 'flagged'; submitted_at: string; review_note: string | null }[];
};
type Step = 'loading' | 'invalid' | 'form' | 'sending' | 'sent';

const fmt = (d: string | null) => (d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const when = (d: string) => new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const FORMATS: Record<string, string> = { billboard: 'Billboard', unipole: 'Unipole', gantry: 'Gantry', bridge_panel: 'Bridge panel', wall_drape: 'Wall drape', led: 'LED screen' };

export default function InstallPhotoPage() {
  const { token } = useParams<{ token: string }>();
  const [step, setStep] = useState<Step>('loading');
  const [view, setView] = useState<View | null>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [loc, setLoc] = useState<{ lat: number; lng: number } | null>(null);
  const [locMsg, setLocMsg] = useState('');
  const [locating, setLocating] = useState(false);
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [distance, setDistance] = useState<number | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/poe/${token}`);
      const r = await res.json();
      if (!res.ok || r.status !== 'ok') { setStep('invalid'); return; }
      setView(r.view);
      setStep(s => (s === 'sent' ? s : 'form'));
    } catch { setStep('invalid'); }
  }, [token]);
  useEffect(() => { if (token) void load(); }, [token, load]);
  useEffect(() => { try { const n = localStorage.getItem('poe_name'); if (n) setName(n); } catch { /* private mode */ } }, []);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  function pick(f: File | undefined) {
    if (!f) return;
    if (f.type && !f.type.startsWith('image/')) { setError('Choose a photo.'); return; }
    if (f.size > 10 * 1024 * 1024) { setError('That photo is over 10 MB. Take it again at a lower size.'); return; }
    setError('');
    setPhoto(f);
    setPreview(URL.createObjectURL(f));
  }

  function locate() {
    if (!navigator.geolocation) { setLocMsg('This phone cannot share its location.'); return; }
    setLocating(true); setLocMsg('');
    navigator.geolocation.getCurrentPosition(
      p => { setLoc({ lat: p.coords.latitude, lng: p.coords.longitude }); setLocating(false); },
      () => { setLocMsg('Location was blocked. You can still send the photo; it may take longer to check.'); setLocating(false); },
      { enableHighAccuracy: true, timeout: 15000 },
    );
  }

  async function send() {
    if (!photo) { setError('Take or choose a photo of the board first.'); return; }
    if (!name.trim()) { setError('Add your name.'); return; }
    setError(''); setStep('sending');
    try {
      const type = photo.type || 'image/jpeg';
      const slot = await fetch(`/api/poe/${token}/upload`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type, size: photo.size }) });
      const s = await slot.json();
      if (!slot.ok) throw new Error(s.error || 'Could not start the upload.');
      const up = await supabase.storage.from('compliance-photos').uploadToSignedUrl(s.path, s.token, photo, { contentType: type });
      if (up.error) throw new Error('The photo did not upload. Check your connection and try again.');
      const done = await fetch(`/api/poe/${token}/complete`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: s.path, latitude: loc?.lat, longitude: loc?.lng, submitterName: name.trim(), notes: notes.trim() || null, deviceInfo: navigator.userAgent }),
      });
      const d = await done.json();
      if (!done.ok) throw new Error(d.error || 'Could not send the photo.');
      try { localStorage.setItem('poe_name', name.trim()); } catch { /* private mode */ }
      setDistance(d.distance_m ?? null);
      setStep('sent');
      setPhoto(null); setPreview(null); setNotes('');
      void load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Try again.');
      setStep('form');
    }
  }

  const b = view?.board;
  const approved = view?.proofs.some(p => p.status === 'verified');
  const latest = view?.proofs[0];

  return (
    <div className="ip">
      <style>{CSS}</style>
      <header className="ip-head">
        <span className="ip-brand">OOH <b>Platform</b></span>
        <span className="ip-tag">Install photo</span>
      </header>

      <main className="ip-main">
        {step === 'loading' && <div className="ip-card ip-center"><div className="ip-spin" /><p className="ip-muted">Opening…</p></div>}

        {step === 'invalid' && (
          <div className="ip-card ip-center">
            <h1 className="ip-h">This link does not work</h1>
            <p className="ip-muted">It may have been replaced, or the booking has ended. Ask the OOH Platform team for a new link.</p>
          </div>
        )}

        {view && b && step !== 'invalid' && step !== 'loading' && (
          <>
            <section className="ip-card ip-board">
              <p className="ip-label">Board</p>
              <h1 className="ip-h">{b.name}</h1>
              <p className="ip-muted">{[b.address, b.area, b.city].filter(Boolean).join(', ') || 'Address not recorded'}</p>
              <dl className="ip-facts">
                {b.format && <div><dt>Format</dt><dd>{FORMATS[b.format] ?? b.format}</dd></div>}
                {b.width && b.height && <div><dt>Size</dt><dd>{b.width} × {b.height} ft</dd></div>}
                <div><dt>Runs</dt><dd>{fmt(view.start_date)} – {fmt(view.end_date)}</dd></div>
                {view.campaign && <div><dt>Campaign</dt><dd>{view.campaign}</dd></div>}
              </dl>
              {b.latitude != null && b.longitude != null && (
                <a className="ip-link" href={`https://www.google.com/maps/search/?api=1&query=${b.latitude},${b.longitude}`} target="_blank" rel="noreferrer">Open directions ↗</a>
              )}
            </section>

            <section className="ip-card">
              <p className="ip-label">Artwork to put up</p>
              {view.artwork.length === 0
                ? <p className="ip-muted">No approved artwork on file yet. Check with the OOH Platform team before installing.</p>
                : <ul className="ip-art">{view.artwork.map(a => (
                    <li key={a.id}>
                      {a.url && a.mime_type?.startsWith('image/') ? <img src={a.url} alt="" /> : <span className="ip-file">{(a.file_name.split('.').pop() || 'file').toUpperCase()}</span>}
                      <span className="ip-art-name">{a.file_name}</span>
                      {a.url && <a className="ip-link" href={a.url} target="_blank" rel="noreferrer">Open</a>}
                    </li>))}
                  </ul>}
            </section>

            {latest && (
              <section className={`ip-card ip-state ${approved ? 'ok' : latest.status === 'flagged' ? 'bad' : 'wait'}`}>
                {approved ? <><b>Photo approved.</b> Thank you. Send another only if the ad changes or gets damaged.</>
                  : latest.status === 'flagged' ? <><b>Please send a new photo.</b> {latest.review_note}</>
                  : <><b>Photo received {when(latest.submitted_at)}.</b> Our team is checking it.</>}
              </section>
            )}

            {step === 'sent' && (
              <section className="ip-card ip-state ok" role="status">
                <b>Sent. Thank you.</b> Our team will check the photo{distance != null ? ` (taken about ${distance} m from the board's map pin)` : ''}. Nothing else to do unless we ask for another.
              </section>
            )}

            {step !== 'sent' && (
              <section className="ip-card">
                <p className="ip-label">{latest ? 'Send another photo' : 'Send a photo of the installed board'}</p>
                <p className="ip-muted ip-tip">Stand where drivers see it. Get the whole face in, with the street in view.</p>

                <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={e => pick(e.target.files?.[0])} />
                <input ref={fileRef} type="file" accept="image/*" hidden onChange={e => pick(e.target.files?.[0])} />
                {preview
                  ? <div className="ip-preview"><img src={preview} alt="Your photo" /><button type="button" className="ip-btn ghost" onClick={() => { setPhoto(null); setPreview(null); }}>Retake</button></div>
                  : <div className="ip-pick">
                      <button type="button" className="ip-btn primary" onClick={() => cameraRef.current?.click()}>Take photo</button>
                      <button type="button" className="ip-btn ghost" onClick={() => fileRef.current?.click()}>Choose from phone</button>
                    </div>}

                <div className="ip-field">
                  <span>Location</span>
                  {loc ? <p className="ip-okline">Location added ✓</p>
                    : <button type="button" className="ip-btn ghost" onClick={locate} disabled={locating}>{locating ? 'Finding you…' : 'Add my location'}</button>}
                  <small>{locMsg || 'Helps us confirm the photo is from this board.'}</small>
                </div>
                <label className="ip-field"><span>Your name</span>
                  <input value={name} onChange={e => setName(e.target.value)} maxLength={120} autoComplete="name" placeholder="e.g. Sam Okafor" />
                </label>
                <label className="ip-field"><span>Note <i>(optional)</i></span>
                  <textarea value={notes} onChange={e => setNotes(e.target.value)} maxLength={1000} rows={2} placeholder="Anything we should know, e.g. a light is out" />
                </label>
                {error && <p className="ip-err" role="alert">{error}</p>}
                <button type="button" className="ip-btn primary wide" onClick={send} disabled={step === 'sending'}>{step === 'sending' ? 'Sending…' : 'Send photo'}</button>
                <p className="ip-muted ip-fine">The photo is stored privately. Only the OOH Platform team, the advertiser and the board&apos;s owner can see it.</p>
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}

const CSS = `
.ip { min-height: 100vh; background: #F1F5F9; font-family: inherit; color: #0F172A; }
.ip-head { background: #0F172A; color: #F8FAFC; display: flex; justify-content: space-between; align-items: center; padding: 14px 16px; }
.ip-brand { font-weight: 600; letter-spacing: -.01em; } .ip-brand b { color: #F59E0B; font-weight: 700; }
.ip-tag { font-size: .75rem; color: rgba(248,250,252,.65); }
.ip-main { max-width: 520px; margin: 0 auto; padding: 16px; display: grid; gap: 12px; }
.ip-card { background: #fff; border: 1px solid #E2E8F0; border-radius: 14px; padding: 16px; }
.ip-center { text-align: center; padding: 40px 20px; }
.ip-spin { width: 32px; height: 32px; border: 3px solid #E2E8F0; border-top-color: #1B4F8A; border-radius: 50%; margin: 0 auto 10px; animation: ipspin .7s linear infinite; }
@keyframes ipspin { to { transform: rotate(360deg); } }
.ip-label { font-size: .6875rem; text-transform: uppercase; letter-spacing: .07em; font-weight: 600; color: #64748B; margin: 0 0 6px; }
.ip-h { font-size: 1.125rem; font-weight: 700; margin: 0 0 4px; letter-spacing: -.01em; }
.ip-muted { font-size: .875rem; color: #64748B; margin: 0; line-height: 1.5; }
.ip-tip { margin-bottom: 12px; } .ip-fine { font-size: .75rem; margin-top: 10px; text-align: center; }
.ip-facts { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 12px; margin: 12px 0 0; }
.ip-facts dt { font-size: .6875rem; color: #94A3B8; } .ip-facts dd { margin: 0; font-size: .875rem; font-weight: 600; }
.ip-link { display: inline-block; margin-top: 10px; font-size: .875rem; font-weight: 600; color: #1B4F8A; text-decoration: none; }
.ip-art { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
.ip-art li { display: flex; align-items: center; gap: 10px; }
.ip-art li .ip-link { margin: 0 0 0 auto; }
.ip-art img, .ip-file { width: 56px; height: 40px; border-radius: 6px; object-fit: cover; background: #F1F5F9; flex: none; }
.ip-file { display: grid; place-items: center; font-size: .625rem; font-weight: 700; color: #64748B; }
.ip-art-name { font-size: .8125rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.ip-state { font-size: .875rem; line-height: 1.5; }
.ip-state.ok { background: #ECFDF5; border-color: #A7F3D0; color: #065F46; }
.ip-state.wait { background: #EFF6FF; border-color: #BFDBFE; color: #1E3A8A; }
.ip-state.bad { background: #FFF7ED; border-color: #FED7AA; color: #9A3412; }
.ip-pick { display: grid; gap: 8px; }
.ip-preview { position: relative; } .ip-preview img { width: 100%; max-height: 320px; object-fit: cover; border-radius: 10px; display: block; }
.ip-preview .ip-btn { position: absolute; right: 8px; bottom: 8px; background: rgba(255,255,255,.95); }
.ip-btn { border: 1px solid #CBD5E1; background: #fff; color: #0F172A; border-radius: 10px; padding: 12px 14px; font: inherit; font-size: .9375rem; font-weight: 600; cursor: pointer; }
.ip-btn.primary { background: #1B4F8A; border-color: #1B4F8A; color: #fff; }
.ip-btn.wide { width: 100%; margin-top: 4px; padding: 14px; }
.ip-btn:disabled { opacity: .6; cursor: default; }
.ip-field { display: grid; gap: 6px; margin-top: 14px; }
.ip-field > span { font-size: .8125rem; font-weight: 600; } .ip-field i { font-weight: 400; color: #94A3B8; font-style: normal; }
.ip-field small { font-size: .75rem; color: #64748B; }
.ip-field input, .ip-field textarea { border: 1px solid #CBD5E1; border-radius: 10px; padding: 11px 12px; font: inherit; font-size: 1rem; resize: vertical; }
.ip-field input:focus, .ip-field textarea:focus { outline: none; border-color: #1B4F8A; box-shadow: 0 0 0 3px rgba(27,79,138,.1); }
.ip-okline { margin: 0; font-size: .875rem; color: #047857; font-weight: 600; }
.ip-err { color: #B91C1C; font-size: .875rem; margin: 12px 0 0; }
`;
