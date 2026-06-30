# Resizable checklist / detail cards (draggable splitter)

**Date:** 2026-06-30
**Status:** Approved (ready for implementation plan)

## Problem

On the project screen the two cards — Checklist (`.checklist-main`) and Detail
panel (`#detail-panel`) — have fixed relative widths (detail = 350px, checklist
fills the rest). The user wants to **resize** them with a draggable splitter,
where making one card thinner makes the other wider (a classic split-pane /
window-divider interaction). They also want the Checklist card's scrollbar
hidden (while keeping scroll).

This is a **UI interaction + presentation change**. No data-model, exporter, or
render-logic changes.

## Target behavior

### Draggable splitter

- A thin **vertical splitter** sits in the gap between the two cards on the
  project screen.
- Dragging it left/right **trades width** between the cards: as one narrows the
  other widens, and together they always fill the available row width.
- The splitter shows a `col-resize` (↔) cursor and a **slim bar that highlights
  on hover** (and while dragging). No dots/grip.
- **Min widths:** neither card can be dragged below ~280px, so neither collapses.
- **Persistence:** the chosen detail-card width is saved to `localStorage` and
  restored on reload (consistent with how theme and sidebar state persist).
- **Scope:** only on desktop (≥901px, where the cards are side by side). On the
  ≤900px stacked layout the splitter is hidden and cards are full-width, as today.

### Mechanism

- The detail card's width is driven by a CSS custom property, e.g.
  `--detail-w` (default `350px`). `#detail-panel` uses `flex: 0 0 var(--detail-w)`
  (and `width: var(--detail-w)`); the checklist card keeps `flex: 1`.
- A pointer-drag handler in `src/app.js` updates `--detail-w` on the project
  screen container during a drag, clamped to
  `[MIN, containerWidth - MIN - gap]` (MIN ≈ 280px). It uses Pointer Events with
  pointer capture so the drag continues smoothly outside the handle.
- On pointer release, the resolved width is written to `localStorage`
  (key e.g. `dpchecklist.detailWidth`). On load / when the project screen renders,
  the stored value is read back and applied to `--detail-w`.
- The clamp is re-applied whenever the value is set, so a stored value that is
  too large for the current window is brought back into range.

### Scrollbar

- On the Checklist card's scroll region (`#items-list`), hide the visible
  scrollbar while keeping scroll: `scrollbar-width: none` (Firefox) and
  `#items-list::-webkit-scrollbar { display: none }` (Chromium/Edge). Wheel /
  trackpad scrolling still works. `overflow-y: auto` stays.
- The Detail card keeps its scrollbar (unchanged).

## Files

- **`index.html`** — add a splitter element between the two cards inside
  `.project-body` (e.g. `<div id="card-splitter" class="card-splitter"
  role="separator" aria-orientation="vertical"></div>`).
- **`styles.css`** — splitter styling (slim bar, hover/active highlight,
  `col-resize` cursor), the `--detail-w`-driven widths, the hidden checklist
  scrollbar, and responsive rules to hide the splitter / drop the fixed width at
  ≤900px (stacked).
- **`src/app.js`** — the pointer-drag handler, clamp logic, `localStorage`
  read/write, and restoring the stored width when the project screen renders.

## Constants

- `MIN_CARD_WIDTH` ≈ 280px (both cards).
- Default detail width: 350px (today's value).
- localStorage key: `dpchecklist.detailWidth`.

## Kept / unchanged

- All rendering logic, the `checklistView` helpers, tri-state behavior, per-unit
  comments/checks, the example viewer.
- The on-disk data model and the Excel/ZIP export.
- The app-like two-bubble layout and independent scrolling (this only makes the
  split adjustable and hides the left scrollbar).
- The ≤900px stacked fallback.

## Out of scope

- No resizing of the sidebar (it already has its own collapse).
- No vertical (height) resizing.
- No double-click-to-reset (YAGNI unless requested later).
