import type { Metadata } from 'next';
import Link from 'next/link';
import ContentPageShell from '@/components/public/ContentPageShell';
import { FORMAT_GUIDE, type FormatGuideEntry } from '@/lib/ooh-formats-guide';
import { boardFormatLabel } from '@/lib/board-formats';

const BASE = process.env.NEXT_PUBLIC_APP_URL || 'https://ooh-platform-xi.vercel.app';

export const metadata: Metadata = {
  title: 'Out-of-Home Advertising Formats in Nigeria — A Plain-Language Guide | OOH Platform',
  description: 'What each outdoor advertising format is, what it is good for and where it works: billboards, unipoles, gantries, bridge panels, wall drapes, LED screens and more.',
  alternates: { canonical: `${BASE}/formats` },
};

// Label comes from the board-type taxonomy wherever the entry maps to one, so
// this page and the board data always use the same names.
function entryName(e: FormatGuideEntry) {
  return e.formats ? boardFormatLabel(e.formats[0]) : e.name ?? e.slug;
}

export default function FormatsGuidePage() {
  return (
    <ContentPageShell
      eyebrow="Guide"
      title="Out-of-home advertising formats in Nigeria"
      intro="What each format is, what it is good for, and the kinds of locations that suit it. Sizes and prices vary from site to site, so this guide does not quote them."
    >
      <nav aria-label="Formats" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 28 }}>
        {FORMAT_GUIDE.map(e => (
          <a key={e.slug} href={`#${e.slug}`} style={{ padding: '6px 12px', borderRadius: 999, background: '#fff', border: '1px solid #E2E8F0', color: '#1B4F8A', fontSize: '0.8125rem', fontWeight: 600, textDecoration: 'none' }}>
            {entryName(e)}
          </a>
        ))}
      </nav>

      {FORMAT_GUIDE.map(e => (
        <section key={e.slug} id={e.slug} style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 14, padding: '24px 26px', marginBottom: 18, scrollMarginTop: 76 }}>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 800, letterSpacing: '-0.02em', margin: '0 0 10px' }}>{entryName(e)}</h2>
          <p style={{ fontSize: '0.9375rem', lineHeight: 1.65, color: '#334155', margin: '0 0 16px' }}>{e.description}</p>

          <h3 style={{ fontSize: '0.75rem', fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 6px' }}>Typical uses</h3>
          <ul style={{ margin: '0 0 16px', paddingLeft: 20, color: '#334155', fontSize: '0.9375rem', lineHeight: 1.65 }}>
            {e.useCases.map(u => <li key={u}>{u}</li>)}
          </ul>

          <h3 style={{ fontSize: '0.75rem', fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 6px' }}>Where it works</h3>
          <p style={{ fontSize: '0.9375rem', lineHeight: 1.65, color: '#334155', margin: '0 0 16px' }}>{e.locations}</p>

          {e.formats ? (
            <Link href={`/marketplace?format=${e.formats[0]}`} style={{ display: 'inline-block', padding: '8px 16px', borderRadius: 8, background: '#1B4F8A', color: '#fff', fontSize: '0.8125rem', fontWeight: 600, textDecoration: 'none' }}>
              Browse {entryName(e)} boards — sign-in required →
            </Link>
          ) : (
            <p style={{ fontSize: '0.8125rem', color: '#94A3B8', margin: 0 }}>
              This is not a separate board type on the platform yet, so there is no filtered listing for it.
            </p>
          )}
        </section>
      ))}

      <p style={{ fontSize: '0.875rem', color: '#64748B', marginTop: 24 }}>
        Unfamiliar term? See the <Link href="/glossary" style={{ color: '#1B4F8A', fontWeight: 600 }}>glossary</Link>.
      </p>
    </ContentPageShell>
  );
}
