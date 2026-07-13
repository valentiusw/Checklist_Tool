# Full "All Items" Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a second Excel export mode — **Full ("All Items")** — that lists every checklist item per unit with a per-unit status (Done / Outstanding / Not Applicable), selectable from a dropdown on the export button, alongside the existing outstanding-only export.

**Architecture:** The pure plan builder (`exporter.js`) gains a `mode` option that, in `'full'`, emits every item with a computed `status`; the workbook renderer (`exportWorkbook.js`) gains a full-mode unit sheet with a Status column and row tints plus a mode-aware Overview; `app.js` turns the export triggers into Outstanding/All-Items dropdowns and threads `mode` through. Vendored `XLSX` stays injected so `exportWorkbook.js` remains DOM-free.

**Tech Stack:** Vanilla ES modules, Node's built-in test runner (`node --test`), vendored `xlsx-js-style` + `jszip` (browser globals). No build step, no new deps.

## Global Constraints

- **Static-app discipline:** no framework, no bundler, no new runtime deps; vendored files only if unavoidable (none needed here).
- **CSS is token-driven and theme-aware:** use existing CSS custom properties; no hardcoded colors in `styles.css`. New layout CSS scoped to avoid leaking across screens.
- **Button labels are Title Case** (every word), for visible `<button>` text: menu items are "All Items", "Outstanding Items".
- **`db.js` owns the IndexedDB schema** — not touched here.
- **Export naming rule:** the ZIP, its top-level folder, and the workbook share one base name. Keep the project title's spaces; strip only filename-illegal chars (`[\\/:*?"<>|]`), collapse whitespace. Outstanding suffix `- Outstanding`; full suffix `- Full`. Dates `DD/MM/YYYY`.
- **S-prefixed items:** excluded from the outstanding export (`/^s/i`); **included** in the full export.
- **Example cells:** file references become blue underlined relative `Examples/<name>` hyperlinks; prose examples are plain text; the **Note** column is never exported.
- **Testing posture:** `exportWorkbook.js` has no Node tests (vendored `XLSX` is a browser bundle) — its rendering is verified by the browser smoke run per repo convention. Pure logic in `exporter.js` is unit-tested with `node --test`.

---

## File Structure

- `src/exporter.js` — MODIFY: `buildExportPlan(model, project, { mode })` gains full mode + per-item `status`. Pure, unit-tested.
- `tests/exporter.test.js` — MODIFY: add full-mode tests (status, S-items, referenced files).
- `src/exportWorkbook.js` — MODIFY: add palette tints, `fullCell` helper, `buildUnitSheetFull`, mode-aware `buildOverviewSheet`, mode-aware `buildExportWorkbook`. Rendering verified by smoke.
- `index.html` — MODIFY: wrap the two export triggers in `.export-wrap` with a `.new-menu` dropdown (All Items / Outstanding Items).
- `styles.css` — MODIFY: add `.export-wrap` positioning + `.export-menu` right-alignment (reuses `.new-menu` styles).
- `src/app.js` — MODIFY: `downloadProjectZip(project, mode)` threads mode + base name; replace the two export click handlers with a reusable `wireExportDropdown(...)`.
- `CLAUDE.md` — MODIFY: document the full export in the Export rules + Current state.

---

## Task 1: `buildExportPlan` full mode (pure logic)

**Files:**
- Modify: `src/exporter.js:39-69` (`buildExportPlan`)
- Test: `tests/exporter.test.js` (append)

**Interfaces:**
- Consumes: `applicableItems(model, values)` and `isApplicable(condition, values, model.inputDefs)` (already imported at `src/exporter.js:1`); `model.items` (each: `id, description, code, example, exampleFile, condition, section, sectionPrefix`).
- Produces: `buildExportPlan(model, project, { mode = 'outstanding' } = {}) -> { units: [{ name, rows }], referencedFiles: string[] }`.
  - Outstanding mode (default): **unchanged** — rows are applicable, unchecked, non-S items with fields `{ id, description, code, comment, example, exampleFile, section, sectionPrefix }` (no `status`).
  - Full mode: rows are **every** item (including S-prefixed) with the same fields **plus** `status: 'done' | 'outstanding' | 'na'` (`na` = not applicable to that unit; `done` = applicable && checked; `outstanding` = applicable && !checked).
  - `referencedFiles`: bare `exampleFile` names across all rows present in the chosen mode, deduped, in first-appearance order.

