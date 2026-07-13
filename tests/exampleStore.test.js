import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeExampleKey } from '../src/exampleStore.js';

// Example files are keyed by filename, but the ZIP's actual filenames and the
// workbook's Example-column spelling are maintained independently (and on a
// case-insensitive Windows filesystem). Normalizing both sides lets a lookup
// succeed despite case, path-prefix, or whitespace differences.

test('lowercases so .PNG on disk matches .png in the workbook', () => {
  assert.equal(normalizeExampleKey('AS1735_LOP.PNG'), normalizeExampleKey('AS1735_LOP.png'));
});

test('strips any directory prefix down to the bare filename', () => {
  assert.equal(normalizeExampleKey('Examples/Photo.png'), normalizeExampleKey('Photo.png'));
  assert.equal(normalizeExampleKey('Examples\\Photo.png'), normalizeExampleKey('Photo.png'));
});

test('trims surrounding whitespace', () => {
  assert.equal(normalizeExampleKey('RedundancyStatement.pdf '), normalizeExampleKey('RedundancyStatement.pdf'));
});

test('empty / nullish names normalize to an empty string', () => {
  assert.equal(normalizeExampleKey(''), '');
  assert.equal(normalizeExampleKey(undefined), '');
  assert.equal(normalizeExampleKey(null), '');
});
