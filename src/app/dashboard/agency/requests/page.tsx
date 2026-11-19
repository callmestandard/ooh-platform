'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useDashboardRole } from '@/components/layout/DashboardLayout';
import { boardFormatLabel } from '@/lib/board-formats';
import {
  listMyBoardRequests, cancelBoardRequest, answerBoardQuote, CANCELLABLE_STAGES, ANSWERABLE_STAGES,
  type BoardRequest, type RequestStage,
} from '@/lib/availability-requests';
import { Journey, StageTag, BUYER_NEXT, toneOf, naira, fmtDate, fmtShort, spanText, ago } from '@/components/requests/journey';

type Filter = 'active' | 'closed' | 'all';
const DONE: RequestStage[] = ['confirmed', 'cancelled', 'unavailable'];
const DEAL_STAGES: RequestStage[] = ['negotiating', 'accepted', 'booking_in_progress', 'confirmed'];
const YOUR_MOVE: RequestStage[] = ['quote_received', 'negotiating'];

/** Requests that need the buyer first, then the rest newest first. */
const order = (r: BoardRequest) => (YOUR_MOVE.includes(r.stage) ? 0 : DONE.includes(r.stage) ? 2 : 1);

export default function MyRequestsPage() {
  const role = useDashboardRole();
  const router = useRouter();
  const [confirming, setConfirming] = useState<string | null>(null);
  const [requests, setRequests] = useState<BoardRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('active');
  const [busy, setBusy] = useState<string | null>(null);

  async function refresh() {
    const { requests, error } = await listMyBoardRequests();
    setRequests(requests);
    setError(error);
    setLoading(false);
  }

  useEffect(() => {
    if (role !== 'agency') return;
    (async () => { await refresh(); })();
  }, [role]);

  async function cancel(r: BoardRequest) {
    setBusy(r.id);
    const { error } = await cancelBoardRequest(r.id);
    setBusy(null);
    if (error) { setError('Could not cancel: ' + error); return; }
    await refresh();
  }

  async function answer(r: BoardRequest, accept: boolean) {
    setBusy(r.id);
    setError(null);
    const { bookingId, error } = await answerBoardQuote(r.id, accept);
    setBusy(null);
    setConfirming(null);
    if (error || !bookingId) { setError((accept ? 'Could not accept: ' : 'Could not open the conversation: ') + (error ?? 'please try again')); return; }
    if (accept) { await refresh(); return; }
    router.push(`/dashboard/agency/negotiations/${bookingId}`);
  }

  if (role !== 'agency') {
    return <div style={{ padding: 32, color: '#64748B', fontSize: '0.875rem' }}>Requests are sent from buyer accounts.</div>;
  }

  const active = requests.filter(r => !DONE.includes(r.stage));
  const closed = requests.filter(r => DONE.includes(r.stage));
  const yourMove = requests.filter(r => YOUR_MOVE.includes(r.stage)).length;
  const waiting = active.length - yourMove;
  const shown = (filter === 'active' ? active : filter === 'closed' ? closed : requests)
    .map((r, i) => ({ r, i })).sort((a, b) => order(a.r) - order(b.r) || a.i - b.i).map(x => x.r);

  return (
    <div className="mr">
      <header className="mr-head">
        <div>
          <h1>My requests</h1>
          <p className="mr-sub">
            {loading ? 'Loading your requests…'
              : requests.length === 0 ? 'Boards you’ve asked about will show here.'
              : <>
                  {yourMove > 0 && <span className="mr-badge"><i />{yourMove} need{yourMove === 1 ? 's' : ''} you</span>}
                  {waiting > 0 && <span>{waiting} waiting on the owner</span>}
                  {yourMove === 0 && waiting === 0 && <span>Nothing open right now</span>}
                </>}
          </p>
        </div>
        <a href="/marketplace" className="mr-new">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
          Find a board
        </a>
      </header>

      {requests.length > 0 && (
        <div className="mr-tabs" role="tablist">
          {([['active', 'Open', active.length], ['closed', 'Closed', closed.length], ['all', 'All', requests.length]] as const).map(([k, text, n]) => (
            <button key={k} role="tab" aria-selected={filter === k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>
              {text}<span>{n}</span>
            </button>
          ))}
        </div>
      )}

      {error && <div className="mr-err" role="alert">{error}</div>}

      {loading ? (
        <div className="mr-list">{[0, 1].map(i => <div key={i} className="mr-card mr-skel"><div /><div /></div>)}</div>
      ) : shown.length === 0 ? (
        <div className="mr-empty">
          <div className="mr-empty-ico">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>
          </div>
          <h2>{requests.length === 0 ? 'No requests yet' : filter === 'closed' ? 'Nothing closed yet' : 'No open requests'}</h2>
          <p>Find a board you like and press <b>Request this location</b>. The owner replies with a price for your dates.</p>
          <div className="mr-empty-j"><Journey active={0} /></div>
          <a href="/marketplace" className="mr-btn mr-primary">Browse boards</a>
        </div>
      ) : (
        <div className="mr-list">
          {shown.map(r => {
            const resp = r.responses?.[0];
            const photo = r.board?.photo_urls?.[0];
            const ownerReached = (r.recipients?.length ?? 0) > 0;
            const canAnswer = ANSWERABLE_STAGES.includes(r.stage) && !!resp?.available;
            const dealId = DEAL_STAGES.includes(r.stage) ? resp?.accepted_booking_id ?? null : null;
            const next = BUYER_NEXT[r.stage];
            const tone = toneOf(r.stage);
            const isDone = DONE.includes(r.stage);
            const place = [r.board?.area, r.board?.city].filter(Boolean).join(', ');
            const href = r.board_id ? `/boards/${r.board_id}` : '#';
            return (
              <article key={r.id} data-request={r.id} className={`mr-card${YOUR_MOVE.includes(r.stage) ? ' mr-hot' : ''}${isDone ? ' mr-done' : ''}`}>
                <div className="mr-top">
                  <a href={href} className="mr-ph" aria-hidden tabIndex={-1}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {photo && <img src={photo} alt="" loading="lazy" />}
                  </a>
                  <div className="mr-id">
                    <div className="mr-line1">
                      <a href={href} className="mr-name">{r.board?.name ?? r.title}</a>
                      <StageTag stage={r.stage} />
                    </div>
                    <p className="mr-meta">{place}{r.board?.format ? ` · ${boardFormatLabel(r.board.format)}` : ''}</p>
                    <p className="mr-dates">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><rect x="3" y="4.5" width="18" height="16" rx="2.5"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/></svg>
                      {fmtShort(r.start_date)} – {fmtDate(r.end_date)} <span>· {spanText(r.start_date, r.end_date)}</span>
                    </p>
                  </div>
                </div>

                {!isDone && <div className="mr-journey"><Journey stage={r.stage} /></div>}

                <div className="mr-next" data-stage-help style={{ background: tone.bg === '#047857' ? '#ECFDF5' : tone.bg }}>
                  <p className="mr-next-t" style={{ color: tone.bg === '#047857' ? '#047857' : tone.fg }}>{next.title}</p>
                  <p className="mr-next-d">
                    {next.detail}
                    {r.stage === 'requested' && !ownerReached && ' Our team is contacting the owner for you.'}
                  </p>

                  {resp && (
                    <div className="mr-reply" data-owner-reply>
                      <div className="mr-reply-h">
                        <span>Owner&rsquo;s reply</span>
                        <small>{ago(resp.updated_at)}</small>
                      </div>
                      {resp.available && resp.quoted_rate ? (
                        <p className="mr-price"><b>{naira(resp.quoted_rate)}</b> per month</p>
                      ) : (
                        <p className="mr-reply-s">{resp.available ? 'Available for your dates' : 'Not available for your dates'}</p>
                      )}
                      {resp.available && (resp.available_from || resp.available_to) && (
                        <p className="mr-reply-x">Can offer {resp.available_from ? fmtDate(resp.available_from) : 'now'} – {resp.available_to ? fmtDate(resp.available_to) : 'open-ended'}</p>
                      )}
                      {resp.available && resp.conditions && <p className="mr-reply-x"><b>Conditions:</b> {resp.conditions}</p>}
                      {resp.note && <p className="mr-quote">&ldquo;{resp.note}&rdquo;</p>}
                    </div>
                  )}

                  {canAnswer && (
                    <div className="mr-actions" data-answer>
                      {confirming === r.id && resp?.quoted_rate ? (
                        <div className="mr-confirm">
                          <p>Accept <b>{naira(resp.quoted_rate)} per month</b> for {fmtShort(r.start_date)} – {fmtDate(r.end_date)}? Our team then contacts you to complete the booking.</p>
                          <div>
                            <button onClick={() => answer(r, true)} disabled={busy === r.id} className="mr-btn mr-primary">{busy === r.id ? 'Accepting…' : 'Yes, accept'}</button>
                            <button onClick={() => setConfirming(null)} disabled={busy === r.id} className="mr-btn">Back</button>
                          </div>
                        </div>
                      ) : (
                        <>
                          {resp?.quoted_rate ? <button onClick={() => setConfirming(r.id)} disabled={busy === r.id} className="mr-btn mr-primary">Accept price</button> : null}
                          <button onClick={() => answer(r, false)} disabled={busy === r.id} className={`mr-btn${resp?.quoted_rate ? '' : ' mr-primary'}`}>
                            {busy === r.id ? 'Opening…' : resp?.quoted_rate ? 'Negotiate' : 'Ask the owner for a price'}
                          </button>
                        </>
                      )}
                    </div>
                  )}
                  {dealId && (
                    <div className="mr-actions">
                      <a href={`/dashboard/agency/negotiations/${dealId}`} className={`mr-btn${r.stage === 'negotiating' ? ' mr-primary' : ''}`}>
                        {r.stage === 'negotiating' ? 'Continue the conversation →' : 'View the conversation'}
                      </a>
                    </div>
                  )}
                  {r.stage === 'unavailable' && (
                    <div className="mr-actions"><a href="/marketplace" className="mr-btn">Find a board nearby</a></div>
                  )}
                </div>

                <footer className="mr-foot">
                  <span>Sent {fmtDate(r.created_at)}{r.budget ? ` · budget ${naira(r.budget)}` : ''}{r.sites_needed ? ` · ${r.sites_needed} board${r.sites_needed > 1 ? 's' : ''}` : ''}</span>
                  {CANCELLABLE_STAGES.includes(r.stage) && r.stage !== 'unavailable' && confirming !== r.id && (
                    <button onClick={() => cancel(r)} disabled={busy === r.id} className="mr-cancel">
                      {busy === r.id ? 'Working…' : r.stage === 'negotiating' ? 'Withdraw' : 'Cancel request'}
                    </button>
                  )}
                </footer>
              </article>
            );
          })}
        </div>
      )}

      <style>{`
        .mr { max-width: 860px; margin: 0 auto; padding: 8px 0 56px; font-family: 'Inter', -apple-system, sans-serif; }
        .mr-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-bottom: 20px; }
        .mr-head h1 { margin: 0; font-size: 1.625rem; font-weight: 800; color: #0F172A; letter-spacing: -0.025em; }
        .mr-sub { margin: 6px 0 0; display: flex; align-items: center; gap: 12px; flex-wrap: wrap; font-size: 0.875rem; color: #64748B; }
        .mr-badge { display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px 3px 8px; border-radius: 999px; background: #EFF6FF; color: #1B4F8A; font-weight: 700; font-size: 0.8125rem; }
        .mr-badge i { width: 7px; height: 7px; border-radius: 50%; background: #1B4F8A; animation: mrPulse 1.8s infinite; }
        @keyframes mrPulse { 0%,100% { box-shadow: 0 0 0 0 rgba(27,79,138,.45); } 60% { box-shadow: 0 0 0 6px rgba(27,79,138,0); } }
        .mr-new { display: inline-flex; align-items: center; gap: 7px; padding: 10px 16px; border-radius: 10px; background: #0F172A; color: #fff; font-size: 0.8125rem; font-weight: 700; text-decoration: none; transition: background .15s; }
        .mr-new:hover { background: #1E293B; }
        .mr-tabs { display: inline-flex; gap: 2px; padding: 3px; border-radius: 11px; background: #F1F5F9; margin-bottom: 16px; }
        .mr-tabs button { display: inline-flex; align-items: center; gap: 7px; padding: 7px 14px; border: none; border-radius: 8px; background: none; color: #64748B; font: 600 0.8125rem/1 inherit; font-family: inherit; cursor: pointer; transition: all .15s; }
        .mr-tabs button span { font-size: 0.6875rem; padding: 2px 6px; border-radius: 6px; background: rgba(15,23,42,.06); }
        .mr-tabs button.on { background: #fff; color: #0F172A; box-shadow: 0 1px 3px rgba(15,23,42,.1); }
        .mr-err { padding: 12px 14px; border-radius: 12px; background: #FEF2F2; border: 1px solid #FECACA; color: #B91C1C; font-size: 0.8125rem; margin-bottom: 14px; }
        .mr-list { display: flex; flex-direction: column; gap: 14px; }
        .mr-card { background: #fff; border: 1px solid #E8EDF3; border-radius: 18px; padding: 18px; box-shadow: 0 1px 2px rgba(15,23,42,.04); transition: box-shadow .2s, border-color .2s; }
        .mr-card:hover { box-shadow: 0 8px 28px -12px rgba(15,23,42,.18); }
        .mr-hot { border-color: #BFDBFE; box-shadow: 0 0 0 3px rgba(27,79,138,.06); }
        .mr-done { background: #FCFDFE; }
        .mr-done .mr-ph { filter: saturate(.4); opacity: .8; }
        .mr-top { display: flex; gap: 14px; align-items: flex-start; }
        .mr-ph { width: 92px; height: 70px; border-radius: 12px; overflow: hidden; background: linear-gradient(135deg, #E2E8F0, #CBD5E1); flex-shrink: 0; display: block; }
        .mr-ph img { width: 100%; height: 100%; object-fit: cover; display: block; transition: transform .3s; }
        .mr-ph:hover img { transform: scale(1.05); }
        .mr-id { flex: 1; min-width: 0; }
        .mr-line1 { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
        .mr-name { font-size: 1rem; font-weight: 700; color: #0F172A; text-decoration: none; line-height: 1.3; letter-spacing: -0.01em; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
        .mr-name:hover { color: #1B4F8A; }
        .mr-meta { margin: 3px 0 0; font-size: 0.8125rem; color: #64748B; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .mr-dates { display: inline-flex; align-items: center; gap: 6px; margin: 8px 0 0; font-size: 0.75rem; font-weight: 600; color: #334155; }
        .mr-dates svg { color: #94A3B8; }
        .mr-dates span { color: #94A3B8; font-weight: 500; }
        .mr-journey { margin: 18px 4px 4px; }
        .mr-next { margin-top: 14px; padding: 14px 16px; border-radius: 14px; }
        .mr-next-t { margin: 0; font-size: 0.9375rem; font-weight: 700; letter-spacing: -0.01em; }
        .mr-next-d { margin: 3px 0 0; font-size: 0.8125rem; color: #475569; line-height: 1.5; }
        .mr-reply { margin-top: 12px; padding: 12px 14px; border-radius: 12px; background: #fff; border: 1px solid rgba(15,23,42,.06); }
        .mr-reply-h { display: flex; justify-content: space-between; align-items: center; }
        .mr-reply-h span { font-size: 0.6875rem; font-weight: 700; color: #64748B; text-transform: uppercase; letter-spacing: .06em; }
        .mr-reply-h small { font-size: 0.6875rem; color: #94A3B8; }
        .mr-price { margin: 4px 0 0; font-size: 0.875rem; color: #475569; }
        .mr-price b { font-size: 1.375rem; font-weight: 800; color: #0F172A; letter-spacing: -0.02em; margin-right: 2px; }
        .mr-reply-s { margin: 4px 0 0; font-size: 0.9375rem; font-weight: 600; color: #0F172A; }
        .mr-reply-x { margin: 4px 0 0; font-size: 0.8125rem; color: #475569; }
        .mr-quote { margin: 8px 0 0; padding-left: 10px; border-left: 2px solid #E2E8F0; font-size: 0.8125rem; color: #334155; font-style: italic; }
        .mr-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px; }
        .mr-confirm { flex-basis: 100%; }
        .mr-confirm p { margin: 0 0 10px; font-size: 0.8125rem; color: #0F172A; line-height: 1.5; }
        .mr-confirm div { display: flex; gap: 8px; flex-wrap: wrap; }
        .mr-btn { display: inline-flex; align-items: center; justify-content: center; padding: 10px 16px; border-radius: 10px; border: 1px solid #CBD5E1; background: #fff; color: #0F172A; font: 700 0.8125rem/1 inherit; font-family: inherit; cursor: pointer; text-decoration: none; white-space: nowrap; transition: all .15s; }
        .mr-btn:hover { border-color: #94A3B8; }
        .mr-btn.mr-primary { background: #1B4F8A; border-color: #1B4F8A; color: #fff; box-shadow: 0 2px 10px rgba(27,79,138,.25); }
        .mr-btn.mr-primary:hover { background: #163F70; }
        .mr-btn:disabled { opacity: .6; cursor: wait; }
        .mr-foot { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; margin-top: 14px; padding-top: 12px; border-top: 1px solid #F1F5F9; font-size: 0.75rem; color: #94A3B8; }
        .mr-cancel { padding: 0; border: none; background: none; color: #64748B; font: 600 0.75rem/1 inherit; font-family: inherit; cursor: pointer; }
        .mr-cancel:hover { color: #B91C1C; }
        .mr-empty { text-align: center; padding: 48px 24px; border-radius: 20px; background: #fff; border: 1px dashed #CBD5E1; }
        .mr-empty-ico { width: 56px; height: 56px; margin: 0 auto 14px; border-radius: 16px; background: #EFF6FF; color: #1B4F8A; display: grid; place-items: center; }
        .mr-empty h2 { margin: 0; font-size: 1.125rem; font-weight: 800; color: #0F172A; }
        .mr-empty p { margin: 6px auto 0; max-width: 380px; font-size: 0.875rem; color: #64748B; line-height: 1.55; }
        .mr-empty-j { max-width: 360px; margin: 24px auto 24px; }
        .mr-skel { height: 170px; display: flex; flex-direction: column; gap: 12px; }
        .mr-skel div { border-radius: 10px; background: linear-gradient(90deg, #F1F5F9, #F8FAFC, #F1F5F9); background-size: 200% 100%; animation: mrSk 1.2s infinite; }
        .mr-skel div:first-child { height: 70px; width: 60%; }
        .mr-skel div:last-child { flex: 1; }
        @keyframes mrSk { to { background-position: -200% 0; } }
        @media (max-width: 600px) {
          .mr-head h1 { font-size: 1.375rem; }
          .mr-card { padding: 14px; border-radius: 16px; }
          .mr-ph { width: 72px; height: 58px; }
          .mr-line1 { flex-direction: column; gap: 6px; }
          .mr-next { padding: 12px 14px; }
          .mr-actions .mr-btn { flex: 1; }
        }
      `}</style>
    </div>
  );
}
