import { buildModel } from './workbookModel.js';
import { createProjectStore } from './projectStore.js';

const MODEL_KEY = 'dpchecklist.model';

const state = {
  model: null,
  store: createProjectStore(window.localStorage),
  currentProjectId: null,
};

const screens = ['setup', 'dashboard', 'project'];
function showScreen(name) {
  for (const s of screens) {
    document.getElementById('screen-' + s).hidden = s !== name;
  }
  if (name === 'dashboard') renderDashboard();
}

function setStatus(msg, kind) {
  const el = document.getElementById('setup-status');
  el.textContent = msg;
  el.className = 'status' + (kind ? ' ' + kind : '');
}

function sheetToRows(workbook, name) {
  const ws = workbook.Sheets[name];
  if (!ws) throw new Error(`Workbook is missing a sheet named "${name}"`);
  return XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: '' });
}

function loadModelFromWorkbook(workbook) {
  const checklistRows = sheetToRows(workbook, 'Checklist');
  const inputRows = sheetToRows(workbook, 'Inputs');
  return buildModel({ checklistRows, inputRows });
}

function persistModel(model) {
  // Conditions are re-parsed on load, so store raw rows-free model minus AST.
  const serializable = {
    items: model.items.map(({ condition, ...rest }) => rest),
    inputs: model.inputs,
  };
  window.localStorage.setItem(MODEL_KEY, JSON.stringify(serializable));
}

function restoreModel() {
  const raw = window.localStorage.getItem(MODEL_KEY);
  if (!raw) return null;
  try {
    const data = JSON.parse(raw);
    // Rebuild AST + inputDefs from stored text.
    const inputRows = [
      ['Name', 'Type', 'Label', 'Unit', 'Choices', 'Default'],
      ...data.inputs.map(i => [i.name, i.type, i.label, i.unit, i.choices.join(';'), i.default]),
    ];
    const checklistRows = [
      ['Item ID', 'Conditions', 'Description', 'Code', 'Note', 'Example'],
      ...data.items.map(i => [i.id, i.conditionsText, i.description, i.code, i.note, i.example]),
    ];
    return buildModel({ checklistRows, inputRows });
  } catch {
    return null;
  }
}

async function handleWorkbookFile(file) {
  try {
    setStatus('Reading workbook…');
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'array' });
    const model = loadModelFromWorkbook(workbook);
    state.model = model;
    persistModel(model);
    setStatus(`Loaded ${model.items.length} items and ${model.inputs.length} inputs.`, 'ok');
  } catch (err) {
    state.model = null;
    setStatus('Could not load workbook: ' + err.message, 'error');
  }
}

function wireSetup() {
  document.getElementById('workbook-file').addEventListener('change', e => {
    const file = e.target.files[0];
    if (file) handleWorkbookFile(file);
  });
}

// Placeholder renderers implemented in later tasks.
function renderDashboard() { /* Task 8 */ }

function init() {
  state.model = restoreModel();
  wireSetup();
  document.getElementById('nav-dashboard').addEventListener('click', () => showScreen('dashboard'));
  document.getElementById('nav-setup').addEventListener('click', () => showScreen('setup'));
  showScreen(state.model ? 'dashboard' : 'setup');
}

init();

export { state, showScreen };