- [ ] **Step 1: Write the failing tests**

Append to `tests/exporter.test.js`:

```javascript
test('buildExportPlan full mode marks per-unit status (done/outstanding/na)', () => {
  const rows = [
    ['Item ID', 'Conditions', 'Description', 'Code', 'Note', 'Example'],
    ['A08', '', 'Always', 'AS3000', '', 'a08.png'],
    ['A10', 'PitToEarth: FALSE', 'Cond item', 'EN81', '', ''],
  ];
  const m = buildModel({ checklistRows: rows, inputRows });
  const project = { units: [
    { name: 'U1', inputs: { PitToEarth: false }, checks: { A08: true }, comments: {} },
    { name: 'U2', inputs: { PitToEarth: true }, checks: {}, comments: {} },
  ] };
  const plan = buildExportPlan(m, project, { mode: 'full' });
  const u1 = Object.fromEntries(plan.units[0].rows.map(r => [r.id, r.status]));
  assert.deepEqual(u1, { A08: 'done', A10: 'outstanding' });
  const u2 = Object.fromEntries(plan.units[1].rows.map(r => [r.id, r.status]));
  assert.deepEqual(u2, { A08: 'outstanding', A10: 'na' });
});

test('buildExportPlan full mode includes S-items; outstanding excludes them', () => {
  const rows = [
    ['Item ID', 'Conditions', 'Description', 'Code', 'Note', 'Example'],
    ['A08', '', 'Keep', 'AS3000', '', 'a08.png'],
    ['S01', '', 'Schindler', 'SL', '', 's01.png'],
  ];
  const m = buildModel({ checklistRows: rows, inputRows });
  const project = { units: [{ name: 'U', inputs: {}, checks: {}, comments: {} }] };
  const full = buildExportPlan(m, project, { mode: 'full' });
  assert.deepEqual(full.units[0].rows.map(r => r.id), ['A08', 'S01']);
  const out = buildExportPlan(m, project);
  assert.deepEqual(out.units[0].rows.map(r => r.id), ['A08']);
});

test('buildExportPlan full mode collects example files for all statuses', () => {
  const rows = [
    ['Item ID', 'Conditions', 'Description', 'Code', 'Note', 'Example'],
    ['A08', '', 'x', 'AS3000', '', 'a08.png'],
    ['A10', 'PitToEarth: FALSE', 'x', 'EN81', '', 'a10.png'],
  ];
  const m = buildModel({ checklistRows: rows, inputRows });
  const project = { units: [{ name: 'U', inputs: { PitToEarth: true }, checks: { A08: true }, comments: {} }] };
  const plan = buildExportPlan(m, project, { mode: 'full' });
  // A08 done (has file), A10 na (has file) — both bundled.
  assert.deepEqual(plan.referencedFiles, ['a08.png', 'a10.png']);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/exporter.test.js`
Expected: the three new tests FAIL (full mode returns outstanding-only rows / no `status` field), existing tests PASS.

- [ ] **Step 3: Implement full mode in `buildExportPlan`**

Replace `src/exporter.js:39-69` (the whole `buildExportPlan` function) with:

