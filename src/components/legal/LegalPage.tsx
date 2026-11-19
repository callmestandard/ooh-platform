import Link from 'next/link';
import ContentPageShell from '@/components/public/ContentPageShell';

/** Shown on every legal page until the business owner and legal counsel approve it. */
export const LEGAL_STATUS = { draft: true, updated: '19 November 2026' };

export type LegalSection = { id: string; title: string; body: React.ReactNode };

/** Something the business still has to decide. Shown in amber so it can't pass as settled. */
export function Tbc({ children }: { children: React.ReactNode }) {
  return <span className="lg-tbc" title="Still to be confirmed">To confirm: {children}</span>;
}

export default function LegalPage({ eyebrow, title, intro, sections, other }: {
  eyebrow: string; title: string; intro: string; sections: LegalSection[];
  other: { href: string; label: string };
}) {
  return (
    <ContentPageShell eyebrow={eyebrow} title={title} intro={intro}>
      <style>{CSS}</style>
      {LEGAL_STATUS.draft && (
        <div className="lg-draft" role="note" data-legal-draft>
          <b>Draft for review.</b> This document has not yet been approved by OOH Platform or reviewed by a Nigerian lawyer, and may change.
          Parts marked <span className="lg-tbc lg-tbc-inline">To confirm</span> are still being decided.
        </div>
      )}
      <p className="lg-meta">Last updated {LEGAL_STATUS.updated} · See also our <Link href={other.href}>{other.label}</Link></p>

      <nav className="lg-toc" aria-label="On this page">
        <p>On this page</p>
        <ol>{sections.map(s => <li key={s.id}><a href={`#${s.id}`}>{s.title}</a></li>)}</ol>
      </nav>

      {sections.map((s, i) => (
        <section key={s.id} id={s.id} className="lg-sec">
          <h2><span>{i + 1}.</span> {s.title}</h2>
          {s.body}
        </section>
      ))}
    </ContentPageShell>
  );
}

const CSS = `
  .lg-draft { background: #FFFBEB; border: 1px solid #FDE68A; color: #78350F; border-radius: 12px; padding: 14px 16px; font-size: .9rem; line-height: 1.6; margin-bottom: 18px; }
  .lg-meta { color: #64748B; font-size: .8125rem; margin: 0 0 22px; }
  .lg-meta a, .lg-sec a { color: #1B4F8A; font-weight: 600; text-decoration: none; border-bottom: 1px solid rgba(27,79,138,.25); }
  .lg-toc { background: #fff; border: 1px solid #E2E8F0; border-radius: 12px; padding: 16px 20px; margin-bottom: 28px; }
  .lg-toc p { margin: 0 0 8px; font-size: .75rem; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: #64748B; }
  .lg-toc ol { margin: 0; padding-left: 20px; columns: 2; column-gap: 28px; font-size: .875rem; line-height: 1.9; }
  .lg-toc a { color: #334155; text-decoration: none; }
  .lg-toc a:hover { color: #1B4F8A; }
  .lg-sec { scroll-margin-top: 80px; padding: 4px 0 10px; }
  .lg-sec h2 { font-size: 1.1875rem; font-weight: 750; letter-spacing: -.01em; margin: 22px 0 10px; color: #0F172A; }
  .lg-sec h2 span { color: #94A3B8; font-weight: 600; margin-right: 2px; }
  .lg-sec p, .lg-sec li { color: #334155; font-size: .9375rem; line-height: 1.7; }
  .lg-sec p { margin: 0 0 12px; }
  .lg-sec ul { margin: 0 0 12px; padding-left: 20px; }
  .lg-sec li { margin-bottom: 6px; }
  .lg-sec table { width: 100%; border-collapse: collapse; margin: 4px 0 14px; font-size: .875rem; background: #fff; border: 1px solid #E2E8F0; border-radius: 10px; overflow: hidden; }
  .lg-sec th, .lg-sec td { text-align: left; vertical-align: top; padding: 10px 12px; border-bottom: 1px solid #F1F5F9; color: #334155; line-height: 1.55; }
  .lg-sec th { background: #F8FAFC; color: #0F172A; font-weight: 650; font-size: .8125rem; }
  .lg-tbc { display: inline; background: #FEF3C7; color: #92400E; border-radius: 6px; padding: 1px 6px; font-size: .8125rem; font-weight: 600; box-decoration-break: clone; -webkit-box-decoration-break: clone; }
  .lg-tbc-inline { padding: 0 5px; }
  @media (max-width: 640px) {
    .lg-toc ol { columns: 1; }
    .lg-sec table, .lg-sec thead, .lg-sec tbody, .lg-sec tr, .lg-sec th, .lg-sec td { display: block; }
    .lg-sec thead { display: none; }
    .lg-sec td { border-bottom: none; padding: 4px 12px; }
    .lg-sec tr { border-bottom: 1px solid #F1F5F9; padding: 8px 0; }
    .lg-sec td:first-child { font-weight: 650; color: #0F172A; }
  }
`;
