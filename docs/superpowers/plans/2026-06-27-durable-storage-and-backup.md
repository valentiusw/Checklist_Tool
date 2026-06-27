# Durable Storage & Connected Backup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the checklist model + projects from `localStorage` into a unified IndexedDB store (removing the ~5 MB cap), then auto-save a JSON snapshot to a real on-disk file via the File System Access API so data survives a browser-data wipe.

**Architecture:** One IndexedDB database (`dpchecklist` v2) holds `examples`, `projects`, and a `kv` store. At startup the app loads everything into an in-memory working set; render/edit code stays synchronous; a debounced flush persists changes to IndexedDB and (Phase 2) to a connected backup file. Reconnecting a backup file each session reconciles by `savedAt` timestamp. Everything degrades to today's manual Save/Restore when the File System Access API is unavailable.

**Tech Stack:** Vanilla ES modules, IndexedDB, File System Access API, `node:test`. No build step; no new vendored libraries.

## Global Constraints

- No build step; vanilla ES modules loaded directly by `index.html`. No new runtime dependencies.
- One IndexedDB database named `dpchecklist`, schema **version 2**, object stores: `examples`, `projects`, `kv`. Exactly one module (`src/db.js`) defines the schema/version; `exampleStore.js` obtains its connection from `db.open()`.
- The live store is IndexedDB; `localStorage` is read only once for one-time migration and otherwise no longer used for model/projects.
- Pure logic (no `indexedDB`, `window`, `document`, File System Access) must live in testable modules: `projectStore.js`, `legacyMigration.js`, `librarySnapshot.js`. Tests run with `node --test`.
- Backup snapshot format: `{ "type": "dpchecklist.library", "version": 1, "savedAt": <ISO>, "model": <serializable>, "projects": [ ... ] }`.
- Reconcile rule: newer `savedAt` wins; file wins exact ties; never discard the newer side.
- Commit after each task; message ends with the trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

# Phase 1 — Unified IndexedDB store

### Task 1: `db.js` — IndexedDB schema and low-level ops

Owns the schema/versioning and primitive reads/writes. Browser-only (uses `indexedDB`), so no `node:test`; verified by `node --check` here and the Phase 1 browser smoke (Task 6).

**Files:**
- Create: `src/db.js`

**Interfaces:**
- Consumes: global `indexedDB`.
- Produces (named exports):
  - `open() -> Promise<IDBDatabase>`
  - `loadSnapshot() -> Promise<{ model: object|null, projects: object[], savedAt: string|null }>`
  - `putProject(project) -> Promise<void>`
  - `deleteProject(id) -> Promise<void>`
  - `clearProjects() -> Promise<void>`
  - `setMeta(key, value) -> Promise<void>`  (kv store; used for `'model'`, `'savedAt'`, `'backupHandle'`)
  - `getMeta(key) -> Promise<any>`

- [ ] **Step 1: Create `src/db.js`**

```js
// The one place that defines the IndexedDB schema for the whole app.
// Stores: examples (filename -> Blob), projects (id -> project), kv (key -> value).
const DB_NAME = 'dpchecklist';
const VERSION = 2;
const STORES = ['examples', 'projects', 'kv'];

let dbPromise = null;

export function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of STORES) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(db, store, mode) {
  return db.transaction(store, mode).objectStore(store);
}

function reqDone(request, t) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    if (t) t.onerror = () => reject(t.error);
  });
}

export async function putProject(project) {
  const db = await open();
  const t = db.transaction('projects', 'readwrite');
  t.objectStore('projects').put(project, project.id);
  return new Promise((res, rej) => { t.oncomplete = () => res(); t.onerror = () => rej(t.error); });
}

export async function deleteProject(id) {
  const db = await open();
  const t = db.transaction('projects', 'readwrite');
  t.objectStore('projects').delete(id);
  return new Promise((res, rej) => { t.oncomplete = () => res(); t.onerror = () => rej(t.error); });
}

export async function clearProjects() {
  const db = await open();
  const t = db.transaction('projects', 'readwrite');
  t.objectStore('projects').clear();
  return new Promise((res, rej) => { t.oncomplete = () => res(); t.onerror = () => rej(t.error); });
}

export async function setMeta(key, value) {
  const db = await open();
  const t = db.transaction('kv', 'readwrite');
  t.objectStore('kv').put(value, key);
  return new Promise((res, rej) => { t.oncomplete = () => res(); t.onerror = () => rej(t.error); });
}

export async function getMeta(key) {
  const db = await open();
  return reqDone(tx(db, 'kv', 'readonly').get(key));
}

export async function loadSnapshot() {
  const db = await open();
  const projects = await reqDone(tx(db, 'projects', 'readonly').getAll());
  const model = await getMeta('model');
  const savedAt = await getMeta('savedAt');
  return { model: model || null, projects: projects || [], savedAt: savedAt || null };
}
```

- [ ] **Step 2: Syntax check**

Run: `node --check src/db.js`
Expected: exit 0, no output.

- [ ] **Step 3: Commit**

```bash
git add src/db.js
git commit -m "feat: add unified IndexedDB schema module (db.js)"
```

---

### Task 2: Refactor `exampleStore.js` to use `db.open()`

Removes its private v1 `openDb` so only `db.js` defines the schema. The public API (`clear/putAll/get/keys`) is unchanged. Browser-only; verified by `node --check` and the existing example flow in the Phase 1 smoke.

