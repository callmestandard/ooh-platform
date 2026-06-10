# Usability Audit — OOH Platform

**Date:** 2026-06-10  
**Build:** ✅ Passes clean

---

## Fixes applied in Pillar 4

### 1. Shared component library — three new components

| Component | File | Purpose |
|-----------|------|---------|
| `ToastProvider` + `useToast` | `src/components/ui/Toast.tsx` | Global toast notifications — success (green), error (red), info (blue). Auto-dismisses after 3.5s. Stacks multiple toasts. |
| `ConfirmDialog` | `src/components/ui/ConfirmDialog.tsx` | Themed confirmation modal. `variant="danger"` shows red warning icon + red confirm button. Replaces native browser `confirm()`. |
| `Skeleton` / `SkeletonCard` / `SkeletonGrid` / `SkeletonTable` | `src/components/ui/Skeleton.tsx` | Animated pulsing skeleton loaders for cards, grids, and tables. |

### 2. ToastProvider wired into root layout

`src/app/layout.tsx` — `<ToastProvider>` wraps the entire app. Any page or component can now call `useToast()` to surface notifications without managing local toast state.

Pages can migrate from per-page custom toasts with a one-line change:
```ts
// before: const [toast, setToast] = useState(...)
// after:
const { success, error } = useToast();
success('Campaign created');
```

### 3. Native `confirm()` dialogs replaced

All four browser `confirm()` calls replaced with the styled `ConfirmDialog`:

| File | Action | Old pattern |
|------|--------|-------------|
| `agency/campaigns/page.tsx` | Delete campaign | `confirm('Delete this campaign?...')` |
| `agency/campaigns/[id]/page.tsx` | Remove board from plan | `confirm('Remove X from this plan?')` |
| `agency/campaigns/[id]/page.tsx` | Approve plan | `confirm('Mark this plan as approved?')` |
| `agency/invoices/[id]/page.tsx` | Cancel invoice | Inline `confirm()` in onClick handler |

### 4. Skeleton loaders on main dashboards

Three dashboards replaced raw spinner with layout-aware skeleton previews:
- `dashboard/agency/page.tsx` — 4-column metric grid + 5-row table skeleton
- `dashboard/owner/page.tsx` — 3-column metric grid + 5-row table skeleton
- `dashboard/client/page.tsx` — 2-card row + 4-row table skeleton

---

## Remaining gaps (documented)

### Per-page custom toast state

12+ pages still manage their own local toast state with `useState<{ msg, type } | null>(null)`. They all work correctly — migration to `useToast()` is a cosmetic improvement, not a bug fix. Each page can be migrated independently when touched.

### Skeleton loaders — not yet on all pages

Skeletons were added to the three main dashboards. These inner pages still show a raw spinner:
- Negotiations list, Campaigns list, Compliance page, Availability calendar, Reports, Rate Intelligence

### Onboarding tour not built

Each dashboard has a first-run empty state (already existed), but there is no guided step-by-step walkthrough for new users. An `OnboardingWizard` component exists at `src/components/onboarding/OnboardingWizard.tsx` but is not wired into any page.

### Audience filter on boards map non-functional

The "Audience" filter dropdown on the boards map (Youth / Professionals / Transit / Premium) depends on a `board_audience_profiles` table that does not exist. Selecting any non-default option shows 0 boards. Recommend: either remove the filter or compute scores from `/api/location-intel` and populate the table.

---

## Pre-launch usability checklist

- [x] Global toast system in layout
- [x] `confirm()` dialogs replaced with `ConfirmDialog`
- [x] Skeleton loaders on agency, owner, client dashboards
- [ ] Migrate remaining per-page toasts to `useToast()`
- [ ] Add skeleton loaders to negotiations, compliance, reports pages
- [ ] Fix or remove non-functional audience filter on boards map
- [ ] Wire `OnboardingWizard` for first-time users
