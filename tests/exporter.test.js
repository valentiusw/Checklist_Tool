import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildModel } from '../src/workbookModel.js';
import { applicableItems, computeProgress, computeProjectProgress, buildExportPlan, computeScopeProgress } from '../src/exporter.js';

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

test('buildExportPlan returns per-unit outstanding rows carrying the example link', () => {
  const rows = [
    ['Item ID', 'Conditions', 'Description', 'Code', 'Note', 'Example', 'Link'],
    ['A08', '', 'Always applies', 'AS3000', '', 'a08.png', 'https://dropbox.com/s/a08.png'],
    ['A10', '', 'Second item', 'EN81', '', 'Prose guidance', ''],
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
  // Unit 1: A08 checked -> only A10 outstanding (prose, no link)
  assert.deepEqual(plan.units[0].rows.map(r => r.id), ['A10']);
  assert.equal(plan.units[0].rows[0].comment, 'note');
  assert.equal(plan.units[0].rows[0].exampleLink, '');
  assert.equal(plan.units[0].rows[0].example, 'Prose guidance');
  // Unit 2: nothing checked -> A08 (linked) + A10 (prose)
  assert.deepEqual(plan.units[1].rows.map(r => r.id), ['A08', 'A10']);
  assert.equal(plan.units[1].rows[0].example, 'a08.png');
  assert.equal(plan.units[1].rows[0].exampleLink, 'https://dropbox.com/s/a08.png');
});

test('buildExportPlan no longer reports referenced files', () => {
  const rows = [
    ['Item ID', 'Conditions', 'Description', 'Code', 'Note', 'Example', 'Link'],
    ['A08', '', 'Item', 'AS3000', '', 'a08.png', 'https://dropbox.com/s/a08.png'],
  ];
  const m = buildModel({ checklistRows: rows, inputRows });
  const project = { units: [{ name: 'U', inputs: {}, checks: {}, comments: {} }] };
  assert.equal(buildExportPlan(m, project).referencedFiles, undefined);
});

test('buildExportPlan full mode carries the link on every status', () => {
  const rows = [
    ['Item ID', 'Conditions', 'Description', 'Code', 'Note', 'Example', 'Link'],
    ['A08', '', 'x', 'AS3000', '', 'a08.png', 'https://dropbox.com/s/a08.png'],
    ['A10', 'PitToEarth: FALSE', 'x', 'EN81', '', 'a10.png', 'https://dropbox.com/s/a10.png'],
  ];
  const m = buildModel({ checklistRows: rows, inputRows });
  const project = { units: [{ name: 'U', inputs: { PitToEarth: true }, checks: { A08: true }, comments: {} }] };
  const plan = buildExportPlan(m, project, { mode: 'full' });
  // A08 done, A10 na — both keep their link.
  assert.deepEqual(plan.units[0].rows.map(r => r.exampleLink),
    ['https://dropbox.com/s/a08.png', 'https://dropbox.com/s/a10.png']);
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

// ---- project-level items ----------------------------------------------------

const scopeSectionRows = [
  ['Prefix', 'Name', 'Scope'],
  ['A', 'Architectural', ''],
  ['F', 'Reports', 'project'],
];
const scopeChecklistRows = [
  ['Item ID', 'Conditions', 'Description', 'Code', 'Note', 'Example'],
  ['A01', '', 'Per-unit item', 'SL', '', ''],
  ['F01', '', 'BCA Report', 'SL', '', ''],
  ['F02', 'MaxFFLInt: >11', 'Tall-building report', 'SL', '', ''],
];
const scopeModel = buildModel({ checklistRows: scopeChecklistRows, inputRows, sectionRows: scopeSectionRows });
const scopeProject = () => ({
  name: 'Smoke Tower',
  checks: {}, comments: {},
  units: [
    { id: 'u1', name: 'Lift 1', inputs: { PitToEarth: true, MaxFFLInt: 20 }, checks: {}, comments: {} },
    { id: 'u2', name: 'Lift 2', inputs: { PitToEarth: true, MaxFFLInt: 4 }, checks: {}, comments: {} },
  ],
});

test('computeProgress excludes project-level items from a unit', () => {
  const p = computeProgress(scopeModel, scopeProject().units[0]);
  assert.deepEqual(p, { checked: 0, applicable: 1, ratio: 0 }, 'only A01 counts');
});

test('a unit can reach 100% with a report outstanding', () => {
  const project = scopeProject();
  project.units[0].checks.A01 = true;
  assert.equal(computeProgress(scopeModel, project.units[0]).ratio, 1);
});

test('computeScopeProgress counts each project item once, any-unit applicable', () => {
  const project = scopeProject();
  // F01 always applies; F02 applies because Lift 1 has MaxFFLInt 20.
  assert.deepEqual(computeScopeProgress(scopeModel, project), { checked: 0, applicable: 2, ratio: 0 });
  project.checks.F01 = true;
  assert.deepEqual(computeScopeProgress(scopeModel, project), { checked: 1, applicable: 2, ratio: 0.5 });
});

test('computeProjectProgress is the units plus the project-level items', () => {
  const project = scopeProject();
  project.units[0].checks.A01 = true;
  project.units[1].checks.A01 = true;
  const all = computeProjectProgress(scopeModel, project);
  assert.deepEqual(all, { checked: 2, applicable: 4, ratio: 0.5 }, '2 unit items + 2 project items');
});

test('the overall bar is not 100% while a report is outstanding', () => {
  const project = scopeProject();
  project.units[0].checks.A01 = true;
  project.units[1].checks.A01 = true;
  project.checks.F01 = true;
  assert.notEqual(computeProjectProgress(scopeModel, project).ratio, 1);
});

test('buildExportPlan keeps project items out of the unit sheets', () => {
  const plan = buildExportPlan(scopeModel, scopeProject(), { mode: 'outstanding' });
  for (const unit of plan.units) {
    assert.deepEqual(unit.rows.map(r => r.id), ['A01'], `${unit.name} holds only its own items`);
  }
});

test('buildExportPlan lists outstanding project items once, with the project comment', () => {
  const project = scopeProject();
  project.comments.F01 = 'Issued 12/09';
  const plan = buildExportPlan(scopeModel, project, { mode: 'outstanding' });
  assert.deepEqual(plan.projectItems.map(r => r.id), ['F01', 'F02']);
  assert.equal(plan.projectItems[0].comment, 'Issued 12/09');
  assert.equal(plan.projectItems[0].section, 'Reports');
});

test('a ticked project item drops out of the outstanding plan', () => {
  const project = scopeProject();
  project.checks.F01 = true;
  const plan = buildExportPlan(scopeModel, project, { mode: 'outstanding' });
  assert.deepEqual(plan.projectItems.map(r => r.id), ['F02']);
});

test('a project item applicable to no unit is left out of the outstanding plan', () => {
  const project = scopeProject();
  project.units[0].inputs.MaxFFLInt = 4; // now no unit is over 11
  const plan = buildExportPlan(scopeModel, project, { mode: 'outstanding' });
  assert.deepEqual(plan.projectItems.map(r => r.id), ['F01']);
});

test('the full plan lists every project item with a status, na included', () => {
  const project = scopeProject();
  project.units[0].inputs.MaxFFLInt = 4; // F02 applies to nobody
  project.checks.F01 = true;
  const plan = buildExportPlan(scopeModel, project, { mode: 'full' });
  assert.deepEqual(plan.projectItems.map(r => ({ id: r.id, status: r.status })), [
    { id: 'F01', status: 'done' },
    { id: 'F02', status: 'na' },
  ]);
});

test('the full plan still keeps project items off the unit sheets', () => {
  const plan = buildExportPlan(scopeModel, scopeProject(), { mode: 'full' });
  for (const unit of plan.units) {
    assert.ok(!unit.rows.some(r => r.id.startsWith('F')), `${unit.name} has no project items`);
  }
});
