'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';

/* ── animated counter hook ── */
function useCountUp(target: number, duration = 1800, start = false) {
  const [val, setVal] = useState(0);
  useEffect(() => {
    if (!start) return;
    let raf: number;
    const startTime = performance.now();
    function tick(now: number) {
      const p = Math.min((now - startTime) / duration, 1);
      const ease = 1 - Math.pow(1 - p, 3);
      setVal(Math.round(ease * target));
      if (p < 1) raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration, start]);
  return val;
}

function StatCounter({ value, suffix = '', prefix = '', label }: { value: number; suffix?: string; prefix?: string; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [started, setStarted] = useState(false);
  const count = useCountUp(value, 1600, started);
  useEffect(() => {
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) setStarted(true); }, { threshold: 0.5 });
    if (ref.current) obs.observe(ref.current);
    return () => obs.disconnect();
  }, []);
  return (
    <div ref={ref} style={{ textAlign: 'center' }}>
      <div style={{ fontSize: '2.5rem', fontWeight: 800, color: '#F8FAFC', letterSpacing: '-0.04em', fontFamily: 'monospace', lineHeight: 1 }}>
        {prefix}{count.toLocaleString()}{suffix}
      </div>
      <div style={{ fontSize: '0.8125rem', color: 'rgba(255,255,255,0.4)', marginTop: 6, fontWeight: 500 }}>{label}</div>
    </div>
  );
}

