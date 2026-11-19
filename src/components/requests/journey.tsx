'use client';

// One way of showing where an enquiry is, used by the request form, the
// buyer's My Requests and the admin pipeline, so all three read the same.
// Nine database stages fold into four steps people understand at a glance.

import type { RequestStage } from '@/lib/availability-requests';

export const JOURNEY_STEPS = ['Sent', 'Owner’s price', 'Agree', 'Booked'] as const;

/** Which step is in progress (0–3), 4 when booked, or -1 when the request is closed. */
export function journeyActive(stage: RequestStage): number {
  switch (stage) {
    case 'requested':
    case 'owner_responded': return 1;
    case 'quote_received':
    case 'negotiating': return 2;
    case 'accepted':
    case 'booking_in_progress': return 3;
    case 'confirmed': return 4;
    default: return -1; // unavailable, cancelled
  }
}

export type Tone = 'wait' | 'act' | 'good' | 'done' | 'closed';

/** What the buyer should know right now: a headline, one line of detail, and whose move it is. */
export const BUYER_NEXT: Record<RequestStage, { title: string; detail: string; tone: Tone }> = {
  requested:           { title: 'Waiting for the owner’s price', detail: 'We’ve sent your dates to the media owner. We’ll email you as soon as they reply.', tone: 'wait' },
  owner_responded:     { title: 'The owner is preparing a price', detail: 'They’ve seen your dates and will send a price for them.', tone: 'wait' },
  quote_received:      { title: 'Your price is ready', detail: 'Accept it, or talk to the owner about the price or dates.', tone: 'act' },
  negotiating:         { title: 'You’re agreeing the terms', detail: 'Carry on the conversation with the owner until you both agree.', tone: 'act' },
  accepted:            { title: 'Price agreed', detail: 'Our team will contact you to complete the booking. Nothing is booked until the owner confirms.', tone: 'good' },
  booking_in_progress: { title: 'Booking in progress', detail: 'Our team is completing the booking with you and the owner.', tone: 'good' },
  confirmed:           { title: 'Booked', detail: 'Your booking is confirmed.', tone: 'done' },
  unavailable:         { title: 'Not available for your dates', detail: 'The owner can’t offer this board then. Try other dates or a board nearby.', tone: 'closed' },
  cancelled:           { title: 'Closed', detail: 'This request was closed.', tone: 'closed' },
};

/** Short stage names for tags. */
export const STAGE_TAG: Record<RequestStage, string> = {
  requested: 'Waiting for price', owner_responded: 'Waiting for price', quote_received: 'Price ready',
  negotiating: 'Negotiating', accepted: 'Agreed', booking_in_progress: 'Booking', confirmed: 'Booked',
  unavailable: 'Not available', cancelled: 'Closed',
};

const TONE: Record<Tone, { bg: string; fg: string; dot: string }> = {
  wait:   { bg: '#F1F5F9', fg: '#334155', dot: '#94A3B8' },
  act:    { bg: '#EFF6FF', fg: '#1B4F8A', dot: '#1B4F8A' },
  good:   { bg: '#ECFDF5', fg: '#047857', dot: '#10B981' },
  done:   { bg: '#047857', fg: '#FFFFFF', dot: '#FFFFFF' },
  closed: { bg: '#F8FAFC', fg: '#64748B', dot: '#CBD5E1' },
};
export const toneOf = (stage: RequestStage) => TONE[BUYER_NEXT[stage].tone];

export function StageTag({ stage }: { stage: RequestStage }) {
  const t = toneOf(stage);
  return (
    <span data-stage={stage} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 10px 3px 8px', borderRadius: 999, background: t.bg, color: t.fg, fontSize: '0.6875rem', fontWeight: 700, whiteSpace: 'nowrap', lineHeight: 1.5 }}>
      <i style={{ width: 6, height: 6, borderRadius: '50%', background: t.dot, flexShrink: 0 }} />
      {STAGE_TAG[stage]}
    </span>
  );
}

/** Four dots on a line: done steps filled, the current one ringed, the rest grey. */
export function Journey({ stage, active: forced, compact }: { stage?: RequestStage; active?: number; compact?: boolean }) {
  const active = forced ?? (stage ? journeyActive(stage) : 0);
  const closed = active < 0;
  return (
    <ol className={`jr${compact ? ' jr-c' : ''}${closed ? ' jr-x' : ''}`} aria-label={closed ? 'Request closed' : `Step ${Math.min(active + 1, 4)} of 4: ${JOURNEY_STEPS[Math.min(active, 3)]}`}>
      {JOURNEY_STEPS.map((label, i) => {
        const state = closed ? 'off' : i < active ? 'done' : i === active ? 'now' : 'off';
        return (
          <li key={label} className={`jr-s ${state}`}>
            <span className="jr-dot">
              {state === 'done' && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>}
            </span>
            {!compact && <span className="jr-l">{label}</span>}
          </li>
        );
      })}
      <style>{`
        .jr { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(4, 1fr); }
        .jr-s { position: relative; display: flex; flex-direction: column; align-items: center; gap: 6px; min-width: 0; }
        .jr-s::before { content: ''; position: absolute; top: 9px; right: 50%; width: 100%; height: 2px; background: #E2E8F0; z-index: 0; }
        .jr-s:first-child::before { display: none; }
        .jr-s.done::before, .jr-s.now::before { background: #1B4F8A; }
        .jr-dot { position: relative; z-index: 1; width: 20px; height: 20px; border-radius: 50%; display: grid; place-items: center; box-sizing: border-box; background: #fff; border: 2px solid #E2E8F0; color: #fff; transition: all .2s; }
        .jr-s.done .jr-dot { background: #1B4F8A; border-color: #1B4F8A; }
        .jr-s.now .jr-dot { border-color: #1B4F8A; box-shadow: 0 0 0 4px rgba(27,79,138,.14); }
        .jr-s.now .jr-dot::after { content: ''; width: 8px; height: 8px; border-radius: 50%; background: #1B4F8A; }
        .jr-l { font-size: 0.6875rem; font-weight: 600; color: #94A3B8; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
        .jr-s.done .jr-l { color: #334155; }
        .jr-s.now .jr-l { color: #1B4F8A; font-weight: 700; }
        .jr-c .jr-s::before { top: 6px; }
        .jr-c .jr-dot { width: 14px; height: 14px; border-width: 2px; }
        .jr-c .jr-dot svg { width: 7px; height: 7px; }
        .jr-c .jr-s.now .jr-dot { box-shadow: 0 0 0 3px rgba(27,79,138,.14); }
        .jr-c .jr-s.now .jr-dot::after { width: 6px; height: 6px; }
        .jr-x { opacity: .55; }
      `}</style>
    </ol>
  );
}

export const naira = (n: number) => '₦' + Math.round(n).toLocaleString('en-NG');
export const fmtDate = (d: string) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
export const fmtShort = (d: string) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

/** "3 months" / "6 weeks" / "10 days" for a campaign's dates. */
export function spanText(start: string, end: string) {
  const days = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 86_400_000) + 1;
  if (days >= 28) { const m = Math.round(days / 30.4); return `${m} month${m === 1 ? '' : 's'}`; }
  if (days >= 14) { const w = Math.round(days / 7); return `${w} weeks`; }
  return `${days} day${days === 1 ? '' : 's'}`;
}

export const ago = (d: string) => {
  const h = Math.round((Date.now() - new Date(d).getTime()) / 3_600_000);
  return h < 1 ? 'just now' : h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
};
