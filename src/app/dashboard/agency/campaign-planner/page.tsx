'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { supabase } from '@/lib/supabase';
import { createNotification } from '@/lib/notifications';
import { formatNaira } from '@/lib/utils';
import type { Board } from '@/app/dashboard/agency/boards-map/page';
import type { AudienceProfile } from '@/lib/types';

type ImportRow = {
  row_index:    number;
  board_name:   string;
  city:         string;
  state:        string;
  format:       string;
  start_date:   string;
  end_date:     string;
  offered_rate: number | null;
  notes:        string;
  board_id:     string | null;
  matched_name: string | null;
  matched_city: string | null;
  confidence:   'exact' | 'fuzzy' | 'none';
};

type ImportResult = {
  rows:    ImportRow[];
  summary: { total: number; exact: number; fuzzy: number; unmatched: number };
};

const PlannerMap = dynamic(() => import('@/components/campaign-planner/PlannerMap'), {
  ssr: false,
  loading: () => (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', background: '#F8FAFC' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ width: 28, height: 28, border: '3px solid #E2E8F0', borderTopColor: '#1B4F8A', borderRadius: '50%', animation: 'spin 0.7s linear infinite', margin: '0 auto 10px' }} />
        <p style={{ fontSize: '0.8125rem', color: '#94A3B8', margin: 0 }}>Loading map…</p>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    </div>
  ),
});

type Objective = 'awareness' | 'launch' | 'engagement' | 'conversion';

type PlanForm = {
  name: string;
  client_name: string;
  start_date: string;
  end_date: string;
  total_budget: string;
  objective: Objective | '';
};

const OBJECTIVES: { value: Objective; label: string; icon: string; desc: string }[] = [
  { value: 'awareness',  label: 'Brand Awareness',   icon: '📢', desc: 'Max reach across multiple locations' },
  { value: 'launch',     label: 'Product Launch',    icon: '🚀', desc: 'High-impact, premium sites' },
  { value: 'engagement', label: 'Engagement',        icon: '💬', desc: 'Dwell-time locations — malls, transit' },
  { value: 'conversion', label: 'Drive Conversion',  icon: '🎯', desc: 'Near point-of-purchase proximity' },
];

const CITY_PRIORITY: Record<string, number> = {
  lagos: 10, abuja: 9, 'port harcourt': 8, kano: 7, ibadan: 6,
};

const FORMAT_PRIORITY: Record<Objective, string[]> = {
  awareness:  ['unipole', 'gantry', 'billboard', 'bridge_panel', 'wall_drape'],
  launch:     ['gantry', 'unipole', 'bridge_panel', 'billboard', 'wall_drape'],
  engagement: ['billboard', 'wall_drape', 'unipole', 'bridge_panel', 'gantry'],
  conversion: ['billboard', 'bridge_panel', 'wall_drape', 'unipole', 'gantry'],
};


function flightDays(start: string, end: string) {
  if (!start || !end) return 0;
  const ms = new Date(end).getTime() - new Date(start).getTime();
  return Math.max(0, Math.ceil(ms / 86400000));
}

function estimateImpressions(board: Board, days: number): number {
  // rough heuristic by format + city
  const city = (board.city || '').toLowerCase();
  const cp = CITY_PRIORITY[city] || 4;
  const formatBase: Record<string, number> = {
    gantry: 80000, unipole: 60000, billboard: 40000, bridge_panel: 70000, wall_drape: 30000,
  };
  const base = formatBase[board.format || 'billboard'] ?? 40000;
  return Math.round(base * (cp / 10) * (days / 30));
}

// Smart suggest: pick best boards within budget for the objective
// Audience profiles (when available) add a third scoring dimension beyond city + format
function smartSuggest(
  boards: Board[],
  budget: number,
  objective: Objective,
  audienceProfiles?: Record<string, AudienceProfile>
): string[] {
  const available = boards.filter(b => b.status === 'available' && b.asking_rate);
  const fmtPriority = FORMAT_PRIORITY[objective];

  const scored = available.map(b => {
    const cityScore = CITY_PRIORITY[(b.city || '').toLowerCase()] || 3;
    const fmtScore = fmtPriority.length - fmtPriority.indexOf(b.format || '');
    const normalizedFmt = fmtPriority.indexOf(b.format || '') >= 0 ? fmtScore : 0;
    const rate = b.asking_rate || 1;

    // Audience bonus from stored profile — objective-matched signal
    let audienceBonus = 0;
    const p = audienceProfiles?.[b.id];
    if (p) {
      switch (objective) {
        case 'awareness':   audienceBonus = (p.footfall_score + p.commercial_score) / 4; break;
        case 'launch':      audienceBonus = (p.premium_score + p.commercial_score) / 4; break;
        case 'engagement':  audienceBonus = (p.youth_score + p.footfall_score) / 4; break;
        case 'conversion':  audienceBonus = (p.commercial_score + p.footfall_score) / 4; break;
      }
    }

    const valueScore = (cityScore * 100 + normalizedFmt * 50 + audienceBonus) / (rate / 100000);
    return { board: b, score: valueScore };
  });

  scored.sort((a, b) => b.score - a.score);

  const selected: string[] = [];
  let spent = 0;

  for (const { board } of scored) {
    const rate = board.asking_rate || 0;
    if (spent + rate <= budget * 0.92) {
      selected.push(board.id);
      spent += rate;
    }
    if (spent >= budget * 0.75 && selected.length >= 5) break;
    if (selected.length >= 20) break;
  }

  return selected;
}

type Toast = { msg: string; type: 'success' | 'error' };

type ParsedBrief = {
  client_name: string;
  campaign_name: string;
  objective: PlanForm['objective'];
  total_budget: number;
  start_date: string;
  end_date: string;
  cities: string[];
  formats: string[];
  notes: string;
  confidence: number;
  warnings: string[];
};

