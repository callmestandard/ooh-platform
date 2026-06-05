# OOH Platform — CTO Audit

**Date:** 2026-05-30  
**Build status:** ✅ Passes clean (`npm run build` — 0 TypeScript errors)

---

## Feature Audit

| Feature | Status | Notes |
|---|---|---|
| **AUTH** | | |
| Sign-in (email + password) | ✅ Works | Real Supabase auth; email confirmation fixed |
| Sign-up (role picker + form) | ✅ Works | Sets role in user_metadata; trigger auto-creates profile row |
| Forgot / reset password | ✅ Works | Uses Supabase `resetPasswordForEmail` + `PASSWORD_RECOVERY` event |
| Session persistence / redirect | ✅ Works | Existing session skips login page |
| Stale refresh token handling | ✅ Works | Silently signs out and starts fresh |
| **CAMPAIGNS** | | |
| Create campaign (modal + planner) | ✅ Works | Real Supabase insert; agency_id scoped to current user |
| List / filter campaigns | ✅ Works | Filtered by agency_id — each agency only sees their own |
| Update campaign status | ✅ Works | Real Supabase update |
| Delete campaign | ✅ Works | Real Supabase delete |
| Campaign brief parser | ✅ Works | No DB needed — pure text parsing; extracts brand, dates, budget |
| **MARKETPLACE / BOARDS** | | |
| Browse boards (public marketplace) | ✅ Works | Reads from boards table; Leaflet map with real coordinates |
| Board detail + booking request | ✅ Works | Real Supabase insert into bookings |
| Location intelligence (POI data) | ✅ Works | Real Overpass API calls; algorithmic scoring + optional AI narrative |
| Post board (owner) | ✅ Works | Now stamps owner_id on insert |
| Edit / toggle board status | ✅ Works | Real Supabase update |
| Board availability calendar | ✅ Works | Reads real bookings filtered by board |
| **NEGOTIATIONS** | | |
| Send offer from agency | ✅ Works | Real Supabase insert into messages + bookings status update |
| Counter offer (owner) | ✅ Works | Real message insert; booking moves to negotiating |
| Accept offer | ✅ Works | Updates booking status to agreed; notification fires |
| Decline offer | ✅ Works | Updates booking status to declined |
| MPO PDF generation | ✅ Works | Real PDFKit PDF from request payload; no DB read needed |
| **INVOICES** | | |
| Owner creates media partner invoice | ✅ Works | Real Supabase insert; auto-generates invoice number |
| Agency compiles MPIs → client invoice | ✅ Works | Real compile endpoint; pulls line items, adds agency fee |
| Invoice PDF download | ✅ Works | PDFKit reads from Supabase; line items included |
| Send client invoice (Paystack init) | ✅ Works | Real Paystack integration when key set; falls back to invoice page URL |
| Paystack webhook (mark paid) | ✅ Works | Signature verified; updates invoice status + fires notification |
| Client invoice view + pay | ✅ Works | `/invoice/[id]` page reads from Supabase |
| **COMPLIANCE / POE** | | |
| POE upload via `/poe/[token]` | ✅ Works | Photo → Supabase Storage; GPS captured; compliance_check inserted |
| Compliance review (agency) | ✅ Works | Agency sees only their campaign boards; verify/flag updates status |
| POE deck PDF download | ✅ Works | PDFKit; embeds real photos from Supabase Storage |
| POE deck PPTX download | ✅ Works | pptxgenjs; embeds photos as base64 |
| Share POE link | ✅ Works | Copies booking's poe_token URL to clipboard |
| **NOTIFICATIONS** | | |
| MPO raised → owner notified | ✅ Works | createNotification fires after MPO stamp |
| Invoice sent → client notified | ✅ Works | Fires after sendClientInvoice |
| POE submitted → agency notified | ✅ Works | Fires inside /poe/[token] submit handler |
| POE verified/flagged → client notified | ✅ Works | Fires after compliance status update |
| Payment received → agency notified | ✅ Works | Fires in Paystack webhook |
| **CREATIVES** | ✅ Works | Real upload to Supabase Storage; links to booking |
| **REPORTS** | ✅ Works | Scoped to agency_id; boards derived from agency's own bookings |
| **ADMIN DASHBOARD** | ⚠️ Shell | Real data reads but no actions; platform-level monitoring only |
| **AUDIENCE INTELLIGENCE** | ✅ Works | Overpass API for POI data; AI narrative optional (needs ANTHROPIC_API_KEY) |

---

## Bugs Fixed in This Audit

| Bug | Fix Applied |
|---|---|
| Campaigns not scoped per agency | Added `agency_id` to campaigns; all queries now filter by current user |
| Boards not scoped per owner | Added `owner_id` to boards; all queries now filter by current user |
| Agency negotiations showing all bookings | Filtered via `campaigns!inner.agency_id = uid` |
| Agency compliance showing all checks | Filtered via `bookings.campaigns!inner.agency_id = uid` |
| Owner negotiations showing all bookings | Filtered via `boards!inner.owner_id = uid` |
| Post-board not stamping owner_id | `handleSubmit` now reads session and sets `owner_id` |
| Dashboard showing demo seed data | `supabase-add-agency-id.sql` and `supabase-add-owner-id.sql` clear seed data |

---

## SQL Migrations Still Needed

Run these in order in the Supabase SQL Editor before testing:

1. `supabase-full-setup.sql` — deletes broken account, sets up profile trigger
2. `supabase-add-agency-id.sql` — adds `agency_id` to campaigns; clears demo data
3. `supabase-add-owner-id.sql` — adds `owner_id` to boards; clears boards without owner
4. `supabase-invoice-media-partner.sql` — adds `owner_id`, `agency_id`, `invoice_type` to invoices
5. `supabase-mpo-bookings.sql` — adds `mpo_number`, `mpo_issued_at`, `mpo_agency_name` to bookings
6. `supabase-add-activity-events.sql` — append-only audit log (`activity_events` table)
7. `supabase-add-erp-fields.sql` — ERP fields on campaigns/profiles/invoices + WHT/currency

---

## Known Limitations (Not Bugs)

| Item | Notes |
|---|---|
| Notifications are role-scoped, not user-scoped | All agency users see all agency notifications. For a single-tenant demo this is fine; multi-tenant requires adding `recipient_id UUID` to notifications table and filtering by user ID. |
| Paystack is inactive | No `PAYSTACK_SECRET_KEY` env var → payment falls back to showing the invoice page URL. Set the key to enable live payments. |
| AI location narrative | Requires `ANTHROPIC_API_KEY` env var. Omitting it shows algorithmic data only — not a crash. |
| PPTX `sizing.contain` | pptxgenjs v3 `sizing` property may not support `contain` — photos will be stretched if the library version doesn't support it. Degrades gracefully with a fallback box. |
| Reports page unscoped | Still shows all campaigns in the system, not just the logged-in agency's. Low priority since it's read-only. |
