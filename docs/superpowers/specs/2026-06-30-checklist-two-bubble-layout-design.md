# Checklist: two-bubble, app-like project screen

**Date:** 2026-06-30
**Status:** Approved (ready for implementation plan)

## Problem

On the project screen the checklist and the detail panel share one scrolling
page, and the right panel is three separate floating cards. The user wants the
two areas visually "detached" into **two rounded bubbles side by side** — the
checklist in one (wider) and the whole detail panel in one (narrower) — that
scroll independently like an app, with a gap between them.

This is a **presentation/layout change only**. No data-model, exporter, or
list/editor logic changes.

## Target layout

The project screen, below its existing full-width toolbar (Back · Edit project ·
Save project file · Download ZIP):

- A two-pane region holding **two rounded bubbles** with a gap between them.
- **Left bubble — Checklist (wider):** takes the remaining width. Inside:
  - the project header (title, progress bar + label, Section filter, Hide
    checked) **pinned** at the top of the bubble;
  - the **item list scrolls** independently beneath the pinned header.
- **Right bubble — Detail panel (narrower, ~340–360px):** a single bubble whose
  contents are Unit Selection, Unit Details (collapsible), and the Item editor,
  flattened into **one** bubble (thin dividers between the three, not three
  separate floating cards). The bubble's content scrolls independently.

### Bubbles

Each bubble is a rounded card — border + surface background + soft shadow —
reusing the existing card/panel styling tokens so it is theme-aware (correct in
dark mode). Widths are asymmetric: the checklist bubble flexes to fill, the
detail bubble stays ~340–360px.

### Flat interiors

- **List rows** lose their individual outlined boxes; rows are separated by thin
  dividers inside the checklist bubble (matching the flattened right bubble).
  Row content is unchanged (tri-state checkbox + "ID — description" + example
  ⓘ).
- **Right bubble sections** (Unit Selection / Unit Details / Item editor) lose
  their individual card borders/backgrounds; thin dividers separate them within
  the one bubble. The Unit Details collapse toggle still works.

### Scrolling (app-like)

The project area fills the viewport height. Each bubble scrolls independently —
the checklist's list and the detail bubble's content each have their own scroll,
and the page/window itself does not scroll on this screen.

### Responsive

On narrow screens (the existing ≤900px breakpoint) the layout falls back to
today's stacked behavior: the detail bubble stacks below the checklist and the
page scrolls normally — no fixed-height trap on mobile.

### Scoping

The fixed-height / independent-scroll / bubble treatment applies **only to the
project screen**. The active screen is marked with a `data-screen` attribute set
in the existing `showScreen()` function, and all new CSS is scoped to
`[data-screen="project"]`. Dashboard, Setup, Editor, and About keep their normal
full-page scrolling and styling. The outer `.screen` card is neutralized on the
project screen (no border/background/shadow/max-width) so the two bubbles stand
on their own against the page background, and the toolbar sits above them.

## What changes

- **`styles.css`** — the bulk: viewport-height project screen scoped via
  `[data-screen="project"]`; the two bubble cards; pinned checklist header +
  scrolling list; flat rows with dividers; flattened right-bubble sections with
  dividers; independent overflow regions; the ≤900px stacked fallback; neutralize
  `.screen` on the project screen.
- **`src/app.js`** — one line in `showScreen()` to set the `data-screen`
  marker (e.g. on `document.documentElement`).
- **`index.html`** — only if needed to give the bubbles/scroll regions the right
  wrapper elements; element ids are preserved.

## Kept / unchanged

- All rendering logic (`renderItems`, `renderItemEditor`, `renderInputsViewer`,
  `renderProgress`), the `checklistView` helpers, tri-state behavior, per-unit
  comments/checks, the example viewer.
- The on-disk data model and the Excel/ZIP export (`src/exporter.js`).
- All other screens (Dashboard, Setup, Editor, About).
- The collapsible sidebar.

## Out of scope

- No changes to item content, the editor's fields, or how units/inputs are
  edited.
- No new screens or navigation.