export default function CampaignPlannerPage() {
  const router = useRouter();
  const [boards, setBoards] = useState<Board[]>([]);
  const [audienceProfiles, setAudienceProfiles] = useState<Record<string, AudienceProfile>>({});
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [step, setStep] = useState<1 | 2>(1); // 1 = details, 2 = boards
  const [form, setForm] = useState<PlanForm>({
    name: '', client_name: '', start_date: '', end_date: '',
    total_budget: '', objective: '',
  });
  // Brief mode
  const [briefMode, setBriefMode] = useState(false);
  const [briefText, setBriefText] = useState('');
  const [parsing, setParsing] = useState(false);
  const [parsedBrief, setParsedBrief] = useState<ParsedBrief | null>(null);

  // Excel import
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importMode, setImportMode] = useState(false);

  useEffect(() => {
    supabase
      .from('boards')
      .select('id, name, address, latitude, longitude, width, height, format, asking_rate, photos, status, state, city')
      .not('latitude', 'is', null)
      .not('longitude', 'is', null)
      .then(({ data }) => {
        setBoards((data as Board[]) || []);
        setLoading(false);
      });

    supabase
      .from('board_audience_profiles')
      .select('*')
      .then(({ data }) => {
        if (data) {
          const map: Record<string, AudienceProfile> = {};
          data.forEach((p: AudienceProfile) => { map[p.board_id] = p; });
          setAudienceProfiles(map);
        }
      });
  }, []);

  function showToast(msg: string, type: Toast['type'] = 'success') {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }

  const toggleBoard = useCallback((board: Board) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(board.id)) next.delete(board.id);
      else next.add(board.id);
      return next;
    });
  }, []);

  const selectedBoards = boards.filter(b => selectedIds.has(b.id));
  const budget = Number(form.total_budget) || 0;
  const totalCost = selectedBoards.reduce((s, b) => s + (b.asking_rate || 0), 0);
  const days = flightDays(form.start_date, form.end_date);
  const totalImpressions = selectedBoards.reduce((s, b) => s + estimateImpressions(b, days), 0);
  const budgetPct = budget > 0 ? Math.min(100, Math.round((totalCost / budget) * 100)) : 0;
  const overBudget = budget > 0 && totalCost > budget;

  function handleSuggest() {
    if (!form.objective) { showToast('Pick a campaign objective first', 'error'); return; }
    if (!form.total_budget || budget <= 0) { showToast('Enter a total budget first', 'error'); return; }
    setSuggesting(true);
    setTimeout(() => {
      const profileCount = Object.keys(audienceProfiles).length;
      const ids = smartSuggest(boards, budget, form.objective as Objective, audienceProfiles);
      setSelectedIds(new Set(ids));
      setSuggesting(false);
      const suffix = profileCount > 0 ? ` (audience data from ${profileCount} enriched boards)` : '';
      showToast(`Smart Suggest picked ${ids.length} boards optimised for ${form.objective}${suffix}`);
    }, 700);
  }

  function validateStep1() {
    const e: Record<string, string> = {};
    if (!form.name.trim()) e.name = 'Required';
    if (!form.client_name.trim()) e.client_name = 'Required';
    if (!form.objective) e.objective = 'Select an objective';
    if (!form.total_budget || budget <= 0) e.total_budget = 'Enter a valid budget';
    if (!form.start_date) e.start_date = 'Required';
    if (!form.end_date) e.end_date = 'Required';
    if (form.start_date && form.end_date && form.end_date <= form.start_date) e.end_date = 'Must be after start date';
    return e;
  }

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setImportResult(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/import-plan', { method: 'POST', body: fd });
      const json = await res.json();
      if (!res.ok) { showToast(json.error || 'Import failed', 'error'); return; }
      setImportResult(json as ImportResult);
      setImportMode(true);
    } catch {
      showToast('Failed to read file', 'error');
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  function applyImport() {
    if (!importResult) return;
    const matchedIds = importResult.rows
      .filter(r => r.board_id && r.confidence !== 'none')
      .map(r => r.board_id!);
    setSelectedIds(new Set(matchedIds));

    // Pre-fill dates from first row that has them
    const firstDated = importResult.rows.find(r => r.start_date && r.end_date);
    if (firstDated) {
      setForm(prev => ({
        ...prev,
        start_date: prev.start_date || firstDated.start_date,
        end_date:   prev.end_date   || firstDated.end_date,
      }));
    }

    setImportMode(false);
    setStep(2);
    showToast(`${matchedIds.length} boards loaded from Excel — review and confirm`);
  }

  async function handleCreate() {
    if (selectedIds.size === 0) { showToast('Select at least one board', 'error'); return; }
    if (overBudget) { showToast('Total cost exceeds budget', 'error'); return; }

    setSaving(true);

    // 1. Create campaign
    const { data: { session: cpSession } } = await supabase.auth.getSession();
    const { data: camp, error: campErr } = await supabase
      .from('campaigns')
      .insert({
        name: form.name.trim(),
        client_name: form.client_name.trim(),
        start_date: form.start_date,
        end_date: form.end_date,
        total_budget: budget,
        status: 'draft',
        plan_notes: `Objective: ${form.objective}. Created via Campaign Planner.`,
        agency_id: cpSession?.user?.id ?? null,
      })
      .select()
      .single();

    if (campErr || !camp) {
      setSaving(false);
      showToast('Failed to save campaign', 'error');
      return;
    }

    // 2. Create bookings for each selected board
    const bookingRows = selectedBoards.map(b => ({
      campaign_id: camp.id,
      board_id: b.id,
      offered_rate: b.asking_rate,
      status: 'pending',
    }));

    const { error: bookErr } = await supabase.from('bookings').insert(bookingRows);

    setSaving(false);

    if (bookErr) {
      showToast('Campaign saved but some bookings failed', 'error');
    } else {
      // Notify board owners of incoming booking requests
      await createNotification({
        recipientRole: 'owner',
        type: 'new_booking',
        title: `New booking request — ${camp.name}`,
        body: `${bookingRows.length} board${bookingRows.length !== 1 ? 's' : ''} requested for "${camp.name}"`,
        link: `/dashboard/owner`,
      });
      showToast(`Campaign "${camp.name}" created with ${bookingRows.length} booking requests!`);
      setTimeout(() => router.push(`/dashboard/agency/campaigns`), 1200);
    }
  }

  async function handleParseBrief() {
    if (!briefText.trim() || briefText.trim().length < 15) {
      showToast('Please enter a more detailed brief', 'error');
      return;
    }
    setParsing(true);
    try {
      const res = await fetch('/api/campaign-brief', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brief: briefText }),
      });
      const parsed: ParsedBrief = await res.json();
      setParsedBrief(parsed);
      // Pre-fill form
      setForm({
        name:         parsed.campaign_name || '',
        client_name:  parsed.client_name || '',
        objective:    parsed.objective || '',
        total_budget: parsed.total_budget > 0 ? parsed.total_budget.toString() : '',
        start_date:   parsed.start_date || '',
        end_date:     parsed.end_date || '',
      });
      setBriefMode(false);
      showToast(`Brief parsed (${parsed.confidence}% confidence) — review details below`);
    } catch {
      showToast('Failed to parse brief', 'error');
    } finally {
      setParsing(false);
    }
  }

  async function handleExportPDF() {
    if (selectedBoards.length === 0) { showToast('Select at least one board first', 'error'); return; }
    setExporting(true);
    try {
      const boardsPayload = selectedBoards.map(b => ({
        id: b.id,
        name: b.name,
        address: b.address || '',
        city: b.city || '',
        state: b.state || '',
        format: b.format || 'billboard',
        asking_rate: b.asking_rate || 0,
        width: b.width,
        height: b.height,
        estimated_impressions: estimateImpressions(b, days),
      }));

      const res = await fetch('/api/media-plan-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaign_name: form.name || 'Media Plan',
          client_name:   form.client_name || '',
          objective:     form.objective || 'awareness',
          start_date:    form.start_date,
          end_date:      form.end_date,
          total_budget:  budget,
          boards:        boardsPayload,
          notes:         parsedBrief?.notes || '',
        }),
      });

      if (!res.ok) throw new Error('PDF generation failed');

      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `media-plan-${(form.name || 'campaign').replace(/\s+/g, '-').toLowerCase()}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast('Media plan PDF downloaded!');
    } catch {
      showToast('Failed to export PDF', 'error');
    } finally {
      setExporting(false);
    }
  }

  const f = (field: keyof PlanForm) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) => {
    setForm(prev => ({ ...prev, [field]: e.target.value }));
    if (errors[field]) setErrors(prev => { const n = { ...prev }; delete n[field]; return n; });
  };

  const INPUT_STYLE: React.CSSProperties = {
    width: '100%', padding: '9px 12px', borderRadius: '8px',
    border: '1.5px solid #E2E8F0', fontSize: '0.8125rem', color: '#0F172A',
    background: '#fff', outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit',
  };

  const LABEL_STYLE: React.CSSProperties = {
    fontSize: '0.75rem', fontWeight: 600, color: '#475569', marginBottom: 4, display: 'block',
  };

  const ERR_STYLE: React.CSSProperties = {
    fontSize: '0.6875rem', color: '#DC2626', marginTop: 3,
  };

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 56px)', margin: '0 -32px', overflow: 'hidden', background: '#F8FAFC', fontFamily: 'inherit' }}>

      {/* ── Left: Map ── */}
      <div style={{ flex: 1, position: 'relative', minWidth: 0 }}>
        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
            <div style={{ width: 32, height: 32, border: '3px solid #E2E8F0', borderTopColor: '#1B4F8A', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </div>
        ) : (
          <PlannerMap
            boards={boards}
            selectedIds={selectedIds}
            onToggleBoard={toggleBoard}
            highlightedId={highlightedId}
          />
        )}

        {/* Map legend overlay */}
        <div style={{
          position: 'absolute', bottom: 16, left: 16, zIndex: 10,
          background: 'rgba(255,255,255,0.95)', borderRadius: '10px',
          padding: '10px 14px', boxShadow: '0 2px 12px rgba(0,0,0,0.1)',
          fontSize: '0.6875rem', color: '#475569', backdropFilter: 'blur(4px)',
        }}>
          <div style={{ fontWeight: 700, color: '#0F172A', marginBottom: 6 }}>Board status</div>
          {[
            { color: '#10B981', label: 'Available — click to add' },
            { color: '#1B4F8A', label: 'Selected for plan' },
            { color: '#94A3B8', label: 'Booked / unavailable' },
          ].map(({ color, label }) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: color, flexShrink: 0 }} />
              {label}
            </div>
          ))}
        </div>

        {/* Selected count badge */}
        {selectedIds.size > 0 && (
          <div style={{
            position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)',
            zIndex: 10, background: '#1B4F8A', color: '#fff',
            borderRadius: '999px', padding: '6px 16px', fontSize: '0.8125rem', fontWeight: 700,
            boxShadow: '0 4px 16px rgba(27,79,138,0.35)',
          }}>
            {selectedIds.size} board{selectedIds.size !== 1 ? 's' : ''} selected · {formatNaira(totalCost)}
          </div>
        )}

        {/* Hint when no boards selected */}
        {selectedIds.size === 0 && !loading && (
          <div style={{
            position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)',
            zIndex: 10, background: 'rgba(255,255,255,0.95)', color: '#475569',
            borderRadius: '999px', padding: '6px 18px', fontSize: '0.8125rem',
            boxShadow: '0 2px 10px rgba(0,0,0,0.1)', whiteSpace: 'nowrap',
          }}>
            Click green pins to add boards to your plan
          </div>
        )}
      </div>

      {/* ── Right: Planning panel ── */}
      <div style={{
        width: 400, background: '#fff', borderLeft: '1px solid #E2E8F0',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        boxShadow: '-4px 0 24px rgba(0,0,0,0.04)',
      }}>

        {/* Panel header */}
        <div style={{ padding: '20px 20px 0', borderBottom: '1px solid #F1F5F9' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <div>
              <h1 style={{ fontSize: '1rem', fontWeight: 700, color: '#0F172A', margin: '0 0 2px', letterSpacing: '-0.02em' }}>
                Campaign Planner
              </h1>
              <p style={{ fontSize: '0.75rem', color: '#94A3B8', margin: 0 }}>
                Select boards on the map, then create your media plan
              </p>
            </div>
            <button
              onClick={() => router.push('/dashboard/agency/campaigns')}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8', padding: 4, borderRadius: 6, display: 'flex' }}
              title="Back to Campaigns"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>

          {/* Import / Brief row */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>

            {/* Excel import button */}
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={importing}
              style={{
                flex: 1, padding: '8px 10px', borderRadius: '8px',
                border: '1.5px dashed #A7F3D0',
                background: importing ? '#F0FDF4' : 'transparent',
                cursor: importing ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center', gap: 6,
                fontFamily: 'inherit', transition: 'all 0.15s',
              }}
            >
              {importing
                ? <span style={{ width: 12, height: 12, border: '2px solid #A7F3D0', borderTopColor: '#10B981', borderRadius: '50%', animation: 'spin 0.7s linear infinite', display: 'inline-block', flexShrink: 0 }} />
                : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                    <polyline points="14 2 14 8 20 8"/>
                    <polyline points="12 18 12 12"/><polyline points="9 15 12 12 15 15"/>
                  </svg>
              }
              <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#059669' }}>
                {importing ? 'Reading…' : 'Import Excel'}
              </span>
            </button>
            <input ref={fileInputRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={handleImportFile} />

            {/* Download template */}
            <a
              href="/api/plan-template"
              download
              style={{
                padding: '8px 10px', borderRadius: '8px',
                border: '1.5px dashed #A7F3D0', background: 'transparent',
                display: 'flex', alignItems: 'center', gap: 5,
                textDecoration: 'none', transition: 'all 0.15s',
              }}
              title="Download Excel template"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              <span style={{ fontSize: '0.6875rem', fontWeight: 600, color: '#059669' }}>Template</span>
            </a>
          </div>

          {/* Brief mode toggle */}
          <button
            onClick={() => setBriefMode(b => !b)}
            style={{
              width: '100%', marginBottom: 10,
              padding: '8px 12px', borderRadius: '8px', border: '1.5px dashed',
              borderColor: briefMode ? '#7C3AED' : '#C4B5FD',
              background: briefMode ? '#F5F3FF' : 'transparent',
              cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
              fontFamily: 'inherit', transition: 'all 0.15s',
            }}
          >
            <span style={{ fontSize: '14px' }}>✨</span>
            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: briefMode ? '#7C3AED' : '#8B5CF6', flex: 1, textAlign: 'left' }}>
              {briefMode ? 'Close brief input' : 'Start with a brief — describe your campaign in plain text'}
            </span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8B5CF6" strokeWidth="2" strokeLinecap="round">
              <path d={briefMode ? 'M18 15l-6-6-6 6' : 'M6 9l6 6 6-6'} />
            </svg>
          </button>

          {/* Brief input panel */}
          {briefMode && (
            <div style={{ marginBottom: 10 }}>
              <textarea
                value={briefText}
                onChange={e => setBriefText(e.target.value)}
                placeholder={'Describe your campaign in plain English.\n\nExample: "We need a 4-week brand awareness campaign for MTN in Lagos and Abuja, budget ₦15M, targeting commuters on major highways, starting in April."'}
                rows={6}
                style={{
                  width: '100%', padding: '10px 12px', borderRadius: '8px',
                  border: '1.5px solid #C4B5FD', fontSize: '0.8125rem', color: '#0F172A',
                  background: '#FAFAFF', outline: 'none', resize: 'vertical',
                  fontFamily: 'inherit', lineHeight: 1.5, boxSizing: 'border-box',
                }}
              />
              <button
                onClick={handleParseBrief}
                disabled={parsing || briefText.trim().length < 15}
                style={{
                  width: '100%', marginTop: 6, padding: '9px', borderRadius: '8px', border: 'none',
                  background: parsing || briefText.trim().length < 15 ? '#C4B5FD' : '#7C3AED',
                  color: '#fff', fontSize: '0.8125rem', fontWeight: 700,
                  cursor: parsing || briefText.trim().length < 15 ? 'not-allowed' : 'pointer',
                  fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                }}
              >
                {parsing
                  ? <><span style={{ display: 'inline-block', width: 14, height: 14, border: '2px solid rgba(255,255,255,0.4)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />{' '}Parsing brief…</>
                  : '✨ Parse & fill campaign details'
                }
              </button>
              {parsedBrief && (parsedBrief.warnings?.length ?? 0) > 0 && !parsing && (
                <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {(parsedBrief.warnings ?? []).map((w, i) => (
                    <p key={i} style={{ fontSize: '0.6875rem', color: '#92400E', background: '#FFFBEB', borderRadius: 6, padding: '4px 8px', margin: 0 }}>⚠ {w}</p>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Parsed badge */}
          {parsedBrief && !briefMode && (
            <div style={{
              marginBottom: 10, padding: '6px 10px', borderRadius: '7px',
              background: '#F5F3FF', border: '1px solid #C4B5FD',
              display: 'flex', alignItems: 'center', gap: 6,
            }}>
              <span style={{ fontSize: '12px' }}>✨</span>
              <span style={{ fontSize: '0.6875rem', color: '#7C3AED', fontWeight: 600, flex: 1 }}>
                Brief parsed · {parsedBrief.confidence}% confidence
              </span>
              <button onClick={() => { setParsedBrief(null); setBriefText(''); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#A78BFA', fontSize: '10px', padding: 0, fontFamily: 'inherit' }}>
                Clear
              </button>
            </div>
          )}


          {/* Steps */}
          <div style={{ display: 'flex', gap: 0, marginBottom: -1 }}>
            {(['Campaign details', 'Select boards'] as const).map((label, i) => {
              const idx = (i + 1) as 1 | 2;
              const active = step === idx;
              const done = step > idx;
              return (
                <button
                  key={label}
                  onClick={() => {
                    if (idx === 2) {
                      const e = validateStep1();
                      if (Object.keys(e).length > 0) { setErrors(e); return; }
                    }
                    setStep(idx);
                    setErrors({});
                  }}
                  style={{
                    flex: 1, padding: '8px 0', border: 'none', background: 'none',
                    cursor: 'pointer', fontSize: '0.75rem', fontWeight: active ? 700 : 500,
                    color: active ? '#1B4F8A' : done ? '#10B981' : '#94A3B8',
                    borderBottom: `2px solid ${active ? '#1B4F8A' : done ? '#10B981' : 'transparent'}`,
                    transition: 'all 0.15s', fontFamily: 'inherit',
                  }}
                >
                  <span style={{ marginRight: 5 }}>{done ? '✓' : idx + '.'}</span>
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Panel body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>

          {/* ── Step 1: Campaign details ── */}
          {step === 1 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

              {/* Campaign name */}
              <div>
                <label style={LABEL_STYLE}>Campaign name *</label>
                <input
                  value={form.name}
                  onChange={f('name')}
                  placeholder="e.g. MTN Ramadan 2026"
                  style={{ ...INPUT_STYLE, borderColor: errors.name ? '#EF4444' : '#E2E8F0' }}
                />
                {errors.name && <p style={ERR_STYLE}>{errors.name}</p>}
              </div>

              {/* Client name */}
              <div>
                <label style={LABEL_STYLE}>Client / brand *</label>
                <input
                  value={form.client_name}
                  onChange={f('client_name')}
                  placeholder="e.g. MTN Nigeria"
                  style={{ ...INPUT_STYLE, borderColor: errors.client_name ? '#EF4444' : '#E2E8F0' }}
                />
                {errors.client_name && <p style={ERR_STYLE}>{errors.client_name}</p>}
              </div>

              {/* Objective */}
              <div>
                <label style={LABEL_STYLE}>Campaign objective *</label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  {OBJECTIVES.map(obj => {
                    const active = form.objective === obj.value;
                    return (
                      <button
                        key={obj.value}
                        onClick={() => { setForm(p => ({ ...p, objective: obj.value })); if (errors.objective) setErrors(p => { const n = { ...p }; delete n.objective; return n; }); }}
                        style={{
                          padding: '10px 10px', borderRadius: '8px', border: `1.5px solid ${active ? '#1B4F8A' : '#E2E8F0'}`,
                          background: active ? '#EFF6FF' : '#fff', cursor: 'pointer', textAlign: 'left',
                          fontFamily: 'inherit', transition: 'all 0.15s',
                        }}
                      >
                        <div style={{ fontSize: '16px', marginBottom: 3 }}>{obj.icon}</div>
                        <div style={{ fontSize: '0.6875rem', fontWeight: 700, color: active ? '#1B4F8A' : '#0F172A', marginBottom: 1 }}>{obj.label}</div>
                        <div style={{ fontSize: '0.625rem', color: '#94A3B8', lineHeight: 1.3 }}>{obj.desc}</div>
                      </button>
                    );
                  })}
                </div>
                {errors.objective && <p style={ERR_STYLE}>{errors.objective}</p>}
              </div>

              {/* Budget */}
              <div>
                <label style={LABEL_STYLE}>Total budget (₦) *</label>
                <div style={{ position: 'relative' }}>
                  <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#94A3B8', fontSize: '0.875rem', fontWeight: 600 }}>₦</span>
                  <input
                    type="number"
                    value={form.total_budget}
                    onChange={f('total_budget')}
                    placeholder="0"
                    min="0"
                    style={{ ...INPUT_STYLE, paddingLeft: 28, borderColor: errors.total_budget ? '#EF4444' : '#E2E8F0' }}
                  />
                </div>
                {errors.total_budget && <p style={ERR_STYLE}>{errors.total_budget}</p>}
              </div>

              {/* Dates */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <label style={LABEL_STYLE}>Start date *</label>
                  <input type="date" value={form.start_date} onChange={f('start_date')} style={{ ...INPUT_STYLE, borderColor: errors.start_date ? '#EF4444' : '#E2E8F0' }} />
                  {errors.start_date && <p style={ERR_STYLE}>{errors.start_date}</p>}
                </div>
                <div>
                  <label style={LABEL_STYLE}>End date *</label>
                  <input type="date" value={form.end_date} onChange={f('end_date')} style={{ ...INPUT_STYLE, borderColor: errors.end_date ? '#EF4444' : '#E2E8F0' }} />
                  {errors.end_date && <p style={ERR_STYLE}>{errors.end_date}</p>}
                </div>
              </div>

              {days > 0 && (
                <div style={{ background: '#F0FDF4', borderRadius: '8px', padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: '14px' }}>📅</span>
                  <span style={{ fontSize: '0.75rem', color: '#065F46', fontWeight: 500 }}>
                    {days}-day flight · {new Date(form.start_date).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' })} – {new Date(form.end_date).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </span>
                </div>
              )}

              <button
                onClick={() => {
                  const e = validateStep1();
                  if (Object.keys(e).length > 0) { setErrors(e); return; }
                  setErrors({});
                  setStep(2);
                }}
                style={{
                  width: '100%', padding: '11px', borderRadius: '10px', border: 'none',
                  background: '#1B4F8A', color: '#fff', fontSize: '0.8125rem', fontWeight: 700,
                  cursor: 'pointer', marginTop: 4, fontFamily: 'inherit',
                  boxShadow: '0 4px 12px rgba(27,79,138,0.25)',
                }}
              >
                Next: Select boards →
              </button>
            </div>
          )}

          {/* ── Step 2: Board selection ── */}
          {step === 2 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

              {/* Campaign summary pill */}
              <div style={{ background: '#EFF6FF', borderRadius: '10px', padding: '12px 14px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <p style={{ fontSize: '0.75rem', fontWeight: 700, color: '#0F172A', margin: '0 0 2px' }}>{form.name}</p>
                    <p style={{ fontSize: '0.6875rem', color: '#64748B', margin: 0 }}>{form.client_name} · {OBJECTIVES.find(o => o.value === form.objective)?.label}</p>
                  </div>
                  <button onClick={() => setStep(1)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#1B4F8A', fontSize: '0.6875rem', fontWeight: 600, fontFamily: 'inherit' }}>
                    Edit
                  </button>
                </div>
                {days > 0 && (
                  <p style={{ fontSize: '0.6875rem', color: '#64748B', margin: '6px 0 0' }}>
                    {days} days · Budget: <strong style={{ color: '#1B4F8A' }}>{formatNaira(budget)}</strong>
                  </p>
                )}
              </div>

              {/* Smart Suggest */}
              <div style={{ background: '#FFFBEB', borderRadius: '10px', padding: '12px 14px', border: '1px solid #FDE68A' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                  <div>
                    <p style={{ fontSize: '0.75rem', fontWeight: 700, color: '#92400E', margin: '0 0 3px' }}>
                      ✨ Smart Suggest
                    </p>
                    <p style={{ fontSize: '0.6875rem', color: '#78350F', margin: 0, lineHeight: 1.4 }}>
                      Auto-select the best boards for {OBJECTIVES.find(o => o.value === form.objective)?.label?.toLowerCase() || 'your objective'} within your budget
                    </p>
                  </div>
                  <button
                    onClick={handleSuggest}
                    disabled={suggesting}
                    style={{
                      padding: '7px 14px', borderRadius: '7px', border: 'none',
                      background: suggesting ? '#FDE68A' : '#F59E0B', color: '#fff',
                      fontSize: '0.75rem', fontWeight: 700, cursor: suggesting ? 'not-allowed' : 'pointer',
                      flexShrink: 0, fontFamily: 'inherit', whiteSpace: 'nowrap',
                    }}
                  >
                    {suggesting ? '…' : 'Suggest'}
                  </button>
                </div>
              </div>

              {/* Budget tracker */}
              <div style={{ background: overBudget ? '#FEF2F2' : '#F8FAFC', borderRadius: '10px', padding: '12px 14px', border: `1px solid ${overBudget ? '#FECACA' : '#E2E8F0'}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: '0.6875rem', fontWeight: 700, color: overBudget ? '#DC2626' : '#0F172A' }}>
                    Budget allocation
                  </span>
                  <span style={{ fontSize: '0.6875rem', fontWeight: 600, color: overBudget ? '#DC2626' : '#1B4F8A' }}>
                    {formatNaira(totalCost)} / {formatNaira(budget)}
                  </span>
                </div>
                <div style={{ height: 6, borderRadius: 3, background: '#E2E8F0', overflow: 'hidden' }}>
                  <div style={{
                    height: '100%', borderRadius: 3,
                    width: `${budgetPct}%`,
                    background: overBudget ? '#DC2626' : budgetPct > 85 ? '#F59E0B' : '#10B981',
                    transition: 'width 0.3s ease',
                  }} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 5 }}>
                  <span style={{ fontSize: '0.625rem', color: '#94A3B8' }}>{budgetPct}% allocated</span>
                  {budget > 0 && (
                    <span style={{ fontSize: '0.625rem', color: overBudget ? '#DC2626' : '#64748B' }}>
                      {overBudget ? `₦${(totalCost - budget).toLocaleString('en-NG')} over budget` : `₦${(budget - totalCost).toLocaleString('en-NG')} remaining`}
                    </span>
                  )}
                </div>
              </div>

              {/* Selected boards list */}
              {selectedBoards.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '32px 0', color: '#CBD5E1' }}>
                  <div style={{ fontSize: '2rem', marginBottom: 8 }}>📍</div>
                  <p style={{ fontSize: '0.8125rem', fontWeight: 600, margin: '0 0 4px', color: '#94A3B8' }}>No boards selected yet</p>
                  <p style={{ fontSize: '0.75rem', color: '#CBD5E1', margin: 0 }}>Click green pins on the map, or use Smart Suggest</p>
                </div>
              ) : (
                <div>
                  <p style={{ fontSize: '0.75rem', fontWeight: 700, color: '#0F172A', margin: '0 0 8px' }}>
                    Selected boards ({selectedBoards.length})
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {selectedBoards.map(board => (
                      <div
                        key={board.id}
                        onMouseEnter={() => setHighlightedId(board.id)}
                        onMouseLeave={() => setHighlightedId(null)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 10,
                          padding: '10px 12px', borderRadius: '8px',
                          background: highlightedId === board.id ? '#EFF6FF' : '#F8FAFC',
                          border: `1px solid ${highlightedId === board.id ? '#BFDBFE' : '#F1F5F9'}`,
                          cursor: 'default', transition: 'all 0.1s',
                        }}
                      >
                        <div style={{ width: 32, height: 32, borderRadius: '6px', background: '#1B4F8A', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          <span style={{ fontSize: '12px', color: '#fff', fontWeight: 700 }}>✓</span>
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{ fontSize: '0.75rem', fontWeight: 600, color: '#0F172A', margin: '0 0 1px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{board.name}</p>
                          <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: 0 }}>
                            {board.format || 'Board'} · {board.city || board.state || '—'}
                          </p>
                        </div>
                        <div style={{ textAlign: 'right', flexShrink: 0 }}>
                          <p style={{ fontSize: '0.75rem', fontWeight: 700, color: '#1B4F8A', margin: '0 0 1px' }}>{formatNaira(board.asking_rate || 0)}</p>
                          {days > 0 && (
                            <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: 0 }}>
                              ~{(estimateImpressions(board, days) / 1000).toFixed(0)}K impr.
                            </p>
                          )}
                        </div>
                        <button
                          onClick={() => toggleBoard(board)}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#CBD5E1', padding: 2, borderRadius: 4, display: 'flex', flexShrink: 0 }}
                          title="Remove"
                        >
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Totals */}
              {selectedBoards.length > 0 && (
                <div style={{ background: '#0F172A', borderRadius: '10px', padding: '14px' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    {[
                      { label: 'Boards', value: selectedBoards.length.toString() },
                      { label: 'Media cost', value: formatNaira(totalCost) },
                      ...(days > 0 ? [
                        { label: 'Flight', value: `${days} days` },
                        { label: 'Est. impressions', value: totalImpressions >= 1_000_000 ? (totalImpressions / 1_000_000).toFixed(1) + 'M' : (totalImpressions / 1_000).toFixed(0) + 'K' },
                      ] : []),
                    ].map(({ label, value }) => (
                      <div key={label}>
                        <p style={{ fontSize: '0.625rem', color: 'rgba(255,255,255,0.4)', margin: '0 0 2px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</p>
                        <p style={{ fontSize: '0.875rem', fontWeight: 700, color: '#F8FAFC', margin: 0 }}>{value}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Panel footer */}
        {step === 2 && (
          <div style={{ padding: '14px 20px', borderTop: '1px solid #F1F5F9', background: '#fff' }}>
            {overBudget && (
              <p style={{ fontSize: '0.75rem', color: '#DC2626', fontWeight: 600, margin: '0 0 10px', textAlign: 'center' }}>
                ⚠ Total cost exceeds budget by {formatNaira(totalCost - budget)}
              </p>
            )}
            <button
              onClick={handleCreate}
              disabled={saving || selectedIds.size === 0 || overBudget}
              style={{
                width: '100%', padding: '12px', borderRadius: '10px', border: 'none',
                background: saving || selectedIds.size === 0 || overBudget ? '#CBD5E1' : '#1B4F8A',
                color: '#fff', fontSize: '0.875rem', fontWeight: 700,
                cursor: saving || selectedIds.size === 0 || overBudget ? 'not-allowed' : 'pointer',
                fontFamily: 'inherit', transition: 'background 0.15s',
                boxShadow: saving || selectedIds.size === 0 || overBudget ? 'none' : '0 4px 16px rgba(27,79,138,0.3)',
              }}
            >
              {saving
                ? 'Creating plan…'
                : selectedIds.size === 0
                  ? 'Select boards to continue'
                  : `Create media plan · ${selectedIds.size} board${selectedIds.size !== 1 ? 's' : ''}`
              }
            </button>

            {/* Export PDF */}
            {selectedIds.size > 0 && (
              <button
                onClick={handleExportPDF}
                disabled={exporting}
                style={{
                  width: '100%', marginTop: 8, padding: '10px', borderRadius: '10px',
                  border: '1.5px solid #E2E8F0', background: exporting ? '#F8FAFC' : '#fff',
                  color: exporting ? '#94A3B8' : '#0F172A', fontSize: '0.8125rem', fontWeight: 600,
                  cursor: exporting ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  transition: 'all 0.15s',
                }}
              >
                {exporting
                  ? <><span style={{ display: 'inline-block', width: 12, height: 12, border: '2px solid #E2E8F0', borderTopColor: '#1B4F8A', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} /> Generating PDF…</>
                  : <>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
                      </svg>
                      Export media plan PDF
                    </>
                }
              </button>
            )}

            <p style={{ fontSize: '0.6875rem', color: '#94A3B8', textAlign: 'center', margin: '8px 0 0' }}>
              Booking requests will be sent to board owners
            </p>
          </div>
        )}
      </div>

      {/* ── Excel Import Review Modal ── */}
      {importMode && importResult && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 200,
          background: 'rgba(15,23,42,0.6)', backdropFilter: 'blur(2px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
        }}>
          <div style={{
            background: '#fff', borderRadius: '16px', width: '100%', maxWidth: 720,
            maxHeight: '85vh', display: 'flex', flexDirection: 'column',
            boxShadow: '0 24px 64px rgba(0,0,0,0.2)',
          }}>
            {/* Modal header */}
            <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid #F1F5F9' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <h2 style={{ fontSize: '1rem', fontWeight: 700, color: '#0F172A', margin: '0 0 4px', letterSpacing: '-0.02em' }}>
                    Import Review
                  </h2>
                  <p style={{ fontSize: '0.75rem', color: '#94A3B8', margin: 0 }}>
                    Review matched boards before loading into your plan
                  </p>
                </div>
                <button onClick={() => setImportMode(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8', padding: 4, borderRadius: 6, display: 'flex' }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                </button>
              </div>

              {/* Summary pills */}
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                {[
                  { label: 'Total rows', value: importResult.summary.total,     bg: '#F8FAFC', color: '#475569' },
                  { label: 'Exact match', value: importResult.summary.exact,    bg: '#ECFDF5', color: '#065F46' },
                  { label: 'Fuzzy match', value: importResult.summary.fuzzy,    bg: '#FFFBEB', color: '#92400E' },
                  { label: 'Not found',   value: importResult.summary.unmatched, bg: '#FEF2F2', color: '#7F1D1D' },
                ].map(({ label, value, bg, color }) => (
                  <div key={label} style={{ background: bg, borderRadius: '8px', padding: '6px 12px', textAlign: 'center' }}>
                    <p style={{ fontSize: '1rem', fontWeight: 700, color, margin: 0, fontFamily: 'monospace' }}>{value}</p>
                    <p style={{ fontSize: '0.625rem', color, margin: 0, opacity: 0.75 }}>{label}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Rows table */}
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {/* Table header */}
              <div style={{
                display: 'grid', gridTemplateColumns: '2fr 2fr 80px',
                padding: '8px 24px', background: '#F8FAFC',
                borderBottom: '1px solid #F1F5F9', position: 'sticky', top: 0,
              }}>
                {['Your Excel row', 'Matched board', 'Status'].map(h => (
                  <span key={h} style={{ fontSize: '0.625rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{h}</span>
                ))}
              </div>

              {importResult.rows.map((row, i) => {
                const conf = row.confidence;
                const confStyle = {
                  exact: { bg: '#ECFDF5', color: '#065F46', label: 'Matched' },
                  fuzzy: { bg: '#FFFBEB', color: '#92400E', label: 'Fuzzy' },
                  none:  { bg: '#FEF2F2', color: '#7F1D1D', label: 'Not found' },
                }[conf];

                return (
                  <div
                    key={i}
                    style={{
                      display: 'grid', gridTemplateColumns: '2fr 2fr 80px',
                      padding: '10px 24px', alignItems: 'center',
                      borderBottom: '1px solid #F8FAFC',
                      background: conf === 'none' ? '#FFFAFA' : '#fff',
                    }}
                  >
                    {/* Excel row */}
                    <div>
                      <p style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#0F172A', margin: '0 0 2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {row.board_name}
                      </p>
                      <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: 0 }}>
                        {[row.city, row.format?.replace(/_/g, ' ')].filter(Boolean).join(' · ')}
                        {row.offered_rate ? ` · ₦${row.offered_rate.toLocaleString('en-NG')}` : ''}
                      </p>
                    </div>

                    {/* Matched board */}
                    <div>
                      {conf !== 'none' ? (
                        <>
                          <p style={{ fontSize: '0.8125rem', fontWeight: 500, color: '#0F172A', margin: '0 0 2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {row.matched_name}
                          </p>
                          <p style={{ fontSize: '0.6875rem', color: '#94A3B8', margin: 0 }}>{row.matched_city}</p>
                        </>
                      ) : (
                        <p style={{ fontSize: '0.75rem', color: '#CBD5E1', margin: 0, fontStyle: 'italic' }}>No match found</p>
                      )}
                    </div>

                    {/* Status badge */}
                    <span style={{
                      display: 'inline-flex', padding: '3px 10px', borderRadius: '999px',
                      background: confStyle.bg, color: confStyle.color,
                      fontSize: '0.6875rem', fontWeight: 600, whiteSpace: 'nowrap',
                    }}>
                      {confStyle.label}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Modal footer */}
            <div style={{ padding: '14px 24px', borderTop: '1px solid #F1F5F9', display: 'flex', gap: 10, alignItems: 'center' }}>
              {importResult.summary.unmatched > 0 && (
                <p style={{ fontSize: '0.75rem', color: '#92400E', margin: 0, flex: 1 }}>
                  ⚠ {importResult.summary.unmatched} row{importResult.summary.unmatched !== 1 ? 's' : ''} not matched — they will be skipped. You can add them manually on the map.
                </p>
              )}
              {importResult.summary.unmatched === 0 && (
                <p style={{ fontSize: '0.75rem', color: '#065F46', margin: 0, flex: 1 }}>
                  ✓ All {importResult.summary.total} boards matched successfully.
                </p>
              )}
              <button
                onClick={() => setImportMode(false)}
                style={{ padding: '9px 16px', borderRadius: '8px', border: '1px solid #E2E8F0', background: '#fff', color: '#64748B', fontSize: '0.8125rem', fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit' }}
              >
                Cancel
              </button>
              <button
                onClick={applyImport}
                disabled={(importResult.summary.exact + importResult.summary.fuzzy) === 0}
                style={{
                  padding: '9px 20px', borderRadius: '8px', border: 'none',
                  background: (importResult.summary.exact + importResult.summary.fuzzy) === 0 ? '#CBD5E1' : '#1B4F8A',
                  color: '#fff', fontSize: '0.8125rem', fontWeight: 700,
                  cursor: (importResult.summary.exact + importResult.summary.fuzzy) === 0 ? 'not-allowed' : 'pointer',
                  fontFamily: 'inherit', boxShadow: '0 4px 12px rgba(27,79,138,0.2)',
                }}
              >
                Load {importResult.summary.exact + importResult.summary.fuzzy} boards into plan →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '12px 18px', borderRadius: '10px',
          background: toast.type === 'success' ? '#0F172A' : '#7F1D1D',
          color: '#F8FAFC', fontSize: '0.8125rem', fontWeight: 500,
          boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
          animation: 'fadeUp 0.25s ease',
        }}>
          <span>{toast.type === 'success' ? '✓' : '✕'}</span>
          <span>{toast.msg}</span>
          <style>{`@keyframes fadeUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }`}</style>
        </div>
      )}
    </div>
  );
}