const FEATURES = [
  { icon: 'M1 6l7-4 8 4 7-4v16l-7 4-8-4-7 4V6 M8 2v16 M16 6v16', title: 'Billboard Marketplace', desc: 'Search, filter and discover every OOH surface in Nigeria — from unipoles to bridge panels.' },
  { icon: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z', title: 'Real-time Negotiations', desc: 'Message, counter-offer, accept or decline deals — all in one thread. No WhatsApp chains.' },
  { icon: 'M9 11l3 3L22 4 M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11', title: 'Compliance Tracking', desc: 'Field staff submit proof-of-posting via mobile. Clients see verification status in real time.' },
  { icon: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6', title: 'Media Plan PDFs', desc: 'Generate branded media plans and MPOs with one click. Impress clients, close deals faster.' },
  { icon: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2 M23 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75', title: 'Audience Intelligence', desc: 'Nigerian city profiles, footfall scoring, CPM calculator. Plan smarter, spend better.' },
  { icon: 'M22 12 18 12 15 21 9 3 6 12 2 12', title: 'Rate Intelligence', desc: 'Market rate benchmarks across formats and cities — so you never leave money on the table.' },
];

const HOW_IT_WORKS = [
  {
    role: 'Agencies',
    color: '#1B4F8A',
    accent: '#3B82F6',
    steps: ['Search boards by city, format & budget', 'Send booking requests & negotiate rates', 'Track campaigns, compliance & invoices'],
  },
  {
    role: 'Board Owners',
    color: '#7C3AED',
    accent: '#8B5CF6',
    steps: ['List your boards with photos & pricing', 'Receive & respond to booking requests', 'Track earnings and raise invoices'],
  },
  {
    role: 'Brands',
    color: '#059669',
    accent: '#10B981',
    steps: ['View your campaign boards on a live map', 'See compliance proof as it comes in', 'Monitor performance & approve budgets'],
  },
];

export default function LandingPage() {
  const [activeRole, setActiveRole] = useState(0);

  return (
    <div style={{ fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif", overflowX: 'hidden' }}>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeUp { from { opacity:0; transform:translateY(20px); } to { opacity:1; transform:translateY(0); } }
        @keyframes float { 0%,100% { transform:translateY(0px); } 50% { transform:translateY(-10px); } }
        @keyframes shimmer { 0% { background-position:-200% 0; } 100% { background-position:200% 0; } }
        .hero-fade { animation: fadeUp 0.7s cubic-bezier(0.22,1,0.36,1) forwards; }
        .hero-fade-2 { animation: fadeUp 0.7s 0.15s cubic-bezier(0.22,1,0.36,1) both; }
        .hero-fade-3 { animation: fadeUp 0.7s 0.3s cubic-bezier(0.22,1,0.36,1) both; }
        .hero-fade-4 { animation: fadeUp 0.7s 0.45s cubic-bezier(0.22,1,0.36,1) both; }
        .feat-card { transition: transform 0.2s, box-shadow 0.2s; }
        .feat-card:hover { transform: translateY(-4px); box-shadow: 0 12px 40px rgba(27,79,138,0.14); }
        .nav-link { transition: color 0.15s; }
        .nav-link:hover { color: #1B4F8A !important; }
        .cta-btn { transition: transform 0.15s, box-shadow 0.15s; }
        .cta-btn:hover { transform: translateY(-2px); box-shadow: 0 8px 28px rgba(27,79,138,0.4); }
        .role-tab { transition: all 0.2s; }
        .billboard-float { animation: float 4s ease-in-out infinite; }
      `}</style>

      {/* ── Navbar ── */}
      <nav style={{
        position: 'sticky', top: 0, zIndex: 100,
        background: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(16px)',
        borderBottom: '1px solid rgba(226,232,240,0.7)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 48px', height: 64,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 32, height: 32, background: '#0A1628', borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round">
              <rect x="3" y="3" width="18" height="5" rx="1.5"/><line x1="6" y1="8" x2="6" y2="21"/><line x1="18" y1="8" x2="18" y2="21"/>
            </svg>
          </div>
          <span style={{ fontSize: '1rem', fontWeight: 800, color: '#0F172A', letterSpacing: '-0.025em' }}>OOH Platform</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 32 }}>
          {['Features', 'How it works', 'Pricing'].map(l => (
            <a key={l} href={`#${l.toLowerCase().replace(/ /g, '-')}`} className="nav-link"
              style={{ fontSize: '0.875rem', fontWeight: 500, color: '#475569', textDecoration: 'none' }}>
              {l}
            </a>
          ))}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Link href="/auth/login" style={{ fontSize: '0.875rem', fontWeight: 600, color: '#475569', textDecoration: 'none', padding: '8px 16px' }}>
            Sign in
          </Link>
          <Link href="/signup" className="cta-btn" style={{
            fontSize: '0.875rem', fontWeight: 700, color: '#fff', textDecoration: 'none',
            background: '#1B4F8A', padding: '9px 20px', borderRadius: 10,
            boxShadow: '0 2px 12px rgba(27,79,138,0.3)',
          }}>
            Get started free
          </Link>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section style={{
        background: 'linear-gradient(160deg, #070E1A 0%, #0A1628 50%, #0D1F3C 100%)',
        padding: '100px 48px 80px', position: 'relative', overflow: 'hidden',
        minHeight: '88vh', display: 'flex', alignItems: 'center',
      }}>
        {/* Background orbs */}
        <div style={{ position: 'absolute', top: '10%', right: '8%', width: 500, height: 500, background: 'radial-gradient(circle, rgba(27,79,138,0.2) 0%, transparent 65%)', pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', bottom: '5%', left: '5%', width: 350, height: 350, background: 'radial-gradient(circle, rgba(124,58,237,0.12) 0%, transparent 65%)', pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', top: '40%', right: '30%', width: 200, height: 200, background: 'radial-gradient(circle, rgba(245,158,11,0.06) 0%, transparent 65%)', pointerEvents: 'none' }} />

        {/* Grid texture */}
        <div style={{ position: 'absolute', inset: 0, opacity: 0.025, backgroundImage: 'linear-gradient(rgba(255,255,255,0.8) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.8) 1px, transparent 1px)', backgroundSize: '48px 48px', pointerEvents: 'none' }} />

        <div style={{ maxWidth: 1200, margin: '0 auto', width: '100%', display: 'flex', alignItems: 'center', gap: 80 }}>
          {/* Left: text */}
          <div style={{ flex: 1 }}>
            <div className="hero-fade" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: 'rgba(27,79,138,0.35)', border: '1px solid rgba(59,130,246,0.3)', borderRadius: 999, padding: '5px 14px', marginBottom: 28 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#F59E0B', boxShadow: '0 0 8px rgba(245,158,11,0.6)' }} />
              <span style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.7)', fontWeight: 600, letterSpacing: '0.04em' }}>NIGERIA&apos;S OOH OPERATING SYSTEM</span>
            </div>

            <h1 className="hero-fade-2" style={{ fontSize: '3.75rem', fontWeight: 900, color: '#F8FAFC', letterSpacing: '-0.05em', lineHeight: 1.05, margin: '0 0 24px', maxWidth: 620 }}>
              The platform that runs outdoor advertising
            </h1>

            <p className="hero-fade-3" style={{ fontSize: '1.125rem', color: 'rgba(255,255,255,0.5)', lineHeight: 1.7, margin: '0 0 40px', maxWidth: 480 }}>
              Billboard owners list space. Agencies plan and book campaigns. Brands track results in real time. One platform — the whole transaction.
            </p>

            <div className="hero-fade-4" style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <Link href="/signup" className="cta-btn" style={{
                background: '#1B4F8A', color: '#fff', borderRadius: 12,
                padding: '14px 28px', fontSize: '1rem', fontWeight: 700,
                textDecoration: 'none', boxShadow: '0 4px 20px rgba(27,79,138,0.5)',
                display: 'inline-flex', alignItems: 'center', gap: 8,
              }}>
                Start for free
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
              </Link>
              <Link href="/marketplace" style={{
                background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.8)',
                border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12,
                padding: '14px 28px', fontSize: '1rem', fontWeight: 600,
                textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 8,
              }}>
                Browse boards
              </Link>
            </div>
          </div>

          {/* Right: billboard mockup */}
          <div className="billboard-float" style={{ flexShrink: 0, width: 360, display: 'flex', flexDirection: 'column', gap: 16, alignItems: 'flex-end' }}>
            {/* Main billboard card */}
            <div style={{ width: '100%', background: 'rgba(255,255,255,0.05)', backdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 20, overflow: 'hidden', boxShadow: '0 24px 64px rgba(0,0,0,0.4)' }}>
              <div style={{ height: 160, background: 'linear-gradient(135deg, #1E3A5F 0%, #1B4F8A 50%, #2563EB 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', overflow: 'hidden' }}>
                <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(90deg, rgba(255,255,255,0.03) 25%, rgba(255,255,255,0.08) 50%, rgba(255,255,255,0.03) 75%)', backgroundSize: '200% 100%', animation: 'shimmer 3s ease-in-out infinite' }} />
                <div style={{ textAlign: 'center', position: 'relative' }}>
                  <div style={{ fontSize: '0.625rem', color: 'rgba(255,255,255,0.4)', letterSpacing: '0.15em', marginBottom: 8 }}>VICTORIA ISLAND · LAGOS</div>
                  <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#fff', letterSpacing: '-0.03em' }}>Ozumba Gantry</div>
                  <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.5)', marginTop: 4 }}>18m × 5m · Illuminated</div>
                </div>
              </div>
              <div style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontSize: '0.625rem', color: 'rgba(255,255,255,0.35)', letterSpacing: '0.06em' }}>ASKING RATE</div>
                  <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#F8FAFC', letterSpacing: '-0.03em', fontFamily: 'monospace' }}>₦1.2M<span style={{ fontSize: '0.75rem', fontWeight: 400, color: 'rgba(255,255,255,0.35)' }}>/mo</span></div>
                </div>
                <div style={{ background: '#1B4F8A', color: '#fff', borderRadius: 8, padding: '8px 14px', fontSize: '0.75rem', fontWeight: 700, boxShadow: '0 4px 12px rgba(27,79,138,0.5)' }}>Book now</div>
              </div>
            </div>

            {/* Mini stat cards */}
            <div style={{ display: 'flex', gap: 10, width: '100%' }}>
              {[
                { label: 'Boards live', val: '143', color: '#3B82F6' },
                { label: 'Active deals', val: '28', color: '#10B981' },
                { label: 'Cities', val: '12', color: '#F59E0B' },
              ].map(({ label, val, color }) => (
                <div key={label} style={{ flex: 1, background: 'rgba(255,255,255,0.05)', backdropFilter: 'blur(16px)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14, padding: '12px', textAlign: 'center' }}>
                  <div style={{ fontSize: '1.25rem', fontWeight: 800, color, fontFamily: 'monospace' }}>{val}</div>
                  <div style={{ fontSize: '0.625rem', color: 'rgba(255,255,255,0.35)', marginTop: 2, fontWeight: 500 }}>{label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Stats bar ── */}
      <section style={{ background: '#0A1628', borderBottom: '1px solid rgba(255,255,255,0.06)', padding: '48px' }}>
        <div style={{ maxWidth: 900, margin: '0 auto', display: 'flex', justifyContent: 'space-around', gap: 32, flexWrap: 'wrap' }}>
          <StatCounter value={100} suffix="B+" prefix="₦" label="Nigeria OOH market value" />
          <StatCounter value={143} label="Billboard locations indexed" />
          <StatCounter value={12} label="Cities covered" />
          <StatCounter value={3} label="User roles, one platform" />
        </div>
      </section>

      {/* ── How it works ── */}
      <section id="how-it-works" style={{ background: '#F0F4FC', padding: '100px 48px' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 56 }}>
            <div style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#1B4F8A', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 12 }}>How it works</div>
            <h2 style={{ fontSize: '2.5rem', fontWeight: 800, color: '#0F172A', letterSpacing: '-0.04em', margin: '0 0 14px' }}>Built for everyone in OOH</h2>
            <p style={{ fontSize: '1.0625rem', color: '#64748B', margin: 0, maxWidth: 480, marginLeft: 'auto', marginRight: 'auto', lineHeight: 1.65 }}>
              Whether you own billboards, buy media space, or approve campaign spend — OOH Platform has a workspace built for you.
            </p>
          </div>

          {/* Role tabs */}
          <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginBottom: 48 }}>
            {HOW_IT_WORKS.map((r, i) => (
              <button key={r.role} className="role-tab" onClick={() => setActiveRole(i)}
                style={{
                  padding: '10px 24px', borderRadius: 10, border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                  fontWeight: 600, fontSize: '0.875rem', transition: 'all 0.2s',
                  background: activeRole === i ? r.color : '#fff',
                  color: activeRole === i ? '#fff' : '#64748B',
                  boxShadow: activeRole === i ? `0 4px 16px ${r.color}40` : '0 1px 4px rgba(0,0,0,0.06)',
                }}>
                {r.role}
              </button>
            ))}
          </div>

          {/* Steps */}
          {HOW_IT_WORKS.map((r, i) => i === activeRole && (
            <div key={r.role} style={{ display: 'flex', gap: 20, justifyContent: 'center', flexWrap: 'wrap' }}>
              {r.steps.map((step, j) => (
                <div key={step} style={{ flex: '1 1 260px', maxWidth: 320, background: '#fff', borderRadius: 18, padding: '28px 24px', boxShadow: '0 4px 20px rgba(0,0,0,0.05)', border: `1px solid ${r.color}18`, position: 'relative', overflow: 'hidden' }}>
                  <div style={{ position: 'absolute', top: 16, right: 16, width: 32, height: 32, background: `${r.color}12`, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.875rem', fontWeight: 800, color: r.color }}>
                    {j + 1}
                  </div>
                  <div style={{ width: 40, height: 4, background: r.accent, borderRadius: 99, marginBottom: 16 }} />
                  <p style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#0F172A', lineHeight: 1.5, margin: 0 }}>{step}</p>
                </div>
              ))}
            </div>
          ))}
        </div>
      </section>

      {/* ── Features ── */}
      <section id="features" style={{ background: '#fff', padding: '100px 48px' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 56 }}>
            <div style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#1B4F8A', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 12 }}>Features</div>
            <h2 style={{ fontSize: '2.5rem', fontWeight: 800, color: '#0F172A', letterSpacing: '-0.04em', margin: 0 }}>
              Everything OOH needs — nothing it doesn&apos;t
            </h2>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20 }}>
            {FEATURES.map(({ icon, title, desc }) => (
              <div key={title} className="feat-card" style={{ background: '#F8FAFC', border: '1px solid #E8EDF2', borderRadius: 18, padding: '28px 24px', cursor: 'default' }}>
                <div style={{ width: 44, height: 44, background: '#EFF6FF', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#1B4F8A" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                    <path d={icon} />
                  </svg>
                </div>
                <h3 style={{ fontSize: '1rem', fontWeight: 700, color: '#0F172A', margin: '0 0 8px', letterSpacing: '-0.01em' }}>{title}</h3>
                <p style={{ fontSize: '0.875rem', color: '#64748B', margin: 0, lineHeight: 1.65 }}>{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Pricing ── */}
      <section id="pricing" style={{ background: '#F0F4FC', padding: '100px 48px' }}>
        <div style={{ maxWidth: 900, margin: '0 auto', textAlign: 'center' }}>
          <div style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#1B4F8A', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 12 }}>Pricing</div>
          <h2 style={{ fontSize: '2.5rem', fontWeight: 800, color: '#0F172A', letterSpacing: '-0.04em', margin: '0 0 14px' }}>Simple, transparent pricing</h2>
          <p style={{ fontSize: '1.0625rem', color: '#64748B', margin: '0 auto 56px', maxWidth: 440, lineHeight: 1.65 }}>
            We take a 10% commission on completed bookings. No monthly fees, no hidden charges.
          </p>

          <div style={{ display: 'flex', gap: 20, justifyContent: 'center', flexWrap: 'wrap' }}>
            {[
              { name: 'Agencies', price: 'Free', note: 'to list & discover boards', highlight: false, color: '#1B4F8A', perks: ['Unlimited board search', 'Campaign planning tools', 'Audience intelligence', 'AI brief parsing', 'Media plan PDF export'] },
              { name: 'Board Owners', price: '10%', note: 'commission on bookings', highlight: true, color: '#7C3AED', perks: ['List unlimited boards', 'Receive booking requests', 'Negotiation thread', 'Invoice generation', 'Earnings analytics'] },
              { name: 'Brands', price: 'Free', note: 'campaign visibility', highlight: false, color: '#059669', perks: ['Real-time campaign map', 'Compliance dashboard', 'POE photo verification', 'Budget tracking', 'Performance reports'] },
            ].map(({ name, price, note, highlight, color, perks }) => (
              <div key={name} style={{
                flex: '1 1 240px', maxWidth: 290,
                background: highlight ? '#0A1628' : '#fff',
                border: `1px solid ${highlight ? 'rgba(255,255,255,0.1)' : '#E8EDF2'}`,
                borderRadius: 20, padding: '32px 28px',
                boxShadow: highlight ? '0 20px 60px rgba(10,22,40,0.4)' : '0 4px 20px rgba(0,0,0,0.04)',
                transform: highlight ? 'scale(1.04)' : 'none',
              }}>
                <div style={{ fontSize: '0.75rem', fontWeight: 700, color: highlight ? 'rgba(255,255,255,0.5)' : '#64748B', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 16 }}>{name}</div>
                <div style={{ fontSize: '3rem', fontWeight: 900, color: highlight ? '#F8FAFC' : color, letterSpacing: '-0.05em', lineHeight: 1, marginBottom: 4, fontFamily: 'monospace' }}>{price}</div>
                <div style={{ fontSize: '0.8125rem', color: highlight ? 'rgba(255,255,255,0.4)' : '#94A3B8', marginBottom: 28 }}>{note}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 28 }}>
                  {perks.map(p => (
                    <div key={p} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={highlight ? '#10B981' : color} strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                      <span style={{ fontSize: '0.8125rem', color: highlight ? 'rgba(255,255,255,0.7)' : '#374151' }}>{p}</span>
                    </div>
                  ))}
                </div>
                <Link href="/signup" style={{
                  display: 'block', textAlign: 'center',
                  background: highlight ? '#1B4F8A' : `${color}12`,
                  color: highlight ? '#fff' : color,
                  borderRadius: 10, padding: '11px', fontSize: '0.875rem', fontWeight: 700,
                  textDecoration: 'none', boxShadow: highlight ? '0 4px 16px rgba(27,79,138,0.4)' : 'none',
                }}>
                  Get started
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Final CTA ── */}
      <section style={{ background: 'linear-gradient(135deg, #0A1628 0%, #0D1F3C 100%)', padding: '100px 48px', textAlign: 'center', position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: 600, height: 600, background: 'radial-gradient(circle, rgba(27,79,138,0.25) 0%, transparent 65%)', pointerEvents: 'none' }} />
        <div style={{ position: 'relative' }}>
          <h2 style={{ fontSize: '3rem', fontWeight: 900, color: '#F8FAFC', letterSpacing: '-0.05em', margin: '0 0 16px', lineHeight: 1.1 }}>
            Ready to modernise<br />your OOH business?
          </h2>
          <p style={{ fontSize: '1.0625rem', color: 'rgba(255,255,255,0.45)', margin: '0 auto 40px', maxWidth: 400, lineHeight: 1.65 }}>
            Join agencies, billboard owners and brands already on OOH Platform.
          </p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link href="/signup" className="cta-btn" style={{
              background: '#1B4F8A', color: '#fff', borderRadius: 12,
              padding: '16px 36px', fontSize: '1.0625rem', fontWeight: 700,
              textDecoration: 'none', boxShadow: '0 4px 24px rgba(27,79,138,0.5)',
            }}>
              Create free account
            </Link>
            <Link href="/auth/login" style={{
              background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.8)',
              border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12,
              padding: '16px 36px', fontSize: '1.0625rem', fontWeight: 600,
              textDecoration: 'none',
            }}>
              Sign in
            </Link>
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer style={{ background: '#070E1A', padding: '40px 48px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 28, height: 28, background: '#1B4F8A', borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round">
              <rect x="3" y="3" width="18" height="5" rx="1.5"/><line x1="6" y1="8" x2="6" y2="21"/><line x1="18" y1="8" x2="18" y2="21"/>
            </svg>
          </div>
          <span style={{ fontSize: '0.875rem', fontWeight: 700, color: 'rgba(255,255,255,0.6)' }}>OOH Platform</span>
        </div>
        <p style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.2)', margin: 0 }}>
          © 2026 OOH Platform · Built for Nigeria, built for the world
        </p>
        <div style={{ display: 'flex', gap: 20 }}>
          {[['Sign in', '/auth/login'], ['Sign up', '/signup'], ['Browse boards', '/marketplace']].map(([label, href]) => (
            <Link key={label} href={href} style={{ fontSize: '0.8125rem', color: 'rgba(255,255,255,0.35)', textDecoration: 'none', fontWeight: 500 }}>{label}</Link>
          ))}
        </div>
      </footer>
    </div>
  );
}