**Files:**
- Modify: `src/exampleStore.js`

**Interfaces:**
- Consumes: `open()` from `./db.js`.
- Produces: unchanged — `clear()`, `putAll(fileMap)`, `get(name)`, `keys()`.

- [ ] **Step 1: Replace `src/exampleStore.js`**

```js
// Persistence for the binary Examples files (PDFs/images), keyed by bare
// filename, in the shared `examples` object store. Schema is owned by db.js.
import { open } from './db.js';

const STORE = 'examples';

export async function clear() {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, 'readwrite');
    t.objectStore(STORE).clear();
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

export async function putAll(fileMap) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, 'readwrite');
    const store = t.objectStore(STORE);
    for (const [name, blob] of fileMap) store.put(blob, name);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

export async function get(name) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const r = db.transaction(STORE, 'readonly').objectStore(STORE).get(name);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export async function keys() {
  const db = await open();
  return new Promise((resolve, reject) => {
    const r = db.transaction(STORE, 'readonly').objectStore(STORE).getAllKeys();
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
```

- [ ] **Step 2: Syntax check + full suite still green**

Run: `node --check src/exampleStore.js`
Expected: exit 0.
Run: `node --test`
Expected: PASS (42 tests; this change is browser-only and shouldn't affect pure tests).

- [ ] **Step 3: Commit**

```bash
git add src/exampleStore.js
git commit -m "refactor: exampleStore uses shared db.js connection"
```

---

### Task 3: Refactor `projectStore.js` to an in-memory store

Becomes a synchronous in-memory `Map` store that emits `onChange` after mutations, so persistence can flush separately. Pure (no `localStorage`/`indexedDB`) — TDD with `node:test`.

**Files:**
- Modify: `src/projectStore.js`
- Modify: `tests/projectStore.test.js`

**Interfaces:**
- Consumes: nothing browser-specific.
- Produces: `createProjectStore({ onChange }) ->` object with:
  - `load(projects: object[]): void`
  - `listProjects(): {id,name,updatedAt}[]`
  - `getProject(id): object|null` (deep clone)
  - `saveProject(project): void`
  - `deleteProject(id): void`
  - `createProject(name): object` (deep clone)
  - `newUnit(name): object`
  - `serializeProject(project): string`
  - `importProject(jsonString): object`
  - `serializeLibrary(): string`
  - `importLibrary(jsonString): number`
  - `onChange` is called as `onChange({ type: 'upsert'|'delete', id })` after each mutation.

- [ ] **Step 1: Rewrite the tests in `tests/projectStore.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProjectStore } from '../src/projectStore.js';

test('createProject + getProject returns an independent clone', () => {
  const store = createProjectStore();
  const p = store.createProject('Tower A');
  assert.equal(p.name, 'Tower A');
  assert.equal(p.units.length, 1);
  const fetched = store.getProject(p.id);
  fetched.name = 'mutated';
  assert.equal(store.getProject(p.id).name, 'Tower A'); // clone isolation
});

test('onChange fires upsert on save and delete on delete', () => {
  const events = [];
  const store = createProjectStore({ onChange: e => events.push(e) });
  const p = store.createProject('X');
  store.deleteProject(p.id);
  assert.deepEqual(events.map(e => e.type), ['upsert', 'delete']);
  assert.equal(events[1].id, p.id);
});

test('load seeds projects and migrates legacy flat shape', () => {
  const store = createProjectStore();
  store.load([
    { id: 'p1', name: 'New', units: [{ id: 'u1', name: 'U', inputs: {}, checks: {}, comments: {} }] },
    { id: 'p2', name: 'Legacy', inputs: { A: true }, checks: { X: true }, comments: {} },
  ]);
  assert.equal(store.listProjects().length, 2);
  const legacy = store.getProject('p2');
  assert.equal(legacy.units.length, 1); // wrapped into one unit
  assert.equal(legacy.units[0].checks.X, true);
});

test('listProjects sorts by updatedAt desc', () => {
  const store = createProjectStore();
  store.load([
    { id: 'a', name: 'A', updatedAt: '2026-01-01T00:00:00Z', units: [] },
    { id: 'b', name: 'B', updatedAt: '2026-02-01T00:00:00Z', units: [] },
  ]);
  assert.deepEqual(store.listProjects().map(p => p.id), ['b', 'a']);
});

test('serializeLibrary then importLibrary into a fresh store reproduces projects', () => {
  const store = createProjectStore();
  store.createProject('One');
  store.createProject('Two');
  const json = store.serializeLibrary();
  const fresh = createProjectStore();
  const n = fresh.importLibrary(json);
  assert.equal(n, 2);
  assert.deepEqual(fresh.listProjects().map(p => p.name).sort(), ['One', 'Two']);
});

test('importLibrary merges by id (same id overwrites)', () => {
  const store = createProjectStore();
  const p = store.createProject('Orig');
  const lib = JSON.stringify({ type: 'dpchecklist.library', version: 1,
    projects: [{ id: p.id, name: 'Renamed', units: [{ id: 'u', name: 'U', inputs: {}, checks: {}, comments: {} }] }] });
  store.importLibrary(lib);
  assert.equal(store.listProjects().length, 1);
  assert.equal(store.getProject(p.id).name, 'Renamed');
});

test('importProject accepts legacy flat JSON and returns a project with units', () => {
  const store = createProjectStore();
  const proj = store.importProject(JSON.stringify({ name: 'Flat', inputs: {}, checks: {}, comments: {} }));
  assert.equal(proj.units.length, 1);
  assert.equal(store.listProjects().length, 1);
});

test('importProject rejects malformed JSON', () => {
  const store = createProjectStore();
  assert.throws(() => store.importProject('{not json'));
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/projectStore.test.js`
Expected: FAIL — current `createProjectStore` expects a `storage` arg and has no `load`.

- [ ] **Step 3: Rewrite `src/projectStore.js`**

```js
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
    id: p.id, name: p.name, updatedAt: p.updatedAt,
    units: [{ id: newId('u'), name: 'Unit 1', inputs: p.inputs || {}, checks: p.checks || {}, comments: p.comments || {} }],
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

const clone = (o) => JSON.parse(JSON.stringify(o));

export function createProjectStore({ onChange } = {}) {
  const projects = new Map(); // id -> stored project (owned copy)
  const notify = (type, id) => { if (onChange) onChange({ type, id }); };

  function load(list) {
    projects.clear();
    for (const raw of list || []) {
      const p = migrateProject(raw);
      if (p && p.id) projects.set(p.id, p);
    }
  }

  function listProjects() {
    return [...projects.values()]
      .map(p => ({ id: p.id, name: p.name, updatedAt: p.updatedAt }))
      .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  }

  function getProject(id) {
    const p = projects.get(id);
    return p ? clone(p) : null;
  }

  function saveProject(project) {
    project.updatedAt = new Date().toISOString();
    projects.set(project.id, clone(project));
    notify('upsert', project.id);
  }

  function createProject(name) {
    const project = {
      id: newId('p'), name: name || 'Untitled project',
      units: [newUnit('Unit 1')], updatedAt: new Date().toISOString(),
    };
    projects.set(project.id, clone(project));
    notify('upsert', project.id);
    return clone(project);
  }

  function deleteProject(id) {
    projects.delete(id);
    notify('delete', id);
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
    if (Array.isArray(data.units)) units = data.units.map(normalizeUnit);
    else units = [{ id: newId('u'), name: 'Unit 1', inputs: data.inputs || {}, checks: data.checks || {}, comments: data.comments || {} }];
    if (units.length === 0) units = [newUnit('Unit 1')];
    const project = { id: newId('p'), name: data.name || 'Imported project', units, updatedAt: new Date().toISOString() };
    projects.set(project.id, clone(project));
    notify('upsert', project.id);
    return clone(project);
  }

  function serializeLibrary() {
    return JSON.stringify({
      type: 'dpchecklist.library', version: 1,
      exportedAt: new Date().toISOString(),
      projects: [...projects.values()].map(clone),
    }, null, 2);
  }

  function importLibrary(jsonString) {
    const data = JSON.parse(jsonString);
    const list = Array.isArray(data) ? data : (data && data.projects) || [];
    if (!Array.isArray(list)) throw new Error('Not a valid project library file');
    for (const raw of list) {
      const project = migrateProject(raw);
      if (!project.id) project.id = newId('p');
      project.name = project.name || 'Imported project';
      project.units = (project.units && project.units.length ? project.units : [newUnit('Unit 1')]).map(normalizeUnit);
      project.updatedAt = project.updatedAt || new Date().toISOString();
      projects.set(project.id, clone(project));
      notify('upsert', project.id);
    }
    return list.length;
  }

  return {
    load, listProjects, getProject, saveProject, deleteProject, createProject,
    newUnit, serializeProject, importProject, serializeLibrary, importLibrary,
  };
}
```

- [ ] **Step 4: Run the suite**

Run: `node --test`
Expected: PASS (the 8 rewritten projectStore tests plus the rest).

- [ ] **Step 5: Commit**

```bash
git add src/projectStore.js tests/projectStore.test.js
git commit -m "refactor: in-memory projectStore with onChange notifications"
```

---

### Task 4: `legacyMigration.js` — read old `localStorage` data

Pure function that maps the legacy `localStorage` keys to `{ model, projects }` for the one-time migration. TDD with `node:test` using a fake storage object.

**Files:**
- Create: `src/legacyMigration.js`
- Create: `tests/legacyMigration.test.js`

**Interfaces:**
- Consumes: a storage-like object with `getItem(key) -> string|null`.
- Produces: `readLegacy(storage) -> { model: object|null, projects: object[] }`.

- [ ] **Step 1: Write failing tests `tests/legacyMigration.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readLegacy } from '../src/legacyMigration.js';

function fakeStorage(map) {
  return { getItem: (k) => (k in map ? map[k] : null) };
}

test('readLegacy returns nulls/empties when nothing stored', () => {
  const out = readLegacy(fakeStorage({}));
  assert.equal(out.model, null);
  assert.deepEqual(out.projects, []);
});

test('readLegacy parses model and indexed projects', () => {
  const storage = fakeStorage({
    'dpchecklist.model': JSON.stringify({ items: [], inputs: [], sections: [], glossary: [] }),
    'dpchecklist.projects.index': JSON.stringify([{ id: 'p1' }, { id: 'p2' }]),
    'dpchecklist.project.p1': JSON.stringify({ id: 'p1', name: 'One', units: [] }),
    'dpchecklist.project.p2': JSON.stringify({ id: 'p2', name: 'Two', units: [] }),
  });
  const out = readLegacy(storage);
  assert.ok(out.model && Array.isArray(out.model.inputs));
  assert.deepEqual(out.projects.map(p => p.name).sort(), ['One', 'Two']);
});

test('readLegacy skips missing/corrupt project records and bad model', () => {
  const storage = fakeStorage({
    'dpchecklist.model': '{bad json',
    'dpchecklist.projects.index': JSON.stringify([{ id: 'p1' }, { id: 'gone' }]),
    'dpchecklist.project.p1': JSON.stringify({ id: 'p1', name: 'One', units: [] }),
  });
  const out = readLegacy(storage);
  assert.equal(out.model, null);
  assert.deepEqual(out.projects.map(p => p.id), ['p1']);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/legacyMigration.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/legacyMigration.js`**

```js
// Read the pre-IndexedDB localStorage layout for the one-time migration:
//   dpchecklist.model            -> serializable model JSON
//   dpchecklist.projects.index   -> [{ id, name, updatedAt }]
//   dpchecklist.project.<id>     -> project JSON
const MODEL_KEY = 'dpchecklist.model';
const INDEX_KEY = 'dpchecklist.projects.index';
const PROJECT_PREFIX = 'dpchecklist.project.';

function tryParse(raw) {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export function readLegacy(storage) {
  const model = tryParse(storage.getItem(MODEL_KEY));
  const index = tryParse(storage.getItem(INDEX_KEY)) || [];
  const projects = [];
  for (const entry of Array.isArray(index) ? index : []) {
    if (!entry || !entry.id) continue;
    const p = tryParse(storage.getItem(PROJECT_PREFIX + entry.id));
    if (p) projects.push(p);
  }
  return { model: model || null, projects };
}
```

- [ ] **Step 4: Run the suite**

Run: `node --test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/legacyMigration.js tests/legacyMigration.test.js
git commit -m "feat: legacy localStorage reader for one-time migration"
```

---

### Task 5: Wire `app.js` to IndexedDB (async startup + debounced flush + migration)

Replaces `localStorage` model/project persistence with the in-memory store + IndexedDB flush, and migrates legacy data on first run. Browser-only; verified by `node --check` and the Phase 1 smoke (Task 6).

**Files:**
- Modify: `src/app.js`

**Interfaces:**
- Consumes: `db.js` (`open`, `loadSnapshot`, `putProject`, `deleteProject`, `setMeta`), `legacyMigration.js` (`readLegacy`), the refactored `projectStore.js`.
- Produces: app behavior; no exports consumed by later tasks beyond the existing `{ state, showScreen }`.

- [ ] **Step 1: Update imports and the store wiring in `src/app.js`**

At the top, add imports:

```js
import * as db from './db.js';
import { readLegacy } from './legacyMigration.js';
```

Remove the `const MODEL_KEY = 'dpchecklist.model';` line.

Change the store construction in the `state` object from:

```js
  store: createProjectStore(window.localStorage),
```

to:

```js
  store: createProjectStore({ onChange: onStoreChange }),
```

- [ ] **Step 2: Replace `persistModel`/`restoreModel` with serialize/rebuild + flush in `src/app.js`**

Replace the entire `persistModel` and `restoreModel` functions with:

```js
function serializeModel(model) {
  return {
    items: model.items.map(({ condition, ...rest }) => rest),
    inputs: model.inputs,
    sections: model.sections,
    glossary: model.glossary,
  };
}

function rebuildModel(data) {
  const inputRows = [
    ['Name', 'Type', 'Label', 'Unit', 'Choices', 'Default'],
    ...data.inputs.map(i => [i.name, i.type, i.label, i.unit, i.choices.join(';'), i.default]),
  ];
  const checklistRows = [
    ['Item ID', 'Conditions', 'Description', 'Code', 'Note', 'Example'],
    ...data.items.map(i => [i.id, i.conditionsText, i.description, i.code, i.note, i.exampleFile || i.exampleImage || i.example]),
  ];
  const sectionRows = (data.sections && data.sections.length)
    ? [['Prefix', 'Name'], ...data.sections.map(s => [s.prefix, s.name])]
    : undefined;
  const glossaryRows = (data.glossary && data.glossary.length)
    ? [['Term', 'Meaning'], ...data.glossary.map(g => [g.term, g.meaning])]
    : undefined;
  return buildModel({ checklistRows, inputRows, sectionRows, glossaryRows });
}

// --- Persistence: in-memory edits flushed to IndexedDB (debounced) ----------
const dirty = { model: false, upserts: new Set(), deletes: new Set() };
let flushTimer = null;

function onStoreChange(info) {
  if (info.type === 'delete') { dirty.deletes.add(info.id); dirty.upserts.delete(info.id); }
  else { dirty.upserts.add(info.id); dirty.deletes.delete(info.id); }
  scheduleFlush();
}

function markModelDirty() { dirty.model = true; scheduleFlush(); }

function scheduleFlush() {
  clearTimeout(flushTimer);
  flushTimer = setTimeout(flushToDb, 300);
}

async function flushToDb() {
  try {
    if (dirty.model && state.model) { await db.setMeta('model', serializeModel(state.model)); dirty.model = false; }
    for (const id of [...dirty.deletes]) { await db.deleteProject(id); dirty.deletes.delete(id); }
    for (const id of [...dirty.upserts]) {
      const p = state.store.getProject(id);
      if (p) await db.putProject(p);
      dirty.upserts.delete(id);
    }
    await db.setMeta('savedAt', new Date().toISOString());
  } catch (err) {
    console.error('Persist failed:', err);
  }
}
```

- [ ] **Step 3: Update `handleSetupFile` to mark the model dirty in `src/app.js`**

In `handleSetupFile`, replace:

```js
    state.model = model;
    persistModel(model);
```

with:

```js
    state.model = model;
    markModelDirty();
```

- [ ] **Step 4: Make `init` async with load + migration in `src/app.js`**

Replace the `init()` function definition line and its first line. Change:

```js
function init() {
  state.model = restoreModel();
```

to:

```js
async function init() {
  let snap = { model: null, projects: [], savedAt: null };
  try {
    await db.open();
    snap = await db.loadSnapshot();
    if (!snap.model && snap.projects.length === 0) {
      const legacy = readLegacy(window.localStorage);
      if (legacy.model || legacy.projects.length) {
        if (legacy.model) await db.setMeta('model', legacy.model);
        for (const p of legacy.projects) await db.putProject(p);
        await db.setMeta('savedAt', new Date().toISOString());
        snap = { model: legacy.model, projects: legacy.projects, savedAt: new Date().toISOString() };
      }
    }
  } catch (err) {
    console.error('Storage unavailable, running in-memory for this session:', err);
  }
  state.model = snap.model ? rebuildModel(snap.model) : null;
  state.store.load(snap.projects);
```

(The rest of `init()` — all the `addEventListener` wiring and the final `showScreen(...)` — stays exactly as-is.)

- [ ] **Step 5: Verify parse + suite**

Run: `node --check src/app.js`
Expected: exit 0.
Run: `node --test`
Expected: PASS (42+ tests; app.js isn't imported by node tests).
Run: `grep -n "localStorage" src/app.js`
Expected: only the legacy migration read (`readLegacy(window.localStorage)`) and the theme key remain; no model/project `localStorage` writes.

- [ ] **Step 6: Commit**

```bash
git add src/app.js
git commit -m "feat: persist model + projects in IndexedDB with one-time migration"
```

---

### Task 6: Phase 1 browser smoke test

End-to-end check that projects persist via IndexedDB across a reload, and that legacy `localStorage` data migrates. Uses the headless-Edge CDP harness.

**Files:**
- None committed (throwaway driver lives in the session scratchpad).

- [ ] **Step 1: Persistence across reload**

Serve (`python -m http.server 8123`) and drive Edge headless via CDP (reuse the smoke-driver pattern). Steps:
1. Load the app, import `SampleSetup.zip` (Settings → `#workbook-file`), wait for `#setup-status` to contain "Loaded".
2. Create a project (`#btn-new-project`, answer the prompt), open it, tick one item.
3. Reload the page (`Page.navigate` to the same URL).
4. After reload, evaluate that the dashboard shows the project and `state` restored it from IndexedDB (no `localStorage` model key was written).

Expected: the project and its checked item survive the reload (loaded from IndexedDB).

- [ ] **Step 2: Legacy migration**

In a fresh Edge profile (`--user-data-dir` pointed at a new temp dir), before loading the app, seed `localStorage` via CDP `Page.addScriptToEvaluateOnNewDocument` (or evaluate after first load then reload) with a legacy model + one `dpchecklist.project.<id>` and matching `dpchecklist.projects.index`. Then load the app fresh.

Expected: the seeded project appears on the dashboard and `await db.loadSnapshot()` (evaluated in the page) returns the migrated model + project.

- [ ] **Step 3: Record the result**

No commit (no repo files changed). Capture the observed evidence (project survived reload; migrated project present) in the task report.

---

# Phase 2 — Connected backup file

### Task 7: `librarySnapshot.js` — snapshot build/parse + reconcile

Pure module for the backup file format and the timestamp reconcile rule. TDD with `node:test`.

**Files:**
- Create: `src/librarySnapshot.js`
- Create: `tests/librarySnapshot.test.js`

**Interfaces:**
- Produces:
  - `buildSnapshot(model, projects, savedAt) -> string`
  - `parseSnapshot(text) -> { model, projects, savedAt }`  (throws on wrong/missing type)
  - `chooseNewer(localSavedAt, fileSavedAt) -> 'local' | 'file' | 'equal'`

- [ ] **Step 1: Write failing tests `tests/librarySnapshot.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSnapshot, parseSnapshot, chooseNewer } from '../src/librarySnapshot.js';

test('build then parse round-trips model + projects + savedAt', () => {
  const model = { items: [], inputs: [], sections: [], glossary: [] };
  const projects = [{ id: 'p1', name: 'A', units: [] }];
  const text = buildSnapshot(model, projects, '2026-06-27T10:00:00Z');
  const out = parseSnapshot(text);
  assert.deepEqual(out.model, model);
  assert.deepEqual(out.projects, projects);
  assert.equal(out.savedAt, '2026-06-27T10:00:00Z');
});

test('parseSnapshot rejects a non-library document', () => {
  assert.throws(() => parseSnapshot(JSON.stringify({ type: 'something-else' })));
  assert.throws(() => parseSnapshot('{bad'));
});

test('chooseNewer: file newer, local newer, equal', () => {
  assert.equal(chooseNewer('2026-06-27T10:00:00Z', '2026-06-27T11:00:00Z'), 'file');
  assert.equal(chooseNewer('2026-06-27T12:00:00Z', '2026-06-27T11:00:00Z'), 'local');
  assert.equal(chooseNewer('2026-06-27T10:00:00Z', '2026-06-27T10:00:00Z'), 'equal');
});

test('chooseNewer: ties and missing timestamps prefer the file (never lose the backup)', () => {
  assert.equal(chooseNewer(null, '2026-06-27T10:00:00Z'), 'file');
  assert.equal(chooseNewer('2026-06-27T10:00:00Z', null), 'local');
  assert.equal(chooseNewer(null, null), 'equal');
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/librarySnapshot.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/librarySnapshot.js`**

```js
// The connected-backup file format and the reconcile rule. Pure: no browser APIs.
const TYPE = 'dpchecklist.library';

export function buildSnapshot(model, projects, savedAt) {
  return JSON.stringify({ type: TYPE, version: 1, savedAt, model, projects }, null, 2);
}

export function parseSnapshot(text) {
  const data = JSON.parse(text);
  if (!data || data.type !== TYPE) throw new Error('Not a Smart Checklist backup file');
  return {
    model: data.model || null,
    projects: Array.isArray(data.projects) ? data.projects : [],
    savedAt: data.savedAt || null,
  };
}

// Decide which side is newer. Newer savedAt wins; the file wins exact ties and
// whenever a timestamp is missing on the other side, so a backup is never lost.
export function chooseNewer(localSavedAt, fileSavedAt) {
  const l = localSavedAt ? Date.parse(localSavedAt) : NaN;
  const f = fileSavedAt ? Date.parse(fileSavedAt) : NaN;
  const lOk = !Number.isNaN(l), fOk = !Number.isNaN(f);
  if (!lOk && !fOk) return 'equal';
  if (!lOk) return 'file';
  if (!fOk) return 'local';
  if (f > l) return 'file';
  if (l > f) return 'local';
  return 'equal';
}
```

- [ ] **Step 4: Run the suite**

Run: `node --test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/librarySnapshot.js tests/librarySnapshot.test.js
git commit -m "feat: backup snapshot format + reconcile rule"
```

---

### Task 8: `fileBackup.js` — File System Access wrapper

Thin wrapper over the File System Access API. Browser-only; verified by `node --check` and manual testing (native pickers can't be automated headlessly).

**Files:**
- Create: `src/fileBackup.js`

**Interfaces:**
- Consumes: global `window` (`showSaveFilePicker`, `showOpenFilePicker`).
- Produces:
  - `isSupported() -> boolean`
  - `connect() -> Promise<FileSystemFileHandle|null>` (null if cancelled)
  - `connectExisting() -> Promise<FileSystemFileHandle|null>`
  - `ensurePermission(handle, mode='readwrite') -> Promise<boolean>`
  - `writeSnapshot(handle, text) -> Promise<void>`
  - `readSnapshot(handle) -> Promise<string>`

- [ ] **Step 1: Create `src/fileBackup.js`**

```js
// File System Access wrapper for the connected backup file. No reconcile logic
// (that lives in librarySnapshot.js) and no IndexedDB (the caller persists the
// handle via db.setMeta). Returns null when the user cancels a picker.

export function isSupported() {
  return typeof window !== 'undefined' && 'showSaveFilePicker' in window;
}

export async function connect() {
  try {
    return await window.showSaveFilePicker({
      suggestedName: 'checklist-backup.json',
      types: [{ description: 'Smart Checklist backup', accept: { 'application/json': ['.json'] } }],
    });
  } catch (err) {
    if (err && err.name === 'AbortError') return null;
    throw err;
  }
}

export async function connectExisting() {
  try {
    const [handle] = await window.showOpenFilePicker({
      types: [{ description: 'Smart Checklist backup', accept: { 'application/json': ['.json'] } }],
      multiple: false,
    });
    return handle || null;
  } catch (err) {
    if (err && err.name === 'AbortError') return null;
    throw err;
  }
}

export async function ensurePermission(handle, mode = 'readwrite') {
  const opts = { mode };
  if ((await handle.queryPermission(opts)) === 'granted') return true;
  return (await handle.requestPermission(opts)) === 'granted';
}

export async function writeSnapshot(handle, text) {
  const writable = await handle.createWritable();
  await writable.write(text);
  await writable.close();
}

export async function readSnapshot(handle) {
  const file = await handle.getFile();
  return file.text();
}
```

- [ ] **Step 2: Syntax check**

Run: `node --check src/fileBackup.js`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/fileBackup.js
git commit -m "feat: File System Access wrapper for connected backup"
```

---

### Task 9: Backup UI + auto-save + reconcile-on-reconnect

Wires the backup file into `app.js`: a Settings UI to connect/open/reconnect, debounced snapshot writes, and reconcile on reconnect. Browser-only; verified by `node --check`, the suite, and manual FSA testing in Task 10.

**Files:**
- Modify: `src/app.js`
- Modify: `index.html`
- Modify: `styles.css`

**Interfaces:**
- Consumes: `fileBackup.js`, `librarySnapshot.js` (`buildSnapshot`, `parseSnapshot`, `chooseNewer`), `db.js` (`setMeta`, `getMeta`, `putProject`, `clearProjects`).
- Produces: app behavior.

- [ ] **Step 1: Add the backup UI to `index.html`**

In the Settings screen's "Backup" `setting-row`, replace the existing `btn-row` (the one with "Restore library" + "Save project library") with:

```html
        <div class="btn-row">
          <label class="import-label">Restore library
            <input type="file" id="restore-library-file" accept=".json" hidden />
          </label>
          <button id="btn-save-library" class="btn-primary">Save project library</button>
        </div>
```

Then, immediately AFTER that `setting-row` closes, add a new auto-save row:

```html
      <div class="setting-row" id="autosave-row">
        <div>
          <div class="setting-title">Auto-save to a file</div>
          <div class="muted setting-desc">Connect a backup file (e.g. in OneDrive) and your work
            saves to it automatically, surviving a browser-data wipe. <span id="backup-status"></span></div>
        </div>
        <div class="btn-row" id="backup-controls"></div>
      </div>
```

- [ ] **Step 2: Add backup styles to `styles.css`**

Append:

```css
/* ---- Auto-save / backup status --------------------------------------- */
#backup-status { font-weight: 600; color: var(--text-muted); }
#backup-status.ok { color: var(--accent); }
#backup-status.warn { color: var(--danger); }
```

- [ ] **Step 3: Add backup imports + state to `src/app.js`**

Add imports near the top:

```js
import * as fileBackup from './fileBackup.js';
import { buildSnapshot, parseSnapshot, chooseNewer } from './librarySnapshot.js';
```

Add a backup state object next to the `dirty` declaration:

```js
const backup = { handle: null, savedAt: null };
let fileTimer = null;
```

- [ ] **Step 4: Add the backup engine to `src/app.js`**

Add these functions (near `flushToDb`):

```js
function currentSnapshotText() {
  const projects = state.store.listProjects().map(s => state.store.getProject(s.id)).filter(Boolean);
  backup.savedAt = new Date().toISOString();
  return buildSnapshot(state.model ? serializeModel(state.model) : null, projects, backup.savedAt);
}

function scheduleBackup() {
  if (!backup.handle) return;
  clearTimeout(fileTimer);
  fileTimer = setTimeout(writeBackup, 1000);
}

async function writeBackup() {
  if (!backup.handle) return;
  try {
    if (!(await fileBackup.ensurePermission(backup.handle, 'readwrite'))) { setBackupStatus('reconnect needed', 'warn'); return; }
    await fileBackup.writeSnapshot(backup.handle, currentSnapshotText());
    setBackupStatus('saved ✓', 'ok');
  } catch (err) {
    console.error('Backup write failed:', err);
    setBackupStatus('auto-save paused — reconnect', 'warn');
  }
}

function setBackupStatus(text, kind) {
  const el = document.getElementById('backup-status');
  if (!el) return;
  el.textContent = text ? '· ' + text : '';
  el.className = kind || '';
}

// Load a parsed snapshot into memory + IndexedDB (used by reconcile/recovery).
async function applySnapshot(snap) {
  await db.clearProjects();
  state.store.load(snap.projects);
  for (const p of snap.projects) await db.putProject(p);
  if (snap.model) { await db.setMeta('model', snap.model); state.model = rebuildModel(snap.model); }
  await db.setMeta('savedAt', snap.savedAt || new Date().toISOString());
}

async function reconcileWithFile() {
  const text = await fileBackup.readSnapshot(backup.handle);
  let fileSnap = null;
  try { fileSnap = parseSnapshot(text); } catch { fileSnap = null; }
  const localSavedAt = await db.getMeta('savedAt');
  if (!fileSnap) { await writeBackup(); return; } // empty/new file: seed it
  const winner = chooseNewer(localSavedAt, fileSnap.savedAt);
  if (winner === 'file') { await applySnapshot(fileSnap); renderDashboard(); }
  else if (winner === 'local') { await writeBackup(); }
}
```

- [ ] **Step 5: Connect `scheduleBackup` to changes and render the controls in `src/app.js`**

In `scheduleFlush`, add a `scheduleBackup()` call so file writes ride along with IndexedDB flushes:

```js
function scheduleFlush() {
  clearTimeout(flushTimer);
  flushTimer = setTimeout(flushToDb, 300);
  scheduleBackup();
}
```

Add a function to render the backup controls based on state, and call it from `init`:

```js
function renderBackupControls() {
  const row = document.getElementById('autosave-row');
  const controls = document.getElementById('backup-controls');
  if (!fileBackup.isSupported()) {
    controls.innerHTML = '';
    setBackupStatus('not available in this browser — use Save/Restore above', '');
    return;
  }
  controls.innerHTML = backup.handle
    ? `<button id="btn-disconnect-backup" class="btn-sm">Disconnect</button>`
    : `<button id="btn-open-backup" class="btn-sm">Open existing backup…</button>` +
      `<button id="btn-connect-backup" class="btn-primary">Back up to a file…</button>`;
  if (backup.handle) {
    document.getElementById('btn-disconnect-backup').addEventListener('click', async () => {
      backup.handle = null; await db.setMeta('backupHandle', null); setBackupStatus('disconnected', ''); renderBackupControls();
    });
  } else {
    document.getElementById('btn-connect-backup').addEventListener('click', async () => {
      const handle = await fileBackup.connect();
      if (!handle) return;
      backup.handle = handle; await db.setMeta('backupHandle', handle);
      await writeBackup(); renderBackupControls();
    });
    document.getElementById('btn-open-backup').addEventListener('click', async () => {
      const handle = await fileBackup.connectExisting();
      if (!handle) return;
      backup.handle = handle; await db.setMeta('backupHandle', handle);
      try { await reconcileWithFile(); } catch (err) { setBackupStatus('could not read file', 'warn'); }
      renderBackupControls();
    });
  }
}
```

- [ ] **Step 6: Restore a stored handle on startup + offer reconnect in `src/app.js`**

At the end of `init()` (just before `showScreen(...)`), add:

```js
  try {
    const storedHandle = await db.getMeta('backupHandle');
    if (storedHandle && fileBackup.isSupported()) {
      backup.handle = storedHandle;
      setBackupStatus('reconnect to resume auto-save', 'warn');
    }
  } catch { /* no stored handle */ }
  renderBackupControls();
  if (backup.handle) {
    // Permission must be re-granted with a user gesture; expose a one-click reconnect.
    const controls = document.getElementById('backup-controls');
    controls.insertAdjacentHTML('afterbegin', `<button id="btn-reconnect-backup" class="btn-primary">Reconnect backup</button>`);
    document.getElementById('btn-reconnect-backup').addEventListener('click', async () => {
      if (!(await fileBackup.ensurePermission(backup.handle, 'readwrite'))) { setBackupStatus('permission denied', 'warn'); return; }
      try { await reconcileWithFile(); setBackupStatus('saved ✓', 'ok'); renderBackupControls(); }
      catch (err) { setBackupStatus('could not read file', 'warn'); }
    });
  }
```

- [ ] **Step 7: Verify parse + suite**

Run: `node --check src/app.js`
Expected: exit 0.
Run: `node --test`
Expected: PASS (all pure tests unaffected).

- [ ] **Step 8: Commit**

```bash
git add src/app.js index.html styles.css
git commit -m "feat: connected backup file with auto-save and reconcile"
```

---

### Task 10: Manual FSA verification + README

Verify the File System Access flow by hand (it can't be automated headlessly) and document the feature.

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Manual FSA walkthrough (Edge/Chrome)**

Serve the app (`python -m http.server 8000`) and open it in Edge. Then:
1. Import a setup ZIP and create a project; tick an item.
2. Settings → "Back up to a file…" → save `checklist-backup.json` to a folder. Confirm `#backup-status` shows "saved ✓" and the file exists on disk with a `dpchecklist.library` JSON snapshot.
3. Make another change; confirm the file's `savedAt` advances within ~1–2 s.
4. Reload the page → Settings shows "Reconnect backup"; click it, grant permission; confirm it reconciles (no data lost) and resumes "saved ✓".
5. Simulate recovery: open the app in a fresh browser profile (empty), Settings → "Open existing backup…" → pick the file → confirm the project reappears.

Expected: each step behaves as described; record the observed outcomes in the task report. (No automated test — native pickers require user gestures.)

- [ ] **Step 2: Update `README.md`**

Under "First use" (or a new short "Backups" subsection after it), add:

```markdown
### Backups & durability

Your projects are stored in your browser. To make them durable, open **Settings**
and use **Auto-save to a file** (Edge/Chrome): pick a backup file — ideally inside
a synced folder like OneDrive — and the app writes your work to it automatically.
After a browser-data wipe or on a new machine, **Settings → Open existing backup…**
restores everything (re-import your setup ZIP to bring back the example images).
In browsers without this feature, use the manual **Save project library** /
**Restore library** buttons.
```

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: document auto-save backups and durability"
```

---

## Self-Review

**Spec coverage:**
- Unified IndexedDB schema (`examples`/`projects`/`kv`, v2) → Task 1. ✓
- exampleStore uses shared connection → Task 2. ✓
- In-memory working set + synchronous UI + onChange → Task 3. ✓
- Debounced flush to IndexedDB → Task 5 (`flushToDb`, `scheduleFlush`). ✓
- One-time localStorage→IndexedDB migration → Task 4 (`readLegacy`) + Task 5 (`init`). ✓
- Snapshot format + reconcile rule → Task 7. ✓
- File System Access wrapper → Task 8. ✓
- Connect / open-existing / reconnect / auto-save / reconcile + graceful fallback → Task 9. ✓
- Wipe-recovery via "Open existing backup…" → Task 9 (`connectExisting` + `reconcileWithFile`). ✓
- Error handling (unsupported, cancelled, permission lost, IDB failure) → Task 8 (AbortError→null), Task 9 (`writeBackup`/`renderBackupControls` status), Task 5 (`init` try/catch). ✓
- Manual FSA verification + docs → Task 10. ✓
- Testing: pure unit tests (Tasks 3,4,7), browser smoke (Task 6), manual FSA (Task 10). ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code. ✓

**Type consistency:**
- `db.js` exports (`open`, `loadSnapshot`, `putProject`, `deleteProject`, `clearProjects`, `setMeta`, `getMeta`) are used with matching names/arity in Tasks 2, 5, 9. ✓
- `createProjectStore({ onChange })` + `onChange({type,id})` defined in Task 3 and consumed in Task 5 (`onStoreChange`). ✓
- `readLegacy(storage) -> {model, projects}` defined in Task 4, used in Task 5. ✓
- `buildSnapshot/parseSnapshot/chooseNewer` defined in Task 7, used in Task 9. ✓
- `fileBackup` API (`isSupported/connect/connectExisting/ensurePermission/writeSnapshot/readSnapshot`) defined in Task 8, used in Task 9. ✓
- `serializeModel`/`rebuildModel` defined in Task 5, used in Task 9 (`currentSnapshotText`, `applySnapshot`). ✓
