import type { CSSProperties } from 'react';

// Inline style tokens shared by the owner-team screens.
export const input: CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: 8,
  border: '1px solid #E2E8F0', fontSize: '0.8125rem', color: '#0F172A', background: '#fff', fontFamily: 'inherit', outline: 'none',
};
export const label: CSSProperties = { fontSize: '0.6875rem', fontWeight: 600, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4, display: 'block' };
export const card: CSSProperties = { background: '#fff', border: '1px solid #E2E8F0', borderRadius: 12, padding: 20, marginBottom: 16 };
export const h1: CSSProperties = { fontSize: '1.375rem', fontWeight: 800, color: '#0F172A', margin: '0 0 4px', letterSpacing: '-0.02em' };
export const sub: CSSProperties = { fontSize: '0.875rem', color: '#64748B', margin: '0 0 20px', maxWidth: 680 };
export const page: CSSProperties = { maxWidth: 1040, margin: '0 auto', padding: '8px 0 48px', fontFamily: 'inherit' };
export const errorBox: CSSProperties = { ...card, borderColor: '#FECACA', background: '#FEF2F2', color: '#B91C1C', fontSize: '0.8125rem' };
export const okBox: CSSProperties = { ...card, borderColor: '#BBF7D0', background: '#F0FDF4', color: '#15803D', fontSize: '0.8125rem' };
export const btn = (enabled = true, color = '#7C3AED'): CSSProperties => ({
  padding: '8px 16px', borderRadius: 8, border: 'none', fontSize: '0.8125rem', fontWeight: 600, fontFamily: 'inherit', whiteSpace: 'nowrap',
  background: enabled ? color : '#F1F5F9', color: enabled ? '#fff' : '#94A3B8', cursor: enabled ? 'pointer' : 'not-allowed',
});
export const ghostBtn: CSSProperties = { padding: '6px 12px', borderRadius: 8, border: '1px solid #E2E8F0', background: '#fff', color: '#475569', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600, fontFamily: 'inherit', whiteSpace: 'nowrap' };
export const naira = (n: number | null | undefined) => '₦' + Math.round(n ?? 0).toLocaleString('en-NG');
export const fmtDate = (d: string) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
