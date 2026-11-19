// Billboard pricing questions buyers ask first. Shared by the homepage and the
// city pages (which also publish them to Google as FAQ data).
// No price figures here: prices aren't shown to buyers (SHOW_PRICES), and any
// figure would have to be backed by confirmed, current rates.

export type Faq = { q: string; a: string };

export function pricingFaqs(city?: string): Faq[] {
  const where = city ? `in ${city}` : 'in Nigeria';
  return [
    {
      q: `How much does a billboard cost ${where}?`,
      a: `It depends on the board: the city, the road, the size, the format (a printed board or a digital screen) and how long you book. Rates also change during the year. Send a request with your dates and our team checks availability with the media owner and sends you a written quotation. Requesting is free and doesn't commit you to anything.`,
    },
    {
      q: 'Why don’t you show prices on the site?',
      a: 'Because a price is only reliable once the board is confirmed free for your dates. Rather than show a figure that might be out of date, we check with the media owner first and give you an exact quotation for your dates, with everything it includes.',
    },
    {
      q: 'What other costs should I plan for?',
      a: 'Besides the space itself, plan for: printing the flex or vinyl (or making the video file for a digital screen); installation, also called flighting; and approval of your artwork by ARCON, the Advertising Regulatory Council of Nigeria (formerly APCON), which every outdoor ad needs. Food, drink and drug ads may also need NAFDAC approval. Some states charge signage permits or levies, such as LASAA in Lagos. VAT may also apply. Your quotation shows which of these are included.',
    },
    {
      q: 'Can I negotiate the price?',
      a: 'Yes. If a quotation doesn’t work for you, tell us your budget or what you’d like to change (dates, length, number of boards) and we’ll see what the media owner can do.',
    },
    {
      q: 'Who owns the boards, and who do I pay?',
      a: 'The boards belong to media owners across Nigeria. We check availability with the owner, send you the quotation, and once you accept it we confirm the booking with the owner. You pay as set out in your quotation and invoice, and only into an account our team has confirmed to you. Nothing is booked until we confirm it.',
    },
    {
      q: 'How long can I book a board for?',
      a: 'Most boards are booked by the month. If you need a shorter or longer run, put your dates in the request and we’ll tell you what’s possible.',
    },
  ];
}

export function faqJsonLd(faqs: Faq[]) {
  return {
    '@type': 'FAQPage',
    mainEntity: faqs.map(f => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
  };
}

export default function PricingFaqList({ faqs, ink = '#0F172A', muted = '#475569', line = '#E2E8F0', accent = '#1B4F8A' }: {
  faqs: Faq[]; ink?: string; muted?: string; line?: string; accent?: string;
}) {
  return (
    <div data-pricing-faq>
      <style>{`
        .pfaq-item summary { cursor: pointer; list-style: none; user-select: none; }
        .pfaq-item summary::-webkit-details-marker { display: none; }
        .pfaq-item[open] summary { color: ${accent}; }
        .pfaq-item[open] .pfaq-plus { transform: rotate(45deg); }
        .pfaq-plus { transition: transform .15s; }
      `}</style>
      {faqs.map((f, i) => (
        <details key={f.q} className="pfaq-item" open={i === 0} style={{ borderTop: `1px solid ${line}` }}>
          <summary style={{ padding: '18px 0', fontWeight: 600, fontSize: '1rem', color: ink, lineHeight: 1.4, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
            {f.q}
            <span className="pfaq-plus" aria-hidden="true" style={{ color: muted, fontSize: '1.375rem', lineHeight: 1, flexShrink: 0 }}>+</span>
          </summary>
          <p style={{ color: muted, fontSize: '0.9375rem', lineHeight: 1.7, margin: '0 0 18px', maxWidth: 760 }}>{f.a}</p>
        </details>
      ))}
      <div style={{ borderTop: `1px solid ${line}` }} />
    </div>
  );
}
