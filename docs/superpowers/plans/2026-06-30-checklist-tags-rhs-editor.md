# Checklist Unit Tags + RHS Editor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the per-unit checklist view with a single tagged item list plus a docked right-hand panel (read-only inputs viewer + per-unit item editor), without changing the on-disk data model or the Excel export.

**Architecture:** Per-unit `inputs`/`checks`/`comments` storage is untouched; all new behaviour is a *view* computed over it. New pure helpers live in `src/checklistView.js` (unit-tested with `node:test`). UI wiring lives in `src/app.js` + `index.html` + `styles.css` and is verified manually in the browser. Built in three independently-shippable stages: (1) RHS panel + inputs viewer, (2) item editor + click-to-open, (3) unify the list with tags.

**Tech Stack:** Vanilla ES modules, vendored SheetJS/JSZip, `node --test`. No build step. No new dependencies.

## Global Constraints

- **No exporter changes.** `src/exporter.js` (`buildExportPlan`, `buildExportRows`, `applicableItems`, `computeProgress`, `computeProjectProgress`) stays as-is. Export remains one sheet per unit of unchecked applicable items.
- **No on-disk schema change.** `unit.inputs` `{name: value}`, `unit.checks` `{itemId: bool}`, `unit.comments` `{itemId: string}` keep their shapes.
- **No new dependencies / no build step.** Plain ES modules loaded by `index.html`.
- **Model items carry `.condition`**; applicability is evaluated with `isApplicable(item.condition, unitInputs, model.inputDefs)` from `src/conditionEngine.js`.
- **Run all tests with** `npm test` (`node --test`). Pure logic is TDD; DOM/UI tasks are verified manually via the browser smoke harness (Edge headless over CDP — see project memory `browser-smoke-test-harness`).
- Each stage must leave the app fully working.

---

## File Structure

- **Create** `src/checklistView.js` — pure view helpers over `(model, project)`: `itemApplicableUnits`, `itemCheckState`, `unifiedItems`.
- **Create** `tests/checklistView.test.js` — unit tests for the above.
- **Modify** `index.html` — project screen markup: two-column body, docked panel (inputs viewer + item editor), remove unit-select bar (Stage 3).
- **Modify** `src/app.js` — state fields, inputs-viewer rendering, item-editor rendering, unified `renderItems`, sync wiring.
- **Modify** `styles.css` — two-column layout, panel, collapsible section, unit tags, tri-state checkbox, responsive stacking.

---

## Stage 1 — RHS scaffold + read-only inputs viewer

### Task 1: Two-column project screen with collapsible inputs viewer

**Files:**
- Modify: `index.html` (project screen `.project-body`, around lines 143-145)
- Modify: `src/app.js` (`state` object lines 12-20; `renderProject` lines 720-733; init wiring near lines 869-967)
- Modify: `styles.css` (append layout + panel rules)

**Interfaces:**
- Consumes: `state.model.inputs` (array of `{name, type, label, unit, choices, default}`), `getCurrentProject()`, `state.currentUnitId`, `ensureUnitInputs(unit)`.
- Produces: `renderInputsViewer()`, `formatInputValue(def, value)`, `state.viewerUnitId`. Later tasks rely on the panel DOM ids: `#detail-panel`, `#item-editor-body`, `#editor-empty`.

- [ ] **Step 1: Replace the project-body markup with two columns + docked panel**

In `index.html`, replace:

```html
      <div class="project-body">
        <div id="items-list" class="items-list"></div>
      </div>
```

with:

```html
      <div class="project-body">
        <div id="items-list" class="items-list"></div>
        <aside id="detail-panel" class="detail-panel">
          <section class="panel-section" id="inputs-viewer">
            <button id="inputs-toggle" class="panel-head" type="button" aria-expanded="true">
              <span>Inputs</span>
              <svg class="panel-chevron" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
            </button>
            <div id="inputs-body" class="panel-body">
              <label class="viewer-unit-row">
                <span>Unit</span>
                <select id="viewer-unit-select"></select>
              </label>
              <dl id="inputs-readout" class="inputs-readout"></dl>
            </div>
          </section>
          <section class="panel-section" id="item-editor">
            <div id="editor-empty" class="editor-empty muted">Select an item to add a comment and check it off per unit.</div>
            <div id="item-editor-body" class="item-editor-body" hidden></div>
          </section>
        </aside>
      </div>
```

