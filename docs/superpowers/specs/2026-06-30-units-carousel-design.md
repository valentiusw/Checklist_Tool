# Units carousel — project editor

## Goal

On the project editor (new/edit project) page, replace the vertically-stacked
list of unit cards with a **carousel** that shows one unit at a time. This stops
the user from scrolling through many lines to add and edit units.

## Behavior

- Only the **current** unit's card is rendered at any time.
- A **"Unit X of Y"** counter sits, centered, under the "Units" heading.
- The card is flanked by two navigation buttons:
  - **Left arrow `‹` (previous):** moves to the previous unit. **Disabled /
    greyed out** when on the first unit.
  - **Right arrow `›` (next):** moves to the next unit. When on the **last**
    unit it renders instead as a **plus-in-circle `⊕`** button that adds a new
    blank unit and navigates to it (focusing its name field).
- A **red `✕`** in the top-right corner of the card deletes the current unit.
  - Confirms with the user (`confirm('Delete this unit?')`) before deleting.
  - **Disabled** when only one unit remains (a project always needs ≥1 unit).
- The previously-added standalone centered **"+ Add unit"** button is removed
  (adding is now handled by the right-arrow `⊕`).
- The old inline per-card **"Delete"** button next to the unit name is removed
  (deletion is now handled by the red `✕`).

## State

- `state.editor` gains a `unitIndex` field (default `0`) — the index of the
  unit currently shown.
- Navigation updates `unitIndex` and re-renders.
- **Add:** push a blank unit (`blankUnit(model)` / existing helper), set
  `unitIndex` to the new last index, re-render, focus the name field, mark dirty.
- **Delete:** after confirm, `splice` the unit, clamp `unitIndex` to
  `Math.min(unitIndex, units.length - 1)` (so deleting the last unit shows the
  new last unit), re-render, mark dirty.

## Components / files

- **`index.html`** — replace the `.editor-units-head` + `#editor-units` +
  `.editor-add-unit-row` block with the carousel structure: heading, counter
  element, and a row containing `‹ | #editor-units (card mount) | ›`.
- **`src/app.js`** — `renderEditor` renders only `units[unitIndex]`; update the
  counter; wire the prev/next/add/delete handlers; manage `unitIndex`. The
  `#btn-add-editor-unit` wiring in setup is removed/replaced.
- **`styles.css`** — carousel layout (flex row, arrows vertically centered),
  arrow button styling + disabled state, the `⊕` plus-in-circle, the red `✕`,
  and the counter.

## Out of scope

- Swipe / drag gestures, keyboard arrow-key navigation, animated transitions.
- Reordering units.
