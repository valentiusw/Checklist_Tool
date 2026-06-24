# Sections, Multi-unit Projects, About Page, Red Theme — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add section grouping/filtering, multi-unit parent projects, an About/Info page, and a red theme (green retained for completion) to the existing Smart Checklist tool.

**Architecture:** Pure logic stays in dependency-free ES modules under `src/` (condition engine, workbook model, project store, exporter), unit-tested with Node's built-in runner. Browser glue lives in `src/app.js` and is verified manually against a local static server. Two new optional workbook sheets (`Sections`, `Glossary`) feed the section names and About page. A project becomes a parent holding a list of units, each with its own inputs/checks/comments.

**Tech Stack:** Static HTML, vanilla ES modules, vendored SheetJS (browser, in `vendor/`), Node `--test` for unit tests, Python 3 + openpyxl (dev-only) for authoring the sample workbook.

## Global Constraints

- Tool runs fully offline at runtime; no runtime network/CDN dependencies. (Dev tooling like `openpyxl` may use the network/pip.)
- `src/*.js` are dependency-free ES modules; logic there must be unit-tested with `node --test` (run via `npm test`).
- Required workbook sheets remain `Checklist` and `Inputs` with strict validation. `Sections` and `Glossary` are **optional** — absence must never throw.
- Export column order is exactly: `Item ID`, `Description`, `Code`, `Comments`, `Example`.
- Red is the UI accent (`--accent`); green (`--success`) is reserved for completion signals: checked-item highlight, checklist item checkboxes, and the progress bar.
- Section prefix = leading alphabetic characters of the Item ID, upper-cased (`A08`→`A`, `EL01`→`EL`). No leading letters → prefix `""` → section name `"Other"`.
- Commit after every task.

---

## File Structure

- `src/workbookModel.js` (modify) — parse `Sections`/`Glossary`, compute `item.section`/`item.sectionPrefix`, return `sections` + `glossary`.
- `src/projectStore.js` (modify) — units data model, lazy migration, dual-shape import, units-shaped serialize.
- `src/exporter.js` (modify) — `buildExportRows(model, unit)`, add `computeProjectProgress(model, project)`.
- `src/app.js` (modify) — optional-sheet loading, model persist/restore round-trip, unit selector UI, section filter, About page, multi-sheet export.
- `index.html` (modify) — About nav + screen, unit bar, section filter control, About tables.
- `styles.css` (modify) — red accent + success green tokens and new element styles.
- `SampleChecklist.xlsx` (regenerate) — add `Sections`, `Glossary`, and B/C items.
- `tools/build-sample-workbook.py` (create) — deterministic authoring script for the sample workbook.
- `tests/workbookModel.test.js`, `tests/projectStore.test.js`, `tests/exporter.test.js` (modify) — new/updated unit tests.
- `README.md` (modify) — document the new sheets, units, About page, theme.

---

### Task 1: Section parsing in the workbook model

**Files:**
- Modify: `src/workbookModel.js`
- Test: `tests/workbookModel.test.js`

**Interfaces:**
- Consumes: existing `buildModel({ checklistRows, inputRows })`, `headerIndex`, `cell`.
- Produces: `buildModel({ checklistRows, inputRows, sectionRows })` → model now also has `sections: Array<{prefix, name}>` (unique, first-appearance order) and each `item` has `section: string` and `sectionPrefix: string`. New exported-internal helpers `sectionPrefix(id)` (not exported) and section-map building.

- [ ] **Step 1: Write failing tests for section extraction + fallback**

Add to `tests/workbookModel.test.js`:

```js
test('items get sectionPrefix and section name from Sections sheet', () => {
  const sectionRows = [
    ['Prefix', 'Name'],
    ['A', 'Architectural'],
    ['B', 'Structural'],
  ];
  const checklist = [
    ['Item ID', 'Conditions', 'Description', 'Code', 'Note', 'Example'],
    ['A08', '', 'arch item', '', '', ''],
    ['B01', '', 'struct item', '', '', ''],
  ];
  const model = buildModel({ checklistRows: checklist, inputRows, sectionRows });
  assert.equal(model.items[0].sectionPrefix, 'A');
  assert.equal(model.items[0].section, 'Architectural');
  assert.equal(model.items[1].section, 'Structural');
});

test('section name falls back to prefix when Sections missing or unlisted', () => {
  const checklist = [
    ['Item ID', 'Conditions', 'Description', 'Code', 'Note', 'Example'],
    ['C02', '', 'no section sheet', '', '', ''],
    ['99x', '', 'no leading letters', '', '', ''],
  ];
  const model = buildModel({ checklistRows: checklist, inputRows });
  assert.equal(model.items[0].sectionPrefix, 'C');
  assert.equal(model.items[0].section, 'C');
  assert.equal(model.items[1].sectionPrefix, '');
  assert.equal(model.items[1].section, 'Other');
});

test('model.sections lists present sections in first-appearance order', () => {
  const sectionRows = [['Prefix', 'Name'], ['A', 'Architectural'], ['B', 'Structural']];
  const checklist = [
    ['Item ID', 'Conditions', 'Description', 'Code', 'Note', 'Example'],
    ['B01', '', 'b', '', '', ''],
    ['A01', '', 'a', '', '', ''],
    ['B02', '', 'b2', '', '', ''],
  ];
  const model = buildModel({ checklistRows: checklist, inputRows, sectionRows });
  assert.deepEqual(model.sections, [
    { prefix: 'B', name: 'Structural' },
    { prefix: 'A', name: 'Architectural' },
  ]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: the three new tests FAIL (e.g. `model.items[0].sectionPrefix` is `undefined`; `model.sections` is `undefined`).

- [ ] **Step 3: Implement section parsing**

In `src/workbookModel.js`, add column constant near the others:

```js
const SECTION_COLS = ['Prefix', 'Name'];
```

Add helpers above `buildItems`:

```js
function sectionPrefix(id) {
  const m = String(id).match(/^[A-Za-z]+/);
  return m ? m[0].toUpperCase() : '';
}

function buildSectionMap(sectionRows) {
  if (!sectionRows || sectionRows.length === 0) return {};
  const idx = headerIndex(sectionRows, SECTION_COLS, 'Sections');
  const map = {};
  for (let r = 1; r < sectionRows.length; r++) {
    const prefix = cell(sectionRows[r], idx['Prefix']).toUpperCase();
    if (!prefix) continue;
    map[prefix] = cell(sectionRows[r], idx['Name']) || prefix;
  }
  return map;
}

