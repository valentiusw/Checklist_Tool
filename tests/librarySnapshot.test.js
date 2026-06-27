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
  assert.equal(chooseNewer('2026-06-27T10:00:00Z', '2026-06-27T10:00:00Z'), 'file');
});

test('chooseNewer: ties and missing timestamps prefer the file (never lose the backup)', () => {
  assert.equal(chooseNewer(null, '2026-06-27T10:00:00Z'), 'file');
  assert.equal(chooseNewer('2026-06-27T10:00:00Z', null), 'local');
  assert.equal(chooseNewer(null, null), 'equal');
});

test('chooseNewer: an invalid timestamp on one side defers to the valid side', () => {
  assert.equal(chooseNewer('not-a-date', '2026-06-27T10:00:00Z'), 'file');
  assert.equal(chooseNewer('2026-06-27T10:00:00Z', 'not-a-date'), 'local');
  assert.equal(chooseNewer('not-a-date', 'also-bad'), 'equal');
});