- [ ] **Step 2: Add panel + layout CSS**

Append to `styles.css`:

```css
/* Two-column checklist: list + docked detail panel */
.project-body { display: flex; align-items: flex-start; gap: 20px; }
.items-list { flex: 1 1 auto; min-width: 0; }
.detail-panel {
  flex: 0 0 340px; width: 340px; position: sticky; top: 16px;
  display: flex; flex-direction: column; gap: 14px;
}
.panel-section { border: 1px solid var(--border, #d8dde3); border-radius: 10px; background: var(--card, #fff); overflow: hidden; }
.panel-head {
  width: 100%; display: flex; align-items: center; justify-content: space-between;
  padding: 10px 14px; background: none; border: none; cursor: pointer;
  font-weight: 600; font-size: 0.95rem; color: inherit;
}
.panel-chevron { transition: transform 0.15s ease; }
.panel-section.collapsed .panel-chevron { transform: rotate(-90deg); }
.panel-section.collapsed .panel-body { display: none; }
.panel-body { padding: 0 14px 14px; }
.viewer-unit-row { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.viewer-unit-row select { flex: 1; }
.inputs-readout { display: grid; grid-template-columns: 1fr auto; gap: 4px 12px; margin: 0; }
.inputs-readout dt { color: var(--muted, #6b7480); font-size: 0.85rem; }
.inputs-readout dd { margin: 0; text-align: right; font-variant-numeric: tabular-nums; }
.editor-empty { padding: 14px; font-size: 0.9rem; }
.item-editor-body { padding: 14px; }
@media (max-width: 900px) {
  .project-body { flex-direction: column; }
  .detail-panel { width: 100%; flex-basis: auto; position: static; }
}
```

- [ ] **Step 3: Add viewer state + rendering functions in `src/app.js`**

Add `viewerUnitId: null` to the `state` object (after `editor: null,` on line 19):

```js
  editor: null, // { draft, isNew, dirty }
  viewerUnitId: null,
```

Add these functions (place them just before `renderProgress` near line 681):

```js
function formatInputValue(def, value) {
  if (def.type === 'Boolean') return value === true ? 'Yes' : 'No';
  if (value === '' || value == null) return '—';
  return String(value);
}

function renderInputsViewer() {
  const project = getCurrentProject();
  if (!project) return;
  const sel = document.getElementById('viewer-unit-select');
  // Default the viewer to the project's first unit (or keep a valid prior pick).
  if (!project.units.some(u => u.id === state.viewerUnitId)) {
    state.viewerUnitId = project.units[0] ? project.units[0].id : null;
  }
  sel.innerHTML = '';
  for (const u of project.units) {
    const opt = document.createElement('option');
    opt.value = u.id; opt.textContent = u.name;
    if (u.id === state.viewerUnitId) opt.selected = true;
    sel.appendChild(opt);
  }
  const unit = project.units.find(u => u.id === state.viewerUnitId);
  const dl = document.getElementById('inputs-readout');
  dl.innerHTML = '';
  if (!unit) return;
  for (const def of state.model.inputs) {
    const dt = document.createElement('dt');
    dt.textContent = def.label + (def.unit ? ` (${def.unit})` : '');
    const dd = document.createElement('dd');
    dd.textContent = formatInputValue(def, unit.inputs[def.name]);
    dl.append(dt, dd);
  }
}
```

- [ ] **Step 4: Ensure inputs on every unit, and call the viewer from `renderProject`**

In `renderProject` (lines 720-733), replace the body so all units get default inputs (the viewer and, later, applicability read every unit) and the viewer renders:

```js
function renderProject() {
  const project = getCurrentProject();
  if (!project) { showScreen('dashboard'); return; }
  if (!getCurrentUnit()) state.currentUnitId = project.units[0].id;
  document.getElementById('project-title').textContent = project.name;
  renderUnitBar();
  renderSectionFilter();
  for (const u of project.units) ensureUnitInputs(u);
  saveCurrent(project); // persist any defaults just applied
  renderInputsViewer();
  renderItems(unitOf(project));
  renderProgress();
}
```

- [ ] **Step 5: Wire the viewer unit selector and collapse toggle in `init`**

In `init` (after the `section-select` listener near line 900), add:

```js
  document.getElementById('viewer-unit-select').addEventListener('change', e => {
    state.viewerUnitId = e.target.value;
    renderInputsViewer();
  });
  document.getElementById('inputs-toggle').addEventListener('click', () => {
    const section = document.getElementById('inputs-viewer');
    const collapsed = section.classList.toggle('collapsed');
    document.getElementById('inputs-toggle').setAttribute('aria-expanded', String(!collapsed));
  });
```

- [ ] **Step 6: Verify no regressions and manual check**

Run: `npm test`
Expected: all existing suites PASS (no logic changed).

Manual (browser smoke harness — see memory `browser-smoke-test-harness`): load a setup ZIP, open a project with ≥2 units. Confirm: the items list still renders and checks/comments still work exactly as before; the right panel shows "Inputs" with a unit selector; switching units changes the read-only values; the chevron collapses/expands the inputs body.

- [ ] **Step 7: Commit**

```bash
git add index.html src/app.js styles.css
git commit -m "feat: add docked RHS panel with read-only inputs viewer"
```

---

## Stage 2 — Item editor + click-to-open

### Task 2: `itemApplicableUnits` helper (TDD)

**Files:**
- Create: `src/checklistView.js`
- Test: `tests/checklistView.test.js`

**Interfaces:**
- Consumes: `isApplicable(condition, values, inputDefs)` from `src/conditionEngine.js`; `model.inputDefs`; `model.items[].condition`.
- Produces: `itemApplicableUnits(model, project, item) -> Unit[]` (the units of `project` whose `inputs` satisfy `item.condition`, preserving `project.units` order).

- [ ] **Step 1: Write the failing test**

Create `tests/checklistView.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildModel } from '../src/workbookModel.js';
import { itemApplicableUnits } from '../src/checklistView.js';

const inputRows = [
  ['Name', 'Type', 'Label', 'Unit', 'Choices', 'Default'],
  ['PitToEarth', 'Boolean', 'Pit', '', '', 'FALSE'],
  ['MaxFFLInt', 'Float', 'FFL', 'm', '', '0'],
];
const checklistRows = [
  ['Item ID', 'Conditions', 'Description', 'Code', 'Note', 'Example'],
  ['A08', '', 'Always', 'AS3000', '', ''],
  ['A10', 'PitToEarth: FALSE', 'No pit', 'EN81', '', ''],
  ['A11', 'MaxFFLInt: >11', 'Tall', 'RDM', '', ''],
];
const model = buildModel({ checklistRows, inputRows });
const item = id => model.items.find(i => i.id === id);
const project = {
  units: [
    { id: 'u1', name: 'U1', inputs: { PitToEarth: false, MaxFFLInt: 5 }, checks: {}, comments: {} },
    { id: 'u2', name: 'U2', inputs: { PitToEarth: true, MaxFFLInt: 12 }, checks: {}, comments: {} },
  ],
};

test('itemApplicableUnits: always-applies item matches every unit', () => {
  assert.deepEqual(itemApplicableUnits(model, project, item('A08')).map(u => u.id), ['u1', 'u2']);
});

test('itemApplicableUnits: condition filters units', () => {
  assert.deepEqual(itemApplicableUnits(model, project, item('A10')).map(u => u.id), ['u1']);
  assert.deepEqual(itemApplicableUnits(model, project, item('A11')).map(u => u.id), ['u2']);
});

test('itemApplicableUnits: no matching unit returns empty', () => {
  const p = { units: [{ id: 'x', name: 'X', inputs: { PitToEarth: true, MaxFFLInt: 0 }, checks: {}, comments: {} }] };
  assert.deepEqual(itemApplicableUnits(model, p, item('A11')), []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/checklistView.test.js`
