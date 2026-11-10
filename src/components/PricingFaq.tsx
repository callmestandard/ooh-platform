// Billboard pricing questions buyers ask first. Shared by the homepage and the
// city pages (which also publish them to Google as FAQ data).
// Prices are set by each board's media owner; the ranges below are a rough
// guide drawn from boards listed on the platform, never one board's rate.

export type Faq = { q: string; a: string };

export function pricingFaqs(city?: string): Faq[] {
  const where = city ? `in ${city}` : 'in Nigeria';
  return [
    {
      q: `How much does a billboard cost ${where}?`,
      a: `Every board's price is set by its media owner. It depends on the city, the road, the size and the format. As a rough guide from boards listed with us: billboards and unipoles in cities like Ibadan, Port Harcourt, Kano or Enugu usually start from about ₦400,000 to ₦850,000 a month. Prime roads and LED screens in Lagos and Abuja often cost ₦2 million to ₦7 million a month. To get the exact price for your dates, request the board and the owner will send you a quote.`,
    },
    {
      q: 'Why is the price not shown on every board?',
      a: 'Media owners choose whether to show their rate. Many quote per campaign, because the price changes with your dates, how long you book, and how many boards you take. Send a request with your dates and the owner replies with availability and a price.',
    },
    {
      q: 'What other costs should I plan for?',
      a: 'Besides the monthly rate, plan for: printing the flex or vinyl (or making the video file for an LED screen); installation, also called flighting; and approval of your artwork by ARCON, the Advertising Regulatory Council of Nigeria (formerly APCON), which every outdoor ad needs. Food, drink and drug ads may also need NAFDAC approval. Some states charge signage permits or levies, such as LASAA in Lagos. Owners often include some of these in their quote, so ask the owner what their price covers. VAT may also apply.',
    },
    {
      q: 'Can I negotiate the price?',
      a: "Yes. When the owner sends a quote, you can accept it or reply with your own offer in the same conversation, until you both agree.",
    },
    {
      q: 'Who owns the boards, and who do I pay?',
      a: "The boards are listed by the media owners who own them. We work directly with the owners, and each listing shows whether and when it was last verified. Once you accept a quote, our team contacts you and the owner to complete the booking and payment.",
    },
    {
      q: 'How long can I book a board for?',
      a: 'Most boards are booked by the month. If you need a shorter or longer run, put your dates in the request and the owner will tell you what they can do.',
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