function resolveSectionName(prefix, sectionMap) {
  if (prefix === '') return 'Other';
  return sectionMap[prefix] || prefix;
}
```

Change `buildItems` to accept `sectionMap` and set the section fields. Update its signature and the pushed object:

```js
function buildItems(checklistRows, inputDefs, sectionMap) {
```

and inside the loop, after computing `id`, add:

```js
    const prefix = sectionPrefix(id);
```

and add to the pushed item object (alongside `id`, `conditionsText`, ...):

```js
      sectionPrefix: prefix,
      section: resolveSectionName(prefix, sectionMap),
```

Replace `buildModel` with:

```js
export function buildModel({ checklistRows, inputRows, sectionRows }) {
  const inputs = buildInputs(inputRows);
  const inputDefs = {};
  for (const inp of inputs) inputDefs[inp.name] = inp;
  const sectionMap = buildSectionMap(sectionRows);
  const items = buildItems(checklistRows, inputDefs, sectionMap);
  const sections = [];
  const seen = new Set();
  for (const item of items) {
    if (seen.has(item.sectionPrefix)) continue;
    seen.add(item.sectionPrefix);
    sections.push({ prefix: item.sectionPrefix, name: item.section });
  }
  return { items, inputs, inputDefs, sections };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: all tests PASS (existing + 3 new).

- [ ] **Step 5: Commit**

```bash
git add src/workbookModel.js tests/workbookModel.test.js
git commit -m "feat: parse item sections from Item ID prefix and Sections sheet"
```

---

### Task 2: Glossary parsing in the workbook model

**Files:**
- Modify: `src/workbookModel.js`
- Test: `tests/workbookModel.test.js`

**Interfaces:**
- Consumes: `buildModel` from Task 1, `headerIndex`, `cell`.
- Produces: `buildModel({ ..., glossaryRows })` → model also has `glossary: Array<{term, meaning}>` (empty array when sheet absent).

- [ ] **Step 1: Write failing tests for glossary parsing**

Add to `tests/workbookModel.test.js`:

```js
test('glossary parsed from Glossary sheet', () => {
  const glossaryRows = [
    ['Term', 'Meaning'],
    ['EN81-20', 'Lift safety standard'],
    ['BCA', 'Building Code of Australia'],
  ];
  const model = buildModel({ checklistRows, inputRows, glossaryRows });
  assert.deepEqual(model.glossary, [
    { term: 'EN81-20', meaning: 'Lift safety standard' },
    { term: 'BCA', meaning: 'Building Code of Australia' },
  ]);
});

test('glossary is empty array when sheet absent', () => {
  const model = buildModel({ checklistRows, inputRows });
  assert.deepEqual(model.glossary, []);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: new tests FAIL (`model.glossary` is `undefined`).

- [ ] **Step 3: Implement glossary parsing**

In `src/workbookModel.js`, add constant:

```js
const GLOSSARY_COLS = ['Term', 'Meaning'];
```

Add helper near `buildSectionMap`:

```js
function buildGlossary(glossaryRows) {
  if (!glossaryRows || glossaryRows.length === 0) return [];
  const idx = headerIndex(glossaryRows, GLOSSARY_COLS, 'Glossary');
  const out = [];
  for (let r = 1; r < glossaryRows.length; r++) {
    const term = cell(glossaryRows[r], idx['Term']);
    if (!term) continue;
    out.push({ term, meaning: cell(glossaryRows[r], idx['Meaning']) });
  }
  return out;
}
```

Update `buildModel` signature and return value to include glossary:

```js
export function buildModel({ checklistRows, inputRows, sectionRows, glossaryRows }) {
```

and before the `return`:

```js
  const glossary = buildGlossary(glossaryRows);
```

and add `glossary` to the returned object:

```js
  return { items, inputs, inputDefs, sections, glossary };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/workbookModel.js tests/workbookModel.test.js
git commit -m "feat: parse optional Glossary sheet in workbook model"
```

---

### Task 3: Regenerate the sample workbook

**Files:**
- Create: `tools/build-sample-workbook.py`
- Modify (regenerate): `SampleChecklist.xlsx`

**Interfaces:**
- Consumes: nothing in-code. Produces a workbook with sheets `Checklist`, `Inputs`, `Sections`, `Glossary` consumed by `app.js` at runtime and by manual verification in later tasks.

- [ ] **Step 1: Write the workbook authoring script**

Create `tools/build-sample-workbook.py`:

```python
"""Regenerate SampleChecklist.xlsx with Checklist, Inputs, Sections, Glossary.

Dev-only tool. Requires openpyxl (pip install openpyxl). The runtime tool does
not depend on this; it only reads the produced .xlsx in the browser.
"""
import os
from openpyxl import Workbook

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "SampleChecklist.xlsx")

checklist = [
    ["Item ID", "Conditions", "Description", "Code", "Note", "Example"],
    ["A08", "", "Lifts are not exposed to weather", "AS3000",
     "Lift opening to an outdoor area must protect electrical components from moisture ingress.",
     "Fit IP-rated enclosures and weather seals to the landing door head."],
    ["A09", "", "Lifts do not open directly into a dwelling", "SL", "",
     "Provide a protected lobby between the lift and the dwelling entrance."],
    ["A10", "PitToEarth: FALSE", "If pit is not to solid earth, need CWT safety device", "EN81-20",
     "Counterweight safety gear required when pit is not founded on solid earth.",
     "Install counterweight safety gear and certify per EN81-20."],
    ["A11", "MaxFFLInt: >11m", "Must have lift-well emergency doors", "EN81-20, RDM",
     "Required where the travel between landings exceeds 11 m.",
     "Add emergency doors at max 11 m spacing along the well."],
    ["A13", 'BuildingClass: "Class 9b" OR MaxFFLInt: >=20', "Enhanced fire service controls", "BCA",
     "High-rise or assembly buildings need fire service lift controls.",
     "Provide fire service control switch and compliant signage."],
    ["B01", "", "Pit structure designed for buffer impact loads", "AS1170", "",
     "Confirm structural design accounts for buffer reaction forces."],
    ["B02", "FloorsServed: >=10", "Guide rail bracket spacing verified for travel", "EN81-20",
     "Taller installations need verified bracket spacing.",
     "Document guide-rail bracket spacing calculations."],
    ["C01", "", "Machine room power isolation provided", "AS3000", "",
     "Install a lockable main switch for the lift supply."],
    ["C02", "PitToEarth: FALSE", "Earthing of car and well per wiring rules", "AS3000",
     "Earthing continuity required where pit is not to solid earth.",
     "Measure and record earth continuity resistance."],
]

inputs = [
    ["Name", "Type", "Label", "Unit", "Choices", "Default"],
    ["PitToEarth", "Boolean", "Pit is founded on solid earth", "", "", "TRUE"],
    ["MaxFFLInt", "Float", "Max internal floor-to-floor travel", "m", "", "0"],
    ["FloorsServed", "Integer", "Number of floors served", "", "", "2"],
    ["BuildingClass", "Choice", "Building classification", "", "Class 2;Class 3;Class 9b", "Class 2"],
]

sections = [
    ["Prefix", "Name"],
    ["A", "Architectural"],
    ["B", "Structural"],
    ["C", "Electrical"],
]

glossary = [
    ["Term", "Meaning"],
    ["AS3000", "AS/NZS 3000 Wiring Rules — electrical installations standard. (sample text)"],
    ["AS1170", "AS/NZS 1170 Structural design actions. (sample text)"],
    ["EN81-20", "EN 81-20 — safety rules for the construction and installation of lifts. (sample text)"],
    ["BCA", "Building Code of Australia. (sample text)"],
    ["DDA", "Disability Discrimination Act — accessibility requirements. (sample text)"],
    ["SL", "State/local regulatory requirement. (sample text)"],
    ["RDM", "Reference Design Manual. (sample text)"],
]

wb = Workbook()
wb.remove(wb.active)
for name, rows in [("Checklist", checklist), ("Inputs", inputs),
                   ("Sections", sections), ("Glossary", glossary)]:
    ws = wb.create_sheet(name)
    for row in rows:
        ws.append(row)
wb.save(OUT)
print("wrote", OUT)
```

- [ ] **Step 2: Run the script to regenerate the workbook**

Run: `python tools/build-sample-workbook.py`
Expected: prints `wrote .../SampleChecklist.xlsx` with no error.

- [ ] **Step 3: Verify the workbook parses with the model**

Run:

```bash
python -c "
from openpyxl import load_workbook
wb = load_workbook('SampleChecklist.xlsx')
print('sheets', wb.sheetnames)
assert wb.sheetnames == ['Checklist','Inputs','Sections','Glossary'], wb.sheetnames
print('checklist rows', wb['Checklist'].max_row)
print('OK')
"
```

Expected: `sheets ['Checklist', 'Inputs', 'Sections', 'Glossary']`, then `OK`.

- [ ] **Step 4: Commit**

```bash
git add tools/build-sample-workbook.py SampleChecklist.xlsx
git commit -m "feat: regenerate sample workbook with Sections, Glossary, B/C items"
```

---

### Task 4: Units data model in the project store

**Files:**
- Modify: `src/projectStore.js`
- Test: `tests/projectStore.test.js`

**Interfaces:**
- Consumes: `storage` (localStorage-like). 
- Produces: project shape `{ id, name, updatedAt, units: [{ id, name, inputs, checks, comments }] }`. `createProject(name)` makes one default unit `"Unit 1"`. `getProject(id)` migrates legacy flat projects on read. `serializeProject` writes units; `importProject` accepts both legacy-flat and units JSON. New exported behavior only via existing function names.

- [ ] **Step 1: Update/add failing tests for the units model + migration**

Replace the body of `tests/projectStore.test.js` (keep the imports and `memStorage` helper) tests with:

```js
test('create, list, get a project with one default unit', () => {
  const store = createProjectStore(memStorage());
  const p = store.createProject('Tower A');
  assert.ok(p.id);
  assert.equal(p.name, 'Tower A');
  assert.equal(p.units.length, 1);
  assert.equal(p.units[0].name, 'Unit 1');
  assert.deepEqual(store.listProjects().map(s => s.name), ['Tower A']);
  assert.equal(store.getProject(p.id).units.length, 1);
});

test('save persists unit inputs/checks/comments', () => {
  const store = createProjectStore(memStorage());
  const p = store.createProject('Tower A');
  p.units[0].inputs = { MaxFFLInt: 12 };
  p.units[0].checks = { A10: true };
  p.units[0].comments = { A10: 'done on site' };
  store.saveProject(p);
  const reloaded = store.getProject(p.id);
  assert.deepEqual(reloaded.units[0].inputs, { MaxFFLInt: 12 });
  assert.equal(reloaded.units[0].checks.A10, true);
  assert.equal(reloaded.units[0].comments.A10, 'done on site');
});

test('delete removes the project', () => {
  const store = createProjectStore(memStorage());
  const p = store.createProject('Tower A');
  store.deleteProject(p.id);
  assert.equal(store.getProject(p.id), null);
  assert.equal(store.listProjects().length, 0);
});

test('getProject migrates a legacy flat project into one unit', () => {
  const storage = memStorage();
  const store = createProjectStore(storage);
  // Hand-write a legacy project + index entry.
  const legacy = { id: 'p_legacy', name: 'Old', updatedAt: '2026-01-01T00:00:00.000Z',
    inputs: { MaxFFLInt: 5 }, checks: { A08: true }, comments: { A08: 'x' } };
  storage.setItem('dpchecklist.project.p_legacy', JSON.stringify(legacy));
  storage.setItem('dpchecklist.projects.index', JSON.stringify([
    { id: 'p_legacy', name: 'Old', updatedAt: legacy.updatedAt }]));
  const got = store.getProject('p_legacy');
  assert.equal(got.units.length, 1);
  assert.equal(got.units[0].name, 'Unit 1');
  assert.deepEqual(got.units[0].inputs, { MaxFFLInt: 5 });
  assert.equal(got.units[0].checks.A08, true);
});

test('serialize then import yields an equal project with new ids', () => {
  const store = createProjectStore(memStorage());
  const p = store.createProject('Tower A');
  p.units[0].checks = { A10: true };
  store.saveProject(p);
  const json = store.serializeProject(p);
  const imported = store.importProject(json);
  assert.notEqual(imported.id, p.id);
  assert.equal(imported.name, 'Tower A');
  assert.equal(imported.units.length, 1);
  assert.deepEqual(imported.units[0].checks, { A10: true });
  assert.equal(store.listProjects().length, 2);
});

test('importProject accepts legacy flat JSON', () => {
  const store = createProjectStore(memStorage());
  const imported = store.importProject(JSON.stringify({
    name: 'Legacy', inputs: { A: 1 }, checks: { A08: true }, comments: {} }));
  assert.equal(imported.units.length, 1);
  assert.deepEqual(imported.units[0].inputs, { A: 1 });
  assert.equal(imported.units[0].checks.A08, true);
});

test('importProject rejects malformed JSON', () => {
  const store = createProjectStore(memStorage());
  assert.throws(() => store.importProject('{not json'));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: the new unit-model tests FAIL (projects have `inputs`/`checks` at top level, no `units`).

- [ ] **Step 3: Implement the units model + migration**

Replace `src/projectStore.js` with:

```js
const INDEX_KEY = 'dpchecklist.projects.index';
const PROJECT_PREFIX = 'dpchecklist.project.';

function newId(prefix = 'p') {
  return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

function newUnit(name) {
  return { id: newId('u'), name: name || 'Unit 1', inputs: {}, checks: {}, comments: {} };
}

function migrateProject(p) {
  if (!p) return p;
  if (Array.isArray(p.units)) return p;
  // Legacy flat project -> wrap into a single unit.
  return {
    id: p.id,
    name: p.name,
    updatedAt: p.updatedAt,
    units: [{
      id: newId('u'),
      name: 'Unit 1',
      inputs: p.inputs || {},
      checks: p.checks || {},
      comments: p.comments || {},
    }],
  };
}

function normalizeUnit(u) {
  return {
    id: u && u.id ? u.id : newId('u'),
    name: (u && u.name) || 'Unit 1',
    inputs: (u && u.inputs) || {},
    checks: (u && u.checks) || {},
    comments: (u && u.comments) || {},
  };
}

export function createProjectStore(storage) {
  function readIndex() {
    const raw = storage.getItem(INDEX_KEY);
    if (!raw) return [];
    try { return JSON.parse(raw); } catch { return []; }
  }
  function writeIndex(index) {
    storage.setItem(INDEX_KEY, JSON.stringify(index));
  }
  function upsertIndex(project) {
    const index = readIndex().filter(s => s.id !== project.id);
    index.push({ id: project.id, name: project.name, updatedAt: project.updatedAt });
    writeIndex(index);
  }

  function listProjects() {
    return readIndex().slice().sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  }

  function getProject(id) {
    const raw = storage.getItem(PROJECT_PREFIX + id);
    if (!raw) return null;
    try { return migrateProject(JSON.parse(raw)); } catch { return null; }
  }

  function saveProject(project) {
    project.updatedAt = new Date().toISOString();
    storage.setItem(PROJECT_PREFIX + project.id, JSON.stringify(project));
    upsertIndex(project);
  }

  function createProject(name) {
    const project = {
      id: newId('p'),
      name: name || 'Untitled project',
      units: [newUnit('Unit 1')],
      updatedAt: new Date().toISOString(),
    };
    saveProject(project);
    return project;
  }

  function deleteProject(id) {
    storage.removeItem(PROJECT_PREFIX + id);
    writeIndex(readIndex().filter(s => s.id !== id));
  }

  function serializeProject(project) {
    return JSON.stringify({
      name: project.name,
      units: (project.units || []).map(u => ({
        name: u.name, inputs: u.inputs || {}, checks: u.checks || {}, comments: u.comments || {},
      })),
    }, null, 2);
  }

  function importProject(jsonString) {
    const data = JSON.parse(jsonString);
    let units;
    if (Array.isArray(data.units)) {
      units = data.units.map(normalizeUnit);
    } else {
      // Legacy flat shape.
      units = [{
        id: newId('u'), name: 'Unit 1',
        inputs: data.inputs || {}, checks: data.checks || {}, comments: data.comments || {},
      }];
    }
    if (units.length === 0) units = [newUnit('Unit 1')];
    const project = {
      id: newId('p'),
      name: data.name || 'Imported project',
      units,
      updatedAt: new Date().toISOString(),
    };
    saveProject(project);
    return project;
  }

  return {
    listProjects, getProject, createProject, saveProject,
    deleteProject, serializeProject, importProject, newUnit,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/projectStore.js tests/projectStore.test.js
git commit -m "feat: parent projects hold multiple units with lazy migration"
```

---

### Task 5: Per-unit export rows and project-level progress

**Files:**
- Modify: `src/exporter.js`
- Test: `tests/exporter.test.js`

**Interfaces:**
- Consumes: `applicableItems(model, values)`, `isApplicable`.
- Produces: `computeProgress(model, unit)` (unit has `inputs`/`checks`), `computeProjectProgress(model, project)` summing across `project.units`, and `buildExportRows(model, unit)` returning rows `[Item ID, Description, Code, Comments, Example]` for the unit's applicable unchecked items.

- [ ] **Step 1: Add a failing test for project-level progress**

In `tests/exporter.test.js`, add (the existing `buildExportRows` and `computeProgress` tests already pass unit-shaped objects, so they stay):

```js
test('computeProjectProgress sums across units', () => {
  const project = {
    units: [
      { inputs: { PitToEarth: false, MaxFFLInt: 5 }, checks: { A08: true }, comments: {} },
      { inputs: { PitToEarth: false, MaxFFLInt: 5 }, checks: {}, comments: {} },
    ],
  };
  const p = computeProjectProgress(model, project);
  // Each unit: A08 + A10 applicable (2 each) -> applicable 4; checked 1 (unit 1 A08).
  assert.equal(p.applicable, 4);
  assert.equal(p.checked, 1);
  assert.equal(p.ratio, 0.25);
});
```

Update the import line at the top of the file to include the new function:

```js
import { applicableItems, computeProgress, computeProjectProgress, buildExportRows } from '../src/exporter.js';
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `computeProjectProgress` is not exported (import is `undefined`, call throws).

- [ ] **Step 3: Implement project progress and rename the export param**

In `src/exporter.js`, add after `computeProgress`:

```js
export function computeProjectProgress(model, project) {
  let checked = 0;
  let applicable = 0;
  for (const unit of project.units || []) {
    const p = computeProgress(model, unit);
    checked += p.checked;
    applicable += p.applicable;
  }
  const ratio = applicable === 0 ? 0 : checked / applicable;
  return { checked, applicable, ratio };
}
```

Change `buildExportRows(model, project)` to `buildExportRows(model, unit)` and use `unit` throughout its body:

```js
export function buildExportRows(model, unit) {
  const header = ['Item ID', 'Description', 'Code', 'Comments', 'Example'];
  const checks = unit.checks || {};
  const comments = unit.comments || {};
  const rows = [header];
  for (const item of applicableItems(model, unit.inputs || {})) {
    if (checks[item.id] === true) continue;
    rows.push([item.id, item.description, item.code, comments[item.id] || '', item.example]);
  }
  return rows;
}
```

(`computeProgress(model, unit)` body is unchanged; only its parameter name semantics shift to "unit".)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/exporter.js tests/exporter.test.js
git commit -m "feat: per-unit export rows and project-level progress"
```

---

### Task 6: Load optional sheets and round-trip model in app.js

**Files:**
- Modify: `src/app.js`

**Interfaces:**
- Consumes: `buildModel({ checklistRows, inputRows, sectionRows, glossaryRows })`, `XLSX`.
- Produces: `state.model` now carries `sections` and `glossary`; persisted model restores them without re-importing the xlsx.

- [ ] **Step 1: Load optional Sections/Glossary sheets**

In `src/app.js`, add an optional-sheet helper after `sheetToRows`:

```js
function optionalSheetToRows(workbook, name) {
  const ws = workbook.Sheets[name];
  if (!ws) return undefined;
  return XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: '' });
}
```

Replace `loadModelFromWorkbook` with:

```js
function loadModelFromWorkbook(workbook) {
  const checklistRows = sheetToRows(workbook, 'Checklist');
  const inputRows = sheetToRows(workbook, 'Inputs');
  const sectionRows = optionalSheetToRows(workbook, 'Sections');
  const glossaryRows = optionalSheetToRows(workbook, 'Glossary');
  return buildModel({ checklistRows, inputRows, sectionRows, glossaryRows });
}
```

- [ ] **Step 2: Round-trip sections + glossary through localStorage**

Replace `persistModel` with:

```js
function persistModel(model) {
  const serializable = {
    items: model.items.map(({ condition, ...rest }) => rest),
    inputs: model.inputs,
    sections: model.sections,
    glossary: model.glossary,
  };
  window.localStorage.setItem(MODEL_KEY, JSON.stringify(serializable));
}
```

Replace `restoreModel` with:

```js
function restoreModel() {
  const raw = window.localStorage.getItem(MODEL_KEY);
  if (!raw) return null;
  try {
    const data = JSON.parse(raw);
    const inputRows = [
      ['Name', 'Type', 'Label', 'Unit', 'Choices', 'Default'],
      ...data.inputs.map(i => [i.name, i.type, i.label, i.unit, i.choices.join(';'), i.default]),
    ];
    const checklistRows = [
      ['Item ID', 'Conditions', 'Description', 'Code', 'Note', 'Example'],
      ...data.items.map(i => [i.id, i.conditionsText, i.description, i.code, i.note, i.example]),
    ];
    const sectionRows = (data.sections && data.sections.length)
      ? [['Prefix', 'Name'], ...data.sections.map(s => [s.prefix, s.name])]
      : undefined;
    const glossaryRows = (data.glossary && data.glossary.length)
      ? [['Term', 'Meaning'], ...data.glossary.map(g => [g.term, g.meaning])]
      : undefined;
    return buildModel({ checklistRows, inputRows, sectionRows, glossaryRows });
  } catch {
    return null;
  }
}
```

- [ ] **Step 3: Manual verification — sections survive reload**

Run: `python -m http.server 8123` (from the project folder; leave running).
In a browser at `http://localhost:8123/`:
1. Setup → load `SampleChecklist.xlsx`. Expected: green status "Loaded 9 items and 4 inputs."
2. Open devtools console and run `localStorage.getItem('dpchecklist.model')`. Expected: the JSON contains `"sections"` with A/B/C and `"glossary"` with EN81-20.
3. Reload the page. Expected: no error; staying functional (Dashboard shows).

- [ ] **Step 4: Commit**

```bash
git add src/app.js
git commit -m "feat: load optional Sections/Glossary sheets and round-trip model"
```

---

### Task 7: Multi-unit project UI

**Files:**
- Modify: `index.html`, `src/app.js`

**Interfaces:**
- Consumes: `getProject`, `saveProject`, `createProject`, `newUnit`, `computeProgress`, `computeProjectProgress`, `applicableItems`.
- Produces: `state.currentUnitId`; project screen renders the active unit; dashboard shows unit count + aggregate progress.

- [ ] **Step 1: Add the unit bar to the project screen**

In `index.html`, inside `#screen-project`, immediately after the `<h2 id="project-title"></h2>` line, add:

```html
      <div id="unit-bar" class="unit-bar">
        <label for="unit-select">Unit</label>
        <select id="unit-select"></select>
        <button id="btn-add-unit" class="btn-sm">Add unit</button>
        <button id="btn-rename-unit" class="btn-sm">Rename</button>
        <button id="btn-delete-unit" class="btn-sm btn-danger">Delete unit</button>
      </div>
```

- [ ] **Step 2: Track the active unit and render it**

In `src/app.js`, add `currentUnitId: null` to the `state` object.

Replace `openProject` with:

```js
function openProject(id) {
  state.currentProjectId = id;
  const project = getCurrentProject();
  state.currentUnitId = project && project.units[0] ? project.units[0].id : null;
  showScreen('project');
  renderProject();
}
```

Add a unit accessor after `getCurrentProject`:

```js
function getCurrentUnit() {
  const project = getCurrentProject();
  if (!project) return null;
  return project.units.find(u => u.id === state.currentUnitId) || project.units[0];
}
```

Replace `renderInputs(project)` signature and its first lines to take a `unit`:

```js
function renderInputs(unit) {
  const panel = document.getElementById('inputs-panel');
  panel.innerHTML = '<h3>Project inputs</h3>';
  for (const def of state.model.inputs) {
    if (!(def.name in unit.inputs)) unit.inputs[def.name] = defaultInputValue(def);
    const value = unit.inputs[def.name];
```

(The rest of `renderInputs` is unchanged except the variable name `project` → `unit`.)

Replace `updateInput` with:

```js
function updateInput(name, value) {
  const project = getCurrentProject();
  const unit = getCurrentUnit();
  unit.inputs[name] = value;
  saveCurrent(project);
  renderItems(unit);
  renderProgress();
}
```

Replace `renderItems(project)` signature and its check/comment handlers to use `unit`:

```js
function renderItems(unit) {
  const container = document.getElementById('items-list');
  container.innerHTML = '';
  const items = applicableItems(state.model, unit.inputs);
  for (const item of items) {
    const checked = unit.checks[item.id] === true;
```

In the textarea handler within `renderItems`, replace the `getCurrentProject()` comment write with unit-scoped writes:

```js
    ta.value = unit.comments[item.id] || '';
    ta.addEventListener('input', () => {
      const u = getCurrentUnit();
      u.comments[item.id] = ta.value;
      saveCurrent(getCurrentProject());
    });
```

In the checkbox handler within `renderItems`, replace with:

```js
  container.querySelectorAll('[data-check]').forEach(cb =>
    cb.addEventListener('change', () => {
      const u = getCurrentUnit();
      u.checks[cb.getAttribute('data-check')] = cb.checked;
      saveCurrent(getCurrentProject());
      renderItems(u);
      renderProgress();
    }));
```

Replace `renderProgress(project)` with a no-arg version using the active unit + project:

```js
function renderProgress() {
  const project = getCurrentProject();
  const unit = getCurrentUnit();
  const u = computeProgress(state.model, unit);
  const all = computeProjectProgress(state.model, project);
  document.getElementById('project-progress-bar').style.width = Math.round(u.ratio * 100) + '%';
  document.getElementById('project-progress-label').textContent =
    `${u.checked} / ${u.applicable} checked in this unit · ${all.checked} / ${all.applicable} across project`;
}
```

Add the import for `computeProjectProgress` at the top of `app.js`:

```js
import { computeProgress, computeProjectProgress, applicableItems, buildExportRows } from './exporter.js';
```

- [ ] **Step 3: Render the unit selector and wire unit controls**

Add a `renderUnitBar` function and call it from `renderProject`:

```js
function renderUnitBar() {
  const project = getCurrentProject();
  const sel = document.getElementById('unit-select');
  sel.innerHTML = '';
  for (const u of project.units) {
    const opt = document.createElement('option');
    opt.value = u.id;
    opt.textContent = u.name;
    if (u.id === state.currentUnitId) opt.selected = true;
    sel.appendChild(opt);
  }
  document.getElementById('btn-delete-unit').disabled = project.units.length <= 1;
}
```

Replace `renderProject` with:

```js
function renderProject() {
  const project = getCurrentProject();
  if (!project) { showScreen('dashboard'); return; }
  if (!getCurrentUnit()) state.currentUnitId = project.units[0].id;
  document.getElementById('project-title').textContent = project.name;
  renderUnitBar();
  const unit = getCurrentUnit();
  renderInputs(unit);
  saveCurrent(project);
  renderItems(unit);
  renderProgress();
}
```

In `init()`, add wiring after the existing `btn-back` listener:

```js
  document.getElementById('unit-select').addEventListener('change', e => {
    state.currentUnitId = e.target.value;
    renderProject();
  });
  document.getElementById('btn-add-unit').addEventListener('click', () => {
    const name = prompt('New unit name?', 'Unit ' + (getCurrentProject().units.length + 1));
    if (!name) return;
    const project = getCurrentProject();
    const unit = state.store.newUnit(name);
    project.units.push(unit);
    saveCurrent(project);
    state.currentUnitId = unit.id;
    renderProject();
  });
  document.getElementById('btn-rename-unit').addEventListener('click', () => {
    const project = getCurrentProject();
    const unit = getCurrentUnit();
    const name = prompt('Rename unit', unit.name);
    if (!name) return;
    unit.name = name;
    saveCurrent(project);
    renderProject();
  });
  document.getElementById('btn-delete-unit').addEventListener('click', () => {
    const project = getCurrentProject();
    if (project.units.length <= 1) { alert('A project needs at least one unit.'); return; }
    if (!confirm('Delete this unit?')) return;
    project.units = project.units.filter(u => u.id !== state.currentUnitId);
    state.currentUnitId = project.units[0].id;
    saveCurrent(project);
    renderProject();
  });
```

- [ ] **Step 4: Update the dashboard for aggregate progress + unit count**

In `renderDashboard`, replace the per-project block (the `computeProgress` call and the `li.innerHTML` template) with:

```js
    const project = state.store.getProject(summary.id);
    const { checked, applicable, ratio } = computeProjectProgress(state.model, project);
    const li = document.createElement('li');
    li.className = 'project-card';
    li.innerHTML = `
      <div class="row-between">
        <strong>${escapeHtml(project.name)}</strong>
        <span class="btn-row">
          <button class="btn-primary btn-sm" data-open="${project.id}">Open</button>
          <button class="btn-danger btn-sm" data-delete="${project.id}">Delete</button>
        </span>
      </div>
      <div class="progress"><div class="progress-bar" style="width:${Math.round(ratio * 100)}%"></div></div>
      <p class="muted">${project.units.length} unit${project.units.length === 1 ? '' : 's'} · ${checked} / ${applicable} checked</p>`;
    list.appendChild(li);
```

- [ ] **Step 5: Manual verification — units work**

With `python -m http.server 8123` running and `SampleChecklist.xlsx` loaded:
1. Dashboard → New project "Tower A". Expected: project screen shows a Unit dropdown with "Unit 1".
2. Click **Add unit** → name "Penthouse". Expected: dropdown now lists "Unit 1" and "Penthouse"; active becomes Penthouse with its own (default) inputs.
3. Set an input on Penthouse, tick an item; switch back to Unit 1. Expected: Unit 1 checks/inputs are independent.
4. Back to Dashboard. Expected: card shows "2 units · X / Y checked" with aggregate progress.
5. **Delete unit** on the only remaining unit is disabled/blocked. Expected: alert or disabled button.

- [ ] **Step 6: Commit**

```bash
git add index.html src/app.js
git commit -m "feat: multi-unit project workspace with unit selector"
```

---

### Task 8: Section filter and grouped checklist rendering

**Files:**
- Modify: `index.html`, `src/app.js`

**Interfaces:**
- Consumes: `state.model.sections`, `applicableItems`, active unit.
- Produces: `state.sectionFilter` (prefix string or `''` for all); items render grouped under section headings.

- [ ] **Step 1: Add the section filter control**

In `index.html`, inside `#screen-project`, add just above `<div class="project-body">`:

```html
      <div class="section-filter">
        <label for="section-select">Section</label>
        <select id="section-select"></select>
      </div>
```

- [ ] **Step 2: Populate the filter and group items**

In `src/app.js`, add `sectionFilter: ''` to the `state` object.

Add a function to populate the filter, called from `renderProject` (add `renderSectionFilter();` right after `renderUnitBar();`):

```js
function renderSectionFilter() {
  const sel = document.getElementById('section-select');
  sel.innerHTML = '';
  const allOpt = document.createElement('option');
  allOpt.value = '';
  allOpt.textContent = 'All sections';
  sel.appendChild(allOpt);
  for (const s of state.model.sections) {
    const opt = document.createElement('option');
    opt.value = s.prefix;
    opt.textContent = s.name;
    if (s.prefix === state.sectionFilter) opt.selected = true;
    sel.appendChild(opt);
  }
}
```

Replace the top of `renderItems` (the part that builds the flat list) with grouped rendering. Replace the whole `for (const item of items) { ... }` construction loop with a grouped version, keeping the per-item card creation identical. Concretely, replace:

```js
  const items = applicableItems(state.model, unit.inputs);
  for (const item of items) {
```

with:

```js
  let items = applicableItems(state.model, unit.inputs);
  if (state.sectionFilter) items = items.filter(i => i.sectionPrefix === state.sectionFilter);
  let currentSection = null;
  for (const item of items) {
    if (item.section !== currentSection) {
      currentSection = item.section;
      const h = document.createElement('h3');
      h.className = 'section-heading';
      h.textContent = currentSection;
      container.appendChild(h);
    }
```

(The existing item-card body — building `div.item`, the checkbox handler attachment block below the loop, etc. — stays the same. The loop now also emits a heading whenever the section changes.)

- [ ] **Step 3: Wire the filter control**

In `init()`, after the unit-select listener, add:

```js
  document.getElementById('section-select').addEventListener('change', e => {
    state.sectionFilter = e.target.value;
    renderItems(getCurrentUnit());
  });
```

- [ ] **Step 4: Manual verification — filtering works**

With the server running and `SampleChecklist.xlsx` loaded, open a project:
1. Expected: items appear grouped under headings "Architectural", "Structural", "Electrical" (subject to applicability).
2. Choose "Structural" in the Section dropdown. Expected: only B-items show, under the "Structural" heading.
3. Choose "All sections". Expected: all applicable items return, grouped.

- [ ] **Step 5: Commit**

```bash
git add index.html src/app.js
git commit -m "feat: section filter and grouped checklist rendering"
```

---

### Task 9: About / Info page

**Files:**
- Modify: `index.html`, `src/app.js`

**Interfaces:**
- Consumes: `state.model.sections`, `state.model.glossary`.
- Produces: an `about` screen rendered from the model; reachable via a top-bar nav button.

- [ ] **Step 1: Add the About nav button and screen**

In `index.html`, add a nav button in the `.topbar nav` (before `#nav-setup`):

```html
      <button id="nav-about" class="btn-ghost">About</button>
```

Add a new screen after `#screen-project` (before the closing `</main>`):

```html
    <section id="screen-about" class="screen" hidden>
      <h2>About — Sections &amp; Glossary</h2>
      <p class="muted">Reference information from the loaded workbook's <code>Sections</code> and
        <code>Glossary</code> sheets.</p>
      <div id="about-empty" class="muted" hidden>This workbook has no reference info — add
        <code>Sections</code> and <code>Glossary</code> sheets to populate this page.</div>
      <h3>Sections</h3>
      <table id="about-sections" class="info-table"></table>
      <h3>Glossary</h3>
      <table id="about-glossary" class="info-table"></table>
    </section>
```

- [ ] **Step 2: Register the screen and render it**

In `src/app.js`, add `'about'` to the `screens` array:

```js
const screens = ['setup', 'dashboard', 'project', 'about'];
```

In `showScreen`, after the dashboard branch, add:

```js
  if (name === 'about') renderAbout();
```

Add `renderAbout`:

```js
function renderAbout() {
  const model = state.model;
  const sections = (model && model.sections) || [];
  const glossary = (model && model.glossary) || [];
  document.getElementById('about-empty').hidden = !(sections.length === 0 && glossary.length === 0);

  const secTable = document.getElementById('about-sections');
  secTable.innerHTML = '<tr><th>Prefix</th><th>Section</th></tr>' +
    sections.map(s => `<tr><td>${escapeHtml(s.prefix)}</td><td>${escapeHtml(s.name)}</td></tr>`).join('');

  const gloTable = document.getElementById('about-glossary');
  gloTable.innerHTML = '<tr><th>Term</th><th>Meaning</th></tr>' +
    glossary.map(g => `<tr><td>${escapeHtml(g.term)}</td><td>${escapeHtml(g.meaning)}</td></tr>`).join('');
}
```

- [ ] **Step 3: Wire the nav button**

In `init()`, after the `nav-setup` listener, add:

```js
  document.getElementById('nav-about').addEventListener('click', () => showScreen('about'));
```

- [ ] **Step 4: Manual verification — About page**

With the server running and `SampleChecklist.xlsx` loaded, click **About** in the top bar.
Expected: a Sections table (A/Architectural, B/Structural, C/Electrical) and a Glossary table (AS3000, EN81-20, BCA, …). Loading a workbook without those sheets shows the "no reference info" note.

- [ ] **Step 5: Commit**

```bash
git add index.html src/app.js
git commit -m "feat: add About page listing sections and glossary"
```

---

### Task 10: Multi-sheet Excel export (one sheet per unit)

**Files:**
- Modify: `src/app.js`

**Interfaces:**
- Consumes: `buildExportRows(model, unit)`, `XLSX`.
- Produces: a single workbook with one worksheet per unit, sheet names sanitized + de-duplicated.

- [ ] **Step 1: Add a sheet-name sanitizer and rewrite the export**

In `src/app.js`, replace `exportUnchecked` with:

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

function exportUnchecked() {
  const project = getCurrentProject();
  const wb = XLSX.utils.book_new();
  const used = new Set();
  for (const unit of project.units) {
    const rows = buildExportRows(state.model, unit);
    const ws = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, sanitizeSheetName(unit.name, used));
  }
  const safeName = project.name.replace(/[^\w\-]+/g, '_');
  const date = new Date().toISOString().slice(0, 10);
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  downloadBlob(new Blob([out], { type: 'application/octet-stream' }), `${safeName}_unchecked_${date}.xlsx`);
}
```

- [ ] **Step 2: Manual verification — multi-sheet export**

With the server running and a project that has 2 units (from Task 7), click **Export unchecked to Excel**.
Expected: a downloaded `.xlsx` opens with one worksheet per unit (named after each unit), each listing that unit's unchecked items with columns Item ID, Description, Code, Comments, Example.

- [ ] **Step 3: Commit**

```bash
git add src/app.js
git commit -m "feat: export one worksheet per unit"
```

---

### Task 11: Red theme with green completion signals

**Files:**
- Modify: `styles.css`

**Interfaces:**
- Consumes: existing class names (`.btn-primary`, `.progress-bar`, `.item.checked`, etc.) plus new ones from Tasks 7–9 (`.unit-bar`, `.section-filter`, `.section-heading`, `.info-table`).
- Produces: red accent everywhere except green completion signals.

- [ ] **Step 1: Recolor tokens and add success green**

In `styles.css`, in the `:root` block, change `--accent`/`--accent-hover`/`--accent-soft` to red and add success tokens:

```css
  --accent: #c0392b;
  --accent-hover: #a5281c;
  --accent-soft: #fbe9e7;
  --success: #5f7d35;
  --success-soft: #eef2e6;
```

- [ ] **Step 2: Point completion signals at green**

In `styles.css`:

Change the progress bar fill:

```css
.progress-bar {
  background: var(--success);
  height: 100%;
  width: 0%;
  border-radius: 999px;
  transition: width .25s ease;
}
```

Change checked-item styling:

```css
.item.checked {
  background: var(--success-soft);
  border-color: #d2e0bd;
}
```

Make checklist item checkboxes green (scoped to the items list) by adding:

```css
.items-list input[type="checkbox"] { accent-color: var(--success); }
```

(Other checkboxes and the focus rings keep `--accent` = red.)

- [ ] **Step 3: Style the new controls**

Append to `styles.css`:

```css
/* ---- Unit bar & section filter --------------------------------------- */

.unit-bar, .section-filter {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 12px 0;
  flex-wrap: wrap;
}

.unit-bar label, .section-filter label {
  font-weight: 600;
  font-size: 13px;
  color: var(--text-muted);
}

.unit-bar select, .section-filter select { width: auto; min-width: 160px; }

.section-heading {
  font-size: 13px;
  font-weight: 650;
  text-transform: uppercase;
  letter-spacing: .05em;
  color: var(--text-muted);
  margin: 18px 0 8px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--border);
}

.section-heading:first-child { margin-top: 0; }

/* ---- About tables ----------------------------------------------------- */

.info-table {
  width: 100%;
  border-collapse: collapse;
  margin: 8px 0 24px;
  font-size: 14px;
}

.info-table th, .info-table td {
  text-align: left;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  vertical-align: top;
}

.info-table th {
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: .05em;
  color: var(--text-muted);
}

.info-table td:first-child { font-weight: 600; white-space: nowrap; }
```

- [ ] **Step 4: Manual verification — theme**

With the server running and `SampleChecklist.xlsx` loaded, capture a screenshot of the dashboard and a project:

```bash
EDGE="/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
[ -f "$EDGE" ] || EDGE="/c/Program Files/Microsoft/Edge/Application/msedge.exe"
"$EDGE" --headless=new --disable-gpu --hide-scrollbars --window-size=1100,900 \
  --screenshot="theme.png" "http://localhost:8123/"
```

Expected: primary buttons, header mark, and focus rings are **red**; progress bars and checked items are **green**. (Open in browser to confirm interactive screens, since the headless shot lands on the Setup/Dashboard screen.)

- [ ] **Step 5: Commit**

```bash
git add styles.css
git commit -m "feat: red accent theme with green completion signals"
```

---

### Task 12: Documentation and final verification

**Files:**
- Modify: `README.md`

**Interfaces:** none (docs + verification).

- [ ] **Step 1: Update the README**

In `README.md`, under "Workbook format", document the two optional sheets and update the workflow:

Add after the `Inputs` sheet description:

```markdown
### Sheet `Sections` (optional)

| Prefix | Name |
|--------|------|

Maps the **leading letters of each Item ID** to a section name (`A` → `Architectural`).
Items are grouped and filterable by section. If this sheet is absent, the bare prefix
letter is used as the section name.

### Sheet `Glossary` (optional)

| Term | Meaning |
|------|---------|

Powers the **About** page — a reference list of the codes/acronyms used in your checklist.
```

Under "First use", add bullets describing **units** (a project can hold multiple units via the Unit dropdown; Add/Rename/Delete unit; export produces one worksheet per unit) and the **About** page and **Section** filter.

- [ ] **Step 2: Run the full test suite**

Run: `npm test`
Expected: all tests pass, `fail 0`.

- [ ] **Step 3: Full manual smoke test**

With `python -m http.server 8123` running:
1. Load `SampleChecklist.xlsx` → "Loaded 9 items and 4 inputs."
2. New project, add a second unit, set different inputs per unit, tick items, switch units — independence holds.
3. Section dropdown filters; headings show.
4. About page shows Sections + Glossary.
5. Export → multi-sheet workbook, columns Item ID/Description/Code/Comments/Example, Example column present, no Note column.
6. Reload page → project + model persist.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: document sections, units, About page, and theme"
```

---

## Self-Review Notes

- **Spec coverage:** §1 Sections sheet → Task 1; §1 model fields → Tasks 1–2,6; §1 sample workbook → Task 3; §2 section filter → Task 8; §3 units model/migration/import/serialize → Task 4; §3 project view → Task 7; §3 dashboard → Task 7; §3 export → Tasks 5,10; §4 About page → Task 9; §5 theme → Task 11; testing → Tasks 1,2,4,5 + manual passes; README → Task 12.
- **Type consistency:** `buildModel({checklistRows, inputRows, sectionRows, glossaryRows})`, model `{items, inputs, inputDefs, sections, glossary}`, item `{..., sectionPrefix, section}`, project `{id, name, updatedAt, units:[{id,name,inputs,checks,comments}]}`, `computeProgress(model, unit)`, `computeProjectProgress(model, project)`, `buildExportRows(model, unit)`, store exposes `newUnit` — all used consistently across tasks.
