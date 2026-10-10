'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import bbox from '@turf/bbox';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { supabase } from '@/lib/supabase';
import { fetchMarketData } from '@/lib/geo/data';
import { poiUnmapped } from '@/lib/geo/flags';
import {
  MAP_METRICS, MAP_METRIC_NAMES, METRICS, SEGMENT_COLORS, classColors, classIndex, formatMetric, metricValue, quantileBreaks,
  type GeoLevel, type MetricKey,
} from '@/lib/geo/metrics';
import { DEFAULT_WEIGHTS, SEGMENT_LABELS, computeSegments, segmentRuleText, type Segment, type SegmentWeights } from '@/lib/geo/segments';
import type { H3Meta, LgaMetrics, MarketData, StateMetrics } from '@/lib/geo/types';
import AskPanel, { AskBox, type AskOutcome } from './AskPanel';
import EvidenceDrawer from './EvidenceDrawer';
import LayerPanel, { type Legend } from './LayerPanel';
import LgaDetail from './LgaDetail';
import MarketMap, { HEX_MIN_ZOOM, type HexMetric, type HoverCard, type MapBoard } from './MarketMap';
import StateProfile from './StateProfile';
import { T, plainButton, useIsNarrow, type EvidenceTarget } from './ui';

const HEX_METRIC: Partial<Record<MetricKey, HexMetric>> = { pop_density_km2: 'd', pop_15_34: 'yd' };
const HEX_LEGEND: Record<HexMetric, { title: string; unit: string }> = {
  d: { title: 'Residents per km² (modelled), by hexagon', unit: 'people per km²' },
  yd: { title: 'Residents aged 15-34 per km² (modelled), by hexagon', unit: 'people per km²' },
};
const SEGMENT_ORDER: Segment[] = ['high_value', 'youth_hub', 'mass_market', 'unclassified'];

type Static = { lgaGeo: GeoJSON.FeatureCollection; stateGeo: GeoJSON.FeatureCollection; h3Meta: H3Meta | null };

function rangeLabels(breaks: number[], format: (v: number) => string): string[] {
  if (breaks.length === 0) return ['All areas with data'];
  return [
    `Under ${format(breaks[0])}`,
    ...breaks.slice(0, -1).map((b, i) => `${format(b)} to under ${format(breaks[i + 1])}`),
    `${format(breaks[breaks.length - 1])} and over`,
  ];
}

