// Builds the styled export workbook: a branded Overview sheet plus one sheet per
// unit whose outstanding items are grouped into named discipline sections.
//
// Pure logic: the vendored `XLSX` (xlsx-js-style) is injected so this module has
// no global/DOM dependency and can be exercised in Node. The library can style
// cells but cannot embed images, so branding is done with styled cells (no logo).
import { computeProgress, computeProjectProgress } from './exporter.js';

// ---- palette ---------------------------------------------------------------
const RED_DK = 'B30510';   // unit-sheet header + discipline-band text
const RED_SUB = 'C00000';  // brand strip + glossary header (Excel "Dark Red")
const WHITE = 'FFFFFF';
const INK = '1A1A1A';
const TITLE_BG = 'F2F2F2';  // Overview title row background
const GREY_HD = 'F0F1F3';   // Overview section bands
const SECTION = 'EDEEF0';   // unit-sheet discipline bands
const GREY_LN = 'D8DBDF';
const TRACK = 'C4C8CE';     // progress-meter outline
const GREEN = '3FA34D';     // progress-meter fill
const FILLABLE = 'FFF6CC';  // client-fill tint
const LINK = '0563C1';      // Example hyperlink blue
const DONE_FILL = 'E7F3E9';  // full-export "Done" row tint (light green)
const NA_FILL = 'F0F1F3';    // full-export "Not Applicable" row tint (grey)
const NA_TEXT = '9AA1AB';    // muted text on N/A rows

const OVERVIEW_COLS = 16;
const UNIT_HEADER = ['Item ID', 'Description', 'Code', 'Comments', 'Example'];
const UNIT_HEADER_FULL = ['Item ID', 'Description', 'Code', 'Status', 'Comments', 'Example'];
const STATUS_TEXT = { done: 'Done', outstanding: 'Outstanding', na: 'N/A' };

// Per-cell style for a full-export row, tinted by status. `bd`/`fill` are module-scope.
function fullCell(status, { bold = false, wrap = true, link = false } = {}) {
  const rowFill = status === 'done' ? DONE_FILL : status === 'na' ? NA_FILL : null;
  const rgb = link ? LINK : (status === 'na' ? NA_TEXT : INK);
  const s = {
    alignment: { vertical: 'top', wrapText: wrap },
    border: { bottom: bd(GREY_LN) },
    font: { color: { rgb }, bold, underline: link },
  };
  if (rowFill) s.fill = fill(rowFill);
  return s;
}

const NOTES = [
  'This workbook lists only the OUTSTANDING (unchecked) compliance items — one tab per unit.',
  'Outstanding items are grouped by discipline (from the Sections defined in the checklist).',
  'The Overview tab summarises progress for each unit as at the review date shown above.',
  'Complete the highlighted Reviewed By and Contact fields before circulating.',
  'Items with an entry in the Example column link to a supporting file in the Examples/ folder of this bundle.',
  'After downloading, extract the ZIP file. Keep this workbook in the top-level (parent) folder and the Examples in the "Examples" sub-folder inside it — the Example links only work when this folder structure is preserved.',
];

const NOTES_FULL = [
  'This workbook lists ALL compliance items — one tab per unit — with each item marked Done, Outstanding, or Not Applicable for that unit.',
  'Items are grouped by discipline (from the Sections defined in the checklist).',
  'Row colours: green = Done (checked); plain = Outstanding (applicable, not yet checked); grey = Not Applicable to that unit.',
  'The Overview tab summarises progress for each unit as at the review date shown above.',
  'Complete the highlighted Reviewed By and Contact fields before circulating.',
  'Items with an entry in the Example column link to a supporting file in the Examples/ folder of this bundle.',
  'After downloading, extract the ZIP file. Keep this workbook in the top-level (parent) folder and the Examples in the "Examples" sub-folder inside it — the Example links only work when this folder structure is preserved.',
];

