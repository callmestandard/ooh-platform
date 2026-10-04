'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useDashboardRole } from '@/components/layout/DashboardLayout';
import { FORMAT_GROUPS, formatGroup } from '@/lib/board-formats';
import {
  MIN_DEALS, fetchOwnDeals, estimateLine, estimateTotals, dealCities,
  saveEstimate, listSavedEstimates, deleteSavedEstimate,
  type OwnDeal, type SavedEstimate,
} from '@/lib/budget-estimator';

type Line = { key: number; city: string; formatKey: string; boards: string; manualRate: string };
type DraftCampaign = { id: string; name: string };

const naira = (n: number) => '₦' + Math.round(n).toLocaleString('en-NG');

const input: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: 8,
  border: '1px solid #E2E8F0', fontSize: '0.8125rem', color: '#0F172A', background: '#fff', fontFamily: 'inherit', outline: 'none',
};
const label: React.CSSProperties = { fontSize: '0.6875rem', fontWeight: 600, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4, display: 'block' };
const card: React.CSSProperties = { background: '#fff', border: '1px solid #E2E8F0', borderRadius: 12, padding: 20 };

let nextKey = 1;
const newLine = (): Line => ({ key: nextKey++, city: '', formatKey: FORMAT_GROUPS[0].key, boards: '1', manualRate: '' });

