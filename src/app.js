import { buildModel } from './workbookModel.js';
import { createProjectStore } from './projectStore.js';
import { computeProgress, computeProjectProgress, applicableItems, buildExportPlan } from './exporter.js';
import * as exampleStore from './exampleStore.js';
import { readSetupZip, buildExportZip } from './zipBundle.js';

const MODEL_KEY = 'dpchecklist.model';

const state = {
  model: null,
  store: createProjectStore(window.localStorage),
  currentProjectId: null,
  currentUnitId: null,
  sectionFilter: '',
};

const screens = ['setup', 'dashboard', 'project', 'about'];
// Which sidebar link is highlighted for each screen (project lives under Projects).
const NAV_FOR_SCREEN = { setup: 'nav-setup', dashboard: 'nav-dashboard', project: 'nav-dashboard', about: 'nav-about' };
function showScreen(name) {
  for (const s of screens) {
    document.getElementById('screen-' + s).hidden = s !== name;
  }
  for (const id of ['nav-dashboard', 'nav-about', 'nav-setup']) {
    document.getElementById(id).classList.toggle('active', NAV_FOR_SCREEN[name] === id);
  }
  if (name === 'dashboard') renderDashboard();
  if (name === 'about') renderAbout();
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

function optionalSheetToRows(workbook, name) {
  const ws = workbook.Sheets[name];
  if (!ws) return undefined;
  return XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: '' });
}

function loadModelFromWorkbook(workbook) {
  const checklistRows = sheetToRows(workbook, 'Checklist');
  const inputRows = sheetToRows(workbook, 'Inputs');
  const sectionRows = optionalSheetToRows(workbook, 'Sections');
  const glossaryRows = optionalSheetToRows(workbook, 'Glossary');
  return buildModel({ checklistRows, inputRows, sectionRows, glossaryRows });
}

function persistModel(model) {
  const serializable = {
    items: model.items.map(({ condition, ...rest }) => rest),
    inputs: model.inputs,
    sections: model.sections,
    glossary: model.glossary,
  };
  window.localStorage.setItem(MODEL_KEY, JSON.stringify(serializable));
}

function restoreModel() {
  const raw = window.localStorage.getItem(MODEL_KEY);
  if (!raw) return null;
  try {
    const data = JSON.parse(raw);
    const inputRows = [
      ['Name', 'Type', 'Label', 'Unit', 'Choices', 'Default'],
      ...data.inputs.map(i => [i.name, i.type, i.label, i.unit, i.choices.join(';'), i.default]),
    ];
    const checklistRows = [
      ['Item ID', 'Conditions', 'Description', 'Code', 'Note', 'Example'],
      // The single Example cell holds either the prose or the file name.
      ...data.items.map(i => [i.id, i.conditionsText, i.description, i.code, i.note, i.exampleFile || i.exampleImage || i.example]),
    ];
    const sectionRows = (data.sections && data.sections.length)
      ? [['Prefix', 'Name'], ...data.sections.map(s => [s.prefix, s.name])]
      : undefined;
    const glossaryRows = (data.glossary && data.glossary.length)
      ? [['Term', 'Meaning'], ...data.glossary.map(g => [g.term, g.meaning])]
      : undefined;
    return buildModel({ checklistRows, inputRows, sectionRows, glossaryRows });
  } catch {
    return null;
  }
}

async function handleSetupFile(file) {
  try {
    setStatus('Reading setup…');
    const buffer = await file.arrayBuffer();
    let workbookBuffer = buffer;
    let files = new Map();
    if (/\.zip$/i.test(file.name)) {
      const res = await readSetupZip(buffer);
      workbookBuffer = res.workbookArrayBuffer;
      files = res.files;
    }
    const workbook = XLSX.read(workbookBuffer, { type: 'array' });
    const model = loadModelFromWorkbook(workbook);
    await exampleStore.clear();
    if (files.size) await exampleStore.putAll(files);
    state.model = model;
    persistModel(model);
    setStatus(`Loaded ${model.items.length} items, ${model.inputs.length} inputs, ${files.size} example file${files.size === 1 ? '' : 's'}.`, 'ok');
  } catch (err) {
    state.model = null;
    setStatus('Could not load setup: ' + err.message, 'error');
  }
}

