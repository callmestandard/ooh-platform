'use client';

/**
 * Board catchments: modelled RESIDENTS within 1, 2 and 5 km of a board, from
 * `board_catchments` (migration 039). These are people who live nearby
 * according to a population model. They are not a measure of who sees a
 * board — this system holds no traffic or dwell data — so nothing built on
 * this file may call them reach, impressions or audience.
 */

import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { supabase } from '@/lib/supabase';
import { fetchMarketData } from './data';
import { percentileRanks, type Segment } from './segments';
import type { GeoDataset, LgaMetrics } from './types';

export type CatchmentRadius = 1 | 2 | 5;
export type AgeBand = 'pop_15_24' | 'pop_25_34' | 'pop_35_plus' | 'pop_15_34';

export const CATCHMENT_RADII: CatchmentRadius[] = [1, 2, 5];
export const AGE_BAND_LABELS: Record<AgeBand, string> = {
  pop_15_24: 'aged 15-24',
  pop_25_34: 'aged 25-34',
  pop_15_34: 'aged 15-34',
  pop_35_plus: 'aged 35 and over',
};

export type Catchment = {
  radius_km: CatchmentRadius;
  pop_15_24: number;
  pop_25_34: number;
  pop_35_plus: number;
  cells: number;
  population_dataset_id: string;
  computed_at: string;
};

export type BoardMarket = {
  /** The LGA whose boundary contains the board, with its stored (default-weight) segment. Null if outside every LGA. */
  lga: LgaMetrics | null;
  /** By radius. Empty when no catchment has been computed for the board. */
  catchments: Partial<Record<CatchmentRadius, Catchment>>;
};

export type BoardMarketContext = {
  byBoard: Record<string, BoardMarket>;
  lgas: LgaMetrics[];
  populationDataset: GeoDataset | null;
};

export function catchmentResidents(c: Catchment | undefined, band: AgeBand): number | null {
  if (!c) return null;
  return band === 'pop_15_34' ? c.pop_15_24 + c.pop_25_34 : c[band];
}

/** "1,234 residents aged 15-24 within 2 km (modelled)" — the one wording used everywhere. */
export function catchmentLabel(value: number | null, band: AgeBand, radius: CatchmentRadius): string {
  if (value === null) return 'No catchment data';
  return `${Math.round(value).toLocaleString('en-NG')} residents ${AGE_BAND_LABELS[band]} within ${radius} km (modelled)`;
}

type GeoBoard = { id: string; latitude?: number | null; longitude?: number | null };

/**
 * Everything the planner needs to place boards in their market context:
 * each board's LGA (point-in-polygon on the static boundary file), that
 * LGA's segment, and the board's cached catchments.
 */
export async function fetchBoardMarketContext(boards: GeoBoard[]): Promise<BoardMarketContext> {
  const [market, lgaGeo, catchmentRows] = await Promise.all([
    fetchMarketData(),
    fetch('/geo/ng-lga.geojson').then(r => {
      if (!r.ok) throw new Error(`LGA boundaries could not be loaded (${r.status})`);
      return r.json() as Promise<GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon>>;
    }),
    fetchCatchments(boards.map(b => b.id)),
  ]);

  const lgaByCode = new Map(market.lgas.map(l => [l.lga_pcode, l]));
  // Bounding boxes first, so each board is tested against a handful of polygons, not 774.
  const shapes = lgaGeo.features.map(feature => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const polygons = feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates;
    for (const rings of polygons) for (const [x, y] of rings[0]) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    return { feature, minX, minY, maxX, maxY };
  });

  const byBoard: Record<string, BoardMarket> = {};
  for (const board of boards) {
    let lga: LgaMetrics | null = null;
    const { latitude: lat, longitude: lng } = board;
    if (typeof lat === 'number' && typeof lng === 'number') {
      const hit = shapes.find(s => lng >= s.minX && lng <= s.maxX && lat >= s.minY && lat <= s.maxY && booleanPointInPolygon([lng, lat], s.feature));
      lga = hit ? lgaByCode.get(hit.feature.properties?.lga_pcode) ?? null : null;
    }
    byBoard[board.id] = { lga, catchments: {} };
  }
  for (const row of catchmentRows) {
    const entry = byBoard[row.board_id];
    if (entry) entry.catchments[row.radius_km] = row;
  }

  const datasetId = catchmentRows[0]?.population_dataset_id ?? 'worldpop_agesex_2020_constrained';
  return { byBoard, lgas: market.lgas, populationDataset: market.datasets[datasetId] ?? null };
}

