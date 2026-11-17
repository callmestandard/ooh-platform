// Sends one test email with the SMTP settings in .env.local.
//
//   node scripts/test-email.mjs you@example.com
//
// Needs SMTP_USER and SMTP_PASS (a Google app password); EMAIL_FROM,
// SMTP_HOST and SMTP_PORT are optional.
import nodemailer from 'nodemailer';
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split(/\r?\n/).filter(l => /^[A-Z_]+=/.test(l)).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
);
const to = process.argv[2];
const user = env.SMTP_USER, pass = (env.SMTP_PASS ?? '').replace(/\s+/g, '');
if (!to) { console.log('Usage: node scripts/test-email.mjs you@example.com'); process.exit(1); }
if (!user || !pass) { console.log('Add SMTP_USER and SMTP_PASS to .env.local first.'); process.exit(1); }

const port = Number(env.SMTP_PORT || 465);
const t = nodemailer.createTransport({ host: env.SMTP_HOST || 'smtp.gmail.com', port, secure: port === 465, auth: { user, pass } });
try {
  await t.verify();
  console.log('Signed in to', env.SMTP_HOST || 'smtp.gmail.com', 'as', user);
  const info = await t.sendMail({
    from: env.EMAIL_FROM || `OOH Platform <${user}>`,
    to,
    subject: 'OOH Platform test email',
    html: '<p>This is a test from OOH Platform. If you can read this, email sending works.</p>',
  });
  console.log('Sent:', info.response);
} catch (e) {
  console.log('Failed:', e.message);
  if (/535|Username and Password not accepted/i.test(e.message)) {
    console.log('Gmail refused the login. SMTP_PASS must be an app password (myaccount.google.com/apppasswords), not the normal password.');
  }
  process.exit(1);
}
