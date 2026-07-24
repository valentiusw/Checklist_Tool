# Excel-style Grid Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the project editor's one-unit-at-a-time carousel with a spreadsheet-style grid — one row per unit, one column per checklist input — with frozen header/name panes, a ghost add-row, Excel paste, and keyboard navigation.

**Architecture:** Pure typed-value + paste logic lives in a new DOM-free module `src/unitGrid.js` (unit-tested under Node). `src/app.js` becomes thin DOM glue that renders a `<table class="unit-grid">` and wires keyboard/paste events to the pure helpers. The draft data model (`{ id, name, units:[{ name, inputs }] }`) and `validateDraft`/`projectStore` are untouched.

**Tech Stack:** Vanilla ES modules, no framework/build step. Node's built-in test runner (`node --test`) over `src/*.js`. Token-driven CSS with dark-mode support. Headless-Edge-over-CDP smoke test.

## Global Constraints

- **Static-app discipline:** no framework, no bundler, no new runtime deps. (CLAUDE.md)
- **Pure logic in `src/`, DOM-free and unit-tested;** `app.js` DOM glue is not unit-tested (verified by `node --check` + smoke run). (CLAUDE.md)
- **CSS is token-driven and theme-aware:** use existing custom properties (`--surface`, `--border`, `--border-strong`, `--surface-muted`, `--accent`, `--text`, `--text-muted`, `--radius`, `--radius-sm`, `--danger`); no hardcoded `#fff`-style colors. New editor CSS scoped under `[data-screen="editor"]`. (CLAUDE.md)
- **Button labels are Title Case;** field/toggle labels stay sentence case. (CLAUDE.md)
- **Input def shape** (from `workbookModel.js`): `{ name, type, label, unit, choices, default }`; `type ∈ {'Choice','Float','Integer','Boolean'}`; `choices` is an array. `model.inputs` is the ordered array of defs.
- **Run tests with** `npm test`; syntax-check edited files with `node --check src/<file>.js`.

---

### Task 1: `coerceInputValue` — pure typed-value coercion

**Files:**
- Create: `src/unitGrid.js`
- Test: `tests/unitGrid.test.js`

**Interfaces:**
- Consumes: input def shape `{ type, choices }` from the model.
- Produces:
  - `export const UNCHANGED` — a `Symbol` sentinel meaning "leave the existing value".
  - `export function coerceInputValue(def, raw)` → typed value (`true`/`false`, a canonical choice string, a number, `''`) or `UNCHANGED`.

- [ ] **Step 1: Write the failing test**

Create `tests/unitGrid.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coerceInputValue, UNCHANGED } from '../src/unitGrid.js';

const boolDef = { name: 'Pit', type: 'Boolean', choices: [] };
const intDef = { name: 'Stops', type: 'Integer', choices: [] };
const floatDef = { name: 'Load', type: 'Float', choices: [] };
const choiceDef = { name: 'Door', type: 'Choice', choices: ['Centre', 'Side'] };

test('coerceInputValue: Boolean truthy synonyms → true', () => {
  for (const raw of ['true', 'TRUE', 'Yes', 'y', '1', '✓', 'x']) {
    assert.equal(coerceInputValue(boolDef, raw), true, `"${raw}" should be true`);
  }
});

test('coerceInputValue: Boolean falsy synonyms and blank → false', () => {
  for (const raw of ['false', 'No', 'n', '0', '']) {
    assert.equal(coerceInputValue(boolDef, raw), false, `"${raw}" should be false`);
  }
});

test('coerceInputValue: Boolean garbage → UNCHANGED', () => {
  assert.equal(coerceInputValue(boolDef, 'maybe'), UNCHANGED);
});

test('coerceInputValue: Integer parses and rounds', () => {
  assert.equal(coerceInputValue(intDef, '3'), 3);
  assert.equal(coerceInputValue(intDef, '3.7'), 4);
});

test('coerceInputValue: Float parses', () => {
  assert.equal(coerceInputValue(floatDef, '1000.5'), 1000.5);
});

test('coerceInputValue: numeric empty string stays empty', () => {
  assert.equal(coerceInputValue(intDef, ''), '');
});

test('coerceInputValue: non-numeric number cell → UNCHANGED', () => {
  assert.equal(coerceInputValue(intDef, 'abc'), UNCHANGED);
});

test('coerceInputValue: Choice matches case-insensitively to canonical', () => {
  assert.equal(coerceInputValue(choiceDef, 'side'), 'Side');
  assert.equal(coerceInputValue(choiceDef, 'CENTRE'), 'Centre');
});

test('coerceInputValue: Choice no-match → UNCHANGED', () => {
  assert.equal(coerceInputValue(choiceDef, 'Diagonal'), UNCHANGED);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/unitGrid.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/unitGrid.js`:

```js
// Pure, DOM-free helpers for the spreadsheet-style unit editor grid:
// typed-value coercion for typed/pasted cells, clipboard parsing, and paste
// spill. Importable from Node tests (no DOM dependency).

// Sentinel returned by coerceInputValue when a raw cell can't be interpreted —
// callers must leave the existing value untouched rather than clobber it.
export const UNCHANGED = Symbol('unchanged');

const TRUE_WORDS = new Set(['true', 'yes', 'y', '1', '✓', 'x', 'checked']);
const FALSE_WORDS = new Set(['false', 'no', 'n', '0', '']);

export function coerceInputValue(def, raw) {
  const s = String(raw ?? '').trim();
  if (def.type === 'Boolean') {
    const low = s.toLowerCase();
    if (TRUE_WORDS.has(low)) return true;
    if (FALSE_WORDS.has(low)) return false;
    return UNCHANGED;
  }
  if (def.type === 'Choice') {
    const match = def.choices.find((c) => c.toLowerCase() === s.toLowerCase());
    return match !== undefined ? match : UNCHANGED;
  }
  // Integer / Float
  if (s === '') return '';
  const n = Number(s);
  if (Number.isNaN(n)) return UNCHANGED;
  return def.type === 'Integer' ? Math.round(n) : n;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS — all `coerceInputValue` tests green.

- [ ] **Step 5: Commit**

```bash
git add src/unitGrid.js tests/unitGrid.test.js
git commit -m "feat: coerceInputValue for grid cell typing"
```

---

### Task 2: `parseClipboardMatrix` — clipboard text → 2-D array

**Files:**
- Modify: `src/unitGrid.js`
- Test: `tests/unitGrid.test.js`

**Interfaces:**
- Produces: `export function parseClipboardMatrix(text)` → `string[][]` (rows by newline, cells by tab; a single trailing blank line dropped).

- [ ] **Step 1: Write the failing test**

Append to `tests/unitGrid.test.js` (add `parseClipboardMatrix` to the existing import from `../src/unitGrid.js`):

```js
import { parseClipboardMatrix } from '../src/unitGrid.js';

test('parseClipboardMatrix: LF rows and tab columns', () => {
  assert.deepEqual(
    parseClipboardMatrix('a\tb\nc\td'),
    [['a', 'b'], ['c', 'd']],
  );
});

test('parseClipboardMatrix: CRLF normalised', () => {
  assert.deepEqual(
    parseClipboardMatrix('a\tb\r\nc\td'),
    [['a', 'b'], ['c', 'd']],
  );
});

test('parseClipboardMatrix: single trailing newline dropped', () => {
  assert.deepEqual(parseClipboardMatrix('a\tb\n'), [['a', 'b']]);
});

