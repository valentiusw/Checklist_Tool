import { buildModel } from './workbookModel.js';
import { createProjectStore } from './projectStore.js';
import { computeProgress, applicableItems, buildExportRows } from './exporter.js';

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

function renderDashboard() {
  const list = document.getElementById('project-list');
  const empty = document.getElementById('dashboard-empty');
  list.innerHTML = '';
  empty.hidden = !!state.model;
  if (!state.model) return;

  const projects = state.store.listProjects();
  for (const summary of projects) {
    const project = state.store.getProject(summary.id);
    const { checked, applicable, ratio } = computeProgress(state.model, project);
    const li = document.createElement('li');
    li.className = 'project-card';
    li.innerHTML = `
      <div class="row-between">
        <strong>${escapeHtml(project.name)}</strong>
        <span>
          <button data-open="${project.id}">Open</button>
          <button data-delete="${project.id}">Delete</button>
        </span>
      </div>
      <div class="progress"><div class="progress-bar" style="width:${Math.round(ratio * 100)}%"></div></div>
      <p class="muted">${checked} / ${applicable} checked</p>`;
    list.appendChild(li);
  }

  list.querySelectorAll('[data-open]').forEach(btn =>
    btn.addEventListener('click', () => openProject(btn.getAttribute('data-open'))));
  list.querySelectorAll('[data-delete]').forEach(btn =>
    btn.addEventListener('click', () => {
      if (confirm('Delete this project?')) {
        state.store.deleteProject(btn.getAttribute('data-delete'));
        renderDashboard();
      }
    }));
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function openProject(id) {
  state.currentProjectId = id;
  showScreen('project');
  if (typeof renderProject === 'function') renderProject();
}

function getCurrentProject() {
  return state.store.getProject(state.currentProjectId);
}

function saveCurrent(project) {
  state.store.saveProject(project);
}

function defaultInputValue(def) {
  if (def.type === 'Boolean') return /^true$/i.test(String(def.default)) ;
  if (def.type === 'Float' || def.type === 'Integer') return def.default === '' ? 0 : Number(def.default);
  if (def.type === 'Choice') return def.default || (def.choices[0] ?? '');
  return def.default;
}

function renderInputs(project) {
  const panel = document.getElementById('inputs-panel');
  panel.innerHTML = '<h3>Project inputs</h3>';
  for (const def of state.model.inputs) {
    if (!(def.name in project.inputs)) project.inputs[def.name] = defaultInputValue(def);
    const value = project.inputs[def.name];
    const label = document.createElement('label');
    label.textContent = def.label + (def.unit ? ` (${def.unit})` : '');
    panel.appendChild(label);

    let control;
    if (def.type === 'Boolean') {
      control = document.createElement('input');
      control.type = 'checkbox';
      control.checked = value === true;
      control.addEventListener('change', () => updateInput(def.name, control.checked));
    } else if (def.type === 'Choice') {
      control = document.createElement('select');
      for (const c of def.choices) {
        const opt = document.createElement('option');
        opt.value = c; opt.textContent = c;
        if (c === value) opt.selected = true;
        control.appendChild(opt);
      }
      control.addEventListener('change', () => updateInput(def.name, control.value));
    } else {
      control = document.createElement('input');
      control.type = 'number';
      if (def.type === 'Integer') control.step = '1';
      control.value = value;
      control.addEventListener('input', () => updateInput(def.name, control.value === '' ? '' : Number(control.value)));
    }
    panel.appendChild(control);
  }
}

function updateInput(name, value) {
  const project = getCurrentProject();
  project.inputs[name] = value;
  saveCurrent(project);
  renderItems(project);
  renderProgress(project);
}

function renderItems(project) {
  const container = document.getElementById('items-list');
  container.innerHTML = '';
  const items = applicableItems(state.model, project.inputs);
  for (const item of items) {
    const checked = project.checks[item.id] === true;
    const div = document.createElement('div');
    div.className = 'item' + (checked ? ' checked' : '');
    div.innerHTML = `
      <div class="item-head">
        <input type="checkbox" data-check="${escapeHtml(item.id)}" ${checked ? 'checked' : ''} />
        <div>
          <span class="id">${escapeHtml(item.id)}</span> — ${escapeHtml(item.description)}
          ${item.code ? `<span class="muted">[${escapeHtml(item.code)}]</span>` : ''}
          ${item.note ? `<div class="item-note">${escapeHtml(item.note)}</div>` : ''}
          ${item.example ? `<div class="item-example"><em>How to complete:</em> ${escapeHtml(item.example)}</div>` : ''}
        </div>
      </div>`;
    const ta = document.createElement('textarea');
    ta.placeholder = 'Your comment for this item…';
    ta.rows = 2;
    ta.value = project.comments[item.id] || '';
    ta.addEventListener('input', () => {
      const p = getCurrentProject();
      p.comments[item.id] = ta.value;
      saveCurrent(p);
    });
    div.appendChild(ta);
    container.appendChild(div);
  }

  container.querySelectorAll('[data-check]').forEach(cb =>
    cb.addEventListener('change', () => {
      const p = getCurrentProject();
      p.checks[cb.getAttribute('data-check')] = cb.checked;
      saveCurrent(p);
      renderItems(p);
      renderProgress(p);
    }));
}

function renderProgress(project) {
  const { checked, applicable, ratio } = computeProgress(state.model, project);
  document.getElementById('project-progress-bar').style.width = Math.round(ratio * 100) + '%';
  document.getElementById('project-progress-label').textContent = `${checked} / ${applicable} checked`;
}

function renderProject() {
  const project = getCurrentProject();
  if (!project) { showScreen('dashboard'); return; }
  document.getElementById('project-title').textContent = project.name;
  renderInputs(project);
  // persist any defaults just applied
  saveCurrent(project);
  renderItems(project);
  renderProgress(project);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function exportUnchecked() {
  const project = getCurrentProject();
  const rows = buildExportRows(state.model, project);
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Unchecked');
  const safeName = project.name.replace(/[^\w\-]+/g, '_');
  const date = new Date().toISOString().slice(0, 10);
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  downloadBlob(new Blob([out], { type: 'application/octet-stream' }), `${safeName}_unchecked_${date}.xlsx`);
}

function saveProjectFile() {
  const project = getCurrentProject();
  const json = state.store.serializeProject(project);
  const safeName = project.name.replace(/[^\w\-]+/g, '_');
  downloadBlob(new Blob([json], { type: 'application/json' }), `${safeName}.json`);
}

function init() {
  state.model = restoreModel();
  wireSetup();
  document.getElementById('nav-dashboard').addEventListener('click', () => showScreen('dashboard'));
  document.getElementById('nav-setup').addEventListener('click', () => showScreen('setup'));
  document.getElementById('btn-back').addEventListener('click', () => showScreen('dashboard'));

  document.getElementById('btn-new-project').addEventListener('click', () => {
    if (!state.model) { alert('Load a checklist workbook in Setup first.'); return; }
    const name = prompt('Project name?');
    if (!name) return;
    const project = state.store.createProject(name);
    openProject(project.id);
  });

  document.getElementById('import-project-file').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      state.store.importProject(text);
      renderDashboard();
    } catch (err) {
      alert('Could not import project: ' + err.message);
    }
    e.target.value = '';
  });

  document.getElementById('btn-export').addEventListener('click', exportUnchecked);
  document.getElementById('btn-save-project').addEventListener('click', saveProjectFile);

  showScreen(state.model ? 'dashboard' : 'setup');
}

init();

export { state, showScreen };
