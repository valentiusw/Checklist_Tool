import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildModel } from '../src/workbookModel.js';
import { applicableItems, computeProgress, computeProjectProgress, buildExportRows, buildExportPlan } from '../src/exporter.js';

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

test('buildExportPlan returns per-unit outstanding rows', () => {
  const rows = [
    ['Item ID', 'Conditions', 'Description', 'Code', 'Note', 'Example'],
    ['A08', '', 'Always applies', 'AS3000', '', 'a08.png'],
    ['A10', '', 'Second item', 'EN81', '', 'Prose guidance'],
  ];
  const m = buildModel({ checklistRows: rows, inputRows });
  const project = {
    units: [
      { name: 'Lift 1', inputs: {}, checks: { A08: true }, comments: { A10: 'note' } },
      { name: 'Lift 2', inputs: {}, checks: {}, comments: {} },
    ],
  };
  const plan = buildExportPlan(m, project);
  assert.equal(plan.units.length, 2);
  // Unit 1: A08 checked -> only A10 outstanding (prose, no file)
  assert.deepEqual(plan.units[0].rows.map(r => r.id), ['A10']);
  assert.equal(plan.units[0].rows[0].comment, 'note');
  assert.equal(plan.units[0].rows[0].exampleFile, '');
  assert.equal(plan.units[0].rows[0].example, 'Prose guidance');
  // Unit 2: nothing checked -> A08 (file) + A10 (prose)
  assert.deepEqual(plan.units[1].rows.map(r => r.id), ['A08', 'A10']);
  assert.equal(plan.units[1].rows[0].exampleFile, 'a08.png');
});

test('buildExportPlan excludes items whose ID starts with S (Schindler)', () => {
  const rows = [
    ['Item ID', 'Conditions', 'Description', 'Code', 'Note', 'Example'],
    ['A08', '', 'Keep me', 'AS3000', '', 'a08.png'],
    ['S01', '', 'Schindler item', 'SL', '', 's01.png'],
    ['S12', '', 'Another Schindler', 'SL', '', 'Prose'],
  ];
  const m = buildModel({ checklistRows: rows, inputRows });
  const project = { units: [{ name: 'U', inputs: {}, checks: {}, comments: {} }] };
  const plan = buildExportPlan(m, project);
  assert.deepEqual(plan.units[0].rows.map(r => r.id), ['A08']);
  assert.deepEqual(plan.referencedFiles, ['a08.png']);
});

test('buildExportPlan collects referenced files once, in order', () => {
  const rows = [
    ['Item ID', 'Conditions', 'Description', 'Code', 'Note', 'Example'],
    ['A08', '', 'Item', 'AS3000', '', 'a08.png'],
    ['A09', '', 'Item', 'AS3000', '', 'a09.pdf'],
    ['A10', '', 'Item', 'AS3000', '', 'a08.png'],
  ];
  const m = buildModel({ checklistRows: rows, inputRows });
  const project = { units: [{ name: 'U', inputs: {}, checks: {}, comments: {} }] };
  const plan = buildExportPlan(m, project);
  assert.deepEqual(plan.referencedFiles, ['a08.png', 'a09.pdf']);
});

test('buildExportPlan full mode marks per-unit status (done/outstanding/na)', () => {
  const rows = [
    ['Item ID', 'Conditions', 'Description', 'Code', 'Note', 'Example'],
    ['A08', '', 'Always', 'AS3000', '', 'a08.png'],
    ['A10', 'PitToEarth: FALSE', 'Cond item', 'EN81', '', ''],
  ];
  const m = buildModel({ checklistRows: rows, inputRows });
  const project = { units: [
    { name: 'U1', inputs: { PitToEarth: false }, checks: { A08: true }, comments: {} },
    { name: 'U2', inputs: { PitToEarth: true }, checks: {}, comments: {} },
  ] };
  const plan = buildExportPlan(m, project, { mode: 'full' });
  const u1 = Object.fromEntries(plan.units[0].rows.map(r => [r.id, r.status]));
  assert.deepEqual(u1, { A08: 'done', A10: 'outstanding' });
  const u2 = Object.fromEntries(plan.units[1].rows.map(r => [r.id, r.status]));
  assert.deepEqual(u2, { A08: 'outstanding', A10: 'na' });
});

test('buildExportPlan full mode includes S-items; outstanding excludes them', () => {
  const rows = [
    ['Item ID', 'Conditions', 'Description', 'Code', 'Note', 'Example'],
    ['A08', '', 'Keep', 'AS3000', '', 'a08.png'],
    ['S01', '', 'Schindler', 'SL', '', 's01.png'],
  ];
  const m = buildModel({ checklistRows: rows, inputRows });
  const project = { units: [{ name: 'U', inputs: {}, checks: {}, comments: {} }] };
  const full = buildExportPlan(m, project, { mode: 'full' });
  assert.deepEqual(full.units[0].rows.map(r => r.id), ['A08', 'S01']);
  const out = buildExportPlan(m, project);
  assert.deepEqual(out.units[0].rows.map(r => r.id), ['A08']);
});

test('buildExportPlan full mode collects example files for all statuses', () => {
  const rows = [
    ['Item ID', 'Conditions', 'Description', 'Code', 'Note', 'Example'],
    ['A08', '', 'x', 'AS3000', '', 'a08.png'],
    ['A10', 'PitToEarth: FALSE', 'x', 'EN81', '', 'a10.png'],
  ];
  const m = buildModel({ checklistRows: rows, inputRows });
  const project = { units: [{ name: 'U', inputs: { PitToEarth: true }, checks: { A08: true }, comments: {} }] };
  const plan = buildExportPlan(m, project, { mode: 'full' });
  // A08 done (has file), A10 na (has file) — both bundled.
  assert.deepEqual(plan.referencedFiles, ['a08.png', 'a10.png']);
});
