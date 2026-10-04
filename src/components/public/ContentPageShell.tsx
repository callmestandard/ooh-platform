import Link from 'next/link';

type Props = {
  eyebrow: string;
  title: string;
  intro: string;
  children: React.ReactNode;
};

const NAV_LINKS = [
  { href: '/formats', label: 'Formats guide' },
  { href: '/glossary', label: 'Glossary' },
];

/** Shared chrome (nav, hero, footer) for the public educational pages. */
export default function ContentPageShell({ eyebrow, title, intro, children }: Props) {
  return (
    <div style={{ minHeight: '100vh', background: '#F8FAFC', fontFamily: "'Inter', sans-serif", color: '#0F172A' }}>
      <nav style={{
        position: 'sticky', top: 0, zIndex: 100,
        background: '#0F172A', borderBottom: '1px solid rgba(255,255,255,0.07)',
        padding: '0 24px', height: 60,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
      }}>
        <Link href="/" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <div style={{ width: 28, height: 28, borderRadius: 7, background: 'linear-gradient(135deg, #1B4F8A, #3B82F6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ color: '#fff', fontSize: 14, fontWeight: 800 }}>O</span>
          </div>
          <span style={{ color: '#fff', fontWeight: 700, fontSize: '0.9375rem', letterSpacing: '-0.02em' }}>OOH Platform</span>
        </Link>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          {NAV_LINKS.map(l => (
            <Link key={l.href} href={l.href} style={{ color: '#94A3B8', textDecoration: 'none', fontSize: '0.875rem', fontWeight: 500, whiteSpace: 'nowrap' }}>{l.label}</Link>
          ))}
          <Link href="/auth/login" style={{ background: '#F59E0B', color: '#fff', textDecoration: 'none', padding: '7px 16px', borderRadius: 8, fontSize: '0.8125rem', fontWeight: 600, whiteSpace: 'nowrap' }}>
            Sign in
          </Link>
        </div>
      </nav>

      <header style={{ background: 'linear-gradient(160deg, #0F172A 0%, #1B4F8A 100%)', padding: '52px 24px 48px' }}>
        <div style={{ maxWidth: 820, margin: '0 auto' }}>
          <p style={{ color: '#F59E0B', fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', margin: '0 0 12px' }}>{eyebrow}</p>
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
