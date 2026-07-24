# Excel-style grid editor for creating/editing projects

**Date:** 2026-07-24
**Status:** Approved (design)

## Problem

The project editor (`#screen-editor`) uses a **carousel**: one unit at a time as a
card, navigated with prev/next arrows and position dots. For projects with many
units this is slow — you can't see units side by side and every unit is a
separate screen. The user wants a **spreadsheet grid**: one row per unit, one
column per checklist input, add rows to add units, so large projects are fast to
enter (including pasting a block straight from Excel).

## Scope

Confined to the **editor screen**. The data model is unchanged — a draft is still
`{ id, name, units: [{ id, name, inputs: {...}, checks, comments }] }` and
`projectStore` / `validateDraft` are untouched. What changes: how units are
rendered and edited, plus a new pure module for the grid's typed-value/paste
logic.

The carousel is **replaced entirely** (not a toggle). Single-unit projects simply
show a one-row grid.

## Architecture

### New pure module — `src/unitGrid.js` (DOM-free, unit-tested)

Keeps the fiddly logic out of `app.js` and testable under Node, matching the
repo's "pure logic in `src/`" convention.

- **`coerceInputValue(def, rawString)`** — map a pasted/typed string to the
  correct typed value for an input def:
  - `Boolean`: `yes/true/1/y/✓` (case-insensitive) → `true`; `no/false/0/n` or
    blank → `false`.
  - `Choice`: matched case-insensitively against `def.choices`; returns the
    canonical choice on match.
  - `Integer` / `Float`: parsed via `Number`; `Integer` rounded. Empty string →
    `''` (allowed today).
  - **Unrecognized / unparseable → returns a sentinel meaning "leave unchanged"**
    (e.g. `undefined`), so a bad paste cell never clobbers an existing value.
- **`parseClipboardMatrix(text)`** — split clipboard text into a 2-D array: rows
  by `\r\n` / `\n` (trailing blank line dropped), cells by `\t`.
- **`applyPasteMatrix({ units, model, startRow, startCol, matrix, makeUnit })`** —
  spill `matrix` into `units` beginning at `(startRow, startCol)`:
  - column `0` is the **unit name** (verbatim string); columns `1..n` map to
    `model.inputs[col-1]` via `coerceInputValue` (skipping cells that coerce to
    the "unchanged" sentinel).
  - rows past the last existing unit **create new units** (via injected
    `makeUnit`, = `newDraftUnit`), so paste is DOM-free and testable.
  - columns past the last input are ignored.
  - returns the updated `units` array.

### DOM glue — `src/app.js`

`renderEditor` keeps the project-name field and Save/Cancel row; its unit section
is rewritten as `renderUnitGrid()` building a `<table class="unit-grid">`:

```
#editor-grid-wrap            (overflow:auto scroll container)
  <table class="unit-grid">
    <thead>                  (sticky top)
      <th class="corner">Unit</th>        (sticky top+left)
      <th> per input: `${def.label}${def.unit ? ` (${def.unit})` : ''}`
    <tbody>
      <tr> per unit:
        <td class="rowhead"> × delete + unit-name <input>   (sticky left)
        <td> per input: buildInputControl(def, unit.inputs[name], onChange)
      <tr class="ghost">     (faint empty materializing row)
<button> + Add Unit
```

Removed: `unitIndex`, `navDir`, prev/next arrows, position dots, `unit-enter-*`
animations, `renderEditor`'s carousel branch, `prevEditorUnit`, `nextEditorUnit`,
and the carousel-specific icons/CSS.

## Interaction

**Cell controls** — every cell holds a live native control (reusing
`buildInputControl`): number input (Integer/Float), `<select>` (Choice), checkbox
(Boolean). No click-to-edit step, so keyboard nav and paste work directly.

**Freeze panes** — `thead` cells `position: sticky; top:0`; `.rowhead` /
`.corner` `position: sticky; left:0` (corner both). Sticky cells get an **opaque
surface-token background** so scrolled content doesn't bleed through. Input
columns scroll horizontally under the frozen header + Unit column. All grid CSS
scoped under `[data-screen="editor"]`, token-driven (no hardcoded colors — dark
mode safe).

**Ghost row** — one faint empty `<tr class="ghost">` pinned at the bottom.
Editing any cell in it materializes it into a real unit (`newDraftUnit`, value
written in) and spawns a fresh ghost. The **`+ Add Unit`** button remains too
(appends a blank unit, focuses its name cell).

**Delete row** — a small `×` in each `.rowhead` (matching today's
`unit-delete-x`), disabled when only one real unit remains, guarded by the
existing `confirm('Delete this unit?')`.

**Keyboard navigation** (committed, conflict-free set):
- **Tab / Shift+Tab** → next/previous cell, wrapping across rows; Tab off the
  last real cell enters the ghost row (creating a unit).
- **Enter / Shift+Enter** → down/up one cell in the same column.
- **Arrow keys** → move between cells for checkbox and select cells; inside
  number/text inputs arrows stay native (caret / step). Arrow-nav out of a
  half-typed number cell is intentionally *not* promised (fragile).

**Paste** — a `paste` listener on the grid: `preventDefault`, read
`clipboardData.getData('text')` → `parseClipboardMatrix` → `applyPasteMatrix`
from the focused cell's `(row, col)` → re-render, keeping the block selected.
A 20×5 Excel block fills/creates 20 units in one action.

**Validation** — `validateDraft` is unchanged. On save, an empty unit name adds
an error class to that row's name cell and scrolls it into view; the existing
name-required message still applies to the project name.

## Files touched

- `index.html` — replace the `.unit-carousel` markup with `#editor-grid-wrap` +
  `+ Add Unit` button.
- `src/app.js` — `renderUnitGrid()`, keyboard + paste handlers, ghost-row
  materialization, delete; remove carousel plumbing.
- `src/unitGrid.js` — **new** pure module (above).
- `src/projectDraft.js` — unchanged (reuses `newDraftUnit`, `defaultInputValue`).
- `styles.css` — `.unit-grid` layout + freeze panes + ghost row, scoped to
  `[data-screen="editor"]`; remove dead carousel CSS.
- `tests/unitGrid.test.js` — **new**.

## Testing

**Unit tests** (`tests/unitGrid.test.js`, `node --test`):
- `coerceInputValue` — Boolean synonyms both ways; Choice case-insensitive match +
  no-match → unchanged; Integer rounding / Float parse; empty string; garbage →
  unchanged sentinel.
- `parseClipboardMatrix` — CRLF & LF, tab columns, trailing newline dropped,
  single cell.
- `applyPasteMatrix` — spill within bounds; spill past last row creates units;
  overflow columns ignored; name column verbatim; typed columns coerced; skipped
  (unchanged) cells preserve existing values.

**Smoke test** (headless Edge over CDP — see `browser-smoke-test-harness`
memory): fresh project → type names + inputs → paste a TSV block and confirm rows
created → scroll horizontally and confirm Unit column + header stay frozen →
delete a row → save → reopen and confirm persistence.

"Done" is backed by `npm test` + a smoke run.

## Out of scope (YAGNI)

- Column resize / reorder / hide.
- Multi-cell drag-select and fill-handle drag.
- Undo/redo.
- CSV import of a whole project (paste covers the need).
