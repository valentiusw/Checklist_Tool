# Download ZIP with Examples — Design

Date: 2026-06-26

## Summary

Add a symmetric ZIP-based workflow to the Smart Checklist tool, built around
Excel's relative-hyperlink feature:

- **Import (Setup):** the user uploads a single `.zip` containing the checklist
  workbook (`.xlsx`) at the root plus an `Examples/` subfolder of the PDFs and
  images referenced by the checklist's **Example** column.
- **Export (Download ZIP):** the tool produces a `.zip` containing a generated
  "unchecked items" workbook plus an `Examples/` subfolder with only the files
  referenced by the outstanding items. In the workbook, each Example cell that
  points at a file is a **relative hyperlink** (`Examples/<file>`), so when the
  recipient unzips the bundle and opens the workbook, the links resolve to the
  adjacent `Examples/` folder.

The previously-existing "Export report (HTML)" feature is removed as part of
this change.

## Goals

- Let the checklist author supply example PDFs/images once and have the tool
  remember them across browser restarts.
- Produce a self-contained ZIP whose workbook links to bundled example files via
  Excel relative hyperlinks.
- Keep the app fully client-side (no server upload of user content).

## Non-goals

- Editing example files in the tool.
- Embedding images inside worksheet cells (that feature was removed previously;
  this design uses hyperlinks to adjacent files instead).
- Preserving the HTML report export.

## Chosen approach

**SheetJS (`XLSX`, already vendored) + JSZip (new vendored lib).**

- SheetJS reads the workbook on import (as today) and writes the export
  workbook, including relative external hyperlinks via a cell's `.l` property:
  `cell.l = { Target: "Examples/a08.png", TargetMode: "External" }`. Excel
  resolves such targets relative to the workbook's own location.
- JSZip handles both unzipping the setup ZIP and assembling the export ZIP.
- Persistence of the binary Examples files uses IndexedDB via a thin wrapper.

Rejected alternatives:

- **ExcelJS + JSZip** — ExcelJS was just removed; re-adding it for hyperlink
  writing is unnecessary because SheetJS already writes relative hyperlinks.
- **CSV / simpler format** — cannot carry hyperlinks, defeating the purpose.

## Conventions

- The subfolder name is **`Examples/`**, used identically on import and export.
- A cell in the **Example** column is a *file reference* when its trimmed value
  ends in a known extension: `.png .jpg .jpeg .gif .webp .bmp .svg` or **`.pdf`**.
  Otherwise it is treated as prose guidance.
- Internal rename for clarity (the field can now be a PDF, not just an image):
  - model field `exampleImage` -> **`exampleFile`**
  - helper `isImageFilename` -> **`isExampleFile`**
  These are internal-only changes confined to `workbookModel.js`, its tests, and
  the export code.

## Modules

### `src/exampleStore.js` (new)

Thin IndexedDB wrapper; the persistence layer for binary Examples files.

- One database with a single object store keyed by filename, value = `Blob`.
- API:
  - `putAll(fileMap)` — replace-style bulk insert of `Map<filename, Blob>`.
  - `get(filename)` -> `Promise<Blob | undefined>`.
  - `keys()` -> `Promise<string[]>`.
  - `clear()` -> `Promise<void>`.

### `src/zipBundle.js` (new)

Glue over JSZip.

- `readSetupZip(arrayBuffer)` -> `{ workbookArrayBuffer, files: Map<filename, Blob> }`.
  - Finds the single `.xlsx` at the ZIP root (error if zero or more than one).
  - Collects every entry under `Examples/` into `files`, keyed by the bare
    filename (no directory prefix).
- `buildExportZip({ workbookArrayBuffer, files })` -> `Promise<Blob>`.
  - Writes the workbook at the ZIP root and each file under `Examples/<name>`.

### `src/exporter.js` (extend)

Add a **pure** function (no browser APIs) that is the testable heart of export:

- `buildExportPlan(model, project)` -> for each unit, an object describing:
  - the ordered outstanding rows (applicable items with `checks[id] !== true`),
    each row carrying Item ID, Description, Code, Comments, Example display
    value, and — when the Example is a file — its `exampleFile` name; and
  - the set of referenced filenames across the unit.