```javascript
export function buildExportPlan(model, project, { mode = 'outstanding' } = {}) {
  const full = mode === 'full';
  const units = (project.units || []).map(unit => {
    const values = unit.inputs || {};
    const comments = unit.comments || {};
    const checks = unit.checks || {};
    const base = (item) => ({
      id: item.id,
      description: item.description,
      code: item.code,
      comment: comments[item.id] || '',
      example: item.example,
      exampleFile: item.exampleFile || '',
      section: item.section,
      sectionPrefix: item.sectionPrefix,
    });
    let rows;
    if (full) {
      // Every item, including S-prefixed, tagged with its per-unit status.
      rows = model.items.map(item => {
        const applicable = isApplicable(item.condition, values, model.inputDefs);
        const status = !applicable ? 'na' : (checks[item.id] === true ? 'done' : 'outstanding');
        return { ...base(item), status };
      });
    } else {
      // Applicable, unchecked, client-facing (non-S) items only.
      rows = applicableItems(model, values)
        .filter(item => checks[item.id] !== true)
        .filter(item => !/^s/i.test(item.id))
        .map(base);
    }
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

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/exporter.test.js`
Expected: all tests PASS (new three + existing eight).

- [ ] **Step 5: Run the full suite + syntax check**

Run: `node --check src/exporter.js && npm test`
Expected: `node --check` silent; `npm test` all pass.

- [ ] **Step 6: Commit**

```bash
git add src/exporter.js tests/exporter.test.js
git commit -m "feat: full-export plan mode with per-unit item status"
```

---

## Task 2: Full-mode workbook rendering

**Files:**
- Modify: `src/exportWorkbook.js` (palette block ~9-21; `buildOverviewSheet` 55-135; `buildExportWorkbook` 210-218; add `fullCell` + `buildUnitSheetFull`)

**Interfaces:**
- Consumes: `plan.units[].rows[].status` from Task 1; existing `orderedSections(model, rows)`, `makeApi(XLSX)`, `bd`, `fill`, palette constants.
- Produces: `buildExportWorkbook({ XLSX, model, project, plan, reviewDate, mode = 'outstanding' })` — full mode renders per-unit sheets with a **Status** column + row tints and a mode-aware Overview. Outstanding mode output unchanged.

- [ ] **Step 1: Add palette tints + full header + status helper**

After `const LINK = '0563C1';` (`src/exportWorkbook.js:21`) add:

```javascript
const DONE_FILL = 'E7F3E9';  // full-export "Done" row tint (light green)
const NA_FILL = 'F0F1F3';    // full-export "Not Applicable" row tint (grey)
const NA_TEXT = '9AA1AB';    // muted text on N/A rows
```

After `const UNIT_HEADER = ['Item ID', 'Description', 'Code', 'Comments', 'Example'];` (`:24`) add:

```javascript
const UNIT_HEADER_FULL = ['Item ID', 'Description', 'Code', 'Status', 'Comments', 'Example'];
const STATUS_TEXT = { done: 'Done', outstanding: 'Outstanding', na: 'N/A' };

// Per-cell style for a full-export row, tinted by status. `bd`/`fill` are module-scope.
function fullCell(status, { bold = false, wrap = true, link = false } = {}) {
  const rowFill = status === 'done' ? DONE_FILL : status === 'na' ? NA_FILL : null;
  const rgb = link ? LINK : (status === 'na' ? NA_TEXT : INK);
  const s = {
    alignment: { vertical: 'top', wrapText: wrap },
    border: { bottom: bd(GREY_LN) },
    font: { color: { rgb }, bold, underline: link },
  };
  if (rowFill) s.fill = fill(rowFill);
  return s;
}
```

- [ ] **Step 2: Add the mode-aware Notes + Status Key to `buildOverviewSheet`**

Change the `buildOverviewSheet` signature (`src/exportWorkbook.js:55`) from:

```javascript
function buildOverviewSheet(XLSX, model, project, reviewDate) {
```
to:
```javascript
function buildOverviewSheet(XLSX, model, project, reviewDate, mode = 'outstanding') {
```

Immediately after the closing `r++;` of the "Progress by unit" block (the line `r++;` at `src/exportWorkbook.js:107`, right before the Glossary comment), insert a Status Key legend for full mode:

