# Reviewer & Builder Details Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture six optional project-level detail fields (Reviewer name/contact; Builder name/phone/email/approval-no) on the create-project screen and surface them on the Excel Overview sheet.

**Architecture:** A new `details` object rides on each project. `projectStore.js` owns the details shape (`emptyDetails`/`normalizeDetails`), defaults it on load/import, and includes it in file-backup serialization; IndexedDB already round-trips it via the whole-project clone. `app.js` renders a static Details section and wires the six inputs to `draft.details`. `exportWorkbook.js` reads `project.details` onto the Overview sheet (reviewer fields fill the existing "Reviewed By/Contact" rows; a new BUILDER DETAILS band holds the builder rows).

**Tech Stack:** Vanilla ES modules, no build step. Node's built-in test runner. Token-driven theme-aware CSS. Vendored `xlsx-js-style` (injected into `exportWorkbook.js`).

## Global Constraints

- **Static-app discipline:** no framework, no bundler, no new runtime deps. (CLAUDE.md)
- **Pure logic in `src/` is DOM-free and unit-tested;** `app.js` DOM glue is not unit-tested (verified by `node --check` + smoke). `exportWorkbook.js` is pure (XLSX injected) but has no committed test — verified via a Node/XLSX harness per repo convention. (CLAUDE.md)
- **CSS token-driven + theme-aware:** existing tokens only (`--surface`, `--border`, `--border-strong`, `--text`, `--text-muted`, `--radius-sm`), no hardcoded colors; new editor CSS scoped under `[data-screen="editor"]`. (CLAUDE.md)
- **Field labels are sentence case** (these are field labels, not buttons). Button labels stay Title Case. (CLAUDE.md)
- **`db.js` owns the IndexedDB schema — do not touch it.** This feature needs no schema change (the whole project object is stored as-is). (CLAUDE.md)
- **The six fields are all optional** — nothing blocks saving; `validateDraft` is unchanged.
- **The details object shape (exact keys):** `{ reviewerName, reviewerContact, builderName, builderPhone, builderEmail, builderApprovalNo }`, all strings.
- **Run tests:** `npm test`. **Syntax check:** `node --check src/<file>.js`.

---

### Task 1: Data model — details shape, defaulting, serialization, draft seeding

**Files:**
- Modify: `src/projectStore.js` (add helpers ~after line 7; `migrateProject` ~9-17; `createProject` ~108-116; `serializeProject` ~122-129; `importProject` ~131-141; exports ~167-171)
- Modify: `src/projectDraft.js` (import line 3; `newBlankDraft` ~47-49)
- Test: `tests/projectStore.test.js`, `tests/projectDraft.test.js`

**Interfaces:**
- Produces (from `projectStore.js`): `emptyDetails()` → `{reviewerName:'',reviewerContact:'',builderName:'',builderPhone:'',builderEmail:'',builderApprovalNo:''}`; `normalizeDetails(d)` → same shape, filling missing keys, dropping unknown keys, coercing values to `String`. Both exported. Every stored/loaded/imported project gains a `details` field of this shape.
- Consumes: nothing new.

- [ ] **Step 1: Write the failing store tests**

Add to `tests/projectStore.test.js`. Change the top import to include the new exports:

```js
import { createProjectStore, emptyDetails, normalizeDetails } from '../src/projectStore.js';
```

Append these tests:

