# Dedicated Project Setup / Edit Page — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dedicated editor screen for creating and editing a project (name, units, per-unit inputs), with a draft-copy Save/Cancel model, an "Edit project" button in the checklist header, and a read-only inputs summary on the checklist screen.

**Architecture:** A new `editor` screen joins the existing `setup/dashboard/project/about` screens in the single-page app. Pure, DOM-free logic (default values, value formatting, validation, draft construction) is extracted into a new `src/projectDraft.js` module so it can be unit-tested under `node --test`; all DOM rendering and wiring lives in `src/app.js` and is verified manually with the browser smoke-test harness. Editing mutates an in-memory draft clone; **Save** commits via the existing `projectStore.saveProject` (which already triggers the debounced IndexedDB flush + file backup), **Cancel** discards it.

**Tech Stack:** Vanilla ES modules, no build step. Tests: Node's built-in test runner (`node --test`) with `node:assert/strict`. Vendored SheetJS/JSZip (not relevant here). Spec: `docs/superpowers/specs/2026-06-29-new-project-setup-design.md`.

## Global Constraints

- No new runtime dependencies; vanilla ES modules only (the app runs fully offline). One line each below is verbatim from the spec / codebase conventions.
- Tests import from `../src/` and use `import { test } from 'node:test';` + `import assert from 'node:assert/strict';`.
- DOM/UI code is **not** unit-tested in this repo (no jsdom); verify UI manually with the browser smoke-test harness (`smoke.mjs` driving Edge via CDP; serve with `python -m http.server 8123`).
- Run `npm test` after every task to confirm existing tests still pass.
- The editor screen is reached via buttons, not the sidebar; while open the sidebar highlights **Projects** (`nav-dashboard`).
- Booleans display as `Yes`/`No`; empty/unset input values display as `—`.
- Use `escapeHtml(...)` (already in app.js) for any user-supplied text inserted via `innerHTML`.
- Branch for this work already exists: `feature/project-setup-page`. Commit to it.

---

### Task 1: Pure draft/format/validation helpers (`src/projectDraft.js`)

Extract the value logic the editor and read-only summary need into a testable module, and export the id/unit factories from the store so drafts can be built without persisting.

**Files:**
- Modify: `src/projectStore.js` (add `export` to the module-scope `newId` and `newUnit`)
- Create: `src/projectDraft.js`
- Test: `tests/projectDraft.test.js`

**Interfaces:**
- Consumes: `newId(prefix?)`, `newUnit(name)` from `src/projectStore.js`; the model shape `{ inputs: [{ name, type, label, unit, choices, default }], ... }` from `buildModel`.
- Produces (imported by `app.js` in later tasks):
  - `defaultInputValue(def) -> boolean|number|string`
  - `defaultInputs(model) -> { [inputName]: value }`
  - `formatInputValue(def, value) -> string`
  - `validateDraft(draft) -> { ok: boolean, errors: Array<{ field: 'name'|'units'|'unit', index?: number, message: string }> }`
  - `newBlankDraft(model) -> { id, name: '', units: [unit] }`
  - `newDraftUnit(model, name) -> { id, name, inputs, checks, comments }`

- [ ] **Step 1: Export `newId` and `newUnit` from the store**

In `src/projectStore.js`, add the `export` keyword to the two existing module-scope functions (lines 1 and 5). Leave everything else (including `newUnit` in the returned factory object) unchanged.

```js
export function newId(prefix = 'p') {
  return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

export function newUnit(name) {
  return { id: newId('u'), name: name || 'Unit 1', inputs: {}, checks: {}, comments: {} };
}
```

- [ ] **Step 2: Write the failing test**

