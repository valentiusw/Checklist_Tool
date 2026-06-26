# Download ZIP with Examples — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a symmetric ZIP workflow — import a setup ZIP (workbook + `Examples/` folder, persisted in IndexedDB) and export a ZIP whose "unchecked items" workbook links to bundled example files via Excel relative hyperlinks. Remove the HTML report export.

**Architecture:** Client-side only. SheetJS (`XLSX`, already vendored) reads the workbook and writes the export workbook with relative external hyperlinks (`cell.l = { Target: "Examples/<file>" }`). A newly vendored JSZip reads the setup ZIP and builds the export ZIP. A thin IndexedDB wrapper persists the binary Examples files. The pure export-planning logic lives in `exporter.js` and is unit-tested with `node:test`; the IndexedDB/JSZip glue is verified with the browser smoke-test harness.

**Tech Stack:** Vanilla ES modules, SheetJS (`vendor/xlsx.full.min.js`), JSZip (`vendor/jszip.min.js`, new), IndexedDB, `node:test`.

## Global Constraints

- No build step; vanilla ES modules loaded directly by `index.html`.
- Vendored libraries are plain `<script>` globals (`XLSX`, `JSZip`), matching the existing `vendor/xlsx.full.min.js` pattern. No bundler, no npm runtime deps.
- The example subfolder is named exactly **`Examples/`** on both import and export.
- A cell in the **Example** column is a file reference iff its trimmed value ends in `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.bmp`, `.svg`, or `.pdf` (case-insensitive). Otherwise it is prose.
- Internal model field is **`exampleFile`** (renamed from `exampleImage`); detector is **`isExampleFile`** (renamed from `isImageFilename`).
- Tests run with `node --test`. Pure logic must not import browser globals (`indexedDB`, `JSZip`, `XLSX`, `document`).
- Commit after each task with a `feat:`/`refactor:`/`docs:` message ending with the project's `Co-Authored-By` trailer.

---

### Task 1: Remove the HTML report export

Removes the now-obsolete HTML report (it fetched a server-side `examples/` folder that no longer fits the in-browser library model). This isolates the deletion so later tasks build on a clean base.

**Files:**
- Modify: `src/app.js` (remove `exportReport`, `reportItemHtml`, `loadExampleImage`, `blobToDataUri`, and the `btn-report` listener)
- Modify: `index.html` (remove the `btn-report` button)

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing new. After this task the project screen has only `Save project file` in its button row; `downloadBlob`, `escapeHtml`, `applicableItems` remain in use elsewhere.

- [ ] **Step 1: Remove the report functions from `src/app.js`**

Delete the four functions in `src/app.js`: `blobToDataUri` (currently ~line 407), `loadExampleImage` (~line 418), `reportItemHtml` (~line 430), and `exportReport` (~line 444 through its end, which finishes with the `downloadBlob(new Blob([html], ...))` call and closing brace). Delete the entire contiguous block from the `function blobToDataUri(blob) {` line through the closing `}` of `exportReport`.

- [ ] **Step 2: Remove the `btn-report` listener from `src/app.js`**

In `init()`, delete this line:

```js
  document.getElementById('btn-report').addEventListener('click', exportReport);
```

- [ ] **Step 3: Remove the button from `index.html`**

Replace the project-screen button row so the report button is gone:

```html
        <div class="btn-row">
          <button id="btn-save-project">Save project file</button>
        </div>
```

- [ ] **Step 4: Verify the app still parses and the suite passes**

Run: `node --test`
Expected: PASS (40 tests), no reference errors.
Also confirm there are no remaining references:
Run: `grep -rn "exportReport\|reportItemHtml\|loadExampleImage\|blobToDataUri\|btn-report" src index.html`
Expected: no matches.

- [ ] **Step 5: Commit**

```bash
git add src/app.js index.html
git commit -m "refactor: remove HTML report export"
```

---

### Task 2: Rename `exampleImage` → `exampleFile` and detect PDFs

