# Pinned-only view + Archive projects — design

**Date:** 2026-07-21
**Status:** Approved (forks confirmed) — pending spec review

## Problem

The project page shows every project in one flat list sorted by recency. Two gaps:

1. **No way to view pinned projects only.** Pinning already exists (pin button per
   card, 5-pin cap, drag-reorderable pinned sidebar nav), but the main list can't be
   filtered down to pins.
2. **No way to retire completed projects.** Finished projects stay in the active list
   forever, cluttering it.

## Solution overview

One **segmented view filter** in the search row with three states — **Active**
(default) / **Pinned** / **Archived** — plus a new `archived` flag on projects and an
**Archive / Unarchive** action in the selected-project header bar. Archiving a project
auto-unpins it.

Decisions confirmed with the user:
- **One segmented filter** (not two separate toggles, not collapsible sections).
- **Archive action lives in the selected-project header bar** (`#dash-actions`), beside Delete.
- **Archiving auto-unpins** — an archived project leaves pins and the pinned sidebar.

## Data model (`src/projectStore.js`)

- Projects gain an optional boolean `archived` (absent/false = active), mirroring the
  existing `pinned` field. No migration needed — absence reads as active.
- `listProjects()` already projects `pinned`/`pinnedOrder`; add `archived: !!p.archived`
  to each summary.
- New `setArchived(id, archived)`:
  - When archiving: set `p.archived = true`, and **unpin** (`delete p.pinned;
    delete p.pinnedOrder;`) so it drops out of the pinned sidebar.
  - When unarchiving: `delete p.archived` (stays unpinned — user re-pins if wanted).
  - `notify('upsert', id)` — persists via the existing `onStoreChange` dirty-queue,
    exactly like `setPinned`. No new persistence plumbing.
- Export `setArchived` from the store's returned API.

`setPinned` gains a guard: **refuse to pin an archived project** (defensive — the pin
button won't render for archived cards, but keep the store honest).

## View filter (state + rendering, `src/app.js`)

- New UI state `state.projectView` = `'active' | 'pinned' | 'archived'`, default
  `'active'`. **Session-only** — resets to `'active'` on load / when leaving and
  returning to the dashboard (least surprising; "these are my active projects").
- `renderDashboard()` renders **all** projects into the list as today (each card keeps
  `data-*` attributes for name/pinned/archived), then filtering is applied by
  `applyProjectFilter()`.
- `applyProjectFilter()` (currently search-only) is extended to compose **view + search**:
  - Active view: card visible if `!archived` AND matches search terms.
  - Pinned view: card visible if `pinned` AND `!archived` AND matches search.
  - Archived view: card visible if `archived` AND matches search.
  - Card carries `data-archived` / `data-pinned` so the filter reads them without a
    store round-trip.
- Empty-state messaging (`#project-search-empty`, reused/extended):
  - Pinned view, none visible, no search: "No pinned projects yet."
  - Archived view, none visible, no search: "No archived projects."
  - Any view with a search that matches nothing: existing `No projects match "…"`.

### Segmented control markup

Added inside `#project-search-row`, before the search box:

```html
<div class="project-view-filter" role="tablist" aria-label="Filter projects">
  <button role="tab" data-view="active"   class="view-tab is-active" aria-selected="true">Active</button>
  <button role="tab" data-view="pinned"   class="view-tab" aria-selected="false">Pinned</button>
  <button role="tab" data-view="archived" class="view-tab" aria-selected="false">Archived</button>
</div>
```

- Clicking a tab sets `state.projectView`, updates `is-active`/`aria-selected`, and calls
  `applyProjectFilter()` (no full re-render needed).
- Styling: token-driven segmented control scoped under `[data-screen="dashboard"]`
  (reuse existing surface/border/accent tokens; active tab uses `--accent-soft` /
  `--accent`). Theme-aware, no hardcoded colors.

## Archive action (`#dash-actions`, `src/app.js` + `index.html`)

- Add an **Archive** icon-button to the selected-project header bar, between Export and
  Delete. A box-with-down-arrow archive glyph (thin-line, `currentColor`), Title-Case
  title/aria ("Archive Project").
- The button is **context-aware**: when the selected project is archived it becomes
  **Unarchive** (different title/aria, e.g. box-with-up-arrow). Determined in
  `selectProject()` / a small helper that reads the selected project's `archived` flag.
- Click → `state.store.setArchived(id, next)` → `renderDashboard()` (refreshes list,
  pinned sidebar, and clears selection). Archive is **non-destructive and reversible**,
  so **no confirmation dialog** (unlike Delete).
- Newly archived project: user stays on the Active view, so it visibly leaves the list —
  clear feedback that it was archived.

## Pin button on cards

- The per-card pin button is **not rendered on archived cards** (they can't be pinned).
  In Active/Pinned views only non-archived cards show, so this only matters in the
  Archived view — where pins are hidden.

## Sidebar

- The pinned sidebar nav is unchanged; because archived projects are auto-unpinned it
  naturally never lists them.

## Testing

- **Unit (`tests/projectStore.test.js`)**: `setArchived` sets/clears the flag;
  archiving unpins (clears `pinned`/`pinnedOrder`); `listProjects` surfaces `archived`;
  `setPinned` refuses an archived project.
- **Smoke (headless Edge / CDP)**: load sample checklist → create 3 projects → pin one →
  Pinned tab shows only it → archive another via header bar → it leaves Active view and
  the pinned sidebar → Archived tab shows it → Unarchive returns it to Active. Assert no
  console errors.

## Out of scope (YAGNI)

- Auto-suggesting archive at 100% progress.
- Persisting the selected view across reloads.
- Bulk archive / multi-select.
- A separate archived count badge.
