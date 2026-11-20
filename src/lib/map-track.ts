'use client';

/**
 * Which map features people use (migration 062): layers, filters, searches,
 * intelligence opened. Same privacy rules as the funnel: a random browser id,
 * no name, email or IP; once per visitor, feature and day; admins not counted.
 */
import { supabase } from './supabase';
import { visitorId } from './track';

export type MapEvent = 'map_view' | 'board_click' | 'map_search' | 'filter' | 'layer' | 'intel_open' | 'intel_detail' | 'compare' | 'pricing_click';

const sent = new Set<string>();

export function trackMap(event: MapEvent, detail = '', boardId?: string | null): void {
  if (typeof window === 'undefined' || navigator.webdriver) return; // skip bots and automated test browsers
  const d = detail.toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 40);
  const once = `${event}:${d}:${boardId ?? ''}`;
  if (sent.has(once)) return;
  sent.add(once);
  const visitor = visitorId();
  if (!visitor) return;
  supabase.rpc('track_map_event', { p_event: event, p_detail: d, p_visitor: visitor, p_board: boardId ?? null }).then(() => {}, () => {});
}
