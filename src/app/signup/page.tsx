'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import type { DemoRole } from '@/lib/constants';

const ROLES: { role: DemoRole; label: string; desc: string; color: string; bg: string }[] = [
  { role: 'agency', label: 'Agency',      desc: 'Plan campaigns, book boards, manage clients', color: '#1B4F8A', bg: '#EFF6FF' },
  { role: 'owner',  label: 'Board Owner', desc: 'List your boards, manage bookings, earn revenue', color: '#7C3AED', bg: '#F5F3FF' },
  { role: 'client', label: 'Advertiser',  desc: 'Track campaigns and view compliance reports', color: '#059669', bg: '#ECFDF5' },
];

function OOHLogo() {
  return (
    <svg width="120" height="28" viewBox="0 0 160 36" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="2" width="28" height="18" rx="2" fill="#1B4F8A"/>
      <rect x="3" y="5" width="22" height="12" rx="1.5" fill="#fff"/>
      <rect x="10" y="20" width="2.5" height="6" fill="#1B4F8A"/>
      <rect x="15.5" y="20" width="2.5" height="6" fill="#1B4F8A"/>
      <rect x="34" y="6" width="24" height="16" rx="2" fill="#1B4F8A"/>
      <rect x="37" y="9" width="18" height="10" rx="1.5" fill="#fff"/>
      <rect x="42" y="22" width="2.5" height="6" fill="#1B4F8A"/>
      <rect x="47.5" y="22" width="2.5" height="6" fill="#1B4F8A"/>
      <rect x="64" y="2" width="4" height="28" rx="2" fill="#1B4F8A"/>
      <rect x="80" y="2" width="4" height="28" rx="2" fill="#1B4F8A"/>
      <rect x="64" y="13" width="20" height="4" rx="1" fill="#1B4F8A"/>
      <circle cx="88" cy="4" r="3" fill="#F59E0B"/>
      <text x="98" y="20" fontFamily="Georgia, serif" fontSize="18" fontWeight="700" fill="#0F172A" letterSpacing="-0.5">OOH</text>
      <text x="99" y="30" fontFamily="Arial, sans-serif" fontSize="6.5" fontWeight="400" fill="#94A3B8" letterSpacing="3">PLATFORM</text>
    </svg>
  );
}