Create `tests/projectDraft.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildModel } from '../src/workbookModel.js';
import { createProjectStore } from '../src/projectStore.js';
import {
  defaultInputValue, defaultInputs, formatInputValue,
  validateDraft, newBlankDraft, newDraftUnit,
} from '../src/projectDraft.js';

const inputRows = [
  ['Name', 'Type', 'Label', 'Unit', 'Choices', 'Default'],
  ['Pit', 'Boolean', 'Has pit', '', '', 'FALSE'],
  ['Load', 'Float', 'Load', 'kg', '', '1000'],
  ['Stops', 'Integer', 'Stops', '', '', '2'],
  ['Door', 'Choice', 'Door type', '', 'Centre;Side', 'Side'],
  ['Bad', 'Choice', 'Bad default', '', 'A;B', 'Z'],
];
const checklistRows = [
  ['Item ID', 'Conditions', 'Description', 'Code', 'Note', 'Example'],
  ['A01', '', 'Always', '', '', ''],
];
const model = buildModel({ checklistRows, inputRows });
const def = (name) => model.inputs.find(i => i.name === name);

test('defaultInputValue resolves per type', () => {
  assert.equal(defaultInputValue(def('Pit')), false);
  assert.equal(defaultInputValue(def('Load')), 1000);
  assert.equal(defaultInputValue(def('Stops')), 2);
  assert.equal(defaultInputValue(def('Door')), 'Side');
  assert.equal(defaultInputValue(def('Bad')), 'A'); // default not in choices -> first choice
});

test('defaultInputs builds a value for every model input', () => {
  const inputs = defaultInputs(model);
  assert.deepEqual(Object.keys(inputs).sort(), ['Bad', 'Door', 'Load', 'Pit', 'Stops']);
  assert.equal(inputs.Door, 'Side');
});

test('formatInputValue: Yes/No, dash for empty, passthrough otherwise', () => {
  assert.equal(formatInputValue(def('Pit'), true), 'Yes');
  assert.equal(formatInputValue(def('Pit'), false), 'No');
  assert.equal(formatInputValue(def('Load'), 0), '0');       // 0 is a real value, not empty
  assert.equal(formatInputValue(def('Load'), 1000), '1000');
  assert.equal(formatInputValue(def('Door'), 'Centre'), 'Centre');
  assert.equal(formatInputValue(def('Door'), ''), '—');
  assert.equal(formatInputValue(def('Door'), undefined), '—');
});

test('validateDraft flags missing project name and unit names', () => {
  assert.equal(validateDraft({ name: 'Tower', units: [{ name: 'U1' }] }).ok, true);
  assert.equal(validateDraft({ name: '  ', units: [{ name: 'U1' }] }).ok, false);
  assert.equal(validateDraft({ name: 'Tower', units: [] }).ok, false);
  const r = validateDraft({ name: 'Tower', units: [{ name: '' }] });
  assert.equal(r.ok, false);
  assert.equal(r.errors[0].field, 'unit');
  assert.equal(r.errors[0].index, 0);
});

test('newBlankDraft: empty name, one unit with default inputs', () => {
  const draft = newBlankDraft(model);
  assert.equal(draft.name, '');
  assert.equal(draft.units.length, 1);
  assert.ok(draft.id);
  assert.equal(draft.units[0].inputs.Door, 'Side');
  assert.deepEqual(draft.units[0].checks, {});
});

test('newDraftUnit: named unit with default inputs and empty checks/comments', () => {
  const u = newDraftUnit(model, 'Unit 2');
  assert.equal(u.name, 'Unit 2');
  assert.equal(u.inputs.Pit, false);
  assert.deepEqual(u.comments, {});
});

test('draft round-trips through projectStore: new creates, edit updates', () => {
  const store = createProjectStore();
  // New: save a blank draft -> creates a project at draft.id
  const draft = newBlankDraft(model);
  draft.name = 'Created via editor';
  store.saveProject(draft);
  assert.equal(store.getProject(draft.id).name, 'Created via editor');
  // Edit: fetch clone, mutate, save -> updates same id
  const edit = store.getProject(draft.id);
  edit.name = 'Renamed';
  edit.units.push(newDraftUnit(model, 'Unit 2'));
  store.saveProject(edit);
  const after = store.getProject(draft.id);
  assert.equal(after.name, 'Renamed');
  assert.equal(after.units.length, 2);
});

test('mutating a draft from getProject does not affect the store (cancel safety)', () => {
  const store = createProjectStore();
  const draft = newBlankDraft(model);
  draft.name = 'Saved';
  store.saveProject(draft);
  const editDraft = store.getProject(draft.id);
  editDraft.name = 'Discarded';            // simulate edits then Cancel (never saved)
  editDraft.units[0].inputs.Load = 9999;
  assert.equal(store.getProject(draft.id).name, 'Saved');
  assert.notEqual(store.getProject(draft.id).units[0].inputs.Load, 9999);
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/projectDraft.js'` (or import error for the named exports).

