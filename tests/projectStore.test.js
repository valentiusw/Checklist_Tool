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

test('create, list, get a project', () => {
  const store = createProjectStore(memStorage());
  const p = store.createProject('Tower A');
  assert.ok(p.id);
  assert.equal(p.name, 'Tower A');
  assert.deepEqual(store.listProjects().map(s => s.name), ['Tower A']);
  assert.equal(store.getProject(p.id).name, 'Tower A');
});

test('save updates fields and updatedAt', () => {
  const store = createProjectStore(memStorage());
  const p = store.createProject('Tower A');
  p.inputs = { MaxFFLInt: 12 };
  p.checks = { A10: true };
  p.comments = { A10: 'done on site' };
  store.saveProject(p);
  const reloaded = store.getProject(p.id);
  assert.deepEqual(reloaded.inputs, { MaxFFLInt: 12 });
  assert.equal(reloaded.checks.A10, true);
  assert.equal(reloaded.comments.A10, 'done on site');
});

test('delete removes the project', () => {
  const store = createProjectStore(memStorage());
  const p = store.createProject('Tower A');
  store.deleteProject(p.id);
  assert.equal(store.getProject(p.id), null);
  assert.equal(store.listProjects().length, 0);
});

test('serialize then import yields an equal project with a new id', () => {
  const store = createProjectStore(memStorage());
  const p = store.createProject('Tower A');
  p.checks = { A10: true };
  store.saveProject(p);
  const json = store.serializeProject(p);
  const imported = store.importProject(json);
  assert.notEqual(imported.id, p.id);
  assert.equal(imported.name, 'Tower A');
  assert.deepEqual(imported.checks, { A10: true });
  assert.equal(store.listProjects().length, 2);
});

test('importProject rejects malformed JSON', () => {
  const store = createProjectStore(memStorage());
  assert.throws(() => store.importProject('{not json'));
});
