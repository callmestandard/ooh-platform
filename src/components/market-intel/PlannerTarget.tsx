'use client';

import { SEGMENT_COLORS } from '@/lib/geo/metrics';
import { SEGMENT_LABELS, type Segment } from '@/lib/geo/segments';
import {
  AGE_BAND_LABELS, CATCHMENT_MAX_POINTS, CATCHMENT_RADII, catchmentLabel, catchmentResidents,
  type AgeBand, type BoardMarketContext, type CatchmentRadius, type MarketTarget, type RankedBoard, type TargetSegment,
} from '@/lib/geo/catchments';

type PlannerBoard = { id: string; name: string; city?: string | null; latitude?: number | null; longitude?: number | null };

const field = {
  width: '100%', padding: '6px 8px', borderRadius: 6, border: '1px solid #E2E8F0', background: '#fff', color: '#0F172A',
  fontSize: '0.75rem', fontFamily: 'inherit',
} as const;
const caption = { fontSize: '0.6875rem', color: '#64748B', margin: 0, lineHeight: 1.45 } as const;
const numeric = { fontVariantNumeric: 'tabular-nums' } as const;

export function SegmentTag({ segment }: { segment: Segment | null }) {
  const s = segment ?? 'unclassified';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: '0.6875rem', color: '#475569' }}>
      <span aria-hidden style={{ width: 8, height: 8, background: SEGMENT_COLORS[s], opacity: 0.85 }} />
      {SEGMENT_LABELS[s]}
    </span>
  );
}

type Props<T extends PlannerBoard> = {
  context: BoardMarketContext | null;
  /** Set when the market data or catchments could not be loaded. */
  error: string | null;
  target: MarketTarget;
  onTarget: (target: MarketTarget) => void;
  ranked: RankedBoard<T>[];
  states: string[];
  cities: string[];
  selectedIds: Set<string>;
  onToggleBoard: (board: T) => void;
  onHighlight?: (id: string | null) => void;
};

/**
 * Campaign planner panel: pick a market segment and place, and see the
 * available boards there ordered by modelled residents nearby. The same
 * ranking feeds Smart Suggest at the weight shown on the slider.
 */