Expected: FAIL — cannot find module `../src/checklistView.js`.

- [ ] **Step 3: Write minimal implementation**

Create `src/checklistView.js`:

```js
import { isApplicable } from './conditionEngine.js';

// Units of `project` whose inputs satisfy `item`'s condition (project order).
export function itemApplicableUnits(model, project, item) {
  return (project.units || []).filter(u =>
    isApplicable(item.condition, u.inputs || {}, model.inputDefs));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/checklistView.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/checklistView.js tests/checklistView.test.js
git commit -m "feat: add itemApplicableUnits view helper"
```

### Task 3: Item editor panel with click-to-open and two-way sync

**Files:**
- Modify: `src/app.js` (import; `state`; `renderItems` lines 565-636; new editor functions; `renderProject`; `init`)

**Interfaces:**
- Consumes: `itemApplicableUnits` (Task 2); `getCurrentProject()`, `saveCurrent(project)`, `getCurrentUnit()`, `openExample(name)`, `escapeHtml`, `INFO_ICON`, `renderProgress`, `buildInputControl` (not used), `state.currentUnitId`.
- Produces: `openItemEditor(itemId, unitId)`, `renderItemEditor()`, `state.editorItemId`, `state.editorUnitId`. Editor mutates `unit.checks[itemId]` / `unit.comments[itemId]` on the fetched project and persists via `saveCurrent`.

- [ ] **Step 1: Import the helper and add editor state**

At the top of `src/app.js`, after the existing imports, add:

```js
import { itemApplicableUnits } from './checklistView.js';
```

Add to `state` (after `viewerUnitId: null,`):

```js
  editorItemId: null,
  editorUnitId: null,
```

- [ ] **Step 2: Add the editor render + open functions**

Add before `renderProgress` in `src/app.js`:

```js
function openItemEditor(itemId, unitId) {
  const item = state.model.items.find(i => i.id === itemId);
  if (!item) return;
  const applicable = itemApplicableUnits(state.model, getCurrentProject(), item);
  state.editorItemId = itemId;
  if (unitId && applicable.some(u => u.id === unitId)) state.editorUnitId = unitId;
  else if (!applicable.some(u => u.id === state.editorUnitId)) {
    state.editorUnitId = applicable[0] ? applicable[0].id : null;
  }
  renderItemEditor();
}

function renderItemEditor() {
  const empty = document.getElementById('editor-empty');
  const body = document.getElementById('item-editor-body');
  const item = state.editorItemId
    ? state.model.items.find(i => i.id === state.editorItemId) : null;
  const project = getCurrentProject();
  const applicable = item ? itemApplicableUnits(state.model, project, item) : [];
  if (!item || applicable.length === 0) {
    empty.hidden = false; body.hidden = true; body.innerHTML = '';
    return;
  }
  empty.hidden = true; body.hidden = false;
  const unit = applicable.find(u => u.id === state.editorUnitId) || applicable[0];
  state.editorUnitId = unit.id;

  body.innerHTML = `
    <div class="ed-item-head">
      <span class="id">${escapeHtml(item.id)}</span>
      ${item.code ? `<span class="code-tag">${escapeHtml(item.code)}</span>` : ''}
      ${item.exampleFile ? `<button type="button" class="item-info" data-example="${escapeHtml(item.exampleFile)}" title="View example" aria-label="View example">${INFO_ICON}</button>` : ''}
    </div>
    <p class="ed-desc">${escapeHtml(item.description)}</p>
    ${item.note ? `<div class="item-note">${escapeHtml(item.note)}</div>` : ''}
    <label class="ed-unit-row"><span>Unit</span><select id="ed-unit-select"></select></label>
    <label class="ed-check-row"><input type="checkbox" id="ed-check" ${unit.checks[item.id] === true ? 'checked' : ''}/> <span>Checked for this unit</span></label>
    <textarea id="ed-comment" class="ed-comment" rows="4" placeholder="Comment for this unit…"></textarea>`;

  const sel = body.querySelector('#ed-unit-select');
  for (const u of applicable) {
    const opt = document.createElement('option');
    opt.value = u.id; opt.textContent = u.name;
    if (u.id === unit.id) opt.selected = true;
    sel.appendChild(opt);
  }
  sel.addEventListener('change', () => { state.editorUnitId = sel.value; renderItemEditor(); });

  body.querySelector('#ed-comment').value = unit.comments[item.id] || '';
  body.querySelector('#ed-comment').addEventListener('input', e => {
    const p = getCurrentProject();
    const u = p.units.find(x => x.id === state.editorUnitId);
    u.comments[item.id] = e.target.value;
    saveCurrent(p);
  });
  body.querySelector('#ed-check').addEventListener('change', e => {
    const p = getCurrentProject();
    const u = p.units.find(x => x.id === state.editorUnitId);
    u.checks[item.id] = e.target.checked;
    saveCurrent(p);
    renderItems(getCurrentUnit());
    renderProgress();
  });
  const info = body.querySelector('[data-example]');
  if (info) info.addEventListener('click', () => openExample(info.getAttribute('data-example')));
}
```

