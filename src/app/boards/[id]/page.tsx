'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { attachVisibleRates } from '@/lib/board-rates';
import RequestLocation, { OPEN_REQUEST_EVENT } from '@/components/boards/RequestLocation';
import { computeTrustBadge, TrustBadgePill, type TrustBadge } from '@/lib/agent-listings';
import { VerificationBadge, VERIFICATION_META, verificationOf, formatVerifiedDate, dimensionsText, UNKNOWN } from '@/lib/board-verification';
import { boardIdFromParam, boardPath, citySlug } from '@/lib/public-links';
import { displayName } from '@/lib/display-name';
import WhatsAppButton from '@/components/WhatsAppButton';
import Board3DMap from '@/components/map/Board3DMapLoader';
import type { NearbyBoard } from '@/components/map/Board3DMap';

type Board = {
  id: string;
  name: string;
  format: string;
  address: string;
  city: string;
  state: string;
  width: number | null;
  height: number | null;
  face_count: number | null;
  illuminated: boolean | null;
  asking_rate: number | null;
  latitude: number | null;
  longitude: number | null;
  status: string;
  notes: string | null;
  photo_urls: string[] | null;
  area: string | null;
  verification_status: string | null;
  last_verified_at: string | null;
  facing_deg?: number | null;
};

type ActiveListing = { sell_price: number; badge: TrustBadge } | null;

const FORMAT_LABELS: Record<string, string> = {
  billboard: 'Billboard', unipole: 'Unipole', gantry: 'Gantry',
  bridge_panel: 'Bridge panel', wall_drape: 'Wall drape', digital: 'LED / digital', led: 'LED screen',
};

function formatNaira(n: number) {
  if (n >= 1_000_000) return '₦' + (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1_000) return '₦' + (n / 1_000).toFixed(0) + 'K';
  return '₦' + n.toLocaleString('en-NG');
}

