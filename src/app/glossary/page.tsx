import type { Metadata } from 'next';
import Link from 'next/link';
import ContentPageShell from '@/components/public/ContentPageShell';
import GlossarySearch from './GlossarySearch';
import { GLOSSARY } from '@/lib/ooh-glossary';

const BASE = process.env.NEXT_PUBLIC_APP_URL || 'https://ooh-platform-xi.vercel.app';

export const metadata: Metadata = {
  title: 'Out-of-Home Advertising Glossary — Nigerian OOH Terms Explained | OOH Platform',
  description: 'Plain-language definitions of the terms used in Nigerian outdoor advertising: MPO, POE, rate card, gross and net, GRP, CPM, LASAA, ARCON and more.',
  alternates: { canonical: `${BASE}/glossary` },
};

export default function GlossaryPage() {
  const terms = [...GLOSSARY].sort((a, b) => a.term.localeCompare(b.term));
  return (
    <ContentPageShell
      eyebrow="Glossary"
      title="Out-of-home advertising terms, explained"
      intro="Plain-language definitions of the words and abbreviations used when planning and buying outdoor advertising in Nigeria."
    >
      <GlossarySearch terms={terms} />
      <p style={{ fontSize: '0.875rem', color: '#64748B', marginTop: 24 }}>
        Looking for the differences between board types? See the <Link href="/formats" style={{ color: '#1B4F8A', fontWeight: 600 }}>formats guide</Link>.
      </p>
    </ContentPageShell>
  );
}