- [ ] **Step 4: Implement `src/projectDraft.js`**

```js
// Pure, DOM-free helpers for building and validating a project draft, and for
// formatting input values. Importable from Node tests (no DOM dependency).
import { newId, newUnit } from './projectStore.js';

export function defaultInputValue(def) {
  if (def.type === 'Boolean') return /^true$/i.test(String(def.default));
  if (def.type === 'Float' || def.type === 'Integer') return def.default === '' ? 0 : Number(def.default);
  if (def.type === 'Choice') return def.choices.includes(def.default) ? def.default : (def.choices[0] ?? '');
  return def.default;
}

export function defaultInputs(model) {
  const inputs = {};
  for (const def of model.inputs) inputs[def.name] = defaultInputValue(def);
  return inputs;
}

// Display string for the checklist's read-only inputs summary.
export function formatInputValue(def, value) {
  if (def.type === 'Boolean') return (value === true || /^true$/i.test(String(value))) ? 'Yes' : 'No';
  if (value === undefined || value === null || value === '') return '—';
  return String(value);
}

export function validateDraft(draft) {
  const errors = [];
  if (!draft.name || !String(draft.name).trim()) {
    errors.push({ field: 'name', message: 'Project name is required' });
  }
  if (!Array.isArray(draft.units) || draft.units.length === 0) {
    errors.push({ field: 'units', message: 'A project needs at least one unit' });
  }
  (draft.units || []).forEach((u, index) => {
    if (!u.name || !String(u.name).trim()) {
      errors.push({ field: 'unit', index, message: 'Unit name is required' });
    }
  });
  return { ok: errors.length === 0, errors };
}

export function newDraftUnit(model, name) {
  const unit = newUnit(name);
  unit.inputs = defaultInputs(model);
  return unit;
}

export function newBlankDraft(model) {
  return { id: newId('p'), name: '', units: [newDraftUnit(model, 'Unit 1')] };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — all `projectDraft` tests green, and the pre-existing suites (`projectStore`, `exporter`, etc.) still pass.

- [ ] **Step 6: Commit**

```bash
git add src/projectStore.js src/projectDraft.js tests/projectDraft.test.js
git commit -m "feat: add projectDraft helpers (defaults, format, validate, draft)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Editor screen markup + Edit button; trim unit bar (`index.html`)

Add the static markup the later app.js tasks target, place the **Edit project** button, and remove the unit add/rename/delete buttons (kept only the unit selector).

**Files:**
- Modify: `index.html` (project header row ~104-109; unit bar ~111-117; add new `<section id="screen-editor">` after the project section ~137)

**Interfaces:**
- Produces (DOM ids consumed by app.js in Tasks 3–5): `#btn-edit-project`, `#screen-editor`, `#editor-cancel`, `#editor-save`, `#editor-project-name`, `#editor-name-error`, `#editor-units`, `#btn-add-editor-unit`.
- Removes: `#btn-add-unit`, `#btn-rename-unit`, `#btn-delete-unit` (and their handlers, removed in Task 3).

- [ ] **Step 1: Add the Edit project button to the project header**