Broadens example detection to PDFs and renames the field/helper for clarity. Pure, TDD with `node:test`.

**Files:**
- Modify: `src/workbookModel.js` (rename `isImageFilename` → `isExampleFile`, add `pdf`, rename produced field `exampleImage` → `exampleFile`)
- Modify: `tests/workbookModel.test.js` (update field name; add a PDF case)
- Modify: `src/app.js` (`restoreModel` reads the renamed field, with back-compat fallback)

**Interfaces:**
- Consumes: nothing new.
- Produces: model items now expose `item.exampleFile` (string filename or `''`) instead of `item.exampleImage`. `item.example` (prose) is unchanged.

- [ ] **Step 1: Update the failing tests in `tests/workbookModel.test.js`**

Replace the two image-related tests (currently titled "a prose Example is text, with no image" and "an Example cell that is an image filename becomes exampleImage") with:

```js
test('a prose Example is text, with no exampleFile', () => {
  const model = buildModel({ checklistRows, inputRows });
  assert.equal(model.items[0].example, 'Seal the enclosure');
  assert.equal(model.items[0].exampleFile, '');
});

test('an Example cell that is a file name becomes exampleFile (image or pdf)', () => {
  const rows = [
    ['Item ID', 'Conditions', 'Description', 'Code', 'Note', 'Example'],
    ['A08', '', 'Lifts not exposed to weather', 'AS3000', '', 'a08-weather-seal.png'],
    ['A09', '', 'Prose item', 'SL', '', 'Provide a protected lobby.'],
    ['A10', '', 'Spec sheet item', 'EN81', '', 'a10-spec.pdf'],
  ];
  const model = buildModel({ checklistRows: rows, inputRows });
  assert.equal(model.items[0].exampleFile, 'a08-weather-seal.png');
  assert.equal(model.items[0].example, '');
  assert.equal(model.items[1].exampleFile, '');
  assert.equal(model.items[1].example, 'Provide a protected lobby.');
  assert.equal(model.items[2].exampleFile, 'a10-spec.pdf');
  assert.equal(model.items[2].example, '');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/workbookModel.test.js`
Expected: FAIL — `model.items[0].exampleFile` is `undefined` (field still named `exampleImage`).

- [ ] **Step 3: Update `src/workbookModel.js`**

Rename the helper and add `pdf`:

```js
// An Example cell is treated as a file reference when its whole value is a
// filename ending in a known extension; otherwise it is explanatory text.
function isExampleFile(value) {
  return /\.(png|jpe?g|gif|svg|webp|bmp|pdf)$/i.test(String(value).trim());
}
```

In `buildItems`, replace the two trailing item fields:

```js
      // One Example column: either prose guidance or a single file name.
      example: isExampleFile(cell(row, idx['Example'])) ? '' : cell(row, idx['Example']),
      exampleFile: isExampleFile(cell(row, idx['Example'])) ? cell(row, idx['Example']) : '',
```

- [ ] **Step 4: Update `restoreModel` in `src/app.js`**

In `restoreModel`, change the checklist-row mapping to read the new field with a fallback to the legacy key (for already-persisted localStorage):

```js
      // The single Example cell holds either the prose or the file name.
      ...data.items.map(i => [i.id, i.conditionsText, i.description, i.code, i.note, i.exampleFile || i.exampleImage || i.example]),
```

- [ ] **Step 5: Run the full suite**

Run: `node --test`
Expected: PASS (40 tests).
Run: `grep -rn "exampleImage\|isImageFilename" src`
Expected: no matches.

- [ ] **Step 6: Commit**

```bash
git add src/workbookModel.js tests/workbookModel.test.js src/app.js
git commit -m "refactor: rename exampleImage to exampleFile and detect PDFs"
```

---

### Task 3: Add `buildExportPlan` to the exporter

The pure heart of the ZIP export: from a model + project, produce per-unit outstanding rows and the de-duplicated list of referenced filenames. TDD with `node:test`.