// ---- styled-sheet builder (XLSX injected) ----------------------------------
function makeApi(XLSX) {
  const newSheet = (ncols) => ({ _max: { r: 0, c: ncols - 1 }, '!merges': [] });
  function put(ws, r, c, v, s, opts = {}) {
    const addr = XLSX.utils.encode_cell({ r, c });
    ws[addr] = { t: typeof v === 'number' ? 'n' : 's', v: v == null ? '' : v };
    if (s) ws[addr].s = s;
    if (opts.link) ws[addr].l = opts.link;
    if (r > ws._max.r) ws._max.r = r;
    return ws[addr];
  }
  const merge = (ws, r, c1, c2, r2 = r) => ws['!merges'].push({ s: { r, c: c1 }, e: { r: r2, c: c2 } });
  function band(ws, r, c1, c2, v, s, opts) { put(ws, r, c1, v, s, opts); for (let c = c1 + 1; c <= c2; c++) put(ws, r, c, '', s); merge(ws, r, c1, c2); }
  const finalize = (ws) => { ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: ws._max }); delete ws._max; return ws; };
  return { newSheet, put, merge, band, finalize };
}
const bd = (rgb = GREY_LN, style = 'thin') => ({ style, color: { rgb } });
const fill = (rgb) => ({ patternType: 'solid', fgColor: { rgb }, bgColor: { rgb } });

