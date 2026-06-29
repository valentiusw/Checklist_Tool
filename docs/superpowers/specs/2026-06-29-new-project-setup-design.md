# Dedicated Project Setup / Edit Page — Design

**Date:** 2026-06-29
**Status:** Approved (design)

## Problem

Today, a project's per-unit inputs (the Choice / Float / Integer / Boolean
values that drive which checklist items apply) are edited inline in the
checklist screen via the `#inputs-panel` aside. This clutters the checklist and
forces the user to change inputs while trying to work through items. Creating a
project is also just a `prompt()` for a name, with no place to set up units or
their inputs up front.

## Goal

Add a dedicated page for **creating** and **editing** a project: set the project
name, add/remove units, and set each unit's input values — all in one place,
before working through the checklist. The checklist screen then shows inputs
**read-only**, eliminating the need to change inputs while checking items off.
Add an **Edit project** button to the checklist header alongside *Save project
file* and *Download ZIP*.

## Approach

Approach A (chosen): a new `editor` screen alongside the existing
`setup / dashboard / project / about` screens, using a **draft-copy** editing
model. All edits mutate an in-memory draft clone; **Save** commits via the
existing `projectStore.saveProject` (which already triggers the debounced
IndexedDB flush and file backup); **Cancel** discards the draft. The screen
reuses the existing input-control rendering, factored into a shared helper.

Rejected: a modal dialog (cramped with multiple units; user asked for a *page*),
and folding setup into the existing `setup` screen (that screen is for loading
the workbook / settings / backup).

## Screens & Navigation

A new screen `screen-editor` is added. It is **not** in the sidebar; it is
reached via buttons. While open, the sidebar highlights **Projects**
(`nav-dashboard`), the same way the checklist screen does. Add `editor` to the
`screens` list and to `NAV_FOR_SCREEN` in `app.js`.

| Trigger | Opens editor | On **Save** | On **Cancel** |
|---|---|---|---|
| Dashboard → **New project** | Blank: one empty unit, name field focused | Persist new project, open its **checklist** | Return to **dashboard** |
| Checklist header → **Edit project** | Pre-filled from the current project | Persist changes, return to **checklist** | Return to **checklist** |

- **New project** no longer uses `prompt()`. The existing guard remains: if
  `state.model` is null, alert "Load a checklist workbook in Setup first." and
  do not navigate.
- **Cancel** with unsaved edits → `confirm("Discard changes to this project?")`.
  If nothing was edited (`dirty === false`), leave immediately with no prompt.

## Editor Screen Layout

```
┌─────────────────────────────────────────────────────────┐
│  ← Cancel                              [ Save project ]   │
│                                                           │
│  Project name  [_____________________________]           │
│                                                           │
│  Units                                    [ + Add unit ]  │
│  ┌─────────────────────────────────────────────────┐     │
│  │ Unit name [____________]            [ Delete ]    │     │
│  │ ───────────────────────────────────────────────  │     │
│  │ <Label>          [ control ]   (per input def)    │     │
│  │ <Label (mm)>     [ number   ]                     │     │
│  │ <Choice label>   [ select ▾ ]                     │     │
│  │ <Boolean label>  [ ◻ toggle ]                     │     │
│  └─────────────────────────────────────────────────┘     │
│  ┌─────────────────────────────────────────────────┐     │
│  │ Unit name [____________]            [ Delete ]    │     │
│  │ ... same input controls ...                       │     │
│  └─────────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────┘
```

- Title row mirrors the checklist header: a ghost **← Cancel** on the left,
  **Save project** (`btn-primary`) on the right.
- **Project name**: a single text field, focused on a New project.
- **Units** section: each unit is a card (`.unit-edit-card`) containing a unit
  name field, a **Delete** button (disabled when only one unit remains, same
  rule as the current `btn-delete-unit`), and the full set of input controls
  built from `state.model.inputs`.
- **+ Add unit** appends a new card with default name `Unit N` and default input
  values.
- Input controls are the same Choice / Float / Integer / Boolean controls used
  today, extracted from `renderInputs` into a shared
  `buildInputControl(def, value, onChange)` helper so the editor and the
  checklist's read-only summary stay consistent.

## Data Flow & Draft Model