In `index.html`, change the project-screen button row (currently `btn-back` + `btn-save-project` + `btn-download-zip`) so the right-hand `btn-row` reads:

```html
        <div class="btn-row">
          <button id="btn-edit-project">Edit project</button>
          <button id="btn-save-project">Save project file</button>
          <button id="btn-download-zip" class="btn-primary">Download ZIP</button>
        </div>
```

- [ ] **Step 2: Trim the unit bar to just the selector**

Replace the unit bar block so only the selector remains (remove Add/Rename/Delete unit buttons):

```html
      <div id="unit-bar" class="unit-bar">
        <label for="unit-select">Unit</label>
        <select id="unit-select"></select>
      </div>
```

- [ ] **Step 3: Add the editor screen section**

Insert this new section immediately after the closing `</section>` of `#screen-project` (before `#screen-about`):

```html
    <section id="screen-editor" class="screen" hidden>
      <div class="row-between">
        <button id="editor-cancel" class="btn-ghost">&larr; Cancel</button>
        <button id="editor-save" class="btn-primary">Save project</button>
      </div>
      <h2 id="editor-heading">New project</h2>
      <label class="editor-field">
        <span class="setting-title">Project name</span>
        <input type="text" id="editor-project-name" placeholder="e.g. Tower A" />
      </label>
      <p id="editor-name-error" class="status error" hidden>Project name is required</p>

      <div class="row-between editor-units-head">
        <h3>Units</h3>
        <button id="btn-add-editor-unit" class="btn-sm">+ Add unit</button>
      </div>
      <div id="editor-units"></div>
    </section>
```

- [ ] **Step 4: Verify the page still loads**

Run: `python -m http.server 8123` (in repo root), then load `http://127.0.0.1:8123/` in a browser (or the smoke harness). Expected: no console errors; the Setup/Dashboard screens render as before; `#screen-editor` is present but hidden. The unit bar shows only the selector. (Wiring for the new buttons comes in later tasks; clicking Edit project does nothing yet.)

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat: add editor screen markup and Edit project button; trim unit bar

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Read-only inputs summary on the checklist (`src/app.js`)

Replace the editable inputs panel with a read-only summary, remove the now-dead input editing and unit-button handlers, and import the shared helpers.

**Files:**
- Modify: `src/app.js` (imports ~1-9; `defaultInputValue` ~362-367; `renderInputs`/`updateInput` ~369-411; `renderProject` ~580; unit-button handlers ~734-760)

**Interfaces:**
- Consumes: `defaultInputValue`, `defaultInputs`, `formatInputValue` from `./projectDraft.js`.
- Produces: `renderInputsSummary(unit)` replacing `renderInputs(unit)`.

- [ ] **Step 1: Import helpers and drop the local `defaultInputValue`**

Add to the import block at the top of `src/app.js`:

```js
import { defaultInputValue, defaultInputs, formatInputValue } from './projectDraft.js';
```

Delete the local `function defaultInputValue(def) { ... }` (lines ~362-367) — it is now imported.

- [ ] **Step 2: Replace `renderInputs` with `renderInputsSummary` and delete `updateInput`**

Replace the entire `renderInputs(unit)` function and the `updateInput(name, value)` function with this single read-only renderer:

```js
function renderInputsSummary(unit) {
  const panel = document.getElementById('inputs-panel');
  panel.innerHTML = '<h3>Inputs</h3>';
  // Ensure any input added to the workbook since the unit was created has a value.
  for (const def of state.model.inputs) {
    if (!(def.name in unit.inputs)) unit.inputs[def.name] = defaultInputValue(def);
    const row = document.createElement('div');
    row.className = 'input-summary-row';
    const label = document.createElement('span');
    label.className = 'input-summary-label';
    label.textContent = def.label + (def.unit ? ` (${def.unit})` : '');
    const value = document.createElement('span');
    value.className = 'input-summary-value';
    value.textContent = formatInputValue(def, unit.inputs[def.name]);
    row.appendChild(label);
    row.appendChild(value);
    panel.appendChild(row);
  }
  const hint = document.createElement('p');
  hint.className = 'muted input-summary-hint';
  hint.textContent = 'Edit project to change these.';
  panel.appendChild(hint);
}
```

