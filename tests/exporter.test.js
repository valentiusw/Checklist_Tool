import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildModel } from '../src/workbookModel.js';
import { applicableItems, computeProgress, computeProjectProgress, buildExportRows } from '../src/exporter.js';

const inputRows = [
  ['Name', 'Type', 'Label', 'Unit', 'Choices', 'Default'],
  ['PitToEarth', 'Boolean', 'Pit', '', '', 'FALSE'],
  ['MaxFFLInt', 'Float', 'FFL', 'm', '', '0'],
];
const checklistRows = [
  ['Item ID', 'Conditions', 'Description', 'Code', 'Note', 'Example'],
  ['A08', '', 'Always applies', 'AS3000', 'note8', 'ex8'],
  ['A10', 'PitToEarth: FALSE', 'CWT device', 'EN81-20', 'note10', 'ex10'],
  ['A11', 'MaxFFLInt: >11', 'Emergency doors', 'RDM', 'note11', 'ex11'],
];
const model = buildModel({ checklistRows, inputRows });

test('applicableItems filters by condition', () => {
  const ids = applicableItems(model, { PitToEarth: false, MaxFFLInt: 5 }).map(i => i.id);
  assert.deepEqual(ids, ['A08', 'A10']);
});

test('computeProgress = checked / applicable', () => {
  const project = { inputs: { PitToEarth: false, MaxFFLInt: 5 }, checks: { A08: true }, comments: {} };
  const p = computeProgress(model, project);
  assert.deepEqual(p, { checked: 1, applicable: 2, ratio: 0.5 });
});

test('computeProgress ratio is 0 when none applicable', () => {
  const project = { inputs: { PitToEarth: true, MaxFFLInt: 0 }, checks: {}, comments: {} };
  // Only A08 always applies, so applicable=1 here; force a no-applicable model instead:
  const emptyModel = buildModel({
    checklistRows: [checklistRows[0], ['Z1', 'MaxFFLInt: >999', 'x', '', '', '']],
    inputRows,
  });
  const p = computeProgress(emptyModel, { inputs: { MaxFFLInt: 0 }, checks: {}, comments: {} });
  assert.equal(p.applicable, 0);
  assert.equal(p.ratio, 0);
});

test('buildExportRows lists applicable unchecked items with header', () => {
  const project = {
    inputs: { PitToEarth: false, MaxFFLInt: 12 },
    checks: { A08: true },
    comments: { A10: 'pending part' },
  };
  const rows = buildExportRows(model, project);
  assert.deepEqual(rows[0], ['Item ID', 'Description', 'Code', 'Comments', 'Example']);
  const ids = rows.slice(1).map(r => r[0]);
  assert.deepEqual(ids, ['A10', 'A11']); // A08 checked -> excluded
  assert.equal(rows[1][3], 'pending part'); // Comments column
  assert.equal(rows[1][4], 'ex10'); // Example column
});

test('computeProjectProgress sums across units', () => {
  const project = {
    units: [
      { inputs: { PitToEarth: false, MaxFFLInt: 5 }, checks: { A08: true }, comments: {} },
      { inputs: { PitToEarth: false, MaxFFLInt: 5 }, checks: {}, comments: {} },
    ],
  };
  const p = computeProjectProgress(model, project);
  // Each unit: A08 + A10 applicable (2 each) -> applicable 4; checked 1 (unit 1 A08).
  assert.equal(p.applicable, 4);
  assert.equal(p.checked, 1);
  assert.equal(p.ratio, 0.25);
});