- [ ] **Step 3: Make list rows open the editor, and keep the editor in sync**

In `renderItems` (lines 565-636), inside the `for (const item of visible)` loop, after `container.appendChild(div);` add a row click handler that ignores clicks on interactive controls:

```js
    div.addEventListener('click', e => {
      if (e.target.closest('input, textarea, button')) return;
      openItemEditor(item.id, state.currentUnitId);
    });
```

In the same function, update the checkbox handler (lines 626-633) to also refresh an open editor:

```js
  container.querySelectorAll('[data-check]').forEach(cb =>
    cb.addEventListener('change', () => {
      const { project, unit: u } = getCurrentProjectAndUnit();
      u.checks[cb.getAttribute('data-check')] = cb.checked;
      saveCurrent(project);
      renderItems(u);
      renderProgress();
      renderItemEditor();
    }));
```

- [ ] **Step 4: Reset and render the editor from `renderProject`**

In `renderProject`, after `renderInputsViewer();` add:

```js
  renderItemEditor();
```

(Initially `state.editorItemId` is null, so the panel shows the placeholder.)

- [ ] **Step 5: Add editor CSS**

Append to `styles.css`:

```css
.ed-item-head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.ed-desc { margin: 0 0 10px; font-weight: 600; }
.ed-unit-row { display: flex; align-items: center; gap: 8px; margin: 12px 0 8px; }
.ed-unit-row select { flex: 1; }
.ed-check-row { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.ed-comment { width: 100%; box-sizing: border-box; resize: vertical; }
.items-list .item { cursor: pointer; }
```

- [ ] **Step 6: Verify no regressions and manual check**

Run: `npm test`
Expected: all suites PASS.

Manual (browser harness): open a project with ≥2 units. Click an item row (not the checkbox) → editor opens on the right showing the item, a unit dropdown (only applicable units), a checkbox, and a comment box. Type a comment and toggle the editor checkbox → confirm the matching unit in the existing list reflects the check when you switch the list's unit dropdown to it. Toggle the list checkbox → the editor's checkbox (for the same unit) updates. Switching the editor's unit dropdown swaps the shown check/comment.

- [ ] **Step 7: Commit**

```bash
git add src/app.js styles.css
git commit -m "feat: per-unit item editor in RHS panel with click-to-open"
```

---

## Stage 3 — Unify the list with tags

### Task 4: `itemCheckState` + `unifiedItems` helpers (TDD)

**Files:**
- Modify: `src/checklistView.js`
- Modify: `tests/checklistView.test.js`

**Interfaces:**
- Consumes: `itemApplicableUnits` (Task 2); `unit.checks`.
- Produces: `itemCheckState(item, applicableUnits) -> 'all' | 'some' | 'none'` ('none' when zero applicable units or zero checked; 'all' when every applicable unit is checked; otherwise 'some'). `unifiedItems(model, project) -> Item[]` (model items applicable to ≥1 unit, in model order).

