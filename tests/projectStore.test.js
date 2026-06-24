import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProjectStore } from '../src/projectStore.js';

function memStorage() {
  const map = new Map();
  return {
    getItem: k => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: k => map.delete(k),
  };
}

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
