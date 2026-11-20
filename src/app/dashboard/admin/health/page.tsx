'use client';

// System health (065): what is failing or stuck, in one place. Errors come
// from our own log (server, browser, scheduled jobs); emails from email_log;
// job runs from cron_runs. The same summary drives the daily alert email.

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { authedFetch } from '@/lib/api';
import { useDashboardRole } from '@/components/layout/DashboardLayout';

type Health = {
  at: string;
  errors: { day: number; week: number; top: { source: string; message: string; path: string | null; n: number; last_at: string; first_at: string }[] };
  emails: { sent_week: number; failed_day: number; failed_week: number; skipped_week: number; reminders_failed_week: number;
            recent_failed: { kind: string; recipient: string; error: string; created_at: string }[] };
  jobs: Record<string, { ran_at: string; ok: boolean; summary: Record<string, unknown> | null }>;
  stuck: { key: string; label: string; link: string; n: number }[];
};
type Setup = { email: boolean; alerts_to: string; cron_secret: boolean; sentry: boolean; mapbox: boolean; ai: boolean; region: string | null; commit: string | null };

const JOBS: { key: string; label: string; every: string; maxDays: number }[] = [
  { key: 'owner-reminders', label: 'Owner reminders', every: 'Mondays 08:00 Lagos', maxDays: 8 },
  { key: 'ops-digest', label: 'Daily alert check', every: 'Daily 07:00 Lagos', maxDays: 2 },
];
const when = (d: string) => new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const SOURCE: Record<string, string> = { server: 'Server', client: 'Browser', cron: 'Job', api: 'API' };

