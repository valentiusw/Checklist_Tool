# Smart Checklist — Sections, Multi-unit Projects, About page, Red theme

**Date:** 2026-06-24
**Status:** Approved (design), pending implementation plan

Builds on the existing Smart Checklist tool (static HTML + dependency-free ES
modules in `src/`, SheetJS vendored in `vendor/`, Node `--test` suite in `tests/`).
This spec adds four capabilities and re-themes the UI.

## Goals

1. Group/filter checklist items by **section**, derived from the Item ID letter
   prefix, and show readable section names.
2. Support **parent projects containing multiple units**, each unit with its own
   name, inputs, checks, and comments.
3. Add an **About / Info page** listing section names and a code/acronym glossary.
4. Re-theme accents to **red**, while keeping "completion" signals (checked items,
   progress bar) **green**.

Non-goals: no change to the condition grammar/engine; no server/back-end; tool
stays fully offline.

## 1. Workbook format — two new optional sheets

Both sheets are **optional**. Workbooks without them continue to load unchanged.

### Sheet `Sections`
Maps an Item ID letter prefix to a display name.

| Prefix | Name |
|--------|------|
| A | Architectural |
| B | Structural |
| C | Electrical |

### Sheet `Glossary`
Powers the About page.

| Term | Meaning |
|------|---------|
| EN81-20 | EN 81-20 lift safety standard |
| BCA | Building Code of Australia |

### Model changes (`src/workbookModel.js`)
- A **section prefix** is the leading alphabetic characters of an Item ID
  (`A08` → `A`, `EL01` → `EL`). Items with no leading letters get prefix `""`.
- Each item gains a `section` field = the resolved section name. Resolution:
  look up the prefix in the `Sections` map; if absent, fall back to the bare
  prefix string (e.g. `"A"`). Empty prefix → section name `"Other"`.
- `buildModel` returns two new fields:
  - `sections`: ordered array of `{ prefix, name }` actually present among the
    loaded items (so the filter dropdown and About page only list real sections),
    ordered by first appearance in the checklist.
  - `glossary`: array of `{ term, meaning }` from the `Glossary` sheet (empty if
    the sheet is absent).
- Sheet parsing is tolerant: a missing optional sheet yields an empty
  map/array, not an error. Required sheets (`Checklist`, `Inputs`) keep their
  current strict validation.
- `app.js` `restoreModel`/`persistModel` must round-trip `sections` and
  `glossary` so a reloaded model still has them without re-importing the xlsx.

### Sample workbook (`SampleChecklist.xlsx`)
- Add a `Sections` sheet (at least A=Architectural, B=Structural, C=Electrical;
  may include more, e.g. M=Mechanical, F=Fire).
- Add a few `B` and `C` items so section filtering is demonstrable.
- Add a `Glossary` sheet with sample meanings for codes already used (AS3000,
  EN81-20, BCA, DDA, SL, RDM) plus any new codes. These are sample definitions
  the user edits in Excel.

## 2. Section filter in the checklist

Pure view logic in `app.js` + CSS; no data-model impact.

- A **Section** dropdown sits above the items list. First option `All sections`
  (default), then one option per entry in `model.sections`.
- Items render **grouped** under a section heading (the section name). With a
  specific section selected, only that group renders.
- Grouping respects the existing applicability filter (only applicable items
  show) and ordering.

## 3. Multi-unit (parent) projects

### Data model
A stored project becomes:

```js
{
  id: string,
  name: string,
  updatedAt: ISOString,
  units: [
    { id: string, name: string, inputs: {}, checks: {}, comments: {} }
  ]
}
```

`createProject(name)` creates a project with one default unit (e.g. `"Unit 1"`).
Unit ids are generated like project ids.

### Migration (lazy, on read) — `src/projectStore.js`
- `getProject` upgrades any legacy flat project (`{ inputs, checks, comments }`
  with no `units`) into `{ units: [{ id, name: "Unit 1", inputs, checks,
  comments }] }` before returning it. Upgraded projects are persisted on next
  save (no destructive rewrite required on read).
- `importProject` accepts **both** shapes: legacy flat JSON is wrapped into a
  single unit; new JSON with `units` is imported as-is (new ids assigned).
- `serializeProject` writes the new `units` shape.

### Project view (`app.js`)
- A **unit selector dropdown** chooses the active unit.
- Controls: **Add unit**, **Rename unit**, **Delete unit** (deleting the last
  unit is prevented or recreates a default unit).
- Inputs panel and items list render for the **active unit**.
- Progress bar shows the **active unit's** progress; the **project overall**
  progress (summed checked / summed applicable across all units) is shown
  alongside as a label.

### Dashboard (`app.js`)
- Each project card shows: project name, **unit count**, and **aggregate
  progress** (summed across units).

### Export (`src/exporter.js` + `app.js`)
- One workbook, **one worksheet per unit**.
- Worksheet name = unit name, sanitized to Excel rules (≤31 chars, strip
  `[]:*?/\`), de-duplicated if two units share a name.
- Each sheet uses the agreed column order: **Item ID, Description, Code,
  Comments, Example**, listing that unit's applicable unchecked items.
- A helper (e.g. `buildExportRows(model, unit)`) stays unit-scoped; `app.js`
  iterates units to assemble the multi-sheet workbook.

## 4. About / Info page

- A third top-bar nav button **About**, and a new `screen-about` section.
- Renders two tables from the model:
  - **Sections** — prefix → name (from `model.sections`).
  - **Glossary** — term → meaning (from `model.glossary`).
- If both are empty (workbook had neither sheet, or none loaded), show a
  friendly note ("This workbook has no reference info — add `Sections` and
  `Glossary` sheets to populate this page.").

## 5. Red theme (green retained for completion)

`styles.css` token changes:
- `--accent` becomes red; a new `--success` (the current green) is added.
- **Red** (`--accent`): primary buttons, header logo mark, focus rings, links,
  primary actions.
- **Green** (`--success`): `.item.checked` highlight, checklist item checkboxes,
  and the **progress bar** fill.
- Danger/delete styling stays distinct from the red accent (or is acceptably
  red — delete remains visually a destructive action).

## Testing

Extend the Node `--test` suite:
- `workbookModel`: section prefix extraction (single/multi-letter, none),
  section-name fallback when `Sections` missing, `sections` list reflects only
  present sections, `glossary` parsed from sheet, optional sheets absent → empty.
- `projectStore`: legacy flat project migrates to units on read; `importProject`
  accepts both shapes; `serializeProject` round-trips units.
- `exporter`: per-unit export rows use the new column order and exclude checked
  items; aggregate progress sums correctly across units.

UI wiring (filter dropdown, unit selector, About page, theme) verified with a
headless browser screenshot pass, as in the previous UI work.

## Out of scope / explicit decisions

- Section prefix is leading letters only; no per-item manual section override.
- No nesting beyond project → units (units are flat).
- Glossary/Sections live in the workbook (user-maintained), not hardcoded.
