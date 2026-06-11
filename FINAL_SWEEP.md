# Final Pre-Launch Sweep — Change Log

All changes made during the CTO pre-launch sweep. Build and `tsc --noEmit` both pass clean.

---

## 1. Auth on All Remaining API Routes

Applied `requireAuth` + `unauthorized()` to every route that bypasses RLS via the service-role key.

| Route | Methods secured |
|-------|----------------|
| `api/invoices/[id]` | GET (+ ownership scope by role), PATCH, DELETE |
| `api/invoices/[id]/pdf` | GET |
| `api/invoices/[id]/paystack` | POST |
| `api/invoices/[id]/erp-export` | GET |
| `api/invoices/compile` | POST |
| `api/invoices/media-partner` | GET (+ role-scoped: owner/agency), POST, PATCH |
| `api/mpo-pdf` | POST |
| `api/contract-pdf` | POST |
| `api/media-plan-pdf` | POST |
| `api/poe-deck` | POST |
| `api/boards/[id]/enrich` | POST |
| `api/import-plan` | POST |
| `api/location-intel` | GET |

Public routes left untouched: `paystack/webhook`, `paystack/callback`, `tracking`, `health`, `poe/[token]`.

**Ownership scoping added:**
- `invoices/[id]` GET: fetches caller profile role, returns 403 if agency/owner doesn't own the invoice
- `invoices/media-partner` GET: scopes query to `owner_id` or `agency_id` based on caller role

---

## 2. Rate Limiting

New file: `src/lib/rate-limit.ts` — in-memory Map-based limiter, 10 req/min per user.

Applied to:
- `api/compliance/verify` — `rateLimit('compliance:{user.id}')`
- `api/location-intel` — `rateLimit('location-intel:{user.id}')`

Returns `429 Too many requests` when limit exceeded.

---

## 3. N+1 Fix in rate-intelligence.ts

**Before:** `getAllMarketRates` queried bookings per board per month (N×M queries).

**After:** Added `getAllRateTrends(months?)` — single query across all bookings, grouped client-side by `format||city` key and `YYYY-MM` month key. Old per-board function untouched for backward compat.

File: `src/lib/rate-intelligence.ts`

---

## 4. Audience Filter Removed

`src/app/dashboard/agency/marketplace/page.tsx` — removed all audience filter UI.

The `audience_segments` table does not exist. Left a TODO comment:
```
// TODO: Audience/demographic filter — requires location-intel table (audience_segments)
// which doesn't exist yet. When location-intel is live, add filter chips here.
```

---

## 5. Skeleton Loaders

Replaced spinners/loading text with reusable Skeleton components on 6 pages:

| Page | Component used |
|------|---------------|
| `agency/negotiations` | `SkeletonTable rows={6} cols={5}` |
| `agency/campaigns` (list) | `SkeletonGrid cols={3} rows={2}` |
| `agency/compliance` | `SkeletonTable rows={5} cols={5}` |
| `agency/availability` | `SkeletonTable rows={8} cols={5}` |
| `agency/reports` | `SkeletonTable rows={6} cols={4}` |
| `agency/rate-intelligence` | `SkeletonGrid cols={3} rows={3}` |

---

## 6. OnboardingWizard Wired

Wired `OnboardingWizard` into all three role dashboards. Shows on first visit (no data), dismissible, stores dismissal in `localStorage` key `ooh_onboarding_{role}_done`.

| Dashboard | Role |
|-----------|------|
| `dashboard/agency/page.tsx` | `"agency"` |
| `dashboard/owner/page.tsx` | `"owner"` |
| `dashboard/client/page.tsx` | `"client"` |

Each fetches `supabase.auth.getUser()` to pass `userName` to the wizard.

---

## 7. metadataBase Set

`src/app/layout.tsx` — added:
```ts
metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || 'https://ooh-platform-xi.vercel.app'),
```

Resolves OG/social image URLs correctly in production.

---

## 8. Global Toast Migration

Migrated all 12 pages from local per-page toast state to the global `useToast()` hook from `src/components/ui/Toast.tsx`. Removed all inline toast JSX, `useState` toast state, and `showToast` helper functions.

| File | Migration pattern |
|------|------------------|
| `dashboard/agency/marketplace/page.tsx` | `const { toast: showToast } = useToast()` |
| `dashboard/client/page.tsx` | `const { toast: showToast } = useToast()` |
| `dashboard/settings/page.tsx` | `const { toast: showToast } = useToast()` |
| `dashboard/owner/page.tsx` | `const { toast: showToast } = useToast()` |
| `dashboard/admin/page.tsx` | `const { toast: showToast } = useToast()` |
| `dashboard/agency/invoices/page.tsx` | wrapper: `(msg, err) => err ? toastErr(msg) : toastOk(msg)` |
| `dashboard/agency/invoices/[id]/page.tsx` | wrapper: `(msg, ok) => ok ? toastOk(msg) : toastErr(msg)` |
| `dashboard/agency/campaigns/page.tsx` | direct `toastSuccess()` / `toastError()` calls |
| `dashboard/agency/campaigns/[id]/page.tsx` | `const { toast: showToast } = useToast()` |
| `dashboard/agency/campaign-planner/page.tsx` | `const { toast: showToast } = useToast()` |
| `invoice/[id]/page.tsx` | `const { toast: showToast } = useToast()` |

---

## Build Verification

```
✓ npx tsc --noEmit  — no errors
✓ npm run build     — 47 pages compiled, no errors
```
