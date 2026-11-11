'use client';

/**
 * The buyer's shortlist: board ids saved in this browser, so people can
 * collect boards before signing up. Requests and proposal links are made
 * from it on /shortlist. Every read/write is guarded: storage can be
 * blocked (private mode), and the page still works without it.
 */

import { useSyncExternalStore } from 'react';

const KEY = 'ooh_shortlist_v1';
const EVENT = 'ooh:shortlist';
export const SHORTLIST_MAX = 30;

let cache: string[] | null = null;
const EMPTY: string[] = [];

function read(): string[] {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(KEY);
    const ids = raw ? (JSON.parse(raw) as unknown) : [];
    cache = Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string').slice(0, SHORTLIST_MAX) : [];
  } catch {
    cache = [];
  }
  return cache;
}

function write(ids: string[]) {
  cache = ids.slice(0, SHORTLIST_MAX);
  try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch {}
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(cb: () => void) {
  const onStorage = (e: StorageEvent) => { if (e.key === KEY) { cache = null; cb(); } };
  window.addEventListener(EVENT, cb);
  window.addEventListener('storage', onStorage); // other tabs
  return () => { window.removeEventListener(EVENT, cb); window.removeEventListener('storage', onStorage); };
}

/** The saved board ids (newest last). Empty on the server. */
export function useShortlist(): string[] {
  return useSyncExternalStore(subscribe, read, () => EMPTY);
}

export function isShortlisted(id: string) { return read().includes(id); }

/** Adds or removes a board. Returns false when the list is full. */
export function toggleShortlist(id: string): boolean {
  const ids = read();
  if (ids.includes(id)) { write(ids.filter(x => x !== id)); return true; }
  if (ids.length >= SHORTLIST_MAX) return false;
  write([...ids, id]);
  return true;
}

export function removeFromShortlist(id: string) { write(read().filter(x => x !== id)); }
export function setShortlist(ids: string[]) { write([...new Set(ids)]); }
export function clearShortlist() { write([]); }
