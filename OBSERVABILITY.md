# Observability Audit — OOH Platform

**Date:** 2026-06-10  
**Build:** ✅ Passes clean

---

## What was added in Pillar 5

### 1. Error tracking — Sentry v10

Three config files created, all gate-keyed on `SENTRY_DSN` — Sentry is a no-op until the env var is set:

| File | Purpose |
|------|---------|
| `sentry.client.config.ts` | Browser error capture, 5% session replay, 100% error replay |
| `sentry.server.config.ts` | Server-side error capture, API route tracing |
| `sentry.edge.config.ts` | Edge runtime errors |

`next.config.ts` now wraps the Next.js config with `withSentryConfig` (tunnel at `/monitoring-tunnel` to bypass ad blockers).

`src/app/global-error.tsx` catches React Server Component crashes and reports them to Sentry before showing the user a "Try again" screen.

**To activate:** add these to `.env.local` and Vercel environment settings:
```
NEXT_PUBLIC_SENTRY_DSN=https://xxx@oyyy.ingest.sentry.io/zzz
SENTRY_DSN=https://xxx@oyyy.ingest.sentry.io/zzz   # same value, server-side
SENTRY_ORG=your-org-slug
SENTRY_PROJECT=ooh-platform
SENTRY_AUTH_TOKEN=sntrys_xxx  # for source map uploads on CI/deploy
```

### 2. Page analytics — Vercel Analytics

`@vercel/analytics` added to layout. Tracks page views automatically in the Vercel dashboard with zero configuration. Requires the project to be deployed on Vercel.

### 3. Core Web Vitals — Vercel Speed Insights

`@vercel/speed-insights` added to layout. Reports LCP, FID, CLS, TTFB, and FCP per route to the Vercel dashboard.

### 4. Structured server-side logger — enhanced

`src/lib/logger.ts` updated: `logger.error()` and `logger.apiHandler()` (on uncaught exceptions) now also call `Sentry.captureMessage` / `Sentry.captureException` when the DSN is present. Console output (JSON lines) still works with or without Sentry.

---

## Existing observability that was already in place

| System | What it captures |
|--------|-----------------|
| `src/lib/activity-log.ts` | Business events written to `activity_events` Supabase table (campaign, booking, invoice, compliance actions) |
| `src/app/api/tracking/route.ts` | QR code scan events and impressions per board |
| `src/lib/logger.ts` | JSON-structured console logs with route, duration, status code |

---

## What is NOT covered (remaining gaps)

### No alert rules configured
Sentry projects need alert rules set up in the Sentry dashboard after DSN activation:
- Alert on new issue
- Alert on error spike (>10 errors/min)
- Alert on performance regression (p95 > 2s)

### No uptime monitoring
No external ping service monitoring `https://your-domain.com/api/health`. Recommend adding a health-check route and wiring it to Vercel Monitoring or BetterUptime.

### Custom business analytics events
`@vercel/analytics` tracks page views only. Higher-value events (campaign created, booking confirmed, invoice paid) are recorded in Supabase `activity_events` but not surfaced in a dashboard. Recommend: add `track('campaign_created', { agency_id })` calls via `import { track } from '@vercel/analytics'` at conversion points.

### Vercel Log Drains not configured
Production errors are visible in `vercel logs` but not forwarded to an external system. If Sentry is not activated, production errors are invisible unless you pull logs manually.

### No p95/p99 latency tracking
The `logger.apiHandler` wrapper records `durationMs` to console. In production, these logs land in Vercel's log stream but are not aggregated. Recommend: pipe to Axiom or Datadog via a Vercel Log Drain to get percentile latency charts per route.

---

## Pre-launch observability checklist

- [x] Sentry SDK installed and config files created
- [x] `global-error.tsx` error boundary for RSC crashes
- [x] `logger.ts` forwards errors to Sentry when DSN is set
- [x] Vercel Analytics wired into root layout
- [x] Vercel Speed Insights wired into root layout
- [ ] Set `NEXT_PUBLIC_SENTRY_DSN` / `SENTRY_DSN` in Vercel env settings
- [ ] Set up Sentry alert rules (new issues, error spikes)
- [ ] Add `track()` calls at key business conversion events
- [ ] Add `/api/health` route + uptime monitor
- [ ] Configure Vercel Log Drain → Axiom / Datadog for structured log retention