**Files:**
- Modify: `src/exporter.js` (add `buildExportPlan`)
- Modify: `tests/exporter.test.js` (add tests)

**Interfaces:**
- Consumes: `applicableItems(model, values)` (existing in `exporter.js`); model items with `id, description, code, example, exampleFile` (from Task 2).
- Produces:
  ```
  buildExportPlan(model, project) -> {
    units: Array<{
      name: string,
      rows: Array<{ id, description, code, comment, example, exampleFile }>
    }>,
    referencedFiles: string[]   // unique exampleFile names, first-appearance order
  }
  ```
  `rows` contains only applicable items that are NOT checked. `comment` is `unit.comments[id] || ''`. `exampleFile` is `''` for prose items.

- [ ] **Step 1: Write failing tests in `tests/exporter.test.js`**

Append:

```js
test('buildExportPlan returns per-unit outstanding rows', () => {
  const rows = [
    ['Item ID', 'Conditions', 'Description', 'Code', 'Note', 'Example'],
    ['A08', '', 'Always applies', 'AS3000', '', 'a08.png'],
    ['A10', '', 'Second item', 'EN81', '', 'Prose guidance'],
  ];
  const m = buildModel({ checklistRows: rows, inputRows });
  const project = {
    units: [
      { name: 'Lift 1', inputs: {}, checks: { A08: true }, comments: { A10: 'note' } },
      { name: 'Lift 2', inputs: {}, checks: {}, comments: {} },
    ],
  };
  const plan = buildExportPlan(m, project);
  assert.equal(plan.units.length, 2);
  // Unit 1: A08 checked -> only A10 outstanding (prose, no file)
  assert.deepEqual(plan.units[0].rows.map(r => r.id), ['A10']);
  assert.equal(plan.units[0].rows[0].comment, 'note');
  assert.equal(plan.units[0].rows[0].exampleFile, '');
  assert.equal(plan.units[0].rows[0].example, 'Prose guidance');
  // Unit 2: nothing checked -> A08 (file) + A10 (prose)
  assert.deepEqual(plan.units[1].rows.map(r => r.id), ['A08', 'A10']);
  assert.equal(plan.units[1].rows[0].exampleFile, 'a08.png');
});

test('buildExportPlan collects referenced files once, in order', () => {
  const rows = [
    ['Item ID', 'Conditions', 'Description', 'Code', 'Note', 'Example'],
    ['A08', '', 'Item', 'AS3000', '', 'a08.png'],
    ['A09', '', 'Item', 'AS3000', '', 'a09.pdf'],
    ['A10', '', 'Item', 'AS3000', '', 'a08.png'],
  ];
  const m = buildModel({ checklistRows: rows, inputRows });
  const project = { units: [{ name: 'U', inputs: {}, checks: {}, comments: {} }] };
  const plan = buildExportPlan(m, project);
  assert.deepEqual(plan.referencedFiles, ['a08.png', 'a09.pdf']);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/exporter.test.js`
Expected: FAIL — `buildExportPlan` is not exported.

- [ ] **Step 3: Implement `buildExportPlan` in `src/exporter.js`**

Append:

```js
export function buildExportPlan(model, project) {
  const units = (project.units || []).map(unit => {
    const comments = unit.comments || {};
    const checks = unit.checks || {};
    const rows = applicableItems(model, unit.inputs || {})
      .filter(item => checks[item.id] !== true)
      .map(item => ({
        id: item.id,
        description: item.description,
        code: item.code,
        comment: comments[item.id] || '',
        example: item.example,
        exampleFile: item.exampleFile || '',
      }));
    return { name: unit.name, rows };
  });
  const referencedFiles = [];
  const seen = new Set();
  for (const unit of units) {
    for (const row of unit.rows) {
      if (row.exampleFile && !seen.has(row.exampleFile)) {
        seen.add(row.exampleFile);
        referencedFiles.push(row.exampleFile);
      }
    }
  }
  return { units, referencedFiles };
}
```

