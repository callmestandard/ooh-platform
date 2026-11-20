import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { requireAuth, unauthorized } from '@/lib/require-auth';
import { sendEmail, emailConfigured, escapeHtml } from '@/lib/email';
import { adminEmails, isAdmin, logEmail } from '@/lib/quotation-server';
import { logAppError, logCronRun } from '@/lib/error-log';

export const runtime = 'nodejs';

// Daily alert to OUR TEAM only (OPS_ALERT_EMAIL, or every admin account):
// errors, failed emails, failed jobs and stuck work. Sent only when something
// needs attention. GET = Vercel cron (CRON_SECRET); POST = an admin's test send.
type Health = {
  errors: { day: number; week: number; top: { source: string; message: string; path: string | null; n: number; last_at: string }[] };
  emails: { failed_day: number; failed_week: number; reminders_failed_week: number; recent_failed: { kind: string; recipient: string; error: string; created_at: string }[] };
  jobs: Record<string, { ran_at: string; ok: boolean; summary: Record<string, unknown> | null }>;
  stuck: { key: string; label: string; link: string; n: number }[];
};
const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || 'https://ooh-platform-xi.vercel.app').replace(/\/$/, '');
const DAY = 86400000;

function attention(h: Health, now: number) {
  const items: string[] = [];
  if (h.errors.day) items.push(`${h.errors.day} error${h.errors.day === 1 ? '' : 's'} in the last 24 hours`);
  if (h.emails.failed_day) items.push(`${h.emails.failed_day} email${h.emails.failed_day === 1 ? '' : 's'} failed to send in the last 24 hours`);
  for (const [job, r] of Object.entries(h.jobs)) {
    if (job === 'ops-digest') continue;
    if (!r.ok && now - Date.parse(r.ran_at) < 8 * DAY) items.push(`The ${job} job failed on its last run`);
  }
  for (const s of h.stuck) if (s.n > 0) items.push(`${s.n} · ${s.label}`);
  return items;
}

function html(h: Health, items: string[]) {
  const li = (t: string) => `<li style="margin:0 0 6px">${escapeHtml(t)}</li>`;
  const errs = h.errors.top.slice(0, 5).map(e => li(`${e.n}× ${e.message}${e.path ? ` (${e.path})` : ''}`)).join('');
  const mails = h.emails.recent_failed.slice(0, 5).map(m => li(`${m.kind} → ${m.recipient}: ${m.error || 'not sent'}`)).join('');
  return `<div style="font-family:-apple-system,Segoe UI,sans-serif;color:#0F172A;max-width:560px">
<h2 style="font-size:18px;margin:0 0 8px">OOH Platform: things that need you</h2>
<ul style="padding-left:18px;font-size:14px;line-height:1.5">${items.map(li).join('')}</ul>
${errs ? `<h3 style="font-size:14px;margin:16px 0 6px">Recent errors</h3><ul style="padding-left:18px;font-size:13px;color:#334155">${errs}</ul>` : ''}
${mails ? `<h3 style="font-size:14px;margin:16px 0 6px">Emails not sent</h3><ul style="padding-left:18px;font-size:13px;color:#334155">${mails}</ul>` : ''}
<p style="margin:20px 0"><a href="${APP_URL}/dashboard/admin/health" style="background:#1B4F8A;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600">Open System health</a></p>
<p style="font-size:12px;color:#64748B">Sent to the OOH Platform team only, once a day when something needs attention.</p></div>`;
}

async function run(force: boolean, trigger: 'cron' | 'test') {
  const db = getSupabaseAdmin();
  if (!db) return { status: 503, body: { error: 'Server is missing its database key' } };
  const { data, error } = await db.rpc('admin_ops_health');
  if (error) {
    await logAppError('cron', 'ops-digest: ' + error.message);
    await logCronRun('ops-digest', false, { error: error.message.slice(0, 200), trigger });
    return { status: 500, body: { error: /function|schema cache/.test(error.message) ? 'Run migration 065 in Supabase first.' : error.message } };
  }
  const h = data as Health;
  const pruned = (await db.rpc('prune_app_errors')).data ?? 0;
  const items = attention(h, Date.now());
  if (!items.length && !force) {
    await logCronRun('ops-digest', true, { sent: 0, items: 0, pruned, trigger });
    return { status: 200, body: { sent: 0, items: 0, note: 'Nothing needs attention; no email sent.' } };
  }
  if (!emailConfigured()) {
    await logCronRun('ops-digest', false, { error: 'email not set up', items: items.length, trigger });
    return { status: 502, body: { error: 'Email is not set up (SMTP_USER / SMTP_PASS in Vercel).', items } };
  }
  const to = (process.env.OPS_ALERT_EMAIL || '').split(',').map(s => s.trim()).filter(Boolean);
  const recipients = to.length ? to : await adminEmails(db);
  const list = items.length ? items : ['Test alert: nothing needs attention right now.'];
  const subject = items.length ? `OOH Platform: ${items.length} thing${items.length === 1 ? '' : 's'} need${items.length === 1 ? 's' : ''} you` : 'OOH Platform: test alert';
  let sent = 0;
  for (const r of recipients) {
    const ok = await sendEmail(r, subject, html(h, list));
    await logEmail(db, { kind: 'ops_digest', recipient: r, subject, status: ok ? 'sent' : 'failed', error: ok ? null : 'SMTP refused' });
    if (ok) sent++;
  }
  await logCronRun('ops-digest', sent > 0 || recipients.length === 0, { sent, recipients: recipients.length, items: items.length, pruned, trigger });
  return { status: sent || !recipients.length ? 200 : 502, body: { sent, recipients: recipients.length, items } };
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET is not set' }, { status: 500 });
  if (req.headers.get('authorization') !== `Bearer ${secret}`) return unauthorized();
  const r = await run(false, 'cron');
  return NextResponse.json(r.body, { status: r.status });
}

export async function POST(req: NextRequest) {
  const user = await requireAuth(req);
  if (!user) return unauthorized();
  const db = getSupabaseAdmin();
  if (!db || !(await isAdmin(db, user))) return NextResponse.json({ error: 'Admins only' }, { status: 403 });
  const r = await run(true, 'test');
  return NextResponse.json(r.body, { status: r.status });
}
