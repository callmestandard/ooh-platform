'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { signInWithEmail, getSession, getCurrentProfile, DEMO_CREDENTIALS } from '@/lib/auth';
import { ROLE_STORAGE_KEY, type DemoRole } from '@/lib/constants';
import { supabase } from '@/lib/supabase';

function OOHLogoLarge() {
  return (
    <svg width="160" height="38" viewBox="0 0 160 36" xmlns="http://www.w3.org/2000/svg">
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

const DEMO_ROLES: { role: DemoRole; label: string; sub: string; color: string; bg: string }[] = [
  { role: 'agency', label: 'Agency',       sub: 'Full platform access',     color: '#1B4F8A', bg: '#EFF6FF' },
  { role: 'client', label: 'MTN (Client)', sub: 'Campaign visibility only', color: '#059669', bg: '#ECFDF5' },
  { role: 'owner',  label: 'Board Owner',  sub: 'Board & earnings view',    color: '#7C3AED', bg: '#F5F3FF' },
];

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail]               = useState('');
  const [password, setPassword]         = useState('');
  const [loading, setLoading]           = useState(false);
  const [demoLoading, setDemoLoading]   = useState<DemoRole | string | null>(null);
  const [error, setError]               = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [unconfirmed, setUnconfirmed]   = useState(false);
  const [resendSent, setResendSent]     = useState(false);
  const [resending, setResending]       = useState(false);

  // If already signed in, skip the login page
  useEffect(() => {
    getSession().then(session => {
      if (!session) return;
      getCurrentProfile().then(profile => {
        if (profile) router.replace(`/dashboard/${profile.role}`);
      });
    });
  }, [router]);

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    if (!email || !password) { setError('Please enter your email and password.'); return; }
    setLoading(true);
    setError('');
    setUnconfirmed(false);

    const { data, error: authError } = await signInWithEmail(email, password);
    if (authError || !data.session) {
      setLoading(false);
      const msg = authError?.message ?? '';
      if (msg.toLowerCase().includes('not confirmed') || msg.toLowerCase().includes('email not confirmed')) {
        setUnconfirmed(true);
      } else {
        setError(msg || 'Invalid credentials. Check your email and password.');
      }
      return;
    }

    const profile = await getCurrentProfile();
    setLoading(false);
    if (profile) {
      router.push(`/dashboard/${profile.role}`);
    } else {
      setError('Account found but no role assigned. Contact your administrator.');
    }
  }

  async function handleResend() {
    if (!email || resending) return;
    setResending(true);
    await supabase.auth.resend({ type: 'signup', email: email.trim().toLowerCase() });
    setResending(false);
    setResendSent(true);
  }

  async function loginAs(role: DemoRole) {
    setDemoLoading(role);
    setError('');

    // Try real Supabase demo accounts first
    const creds = DEMO_CREDENTIALS[role];
    const { data, error: authError } = await signInWithEmail(creds.email, creds.password);

    if (!authError && data.session) {
      // Real auth succeeded — get profile and redirect
      const profile = await getCurrentProfile();
      setDemoLoading(null);
      if (profile) {
        router.push(`/dashboard/${profile.role}`);
        return;
      }
    }

    // Graceful fallback: demo accounts not in Supabase yet — use localStorage
    setDemoLoading(null);
    localStorage.setItem(ROLE_STORAGE_KEY, role);
    router.push(`/dashboard/${role}`);
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: '#F8FAFC',
      display: 'flex',
      fontFamily: "'Inter', -apple-system, sans-serif",
    }}>
      {/* Left panel — branding */}
      <div style={{
        width: '45%',
        background: '#0F172A',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '48px',
        position: 'relative',
        overflow: 'hidden',
      }}>
        <div style={{
          position: 'absolute', inset: 0, opacity: 0.03,
          backgroundImage: 'linear-gradient(rgba(255,255,255,0.8) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.8) 1px, transparent 1px)',
          backgroundSize: '40px 40px',
        }} />

        <div style={{ position: 'relative' }}>
          <OOHLogoLarge />
        </div>

        <div style={{ position: 'relative' }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: '8px',
            background: 'rgba(27,79,138,0.4)', border: '1px solid rgba(27,79,138,0.6)',
            borderRadius: '999px', padding: '5px 14px', marginBottom: '24px',
          }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#F59E0B' }} />
            <span style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.7)', fontWeight: 500 }}>
              Nigeria&apos;s OOH operating system
            </span>
          </div>

          <h1 style={{
            fontSize: '2.25rem', fontWeight: 800, color: '#F8FAFC',
            letterSpacing: '-0.04em', lineHeight: 1.1, margin: '0 0 16px',
          }}>
            The operating system for outdoor advertising
          </h1>
          <p style={{
            fontSize: '1rem', color: 'rgba(255,255,255,0.45)',
            lineHeight: 1.6, margin: 0, maxWidth: '340px',
          }}>
            Where billboard owners list space, agencies plan campaigns, and brands see results in real time.
          </p>

          <div style={{ display: 'flex', gap: '32px', marginTop: '40px' }}>
            {[
              { value: '₦100B+', label: 'Market size' },
              { value: '143',    label: 'Boards live' },
              { value: '8',      label: 'Active campaigns' },
            ].map(({ value, label }) => (
              <div key={label}>
                <div style={{ fontSize: '1.375rem', fontWeight: 700, color: '#F8FAFC', letterSpacing: '-0.02em', fontFamily: 'monospace' }}>{value}</div>
                <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.35)', marginTop: '2px' }}>{label}</div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ position: 'relative' }}>
          <p style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.2)', margin: 0 }}>
            © 2026 OOH Platform · Built for Nigeria, built for the world
          </p>
        </div>
      </div>

      {/* Right panel — login form */}
      <div style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '48px',
      }}>
        <div style={{ width: '100%', maxWidth: '400px' }}>
          <div style={{ marginBottom: '32px' }}>
            <h2 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#0F172A', letterSpacing: '-0.025em', margin: '0 0 6px' }}>
              Sign in
            </h2>
            <p style={{ fontSize: '0.875rem', color: '#64748B', margin: 0 }}>
              Enter your credentials to access your workspace
            </p>
          </div>

          <form onSubmit={handleSignIn} style={{ marginBottom: '24px' }}>
            <div style={{ marginBottom: '14px' }}>
              <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 500, color: '#374151', marginBottom: '6px' }}>
                Email address
              </label>
              <input
                type="email"
                value={email}
                onChange={e => { setEmail(e.target.value); setError(''); setUnconfirmed(false); setResendSent(false); }}
                placeholder="you@company.com"
                style={{
                  width: '100%', padding: '10px 12px',
                  border: `1px solid ${error ? '#EF4444' : '#E2E8F0'}`,
                  borderRadius: '8px', fontSize: '0.875rem',
                  color: '#0F172A', outline: 'none', background: '#fff',
                  fontFamily: 'inherit', transition: 'border-color 0.15s',
                  boxSizing: 'border-box',
                }}
                onFocus={e => { e.currentTarget.style.borderColor = '#1B4F8A'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(27,79,138,0.08)'; }}
                onBlur={e => { e.currentTarget.style.borderColor = error ? '#EF4444' : '#E2E8F0'; e.currentTarget.style.boxShadow = 'none'; }}
              />
            </div>

            <div style={{ marginBottom: '20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <label style={{ fontSize: '0.8125rem', fontWeight: 500, color: '#374151' }}>
                  Password
                </label>
                <a href="/forgot-password" style={{ fontSize: '0.75rem', color: '#1B4F8A', fontWeight: 500, textDecoration: 'none' }}>
                  Forgot password?
                </a>
              </div>
              <div style={{ position: 'relative' }}>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={e => { setPassword(e.target.value); setError(''); setUnconfirmed(false); }}
                  placeholder="••••••••"
                  style={{
                    width: '100%', padding: '10px 40px 10px 12px',
                    border: `1px solid ${error ? '#EF4444' : '#E2E8F0'}`,
                    borderRadius: '8px', fontSize: '0.875rem',
                    color: '#0F172A', outline: 'none', background: '#fff',
                    fontFamily: 'inherit', transition: 'border-color 0.15s',
                    boxSizing: 'border-box',
                  }}
                  onFocus={e => { e.currentTarget.style.borderColor = '#1B4F8A'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(27,79,138,0.08)'; }}
                  onBlur={e => { e.currentTarget.style.borderColor = error ? '#EF4444' : '#E2E8F0'; e.currentTarget.style.boxShadow = 'none'; }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(v => !v)}
                  style={{
                    position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)',
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: '#94A3B8', padding: '2px', display: 'flex',
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    {showPassword
                      ? <><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></>
                      : <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></>
                    }
                  </svg>
                </button>
              </div>
            </div>

            {unconfirmed && (
              <div style={{
                background: '#FFFBEB', border: '1px solid #FDE68A',
                borderRadius: '8px', padding: '12px 14px', marginBottom: '16px',
              }}>
                <p style={{ fontSize: '0.8125rem', color: '#92400E', margin: '0 0 8px', fontWeight: 500 }}>
                  Email not confirmed
                </p>
                <p style={{ fontSize: '0.8125rem', color: '#78350F', margin: '0 0 10px', lineHeight: 1.5 }}>
                  Check your inbox for a confirmation link, or click below to resend it.
                </p>
                {resendSent ? (
                  <p style={{ fontSize: '0.8125rem', color: '#059669', margin: 0, fontWeight: 500 }}>Confirmation email sent — check your inbox.</p>
                ) : (
                  <button
                    type="button"
                    onClick={handleResend}
                    disabled={resending}
                    style={{
                      padding: '6px 14px', background: '#F59E0B', color: '#fff', border: 'none',
                      borderRadius: '6px', fontSize: '0.8125rem', fontWeight: 600, cursor: resending ? 'not-allowed' : 'pointer',
                      fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 6,
                    }}
                  >
                    {resending && <div style={{ width: 10, height: 10, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />}
                    {resending ? 'Sending…' : 'Resend confirmation email'}
                  </button>
                )}
              </div>
            )}

            {error && (
              <div style={{
                background: '#FEF2F2', border: '1px solid #FECACA',
                borderRadius: '8px', padding: '10px 12px',
                fontSize: '0.8125rem', color: '#7F1D1D', marginBottom: '16px',
              }}>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              style={{
                width: '100%', padding: '11px',
                background: loading ? '#94A3B8' : '#1B4F8A',
                color: '#fff', border: 'none', borderRadius: '8px',
                fontSize: '0.875rem', fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer',
                fontFamily: 'inherit', transition: 'background 0.15s',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
              }}
            >
              {loading && (
                <div style={{
                  width: 14, height: 14, border: '2px solid rgba(255,255,255,0.3)',
                  borderTopColor: '#fff', borderRadius: '50%',
                  animation: 'spin 0.7s linear infinite',
                }} />
              )}
              {loading ? 'Signing in...' : 'Sign in'}
            </button>
          </form>

          <p style={{ textAlign: 'center', fontSize: '0.8125rem', color: '#94A3B8', margin: '-8px 0 20px' }}>
            Don&apos;t have an account?{' '}
            <a href="/signup" style={{ color: '#1B4F8A', fontWeight: 600, textDecoration: 'none' }}>Create one</a>
          </p>

          {/* Divider */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
            <div style={{ flex: 1, height: 1, background: '#E2E8F0' }} />
            <span style={{ fontSize: '0.75rem', color: '#94A3B8', fontWeight: 500, whiteSpace: 'nowrap' }}>Quick demo access</span>
            <div style={{ flex: 1, height: 1, background: '#E2E8F0' }} />
          </div>

          {/* Browse marketplace link */}
          <div style={{ textAlign: 'center', marginBottom: '20px' }}>
            <a
              href="/marketplace"
              style={{ fontSize: '0.8125rem', color: '#1B4F8A', fontWeight: 500, textDecoration: 'none' }}
            >
              Browse available boards without signing in →
            </a>
          </div>

          {/* Demo role buttons */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {DEMO_ROLES.map(({ role, label, sub, color, bg }) => {
              const isThisLoading = demoLoading === role;
              return (
                <button
                  key={role}
                  onClick={() => loginAs(role)}
                  disabled={demoLoading !== null}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '12px',
                    padding: '12px 14px', background: '#fff',
                    border: '1px solid #E2E8F0', borderRadius: '10px',
                    cursor: demoLoading !== null ? 'not-allowed' : 'pointer',
                    fontFamily: 'inherit', transition: 'all 0.15s', textAlign: 'left',
                    opacity: demoLoading !== null && !isThisLoading ? 0.5 : 1,
                  }}
                  onMouseEnter={e => {
                    if (demoLoading !== null) return;
                    (e.currentTarget as HTMLElement).style.borderColor = color;
                    (e.currentTarget as HTMLElement).style.background = bg;
                  }}
                  onMouseLeave={e => {
                    (e.currentTarget as HTMLElement).style.borderColor = '#E2E8F0';
                    (e.currentTarget as HTMLElement).style.background = '#fff';
                  }}
                >
                  <div style={{
                    width: 36, height: 36, borderRadius: '8px',
                    background: bg, border: `1px solid ${color}20`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0,
                  }}>
                    {isThisLoading
                      ? <div style={{ width: 14, height: 14, border: `2px solid ${color}40`, borderTopColor: color, borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
                      : <div style={{ width: 10, height: 10, borderRadius: '50%', background: color }} />
                    }
                  </div>
                  <div>
                    <p style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#0F172A', margin: 0 }}>
                      Login as {label}
                    </p>
                    <p style={{ fontSize: '0.75rem', color: '#64748B', margin: 0 }}>{sub}</p>
                  </div>
                  {!isThisLoading && (
                    <svg style={{ marginLeft: 'auto', color: '#CBD5E1' }} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="9 18 15 12 9 6"/>
                    </svg>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
