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

test('setPinned sets and clears the flag without bumping updatedAt', () => {
  const store = createProjectStore();
  store.load([{ id: 'p1', name: 'A', updatedAt: '2026-01-01T00:00:00Z',
    units: [{ id: 'u', name: 'U', inputs: {}, checks: {}, comments: {} }] }]);
  store.setPinned('p1', true);
  let p = store.getProject('p1');
  assert.equal(p.pinned, true);
  assert.equal(p.updatedAt, '2026-01-01T00:00:00Z'); // unchanged
  store.setPinned('p1', false);
  p = store.getProject('p1');
  assert.ok(!p.pinned);
  assert.equal(p.updatedAt, '2026-01-01T00:00:00Z');
});

test('setPinned is a no-op for unknown ids and fires no event', () => {
  const events = [];
  const store = createProjectStore({ onChange: e => events.push(e) });
  store.setPinned('nope', true);
  assert.deepEqual(events, []);
});

test('listProjects surfaces pinned as a boolean', () => {
  const store = createProjectStore();
  store.load([
    { id: 'a', name: 'A', updatedAt: '2026-02-01T00:00:00Z', pinned: true, units: [] },
    { id: 'b', name: 'B', updatedAt: '2026-01-01T00:00:00Z', units: [] },
  ]);
  const byId = Object.fromEntries(store.listProjects().map(p => [p.id, p.pinned]));
  assert.equal(byId.a, true);
  assert.equal(byId.b, false);
});

test('setPinned appends a pinnedOrder to the bottom, surfaced by listProjects', () => {
  const store = createProjectStore();
  store.load([
    { id: 'a', name: 'A', updatedAt: '2026-01-01T00:00:00Z', units: [] },
    { id: 'b', name: 'B', updatedAt: '2026-01-02T00:00:00Z', units: [] },
  ]);
  store.setPinned('a', true);
  store.setPinned('b', true);
  const byId = Object.fromEntries(store.listProjects().map(p => [p.id, p.pinnedOrder]));
  assert.equal(byId.a, 0); // first pinned lands at the bottom of an empty list → 0
  assert.equal(byId.b, 1); // next pinned appends below
});

test('setPinned(false) clears both pinned and pinnedOrder', () => {
  const store = createProjectStore();
  store.load([{ id: 'a', name: 'A', updatedAt: '2026-01-01T00:00:00Z', units: [] }]);
  store.setPinned('a', true);
  store.setPinned('a', false);
  const p = store.getProject('a');
  assert.ok(!p.pinned);
  assert.equal(p.pinnedOrder, undefined);
});

test('reorderPinned reassigns pinnedOrder by index without bumping updatedAt', () => {
  const store = createProjectStore();
  store.load([
    { id: 'a', name: 'A', updatedAt: '2026-01-01T00:00:00Z', pinned: true, pinnedOrder: 0, units: [] },
    { id: 'b', name: 'B', updatedAt: '2026-01-02T00:00:00Z', pinned: true, pinnedOrder: 1, units: [] },
    { id: 'c', name: 'C', updatedAt: '2026-01-03T00:00:00Z', pinned: true, pinnedOrder: 2, units: [] },
  ]);
  store.reorderPinned(['c', 'a', 'b']);
  const byId = Object.fromEntries(store.listProjects().map(p => [p.id, p.pinnedOrder]));
  assert.equal(byId.c, 0);
  assert.equal(byId.a, 1);
  assert.equal(byId.b, 2);
  assert.equal(store.getProject('a').updatedAt, '2026-01-01T00:00:00Z'); // unchanged
});

test('reorderPinned ignores unknown or unpinned ids', () => {
  const store = createProjectStore();
  store.load([
    { id: 'a', name: 'A', updatedAt: '2026-01-01T00:00:00Z', pinned: true, pinnedOrder: 0, units: [] },
    { id: 'b', name: 'B', updatedAt: '2026-01-02T00:00:00Z', units: [] }, // not pinned
  ]);
  store.reorderPinned(['nope', 'b', 'a']); // unknown + unpinned skipped; 'a' takes the next slot
  assert.equal(store.getProject('a').pinnedOrder, 0);
  assert.ok(!store.getProject('b').pinned);
});
