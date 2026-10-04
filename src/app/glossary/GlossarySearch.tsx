'use client';

import { useMemo, useState } from 'react';
import type { GlossaryTerm } from '@/lib/ooh-glossary';

export default function GlossarySearch({ terms }: { terms: GlossaryTerm[] }) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return terms;
    return terms.filter(t => `${t.term} ${t.aka ?? ''} ${t.definition}`.toLowerCase().includes(q));
  }, [terms, query]);

  return (
    <>
      <input
        type="search"
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder="Search terms, e.g. MPO, CPM, LASAA…"
        aria-label="Search the glossary"
        style={{ width: '100%', boxSizing: 'border-box', padding: '12px 14px', borderRadius: 10, border: '1px solid #CBD5E1', fontSize: '0.9375rem', fontFamily: 'inherit', outline: 'none', marginBottom: 8, background: '#fff', color: '#0F172A' }}
      />
      <p aria-live="polite" style={{ fontSize: '0.75rem', color: '#94A3B8', margin: '0 0 20px' }}>
        {filtered.length} of {terms.length} terms
      </p>

      {filtered.length === 0 ? (
        <p style={{ fontSize: '0.9375rem', color: '#64748B' }}>No terms match “{query}”.</p>
      ) : (
        <dl style={{ margin: 0 }}>
          {filtered.map(t => (
            <div key={t.term} style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 12, padding: '16px 20px', marginBottom: 10 }}>
              <dt style={{ fontSize: '1rem', fontWeight: 800, color: '#0F172A' }}>
                {t.term}
                {t.aka && <span style={{ fontWeight: 500, color: '#64748B', fontSize: '0.875rem' }}> — {t.aka}</span>}
              </dt>
              <dd style={{ margin: '6px 0 0', fontSize: '0.9375rem', lineHeight: 1.6, color: '#334155' }}>{t.definition}</dd>
            </div>
          ))}
        </dl>
      )}
    </>
  );
}
