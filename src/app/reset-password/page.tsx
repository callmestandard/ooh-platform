'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { getCurrentProfile } from '@/lib/auth';

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword]   = useState('');
  const [confirm, setConfirm]     = useState('');
  const [showPw, setShowPw]       = useState(false);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState('');
  const [ready, setReady]         = useState(false);

  // Supabase puts the recovery token in the URL hash — the client SDK
  // automatically exchanges it and fires a PASSWORD_RECOVERY auth event.
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setReady(true);
    });
    // If page loaded after redirect, session may already be active
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setReady(true);
    });
    return () => subscription.unsubscribe();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8)  { setError('Password must be at least 8 characters.'); return; }
    if (password !== confirm)  { setError('Passwords do not match.'); return; }
    setLoading(true);
    setError('');

    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) {
      setLoading(false);
      setError(updateError.message);
      return;
    }

    // Redirect to the user's dashboard
    const profile = await getCurrentProfile();
    router.replace(profile ? `/dashboard/${profile.role}` : '/');
  }

  if (!ready) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#F8FAFC', fontFamily: "'Inter', sans-serif" }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ width: 28, height: 28, border: '3px solid #E2E8F0', borderTopColor: '#1B4F8A', borderRadius: '50%', animation: 'spin 0.7s linear infinite', margin: '0 auto 12px' }} />
          <p style={{ fontSize: '0.875rem', color: '#94A3B8' }}>Verifying reset link…</p>
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#F8FAFC', fontFamily: "'Inter', -apple-system, sans-serif", padding: 24 }}>
      <div style={{ width: '100%', maxWidth: 380 }}>
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <a href="/" style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: '#1B4F8A', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#F59E0B' }} />
            </div>
            <span style={{ fontSize: '1rem', fontWeight: 700, color: '#0F172A', letterSpacing: '-0.02em' }}>OOH Platform</span>
          </a>
        </div>

        <div style={{ background: '#fff', border: '1px solid #E8EDF2', borderRadius: 16, padding: '32px 28px' }}>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#0F172A', margin: '0 0 6px', letterSpacing: '-0.02em' }}>Set new password</h2>
          <p style={{ fontSize: '0.875rem', color: '#64748B', margin: '0 0 24px', lineHeight: 1.5 }}>
            Choose a strong password for your account.
          </p>

          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: 12 }}>
              <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 500, color: '#374151', marginBottom: 5 }}>New password</label>
              <div style={{ position: 'relative' }}>
                <input
                  type={showPw ? 'text' : 'password'}
                  value={password}
                  onChange={e => { setPassword(e.target.value); setError(''); }}
                  placeholder="8+ characters"
                  autoFocus
                  style={{ width: '100%', padding: '10px 36px 10px 12px', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: '0.875rem', color: '#0F172A', outline: 'none', background: '#fff', fontFamily: 'inherit', boxSizing: 'border-box' }}
                  onFocus={e => { e.currentTarget.style.borderColor = '#1B4F8A'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(27,79,138,0.08)'; }}
                  onBlur={e => { e.currentTarget.style.borderColor = '#E2E8F0'; e.currentTarget.style.boxShadow = 'none'; }}
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

            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 500, color: '#374151', marginBottom: 5 }}>Confirm password</label>
              <input
                type="password"
                value={confirm}
                onChange={e => { setConfirm(e.target.value); setError(''); }}
                placeholder="Repeat password"
                style={{ width: '100%', padding: '10px 12px', border: `1px solid ${confirm && confirm !== password ? '#EF4444' : '#E2E8F0'}`, borderRadius: 8, fontSize: '0.875rem', color: '#0F172A', outline: 'none', background: '#fff', fontFamily: 'inherit', boxSizing: 'border-box' }}
                onFocus={e => { e.currentTarget.style.borderColor = '#1B4F8A'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(27,79,138,0.08)'; }}
                onBlur={e => { e.currentTarget.style.borderColor = confirm && confirm !== password ? '#EF4444' : '#E2E8F0'; e.currentTarget.style.boxShadow = 'none'; }}
              />
              {confirm && confirm !== password && <p style={{ fontSize: '0.6875rem', color: '#EF4444', margin: '4px 0 0' }}>Passwords don&apos;t match</p>}
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
              {loading ? 'Saving…' : 'Save new password'}
            </button>
          </form>
        </div>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } } * { box-sizing: border-box; }`}</style>
    </div>
  );
}
