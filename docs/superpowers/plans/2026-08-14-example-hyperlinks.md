# Example Hyperlinks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the setup-ZIP-plus-`Examples/`-folder bundle with a single `.xlsx` whose new `Link` column carries example URLs, and make the export a single `.xlsx` whose Example cells link straight to those URLs.

**Architecture:** The pure model (`workbookModel.js`) reads the new optional `Link` column and exposes `item.exampleLink` in place of `item.exampleFile`; the filename-sniffing split of the Example cell disappears. That one field then flows outward: the export plan carries it, the export workbook turns it into an external hyperlink, and the in-app ⓘ button opens it in a new tab. Everything that existed only to move binary files — `zipBundle.js`, `exampleStore.js`, the `examples` IndexedDB store, JSZip — is deleted.

**Tech Stack:** Vanilla ES modules, no build step. Vendored `xlsx-js-style` as the browser global `XLSX`. Tests: Node's built-in runner (`node --test`) over the dependency-free modules in `src/`.

**Spec:** `docs/superpowers/specs/2026-08-14-example-hyperlinks-design.md`

## Global Constraints

- **No framework, no bundler, no new runtime deps.** Pure browser, offline-capable app.
- **Pure logic stays pure.** Modules under test (`workbookModel.js`, `exporter.js`, `exportWorkbook.js`) must not touch `document`, `indexedDB`, or a global `XLSX` — `exportWorkbook.js` takes `XLSX` as an injected parameter.
- **`db.js` owns the IndexedDB schema.** Bump the version there and nowhere else.
- **CSS is token-driven and theme-aware.** No hardcoded `#fff`-style colors.
- **Button labels are Title Case** — every word capitalised, including short ones ("Download Workbook", "See Example"). Applies to visible `<button>` text and button-styled labels. Not to headings or field labels.
- **Export naming is unchanged:** base name `<Project Title>_DPVT_Out` (outstanding) / `<Project Title>_DPVT_All` (full). Project **title only** — the project number never appears in a file name. Spaces are kept; only filename-illegal characters `\ / : * ? " < > |` are stripped.
- **Per-item export column order:** `Item ID, Description, Code, Comments, Example` (outstanding) and `Item ID, Description, Code, Status, Comments, Example` (full). The `Note` column is never exported. `S`-prefixed items are excluded from the outstanding export only.
- **Commit after every task.** Never push; never merge to `main` without explicit authorization.

## File Structure

| File | Change | Responsibility after this plan |
|---|---|---|
| `src/workbookModel.js` | Modify | Reads `Example` (required) + `Link` (optional); emits `example` / `exampleLink` |
| `src/exporter.js` | Modify | Plan rows carry `exampleLink`; `referencedFiles` and dead `buildExportRows` deleted |
| `src/exportWorkbook.js` | Modify | Example cell becomes an external hyperlink to the URL; Overview notes rewritten |
| `src/app.js` | Modify | Single-`.xlsx` import, URL-opening viewer, single-`.xlsx` download |
| `src/db.js` | Modify | Schema v3 — `examples` store dropped |
| `index.html` | Modify | Setup copy + `accept`, export button labels, JSZip `<script>` removed |
| `styles.css` | Modify | `.lightbox` block removed |
| `src/zipBundle.js` | **Delete** | — |
| `src/exampleStore.js` | **Delete** | — |
| `vendor/jszip.min.js` | **Delete** | — |
| `tests/exampleStore.test.js` | **Delete** | — |
| `tests/exportWorkbook.test.js` | **Create** | Asserts the Example cell's hyperlink target and text |
| `tools/build-sample-workbook.py` | Modify | Emits a `Link` column |
| `tools/build-sample-setup-zip.mjs`, `SampleSetup.zip`, `examples/` | **Delete** | — |
| `README.md`, `CLAUDE.md` | Modify | Docs match the new contract |

---

### Task 1: Model reads the Link column

**Files:**
- Modify: `src/workbookModel.js:10`, `:28-37`, `:98-132`
- Test: `tests/workbookModel.test.js`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: every item in `buildModel(...).items` gains `exampleLink: string` (an absolute `http(s)` URL or `''`) and `example: string` (the Example cell verbatim). **`exampleFile` no longer exists** — Tasks 2, 3, 4 and 5 rely on this.

- [ ] **Step 1: Write the failing tests**

In `tests/workbookModel.test.js`, **replace** the two tests at the end of the file (`'a prose Example is text, with no exampleFile'` and `'an Example cell that is a file name becomes exampleFile (image or pdf)'`) with:

```js
test('a Link URL becomes exampleLink, with Example kept as the label', () => {
  const rows = [
    ['Item ID', 'Conditions', 'Description', 'Code', 'Note', 'Example', 'Link', 'HyperLink'],
    ['A08', '', 'Weather', 'AS3000', '', 'ShaftVentilation.png', 'https://dropbox.com/s/abc/ShaftVentilation.PNG?dl=0', 'ShaftVentilation.png'],
  ];
  const model = buildModel({ checklistRows: rows, inputRows });
  assert.equal(model.items[0].example, 'ShaftVentilation.png');
  assert.equal(model.items[0].exampleLink, 'https://dropbox.com/s/abc/ShaftVentilation.PNG?dl=0');
});

test('an Example with no Link stays plain text', () => {
  const rows = [
    ['Item ID', 'Conditions', 'Description', 'Code', 'Note', 'Example', 'Link'],
    ['A09', '', 'Lobby', 'SL', '', 'Provide a protected lobby.', ''],
  ];
  const model = buildModel({ checklistRows: rows, inputRows });
  assert.equal(model.items[0].example, 'Provide a protected lobby.');
  assert.equal(model.items[0].exampleLink, '');
});

test('a Link that is not an http(s) URL is ignored', () => {
  const rows = [
    ['Item ID', 'Conditions', 'Description', 'Code', 'Note', 'Example', 'Link'],
    ['A10', '', 'Spec', 'EN81', '', 'a10-spec.pdf', 'C:\\shared\\a10-spec.pdf'],
    ['A11', '', 'Spec', 'EN81', '', 'a11-spec.pdf', 'see the drive'],
  ];
  const model = buildModel({ checklistRows: rows, inputRows });
  assert.equal(model.items[0].exampleLink, '');
  assert.equal(model.items[1].exampleLink, '');
});

test('a workbook with no Link column still loads', () => {
  const model = buildModel({ checklistRows, inputRows });
  assert.equal(model.items[0].example, 'Seal the enclosure');
  assert.equal(model.items[0].exampleLink, '');
});

test('a Link value is trimmed', () => {
  const rows = [
    ['Item ID', 'Conditions', 'Description', 'Code', 'Note', 'Example', 'Link'],
    ['A12', '', 'x', '', '', 'x.png', '  https://dropbox.com/s/x.png  '],
  ];
  const model = buildModel({ checklistRows: rows, inputRows });
  assert.equal(model.items[0].exampleLink, 'https://dropbox.com/s/x.png');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/workbookModel.test.js`
Expected: FAIL — `exampleLink` is `undefined` (the model does not read `Link` yet).

- [ ] **Step 3: Add optional-column support to `headerIndex`**

In `src/workbookModel.js`, replace the `headerIndex` function (line 16) with:

```js
function headerIndex(rows, requiredCols, sheetName, optionalCols = []) {
  if (!rows || rows.length === 0) throw new ModelError(`Sheet "${sheetName}" is empty`);
  const header = rows[0].map(c => String(c ?? '').trim());
  const idx = {};
  for (const col of requiredCols) {
    const i = header.indexOf(col);
    if (i === -1) throw new ModelError(`Sheet "${sheetName}" is missing required column: ${col}`);
    idx[col] = i;
  }
  // Optional columns are simply absent from idx when the sheet omits them;
  // cell() then reads undefined and yields ''.
  for (const col of optionalCols) {
    const i = header.indexOf(col);
    if (i !== -1) idx[col] = i;
  }
  return idx;
}
```

Then make `cell` explicit about a missing column — replace the function at line 28:

```js
function cell(row, i) {
  if (i === undefined) return ''; // column not present in this workbook
  const v = row[i];
  return v === undefined || v === null ? '' : String(v).trim();
}
```

- [ ] **Step 4: Read the Link column into `exampleLink`**

Replace the `CHECKLIST_COLS` constant (line 10) with:

```js
const CHECKLIST_COLS = ['Item ID', 'Conditions', 'Description', 'Code', 'Note', 'Example'];
// "Link" holds the example's URL. Optional so older workbooks still load.
// The workbook's third example column, "HyperLink", is a =HYPERLINK(Link,Example)
// formula for humans reading the spreadsheet — its cached value carries no
// target, so it is never read.
const CHECKLIST_OPTIONAL_COLS = ['Link'];
```

Replace the `isExampleFile` function (lines 33-37) with:

```js
// A Link cell counts as a target only when it is an absolute http(s) URL.
function isUrl(value) {
  return /^https?:\/\//i.test(String(value).trim());
}
```

In `buildItems`, change the `headerIndex` call (line 99) to pass the optional columns:

```js
  const idx = headerIndex(checklistRows, CHECKLIST_COLS, 'Checklist', CHECKLIST_OPTIONAL_COLS);
```

and replace the two `example:` / `exampleFile:` properties (lines 126-128) with:

```js
      // Example is the display label (usually a file name); Link is its URL.
      example: cell(row, idx['Example']),
      exampleLink: isUrl(cell(row, idx['Link'])) ? cell(row, idx['Link']) : '',
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test tests/workbookModel.test.js`
Expected: PASS — all tests, including the pre-existing ones.

- [ ] **Step 6: Commit**

```bash
git add src/workbookModel.js tests/workbookModel.test.js
git commit -m "feat: read example URLs from the checklist Link column"
```

---

### Task 2: Export plan carries the link

**Files:**
- Modify: `src/exporter.js:27-37` (delete), `:39-83`
- Test: `tests/exporter.test.js`

**Interfaces:**
- Consumes: `item.exampleLink` from Task 1.
- Produces: `buildExportPlan(model, project, { mode })` returns `{ units: [{ name, rows }] }` where each row is `{ id, description, code, comment, example, exampleLink, section, sectionPrefix }` (plus `status` in `full` mode). **`plan.referencedFiles` no longer exists**; Task 5 relies on that.

- [ ] **Step 1: Write the failing tests**

In `tests/exporter.test.js`:

**(a)** Remove `buildExportRows` from the import on line 4 so it reads:

```js
import { applicableItems, computeProgress, computeProjectProgress, buildExportPlan } from '../src/exporter.js';
```

**(b)** Delete the whole `test('buildExportRows lists applicable unchecked items with header', ...)` block (lines 42-56) — the function is dead code and goes away in Step 3.

**(c)** Delete the whole `test('buildExportPlan collects referenced files once, in order', ...)` block and the whole `test('buildExportPlan full mode collects example files for all statuses', ...)` block.

**(d)** In `test('buildExportPlan excludes items whose ID starts with S (Schindler)')`, delete the line `assert.deepEqual(plan.referencedFiles, ['a08.png']);`.

**(e)** Replace the `test('buildExportPlan returns per-unit outstanding rows', ...)` block with:

```js
test('buildExportPlan returns per-unit outstanding rows carrying the example link', () => {
  const rows = [
    ['Item ID', 'Conditions', 'Description', 'Code', 'Note', 'Example', 'Link'],
    ['A08', '', 'Always applies', 'AS3000', '', 'a08.png', 'https://dropbox.com/s/a08.png'],
    ['A10', '', 'Second item', 'EN81', '', 'Prose guidance', ''],
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
  // Unit 1: A08 checked -> only A10 outstanding (prose, no link)
  assert.deepEqual(plan.units[0].rows.map(r => r.id), ['A10']);
  assert.equal(plan.units[0].rows[0].comment, 'note');
  assert.equal(plan.units[0].rows[0].exampleLink, '');
  assert.equal(plan.units[0].rows[0].example, 'Prose guidance');
  // Unit 2: nothing checked -> A08 (linked) + A10 (prose)
  assert.deepEqual(plan.units[1].rows.map(r => r.id), ['A08', 'A10']);
  assert.equal(plan.units[1].rows[0].example, 'a08.png');
  assert.equal(plan.units[1].rows[0].exampleLink, 'https://dropbox.com/s/a08.png');
});

test('buildExportPlan no longer reports referenced files', () => {
  const rows = [
    ['Item ID', 'Conditions', 'Description', 'Code', 'Note', 'Example', 'Link'],
    ['A08', '', 'Item', 'AS3000', '', 'a08.png', 'https://dropbox.com/s/a08.png'],
  ];
  const m = buildModel({ checklistRows: rows, inputRows });
  const project = { units: [{ name: 'U', inputs: {}, checks: {}, comments: {} }] };
  assert.equal(buildExportPlan(m, project).referencedFiles, undefined);
});

test('buildExportPlan full mode carries the link on every status', () => {
  const rows = [
    ['Item ID', 'Conditions', 'Description', 'Code', 'Note', 'Example', 'Link'],
    ['A08', '', 'x', 'AS3000', '', 'a08.png', 'https://dropbox.com/s/a08.png'],
    ['A10', 'PitToEarth: FALSE', 'x', 'EN81', '', 'a10.png', 'https://dropbox.com/s/a10.png'],
  ];
  const m = buildModel({ checklistRows: rows, inputRows });
  const project = { units: [{ name: 'U', inputs: { PitToEarth: true }, checks: { A08: true }, comments: {} }] };
  const plan = buildExportPlan(m, project, { mode: 'full' });
  // A08 done, A10 na — both keep their link.
  assert.deepEqual(plan.units[0].rows.map(r => r.exampleLink),
    ['https://dropbox.com/s/a08.png', 'https://dropbox.com/s/a10.png']);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/exporter.test.js`
Expected: FAIL — rows have `exampleFile`, not `exampleLink`, and `referencedFiles` is still returned.

- [ ] **Step 3: Delete `buildExportRows` and carry the link**

In `src/exporter.js`, delete the entire `buildExportRows` function (lines 27-37). Nothing in `src/` imports it.

In `buildExportPlan`, replace the `exampleFile` line in `base` (line 51) with:

```js
      exampleLink: item.exampleLink || '',
```

and replace the `referencedFiles` block plus the return (lines 72-82) with:

```js
  return { units };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/exporter.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/exporter.js tests/exporter.test.js
git commit -m "feat: carry example links through the export plan"
```

---

### Task 3: Export workbook links the Example cell to the URL

**Files:**
- Modify: `src/exportWorkbook.js:44-61`, `:181-188`, `:238-243`, `:280-285`
- Create: `tests/exportWorkbook.test.js`

**Interfaces:**
- Consumes: plan rows with `example` / `exampleLink` from Task 2.
- Produces: no signature change — `buildExportWorkbook({ XLSX, model, project, plan, reviewDate, mode })` still returns a workbook object. Task 5 calls it unchanged.

- [ ] **Step 1: Write the failing test**

Create `tests/exportWorkbook.test.js`. The module takes `XLSX` as a parameter, so a ~20-line stub covers the four helpers it uses and lets us assert on raw cells:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildModel } from '../src/workbookModel.js';
import { buildExportPlan } from '../src/exporter.js';
import { buildExportWorkbook } from '../src/exportWorkbook.js';

// Minimal stand-in for the vendored xlsx-js-style global. buildExportWorkbook
// only uses these four helpers, so the real library is not needed to assert on
// the cells it writes.
const A1 = ({ r, c }) => String.fromCharCode(65 + c) + (r + 1);
const XLSX = {
  utils: {
    encode_cell: A1,
    encode_range: ({ s, e }) => A1(s) + ':' + A1(e),
    book_new: () => ({ SheetNames: [], Sheets: {} }),
    book_append_sheet: (wb, ws, name) => { wb.SheetNames.push(name); wb.Sheets[name] = ws; },
  },
};