// ---- Overview sheet --------------------------------------------------------
function buildOverviewSheet(XLSX, model, project, reviewDate, mode = 'outstanding') {
  const N = OVERVIEW_COLS;
  const { newSheet, put, band, finalize } = makeApi(XLSX);
  const ws = newSheet(N);
  ws['!cols'] = Array.from({ length: N }, (_, i) => ({ wch: i < 4 ? 7 : 5 }));
  const rows = [];
  const rh = (r, hpt) => { rows[r] = { hpt }; };
  let r = 0;

  // Header: thin dark-red brand strip, then a large black title on white
  band(ws, r, 0, N - 1, 'SCHINDLER', { fill: fill(RED_SUB), font: { bold: true, sz: 12, color: { rgb: WHITE } }, alignment: { vertical: 'center', indent: 1 } }); rh(r, 15); r++;
  band(ws, r, 0, N - 1, 'COMPLIANCE CHECKLIST REVIEW', { fill: fill(TITLE_BG), font: { bold: true, sz: 22, color: { rgb: INK } }, alignment: { vertical: 'center', indent: 1 } }); rh(r, 41); r++;
  r++;

  const sectionBand = (t) => { band(ws, r, 0, N - 1, t, { fill: fill(GREY_HD), font: { bold: true, sz: 11, color: { rgb: INK } }, alignment: { vertical: 'center', indent: 1 } }); rh(r, 20); r++; };

  // Project Details
  sectionBand('PROJECT DETAILS');
  const detail = (label, value, fillable = false) => {
    const labStyle = { font: { bold: true, color: { rgb: INK } }, alignment: { vertical: 'center', indent: 1 }, border: { bottom: bd() } };
    const valStyle = fillable
      ? { fill: fill(FILLABLE), font: { italic: true, color: { rgb: '9A7B00' } }, alignment: { vertical: 'center', indent: 1 }, border: { bottom: bd() } }
      : { font: { color: { rgb: INK } }, alignment: { vertical: 'center', indent: 1 }, border: { bottom: bd() } };
    band(ws, r, 0, 3, label, labStyle);
    band(ws, r, 4, N - 1, fillable ? '  (to be completed)' : value, valStyle);
    rh(r, 18); r++;
  };
  const d = project.details || {};
  detail('Date Reviewed', reviewDate);
  detail('Project Title', project.name || '');
  // Reviewer fields fall back to the highlighted "(to be completed)" fillable
  // cell when not captured in-app (preserves the fill-in-Excel workflow).
  detail('Reviewed By', d.reviewerName || '', !d.reviewerName);
  detail('Contact', d.reviewerContact || '', !d.reviewerContact);
  r++;

  // Builder Details — informational; empty fields render as a plain blank cell.
  sectionBand('BUILDER DETAILS');
  detail('Builder Name', d.builderName || '');
  detail('Phone', d.builderPhone || '');
  detail('Email', d.builderEmail || '');
  detail('Registration No. (BUP/BDC/DEP)', d.builderApprovalNo || '');
  r++;

  // Progress by unit — continuous bordered track meter
  sectionBand('PROGRESS BY UNIT');
  const BAR0 = 4, BARN = 10;
  const meter = (label, pct, bold = false) => {
    band(ws, r, 0, 3, label, { font: { bold, color: { rgb: INK } }, alignment: { vertical: 'center', indent: 1 } });
    const filled = Math.round((pct / 100) * BARN);
    for (let i = 0; i < BARN; i++) {
      const on = i < filled;
      put(ws, r, BAR0 + i, '', { fill: fill(on ? GREEN : WHITE), border: { top: bd(TRACK), bottom: bd(TRACK), left: i === 0 ? bd(TRACK) : undefined, right: i === BARN - 1 ? bd(TRACK) : undefined } });
    }
    band(ws, r, 14, 15, pct + '%', { font: { bold: true, color: { rgb: pct === 100 ? '2E7D32' : INK } }, alignment: { vertical: 'center', horizontal: 'left', indent: 1 } });
    rh(r, 18); r++;
  };
  for (const unit of project.units || []) {
    const p = computeProgress(model, unit);
    meter(unit.name || 'Unit', Math.round(p.ratio * 100));
  }
  const overall = computeProjectProgress(model, project);
  meter('Overall', Math.round(overall.ratio * 100), true);
  r++;

  // Status key — only in the full ("all items") export.
  if (mode === 'full') {
    sectionBand('STATUS KEY');
    const legendRow = (swatch, label) => {
      put(ws, r, 0, '', { fill: fill(swatch), border: { top: bd(TRACK), bottom: bd(TRACK), left: bd(TRACK) } });
      put(ws, r, 1, '', { fill: fill(swatch), border: { top: bd(TRACK), bottom: bd(TRACK), right: bd(TRACK) } });
      band(ws, r, 2, N - 1, label, { font: { color: { rgb: INK } }, alignment: { vertical: 'center', indent: 1 } });
      rh(r, 18); r++;
    };
    legendRow(DONE_FILL, 'Done — applicable to this unit and checked complete');
    legendRow(WHITE, 'Outstanding — applicable but not yet checked');
    legendRow(NA_FILL, "Not Applicable — item's condition does not apply to this unit");
    r++;
  }

  // Glossary — only when the checklist supplies one
  if (model.glossary && model.glossary.length) {
    sectionBand('GLOSSARY');
    band(ws, r, 0, 3, 'Acronym', { font: { bold: true, color: { rgb: WHITE } }, fill: fill(RED_SUB), alignment: { vertical: 'center', indent: 1 } });
    band(ws, r, 4, N - 1, 'Meaning', { font: { bold: true, color: { rgb: WHITE } }, fill: fill(RED_SUB), alignment: { vertical: 'center', indent: 1 } }); rh(r, 18); r++;
    for (const g of model.glossary) {
      band(ws, r, 0, 3, g.term, { font: { bold: true, color: { rgb: RED_SUB } }, alignment: { vertical: 'center', indent: 1 }, border: { bottom: bd() } });
      band(ws, r, 4, N - 1, g.meaning || '', { font: { color: { rgb: INK } }, alignment: { vertical: 'center', indent: 1 }, border: { bottom: bd() } }); rh(r, 18); r++;
    }
    r++;
  }

  // How to use
  sectionBand('HOW TO USE THIS WORKBOOK');
  const CHARS_PER_LINE = 96;
  const notes = mode === 'full' ? NOTES_FULL : NOTES;
  notes.forEach((note, i) => {
    const text = `${i + 1}.  ${note}`;
    const lines = Math.max(1, Math.ceil(text.length / CHARS_PER_LINE));
    // The final note (extract-the-ZIP / folder-structure warning) is shown in red.
    const color = i === notes.length - 1 ? RED_SUB : INK;
    band(ws, r, 0, N - 1, text, { font: { color: { rgb: color } }, alignment: { vertical: 'top', wrapText: true, indent: 1 } });
    rh(r, 14 + lines * 14); r++;
  });

  ws['!rows'] = rows;
  return finalize(ws);
}