const Icon = ({ d, size = 16, color = 'currentColor' }: { d: string; size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {d.split(' M').map((p, i) => <path key={i} d={(i ? 'M' : '') + p} />)}
  </svg>
);
const PIN = 'M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z M12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6';
const SHARE = 'M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8 M16 6l-4-4-4 4 M12 2v13';
const CHECK = 'M20 6L9 17l-5-5';

export default function PublicBoardPage() {
  // Accepts "/boards/<id>" and the readable "/boards/<name>-<city>-<id>".
  const id = boardIdFromParam(useParams().id);
  const [board, setBoard] = useState<Board | null>(null);
  const [activeListing, setActiveListing] = useState<ActiveListing>(null);
  const [nearby, setNearby] = useState<NearbyBoard[]>([]);
  const [loading, setLoading] = useState(true);
  const [photoIdx, setPhotoIdx] = useState(0);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!id) return; // no id: the page shows "Board not found"
    Promise.all([
      supabase.from('boards').select('*').eq('id', id).single(),
      supabase.from('listings').select('sell_price, agent_id, board_authorizations(owner_verified)').eq('board_id', id).eq('status', 'active').maybeSingle(),
    ]).then(async ([{ data }, { data: listing }]) => {
      const b = data ? (await attachVisibleRates([data as Board]))[0] : null;
      setBoard(b);
      // Show the readable link in the address bar, so shared links read well.
      if (b) {
        const readable = boardPath(b);
        if (window.location.pathname !== readable) window.history.replaceState(window.history.state, '', readable + window.location.search + window.location.hash);
      }
      if (listing) {
        const badge = computeTrustBadge({ agent_id: listing.agent_id }, listing.board_authorizations as never);
        setActiveListing({ sell_price: listing.sell_price, badge });
      }
      setLoading(false);
      // Other boards within about 3 km, for the map.
      if (b?.latitude != null && b.longitude != null) {
        const d = 0.03;
        const { data: near } = await supabase.from('boards').select('id, name, city, latitude, longitude')
          .eq('status', 'available').neq('id', b.id)
          .gte('latitude', b.latitude - d).lte('latitude', b.latitude + d)
          .gte('longitude', b.longitude - d).lte('longitude', b.longitude + d).limit(25);
        setNearby((near ?? []).filter(n => n.latitude != null && n.longitude != null).map(n => ({
          id: n.id, name: displayName(n.name), lat: n.latitude as number, lng: n.longitude as number, href: boardPath(n),
        })));
      }
    });
  }, [id]);

  const effectiveRate = activeListing ? activeListing.sell_price : (board?.asking_rate ?? 0);
  const openRequest = () => window.dispatchEvent(new Event(OPEN_REQUEST_EVENT));

  function shareBoard() {
    const url = window.location.href;
    if (navigator.share) {
      navigator.share({ title: board ? displayName(board.name) : undefined, url }).catch(() => {});
    } else {
      navigator.clipboard.writeText(url).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2500);
      });
    }
  }

  if (loading && id) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#F8FAFC' }}>
        <div style={{ width: 32, height: 32, border: '2.5px solid #E2E8F0', borderTopColor: '#1B4F8A', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (!board) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, background: '#F8FAFC', fontFamily: "'Inter', sans-serif" }}>
        <p style={{ fontSize: '1rem', color: '#64748B', fontWeight: 500 }}>Board not found</p>
        <Link href="/marketplace" style={{ fontSize: '0.875rem', color: '#1B4F8A', fontWeight: 600, textDecoration: 'none' }}>← Browse all boards</Link>
      </div>
    );
  }

  const name = displayName(board.name);
  const photos = (board.photo_urls || []).filter(Boolean);
  const hasPin = board.latitude != null && board.longitude != null;
  const mapsUrl = hasPin
    ? `https://www.google.com/maps/dir/?api=1&destination=${board.latitude},${board.longitude}`
    : `https://www.google.com/maps/search/${encodeURIComponent(`${board.address}, ${board.city}`)}`;
  const isBooked = board.status === 'booked';
  const format = FORMAT_LABELS[board.format] || board.format || 'Billboard';
  const place = [board.area, board.city, board.state && board.state !== board.city ? board.state : null].filter(Boolean).join(', ');
  const address = board.address && displayName(board.address) !== name ? displayName(board.address) : null;
  const verified = verificationOf(board);
  const verifiedOn = formatVerifiedDate(board.last_verified_at);

  // Only facts we know; unknowns are left out instead of "Information unavailable".
  const dims = dimensionsText(board.width, board.height);
  const facts = [
    { label: 'Format', value: format },
    dims !== UNKNOWN && { label: 'Size', value: dims },
    board.face_count ? { label: 'Faces', value: String(board.face_count) } : null,
    board.illuminated != null && { label: 'Lighting', value: board.illuminated ? 'Lit at night' : 'Not lit' },
    board.area && { label: 'Area', value: board.area },
    board.city && { label: 'City', value: board.city },
    board.state && board.state !== board.city && { label: 'State', value: board.state === 'FCT' ? 'Abuja (FCT)' : board.state },
    { label: 'Verification', value: verifiedOn ? `${VERIFICATION_META[verified].label} · ${verifiedOn}` : VERIFICATION_META[verified].label },
  ].filter(Boolean) as { label: string; value: string }[];

  const priceBlock = (
    <div>
      <p className="bp-eyebrow">{effectiveRate ? 'Asking rate' : 'Price'}</p>
      <p style={{ margin: '2px 0 0', fontSize: effectiveRate ? '1.75rem' : '1.25rem', fontWeight: 800, color: '#0F172A', letterSpacing: '-0.02em', lineHeight: 1.15 }}>
        {effectiveRate ? <>{formatNaira(effectiveRate)}<span style={{ fontSize: '0.9375rem', fontWeight: 500, color: '#64748B' }}> / month</span></> : 'On request'}
      </p>
      {!effectiveRate && <p style={{ margin: '4px 0 0', fontSize: '0.8125rem', color: '#64748B' }}>Set by the board&apos;s owner. Request it to get a quote.</p>}
    </div>
  );

  return (
    <>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        *, *::before, *::after { box-sizing: border-box; }
        body { background: #F8FAFC; margin: 0; }
        .bp { font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; color: #0F172A; min-height: 100vh; background: #F8FAFC; }
        .bp-wrap { max-width: 1180px; margin: 0 auto; padding: 20px 24px 64px; }
        .bp-grid { display: grid; grid-template-columns: minmax(0, 1.65fr) minmax(320px, 1fr); gap: 28px; align-items: start; }
        .bp-side { position: sticky; top: 84px; display: flex; flex-direction: column; gap: 14px; }
        .bp-card { background: #fff; border: 1px solid #E2E8F0; border-radius: 16px; padding: 20px; }
        .bp-eyebrow { margin: 0; font-size: 0.75rem; font-weight: 700; color: #64748B; text-transform: uppercase; letter-spacing: 0.06em; }
        .bp-h2 { margin: 0 0 12px; font-size: 1.125rem; font-weight: 700; letter-spacing: -0.01em; }
        .bp-btn { transition: background .15s, transform .1s, box-shadow .15s; }
        .bp-btn:active { transform: scale(0.98); }
        .bp-primary { display: block; width: 100%; text-align: center; background: #1B4F8A; color: #fff; border: none; border-radius: 12px; padding: 14px; font-size: 0.9375rem; font-weight: 700; cursor: pointer; font-family: inherit; box-shadow: 0 6px 18px -6px rgba(27,79,138,.55); }
        .bp-primary:hover { background: #163F6F; }
        .bp-ghost { display: inline-flex; align-items: center; gap: 7px; background: #fff; color: #1B4F8A; border: 1px solid #CBD5E1; border-radius: 10px; padding: 9px 13px; font-size: 0.8125rem; font-weight: 600; cursor: pointer; font-family: inherit; text-decoration: none; }
        .bp-ghost:hover { border-color: #1B4F8A; }
        .bp-thumb { flex-shrink: 0; width: 84px; height: 58px; border-radius: 9px; overflow: hidden; padding: 0; cursor: pointer; background: #E2E8F0; }
        .bp-facts { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; }
        .bp-fact { background: #F8FAFC; border: 1px solid #EEF2F7; border-radius: 12px; padding: 11px 13px; }
        .bp-mobilebar { display: none; }
        .bp-mobile-only { display: none; }
        @media (max-width: 900px) {
          .bp-wrap { padding: 0 0 110px; }
          .bp-grid { grid-template-columns: 1fr; gap: 0; }
          .bp-side { position: static; padding: 0 16px; margin-top: -8px; }
          .bp-main > * { margin-left: 16px; margin-right: 16px; }
          .bp-main > .bp-gallery { margin: 0; }
          .bp-gallery-main { border-radius: 0 !important; aspect-ratio: 4 / 3 !important; }
          .bp-thumbs { padding: 0 16px; }
          .bp-desktop-only { display: none !important; }
          .bp-mobile-only { display: block; }
          .bp-mobilebar { display: flex; position: fixed; left: 0; right: 0; bottom: 0; z-index: 800; align-items: center; gap: 12px;
            padding: 10px 16px calc(10px + env(safe-area-inset-bottom)); background: rgba(255,255,255,.97); backdrop-filter: blur(10px); border-top: 1px solid #E2E8F0; box-shadow: 0 -8px 24px -12px rgba(15,23,42,.25); }
          .bp-head-cta { display: none !important; }
          .bp-crumbs { display: none !important; }
        }
      `}</style>

      <div className="bp">
        {/* ── Header ── */}
        <header style={{ position: 'sticky', top: 0, zIndex: 700, background: 'rgba(255,255,255,0.96)', backdropFilter: 'blur(12px)', borderBottom: '1px solid #E2E8F0' }}>
          <div style={{ maxWidth: 1180, margin: '0 auto', padding: '11px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <Link href="/" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 9 }}>
              <span style={{ width: 30, height: 30, background: '#1B4F8A', borderRadius: 8, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round"><rect x="3" y="3" width="18" height="5" rx="1.5" /><line x1="6" y1="8" x2="6" y2="21" /><line x1="18" y1="8" x2="18" y2="21" /></svg>
              </span>
              <span style={{ fontSize: '0.9375rem', fontWeight: 800, color: '#0F172A', letterSpacing: '-0.02em' }}>OOH Platform</span>
            </Link>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Link href="/marketplace" className="bp-ghost" style={{ border: 'none', padding: '8px 6px' }}>All boards</Link>
              <button type="button" onClick={openRequest} className="bp-btn bp-head-cta" style={{ background: '#1B4F8A', color: '#fff', borderRadius: 10, border: 'none', cursor: 'pointer', fontFamily: 'inherit', padding: '9px 16px', fontSize: '0.8125rem', fontWeight: 700 }}>
                {isBooked ? 'Request future dates' : 'Request this location'}
              </button>
            </div>
          </div>
        </header>

        <div className="bp-wrap">
          {/* Breadcrumb */}
          <nav aria-label="Breadcrumb" className="bp-crumbs" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: '0.8125rem', color: '#64748B', margin: '0 0 14px' }}>
            <Link href="/marketplace" style={{ color: '#64748B', textDecoration: 'none' }}>Boards</Link>
            {board.city && <><span>/</span><Link href={`/billboards/${citySlug(board.city)}`} style={{ color: '#64748B', textDecoration: 'none' }}>{board.city}</Link></>}
            <span>/</span><span style={{ color: '#0F172A', fontWeight: 500 }}>{name.length > 60 ? name.slice(0, 58) + '…' : name}</span>
          </nav>

          <div className="bp-grid">
            {/* ── Main column ── */}
            <main className="bp-main" style={{ display: 'flex', flexDirection: 'column', gap: 22, minWidth: 0 }}>
              {/* Gallery */}
              <section className="bp-gallery" aria-label="Photos">
                <div className="bp-gallery-main" style={{ position: 'relative', background: '#0F172A', borderRadius: 18, overflow: 'hidden', aspectRatio: '16 / 10' }}>
                  {photos.length > 0 ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={photos[photoIdx]} alt={`${name}, photo ${photoIdx + 1}`} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                  ) : (
                    <div style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center', color: 'rgba(255,255,255,.45)', fontSize: '0.875rem' }}>No photos yet</div>
                  )}
                  {photos.length > 1 && (
                    <>
                      <button type="button" aria-label="Previous photo" onClick={() => setPhotoIdx(p => (p - 1 + photos.length) % photos.length)}
                        style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', width: 40, height: 40, borderRadius: '50%', background: 'rgba(255,255,255,0.92)', border: 'none', cursor: 'pointer', fontSize: 20, color: '#0F172A' }}>‹</button>
                      <button type="button" aria-label="Next photo" onClick={() => setPhotoIdx(p => (p + 1) % photos.length)}
                        style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', width: 40, height: 40, borderRadius: '50%', background: 'rgba(255,255,255,0.92)', border: 'none', cursor: 'pointer', fontSize: 20, color: '#0F172A' }}>›</button>
                      <span style={{ position: 'absolute', bottom: 12, right: 12, background: 'rgba(15,23,42,0.7)', color: '#fff', borderRadius: 999, padding: '4px 10px', fontSize: '0.75rem', fontWeight: 600 }}>{photoIdx + 1} / {photos.length}</span>
                    </>
                  )}
                  {isBooked && <span style={{ position: 'absolute', top: 12, left: 12, background: '#DC2626', color: '#fff', borderRadius: 8, padding: '5px 11px', fontSize: '0.75rem', fontWeight: 700 }}>Booked now</span>}
                </div>
                {photos.length > 1 && (
                  <div className="bp-thumbs" style={{ display: 'flex', gap: 8, marginTop: 10, overflowX: 'auto' }}>
                    {photos.map((p, i) => (
                      <button key={p + i} type="button" className="bp-thumb" onClick={() => setPhotoIdx(i)} aria-label={`Photo ${i + 1}`}
                        style={{ border: i === photoIdx ? '2.5px solid #1B4F8A' : '2.5px solid transparent' }}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={p} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                      </button>
                    ))}
                  </div>
                )}
              </section>

              {/* Title on phones (on desktop it sits in the side card) */}
              <div className="bp-mobile-only">
                <TitleBlock heading={false} name={name} format={format} place={place} address={address} board={board} activeListing={activeListing} />
              </div>

              {/* Location */}
              <section aria-labelledby="bp-location">
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
                  <h2 id="bp-location" className="bp-h2" style={{ margin: 0 }}>Where it is</h2>
                  <a href={mapsUrl} target="_blank" rel="noopener noreferrer" className="bp-ghost"><Icon d={PIN} size={14} /> Directions</a>
                </div>
                {hasPin ? (
                  <Board3DMap lat={board.latitude as number} lng={board.longitude as number} format={board.format}
                    width={board.width} height={board.height} name={name} facing={board.facing_deg} nearby={nearby} />
                ) : (
                  <div className="bp-card" style={{ color: '#64748B', fontSize: '0.875rem' }}>The exact map location hasn&apos;t been added yet. {address ? `Address: ${address}.` : ''}</div>
                )}
                {hasPin && <p style={{ margin: '8px 2px 0', fontSize: '0.75rem', color: '#94A3B8' }}>3D model is drawn to the listed size. Drag to look around; use two fingers on a phone.</p>}
              </section>

              {/* Details */}
              <section aria-labelledby="bp-details">
                <h2 id="bp-details" className="bp-h2">About this board</h2>
                <div className="bp-facts">
                  {facts.map(f => (
                    <div key={f.label} className="bp-fact">
                      <p style={{ margin: 0, fontSize: '0.75rem', color: '#64748B', fontWeight: 500 }}>{f.label}</p>
                      <p style={{ margin: '3px 0 0', fontSize: '0.9375rem', fontWeight: 600 }}>{f.value}</p>
                    </div>
                  ))}
                </div>
                {board.notes && <p style={{ margin: '14px 0 0', fontSize: '0.9375rem', color: '#334155', lineHeight: 1.7 }}>{board.notes}</p>}
              </section>

              {/* How booking works */}
              <section className="bp-card" aria-labelledby="bp-how">
                <h2 id="bp-how" className="bp-h2">How booking works</h2>
                <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 12 }}>
                  {[
                    ['Request it', 'Send your campaign dates. It takes a minute.'],
                    ['Get a quote', 'The media owner replies with availability and a price. You can make an offer.'],
                    ['We complete the booking', 'Once you agree, our team contacts you and the owner to finish it.'],
                  ].map(([t, d], i) => (
                    <li key={t} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                      <span style={{ flexShrink: 0, width: 26, height: 26, borderRadius: '50%', background: '#EFF6FF', color: '#1B4F8A', fontWeight: 700, fontSize: '0.8125rem', display: 'grid', placeItems: 'center' }}>{i + 1}</span>
                      <span><b style={{ fontSize: '0.9375rem' }}>{t}</b><br /><span style={{ fontSize: '0.875rem', color: '#64748B' }}>{d}</span></span>
                    </li>
                  ))}
                </ol>
              </section>

              {board.city && (
                <Link href={`/billboards/${citySlug(board.city)}`} data-city-link style={{ alignSelf: 'flex-start', fontSize: '0.875rem', fontWeight: 600, color: '#1B4F8A', textDecoration: 'none' }}>
                  More billboards in {board.city} →
                </Link>
              )}
            </main>

            {/* ── Side: title, price, request ── */}
            <aside className="bp-side" aria-label="Request this board">
              <div className="bp-card bp-desktop-only">
                <TitleBlock name={name} format={format} place={place} address={address} board={board} activeListing={activeListing} />
              </div>
              <div className="bp-card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {priceBlock}
                <RequestLocation board={{ id: board.id, name, status: board.status }} compact />
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button type="button" onClick={shareBoard} className="bp-ghost">
                    <Icon d={copied ? CHECK : SHARE} size={14} /> {copied ? 'Link copied' : 'Share'}
                  </button>
                  <a href={mapsUrl} target="_blank" rel="noopener noreferrer" className="bp-ghost"><Icon d={PIN} size={14} /> Directions</a>
                </div>
              </div>
              <p style={{ margin: 0, fontSize: '0.75rem', color: '#94A3B8', textAlign: 'center' }}>Listed by its media owner on OOH Platform</p>
            </aside>
          </div>
        </div>

        {/* Phone: request bar always in reach */}
        <div className="bp-mobilebar">
          <div style={{ minWidth: 0, flex: 1 }}>
            <p style={{ margin: 0, fontSize: '0.75rem', color: '#64748B' }}>{effectiveRate ? 'Asking rate' : 'Price'}</p>
            <p style={{ margin: 0, fontSize: '1rem', fontWeight: 800 }}>{effectiveRate ? `${formatNaira(effectiveRate)}/mo` : 'On request'}</p>
          </div>
          <button type="button" onClick={openRequest} className="bp-primary bp-btn" style={{ width: 'auto', padding: '13px 20px' }}>
            {isBooked ? 'Request dates' : 'Request this location'}
          </button>
        </div>
      </div>
      <WhatsAppButton bottom={20} mobileBottom={92}
        message={`Hi, I'm interested in this board on OOH Platform: "${name}"${board.city ? ` (${board.city})` : ''}. ${typeof window !== 'undefined' ? window.location.origin + boardPath(board) : ''}`} />
    </>
  );
}

function TitleBlock({ name, format, place, address, board, activeListing, heading = true }: {
  name: string; format: string; place: string; address: string | null; board: Board; activeListing: ActiveListing; heading?: boolean;
}) {
  // One real <h1> per page (the desktop card); the phone copy is a plain paragraph.
  const H = heading ? 'h1' : 'p';
  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
        <span style={{ background: '#EFF6FF', color: '#1D4ED8', borderRadius: 999, padding: '4px 11px', fontSize: '0.75rem', fontWeight: 700 }}>{format}</span>
        {board.illuminated && <span style={{ background: '#FFFBEB', color: '#92400E', borderRadius: 999, padding: '4px 11px', fontSize: '0.75rem', fontWeight: 700 }}>Lit at night</span>}
        {!!board.face_count && board.face_count > 1 && <span style={{ background: '#F5F3FF', color: '#5B21B6', borderRadius: 999, padding: '4px 11px', fontSize: '0.75rem', fontWeight: 700 }}>{board.face_count} faces</span>}
      </div>
      <H data-board-title style={{ margin: 0, color: '#0F172A', fontSize: '1.5rem', fontWeight: 800, lineHeight: 1.25, letterSpacing: '-0.02em' }}>{name}</H>
      {(place || address) && (
        <p style={{ margin: '8px 0 0', display: 'flex', gap: 6, alignItems: 'flex-start', fontSize: '0.875rem', color: '#475569', lineHeight: 1.5 }}>
          <span style={{ marginTop: 2, flexShrink: 0 }}><Icon d={PIN} size={14} color="#94A3B8" /></span>
          <span>{[address, place].filter(Boolean).join(' · ')}</span>
        </p>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 12 }}>
        <VerificationBadge status={board.verification_status} small />
        {activeListing && <TrustBadgePill badge={activeListing.badge} small />}
      </div>
    </div>
  );
}
