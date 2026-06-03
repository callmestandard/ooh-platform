'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import type { DemoRole } from '@/lib/constants';

const DONE_KEY = (role: DemoRole) => `ooh_onboarding_${role}_done`;

/* ── Step definitions ─────────────────────────────────────────────────── */

type Step = {
  id: string;
  title: string;
  subtitle: string;
};

const AGENCY_STEPS: Step[] = [
  { id: 'welcome',  title: 'Welcome to OOH Platform',       subtitle: 'Your full-stack OOH command centre is ready.' },
  { id: 'profile',  title: 'Tell us about your agency',     subtitle: 'This appears on media plans and MPOs you send to clients.' },
  { id: 'done',     title: 'You\'re all set, Alex.',        subtitle: 'Here\'s where to start.' },
];

const OWNER_STEPS: Step[] = [
  { id: 'welcome',  title: 'Welcome to OOH Platform',       subtitle: 'Start listing your boards and receiving booking requests.' },
  { id: 'contact',  title: 'Your contact details',          subtitle: 'Agencies will see this when they view your boards.' },
  { id: 'done',     title: 'Ready to go.',                  subtitle: 'Post your first board and start earning.' },
];

const CLIENT_STEPS: Step[] = [
  { id: 'welcome',  title: 'Your campaign dashboard',       subtitle: 'Track your boards, compliance and spend in real time.' },
  { id: 'done',     title: 'All caught up.',                subtitle: 'Your agency keeps this dashboard updated for you.' },
];

const STEPS: Record<DemoRole, Step[]> = {
  agency: AGENCY_STEPS,
  owner:  OWNER_STEPS,
  client: CLIENT_STEPS,
  admin:  [],
};

/* ── Quick-action cards shown on the Done step ─────────────────────────── */

const AGENCY_ACTIONS = [
  { icon: 'M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z M12 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6z', label: 'Find boards', sub: 'Search by city & format', href: '/dashboard/agency/marketplace', color: '#1B4F8A' },
  { icon: 'M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2 M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2 M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2', label: 'New campaign', sub: 'Plan, book and track', href: '/dashboard/agency/campaigns', color: '#7C3AED' },
  { icon: 'M12 20h9 M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z', label: 'Try AI brief', sub: 'Describe → auto-fill plan', href: '/dashboard/agency/campaign-planner', color: '#F59E0B' },
];

const OWNER_ACTIONS = [
  { icon: 'M12 5v14 M5 12h14', label: 'Post a board', sub: 'List your first inventory', href: '/dashboard/owner/post-board', color: '#7C3AED' },
  { icon: 'M8 6h13 M8 12h13 M8 18h13 M3 6h.01 M3 12h.01 M3 18h.01', label: 'View bookings', sub: 'See incoming requests', href: '/dashboard/owner?tab=bookings', color: '#1B4F8A' },
];

const CLIENT_ACTIONS = [
  { icon: 'M1 6l7-4 8 4 7-4v16l-7 4-8-4-7 4V6 M8 2v16 M16 6v16', label: 'View your boards', sub: 'See where you\'re live', href: '/dashboard/client?tab=board-status', color: '#059669' },
  { icon: 'M9 11l3 3L22 4 M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11', label: 'Compliance', sub: 'Check proof of posting', href: '/dashboard/client?tab=compliance', color: '#1B4F8A' },
];

const ACTIONS: Record<DemoRole, typeof AGENCY_ACTIONS> = {
  agency: AGENCY_ACTIONS,
  owner:  OWNER_ACTIONS,
  client: CLIENT_ACTIONS,
  admin:  [],
};

/* ── Component ─────────────────────────────────────────────────────────── */

