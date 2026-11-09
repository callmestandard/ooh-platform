'use client';

import { useEffect, useState } from 'react';

export type OwnerAccount = { id: string; label: string; email?: string | null };
/** An owner account (ownerId), a typed name for an owner with no account yet, or neither. */
export type OwnerChoice = { ownerId: string | null; ownerName: string };

type Option =
  | { kind: 'account'; account: OwnerAccount }
  | { kind: 'name'; name: string }
  | { kind: 'none' };

/**
 * Type a media owner: matching owner accounts are suggested, and a name with
 * no account is kept as typed (the board stays unclaimed until they sign up).
 */
export default function OwnerPicker({ owners, value, onChange, disabled, compact }: {
  owners: OwnerAccount[];
  value: OwnerChoice;
  onChange: (v: OwnerChoice) => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  const selected = value.ownerId ? owners.find(o => o.id === value.ownerId) ?? null : null;
  const shown = selected ? selected.label : value.ownerName;
  const [text, setText] = useState(shown);
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(0);

  // Keep the box in step when the choice changes from outside (e.g. after the owner list loads).
  useEffect(() => { if (!focused) setText(shown); }, [shown, focused]);

  const q = text.trim().toLowerCase();
  const matches = owners
    .filter(o => !q || o.label.toLowerCase().includes(q) || (o.email ?? '').toLowerCase().includes(q))
    .sort((a, b) => Number(b.label.toLowerCase().startsWith(q)) - Number(a.label.toLowerCase().startsWith(q)))
    .slice(0, 6);
  const exact = owners.some(o => o.label.toLowerCase() === q);
  const options: Option[] = [
    ...matches.map(account => ({ kind: 'account' as const, account })),
    ...(q && !exact ? [{ kind: 'name' as const, name: text.trim() }] : []),
    ...(!q ? [{ kind: 'none' as const }] : []),
  ];

  useEffect(() => { setActive(0); }, [q]);

  function choose(o: Option) {
    setOpen(false);
    if (o.kind === 'account') { onChange({ ownerId: o.account.id, ownerName: '' }); setText(o.account.label); }
    else if (o.kind === 'name') { onChange({ ownerId: null, ownerName: o.name }); setText(o.name); }
    else { onChange({ ownerId: null, ownerName: '' }); setText(''); }
  }

  // Leaving the box keeps what was typed: an exact account match links the
  // account, anything else is kept as a name.
  function commitTyped() {
    const t = text.trim();
    if (selected && t === selected.label) return;
    const match = owners.find(o => o.label.toLowerCase() === t.toLowerCase());
    if (match) { onChange({ ownerId: match.id, ownerName: '' }); setText(match.label); }
    else onChange({ ownerId: null, ownerName: t });
  }

  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') { e.preventDefault(); if (open && options[active]) choose(options[active]); return; }
    if (!open) { if (e.key === 'ArrowDown') setOpen(true); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => (a + 1) % options.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => (a - 1 + options.length) % options.length); }
    else if (e.key === 'Escape') setOpen(false);
  }

  // No badge while the text is being changed; it shows again once a choice is made.
  const badge = text.trim() !== shown.trim() ? null : value.ownerId
    ? { text: 'Has account', bg: '#ECFDF5', color: '#065F46' }
    : value.ownerName.trim() ? { text: 'No account yet', bg: '#FFFBEB', color: '#92400E' } : null;
  const pad = compact ? '8px 10px' : '10px 12px';

  return (
    <div data-owner-picker style={{ position: 'relative' }}>
      <div style={{ display: 'flex', alignItems: 'center', border: `1px solid ${focused ? '#7C3AED' : '#E2E8F0'}`, borderRadius: 8, background: disabled ? '#F8FAFC' : '#fff', transition: 'border-color 0.15s' }}>
        <input
          value={text}
          disabled={disabled}
          onChange={e => { setText(e.target.value); setOpen(true); }}
          onFocus={() => { setFocused(true); setOpen(true); }}
          onBlur={() => { setFocused(false); setOpen(false); commitTyped(); }}
          onKeyDown={onKey}
          placeholder="Type the owner's name, e.g. Sule Outdoor"
          aria-label="Board owner"
          autoComplete="off"
          maxLength={200}
          style={{ flex: 1, padding: pad, border: 'none', outline: 'none', fontSize: compact ? '0.8125rem' : '0.9375rem', fontFamily: 'inherit', color: '#0F172A', background: 'transparent', minWidth: 0 }}
        />
        {badge && (
          <span style={{ marginRight: 8, fontSize: '0.6875rem', fontWeight: 600, padding: '2px 8px', borderRadius: 999, background: badge.bg, color: badge.color, whiteSpace: 'nowrap', flexShrink: 0 }}>{badge.text}</span>
        )}
      </div>

      {open && !disabled && options.length > 0 && (
        <div role="listbox" style={{ position: 'absolute', zIndex: 30, left: 0, right: 0, top: 'calc(100% + 4px)', background: '#fff', border: '1px solid #E2E8F0', borderRadius: 10, overflow: 'hidden', boxShadow: '0 12px 32px rgba(15,23,42,0.14)' }}>
          {options.map((o, i) => (
            <button key={i} type="button" role="option" aria-selected={i === active}
              onMouseDown={e => e.preventDefault()} onClick={() => choose(o)} onMouseEnter={() => setActive(i)}
              style={{ display: 'block', width: '100%', padding: '9px 14px', background: i === active ? '#F5F3FF' : '#fff', border: 'none', borderBottom: i < options.length - 1 ? '1px solid #F1F5F9' : 'none', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit' }}>
              {o.kind === 'account' ? (
                <>
                  <span style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, color: '#0F172A' }}>{o.account.label}</span>
                  <span style={{ display: 'block', fontSize: '0.6875rem', color: '#94A3B8', marginTop: 1 }}>Owner account{o.account.email ? ` · ${o.account.email}` : ''} · board goes on their account</span>
                </>
              ) : o.kind === 'name' ? (
                <>
                  <span style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, color: '#0F172A' }}>Use “{o.name}”</span>
                  <span style={{ display: 'block', fontSize: '0.6875rem', color: '#94A3B8', marginTop: 1 }}>No account yet · the board stays unclaimed until they sign up</span>
                </>
              ) : (
                <span style={{ display: 'block', fontSize: '0.8125rem', color: '#64748B' }}>Owner not known (unclaimed)</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