- [ ] **Step 4: Add the import to the test file**

Ensure the top of `tests/exporter.test.js` imports the new function:

```js
import { applicableItems, computeProgress, computeProjectProgress, buildExportRows, buildExportPlan } from '../src/exporter.js';
```

- [ ] **Step 5: Run the full suite**

Run: `node --test`
Expected: PASS (42 tests).

- [ ] **Step 6: Commit**

```bash
git add src/exporter.js tests/exporter.test.js
git commit -m "feat: add buildExportPlan for ZIP export"
```

---

### Task 4: Vendor JSZip and add the IndexedDB example store

Adds the JSZip library and the persistence layer. No `node:test` (browser-only APIs); verified by inspection + the browser smoke test in Task 7.

**Files:**
- Create: `vendor/jszip.min.js` (downloaded)
- Create: `src/exampleStore.js`
- Modify: `index.html` (add the JSZip `<script>`)

**Interfaces:**
- Consumes: global `indexedDB`.
- Produces (`src/exampleStore.js`, named async exports):
  - `clear() -> Promise<void>`
  - `putAll(fileMap: Map<string, Blob>) -> Promise<void>`
  - `get(name: string) -> Promise<Blob | undefined>`
  - `keys() -> Promise<string[]>`

- [ ] **Step 1: Download JSZip into `vendor/`**

Run (PowerShell):
```powershell
Invoke-WebRequest -Uri "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js" -OutFile "vendor/jszip.min.js"
```
Verify it is a real file (~90 KB) and exposes the global:
Run: `grep -c "JSZip" vendor/jszip.min.js`
Expected: a non-zero count.
If the download is blocked by the network, obtain `jszip.min.js` (v3.10.1) by other means and place it at `vendor/jszip.min.js`; the file must define a global `JSZip`.

- [ ] **Step 2: Add the JSZip script tag to `index.html`**

After the existing SheetJS script tag, add JSZip so both globals load before the module:

```html
  <script src="vendor/xlsx.full.min.js"></script>
  <script src="vendor/jszip.min.js"></script>
  <script type="module" src="src/app.js"></script>
```

- [ ] **Step 3: Create `src/exampleStore.js`**

```js
// Persistence for the binary Examples files (PDFs/images) in IndexedDB, keyed
// by bare filename. The parsed checklist model stays in localStorage; only the
// large binaries live here.
const DB_NAME = 'dpchecklist';
const STORE = 'examples';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function clear() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, 'readwrite');
    t.objectStore(STORE).clear();
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

export async function putAll(fileMap) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, 'readwrite');
    const store = t.objectStore(STORE);
    for (const [name, blob] of fileMap) store.put(blob, name);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

export async function get(name) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const r = db.transaction(STORE, 'readonly').objectStore(STORE).get(name);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export async function keys() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const r = db.transaction(STORE, 'readonly').objectStore(STORE).getAllKeys();
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
```

- [ ] **Step 4: Sanity-check the module loads (no syntax errors)**

Run: `node --check src/exampleStore.js`
Expected: no output (exit 0). (This only checks syntax; runtime behavior is verified in Task 7.)

- [ ] **Step 5: Commit**

```bash
git add vendor/jszip.min.js src/exampleStore.js index.html
git commit -m "feat: vendor JSZip and add IndexedDB example store"
```

---

### Task 5: Add the ZIP read/write helpers

Wraps JSZip for reading the setup ZIP and building the export ZIP. No `node:test` (JSZip is a browser global); verified in Task 7.

**Files:**
- Create: `src/zipBundle.js`

**Interfaces:**
- Consumes: global `JSZip`.
- Produces (`src/zipBundle.js`, named exports):
  - `readSetupZip(arrayBuffer) -> Promise<{ workbookArrayBuffer: ArrayBuffer, files: Map<string, Blob> }>`
  - `buildExportZip({ workbookName: string, workbookArrayBuffer: ArrayBuffer|Uint8Array, files: Map<string, Blob> }) -> Promise<Blob>`

