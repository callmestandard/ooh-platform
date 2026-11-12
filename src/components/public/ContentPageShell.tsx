import Link from 'next/link';
import SiteHeader from '@/components/public/SiteHeader';

type Props = {
  eyebrow: string;
  title: string;
  intro: string;
  children: React.ReactNode;
};

/** Shared chrome (nav, hero, footer) for the public educational pages. */
export default function ContentPageShell({ eyebrow, title, intro, children }: Props) {
  return (
    <div style={{ minHeight: '100vh', background: '#F8FAFC', fontFamily: "'Inter', sans-serif", color: '#0F172A' }}>
      <SiteHeader />

      <header style={{ background: 'linear-gradient(160deg, #0F172A 0%, #1B4F8A 100%)', padding: '52px 24px 48px' }}>
        <div style={{ maxWidth: 820, margin: '0 auto' }}>
          <p style={{ color: '#BFDBFE', fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', margin: '0 0 12px' }}>{eyebrow}</p>
          <h1 style={{ color: '#fff', fontSize: 'clamp(1.75rem, 4vw, 2.5rem)', fontWeight: 800, letterSpacing: '-0.03em', lineHeight: 1.15, margin: '0 0 14px' }}>{title}</h1>
          <p style={{ color: '#CBD5E1', fontSize: '1rem', lineHeight: 1.6, margin: 0, maxWidth: 640 }}>{intro}</p>
        </div>
      </header>

      <main style={{ maxWidth: 820, margin: '0 auto', padding: '36px 24px 64px' }}>{children}</main>

      <footer style={{ borderTop: '1px solid #E2E8F0', padding: '24px', textAlign: 'center', fontSize: '0.8125rem', color: '#94A3B8' }}>
        <Link href="/formats" style={{ color: '#64748B', textDecoration: 'none', margin: '0 10px' }}>Formats guide</Link>
        <Link href="/glossary" style={{ color: '#64748B', textDecoration: 'none', margin: '0 10px' }}>Glossary</Link>
        <Link href="/" style={{ color: '#64748B', textDecoration: 'none', margin: '0 10px' }}>Home</Link>
      </footer>
    </div>
  );
}