export default function SignupPage() {
  const router = useRouter();

  const [step, setStep]           = useState<1 | 2>(1);
  const [role, setRole]           = useState<DemoRole | null>(null);
  const [fullName, setFullName]   = useState('');
  const [company, setCompany]     = useState('');
  const [email, setEmail]         = useState('');
  const [password, setPassword]   = useState('');
  const [confirm, setConfirm]     = useState('');
  const [showPw, setShowPw]       = useState(false);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState('');
  const [success, setSuccess]     = useState(false);

  function nextStep() {
    if (!role) { setError('Please select your account type.'); return; }
    setError('');
    setStep(2);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!fullName.trim())          { setError('Full name is required.'); return; }
    if (!company.trim())           { setError('Company name is required.'); return; }
    if (!email.trim())             { setError('Email is required.'); return; }
    if (password.length < 8)      { setError('Password must be at least 8 characters.'); return; }
    if (password !== confirm)      { setError('Passwords do not match.'); return; }

    setLoading(true);
    setError('');

    const { data, error: signUpError } = await supabase.auth.signUp({
      email: email.trim().toLowerCase(),
      password,
      options: {
        data: {
          full_name:    fullName.trim(),
          company_name: company.trim(),
          role,
        },
      },
    });

    if (signUpError) {
      setLoading(false);
      setError(signUpError.message);
      return;
    }

    // If email confirmation is disabled in Supabase, the session is ready immediately
    if (data.session) {
      router.push(`/dashboard/${role}`);
      return;
    }

    // Email confirmation required
    setLoading(false);
    setSuccess(true);
  }

  if (success) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#F8FAFC', fontFamily: "'Inter', sans-serif", padding: 24 }}>
        <div style={{ maxWidth: 420, width: '100%', textAlign: 'center' }}>
          <div style={{ width: 64, height: 64, borderRadius: '50%', background: '#ECFDF5', border: '2px solid #A7F3D0', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px' }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
          </div>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#0F172A', margin: '0 0 8px', letterSpacing: '-0.025em' }}>Check your email</h2>
          <p style={{ fontSize: '0.9375rem', color: '#64748B', margin: '0 0 24px', lineHeight: 1.6 }}>
            We&apos;ve sent a confirmation link to <strong style={{ color: '#0F172A' }}>{email}</strong>. Click the link to activate your account.
          </p>
          <a href="/" style={{ display: 'inline-block', padding: '10px 24px', background: '#1B4F8A', color: '#fff', borderRadius: 8, fontSize: '0.875rem', fontWeight: 600, textDecoration: 'none' }}>
            Back to sign in
          </a>
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: '#F8FAFC', display: 'flex', fontFamily: "'Inter', -apple-system, sans-serif" }}>

      {/* Left panel */}
      <div className="auth-split-left" style={{ width: '42%', background: '#0F172A', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: '48px', position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', inset: 0, opacity: 0.03, backgroundImage: 'linear-gradient(rgba(255,255,255,0.8) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.8) 1px, transparent 1px)', backgroundSize: '40px 40px' }} />
        <div style={{ position: 'relative' }}>
          <a href="/" style={{ textDecoration: 'none' }}><OOHLogo /></a>
        </div>
        <div style={{ position: 'relative' }}>
          <h1 style={{ fontSize: '2rem', fontWeight: 800, color: '#F8FAFC', letterSpacing: '-0.04em', lineHeight: 1.15, margin: '0 0 16px' }}>
            Join Nigeria&apos;s OOH operating system
          </h1>
          <p style={{ fontSize: '0.9375rem', color: 'rgba(255,255,255,0.45)', lineHeight: 1.6, margin: '0 0 32px', maxWidth: 300 }}>
            Agencies plan smarter. Owners earn more. Brands see results.
          </p>
          {[
            { icon: '📋', text: 'Plan campaigns with AI-powered board selection' },
            { icon: '🤝', text: 'Negotiate and book boards in real time' },
            { icon: '📸', text: 'Verify proof of posting with GPS-tagged photos' },
            { icon: '🧾', text: 'End-to-end billing from owner to client' },
          ].map(f => (
            <div key={f.text} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 14 }}>
              <span style={{ fontSize: '1rem', flexShrink: 0, marginTop: 1 }}>{f.icon}</span>
              <p style={{ fontSize: '0.8125rem', color: 'rgba(255,255,255,0.55)', margin: 0, lineHeight: 1.5 }}>{f.text}</p>
            </div>
          ))}
        </div>
        <p style={{ position: 'relative', fontSize: '0.75rem', color: 'rgba(255,255,255,0.2)', margin: 0 }}>
          © 2026 OOH Platform
        </p>
      </div>

      {/* Right panel */}
      <div className="auth-split-right" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '48px 48px' }}>
        <div style={{ width: '100%', maxWidth: 420 }}>

          {/* Step indicator */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 28 }}>
            {[1, 2].map(s => (
              <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 24, height: 24, borderRadius: '50%', background: step >= s ? '#1B4F8A' : '#E2E8F0', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background 0.2s' }}>
                  {step > s
                    ? <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                    : <span style={{ fontSize: '0.6875rem', fontWeight: 700, color: step >= s ? '#fff' : '#94A3B8' }}>{s}</span>
                  }
                </div>
                <span style={{ fontSize: '0.75rem', fontWeight: 500, color: step >= s ? '#0F172A' : '#94A3B8' }}>
                  {s === 1 ? 'Account type' : 'Your details'}
                </span>
                {s < 2 && <div style={{ width: 32, height: 1, background: step > s ? '#1B4F8A' : '#E2E8F0', marginLeft: 4 }} />}
              </div>
            ))}
          </div>

          <div style={{ marginBottom: 24 }}>
            <h2 style={{ fontSize: '1.375rem', fontWeight: 700, color: '#0F172A', letterSpacing: '-0.025em', margin: '0 0 4px' }}>
              {step === 1 ? 'Create your account' : 'Your details'}
            </h2>
            <p style={{ fontSize: '0.875rem', color: '#64748B', margin: 0 }}>
              {step === 1 ? 'Choose how you will use OOH Platform' : 'Fill in your information to get started'}
            </p>
          </div>

          {/* Step 1 — role picker */}
          {step === 1 && (
            <div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
                {ROLES.map(r => (
                  <button
                    key={r.role}
                    onClick={() => { setRole(r.role); setError(''); }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px',
                      background: role === r.role ? r.bg : '#fff',
                      border: `2px solid ${role === r.role ? r.color : '#E2E8F0'}`,
                      borderRadius: 12, cursor: 'pointer', fontFamily: 'inherit',
                      textAlign: 'left', transition: 'all 0.15s',
                    }}
                  >
                    <div style={{ width: 40, height: 40, borderRadius: 10, background: r.bg, border: `1px solid ${r.color}25`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <div style={{ width: 12, height: 12, borderRadius: '50%', background: r.color }} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <p style={{ fontSize: '0.9375rem', fontWeight: 700, color: '#0F172A', margin: '0 0 2px' }}>{r.label}</p>
                      <p style={{ fontSize: '0.75rem', color: '#64748B', margin: 0 }}>{r.desc}</p>
                    </div>
                    <div style={{ width: 18, height: 18, borderRadius: '50%', border: `2px solid ${role === r.role ? r.color : '#CBD5E1'}`, background: role === r.role ? r.color : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'all 0.15s' }}>
                      {role === r.role && <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#fff' }} />}
                    </div>
                  </button>
                ))}
              </div>

              {error && <p style={{ fontSize: '0.8125rem', color: '#EF4444', marginBottom: 12 }}>{error}</p>}

              <button
                onClick={nextStep}
                style={{ width: '100%', padding: '11px', background: '#1B4F8A', color: '#fff', border: 'none', borderRadius: 8, fontSize: '0.875rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
              >
                Continue
              </button>
            </div>
          )}

          {/* Step 2 — details form */}
          {step === 2 && (
            <form onSubmit={handleSubmit}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 500, color: '#374151', marginBottom: 5 }}>Full name *</label>
                  <input
                    value={fullName} onChange={e => { setFullName(e.target.value); setError(''); }}
                    placeholder="Alex Okonkwo"
                    style={inputStyle}
                    onFocus={focusStyle} onBlur={blurStyle}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 500, color: '#374151', marginBottom: 5 }}>
                    {role === 'client' ? 'Brand name *' : 'Company name *'}
                  </label>
                  <input
                    value={company} onChange={e => { setCompany(e.target.value); setError(''); }}
                    placeholder={role === 'owner' ? 'Sule Outdoor Ltd' : role === 'client' ? 'MTN Nigeria' : 'MediaPro Agency'}
                    style={inputStyle}
                    onFocus={focusStyle} onBlur={blurStyle}
                  />
                </div>
              </div>

              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 500, color: '#374151', marginBottom: 5 }}>Work email *</label>
                <input
                  type="email" value={email} onChange={e => { setEmail(e.target.value); setError(''); }}
                  placeholder="you@company.com"
                  style={inputStyle}
                  onFocus={focusStyle} onBlur={blurStyle}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 500, color: '#374151', marginBottom: 5 }}>Password *</label>
                  <div style={{ position: 'relative' }}>
                    <input
                      type={showPw ? 'text' : 'password'} value={password}
                      onChange={e => { setPassword(e.target.value); setError(''); }}
                      placeholder="8+ characters"
                      style={{ ...inputStyle, paddingRight: 36 }}
                      onFocus={focusStyle} onBlur={blurStyle}
                    />
                    <button type="button" onClick={() => setShowPw(v => !v)} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8', padding: 2, display: 'flex' }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        {showPw ? <><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></> : <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></>}
                      </svg>
                    </button>
                  </div>
                  {password && (
                    <div style={{ marginTop: 6, display: 'flex', gap: 3 }}>
                      {[8, 12, 16].map(len => (
                        <div key={len} style={{ flex: 1, height: 3, borderRadius: 2, background: password.length >= len ? (len === 8 ? '#F59E0B' : len === 12 ? '#3B82F6' : '#10B981') : '#E2E8F0', transition: 'background 0.2s' }} />
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 500, color: '#374151', marginBottom: 5 }}>Confirm password *</label>
                  <input
                    type="password" value={confirm}
                    onChange={e => { setConfirm(e.target.value); setError(''); }}
                    placeholder="Repeat password"
                    style={{ ...inputStyle, borderColor: confirm && confirm !== password ? '#EF4444' : undefined }}
                    onFocus={focusStyle} onBlur={blurStyle}
                  />
                  {confirm && confirm !== password && <p style={{ fontSize: '0.6875rem', color: '#EF4444', margin: '4px 0 0' }}>Passwords don&apos;t match</p>}
                </div>
              </div>

              {error && (
                <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: '10px 12px', fontSize: '0.8125rem', color: '#7F1D1D', marginBottom: 14 }}>
                  {error}
                </div>
              )}

              <button
                type="submit" disabled={loading}
                style={{ width: '100%', padding: '11px', background: loading ? '#94A3B8' : '#1B4F8A', color: '#fff', border: 'none', borderRadius: 8, fontSize: '0.875rem', fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
              >
                {loading && <div style={{ width: 14, height: 14, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />}
                {loading ? 'Creating account…' : 'Create account'}
              </button>

              <button
                type="button" onClick={() => { setStep(1); setError(''); }}
                style={{ width: '100%', marginTop: 10, padding: '10px', background: 'transparent', color: '#64748B', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: '0.875rem', fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit' }}
              >
                Back
              </button>
            </form>
          )}

          <p style={{ textAlign: 'center', fontSize: '0.8125rem', color: '#94A3B8', margin: '20px 0 0' }}>
            Already have an account?{' '}
            <a href="/" style={{ color: '#1B4F8A', fontWeight: 600, textDecoration: 'none' }}>Sign in</a>
          </p>
        </div>
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        * { box-sizing: border-box; }
      `}</style>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '9px 12px',
  border: '1px solid #E2E8F0', borderRadius: 8,
  fontSize: '0.875rem', color: '#0F172A',
  outline: 'none', background: '#fff',
  fontFamily: 'inherit', transition: 'border-color 0.15s',
  boxSizing: 'border-box',
};

function focusStyle(e: React.FocusEvent<HTMLInputElement>) {
  e.currentTarget.style.borderColor = '#1B4F8A';
  e.currentTarget.style.boxShadow   = '0 0 0 3px rgba(27,79,138,0.08)';
}
function blurStyle(e: React.FocusEvent<HTMLInputElement>) {
  e.currentTarget.style.borderColor = '#E2E8F0';
  e.currentTarget.style.boxShadow   = 'none';
}
