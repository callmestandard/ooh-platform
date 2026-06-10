# Verification Report — Production-Readiness Changes

**Date:** 2026-06-10  
**Dev server:** Next.js 16.2.2 (localhost:3000)  
**TypeScript:** `npx tsc --noEmit` → 0 errors  
**Build:** `npm run build` → ✅ Compiled successfully

---

## TEST 3 — Auth Guard Sanity ✅ PASSED

All guarded API routes correctly reject unauthenticated requests.

Tests run against the live dev server with `Invoke-WebRequest` (PowerShell):

| Request | Auth | Result | Expected | Status |
|---------|------|--------|----------|--------|
| `GET /api/invoices` | No token | **401** | 401 | ✅ |
| `POST /api/compliance/verify` | No token | **401** | 401 | ✅ |
| `POST /api/notify/email` | No token | **401** | 401 | ✅ |
| `GET /api/invoices` | Fake JWT (`eyJfake.jwt.token`) | **401** | 401 | ✅ |

**How the guard works:**  
`requireAuth` in `src/lib/require-auth.ts` extracts the `Bearer` token from the `Authorization` header, then calls `supabase.auth.getUser(token)` against the Supabase anon key endpoint. No token → returns null immediately (no network call). Invalid/expired token → Supabase returns null user. In both cases the route returns `{ error: "Unauthorized" }` with status 401.

**authedFetch wiring:**  
`src/lib/api.ts` reads `supabase.auth.getSession()` from the browser localStorage session and injects `Authorization: Bearer <token>` on every client→API call. Verified by code review across compliance, campaigns, invoices, owner-negotiations pages.

---

## TEST 4 — Sentry Graceful Degradation ✅ PASSED

Sentry is configured but not yet activated (no `NEXT_PUBLIC_SENTRY_DSN` in `.env.local`).

**Verified by code review:**

- `sentry.client.config.ts`: `if (process.env.NEXT_PUBLIC_SENTRY_DSN)` — init only runs when DSN is set
- `sentry.server.config.ts`: `if (process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN)` — same guard
- `sentry.edge.config.ts`: same guard
- `src/lib/logger.ts`: `logger.error()` and `logger.apiHandler()` call `Sentry.captureException/captureMessage` only when DSN is present
- **Build with no DSN:** `npm run build` → ✅ compiled without error — Sentry does not crash the app when DSN is unset
- `src/app/global-error.tsx`: created and catches RSC errors, calls `Sentry.captureException(error)` — will be a no-op until DSN is activated

**To fully activate Sentry:** add `NEXT_PUBLIC_SENTRY_DSN` and `SENTRY_DSN` to Vercel env settings. See OBSERVABILITY.md.

---

## Bug Found and Fixed: invoice POST didn't stamp `agency_id` ✅ FIXED

**Discovered during:** code review of `GET /api/invoices` tenant scoping logic.