- The plan also exposes the union of referenced filenames across all units, so
  the caller knows exactly which Examples files to pull from the store.

The existing `buildExportRows` may be folded into or reused by this function.

### `src/app.js` (change)

- Setup import accepts a `.zip` (primary) or a bare `.xlsx` (fallback).
- Replace the project-screen export button wiring with **Download ZIP**.
- Remove the HTML report export (`exportReport`, `reportItemHtml`) and the
  server-fetch helpers used only by it (`loadExampleImage`, `blobToDataUri`).
- Persist the model to `localStorage` as today; persist Examples to IndexedDB.

### `index.html` / `styles.css` (change)

- Add `<script src="vendor/jszip.min.js"></script>`.
- Settings file input accepts `.zip,.xlsx`; helper text describes the ZIP format
  (workbook at root + `Examples/` subfolder).
- Project screen: primary action becomes **Download ZIP**; remove the HTML
  report button. `Save project file` stays.

### `vendor/jszip.min.js` (new)

Vendored JSZip build, loaded as a global `JSZip` (matching the existing
`vendor/xlsx.full.min.js` global pattern).

## Data flow — Import (Setup)

1. User selects a file in Settings.
2. If `.zip`: `readSetupZip` extracts workbook bytes + `Examples/` file map.
   If `.xlsx`: read the file directly with an empty Examples map.
3. `XLSX.read(workbookArrayBuffer)` -> `buildModel(...)` as today.
4. Persist the model to `localStorage` (small JSON, as today).
5. `exampleStore.clear()` then `exampleStore.putAll(files)`.
6. Status line: `Loaded N items, M inputs, K example files.`

## Data flow — Export (Download ZIP)

1. `buildExportPlan(model, project)` produces per-unit rows + referenced
   filenames.
2. Build the workbook with SheetJS: one worksheet per unit (sheet names
   sanitized + de-duplicated), header row Item ID, Description, Code, Comments,
   Example. For a file-backed Example, set the cell text to the filename and
   `cell.l = { Target: "Examples/<file>", TargetMode: "External" }`. Prose
   Examples are plain text.
3. For each referenced filename, `exampleStore.get(name)`; add found blobs to
   the ZIP under `Examples/<name>`. Track any missing names.
4. Add the workbook at ZIP root as `<ProjectName>_unchecked_<date>.xlsx`.
5. `buildExportZip(...)` -> Blob; `downloadBlob` as `<ProjectName>_<date>.zip`.
6. If any referenced files were missing from the store, `alert` a summary.

## Error handling

- Setup ZIP with no `.xlsx` at root, more than one `.xlsx`, or a malformed
  workbook -> clear status error; existing model left unchanged.
- A referenced file missing from the library -> the hyperlink is still written;
  missing names are collected and surfaced in an `alert` after export; the
  export still succeeds.
- IndexedDB unavailable or blocked -> status error on import. On export with an
  empty/unavailable store, the workbook is still produced (with hyperlinks) and
  an empty/partial `Examples/`, plus a warning.

## Testing

- Unit tests (`node:test`) for the pure pieces:
  - `isExampleFile` including `.pdf` and prose negatives.
  - `buildExportPlan`: correct outstanding rows, correct referenced-filename
    set, correct hyperlink target strings, prose-vs-file distinction, and
    multi-unit aggregation.
- The IndexedDB + JSZip glue (`exampleStore`, `zipBundle`) and the end-to-end
  Download ZIP path are verified with the existing browser smoke-test harness:
  import a sample setup ZIP, click Download ZIP, confirm a ZIP downloads.

## Backward compatibility

- Bare `.xlsx` import remains supported (empty Examples library), keeping
  `SampleChecklist.xlsx` and existing model tests working.
- Persisted-model `localStorage` format is unchanged except the per-item field
  rename `exampleImage` -> `exampleFile`; `restoreModel`/`persistModel` are
  updated to the new field name.