```js
test('emptyDetails returns six empty-string fields', () => {
  assert.deepEqual(emptyDetails(), {
    reviewerName: '', reviewerContact: '',
    builderName: '', builderPhone: '', builderEmail: '', builderApprovalNo: '',
  });
});

test('normalizeDetails fills missing keys, drops unknowns, coerces to string', () => {
  assert.deepEqual(
    normalizeDetails({ reviewerName: 'Jo', builderPhone: 123, junk: 'x' }),
    { reviewerName: 'Jo', reviewerContact: '', builderName: '', builderPhone: '123', builderEmail: '', builderApprovalNo: '' },
  );
  assert.deepEqual(normalizeDetails(undefined), emptyDetails());
});

test('serializeProject includes details and round-trips through importProject', () => {
  const store = createProjectStore();
  const p = store.createProject('T');
  p.details = { ...emptyDetails(), reviewerName: 'Ana', builderEmail: 'b@x.com' };
  const back = store.importProject(store.serializeProject(p));
  assert.equal(back.details.reviewerName, 'Ana');
  assert.equal(back.details.builderEmail, 'b@x.com');
  assert.equal(back.details.builderName, ''); // untouched fields stay empty
});

test('createProject seeds empty details', () => {
  const store = createProjectStore();
  assert.deepEqual(store.createProject('X').details, emptyDetails());
});

test('load defaults details on projects that lack it', () => {
  const store = createProjectStore();
  store.load([{ id: 'p1', name: 'Old', units: [{ id: 'u1', name: 'U', inputs: {}, checks: {}, comments: {} }] }]);
  assert.deepEqual(store.getProject('p1').details, emptyDetails());
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `emptyDetails`/`normalizeDetails` not exported; `details` undefined.

- [ ] **Step 3: Implement in `src/projectStore.js`**

Add the helpers and constant near the top, after the `newUnit` function (~line 7):

```js
const DETAIL_KEYS = ['reviewerName', 'reviewerContact', 'builderName', 'builderPhone', 'builderEmail', 'builderApprovalNo'];

export function emptyDetails() {
  const d = {};
  for (const k of DETAIL_KEYS) d[k] = '';
  return d;
}

// Merge a partial/missing details object onto the empty shape: fills missing
// keys, drops unknown keys, coerces values to string. Defensive for legacy
// stored projects and imported data.
export function normalizeDetails(d) {
  const out = emptyDetails();
  if (d && typeof d === 'object') {
    for (const k of DETAIL_KEYS) if (d[k] != null) out[k] = String(d[k]);
  }
  return out;
}
```

Update `migrateProject` to guarantee a `details` field on both branches:

```js
function migrateProject(p) {
  if (!p) return p;
  if (Array.isArray(p.units)) return { ...p, details: normalizeDetails(p.details) };
  // Legacy flat project -> wrap into a single unit.
  return {
    id: p.id, name: p.name, updatedAt: p.updatedAt,
    details: normalizeDetails(p.details),
    units: [{ id: newId('u'), name: 'Unit 1', inputs: p.inputs || {}, checks: p.checks || {}, comments: p.comments || {} }],
  };
}
```

Seed `details` in `createProject`:

```js
  function createProject(name) {
    const project = {
      id: newId('p'), name: name || 'Untitled project',
      details: emptyDetails(),
      units: [newUnit('Unit 1')], updatedAt: new Date().toISOString(),
    };
    projects.set(project.id, clone(project));
    notify('upsert', project.id);
    return clone(project);
  }
```

Include `details` in `serializeProject`:

```js
  function serializeProject(project) {
    return JSON.stringify({
      name: project.name,
      details: normalizeDetails(project.details),
      units: (project.units || []).map(u => ({
        name: u.name, inputs: u.inputs || {}, checks: u.checks || {}, comments: u.comments || {},
      })),
    }, null, 2);
  }
```

Set `details` in `importProject` (the reconstructed project object ~line 137):

```js
    const project = { id: newId('p'), name: data.name || 'Imported project', details: normalizeDetails(data.details), units, updatedAt: new Date().toISOString() };
