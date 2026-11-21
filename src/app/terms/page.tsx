import type { Metadata } from 'next';
import Link from 'next/link';
import LegalPage, { LEGAL_STATUS, Tbc, type LegalSection } from '@/components/legal/LegalPage';
import { teamWhatsAppLink, TEAM_WHATSAPP } from '@/lib/public-links';

export const metadata: Metadata = {
  title: 'Terms of use | OOH Platform',
  description: 'How OOH Platform works: board listings, requests, quotations, bookings, payment, cancellation, campaigns and complaints.',
  alternates: { canonical: '/terms' },
  // Kept out of search results while it is a draft.
  robots: LEGAL_STATUS.draft ? { index: false, follow: true } : undefined,
};

const wa = teamWhatsAppLink('Hi, I have a question about a booking on OOH Platform.');
const phone = TEAM_WHATSAPP ? `+${TEAM_WHATSAPP}` : null;

const sections: LegalSection[] = [
  {
    id: 'about', title: 'About these terms',
    body: <>
      <p>These terms apply when you use the OOH Platform website, create an account, send a request, accept a quotation or book advertising through us. &ldquo;We&rdquo; and &ldquo;us&rdquo; means OOH Platform. <Tbc>registered company name, RC number and registered address</Tbc></p>
      <p>By creating an account or sending a request you agree to these terms. Our <Link href="/privacy">Privacy notice</Link> explains how we use your information.</p>
    </>,
  },
  {
    id: 'what', title: 'What OOH Platform does',
    body: <>
      <p>We help advertisers, brands and agencies (&ldquo;buyers&rdquo;) find outdoor advertising sites in Nigeria, such as billboards, unipoles and digital screens, and book them with the companies that own or manage them (&ldquo;media owners&rdquo;). Our team checks availability with the media owner, sends you a quotation and arranges the booking.</p>
      <p>We are not the owner of the boards unless we say so. The media owner is responsible for the board itself, its permits, and putting up and maintaining your advert.</p>
    </>,
  },
  {
    id: 'listings', title: 'Board information',
    body: <>
      <p>Board details, photos, sizes and locations come from media owners, their rate cards and our own checks. We work to keep them accurate, and each listing shows whether it has been verified. Even so, details can be out of date: photos may be older, a pin on the map may be approximate, and surroundings change.</p>
      <p>Area figures such as estimated residents and nearby places come from public datasets. They are estimates of people living nearby, not traffic counts or guaranteed audiences.</p>
      <p>If something important to you (for example the exact position, size or lighting) is not confirmed on the listing, ask us before you accept a quotation.</p>
    </>,
  },
  {
    id: 'requests', title: 'Requests and availability',
    body: <>
      <p>Sending a request is free and does not book anything or commit you to pay. A board shown on the site may not be free for your dates. We confirm availability with the media owner after you send a request, and nothing is held for you until a booking is confirmed.</p>
    </>,
  },
  {
    id: 'quotations', title: 'Quotations and prices',
    body: <>
      <p>Prices are not shown on the website. After checking availability we send you a written quotation. It sets out the boards, dates, the price, any extra costs (such as printing, installation or production), VAT, how long the quotation is valid, and its payment and cancellation terms.</p>
      <p>The price in a quotation is our price to you for the booking and our service. It may differ from the media owner&apos;s own rate.</p>
      <p>A quotation is valid until the date shown on it. After that, the price and availability may change and we may need to send a new one. Approval of your artwork by ARCON, and any state signage permits or levies, are not included unless the quotation says so.</p>
    </>,
  },
  {
    id: 'booking', title: 'Accepting a quotation and booking',
    body: <>
      <p>You accept a quotation online in your account. Your acceptance is an offer to book on the terms of that quotation and these terms. The booking is confirmed only when our team confirms it with the media owner and tells you so. If the media owner can no longer provide a board, we will tell you and offer an alternative or cancel that part without charge.</p>
      <p>If the terms in a quotation differ from these terms, the quotation applies for that booking.</p>
    </>,
  },
  {
    id: 'payment', title: 'Payment',
    body: <>
      <p>You pay as set out in the quotation and the invoice we send you. Only pay into a bank account that our team has confirmed to you directly in writing. If you receive payment details you are unsure about, check with us on WhatsApp before paying.</p>
      <p>Unless your quotation says otherwise, full payment (100%) is due before your board is posted. We schedule posting once payment has been received in full. <Tbc>late payment</Tbc></p>
    </>,
  },
  {
    id: 'cancellation', title: 'Changes and cancellation',
    body: <>
      <p>The cancellation terms for a booking are those in its quotation. If you need to change dates or cancel, tell us as early as possible; the media owner may charge for cancellations, especially once printing or installation has started.</p>
      <p>Unless your quotation says otherwise, you can cancel free of charge, in writing, before your creative goes to print. Once printing or posting has started, payment is not refundable.</p>
    </>,
  },
  {
    id: 'campaign', title: 'Your advert and the campaign',
    body: <>
      <ul>
        <li>You are responsible for your advert: that you have the right to use its content, that it is lawful and truthful, and that it has any approval it needs, including from ARCON (and NAFDAC for food, drink and drug adverts).</li>
        <li>You must provide the artwork or print material by the date we agree. A late delivery may delay the start without changing the price.</li>
        <li>The media owner, or someone working for them, installs the advert. Weather, power cuts, road works or orders from the authorities can occasionally affect a board; we will tell you and work with the media owner on a fair remedy, such as extra days.</li>
        <li>We or the media owner may refuse or remove an advert that is unlawful, offensive, or breaks a permit condition.</li>
      </ul>
    </>,
  },
  {
    id: 'proof', title: 'Proof that your advert ran',
    body: <>
      <p>We ask media owners for dated photos (and, where possible, night photos or video) showing your advert in place, and share them with you in your account. <Tbc>when proof is sent and what happens if it is not provided</Tbc></p>
    </>,
  },
  {
    id: 'accounts', title: 'Your account',
    body: <>
      <p>Give accurate details, keep your password private, and tell us if you think your account has been misused. You are responsible for requests and acceptances made from your account. We may suspend an account that is used to mislead, to harass media owners or buyers, or to misuse the platform.</p>
      <p>Media owners must only list boards they own or are allowed to sell, with accurate details, and must honour availability they confirm.</p>
    </>,
  },
  {
    id: 'liability', title: 'Responsibilities and limits',
    body: <>
      <p>We will carry out our part with reasonable care and skill. We are not responsible for losses caused by things outside our reasonable control, or for the content of your advert. <Tbc>limit of liability (for example, the amount paid for the affected booking)</Tbc></p>
      <p>Nothing in these terms limits any right you have under Nigerian law that cannot be limited, including under the Federal Competition and Consumer Protection Act.</p>
    </>,
  },
  {
    id: 'complaints', title: 'Complaints and disputes',
    body: <>
      <p>If something goes wrong, please tell us first: message our team on WhatsApp{phone ? <> at <b>{phone}</b></> : null}{wa ? <> (<a href={wa} target="_blank" rel="noopener noreferrer">open WhatsApp</a>)</> : null}, or reply to any email we have sent you. Tell us the booking, what happened and what you would like us to do. We aim to reply within 2 working days and to resolve most issues within 14 days. <Tbc>complaint response times</Tbc></p>
      <p>If we cannot agree, either of us may refer the dispute to mediation before going to court. These terms are governed by the laws of the Federal Republic of Nigeria. <Tbc>mediation body and the courts of which state</Tbc></p>
    </>,
  },
  {
    id: 'changes', title: 'Changes to these terms',
    body: <p>We may update these terms. The date at the top shows the latest version. Changes do not affect a quotation you have already accepted.</p>,
  },
];

export default function TermsPage() {
  return (
    <LegalPage
      eyebrow="Terms"
      title="Terms of use"
      intro="How OOH Platform works: board listings, requests, quotations, bookings, payment, cancellation, campaigns and complaints."
      sections={sections}
      other={{ href: '/privacy', label: 'Privacy notice' }}
    />
  );
}