export default function OnboardingWizard({ role, userName }: { role: DemoRole; userName: string }) {
  const router = useRouter();
  const steps  = STEPS[role];
  const [visible,  setVisible]  = useState(false);
  const [step,     setStep]     = useState(0);
  const [animDir,  setAnimDir]  = useState<'forward' | 'back'>('forward');
  const [animKey,  setAnimKey]  = useState(0);

  // Form state
  const [companyName, setCompanyName] = useState('');
  const [city,        setCity]        = useState('');
  const [phone,       setPhone]       = useState('');

  useEffect(() => {
    if (role === 'admin' || !steps.length) return;
    const done = localStorage.getItem(DONE_KEY(role));
    if (!done) setVisible(true);
  }, [role, steps.length]);

  function dismiss() {
    localStorage.setItem(DONE_KEY(role), '1');
    setVisible(false);
  }

  function saveAndNext() {
    const current = steps[step];

    if (role === 'agency' && current.id === 'profile') {
      if (companyName.trim()) {
        localStorage.setItem('ooh_company_name', companyName.trim());
        localStorage.setItem(`ooh_settings_agency_profile`, JSON.stringify({ company: companyName.trim(), city, phone }));
      }
    }
    if (role === 'owner' && current.id === 'contact') {
      if (phone.trim()) localStorage.setItem(`ooh_settings_owner_phone`, phone.trim());
      if (city.trim())  localStorage.setItem(`ooh_settings_owner_city`, city.trim());
    }

    if (step < steps.length - 1) {
      setAnimDir('forward');
      setAnimKey(k => k + 1);
      setStep(s => s + 1);
    } else {
      dismiss();
    }
  }

  function goBack() {
    if (step > 0) {
      setAnimDir('back');
      setAnimKey(k => k + 1);
      setStep(s => s - 1);
    }
  }

  function navigateAndDismiss(href: string) {
    dismiss();
    router.push(href);
  }

  if (!visible || !steps.length) return null;

  const current  = steps[step];
  const isLast   = step === steps.length - 1;
  const actions  = ACTIONS[role];
  const firstName = userName.split(' ')[0];

  return (
    <>
      <style>{`
        @keyframes wizardIn { from { opacity:0; transform:scale(0.95) translateY(12px); } to { opacity:1; transform:scale(1) translateY(0); } }
        @keyframes slideForward { from { opacity:0; transform:translateX(32px); } to { opacity:1; transform:translateX(0); } }
        @keyframes slideBack    { from { opacity:0; transform:translateX(-32px); } to { opacity:1; transform:translateX(0); } }
        .wiz-enter-forward { animation: slideForward 0.28s cubic-bezier(0.22,1,0.36,1) forwards; }
        .wiz-enter-back    { animation: slideBack    0.28s cubic-bezier(0.22,1,0.36,1) forwards; }
        .wiz-action:hover { transform: translateY(-2px); box-shadow: 0 8px 24px rgba(0,0,0,0.1) !important; }
        .wiz-action { transition: transform 0.15s, box-shadow 0.15s; }
        .wiz-btn:hover { opacity: 0.88; }
        .wiz-input:focus { border-color: #1B4F8A !important; box-shadow: 0 0 0 3px rgba(27,79,138,0.1); }
      `}</style>

      {/* Backdrop */}
      <div style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(10,22,40,0.65)', backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
      }}>
        {/* Modal */}
        <div style={{
          width: '100%', maxWidth: 480,
          background: 'rgba(255,255,255,0.96)', backdropFilter: 'blur(20px)',
          border: '1px solid rgba(255,255,255,0.6)',
          borderRadius: 24, overflow: 'hidden',
          boxShadow: '0 32px 80px rgba(0,0,0,0.25)',
          animation: 'wizardIn 0.35s cubic-bezier(0.22,1,0.36,1) forwards',
        }}>

          {/* Progress bar */}
          <div style={{ height: 3, background: '#F1F5F9' }}>
            <div style={{
              height: '100%', background: 'linear-gradient(90deg, #1B4F8A, #3B82F6)',
              width: `${((step + 1) / steps.length) * 100}%`,
              transition: 'width 0.4s cubic-bezier(0.22,1,0.36,1)',
              borderRadius: 99,
            }} />
          </div>

          {/* Header */}
          <div style={{ padding: '28px 32px 0', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
            {/* Step dots */}
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              {steps.map((_, i) => (
                <div key={i} style={{
                  width: i === step ? 20 : 6, height: 6, borderRadius: 99,
                  background: i <= step ? '#1B4F8A' : '#E2E8F0',
                  transition: 'all 0.3s ease',
                }} />
              ))}
            </div>
            <button onClick={dismiss} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#CBD5E1', padding: 4, lineHeight: 1, fontSize: 18 }}>
              ✕
            </button>
          </div>

          {/* Content */}
          <div
            key={animKey}
            className={animDir === 'forward' ? 'wiz-enter-forward' : 'wiz-enter-back'}
            style={{ padding: '24px 32px 32px' }}
          >
            {/* Step: Welcome */}
            {current.id === 'welcome' && (
              <div>
                <div style={{ width: 56, height: 56, background: 'linear-gradient(135deg, #EFF6FF, #DBEAFE)', borderRadius: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 20 }}>
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#1B4F8A" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z M9 22V12h6v10"/>
                  </svg>
                </div>
                <h2 style={{ fontSize: '1.375rem', fontWeight: 800, color: '#0F172A', letterSpacing: '-0.03em', margin: '0 0 6px', lineHeight: 1.2 }}>
                  {current.title.replace('Alex', firstName)}
                </h2>
                <p style={{ fontSize: '0.9375rem', color: '#64748B', margin: '0 0 28px', lineHeight: 1.6 }}>{current.subtitle}</p>

                {role === 'agency' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {[
                      { icon: '🗺️', label: 'Discover boards', desc: 'Search 143+ billboard locations across Nigeria' },
                      { icon: '📋', label: 'Plan campaigns', desc: 'Build media plans, negotiate rates, raise MPOs' },
                      { icon: '✅', label: 'Track compliance', desc: 'Proof of posting, performance reports, invoices' },
                    ].map(({ icon, label, desc }) => (
                      <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 14, background: '#F8FAFC', borderRadius: 12, padding: '12px 16px', border: '1px solid #F1F5F9' }}>
                        <span style={{ fontSize: '1.25rem', flexShrink: 0 }}>{icon}</span>
                        <div>
                          <p style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0F172A', margin: 0 }}>{label}</p>
                          <p style={{ fontSize: '0.75rem', color: '#94A3B8', margin: 0 }}>{desc}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {role === 'owner' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {[
                      { icon: '🏗️', label: 'List your inventory', desc: 'Upload photos, set rates, manage availability' },
                      { icon: '💬', label: 'Negotiate in-app', desc: 'Receive requests, counter-offer, accept deals' },
                      { icon: '💰', label: 'Track earnings', desc: 'Invoicing, payouts and performance analytics' },
                    ].map(({ icon, label, desc }) => (
                      <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 14, background: '#F8FAFC', borderRadius: 12, padding: '12px 16px', border: '1px solid #F1F5F9' }}>
                        <span style={{ fontSize: '1.25rem', flexShrink: 0 }}>{icon}</span>
                        <div>
                          <p style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0F172A', margin: 0 }}>{label}</p>
                          <p style={{ fontSize: '0.75rem', color: '#94A3B8', margin: 0 }}>{desc}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {role === 'client' && (
                  <div style={{ background: '#F8FAFC', borderRadius: 14, padding: '20px', border: '1px solid #F1F5F9' }}>
                    <p style={{ fontSize: '0.875rem', color: '#475569', margin: 0, lineHeight: 1.7 }}>
                      Your agency manages the bookings. You can see your boards on a live map, check proof-of-posting photos, and monitor campaign performance — all in one place.
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Step: Agency profile */}
            {current.id === 'profile' && (
              <div>
                <h2 style={{ fontSize: '1.375rem', fontWeight: 800, color: '#0F172A', letterSpacing: '-0.03em', margin: '0 0 6px' }}>{current.title}</h2>
                <p style={{ fontSize: '0.9375rem', color: '#64748B', margin: '0 0 24px', lineHeight: 1.6 }}>{current.subtitle}</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, color: '#374151', marginBottom: 6 }}>Agency / company name</label>
                    <input
                      className="wiz-input"
                      type="text" value={companyName} onChange={e => setCompanyName(e.target.value)}
                      placeholder="e.g. Apex Media Group"
                      style={{ width: '100%', padding: '10px 14px', border: '1.5px solid #E2E8F0', borderRadius: 10, fontSize: '0.9375rem', color: '#0F172A', outline: 'none', fontFamily: 'inherit', transition: 'border-color 0.15s, box-shadow 0.15s', boxSizing: 'border-box' }}
                    />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, color: '#374151', marginBottom: 6 }}>City</label>
                      <input
                        className="wiz-input"
                        type="text" value={city} onChange={e => setCity(e.target.value)}
                        placeholder="Lagos"
                        style={{ width: '100%', padding: '10px 14px', border: '1.5px solid #E2E8F0', borderRadius: 10, fontSize: '0.9375rem', color: '#0F172A', outline: 'none', fontFamily: 'inherit', transition: 'border-color 0.15s, box-shadow 0.15s', boxSizing: 'border-box' }}
                      />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, color: '#374151', marginBottom: 6 }}>Phone</label>
                      <input
                        className="wiz-input"
                        type="tel" value={phone} onChange={e => setPhone(e.target.value)}
                        placeholder="080xxxxxxxx"
                        style={{ width: '100%', padding: '10px 14px', border: '1.5px solid #E2E8F0', borderRadius: 10, fontSize: '0.9375rem', color: '#0F172A', outline: 'none', fontFamily: 'inherit', transition: 'border-color 0.15s, box-shadow 0.15s', boxSizing: 'border-box' }}
                      />
                    </div>
                  </div>
                </div>
                <p style={{ fontSize: '0.75rem', color: '#CBD5E1', margin: '14px 0 0' }}>You can update these any time in Settings.</p>
              </div>
            )}

            {/* Step: Owner contact */}
            {current.id === 'contact' && (
              <div>
                <h2 style={{ fontSize: '1.375rem', fontWeight: 800, color: '#0F172A', letterSpacing: '-0.03em', margin: '0 0 6px' }}>{current.title}</h2>
                <p style={{ fontSize: '0.9375rem', color: '#64748B', margin: '0 0 24px', lineHeight: 1.6 }}>{current.subtitle}</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, color: '#374151', marginBottom: 6 }}>Phone number</label>
                    <input
                      className="wiz-input"
                      type="tel" value={phone} onChange={e => setPhone(e.target.value)}
                      placeholder="080xxxxxxxx"
                      style={{ width: '100%', padding: '10px 14px', border: '1.5px solid #E2E8F0', borderRadius: 10, fontSize: '0.9375rem', color: '#0F172A', outline: 'none', fontFamily: 'inherit', transition: 'border-color 0.15s, box-shadow 0.15s', boxSizing: 'border-box' }}
                    />
                    <p style={{ fontSize: '0.75rem', color: '#94A3B8', margin: '6px 0 0' }}>Shown on your public board listing so agencies can WhatsApp you directly.</p>
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, color: '#374151', marginBottom: 6 }}>Primary city</label>
                    <input
                      className="wiz-input"
                      type="text" value={city} onChange={e => setCity(e.target.value)}
                      placeholder="Lagos"
                      style={{ width: '100%', padding: '10px 14px', border: '1.5px solid #E2E8F0', borderRadius: 10, fontSize: '0.9375rem', color: '#0F172A', outline: 'none', fontFamily: 'inherit', transition: 'border-color 0.15s, box-shadow 0.15s', boxSizing: 'border-box' }}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Step: Done */}
            {current.id === 'done' && (
              <div>
                <div style={{ width: 56, height: 56, background: 'linear-gradient(135deg, #ECFDF5, #D1FAE5)', borderRadius: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 20 }}>
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                </div>
                <h2 style={{ fontSize: '1.375rem', fontWeight: 800, color: '#0F172A', letterSpacing: '-0.03em', margin: '0 0 6px', lineHeight: 1.2 }}>
                  {current.title.replace('Alex', firstName)}
                </h2>
                <p style={{ fontSize: '0.9375rem', color: '#64748B', margin: '0 0 24px', lineHeight: 1.6 }}>{current.subtitle}</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {actions.map(({ icon, label, sub, href, color }) => (
                    <button key={label} className="wiz-action" onClick={() => navigateAndDismiss(href)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 14, background: '#F8FAFC',
                        border: '1px solid #F1F5F9', borderRadius: 14, padding: '14px 16px',
                        cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', width: '100%',
                        boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
                      }}>
                      <div style={{ width: 40, height: 40, background: `${color}14`, borderRadius: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                          <path d={icon}/>
                        </svg>
                      </div>
                      <div style={{ flex: 1 }}>
                        <p style={{ fontSize: '0.9375rem', fontWeight: 700, color: '#0F172A', margin: 0 }}>{label}</p>
                        <p style={{ fontSize: '0.75rem', color: '#94A3B8', margin: 0 }}>{sub}</p>
                      </div>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#CBD5E1" strokeWidth="2.5"><polyline points="9 18 15 12 9 6"/></svg>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Footer buttons */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 28 }}>
              <button
                onClick={step === 0 ? dismiss : goBack}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.8125rem', color: '#94A3B8', fontFamily: 'inherit', padding: '4px 0' }}
              >
                {step === 0 ? 'Skip for now' : '← Back'}
              </button>

              {!isLast && (
                <button className="wiz-btn" onClick={saveAndNext}
                  style={{
                    background: '#1B4F8A', color: '#fff', border: 'none',
                    borderRadius: 10, padding: '11px 24px', fontSize: '0.9375rem',
                    fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                    boxShadow: '0 4px 16px rgba(27,79,138,0.3)',
                  }}>
                  Continue →
                </button>
              )}

              {isLast && (
                <button className="wiz-btn" onClick={dismiss}
                  style={{
                    background: '#F1F5F9', color: '#64748B', border: 'none',
                    borderRadius: 10, padding: '11px 24px', fontSize: '0.875rem',
                    fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                  }}>
                  Go to dashboard
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