```

Export the helpers — add them to the returned/exported surface. They are already `export function` declarations at module scope, so they are module exports directly; no change to the `createProjectStore` return object is needed. (Leave the `return { load, ... }` object as-is.)

- [ ] **Step 4: Write the failing draft test**

In `tests/projectDraft.test.js`, add `emptyDetails` to imports from the store and add a test. The file already imports from `../src/projectStore.js` and builds a `model` — reuse that `model`.

Add import:
```js
import { emptyDetails } from '../src/projectStore.js';
```
Add test:
```js
test('newBlankDraft seeds empty details', () => {
  assert.deepEqual(newBlankDraft(model).details, emptyDetails());
});
```

- [ ] **Step 5: Implement draft seeding in `src/projectDraft.js`**

Update the import (line 3) to add `emptyDetails`:
```js
import { newId, newUnit, emptyDetails } from './projectStore.js';
```
Seed it in `newBlankDraft`:
```js
export function newBlankDraft(model) {
  return { id: newId('p'), name: '', details: emptyDetails(), units: [newDraftUnit(model, 'Unit 1')] };
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — all new store + draft tests green, existing suite unaffected.

- [ ] **Step 7: Commit**

```bash
git add src/projectStore.js src/projectDraft.js tests/projectStore.test.js tests/projectDraft.test.js
git commit -m "feat: project details data model (reviewer + builder fields)"
```

---

### Task 2: Editor UI — Details section + wiring

**Files:**
- Modify: `index.html` (insert after `#editor-name-error` ~line 295, before `.editor-units-head` ~line 297)
- Modify: `src/app.js` (import line 2; `renderEditor` name-wiring ~line 678; `openEditor` ~807-816)
- Modify: `styles.css` (after the editor-field rules ~line 842)

**Interfaces:**
- Consumes: `draft.details` (Task 1 shape); `normalizeDetails` (Task 1, from `projectStore.js`); `markEditorDirty` (existing).
- Produces: six inputs with ids `editor-reviewer-name`, `editor-reviewer-contact`, `editor-builder-name`, `editor-builder-phone`, `editor-builder-email`, `editor-builder-approval`.

- [ ] **Step 1: Add the Details markup to `index.html`**

Insert between the `#editor-name-error` paragraph and the `.editor-units-head` div:

```html
        <div class="editor-details" id="editor-details">
          <fieldset class="editor-details-group">
            <legend>Reviewer</legend>
            <label class="editor-field">
              <span class="setting-title">Name</span>
              <input type="text" id="editor-reviewer-name" />
            </label>
            <label class="editor-field">
              <span class="setting-title">Contact (email)</span>
              <input type="text" id="editor-reviewer-contact" />
            </label>
          </fieldset>
          <fieldset class="editor-details-group">
            <legend>Builder</legend>
            <div class="editor-details-grid">
              <label class="editor-field">
                <span class="setting-title">Name</span>
                <input type="text" id="editor-builder-name" />
              </label>
              <label class="editor-field">
                <span class="setting-title">Phone</span>
                <input type="text" id="editor-builder-phone" />
              </label>
              <label class="editor-field">
                <span class="setting-title">Email</span>
                <input type="text" id="editor-builder-email" />
              </label>
              <label class="editor-field">
                <span class="setting-title">Approval No. (BUP/BDC/DEP)</span>
                <input type="text" id="editor-builder-approval" />
              </label>
            </div>
          </fieldset>
        </div>
```

- [ ] **Step 2: Wire the inputs in `renderEditor` (`src/app.js`)**

The `renderEditor` function currently (after the grid feature) reads:

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

Insert the detail-field wiring immediately before `renderUnitGrid();`:

```js
  const details = draft.details;
  const wireDetail = (id, key) => {
    const el = document.getElementById(id);
    el.value = details[key] || '';
    el.oninput = () => { details[key] = el.value; markEditorDirty(); };
  };
  wireDetail('editor-reviewer-name', 'reviewerName');
  wireDetail('editor-reviewer-contact', 'reviewerContact');
  wireDetail('editor-builder-name', 'builderName');
  wireDetail('editor-builder-phone', 'builderPhone');
  wireDetail('editor-builder-email', 'builderEmail');
  wireDetail('editor-builder-approval', 'builderApprovalNo');
```

- [ ] **Step 3: Guard `draft.details` in `openEditor` and import `normalizeDetails`**

Change the `app.js` import line 2 from:
```js
import { createProjectStore } from './projectStore.js';
```
to:
```js
import { createProjectStore, normalizeDetails } from './projectStore.js';
```

In `openEditor`, after the `if (projectId) { … } else { … }` block that sets `state.editor`, add a guard so opening a legacy project (or any draft) always has the full details shape:

```js
  state.editor.draft.details = normalizeDetails(state.editor.draft.details);
```

(Place it right before `showScreen('editor');`.)

- [ ] **Step 4: Add scoped CSS to `styles.css`**

After the `.editor-units-head` rule (~line 842), add:

```css
[data-screen="editor"] .editor-details { margin: 4px 0 8px; }
[data-screen="editor"] .editor-details-group {
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 2px 16px 12px;
  margin: 0 0 14px;
}
[data-screen="editor"] .editor-details-group legend {
  padding: 0 6px;
  font-weight: 600;
  font-size: 13px;
  color: var(--text-muted);
}
[data-screen="editor"] .editor-details-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0 20px;
}
/* Inside the two-column builder grid the inputs fill their column (the base
   .editor-field input caps at 420px, which we don't want here). */
[data-screen="editor"] .editor-details-grid .editor-field input { max-width: none; }
@media (max-width: 720px) {
  [data-screen="editor"] .editor-details-grid { grid-template-columns: 1fr; }
}
```

- [ ] **Step 5: Syntax-check and manually verify**

Run: `node --check src/app.js`
Expected: no output.

Then run `python -m http.server 8000`, open a new project: the Details section shows a Reviewer group (Name, Contact) and a Builder group (Name, Phone, Email, Approval No.) between Project name and Units. Typing in a field, saving, and reopening the project shows the values preserved. (Full browser verification is Task 4.)

- [ ] **Step 6: Commit**

```bash
git add index.html src/app.js styles.css
git commit -m "feat: reviewer + builder details section on the project editor"
```

---

### Task 3: Export — reviewer fields + BUILDER DETAILS band on the Overview

**Files:**
- Modify: `src/exportWorkbook.js` (`buildOverviewSheet`, the PROJECT DETAILS rows ~lines 110-114)

**Interfaces:**
- Consumes: `project.details` (Task 1 shape); the existing `detail(label, value, fillable)` and `sectionBand(title)` closures already defined within `buildOverviewSheet`.
- Produces: reviewer values on the "Reviewed By"/"Contact" rows; a new BUILDER DETAILS section band with four rows. No signature changes.

- [ ] **Step 1: Update the PROJECT DETAILS rows and add the BUILDER DETAILS band**

In `buildOverviewSheet`, replace this block (~lines 110-114):

```js
  detail('Date Reviewed', reviewDate);
  detail('Project Title', project.name || '');
  detail('Reviewed By', '', true);
  detail('Contact', '', true);
  r++;
```

with:

```js
  const d = project.details || {};
  detail('Date Reviewed', reviewDate);
  detail('Project Title', project.name || '');
  // Reviewer fields fall back to the highlighted "(to be completed)" fillable
  // cell when not captured in-app (preserves the fill-in-Excel workflow).
  detail('Reviewed By', d.reviewerName || '', !d.reviewerName);
  detail('Contact', d.reviewerContact || '', !d.reviewerContact);
  r++;

  // Builder Details — informational; empty fields render as a plain blank cell.
  sectionBand('BUILDER DETAILS');
  detail('Builder Name', d.builderName || '');
  detail('Phone', d.builderPhone || '');
  detail('Email', d.builderEmail || '');
  detail('Approval No. (BUP/BDC/DEP)', d.builderApprovalNo || '');
  r++;
```

(`detail` and `sectionBand` are closures defined earlier in the same function and advance the shared `r`; no other change is needed. This runs for both `outstanding` and `full` modes since the Overview is shared.)

- [ ] **Step 2: Syntax-check**

Run: `node --check src/exportWorkbook.js`
Expected: no output.

Run: `npm test`
Expected: PASS — existing suite unaffected (no committed test imports `buildOverviewSheet`; it is verified via harness in Task 4).

- [ ] **Step 3: Commit**

```bash
git add src/exportWorkbook.js
git commit -m "feat: reviewer + builder details on the export Overview sheet"
```

---

### Task 4: Verification — export harness + browser smoke + full suite

**Files:** none (verification task; harness scripts live in the session scratchpad).

- [ ] **Step 1: Full unit suite**

Run: `npm test`
Expected: PASS — all suites green, including the new Task 1 tests.

- [ ] **Step 2: Syntax-check touched modules**

Run: `node --check src/projectStore.js && node --check src/projectDraft.js && node --check src/app.js && node --check src/exportWorkbook.js`
Expected: no output.

- [ ] **Step 3: Export Overview harness (Node + vendored XLSX)**

`exportWorkbook.js` has no committed test (repo convention: verify via harness). Build a real workbook and inspect the Overview. In the scratchpad, write a Node ESM harness that:
1. Loads the vendored `vendor/xlsx.bundle.js` (e.g. in a `vm` sandbox exposing `XLSX`, as the full-items-export verification did — see the `.superpowers/sdd/progress.md` ledger note for that feature) OR reuses whatever loader the prior `verify_export.mjs` harness used.
2. Builds a `model` via `buildModel({ checklistRows, inputRows })` on small sample sheets (see `tests/projectDraft.test.js` / `tests/exporter.test.js` for sample-row shapes) and a `project` with one unit and `details` = `{ reviewerName: 'Ana Reviewer', reviewerContact: 'ana@x.com', builderName: 'Acme Builders', builderPhone: '0400 000 000', builderEmail: 'build@acme.com', builderApprovalNo: 'BUP-12345' }`.
3. Builds the export plan: `const plan = buildExportPlan(model, project, { mode: 'outstanding' })` (imported from `src/exporter.js`).
4. Calls `buildExportWorkbook({ XLSX, model, project, plan, reviewDate: '01/01/2026', mode: 'outstanding' })` — the real signature is `{ XLSX, model, project, plan, reviewDate, mode }` (confirmed in `exportWorkbook.js:295`).
5. Reads the `Overview` sheet and collects every cell's `.v` string.

Assert:
- All six detail values appear among the Overview cell values (`Ana Reviewer`, `ana@x.com`, `Acme Builders`, `0400 000 000`, `build@acme.com`, `BUP-12345`).
- The label `BUILDER DETAILS` appears.
- With a second project whose `details.reviewerName`/`reviewerContact` are empty, the Overview still contains the `(to be completed)` placeholder text on those rows.

- [ ] **Step 4: Browser smoke (headless Edge over CDP)**

Follow the `browser-smoke-test-harness` memory. Script:
1. Load the model (`SampleSetup.zip`), create a new project.
2. Fill the six detail inputs (`#editor-reviewer-name`, `#editor-reviewer-contact`, `#editor-builder-name`, `#editor-builder-phone`, `#editor-builder-email`, `#editor-builder-approval`), a project name, and a unit.
3. Save, reopen the project's editor, assert the six inputs still hold the entered values (persistence through IndexedDB).
4. (If practical) trigger an export and confirm no error; deep Overview-content validation is already covered by Step 3's harness.

- [ ] **Step 5: Final commit if a fix was needed**

If Step 3 or 4 surfaced a fix, commit it:
```bash
git add -A
git commit -m "fix: <what verification caught>"
```
Otherwise no commit — the feature is complete on the branch.

---

## Self-Review Notes

- **Spec coverage:** data-model `details` shape + `emptyDetails`/`normalizeDetails` (Task 1) ✓; serialize/import round-trip + load default (Task 1) ✓; draft seeding (Task 1) ✓; editor Details section + wiring + openEditor guard (Task 2) ✓; scoped theme-aware CSS (Task 2) ✓; Overview reviewer wiring with fillable fallback + BUILDER DETAILS band (Task 3) ✓; unit tests + export harness + smoke (Tasks 1, 4) ✓; all fields optional / `validateDraft` untouched ✓; `db.js` untouched ✓.
- **Out of scope (per spec):** no email/phone validation, no approval type/value split, nothing required, no surfacing beyond the Overview.
- **Type consistency:** the six keys `reviewerName / reviewerContact / builderName / builderPhone / builderEmail / builderApprovalNo` are used identically in `emptyDetails`/`normalizeDetails` (Task 1), the `wireDetail` calls (Task 2), and the export `d.<key>` reads (Task 3). Input ids `editor-reviewer-name / -contact / editor-builder-name / -phone / -email / -approval` match between the HTML (Task 2 Step 1) and the `wireDetail` calls (Task 2 Step 2). `emptyDetails`/`normalizeDetails` are defined and exported in `projectStore.js` (Task 1) and imported by `projectDraft.js` and `app.js`.
```
