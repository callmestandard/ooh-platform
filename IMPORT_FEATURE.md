# Bulk Board Importer — Feature Documentation

**Route:** `/dashboard/owner/import-boards`  
**Entry point:** also linked from `/dashboard/owner/post-board` via "Import many boards" button  
**Build:** ✅ Clean — 51 pages, TypeScript passes

---

## Overview

Allows an owner to bulk-list hundreds of boards from a spreadsheet in 4 guided steps instead of filling a form for each board individually.

---

## Flow — 4-Step Stepper

### Step 1 — Upload

- Accepts `.xlsx`, `.xls`, `.csv` via drag-and-drop or file picker
- File is POSTed to `/api/import-boards/parse` (server-side XLSX parsing via SheetJS)
- Server returns `{ headers, rows, total, truncated }` — hard cap of 1,000 rows enforced server-side
- A preview table shows the first 5 rows immediately after parse
- "Download blank template" link points to `/api/import-boards/template` — returns a two-sheet XLSX (Instructions + Boards) with 4 example rows, column widths, frozen header, and format reference

**Excel quirks handled:**
- Blank rows filtered out (`Object.values(row).some(v => trim !== '')`)
- Merged cells: XLSX `defval: ''` fills merged cell gaps with empty string
- Naira symbol `₦` stripped in rate parsing
- Comma thousands separators stripped
- Excel serial dates not applicable (owner import uses text rates, not dates)

---

### Step 2 — Map Columns

- Auto-detects likely field for each spreadsheet header using fuzzy hint matching
- Hint table covers 50+ common header variations (e.g. "Monthly Rate", "Tariff", "Fee" → `asking_rate`)
- User corrects any wrong mappings via dropdown — each field shows ✓ when mapped
- Required fields (Name, City, Format, Rate) gated — can't proceed without mapping all four
- Optional fields (Address, State, Width, Height, Latitude, Longitude, Notes) can be skipped

---

### Step 3 — Review + Geocoding

#### Validation (client-side, zero additional requests)

Per-row status:
- 🟢 **Ready** — all required fields present and valid
- 🟡 **Warning** — has fixable issues (unknown format, note-only problems) — included in import by default
- 🔴 **Skip** — missing name, city, or rate — excluded by default

**Format normalization:** 50+ aliases mapped to canonical enum values:
- `"Billboard"`, `"B/B"`, `"Board"` → `billboard`
- `"Uni-pole"`, `"Monopole"`, `"Single pole"` → `unipole`
- `"Gantry"`, `"Overhead"` → `gantry`
- `"Bridge Panel"`, `"Flyover"` → `bridge_panel`
- `"Wall Drape"`, `"Facade"`, `"Wall Banner"` → `wall_drape`
- `"LED"`, `"DOOH"`, `"Digital Billboard"` → `led`
- Unknown formats flagged as warning — inline-selectable in the review table

**Rate parsing:** handles messy strings:
- `"₦1.2m"` → 1,200,000
- `"850,000"` → 850,000
- `"1.5M"` → 1,500,000
- `"850k"` → 850,000
- Bare numbers → pass-through

#### Deduplication

**Within-file:** normalized name (lowercase, stripped punctuation) compared across all rows. Duplicate → flagged as warning, row highlighted amber, issue noted.

**Against existing boards:** owner's boards loaded from Supabase on page mount. Check:
1. If normalized names match AND both rows have lat/lng AND Haversine distance < 100m → flagged as likely duplicate
2. If normalized names match but no coords → flagged (user decides)

Duplicate rows are still selectable — the owner decides whether to include them.

#### Geocoding (runs in background during review)

- Rows missing `latitude`/`longitude` but with `address` or `city` are geocoded via Mapbox Geocoding API
- Query: `"${address}, ${city}, Nigeria"` with `country=ng&types=address,place,neighborhood`
- Rate-limited: 200ms between requests (5 req/sec) to stay within Mapbox free tier
- Runs concurrently with user reviewing — progress shown in the summary bar
- Geocoded rows flagged with `geocoded: true` → amber ring on map, "⚠ geo" label in table, post-publish warning message
- Geocoding can be aborted (when user navigates back) via `geocodeAbort` ref

#### Inline editing

Any cell in Name, City, Format, Rate columns is click-to-edit. Editing re-evaluates status in real-time. Format column uses a select dropdown with the 6 valid enum values.

---

### Step 4 — Preview Map + Publish

**Preview map:**
- Leaflet/OpenStreetMap (reuses existing react-leaflet setup)
- Plots all selected boards that have coordinates (blue pins = GPS, yellow ring = geocoded)
- `FitBounds` component auto-fits viewport to all pins
- Popup on each pin shows name, city, format, rate, geocode warning

**Publish:**
- `ConfirmDialog` with count and skip warning before proceeding
- Client sends batches of 50 rows to `POST /api/import-boards`
- Progress bar updates after each batch completes
- Server stamps `owner_id` from auth session (never trusts client-sent owner_id)
- Server sets `status: 'available'`, `face_count: 1`, `illuminated: false`
- Summary after completion: inserted count + skip report download

**Skip report:** downloadable CSV with columns Name, City, Format, Rate, Reason. Generated client-side from the rows that were not selected or had `status: 'skip'`.

---

## API Routes

### `POST /api/import-boards/parse`
- **Auth:** `requireAuth` — prevents abuse
- Accepts multipart FormData with `file` field
- Parses with SheetJS, filters blank rows, caps at 1,000
- Returns `{ headers: string[], rows: Record<string, unknown>[], total: number, truncated: boolean }`

### `POST /api/import-boards`
- **Auth:** `requireAuth` — mandatory
- Accepts `{ rows: InsertRow[] }` JSON body (batch of ≤50)
- Stamps `owner_id` from `user.id` (auth session) — client-sent `owner_id` ignored
- Inserts via service-role key (bypasses RLS safely, scoped to auth user)
- Returns `{ inserted: number }`

### `GET /api/import-boards/template`
- Public (no auth)
- Returns XLSX template with Instructions and Boards sheets
- 11 columns, 4 example rows, frozen header, column widths set

---

## Security / Guardrails

| Concern | How handled |
|---------|-------------|
| Auth bypass | `requireAuth` on both parse and insert routes |
| Owner ID spoofing | `owner_id` always set from `user.id` in API route, never from request body |
| Row count bomb | Hard cap of 1,000 rows in parse route |
| Duplicate data | Within-file and against-existing checks with Haversine proximity |
| Invalid formats | Normalized to enum — unknown formats flagged, not blindly inserted |
| Geocoding rate limit | 200ms delay between requests (5/sec) |
| Geocoding accuracy | All geocoded boards flagged with "verify pin" warning |

---

## Edge Cases Handled

- Blank rows in the middle of the spreadsheet (filtered)
- Merged cells (XLSX defval fills gaps)
- Naira symbol in rate column
- Comma-separated thousands
- Mixed-case format names (unipole / Unipole / UNI-POLE all map to `unipole`)
- Shorthand rates (1.2M, 850k, 1.5B)
- Missing lat/lng — geocoded from address + city
- Geocoded positions flagged for human review
- File larger than 1,000 rows — truncated with notice
- Multiple files — drop a new file to replace (state reset)
- User goes back mid-geocode — `geocodeAbort` ref halts the queue
- Duplicate rows within file — flagged, user decides whether to include
- Duplicate against existing inventory — flagged with existing board name
- All skipped rows — can't proceed to publish (button disabled)
