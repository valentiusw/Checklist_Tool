# Smart Checklist Tool — Design Spec

**Date:** 2026-06-23
**Status:** Approved (design), pending implementation plan

## 1. Purpose

A self-contained, static HTML tool that turns a compliance checklist (currently
maintained in Excel) into a **smart, dynamic checklist**. For a given project,
only the checklist items whose conditions are met by the project's inputs are
shown. The user tracks multiple project drafts with progress bars and exports the
outstanding (unchecked) items to Excel.

Domain context: lift / elevator compliance (codes such as AS3000, EN81-20). The
real checklist contains sensitive data and must **never** be sent to Claude or any
server — all parsing and processing happens locally in the browser.

## 2. Architecture

- **Single static HTML file** (plus bundled JS/CSS and vendored libraries) opened
  directly in a browser. No server, no install, works offline.
- **SheetJS (xlsx)** vendored locally — used both to **read** the checklist
  workbook and to **write** the export workbook.
- **Vanilla JS** (no framework) to keep the tool portable and dependency-light.
- All data (the loaded checklist template + project drafts) lives in the browser's
  `localStorage`; project drafts can also be exported/imported as `.json` files.

### Screens

1. **Dashboard** — list of project drafts, each with a progress bar. Actions:
   create, open, import (`.json`), delete.
2. **Project view** — inputs panel + dynamically filtered checklist for one
   project.
3. **Setup** — load or replace the checklist workbook (the shared template all
   projects use).

## 3. Data Model — The Excel Workbook (source of truth)

The user maintains one `.xlsx` workbook with **two sheets**. The user is
responsible for naming the sheets exactly `Checklist` and `Inputs` and for adding
the `Example` column (decision: the tool expects these names/columns rather than
auto-detecting). If a required sheet or column is missing, the tool shows a clear
error on load naming what is missing.

### Sheet `Checklist`

| Column      | Meaning |
|-------------|---------|
| Item ID     | Unique id, e.g. `A10` |
| Conditions  | Condition expression (may be empty); see §4 |
| Description | What the item requires |
| Code        | Reference code/standard, e.g. `EN81-20` |
| Note        | Guidance / explanatory note |
| **Example** | **New column** — example / how-to-complete text (may be blank) |

**Rule:** An item with an **empty Conditions cell always applies**. An item with a
condition applies only when that condition evaluates true for the project's inputs.

### Sheet `Inputs`

Defines every variable that conditions may reference.

| Column   | Meaning |
|----------|---------|
| Name     | Variable name used in conditions, e.g. `PitToEarth` |
| Type     | One of `Choice`, `Float`, `Integer`, `Boolean` |
| Label    | Human-readable label shown in the UI |
| Unit     | Optional display unit (e.g. `m`); cosmetic only |
| Choices  | For `Choice` type only: semicolon-separated options, e.g. `Class 2;Class 3;Class 9b` |
| Default  | Optional default value |

Example rows:

| Name | Type | Label | Unit | Choices | Default |
|------|------|-------|------|---------|---------|
| PitToEarth | Boolean | Pit is to solid earth | | | FALSE |
| MaxFFLInt | Float | Max internal FFL height | m | | 0 |
| BuildingClass | Choice | Building classification | | Class 2;Class 3;Class 9b | |

## 4. Condition Grammar

Conditions reference input names and support **AND, OR, and parenthesised
grouping**.

### Syntax

```
PitToEarth: FALSE
MaxFFLInt: >11m
PitToEarth: FALSE AND MaxFFLInt: >11
BuildingClass: "Class 9b" OR MaxFFLInt: >=11
(PitToEarth: FALSE AND MaxFFLInt: >11) OR BuildingClass: "Class 2"
```

### Rules

- A single comparison is `Name <op> Value`. Both `:` and `=` are accepted as the
  equality operator.
- Operators: `=` / `:`, `!=`, `>`, `<`, `>=`, `<=`.
  - `>`, `<`, `>=`, `<=` are numeric comparisons, valid for `Float` / `Integer`.
  - `=`/`:` and `!=` work for all types (equality for `Boolean` / `Choice`,
    numeric equality for `Float` / `Integer`).
- Booleans are written `TRUE` / `FALSE` (case-insensitive).
- Choice values may be quoted (`"Class 9b"`) — required when they contain spaces.
- A trailing unit on a numeric literal (e.g. the `m` in `>11m`) is **ignored** by
  the engine; only the number is compared.
- Combine comparisons with `AND` / `OR`; group with parentheses. `AND` binds
  tighter than `OR` (standard precedence); parentheses override.

### Error handling

- If a condition references an **unknown input name** or **fails to parse**, the
  tool surfaces a clear, item-specific error (rather than silently treating the
  item as applicable or not). This makes malformed rules visible immediately when
  the workbook is loaded.

## 5. Project View & Progress

- **Inputs panel** (top): one control per `Inputs` row —
  - `Choice` → dropdown of its choices
  - `Float` / `Integer` → number field (with unit label if provided)
  - `Boolean` → toggle / checkbox
  - Controls initialise to the `Default` where provided.
- Changing any input **live-refilters** the visible items (re-evaluates all
  conditions).
- **Item list:** each applicable item shows Item ID, Description, Code, Note, a
  **done checkbox**, and a **per-item comment field** (the user's own note for this
  project).
- **Progress bar:** `checked ÷ applicable items`, updated live. The same value is
  shown on the project's dashboard card.
- All changes **autosave** to `localStorage` for that project.

## 6. Export

A **"Export unchecked to Excel"** action generates a `.xlsx` listing every item
that is **applicable but unchecked** for the current project.

Export columns:

| Item ID | Description | Code | Note | Example (how to complete) | Your comment |
|---------|-------------|------|------|---------------------------|--------------|

- Header includes the project name and export date.
- Checked items and non-applicable items are excluded.

## 7. Save / Load / Persistence

- **Autosave:** project state (inputs, checks, comments) persists in
  `localStorage`; the dashboard lists all stored projects between sessions.
- **Save project:** downloads a `.json` file containing the project's inputs,
  checks, and comments — for backup, sharing, or moving to another machine.
- **Import project:** loads such a `.json` back into the dashboard.
- The **checklist template** (parsed from the workbook) is also cached in
  `localStorage` so projects work without re-loading the Excel each session;
  Setup can replace it.

## 8. Out of Scope (YAGNI)

- No "N/A" item state — items are only checked or unchecked. Progress denominator
  is the count of applicable items.
- No server, accounts, or multi-user sync.
- No editing of the checklist content inside the tool — the Excel workbook remains
  the single source of truth; the tool reads it.

## 9. Component Boundaries

- **Workbook parser** — reads `Checklist` + `Inputs` sheets into in-memory model;
  validates input definitions. Depends on SheetJS.
- **Condition engine** — parses a condition string into an AST and evaluates it
  against a set of input values. Pure, independently testable, no DOM.
- **Project store** — CRUD for project drafts in `localStorage`; JSON
  export/import.
- **UI layer** — dashboard, project view, setup screens; wires inputs → engine →
  rendered item list and progress.
- **Exporter** — builds the unchecked-items workbook via SheetJS.

Each unit communicates through plain data structures (parsed model, input-value
map, project object) so it can be understood and tested in isolation.