```javascript
  // Status key — only in the full ("all items") export.
  if (mode === 'full') {
    sectionBand('STATUS KEY');
    const legendRow = (swatch, label) => {
      put(ws, r, 0, '', { fill: fill(swatch), border: { top: bd(TRACK), bottom: bd(TRACK), left: bd(TRACK) } });
      put(ws, r, 1, '', { fill: fill(swatch), border: { top: bd(TRACK), bottom: bd(TRACK), right: bd(TRACK) } });
      band(ws, r, 2, N - 1, label, { font: { color: { rgb: INK } }, alignment: { vertical: 'center', indent: 1 } });
      rh(r, 18); r++;
    };
    legendRow(DONE_FILL, 'Done — applicable to this unit and checked complete');
    legendRow(WHITE, 'Outstanding — applicable but not yet checked');
    legendRow(NA_FILL, "Not Applicable — item's condition does not apply to this unit");
    r++;
  }
```

Then replace the single `NOTES` constant (`src/exportWorkbook.js:26-33`) usage: keep `NOTES` for outstanding and add a full-mode set. Add after the existing `NOTES` array (`:33`):

```javascript
const NOTES_FULL = [
  'This workbook lists ALL compliance items — one tab per unit — with each item marked Done, Outstanding, or Not Applicable for that unit.',
  'Items are grouped by discipline (from the Sections defined in the checklist).',
  'Row colours: green = Done (checked); plain = Outstanding (applicable, not yet checked); grey = Not Applicable to that unit.',
  'The Overview tab summarises progress for each unit as at the review date shown above.',
  'Complete the highlighted Reviewed By and Contact fields before circulating.',
  'Items with an entry in the Example column link to a supporting file in the Examples/ folder of this bundle.',
  'After downloading, extract the ZIP file. Keep this workbook in the top-level (parent) folder and the Examples in the "Examples" sub-folder inside it — the Example links only work when this folder structure is preserved.',
];
```

In the "How to use" block, change the line that iterates `NOTES` (`src/exportWorkbook.js:124`) from:

```javascript
  NOTES.forEach((note, i) => {
```
to:
```javascript
  const notes = mode === 'full' ? NOTES_FULL : NOTES;
  notes.forEach((note, i) => {
```
and update the `color` line inside (`:128`) that references `NOTES.length` from `i === NOTES.length - 1` to `i === notes.length - 1`.

- [ ] **Step 3: Add `buildUnitSheetFull`**

Add this function immediately after `buildUnitSheet` ends (after `src/exportWorkbook.js:193`):

```javascript
// Full-export per-unit sheet: every item, grouped by discipline, with a Status
// column and status-tinted rows (green Done / plain Outstanding / grey N/A).
function buildUnitSheetFull(XLSX, unitPlan, model) {
  const { newSheet, put, band, finalize } = makeApi(XLSX);
  const ws = newSheet(UNIT_HEADER_FULL.length);
  ws['!cols'] = [{ wch: 10 }, { wch: 44 }, { wch: 12 }, { wch: 13 }, { wch: 26 }, { wch: 38 }];
  const rows = [];
  const rh = (r, hpt) => { rows[r] = { hpt }; };
  let r = 0;

  UNIT_HEADER_FULL.forEach((h, c) => put(ws, r, c, h, { font: { bold: true, color: { rgb: WHITE } }, fill: fill(RED_DK), alignment: { vertical: 'center' } }));
  rh(r, 18); r++;

  if (!unitPlan.rows.length) {
    band(ws, r, 0, UNIT_HEADER_FULL.length - 1, 'No checklist items.', { font: { italic: true, color: { rgb: INK } }, alignment: { vertical: 'center', indent: 1 } });
    rh(r, 18); r++;
    return finalize(ws);
  }

  for (const group of orderedSections(model, unitPlan.rows)) {
    band(ws, r, 0, 5, String(group.name).toUpperCase(), { fill: fill(SECTION), font: { bold: true, color: { rgb: RED_DK } }, alignment: { vertical: 'center' }, border: { top: bd(), bottom: bd() } });
    rh(r, 18); r++;
    for (const it of group.rows) {
      put(ws, r, 0, it.id, fullCell(it.status, { bold: true, wrap: false }));
      put(ws, r, 1, it.description, fullCell(it.status));
      put(ws, r, 2, it.code, fullCell(it.status, { wrap: false }));
      put(ws, r, 3, STATUS_TEXT[it.status] || '', fullCell(it.status, { bold: it.status !== 'outstanding', wrap: false }));
      put(ws, r, 4, it.comment || '', fullCell(it.status));
      if (it.exampleFile) {
        put(ws, r, 5, it.exampleFile, fullCell(it.status, { link: true, wrap: false }),
          { link: { Target: 'Examples/' + it.exampleFile, Tooltip: 'Open ' + it.exampleFile } });
      } else {
        put(ws, r, 5, it.example || '', fullCell(it.status));
      }
      const lines = Math.max(1, Math.ceil((it.description || '').length / 44), Math.ceil((it.comment || '').length / 26));
      rh(r, 4 + lines * 14); r++;
    }
  }
  return finalize(ws);
}
```

