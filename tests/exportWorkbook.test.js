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
