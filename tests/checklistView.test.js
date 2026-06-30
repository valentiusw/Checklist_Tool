import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildModel } from '../src/workbookModel.js';
import { itemApplicableUnits } from '../src/checklistView.js';

const inputRows = [
  ['Name', 'Type', 'Label', 'Unit', 'Choices', 'Default'],
  ['PitToEarth', 'Boolean', 'Pit', '', '', 'FALSE'],
  ['MaxFFLInt', 'Float', 'FFL', 'm', '', '0'],
];
const checklistRows = [
  ['Item ID', 'Conditions', 'Description', 'Code', 'Note', 'Example'],
  ['A08', '', 'Always', 'AS3000', '', ''],
  ['A10', 'PitToEarth: FALSE', 'No pit', 'EN81', '', ''],
  ['A11', 'MaxFFLInt: >11', 'Tall', 'RDM', '', ''],
];
const model = buildModel({ checklistRows, inputRows });
const item = id => model.items.find(i => i.id === id);
const project = {
  units: [
    { id: 'u1', name: 'U1', inputs: { PitToEarth: false, MaxFFLInt: 5 }, checks: {}, comments: {} },
    { id: 'u2', name: 'U2', inputs: { PitToEarth: true, MaxFFLInt: 12 }, checks: {}, comments: {} },
  ],
};

test('itemApplicableUnits: always-applies item matches every unit', () => {
  assert.deepEqual(itemApplicableUnits(model, project, item('A08')).map(u => u.id), ['u1', 'u2']);
});

test('itemApplicableUnits: condition filters units', () => {
  assert.deepEqual(itemApplicableUnits(model, project, item('A10')).map(u => u.id), ['u1']);
  assert.deepEqual(itemApplicableUnits(model, project, item('A11')).map(u => u.id), ['u2']);
});

test('itemApplicableUnits: no matching unit returns empty', () => {
  const p = { units: [{ id: 'x', name: 'X', inputs: { PitToEarth: true, MaxFFLInt: 0 }, checks: {}, comments: {} }] };
  assert.deepEqual(itemApplicableUnits(model, p, item('A11')), []);
});
