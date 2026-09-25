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

test('items get sectionPrefix and section name from Sections sheet', () => {
  const sectionRows = [
    ['Prefix', 'Name'],
    ['A', 'Architectural'],
    ['B', 'Structural'],
  ];
  const checklist = [
    ['Item ID', 'Conditions', 'Description', 'Code', 'Note', 'Example'],
    ['A08', '', 'arch item', '', '', ''],
    ['B01', '', 'struct item', '', '', ''],
  ];
  const model = buildModel({ checklistRows: checklist, inputRows, sectionRows });
  assert.equal(model.items[0].sectionPrefix, 'A');
  assert.equal(model.items[0].section, 'Architectural');
  assert.equal(model.items[1].section, 'Structural');
});

test('section name falls back to prefix when Sections missing or unlisted', () => {
  const checklist = [
    ['Item ID', 'Conditions', 'Description', 'Code', 'Note', 'Example'],
    ['C02', '', 'no section sheet', '', '', ''],
    ['99x', '', 'no leading letters', '', '', ''],
  ];
  const model = buildModel({ checklistRows: checklist, inputRows });
  assert.equal(model.items[0].sectionPrefix, 'C');
  assert.equal(model.items[0].section, 'C');
  assert.equal(model.items[1].sectionPrefix, '');
  assert.equal(model.items[1].section, 'Other');
});

test('model.sections lists present sections in first-appearance order', () => {
  const sectionRows = [['Prefix', 'Name'], ['A', 'Architectural'], ['B', 'Structural']];
  const checklist = [
    ['Item ID', 'Conditions', 'Description', 'Code', 'Note', 'Example'],
    ['B01', '', 'b', '', '', ''],
    ['A01', '', 'a', '', '', ''],
    ['B02', '', 'b2', '', '', ''],
  ];
  const model = buildModel({ checklistRows: checklist, inputRows, sectionRows });
  assert.deepEqual(model.sections, [
    { prefix: 'B', name: 'Structural', scope: 'unit' },
    { prefix: 'A', name: 'Architectural', scope: 'unit' },
  ]);
});

test('glossary parsed from Glossary sheet', () => {
  const glossaryRows = [
    ['Term', 'Meaning'],
    ['EN81-20', 'Lift safety standard'],
    ['BCA', 'Building Code of Australia'],
  ];
  const model = buildModel({ checklistRows, inputRows, glossaryRows });
  assert.deepEqual(model.glossary, [
    { term: 'EN81-20', meaning: 'Lift safety standard' },
    { term: 'BCA', meaning: 'Building Code of Australia' },
  ]);
});

test('glossary is empty array when sheet absent', () => {
  const model = buildModel({ checklistRows, inputRows });
  assert.deepEqual(model.glossary, []);
});

test('a Link URL becomes exampleLink, with Example kept as the label', () => {
  const rows = [
    ['Item ID', 'Conditions', 'Description', 'Code', 'Note', 'Example', 'Link', 'HyperLink'],
    ['A08', '', 'Weather', 'AS3000', '', 'ShaftVentilation.png', 'https://dropbox.com/s/abc/ShaftVentilation.PNG?dl=0', 'ShaftVentilation.png'],
  ];
  const model = buildModel({ checklistRows: rows, inputRows });
  assert.equal(model.items[0].example, 'ShaftVentilation.png');
  assert.equal(model.items[0].exampleLink, 'https://dropbox.com/s/abc/ShaftVentilation.PNG?dl=0');
});

test('an Example with no Link stays plain text', () => {
  const rows = [
    ['Item ID', 'Conditions', 'Description', 'Code', 'Note', 'Example', 'Link'],
    ['A09', '', 'Lobby', 'SL', '', 'Provide a protected lobby.', ''],
  ];
  const model = buildModel({ checklistRows: rows, inputRows });
  assert.equal(model.items[0].example, 'Provide a protected lobby.');
  assert.equal(model.items[0].exampleLink, '');
});