- [ ] **Step 1: Create `src/zipBundle.js`**

```js
/* global JSZip */
// Read/write the setup and export ZIP bundles. The setup ZIP holds the
// workbook (.xlsx) at its root and an Examples/ subfolder of PDFs/images; the
// export ZIP mirrors that shape.

function isJunk(path) {
  return /(^|\/)__MACOSX\//.test(path) || /(^|\/)\.DS_Store$/.test(path);
}

export async function readSetupZip(arrayBuffer) {
  const zip = await JSZip.loadAsync(arrayBuffer);
  const entries = [];
  zip.forEach((path, entry) => { if (!entry.dir && !isJunk(path)) entries.push({ path, entry }); });

  let workbookArrayBuffer = null;
  const files = new Map();
  for (const { path, entry } of entries) {
    const parts = path.split('/');
    const name = parts[parts.length - 1];
    if (parts.length === 1 && /\.xlsx$/i.test(name)) {
      if (workbookArrayBuffer) throw new Error('ZIP has more than one .xlsx at its root');
      workbookArrayBuffer = await entry.async('arraybuffer');
    } else if (/^examples\//i.test(path) && name) {
      files.set(name, await entry.async('blob'));
    }
  }
  if (!workbookArrayBuffer) throw new Error('ZIP has no .xlsx workbook at its root');
  return { workbookArrayBuffer, files };
}

export async function buildExportZip({ workbookName, workbookArrayBuffer, files }) {
  const zip = new JSZip();
  zip.file(workbookName, workbookArrayBuffer);
  const examples = zip.folder('Examples');
  for (const [name, blob] of files) examples.file(name, blob);
  return zip.generateAsync({ type: 'blob', mimeType: 'application/zip' });
}
```

- [ ] **Step 2: Sanity-check the module loads**

Run: `node --check src/zipBundle.js`
Expected: no output (exit 0).

- [ ] **Step 3: Commit**

```bash
git add src/zipBundle.js
git commit -m "feat: add ZIP read/write helpers"
```

---

### Task 6: Wire setup ZIP import and Download ZIP export into the app

Connects the new modules: the Settings file input accepts a ZIP and persists Examples; the project screen gets a **Download ZIP** button that builds the hyperlinked workbook and bundles referenced files.

**Files:**
- Modify: `src/app.js` (imports; `handleSetupFile`; sheet-name helper; `downloadProjectZip`; `init` wiring)
- Modify: `index.html` (Settings input `accept` + helper text; project-screen Download ZIP button)

**Interfaces:**
- Consumes: `buildExportPlan` (Task 3); `exampleStore.*` (Task 4); `readSetupZip`, `buildExportZip` (Task 5); global `XLSX`.
- Produces: app behavior; no exports consumed by later tasks.

- [ ] **Step 1: Add imports at the top of `src/app.js`**

Update the import block:

```js
import { buildModel } from './workbookModel.js';
import { createProjectStore } from './projectStore.js';
import { computeProgress, computeProjectProgress, applicableItems, buildExportPlan } from './exporter.js';
import * as exampleStore from './exampleStore.js';
import { readSetupZip, buildExportZip } from './zipBundle.js';
```

- [ ] **Step 2: Replace `handleWorkbookFile` with `handleSetupFile` in `src/app.js`**

Replace the existing `handleWorkbookFile` function with:

```js
async function handleSetupFile(file) {
  try {
    setStatus('Reading setup…');
    const buffer = await file.arrayBuffer();
    let workbookBuffer = buffer;
    let files = new Map();
    if (/\.zip$/i.test(file.name)) {
      const res = await readSetupZip(buffer);
      workbookBuffer = res.workbookArrayBuffer;
      files = res.files;
    }
    const workbook = XLSX.read(workbookBuffer, { type: 'array' });
    const model = loadModelFromWorkbook(workbook);
    state.model = model;
    persistModel(model);
    await exampleStore.clear();
    if (files.size) await exampleStore.putAll(files);
    setStatus(`Loaded ${model.items.length} items, ${model.inputs.length} inputs, ${files.size} example file${files.size === 1 ? '' : 's'}.`, 'ok');
  } catch (err) {
    state.model = null;
    setStatus('Could not load setup: ' + err.message, 'error');
  }
}
```

