# Reliability Audit — Full Report

**Date:** 2026-06-10  
**Build:** ✅ `npm run build` passes — 0 errors, 0 warnings (excluding cosmetic metadataBase notice)

---

## Step 1 — Inventory: Real vs. Mock/Shell

| Page / Route | Status | Notes |
|---|---|---|
| `dashboard/agency` | ✅ Real | Fetches campaigns, bookings, invoices by agency_id |
| `dashboard/agency/campaigns` | ✅ Real | Uses `getCampaigns(uid)` lib — properly scoped |
| `dashboard/agency/campaigns/[id]` | ✅ Real | Fetches campaign, bookings, compliance, creatives |
| `dashboard/agency/marketplace` | ✅ Real | Loads real boards; creates real bookings |
| `dashboard/agency/negotiations` | ✅ Real | Fetches bookings scoped by agency via campaigns join |
| `dashboard/agency/negotiations/[id]` | ✅ Real | Supabase realtime subscriptions wired; status updates write to DB |
| `dashboard/agency/invoices` | ✅ Real | Lists real invoices; compilation and payment status updates work |
| `dashboard/agency/invoices/[id]` | ✅ Real | Invoice detail, ERP export, PDF download, Paystack integration |
| `dashboard/agency/compliance` | ✅ Real | POE submission writes to DB; AI verification calls Anthropic |
| `dashboard/agency/reports` | ✅ Real | All charts derived from real bookings/campaigns data |
| `dashboard/agency/audience` | ⚠️ Estimated | Boards come from Supabase. Traffic/CPM/demographics are **calculated estimates** from Nigerian OOH industry benchmarks — NOT real sensor/survey data. Footnote discloses this. |
| `dashboard/agency/rate-intelligence` | ✅ Real | Aggregates agreed rates from closed bookings; shows "no data" when empty |
| `dashboard/agency/availability` | ✅ Real | Timeline/calendar built from real boards + bookings |
| `dashboard/agency/boards-map` | ✅ Real | Mapbox map with real board coordinates from Supabase |
| `dashboard/agency/campaign-planner` | ✅ Real | AI brief parser → real board search → creates real campaign + bookings |
| `dashboard/agency/creatives` | ✅ Real | Fetches creative_uploads from Supabase |
| `dashboard/client` | ✅ Real | Campaign list, compliance timeline, billing tab |
| `dashboard/owner` | ✅ Real | Boards, bookings, messages, invoices — all Supabase |
| `dashboard/owner/negotiations` | ✅ Real | Bookings scoped by board owner_id |
| `dashboard/owner/negotiations/[id]` | ✅ Real | Realtime messages; counter/accept/decline writes to DB |
| `dashboard/owner/invoices/[id]` | ✅ Real | Media-partner invoice detail |
| `dashboard/owner/post-board` | ✅ Real | Writes to boards table |
| `dashboard/admin` | ✅ Real | Sees all boards, bookings, campaigns, compliance, profiles |
| `dashboard/settings` | ✅ Real | Reads/writes profiles table |
| `marketplace` | ✅ Real | Public board listing from Supabase |
| `boards/[id]` | ✅ Real | Board detail from Supabase |
| `poe/[token]` | ✅ Real | Token-gated compliance upload; GPS + photo saved to DB |
| `poe-deck` | ✅ Real | Fetches real compliance photos + campaign data; generates PDF/PPTX |
| `invoice/[id]` | ✅ Real | Public invoice view; Paystack pay button |
| `report/[id]` | ✅ Real | Impression estimates use format constants (no real sensor data) but campaign/booking/compliance data is real |
| `t/[code]` | ✅ Real | QR tracking link — creates tracking_events in DB |

### API Routes

