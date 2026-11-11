'use client';

/**
 * Anonymous funnel events (migration 054): board viewed, board saved,
 * request started. The visitor is a random id kept in this browser; no name,
 * email or IP is sent. Never throws and never blocks the page.
 */

import { supabase } from './supabase';

export type FunnelEvent = 'board_view' | 'shortlist_add' | 'request_open';

const KEY = 'ooh_vid';
const sent = new Set<string>();

function visitorId(): string | null {
  try {
    let id = localStorage.getItem(KEY);
    if (!id || !/^[A-Za-z0-9_-]{12,64}$/.test(id)) {
      id = (crypto.randomUUID?.() ?? `${Date.now()}${Math.random()}`).replace(/[^A-Za-z0-9]/g, '').slice(0, 32);
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return null; // storage blocked: don't count rather than count twice
  }
}

export function track(event: FunnelEvent, boardId?: string | null): void {
  if (typeof window === 'undefined') return;
  const once = `${event}:${boardId ?? ''}`;
  if (sent.has(once)) return;
  sent.add(once);
  const visitor = visitorId();
  if (!visitor) return;
  supabase.rpc('track_event', { p_event: event, p_visitor: visitor, p_board: boardId ?? null }).then(() => {}, () => {});
}
