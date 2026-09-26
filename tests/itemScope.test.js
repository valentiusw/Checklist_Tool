import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildModel } from '../src/workbookModel.js';
import {
  isProjectScoped, projectItemApplicable, projectItemChecked, projectItemComment, projectScopeLabel,
  migrateItemScope,
} from '../src/itemScope.js';

const inputRows = [
  ['Name', 'Type', 'Label', 'Unit', 'Choices', 'Default'],
  ['EH', 'Float', 'Effective Height', 'm', '', '0'],
];
const sectionRows = [
  ['Prefix', 'Name', 'Scope'],
  ['A', 'Architectural', ''],
  ['F', 'Reports', 'project'],
];
const checklistRows = [
  ['Item ID', 'Conditions', 'Description', 'Code', 'Note', 'Example'],
  ['A01', '', 'Per-unit item', '', '', ''],
  ['F01', '', 'BCA Report', '', '', ''],
  ['F02', 'EH: >12', 'Tall-building report', '', '', ''],
];
const model = buildModel({ checklistRows, inputRows, sectionRows });
const item = (id) => model.items.find(i => i.id === id);

test('isProjectScoped reads item.scope', () => {
  assert.equal(isProjectScoped(item('A01')), false);
  assert.equal(isProjectScoped(item('F01')), true);
});

test('a project item applies when ANY unit matches its condition', () => {
  const project = { units: [{ inputs: { EH: 20 } }, { inputs: { EH: 5 } }] };
  assert.equal(projectItemApplicable(model, project, item('F02')), true);
});

test('a project item does not apply when NO unit matches', () => {
  const project = { units: [{ inputs: { EH: 5 } }, { inputs: { EH: 8 } }] };
  assert.equal(projectItemApplicable(model, project, item('F02')), false);
});

test('an unconditional project item applies to any project with a unit', () => {
  assert.equal(projectItemApplicable(model, { units: [{ inputs: {} }] }, item('F01')), true);
});

test('the tick and comment come from the project, not a unit', () => {
  const project = { checks: { F01: true }, comments: { F01: 'Issued 12/09' }, units: [] };
  assert.equal(projectItemChecked(project, item('F01')), true);
  assert.equal(projectItemComment(project, item('F01')), 'Issued 12/09');
});

test('a project with no maps yet reads as unticked and uncommented', () => {
  assert.equal(projectItemChecked({ units: [] }, item('F01')), false);
  assert.equal(projectItemComment({ units: [] }, item('F01')), '');
});

test('projectScopeLabel joins the project-scoped section names in model order', () => {
  assert.equal(projectScopeLabel(model), 'Reports');
  const two = buildModel({
    checklistRows: [
      ['Item ID', 'Conditions', 'Description', 'Code', 'Note', 'Example'],
      ['F01', '', 'BCA Report', '', '', ''],
      ['G01', '', 'Redundancy Statement', '', '', ''],
    ],
    inputRows,
    sectionRows: [['Prefix', 'Name', 'Scope'], ['F', 'Reports', 'project'], ['G', 'Statements', 'project']],
  });
  assert.equal(projectScopeLabel(two), 'Reports & Statements');
});

test('projectScopeLabel is empty when no section is project-scoped', () => {
  const none = buildModel({
    checklistRows: [['Item ID', 'Conditions', 'Description', 'Code', 'Note', 'Example'], ['A01', '', 'a', '', '', '']],
    inputRows,
  });
  assert.equal(projectScopeLabel(none), '');
});

// ---- migration of pre-scope projects -------

function legacyProject() {
  return {
    checks: {}, comments: {},
    units: [
      { id: 'u1', name: 'Lift 1', inputs: { EH: 20 }, checks: { A01: true, F01: true }, comments: {} },
      { id: 'u2', name: 'Lift 2', inputs: { EH: 20 }, checks: {}, comments: { F01: 'Chased 12/09' } },
    ],
  };
}

test('migration drops per-unit ticks on project items but keeps unit ticks', () => {
  const p = legacyProject();
  assert.equal(migrateItemScope(model, p), true);
  assert.equal(p.checks.F01, undefined, 'project item starts outstanding');
  assert.equal(p.units[0].checks.F01, undefined, 'per-unit tick removed');
  assert.equal(p.units[0].checks.A01, true, 'per-unit item untouched');
});

test('migration folds the first non-empty comment up to the project', () => {
  const p = legacyProject();
  migrateItemScope(model, p);
  assert.equal(p.comments.F01, 'Chased 12/09');
  assert.equal(p.units[1].comments.F01, undefined, 'per-unit comment removed');
});

test('migration keeps the earliest unit comment when several units have one', () => {
  const p = legacyProject();
  p.units[0].comments.F01 = 'From Lift 1';
  migrateItemScope(model, p);
  assert.equal(p.comments.F01, 'From Lift 1');
});

test('migration never overwrites a comment already held at project level', () => {
  const p = legacyProject();
  p.comments.F01 = 'Already written here';
  migrateItemScope(model, p);
  assert.equal(p.comments.F01, 'Already written here');
});

test('migration is idempotent and reports no change on a second pass', () => {
  const p = legacyProject();
  assert.equal(migrateItemScope(model, p), true);
  const after = JSON.parse(JSON.stringify(p));
  assert.equal(migrateItemScope(model, p), false, 'nothing left to move');
  assert.deepEqual(p, after);
});

test('migration reports no change for a project with no project-level data', () => {
  const p = { checks: {}, comments: {}, units: [{ id: 'u1', inputs: {}, checks: { A01: true }, comments: {} }] };
  assert.equal(migrateItemScope(model, p), false);
});

test('migration seeds the project maps when they are absent', () => {
  const p = { units: [{ id: 'u1', inputs: {}, checks: {}, comments: { F01: 'text' } }] };
  migrateItemScope(model, p);
  assert.deepEqual(p.checks, {});
  assert.equal(p.comments.F01, 'text');
});
