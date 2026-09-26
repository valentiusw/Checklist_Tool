import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildModel } from '../src/workbookModel.js';
import { buildExportPlan } from '../src/exporter.js';
import { buildExportWorkbook } from '../src/exportWorkbook.js';

// Minimal stand-in for the vendored xlsx-js-style global. buildExportWorkbook
// only uses these four helpers, so the real library is not needed to assert on
// the cells it writes.
const A1 = ({ r, c }) => String.fromCharCode(65 + c) + (r + 1);
const XLSX = {
  utils: {
    encode_cell: A1,
    encode_range: ({ s, e }) => A1(s) + ':' + A1(e),
    book_new: () => ({ SheetNames: [], Sheets: {} }),
    book_append_sheet: (wb, ws, name) => { wb.SheetNames.push(name); wb.Sheets[name] = ws; },
  },
};

const inputRows = [['Name', 'Type', 'Label', 'Unit', 'Choices', 'Default']];
const checklistRows = [
  ['Item ID', 'Conditions', 'Description', 'Code', 'Note', 'Example', 'Link'],
  ['A08', '', 'Weather seal', 'AS3000', '', 'ShaftVentilation.png', 'https://dropbox.com/s/abc.png'],
  ['A09', '', 'Protected lobby', 'SL', '', 'Provide a protected lobby.', ''],
];

// Find a cell by the text it carries, across every sheet but the Overview.
function cellWithText(wb, text) {
  for (const name of wb.SheetNames.filter(n => n !== 'Overview')) {
    for (const [addr, cell] of Object.entries(wb.Sheets[name])) {
      if (addr.startsWith('!')) continue;
      if (cell && cell.v === text) return cell;
    }
  }
  return undefined;
}

function build(mode) {
  const model = buildModel({ checklistRows, inputRows });
  const project = { name: 'Smoke Tower', details: {}, units: [{ name: 'Lift 1', inputs: {}, checks: {}, comments: {} }] };
  const plan = buildExportPlan(model, project, { mode });
  return buildExportWorkbook({ XLSX, model, project, plan, reviewDate: '14/08/2026', mode });
}

test('a linked example cell shows the label and hyperlinks to the URL', () => {
  const cell = cellWithText(build('outstanding'), 'ShaftVentilation.png');
  assert.ok(cell, 'expected the example label in a unit sheet');
  assert.equal(cell.l.Target, 'https://dropbox.com/s/abc.png');
  assert.equal(cell.l.Tooltip, 'Open ShaftVentilation.png');
  assert.equal(cell.s.font.underline, true);
});

test('an unlinked example cell is plain text', () => {
  const cell = cellWithText(build('outstanding'), 'Provide a protected lobby.');
  assert.ok(cell, 'expected the prose example in a unit sheet');
  assert.equal(cell.l, undefined);
});

test('the full export links its example cells too', () => {
  const cell = cellWithText(build('full'), 'ShaftVentilation.png');
  assert.ok(cell, 'expected the example label in a full unit sheet');
  assert.equal(cell.l.Target, 'https://dropbox.com/s/abc.png');
});

test('a linked item with no Example label falls back to the URL as the cell text', () => {
  const rows = [
    ['Item ID', 'Conditions', 'Description', 'Code', 'Note', 'Example', 'Link'],
    ['A20', '', 'No label supplied', 'CODE', '', '', 'https://dropbox.com/s/no-label.png'],
  ];
  const model = buildModel({ checklistRows: rows, inputRows });
  const project = { name: 'Smoke Tower', details: {}, units: [{ name: 'Lift 1', inputs: {}, checks: {}, comments: {} }] };
  const plan = buildExportPlan(model, project, { mode: 'outstanding' });
  const wb = buildExportWorkbook({ XLSX, model, project, plan, reviewDate: '14/08/2026', mode: 'outstanding' });
  const cell = cellWithText(wb, 'https://dropbox.com/s/no-label.png');
  assert.ok(cell, 'expected the URL itself as the cell text when Example is empty');
  assert.equal(cell.l.Target, 'https://dropbox.com/s/no-label.png');
});

