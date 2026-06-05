import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM   = process.env.RESEND_FROM_EMAIL ?? 'OOH Platform <onboarding@resend.dev>';
const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://oohplatform.ng').replace(/\/$/, '');

export async function sendEmail(to: string, subject: string, html: string) {
  if (!process.env.RESEND_API_KEY || !to) return;
  try {
    await resend.emails.send({ from: FROM, to, subject, html });
  } catch (err) {
    console.error('[email] send failed:', err);
  }
}

// ── HTML shell ────────────────────────────────────────────────────────────────

function emailWrap(preheader: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>OOH Platform</title>
</head>
<body style="margin:0;padding:0;background:#F1F5F9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<span style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${preheader}&nbsp;‌&nbsp;‌&nbsp;‌&nbsp;‌&nbsp;‌&nbsp;‌</span>
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F1F5F9;padding:32px 16px;">
  <tr><td align="center">
    <table width="100%" style="max-width:560px;" cellpadding="0" cellspacing="0">

      <!-- Logo bar -->
      <tr><td style="padding:0 0 20px;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="background:#0F172A;border-radius:12px 12px 0 0;padding:18px 28px;">
              <span style="font-size:18px;font-weight:800;color:#F8FAFC;letter-spacing:-0.5px;">OOH <span style="color:#1B4F8A;">Platform</span></span>
            </td>
          </tr>
        </table>
      </td></tr>

      <!-- Card -->
      <tr><td style="background:#fff;border-radius:0 0 12px 12px;padding:32px 28px 28px;box-shadow:0 2px 12px rgba(0,0,0,0.06);">
        ${body}
      </td></tr>

      <!-- Footer -->
      <tr><td style="padding:20px 0 0;text-align:center;">
        <p style="font-size:11px;color:#94A3B8;margin:0;">Nigeria's OOH Advertising Operating System · <a href="${APP_URL}" style="color:#1B4F8A;text-decoration:none;">oohplatform.ng</a></p>
        <p style="font-size:11px;color:#CBD5E1;margin:4px 0 0;">You're receiving this because you have an account on OOH Platform.</p>
      </td></tr>

    </table>
  </td></tr>
</table>
</body>
</html>`;
}

function btn(label: string, href: string, color = '#1B4F8A'): string {
  return `<table cellpadding="0" cellspacing="0" style="margin:24px 0 0;">
    <tr><td style="background:${color};border-radius:9px;">
      <a href="${href}" style="display:inline-block;padding:12px 24px;font-size:14px;font-weight:700;color:#fff;text-decoration:none;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">${label}</a>
    </td></tr>
  </table>`;
}

function metaRow(label: string, value: string): string {
  return `<tr>
    <td style="padding:6px 0;font-size:12px;color:#94A3B8;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;width:120px;">${label}</td>
    <td style="padding:6px 0;font-size:13px;color:#0F172A;font-weight:600;">${value}</td>
  </tr>`;
}

// ── Email builders ────────────────────────────────────────────────────────────

export async function emailInvoiceSent(params: {
  to: string;
  invoiceNumber: string;
  totalAmount: number;
  agencyName: string;
  dueDate?: string | null;
  invoiceId: string;
}) {
  const amount = '₦' + Number(params.totalAmount).toLocaleString('en-NG');
  const due    = params.dueDate ? new Date(params.dueDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : null;
  const link   = `${APP_URL}/invoice/${params.invoiceId}`;

  const html = emailWrap(
    `Invoice ${params.invoiceNumber} — ${amount} due${due ? ' ' + due : ''}`,
    `<h1 style="font-size:22px;font-weight:800;color:#0F172A;margin:0 0 8px;">You have a new invoice</h1>
     <p style="font-size:14px;color:#64748B;margin:0 0 24px;line-height:1.6;">${params.agencyName} has sent you an invoice for payment.</p>
     <table cellpadding="0" cellspacing="0" style="width:100%;background:#F8FAFC;border-radius:10px;padding:16px 20px;margin:0 0 8px;">
       <tbody>
         ${metaRow('Invoice', params.invoiceNumber)}
         ${metaRow('Amount', `<span style="font-size:20px;font-family:monospace;color:#0F172A;font-weight:800;">${amount}</span>`)}
         ${metaRow('From', params.agencyName)}
         ${due ? metaRow('Due date', `<span style="color:${new Date(params.dueDate!) < new Date() ? '#DC2626' : '#0F172A'}">${due}</span>`) : ''}
       </tbody>
     </table>
     ${btn('View &amp; Pay Invoice', link)}
     <p style="font-size:12px;color:#94A3B8;margin:16px 0 0;">Or copy this link: <a href="${link}" style="color:#1B4F8A;">${link}</a></p>`
  );

  await sendEmail(params.to, `Invoice ${params.invoiceNumber} — ${amount} from ${params.agencyName}`, html);
}

export async function emailPaymentReceived(params: {
  to: string;
  invoiceNumber: string;
  totalAmount: number;
  clientName: string;
  invoiceId: string;
}) {
  const amount = '₦' + Number(params.totalAmount).toLocaleString('en-NG');
  const link   = `${APP_URL}/dashboard/agency/invoices/${params.invoiceId}`;

  const html = emailWrap(
    `Payment received — ${amount} from ${params.clientName}`,
    `<h1 style="font-size:22px;font-weight:800;color:#0F172A;margin:0 0 8px;">Payment received</h1>
     <p style="font-size:14px;color:#64748B;margin:0 0 24px;line-height:1.6;">${params.clientName} has paid invoice ${params.invoiceNumber}.</p>
     <table cellpadding="0" cellspacing="0" style="width:100%;background:#ECFDF5;border-radius:10px;padding:16px 20px;margin:0 0 8px;border:1px solid #A7F3D0;">
       <tbody>
         ${metaRow('Invoice', params.invoiceNumber)}
         ${metaRow('Amount', `<span style="font-size:20px;font-family:monospace;color:#065F46;font-weight:800;">${amount}</span>`)}
         ${metaRow('Paid by', params.clientName)}
         ${metaRow('Status', '<span style="color:#065F46;font-weight:700;">✓ SETTLED</span>')}
       </tbody>
     </table>
     ${btn('View Invoice', link, '#059669')}`
  );

  await sendEmail(params.to, `Payment received — ${amount} from ${params.clientName}`, html);
}

export async function emailMPISent(params: {
  to: string;
  invoiceNumber: string;
  totalAmount: number;
  ownerName: string;
  invoiceId: string;
}) {
  const amount = '₦' + Number(params.totalAmount).toLocaleString('en-NG');
  const link   = `${APP_URL}/dashboard/agency/invoices`;

  const html = emailWrap(
    `Media partner invoice ${params.invoiceNumber} — ${amount}`,
    `<h1 style="font-size:22px;font-weight:800;color:#0F172A;margin:0 0 8px;">New media partner invoice</h1>
     <p style="font-size:14px;color:#64748B;margin:0 0 24px;line-height:1.6;">${params.ownerName} has raised an invoice for board placement fees. Review it in your invoices dashboard.</p>
     <table cellpadding="0" cellspacing="0" style="width:100%;background:#F8FAFC;border-radius:10px;padding:16px 20px;margin:0 0 8px;">
       <tbody>
         ${metaRow('Invoice', params.invoiceNumber)}
         ${metaRow('Amount', `<span style="font-size:20px;font-family:monospace;font-weight:800;">${amount}</span>`)}
         ${metaRow('From', params.ownerName)}
       </tbody>
     </table>
     ${btn('Review Invoice', link)}`
  );

  await sendEmail(params.to, `Media partner invoice from ${params.ownerName} — ${amount}`, html);
}

export async function emailPlanSentForApproval(params: {
  to: string;
  clientName: string;
  agencyName: string;
  campaignName: string;
  boardCount: number;
}) {
  const link = `${APP_URL}/dashboard/client?tab=plan`;

  const html = emailWrap(
    `${params.agencyName} has sent a media plan for your review`,
    `<h1 style="font-size:22px;font-weight:800;color:#0F172A;margin:0 0 8px;">Media plan ready for review</h1>
     <p style="font-size:14px;color:#64748B;margin:0 0 24px;line-height:1.6;">Hi ${params.clientName}, <strong>${params.agencyName}</strong> has sent you a media plan for your approval. Please review and approve or decline each board.</p>
     <table cellpadding="0" cellspacing="0" style="width:100%;background:#F8FAFC;border-radius:10px;padding:16px 20px;margin:0 0 8px;">
       <tbody>
         ${metaRow('Campaign', params.campaignName)}
         ${metaRow('Boards', `${params.boardCount} board${params.boardCount !== 1 ? 's' : ''} proposed`)}
         ${metaRow('Agency', params.agencyName)}
       </tbody>
     </table>
     ${btn('Review Media Plan', link, '#7C3AED')}`
  );

  await sendEmail(params.to, `Media plan from ${params.agencyName} — ${params.boardCount} boards ready for approval`, html);
}

export async function emailPlanApproved(params: {
  to: string;
  agencyName: string;
  clientName: string;
  campaignName: string;
  boardCount: number;
  campaignId: string;
}) {
  const link = `${APP_URL}/dashboard/agency/campaigns/${params.campaignId}`;

  const html = emailWrap(
    `${params.clientName} approved the media plan`,
    `<h1 style="font-size:22px;font-weight:800;color:#0F172A;margin:0 0 8px;">Media plan approved!</h1>
     <p style="font-size:14px;color:#64748B;margin:0 0 24px;line-height:1.6;"><strong>${params.clientName}</strong> has approved the media plan. All ${params.boardCount} board${params.boardCount !== 1 ? 's' : ''} are confirmed — you can proceed to production.</p>
     <table cellpadding="0" cellspacing="0" style="width:100%;background:#ECFDF5;border-radius:10px;padding:16px 20px;margin:0 0 8px;border:1px solid #A7F3D0;">
       <tbody>
         ${metaRow('Campaign', params.campaignName)}
         ${metaRow('Boards', `${params.boardCount} approved`)}
         ${metaRow('Client', params.clientName)}
         ${metaRow('Status', '<span style="color:#065F46;font-weight:700;">✓ APPROVED</span>')}
       </tbody>
     </table>
     ${btn('View Campaign', link, '#059669')}`
  );

  await sendEmail(params.to, `${params.clientName} approved the media plan — ${params.campaignName}`, html);
}

export async function emailNewBookingRequest(params: {
  to: string;
  ownerName: string;
  boardName: string;
  agencyName: string;
  campaignName: string;
  rate: number;
  bookingId: string;
}) {
  const amount = '₦' + Number(params.rate).toLocaleString('en-NG');
  const link   = `${APP_URL}/dashboard/owner/negotiations`;

  const html = emailWrap(
    `New booking request for ${params.boardName}`,
    `<h1 style="font-size:22px;font-weight:800;color:#0F172A;margin:0 0 8px;">New booking request</h1>
     <p style="font-size:14px;color:#64748B;margin:0 0 24px;line-height:1.6;">Hi ${params.ownerName}, <strong>${params.agencyName}</strong> wants to book one of your boards.</p>
     <table cellpadding="0" cellspacing="0" style="width:100%;background:#F8FAFC;border-radius:10px;padding:16px 20px;margin:0 0 8px;">
       <tbody>
         ${metaRow('Board', params.boardName)}
         ${metaRow('Campaign', params.campaignName)}
         ${metaRow('Agency', params.agencyName)}
         ${metaRow('Offered rate', `<span style="font-family:monospace;font-weight:700;">${amount}/mo</span>`)}
       </tbody>
     </table>
     ${btn('Review &amp; Respond', link)}`
  );

  await sendEmail(params.to, `Booking request from ${params.agencyName} — ${params.boardName}`, html);
}
