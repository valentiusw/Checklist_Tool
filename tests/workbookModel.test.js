import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildModel, ModelError } from '../src/workbookModel.js';

const inputRows = [
  ['Name', 'Type', 'Label', 'Unit', 'Choices', 'Default'],
  ['PitToEarth', 'Boolean', 'Pit is to solid earth', '', '', 'FALSE'],
  ['MaxFFLInt', 'Float', 'Max internal FFL height', 'm', '', '0'],
  ['BuildingClass', 'Choice', 'Building classification', '', 'Class 2;Class 3;Class 9b', ''],
];
const checklistRows = [
  ['Item ID', 'Conditions', 'Description', 'Code', 'Note', 'Example'],
  ['A08', '', 'Lifts not exposed to weather', 'AS3000', 'Protect from moisture', 'Seal the enclosure'],
  ['A10', 'PitToEarth: FALSE', 'CWT safety device', 'EN81-20', '', 'Fit device X'],
];

test('builds inputs with parsed choices and defaults', () => {
  const model = buildModel({ checklistRows, inputRows });
  assert.equal(model.inputs.length, 3);
  const bc = model.inputDefs.BuildingClass;
  assert.deepEqual(bc.choices, ['Class 2', 'Class 3', 'Class 9b']);
  assert.equal(model.inputDefs.MaxFFLInt.unit, 'm');
});

test('builds items; empty condition -> null', () => {
  const model = buildModel({ checklistRows, inputRows });
  assert.equal(model.items[0].id, 'A08');
  assert.equal(model.items[0].condition, null);
  assert.equal(model.items[1].condition.type, 'CMP');
  assert.equal(model.items[1].example, 'Fit device X');
});

test('missing column throws ModelError naming it', () => {
  const bad = [['Item ID', 'Conditions', 'Description', 'Code', 'Note']]; // no Example
  assert.throws(() => buildModel({ checklistRows: bad, inputRows }), /Example/);
});

test('invalid input type throws ModelError', () => {
  const badInputs = [
    ['Name', 'Type', 'Label', 'Unit', 'Choices', 'Default'],
    ['X', 'Text', 'x', '', '', ''],
  ];
  assert.throws(() => buildModel({ checklistRows, inputRows: badInputs }), ModelError);
});

test('condition referencing unknown input throws ModelError', () => {
  const badChecklist = [
    ['Item ID', 'Conditions', 'Description', 'Code', 'Note', 'Example'],
    ['A99', 'Ghost: TRUE', 'x', '', '', ''],
  ];
  assert.throws(() => buildModel({ checklistRows: badChecklist, inputRows }), ModelError);
});
