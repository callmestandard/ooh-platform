import type { Metadata } from 'next';
import LegalPage, { LEGAL_STATUS, Tbc, type LegalSection } from '@/components/legal/LegalPage';
import { teamWhatsAppLink, TEAM_WHATSAPP } from '@/lib/public-links';

export const metadata: Metadata = {
  title: 'Privacy notice | OOH Platform',
  description: 'What information OOH Platform collects, why, who can see it, and how to ask us to see, correct or delete it.',
  alternates: { canonical: '/privacy' },
  // Kept out of search results while it is a draft.
  robots: LEGAL_STATUS.draft ? { index: false, follow: true } : undefined,
};

const wa = teamWhatsAppLink('Hi, I have a privacy request about my information on OOH Platform.');
const phone = TEAM_WHATSAPP ? `+${TEAM_WHATSAPP}` : null;

const sections: LegalSection[] = [
  {
    id: 'who', title: 'Who we are',
    body: <>
      <p>OOH Platform is a website for finding and booking billboards and other outdoor advertising in Nigeria. In this notice, &ldquo;we&rdquo; and &ldquo;us&rdquo; means OOH Platform, and we are responsible for the information described here. <Tbc>registered company name, RC number and registered address</Tbc></p>
      <p>We aim to handle personal information in line with the Nigeria Data Protection Act 2023.</p>
    </>,
  },
  {
    id: 'collect', title: 'What we collect and why',
    body: <>
      <table>
        <thead><tr><th>What</th><th>When</th><th>Why we use it</th></tr></thead>
        <tbody>
          <tr><td>Name, email, phone, company name, password and account type (buyer or media owner)</td><td>When you create an account</td><td>To run your account, let you sign in and contact you about your requests and bookings</td></tr>
          <tr><td>CAC (RC) and TIN numbers, if you give them</td><td>Media owners and agencies at sign-up or in settings</td><td>To check who we are dealing with and to prepare quotations and invoices</td></tr>
          <tr><td>The boards you ask about, your dates, budget and message</td><td>When you send a request</td><td>To check availability with the media owner and send you a quotation</td></tr>
          <tr><td>Quotations, bookings, invoices and payment records</td><td>When you accept a quotation or book</td><td>To deliver the booking, keep accounts and meet tax and legal duties</td></tr>
          <tr><td>Board details, photos, rate cards and the media owner&apos;s business contact details</td><td>From media owners, their rate cards, or our own checks</td><td>To list boards, confirm availability and arrange bookings</td></tr>
          <tr><td>Photos and videos showing an advert in place, and campaign files you upload</td><td>During a campaign</td><td>To show that an advert ran as agreed</td></tr>
          <tr><td>A random ID kept in your browser, and which pages and map features were used</td><td>When you use the website</td><td>To count, in total, how the site is used so we can improve it. It does not hold your name, email or IP address</td></tr>
        </tbody>
      </table>
      <p>We only use your information for the reasons above, or where the law requires it. We rely on: carrying out a contract with you or taking steps you asked for (requests, quotations, bookings); our legitimate interest in running and improving the service; legal duties such as keeping financial records; and your consent where we ask for it.</p>
      <p>We do not sell your personal information, and we do not use it for third-party advertising.</p>
    </>,
  },
  {
    id: 'browser', title: 'Cookies and browser storage',
    body: <>
      <p>We do not use advertising or tracking cookies. The website keeps a few items in your own browser&apos;s storage: your sign-in session, the boards you saved to your shortlist, and the random ID described above. You can clear these at any time in your browser settings; you will be signed out and your shortlist will be emptied.</p>
      <p>We use Vercel Web Analytics and Speed Insights to see page visits and loading speed in total. They do not use cookies.</p>
    </>,
  },
  {
    id: 'access', title: 'Who can see your information',
    body: <>
      <ul>
        <li><b>Our team</b> can see what is needed to handle requests, quotations, bookings and support.</li>
        <li><b>Media owners</b> see your company name and what you asked for (boards and dates), so they can confirm availability. Your email and phone number are shared only with our team, unless you agree otherwise to arrange a booking.</li>
        <li><b>Buyers</b> see board details and photos. They do not see a media owner&apos;s contact details or rate card.</li>
      </ul>
      <p>Access inside the platform is controlled by account type, and the database only returns each person the records they are allowed to see.</p>
    </>,
  },
  {
    id: 'providers', title: 'Service providers',
    body: <>
      <p>We use these companies to run the service. They handle information for us, under their own security and privacy terms, and only as needed for their part:</p>
      <ul>
        <li><b>Supabase</b>: database, sign-in and file storage. <Tbc>hosting region</Tbc></li>
        <li><b>Vercel</b>: hosts the website, and provides the page and speed statistics above.</li>
        <li><b>Google (Gmail)</b>: sends our emails to you.</li>
        <li><b>Mapbox</b>: shows maps and searches for places you type into the map.</li>
        <li><b>Mapillary (Meta)</b>: street-level photos, when you open that view.</li>
        <li><b>WhatsApp (Meta)</b>: only if you choose to message us on WhatsApp.</li>
        <li><b>Anthropic</b>: some planning tools for signed-in teams use an AI service to read board locations or a campaign brief you type in. We don&apos;t send it your account details.</li>
      </ul>
      <p>Some of these providers store or process information outside Nigeria. Where they do, we rely on their contractual and security commitments to protect it. <Tbc>transfer basis under the NDPA for each provider</Tbc></p>
      <p>We may also share information where the law requires it, or to protect our rights or someone&apos;s safety.</p>
    </>,
  },
  {
    id: 'storage', title: 'How we store and protect it',
    body: <>
      <p>Your information is stored in our database and file storage, protected by passwords and access rules, and sent over encrypted connections. Passwords are stored in scrambled (hashed) form and we cannot read them. No system is perfectly secure, so please use a strong password and tell us straight away if you think your account has been misused.</p>
      <p>We keep account information while your account is open, and records of quotations, bookings and payments for as long as tax and accounting law requires. <Tbc>retention periods for each type of record</Tbc></p>
    </>,
  },
  {
    id: 'rights', title: 'Your rights and how to use them',
    body: <>
      <p>You can ask us to:</p>
      <ul>
        <li>give you a copy of the personal information we hold about you;</li>
        <li>correct information that is wrong or incomplete (you can also edit most of it yourself in your account settings);</li>
        <li>delete your information, where we don&apos;t need to keep it for a booking or by law;</li>
        <li>stop or limit a use of your information, or withdraw consent you gave;</li>
        <li>send your information to you or another organisation in a common format.</li>
      </ul>
      <p>We will reply within 30 days. We may ask you to confirm who you are first. Media owners whose business details came from a rate card can ask for the same.</p>
      <p>If you are unhappy with how we handled your information, please tell us first. You can also complain to the Nigeria Data Protection Commission (NDPC).</p>
    </>,
  },
  {
    id: 'contact', title: 'Contact us about privacy',
    body: <>
      <p>
        Message our team on WhatsApp{phone ? <> at <b>{phone}</b></> : null}{wa ? <> (<a href={wa} target="_blank" rel="noopener noreferrer">open WhatsApp</a>)</> : null}, or reply to any email we have sent you, and say it is a privacy request. <Tbc>a dedicated privacy email address</Tbc>
      </p>
    </>,
  },
  {
    id: 'changes', title: 'Changes to this notice',
    body: <p>We will update this page when how we use information changes, and change the date at the top. If a change matters to you, we will tell you by email or when you next sign in.</p>,
  },
];

export default function PrivacyPage() {
  return (
    <LegalPage
      eyebrow="Privacy"
      title="Privacy notice"
      intro="What information we collect, why, who can see it, and how to ask us to see, correct or delete it."
      sections={sections}
      other={{ href: '/terms', label: 'Terms of use' }}
    />
  );
}