- [ ] **Step 1: Write the failing tests**

Append to `tests/checklistView.test.js`:

```js
import { itemCheckState, unifiedItems } from '../src/checklistView.js';

test('itemCheckState: none / some / all', () => {
  const i = item('A08');
  const u1 = { id: 'u1', checks: {} };
  const u2 = { id: 'u2', checks: {} };
  assert.equal(itemCheckState(i, [u1, u2]), 'none');
  u1.checks.A08 = true;
  assert.equal(itemCheckState(i, [u1, u2]), 'some');
  u2.checks.A08 = true;
  assert.equal(itemCheckState(i, [u1, u2]), 'all');
});

test('itemCheckState: empty applicable set is none', () => {
  assert.equal(itemCheckState(item('A08'), []), 'none');
});

test('unifiedItems: items applicable to >=1 unit, in model order', () => {
  // project: u1 (no pit, short) -> A08,A10 ; u2 (pit, tall) -> A08,A11
  assert.deepEqual(unifiedItems(model, project).map(i => i.id), ['A08', 'A10', 'A11']);
  // a project where no unit is tall drops A11
  const shortOnly = { units: [{ id: 'u1', name: 'U1', inputs: { PitToEarth: false, MaxFFLInt: 5 }, checks: {}, comments: {} }] };
  assert.deepEqual(unifiedItems(model, shortOnly).map(i => i.id), ['A08', 'A10']);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/checklistView.test.js`
Expected: FAIL — `itemCheckState`/`unifiedItems` are not exported.

- [ ] **Step 3: Add the implementations**

Append to `src/checklistView.js`:

```js
// Tri-state for the unified checkbox over an item's applicable units.
export function itemCheckState(item, applicableUnits) {
  const checked = applicableUnits.filter(u => (u.checks || {})[item.id] === true).length;
  if (checked === 0) return 'none';
  if (checked === applicableUnits.length) return 'all';
  return 'some';
}

// Model items applicable to at least one unit, in model order.
export function unifiedItems(model, project) {
  return model.items.filter(item => itemApplicableUnits(model, project, item).length > 0);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/checklistView.test.js`
Expected: PASS (all checklistView tests).

- [ ] **Step 5: Commit**

```bash
git add src/checklistView.js tests/checklistView.test.js
git commit -m "feat: add itemCheckState and unifiedItems view helpers"
```

### Task 5: Unified tagged list, tri-state checks, project-wide progress

**Files:**
- Modify: `index.html` (remove `#unit-bar`, lines 124-127)
- Modify: `src/app.js` (imports; `renderItems`; `renderProgress`; remove `renderUnitBar` + unit-select wiring; update `renderItems` callers)
- Modify: `styles.css` (unit tags, indeterminate checkbox)

**Interfaces:**
- Consumes: `unifiedItems`, `itemApplicableUnits`, `itemCheckState` (Tasks 2/4); `computeProjectProgress` (exporter); `openItemEditor`, `renderItemEditor` (Task 3); `escapeHtml`, `INFO_ICON`, `openExample`, `state.sectionFilter`, `state.hideChecked`.
- Produces: a no-argument `renderItems()` that renders the unified list and a project-wide `renderProgress()`.

- [ ] **Step 1: Extend the checklistView import**

In `src/app.js`, change the Task-2 import line to:

```js
import { itemApplicableUnits, itemCheckState, unifiedItems } from './checklistView.js';
```

- [ ] **Step 2: Remove the unit-select bar from the project screen**

In `index.html`, delete:

```html
      <div id="unit-bar" class="unit-bar">
        <label for="unit-select">Unit</label>
        <select id="unit-select"></select>
      </div>
```

- [ ] **Step 3: Remove unit-select wiring and `renderUnitBar`**

In `src/app.js`:
- Delete the `renderUnitBar` function (lines 691-702).
- In `renderProject`, delete the `renderUnitBar();` call.
- In `init`, delete the `unit-select` change listener:

```js
  document.getElementById('unit-select').addEventListener('change', e => {
    state.currentUnitId = e.target.value;
    renderProject();
  });
```

- [ ] **Step 4: Rewrite `renderItems` as the unified tagged list**

Replace the entire `renderItems(unit)` function (lines 565-636) with:

```js
function renderItems() {
  const container = document.getElementById('items-list');
  container.innerHTML = '';
  const project = getCurrentProject();
  let items = unifiedItems(state.model, project);
  if (state.sectionFilter) items = items.filter(i => i.sectionPrefix === state.sectionFilter);

  // Precompute applicable units + tri-state per item.
  const meta = new Map();
  for (const i of items) {
    const units = itemApplicableUnits(state.model, project, i);
    meta.set(i.id, { units, state: itemCheckState(i, units) });
  }

  // Section totals from the full (pre hide-checked) list. Done = fully checked.
  const total = new Map();
  const done = new Map();
  for (const i of items) {
    total.set(i.section, (total.get(i.section) || 0) + 1);
    if (meta.get(i.id).state === 'all') done.set(i.section, (done.get(i.section) || 0) + 1);
  }

  const visible = state.hideChecked ? items.filter(i => meta.get(i.id).state !== 'all') : items;
  let currentSection = null;
  for (const item of visible) {
    if (item.section !== currentSection) {
      currentSection = item.section;
      const h = document.createElement('h3');
      h.className = 'section-heading';
      h.innerHTML = `<span>${escapeHtml(currentSection)}</span>` +
        `<span class="section-count">${done.get(currentSection) || 0} / ${total.get(currentSection) || 0}</span>`;
      container.appendChild(h);
    }
    const { units, state: cs } = meta.get(item.id);
    const div = document.createElement('div');
    div.className = 'item' + (cs === 'all' ? ' checked' : '');
    const tags = units.map(u =>
      `<button type="button" class="unit-tag${u.checks[item.id] === true ? ' done' : ''}" data-tag-item="${escapeHtml(item.id)}" data-tag-unit="${escapeHtml(u.id)}">${escapeHtml(u.name)}</button>`
    ).join('');
    div.innerHTML = `
      <div class="item-head">
        <input type="checkbox" data-check="${escapeHtml(item.id)}" />
        <div>
          <span class="id">${escapeHtml(item.id)}</span> — ${escapeHtml(item.description)}
          ${item.code ? `<span class="code-tag">${escapeHtml(item.code)}</span>` : ''}
          ${item.note ? `<div class="item-note">${escapeHtml(item.note)}</div>` : ''}
          <div class="unit-tags">${tags}</div>
        </div>
        ${item.exampleFile ? `<button type="button" class="item-info" data-example="${escapeHtml(item.exampleFile)}" title="View example" aria-label="View example for ${escapeHtml(item.id)}">${INFO_ICON}</button>` : ''}
      </div>`;
    const cb = div.querySelector('[data-check]');
    cb.checked = cs === 'all';
    cb.indeterminate = cs === 'some';
    container.appendChild(div);
    div.addEventListener('click', e => {
      if (e.target.closest('input, textarea, button')) return;
      openItemEditor(item.id, state.viewerUnitId);
    });
  }

  if (visible.length === 0) {
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = state.hideChecked
      ? 'All applicable items are checked. ✓'
      : 'No applicable items for the current inputs.';
    container.appendChild(p);
  }

  container.querySelectorAll('[data-check]').forEach(cb =>
    cb.addEventListener('change', () => {
      const itemId = cb.getAttribute('data-check');
      const item = state.model.items.find(i => i.id === itemId);
      const p = getCurrentProject();
      const applicable = itemApplicableUnits(state.model, p, item);
      const target = itemCheckState(item, applicable) !== 'all';
      for (const u of applicable) {
        const live = p.units.find(x => x.id === u.id);
        live.checks[itemId] = target;
      }
      saveCurrent(p);
      renderItems();
      renderProgress();
      renderItemEditor();
    }));
  container.querySelectorAll('[data-tag-item]').forEach(tag =>
    tag.addEventListener('click', e => {
      e.stopPropagation();
      openItemEditor(tag.getAttribute('data-tag-item'), tag.getAttribute('data-tag-unit'));
    }));
  container.querySelectorAll('[data-example]').forEach(btn =>
    btn.addEventListener('click', e => { e.stopPropagation(); openExample(btn.getAttribute('data-example')); }));
}
```