const inputRows = [['Name', 'Type', 'Label', 'Unit', 'Choices', 'Default']];
const checklistRows = [
  ['Item ID', 'Conditions', 'Description', 'Code', 'Note', 'Example', 'Link'],
  ['A08', '', 'Weather seal', 'AS3000', '', 'ShaftVentilation.png', 'https://dropbox.com/s/abc.png'],
  ['A09', '', 'Protected lobby', 'SL', '', 'Provide a protected lobby.', ''],
];

// Find a cell by the text it carries, across every sheet but the Overview.
function cellWithText(wb, text) {
  for (const name of wb.SheetNames.filter(n => n !== 'Overview')) {
    for (const [addr, cell] of Object.entries(wb.Sheets[name])) {
      if (addr.startsWith('!')) continue;
      if (cell && cell.v === text) return cell;
    }
  }
  return undefined;
}

function build(mode) {
  const model = buildModel({ checklistRows, inputRows });
  const project = { name: 'Smoke Tower', details: {}, units: [{ name: 'Lift 1', inputs: {}, checks: {}, comments: {} }] };
  const plan = buildExportPlan(model, project, { mode });
  return buildExportWorkbook({ XLSX, model, project, plan, reviewDate: '14/08/2026', mode });
}

test('a linked example cell shows the label and hyperlinks to the URL', () => {
  const cell = cellWithText(build('outstanding'), 'ShaftVentilation.png');
  assert.ok(cell, 'expected the example label in a unit sheet');
  assert.equal(cell.l.Target, 'https://dropbox.com/s/abc.png');
  assert.equal(cell.l.Tooltip, 'Open ShaftVentilation.png');
  assert.equal(cell.s.font.underline, true);
});

test('an unlinked example cell is plain text', () => {
  const cell = cellWithText(build('outstanding'), 'Provide a protected lobby.');
  assert.ok(cell, 'expected the prose example in a unit sheet');
  assert.equal(cell.l, undefined);
});

test('the full export links its example cells too', () => {
  const cell = cellWithText(build('full'), 'ShaftVentilation.png');
  assert.ok(cell, 'expected the example label in a full unit sheet');
  assert.equal(cell.l.Target, 'https://dropbox.com/s/abc.png');
});