async function fetchCatchments(boardIds: string[]): Promise<(Catchment & { board_id: string })[]> {
  const rows: (Catchment & { board_id: string })[] = [];
  // Chunked so the id list never overflows the request URL.
  for (let i = 0; i < boardIds.length; i += 150) {
    const { data, error } = await supabase
      .from('board_catchments')
      .select('board_id, radius_km, pop_15_24, pop_25_34, pop_35_plus, cells, population_dataset_id, computed_at')
      .in('board_id', boardIds.slice(i, i + 150));
    if (error) throw new Error(error.message);
    rows.push(...((data || []) as (Catchment & { board_id: string })[]));
  }
  return rows;
}

// ── Targeting ──────────────────────────────────────────────────────────────

export type TargetSegment = Exclude<Segment, 'unclassified'> | 'custom';

export type MarketTarget = {
  /** null = no market targeting; the planner behaves exactly as before. */
  segment: TargetSegment | null;
  /** Custom filter on LGA metrics; an empty field is not applied. */
  custom: { minYouthShare: number | null; minDensity: number | null; minAffluence: number | null };
  state: string | null;
  city: string | null;
  band: AgeBand;
  radius: CatchmentRadius;
  /** 0-100. How much the catchment counts in Smart Suggest; always shown beside the control. */
  weight: number;
};

export const DEFAULT_TARGET: MarketTarget = {
  segment: null,
  custom: { minYouthShare: null, minDensity: null, minAffluence: null },
  state: null,
  city: null,
  band: 'pop_15_34',
  radius: 2,
  weight: 50,
};

/** Points a board at the top of the catchment ranking gains in Smart Suggest at 100% weight. */
export const CATCHMENT_MAX_POINTS = 500;

export function lgaMatchesTarget(lga: LgaMetrics | null, target: MarketTarget): boolean {
  if (!target.segment) return true;
  if (!lga) return false;
  if (target.segment !== 'custom') return lga.segment === target.segment;
  const { minYouthShare, minDensity, minAffluence } = target.custom;
  if (minYouthShare !== null && !(lga.youth_share !== null && lga.youth_share * 100 >= minYouthShare)) return false;
  if (minDensity !== null && !(lga.pop_density_km2 !== null && lga.pop_density_km2 >= minDensity)) return false;
  if (minAffluence !== null && !(lga.affluence_index !== null && lga.affluence_index >= minAffluence)) return false;
  return true;
}

type TargetBoard = GeoBoard & { city?: string | null };

export type RankedBoard<T> = { board: T; market: BoardMarket; residents: number | null };

/**
 * Boards that fall in the chosen segment and place, ordered by modelled
 * residents in the chosen age band and radius. Boards without a computed
 * catchment come last and are shown as "no data" — they are not given a guess.
 */
export function rankBoardsForTarget<T extends TargetBoard>(boards: T[], context: BoardMarketContext, target: MarketTarget): RankedBoard<T>[] {
  return boards
    .map(board => {
      const market = context.byBoard[board.id] ?? { lga: null, catchments: {} };
      return { board, market, residents: catchmentResidents(market.catchments[target.radius], target.band) };
    })
    .filter(({ board, market }) =>
      lgaMatchesTarget(market.lga, target) &&
      (!target.state || market.lga?.state_name === target.state) &&
      (!target.city || (board.city || '').toLowerCase() === target.city.toLowerCase()))
    .sort((a, b) => (b.residents ?? -1) - (a.residents ?? -1));
}

/**
 * The catchment's contribution to Smart Suggest, in the same points the
 * existing score uses: each candidate's percentile rank on residents (0-100)
 * x weight x CATCHMENT_MAX_POINTS. Zero weight, or no target, adds nothing.
 */
export function catchmentBonusPoints<T extends TargetBoard>(ranked: RankedBoard<T>[], weight: number): Record<string, number> {
  const ranks = percentileRanks(ranked.map(r => r.residents));
  const bonus: Record<string, number> = {};
  ranked.forEach((r, i) => { bonus[r.board.id] = ranks[i] === null ? 0 : (weight / 100) * CATCHMENT_MAX_POINTS * ((ranks[i] as number) / 100); });
  return bonus;
}