export default function BudgetEstimatorPage() {
  const role = useDashboardRole();
  const [deals, setDeals] = useState<OwnDeal[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>(() => [newLine()]);
  const [months, setMonths] = useState('3');

  const [drafts, setDrafts] = useState<DraftCampaign[]>([]);
  const [saveTarget, setSaveTarget] = useState<'brief' | 'campaign'>('brief');
  const [briefLabel, setBriefLabel] = useState('');
  const [campaignId, setCampaignId] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [saved, setSaved] = useState<SavedEstimate[]>([]);
  const [savedError, setSavedError] = useState<string | null>(null);

  async function refreshSaved() {
    const { estimates, error } = await listSavedEstimates();
    setSaved(estimates);
    setSavedError(error);
  }

  useEffect(() => {
    if (role !== 'agency') return;
    (async () => {
      const [{ deals, error }, { data: { session } }] = await Promise.all([fetchOwnDeals(), supabase.auth.getSession()]);
      setDeals(deals);
      setLoadError(error);
      if (session) {
        const { data } = await supabase
          .from('campaigns')
          .select('id, name')
          .eq('agency_id', session.user.id)
          .eq('status', 'draft')
          .order('created_at', { ascending: false });
        setDrafts((data ?? []) as DraftCampaign[]);
      }
      await refreshSaved();
      setLoading(false);
    })();
  }, [role]);

  const monthsNum = Math.max(0, Math.floor(Number(months) || 0));
  const cities = useMemo(() => dealCities(deals), [deals]);

  const results = useMemo(
    () => lines.map(l => estimateLine(deals, {
      city: l.city, formatKey: l.formatKey, boards: Number(l.boards) || 0, manualRate: Number(l.manualRate) || null,
    }, monthsNum)),
    [lines, deals, monthsNum],
  );
  const totals = useMemo(() => estimateTotals(results), [results]);
  const ready = monthsNum > 0 && lines.every(l => l.city.trim() && Number(l.boards) > 0);
  const canSave = ready && totals.unpricedLines === 0 && (saveTarget === 'brief' ? briefLabel.trim().length > 0 : !!campaignId);

  function updateLine(key: number, patch: Partial<Line>) {
    setLines(prev => prev.map(l => (l.key === key ? { ...l, ...patch } : l)));
    setSaveMsg(null);
  }

  async function handleSave() {
    setSaving(true);
    const { error } = await saveEstimate({
      campaignId: saveTarget === 'campaign' ? campaignId : null,
      briefLabel: saveTarget === 'brief' ? briefLabel.trim() : null,
      months: monthsNum,
      lines: results,
      low: totals.low,
      high: totals.high,
    });
    setSaving(false);
    setSaveMsg(error ? { ok: false, text: 'Could not save — ' + error } : { ok: true, text: 'Estimate saved.' });
    if (!error) await refreshSaved();
  }

  async function handleDelete(id: string) {
    const { error } = await deleteSavedEstimate(id);
    if (error) setSavedError(error); else await refreshSaved();
  }

  if (role !== 'agency') {
    return <div style={{ padding: 32, color: '#64748B', fontSize: '0.875rem' }}>The budget estimator is available to agency accounts only.</div>;
  }

  return (
    <div style={{ maxWidth: 980, margin: '0 auto', padding: '8px 0 48px', fontFamily: 'inherit' }}>
      <h1 style={{ fontSize: '1.375rem', fontWeight: 800, color: '#0F172A', margin: '0 0 4px', letterSpacing: '-0.02em' }}>Budget estimator</h1>
      <p style={{ fontSize: '0.875rem', color: '#64748B', margin: '0 0 20px', maxWidth: 640 }}>
        A quick cost range for a brief with no firm budget, worked out from the rates your own agency has agreed on past bookings. Private to your agency.
      </p>

      {loadError && (
        <div style={{ ...card, borderColor: '#FECACA', background: '#FEF2F2', color: '#B91C1C', fontSize: '0.8125rem', marginBottom: 16 }}>
          Could not load your deal history — {loadError}
        </div>
      )}

      <div style={{ ...card, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, marginBottom: 16 }}>
          <div style={{ width: 160 }}>
            <span style={label}>Duration (months)</span>
            <input type="number" min={1} value={months} onChange={e => { setMonths(e.target.value); setSaveMsg(null); }} style={input} aria-label="Duration in months" />
          </div>
          <p style={{ fontSize: '0.75rem', color: '#94A3B8', margin: '0 0 9px' }}>
            {loading ? 'Loading your deal history…' : `${deals.length} past deal${deals.length !== 1 ? 's' : ''} with an agreed rate on your campaigns`}
          </p>
        </div>

        <datalist id="estimator-cities">{cities.map(c => <option key={c} value={c} />)}</datalist>

        {lines.map((l, i) => {
          const r = results[i];
          const fmt = formatGroup(l.formatKey)?.label ?? l.formatKey;
          return (
            <div key={l.key} data-line={i} style={{ borderTop: '1px solid #F1F5F9', padding: '14px 0' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1.2fr 0.7fr auto', gap: 12, alignItems: 'end' }}>
                <div>
                  <span style={label}>City</span>
                  <input list="estimator-cities" value={l.city} onChange={e => updateLine(l.key, { city: e.target.value })} placeholder="e.g. Lagos" style={input} aria-label="City" />
                </div>
                <div>
                  <span style={label}>Format</span>
                  <select value={l.formatKey} onChange={e => updateLine(l.key, { formatKey: e.target.value })} style={input} aria-label="Format">
                    {FORMAT_GROUPS.map(g => <option key={g.key} value={g.key}>{g.label}</option>)}
                  </select>
                </div>
                <div>
                  <span style={label}>Boards</span>
                  <input type="number" min={1} value={l.boards} onChange={e => updateLine(l.key, { boards: e.target.value })} style={input} aria-label="Number of boards" />
                </div>
                <button
                  onClick={() => setLines(prev => prev.filter(x => x.key !== l.key))}
                  disabled={lines.length === 1}
                  style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid #E2E8F0', background: '#fff', color: lines.length === 1 ? '#CBD5E1' : '#EF4444', cursor: lines.length === 1 ? 'not-allowed' : 'pointer', fontSize: '0.75rem', fontWeight: 600, fontFamily: 'inherit' }}
                >
                  Remove
                </button>
              </div>

              {l.city.trim() && !loading && (
                r.basis ? (
                  <div data-basis="history" style={{ marginTop: 10, padding: '10px 12px', borderRadius: 8, background: '#F0FDF4', border: '1px solid #BBF7D0', fontSize: '0.8125rem', color: '#14532D' }}>
                    <strong>{naira(r.basis.low)} – {naira(r.basis.high)}</strong> per board per month
                    <span style={{ color: '#15803D' }}> · based on {r.basis.dealCount} past deals in {l.city.trim()}, {fmt}</span>
                    <div style={{ fontSize: '0.75rem', color: '#15803D', marginTop: 3 }}>
                      Range is the middle half of those agreed rates (median {naira(r.basis.median)}; lowest {naira(r.basis.min)}, highest {naira(r.basis.max)}).
                    </div>
                  </div>
                ) : (
                  <div data-basis="insufficient" style={{ marginTop: 10, padding: '10px 12px', borderRadius: 8, background: '#FFFBEB', border: '1px solid #FDE68A', fontSize: '0.8125rem', color: '#78350F' }}>
                    <strong>Not enough data yet</strong> — {r.dealCount === 0 ? 'no past deals' : `only ${r.dealCount} past deal${r.dealCount !== 1 ? 's' : ''}`} in {l.city.trim()}, {fmt} (at least {MIN_DEALS} needed).
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
                      <span style={{ fontSize: '0.75rem' }}>Your own assumption, ₦ per board per month:</span>
                      <input type="number" min={0} value={l.manualRate} onChange={e => updateLine(l.key, { manualRate: e.target.value })} placeholder="e.g. 500000" style={{ ...input, width: 170 }} aria-label="Manual rate per board per month" />
                    </div>
                  </div>
                )
              )}
            </div>
          );
        })}

        <button onClick={() => setLines(prev => [...prev, newLine()])} style={{ marginTop: 4, padding: '8px 14px', borderRadius: 8, border: '1px dashed #CBD5E1', background: '#F8FAFC', color: '#1B4F8A', cursor: 'pointer', fontSize: '0.8125rem', fontWeight: 600, fontFamily: 'inherit' }}>
          + Add another city or format
        </button>
      </div>

      {/* ── Result ── */}
      <div style={{ ...card, marginBottom: 16, borderLeft: '4px solid #1B4F8A' }}>
        <span style={label}>Estimated media cost</span>
        {!ready ? (
          <p style={{ fontSize: '0.875rem', color: '#94A3B8', margin: 0 }}>Enter a city, number of boards and duration for every line.</p>
        ) : totals.unpricedLines === lines.length ? (
          <p data-total="none" style={{ fontSize: '0.9375rem', fontWeight: 700, color: '#78350F', margin: 0 }}>Not enough data yet — add a rate assumption above to get an estimate.</p>
        ) : (
          <>
            <p data-total="range" style={{ fontSize: '1.625rem', fontWeight: 800, color: '#0F172A', fontFamily: "'JetBrains Mono', monospace", margin: '2px 0 6px' }}>
              {totals.low === totals.high ? naira(totals.low) : `${naira(totals.low)} – ${naira(totals.high)}`}
            </p>
            <p style={{ fontSize: '0.75rem', color: '#64748B', margin: 0 }}>
              Per-board monthly rate × boards × {monthsNum} month{monthsNum !== 1 ? 's' : ''}, summed across lines. Media cost only — excludes printing, installation, agency fees and taxes.
              {totals.manualLines > 0 && ` ${totals.manualLines} line${totals.manualLines !== 1 ? 's use' : ' uses'} your own rate assumption, not deal history.`}
              {totals.unpricedLines > 0 && ` ${totals.unpricedLines} line${totals.unpricedLines !== 1 ? 's are' : ' is'} not included because there is no rate for ${totals.unpricedLines !== 1 ? 'them' : 'it'} yet.`}
            </p>
          </>
        )}
      </div>

      {/* ── Save ── */}
      <div style={{ ...card, marginBottom: 16 }}>
        <span style={label}>Save this estimate against</span>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          {(['brief', 'campaign'] as const).map(t => (
            <button key={t} onClick={() => setSaveTarget(t)} style={{ padding: '6px 14px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: '0.8125rem', fontWeight: 600, fontFamily: 'inherit', background: saveTarget === t ? '#1B4F8A' : '#F1F5F9', color: saveTarget === t ? '#fff' : '#475569' }}>
              {t === 'brief' ? 'A brief' : 'A campaign draft'}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          {saveTarget === 'brief' ? (
            <input value={briefLabel} onChange={e => setBriefLabel(e.target.value)} placeholder="Brief name or reference" style={{ ...input, maxWidth: 360 }} aria-label="Brief name" />
          ) : (
            <select value={campaignId} onChange={e => setCampaignId(e.target.value)} style={{ ...input, maxWidth: 360 }} aria-label="Campaign draft">
              <option value="">{drafts.length ? 'Choose a campaign draft…' : 'No campaign drafts yet'}</option>
              {drafts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          )}
          <button onClick={handleSave} disabled={!canSave || saving} style={{ padding: '8px 18px', borderRadius: 8, border: 'none', fontSize: '0.8125rem', fontWeight: 600, fontFamily: 'inherit', background: canSave ? '#1B4F8A' : '#F1F5F9', color: canSave ? '#fff' : '#94A3B8', cursor: canSave ? 'pointer' : 'not-allowed' }}>
            {saving ? 'Saving…' : 'Save estimate'}
          </button>
        </div>
        {saveMsg && <p style={{ fontSize: '0.75rem', margin: '8px 0 0', color: saveMsg.ok ? '#15803D' : '#B91C1C' }}>{saveMsg.text}</p>}
      </div>

      {/* ── Saved ── */}
      <div style={card}>
        <span style={label}>Saved estimates</span>
        {savedError ? (
          <p style={{ fontSize: '0.8125rem', color: '#B91C1C', margin: 0 }}>Could not load saved estimates — {savedError}</p>
        ) : saved.length === 0 ? (
          <p style={{ fontSize: '0.8125rem', color: '#94A3B8', margin: 0 }}>Nothing saved yet.</p>
        ) : saved.map(s => (
          <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderTop: '1px solid #F1F5F9' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#0F172A', margin: 0 }}>
                {s.campaigns?.name ? `Campaign draft: ${s.campaigns.name}` : `Brief: ${s.brief_label ?? '—'}`}
              </p>
              <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: '2px 0 0' }}>
                {s.lines.map(l => `${l.boards} × ${formatGroup(l.formatKey)?.label ?? l.formatKey} in ${l.city}`).join(' · ')} · {s.duration_months} mo · {new Date(s.created_at).toLocaleDateString('en-NG')}
              </p>
            </div>
            <span style={{ fontSize: '0.8125rem', fontWeight: 700, color: '#1B4F8A', fontFamily: "'JetBrains Mono', monospace", flexShrink: 0 }}>
              {Number(s.low_total) === Number(s.high_total) ? naira(Number(s.low_total)) : `${naira(Number(s.low_total))} – ${naira(Number(s.high_total))}`}
            </span>
            <button onClick={() => handleDelete(s.id)} style={{ fontSize: '0.6875rem', fontWeight: 600, color: '#EF4444', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>Delete</button>
          </div>
        ))}
      </div>
    </div>
  );
}