// ---- per-unit sheet: grouped into named discipline sections ----------------
// Orders sections by the model's Section order; unknown prefixes come after.
function orderedSections(model, rows) {
  const order = new Map();
  (model.sections || []).forEach((s, i) => order.set(s.prefix, i));
  const groups = new Map(); // prefix -> { name, rows }
  for (const row of rows) {
    const key = row.sectionPrefix || '';
    if (!groups.has(key)) groups.set(key, { name: row.section || 'Other', rows: [] });
    groups.get(key).rows.push(row);
  }
  return [...groups.entries()].sort((a, b) => {
    const oa = order.has(a[0]) ? order.get(a[0]) : Infinity;
    const ob = order.has(b[0]) ? order.get(b[0]) : Infinity;
    return oa - ob;
  }).map(([, g]) => g);
}

function buildUnitSheet(XLSX, unitPlan, model) {
  const { newSheet, put, band, finalize } = makeApi(XLSX);
  const ws = newSheet(UNIT_HEADER.length);
  ws['!cols'] = [{ wch: 10 }, { wch: 46 }, { wch: 14 }, { wch: 28 }, { wch: 40 }];
  const rows = [];
  const rh = (r, hpt) => { rows[r] = { hpt }; };
  let r = 0;

  UNIT_HEADER.forEach((h, c) => put(ws, r, c, h, { font: { bold: true, color: { rgb: WHITE } }, fill: fill(RED_DK), alignment: { vertical: 'center' } }));
  rh(r, 18); r++;

  if (!unitPlan.rows.length) {
    band(ws, r, 0, UNIT_HEADER.length - 1, 'No outstanding items — all applicable checks are complete.', { font: { italic: true, color: { rgb: '2E7D32' } }, alignment: { vertical: 'center', indent: 1 } });
    rh(r, 18); r++;
    return finalize(ws);
  }

  for (const group of orderedSections(model, unitPlan.rows)) {
    band(ws, r, 0, 4, String(group.name).toUpperCase(), { fill: fill(SECTION), font: { bold: true, color: { rgb: RED_DK } }, alignment: { vertical: 'center' }, border: { top: bd(), bottom: bd() } });
    rh(r, 18); r++;
    for (const it of group.rows) {
      const border = { bottom: bd(GREY_LN) };
      put(ws, r, 0, it.id, { font: { bold: true, color: { rgb: INK } }, alignment: { vertical: 'top' }, border });
      put(ws, r, 1, it.description, { alignment: { vertical: 'top', wrapText: true }, border });
      put(ws, r, 2, it.code, { alignment: { vertical: 'top' }, border });
      put(ws, r, 3, it.comment || '', { alignment: { vertical: 'top', wrapText: true }, border });
      if (it.exampleFile) {
        put(ws, r, 4, it.exampleFile, { font: { color: { rgb: LINK }, underline: true }, alignment: { vertical: 'top' }, border },
          { link: { Target: 'Examples/' + it.exampleFile, Tooltip: 'Open ' + it.exampleFile } });
      } else {
        put(ws, r, 4, it.example || '', { alignment: { vertical: 'top', wrapText: true }, border });
      }
      // rough height: whichever of description/comment wraps to the most lines
      const lines = Math.max(1, Math.ceil((it.description || '').length / 46), Math.ceil((it.comment || '').length / 28));
      rh(r, 4 + lines * 14); r++;
    }
  }
  return finalize(ws);
}

