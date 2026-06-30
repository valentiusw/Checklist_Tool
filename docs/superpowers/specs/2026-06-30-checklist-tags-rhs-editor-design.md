# Checklist: unit tags + RHS editor panel

**Date:** 2026-06-30
**Status:** Approved (ready for implementation plan)

## Problem

When a project has several similar units, the checklist screen shows the same
items once per unit (you pick a unit from a dropdown to view its list). Doing the
checklist means re-checking and re-commenting the same items across every unit —
a lot of duplicated work ("double-ups").

We want to show each item **once**, use **tags** to indicate which units an item
applies to, and move per-unit detail (comment + check) into a dedicated editor on
the right-hand side of the screen.

## Hard constraint: the on-disk data model does not change

Per-unit storage stays exactly as it is today:

- `unit.inputs` — `{ inputName: value }` (the unit's specs)
- `unit.checks` — `{ itemId: boolean }`
- `unit.comments` — `{ itemId: string }`

`buildExportPlan` / `buildExportRows` (in `src/exporter.js`) and the ZIP/Excel
export read this per-unit data unchanged. **No exporter changes.** Everything new
in this spec is a *view* computed over that same data so the output Excel keeps
making sense (one sheet per unit, unchecked applicable items).

## Core concept: applicable-unit set

For a given item, its **applicable-unit set** is the set of units in the current
project whose `inputs` satisfy the item's condition:

```
applicableUnits(item, project) =
  project.units.filter(u => isApplicable(item.condition, u.inputs, model.inputDefs))
```

An item appears in the unified list if it is applicable to **at least one** unit.

## View semantics

### Main-list checkbox (tri-state)

Computed over the item's applicable-unit set:

- **all** applicable units have `checks[item.id] === true` → checked (✓)
- **none** are checked → unchecked
- **some** are checked → indeterminate

Click behaviour: if currently all-checked → set `checks[item.id] = false` for every
applicable unit; otherwise → set `checks[item.id] = true` for every applicable unit.

### Tags

One chip per applicable unit, labelled with the unit name and styled by that unit's
`checks[item.id]`:

- checked → filled / ✓ style
- pending → outline style

Clicking a chip opens the RHS item editor for that item with that unit selected in
the editor's unit dropdown.

### Section counts

An item counts as **done** for its section header when **all** of its applicable
units are checked. Total for a section = number of items applicable to ≥1 unit in
that section. (Counts computed from the full applicable list, independent of the
hide-checked view filter — same approach as today.)

### Progress bar

Project-wide, via the existing `computeProjectProgress(model, project)` (sum of
checked / applicable across all units). The current per-unit progress label is
replaced by this project-wide figure.

### Hide-checked toggle

Hides items that are **fully** checked (all applicable units checked). Section
filter behaves as today.

## Layout: project screen becomes two columns

**Left column — unified items list:**

- Grouped by section (headings + counts as today).
- Each row: tri-state checkbox, item id + description + code tag + note + example
  info button, and the unit tags.
- **No** per-item comment textarea (removed in Stage 3).
- **No** unit-select dropdown at the top of the screen (removed in Stage 3).
- The whole row is clickable to open the editor (clicking the checkbox itself still
  just toggles the check; clicking a tag opens the editor on that unit).

**Right column — docked panel** (stacks below the list on narrow screens):

1. **Inputs viewer** (top, collapsible):
   - Its own unit selector listing **all** units in the project.
   - Read-only display of the selected unit's input values (label, unit suffix,
     formatted value). Independent of the editor's unit dropdown.
2. **Item editor** (below):
   - Placeholder ("Select an item") until a row or tag is clicked.
   - Once open: item id, description, code, note, and example button (if any).
   - **Unit dropdown limited to the item's applicable units.**
   - For the selected unit: a checkbox bound to `checks[item.id]` and a comment
     textarea bound to `comments[item.id]`.
   - Changing the dropdown swaps the visible check + comment to that unit.
   - Edits sync live to the left-list row (tri-state checkbox + tag styling) and to
     the progress bar / section counts.

### Sync rules

- Toggling the main-list checkbox updates all applicable units; if the editor is
  open for that item, its currently-shown unit's checkbox updates accordingly.
- Toggling the editor's per-unit checkbox (or editing the comment) updates the
  underlying unit and re-renders the affected list row's tri-state checkbox and
  tags, plus progress.

## Staging

Each stage is independently shippable and leaves the app in a working state.

### Stage 1 — RHS scaffold + read-only inputs viewer

- Convert the project screen to a two-column layout (list left, docked panel right;
  stacks on narrow screens).
- Add the collapsible **inputs viewer** with its own unit selector and read-only
  spec values.
- The existing items list (per-unit, unit dropdown, comment boxes) is **untouched**.

*Acceptance:* specs display correctly per selected unit; collapse/expand works; the
existing list behaves exactly as before.

### Stage 2 — Item editor + click-to-open

- Add the **item editor** section beneath the inputs viewer.
- Clicking an item row opens the editor: unit dropdown (applicable units) +
  per-unit checkbox + per-unit comment.
- Two-way sync between the editor and the existing list for checks and comments.
- The existing per-unit list and its comment box **stay in place** so no
  functionality is lost yet.

*Acceptance:* clicking an item opens it in the editor; editing the comment/check in
the editor reflects in the list, and vice-versa.

### Stage 3 — Unify the list

- Replace the unit-select dropdown + per-unit rows with the single **tagged list**:
  state-aware clickable tags, tri-state "check all applicable units" checkbox.
- Redefine section counts (done = all applicable units checked), switch the
  progress bar to project-wide, redefine hide-checked (hide fully-checked).
- **Remove** the per-item comment textarea (comments now live only in the editor).
- Remove the unit-select dropdown from the project screen.

*Acceptance:* each item appears once; tags reflect per-unit state and are clickable;
checking from the list and from the editor stay in sync; the Excel/ZIP export is
unchanged.

## Out of scope

- No changes to the exporter, workbook model, project editor (units carousel), or
  storage/backup.
- No change to how units are created or their inputs edited (still done in the
  project editor).
