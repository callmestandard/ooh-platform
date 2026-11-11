'use client';

/**
 * Funnel numbers for the admin overview (054). Two funnels, because they
 * count different things: browsers (anonymous visitors) and requests.
 * Each step shows how many made it from the step before, and the change
 * from the period before.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';

type Window = {
  visitors: number; viewed: number; saved: number; started: number; signups: number;
  buyers: number; requests: number; answered: number; accepted: number; confirmed: number;
  confirmed_value: number; median_answer_hours: number | null; proposals: number; proposals_opened: number;
};
type Funnel = {
  days: number; now: Window; prev: Window;
  supply: { boards: number; confirmed_7d: number; owners_active_7d: number; owners_linked: number; waiting_48h: number; to_check: number };
  weeks: { week: string; requests: number }[];
};
type Step = { key: keyof Window; label: string; unit: string; base?: keyof Window; of?: string; sub?: (w: Window) => string | null };

const PERIODS = [7, 30, 90] as const;
const BAR = '#1B4F8A';

const BUYER_STEPS: Step[] = [
  { key: 'viewed', label: 'Viewed a board', unit: 'visitors' },
  { key: 'saved', label: 'Saved a board', unit: 'visitors', base: 'viewed', of: 'of viewers' },
  { key: 'started', label: 'Started a request', unit: 'visitors', base: 'viewed', of: 'of viewers' },
  { key: 'buyers', label: 'Sent a request', unit: 'buyers', base: 'started', of: 'of those who started', sub: w => `${w.requests} request${w.requests !== 1 ? 's' : ''}` },
];
const REQUEST_STEPS: Step[] = [
  { key: 'requests', label: 'Requests sent', unit: 'requests' },
  { key: 'answered', label: 'Owner answered', unit: 'requests', base: 'requests', of: 'of requests' },
  { key: 'accepted', label: 'Buyer accepted', unit: 'requests', base: 'answered', of: 'of answered' },
  { key: 'confirmed', label: 'Booking confirmed', unit: 'requests', base: 'accepted', of: 'of accepted', sub: w => (w.confirmed_value > 0 ? `${naira(w.confirmed_value)}/mo` : null) },
];

function naira(n: number) {
  if (n >= 1_000_000) return `₦${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1).replace(/\.0$/, '')}M`;
  if (n >= 1_000) return `₦${Math.round(n / 1_000)}K`;
  return `₦${Math.round(n)}`;
}
const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : '—');
function hours(h: number | null) {
  if (h == null) return '—';
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
  if (h < 48) return `${Math.round(h)} h`;
  return `${Math.round(h / 24)} days`;
}
const fmtWeek = (d: string) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

function Delta({ now, prev, days }: { now: number; prev: number; days: number }) {
  const d = now - prev;
  if (d === 0) return <span className="fn-delta" title={`Same as the ${days} days before`}>±0</span>;
  return <span className="fn-delta" title={`${prev} in the ${days} days before`}>{d > 0 ? '▲' : '▼'} {Math.abs(d)}</span>;
}

function FunnelSteps({ title, steps, f }: { title: string; steps: Step[]; f: Funnel }) {
  const top = Math.max(1, Number(f.now[steps[0].key]) || 0);
  return (
    <div className="fn-col">
      <h3>{title}</h3>
      <ol className="fn-steps">
        {steps.map(s => {
          const v = Number(f.now[s.key]) || 0;
          const sub = s.sub?.(f.now);
          return (
            <li key={s.key} title={`${s.label}: ${v} ${s.unit}${s.base ? ` (${pct(v, Number(f.now[s.base]) || 0)} ${s.of})` : ''}`}>
              <div className="fn-row">
                <span className="fn-label">{s.label}</span>
                <span className="fn-val">{v.toLocaleString()}<em> {s.unit}</em></span>
              </div>
              <div className="fn-track"><div className="fn-bar" style={{ width: v ? `max(4px, ${(v / top) * 100}%)` : 0 }} /></div>
              <div className="fn-meta">
                <span>{s.base ? <><strong>{pct(v, Number(f.now[s.base]) || 0)}</strong> {s.of}</> : 'Start of this funnel'}{sub ? ` · ${sub}` : ''}</span>
                <Delta now={v} prev={Number(f.prev[s.key]) || 0} days={f.days} />
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export default function FunnelPanel() {
  const [days, setDays] = useState<(typeof PERIODS)[number]>(30);
  const [data, setData] = useState<Funnel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: d, error: e } = await supabase.rpc('admin_funnel', { p_days: days });
      if (cancelled) return;
      if (e) { setError(e.message.includes('admin_funnel') ? 'Run migration 054 in Supabase to switch on the funnel.' : e.message); return; }
      setError(null);
      setData(d as Funnel);
    })();
    return () => { cancelled = true; };
  }, [days]);

  const f = data && data.days === days ? data : null;
  const maxWeek = Math.max(1, ...(f?.weeks ?? []).map(w => w.requests));
  const noTracking = f && f.now.visitors === 0 && f.prev.visitors === 0;

  return (
    <section className="fn" data-funnel>
      <style>{CSS}</style>
      <header className="fn-head">
        <div>
          <h2>Funnel</h2>
          <p>Where buyers drop off · last {days} days, with the change from the {days} days before</p>
        </div>
        <div className="fn-seg" role="tablist" aria-label="Period">
          {PERIODS.map(p => (
            <button key={p} type="button" role="tab" aria-selected={days === p} className={days === p ? 'is-on' : ''} onClick={() => setDays(p)}>{p} days</button>
          ))}
        </div>
      </header>

      {error ? (
        <p className="fn-note">{error}</p>
      ) : !f ? (
        <div className="fn-skel" />
      ) : (
        <>
          {noTracking && <p className="fn-note">Visitor numbers start from today (when tracking went live). Request numbers already include past requests.</p>}
          <div className="fn-grid">
            <FunnelSteps title="Visitors" steps={BUYER_STEPS} f={f} />
            <FunnelSteps title="Requests" steps={REQUEST_STEPS} f={f} />
          </div>

          <div className="fn-tiles">
            <div><span>New buyer accounts</span><strong>{f.now.signups}</strong><Delta now={f.now.signups} prev={f.prev.signups} days={f.days} /></div>
            <div><span>Typical time to owner answer</span><strong>{hours(f.now.median_answer_hours)}</strong><em>middle request</em></div>
            <div><span>Boards confirmed this week</span><strong>{f.supply.confirmed_7d}<small>/{f.supply.boards}</small></strong><em>{pct(f.supply.confirmed_7d, f.supply.boards)} of listed</em></div>
            <div className={f.supply.waiting_48h ? 'is-warn' : ''}>
              <span>Requests waiting 48h+</span><strong>{f.supply.waiting_48h}</strong>
              <em>{f.supply.waiting_48h ? <Link href="/dashboard/admin/needs-checking">Nudge owners →</Link> : 'none waiting'}</em>
            </div>
            <div><span>Proposals sent</span><strong>{f.now.proposals}</strong><em>{f.now.proposals_opened} opened by clients</em></div>
          </div>

          <div className="fn-weeks">
            <div className="fn-weeks-head">
              <h3>Requests per week</h3>
              <span>last 12 weeks · most {maxWeek}</span>
            </div>
            <div className="fn-plot" onMouseLeave={() => setHover(null)}>
              {f.weeks.map((w, i) => (
                <div key={w.week} className="fn-col-bar" onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} tabIndex={0}
                  aria-label={`Week of ${fmtWeek(w.week)}: ${w.requests} requests`}>
                  <div className={`fn-wbar${hover === i ? ' is-hover' : ''}`} style={{ height: w.requests ? `max(3px, ${(w.requests / maxWeek) * 100}%)` : 0 }} />
                  {hover === i && <div className="fn-tip" role="status">{w.requests} request{w.requests !== 1 ? 's' : ''}<br /><em>week of {fmtWeek(w.week)}</em></div>}
                </div>
              ))}
            </div>
            <div className="fn-axis"><span>{f.weeks[0] ? fmtWeek(f.weeks[0].week) : ''}</span><span>this week</span></div>
          </div>
        </>
      )}
    </section>
  );
}

const CSS = `
.fn { background: #fff; border: 1px solid #E8EDF2; border-radius: 14px; padding: 18px 20px 20px; margin-bottom: 16px; color: #0F172A; }
.fn-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; flex-wrap: wrap; margin-bottom: 16px; }
.fn-head h2 { font-size: 1rem; font-weight: 700; margin: 0 0 2px; letter-spacing: -.01em; }
.fn-head p { font-size: .75rem; color: #94A3B8; margin: 0; }
.fn-seg { display: flex; background: #F1F5F9; border-radius: 9px; padding: 3px; gap: 2px; }
.fn-seg button { border: none; background: none; height: 28px; padding: 0 12px; border-radius: 7px; font-family: inherit; font-size: .75rem; font-weight: 600; color: #64748B; cursor: pointer; }
.fn-seg button.is-on { background: #fff; color: #0F172A; box-shadow: 0 1px 3px rgba(15,23,42,.1); }
.fn-note { font-size: .8125rem; color: #64748B; background: #F8FAFC; border-radius: 10px; padding: 10px 12px; margin: 0 0 14px; }
.fn-skel { height: 300px; border-radius: 12px; background: linear-gradient(90deg, #F1F5F9 0%, #F8FAFC 50%, #F1F5F9 100%); background-size: 200% 100%; animation: fnSk 1.2s infinite; }
@keyframes fnSk { from { background-position: 200% 0; } to { background-position: -200% 0; } }
.fn-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 28px; }
.fn-col h3, .fn-weeks h3 { font-size: .6875rem; font-weight: 700; color: #64748B; text-transform: uppercase; letter-spacing: .06em; margin: 0 0 10px; }
.fn-steps { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 14px; }
.fn-row { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
.fn-label { font-size: .8125rem; font-weight: 600; color: #334155; }
.fn-val { font-size: 1.125rem; font-weight: 800; letter-spacing: -.02em; font-variant-numeric: tabular-nums; }
.fn-val em { font-style: normal; font-size: .6875rem; font-weight: 500; color: #94A3B8; letter-spacing: 0; }
.fn-track { height: 8px; background: #F1F5F9; border-radius: 4px; margin: 6px 0 5px; overflow: hidden; }
.fn-bar { height: 100%; background: ${BAR}; border-radius: 0 4px 4px 0; transition: width .4s cubic-bezier(.2,.8,.2,1); }
.fn-meta { display: flex; justify-content: space-between; gap: 8px; font-size: .6875rem; color: #94A3B8; }
.fn-meta strong { color: #475569; font-weight: 700; }
.fn-delta { color: #64748B; font-weight: 600; white-space: nowrap; font-variant-numeric: tabular-nums; }
.fn-tiles { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 10px; margin-top: 22px; }
.fn-tiles > div { border: 1px solid #F1F5F9; background: #F8FAFC; border-radius: 12px; padding: 10px 12px; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.fn-tiles span { font-size: .6875rem; color: #64748B; font-weight: 600; }
.fn-tiles strong { font-size: 1.25rem; font-weight: 800; letter-spacing: -.02em; font-variant-numeric: tabular-nums; }
.fn-tiles small { font-size: .8125rem; color: #94A3B8; font-weight: 600; }
.fn-tiles em { font-style: normal; font-size: .6875rem; color: #94A3B8; }
.fn-tiles em a { color: #1B4F8A; font-weight: 700; text-decoration: none; }
.fn-tiles .is-warn { background: #FFFBEB; border-color: #FDE68A; }
.fn-tiles .is-warn strong { color: #92400E; }
.fn-weeks { margin-top: 22px; }
.fn-weeks-head { display: flex; justify-content: space-between; align-items: baseline; }
.fn-weeks-head span { font-size: .6875rem; color: #94A3B8; }
.fn-plot { height: 84px; display: grid; grid-template-columns: repeat(12, 1fr); gap: 2px; align-items: end; border-bottom: 1px solid #E2E8F0; }
.fn-col-bar { position: relative; height: 100%; display: flex; align-items: flex-end; justify-content: center; cursor: default; outline: none; }
.fn-col-bar:focus-visible .fn-wbar { outline: 2px solid #93C5FD; }
.fn-wbar { width: 100%; max-width: 28px; background: ${BAR}; border-radius: 4px 4px 0 0; opacity: .85; transition: opacity .15s; }
.fn-wbar.is-hover { opacity: 1; }
.fn-tip { position: absolute; bottom: calc(100% + 6px); left: 50%; transform: translateX(-50%); white-space: nowrap; background: #0F172A; color: #fff; font-size: .6875rem; font-weight: 700; padding: 6px 8px; border-radius: 7px; z-index: 2; text-align: center; pointer-events: none; }
.fn-tip em { font-style: normal; font-weight: 500; color: #CBD5E1; }
.fn-axis { display: flex; justify-content: space-between; font-size: .6875rem; color: #94A3B8; margin-top: 4px; }
@media (max-width: 900px) {
  .fn-grid { grid-template-columns: 1fr; gap: 22px; }
  .fn-tiles { grid-template-columns: 1fr 1fr; }
  .fn-tiles > div:last-child { grid-column: 1 / -1; }
}
`;