test('no export note mentions the Examples folder or the ZIP', () => {
  for (const mode of ['outstanding', 'full']) {
    const overview = build(mode).Sheets.Overview;
    const text = Object.entries(overview)
      .filter(([addr]) => !addr.startsWith('!'))
      .map(([, cell]) => String(cell.v || '')).join('\n');
    assert.ok(!/Examples\//.test(text), `${mode}: still mentions the Examples/ folder`);
    assert.ok(!/ZIP/i.test(text), `${mode}: still mentions the ZIP`);
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/exportWorkbook.test.js`
Expected: FAIL. The writer still reads `it.exampleFile` (now always undefined), so the linked item falls into the plain-text branch: the cell exists with the right text but has no `.l`, and the first and third tests die on `Cannot read properties of undefined (reading 'Target')`. The fourth fails because the Overview still mentions `Examples/` and the ZIP. The second test ("plain text") passes already — that is expected.

- [ ] **Step 3: Rewrite the outstanding-sheet Example cell**

In `src/exportWorkbook.js`, replace the `if (it.exampleFile) { … } else { … }` block inside `buildUnitSheet` (lines 238-243) with:

```js
      if (it.exampleLink) {
        const label = it.example || it.exampleLink;
        put(ws, r, 4, label, { font: { color: { rgb: LINK }, underline: true }, alignment: { vertical: 'top' }, border },
          { link: { Target: it.exampleLink, Tooltip: 'Open ' + label } });
      } else {
        put(ws, r, 4, it.example || '', { alignment: { vertical: 'top', wrapText: true }, border });
      }
```

- [ ] **Step 4: Rewrite the full-sheet Example cell**

Replace the matching block inside `buildUnitSheetFull` (lines 280-285) with:

```js
      if (it.exampleLink) {
        const label = it.example || it.exampleLink;
        put(ws, r, 5, label, fullCell(it.status, { link: true, wrap: false }),
          { link: { Target: it.exampleLink, Tooltip: 'Open ' + label } });
      } else {
        put(ws, r, 5, it.example || '', fullCell(it.status));
      }
```

- [ ] **Step 5: Rewrite the Overview how-to notes**

In `NOTES` (lines 44-51), replace the last two entries — the one beginning `'Items with an entry in the Example column link to a supporting file in the Examples/ folder'` and the one beginning `'After downloading, extract the ZIP file.'` — with this single entry:

```js
  'Items with an entry in the Example column link to a supporting file online — click to open it in your browser.',
```

Make the identical replacement for the last two entries of `NOTES_FULL` (lines 53-61).

- [ ] **Step 6: Stop rendering the last note in red**

The Overview colours its final note red because it used to be the "extract the ZIP and
keep the folder structure" warning. The new last note is ordinary guidance, so drop the
special case — in `buildOverviewSheet`, replace the comment and `color` line (lines
184-185) with a plain `INK` font in the `band` call, so the whole `forEach` body reads:

```js
  notes.forEach((note, i) => {
    const text = `${i + 1}.  ${note}`;
    const lines = Math.max(1, Math.ceil(text.length / CHARS_PER_LINE));
    band(ws, r, 0, N - 1, text, { font: { color: { rgb: INK } }, alignment: { vertical: 'top', wrapText: true, indent: 1 } });
    rh(r, 14 + lines * 14); r++;
  });
```

If `RED_SUB` now has no other reference in the file, delete its declaration too — check
with `grep -n "RED_SUB" src/exportWorkbook.js` and leave it alone if anything else uses it.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `node --test tests/exportWorkbook.test.js`
Expected: PASS — all four tests.

- [ ] **Step 8: Run the whole suite**

Run: `npm test`
Expected: PASS. `tests/exampleStore.test.js` still passes at this point (it is deleted in Task 6).

- [ ] **Step 9: Commit**

```bash
git add src/exportWorkbook.js tests/exportWorkbook.test.js
git commit -m "feat: hyperlink exported Example cells to their URLs"
```

---

### Task 4: The in-app example opens its URL

**Files:**
- Modify: `src/app.js:1026`, `:1084-1099`, `:1110-1151`, `:1256`, `:1303`
- Modify: `styles.css:782-814`

**Interfaces:**
- Consumes: `item.exampleLink` from Task 1.
- Produces: `openExample(url)` — takes a URL string, not a filename. This task removes the last caller of `exampleStore.get`, but **leaves the `exampleStore` import in place** (`handleSetupFile` still uses it until Task 6).

- [ ] **Step 1: Replace `openExample` and delete the blob helpers**

In `src/app.js`, delete the `IMAGE_EXT` constant (line 1084), the `CONTENT_TYPE_BY_EXT` map with its comment (lines 1086-1094), and the `contentTypeFor` function (lines 1096-1099).

Replace the whole `openExample` function including its comment (lines 1110-1134) with:

```js
// Open an item's example. The workbook's Link column holds an absolute URL, so
// hand it to the browser in a new tab — images and PDFs alike.
function openExample(url) {
  if (!url) return;
  window.open(url, '_blank', 'noopener');
}
```

Delete the entire `showLightbox` function (lines 1136-1151) — nothing calls it now.

- [ ] **Step 2: Point the item button and the editor button at the link**

In `renderItems`, replace the example-button line (line 1026) with:

```js
        ${item.exampleLink ? `<button type="button" class="item-info" data-example="${escapeHtml(item.exampleLink)}" title="View example" aria-label="View example for ${escapeHtml(item.id)}">${INFO_ICON}</button>` : ''}
```

In `renderItemEditor`, replace the See Example button line (line 1256) with:

```js
    ${item.exampleLink ? `<button type="button" id="ed-see-example" class="ed-see-example">See Example</button>` : ''}`;
```

and its click handler (line 1303) with:

```js
  if (exampleBtn) exampleBtn.addEventListener('click', () => openExample(item.exampleLink));
```

- [ ] **Step 3: Delete the lightbox CSS**

In `styles.css`, delete the whole `/* ---- Example lightbox ---- */` block — the heading comment (line 782) and the `.lightbox`, `.lightbox-fig`, `.lightbox-fig img` and `.lightbox-fig figcaption` rules (lines 784-814), up to but not including the `/* ---- About tables ---- */` heading.

- [ ] **Step 4: Syntax-check**

Run: `node --check src/app.js`
Expected: no output (success).

- [ ] **Step 5: Commit**

```bash
git add src/app.js styles.css
git commit -m "feat: open item examples as links in a new tab"
```

---

### Task 5: Export downloads a single workbook

**Files:**
- Modify: `src/app.js:522-531`, `:1359-1396`, `:1658`
- Modify: `index.html:182-183`, `:267-268`

**Interfaces:**
- Consumes: `buildExportPlan` without `referencedFiles` (Task 2), `buildExportWorkbook` (Task 3).
- Produces: `downloadProjectWorkbook(project, mode)` replaces `downloadProjectZip`. Not `async` — nothing in it awaits. This removes the last caller of `exampleStore` from the export path and the only caller of `buildExportZip`.

- [ ] **Step 1: Replace `downloadProjectZip`**

In `src/app.js`, replace the entire `downloadProjectZip` function (lines 1359-1396) with:

```js
function downloadProjectWorkbook(project = getCurrentProject(), mode = 'outstanding') {
  if (!project) return;
  try {
    const plan = buildExportPlan(state.model, project, { mode });
    const now = new Date();
    const reviewDate = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;
    const wb = buildExportWorkbook({ XLSX, model: state.model, project, plan, reviewDate, mode });
    const data = XLSX.write(wb, { bookType: 'xlsx', type: 'array', cellStyles: true });

    // Project title only (never the project number); keep its spaces and strip
    // only characters illegal in file names. The mode is named outright rather
    // than suffixed, and abbreviated to keep names short:
    // "Smoke Tower_DPVT_Out" (outstanding) / "Smoke Tower_DPVT_All" (all items).
    const safeTitle = (project.name || 'Project').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Project';
    const base = `${safeTitle}_DPVT_${mode === 'full' ? 'All' : 'Out'}`;
    const type = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    downloadBlob(new Blob([data], { type }), `${base}.xlsx`);
  } catch (err) {
    alert('Could not build the workbook: ' + err.message);
  }
}
```

- [ ] **Step 2: Update the two dropdown call sites**

In `wireExportDropdown`, replace line 525 with:

```js
    if (p) downloadProjectWorkbook(p, 'full');
```

and line 530 with:

```js
    if (p) downloadProjectWorkbook(p, 'outstanding');
```

- [ ] **Step 3: Rename the ZIP-named controls in `index.html`**

Replace the dashboard export button's opening tag (lines 182-183) with:

```html
                <button id="dash-export" class="icon-btn" type="button" title="Export Workbook" aria-haspopup="true"
                  aria-expanded="false" aria-label="Export Workbook">
```

Replace the project-screen export button (lines 267-268) with:

```html
              <button id="btn-download-zip" class="btn-primary" type="button" aria-haspopup="true"
                aria-expanded="false">Download Workbook</button>
```

Leave the element ids alone — `app.js:1658` wires `btn-download-zip` by id, and the dropdown items (**All Items** / **Outstanding**) are unchanged.

- [ ] **Step 4: Syntax-check**

Run: `node --check src/app.js`
Expected: no output (success).

- [ ] **Step 5: Commit**

```bash
git add src/app.js index.html
git commit -m "feat: export a single workbook instead of a ZIP bundle"
```

---

### Task 6: Setup takes one workbook; the ZIP machinery goes

**Files:**
- Modify: `src/app.js:5-6`, `:94-110`, `:248-277`
- Modify: `src/db.js:1-23`
- Modify: `index.html:112-116`, `:406`
- Delete: `src/zipBundle.js`, `src/exampleStore.js`, `tests/exampleStore.test.js`, `vendor/jszip.min.js`

**Interfaces:**
- Consumes: nothing new. Tasks 4 and 5 must be done first — they removed every other reader of `exampleStore`.
- Produces: `handleSetupFile(file)` reads a bare `.xlsx`; IndexedDB is at v3 with stores `projects` and `kv` only.

- [ ] **Step 1: Simplify `handleSetupFile` and drop the two imports**

In `src/app.js`, delete the import lines 5-6:

```js
import * as exampleStore from './exampleStore.js';
import { readSetupZip, buildExportZip } from './zipBundle.js';
```

Replace the whole `handleSetupFile` function (lines 248-270) with:

```js
async function handleSetupFile(file) {
  try {
    setStatus('Reading workbook…');
    const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    const model = loadModelFromWorkbook(workbook);
    state.model = model;
    markModelDirty();
    setStatus(`Loaded ${model.items.length} items, ${model.inputs.length} inputs.`, 'ok');
  } catch (err) {
    state.model = null;
    setStatus('Could not load setup: ' + err.message, 'error');
  }
}
```

- [ ] **Step 2: Round-trip the Link column through `rebuildModel`**

`rebuildModel` reconstructs a model from the serialized copy in IndexedDB or a backup file. Replace its `checklistRows` block (lines 99-102) with:

```js
  const checklistRows = [
    ['Item ID', 'Conditions', 'Description', 'Code', 'Note', 'Example', 'Link'],
    // A model saved before examples became links stored the file name in
    // `exampleFile` and left `example` empty; keep it as the label.
    ...data.items.map(i => [i.id, i.conditionsText, i.description, i.code, i.note,
      i.example || i.exampleFile || '', i.exampleLink || '']),
  ];
```

- [ ] **Step 3: Bump the IndexedDB schema to v3**

In `src/db.js`, replace lines 1-5 with:

```js
// The one place that defines the IndexedDB schema for the whole app.
// Stores: projects (id -> project), kv (key -> value).
const DB_NAME = 'dpchecklist';
const VERSION = 3;
const STORES = ['projects', 'kv'];
```

and replace the `onupgradeneeded` handler (lines 13-18) with:

```js
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of STORES) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
      }
      // v3 dropped the example-file blob store — examples are URLs now.
      if (db.objectStoreNames.contains('examples')) db.deleteObjectStore('examples');
    };
```

- [ ] **Step 4: Update the setup screen copy and drop JSZip**

In `index.html`, replace the setup paragraph and file input (lines 112-116) with:

```html
        <p class="muted">Upload your checklist workbook (<code>.xlsx</code>). Nothing is
          uploaded &mdash; everything stays in your browser.</p>
        <input type="file" id="workbook-file" accept=".xlsx" />
```

Delete the JSZip script tag (line 406):

```html
  <script src="vendor/jszip.min.js"></script>
```

- [ ] **Step 5: Delete the dead modules**

```bash
git rm src/zipBundle.js src/exampleStore.js tests/exampleStore.test.js vendor/jszip.min.js
```

- [ ] **Step 6: Verify nothing still references them**

Run: `grep -rn "exampleStore\|zipBundle\|JSZip\|exampleFile" src/ tests/ index.html`
Expected: exactly one hit — the `i.exampleFile` backwards-compatibility fallback added in Step 2. Anything else is a leftover to fix.

- [ ] **Step 7: Syntax-check and run the suite**

Run: `node --check src/app.js && node --check src/db.js && npm test`
Expected: PASS, with no `exampleStore` test in the run.

- [ ] **Step 8: Commit**

```bash
git add -A src tests index.html
git commit -m "feat: take a single .xlsx as setup and drop the ZIP machinery"
```

---

### Task 7: Docs and sample data

**Files:**
- Modify: `tools/build-sample-workbook.py:12-41`
- Modify: `README.md:33-36`, `:43-49`, `:63`, `:77`, `:87-98`, `:161-162`
- Modify: `CLAUDE.md` (What this is / Architecture / Export rules)
- Delete: `tools/build-sample-setup-zip.mjs`, `SampleSetup.zip`, `examples/`

**Interfaces:** none — documentation and dev tooling only.

- [ ] **Step 1: Give the sample workbook a Link column**

In `tools/build-sample-workbook.py`, replace the comment and the `checklist` list (lines 12-41) with:

```python
# The "Example" column holds the display label (usually a file name) and the
# "Link" column its URL. An Example with no Link renders as plain text.
checklist = [
    ["Item ID", "Conditions", "Description", "Code", "Note", "Example", "Link"],
    ["A08", "", "Lifts are not exposed to weather", "AS3000",
     "Lift opening to an outdoor area must protect electrical components from moisture ingress.",
     "a08-weather-seal.png", "https://example.com/examples/a08-weather-seal.png"],
    ["A09", "", "Lifts do not open directly into a dwelling", "SL", "",
     "Provide a protected lobby between the lift and the dwelling entrance.", ""],
    ["A10", "PitToEarth: FALSE", "If pit is not to solid earth, need CWT safety device", "EN81-20",
     "Counterweight safety gear required when pit is not founded on solid earth.",
     "a10-cwt-safety.png", "https://example.com/examples/a10-cwt-safety.png"],
    ["A11", "MaxFFLInt: >11m", "Must have lift-well emergency doors", "EN81-20, RDM",
     "Required where the travel between landings exceeds 11 m.",
     "Add emergency doors at max 11 m spacing along the well.", ""],
    ["A13", 'BuildingClass: "Class 9b" OR MaxFFLInt: >=20', "Enhanced fire service controls", "BCA",
     "High-rise or assembly buildings need fire service lift controls.",
     "Provide fire service control switch and compliant signage.", ""],
    ["B01", "", "Pit structure designed for buffer impact loads", "AS1170", "",
     "Confirm structural design accounts for buffer reaction forces.", ""],
    ["B02", "FloorsServed: >=10", "Guide rail bracket spacing verified for travel", "EN81-20",
     "Taller installations need verified bracket spacing.",
     "Document guide-rail bracket spacing calculations.", ""],
    ["C01", "", "Machine room power isolation provided", "AS3000", "",
     "Install a lockable main switch for the lift supply.", ""],
    ["C02", "PitToEarth: FALSE", "Earthing of car and well per wiring rules", "AS3000",
     "Earthing continuity required where pit is not to solid earth.",
     "Measure and record earth continuity resistance.", ""],
]
```

- [ ] **Step 2: Regenerate the sample workbook**

Run: `python tools/build-sample-workbook.py`
Expected: `wrote …\SampleChecklist.xlsx`.

If `openpyxl` is missing, run `pip install openpyxl` first. If Python is unavailable, say so in the task report rather than hand-editing the binary — the plan's other steps do not depend on it.

- [ ] **Step 3: Delete the ZIP sample and its generator**

```bash
git rm -r tools/build-sample-setup-zip.mjs SampleSetup.zip examples/
```

- [ ] **Step 4: Update `README.md`**

Replace **First use §1** (lines 33-36) with:

```markdown
1. Go to **Setup** and load your checklist workbook — a single `.xlsx`.
   `SampleChecklist.xlsx` is included here to try it out.
```

Replace **First use §5** (lines 43-49) with:

```markdown
5. **Download Workbook** produces a `.xlsx` of everything still outstanding — one
   worksheet per unit, columns Item ID, Description, Code, Comments, Example. Where an
   item has an example link, the Example cell is a **hyperlink** that opens the file in
   your browser. The workbook is named `<Project Name>_DPVT_Out`, or
   `<Project Name>_DPVT_All` when you pick **All Items** from the dropdown.
```

On line 63, change `**Download ZIP** then produces one worksheet per unit.` to `**Download Workbook** then produces one worksheet per unit.`

On line 77, change `restores everything (re-import your setup ZIP to bring back the example images).` to `restores everything (re-import your checklist workbook to bring back the example links).`

Replace the `Sheet Checklist` table and the **Example** bullet (lines 87-98) with:

```markdown
| Item ID | Conditions | Description | Code | Note | Example | Link | HyperLink |
|---------|------------|-------------|------|------|---------|------|-----------|

- **Conditions** — leave blank for items that always apply. Otherwise reference your
  inputs (see grammar below).
- **Example** — the label shown for the item's supporting file, usually its file name
  (e.g. `ShaftVentilation.png`), or a paragraph of explanatory text.
- **Link** — the example's URL (Dropbox, SharePoint, anywhere reachable). Optional: an
  Example with no Link shows as plain text. Only absolute `http://` / `https://` values
  are used; anything else is ignored.
- **HyperLink** — optional, and never read by the tool. Keep a
  `=HYPERLINK(Link, Example)` formula here if you like a clickable cell while editing the
  spreadsheet; the tool takes its URL from **Link**.

  In the export, an Example with a Link becomes a **clickable hyperlink** in the Example
  cell, so any format (PNG, JPG, SVG, PDF, …) works.
```

On lines 161-162, drop the JSZip mention so the sentence names only the SheetJS fork.

- [ ] **Step 5: Update `CLAUDE.md`**

- **What this is** — drop "the `.xlsx` is parsed client-side" claim about bundled files if it implies a ZIP, and change the vendored-deps line to name only `vendor/xlsx.bundle.js` (JSZip is gone).
- **Architecture** — delete the `exampleStore.js`, `zipBundle.js` bullets; update the `db.js` bullet to `dpchecklist, v3, stores: projects, kv`.
- **Export rules** — replace the opening of that bullet, up to and including the sentence about the `Examples/` subfolder, with:

  ```markdown
  - **Export rules (per the user's spec):** the export is a **single `.xlsx`** named
    `<Project Title>_DPVT_<Mode>.xlsx` (project title keeps its spaces; only
    filename-illegal chars are stripped — **no** `_`-for-space; the **project number is
    never** in a file name). The workbook has a branded **Overview** sheet
  ```

  Then, further down the same bullet, replace the sentence beginning "Example file cells
  become blue underlined relative `Examples/…` hyperlinks" with:

  ```markdown
  Example cells with a `Link` become blue underlined external hyperlinks to that URL
  (cell text = the Example label); Example cells without one stay plain text;
  ```

  Keep every other rule in the bullet verbatim — column order, `Note` excluded, `S`-items
  excluded from the outstanding export, `DD/MM/YYYY`, the two modes and their base names,
  the Status column and row tints, and the `mode` threading.

- Add this bullet to the conventions, next to the Export rules one:

  ```markdown
  - **The Checklist sheet's three example columns:** **Example** is the display label
    (usually a file name), **Link** is its URL, and **HyperLink** is a human-facing
    `=HYPERLINK(Link, Example)` formula the tool **never reads** (its cached value carries
    no target). `Link` is optional and only absolute `http(s)` values are kept — anything
    else is ignored, leaving the Example as plain text. Parsed in `workbookModel.js` into
    `item.example` / `item.exampleLink`.
  ```
- **Current state** — note that setup is a single `.xlsx`, examples are URLs, and the export is a single workbook.

- [ ] **Step 6: Commit**

```bash
git add -A README.md CLAUDE.md tools SampleChecklist.xlsx
git commit -m "docs: document the single-workbook setup and example links"
```

---

### Task 8: End-to-end verification

**Files:** none modified (fix-ups only if a defect surfaces).

**Interfaces:** none.

- [ ] **Step 1: Run the full unit suite**

Run: `npm test`
Expected: PASS, no failures, no `exampleStore` tests.

- [ ] **Step 2: Start the app**

Run: `python -m http.server 8000`
The app needs a server — ES-module imports are blocked over `file://`.

- [ ] **Step 3: Drive it headless and check the import**

Use the CDP harness described in the `browser-smoke-test-harness` memory; put the harness script in the session scratchpad, not the repo.

Load `http://localhost:8000/`, set the `#workbook-file` input to `Checklist_14.08.26.xlsx` (in the repo root) and fire a `change` event. Assert `#setup-status` reads exactly:

```
Loaded 45 items, 9 inputs.
```

with no file count and no error class.

- [ ] **Step 4: Check the example buttons**

Create a project with one unit, open the checklist, and assert:
- `document.querySelectorAll('.item-info').length === 16` — one per linked item, none on the rest.
- A `.item-info` button's `data-example` starts with `https://www.dropbox.com/`.

Stub `window.open` to record its arguments, click one button, and assert it was called with that same URL and `'_blank'`.

- [ ] **Step 5: Check both exports**

Stub the download by wrapping `HTMLAnchorElement.prototype.click` to capture the `download` attribute and the blob. Trigger **Outstanding**, then **All Items**, and assert:
- the file names end in `.xlsx`, not `.zip`;
- they read `<Project Name>_DPVT_Out.xlsx` and `<Project Name>_DPVT_All.xlsx`.

- [ ] **Step 6: Verify the hyperlink survives into the file**

Read the captured blob back with the page's own `XLSX.read`, then for a unit sheet find a cell whose `.l` is set and assert `.l.Target` starts with `https://www.dropbox.com/` and its `.v` is the Example label (e.g. `ShaftVentilation.png`). Do this for both modes.

- [ ] **Step 7: Confirm the old blob store is gone**

In the page, run `indexedDB.open('dpchecklist')` and assert `result.version === 3` and `[...result.objectStoreNames]` deep-equals `['kv', 'projects']` (order-insensitive) — no `examples`.

- [ ] **Step 8: Report and commit any fixes**

If every check passes, report the results verbatim. If a step fails, fix it, re-run `npm test` and the failing smoke step, then:

```bash
git add -A
git commit -m "fix: <what the smoke test caught>"
```

---

## Notes for the implementer

- **`Checklist_14.08.26.xlsx` is untracked on purpose.** It is the user's real workbook with live Dropbox links; do not `git add` it.
- **The branch `feat/example-hyperlinks` is stacked on `feat/project-number-and-export-naming`**, which is not yet in `main`. Do not merge or rebase without asking.
- **Item A10's Example cell in the real workbook contains only spaces.** `cell()` trims it to `''`, so it behaves as blank. That is expected, not a bug to chase.
