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

test('mutating a seed object after load does not corrupt the store', () => {
  const store = createProjectStore();
  const seed = { id: 'p1', name: 'Original', units: [{ id: 'u', name: 'U', inputs: {}, checks: {}, comments: {} }] };
  store.load([seed]);
  seed.name = 'Mutated';
  assert.equal(store.getProject('p1').name, 'Original');
});