function wireSetup() {
  document.getElementById('workbook-file').addEventListener('change', e => {
    const file = e.target.files[0];
    if (file) handleSetupFile(file);
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
    const { checked, applicable, ratio } = computeProjectProgress(state.model, project);
    const unitRows = project.units.map(u => {
      const p = computeProgress(state.model, u);
      return `
        <div class="unit-row">
          <span class="unit-name">${escapeHtml(u.name)}</span>
          <div class="progress progress-sm"><div class="progress-bar" style="width:${Math.round(p.ratio * 100)}%"></div></div>
          <span class="unit-count muted">${p.checked} / ${p.applicable}</span>
        </div>`;
    }).join('');
    const li = document.createElement('li');
    li.className = 'project-card';
    li.innerHTML = `
      <div class="row-between">
        <strong>${escapeHtml(project.name)}</strong>
        <span class="btn-row">
          <button class="btn-ghost btn-sm" data-toggle="${project.id}" aria-expanded="false">Expand</button>
          <button class="btn-primary btn-sm" data-open="${project.id}">Open</button>
          <button class="btn-danger btn-sm" data-delete="${project.id}">Delete</button>
        </span>
      </div>
      <div class="progress"><div class="progress-bar" style="width:${Math.round(ratio * 100)}%"></div></div>
      <p class="muted">${project.units.length} unit${project.units.length === 1 ? '' : 's'} · ${checked} / ${applicable} checked</p>
      <div class="unit-breakdown" hidden>${unitRows}</div>`;
    list.appendChild(li);
  }

  list.querySelectorAll('[data-toggle]').forEach(btn =>
    btn.addEventListener('click', () => {
      const breakdown = btn.closest('.project-card').querySelector('.unit-breakdown');
      const show = breakdown.hidden;
      breakdown.hidden = !show;
      btn.textContent = show ? 'Collapse' : 'Expand';
      btn.setAttribute('aria-expanded', String(show));
    }));
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

function renderAbout() {
  const model = state.model;
  const sections = (model && model.sections) || [];
  const glossary = (model && model.glossary) || [];
  document.getElementById('about-empty').hidden = !(sections.length === 0 && glossary.length === 0);

  const secTable = document.getElementById('about-sections');
  secTable.innerHTML = '<tr><th>Prefix</th><th>Section</th></tr>' +
    sections.map(s => `<tr><td>${escapeHtml(s.prefix)}</td><td>${escapeHtml(s.name)}</td></tr>`).join('');

  const gloTable = document.getElementById('about-glossary');
  gloTable.innerHTML = '<tr><th>Term</th><th>Meaning</th></tr>' +
    glossary.map(g => `<tr><td>${escapeHtml(g.term)}</td><td>${escapeHtml(g.meaning)}</td></tr>`).join('');
}

function openProject(id) {
  state.currentProjectId = id;
  const project = getCurrentProject();
  state.currentUnitId = project && project.units[0] ? project.units[0].id : null;
  showScreen('project');
  renderProject();
}

function getCurrentProject() {
  return state.store.getProject(state.currentProjectId);
}

function unitOf(project) {
  if (!project) return null;
  return project.units.find(u => u.id === state.currentUnitId) || project.units[0];
}

function getCurrentUnit() {
  return unitOf(getCurrentProject());
}

// Read the project once so a mutation and the save that follows act on the SAME
// object — getCurrentProject() returns a fresh copy from storage on every call.
function getCurrentProjectAndUnit() {
  const project = getCurrentProject();
  return { project, unit: unitOf(project) };
}

function saveCurrent(project) {
  state.store.saveProject(project);
}

function defaultInputValue(def) {
  if (def.type === 'Boolean') return /^true$/i.test(String(def.default)) ;
  if (def.type === 'Float' || def.type === 'Integer') return def.default === '' ? 0 : Number(def.default);
  if (def.type === 'Choice') return def.choices.includes(def.default) ? def.default : (def.choices[0] ?? '');
  return def.default;
}

function renderInputs(unit) {
  const panel = document.getElementById('inputs-panel');
  panel.innerHTML = '<h3>Project inputs</h3>';
  for (const def of state.model.inputs) {
    if (!(def.name in unit.inputs)) unit.inputs[def.name] = defaultInputValue(def);
    const value = unit.inputs[def.name];
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
  const { project, unit } = getCurrentProjectAndUnit();
  unit.inputs[name] = value;
  saveCurrent(project);
  renderItems(unit);
  renderProgress();
}

function renderItems(unit) {
  const container = document.getElementById('items-list');
  container.innerHTML = '';
  let items = applicableItems(state.model, unit.inputs);
  if (state.sectionFilter) items = items.filter(i => i.sectionPrefix === state.sectionFilter);
  let currentSection = null;
  for (const item of items) {
    if (item.section !== currentSection) {
      currentSection = item.section;
      const h = document.createElement('h3');
      h.className = 'section-heading';
      h.textContent = currentSection;
      container.appendChild(h);
    }
    const checked = unit.checks[item.id] === true;
    const div = document.createElement('div');
    div.className = 'item' + (checked ? ' checked' : '');
    div.innerHTML = `
      <div class="item-head">
        <input type="checkbox" data-check="${escapeHtml(item.id)}" ${checked ? 'checked' : ''} />
        <div>
          <span class="id">${escapeHtml(item.id)}</span> — ${escapeHtml(item.description)}
          ${item.code ? `<span class="code-tag">${escapeHtml(item.code)}</span>` : ''}
          ${item.note ? `<div class="item-note">${escapeHtml(item.note)}</div>` : ''}
        </div>
      </div>`;
    const ta = document.createElement('textarea');
    ta.placeholder = 'Your comment for this item…';
    ta.rows = 2;
    ta.value = unit.comments[item.id] || '';
    ta.addEventListener('input', () => {
      const { project, unit: u } = getCurrentProjectAndUnit();
      u.comments[item.id] = ta.value;
      saveCurrent(project);
    });
    div.appendChild(ta);
    container.appendChild(div);
  }

  container.querySelectorAll('[data-check]').forEach(cb =>
    cb.addEventListener('change', () => {
      const { project, unit: u } = getCurrentProjectAndUnit();
      u.checks[cb.getAttribute('data-check')] = cb.checked;
      saveCurrent(project);
      renderItems(u);
      renderProgress();
    }));
}

function renderProgress() {
  const project = getCurrentProject();
  const unit = getCurrentUnit();
  const u = computeProgress(state.model, unit);
  const all = computeProjectProgress(state.model, project);
  document.getElementById('project-progress-bar').style.width = Math.round(u.ratio * 100) + '%';
  document.getElementById('project-progress-label').textContent =
    `${u.checked} / ${u.applicable} checked in this unit · ${all.checked} / ${all.applicable} across project`;
}

function renderUnitBar() {
  const project = getCurrentProject();
  const sel = document.getElementById('unit-select');
  sel.innerHTML = '';
  for (const u of project.units) {
    const opt = document.createElement('option');
    opt.value = u.id;
    opt.textContent = u.name;
    if (u.id === state.currentUnitId) opt.selected = true;
    sel.appendChild(opt);
  }
  document.getElementById('btn-delete-unit').disabled = project.units.length <= 1;
}

function renderSectionFilter() {
  const sel = document.getElementById('section-select');
  sel.innerHTML = '';
  const allOpt = document.createElement('option');
  allOpt.value = '';
  allOpt.textContent = 'All sections';
  sel.appendChild(allOpt);
  for (const s of state.model.sections) {
    const opt = document.createElement('option');
    opt.value = s.prefix;
    opt.textContent = s.name;
    if (s.prefix === state.sectionFilter) opt.selected = true;
    sel.appendChild(opt);
  }
}

function renderProject() {
  const project = getCurrentProject();
  if (!project) { showScreen('dashboard'); return; }
  if (!getCurrentUnit()) state.currentUnitId = project.units[0].id;
  document.getElementById('project-title').textContent = project.name;
  renderUnitBar();
  renderSectionFilter();
  const unit = unitOf(project);
  renderInputs(unit);
  // persist any defaults just applied (unit belongs to `project`, so they are saved)
  saveCurrent(project);
  renderItems(unit);
  renderProgress();
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  // Defer cleanup: revoking the URL synchronously can cancel the download in some browsers.
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 1500);
}

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

async function downloadProjectZip() {
  try {
    const project = getCurrentProject();
    const plan = buildExportPlan(state.model, project);
    const wb = XLSX.utils.book_new();
    const used = new Set();
    for (const unit of plan.units) {
      const header = ['Item ID', 'Description', 'Code', 'Comments', 'Example'];
      const aoa = [header, ...unit.rows.map(r => [r.id, r.description, r.code, r.comment, r.exampleFile || r.example])];
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      ws['!cols'] = [{ wch: 10 }, { wch: 42 }, { wch: 14 }, { wch: 28 }, { wch: 40 }];
      // Bold the header row.
      for (let c = 0; c < header.length; c++) {
        const addr = XLSX.utils.encode_cell({ r: 0, c });
        if (ws[addr]) ws[addr].s = { font: { bold: true } };
      }
      // Example column is index 4; file rows get a relative hyperlink to Examples/,
      // styled like a clickable link (blue + underlined).
      unit.rows.forEach((r, i) => {
        if (!r.exampleFile) return;
        const addr = XLSX.utils.encode_cell({ r: i + 1, c: 4 });
        if (!ws[addr]) ws[addr] = { t: 's', v: r.exampleFile };
        ws[addr].l = { Target: 'Examples/' + r.exampleFile, Tooltip: 'Open ' + r.exampleFile };
        ws[addr].s = { font: { color: { rgb: 'FF0563C1' }, underline: true } };
      });
      XLSX.utils.book_append_sheet(wb, ws, sanitizeSheetName(unit.name, used));
    }
    const workbookArrayBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array', cellStyles: true });

    const files = new Map();
    const missing = [];
    for (const name of plan.referencedFiles) {
      const blob = await exampleStore.get(name);
      if (blob) files.set(name, blob);
      else missing.push(name);
    }

    const safeName = project.name.replace(/[^\w\-]+/g, '_');
    const date = new Date().toISOString().slice(0, 10);
    const zipBlob = await buildExportZip({
      workbookName: `${safeName}_unchecked_${date}.xlsx`,
      workbookArrayBuffer,
      files,
    });
    downloadBlob(zipBlob, `${safeName}_${date}.zip`);
    if (missing.length) {
      alert(`Exported. These referenced files weren't in your library:\n${missing.join('\n')}`);
    }
  } catch (err) {
    alert('Could not build the ZIP: ' + err.message);
  }
}

function saveProjectFile() {
  const project = getCurrentProject();
  const json = state.store.serializeProject(project);
  const safeName = project.name.replace(/[^\w\-]+/g, '_');
  downloadBlob(new Blob([json], { type: 'application/json' }), `${safeName}.json`);
}

function saveLibraryFile() {
  const count = state.store.listProjects().length;
  if (count === 0) {
    alert('There are no projects to save yet. Create at least one project first.');
    return;
  }
  const json = state.store.serializeLibrary();
  const date = new Date().toISOString().slice(0, 10);
  downloadBlob(new Blob([json], { type: 'application/json' }), `checklist-library-${date}.json`);
  setStatus(`Saved a backup of ${count} project${count === 1 ? '' : 's'}.`, 'ok');
}


const THEME_KEY = 'dpchecklist.theme';
function wireThemeToggle() {
  const toggle = document.getElementById('toggle-dark');
  toggle.checked = document.documentElement.getAttribute('data-theme') === 'dark';
  toggle.addEventListener('change', () => {
    const dark = toggle.checked;
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    try { window.localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light'); } catch { /* ignore */ }
  });
}

function init() {
  state.model = restoreModel();
  wireSetup();
  wireThemeToggle();
  document.getElementById('nav-dashboard').addEventListener('click', () => showScreen('dashboard'));
  document.getElementById('nav-about').addEventListener('click', () => showScreen('about'));
  document.getElementById('nav-setup').addEventListener('click', () => showScreen('setup'));
  document.getElementById('btn-back').addEventListener('click', () => showScreen('dashboard'));

  document.getElementById('unit-select').addEventListener('change', e => {
    state.currentUnitId = e.target.value;
    renderProject();
  });
  document.getElementById('section-select').addEventListener('change', e => {
    state.sectionFilter = e.target.value;
    renderItems(getCurrentUnit());
  });
  document.getElementById('btn-add-unit').addEventListener('click', () => {
    const name = prompt('New unit name?', 'Unit ' + (getCurrentProject().units.length + 1));
    if (!name) return;
    const project = getCurrentProject();
    const unit = state.store.newUnit(name);
    project.units.push(unit);
    saveCurrent(project);
    state.currentUnitId = unit.id;
    renderProject();
  });
  document.getElementById('btn-rename-unit').addEventListener('click', () => {
    const { project, unit } = getCurrentProjectAndUnit();
    const name = prompt('Rename unit', unit.name);
    if (!name) return;
    unit.name = name;
    saveCurrent(project);
    renderProject();
  });
  document.getElementById('btn-delete-unit').addEventListener('click', () => {
    const project = getCurrentProject();
    if (project.units.length <= 1) { alert('A project needs at least one unit.'); return; }
    if (!confirm('Delete this unit?')) return;
    project.units = project.units.filter(u => u.id !== state.currentUnitId);
    state.currentUnitId = project.units[0].id;
    saveCurrent(project);
    renderProject();
  });

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

  document.getElementById('btn-save-project').addEventListener('click', saveProjectFile);
  document.getElementById('btn-download-zip').addEventListener('click', downloadProjectZip);
  document.getElementById('btn-save-library').addEventListener('click', saveLibraryFile);

  document.getElementById('restore-library-file').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    if (confirm('Restore projects from this file? Projects with the same id will be overwritten.')) {
      try {
        const n = state.store.importLibrary(await file.text());
        alert(`Restored ${n} project${n === 1 ? '' : 's'} into your library.`);
        renderDashboard();
      } catch (err) {
        alert('Could not restore library: ' + err.message);
      }
    }
    e.target.value = '';
  });

  showScreen(state.model ? 'dashboard' : 'setup');
}

init();

export { state, showScreen };