export default function MarketIntelView() {
  const narrow = useIsNarrow();
  const [data, setData] = useState<MarketData | null>(null);
  const [statics, setStatics] = useState<Static | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [boards, setBoards] = useState<MapBoard[] | null>(null);

  const [level, setLevel] = useState<GeoLevel>('lga');
  const [metric, setMetric] = useState<MetricKey>('pop_15_34');
  const [weights, setWeights] = useState<SegmentWeights>(DEFAULT_WEIGHTS);
  const [zoom, setZoom] = useState(5);
  const [profileStates, setProfileStates] = useState<string[]>([]);
  const [selectedLga, setSelectedLga] = useState<string | null>(null);
  const [evidence, setEvidence] = useState<EvidenceTarget | null>(null);
  const [focusBounds, setFocusBounds] = useState<[number, number, number, number] | null>(null);
  const [layersOpen, setLayersOpen] = useState(false);
  const [asked, setAsked] = useState<AskOutcome | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const json = async (path: string) => {
          const res = await fetch(path);
          if (!res.ok) throw new Error(`${path} could not be loaded (${res.status})`);
          return res.json();
        };
        const [market, lgaGeo, stateGeo, h3Meta] = await Promise.all([
          fetchMarketData(),
          json('/geo/ng-lga.geojson'),
          json('/geo/ng-state.geojson'),
          // The hexagon layer is optional: without its tiles the map keeps the LGA fill at every zoom.
          fetch('/geo/h3-meta.json').then(r => (r.ok ? r.json() : null)).catch(() => null),
        ]);
        if (cancelled) return;
        setData(market);
        setStatics({ lgaGeo, stateGeo, h3Meta });
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'The market data could not be loaded.');
      }
    })();
    // Boards load separately so a slow inventory query never holds up the map. Only identity
    // and position are read — no rate fields.
    supabase.from('boards').select('id, name, latitude, longitude').not('latitude', 'is', null).not('longitude', 'is', null).limit(5000)
      .then(({ data: rows }) => {
        if (cancelled) return;
        setBoards(((rows as { id: string; name: string; latitude: number; longitude: number }[] | null) || [])
          .map(b => ({ id: b.id, name: b.name, lng: b.longitude, lat: b.latitude })));
      });
    return () => { cancelled = true; };
  }, []);

  // Segments are always derived here from the stored source metrics with the weights in
  // force, by the same function the pipeline used — so the map, the rules text and the
  // thresholds can never disagree.
  const derived = useMemo(() => {
    if (!data) return null;
    const { results, thresholds } = computeSegments(data.lgas, weights);
    const lgas: LgaMetrics[] = data.lgas.map((l, i) => ({ ...l, ...results[i] }));
    const segmentCounts = { high_value: 0, youth_hub: 0, mass_market: 0, unclassified: 0 } as Record<Segment, number>;
    for (const l of lgas) segmentCounts[l.segment ?? 'unclassified']++;
    return { lgas, thresholds, ruleText: segmentRuleText(thresholds), segmentCounts };
  }, [data, weights]);

  const lgaByCode = useMemo(() => new Map((derived?.lgas || []).map(l => [l.lga_pcode, l])), [derived]);
  const stateByCode = useMemo(() => new Map((data?.states || []).map(s => [s.state_pcode, s])), [data]);

  const hexMetric = statics?.h3Meta ? HEX_METRIC[metric] ?? null : null;
  const hexInView = !!hexMetric && zoom >= HEX_MIN_ZOOM;

  const { fillByCode, legend } = useMemo<{ fillByCode: Record<string, string>; legend: Legend }>(() => {
    const empty = { fillByCode: {}, legend: { title: '', unit: '', classes: [] } };
    if (!derived || !data) return empty;
    const def = METRICS[metric];

    if (hexInView && statics?.h3Meta) {
      const levels = statics.h3Meta.levels;
      const current = [...levels].reverse().find(l => zoom >= l.min_zoom) || levels[0];
      const breaks = current.breaks[hexMetric!];
      const colors = classColors(breaks.length + 1);
      const labels = rangeLabels(breaks, METRICS.pop_density_km2.format);
      return {
        fillByCode: {},
        legend: {
          ...HEX_LEGEND[hexMetric!],
          classes: labels.map((label, i) => ({ label, color: colors[i] })),
          note: `Hexagons of about ${current.resolution === 7 ? '5' : '0.7'} km². Five classes with equal numbers of populated hexagons; unpopulated land is left blank.`,
        },
      };
    }

    if (metric === 'segment') {
      const fill: Record<string, string> = {};
      for (const l of derived.lgas) fill[l.lga_pcode] = SEGMENT_COLORS[l.segment ?? 'unclassified'];
      return {
        fillByCode: fill,
        legend: { title: 'Segment', unit: '', classes: SEGMENT_ORDER.map(s => ({ label: SEGMENT_LABELS[s], color: SEGMENT_COLORS[s] })) },
      };
    }

    const rows: (LgaMetrics | StateMetrics)[] = level === 'lga' ? derived.lgas : data.states;
    const code = (r: LgaMetrics | StateMetrics) => (level === 'lga' ? (r as LgaMetrics).lga_pcode : r.state_pcode);
    const values = rows.map(r => metricValue(r, metric));
    const breaks = quantileBreaks(values);
    const colors = classColors(breaks.length + 1);
    const fill: Record<string, string> = {};
    rows.forEach((r, i) => { if (values[i] !== null) fill[code(r)] = colors[classIndex(values[i] as number, breaks)]; });
    const hasData = values.some(v => v !== null);
    return {
      fillByCode: fill,
      legend: {
        title: `${def.label}, by ${level === 'lga' ? 'LGA' : 'state'}`,
        unit: def.unit,
        classes: hasData ? rangeLabels(breaks, def.format).map((label, i) => ({ label, color: colors[i] })) : [],
        note: hasData
          ? `Classes hold roughly equal numbers of ${level === 'lga' ? 'LGAs' : 'states'}.${hexMetric ? ' Zoom in to city level for hexagons.' : ''}`
          : 'No data for this metric.',
      },
    };
  }, [derived, data, metric, level, hexInView, hexMetric, statics, zoom]);

  const flaggedCodes = useMemo(() => {
    if (!derived || level !== 'lga' || (metric !== 'affluence_index' && metric !== 'segment')) return [];
    return derived.lgas.filter(l => l.affluence_index !== null && poiUnmapped(l)).map(l => l.lga_pcode);
  }, [derived, level, metric]);

  const boardCounts = useMemo(() => {
    if (!boards || !statics) return null;
    const counts: Record<string, number> = {};
    for (const b of boards) {
      const state = statics.stateGeo.features.find(f => booleanPointInPolygon([b.lng, b.lat], f as GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>));
      const code = state?.properties?.state_pcode;
      if (code) counts[code] = (counts[code] || 0) + 1;
    }
    return counts;
  }, [boards, statics]);

  const focusOn = useCallback((kind: 'state' | 'lga', code: string) => {
    const geo = kind === 'state' ? statics?.stateGeo : statics?.lgaGeo;
    const feature = geo?.features.find(f => f.properties?.[kind === 'state' ? 'state_pcode' : 'lga_pcode'] === code);
    if (feature) setFocusBounds(bbox(feature) as [number, number, number, number]);
  }, [statics]);

  const openState = useCallback((code: string, fly = true) => {
    setSelectedLga(null);
    setEvidence(null);
    setProfileStates([code]);
    setLayersOpen(false);
    if (fly) focusOn('state', code);
  }, [focusOn]);

  const openLga = useCallback((code: string, fly = true) => {
    setEvidence(null);
    setSelectedLga(code);
    setLayersOpen(false);
    if (fly) focusOn('lga', code);
  }, [focusOn]);

  const handleMapSelect = useCallback((code: string) => {
    if (level === 'lga') openLga(code, false); else openState(code, false);
  }, [level, openLga, openState]);

  const describeArea = useCallback((code: string): HoverCard | null => {
    const row = level === 'lga' ? lgaByCode.get(code) : stateByCode.get(code);
    if (!row) return null;
    const lga = level === 'lga' ? (row as LgaMetrics) : null;
    const youth = row.pop_15_34 === null ? 'No data' : `${formatMetric('pop_15_34', row.pop_15_34)} (${formatMetric('youth_share', row.youth_share)})`;
    const third = lga && metric === 'affluence_index'
      ? { label: 'Affluence index', value: formatMetric('affluence_index', lga.affluence_index) }
      : lga && metric === 'segment'
        ? { label: 'Segment', value: SEGMENT_LABELS[lga.segment ?? 'unclassified'] }
        : { label: 'Residents per km²', value: formatMetric('pop_density_km2', row.pop_density_km2) };
    return {
      title: lga ? lga.lga_name : `${row.state_name} State`,
      subtitle: lga ? `${lga.state_name} State` : undefined,
      lines: [
        { label: 'Residents (modelled)', value: formatMetric('pop_total', row.pop_total) },
        { label: 'Aged 15-34 (modelled)', value: youth },
        third,
      ],
    };
  }, [level, metric, lgaByCode, stateByCode]);

  const populationYear = data?.datasets.worldpop_agesex_2020_constrained?.reference_year;
  const describeHex = useCallback((p: { pop: number; y: number; d: number; yd: number }, resolution: number): HoverCard => ({
    title: `Hexagon, about ${resolution === 7 ? '5' : '0.7'} km²`,
    subtitle: `Modelled residents${populationYear ? `, ${populationYear}` : ''}`,
    lines: [
      { label: 'Residents', value: formatMetric('pop_total', p.pop) },
      { label: 'Aged 15-34', value: formatMetric('pop_15_34', p.y) },
      { label: 'Residents per km²', value: formatMetric('pop_density_km2', p.d) },
    ],
  }), [populationYear]);

  const handleLevel = useCallback((next: GeoLevel) => {
    setLevel(next);
    setMetric(m => (MAP_METRICS[next].includes(m) ? m : 'pop_15_34'));
  }, []);

  const handleMetricInfo = useCallback((key: MetricKey) => {
    if (!derived || !data) return;
    // General information about a metric: any row carries the same dataset references.
    const row = level === 'lga' ? derived.lgas.find(l => metricValue(l, key) !== null || key === 'segment') ?? derived.lgas[0] : data.states[0];
    setEvidence({ metric: key, display: MAP_METRIC_NAMES[key] || METRICS[key].label, geography: `Nigeria, by ${level === 'lga' ? 'LGA' : 'state'}`, row });
  }, [derived, data, level]);

  if (error) {
    return (
      <div style={{ padding: 24, maxWidth: 560 }}>
        <h1 style={{ fontSize: '1rem', fontWeight: 600, color: T.ink, margin: '0 0 6px' }}>Market intelligence is not available</h1>
        <p style={{ fontSize: '0.875rem', color: T.body, margin: 0 }}>{error}</p>
      </div>
    );
  }
  if (!data || !statics || !derived) {
    return <div style={{ padding: 24, fontSize: '0.875rem', color: T.muted }}>Loading market data…</div>;
  }
  if (data.lgas.length === 0) {
    return (
      <div style={{ padding: 24, maxWidth: 560 }}>
        <h1 style={{ fontSize: '1rem', fontWeight: 600, color: T.ink, margin: '0 0 6px' }}>No market data has been loaded</h1>
        <p style={{ fontSize: '0.875rem', color: T.body, margin: 0 }}>
          The metric tables are empty. Run the pipeline in scripts/geo/ and its load step, then reload this page. No figures are shown until then.
        </p>
      </div>
    );
  }

  const askOutcome = (outcome: AskOutcome) => { setEvidence(null); setAsked(outcome); };
  const profile = profileStates.map(c => stateByCode.get(c)).filter((s): s is StateMetrics => !!s);
  const lgaRow = selectedLga ? lgaByCode.get(selectedLga) ?? null : null;
  const rightOpen = !!evidence || !!asked || !!lgaRow || profile.length > 0;
  const rightWidth = evidence || asked || lgaRow ? 380 : Math.min(132 + profile.length * 220 + 16, 820);
  const selectedCode = level === 'lga' ? selectedLga : profile.length === 1 ? profile[0].state_pcode : null;

  const rightPanel = evidence ? (
    <EvidenceDrawer target={evidence} datasets={data.datasets} ruleText={derived.ruleText} thresholds={derived.thresholds} onClose={() => setEvidence(null)} />
  ) : asked ? (
    <AskPanel outcome={asked} datasets={data.datasets} onEvidence={setEvidence} onClose={() => setAsked(null)} />
  ) : lgaRow ? (
    <LgaDetail lga={lgaRow} ruleText={derived.ruleText} datasets={data.datasets} onEvidence={setEvidence} onOpenState={openState} onClose={() => setSelectedLga(null)} />
  ) : profile.length > 0 ? (
    <StateProfile
      states={profile}
      allStates={data.states}
      lgas={derived.lgas}
      boardCounts={boardCounts}
      datasets={data.datasets}
      onEvidence={setEvidence}
      onAddState={code => setProfileStates(prev => (prev.includes(code) || prev.length >= 3 ? prev : [...prev, code]))}
      onRemoveState={code => setProfileStates(prev => prev.filter(c => c !== code))}
      onSelectLga={code => { setLevel('lga'); openLga(code); }}
      onClose={() => setProfileStates([])}
    />
  ) : null;

  const layerPanel = (
    <LayerPanel
      level={level}
      metric={metric}
      legend={legend}
      states={data.states}
      lgas={derived.lgas}
      selectedStateCode={lgaRow?.state_pcode ?? profile[0]?.state_pcode ?? null}
      selectedLgaCode={selectedLga}
      weights={weights}
      thresholds={derived.thresholds}
      ruleText={derived.ruleText}
      segmentCounts={derived.segmentCounts}
      flaggedCount={flaggedCodes.length}
      datasets={data.datasets}
      onLevel={handleLevel}
      onMetric={setMetric}
      onMetricInfo={handleMetricInfo}
      onWeights={setWeights}
      onSelectState={code => openState(code)}
      onSelectLga={code => { setLevel('lga'); openLga(code); }}
    />
  );

  const map = (
    <MarketMap
      level={level}
      lgaGeo={statics.lgaGeo}
      stateGeo={statics.stateGeo}
      fillByCode={fillByCode}
      flaggedCodes={flaggedCodes}
      selectedCode={selectedCode}
      hexMetric={hexMetric}
      h3Meta={statics.h3Meta}
      boards={boards || []}
      focusBounds={focusBounds}
      describeArea={describeArea}
      describeHex={describeHex}
      onSelect={handleMapSelect}
      onZoomChange={setZoom}
    />
  );

  if (narrow) {
    // Phone layout: the map fills the screen; layers and details are sheets over it.
    return (
      <div style={{ position: 'relative', height: 'calc(100dvh - 56px)', minHeight: 420, fontFamily: "'Inter', -apple-system, sans-serif", overflow: 'hidden' }}>
        {map}
        {!layersOpen && !rightOpen && (
          <>
            <button type="button" onClick={() => setLayersOpen(true)} style={{ ...plainButton, position: 'absolute', top: 10, left: 10, zIndex: 6, fontWeight: 600 }}>
              Layers and legend
            </button>
            <div style={{ position: 'absolute', top: 52, left: 10, right: 10, zIndex: 6 }}><AskBox onOutcome={askOutcome} /></div>
          </>
        )}
        {layersOpen && !rightOpen && (
          <div style={{ position: 'absolute', inset: 0, zIndex: 7, background: T.surface, display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '8px 12px', borderBottom: `1px solid ${T.line}`, textAlign: 'right' }}>
              <button type="button" onClick={() => setLayersOpen(false)} style={plainButton}>Show map</button>
            </div>
            <div style={{ flex: 1, minHeight: 0 }}>{layerPanel}</div>
          </div>
        )}
        {rightOpen && (
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, top: '22%', zIndex: 8, background: T.surface, borderTop: `1px solid ${T.line}`, boxShadow: '0 -4px 16px rgba(15,23,42,0.08)' }}>
            {rightPanel}
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 56px)', minHeight: 480, fontFamily: "'Inter', -apple-system, sans-serif", border: `1px solid ${T.line}`, borderRadius: 8, overflow: 'hidden', background: T.surface }}>
      <aside aria-label="Layers" style={{ width: 300, flexShrink: 0, borderRight: `1px solid ${T.line}`, minHeight: 0 }}>{layerPanel}</aside>
      <div style={{ flex: 1, position: 'relative', minWidth: 0 }}>
        {map}
        <div style={{ position: 'absolute', top: 10, left: 10, right: 10, maxWidth: 560, zIndex: 6 }}><AskBox onOutcome={askOutcome} /></div>
      </div>
      {rightOpen && (
        <aside aria-label="Details" style={{ width: rightWidth, maxWidth: '55vw', flexShrink: 0, borderLeft: `1px solid ${T.line}`, minHeight: 0 }}>{rightPanel}</aside>
      )}
    </div>
  );
}
