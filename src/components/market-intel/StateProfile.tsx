'use client';

import { METRICS, SEQUENTIAL_COLORS, formatMetric, type MetricKey } from '@/lib/geo/metrics';
import type { GeoDataset, LgaMetrics, StateMetrics } from '@/lib/geo/types';
import { InfoButton, PanelHeader, T, numeric, plainButton, sectionLabel, type EvidenceTarget } from './ui';

const MAX_COMPARE = 3;

const DHS_FIFTHS: { key: keyof StateMetrics; label: string }[] = [
  { key: 'dhs_q1_lowest_pct', label: 'Lowest' },
  { key: 'dhs_q2_second_pct', label: 'Second' },
  { key: 'dhs_q3_middle_pct', label: 'Middle' },
  { key: 'dhs_q4_fourth_pct', label: 'Fourth' },
  { key: 'dhs_q5_highest_pct', label: 'Highest' },
];

const HEADLINE: MetricKey[] = ['pop_total', 'pop_15_34', 'youth_share', 'pop_density_km2'];

type Props = {
  states: StateMetrics[];
  allStates: StateMetrics[];
  lgas: LgaMetrics[];
  /** Boards with coordinates inside each state's boundary; null while boards are loading. */
  boardCounts: Record<string, number> | null;
  datasets: Record<string, GeoDataset>;
  onEvidence: (target: EvidenceTarget) => void;
  onAddState: (code: string) => void;
  onRemoveState: (code: string) => void;
  onSelectLga: (code: string) => void;
  onClose: () => void;
};

