# Launch Checklist — OOH Platform

**Prepared:** 2026-06-10  
**Build:** ✅ Passes clean

This checklist covers everything that must be done or verified before going live. Items marked ✅ are already done. Items marked ☐ require action before launch.

---

## Pillar 1 — Reliability

| # | Check | Status |
|---|-------|--------|
| 1 | RLS migration `001_rls_policies.sql` applied in Supabase | ☐ Run in Supabase SQL editor |
| 2 | All 10 tables have Row Level Security enabled | ☐ Verify in Supabase → Authentication → Policies |
| 3 | `notifications` table uses `recipient_role` column (not `recipient_id`) | ✅ Fixed in migration |
| 4 | No references to non-existent `audience_profiles` / `board_audience_profiles` tables | ✅ Removed from codebase and migration |

---

## Pillar 2 — Security

| # | Check | Status |
|---|-------|--------|
| 5 | `requireAuth` guard on `/api/compliance/verify` | ✅ |
| 6 | `requireAuth` guard on `/api/notify/email` | ✅ |
| 7 | `requireAuth` guard on `/api/invoices` (GET + POST) | ✅ |
| 8 | Cross-tenant invoice query scoped by caller's role | ✅ |
| 9 | `authedFetch` used on all client → API calls in: compliance, campaigns, invoices, owner negotiations | ✅ |
| 10 | Remaining 12 lower-risk API routes should have `requireAuth` added | ☐ See SECURITY.md §gaps |
| 11 | Supabase Storage buckets — verify public/private policies in Supabase dashboard | ☐ |
| 12 | `NEXT_PUBLIC_SUPABASE_ANON_KEY` is anon key only (not service role) | ☐ Verify in Vercel env settings |
| 13 | `SUPABASE_SERVICE_ROLE_KEY` is NOT prefixed `NEXT_PUBLIC_` | ☐ Verify — must never reach the browser |

---

## Pillar 3 — Scale

| # | Check | Status |
|---|-------|--------|
| 14 | All Supabase queries have `.limit()` caps | ✅ |
| 15 | All queries use explicit column lists (no `select('*')` on hot paths) | ✅ |
| 16 | Marketplace filter/sort pipeline memoized | ✅ |
| 17 | Broken `board_audience_profiles` DB call removed | ✅ |
| 18 | Add Supabase indexes for high-traffic queries (see SCALE.md §indexes) | ☐ |

---

## Pillar 4 — Usability

| # | Check | Status |
|---|-------|--------|
| 19 | Global `ToastProvider` in root layout | ✅ |
| 20 | All `window.confirm()` calls replaced with `ConfirmDialog` | ✅ (4 locations) |
| 21 | Skeleton loaders on agency, owner, client main dashboards | ✅ |
| 22 | Audience filter on boards map (non-functional) — remove or fix | ☐ See USABILITY.md |

---

## Pillar 5 — Observability

| # | Check | Status |
|---|-------|--------|
| 23 | `@vercel/analytics` wired into layout | ✅ |
| 24 | `@vercel/speed-insights` wired into layout | ✅ |
| 25 | Sentry SDK installed + config files created | ✅ |
| 26 | `global-error.tsx` RSC error boundary | ✅ |
| 27 | Set `NEXT_PUBLIC_SENTRY_DSN` + `SENTRY_DSN` in Vercel env settings | ☐ Requires Sentry project |
| 28 | Set up Sentry alert rules after first deploy | ☐ |
| 29 | Add `/api/health` uptime endpoint | ☐ |

---

## Environment variables — full pre-launch audit

These must be set in Vercel → Project → Settings → Environment Variables for Production:

| Variable | Required | Notes |
|----------|----------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | Public |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ | Public, anon only |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | Secret, server-only |
| `RESEND_API_KEY` | ✅ | Email sending |
| `ANTHROPIC_API_KEY` | ✅ | AI features |
| `NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY` | ✅ | Public |
| `PAYSTACK_SECRET_KEY` | ✅ | Secret |
| `NEXT_PUBLIC_MAPBOX_TOKEN` | ✅ | Public |
| `NEXT_PUBLIC_SENTRY_DSN` | ☐ | Create project at sentry.io |
| `SENTRY_DSN` | ☐ | Same value as above |
| `SENTRY_ORG` | ☐ | For source map uploads |
| `SENTRY_PROJECT` | ☐ | For source map uploads |
| `SENTRY_AUTH_TOKEN` | ☐ | For source map uploads on CI |

---

## Pre-deploy verification steps

```bash
# 1. Clean build (zero errors)
npm run build

# 2. TypeScript no errors
npx tsc --noEmit

# 3. Confirm .env.local is NOT committed
git status .env.local  # should show "nothing to commit"
```

---

## First 24 hours post-launch

- [ ] Monitor Sentry for new issues (first-run errors surface here)
- [ ] Check Vercel Analytics dashboard for page view data
- [ ] Check Vercel Speed Insights for Core Web Vitals scores
- [ ] Run the RLS migration SQL if not done pre-launch
- [ ] Test a full flow: signup → browse marketplace → create campaign → book board → pay invoice

---

## Audit reports

- [SECURITY.md](./SECURITY.md) — auth gaps, cross-tenant risks, remaining work
- [SCALE.md](./SCALE.md) — query caps, index recommendations, known limits
- [USABILITY.md](./USABILITY.md) — component changes, remaining gaps
- [OBSERVABILITY.md](./OBSERVABILITY.md) — monitoring setup, activation steps