test('parseClipboardMatrix: single cell', () => {
  assert.deepEqual(parseClipboardMatrix('hello'), [['hello']]);
});
```

> Note: consolidate the two `import ... from '../src/unitGrid.js'` lines into one if your reviewer prefers; separate imports are valid ES modules.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `parseClipboardMatrix is not a function` / not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `src/unitGrid.js`:

```js
export function parseClipboardMatrix(text) {
  const norm = String(text ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = norm.split('\n');
  // Excel appends a trailing newline to a copied block — drop that lone empty
  // final line (but keep genuinely blank interior rows).
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return lines.map((line) => line.split('\t'));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/unitGrid.js tests/unitGrid.test.js
git commit -m "feat: parseClipboardMatrix for grid paste"
```

---

### Task 3: `applyPasteMatrix` — spill a matrix into units

**Files:**
- Modify: `src/unitGrid.js`
- Test: `tests/unitGrid.test.js`

**Interfaces:**
- Consumes: `coerceInputValue`, `UNCHANGED` (Task 1); `model.inputs` (ordered def array).
- Produces: `export function applyPasteMatrix({ units, model, startRow, startCol, matrix, makeUnit })` → new `units` array. `makeUnit(index)` is injected and returns a fresh unit `{ name, inputs:{...} }` (in app.js = `newDraftUnit`). Column `0` = unit name (verbatim string); columns `1..n` map to `model.inputs[col-1]` via `coerceInputValue`, skipping `UNCHANGED`; rows past the end create units; columns past the last input are ignored.

- [ ] **Step 1: Write the failing test**

Append to `tests/unitGrid.test.js` (import `applyPasteMatrix` from `../src/unitGrid.js`):

```js
import { applyPasteMatrix } from '../src/unitGrid.js';

const model = {
  inputs: [
    { name: 'Pit', type: 'Boolean', choices: [] },
    { name: 'Stops', type: 'Integer', choices: [] },
    { name: 'Door', type: 'Choice', choices: ['Centre', 'Side'] },
  ],
};
const makeUnit = (i) => ({ name: 'Unit ' + (i + 1), inputs: { Pit: false, Stops: 0, Door: 'Centre' } });
const seed = () => [{ name: 'A', inputs: { Pit: false, Stops: 1, Door: 'Centre' } }];

test('applyPasteMatrix: fills a row starting at the name column', () => {
  const out = applyPasteMatrix({
    units: seed(), model, startRow: 0, startCol: 0,
    matrix: [['Tower', 'yes', '5', 'Side']], makeUnit,
  });
  assert.equal(out.length, 1);
  assert.deepEqual(out[0], { name: 'Tower', inputs: { Pit: true, Stops: 5, Door: 'Side' } });
});

test('applyPasteMatrix: rows past the end create units', () => {
  const out = applyPasteMatrix({
    units: seed(), model, startRow: 1, startCol: 0,
    matrix: [['B', 'no', '2', 'Centre'], ['C', 'yes', '3', 'Side']], makeUnit,
  });
  assert.equal(out.length, 3);
  assert.equal(out[1].name, 'B');
  assert.equal(out[2].name, 'C');
  assert.equal(out[2].inputs.Stops, 3);
});

test('applyPasteMatrix: columns past the last input are ignored', () => {
  const out = applyPasteMatrix({
    units: seed(), model, startRow: 0, startCol: 0,
    matrix: [['X', 'yes', '9', 'Side', 'EXTRA', 'MORE']], makeUnit,
  });
  assert.equal(out[0].name, 'X');
  assert.equal(out[0].inputs.Door, 'Side');
});

test('applyPasteMatrix: starts at a non-zero column', () => {
  const out = applyPasteMatrix({
    units: seed(), model, startRow: 0, startCol: 2, // Stops column
    matrix: [['7', 'Side']], makeUnit,
  });
  assert.equal(out[0].name, 'A');           // name untouched
  assert.equal(out[0].inputs.Stops, 7);
  assert.equal(out[0].inputs.Door, 'Side');
});

test('applyPasteMatrix: uninterpretable cells leave existing values', () => {
  const out = applyPasteMatrix({
    units: seed(), model, startRow: 0, startCol: 1, // Pit column
    matrix: [['maybe']], makeUnit,                  // Boolean garbage → UNCHANGED
  });
  assert.equal(out[0].inputs.Pit, false); // unchanged from seed
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `applyPasteMatrix is not a function`.

- [ ] **Step 3: Write minimal implementation**

Append to `src/unitGrid.js`:

```js
export function applyPasteMatrix({ units, model, startRow, startCol, matrix, makeUnit }) {
  const inputs = model.inputs;
  const result = units.slice();
  matrix.forEach((cells, r) => {
    const rowIdx = startRow + r;
    while (rowIdx >= result.length) result.push(makeUnit(result.length));
    const unit = result[rowIdx];
    cells.forEach((raw, c) => {
      const colIdx = startCol + c;
      if (colIdx === 0) {
        unit.name = String(raw);
        return;
      }
      const def = inputs[colIdx - 1];
      if (!def) return; // overflow past the last input column
      const val = coerceInputValue(def, raw);
      if (val !== UNCHANGED) unit.inputs[def.name] = val;
    });
  });
  return result;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS — all `unitGrid` tests green.

- [ ] **Step 5: Commit**

```bash
git add src/unitGrid.js tests/unitGrid.test.js
git commit -m "feat: applyPasteMatrix spills clipboard into units"
```

---

### Task 4: Swap the editor markup — carousel → grid container

**Files:**
- Modify: `index.html` (the `#screen-editor` unit block, currently ~lines 297-306)

**Interfaces:**
- Produces DOM ids consumed by app.js in Tasks 5-6: `#editor-grid` (the `<table>`), `#editor-grid-wrap` (scroll container), `#editor-add-unit` (button).

- [ ] **Step 1: Replace the carousel markup**

In `index.html`, replace this block:

```html
        <div class="editor-units-head">
          <h3>Units</h3>
          <p id="editor-unit-counter" class="editor-unit-counter"></p>
          <div id="editor-unit-dots" class="unit-dots"></div>
        </div>
        <div class="unit-carousel">
          <button id="editor-prev-unit" class="carousel-nav" type="button" aria-label="Previous unit"></button>
          <div id="editor-units" class="unit-carousel-stage"></div>
          <button id="editor-next-unit" class="carousel-nav" type="button" aria-label="Next unit"></button>
        </div>
```

with:

```html
        <div class="editor-units-head">
          <h3>Units</h3>
        </div>
        <div id="editor-grid-wrap" class="editor-grid-wrap">
          <table id="editor-grid" class="unit-grid"></table>
        </div>
        <button id="editor-add-unit" class="btn-ghost" type="button">+ Add Unit</button>
```

- [ ] **Step 2: Verify the app still loads (temporary breakage expected)**

Run: `python -m http.server 8000` then open `http://localhost:8000/` and open the editor.
Expected: the editor screen shows the name field + "Units" heading + an empty area; the browser console will show errors from app.js still referencing `editor-prev-unit`/`editor-next-unit` — this is fixed in Task 5. (No commit yet — HTML and JS change together.)

- [ ] **Step 3: Commit together with Task 5** — do not commit `index.html` alone.

---

### Task 5: Render the grid + ghost row + add/delete; remove carousel JS

**Files:**
- Modify: `src/app.js` (replace carousel render/helpers ~lines 664-805; event wiring ~lines 1555-1558; `openEditor` ~line 807)

**Interfaces:**
- Consumes: `newDraftUnit`, `defaultInputValue` (already imported from `projectDraft.js`); `buildInputControl` (existing, ~line 635); `state.editor.draft`, `state.model`.
- Produces functions used in Task 6: `renderUnitGrid()`, `focusCell(row, col, caretEnd)`, and per-cell controls carrying `dataset.col` (`'0'` = name, `'1..n'` = inputs) on rows carrying `dataset.row`.

- [ ] **Step 1: Confirm the current import line exists**

`src/app.js` top already imports from `./projectDraft.js`. Verify it includes `defaultInputValue` and `newDraftUnit`:

Run: `grep -n "from './projectDraft.js'" src/app.js`
Expected: an import line listing `defaultInputValue`, `newDraftUnit` (among others). If `newDraftUnit` is missing, add it to that import.

- [ ] **Step 2: Delete the carousel icons and carousel render/nav helpers**

In `src/app.js` delete:
- the three icon constants `ICON_PREV`, `ICON_NEXT`, `ICON_ADD` (~lines 664-669);
- the entire `renderEditor` carousel body from the `// Carousel:` comment (~line 680) through the end of the `for (const def of state.model.inputs) { ... }` loop that builds `.unit-edit-card` (~line 774) — i.e. everything after the project-name wiring inside `renderEditor` up to its closing brace;
- the functions `prevEditorUnit` (~line 777) and `nextEditorUnit` (~line 785);
- the body of `addEditorUnit` (~line 796) — it will be rewritten in Step 4.

Leave `renderEditor`'s opening (heading, name-error reset, name-field wiring, ~lines 671-678) intact.

- [ ] **Step 3: Make `renderEditor` call the grid**

`renderEditor` should end by calling the grid. Its full body becomes:

```js
function renderEditor() {
  const { draft, isNew } = state.editor;
  document.getElementById('editor-heading').textContent = isNew ? 'New Project' : 'Edit Project';
  document.getElementById('editor-name-error').hidden = true;

  const nameInput = document.getElementById('editor-project-name');
  nameInput.value = draft.name;
  nameInput.oninput = () => { draft.name = nameInput.value; markEditorDirty(); };

  renderUnitGrid();
}
```

- [ ] **Step 4: Add the grid render + row builders + add/delete + focus helper**

Add these functions to `src/app.js` (near the old carousel code):

```js
// ---- Unit grid (spreadsheet editor) ----------------------------------------

// Rebuild the whole <table>. Cheap for realistic project sizes and keeps
// row/column indices authoritative after every structural change.
function renderUnitGrid() {
  const { draft } = state.editor;
  const model = state.model;
  const table = document.getElementById('editor-grid');
  table.innerHTML = '';

  const thead = document.createElement('thead');
  const hr = document.createElement('tr');
  const corner = document.createElement('th');
  corner.className = 'corner';
  corner.textContent = 'Unit';
  hr.appendChild(corner);
  for (const def of model.inputs) {
    const th = document.createElement('th');
    th.textContent = def.label + (def.unit ? ` (${def.unit})` : '');
    hr.appendChild(th);
  }
  thead.appendChild(hr);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  draft.units.forEach((unit, rowIdx) => {
    tbody.appendChild(buildUnitRow(unit, rowIdx, model, false));
  });
  tbody.appendChild(buildUnitRow(null, draft.units.length, model, true)); // ghost
  table.appendChild(tbody);
}

// Build one <tr>. isGhost renders a faint blank row that materializes into a
// real unit on first edit (name or any input).
function buildUnitRow(unit, rowIdx, model, isGhost) {
  const tr = document.createElement('tr');
  tr.dataset.row = String(rowIdx);
  if (isGhost) tr.className = 'ghost';

  const rowhead = document.createElement('td');
  rowhead.className = 'rowhead';
  const inner = document.createElement('div');
  inner.className = 'rowhead-inner';

  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'unit-delete-x';
  del.innerHTML = '&times;';
  del.tabIndex = -1; // keep Tab moving between data cells, not delete buttons
  del.setAttribute('aria-label', 'Delete unit');
  del.disabled = isGhost || state.editor.draft.units.length <= 1;
  del.addEventListener('click', () => {
    if (!confirm('Delete this unit?')) return;
    state.editor.draft.units.splice(rowIdx, 1);
    markEditorDirty();
    renderUnitGrid();
  });

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'unit-edit-name';
  nameInput.dataset.col = '0';
  nameInput.value = isGhost ? '' : unit.name;
  nameInput.placeholder = isGhost ? 'New unit…' : 'Unit name';
  if (isGhost) {
    nameInput.addEventListener('input', () =>
      materializeGhost(0, (u) => { u.name = nameInput.value; }));
  } else {
    nameInput.addEventListener('input', () => { unit.name = nameInput.value; markEditorDirty(); });
  }

  inner.appendChild(del);
  inner.appendChild(nameInput);
  rowhead.appendChild(inner);
  tr.appendChild(rowhead);

  model.inputs.forEach((def, i) => {
    const col = i + 1;
    const td = document.createElement('td');
    let value;
    if (isGhost) {
      value = defaultInputValue(def);
    } else {
      if (!(def.name in unit.inputs)) unit.inputs[def.name] = defaultInputValue(def);
      value = unit.inputs[def.name];
    }
    const control = buildInputControl(def, value, (v) => {
      if (isGhost) { materializeGhost(col, (u) => { u.inputs[def.name] = v; }); return; }
      unit.inputs[def.name] = v;
      markEditorDirty();
    });
    control.dataset.col = String(col);
    td.appendChild(control);
    tr.appendChild(td);
  });

  return tr;
}

// Promote the ghost row into a real unit, apply the just-entered value, then
// re-render and restore focus/caret to the same cell in the new real row.
function materializeGhost(col, apply) {
  const draft = state.editor.draft;
  const unit = newDraftUnit(state.model, 'Unit ' + (draft.units.length + 1));
  apply(unit);
  draft.units.push(unit);
  markEditorDirty();
  renderUnitGrid();
  focusCell(draft.units.length - 1, col, true);
}

// Append a blank unit via the explicit button and focus its name cell.
function addEditorUnit() {
  const draft = state.editor.draft;
  draft.units.push(newDraftUnit(state.model, 'Unit ' + (draft.units.length + 1)));
  markEditorDirty();
  renderUnitGrid();
  focusCell(draft.units.length - 1, 0, false);
}

// Move focus to the control at (row, col); optionally place the caret at end
// (text inputs only — number inputs reject setSelectionRange, hence the guard).
function focusCell(row, col, caretEnd) {
  const el = document.querySelector(`#editor-grid tbody tr[data-row="${row}"] [data-col="${col}"]`);
  if (!el) return;
  el.focus();
  if (caretEnd && el.tagName === 'INPUT' && el.type === 'text') {
    try { const n = el.value.length; el.setSelectionRange(n, n); } catch (_) { /* unsupported */ }
  }
}
```

- [ ] **Step 5: Simplify `openEditor` state (remove `unitIndex`)**

In `openEditor` (~line 807), drop the now-unused `unitIndex` from both `state.editor` initializers:

```js
    state.editor = { draft: state.store.getProject(projectId), isNew: false, dirty: false };
  } else {
    state.editor = { draft: newBlankDraft(state.model), isNew: true, dirty: false };
```

- [ ] **Step 6: Rewire editor events**

In the init block (~lines 1555-1558) replace the prev/next listeners with the add-unit listener:

```js
  document.getElementById('editor-save').addEventListener('click', saveEditor);
  document.getElementById('editor-cancel').addEventListener('click', cancelEditor);
  document.getElementById('editor-add-unit').addEventListener('click', addEditorUnit);
```

(Delete the two lines referencing `editor-prev-unit` / `editor-next-unit`.)

- [ ] **Step 7: Syntax-check and manually verify**

Run: `node --check src/app.js`
Expected: no output (valid).

Run: `grep -n "editor-prev-unit\|editor-next-unit\|editor-unit-counter\|editor-unit-dots\|ICON_PREV\|prevEditorUnit\|nextEditorUnit\|state.editor.unitIndex\|navDir" src/app.js`
Expected: **no matches** (all carousel references removed).

Then run `python -m http.server 8000`, open the editor: a grid renders with a header row (Unit + one column per input), a row per unit with a working name field + input controls, a faint ghost row at the bottom, and a "+ Add Unit" button. Typing in the ghost row adds a real row; "+ Add Unit" appends a row; the × deletes a row (disabled at one unit); Save persists and reopens correctly.

- [ ] **Step 8: Commit (with Task 4's `index.html`)**

```bash
git add index.html src/app.js
git commit -m "feat: render unit editor as a grid (replaces carousel)"
```

---

### Task 6: Keyboard navigation + Excel paste

**Files:**
- Modify: `src/app.js` (add two handlers + wire them once in init)

**Interfaces:**
- Consumes: `parseClipboardMatrix`, `applyPasteMatrix` from `./unitGrid.js` (Tasks 2-3); `focusCell`, `renderUnitGrid` (Task 5); `newDraftUnit`.
- Produces: keydown + paste behavior on `#editor-grid`.

- [ ] **Step 1: Import the pure paste helpers**

At the top of `src/app.js`, add:

```js
import { parseClipboardMatrix, applyPasteMatrix } from './unitGrid.js';
```

- [ ] **Step 2: Add the keyboard + paste handlers**

Add to `src/app.js`:

```js
// Enter/Shift+Enter move vertically; Arrow keys move between non-text cells
// (checkbox/select) — inside number/text inputs arrows stay native so the caret
// and number steppers keep working. Tab/Shift+Tab are left to native DOM order
// (delete buttons are tabIndex -1, so Tab walks name → inputs → next row).
function onGridKeydown(e) {
  const cell = e.target.closest('[data-col]');
  if (!cell) return;
  const tr = cell.closest('tr');
  const row = Number(tr.dataset.row);
  const col = Number(cell.dataset.col);
  const isText = cell.tagName === 'INPUT' && (cell.type === 'text' || cell.type === 'number');

  if (e.key === 'Enter') {
    e.preventDefault();
    focusCell(row + (e.shiftKey ? -1 : 1), col, true);
  } else if (!isText && e.key === 'ArrowDown') {
    e.preventDefault(); focusCell(row + 1, col, true);
  } else if (!isText && e.key === 'ArrowUp') {
    e.preventDefault(); focusCell(row - 1, col, true);
  } else if (!isText && e.key === 'ArrowRight') {
    e.preventDefault(); focusCell(row, col + 1, true);
  } else if (!isText && e.key === 'ArrowLeft') {
    e.preventDefault(); focusCell(row, col - 1, true);
  }
}

// Paste a block copied from Excel: fill cells from the focused cell, spilling
// right and down, creating units past the last row. A 1x1 paste is left to the
// native field so ordinary single-value pastes behave normally.
function onGridPaste(e) {
  const cell = e.target.closest('[data-col]');
  if (!cell) return;
  const text = e.clipboardData.getData('text');
  if (!text) return;
  const matrix = parseClipboardMatrix(text);
  if (matrix.length === 1 && matrix[0].length === 1) return; // single value → native
  e.preventDefault();
  const tr = cell.closest('tr');
  const startRow = Number(tr.dataset.row);
  const startCol = Number(cell.dataset.col);
  const draft = state.editor.draft;
  draft.units = applyPasteMatrix({
    units: draft.units,
    model: state.model,
    startRow, startCol, matrix,
    makeUnit: (i) => newDraftUnit(state.model, 'Unit ' + (i + 1)),
  });
  markEditorDirty();
  renderUnitGrid();
  focusCell(startRow, startCol, false);
}
```

- [ ] **Step 3: Wire the handlers once in init**

Next to the `editor-add-unit` listener from Task 5, add:

```js
  const grid = document.getElementById('editor-grid');
  grid.addEventListener('keydown', onGridKeydown);
  grid.addEventListener('paste', onGridPaste);
```

(The `<table>` element persists across `renderUnitGrid()` — which only replaces its children — so these listeners bind once.)

- [ ] **Step 4: Syntax-check and manually verify**

Run: `node --check src/app.js`
Expected: no output.

Then in the browser editor: Tab walks name → each input → next row's name; Enter moves down a column; arrow keys move between checkbox/select cells. Copy a 3×4 block in Excel (or a `.tsv`), click a cell, paste — rows fill and any needed units are created. Pasting into the ghost row creates units too.

- [ ] **Step 5: Commit**

```bash
git add src/app.js
git commit -m "feat: keyboard nav and Excel paste in the unit grid"
```

---

### Task 7: Grid CSS + freeze panes; remove dead carousel CSS

**Files:**
- Modify: `styles.css` (carousel block ~lines 842-927; add grid rules)

**Interfaces:** none (styling only). Depends on the class names emitted in Tasks 4-5: `.editor-grid-wrap`, `.unit-grid`, `.corner`, `.rowhead`, `.rowhead-inner`, `tr.ghost`. Reuses existing `.unit-edit-name` and `.unit-delete-x` (keep those).

- [ ] **Step 1: Remove the carousel-only CSS**

In `styles.css` delete these rules (they target removed DOM):
- `.editor-unit-counter` (~line 843)
- `.unit-dots`, `.unit-dot`, `.unit-dot:hover`, `.unit-dot.is-active` (~lines 845-865)
- the `/* ---- Units carousel ---- */` block: `.unit-carousel`, `.unit-carousel-stage`, `.carousel-nav` (all variants), `.unit-edit-card`, the `@keyframes unit-enter-*`, the `.unit-edit-card.unit-enter-*` rules, the reduced-motion block, and `.unit-edit-head` (~lines 867-927).

**Keep** `.unit-edit-name` (~line 928) and `.unit-delete-x` (~line 939) — the grid reuses them. Leave `.editor-units-head` (~line 842) but note it no longer needs `text-align: center`; you may simplify it to `.editor-units-head { margin-top: 8px; }`.

- [ ] **Step 2: Add the grid CSS**

Add to `styles.css` (in the editor section):

```css
/* ---- Unit grid (spreadsheet editor) ---------------------------------- */
[data-screen="editor"] .editor-grid-wrap {
  overflow: auto;
  max-height: 60vh;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  margin-bottom: 12px;
}
[data-screen="editor"] .unit-grid {
  border-collapse: separate;
  border-spacing: 0;
  width: max-content;
  min-width: 100%;
}
[data-screen="editor"] .unit-grid th,
[data-screen="editor"] .unit-grid td {
  border-right: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
  padding: 4px 8px;
  white-space: nowrap;
  vertical-align: middle;
}
[data-screen="editor"] .unit-grid thead th {
  position: sticky;
  top: 0;
  z-index: 2;
  background: var(--surface-muted);
  text-align: left;
  font-weight: 600;
  color: var(--text);
}
[data-screen="editor"] .unit-grid .rowhead,
[data-screen="editor"] .unit-grid .corner {
  position: sticky;
  left: 0;
  background: var(--surface);
  z-index: 1;
}
[data-screen="editor"] .unit-grid thead .corner {
  background: var(--surface-muted);
  z-index: 3; /* frozen corner sits above both sticky edges */
}
[data-screen="editor"] .unit-grid .rowhead-inner {
  display: flex;
  align-items: center;
  gap: 6px;
}
[data-screen="editor"] .unit-grid .unit-edit-name {
  min-width: 130px;
}
[data-screen="editor"] .unit-grid td input[type="number"],
[data-screen="editor"] .unit-grid td select {
  width: 100%;
  min-width: 90px;
}
[data-screen="editor"] .unit-grid tr.ghost {
  opacity: 0.55;
}
```

- [ ] **Step 3: Verify visually (light + dark)**

Run `python -m http.server 8000`, open the editor with a multi-input, multi-unit project:
- The header row and the Unit column stay pinned while input columns scroll horizontally; the top-left "Unit" cell stays put in both directions with no content bleeding through (opaque sticky backgrounds).
- Toggle dark mode (`[data-theme="dark"]`) — colors come from tokens, borders/text readable.
- The ghost row is visibly faint; delete/name controls look right.

- [ ] **Step 4: Commit**

```bash
git add styles.css
git commit -m "style: grid layout with frozen panes; drop carousel CSS"
```

---

### Task 8: Full test run + browser smoke test

**Files:** none (verification task).

- [ ] **Step 1: Run the unit suite**

Run: `npm test`
Expected: PASS — all suites green, including the new `tests/unitGrid.test.js`.

- [ ] **Step 2: Syntax-check touched modules**

Run: `node --check src/app.js && node --check src/unitGrid.js`
Expected: no output.

- [ ] **Step 3: Browser smoke test (headless Edge over CDP)**

Follow the `browser-smoke-test-harness` memory to launch headless Edge and drive the app. Script the following and assert each:
1. Create a new project; the editor shows the grid.
2. Type a project name; type two unit names in rows; set some inputs.
3. Focus a cell and dispatch a paste of a 3-row × N-column TSV block; assert three (or more) unit rows now exist with the pasted values coerced (booleans, choices, numbers).
4. Scroll `#editor-grid-wrap` horizontally; assert the `.corner` and a `.rowhead` remain at `left: 0` (frozen) — e.g. compare `getBoundingClientRect().left` before/after scroll.
5. Delete a row; assert the row count drops and the delete button is disabled when one unit remains.
6. Save; reopen the project; assert units + inputs persisted.

- [ ] **Step 4: Final commit if any smoke-fix was needed**

If the smoke test surfaced a fix, commit it:

```bash
git add -A
git commit -m "fix: <what the smoke test caught>"
```

Otherwise no commit — the feature is complete on the branch.

---

## Self-Review Notes

- **Spec coverage:** pure module (Tasks 1-3) ✓; carousel→grid replacement (Tasks 4-5) ✓; freeze panes (Task 7) ✓; ghost row + Add Unit (Task 5) ✓; delete row w/ confirm (Task 5) ✓; Tab/Enter/arrow nav (Task 6) ✓; Excel paste creating units (Tasks 3, 6) ✓; validation unchanged (relies on existing `validateDraft`) ✓; unit + smoke tests (Tasks 1-3, 8) ✓.
- **Out of scope (per spec):** column resize/reorder/hide, drag-select/fill-handle, undo/redo, whole-project CSV import — none planned.
- **Type consistency:** `UNCHANGED` sentinel, `coerceInputValue(def, raw)`, `parseClipboardMatrix(text)`, `applyPasteMatrix({units,model,startRow,startCol,matrix,makeUnit})`, `focusCell(row,col,caretEnd)`, `renderUnitGrid()`, `buildUnitRow(unit,rowIdx,model,isGhost)`, `materializeGhost(col,apply)` — names used consistently across tasks. `dataset.col`: `'0'`=name, `'1..n'`=inputs; `dataset.row` on every `<tr>`.
```