// Full-export per-unit sheet: every item, grouped by discipline, with a Status
// column and status-tinted rows (green Done / plain Outstanding / grey N/A).
function buildUnitSheetFull(XLSX, unitPlan, model) {
  const { newSheet, put, band, finalize } = makeApi(XLSX);
  const ws = newSheet(UNIT_HEADER_FULL.length);
  ws['!cols'] = [{ wch: 10 }, { wch: 44 }, { wch: 12 }, { wch: 13 }, { wch: 26 }, { wch: 38 }];
  const rows = [];
  const rh = (r, hpt) => { rows[r] = { hpt }; };
  let r = 0;

  UNIT_HEADER_FULL.forEach((h, c) => put(ws, r, c, h, { font: { bold: true, color: { rgb: WHITE } }, fill: fill(RED_DK), alignment: { vertical: 'center' } }));
  rh(r, 18); r++;

  if (!unitPlan.rows.length) {
    band(ws, r, 0, UNIT_HEADER_FULL.length - 1, 'No checklist items.', { font: { italic: true, color: { rgb: INK } }, alignment: { vertical: 'center', indent: 1 } });
    rh(r, 18); r++;
    return finalize(ws);
  }

  for (const group of orderedSections(model, unitPlan.rows)) {
    band(ws, r, 0, 5, String(group.name).toUpperCase(), { fill: fill(SECTION), font: { bold: true, color: { rgb: RED_DK } }, alignment: { vertical: 'center' }, border: { top: bd(), bottom: bd() } });
    rh(r, 18); r++;
    for (const it of group.rows) {
      put(ws, r, 0, it.id, fullCell(it.status, { bold: true, wrap: false }));
      put(ws, r, 1, it.description, fullCell(it.status));
      put(ws, r, 2, it.code, fullCell(it.status, { wrap: false }));
      put(ws, r, 3, STATUS_TEXT[it.status] || '', fullCell(it.status, { bold: it.status !== 'outstanding', wrap: false }));
      put(ws, r, 4, it.comment || '', fullCell(it.status));
      if (it.exampleFile) {
        put(ws, r, 5, it.exampleFile, fullCell(it.status, { link: true, wrap: false }),
          { link: { Target: 'Examples/' + it.exampleFile, Tooltip: 'Open ' + it.exampleFile } });
      } else {
        put(ws, r, 5, it.example || '', fullCell(it.status));
      }
      const lines = Math.max(1, Math.ceil((it.description || '').length / 44), Math.ceil((it.comment || '').length / 26));
      rh(r, 4 + lines * 14); r++;
    }
  }
  return finalize(ws);
}

// ---- sheet-name sanitiser (Excel: <=31 chars, no []:*?/\, unique) ----------
function sanitizeSheetName(name, used) {
  let base = String(name || 'Unit').replace(/[\[\]:*?/\\]/g, ' ').trim().slice(0, 31) || 'Unit';
  let candidate = base;
  let n = 2;
  while (used.has(candidate)) {
    const suffix = ' (' + n + ')';
    candidate = base.slice(0, 31 - suffix.length) + suffix;
    n++;
  }
  used.add(candidate);
  return candidate;
}

// ---- assemble --------------------------------------------------------------
export function buildExportWorkbook({ XLSX, model, project, plan, reviewDate, mode = 'outstanding' }) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, buildOverviewSheet(XLSX, model, project, reviewDate, mode), 'Overview');
  const used = new Set(['Overview']);
  for (const unitPlan of plan.units) {
    const sheet = mode === 'full'
      ? buildUnitSheetFull(XLSX, unitPlan, model)
      : buildUnitSheet(XLSX, unitPlan, model);
    XLSX.utils.book_append_sheet(wb, sheet, sanitizeSheetName(unitPlan.name, used));
  }
  return wb;
}