- **State:** add `state.editor = { draft, isNew, dirty }`. `draft` is a full
  project object `{ id, name, units[] }` — always a clone, never the stored
  copy.
  - **New:** `draft = { id: newId('p'), name: '', units: [newUnit('Unit 1')] }`,
    built in memory and **not** added to the store. `isNew = true`.
    (`newId`/`newUnit` are in `projectStore`; expose what is needed or build the
    draft via a small store helper.)
  - **Edit:** `draft = state.store.getProject(currentProjectId)` (already a
    clone). `isNew = false`.
- **Editing:** controls mutate `draft` in place — `draft.name`,
  `draft.units[i].name`, `draft.units[i].inputs[def.name]`. Any change sets
  `dirty = true`. Adding/deleting a unit mutates `draft.units` and re-renders.
- **Save:** validate (below); then `state.store.saveProject(draft)` — an upsert
  that works for both new and existing projects and triggers the existing
  `onStoreChange` → debounced IndexedDB flush + file backup. Clear
  `state.editor`, then navigate per the table above.
- **Cancel:** if `dirty`, confirm; on proceed (or if not dirty) clear
  `state.editor` and navigate. The store is untouched, so nothing is persisted.
- **Defaults:** new units get input defaults via the existing
  `defaultInputValue(def)`, which also assigns Choice inputs their proper
  default. (Fully fixing the separate "Choice default not working" bug noted in
  Context.txt is out of scope for this feature.)

## Checklist Screen Changes

- **Edit project button:** added to the existing header row in `index.html`, on
  the same line as `Save project file` and `Download ZIP`. Order:
  `[ Edit project ] [ Save project file ] [ Download ZIP ]`. Edit is a default
  button (not `btn-primary`) so Download ZIP remains the prominent action.
  Clicking it opens the editor pre-filled from the current project.
- **Inputs panel → read-only summary:** `#inputs-panel` no longer renders
  editable controls. `renderInputs` becomes `renderInputsSummary(unit)`, showing
  the current unit's input values as a compact, non-editable list:
  ```
  Inputs (read-only)
  Load (kg)          1000
  Door type          Centre
  Has machine room   No
  ```
  Includes a hint line: *"Edit project to change these."* Boolean values render
  as Yes/No; empty/unset values show as "—". The summary uses the input
  definition's label (and unit suffix) just like the editable panel did.
- **`updateInput` is removed** from the checklist path; inputs are no longer
  edited there.
- **Unit bar:** keep the **Unit selector** dropdown (to switch which unit is
  being checked off). Remove **Add unit / Rename / Delete unit** buttons and
  their handlers — unit management now lives in the editor.

## Validation (on Save)

- Project name required (trimmed non-empty); otherwise block Save and highlight
  the field.
- At least one unit; each unit name required (non-empty). Defaults to `Unit N`,
  so this rarely triggers.
- Number inputs: Integer coerced to whole numbers, Float to numbers, reusing the
  existing parsing in the control's change handler.

## Edge Cases

- **Changing inputs that hide checked items:** checks/comments are keyed by item
  ID and preserved regardless of applicability. If new inputs make a checked
  item inapplicable, its check is kept silently (it reappears if inputs change
  back). No destruction, no warning — matches today's behaviour.
- **Deleting a unit** in the editor: allowed down to the last unit (Delete
  disabled at one). Draft-only until Save.
- **Editing the currently-open unit:** after Save returns to the checklist,
  re-render so the read-only summary and items reflect the new inputs. If the
  open unit was deleted, fall back to `units[0]`.

## Testing

The project has a `tests/` folder. Add tests for the extractable logic:

- `buildInputControl` produces the correct control type and default per input
  type (Boolean → checkbox, Choice → select, Float/Integer → number).
- Draft → Save round-trips through `projectStore`: New creates a project; Edit
  updates name/units; units (inputs/checks/comments) are preserved.
- Read-only summary formatting: Boolean → Yes/No, empty/unset → "—", numeric and
  choice values pass through with label + unit suffix.
- Cancel-while-dirty does not mutate the store.

UI wiring (navigation, confirm-on-cancel) is covered by manual verification with
the browser smoke-test harness.

## Out of Scope

- The separate "Choice default not working" bug (beyond reusing
  `defaultInputValue`).
- The Context.txt idea of replacing per-unit checklists with a per-comment unit
  selector — a different restructuring, not part of this feature.
- Restyling beyond what is needed to make the editor and read-only summary fit
  the existing visual theme.
