import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildModel } from '../src/workbookModel.js';
import {
  isProjectScoped, projectItemApplicable, projectItemChecked, projectItemComment, projectScopeLabel,
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
