# Checklist: 3-column layout restructure

**Date:** 2026-06-30
**Status:** Approved (ready for implementation plan)

## Problem

The checklist screen's right-hand detail panel and item list grew out of an
earlier rework. The current arrangement puts the project title/progress as a
full-width band *above* a two-column body, buries the inputs unit-selector
inside a collapsible "Inputs" box, and packs each list row with per-unit tag
chips, code tags, and notes. The user wants a cleaner three-column layout
(matching a provided mockup): a lean item list in the middle and a
well-organised detail panel on the right whose unit selector is always visible.

This is a **presentation/restructure change only**. No data-model or exporter
changes.

## Target layout

Three columns:

1. **Sidebar** (col 1) — the existing collapsible nav. Unchanged.
2. **Middle column** — two stacked cards:
   - **Project header card:** project name, progress bar + label, and the
     section filter + "hide checked" controls.
   - **Item list card:** the checklist.
3. **Right column — detail panel** — rises to the top of the page (the project
   header no longer spans over it). Three stacked boxes:
   - **Unit Selection** (always visible)
   - **Unit Details** (collapsible)
   - **Item editor**

The top toolbar (Back · Edit project · Save project file · Download ZIP) stays
full-width above the body.

The key structural move: the project title/progress/filter controls move *into*
the middle column so the detail panel starts at the very top of the right
column.

## Middle item list (simplified)

Each item row shows:

- a **tri-state checkbox** (unchanged semantics: checks/unchecks all of the
  item's applicable units; indeterminate when only some are checked),
- the text **"`ID` — `description`"**,
- the **example ⓘ button** when the item has an example file.

Rows stay **grouped under section headings with counts** (done = all applicable
units checked), as today. The section filter and "hide checked" toggle continue
to work.

**Removed from each row:** the unit-tag chips, the code tag, and the note.

Clicking a row — but not its checkbox or ⓘ button — opens that item in the
editor (default unit = the currently selected Unit-Selection unit, same
fallback logic as today).

The `checklistView` helpers (`itemApplicableUnits`, `itemCheckState`,
`unifiedItems`) remain in use for the tri-state checkbox and section counts.

## Right panel — three boxes

1. **Unit Selection** (always visible, top): the unit `<select>` listing all
   units in the project. Moved *out* of the collapsible body so the selected
   unit stays visible when Unit Details is collapsed. Drives Unit Details.
2. **Unit Details** (collapsible): the read-only spec values (label → formatted
   value) for the selected unit — today's "Inputs" readout, relabelled. Starts
   expanded; the header toggles collapse.
3. **Item editor** (lean): a placeholder ("Select an item…") until a row is
   clicked, then:
   - **checkbox + "`ID` — `description`"** on top (checkbox = the selected
     unit's check for this item),
   - the **note** beneath it, when present,
   - a **Unit Selection** dropdown listing the item's **applicable units**,
   - a large **Comments** box bound to the selected unit's comment.

   The example button is **not** duplicated here (it lives on the row). The
   code tag and the state-aware tag chips are not shown. Two-way sync with the
   list (check + comment) is unchanged.

## Removed vs kept

**Removed from view (not from data):**
- Unit-tag chips. Per-unit completion is now read by selecting a unit in the
  editor's Unit Selection dropdown and looking at its checkbox.
- Code tag on list rows.
- Note on list rows (the note moves to the editor).

**Kept / unchanged:**
- Tri-state "check all applicable units" behaviour and the `checklistView`
  helpers.
- Project-wide progress, section filter, "hide checked".
- The example image/PDF viewer (now only on the list row).
- Per-unit comments and checks; the editor's two-way sync.
- The on-disk data model and the Excel/ZIP export (`src/exporter.js`,
  `buildExportPlan`, `downloadProjectZip`) — untouched.

## Two unit selectors (as today)

There remain two independent unit selectors:
- the **top Unit Selection** drives which unit's read-only specs show in Unit
  Details (lists all units),
- the **editor Unit Selection** drives which unit a comment/check applies to
  (lists only the item's applicable units).

They are independent, as in the current implementation.

## Out of scope

- No exporter, workbook-model, project-editor (units carousel), or
  storage/backup changes.
- No change to how units are created or their inputs edited.
- The sidebar collapse behaviour already exists and is unchanged.