function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function download(filename: string, rows: (string | number | null | undefined)[][]) {
  const csv = rows.map(r => r.map(csvCell).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export default function StateProfile({ states, allStates, lgas, boardCounts, datasets, onEvidence, onAddState, onRemoveState, onSelectLga, onClose }: Props) {
  const lgasOf = (code: string) => lgas.filter(l => l.state_pcode === code);
  const topBy = (code: string, key: 'pop_15_34' | 'affluence_index') =>
    lgasOf(code).filter(l => l[key] !== null).sort((a, b) => (b[key] as number) - (a[key] as number)).slice(0, 5);
  const massMarket = (code: string) => lgasOf(code).filter(l => l.segment === 'mass_market').sort((a, b) => a.lga_name.localeCompare(b.lga_name));
  const addable = allStates.filter(s => !states.some(x => x.state_pcode === s.state_pcode));
  const slug = states.map(s => s.state_name.toLowerCase().replace(/[^a-z]+/g, '-')).join('_');
  const source = (id: string | null) => (id && datasets[id] ? `${datasets[id].name} (${datasets[id].reference_year})` : '');

  function evidence(state: StateMetrics, metric: MetricKey, display: string, notes?: string[]) {
    onEvidence({ metric, display, geography: `${state.state_name} State`, row: state, notes });
  }

  function exportStates() {
    const rows: (string | number | null)[][] = [[
      'state_pcode', 'state', 'area_km2',
      'residents_modelled', 'residents_15_34_modelled', 'share_15_34', 'residents_per_km2', 'population_source',
      ...DHS_FIFTHS.map(f => `dhs_${f.label.toLowerCase()}_fifth_pct`), 'dhs_sample_unweighted', 'dhs_source',
      'mass_market_lgas', 'boards_on_platform',
    ]];
    for (const s of states) {
      rows.push([
        s.state_pcode, s.state_name, s.area_km2,
        s.pop_total, s.pop_15_34, s.youth_share, s.pop_density_km2, source(s.population_dataset_id),
        ...DHS_FIFTHS.map(f => s[f.key] as number | null), s.dhs_sample_unweighted, source(s.dhs_dataset_id),
        massMarket(s.state_pcode).length, boardCounts ? boardCounts[s.state_pcode] ?? 0 : null,
      ]);
    }
    download(`state-profile_${slug}.csv`, rows);
  }

  function exportLgas() {
    const rows: (string | number | null)[][] = [[
      'state', 'lga_pcode', 'lga', 'area_km2',
      'residents_modelled', 'residents_15_24_modelled', 'residents_25_34_modelled', 'residents_15_34_modelled', 'share_15_34', 'residents_per_km2', 'population_source',
      'night_light_mean', 'night_light_source', 'banks_malls_hotels_universities_per_km2_mapped', 'places_source',
      'affluence_index', 'segment', 'youth_count_percentile', 'youth_share_percentile', 'density_percentile',
    ]];
    for (const s of states) {
      for (const l of lgasOf(s.state_pcode)) {
        rows.push([
          l.state_name, l.lga_pcode, l.lga_name, l.area_km2,
          l.pop_total, l.pop_15_24, l.pop_25_34, l.pop_15_34, l.youth_share, l.pop_density_km2, source(l.population_dataset_id),
          l.ntl_mean, source(l.ntl_dataset_id), l.poi_affluence_density_km2, source(l.poi_dataset_id),
          l.affluence_index, l.segment, l.youth_count_pctile, l.youth_share_pctile, l.density_pctile,
        ]);
      }
    }
    download(`lga-table_${slug}.csv`, rows);
  }

  const cell = { padding: '10px 12px', verticalAlign: 'top', borderBottom: `1px solid ${T.hairline}`, fontSize: '0.8125rem', color: T.body } as const;
  const rowHead = { ...cell, color: T.muted, width: 132, fontWeight: 400, textAlign: 'left' } as const;

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: T.surface }}>
      <PanelHeader
        title={states.length > 1 ? 'State comparison' : `${states[0].state_name} State`}
        subtitle={states.length > 1 ? `${states.length} states side by side` : `${states[0].lga_count} LGAs`}
        onClose={onClose}
        closeLabel="Close state profile"
      />

      <div style={{ padding: '10px 16px', borderBottom: `1px solid ${T.hairline}`, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        {states.length < MAX_COMPARE && (
          <select
            aria-label="Add a state to compare"
            value=""
            onChange={e => e.target.value && onAddState(e.target.value)}
            style={{ ...plainButton, padding: '5px 8px', maxWidth: 180 }}
          >
            <option value="">Compare with…</option>
            {addable.map(s => <option key={s.state_pcode} value={s.state_pcode}>{s.state_name}</option>)}
          </select>
        )}
        <button type="button" onClick={exportStates} style={plainButton}>Export state table (CSV)</button>
        <button type="button" onClick={exportLgas} style={plainButton}>Export LGA table (CSV)</button>
      </div>

      <div style={{ flex: 1, overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', minWidth: 132 + states.length * 200 }}>
          <thead>
            <tr>
              <th scope="col" style={{ ...rowHead, borderBottom: `1px solid ${T.line}` }}><span style={sectionLabel}>Figure</span></th>
              {states.map(s => (
                <th key={s.state_pcode} scope="col" style={{ ...cell, textAlign: 'left', borderBottom: `1px solid ${T.line}`, color: T.ink, fontWeight: 600 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    {s.state_name}
                    {states.length > 1 && (
                      <button type="button" onClick={() => onRemoveState(s.state_pcode)} aria-label={`Remove ${s.state_name} from comparison`} style={{ ...plainButton, padding: '1px 6px', fontSize: '0.6875rem', fontWeight: 400 }}>
                        Remove
                      </button>
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {HEADLINE.map(metric => (
              <tr key={metric}>
                <th scope="row" style={rowHead}>{METRICS[metric].label}</th>
                {states.map(s => {
                  const value = s[metric as keyof StateMetrics] as number | null;
                  const display = formatMetric(metric, value);
                  return (
                    <td key={s.state_pcode} style={cell}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ ...numeric, fontSize: '0.9375rem', fontWeight: 600, color: value === null ? T.faint : T.ink }}>{display}</span>
                        <InfoButton label={`${METRICS[metric].label}, ${s.state_name}`} onClick={() => evidence(s, metric, display)} />
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}

            <tr>
              <th scope="row" style={rowHead}>{METRICS.dhs_wealth.label}</th>
              {states.map(s => {
                const values = DHS_FIFTHS.map(f => s[f.key] as number | null);
                const has = values.every(v => v !== null);
                const summary = has ? DHS_FIFTHS.map((f, i) => `${f.label} ${formatMetric('dhs_wealth', values[i])}`).join(', ') : 'No data';
                const notes = has && s.dhs_sample_unweighted !== null
                  ? [`Sample: ${s.dhs_sample_unweighted.toLocaleString('en-NG')} people in surveyed households (unweighted). The source publishes no confidence interval for these figures.`]
                  : undefined;
                return (
                  <td key={s.state_pcode} style={cell}>
                    {has ? (
                      <>
                        <div aria-hidden style={{ display: 'flex', height: 10, border: `1px solid ${T.line}`, marginBottom: 6 }}>
                          {values.map((v, i) => <div key={i} style={{ width: `${v}%`, background: SEQUENTIAL_COLORS[i] }} />)}
                        </div>
                        <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: '1fr auto', rowGap: 1, columnGap: 8, fontSize: '0.75rem' }}>
                          {DHS_FIFTHS.map((f, i) => (
                            <div key={f.label} style={{ display: 'contents' }}>
                              <dt style={{ color: T.muted, display: 'flex', alignItems: 'center', gap: 6 }}>
                                <span aria-hidden style={{ width: 8, height: 8, background: SEQUENTIAL_COLORS[i], border: `1px solid ${T.line}` }} />{f.label} fifth
                              </dt>
                              <dd style={{ ...numeric, margin: 0, textAlign: 'right', color: T.ink }}>{formatMetric('dhs_wealth', values[i])}</dd>
                            </div>
                          ))}
                        </dl>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, fontSize: '0.6875rem', color: T.muted }}>
                          <span style={numeric}>Sample {s.dhs_sample_unweighted?.toLocaleString('en-NG')}</span>
                          <InfoButton label={`Wealth fifths, ${s.state_name}`} onClick={() => evidence(s, 'dhs_wealth', summary, notes)} />
                        </div>
                      </>
                    ) : <span style={{ color: T.faint }}>No data</span>}
                  </td>
                );
              })}
            </tr>

            {([
              { key: 'pop_15_34', title: 'Top 5 LGAs by residents aged 15-34 (modelled)' },
              { key: 'affluence_index', title: 'Top 5 LGAs by affluence index' },
            ] as const).map(list => (
              <tr key={list.key}>
                <th scope="row" style={rowHead}>{list.title}</th>
                {states.map(s => {
                  const top = topBy(s.state_pcode, list.key);
                  return (
                    <td key={s.state_pcode} style={cell}>
                      {top.length === 0 ? <span style={{ color: T.faint }}>No data</span> : (
                        <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 3 }}>
                          {top.map(l => (
                            <li key={l.lga_pcode} style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                              <button type="button" onClick={() => onSelectLga(l.lga_pcode)} style={{ border: 'none', background: 'none', padding: 0, color: T.accent, fontSize: '0.8125rem', fontFamily: 'inherit', cursor: 'pointer', textAlign: 'left' }}>
                                {l.lga_name}
                              </button>
                              <span style={{ ...numeric, color: T.ink }}>{formatMetric(list.key, l[list.key])}</span>
                            </li>
                          ))}
                        </ol>
                      )}
                      {top.length > 0 && (
                        <div style={{ marginTop: 6 }}>
                          <InfoButton
                            label={`${METRICS[list.key].label}, LGAs of ${s.state_name}`}
                            onClick={() => onEvidence({ metric: list.key, display: formatMetric(list.key, top[0][list.key]), geography: `${top[0].lga_name}, ${s.state_name} (highest in the state)`, row: top[0] })}
                          />
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}

            <tr>
              <th scope="row" style={rowHead}>Mass market LGAs</th>
              {states.map(s => {
                const list = massMarket(s.state_pcode);
                return (
                  <td key={s.state_pcode} style={cell}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: list.length ? 4 : 0 }}>
                      <span style={{ ...numeric, fontWeight: 600, color: T.ink }}>{list.length}</span>
                      <span style={{ color: T.muted }}>of {s.lga_count}</span>
                      {list.length > 0 && (
                        <InfoButton label={`Mass market segment, ${s.state_name}`} onClick={() => onEvidence({ metric: 'segment', display: 'Mass market', geography: `${list[0].lga_name}, ${s.state_name}`, row: list[0] })} />
                      )}
                    </div>
                    {list.map((l, i) => (
                      <span key={l.lga_pcode}>
                        <button type="button" onClick={() => onSelectLga(l.lga_pcode)} style={{ border: 'none', background: 'none', padding: 0, color: T.accent, fontSize: '0.8125rem', fontFamily: 'inherit', cursor: 'pointer' }}>
                          {l.lga_name}
                        </button>
                        {i < list.length - 1 ? ', ' : ''}
                      </span>
                    ))}
                  </td>
                );
              })}
            </tr>

            <tr>
              <th scope="row" style={rowHead}>Boards on this platform</th>
              {states.map(s => (
                <td key={s.state_pcode} style={cell}>
                  <span style={{ ...numeric, fontSize: '0.9375rem', fontWeight: 600, color: T.ink }}>
                    {boardCounts ? (boardCounts[s.state_pcode] ?? 0).toLocaleString('en-NG') : '…'}
                  </span>
                  <p style={{ fontSize: '0.6875rem', color: T.muted, margin: '2px 0 0' }}>Boards you can see whose coordinates fall inside the state boundary.</p>
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