- [ ] **Step 3: Point `renderProject` at the new renderer**

In `renderProject()`, change the `renderInputs(unit);` call to `renderInputsSummary(unit);`. Leave the `saveCurrent(project);` line that follows it (it persists any newly defaulted inputs).

- [ ] **Step 4: Remove the unit add/rename/delete handlers**

In `init()`, delete the three `document.getElementById('btn-add-unit')…`, `'btn-rename-unit'…`, and `'btn-delete-unit'…` `addEventListener` blocks (the elements were removed in Task 2; leaving the handlers would throw on the null element). Keep the `unit-select` change handler. Also remove the `btn-delete-unit` disabling line inside `renderUnitBar()` (`document.getElementById('btn-delete-unit').disabled = …`).

- [ ] **Step 5: Verify the checklist screen**

Run the smoke harness (serve with `python -m http.server 8123`, drive Edge via `smoke.mjs`): load a workbook, open a project. Expected: the inputs panel now shows a read-only list (labels + values, Booleans as Yes/No), the "Edit project to change these." hint appears, there are no editable input controls, and the unit bar shows only the selector. Toggling the unit selector still switches units. No console errors.

Run: `npm test`
Expected: PASS (no regressions; app.js is not imported by tests, so this only guards the other modules).

- [ ] **Step 6: Commit**

```bash
git add src/app.js
git commit -m "feat: read-only inputs summary on checklist; remove inline input editing

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Render the editor draft — name + unit cards with controls (`src/app.js`)

Build the editor screen UI from a draft held in `state.editor`, including per-unit input controls, add/delete unit, and dirty tracking. Navigation wiring is Task 5.

**Files:**
- Modify: `src/app.js` (add `editor` to `screens`/`NAV_FOR_SCREEN` ~20-22; add `state.editor`; add render + control helpers; add `import` of draft factories)

**Interfaces:**
- Consumes: `newBlankDraft`, `newDraftUnit`, `defaultInputs` from `./projectDraft.js`; `escapeHtml`.
- Produces: `state.editor = { draft, isNew, dirty }`; `renderEditor()`; `buildInputControl(def, value, onChange) -> HTMLElement`; `markEditorDirty()`.

- [ ] **Step 1: Extend imports and state**

Add `newBlankDraft, newDraftUnit` to the existing `./projectDraft.js` import:

```js
import { defaultInputValue, defaultInputs, formatInputValue, validateDraft, newBlankDraft, newDraftUnit } from './projectDraft.js';
```

Add `'editor'` to the `screens` array and an entry to `NAV_FOR_SCREEN`:

```js
const screens = ['setup', 'dashboard', 'project', 'about', 'editor'];
const NAV_FOR_SCREEN = { setup: 'nav-setup', dashboard: 'nav-dashboard', project: 'nav-dashboard', about: 'nav-about', editor: 'nav-dashboard' };
```

Add the editor slice to `state` (top of file):

```js
  editor: null, // { draft, isNew, dirty }
```

- [ ] **Step 2: Add the shared input-control builder**

Add this helper (it is the editable counterpart to `formatInputValue`; the checklist summary stays read-only):

```js
// Build an editable control for one input definition. `onChange(value)` is
// called with the typed value (boolean / number / string) on every change.
function buildInputControl(def, value, onChange) {
  if (def.type === 'Boolean') {
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = value === true;
    input.addEventListener('change', () => onChange(input.checked));
    return input;
  }
  if (def.type === 'Choice') {
    const select = document.createElement('select');
    for (const c of def.choices) {
      const opt = document.createElement('option');
      opt.value = c; opt.textContent = c;
      if (c === value) opt.selected = true;
      select.appendChild(opt);
    }
    select.addEventListener('change', () => onChange(select.value));
    return select;
  }
  const input = document.createElement('input');
  input.type = 'number';
  if (def.type === 'Integer') input.step = '1';
  input.value = value;
  input.addEventListener('input', () => onChange(input.value === '' ? '' : Number(input.value)));
  return input;
}
```

- [ ] **Step 3: Add `renderEditor` and dirty tracking**

```js
function markEditorDirty() { if (state.editor) state.editor.dirty = true; }

