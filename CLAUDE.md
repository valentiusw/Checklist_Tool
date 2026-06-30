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
  cell styles; `vendor/jszip.min.js`). No npm runtime deps.

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

`index.html` loads the two vendored scripts then `src/app.js` (ES module). Screens are
`<section class="screen">` blocks toggled by `app.js`; `showScreen(name)` sets
`document.documentElement.dataset.screen` (CSS hooks off `[data-screen="…"]`).

**Pure logic (DOM-free, unit-tested) — `src/`:**
- `conditionEngine.js` — parse + evaluate item conditions (`AND`/`OR`/parens, comparison ops). `ConditionError`.
- `workbookModel.js` — build the in-memory model from parsed sheets. `ModelError`.
- `exporter.js` — `applicableItems`, `computeProgress`, `computeProjectProgress`, `buildExportPlan`.
- `projectStore.js` / `projectDraft.js` — project + unit data model, id/unit creation, draft validation, input defaulting.
- `checklistView.js` — `itemApplicableUnits` (which units a given item's condition matches → drives unit tags).
- `librarySnapshot.js` — connected-backup file format + reconcile rule (pure).
- `legacyMigration.js` — one-time read of the old localStorage layout.

**Browser glue / persistence — `src/`:**
- `app.js` — the controller: rendering, events, screen switching, splitter drag, all DOM. Largest file (~47KB).
- `db.js` — **the one place** defining the IndexedDB schema (`dpchecklist`, v2, stores: `examples`, `projects`, `kv`). Other stores must not redefine it.
- `exampleStore.js` — binary Example files (PDFs/images) keyed by filename, in the shared `examples` store.
- `fileBackup.js` — File System Access wrapper for the connected backup file (no reconcile, no IndexedDB).
- `zipBundle.js` — read setup ZIP / write export ZIP (tolerates the whole bundle being zipped one level deep).

**Other:** `styles.css` (all styling, token-driven, dark theme via `[data-theme="dark"]`);
`tools/` (sample-data generators); `tests/` (mirrors `src/` module names).

## Conventions & constraints (easy to get wrong)

- **Static-app discipline:** no framework, no bundler, no new runtime deps. Add vendored files only if unavoidable.
- **CSS is token-driven and theme-aware.** Use existing CSS custom properties; don't hardcode `#fff`-style colors (breaks dark mode). New layout CSS is typically scoped with a `[data-screen="project"]` prefix to avoid leaking across screens.
- **localStorage / pointer-capture / File System Access calls go in `try/catch`** (private mode / unsupported browsers).
- **db.js owns the IndexedDB schema** — bump its version there, nowhere else.
- **Export rules (per the user's spec):** unchecked-items Excel uses column order **ID, Description, Code, Comments, Example**; header row bold; Example cells that reference a file become blue underlined relative hyperlinks; the **Note** column is excluded from export; **Schindler / `S` items are excluded from export.**
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

Functional MVP in active UI refinement. Recently completed on `main`: two-bubble project layout
(independent-scroll checklist/detail cards) and drag-to-resize cards with a persisted splitter
width. Larger in-flight direction (from `Context.txt`, 30/6): move per-item commenting + inputs
into the RHS detail panel, and replace per-unit checklists with a **unit-tag** system (items show
"Unit 2" / "Unit 3" tags; comments pick which unit they apply to).