test('a Link that is not an http(s) URL is ignored', () => {
  const rows = [
    ['Item ID', 'Conditions', 'Description', 'Code', 'Note', 'Example', 'Link'],
    ['A10', '', 'Spec', 'EN81', '', 'a10-spec.pdf', 'C:\\shared\\a10-spec.pdf'],
    ['A11', '', 'Spec', 'EN81', '', 'a11-spec.pdf', 'see the drive'],
  ];
  const model = buildModel({ checklistRows: rows, inputRows });
  assert.equal(model.items[0].exampleLink, '');
  assert.equal(model.items[1].exampleLink, '');
});

test('a workbook with no Link column still loads', () => {
  const model = buildModel({ checklistRows, inputRows });
  assert.equal(model.items[0].example, 'Seal the enclosure');
  assert.equal(model.items[0].exampleLink, '');
});

test('a Link value is trimmed', () => {
  const rows = [
    ['Item ID', 'Conditions', 'Description', 'Code', 'Note', 'Example', 'Link'],
    ['A12', '', 'x', '', '', 'x.png', '  https://dropbox.com/s/x.png  '],
  ];
  const model = buildModel({ checklistRows: rows, inputRows });
  assert.equal(model.items[0].exampleLink, 'https://dropbox.com/s/x.png');
});

test('Scope column marks a section project-level; blank and absent default to unit', () => {
  const sectionRows = [
    ['Prefix', 'Name', 'Scope'],
    ['A', 'Architectural', ''],
    ['F', 'Reports', 'project'],
    ['G', 'Statements', 'PROJECT '],
  ];
  const checklist = [
    ['Item ID', 'Conditions', 'Description', 'Code', 'Note', 'Example'],
    ['A08', '', 'arch item', '', '', ''],
    ['F02', '', 'BCA Report', '', '', ''],
    ['G01', '', 'Redundancy Statement', '', '', ''],
  ];
  const model = buildModel({ checklistRows: checklist, inputRows, sectionRows });
  assert.equal(model.items[0].scope, 'unit');
  assert.equal(model.items[1].scope, 'project');
  assert.equal(model.items[2].scope, 'project', 'case and trailing space tolerated');
});

test('a Sections sheet with no Scope column leaves every section unit-scoped', () => {
  const sectionRows = [['Prefix', 'Name'], ['F', 'Reports']];
  const checklist = [
    ['Item ID', 'Conditions', 'Description', 'Code', 'Note', 'Example'],
    ['F02', '', 'BCA Report', '', '', ''],
  ];
  const model = buildModel({ checklistRows: checklist, inputRows, sectionRows });
  assert.equal(model.items[0].scope, 'unit');
});

test('an item whose prefix has no Sections row is unit-scoped', () => {
  const checklist = [
    ['Item ID', 'Conditions', 'Description', 'Code', 'Note', 'Example'],
    ['Z01', '', 'unlisted prefix', '', '', ''],
  ];
  const model = buildModel({ checklistRows: checklist, inputRows });
  assert.equal(model.items[0].scope, 'unit');
});

test('an unrecognised Scope value throws ModelError naming it', () => {
  const sectionRows = [['Prefix', 'Name', 'Scope'], ['F', 'Reports', 'projet']];
  const checklist = [
    ['Item ID', 'Conditions', 'Description', 'Code', 'Note', 'Example'],
    ['F02', '', 'BCA Report', '', '', ''],
  ];
  assert.throws(() => buildModel({ checklistRows: checklist, inputRows, sectionRows }), err => {
    assert.equal(err.name, 'ModelError');
    assert.match(err.message, /projet/);
    return true;
  });
});

test('model.sections carries each section scope', () => {
  const sectionRows = [['Prefix', 'Name', 'Scope'], ['A', 'Architectural', ''], ['F', 'Reports', 'project']];
  const checklist = [
    ['Item ID', 'Conditions', 'Description', 'Code', 'Note', 'Example'],
    ['A01', '', 'a', '', '', ''],
    ['F01', '', 'f', '', '', ''],
  ];
  const model = buildModel({ checklistRows: checklist, inputRows, sectionRows });
  assert.deepEqual(model.sections, [
    { prefix: 'A', name: 'Architectural', scope: 'unit' },
    { prefix: 'F', name: 'Reports', scope: 'project' },
  ]);
});