function renderEditor() {
  const { draft, isNew } = state.editor;
  document.getElementById('editor-heading').textContent = isNew ? 'New project' : 'Edit project';
  document.getElementById('editor-name-error').hidden = true;

  const nameInput = document.getElementById('editor-project-name');
  nameInput.value = draft.name;
  nameInput.oninput = () => { draft.name = nameInput.value; markEditorDirty(); };

  const container = document.getElementById('editor-units');
  container.innerHTML = '';
  draft.units.forEach((unit, index) => {
    const card = document.createElement('div');
    card.className = 'unit-edit-card';

    const head = document.createElement('div');
    head.className = 'row-between';
    const nameField = document.createElement('input');
    nameField.type = 'text';
    nameField.className = 'unit-edit-name';
    nameField.value = unit.name;
    nameField.placeholder = 'Unit name';
    nameField.oninput = () => { unit.name = nameField.value; markEditorDirty(); };
    head.appendChild(nameField);

    const del = document.createElement('button');
    del.className = 'btn-sm btn-danger';
    del.textContent = 'Delete';
    del.disabled = draft.units.length <= 1;
    del.addEventListener('click', () => {
      draft.units.splice(index, 1);
      markEditorDirty();
      renderEditor();
    });
    head.appendChild(del);
    card.appendChild(head);

    for (const def of state.model.inputs) {
      if (!(def.name in unit.inputs)) unit.inputs[def.name] = defaultInputValue(def);
      const label = document.createElement('label');
      label.className = 'editor-input-label';
      label.textContent = def.label + (def.unit ? ` (${def.unit})` : '');
      const control = buildInputControl(def, unit.inputs[def.name], (v) => {
        unit.inputs[def.name] = v;
        markEditorDirty();
      });
      label.appendChild(control);
      card.appendChild(label);
    }
    container.appendChild(card);
  });
}
```

- [ ] **Step 4: Verify rendering with a temporary hook**

There is no automated DOM test. Verify with the smoke harness: temporarily expose the editor by running, in the page console (via `Runtime.evaluate`), `state.editor = { draft: <a sample>, isNew: true }; showScreen('editor'); renderEditor();` — or simply wait for Task 5 which wires the buttons and verify there. Confirm `renderEditor` is syntactically valid by loading the page (no console errors on load).

Run: `npm test`
Expected: PASS (no regressions).

- [ ] **Step 5: Commit**

```bash
git add src/app.js
git commit -m "feat: render project editor draft (name, unit cards, input controls)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Wire navigation — New, Edit, Add unit, Save, Cancel (`src/app.js`)

Connect the buttons so the editor opens, edits, and commits/discards, with validation and the confirm-on-cancel-when-dirty guard.

**Files:**
- Modify: `src/app.js` (the `btn-new-project` handler ~762; add handlers in `init()`; add `openEditor`/`saveEditor`/`cancelEditor`)

**Interfaces:**
- Consumes: `state.editor`, `renderEditor`, `validateDraft`, `newBlankDraft`, `newDraftUnit`, `state.store.getProject/saveProject`, `openProject`, `showScreen`, `renderDashboard`.
- Produces: `openEditor(projectId|null)`, `saveEditor()`, `cancelEditor()`.

- [ ] **Step 1: Add open/save/cancel functions**

