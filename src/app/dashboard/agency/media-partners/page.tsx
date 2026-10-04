'use client';

import { useEffect, useState } from 'react';
import { useDashboardRole } from '@/components/layout/DashboardLayout';
import { input, label, card, h1, sub, page, errorBox } from '@/components/owner/ui';
import {
  listMediaPartners, setVendorPreference, VENDOR_PREFERENCE_LABELS, VENDOR_PREFERENCE_STYLE,
  type MediaPartner, type VendorPreference,
} from '@/lib/vendor-preferences';

const OPTIONS: VendorPreference[] = ['preferred', 'direct', 'excluded'];

export default function MediaPartnersPage() {
  const role = useDashboardRole();
  const [partners, setPartners] = useState<MediaPartner[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | VendorPreference>('all');
  const [query, setQuery] = useState('');

  async function load() {
    const { partners, error } = await listMediaPartners();
    setPartners(partners);
    setError(error);
    setLoading(false);
  }
  useEffect(() => { if (role === 'agency') (async () => { await load(); })(); }, [role]);

  async function choose(p: MediaPartner, next: VendorPreference | null) {
    setError(null);
    const { error } = await setVendorPreference(p.owner_id, next, p.notes);
    if (error) setError(error); else await load();
  }
  async function saveNotes(p: MediaPartner, notes: string) {
    if (!p.preference || (p.notes ?? '') === notes.trim()) return;
    const { error } = await setVendorPreference(p.owner_id, p.preference, notes);
    if (error) setError(error); else await load();
  }

  if (role !== 'agency') return <div style={page}><p style={{ color: '#64748B', fontSize: '0.875rem' }}>Media partner preferences are for agency accounts.</p></div>;

  const excluded = partners.filter(p => p.preference === 'excluded');
  const shown = partners
    .filter(p => filter === 'all' || p.preference === filter)
    .filter(p => p.owner_name.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <div style={page}>
      <h1 style={h1}>Media partners</h1>
      <p style={sub}>
        Mark the media owners you work with. These settings are private to your agency: owners and other agencies cannot see them.
        They change only what you see when searching and shortlisting — existing bookings and plan lines are never affected.
      </p>
      {error && <div style={errorBox}>{error}</div>}

      {excluded.length > 0 && (
        <div data-excluded-summary={excluded.length} style={{ ...card, borderColor: '#FECACA', background: '#FEF2F2' }}>
          <p style={{ fontSize: '0.875rem', fontWeight: 700, color: '#991B1B', margin: '0 0 6px' }}>
            {excluded.length} owner{excluded.length !== 1 ? 's' : ''} excluded
          </p>
          <p style={{ fontSize: '0.75rem', color: '#7F1D1D', margin: '0 0 10px' }}>Their boards are hidden from your shortlists, planner suggestions, map and brief matching.</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {excluded.map(p => (
              <span key={p.owner_id} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: '0.75rem', background: '#fff', border: '1px solid #FECACA', borderRadius: 999, padding: '4px 6px 4px 12px', color: '#7F1D1D' }}>
                {p.owner_name}
                <button data-undo={p.owner_id} onClick={() => choose(p, null)} style={{ border: 'none', background: '#991B1B', color: '#fff', borderRadius: 999, padding: '3px 9px', fontSize: '0.6875rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>Undo</button>
              </span>
            ))}
          </div>
        </div>
      )}

      <div style={card}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 12 }}>
          <input style={{ ...input, maxWidth: 260 }} placeholder="Search owners" value={query} onChange={e => setQuery(e.target.value)} aria-label="Search owners" />
          {(['all', ...OPTIONS] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)} style={{ padding: '6px 12px', borderRadius: 999, border: '1px solid #E2E8F0', background: filter === f ? '#1B4F8A' : '#fff', color: filter === f ? '#fff' : '#475569', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
              {f === 'all' ? `All (${partners.length})` : `${VENDOR_PREFERENCE_LABELS[f]} (${partners.filter(p => p.preference === f).length})`}
            </button>
          ))}
        </div>

        <span style={label}>Owners with boards on the platform</span>
        {loading ? <p style={{ fontSize: '0.8125rem', color: '#94A3B8', margin: 0 }}>Loading…</p>
          : shown.length === 0 ? <p style={{ fontSize: '0.8125rem', color: '#94A3B8', margin: 0 }}>No owners to show.</p>
          : shown.map(p => (
            <div key={p.owner_id} data-partner={p.owner_id} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, padding: '11px 0', borderTop: '1px solid #F1F5F9' }}>
              <div style={{ flex: '1 1 200px', minWidth: 0 }}>
                <p style={{ fontSize: '0.875rem', fontWeight: 700, color: '#0F172A', margin: 0 }}>{p.owner_name}</p>
                <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: '2px 0 0' }}>{p.board_count} board{p.board_count !== 1 ? 's' : ''}</p>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                {OPTIONS.map(o => {
                  const on = p.preference === o;
                  const s = VENDOR_PREFERENCE_STYLE[o];
                  return (
                    <button key={o} data-pref={o} onClick={() => choose(p, on ? null : o)}
                      style={{ padding: '5px 11px', borderRadius: 999, border: `1px solid ${on ? s.color : '#E2E8F0'}`, background: on ? s.bg : '#fff', color: on ? s.color : '#475569', fontSize: '0.6875rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                      {on ? '✓ ' : ''}{VENDOR_PREFERENCE_LABELS[o]}
                    </button>
                  );
                })}
              </div>
              <input style={{ ...input, flex: '1 1 200px', maxWidth: 300 }} placeholder={p.preference ? 'Private note' : 'Set a preference to add a note'} disabled={!p.preference}
                defaultValue={p.notes ?? ''} key={p.owner_id + (p.preference ?? '')} onBlur={e => saveNotes(p, e.target.value)} aria-label="Private note" />
            </div>
          ))}
      </div>
    </div>
  );
}