- [ ] **Step 3: Update `wireSetup` to call `handleSetupFile`**

```js
function wireSetup() {
  document.getElementById('workbook-file').addEventListener('change', e => {
    const file = e.target.files[0];
    if (file) handleSetupFile(file);
  });
}
```

- [ ] **Step 4: Add a sheet-name helper and `downloadProjectZip` to `src/app.js`**

Add just above `saveProjectFile`:

```js
function sanitizeSheetName(name, used) {
  let base = String(name || 'Unit').replace(/[\[\]:*?/\\]/g, ' ').trim().slice(0, 31) || 'Unit';
  let candidate = base;
  let n = 2;
  while (used.has(candidate)) {
    const suffix = ' (' + n + ')';
    candidate = base.slice(0, 31 - suffix.length) + suffix;
    n++;
  }
  used.add(candidate);
  return candidate;
}

async function downloadProjectZip() {
  const project = getCurrentProject();
  const plan = buildExportPlan(state.model, project);
  const wb = XLSX.utils.book_new();
  const used = new Set();
  for (const unit of plan.units) {
    const header = ['Item ID', 'Description', 'Code', 'Comments', 'Example'];
    const aoa = [header, ...unit.rows.map(r => [r.id, r.description, r.code, r.comment, r.exampleFile || r.example])];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [{ wch: 10 }, { wch: 42 }, { wch: 14 }, { wch: 28 }, { wch: 40 }];
    // Example column is index 4; file rows get a relative hyperlink to Examples/.
    unit.rows.forEach((r, i) => {
      if (!r.exampleFile) return;
      const addr = XLSX.utils.encode_cell({ r: i + 1, c: 4 });
      if (!ws[addr]) ws[addr] = { t: 's', v: r.exampleFile };
      ws[addr].l = { Target: 'Examples/' + r.exampleFile, Tooltip: 'Open ' + r.exampleFile };
    });
    XLSX.utils.book_append_sheet(wb, ws, sanitizeSheetName(unit.name, used));
  }
  const workbookArrayBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });

  const files = new Map();
  const missing = [];
  for (const name of plan.referencedFiles) {
    const blob = await exampleStore.get(name);
    if (blob) files.set(name, blob);
    else missing.push(name);
  }

  const safeName = project.name.replace(/[^\w\-]+/g, '_');
  const date = new Date().toISOString().slice(0, 10);
  const zipBlob = await buildExportZip({
    workbookName: `${safeName}_unchecked_${date}.xlsx`,
    workbookArrayBuffer,
    files,
  });
  downloadBlob(zipBlob, `${safeName}_${date}.zip`);
  if (missing.length) {
    alert(`Exported. These referenced files weren't in your library:\n${missing.join('\n')}`);
  }
}
```

- [ ] **Step 5: Wire the Download ZIP button in `init()`**

Add next to the other project-action listeners (where `btn-save-project` is wired):

```js
  document.getElementById('btn-download-zip').addEventListener('click', downloadProjectZip);
```

- [ ] **Step 6: Update `index.html` — Settings input and helper text**

Replace the Setup file input and its description:

```html
      <p class="muted">Upload a setup <code>.zip</code> containing your checklist workbook
        (<code>.xlsx</code>) at the root and an <code>Examples</code> subfolder of the PDFs and
        images its Example column references. A bare <code>.xlsx</code> also works (no examples).
        Nothing is uploaded &mdash; everything stays in your browser.</p>
      <input type="file" id="workbook-file" accept=".zip,.xlsx,.xls" />