test('no export note mentions the Examples folder or the ZIP', () => {
  for (const mode of ['outstanding', 'full']) {
    const overview = build(mode).Sheets.Overview;
    const text = Object.entries(overview)
      .filter(([addr]) => !addr.startsWith('!'))
      .map(([, cell]) => String(cell.v || '')).join('\n');
    assert.ok(!/Examples\//.test(text), `${mode}: still mentions the Examples/ folder`);
    assert.ok(!/ZIP/i.test(text), `${mode}: still mentions the ZIP`);
  }
});

// ---- column header / width / prose conventions ------------------------------

// Every string a sheet carries, across the whole workbook (Overview included).
function allText(wb) {
  const out = [];
  for (const name of wb.SheetNames) {
    for (const [addr, cell] of Object.entries(wb.Sheets[name])) {
      if (addr.startsWith('!')) continue;
      if (cell && typeof cell.v === 'string') out.push(cell.v);
    }
  }
  return out;
}

// The header row of the first unit sheet (row 1), left to right.
function unitHeader(wb) {
  const name = wb.SheetNames.find(n => n !== 'Overview');
  const ws = wb.Sheets[name];
  return Object.entries(ws)
    .filter(([addr]) => /^[A-Z]1$/.test(addr))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, cell]) => cell.v);
}

test('the comments column is headed "SL comments", not "Comments"', () => {
  for (const mode of ['outstanding', 'full']) {
    const header = unitHeader(build(mode));
    assert.ok(header.includes('SL comments'), `${mode}: expected an "SL comments" header, got ${header.join(' | ')}`);
    assert.ok(!header.includes('Comments'), `${mode}: the bare "Comments" header is still there`);
  }
});

test('the comments column is 50 wide in both export modes', () => {
  for (const mode of ['outstanding', 'full']) {
    const wb = build(mode);
    const name = wb.SheetNames.find(n => n !== 'Overview');
    const header = unitHeader(wb);
    const col = header.indexOf('SL comments');
    assert.equal(wb.Sheets[name]['!cols'][col].wch, 50, `${mode}: comments column is not 50 wide`);
  }
});

test('no note tells the reader to complete the Reviewed By and Contact fields', () => {
  for (const mode of ['outstanding', 'full']) {
    const text = allText(build(mode)).join('\n');
    assert.ok(!/Complete the highlighted/i.test(text), `${mode}: the Reviewed By / Contact note is still there`);
  }
});

// The fixture's checklist text and comments carry no dashes, so anything this finds
// was generated by exportWorkbook.js: notes, legends, empty states, headers.
test('no text the export generates itself contains an em or en dash', () => {
  for (const mode of ['outstanding', 'full']) {
    const offenders = allText(build(mode)).filter(v => /[—–]/.test(v));
    assert.deepEqual(offenders, [], `${mode}: em/en dashes in ${offenders.length} cell(s)`);
  }
});

test("a user's own em dashes survive: comments and checklist text are not rewritten", () => {
  const rows = [
    ['Item ID', 'Conditions', 'Description', 'Code', 'Note', 'Example', 'Link'],
    ['A30', '', 'Shaft ventilation — see the mechanical drawings', 'S24C4', '', '', ''],
  ];
  const model = buildModel({ checklistRows: rows, inputRows });
  const project = {
    name: 'Smoke Tower',
    details: {},
    units: [{ name: 'Lift 1', inputs: {}, checks: {}, comments: { A30: 'Awaiting issue — chase the consultant' } }],
  };
  for (const mode of ['outstanding', 'full']) {
    const plan = buildExportPlan(model, project, { mode });
    const wb = buildExportWorkbook({ XLSX, model, project, plan, reviewDate: '14/08/2026', mode });
    const text = allText(wb);
    assert.ok(text.includes('Awaiting issue — chase the consultant'), `${mode}: the comment's em dash was rewritten`);
    assert.ok(text.includes('Shaft ventilation — see the mechanical drawings'), `${mode}: the description's em dash was rewritten`);
  }
});