- [ ] **Step 4: Thread `mode` through `buildExportWorkbook`**

Replace `buildExportWorkbook` (`src/exportWorkbook.js:210-218`) with:

```javascript
export function buildExportWorkbook({ XLSX, model, project, plan, reviewDate, mode = 'outstanding' }) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, buildOverviewSheet(XLSX, model, project, reviewDate, mode), 'Overview');
  const used = new Set(['Overview']);
  for (const unitPlan of plan.units) {
    const sheet = mode === 'full'
      ? buildUnitSheetFull(XLSX, unitPlan, model)
      : buildUnitSheet(XLSX, unitPlan, model);
    XLSX.utils.book_append_sheet(wb, sheet, sanitizeSheetName(unitPlan.name, used));
  }
  return wb;
}
```

- [ ] **Step 5: Syntax check**

Run: `node --check src/exportWorkbook.js`
Expected: silent (exit 0). (No Node unit test — rendering is verified in Task 4's smoke run, per repo convention.)

- [ ] **Step 6: Commit**

```bash
git add src/exportWorkbook.js
git commit -m "feat: full-export unit sheets with status column, tints, status key"
```

---

## Task 3: Export dropdown + mode wiring in the app

**Files:**
- Modify: `index.html:168-170` (dash export icon), `index.html:214` (Download ZIP button)
- Modify: `styles.css` (append `.export-wrap` / `.export-menu`)
- Modify: `src/app.js:430-433` (dash-export handler), `src/app.js:1439` (btn-download-zip handler), `src/app.js:1160-1195` (`downloadProjectZip`)

**Interfaces:**
- Consumes: `buildExportPlan(model, project, { mode })` (Task 1), `buildExportWorkbook({ …, mode })` (Task 2), existing `state.store.getProject`, `getCurrentProject`.
- Produces: `downloadProjectZip(project, mode = 'outstanding')`; a reusable `wireExportDropdown({ btnId, menuId, fullId, outId, getProject })`.

- [ ] **Step 1: Add the dashboard export dropdown markup**

Replace `index.html:168-170` (the `dash-export` button) with:

```html
            <div class="export-wrap">
              <button id="dash-export" class="icon-btn" type="button" title="Export to ZIP" aria-haspopup="true" aria-expanded="false" aria-label="Export to ZIP">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3h7v7" /><path d="M10 14 21 3" /><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" /></svg>
              </button>
              <div id="export-menu" class="new-menu export-menu" role="menu" hidden>
                <button id="menu-export-full" class="new-menu-item" type="button" role="menuitem">All Items</button>
                <button id="menu-export-outstanding" class="new-menu-item" type="button" role="menuitem">Outstanding Items</button>
              </div>
            </div>
```

- [ ] **Step 2: Add the project-screen Download ZIP dropdown markup**

Replace `index.html:214` (the `btn-download-zip` button) with:

```html
            <div class="export-wrap">
              <button id="btn-download-zip" class="btn-primary" type="button" aria-haspopup="true" aria-expanded="false">Download ZIP</button>
              <div id="dl-export-menu" class="new-menu export-menu" role="menu" hidden>
                <button id="dl-export-full" class="new-menu-item" type="button" role="menuitem">All Items</button>
                <button id="dl-export-outstanding" class="new-menu-item" type="button" role="menuitem">Outstanding Items</button>
              </div>
            </div>
```

- [ ] **Step 3: Add dropdown CSS**

Append to `styles.css`:

```css
/* Export dropdown (reuses .new-menu styling; right-aligned under its trigger). */
.export-wrap { position: relative; display: inline-block; }
.export-menu { left: auto; right: 0; }
```

- [ ] **Step 4: Thread `mode` into `downloadProjectZip`**

In `src/app.js`, change the signature (`:1160`) from:

```javascript
async function downloadProjectZip(project = getCurrentProject()) {
```
to:
```javascript
async function downloadProjectZip(project = getCurrentProject(), mode = 'outstanding') {
```

Change the plan build (`:1163`) from:

```javascript
    const plan = buildExportPlan(state.model, project);
```
to:
```javascript
    const plan = buildExportPlan(state.model, project, { mode });
```

Change the workbook build (`:1166`) from:

```javascript
    const wb = buildExportWorkbook({ XLSX, model: state.model, project, plan, reviewDate });
```
to:
```javascript
    const wb = buildExportWorkbook({ XLSX, model: state.model, project, plan, reviewDate, mode });
```

Change the base-name block (`:1180-1181`) from:

```javascript
    const safeTitle = (project.name || 'Project').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Project';
    const base = `${safeTitle}_Compliance Review - Outstanding`;
```
to:
```javascript
    const safeTitle = (project.name || 'Project').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Project';
    const suffix = mode === 'full' ? 'Full' : 'Outstanding';
    const base = `${safeTitle}_Compliance Review - ${suffix}`;
```

- [ ] **Step 5: Add the reusable dropdown wiring helper**

In `src/app.js`, add this function just above `wireDashboardActions` (before `src/app.js:425`):

```javascript
// Export trigger dropdown: toggles a menu whose two items export in the chosen
// mode. `getProject` resolves the project to export at click time.
function wireExportDropdown({ btnId, menuId, fullId, outId, getProject }) {
  const btn = document.getElementById(btnId);
  const menu = document.getElementById(menuId);
  const close = () => { if (!menu.hidden) { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); } };
  btn.addEventListener('click', e => {
    e.stopPropagation();
    const open = menu.hidden;
    menu.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
  });
  document.addEventListener('click', e => {
    if (!menu.hidden && !e.target.closest('#' + menuId + ', #' + btnId)) close();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  document.getElementById(fullId).addEventListener('click', () => {
    close();
    const p = getProject();
    if (p) downloadProjectZip(p, 'full');
  });
  document.getElementById(outId).addEventListener('click', () => {
    close();
    const p = getProject();
    if (p) downloadProjectZip(p, 'outstanding');
  });
}
```

- [ ] **Step 6: Replace the dashboard export handler**

In `src/app.js`, replace the `dash-export` handler in `wireDashboardActions` (`:430-433`):

```javascript
  document.getElementById('dash-export').addEventListener('click', () => {
    const p = state.store.getProject(state.selectedProjectId);
    if (p) downloadProjectZip(p);
  });
```
with:
```javascript
  wireExportDropdown({
    btnId: 'dash-export', menuId: 'export-menu',
    fullId: 'menu-export-full', outId: 'menu-export-outstanding',
    getProject: () => state.store.getProject(state.selectedProjectId),
  });
```

- [ ] **Step 7: Replace the project-screen Download ZIP handler**

In `src/app.js`, replace the `btn-download-zip` handler (`:1439`):

```javascript
  document.getElementById('btn-download-zip').addEventListener('click', () => downloadProjectZip());
```
with:
```javascript
  wireExportDropdown({
    btnId: 'btn-download-zip', menuId: 'dl-export-menu',
    fullId: 'dl-export-full', outId: 'dl-export-outstanding',
    getProject: () => getCurrentProject(),
  });
```

- [ ] **Step 8: Syntax check + full suite**

Run: `node --check src/app.js && npm test`
Expected: `node --check` silent; `npm test` all pass (logic unaffected).

- [ ] **Step 9: Commit**

```bash
git add index.html styles.css src/app.js
git commit -m "feat: export dropdown to choose All Items vs Outstanding"
```

---

## Task 4: Browser smoke verification + docs

**Files:**
- Modify: `CLAUDE.md` (Export rules convention + Current state)

**Interfaces:** none (verification + docs).

- [ ] **Step 1: Serve the app**

Run: `python -m http.server 8000` (from repo root; background it).

- [ ] **Step 2: Drive the smoke test (headless Edge over CDP)**

Per the `browser-smoke-test-harness` memory, script these steps against `http://localhost:8000/`:
1. Import `SampleSetup.zip` (or the sample workbook), create a project with ≥1 unit, check some items, leave others, and use inputs that make at least one item non-applicable.
2. On the dashboard, click the **export icon** → menu shows **All Items** and **Outstanding Items**; click outside closes it; Escape closes it.
3. Click **Outstanding Items** → a ZIP named `… - Outstanding.zip` downloads.
4. Click **All Items** → a ZIP named `… - Full.zip` downloads.
5. Open the full workbook; on a unit sheet verify: a **Status** column exists; a checked applicable item shows green + "Done"; an unchecked applicable item shows plain + "Outstanding"; a non-applicable item shows grey + "N/A"; an S-item appears; the Overview has a **STATUS KEY** section.

Expected: all of the above hold. Capture a screenshot of a full-export unit sheet.

- [ ] **Step 3: Update CLAUDE.md**

In the **Export rules** convention bullet, after the sentence describing the outstanding workbook, add:

```markdown
The export button offers two modes via a dropdown: **Outstanding Items** (default,
suffix `- Outstanding`) and **All Items** (suffix `- Full`). The full workbook lists
**every** item per unit — including `S`-prefixed items — each tagged with a per-unit
**Status** (Done / Outstanding / Not Applicable) shown by a Status column and a row
tint (green Done / plain Outstanding / grey N/A); its Overview adds a Status Key
legend. Mode is threaded through `buildExportPlan(model, project, { mode })` and
`buildExportWorkbook({ …, mode })`.
```

In **Current state**, note the full export landed alongside the outstanding one.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: describe the full 'all items' export"
```

---

## Self-Review

**Spec coverage:**
- Trigger dropdown (Outstanding / All Items) on `dash-export` **and** `btn-download-zip` → Task 3 (Steps 1-2, 5-7). ✓
- Full = every item per unit, discipline-grouped, per-unit status → Task 1 (full mode) + Task 2 (`buildUnitSheetFull`). ✓
- Statuses Done/Outstanding/NA with Status column + row tints → Task 2 (Steps 1, 3). ✓
- S-items included in full, excluded in outstanding → Task 1 (test + impl). ✓
- Column order `ID · Description · Code · Status · Comments · Example` → `UNIT_HEADER_FULL` (Task 2). ✓
- Overview notes reworded + Status Key legend for full → Task 2 (Step 2). ✓
- Naming `- Full` vs `- Outstanding`, shared base name → Task 3 (Step 4). ✓
- Example files for all shown rows bundled → Task 1 (`referencedFiles` over full rows) + existing `downloadProjectZip` loop. ✓
- Progress meters unchanged → not touched (Overview meters untouched). ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code; no "handle edge cases" placeholders. ✓

**Type consistency:** `mode: 'outstanding' | 'full'` used identically across `buildExportPlan`, `buildExportWorkbook`, `downloadProjectZip`. `status: 'done' | 'outstanding' | 'na'` produced in Task 1, consumed by `fullCell`/`STATUS_TEXT` in Task 2. `UNIT_HEADER_FULL` (6 cols) matches the `band(ws, r, 0, 5, …)` merge and per-row `put` columns 0-5. `wireExportDropdown` param names (`btnId/menuId/fullId/outId/getProject`) match both call sites and the element IDs in `index.html`. ✓
