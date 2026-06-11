const buckets = new Map<string, { count: number; reset: number }>();

export function rateLimit(key: string, maxReq = 10, windowMs = 60_000): boolean {
  const now = Date.now();
  const entry = buckets.get(key);
  if (!entry || entry.reset < now) {
    buckets.set(key, { count: 1, reset: now + windowMs });
    return true;
  }
  entry.count++;
  return entry.count <= maxReq;
}

export function rateLimitResponse() {
  return Response.json({ error: 'Too many requests — please wait and try again' }, { status: 429 });
}
