'use client';

import { useEffect } from 'react';
import { track } from '@/lib/track';

/** Counts a site visit: once per browser per day (the database ignores repeats). Admins aren't counted. */
export default function VisitTracker() {
  useEffect(() => { track('site_visit'); }, []);
  return null;
}
