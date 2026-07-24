import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coerceInputValue, UNCHANGED, parseClipboardMatrix } from '../src/unitGrid.js';
import { applyPasteMatrix } from '../src/unitGrid.js';

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

const model = {
  inputs: [
    { name: 'Pit', type: 'Boolean', choices: [] },
    { name: 'Stops', type: 'Integer', choices: [] },
    { name: 'Door', type: 'Choice', choices: ['Centre', 'Side'] },
  ],
};
const makeUnit = (i) => ({ name: 'Unit ' + (i + 1), inputs: { Pit: false, Stops: 0, Door: 'Centre' } });
const seed = () => [{ name: 'A', inputs: { Pit: false, Stops: 1, Door: 'Centre' } }];

test('applyPasteMatrix: fills a row starting at the name column', () => {
  const out = applyPasteMatrix({
    units: seed(), model, startRow: 0, startCol: 0,
    matrix: [['Tower', 'yes', '5', 'Side']], makeUnit,
  });
  assert.equal(out.length, 1);
  assert.deepEqual(out[0], { name: 'Tower', inputs: { Pit: true, Stops: 5, Door: 'Side' } });
});

test('applyPasteMatrix: rows past the end create units', () => {
  const out = applyPasteMatrix({
    units: seed(), model, startRow: 1, startCol: 0,
    matrix: [['B', 'no', '2', 'Centre'], ['C', 'yes', '3', 'Side']], makeUnit,
  });
  assert.equal(out.length, 3);
  assert.equal(out[1].name, 'B');
  assert.equal(out[2].name, 'C');
  assert.equal(out[2].inputs.Stops, 3);
});

test('applyPasteMatrix: columns past the last input are ignored', () => {
  const out = applyPasteMatrix({
    units: seed(), model, startRow: 0, startCol: 0,
    matrix: [['X', 'yes', '9', 'Side', 'EXTRA', 'MORE']], makeUnit,
  });
  assert.equal(out[0].name, 'X');
  assert.equal(out[0].inputs.Door, 'Side');
});

test('applyPasteMatrix: starts at a non-zero column', () => {
  const out = applyPasteMatrix({
    units: seed(), model, startRow: 0, startCol: 2, // Stops column
    matrix: [['7', 'Side']], makeUnit,
  });
  assert.equal(out[0].name, 'A');           // name untouched
  assert.equal(out[0].inputs.Stops, 7);
  assert.equal(out[0].inputs.Door, 'Side');
});

test('applyPasteMatrix: uninterpretable cells leave existing values', () => {
  const out = applyPasteMatrix({
    units: seed(), model, startRow: 0, startCol: 1, // Pit column
    matrix: [['maybe']], makeUnit,                  // Boolean garbage → UNCHANGED
  });
  assert.equal(out[0].inputs.Pit, false); // unchanged from seed
});