| Route | Status | Notes |
|---|---|---|
| `POST /api/campaign-brief` | ⚠️ Regex NLP | Parses brief with regex, NOT AI. Works reliably; returns confidence score and warnings |
| `POST /api/compliance/verify` | ✅ Real AI | Calls `claude-haiku-4-5` with photo URL; writes ai_verdict to DB |
| `POST /api/invoices` | ✅ Real | Creates invoice + line items from campaign bookings |
| `GET /api/invoices` | ✅ Real | Lists invoices (service role, limited to 200 rows) |
| `GET/PUT /api/invoices/[id]` | ✅ Real | Invoice CRUD + status updates |
| `POST /api/invoices/[id]/pdf` | ✅ Real | Generates PDF from real invoice data |
| `POST /api/invoices/[id]/paystack` | ✅ Real | Creates Paystack payment link |
| `POST /api/invoices/[id]/erp-export` | ✅ Real | Generates CSV/JSON for ERP |
| `POST /api/invoices/compile` | ✅ Real | Compiles media-partner invoices from bookings |
| `POST /api/invoices/media-partner` | ✅ Real | Creates owner-side invoice |
| `POST /api/poe-deck` | ✅ Real | Fetches compliance photos + campaign data; generates PPTX/PDF |
| `POST /api/mpo-pdf` | ✅ Real | Generates MPO document from booking data |
| `POST /api/contract-pdf` | ✅ Real | Generates contract PDF from booking data |
| `POST /api/media-plan-pdf` | ✅ Real | Media plan PDF with real board/campaign data |
| `POST /api/location-intel` | ✅ Real | Calls external location API |
| `POST /api/boards/[id]/enrich` | ✅ Real | Enriches board with location data |
| `POST /api/import-plan` | ✅ Real | Fuzzy-matches uploaded CSV rows to real boards |
| `POST /api/plan-template` | ✅ Real | Generates downloadable plan template |
| `POST /api/notify/email` | ✅ Real | Resend email notifications |
| `POST /api/paystack/webhook` | ✅ Real | Handles payment confirmation from Paystack |
| `GET /api/paystack/callback/[invoiceId]` | ✅ Real | Verifies payment and updates invoice status |
| `POST /api/tracking` | ✅ Real | Logs scan events; returns click stats |
| `GET /api/health` | ✅ Real | DB ping + env var check |

---

## Step 2 — Golden Path Trace

### 1. Campaign creation + AI brief parse
**Status: Works** — `/api/campaign-brief` uses regex NLP (not LLM). Extracts client, budget, dates, cities, formats from plain text. Saves result to DB via campaign-planner page. Confirmed no Anthropic call here.

### 2. Marketplace filter + shortlist + add to plan
**Status: Works** — Marketplace fetches real boards, filters by status/city/format. Board availability during campaign window checked via bookings query. Shortlist stored in localStorage. "Add to plan" creates real booking in Supabase.

### 3. Budget bar
**Status: Works** — Campaign planner calculates total from bookings summed against `total_budget`. Updates live as boards are added/removed.

### 4. Negotiation flow (offer → counter → accept → status update)
**Status: Works** — Messages write to `messages` table; `supabase.channel()` subscription propagates in realtime to both sides. Status updates write to `bookings.status`. Both agency and owner pages subscribe to the same channel.

### 5. ARCON module
**Status: Works (UI-complete)** — `campaigns/[id]` has an `arcon` tab. Saves `arcon_status`, `arcon_ref`, `arcon_approved_at`, `arcon_expiry_date` to the `campaigns` table. Pre-launch gate checks `arcon_status === 'approved'` before allowing campaign activation.

### 6. Creative upload
**Status: Works** — `CreativeUploadPanel` uploads files to Supabase Storage, writes record to `creative_uploads` table. Status flows from `uploaded` → `approved` / `changes_requested`.

### 7. POE upload via `/poe/[token]`
**Status: Works** — Token validated against booking `poe_token`. Photo + GPS saved to `compliance_checks`. AI verification triggered on submit.

### 8. Compliance verify / flag
**Status: Works** — `POST /api/compliance/verify` calls Claude Haiku with the photo URL. GPS distance computed. Writes `ai_verdict`, `ai_confidence`, `ai_notes` back to `compliance_checks`. Agency can then manually override to `verified` or `flagged`.

### 9. MPO → PDF → owner invoice
**Status: Works** — Raise MPO from agency negotiations detail → writes `mpo_number` to booking → owner notified via `/api/notify/email` → `/api/mpo-pdf` generates PDF → owner creates media-partner invoice via `/api/invoices/media-partner`.

### 10. Agency invoice compile → client invoice
**Status: Works** — `/api/invoices/compile` aggregates bookings into one invoice. Client invoice includes agency fee and VAT calculation. Client sees invoice in billing tab at `/dashboard/client`.

### 11. Client Oracle reference entry
**Status: Works** — Client can enter PO/Oracle reference number in invoice view; saved to `invoices.client_invoice_number`. Agency notified via email.

### 12. POE deck + white-label report
**Status: Works** — `poe-deck` page calls `/api/poe-deck` which fetches compliance photos and generates downloadable PPTX/PDF. `/report/[id]` generates white-label PDF with real campaign data.

---

## Step 3 — Reliability Fixes Applied

### Critical data leaks (fixed in previous session)
| Fix | File |
|-----|------|
| Client campaigns: removed unauthenticated "fetch all" fallback | `dashboard/client/page.tsx` |
| Owner invoices: added `.eq('owner_id', uid)` filter | `dashboard/owner/page.tsx` |
| Owner messages: scoped to booking IDs owned by this owner | `dashboard/owner/page.tsx` |
| Agency invoices: added `.eq('agency_id', uid)` filter | `dashboard/agency/page.tsx` |

