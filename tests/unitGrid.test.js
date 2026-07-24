import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coerceInputValue, UNCHANGED, parseClipboardMatrix } from '../src/unitGrid.js';

const boolDef = { name: 'Pit', type: 'Boolean', choices: [] };
const intDef = { name: 'Stops', type: 'Integer', choices: [] };
const floatDef = { name: 'Load', type: 'Float', choices: [] };
const choiceDef = { name: 'Door', type: 'Choice', choices: ['Centre', 'Side'] };

test('coerceInputValue: Boolean truthy synonyms → true', () => {
  for (const raw of ['true', 'TRUE', 'Yes', 'y', '1', '✓', 'x']) {
    assert.equal(coerceInputValue(boolDef, raw), true, `"${raw}" should be true`);
  }
});

test('coerceInputValue: Boolean falsy synonyms and blank → false', () => {
  for (const raw of ['false', 'No', 'n', '0', '']) {
    assert.equal(coerceInputValue(boolDef, raw), false, `"${raw}" should be false`);
  }
});

test('coerceInputValue: Boolean garbage → UNCHANGED', () => {
  assert.equal(coerceInputValue(boolDef, 'maybe'), UNCHANGED);
});

test('coerceInputValue: Integer parses and rounds', () => {
  assert.equal(coerceInputValue(intDef, '3'), 3);
  assert.equal(coerceInputValue(intDef, '3.7'), 4);
});

test('coerceInputValue: Float parses', () => {
  assert.equal(coerceInputValue(floatDef, '1000.5'), 1000.5);
});

test('coerceInputValue: numeric empty string stays empty', () => {
  assert.equal(coerceInputValue(intDef, ''), '');
});

test('coerceInputValue: non-numeric number cell → UNCHANGED', () => {
  assert.equal(coerceInputValue(intDef, 'abc'), UNCHANGED);
});

test('coerceInputValue: Choice matches case-insensitively to canonical', () => {
  assert.equal(coerceInputValue(choiceDef, 'side'), 'Side');
  assert.equal(coerceInputValue(choiceDef, 'CENTRE'), 'Centre');
});

test('coerceInputValue: Choice no-match → UNCHANGED', () => {
  assert.equal(coerceInputValue(choiceDef, 'Diagonal'), UNCHANGED);
});

test('parseClipboardMatrix: LF rows and tab columns', () => {
  assert.deepEqual(
    parseClipboardMatrix('a\tb\nc\td'),
    [['a', 'b'], ['c', 'd']],
  );
});

test('parseClipboardMatrix: CRLF normalised', () => {
  assert.deepEqual(
    parseClipboardMatrix('a\tb\r\nc\td'),
    [['a', 'b'], ['c', 'd']],
  );
});

test('parseClipboardMatrix: single trailing newline dropped', () => {
  assert.deepEqual(parseClipboardMatrix('a\tb\n'), [['a', 'b']]);
});

test('parseClipboardMatrix: single cell', () => {
  assert.deepEqual(parseClipboardMatrix('hello'), [['hello']]);
});
