import { parseCondition, evaluate } from './conditionEngine.js';

export class ModelError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ModelError';
  }
}

const CHECKLIST_COLS = ['Item ID', 'Conditions', 'Description', 'Code', 'Note', 'Example'];
const INPUT_COLS = ['Name', 'Type', 'Label', 'Unit', 'Choices', 'Default'];
const SECTION_COLS = ['Prefix', 'Name'];
const GLOSSARY_COLS = ['Term', 'Meaning'];
const VALID_TYPES = ['Choice', 'Float', 'Integer', 'Boolean'];

function headerIndex(rows, requiredCols, sheetName) {
  if (!rows || rows.length === 0) throw new ModelError(`Sheet "${sheetName}" is empty`);
  const header = rows[0].map(c => String(c ?? '').trim());
  const idx = {};
  for (const col of requiredCols) {
    const i = header.indexOf(col);
    if (i === -1) throw new ModelError(`Sheet "${sheetName}" is missing required column: ${col}`);
    idx[col] = i;
  }
  return idx;
}

function cell(row, i) {
  const v = row[i];
  return v === undefined || v === null ? '' : String(v).trim();
}

// An Example cell is treated as an image when its whole value is an image
// filename (ends in a known extension); otherwise it is explanatory text.
function isImageFilename(value) {
  return /\.(png|jpe?g|gif|svg|webp|bmp)$/i.test(String(value).trim());
}

function buildInputs(inputRows) {
  const idx = headerIndex(inputRows, INPUT_COLS, 'Inputs');
  const inputs = [];
  for (let r = 1; r < inputRows.length; r++) {
    const row = inputRows[r];
    const name = cell(row, idx['Name']);
    if (!name) continue;
    const type = cell(row, idx['Type']);
    if (!VALID_TYPES.includes(type)) {
      throw new ModelError(`Input "${name}" has invalid Type "${type}" (must be one of ${VALID_TYPES.join(', ')})`);
    }
    const choicesRaw = cell(row, idx['Choices']);
    const choices = choicesRaw ? choicesRaw.split(';').map(s => s.trim()).filter(Boolean) : [];
    inputs.push({
      name,
      type,
      label: cell(row, idx['Label']) || name,
      unit: cell(row, idx['Unit']),
      choices,
      default: cell(row, idx['Default']),
    });
  }
  return inputs;
}

function sectionPrefix(id) {
  const m = String(id).match(/^[A-Za-z]+/);
  return m ? m[0].toUpperCase() : '';
}

function buildSectionMap(sectionRows) {
  if (!sectionRows || sectionRows.length === 0) return {};
  const idx = headerIndex(sectionRows, SECTION_COLS, 'Sections');
  const map = {};
  for (let r = 1; r < sectionRows.length; r++) {
    const prefix = cell(sectionRows[r], idx['Prefix']).toUpperCase();
    if (!prefix) continue;
    map[prefix] = cell(sectionRows[r], idx['Name']) || prefix;
  }
  return map;
}

function resolveSectionName(prefix, sectionMap) {
  if (prefix === '') return 'Other';
  return sectionMap[prefix] || prefix;
}

function buildGlossary(glossaryRows) {
  if (!glossaryRows || glossaryRows.length === 0) return [];
  const idx = headerIndex(glossaryRows, GLOSSARY_COLS, 'Glossary');
  const out = [];
  for (let r = 1; r < glossaryRows.length; r++) {
    const term = cell(glossaryRows[r], idx['Term']);
    if (!term) continue;
    out.push({ term, meaning: cell(glossaryRows[r], idx['Meaning']) });
  }
  return out;
}

function buildItems(checklistRows, inputDefs, sectionMap) {
  const idx = headerIndex(checklistRows, CHECKLIST_COLS, 'Checklist');
  const items = [];
  for (let r = 1; r < checklistRows.length; r++) {
    const row = checklistRows[r];
    const id = cell(row, idx['Item ID']);
    if (!id) continue;
    const prefix = sectionPrefix(id);
    const conditionsText = cell(row, idx['Conditions']);
    let condition = null;
    if (conditionsText) {
      try {
        condition = parseCondition(conditionsText);
        // validate references by a dry-run evaluate with empty values
        evaluate(condition, {}, inputDefs);
      } catch (err) {
        throw new ModelError(`Item ${id}: ${err.message}`);
      }
    }
    items.push({
      id,
      sectionPrefix: prefix,
      section: resolveSectionName(prefix, sectionMap),
      conditionsText,
      condition,
      description: cell(row, idx['Description']),
      code: cell(row, idx['Code']),
      note: cell(row, idx['Note']),
      // One Example column: either prose guidance or a single image filename.
      example: isImageFilename(cell(row, idx['Example'])) ? '' : cell(row, idx['Example']),
      exampleImage: isImageFilename(cell(row, idx['Example'])) ? cell(row, idx['Example']) : '',
    });
  }
  return items;
}

export function buildModel({ checklistRows, inputRows, sectionRows, glossaryRows }) {
  const inputs = buildInputs(inputRows);
  const inputDefs = {};
  for (const inp of inputs) inputDefs[inp.name] = inp;
  const sectionMap = buildSectionMap(sectionRows);
  const items = buildItems(checklistRows, inputDefs, sectionMap);
  const sections = [];
  const seen = new Set();
  for (const item of items) {
    if (seen.has(item.sectionPrefix)) continue;
    seen.add(item.sectionPrefix);
    sections.push({ prefix: item.sectionPrefix, name: item.section });
  }
  const glossary = buildGlossary(glossaryRows);
  return { items, inputs, inputDefs, sections, glossary };
}
