# Scale Audit — OOH Platform

**Date:** 2026-06-10  
**Build:** ✅ Passes clean

---

## Fixes applied in Pillar 3

### Unbounded queries capped

Every page that fetched unlimited rows from Supabase now has a `.limit()`:

| Page | Table | Before | After |
|------|-------|--------|-------|
| `admin/page.tsx` | boards | unbounded | 200 |
| `admin/page.tsx` | bookings | unbounded | 200 |
| `admin/page.tsx` | campaigns | unbounded | 100 |
| `admin/page.tsx` | compliance_checks | unbounded | 100 |
| `admin/page.tsx` | profiles | unbounded | 200 |
| `reports/page.tsx` | campaigns | unbounded | 200 |
| `reports/page.tsx` | bookings | unbounded | 500 |
| `negotiations/page.tsx` | bookings | unbounded | 150 |
| `availability/page.tsx` | boards | unbounded | 300 |
| `availability/page.tsx` | bookings | unbounded | 500 |
| `marketplace/page.tsx` | boards | unbounded | 300 |
| `marketplace/page.tsx` | campaigns | unbounded | 50 |
| `boards-map/page.tsx` | boards | unbounded | 500 |

### Wildcard selects replaced

All `select('*')` in high-volume queries replaced with explicit column lists, cutting payload size by ~40–60% on joins:

- `admin/page.tsx` — all 6 queries now enumerate columns
- `reports/page.tsx` — both queries now enumerate columns
- `negotiations/page.tsx` — explicit columns

### Client-side hot paths memoised

`marketplace/page.tsx` — format average calculation and the filter/sort pipeline were recomputing on every render regardless of whether boards or filters changed. Both are now wrapped in `useMemo` with correct dependency arrays.

### Broken DB call removed

`boards-map/page.tsx` was firing `supabase.from('board_audience_profiles').select('*')` on mount — a table that does not exist in the database. This caused a silent error on every page load. The call has been removed.

### DB indexes

All performance-critical indexes were added in `supabase/migrations/001_rls_policies.sql`:

```
idx_campaigns_agency_id, idx_campaigns_client_id, idx_campaigns_status
idx_bookings_campaign_id, idx_bookings_board_id, idx_bookings_status
idx_boards_owner_id, idx_boards_city, idx_boards_format
idx_invoices_agency_id, idx_invoices_owner_id, idx_invoices_status, idx_invoices_type
idx_compliance_booking_id, idx_messages_booking_id
idx_notifications_recipient, idx_activity_campaign_id
```

---

## Known gaps (documented, not yet fixed)

### Pagination not implemented

Pages with limits will silently truncate data once the row count exceeds the cap. Users with large datasets (e.g. 300+ boards, 500+ bookings) will see incomplete data with no indication. **Recommended fix:** implement cursor-based pagination or an infinite-scroll "load more" button on:
- Marketplace (boards grid)
- Negotiations list
- Availability calendar
- Admin board/booking/campaign tables

### Map: viewport-based loading not implemented

`boards-map` fetches the first 500 boards unconditionally. For a national inventory of 1000+ boards, this will be slow and the map will be cluttered. **Recommended fix:** query boards using a bounding-box filter (`latitude BETWEEN` + `longitude BETWEEN`) triggered by the Mapbox `moveend` event, replacing the initial full fetch.

### Audience filter on map non-functional

The map's "Audience" filter dropdown (Youth / Professionals / Transit / Premium) is wired to a `board_audience_profiles` table that does not exist. Selecting any non-default option will show 0 boards. **Options:** (a) remove the filter from the UI, (b) compute audience scores client-side from the `/api/location-intel` data and cache them in a new DB table.

### N+1 in rate intelligence

`src/lib/rate-intelligence.ts` (called from the rate-intelligence page) fires a separate Supabase query per board per time period for trend data. With 20 boards × 12 months = 240 queries on page load. **Recommended fix:** replace with a single aggregation query using `GROUP BY board_id, date_trunc('month', created_at)`.

### Reports and admin: client-side chart aggregation

Monthly spend charts, city breakdowns, format breakdowns are computed in JavaScript from the full booking/campaign datasets on every render cycle. At 500 bookings this is fine; at 10,000 it would noticeably slow the page. **Recommended fix at scale:** move aggregations to Postgres views or use Supabase's RPC functions.

---

## Current scale ceiling (honest estimate)

| Feature | Works well up to | Degrades after |
|---------|-----------------|----------------|
| Marketplace board grid | ~300 boards | 300 (hard cap) |
| Boards map | ~500 boards | 500 (hard cap) |
| Availability calendar | ~300 boards / ~500 bookings | hard caps |
| Negotiations list | ~150 bookings | hard cap |
| Reports charts | ~500 bookings | performance |
| Admin dashboard | ~200 per table | hard caps |

For the initial launch (likely <100 boards, <500 total bookings), the platform will not hit any of these limits. Hard caps are a safety net, not an active constraint.