// ---- the project-level sheet ------------------------------------------------

const scopeSectionRows = [
  ['Prefix', 'Name', 'Scope'],
  ['A', 'Architectural', ''],
  ['F', 'Reports', 'project'],
  ['G', 'Statements', 'project'],
];
const scopeChecklistRows = [
  ['Item ID', 'Conditions', 'Description', 'Code', 'Note', 'Example'],
  ['A01', '', 'Per-unit item', 'SL', '', ''],
  ['F01', '', 'BCA Report', 'SL', '', ''],
  ['G01', '', 'Redundancy Statement', 'RDM', '', ''],
];
const scopeModel = buildModel({ checklistRows: scopeChecklistRows, inputRows, sectionRows: scopeSectionRows });

function buildScoped(mode, project) {
  const plan = buildExportPlan(scopeModel, project, { mode });
  return buildExportWorkbook({ XLSX, model: scopeModel, project, plan, reviewDate: '25/09/2026', mode });
}
const scopedProject = (over = {}) => ({
  name: 'Smoke Tower', details: {}, checks: {}, comments: {},
  units: [{ id: 'u1', name: 'Lift 1', inputs: {}, checks: {}, comments: {} }],
  ...over,
});

test('the project-level sheet sits right after Overview', () => {
  const wb = buildScoped('outstanding', scopedProject());
  assert.deepEqual(wb.SheetNames, ['Overview', 'Reports & Statements', 'Lift 1']);
});

test('the project-level sheet is named from the project-scoped sections', () => {
  const oneSection = buildModel({
    checklistRows: [scopeChecklistRows[0], scopeChecklistRows[1], scopeChecklistRows[2]],
    inputRows,
    sectionRows: [['Prefix', 'Name', 'Scope'], ['A', 'Architectural', ''], ['F', 'Reports', 'project']],
  });
  const project = scopedProject();
  const plan = buildExportPlan(oneSection, project, { mode: 'outstanding' });
  const wb = buildExportWorkbook({ XLSX, model: oneSection, project, plan, reviewDate: '25/09/2026', mode: 'outstanding' });
  assert.deepEqual(wb.SheetNames, ['Overview', 'Reports', 'Lift 1']);
});

test('no project-level sheet when nothing is outstanding', () => {
  const wb = buildScoped('outstanding', scopedProject({ checks: { F01: true, G01: true } }));
  assert.deepEqual(wb.SheetNames, ['Overview', 'Lift 1'], 'the extra tab is omitted entirely');
});

test('no project-level sheet when the workbook has no project-scoped sections', () => {
  const wb = build('outstanding'); // the module-level unit-scoped fixture
  assert.ok(!wb.SheetNames.includes('Reports & Statements'));
});

test('the full export always carries the project-level sheet, even all-done', () => {
  const wb = buildScoped('full', scopedProject({ checks: { F01: true, G01: true } }));
  assert.deepEqual(wb.SheetNames, ['Overview', 'Reports & Statements', 'Lift 1']);
});

test('the project-level sheet groups its rows into discipline bands', () => {
  const ws = buildScoped('outstanding', scopedProject()).Sheets['Reports & Statements'];
  const text = Object.entries(ws)
    .filter(([addr]) => !addr.startsWith('!'))
    .map(([, cell]) => String(cell.v || ''));
  assert.ok(text.includes('REPORTS'), 'REPORTS band');
  assert.ok(text.includes('STATEMENTS'), 'STATEMENTS band');
  assert.ok(text.includes('SL comments'), 'same header as a unit sheet');
  assert.ok(text.includes('BCA Report'));
});

test('the Overview gains a progress meter for the project-level items', () => {
  const ws = buildScoped('outstanding', scopedProject()).Sheets.Overview;
  const text = Object.entries(ws)
    .filter(([addr]) => !addr.startsWith('!'))
    .map(([, cell]) => String(cell.v || ''));
  assert.ok(text.includes('Reports & Statements'), 'meter label on the Overview');
});