**Root cause:**  
`POST /api/invoices` created invoices without setting `agency_id`. The `GET` handler for agency users filters by `agency_id = user.id`, so agencies would never see invoices they just created (they'd silently disappear from the list).

**Fix:** `src/app/api/invoices/route.ts` — after `requireAuth`, fetches the caller's profile role and stamps `agency_id` or `owner_id` on the insert:

```ts
const { data: callerProfile } = await supabase.from('profiles').select('role').eq('id', user.id).single();
const tenantFields: Record<string, string> = {};
if (callerProfile?.role === 'agency') tenantFields.agency_id = user.id;
else if (callerProfile?.role === 'owner') tenantFields.owner_id = user.id;
// ... insert({ ..., ...tenantFields })
```

This also aligns with the RLS `invoices_select` policy which gates on `agency_id = auth.uid()`.

---

## RLS Migration — Logic Review ✅ SOUND

Migration: `supabase/migrations/001_rls_policies.sql`

Policy-by-policy review:

| Table | Policy logic | Assessment |
|-------|-------------|------------|
| `profiles` | SELECT: own row or admin; UPDATE/INSERT: own row | ✅ Correct |
| `boards` | SELECT: public (marketplace); INSERT/UPDATE/DELETE: owner_id | ✅ Correct |
| `campaigns` | SELECT: agency_id or client_id or admin; writes: agency_id | ✅ Correct |
| `bookings` | SELECT/UPDATE: joins to campaigns (agency/client) + boards (owner); INSERT: agency only | ✅ Correct |
| `messages` | SELECT: sender or booking participant (JOIN chain); INSERT: sender_id only | ✅ Correct |
| `invoices` | SELECT: agency_id or owner_id or campaign.client_id; writes: agency or owner | ✅ Correct |
| `invoice_items` | SELECT/INSERT: joins to parent invoice | ✅ Correct |
| `compliance_checks` | SELECT: booking → campaign chain; INSERT: open (field agents via service-role) | ✅ Intentional |
| `activity_events` | SELECT: actor_id or campaign participant; INSERT: open (written server-side) | ✅ Intentional |
| `notifications` | SELECT/UPDATE: role-based broadcast (all agencies see agency notifs) | ✅ Intentional — broadcast design |

**Key note on service-role bypass:**  
All API routes use `SUPABASE_SERVICE_ROLE_KEY` which bypasses RLS entirely. RLS is the safety net for direct client-side Supabase queries (anon key). The code-level auth guards (`requireAuth`) + tenant scoping in GET handlers are the primary enforcement layer for API traffic.

---

## TEST 1 — RLS + Data Visibility (Manual Verification Required)

**Status: ⚠️ REQUIRES MANUAL TESTING IN BROWSER**

I cannot log in as different roles through a headless test because:
- There are no test-account credentials available to these tools
- The authentication flow requires a real browser session

**What to verify manually:**

Log in as each role and confirm data loads on:

**Agency:**
- [ ] `/dashboard/agency` — metrics + recent campaigns table loads
- [ ] `/dashboard/agency/campaigns` — campaign list loads
- [ ] `/dashboard/agency/campaigns/[id]` — campaign detail + plan loads
- [ ] `/dashboard/agency/marketplace` — boards grid loads
- [ ] `/dashboard/agency/negotiations` — negotiation list loads
- [ ] `/dashboard/agency/compliance` — compliance checks load
- [ ] `/dashboard/agency/invoices` — invoice list loads
- [ ] `/dashboard/agency/rate-intelligence` — boards load

**Owner:**
- [ ] `/dashboard/owner` — boards, bookings, earnings, invoices tabs load
- [ ] `/dashboard/owner/negotiations` — negotiation list loads

**Client:**
- [ ] `/dashboard/client` — all 7 tabs load

If any screen shows empty where data is expected: check browser console for Supabase 406/403 errors, then review the corresponding RLS policy.

---

## TEST 2 — Tenant Isolation (Manual Verification Required)

**Status: ⚠️ REQUIRES MANUAL TESTING WITH TWO ACCOUNTS**

**What to verify:**

With Agency A logged in:
1. Navigate to Agency B's campaign URL directly → should show 404 or empty
2. `GET /api/invoices` → response should contain ONLY Agency A's invoices (verify with DevTools)
3. Marketplace → Agency A should NOT see Agency B's private negotiated rates

**Code-level evidence of correct isolation** (verified by review):

`GET /api/invoices` — `q.eq('agency_id', user.id)` means Agency A's token can only retrieve rows where `agency_id = A.id`. Agency B's invoices have `agency_id = B.id` and will never be returned.

`POST /api/invoices` — now stamps `agency_id: user.id` (fixed in this session), so new invoices are correctly owned by the creating agency.

RLS `invoices_select` policy: `agency_id = auth.uid()` — provides a second enforcement layer for direct client queries.

---

## Summary

| Test | Method | Result |
|------|--------|--------|
| TEST 3: Auth guards (no token → 401) | Live HTTP tests, 4 requests | ✅ PASSED |
| TEST 3: Auth guards (fake token → 401) | Live HTTP test | ✅ PASSED |
| TEST 4: Sentry graceful no-DSN | Code review + build | ✅ PASSED |
| Invoice POST missing agency_id | Code review | 🐛 BUG FOUND + FIXED |
| RLS migration logic | Policy-by-policy review | ✅ SOUND |
| TEST 1: Data visible per role | Requires browser login | ⚠️ Manual |
| TEST 2: Cross-tenant isolation | Requires 2 accounts | ⚠️ Manual (code evidence strong) |

**One real bug fixed:** `POST /api/invoices` now correctly stamps `agency_id`/`owner_id` on created invoices.  
**TypeScript:** zero errors after the fix.