```

- [ ] **Step 7: Update `index.html` — Download ZIP button**

Replace the project-screen button row (from Task 1 it currently holds only `btn-save-project`):

```html
        <div class="btn-row">
          <button id="btn-save-project">Save project file</button>
          <button id="btn-download-zip" class="btn-primary">Download ZIP</button>
        </div>
```

- [ ] **Step 8: Confirm the suite still passes and app parses**

Run: `node --test`
Expected: PASS (42 tests).
Run: `node --check src/app.js`
Expected: exit 0.

- [ ] **Step 9: Commit**

```bash
git add src/app.js index.html
git commit -m "feat: wire setup ZIP import and Download ZIP export"
```

---

### Task 7: Sample setup ZIP, end-to-end smoke test, and README

Build a sample setup ZIP from the repo's existing assets, run the browser smoke test end-to-end, and update the docs.

**Files:**
- Create: `tools/build-sample-setup-zip.mjs` (assembles a sample setup ZIP for testing)
- Modify: `README.md` (document the ZIP workflow; drop the removed HTML report step)

**Interfaces:**
- Consumes: existing `ExampleChecklist.xlsx` and `examples/*.png`.
- Produces: `SampleSetup.zip` (git-ignored test artifact, not committed).

- [ ] **Step 1: Create `tools/build-sample-setup-zip.mjs`**

Zero-dependency Node script (Node 24 here) that writes a store-only ZIP containing the workbook at the root and the two example PNGs under `Examples/`. (Store-only is valid ZIP and avoids any dependency.)

```js
// Build SampleSetup.zip: ExampleChecklist.xlsx at root + Examples/*.png.
// Store-only (no compression) — valid ZIP, zero dependencies.
import { readFileSync, writeFileSync } from 'node:fs';
import { crc32 } from 'node:zlib';

function entry(name, data) {
  return { name: Buffer.from(name), data, crc: crc32(data) >>> 0 };
}
function leUint(n, bytes) {
  const b = Buffer.alloc(bytes);
  if (bytes === 2) b.writeUInt16LE(n); else b.writeUInt32LE(n);
  return b;
}
function build(entries) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const e of entries) {
    const header = Buffer.concat([
      leUint(0x04034b50, 4), leUint(20, 2), leUint(0, 2), leUint(0, 2),
      leUint(0, 2), leUint(0, 2), leUint(e.crc, 4),
      leUint(e.data.length, 4), leUint(e.data.length, 4),
      leUint(e.name.length, 2), leUint(0, 2), e.name, e.data,
    ]);
    locals.push(header);
    central.push(Buffer.concat([
      leUint(0x02014b50, 4), leUint(20, 2), leUint(20, 2), leUint(0, 2),
      leUint(0, 2), leUint(0, 2), leUint(0, 2), leUint(e.crc, 4),
      leUint(e.data.length, 4), leUint(e.data.length, 4), leUint(e.name.length, 2),
      leUint(0, 2), leUint(0, 2), leUint(0, 2), leUint(0, 2), leUint(0, 4),
      leUint(offset, 4), e.name,
    ]));
    offset += header.length;
  }
  const centralBuf = Buffer.concat(central);
  const end = Buffer.concat([
    leUint(0x06054b50, 4), leUint(0, 2), leUint(0, 2),
    leUint(entries.length, 2), leUint(entries.length, 2),
    leUint(centralBuf.length, 4), leUint(offset, 4), leUint(0, 2),
  ]);
  return Buffer.concat([...locals, centralBuf, end]);
}

const entries = [
  entry('ExampleChecklist.xlsx', readFileSync('ExampleChecklist.xlsx')),
  entry('Examples/a08-weather-seal.png', readFileSync('examples/a08-weather-seal.png')),
  entry('Examples/a10-cwt-safety.png', readFileSync('examples/a10-cwt-safety.png')),
];
writeFileSync('SampleSetup.zip', build(entries));
console.log('Wrote SampleSetup.zip');
```

- [ ] **Step 2: Build the sample ZIP and ignore the artifact**

Run: `node tools/build-sample-setup-zip.mjs`
Expected: `Wrote SampleSetup.zip`.
Add `SampleSetup.zip` to `.gitignore` (append the line if not present).

- [ ] **Step 3: Browser smoke test (per the browser-smoke-test-harness memory)**

Serve and drive Edge headless via CDP (reuse the `smoke.mjs` driver pattern from the harness memory):
1. `python -m http.server 8123` in the repo root.
2. Open `http://127.0.0.1:8123/`, go to Settings, upload `SampleSetup.zip` into `#workbook-file`; retry `dispatchEvent(new Event('change'))` until `#setup-status` is non-empty. Expected status text contains `example file` with a count of `2`.
3. Create a project, open it, leave a file-backed item (e.g. A08) unchecked.
4. Monkeypatch `URL.createObjectURL` to capture the Blob, click `#btn-download-zip`, read the Blob as a data URL.
5. Validate the captured ZIP: it contains an `.xlsx` at the root and `Examples/a08-weather-seal.png`; the workbook's Example cell for the unchecked file-backed item has a hyperlink whose target is `Examples/a08-weather-seal.png` (verify with python + openpyxl: `ws.cell(...).hyperlink.target`).

Expected: ZIP contains the workbook + the referenced PNG; the hyperlink target is the relative `Examples/...` path.

- [ ] **Step 4: Update `README.md`**

In the "First use" list: ensure step 1 mentions uploading the setup `.zip` (workbook + `Examples/`), and replace the export step with:

```markdown
5. **Download ZIP** produces a `.zip` containing a spreadsheet of everything still
   outstanding (one worksheet per unit; columns Item ID, Description, Code, Comments,
   Example) alongside an `Examples` subfolder with the referenced PDFs/images. Where an
   item's Example is a file, the Example cell is a **relative hyperlink** — unzip the
   bundle and the links open the adjacent files from `Examples/`.
6. **Save project file** downloads the project as `.json` (back it up or move it to
   another machine); **Import project** loads it back.
```

(Remove the old HTML report bullet if any remnant remains.)

- [ ] **Step 5: Commit**

```bash
git add tools/build-sample-setup-zip.mjs .gitignore README.md
git commit -m "docs: sample setup ZIP, smoke test, and README for ZIP workflow"
```

---

## Self-Review

**Spec coverage:**
- ZIP import (workbook + `Examples/`) → Tasks 5 (`readSetupZip`) + 6 (wiring). ✓
- Persist in IndexedDB → Task 4 (`exampleStore`) + 6 (persist on import). ✓
- Export ZIP, only referenced files, relative hyperlinks → Tasks 3 (`buildExportPlan`) + 5 (`buildExportZip`) + 6 (`downloadProjectZip`). ✓
- Remove HTML report → Task 1. ✓
- `Examples/` naming, `.pdf` detection, `exampleFile`/`isExampleFile` rename → Tasks 2 + Global Constraints. ✓
- Backward-compat bare `.xlsx` import → Task 6 (`handleSetupFile`). ✓
- Missing-file warning → Task 6 (`missing` + `alert`). ✓
- Error handling for bad ZIP (no/multiple `.xlsx`) → Task 5 (`readSetupZip` throws) surfaced by Task 6 `catch`. ✓
- Testing: pure unit tests → Tasks 2, 3; browser smoke → Task 7. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code. ✓

**Type consistency:** `buildExportPlan` shape (`units[].rows[] {id,description,code,comment,example,exampleFile}`, `referencedFiles[]`) is identical in Task 3 (definition) and Task 6 (consumption). `buildExportZip({ workbookName, workbookArrayBuffer, files })` matches between Task 5 and Task 6. `exampleStore` method names (`clear`, `putAll`, `get`, `keys`) match between Task 4 and Task 6. ✓
