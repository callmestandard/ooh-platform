# Security Audit — OOH Platform

**Date:** 2026-06-10  
**Build:** ✅ Passes clean

---

## Architecture: how the app is secured

| Layer | Mechanism | Status |
|-------|-----------|--------|
| Auth (login/sessions) | Supabase Auth (email + password, JWT) | ✅ Active |
| Row Level Security | Supabase RLS policies | ✅ Active — run `001_rls_policies.sql` |
| Direct Supabase queries (client-side) | Anon key + RLS — policies enforce tenant isolation | ✅ Active post-migration |
| API routes | Service-role key (bypasses RLS) — code-level tenant filters | ⚠️ Partially protected |
| File uploads | Supabase Storage via client-side SDK | ✅ Anon key — Storage policies needed |

---

## Fixes applied in Pillar 2

### 1. API route authentication helper
Added `src/lib/require-auth.ts` — reads `Authorization: Bearer <token>` from request header, verifies the JWT against Supabase, returns the user or null.

### 2. High-risk routes protected

| Route | Risk | Fix |
|-------|------|-----|
| `POST /api/compliance/verify` | Burns Anthropic AI credits on unauthenticated calls | ✅ Now requires valid JWT |
| `POST /api/notify/email` | Anyone could trigger emails to arbitrary user IDs | ✅ Now requires valid JWT |
| `POST /api/invoices` | Financial record creation | ✅ Now requires valid JWT |
| `GET /api/invoices` | Returned all 200 invoices regardless of caller (cross-tenant leak) | ✅ Now scoped to caller's agency/owner/client ID |

### 3. Frontend auth propagation
Added `src/lib/api.ts` (`authedFetch`) — client-side helper that reads the active Supabase session and attaches `Authorization: Bearer <token>` to every API call. Applied to:
- `agency/compliance/page.tsx` — AI verify call
- `agency/campaigns/[id]/page.tsx` — notify/email call
- `agency/marketplace/page.tsx` — notify/email call
- `owner/negotiations/[id]/page.tsx` — notify/email calls (3 call sites)
- `client/page.tsx` — notify/email call

---

## Remaining gaps (documented)

### API routes without auth checks

These routes use service-role key and accept any caller with valid UUIDs. The practical attack surface is low (UUIDs are unguessable without DB access), but they should be protected before a public launch:

| Route | Exposure |
|-------|----------|
| `GET/PATCH/DELETE /api/invoices/[id]` | Any caller who knows an invoice UUID can read/update it |
| `POST /api/invoices/[id]/pdf` | PDF generation for any known invoice ID |
| `POST /api/invoices/[id]/paystack` | Can initialise payment for any known invoice |
| `POST /api/invoices/[id]/erp-export` | Data export for any known invoice |
| `POST /api/invoices/compile` | Compiles invoices from any known MPI IDs |
| `GET/POST/PATCH /api/invoices/media-partner` | Creates/reads MPIs without auth |
| `POST /api/mpo-pdf`, `/api/contract-pdf`, `/api/media-plan-pdf` | PDF generation |
| `POST /api/poe-deck` | Compiles compliance photos for any campaign |
| `POST /api/campaign-brief` | Regex NLP — minimal risk, no DB write |
| `GET /api/location-intel` | Calls Overpass API + optional Anthropic — no auth |
| `POST /api/boards/[id]/enrich` | Enriches any board with location data |
| `POST /api/import-plan` | Processes uploaded CSV |

**Recommended fix:** Apply `requireAuth` to all of the above routes, and update their callers to use `authedFetch`.

### Intentionally public routes

| Route | Why public |
|-------|-----------|
| `POST /api/paystack/webhook` | Called by Paystack servers — verified by HMAC-SHA512 signature ✅ |
| `GET /api/paystack/callback/[id]` | Redirect URL after payment — no sensitive write |
| `POST /api/tracking` | QR scan events — designed to be unauthenticated |
| `GET /api/health` | Health check |
| `GET /api/invoice?bookingId=...` | Legacy PDF route — requires valid booking UUID |
| `GET /api/location-intel` | Read-only POI data — no write, Overpass API is the real limit |

### Storage policies not configured
Supabase Storage buckets (creative uploads, compliance photos) likely have no policies set, meaning authenticated users can read each other's files if they know the path. **Action:** Configure Storage bucket policies in Supabase Dashboard → Storage → Policies.

### `metadataBase` not set
In `src/app/layout.tsx` — OG image URLs fall back to `localhost` in production. Cosmetic only.

### API route caller identity
API routes use a module-level service-role client (set up at import time). This means route-level auth checks only block the request — they don't automatically scope DB queries. Each protected route must still add `.eq('agency_id', user.id)` filters as needed. The routes protected in Pillar 2 were audited for this.

---

## What is safe by design

- **No SQL injection** — all queries use Supabase SDK parameterized calls
- **No XSS** — React escapes all JSX output by default
- **HMAC verified webhook** — Paystack webhook rejects requests with invalid signatures
- **Secrets server-side only** — `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `PAYSTACK_SECRET_KEY`, `RESEND_API_KEY` are never in `NEXT_PUBLIC_*` and are not exposed to the browser
- **SSRF not possible** — `/api/location-intel` calls a hardcoded Overpass API URL, not user-supplied URLs
- **Compliance AI** — photo URLs passed to Claude are fetched from Supabase Storage (controlled domain), not arbitrary URLs from user input
- **RLS active** — direct Supabase queries from client are tenant-isolated

---

## Pre-launch security checklist

- [x] RLS policies active — `001_rls_policies.sql` run
- [x] Service-role key is server-side only
- [x] Paystack webhook HMAC verified
- [x] High-risk API routes require JWT (compliance/verify, notify/email, invoices)
- [ ] Remaining API routes — add `requireAuth` + `authedFetch` (see table above)
- [ ] Supabase Storage bucket policies — configure per-role read access
- [ ] Set `metadataBase` in `src/app/layout.tsx`
- [ ] Rate limiting on AI routes (`/api/compliance/verify`, `/api/location-intel`) — consider Upstash or Vercel Edge rate limiting
- [ ] Rotate all secret keys before go-live (Supabase service role, Paystack, Anthropic, Resend)
- [ ] Enable Supabase Auth email confirmation for production signups
