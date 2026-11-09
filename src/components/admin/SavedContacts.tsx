'use client';

import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';

type Contact = { id: string; contact_name: string; contact_phone: string };

/**
 * Sales contacts our team used before for this board owner (migration 048).
 * The most recent one fills empty fields automatically; others are one tap
 * away, and any can be deleted.
 */
export default function SavedContacts({ ownerKey, ownerLabel, name, phone, onUse }: {
  ownerKey: string | null;
  ownerLabel: string;
  name: string;
  phone: string;
  onUse: (name: string, phone: string) => void;
}) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [error, setError] = useState('');
  const filledFor = useRef<string | null>(null);
  const empty = !name.trim() && !phone.trim();

  useEffect(() => {
    setContacts([]); setConfirming(null); setError('');
    if (!ownerKey) return;
    let cancelled = false;
    supabase.from('owner_sales_contacts').select('id, contact_name, contact_phone')
      .eq('owner_key', ownerKey).order('last_used_at', { ascending: false }).limit(12)
      .then(({ data }) => {
        if (cancelled) return;
        const list = (data as Contact[]) || [];
        setContacts(list);
        // Fill in the last-used contact once per owner, only if nothing is typed yet.
        if (list[0] && empty && filledFor.current !== ownerKey) {
          filledFor.current = ownerKey;
          onUse(list[0].contact_name, list[0].contact_phone);
        }
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerKey]);

  async function remove(c: Contact) {
    setError('');
    const { error: e } = await supabase.from('owner_sales_contacts').delete().eq('id', c.id);
    if (e) { setError('Could not delete that contact. Try again.'); return; }
    setContacts(list => list.filter(x => x.id !== c.id));
    setConfirming(null);
    if (c.contact_name === name.trim() && c.contact_phone === phone.trim()) onUse('', '');
  }

  if (!ownerKey) {
    return (
      <p data-saved-contacts style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: '0 0 8px' }}>
        Pick the board owner at the top to reuse their saved sales contacts.
      </p>
    );
  }
  if (contacts.length === 0) {
    return (
      <p data-saved-contacts style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: '0 0 8px' }}>
        No saved contacts for {ownerLabel} yet. The one you enter is saved for next time.
      </p>
    );
  }

  return (
    <div data-saved-contacts style={{ marginBottom: 10 }}>
      <p style={{ fontSize: '0.75rem', fontWeight: 600, color: '#475569', margin: '0 0 6px' }}>Saved contacts for {ownerLabel}</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {contacts.map(c => {
          const active = c.contact_name === name.trim() && c.contact_phone === phone.trim();
          const label = [c.contact_name, c.contact_phone].filter(Boolean).join(' · ');
          return (
            <span key={c.id} data-saved-contact style={{ display: 'inline-flex', alignItems: 'center', maxWidth: '100%', border: `1px solid ${active ? '#7C3AED' : '#E2E8F0'}`, background: active ? '#F5F3FF' : '#fff', borderRadius: 999, overflow: 'hidden' }}>
              {confirming === c.id ? (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '5px 10px', fontSize: '0.75rem', color: '#0F172A' }}>
                  Delete {c.contact_name || c.contact_phone}?
                  <button type="button" onClick={() => remove(c)} style={{ background: 'none', border: 'none', color: '#DC2626', fontWeight: 700, cursor: 'pointer', padding: 0, fontFamily: 'inherit', fontSize: '0.75rem' }}>Delete</button>
                  <button type="button" onClick={() => setConfirming(null)} style={{ background: 'none', border: 'none', color: '#64748B', fontWeight: 600, cursor: 'pointer', padding: 0, fontFamily: 'inherit', fontSize: '0.75rem' }}>Keep</button>
                </span>
              ) : (
                <>
                  <button type="button" onClick={() => onUse(c.contact_name, c.contact_phone)} title="Use this contact"
                    style={{ background: 'none', border: 'none', padding: '5px 4px 5px 12px', fontSize: '0.75rem', fontWeight: 600, color: active ? '#6D28D9' : '#334155', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>
                    {active ? '✓ ' : ''}{label}
                  </button>
                  <button type="button" onClick={() => setConfirming(c.id)} aria-label={`Delete saved contact ${label}`} title="Delete this saved contact"
                    style={{ background: 'none', border: 'none', padding: '5px 10px 5px 6px', color: '#94A3B8', cursor: 'pointer', fontSize: '0.8125rem', lineHeight: 1, flexShrink: 0 }}>✕</button>
                </>
              )}
            </span>
          );
        })}
      </div>
      {error && <p style={{ fontSize: '0.6875rem', color: '#DC2626', margin: '4px 0 0' }}>{error}</p>}
    </div>
  );
}
