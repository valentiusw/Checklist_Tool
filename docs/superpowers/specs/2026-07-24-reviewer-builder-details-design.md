# Reviewer & Builder details → Overview export

**Date:** 2026-07-24
**Status:** Approved (design)

## Problem

Projects capture per-unit checklist inputs but no project-level metadata about
**who reviewed it** or **who the builder is**. The Excel Overview sheet has blank
"Reviewed By" / "Contact" cells the reviewer fills in by hand after export, and no
builder information at all. The user wants to capture these once, in the app, and
have them flow onto the Overview sheet.

This also resolves the long-standing `Context.txt` note: "Client details section…
Add a card … when creating project … [NEED TO FIND WHAT FIELDS] … exported to the
first sheet of excel output."

## Scope

Six new **project-level**, optional free-text fields (distinct from the per-unit
grid inputs, which come from the checklist workbook and drive conditions):

- **Reviewer:** Name, Contact (Email)
- **Builder:** Name, Phone, Email, Approval No. (BUP/BDC/DEP)

Captured on the create/edit-project screen; surfaced on the export Overview sheet.
No effect on conditions, applicability, progress, or the per-unit sheets.

## Data model

A new project-level field `details` holding six strings (all default `''`):

```js
details: {
  reviewerName: '', reviewerContact: '',
  builderName: '', builderPhone: '', builderEmail: '', builderApprovalNo: '',
}
```

- **`src/projectDraft.js`**
  - `emptyDetails()` → the object above with all `''`.
  - `normalizeDetails(d)` → merges a partial/missing `d` onto `emptyDetails()`
    (ignores unknown keys, coerces values to string), so older projects and
    imported data get the full shape. Pure, unit-tested.
  - `newBlankDraft(model)` seeds `details: emptyDetails()`.
- **`src/projectStore.js`**
  - `saveProject` already `clone()`s the whole project, so `details` persists to
    IndexedDB automatically — **no change needed there**.
  - `serializeProject(project)` includes `details: normalizeDetails(project.details)`
    so the **connected-file backup** round-trips it.
  - The deserialize path (import / restore) sets `details: normalizeDetails(data.details)`.
  - Project load (`load`) defaults `details` via `normalizeDetails` when absent,
    so legacy stored projects gain the shape.
- **`validateDraft`**: unchanged — all six fields optional; nothing blocks saving.

## UI (create/edit project screen)

Static markup for a **Details** section placed between the Project-name field
(`#editor-project-name`) and the Units heading (`.editor-units-head`), with two
labeled sub-groups:

- **Reviewer** — Name, Contact (Email)
- **Builder** — Name, Phone, Email, Approval No. (BUP/BDC/DEP)

Six `<input>`s with stable ids:
`#editor-reviewer-name`, `#editor-reviewer-contact`, `#editor-builder-name`,
`#editor-builder-phone`, `#editor-builder-email`, `#editor-builder-approval`.

`renderEditor()` (in `app.js`) populates each from `draft.details` and wires
`oninput` → `draft.details.<field> = input.value; markEditorDirty()`, mirroring
the existing project-name wiring. `openEditor` guards `draft.details` (defaults via
`normalizeDetails`) so opening a legacy project doesn't throw.

- Field labels are **sentence case** (they are field labels, not buttons).
- CSS scoped under `[data-screen="editor"]`, token-driven (no hardcoded colors).
  Builder fields laid out two-per-row (responsive: stack on narrow widths) to stay
  compact; reuse existing `.editor-field`-style input styling where possible.

## Export (Overview sheet — `src/exportWorkbook.js`)

In `buildOverviewSheet`, read from `project.details` (via `normalizeDetails` for
safety):

- **PROJECT DETAILS** band (existing): "Reviewed By" → `reviewerName`,
  "Contact" → `reviewerContact`. When a field is **empty**, keep today's
  highlighted **"(to be completed)"** fillable cell (preserves the fill-in-Excel
  workflow); when non-empty, render the value as a normal (non-fillable) cell.
- **BUILDER DETAILS** band (new `sectionBand`), placed immediately after
  PROJECT DETAILS, with four `detail(label, value)` rows:
  Builder Name, Phone, Email, Approval No. (BUP/BDC/DEP). Empty builder fields
  render as a plain blank cell (informational, not "fill-in-later"). The band is
  always shown for a consistent layout.

No function-signature changes: `details` rides on the `project` object already
threaded through `buildExportWorkbook` → `buildOverviewSheet`. Applies to **both**
export modes (`outstanding` and `full`) since the Overview is shared.

## Files touched

- `src/projectDraft.js` — `emptyDetails`, `normalizeDetails`, seed `newBlankDraft`.
- `src/projectStore.js` — `serializeProject` + deserialize + `load` default `details`.
- `src/exportWorkbook.js` — Overview reviewer wiring + BUILDER DETAILS band.
- `index.html` — Details section markup on `#screen-editor`.
- `src/app.js` — populate + wire the six inputs in `renderEditor`; guard in `openEditor`.
- `styles.css` — `[data-screen="editor"]`-scoped Details section layout.
- `tests/projectDraft.test.js`, `tests/projectStore.test.js` — new assertions.

## Testing

**Unit tests** (`node --test`):
- `projectDraft.test.js`: `emptyDetails()` shape (six empty strings);
  `normalizeDetails` fills missing keys, drops unknown keys, coerces to string;
  `newBlankDraft(model).details` equals `emptyDetails()`.
- `projectStore.test.js`: `serializeProject` includes all six detail fields;
  a serialize → deserialize/import round-trip preserves them; loading a legacy
  project object (no `details`) yields the full empty shape.

**Export verification** (Node/XLSX harness — `exportWorkbook.js` has no committed
test today; verified via harness per repo convention, see the full-items-export
ledger entry): build a real workbook from a project with details filled, parse the
Overview sheet, and assert (a) the reviewer + builder values appear in Overview
cells, (b) an empty reviewer field still shows the "(to be completed)" placeholder,
(c) the BUILDER DETAILS band label is present.

**Smoke** (headless Edge over CDP): create a project, fill the six detail fields,
save, reopen the editor → values persisted; export and confirm the values land on
the Overview.

"Done" is backed by `npm test` + the export harness + a smoke run.

## Out of scope (YAGNI)

- Email/phone format validation (fields are free text).
- Splitting the approval number into type + value (single text field, per decision).
- Making any field required.
- Surfacing details anywhere other than the Overview sheet (e.g. per-unit sheets,
  the in-app project-details read view) — can be added later if wanted.
