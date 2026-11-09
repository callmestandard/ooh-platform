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
        <p style="font-size:11px;color:#94A3B8;margin:0;">${process.env.NEXT_PUBLIC_MVP_MODE !== 'false' ? 'Nigeria&apos;s billboard marketplace' : 'Nigeria&apos;s OOH Advertising Operating System'} · <a href="${APP_URL}" style="color:#1B4F8A;text-decoration:none;">oohplatform.ng</a></p>
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
  /** null = a quote request: no amount was offered. */
  rate: number | null;
  bookingId: string;
}) {
  const amount = params.rate ? '₦' + Number(params.rate).toLocaleString('en-NG') : null;
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
         ${amount ? metaRow('Offered rate', `<span style="font-family:monospace;font-weight:700;">${amount}/mo</span>`) : metaRow('Offer', 'Quote requested — please reply with your rate')}
       </tbody>
     </table>
     ${btn('Review &amp; Respond', link)}`
  );

  await sendEmail(params.to, `Booking request from ${params.agencyName} — ${params.boardName}`, html);
}

export async function emailBookingAccepted(params: {
  to: string;
  agencyName: string;
  ownerName: string;
  boardName: string;
  agreedRate: number;
  bookingId: string;
}) {
  const amount = '₦' + Number(params.agreedRate).toLocaleString('en-NG');
  const link   = `${APP_URL}/dashboard/agency/negotiations/${params.bookingId}`;

  const html = emailWrap(
    `Your booking for ${params.boardName} has been accepted`,
    `<h1 style="font-size:22px;font-weight:800;color:#0F172A;margin:0 0 8px;">Booking accepted!</h1>
     <p style="font-size:14px;color:#64748B;margin:0 0 24px;line-height:1.6;">Hi ${params.agencyName}, <strong>${params.ownerName}</strong> has accepted your booking request. The deal is agreed.</p>
     <table cellpadding="0" cellspacing="0" style="width:100%;background:#ECFDF5;border-radius:10px;padding:16px 20px;margin:0 0 8px;border:1px solid #A7F3D0;">
       <tbody>
         ${metaRow('Board', params.boardName)}
         ${metaRow('Owner', params.ownerName)}
         ${metaRow('Agreed rate', `<span style="font-family:monospace;font-weight:700;">${amount}/mo</span>`)}
         ${metaRow('Status', '<span style="color:#065F46;font-weight:700;">✓ AGREED</span>')}
       </tbody>
     </table>
     ${btn('View Booking', link, '#059669')}`
  );

  await sendEmail(params.to, `Booking accepted — ${params.boardName} at ${amount}/mo`, html);
}

export async function emailBookingDeclined(params: {
  to: string;
  agencyName: string;
  ownerName: string;
  boardName: string;
  bookingId: string;
}) {
  const link = `${APP_URL}/dashboard/agency/negotiations/${params.bookingId}`;

  const html = emailWrap(
    `Your booking request for ${params.boardName} was declined`,
    `<h1 style="font-size:22px;font-weight:800;color:#0F172A;margin:0 0 8px;">Booking declined</h1>
     <p style="font-size:14px;color:#64748B;margin:0 0 24px;line-height:1.6;">Hi ${params.agencyName}, <strong>${params.ownerName}</strong> has declined your booking request for <strong>${params.boardName}</strong>.</p>
     <table cellpadding="0" cellspacing="0" style="width:100%;background:#FEF2F2;border-radius:10px;padding:16px 20px;margin:0 0 8px;border:1px solid #FECACA;">
       <tbody>
         ${metaRow('Board', params.boardName)}
         ${metaRow('Owner', params.ownerName)}
         ${metaRow('Status', '<span style="color:#991B1B;font-weight:700;">✗ DECLINED</span>')}
       </tbody>
     </table>
     <p style="font-size:13px;color:#64748B;margin:16px 0 0;line-height:1.6;">You can browse other available boards on the marketplace or reach out to the owner directly.</p>
     ${btn('Browse Available Boards', `${APP_URL}/marketplace`, '#64748B')}`
  );

  await sendEmail(params.to, `Booking declined — ${params.boardName}`, html);
}

export async function emailBookingCounterOffer(params: {
  to: string;
  agencyName: string;
  ownerName: string;
  boardName: string;
  counterRate: number;
  bookingId: string;
}) {
  const amount = '₦' + Number(params.counterRate).toLocaleString('en-NG');
  const link   = `${APP_URL}/dashboard/agency/negotiations/${params.bookingId}`;

  const html = emailWrap(
    `Counter offer on ${params.boardName} — ${amount}/mo`,
    `<h1 style="font-size:22px;font-weight:800;color:#0F172A;margin:0 0 8px;">Counter offer received</h1>
     <p style="font-size:14px;color:#64748B;margin:0 0 24px;line-height:1.6;">Hi ${params.agencyName}, <strong>${params.ownerName}</strong> has sent a counter offer for <strong>${params.boardName}</strong>.</p>
     <table cellpadding="0" cellspacing="0" style="width:100%;background:#EFF6FF;border-radius:10px;padding:16px 20px;margin:0 0 8px;border:1px solid #BFDBFE;">
       <tbody>
         ${metaRow('Board', params.boardName)}
         ${metaRow('Owner', params.ownerName)}
         ${metaRow('Counter rate', `<span style="font-family:monospace;font-weight:700;color:#1D4ED8;">${amount}/mo</span>`)}
       </tbody>
     </table>
     ${btn('Respond to Offer', link)}`
  );

  await sendEmail(params.to, `Counter offer from ${params.ownerName} — ${params.boardName} at ${amount}/mo`, html);
}

// ── Board requests (MVP marketplace loop) ────────────────────────────────────
// Every value below can come from a user (board names, company names, notes),
// so it is escaped before going into the HTML.

function esc(s: string | null | undefined): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function ngDate(d: string | null | undefined): string {
  if (!d) return '—';
  const t = new Date(d);
  return isNaN(t.getTime()) ? '—' : t.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export type RequestEmailInfo = {
  boardName: string;
  location: string;
  startDate: string;
  endDate: string;
  buyerCompany: string;
  ownerName: string;
};

function requestTable(r: RequestEmailInfo, extra = ''): string {
  return `<table cellpadding="0" cellspacing="0" style="width:100%;background:#F8FAFC;border-radius:10px;padding:16px 20px;margin:0 0 8px;">
    <tbody>
      ${metaRow('Board', esc(r.boardName))}
      ${r.location ? metaRow('Location', esc(r.location)) : ''}
      ${metaRow('Dates', `${ngDate(r.startDate)} – ${ngDate(r.endDate)}`)}
      ${extra}
    </tbody>
  </table>`;
}

const h1 = (t: string) => `<h1 style="font-size:22px;font-weight:800;color:#0F172A;margin:0 0 8px;">${t}</h1>`;
const lead = (t: string) => `<p style="font-size:14px;color:#64748B;margin:0 0 24px;line-height:1.6;">${t}</p>`;

/** To the board's owner: a buyer wants this board. */
export async function emailRequestToOwner(to: string, r: RequestEmailInfo) {
  const html = emailWrap(
    `New request for ${esc(r.boardName)}`,
    `${h1('A buyer wants your board')}
     ${lead(`${esc(r.buyerCompany)} has asked whether <strong>${esc(r.boardName)}</strong> is available for their dates. Reply with your availability and price — buyers who hear back quickly are far more likely to book.`)}
     ${requestTable(r, metaRow('Buyer', esc(r.buyerCompany)))}
     ${btn('Reply to the request', `${APP_URL}/dashboard/owner/availability-requests`)}`,
  );
  await sendEmail(to, `New request: ${r.boardName} (${ngDate(r.startDate)} – ${ngDate(r.endDate)})`, html);
}

/** To the buyer: we have your request. */
export async function emailRequestConfirmation(to: string, r: RequestEmailInfo, ownerOnPlatform: boolean) {
  const html = emailWrap(
    `We've received your request for ${esc(r.boardName)}`,
    `${h1('Request received')}
     ${lead(ownerOnPlatform
       ? `We've sent your request to the media owner. You'll get an email as soon as they reply with availability and a price.`
       : `This board's owner isn't on the platform yet, so our team will contact them for you. You'll get an email as soon as we have availability and a price.`)}
     ${requestTable(r)}
     ${btn('Track your request', `${APP_URL}/dashboard/agency/requests`)}`,
  );
  await sendEmail(to, `Request received: ${r.boardName}`, html);
}

/** To our team: a new request came in. */
export async function emailRequestToAdmin(to: string, r: RequestEmailInfo, ownerOnPlatform: boolean) {
  const html = emailWrap(
    `New request for ${esc(r.boardName)} from ${esc(r.buyerCompany)}`,
    `${h1('New board request')}
     ${lead(ownerOnPlatform
       ? `${esc(r.buyerCompany)} requested a board owned by ${esc(r.ownerName)}. The owner has been notified.`
       : `<strong>Follow-up needed:</strong> the owner of this board has no account, so nobody has been notified but us.`)}
     ${requestTable(r, metaRow('Buyer', esc(r.buyerCompany)) + metaRow('Owner', esc(r.ownerName)))}
     ${btn('Open the Requests console', `${APP_URL}/dashboard/admin/requests`)}`,
  );
  await sendEmail(to, `${ownerOnPlatform ? 'New request' : 'Follow up'}: ${r.boardName} — ${r.buyerCompany}`, html);
}

/** To the buyer: the owner (or our team) answered. */
export async function emailOwnerReplied(to: string, r: RequestEmailInfo, reply: { available: boolean; rate: number | null; from: string | null; to: string | null; conditions: string | null; note: string | null }) {
  const price = reply.rate ? `<span style="font-size:18px;font-family:monospace;color:#0F172A;font-weight:800;">₦${Math.round(reply.rate).toLocaleString('en-NG')}</span> <span style="color:#94A3B8;font-weight:500;">per month</span>` : 'On request';
  const extra = reply.available
    ? metaRow('Price', price)
      + (reply.from || reply.to ? metaRow('Available', `${ngDate(reply.from ?? r.startDate)} – ${ngDate(reply.to ?? r.endDate)}`) : '')
      + (reply.conditions ? metaRow('Conditions', esc(reply.conditions)) : '')
    : metaRow('Status', '<span style="color:#B45309;">Not available for these dates</span>');
  const html = emailWrap(
    reply.available ? `${esc(r.boardName)} is available — see the price` : `${esc(r.boardName)} isn't available for your dates`,
    `${h1(reply.available ? 'The owner replied: available' : 'The owner replied')}
     ${lead(reply.available
       ? `Good news — <strong>${esc(r.boardName)}</strong> is available. Accept the offer, or negotiate in one conversation with the owner.`
       : `Unfortunately <strong>${esc(r.boardName)}</strong> isn't available for your dates. Browse other locations nearby — our team can also help you find an alternative.`)}
     ${requestTable(r, extra)}
     ${reply.note ? `<p style="font-size:13px;color:#475569;margin:12px 0 0;line-height:1.6;border-left:3px solid #E2E8F0;padding-left:12px;">${esc(reply.note)}</p>` : ''}
     ${reply.available ? btn('View the offer', `${APP_URL}/dashboard/agency/requests`) : btn('Find other locations', `${APP_URL}/marketplace`)}`,
  );
  await sendEmail(to, reply.available ? `Offer received: ${r.boardName}` : `Not available: ${r.boardName}`, html);
}

/** To the buyer, the owner or our team: a deal was agreed. */
export async function emailDealAgreed(to: string, r: RequestEmailInfo, who: 'buyer' | 'owner' | 'admin', rate: number | null) {
  const rateRow = rate ? metaRow('Agreed price', `<span style="font-family:monospace;font-weight:800;">₦${Math.round(rate).toLocaleString('en-NG')}</span> per month`) : '';
  const copy = {
    buyer: { title: 'Deal agreed', text: 'Request accepted. Our team will contact you shortly to complete the booking — no further action is needed right now.', link: `${APP_URL}/dashboard/agency/requests`, cta: 'View your request' },
    owner: { title: 'Deal agreed', text: `You and ${esc(r.buyerCompany)} agreed terms for <strong>${esc(r.boardName)}</strong>. Our team will contact you to complete the booking.`, link: `${APP_URL}/dashboard/owner/negotiations`, cta: 'View the deal' },
    admin: { title: 'Deal agreed — complete the booking', text: `${esc(r.buyerCompany)} and ${esc(r.ownerName)} agreed terms. Contact both sides to complete the booking, then move the request to Booking in progress.`, link: `${APP_URL}/dashboard/admin/requests`, cta: 'Open the Requests console' },
  }[who];
  const html = emailWrap(
    `${copy.title}: ${esc(r.boardName)}`,
    `${h1(copy.title)}
     ${lead(copy.text)}
     ${requestTable(r, metaRow('Buyer', esc(r.buyerCompany)) + rateRow)}
     ${btn(copy.cta, copy.link, '#059669')}`,
  );
  await sendEmail(to, `${who === 'admin' ? 'Action needed — deal agreed' : 'Deal agreed'}: ${r.boardName}`, html);
}
