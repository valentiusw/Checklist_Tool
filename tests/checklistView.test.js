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

import { itemCheckState, unifiedItems } from '../src/checklistView.js';

test('itemCheckState: none / some / all', () => {
  const i = item('A08');
  const u1 = { id: 'u1', checks: {} };
  const u2 = { id: 'u2', checks: {} };
  assert.equal(itemCheckState(i, [u1, u2]), 'none');
  u1.checks.A08 = true;
  assert.equal(itemCheckState(i, [u1, u2]), 'some');
  u2.checks.A08 = true;
  assert.equal(itemCheckState(i, [u1, u2]), 'all');
});

test('itemCheckState: empty applicable set is none', () => {
  assert.equal(itemCheckState(item('A08'), []), 'none');
});

test('unifiedItems: items applicable to >=1 unit, in model order', () => {
  // project: u1 (no pit, short) -> A08,A10 ; u2 (pit, tall) -> A08,A11
  assert.deepEqual(unifiedItems(model, project).map(i => i.id), ['A08', 'A10', 'A11']);
  // a project where no unit is tall drops A11
  const shortOnly = { units: [{ id: 'u1', name: 'U1', inputs: { PitToEarth: false, MaxFFLInt: 5 }, checks: {}, comments: {} }] };
  assert.deepEqual(unifiedItems(model, shortOnly).map(i => i.id), ['A08', 'A10']);
});