- [ ] **Step 5: Update `renderItems` callers and project-wide progress**

In `src/app.js`:
- In `renderProject`, change `renderItems(unitOf(project));` to `renderItems();`.
- In `init`, change the section-filter and hide-checked listeners to call `renderItems()` with no argument:

```js
  document.getElementById('section-select').addEventListener('change', e => {
    state.sectionFilter = e.target.value;
    renderItems();
  });
  document.getElementById('toggle-hide-checked').addEventListener('change', e => {
    state.hideChecked = e.target.checked;
    renderItems();
  });
```

- Replace `renderProgress` (lines 681-689) with a project-wide version:

```js
function renderProgress() {
  const project = getCurrentProject();
  const all = computeProjectProgress(state.model, project);
  document.getElementById('project-progress-bar').style.width = Math.round(all.ratio * 100) + '%';
  document.getElementById('project-progress-label').textContent =
    `${all.checked} / ${all.applicable} checked across project`;
}
```

(`computeProgress` is still imported and used elsewhere — the dashboard — so leave the import list as-is.)

- [ ] **Step 6: Add unit-tag + indeterminate-checkbox CSS**

Append to `styles.css`:

```css
.unit-tags { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
.unit-tag {
  font-size: 0.78rem; line-height: 1; padding: 4px 8px; border-radius: 999px;
  border: 1px solid var(--accent, #2f6feb); color: var(--accent, #2f6feb);
  background: none; cursor: pointer;
}
.unit-tag.done {
  background: var(--accent, #2f6feb); color: #fff;
}
.unit-tag.done::before { content: '✓ '; }
.items-list .item input[type=checkbox]:indeterminate { opacity: 0.85; }
```

- [ ] **Step 7: Verify and manual check**

Run: `npm test`
Expected: all suites PASS (exporter tests unchanged confirms export still works).

Manual (browser harness): open a project with ≥2 units having different inputs.
- Each item appears **once**; items not applicable to any unit are absent.
- Each row shows unit tags; tags for checked units are filled with ✓.
- Ticking a row's checkbox checks the item for **all** its applicable units (tags all turn filled); the box shows indeterminate when only some units are checked (toggle one unit from the editor to see it).
- Clicking a tag opens the editor focused on that unit.
- Progress label reads "X / Y checked across project".
- "Hide checked" hides only fully-checked items.
- Download ZIP still produces one sheet per unit of the unchecked items with comments.

- [ ] **Step 8: Commit**

```bash
git add index.html src/app.js styles.css
git commit -m "feat: unified tagged checklist with tri-state per-unit checks"
```

---

## Self-Review Notes

- **Spec coverage:** press-to-open editor (Task 3 Step 3, Task 5 row click) ✓; remove unit selection → tags (Task 5) ✓; per-unit comment via editor dropdown (Task 3) ✓; read-only collapsible inputs viewer with unit selector (Task 1) ✓; editor opens on click with applicable-unit dropdown (Task 3) ✓; remove main comment box (Task 5 — new `renderItems` omits the textarea) ✓; two synced check paths with tri-state "check all applicable units" (Task 5 checkbox handler + editor sync) ✓; tags reflect state and are clickable (Task 5) ✓; section counts/progress/hide-checked redefined (Task 5) ✓; export untouched (Global Constraints; verified Task 5 Step 7) ✓.
- **Placeholder scan:** none — every code step shows full code.
- **Type consistency:** `itemApplicableUnits(model, project, item)`, `itemCheckState(item, applicableUnits)`, `unifiedItems(model, project)`, `openItemEditor(itemId, unitId)`, `renderItemEditor()`, no-arg `renderItems()`/`renderProgress()` used consistently across tasks.
