# Pinned Projects — Design

**Date:** 2026-07-02
**Status:** Approved (design)

## Goal

Let the user pin favorite projects so they're reachable from an expandable **Pinned**
section in the left sidebar, without hunting through the dashboard list. A pin toggle lives
on each dashboard project card. At most **5** projects may be pinned; attempting a 6th shows
an error.

## User-facing behavior

1. **Pin toggle on the card.** Each project card in the dashboard list (`#project-list`)
   gains a pin icon button in its `.btn-row`, to the left of the existing Quick Look (eye)
   button. Outline pin = not pinned; filled pin = pinned. Clicking toggles pin state and does
   not select or open the card.
2. **5-pin cap.** If the user tries to pin a project while 5 are already pinned, a blocking
   `alert('You can pin up to 5 projects. Unpin one first.')` fires and nothing changes.
   Unpinning is always allowed.
3. **Sidebar "Pinned" section.** A new expandable entry in `.side-nav`, positioned between
   **Projects** and **About**: a pin icon, the label "Pinned", and a chevron. Clicking toggles
   a dropdown sub-list of the pinned projects. Clicking a project row **opens** that project
   (same as double-clicking its card). The sub-list uses the dashboard's `updatedAt`-descending
   order and shows at most 5 rows.
4. **Empty / collapsed states.** When no projects are pinned, the entire "Pinned" nav item is
   hidden (no dead expander). Expand/collapse state persists across sessions (localStorage),
   defaulting to expanded. When the sidebar itself is collapsed (`sidebar-collapsed`), the
   dropdown is suppressed by existing CSS — only the icon shows, consistent with the other
   nav links.

## Data & persistence

- Add an optional `pinned: true` flag on the project object. Absent or falsy = not pinned.
- Persisted through the existing `saveProject` → IndexedDB path.
- **Library backup/restore preserves it:** `importLibrary` deep-clones raw projects, so the
  flag round-trips. Single-project **download** (`serializeProject`) intentionally omits it,
  so importing a shared single project starts unpinned.
- The 5-cap is **not** enforced on load — a restored backup is the user's own data. The cap is
  enforced only on the interactive pin action (see below). In the rare case a loaded library
  has >5 pinned, the sidebar simply shows the first 5 (by sort order); the user can unpin.

## Store API (`src/projectStore.js`)

New method:

```js
setPinned(id, pinned)
```

- Sets/clears `pinned` on the stored project **without** bumping `updatedAt` (so pinning does
  not reorder the dashboard).
- No-op if `id` is unknown.
- Calls `notify('upsert', id)` so subscribers re-render.
- The store performs **no** cap enforcement — that lives in `app.js` where an alert can fire.

`listProjects()` gains `pinned` in the returned summary objects so callers can render pin state
and build the sidebar list without a second `getProject` round-trip.

## Controller (`src/app.js`)

- **Card rendering** (`renderDashboard`): add the pin button to each card's `.btn-row`; set its
  filled/outline state from the summary's `pinned`. Wire a click handler that:
  - reads current pinned count from `state.store.listProjects()`;
  - if pinning and count already ≥ 5 → `alert(...)`, return;
  - else `state.store.setPinned(id, next)`, then `renderDashboard()` + `renderPinnedNav()`.
- **`renderPinnedNav()`**: rebuilds the sidebar sub-list from pinned summaries. Hides the whole
  "Pinned" nav item when none are pinned. Each row calls `openProject(id)`. Called from:
  dashboard render, project create/delete, pin toggle, library import, and initial screen load.
- **Expand/collapse**: a small toggle handler on the "Pinned" nav button that flips a class and
  persists the state under a localStorage key (in `try/catch`, matching `SIDEBAR_KEY`).

## Markup (`index.html`)

- Insert the "Pinned" nav item (button + chevron + empty `<ul>` container) into `.side-nav`
  between the Projects and About buttons.
- Pin-icon SVG defined once for cards (generated in `app.js` like the eye button) and once for
  the nav header.

## CSS (`styles.css`)

- Scope new rules to `.side-nav` / the pinned sub-list; reuse existing tokens (no hardcoded
  colors — dark-mode safe).
- Filled vs outline pin handled by toggling a class / the SVG `fill` between `none` and
  `currentColor`.
- Dropdown open/closed via a class on the "Pinned" item; hidden entirely when the sidebar is
  collapsed (piggyback on existing `sidebar-collapsed` rules).

## Testing

- **Unit** (`tests/projectStore.test.js`): `setPinned` sets and clears the flag; leaves
  `updatedAt` unchanged; is a no-op for unknown ids; `listProjects` surfaces `pinned`.
- **Smoke** (headless Edge over CDP): pin/unpin from a card flips the icon and the sidebar list;
  the 6th pin attempt alerts and is blocked; clicking a sidebar row opens the project;
  the "Pinned" item hides when nothing is pinned.

## Out of scope

- Reordering pinned projects (drag to rearrange). Order follows `updatedAt` desc.
- Pinning from the Quick Look card or the project screen. Toggle is dashboard-card only.