export default function PlannerTarget<T extends PlannerBoard>({ context, error, target, onTarget, ranked, states, cities, selectedIds, onToggleBoard, onHighlight }: Props<T>) {
  const set = (patch: Partial<MarketTarget>) => onTarget({ ...target, ...patch });
  const setCustom = (key: keyof MarketTarget['custom'], raw: string) =>
    onTarget({ ...target, custom: { ...target.custom, [key]: raw.trim() === '' || Number.isNaN(Number(raw)) ? null : Number(raw) } });
  const year = context?.populationDataset?.reference_year;
  const withData = ranked.filter(r => r.residents !== null).length;
  const maxPoints = Math.round((target.weight / 100) * CATCHMENT_MAX_POINTS);

  return (
    <div style={{ background: '#fff', borderRadius: 10, padding: '12px 14px', border: '1px solid #E2E8F0' }}>
      <p style={{ fontSize: '0.75rem', fontWeight: 700, color: '#0F172A', margin: '0 0 3px' }}>Target a market segment</p>
      <p style={caption}>
        Orders boards by the residents who live nearby{year ? `, from a ${year} population model` : ''}. It counts people living in the area, not people passing the board.
      </p>

      {error && <p style={{ ...caption, color: '#92400E', marginTop: 8 }}>Market data is not available: {error}</p>}

      {!error && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 10 }}>
            <label style={{ ...caption, gridColumn: '1 / -1' }}>
              Segment
              <select value={target.segment ?? ''} onChange={e => set({ segment: (e.target.value || null) as TargetSegment | null })} style={{ ...field, marginTop: 3 }}>
                <option value="">No segment targeting</option>
                <option value="youth_hub">Youth hub</option>
                <option value="high_value">High value</option>
                <option value="mass_market">Mass market</option>
                <option value="custom">Custom filter</option>
              </select>
            </label>

            {target.segment === 'custom' && (
              <div style={{ gridColumn: '1 / -1', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
                <label style={caption}>Min. share aged 15-34 (%)
                  <input type="number" min={0} max={100} value={target.custom.minYouthShare ?? ''} onChange={e => setCustom('minYouthShare', e.target.value)} style={{ ...field, marginTop: 3 }} />
                </label>
                <label style={caption}>Min. residents per km²
                  <input type="number" min={0} value={target.custom.minDensity ?? ''} onChange={e => setCustom('minDensity', e.target.value)} style={{ ...field, marginTop: 3 }} />
                </label>
                <label style={caption}>Min. affluence index
                  <input type="number" min={0} max={100} value={target.custom.minAffluence ?? ''} onChange={e => setCustom('minAffluence', e.target.value)} style={{ ...field, marginTop: 3 }} />
                </label>
              </div>
            )}

            <label style={caption}>
              State
              <select value={target.state ?? ''} onChange={e => set({ state: e.target.value || null })} style={{ ...field, marginTop: 3 }}>
                <option value="">Any state</option>
                {states.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <label style={caption}>
              City
              <select value={target.city ?? ''} onChange={e => set({ city: e.target.value || null })} style={{ ...field, marginTop: 3 }}>
                <option value="">Any city</option>
                {cities.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <label style={caption}>
              Residents
              <select value={target.band} onChange={e => set({ band: e.target.value as AgeBand })} style={{ ...field, marginTop: 3 }}>
                {(Object.keys(AGE_BAND_LABELS) as AgeBand[]).map(b => <option key={b} value={b}>{AGE_BAND_LABELS[b]}</option>)}
              </select>
            </label>
            <label style={caption}>
              Within
              <select value={target.radius} onChange={e => set({ radius: Number(e.target.value) as CatchmentRadius })} style={{ ...field, marginTop: 3 }}>
                {CATCHMENT_RADII.map(r => <option key={r} value={r}>{r} km</option>)}
              </select>
            </label>
          </div>

          <div style={{ marginTop: 10 }}>
            <label htmlFor="planner-catchment-weight" style={{ ...caption, display: 'flex', justifyContent: 'space-between', color: '#0F172A' }}>
              <span>Weight in Smart Suggest</span>
              <span style={numeric}>{target.weight}%</span>
            </label>
            <input id="planner-catchment-weight" type="range" min={0} max={100} step={10} value={target.weight} onChange={e => set({ weight: Number(e.target.value) })} style={{ width: '100%', accentColor: '#1B4F8A' }} />
            <p style={caption}>
              {target.weight === 0
                ? 'Off: Smart Suggest ignores nearby residents.'
                : <>Adds up to <span style={numeric}>{maxPoints}</span> points to a board in Smart Suggest, scaled by its rank on nearby residents among the boards listed here. For comparison, city adds up to 1,000 and format up to 250.{target.segment || target.state || target.city ? ' Smart Suggest also picks only from the boards listed here.' : ''}</>}
            </p>
          </div>

          <div style={{ marginTop: 10, borderTop: '1px solid #F1F5F9', paddingTop: 8 }}>
            <p style={{ ...caption, color: '#0F172A', fontWeight: 600 }}>
              <span style={numeric}>{ranked.length}</span> available board{ranked.length !== 1 ? 's' : ''} match
              {withData < ranked.length && <span style={{ fontWeight: 400, color: '#92400E' }}> · <span style={numeric}>{ranked.length - withData}</span> without catchment data</span>}
            </p>
            {!context && <p style={{ ...caption, marginTop: 4 }}>Loading market data…</p>}
            <ol style={{ listStyle: 'none', margin: '6px 0 0', padding: 0, maxHeight: 260, overflowY: 'auto', display: 'grid', gap: 4 }}>
              {ranked.slice(0, 30).map(({ board, market, residents }, i) => {
                const selected = selectedIds.has(board.id);
                return (
                  <li key={board.id} onMouseEnter={() => onHighlight?.(board.id)} onMouseLeave={() => onHighlight?.(null)}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 6, background: '#F8FAFC', border: '1px solid #F1F5F9' }}>
                    <span style={{ ...numeric, fontSize: '0.6875rem', color: '#94A3B8', width: 16, textAlign: 'right', flexShrink: 0 }}>{i + 1}</span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#0F172A', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{board.name}</span>
                      <span style={{ ...numeric, display: 'block', fontSize: '0.6875rem', color: residents === null ? '#94A3B8' : '#334155' }}>
                        {catchmentLabel(catchmentResidents(market.catchments[target.radius], target.band), target.band, target.radius)}
                      </span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.6875rem', color: '#64748B' }}>
                        {market.lga ? <>{market.lga.lga_name} LGA · <SegmentTag segment={market.lga.segment} /></> : 'Outside every LGA boundary'}
                      </span>
                    </span>
                    <button type="button" onClick={() => onToggleBoard(board)} aria-pressed={selected}
                      style={{ flexShrink: 0, padding: '4px 8px', borderRadius: 6, border: `1px solid ${selected ? '#1B4F8A' : '#E2E8F0'}`, background: selected ? '#EFF6FF' : '#fff', color: selected ? '#1B4F8A' : '#334155', fontSize: '0.6875rem', fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer' }}>
                      {selected ? 'Remove' : 'Add'}
                    </button>
                  </li>
                );
              })}
            </ol>
            {ranked.length > 30 && <p style={{ ...caption, marginTop: 4 }}>Showing the first 30.</p>}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Corridor/radius tool summary: the catchments of the boards inside the
 * drawn shape, added together, and which segments those boards sit in.
 */
export function CorridorMarketSummary({ boardIds, context, band, radius }: { boardIds: string[]; context: BoardMarketContext | null; band: AgeBand; radius: CatchmentRadius }) {
  if (!context || boardIds.length === 0) return null;
  let sum = 0;
  let counted = 0;
  const mix: Record<Segment, number> = { high_value: 0, youth_hub: 0, mass_market: 0, unclassified: 0 };
  let outside = 0;
  for (const id of boardIds) {
    const market = context.byBoard[id];
    const residents = catchmentResidents(market?.catchments[radius], band);
    if (residents !== null) { sum += residents; counted++; }
    if (market?.lga) mix[market.lga.segment ?? 'unclassified']++; else outside++;
  }
  return (
    <div style={{ margin: '0 0 10px', padding: '8px 10px', borderRadius: 8, background: '#F8FAFC', border: '1px solid #E2E8F0' }}>
      <p style={{ ...caption, color: '#0F172A', fontWeight: 600 }}>
        {counted === 0 ? 'No catchment data for these boards' : <><span style={numeric}>{Math.round(sum).toLocaleString('en-NG')}</span> residents {AGE_BAND_LABELS[band]} within {radius} km (modelled), summed over <span style={numeric}>{counted}</span> board{counted !== 1 ? 's' : ''}</>}
      </p>
      {counted > 0 && (
        <p style={caption}>
          Each board&apos;s {radius} km circle is added in full, so people living near more than one of these boards are counted once per board.
          {counted < boardIds.length ? ` ${boardIds.length - counted} board${boardIds.length - counted !== 1 ? 's have' : ' has'} no catchment data and ${boardIds.length - counted !== 1 ? 'are' : 'is'} left out.` : ''}
        </p>
      )}
      <p style={{ ...caption, marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: '2px 10px' }}>
        {(Object.keys(mix) as Segment[]).filter(s => mix[s] > 0).map(s => (
          <span key={s} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <SegmentTag segment={s} /> <span style={numeric}>{mix[s]}</span>
          </span>
        ))}
        {outside > 0 && <span>Outside LGA boundaries <span style={numeric}>{outside}</span></span>}
      </p>
    </div>
  );
}
