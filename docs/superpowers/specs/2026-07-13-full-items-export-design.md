# Full "All Items" Export — Design

Date: 2026-07-13

## Problem

The current Excel export lists only the **outstanding** (applicable-and-unchecked)
items per unit. Users also want a **complete** view: every checklist item, showing
which are done, which are outstanding, and which are not applicable to each unit —
with status conveyed visually so the sheet is scannable.

## Overview

Add a second export mode, **Full ("All Items")**, alongside the existing
**Outstanding** export. The export icon becomes a dropdown offering both. The full
export keeps the branded Overview + per-unit, discipline-grouped structure, but each
unit sheet lists every item with a per-unit status (Done / Outstanding / Not
Applicable) shown by a Status column and a row tint.

## Requirements

### Trigger (UI)
- The `dash-export` icon opens a small dropdown menu with two choices:
  **Outstanding Items** (current behaviour) and **All Items** (new).
- Reuses the existing popover-menu pattern (as used by the "+ New" menu).
- The same two-option choice applies anywhere export is triggered (`btn-download-zip`).
- Button labels are Title Case per repo convention.

### Full export content
- One sheet per unit, keeping the **discipline grouping** (from `model.sections` /
  `item.section`), items in checklist order within each group.
- Each unit sheet lists **every checklist item**, each carrying a per-unit **status**:
  - **Done** — applicable to this unit (condition matches its inputs) *and* checked
    → light-green row tint, Status text "Done".
  - **Outstanding** — applicable, not checked → plain (untinted) row, Status
    "Outstanding".
  - **Not Applicable** — condition does not match this unit's inputs → grey row,
    muted text, Status "N/A".
- **S-prefixed (Schindler internal) items ARE included** in the full export (it is the
  complete internal view). They appear with their computed status like any other item.
  (The outstanding export continues to exclude them.)
- Column order: `ID · Description · Code · Status · Comments · Example`.
  - Rationale: keeps the existing descriptive fields together, inserts Status before
    the reviewer's Comments. Row tint already provides at-a-glance scannability.
- Example-file cells remain blue underlined relative `Examples/…` hyperlinks; example
  files for **all shown rows** are bundled into the ZIP's `Examples/` folder.

### Overview sheet (full mode)
- Progress meters unchanged (still applicable-checked ratio per unit + overall).
- The "HOW TO USE THIS WORKBOOK" notes are reworded for full mode (the current text
  states it "lists only the OUTSTANDING items").
- A small **Status Key** legend is added showing the three tints:
  green = Done, plain = Outstanding, grey = Not Applicable.

### Naming
- Outstanding export unchanged: `<Project Title>_Compliance Review - Outstanding`.
- Full export: `<Project Title>_Compliance Review - Full` — shared by the ZIP, its
  top-level folder, and the workbook (same sanitising rule: keep spaces, strip only
  filename-illegal chars).
- Dates remain `DD/MM/YYYY`.

## Architecture / code shape

Keep the two modes DRY by parametrising the existing pure builders; the vendored
`XLSX` stays injected so `exportWorkbook.js` remains DOM-free and testable.

- **`src/exporter.js`**
  - `buildExportPlan(model, project, { mode = 'outstanding' } = {})`.
    - `mode: 'outstanding'` — unchanged behaviour (applicable, unchecked, S-items
      excluded; rows have no `status`).
    - `mode: 'full'` — include **all** items (including S-prefixed). Each row gains a
      `status` field: `'done' | 'outstanding' | 'na'`, computed per unit:
      applicable = condition matches unit inputs; done = applicable && checked;
      na = not applicable. Rows still carry `section` / `sectionPrefix`.
  - `referencedFiles` gathered from all rows present in the chosen mode.

- **`src/exportWorkbook.js`**
  - `buildExportWorkbook({ XLSX, model, project, plan, reviewDate, mode = 'outstanding' })`.
  - `buildUnitSheet` renders the extra **Status** column and applies row tints when
    `mode === 'full'`. Outstanding mode keeps the current 5-column layout untouched.
  - New palette constants for row tints: Done fill (light green), N/A fill (grey) +
    muted N/A text. Outstanding row = no tint.
  - Overview `NOTES` and the Status-Key legend switch on `mode`.

- **`src/app.js`**
  - `downloadProjectZip(project, mode = 'outstanding')` — threads `mode` into
    `buildExportPlan` / `buildExportWorkbook` and the base name.
  - Export dropdown wired on the `dash-export` icon (and `btn-download-zip`), reusing
    the popover-menu pattern; CSS scoped consistently with existing menus.

## Testing

- **`tests/exporter.test.js`** — extend:
  - Full mode assigns correct per-unit status (done / outstanding / na) across a
    multi-unit project where an item is applicable to one unit but not another.
  - Full mode includes S-prefixed items; outstanding mode still excludes them.
  - `referencedFiles` covers example files of all shown rows in full mode.
- **`tests/exportWorkbook.test.js`** — extend:
  - Full mode adds the Status column header and writes the Status text per row.
  - Row tint fills applied per status (done → green fill, na → grey fill, outstanding
    → none).
  - Outstanding mode output unchanged (regression guard).
- **Browser smoke run** — export dropdown appears, both options build a valid ZIP;
  full workbook shows statuses/tints (per repo's headless-Edge/CDP harness).

## Out of scope / non-goals

- No change to the outstanding export's content or layout.
- No embedded images/logos (vendored `xlsx-js-style` cannot embed images).
- No new "grid view in-app" — this is export-only.
- No special S-item marker beyond normal status (can be added later if wanted).
