'use client';

/**
 * A proposal a buyer sent to their client (052). Read-only and public to
 * anyone with the link. It shows the boards and, if the buyer chose, guide
 * prices. There is no request button: the client goes back to the buyer.
 */

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { attachGuidePrices, compactNaira, guideText, GUIDE_NOTE, type GuidePrice } from '@/lib/guide-prices';
import { boardFormatLabel } from '@/lib/board-formats';
import { dimensionsText } from '@/lib/board-verification';
import type { MapBoard } from '../../marketplace/MarketplaceMap';

const MarketplaceMap = dynamic(() => import('../../marketplace/MarketplaceMap'), {
  ssr: false,
  loading: () => <div style={{ height: '100%', background: '#EEF2F7' }} />,
});

type Proposal = { title: string; client_name: string | null; note: string | null; board_ids: string[]; show_prices: boolean; created_at: string; prepared_by: string };
type PBoard = {
  id: string; name: string; address: string | null; area: string | null; city: string | null; state: string | null;
  format: string | null; width: number | null; height: number | null; illuminated: boolean | null; face_count: number | null;
  photo_urls: string[] | null; verification_status: string | null; latitude: number | null; longitude: number | null;
  guide: GuidePrice | null;
};

const fmtDate = (d: string) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

export default function ProposalPage() {
  const { token } = useParams<{ token: string }>();
  const [p, setP] = useState<Proposal | null>(null);
  const [boards, setBoards] = useState<PBoard[] | null>(null);
  const [problem, setProblem] = useState(false);
  const [photo, setPhoto] = useState<{ urls: string[]; i: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.rpc('get_proposal', { p_token: token });
      if (cancelled) return;
      if (error || !data) { setProblem(true); return; }
      const prop = data as Proposal;
      setP(prop);
      // Count an open once per browser session.
      let seen = false;
      try { seen = sessionStorage.getItem(`ooh_p_${token}`) === '1'; sessionStorage.setItem(`ooh_p_${token}`, '1'); } catch {}
      if (!seen) supabase.rpc('record_proposal_open', { p_token: token }).then(() => {}, () => {});

      const { data: rows } = await supabase.from('boards')
        .select('id, name, address, area, city, state, format, width, height, illuminated, face_count, photo_urls, verification_status, latitude, longitude')
        .in('id', prop.board_ids);
      const base = (rows ?? []) as Omit<PBoard, 'guide'>[];
      const withGuide: PBoard[] = prop.show_prices ? await attachGuidePrices(base) : base.map(b => ({ ...b, guide: null }));
      const order = new Map(prop.board_ids.map((id, i) => [id, i]));
      if (!cancelled) setBoards(withGuide.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)));
    })();
    return () => { cancelled = true; };
  }, [token]);

  useEffect(() => {
    if (p) document.title = `${p.title} · ${p.prepared_by}`;
  }, [p]);

  const priced = (boards ?? []).filter(b => b.guide);
  const total = priced.reduce((t, b) => ({ low: t.low + b.guide!.low, high: t.high + b.guide!.high }), { low: 0, high: 0 });
  const cities = [...new Set((boards ?? []).map(b => b.city).filter(Boolean))] as string[];
  const mapBoards: MapBoard[] = useMemo(() => (boards ?? [])
    .filter(b => b.latitude != null && b.longitude != null)
    .map(b => ({
      id: b.id, name: b.name, area: b.area, city: b.city ?? '', format: boardFormatLabel(b.format), photo_urls: b.photo_urls,
      verification_status: b.verification_status, latitude: b.latitude!, longitude: b.longitude!,
      rate: b.guide ? guideText(b.guide) : '', perMonth: !!b.guide, guide: !!b.guide,
    })), [boards]);

  if (problem) {
    return (
      <div className="pp"><style>{CSS}</style>
        <div className="pp-missing" data-problem>
          <h1>This link isn&rsquo;t available</h1>
          <p>It may have been removed. Ask the person who sent it for a new link.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="pp">
      <style>{CSS}</style>
      <header className="pp-hero">
        <div className="pp-in">
          <div className="pp-top">
            <p className="pp-eyebrow">{p ? `Prepared by ${p.prepared_by}` : ' '}</p>
            {boards && boards.length > 0 && <button type="button" className="pp-print" onClick={() => window.print()}>Save as PDF</button>}
          </div>
          <h1 className="pp-h1">{p?.title ?? 'Loading…'}</h1>
          {p && (
            <p className="pp-meta">
              {p.client_name && <>For {p.client_name} · </>}{fmtDate(p.created_at)}
            </p>
          )}
          {boards && boards.length > 0 && (
            <div className="pp-stats">
              <div><strong>{boards.length}</strong><span>board{boards.length !== 1 ? 's' : ''}</span></div>
              <div><strong>{cities.length || '—'}</strong><span>{cities.length === 1 ? cities[0] : 'cities'}</span></div>
              {p?.show_prices && priced.length > 0 && (
                <div><strong>{compactNaira(total.low)}–{compactNaira(total.high).replace('₦', '')}</strong><span>guide per month{priced.length < boards.length ? ` · ${priced.length} priced` : ''}</span></div>
              )}
            </div>
          )}
        </div>
      </header>

      <main className="pp-in pp-main">
        {p?.note && <blockquote className="pp-note">{p.note}<cite>{p.prepared_by}</cite></blockquote>}

        {!boards ? (
          <div className="pp-cards">{[0, 1, 2].map(i => <div key={i} className="pp-skel" />)}</div>
        ) : boards.length === 0 ? (
          <p className="pp-empty">These boards are no longer listed. Ask {p?.prepared_by ?? 'the sender'} for an updated list.</p>
        ) : (
          <>
            {mapBoards.length > 0 && (
              <div className="pp-map" data-map>
                <MarketplaceMap boards={mapBoards} onOpen={id => document.getElementById(`pp-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })} />
              </div>
            )}
            <div className="pp-cards">
              {boards.map((b, n) => {
                const size = b.width && b.height ? dimensionsText(b.width, b.height) : null;
                const facts = [boardFormatLabel(b.format), size, b.illuminated ? 'Lit' : b.illuminated === false ? 'Not lit' : null, b.face_count && b.face_count > 1 ? `${b.face_count} faces` : null].filter(Boolean);
                return (
                  <article key={b.id} id={`pp-${b.id}`} className="pp-card" data-proposal-board>
                    <button type="button" className="pp-photo" disabled={!b.photo_urls?.length} onClick={() => b.photo_urls?.length && setPhoto({ urls: b.photo_urls, i: 0 })} aria-label={`Photos of ${b.name}`}>
                      {b.photo_urls?.[0]
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img src={b.photo_urls[0]} alt="" loading="lazy" />
                        : <span>No photo yet</span>}
                      <em>{n + 1}</em>
                      {(b.photo_urls?.length ?? 0) > 1 && <i>{b.photo_urls!.length} photos</i>}
                    </button>
                    <div className="pp-body">
                      <h2>{b.name}</h2>
                      <p className="pp-place">{[b.address, b.area, b.city].filter(Boolean).join(', ') || '—'}</p>
                      <p className="pp-facts">{facts.join(' · ')}</p>
                      {p?.show_prices && (
                        <p className="pp-price">{b.guide ? <><strong>{guideText(b.guide)}</strong> per month</> : <span>Price on request</span>}</p>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
            {p?.show_prices && priced.length > 0 && <p className="pp-fine">{GUIDE_NOTE.replace('when you request it', 'when the booking is placed')}</p>}
          </>
        )}
      </main>

      <footer className="pp-foot">Shared via <Link href="/">OOH Platform</Link>, Nigeria&rsquo;s billboard marketplace</footer>

      {photo && (
        <div className="pp-lb" role="dialog" aria-modal="true" onClick={() => setPhoto(null)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photo.urls[photo.i]} alt="" onClick={e => e.stopPropagation()} />
          {photo.urls.length > 1 && (
            <div className="pp-lb-nav" onClick={e => e.stopPropagation()}>
              <button type="button" onClick={() => setPhoto({ ...photo, i: (photo.i - 1 + photo.urls.length) % photo.urls.length })} aria-label="Previous photo">‹</button>
              <span>{photo.i + 1} / {photo.urls.length}</span>
              <button type="button" onClick={() => setPhoto({ ...photo, i: (photo.i + 1) % photo.urls.length })} aria-label="Next photo">›</button>
            </div>
          )}
          <button type="button" className="pp-lb-x" onClick={() => setPhoto(null)} aria-label="Close">×</button>
        </div>
      )}
    </div>
  );
}

const CSS = `
.pp { min-height: 100vh; background: #F8FAFC; color: #0F172A; font-family: 'Inter', system-ui, sans-serif; display: flex; flex-direction: column; }
.pp-in { max-width: 1080px; margin: 0 auto; padding-left: 24px; padding-right: 24px; width: 100%; box-sizing: border-box; }
.pp-hero { background: radial-gradient(120% 140% at 0% 0%, #1B4F8A 0%, #0F172A 60%); color: #fff; padding: 28px 0 32px; }
.pp-top { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 34px; }
.pp-eyebrow { font-size: .75rem; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; color: #FCD34D; margin: 0; }
.pp-print { height: 34px; padding: 0 14px; border-radius: 999px; border: 1px solid rgba(255,255,255,.25); background: rgba(255,255,255,.08); color: #fff; font-size: .8125rem; font-weight: 600; line-height: 1; font-family: inherit; cursor: pointer; }
.pp-print:hover { background: rgba(255,255,255,.16); }
.pp-h1 { color: #fff; font-size: 2.25rem; font-weight: 800; letter-spacing: -.03em; line-height: 1.12; margin: 10px 0 0; max-width: 760px; }
.pp-meta { color: #CBD5E1; font-size: .9375rem; margin: 8px 0 0; }
.pp-stats { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 22px; }
.pp-stats div { background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.12); border-radius: 14px; padding: 10px 16px; display: flex; flex-direction: column; gap: 2px; min-width: 96px; }
.pp-stats strong { font-size: 1.25rem; font-weight: 800; letter-spacing: -.02em; }
.pp-stats span { font-size: .75rem; color: #CBD5E1; }
.pp-main { padding-top: 24px; padding-bottom: 48px; flex: 1; }
.pp-note { margin: 0 0 20px; background: #fff; border: 1px solid #E2E8F0; border-left: 4px solid #F59E0B; border-radius: 12px; padding: 14px 18px; font-size: .9375rem; line-height: 1.6; color: #334155; white-space: pre-wrap; }
.pp-note cite { display: block; font-style: normal; font-size: .75rem; color: #94A3B8; margin-top: 6px; font-weight: 600; }
.pp-map { height: 360px; border-radius: 18px; overflow: hidden; border: 1px solid #E2E8F0; margin-bottom: 20px; position: relative; }
.pp-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 16px; }
.pp-card { background: #fff; border: 1px solid #E2E8F0; border-radius: 18px; overflow: hidden; display: flex; flex-direction: column; }
.pp-photo { position: relative; aspect-ratio: 16 / 10; background: #EEF2F7; border: none; padding: 0; cursor: zoom-in; display: block; width: 100%; }
.pp-photo:disabled { cursor: default; }
.pp-photo img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; display: block; }
.pp-photo > span { position: absolute; inset: 0; display: grid; place-items: center; height: 100%; font-size: .8125rem; color: #94A3B8; }
.pp-photo em { position: absolute; top: 10px; left: 10px; min-width: 26px; height: 26px; border-radius: 999px; background: rgba(15,23,42,.85); color: #fff; font-size: .75rem; font-weight: 700; font-style: normal; display: grid; place-items: center; padding: 0 6px; box-sizing: border-box; }
.pp-photo i { position: absolute; bottom: 10px; right: 10px; font-style: normal; font-size: .6875rem; font-weight: 600; color: #fff; background: rgba(15,23,42,.7); border-radius: 999px; padding: 4px 9px; }
.pp-body { padding: 14px 16px 16px; }
.pp-body h2 { font-size: 1rem; font-weight: 700; letter-spacing: -.01em; margin: 0; }
.pp-place { font-size: .8125rem; color: #475569; margin: 4px 0 0; line-height: 1.45; }
.pp-facts { font-size: .75rem; color: #94A3B8; margin: 6px 0 0; }
.pp-price { margin: 12px 0 0; padding-top: 12px; border-top: 1px solid #F1F5F9; font-size: .8125rem; color: #64748B; }
.pp-price strong { font-size: 1.0625rem; color: #0F172A; font-weight: 800; letter-spacing: -.01em; }
.pp-fine { font-size: .75rem; color: #94A3B8; margin: 16px 2px 0; }
.pp-empty { text-align: center; color: #64748B; padding: 48px 0; }
.pp-skel { height: 300px; border-radius: 18px; background: linear-gradient(90deg, #EEF2F7 0%, #F8FAFC 50%, #EEF2F7 100%); background-size: 200% 100%; animation: ppSk 1.2s infinite; }
@keyframes ppSk { from { background-position: 200% 0; } to { background-position: -200% 0; } }
.pp-foot { text-align: center; font-size: .8125rem; color: #94A3B8; padding: 20px 16px 32px; }
.pp-foot a { color: #1B4F8A; font-weight: 600; text-decoration: none; }
.pp-missing { max-width: 460px; margin: 18vh auto 0; text-align: center; padding: 0 16px; }
.pp-missing h1 { font-size: 1.5rem; font-weight: 800; letter-spacing: -.02em; margin: 0 0 8px; }
.pp-missing p { color: #64748B; margin: 0; }
.pp-lb { position: fixed; inset: 0; z-index: 2000; background: rgba(2,6,23,.92); display: grid; place-items: center; padding: 24px; }
.pp-lb img { max-width: min(1100px, 100%); max-height: 82vh; border-radius: 12px; object-fit: contain; }
.pp-lb-nav { position: absolute; bottom: 24px; left: 50%; transform: translateX(-50%); display: flex; align-items: center; gap: 14px; color: #fff; font-size: .875rem; }
.pp-lb-nav button, .pp-lb-x { width: 40px; height: 40px; border-radius: 50%; border: none; background: rgba(255,255,255,.14); color: #fff; font-size: 1.5rem; line-height: 1; cursor: pointer; }
.pp-lb-x { position: absolute; top: 16px; right: 16px; }
@media (max-width: 700px) {
  .pp-in { padding-left: 16px; padding-right: 16px; }
  .pp-hero { padding: 20px 0 24px; }
  .pp-h1 { font-size: 1.625rem; }
  .pp-stats div { flex: 1 1 0; min-width: 0; padding: 9px 12px; }
  .pp-stats div:nth-child(3) { flex-basis: 100%; }
  .pp-stats strong { font-size: 1.0625rem; }
  .pp-map { height: 260px; }
  .pp-cards { grid-template-columns: 1fr; }
}
@media print {
  .pp-print, .pp-map, .pp-lb { display: none !important; }
  .pp-hero { background: #0F172A !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .pp-cards { grid-template-columns: 1fr 1fr; }
  .pp-card { break-inside: avoid; }
}
`;