### Error handling added (this session)
All pages below now have: `const [fetchError, setFetchError] = useState<string|null>(null)`, full `try/catch/finally` in fetch functions, `setLoading(false)` guaranteed in `finally`, and error render with retry button.

| Page | What was missing |
|------|-----------------|
| `agency/negotiations/page.tsx` | Only `console.error`, no error state |
| `agency/negotiations/[id]/page.tsx` | No try/catch in fetchBooking/fetchMessages |
| `agency/compliance/page.tsx` | No try/catch; upload failure was silent |
| `agency/campaigns/[id]/page.tsx` | No try/catch; parallel queries collapsed into single try |
| `agency/reports/page.tsx` | No try/catch; fake monthly spend fallback removed |
| `agency/availability/page.tsx` | No try/catch |
| `agency/audience/page.tsx` | No try/catch in fetchBoards |
| `owner/negotiations/page.tsx` | No try/catch |
| `owner/negotiations/[id]/page.tsx` | No try/catch in fetchBooking/fetchMessages |
| `dashboard/admin/page.tsx` | No try/catch in fetchAll |

### Fake/seeded data removed
| Location | What it was | Fix |
|----------|-------------|-----|
| `reports/page.tsx` L107–111 | Monthly spend chart was seeded with `Math.sin()`-based fake values when no booking data existed | Removed — chart now shows real 0-value bars, guiding user to make bookings |

### Unbounded queries capped
| Query | Limit added |
|-------|------------|
| `GET /api/invoices` | 200 rows |
| `owner/page.tsx` boards | 200 rows |
| `owner/page.tsx` bookings | 100 rows |
| `client/page.tsx` campaigns | 50 rows |

---

## Step 4 — Build

```
✓ Compiled successfully in 16.7s
✓ TypeScript passed
✓ 47 pages generated — 0 errors
⚠ metadataBase not set (cosmetic — affects OG image URLs only)
```

---

## Step 5 — Honest Assessment: Works / Fixed / Still Broken

| Feature | Status | Notes |
|---------|--------|-------|
| Auth (login/signup/reset) | ✅ Works | Supabase Auth |
| Campaign creation | ✅ Works | |
| AI brief parser | ⚠️ Regex, not AI | Works reliably but it's regex NLP, not LLM |
| Marketplace + board discovery | ✅ Works | |
| Budget bar calculation | ✅ Works | |
| Negotiation messaging | ✅ Works | Supabase realtime confirmed |
| Booking status flow | ✅ Works | pending → negotiating → agreed → signed → live → complete |
| ARCON permit tracking | ✅ Works | UI-complete; saves to DB |
| Creative upload | ✅ Works | Supabase Storage |
| POE upload (token link) | ✅ Works | GPS + photo → DB |
| AI compliance verification | ✅ Works | Real Claude Haiku call |
| MPO PDF generation | ✅ Works | |
| Contract PDF | ✅ Works | |
| Client invoice + VAT | ✅ Works | |
| Owner media-partner invoice | ✅ Works | |
| Paystack payment | ✅ Works | Webhook + callback handler confirmed |
| ERP export | ✅ Works | CSV/JSON |
| POE deck (PPTX/PDF) | ✅ Works | |
| White-label report | ✅ Works | |
| QR tracking | ✅ Works | |
| Rate intelligence | ✅ Works | Shows "no data" when empty; builds from real closed deals |
| Audience intelligence | ⚠️ Estimated data | Boards real; traffic/CPM/demographics are industry-benchmark estimates |
| Reports | ✅ Works | Monthly spend shows 0 when no bookings (no longer seeded) |
| Availability calendar/timeline | ✅ Works | |
| Admin dashboard | ✅ Works | Sees full platform data |
| RLS policies | ⚠️ Pending manual step | `supabase/migrations/001_rls_policies.sql` must be run in Supabase SQL Editor |
| API route auth | ⚠️ Service role | API routes use service-role key (bypasses RLS). Code-level filters are the mitigation until `@supabase/ssr` is added |
| metadataBase | ⚠️ Not set | OG image URLs fall back to localhost — cosmetic for production |

### Known gaps / recommended follow-ups
1. **Run `supabase/migrations/001_rls_policies.sql`** before launch — RLS is NOT active until this SQL runs.
2. **Set `metadataBase`** in `src/app/layout.tsx` for correct OG image URLs.
3. **API route security** — consider adding `@supabase/ssr` and forwarding user JWT to service-role calls, or adding token validation middleware.
4. **Audience data** — consider integrating a real Nigerian traffic data source (LASG, Google Maps Places API) to replace benchmark estimates.
5. **Brief parser** — could upgrade to Anthropic API call for better extraction if regex misses edge cases.