```js
function openEditor(projectId) {
  if (!state.model) { alert('Load a checklist workbook in Setup first.'); return; }
  if (projectId) {
    state.editor = { draft: state.store.getProject(projectId), isNew: false, dirty: false };
  } else {
    state.editor = { draft: newBlankDraft(state.model), isNew: true, dirty: false };
  }
  showScreen('editor');
  renderEditor();
  if (state.editor.isNew) document.getElementById('editor-project-name').focus();
}

function saveEditor() {
  const { draft, isNew } = state.editor;
  const result = validateDraft(draft);
  if (!result.ok) {
    const nameErr = result.errors.find(e => e.field === 'name');
    document.getElementById('editor-name-error').hidden = !nameErr;
    const unitErr = result.errors.find(e => e.field === 'unit' || e.field === 'units');
    if (unitErr) alert(unitErr.message);
    return;
  }
  state.store.saveProject(draft);
  const id = draft.id;
  state.editor = null;
  if (isNew) {
    openProject(id);
  } else {
    // If the open unit was deleted, openProject's first-unit fallback applies.
    openProject(id);
  }
}

function cancelEditor() {
  const wasNew = state.editor.isNew;
  if (state.editor.dirty && !confirm('Discard changes to this project?')) return;
  const id = state.editor.draft.id;
  state.editor = null;
  if (wasNew) showScreen('dashboard');
  else openProject(id);
}
```

Note: `openProject(id)` already resets `currentUnitId` to `units[0]`, which covers the "open unit was deleted" edge case for both New and Edit.

- [ ] **Step 2: Replace the New project handler and add the rest**

Replace the existing `btn-new-project` click handler body with a call to `openEditor(null)`:

```js
  document.getElementById('btn-new-project').addEventListener('click', () => openEditor(null));
```

Add these handlers in `init()` (near the other project-screen button wiring):

```js
  document.getElementById('btn-edit-project').addEventListener('click', () => openEditor(state.currentProjectId));
  document.getElementById('editor-save').addEventListener('click', saveEditor);
  document.getElementById('editor-cancel').addEventListener('click', cancelEditor);
  document.getElementById('btn-add-editor-unit').addEventListener('click', () => {
    const draft = state.editor.draft;
    draft.units.push(newDraftUnit(state.model, 'Unit ' + (draft.units.length + 1)));
    markEditorDirty();
    renderEditor();
  });
```

- [ ] **Step 3: Verify end-to-end with the smoke harness**

Serve (`python -m http.server 8123`) and drive Edge via `smoke.mjs`. The harness must answer `confirm()` dialogs via `Page.handleJavaScriptDialog`. Verify each flow:
  1. **New:** Dashboard → New project → editor opens blank, name focused. Type a name, add a second unit, set some inputs, **Save project** → lands on the new project's checklist; the read-only summary reflects the inputs set.
  2. **New + empty name:** Save with blank name → `#editor-name-error` shows, nothing persists, stays on editor.
  3. **Edit:** open a project → **Edit project** → editor pre-filled. Change an input, **Save** → back on checklist, summary updated.
  4. **Cancel dirty:** Edit, change something, **Cancel** → confirm dialog; accept → back to checklist with no change; (repeat, dismiss → stays in editor).
  5. **Cancel clean:** open editor, change nothing, **Cancel** → leaves immediately, no dialog.
  6. **Delete unit:** in editor with 2 units, Delete one → card removed; with 1 unit the Delete button is disabled.