export default function SystemHealthPage() {
  const role = useDashboardRole();
  const [h, setH] = useState<Health | null>(null);
  const [setup, setSetup] = useState<Setup | null>(null);
  const [up, setUp] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [testMsg, setTestMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const [testing, setTesting] = useState(false);
  const [now] = useState(() => Date.now());

  const load = useCallback(async () => {
    const [r, hr] = await Promise.all([
      supabase.rpc('admin_ops_health'),
      authedFetch('/api/health').then(x => x.json()).catch(() => null),
    ]);
    if (r.error) setError(/function|schema cache/i.test(r.error.message) ? 'Run migration 065 in Supabase to switch on System health.' : r.error.message);
    else { setH(r.data as Health); setError(null); }
    setUp(hr ? hr.status === 'ok' : false);
    setSetup(hr?.setup ?? null);
  }, []);
  useEffect(() => { if (role !== 'admin') return; (async () => { await load(); })(); }, [role, load]);

  async function sendTest() {
    setTesting(true); setTestMsg(null);
    const res = await authedFetch('/api/ops-digest', { method: 'POST' });
    const d = await res.json().catch(() => ({}));
    setTesting(false);
    setTestMsg(res.ok ? { text: `Alert sent to ${d.sent} address${d.sent === 1 ? '' : 'es'}${d.items?.length ? ` with ${d.items.length} item${d.items.length === 1 ? '' : 's'}` : ''}.` }
      : { text: d.error || 'Could not send the alert.', bad: true });
    await load();
  }

  if (role && role !== 'admin') return <div className="sh-pad">Admins only.</div>;
  const stuck = h?.stuck.filter(s => s.n > 0) ?? [];
  const jobState = (k: string, maxDays: number) => {
    const r = h?.jobs[k];
    if (!r) return { tone: 'todo', text: 'No run recorded yet' };
    const late = now - Date.parse(r.ran_at) > maxDays * 86400000;
    return { tone: !r.ok ? 'bad' : late ? 'warn' : 'ok', text: `${r.ok ? 'Worked' : 'Failed'} · ${when(r.ran_at)}${late ? ' · overdue' : ''}` };
  };
  const failing = !h ? [] : [
    up === false && 'site or database down',
    h.errors.day > 0 && `${h.errors.day} error${h.errors.day === 1 ? '' : 's'} today`,
    h.emails.failed_day > 0 && `${h.emails.failed_day} email${h.emails.failed_day === 1 ? '' : 's'} failed today`,
    ...JOBS.filter(j => jobState(j.key, j.maxDays).tone === 'bad').map(j => `${j.label.toLowerCase()} job failed`),
  ].filter((x): x is string => !!x);
  const overall = !h ? null : h.errors.day > 0 || h.emails.failed_day > 0 || up === false || JOBS.some(j => jobState(j.key, j.maxDays).tone === 'bad') ? 'bad' : stuck.length ? 'warn' : 'ok';

  return (
    <div className="sh">
      <style>{CSS}</style>
      <header className="sh-top">
        <div>
          <h1>System health</h1>
          <p className="sh-sub">Errors, emails, scheduled jobs and stalled work. Our team gets a daily email when anything here needs attention.</p>
        </div>
        <button type="button" className="sh-btn" onClick={() => void load()}>Refresh</button>
      </header>
      {error && <div className="sh-err" role="alert">{error}</div>}

      {h && (
        <>
          <div className={`sh-banner ${overall}`}>
            <b>{overall === 'ok' ? 'All clear' : overall === 'warn' ? `${stuck.length} thing${stuck.length === 1 ? '' : 's'} waiting on our team` : `Needs a look: ${failing.join(' · ')}`}</b>
            <span>Checked {when(h.at)}</span>
          </div>

          <div className="sh-tiles">
            <Tile n={up === null ? '…' : up ? 'Up' : 'Down'} label="Site and database" tone={up === false ? 'bad' : 'ok'} />
            <Tile n={h.errors.day} label={`errors today · ${h.errors.week} this week`} tone={h.errors.day ? 'bad' : 'ok'} />
            <Tile n={h.emails.failed_week} label={`emails failed this week · ${h.emails.sent_week} sent`} tone={h.emails.failed_day ? 'bad' : h.emails.failed_week ? 'warn' : 'ok'} />
            <Tile n={stuck.reduce((a, s) => a + s.n, 0)} label="items waiting on our team" tone={stuck.length ? 'warn' : 'ok'} />
          </div>

          <div className="sh-grid">
            <section className="sh-box">
              <h2>Waiting on our team</h2>
              <ul className="sh-stuck">
                {h.stuck.map(s => (
                  <li key={s.key} className={s.n ? 'on' : ''}>
                    <span className="sh-n">{s.n}</span>
                    <span className="sh-l">{s.label}</span>
                    {s.n > 0 && <a href={s.link}>Open →</a>}
                  </li>
                ))}
              </ul>
            </section>

            <section className="sh-box">
              <h2>Scheduled jobs</h2>
              <ul className="sh-jobs">
                {JOBS.map(j => { const s = jobState(j.key, j.maxDays); return (
                  <li key={j.key}><i className={s.tone} aria-hidden /><span><b>{j.label}</b><small>{j.every}</small></span><em className={s.tone}>{s.text}</em></li>
                ); })}
              </ul>
              <h2 className="sh-h2b">Setup</h2>
              {setup ? (
                <ul className="sh-setup">
                  <Check ok={setup.email} label="Email sending" fix="Set SMTP_USER and SMTP_PASS in Vercel" />
                  <Check ok={setup.cron_secret} label="Scheduled jobs allowed" fix="Set CRON_SECRET in Vercel" />
                  <Check ok label={`Alerts go to ${setup.alerts_to === 'OPS_ALERT_EMAIL' ? 'OPS_ALERT_EMAIL' : 'every admin account'}`} fix="" />
                  <Check ok={setup.sentry} label="Sentry (optional, extra error detail)" fix="Optional: set NEXT_PUBLIC_SENTRY_DSN. Errors are logged here either way." optional />
                  <Check ok={setup.mapbox} label="Maps" fix="Set NEXT_PUBLIC_MAPBOX_TOKEN" />
                </ul>
              ) : <p className="sh-muted">Setup details unavailable.</p>}
              <div className="sh-test">
                <button type="button" className="sh-btn primary" onClick={sendTest} disabled={testing}>{testing ? 'Sending…' : 'Send a test alert'}</button>
                <small>Goes to our team only.</small>
              </div>
              {testMsg && <p className={`sh-msg${testMsg.bad ? ' bad' : ''}`} role="status">{testMsg.text}</p>}
            </section>
          </div>

          <section className="sh-box">
            <h2>Errors this week</h2>
            {h.errors.top.length === 0 ? <p className="sh-muted">No errors recorded in the last 7 days.</p> : (
              <div className="sh-table" role="table">
                {h.errors.top.map((e, i) => (
                  <div key={i} className="sh-row" role="row">
                    <span className="sh-src">{SOURCE[e.source] ?? e.source}</span>
                    <span className="sh-msgcell"><b>{e.message}</b>{e.path && <small>{e.path}</small>}</span>
                    <span className="sh-count">{e.n}×</span>
                    <span className="sh-when">{when(e.last_at)}</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="sh-box">
            <h2>Emails not sent this week</h2>
            {h.emails.recent_failed.length === 0 ? <p className="sh-muted">Every email this week went out{h.emails.reminders_failed_week ? `, apart from ${h.emails.reminders_failed_week} owner reminder(s)` : ''}.</p> : (
              <div className="sh-table" role="table">
                {h.emails.recent_failed.map((m, i) => (
                  <div key={i} className="sh-row" role="row">
                    <span className="sh-src">{m.kind.replace(/_/g, ' ')}</span>
                    <span className="sh-msgcell"><b>{m.recipient}</b>{m.error && <small>{m.error}</small>}</span>
                    <span className="sh-count" />
                    <span className="sh-when">{when(m.created_at)}</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="sh-box">
            <h2>Backups</h2>
            <p className="sh-muted">
              Supabase keeps automatic daily backups on paid plans only. Check yours under Supabase → Project settings → Database → Backups.
              For your own copy, run <code>node scripts/backup.mjs</code> on your computer. It saves every table to a dated folder under <code>backups/</code>, which is never uploaded to GitHub.
              Keep that folder somewhere safe: it contains customer and owner details.
            </p>
          </section>
        </>
      )}
    </div>
  );
}

function Tile({ n, label, tone }: { n: number | string; label: string; tone: string }) {
  return <div className={`sh-tile ${tone}`}><b>{n}</b><span>{label}</span></div>;
}
function Check({ ok, label, fix, optional }: { ok: boolean; label: string; fix: string; optional?: boolean }) {
  return <li className={ok ? 'ok' : optional ? 'opt' : 'bad'}><i aria-hidden>{ok ? '✓' : optional ? '–' : '!'}</i><span>{label}{!ok && fix && <small>{fix}</small>}</span></li>;
}

const CSS = `
.sh { max-width: 1100px; }
.sh-pad { padding: 32px; color: #64748B; font-size: .875rem; }
.sh-top { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; flex-wrap: wrap; margin-bottom: 16px; }
.sh-top h1 { font-size: 1.5rem; font-weight: 700; margin: 0; letter-spacing: -.02em; color: #0F172A; }
.sh-sub { font-size: .875rem; color: #64748B; margin: 4px 0 0; max-width: 640px; }
.sh-err { background: #FEF2F2; border: 1px solid #FECACA; color: #B91C1C; border-radius: 10px; padding: 10px 12px; font-size: .875rem; margin-bottom: 12px; }
.sh-banner { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; align-items: center; border-radius: 12px; padding: 12px 16px; margin-bottom: 12px; font-size: .9375rem; border: 1px solid; }
.sh-banner span { font-size: .75rem; opacity: .8; }
.sh-banner.ok { background: #ECFDF5; border-color: #A7F3D0; color: #065F46; }
.sh-banner.warn { background: #FFF7ED; border-color: #FED7AA; color: #9A3412; }
.sh-banner.bad { background: #FEF2F2; border-color: #FECACA; color: #991B1B; }
.sh-tiles { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 12px; }
.sh-tile { background: #fff; border: 1px solid #E2E8F0; border-radius: 12px; padding: 12px 14px; display: grid; border-top-width: 3px; }
.sh-tile b { font-size: 1.375rem; color: #0F172A; } .sh-tile span { font-size: .75rem; color: #64748B; }
.sh-tile.ok { border-top-color: #10B981; } .sh-tile.warn { border-top-color: #F97316; } .sh-tile.bad { border-top-color: #EF4444; } .sh-tile.bad b { color: #B91C1C; }
.sh-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px; }
.sh-box { background: #fff; border: 1px solid #E2E8F0; border-radius: 12px; padding: 14px 16px; margin-bottom: 12px; }
.sh-grid .sh-box { margin-bottom: 0; }
.sh-box h2 { font-size: .6875rem; text-transform: uppercase; letter-spacing: .07em; color: #64748B; margin: 0 0 10px; font-weight: 600; }
.sh-h2b { margin-top: 18px !important; }
.sh-muted { font-size: .8125rem; color: #64748B; margin: 0; line-height: 1.6; }
.sh-muted code { background: #F1F5F9; border-radius: 4px; padding: 1px 5px; font-size: .75rem; }
.sh-stuck, .sh-jobs, .sh-setup { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; }
.sh-stuck li { display: flex; align-items: center; gap: 10px; padding: 7px 0; border-bottom: 1px solid #F1F5F9; font-size: .8125rem; color: #94A3B8; }
.sh-stuck li:last-child { border-bottom: 0; }
.sh-stuck li.on { color: #0F172A; }
.sh-n { min-width: 28px; text-align: center; font-weight: 700; border-radius: 6px; padding: 2px 6px; background: #F1F5F9; }
.sh-stuck li.on .sh-n { background: #FFEDD5; color: #C2410C; }
.sh-l { flex: 1; } .sh-stuck a { color: #1B4F8A; font-weight: 600; text-decoration: none; white-space: nowrap; }
.sh-jobs li { display: flex; align-items: center; gap: 10px; padding: 7px 0; font-size: .8125rem; flex-wrap: wrap; }
.sh-jobs i { width: 8px; height: 8px; border-radius: 50%; background: #CBD5E1; flex: none; }
.sh-jobs i.ok { background: #10B981; } .sh-jobs i.warn { background: #F97316; } .sh-jobs i.bad { background: #EF4444; }
.sh-jobs span { display: grid; flex: 1; min-width: 140px; } .sh-jobs small { color: #94A3B8; font-size: .6875rem; }
.sh-jobs em { font-style: normal; font-size: .75rem; color: #64748B; } .sh-jobs em.bad { color: #B91C1C; } .sh-jobs em.warn { color: #C2410C; }
.sh-setup li { display: flex; gap: 8px; padding: 4px 0; font-size: .8125rem; align-items: flex-start; }
.sh-setup i { width: 18px; height: 18px; border-radius: 50%; display: grid; place-items: center; font-style: normal; font-size: .6875rem; font-weight: 700; flex: none; }
.sh-setup li.ok i { background: #D1FAE5; color: #047857; } .sh-setup li.bad i { background: #FEE2E2; color: #B91C1C; } .sh-setup li.opt i { background: #F1F5F9; color: #64748B; }
.sh-setup span { display: grid; } .sh-setup small { font-size: .75rem; color: #64748B; }
.sh-test { display: flex; align-items: center; gap: 10px; margin-top: 14px; flex-wrap: wrap; } .sh-test small { font-size: .75rem; color: #94A3B8; }
.sh-btn { border: 1px solid #CBD5E1; background: #fff; color: #0F172A; border-radius: 8px; padding: 7px 12px; font: inherit; font-size: .8125rem; font-weight: 600; cursor: pointer; }
.sh-btn.primary { background: #1B4F8A; border-color: #1B4F8A; color: #fff; } .sh-btn:disabled { opacity: .6; cursor: default; }
.sh-msg { font-size: .8125rem; color: #047857; margin: 8px 0 0; } .sh-msg.bad { color: #B91C1C; }
.sh-table { display: grid; }
.sh-row { display: grid; grid-template-columns: 80px 1fr 50px 120px; gap: 10px; align-items: start; padding: 8px 0; border-bottom: 1px solid #F1F5F9; font-size: .8125rem; }
.sh-row:last-child { border-bottom: 0; }
.sh-src { font-size: .6875rem; font-weight: 600; color: #475569; background: #F1F5F9; border-radius: 6px; padding: 2px 6px; justify-self: start; text-transform: capitalize; }
.sh-msgcell { display: grid; min-width: 0; } .sh-msgcell b { font-weight: 600; color: #0F172A; overflow-wrap: anywhere; } .sh-msgcell small { color: #94A3B8; font-size: .75rem; overflow-wrap: anywhere; }
.sh-count { font-weight: 700; color: #B91C1C; text-align: right; } .sh-when { color: #64748B; font-size: .75rem; text-align: right; }
@media (max-width: 760px) {
  .sh-tiles { grid-template-columns: 1fr 1fr; } .sh-grid { grid-template-columns: 1fr; }
  .sh-row { grid-template-columns: 1fr auto; } .sh-src { grid-column: 1 / -1; } .sh-when { grid-column: 1 / -1; text-align: left; }
}
`;
