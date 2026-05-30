'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabase';

export default function ForgotPasswordPage() {
  const [email, setEmail]     = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent]       = useState(false);
  const [error, setError]     = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) { setError('Please enter your email address.'); return; }
    setLoading(true);
    setError('');

    const { error: resetError } = await supabase.auth.resetPasswordForEmail(
      email.trim().toLowerCase(),
      { redirectTo: `${window.location.origin}/reset-password` }
    );

    setLoading(false);
    if (resetError) {
      setError(resetError.message);
    } else {
      setSent(true);
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#F8FAFC', fontFamily: "'Inter', -apple-system, sans-serif", padding: 24 }}>
      <div style={{ width: '100%', maxWidth: 400 }}>

        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <a href="/" style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: '#1B4F8A', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#F59E0B' }} />
            </div>
            <span style={{ fontSize: '1rem', fontWeight: 700, color: '#0F172A', letterSpacing: '-0.02em' }}>OOH Platform</span>
          </a>
        </div>

        <div style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: 16, padding: '32px 28px' }}>
          {sent ? (
            <div style={{ textAlign: 'center' }}>
              <div style={{ width: 56, height: 56, borderRadius: '50%', background: '#ECFDF5', border: '2px solid #A7F3D0', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              </div>
              <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#0F172A', margin: '0 0 8px', letterSpacing: '-0.02em' }}>Check your inbox</h2>
              <p style={{ fontSize: '0.875rem', color: '#64748B', lineHeight: 1.6, margin: '0 0 20px' }}>
                We sent a password reset link to <strong style={{ color: '#0F172A' }}>{email}</strong>. Check your spam folder if you don&apos;t see it.
              </p>
              <a href="/" style={{ display: 'inline-block', padding: '9px 20px', background: '#1B4F8A', color: '#fff', borderRadius: 8, fontSize: '0.875rem', fontWeight: 600, textDecoration: 'none' }}>
                Back to sign in
              </a>
            </div>
          ) : (
            <>
              <div style={{ marginBottom: 24 }}>
                <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#0F172A', margin: '0 0 6px', letterSpacing: '-0.02em' }}>Forgot your password?</h2>
                <p style={{ fontSize: '0.875rem', color: '#64748B', margin: 0, lineHeight: 1.5 }}>
                  Enter your email and we&apos;ll send you a link to reset it.
                </p>
              </div>

              <form onSubmit={handleSubmit}>
                <div style={{ marginBottom: 16 }}>
                  <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 500, color: '#374151', marginBottom: 6 }}>
                    Email address
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={e => { setEmail(e.target.value); setError(''); }}
                    placeholder="you@company.com"
                    autoFocus
                    style={{ width: '100%', padding: '10px 12px', border: `1px solid ${error ? '#EF4444' : '#E2E8F0'}`, borderRadius: 8, fontSize: '0.875rem', color: '#0F172A', outline: 'none', background: '#fff', fontFamily: 'inherit', boxSizing: 'border-box' }}
                    onFocus={e => { e.currentTarget.style.borderColor = '#1B4F8A'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(27,79,138,0.08)'; }}
                    onBlur={e => { e.currentTarget.style.borderColor = error ? '#EF4444' : '#E2E8F0'; e.currentTarget.style.boxShadow = 'none'; }}
                  />
                </div>

                {error && (
                  <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: '9px 12px', fontSize: '0.8125rem', color: '#7F1D1D', marginBottom: 14 }}>
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  style={{ width: '100%', padding: '11px', background: loading ? '#94A3B8' : '#1B4F8A', color: '#fff', border: 'none', borderRadius: 8, fontSize: '0.875rem', fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
                >
                  {loading && <div style={{ width: 14, height: 14, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />}
                  {loading ? 'Sending…' : 'Send reset link'}
                </button>
              </form>
            </>
          )}
        </div>

        <p style={{ textAlign: 'center', fontSize: '0.8125rem', color: '#94A3B8', marginTop: 16 }}>
          <a href="/" style={{ color: '#1B4F8A', fontWeight: 500, textDecoration: 'none' }}>← Back to sign in</a>
        </p>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } } * { box-sizing: border-box; }`}</style>
    </div>
  );
}
