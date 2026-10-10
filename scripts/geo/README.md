# Market-intelligence geo pipeline

Offline, re-runnable pipeline that turns named public datasets into the
per-state, per-LGA and per-hexagon figures behind the Market Intel map.

**The rule:** every figure is computed here, deterministically, from a named
dataset. Nothing is estimated, smoothed, rounded or filled in, and no language
model produces or touches a number. Missing data stays missing.

## Run it

Node 24+ (the steps import `src/lib/geo/segments.ts` directly, which needs
Node's built-in TypeScript support). From the repo root:

```bash
node scripts/geo/01-download.mjs      # ~2.3 GB of rasters; resumes if interrupted
node scripts/geo/02-boundaries.mjs    # LGA/state polygons, areas, simplified map files
node scripts/geo/03-population.mjs    # WorldPop → LGA, state, H3 r9/r8/r7 (several minutes)
node scripts/geo/04-pois.mjs          # OpenStreetMap places (add --refresh to re-query Overpass)
node scripts/geo/05-dhs.mjs           # DHS wealth fifths by state (add --refresh to re-query)
node scripts/geo/06-nightlights.mjs   # night-time lights per LGA (needs ~13 GB free while it runs)
node scripts/geo/07-segments.mjs      # join everything, percentile ranks, affluence index, segments
node scripts/geo/08-tiles.mjs         # static vector tiles for the hexagon layers
node scripts/geo/09-load.mjs          # write to Supabase (run migration 038 first)
node scripts/geo/10-catchments.mjs    # population cells + board catchments (run migration 039 first)
```

Raw downloads land in `scripts/geo/data/`, computed outputs in
`scripts/geo/out/` (both gitignored). Steps 2 and 8 also write the files the
app serves: `public/geo/ng-lga.geojson`, `public/geo/ng-state.geojson`,
`public/geo/h3-meta.json` and `public/geo/h3/{z}/{x}/{y}.pbf`.

Step 9 needs `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in
`.env.local`, and `supabase/migrations/038_geo_market_intelligence.sql` applied.

## Sources

The full registry — version, reference year, licence, method, limitation and
attribution for each — is `datasets.mjs`, loaded into `geo_datasets`.

| Used for | Dataset | Licence |
|---|---|---|
| Population by age | WorldPop Nigeria 2020, constrained, 100 m, age-sex | CC BY 4.0 |
| Boundaries | OCHA COD-AB Nigeria (774 LGAs, 37 states) | CC BY-IGO 3.0 |
| Places | OpenStreetMap via Overpass | ODbL 1.0 |
| State wealth fifths | Nigeria DHS 2023-24 via the DHS Program API | Citation required |
| Night-time lights | NPP-VIIRS-like NTL V2, 2024 (Harvard Dataverse) | CC0 1.0 |
| *Not used* | Meta Relative Wealth Index | CC BY-NC 4.0 — non-commercial |

Decisions worth knowing:

- **Relative Wealth Index is excluded.** Its HDX page lists CC BY-NC 4.0. The
  `rwi_*` columns exist and stay NULL; the affluence index is built without it.
- **Night-time lights** use the CC0 NPP-VIIRS-like product because the
  standard EOG VIIRS annual files need a login.
- **Population** uses WorldPop's top-down constrained 2020 release. The
  bottom-up WorldPop/NPC release was not evaluated.
- **DHS** uses published state aggregates from the public API. No microdata.

## Methods

- **Pixel → area.** LGA polygons are scanline-rasterised onto each source
  grid; a pixel belongs to the LGA containing its centre and is never split.
  States are sums of their LGAs. Populated pixels that fall in no LGA polygon
  (coast and border slivers) are reported in `out/pop_summary.json` as
  `unassigned` and are not reassigned.
- **Pixel → H3.** Each populated pixel is added to the resolution-9 cell
  containing its centre; resolutions 8 and 7 are sums of their children.
- **Age bands.** `0-14`, `15-24`, `25-34`, `35+` are sums of WorldPop's
  5-year groups (both sexes) and add up to the total exactly.
- **Places.** See the header of `04-pois.mjs` for tags and the duplicate rule.
- **Segments.** Defined once in `src/lib/geo/segments.ts` and used by both
  step 7 and the app's weights panel. Thresholds and rule text are written to
  `geo_segment_rules`.

## Board catchments

Step 10 loads the 2.2 million resolution-9 cells into the narrow `geo_pop_r9`
table and has the database compute `board_catchments`: modelled residents
within 1, 2 and 5 km of each board, by age band. A cell counts when its centre
is within the radius. A trigger from migration 039 recomputes a board's rows
whenever its coordinates change. The step ends by checking the database
against the local file at five fixed points.

These are residents from a population model. They are not reach, impressions
or traffic, and no UI text may describe them that way.

## Ask the map

`node scripts/geo/test-ask.mjs` runs the answer engine (`src/lib/geo/ask-core.ts`)
with a scripted stand-in for the model. It needs no API key and proves that
unsupported questions are refused before any model call and that an answer
containing a figure no lookup returned is rejected and never shown. The live
feature needs `ANTHROPIC_API_KEY` on the server and migration 040 for its
audit log.

## Tiles

The hexagon layers are static Mapbox Vector Tiles cut with `geojson-vt`
(tippecanoe does not run on Windows): zoom 8 holds H3 resolution 7, over-zoomed
beyond that. Resolution 8 is computed but not tiled by default (about 70 MB
per zoom level). The map never queries per-cell data.
