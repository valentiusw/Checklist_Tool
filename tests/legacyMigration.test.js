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