Run: `npm test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/app.js
git commit -m "feat: wire editor navigation, save with validation, cancel guard, add unit

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Style the editor and read-only summary (`styles.css`)

Make the editor screen and the read-only summary match the existing theme (uses the existing CSS variables / tokens).

**Files:**
- Modify: `styles.css` (append new rules; reuse `--surface`, `--border`, `--radius`, `--text-muted`, etc.)

**Interfaces:**
- Consumes: existing CSS custom properties in `:root` (`--surface`, `--border`, `--radius`, `--radius-sm`, `--text-muted`, `--accent`).
- Produces: styles for `.unit-edit-card`, `.unit-edit-name`, `.editor-input-label`, `.editor-field`, `.editor-units-head`, `.input-summary-row`, `.input-summary-label`, `.input-summary-value`, `.input-summary-hint`.

- [ ] **Step 1: Append editor + summary styles**

Add to `styles.css`:

```css
/* ---- Project editor screen ------------------------------------------- */
.editor-field { display: block; margin: 16px 0; }
.editor-field input,
#editor-project-name {
  display: block;
  width: 100%;
  max-width: 420px;
  margin-top: 6px;
  padding: 8px 10px;
  font: inherit;
  color: var(--text);
  background: var(--surface);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
}
.editor-units-head { margin-top: 8px; }

.unit-edit-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  padding: 14px 16px;
  margin-bottom: 14px;
}
.unit-edit-name {
  font: inherit;
  font-weight: 600;
  padding: 6px 8px;
  color: var(--text);
  background: var(--surface);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  min-width: 200px;
}
.editor-input-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 0;
  border-top: 1px solid var(--border);
  color: var(--text-muted);
}
.editor-input-label input[type="number"],
.editor-input-label select {
  flex: none;
  min-width: 160px;
}

/* ---- Read-only inputs summary on the checklist ----------------------- */
.input-summary-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  padding: 5px 0;
  border-top: 1px solid var(--border);
}
.input-summary-label { color: var(--text-muted); }
.input-summary-value { font-weight: 600; color: var(--text); }
.input-summary-hint { margin-top: 10px; font-size: 13px; }
```

- [ ] **Step 2: Verify visually (light + dark)**

Load the app (served), open the editor and a project checklist. Expected: unit cards look like the dashboard project cards (surface + border + radius + shadow); inputs align label-left / control-right; the read-only summary rows are tidy with the hint muted. Toggle dark mode (Setup → Appearance) and confirm both screens read correctly with no hard-coded light colors leaking through.

- [ ] **Step 3: Commit**

```bash
git add styles.css
git commit -m "style: editor screen and read-only inputs summary

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- New screen + navigation table → Tasks 2 (markup), 5 (wiring). ✓
- Editor layout (name, unit cards, +Add unit, controls) → Tasks 2, 4. ✓
- Draft model + Save/Cancel + dirty confirm → Tasks 4 (dirty), 5 (save/cancel). ✓
- Edit project button placement/order → Task 2. ✓
- Read-only summary (Yes/No, "—", hint, labels) → Tasks 1 (`formatInputValue`), 3 (render). ✓
- Remove inline editing + Add/Rename/Delete unit; keep selector → Tasks 2, 3. ✓
- Validation → Task 1 (`validateDraft`), Task 5 (enforced on Save). ✓
- Edge cases: hidden checked items preserved (no code needed — checks keyed by id, untouched); deleted open unit fallback → Task 5 note via `openProject`. ✓
- Testing list (buildInputControl/defaults, round-trip, summary format, cancel safety) → Task 1 covers the DOM-free items; `buildInputControl` is DOM and is verified manually (Task 4/5) since the repo has no DOM test runner. This is a deliberate deviation from the spec's testing list, consistent with the repo's "pure modules only" test convention. ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code. ✓

**Type consistency:** `state.editor = { draft, isNew, dirty }` used consistently across Tasks 4–5. `validateDraft` returns `{ ok, errors }` with `errors[].field ∈ {name, units, unit}` — matched by `saveEditor`. `newBlankDraft`/`newDraftUnit`/`defaultInputs`/`formatInputValue`/`defaultInputValue` signatures match between Task 1 definitions and Tasks 3–5 call sites. `buildInputControl(def, value, onChange)` defined and used in Task 4. ✓

**Note for executor:** `app.js` is not imported by any `node --test` file, so `npm test` will not catch errors inside `app.js`; the smoke-harness verification steps in Tasks 3–6 are the real gate for those tasks.
