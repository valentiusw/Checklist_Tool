# CLAUDE.md

Orientation for working in this repo. Durable facts only — for the user's running
notes see `Context.txt` (raw inbox, not authoritative). For end-user docs and the full
workbook/condition-grammar reference see `README.md` (don't duplicate it here).

## What this is

**Smart Checklist** — a self-contained, **offline static web app** that turns a compliance
checklist (maintained in Excel) into a dynamic checklist. Per project the user enters a few
inputs; only items whose conditions are met are shown. Tracks multiple project drafts with
progress bars and exports outstanding items to Excel.

- **No backend, no build step, no network.** Pure browser. Checklist data never leaves the
  machine — the `.xlsx` is parsed client-side.
- Dependencies are **vendored** (`vendor/xlsx.bundle.js` = xlsx-js-style fork that writes
  cell styles). No npm runtime deps.

## Run & test

```bash
# Run the app (ES-module imports are blocked over file:// — a server is required)
python -m http.server 8000      # then open http://localhost:8000/
# or double-click start.cmd (launches the server + opens the browser)

npm test                        # node --test — unit tests for the pure logic (src/*.js)
node --check src/<file>.js      # quick syntax check after editing
```

There is **no lint/build/typecheck** step. Tests are Node's built-in runner over the
dependency-free modules only (DOM glue in `app.js` is not unit-tested — see smoke tests below).

## Architecture

`index.html` loads the vendored script then `src/app.js` (ES module). Screens are
`<section class="screen">` blocks toggled by `app.js`; `showScreen(name)` sets
`document.documentElement.dataset.screen` (CSS hooks off `[data-screen="…"]`).

**Pure logic (DOM-free, unit-tested) — `src/`:**
- `conditionEngine.js` — parse + evaluate item conditions (`AND`/`OR`/parens, comparison ops). `ConditionError`.
- `workbookModel.js` — build the in-memory model from parsed sheets. `ModelError`.
- `exporter.js` — `applicableItems`, `computeProgress`, `computeProjectProgress`, `buildExportPlan` (rows carry `section`).
- `exportWorkbook.js` — builds the styled export workbook (branded Overview sheet + discipline-grouped unit sheets); `XLSX` is injected so it stays DOM-free/testable.
- `projectStore.js` / `projectDraft.js` — project + unit data model, id/unit creation, draft validation, input defaulting.
- `checklistView.js` — `itemApplicableUnits` (which units a given item's condition matches → drives unit tags).
- `librarySnapshot.js` — connected-backup file format + reconcile rule (pure).
- `legacyMigration.js` — one-time read of the old localStorage layout.

**Browser glue / persistence — `src/`:**
- `app.js` — the controller: rendering, events, screen switching, splitter drag, all DOM. Largest file (~47KB).
- `db.js` — **the one place** defining the IndexedDB schema (`dpchecklist`, v3, stores: `projects`, `kv`). Other stores must not redefine it.
- `fileBackup.js` — File System Access wrapper for the connected backup file (no reconcile, no IndexedDB).

**Other:** `styles.css` (all styling, token-driven, dark theme via `[data-theme="dark"]`);
`tools/` (sample-data generators); `tests/` (mirrors `src/` module names).

## Conventions & constraints (easy to get wrong)

- **Static-app discipline:** no framework, no bundler, no new runtime deps. Add vendored files only if unavoidable.
- **CSS is token-driven and theme-aware.** Use existing CSS custom properties; don't hardcode `#fff`-style colors (breaks dark mode). New layout CSS is typically scoped with a `[data-screen="project"]` prefix to avoid leaking across screens.
- **localStorage / pointer-capture / File System Access calls go in `try/catch`** (private mode / unsupported browsers).
- **db.js owns the IndexedDB schema** — bump its version there, nowhere else.
- **Export rules (per the user's spec):** the export is a **single `.xlsx`** named
  `<Project Title>_DPVT_<Mode>.xlsx` (project title keeps its spaces; only
  filename-illegal chars are stripped — **no** `_`-for-space; the **project number is
  never** in a file name). The workbook has a branded **Overview** sheet (project details with fillable Reviewed By/Contact, per-unit progress meters, the checklist's glossary, how-to notes; **Date Reviewed** formatted `DD/MM/YYYY`) then one sheet per unit whose **outstanding** items are grouped into named **discipline sections** (from the model's `Sections` map, `item.section`). Per-item column order **ID, Description, Code, Comments, Example**; Example cells with a `Link` become blue underlined external hyperlinks to that URL (cell text = the Example label); Example cells without one stay plain text; the **Note** column is excluded; **`S`-prefixed items are excluded** (filtered in `buildExportPlan`, `/^s/i`). Rendering lives in `exportWorkbook.js`; the vendored `xlsx-js-style` styles cells but **cannot embed images** (branding is styled cells, no logo). The export button offers two modes via a dropdown: **Outstanding Items** (base name `<Project Title>_DPVT_Out`) and **All Items** (`<Project Title>_DPVT_All`) — the mode is named outright and abbreviated, not appended as an extra suffix, to keep names short. The full workbook lists **every** item per unit — including `S`-prefixed items — each tagged with a per-unit **Status** (Done / Outstanding / Not Applicable) shown by a Status column and a row tint (green Done / plain Outstanding / grey N/A); its Overview adds a Status Key legend. Mode is threaded through `buildExportPlan(model, project, { mode })` and `buildExportWorkbook({ …, mode })`, and selects the base-name word.
- **The Checklist sheet's three example columns:** **Example** is the display label
  (usually a file name), **Link** is its URL, and **HyperLink** is a human-facing
  `=HYPERLINK(Link, Example)` formula the tool **never reads** (its cached value carries
  no target). `Link` is optional and only absolute `http(s)` values are kept — anything
  else is ignored, leaving the Example as plain text. Parsed in `workbookModel.js` into
  `item.example` / `item.exampleLink`.
- **Project number** is an optional identity field stored as `details.projectNumber` (so it rides along with `normalizeDetails` / serialize / import for free). It renders as subtext under the name on dashboard cards and in the details panel, and the dashboard search matches name **or** number via the pure `matchesProjectSearch()` in `projectStore.js`. It is deliberately **not** part of export file names (those use the title only) and appears on the export Overview as a `Project No.` row only when set.
- **Button labels are Title Case** — capitalize *every* word, including short words (e.g. "See Project Details", "Back Up To A File…"). Applies to visible `<button>` text and button-styled labels, static and dynamically generated; not to headings, field labels, or toggle labels (those stay sentence case).
- **Done/partial tint tokens:** `--success-fill` / `--warning-fill` are translucent (0.08 alpha) and used for **both** background and border so the edge blends (no hard outline). Item bubbles go green (all units checked), amber (some), or plain. Per-unit pills deliberately do **not** reuse that faint fill — a ticked pill gets its own slightly stronger translucent pair, `--success-pill` (bg) / `--success-pill-edge` (border), so it stays legible in dark mode and with "Colour completed items" off (when there is no bubble tint behind it) while staying quiet. **No tick glyph** on ticked pills — the user asked for colour only; hover firms the edge to `--success`.
- The user's notes in `Context.txt` are requirements/feedback, often dated — treat as intent, confirm current state against code before acting.

## Development workflow (this repo uses Superpowers SDD)

Work is done in **spec → plan → tasks** under `docs/superpowers/` (specs/, plans/), tracked in
`.superpowers/sdd/progress.md` (the running ledger — read its tail for current state) with
per-task briefs/reports and per-commit review diffs. Feature work happens on a branch, merged to
`main` only on explicit user authorization. Nothing is pushed without the user asking.

**Verification:** after UI/layout changes, the project drives **headless Edge over CDP** for
browser smoke tests (see the `browser-smoke-test-harness` memory; harnesses land in the session
scratchpad). Claims of "done" are backed by `npm test` + a smoke run, not assertion alone.

## Current state (update when it drifts)

Functional MVP, actively refined. The RHS detail panel is now a **dynamic workspace** with two
modes, toggled by the "See Project Details" button on the checklist card:
- **Item editor** (default) — clicking a checklist item (or a unit pill) opens its detail +
  per-unit comment/check here. A dashed empty-state box shows until an item is picked.
- **Project details** — a read-only unit view: a unit picker over clean two-column spec rows
  (no collapse). `applyDetailMode()` in `app.js` flips section visibility + the button label.

Also landed on `main`: two-bubble layout with independent scroll + drag-resize splitter;
restored item **bubbles** (green done / amber partial, translucent tints) with the code shown
after the description; **per-unit pill tags** on items (multi-unit projects only — click a pill to
open that unit in the editor); an **"All Lifts"** editor option that writes a comment / check to
every applicable unit; single-unit projects omit pills and the unit picker; S-items excluded from
export; Title-Case buttons.

The **Excel export was redesigned** (`src/exportWorkbook.js`): a branded, client-ready workbook —
a Schindler-styled Overview sheet (details, per-unit progress meters, glossary, how-to notes) plus
per-unit sheets that group outstanding items into discipline sections. The deliverable is a single
workbook named `<Project Title>_DPVT_Out` with dates as `DD/MM/YYYY`. See the Export rules
convention above for the full contract.

A second export mode, **All Items** (`<Project Title>_DPVT_All`), now sits alongside the outstanding
export — the export trigger is a dropdown. The full workbook lists every item per unit (including `S`-items) with a
per-unit **Status** column and status row tints (green Done / plain Outstanding / grey Not Applicable)
and a Status Key legend on the Overview. `mode: 'outstanding' | 'full'` threads through
`buildExportPlan` / `buildExportWorkbook` / `downloadProjectWorkbook`.

Setup now loads a single `.xlsx` (no ZIP, no bundled example files); the workbook's Checklist
sheet carries `Example` / `Link` / `HyperLink` columns and example links open as URLs in a new
browser tab rather than an in-app lightbox.

No specific in-flight task at last update — driven by ad-hoc requests in `Context.txt` / chat.
