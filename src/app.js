import { buildModel } from './workbookModel.js';
import { createProjectStore } from './projectStore.js';
import { computeProgress, computeProjectProgress, applicableItems, buildExportPlan } from './exporter.js';
import * as exampleStore from './exampleStore.js';
import { readSetupZip, buildExportZip } from './zipBundle.js';
import * as db from './db.js';
import { readLegacy } from './legacyMigration.js';
import * as fileBackup from './fileBackup.js';
import { buildSnapshot, parseSnapshot, chooseNewer } from './librarySnapshot.js';

const state = {
  model: null,
  store: createProjectStore({ onChange: onStoreChange }),
  currentProjectId: null,
  currentUnitId: null,
  sectionFilter: '',
  hideChecked: false,
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

function serializeModel(model) {
  return {
    items: model.items.map(({ condition, ...rest }) => rest),
    inputs: model.inputs,
    sections: model.sections,
    glossary: model.glossary,
  };
}

function rebuildModel(data) {
  const inputRows = [
    ['Name', 'Type', 'Label', 'Unit', 'Choices', 'Default'],
    ...data.inputs.map(i => [i.name, i.type, i.label, i.unit, i.choices.join(';'), i.default]),
  ];
  const checklistRows = [
    ['Item ID', 'Conditions', 'Description', 'Code', 'Note', 'Example'],
    ...data.items.map(i => [i.id, i.conditionsText, i.description, i.code, i.note, i.exampleFile || i.exampleImage || i.example]),
  ];
  const sectionRows = (data.sections && data.sections.length)
    ? [['Prefix', 'Name'], ...data.sections.map(s => [s.prefix, s.name])]
    : undefined;
  const glossaryRows = (data.glossary && data.glossary.length)
    ? [['Term', 'Meaning'], ...data.glossary.map(g => [g.term, g.meaning])]
    : undefined;
  return buildModel({ checklistRows, inputRows, sectionRows, glossaryRows });
}

// --- Persistence: in-memory edits flushed to IndexedDB (debounced) ----------
const dirty = { model: false, upserts: new Set(), deletes: new Set() };
let flushTimer = null;
const backup = { handle: null, savedAt: null };
let fileTimer = null;

function onStoreChange(info) {
  if (info.type === 'delete') { dirty.deletes.add(info.id); dirty.upserts.delete(info.id); }
  else { dirty.upserts.add(info.id); dirty.deletes.delete(info.id); }
  scheduleFlush();
}

function markModelDirty() { dirty.model = true; scheduleFlush(); }

function scheduleFlush() {
  clearTimeout(flushTimer);
  flushTimer = setTimeout(flushToDb, 300);
  scheduleBackup();
}

async function flushToDb() {
  try {
    if (dirty.model && state.model) { await db.setMeta('model', serializeModel(state.model)); dirty.model = false; }
    for (const id of [...dirty.deletes]) { await db.deleteProject(id); dirty.deletes.delete(id); }
    for (const id of [...dirty.upserts]) {
      const p = state.store.getProject(id);
      if (p) await db.putProject(p);
      dirty.upserts.delete(id);
    }
    await db.setMeta('savedAt', new Date().toISOString());
  } catch (err) {
    console.error('Persist failed:', err);
  }
}

function currentSnapshotText() {
  const projects = state.store.listProjects().map(s => state.store.getProject(s.id)).filter(Boolean);
  backup.savedAt = new Date().toISOString();
  return buildSnapshot(state.model ? serializeModel(state.model) : null, projects, backup.savedAt);
}

function scheduleBackup() {
  if (!backup.handle) return;
  clearTimeout(fileTimer);
  fileTimer = setTimeout(writeBackup, 1000);
}

async function writeBackup() {
  if (!backup.handle) return;
  try {
    if (!(await fileBackup.ensurePermission(backup.handle, 'readwrite'))) { setBackupStatus('reconnect needed', 'warn'); return; }
    await fileBackup.writeSnapshot(backup.handle, currentSnapshotText());
    setBackupStatus('saved ✓', 'ok');
  } catch (err) {
    console.error('Backup write failed:', err);
    setBackupStatus('auto-save paused — reconnect', 'warn');
  }
}

function setBackupStatus(text, kind) {
  const el = document.getElementById('backup-status');
  if (!el) return;
  el.textContent = text ? '· ' + text : '';
  el.className = kind || '';
}

// Load a parsed snapshot into memory + IndexedDB (used by reconcile/recovery).
async function applySnapshot(snap) {
  await db.clearProjects();
  state.store.load(snap.projects);
  for (const p of snap.projects) await db.putProject(p);
  if (snap.model) { await db.setMeta('model', snap.model); state.model = rebuildModel(snap.model); }
  await db.setMeta('savedAt', snap.savedAt || new Date().toISOString());
}

async function reconcileWithFile() {
  const text = await fileBackup.readSnapshot(backup.handle);
  let fileSnap = null;
  try { fileSnap = parseSnapshot(text); } catch { fileSnap = null; }
  const localSavedAt = await db.getMeta('savedAt');
  if (!fileSnap) { await writeBackup(); return; } // empty/new file: seed it
  const winner = chooseNewer(localSavedAt, fileSnap.savedAt);
  if (winner === 'file') { await applySnapshot(fileSnap); renderDashboard(); }
  else if (winner === 'local') { await writeBackup(); }
}

function renderBackupControls() {
  const controls = document.getElementById('backup-controls');
  if (!fileBackup.isSupported()) {
    controls.innerHTML = '';
    setBackupStatus('not available in this browser — use Save/Restore above', '');
    return;
  }
  controls.innerHTML = backup.handle
    ? `<button id="btn-disconnect-backup" class="btn-sm">Disconnect</button>`
    : `<button id="btn-open-backup" class="btn-sm">Open existing backup…</button>` +
      `<button id="btn-connect-backup" class="btn-primary">Back up to a file…</button>`;
  if (backup.handle) {
    document.getElementById('btn-disconnect-backup').addEventListener('click', async () => {
      backup.handle = null; await db.setMeta('backupHandle', null); setBackupStatus('disconnected', ''); renderBackupControls();
    });
  } else {
    document.getElementById('btn-connect-backup').addEventListener('click', async () => {
      const handle = await fileBackup.connect();
      if (!handle) return;
      backup.handle = handle; await db.setMeta('backupHandle', handle);
      await writeBackup(); renderBackupControls();
    });
    document.getElementById('btn-open-backup').addEventListener('click', async () => {
      const handle = await fileBackup.connectExisting();
      if (!handle) return;
      backup.handle = handle; await db.setMeta('backupHandle', handle);
      try { await reconcileWithFile(); } catch (err) { setBackupStatus('could not read file', 'warn'); }
      renderBackupControls();
    });
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
    markModelDirty();
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

// Circular info button shown on items that carry an example file (image/PDF).
const INFO_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><line x1="12" y1="11" x2="12" y2="16"/><line x1="12" y1="8" x2="12" y2="8"/></svg>`;

function renderItems(unit) {
  const container = document.getElementById('items-list');
  container.innerHTML = '';
  let items = applicableItems(state.model, unit.inputs);
  if (state.sectionFilter) items = items.filter(i => i.sectionPrefix === state.sectionFilter);

  // Per-section totals computed from the full applicable list so the counts
  // stay stable regardless of the "hide checked" view filter.
  const total = new Map();
  const done = new Map();
  for (const i of items) {
    total.set(i.section, (total.get(i.section) || 0) + 1);
    if (unit.checks[i.id] === true) done.set(i.section, (done.get(i.section) || 0) + 1);
  }

  const visible = state.hideChecked ? items.filter(i => unit.checks[i.id] !== true) : items;
  let currentSection = null;
  for (const item of visible) {
    if (item.section !== currentSection) {
      currentSection = item.section;
      const h = document.createElement('h3');
      h.className = 'section-heading';
      h.innerHTML = `<span>${escapeHtml(currentSection)}</span>` +
        `<span class="section-count">${done.get(currentSection) || 0} / ${total.get(currentSection) || 0}</span>`;
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
        ${item.exampleFile ? `<button type="button" class="item-info" data-example="${escapeHtml(item.exampleFile)}" title="View example" aria-label="View example for ${escapeHtml(item.id)}">${INFO_ICON}</button>` : ''}
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

  if (visible.length === 0) {
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = state.hideChecked
      ? 'All applicable items are checked. ✓'
      : 'No applicable items for the current inputs.';
    container.appendChild(p);
  }

  container.querySelectorAll('[data-check]').forEach(cb =>
    cb.addEventListener('change', () => {
      const { project, unit: u } = getCurrentProjectAndUnit();
      u.checks[cb.getAttribute('data-check')] = cb.checked;
      saveCurrent(project);
      renderItems(u);
      renderProgress();
    }));
  container.querySelectorAll('[data-example]').forEach(btn =>
    btn.addEventListener('click', () => openExample(btn.getAttribute('data-example'))));
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|svg)$/i;

// Open an item's example file from the in-browser library: images in a
// lightbox, everything else (PDFs) in a new tab.
async function openExample(name) {
  let blob;
  try {
    blob = await exampleStore.get(name);
  } catch {
    alert(`Could not read example "${name}" from your library.`);
    return;
  }
  if (!blob) {
    alert(`Example file "${name}" isn't in your library. Re-import your setup ZIP to include it.`);
    return;
  }
  const url = URL.createObjectURL(blob);
  if (IMAGE_EXT.test(name)) {
    showLightbox(url, name);
  } else {
    window.open(url, '_blank', 'noopener');
    // The new tab now owns the URL; revoke after a grace period.
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
}

function showLightbox(url, name) {
  const overlay = document.createElement('div');
  overlay.className = 'lightbox';
  overlay.innerHTML =
    `<figure class="lightbox-fig"><img src="${url}" alt="Example: ${escapeHtml(name)}">` +
    `<figcaption>${escapeHtml(name)}</figcaption></figure>`;
  const onKey = e => { if (e.key === 'Escape') close(); };
  function close() {
    overlay.remove();
    URL.revokeObjectURL(url);
    document.removeEventListener('keydown', onKey);
  }
  overlay.addEventListener('click', close);
  document.addEventListener('keydown', onKey);
  document.body.appendChild(overlay);
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

async function init() {
  let snap = { model: null, projects: [], savedAt: null };
  try {
    await db.open();
    snap = await db.loadSnapshot();
    if (!snap.model && snap.projects.length === 0) {
      const legacy = readLegacy(window.localStorage);
      if (legacy.model || legacy.projects.length) {
        if (legacy.model) await db.setMeta('model', legacy.model);
        for (const p of legacy.projects) await db.putProject(p);
        await db.setMeta('savedAt', new Date().toISOString());
        snap = { model: legacy.model, projects: legacy.projects, savedAt: new Date().toISOString() };
      }
    }
  } catch (err) {
    console.error('Storage unavailable, running in-memory for this session:', err);
  }
  state.model = snap.model ? rebuildModel(snap.model) : null;
  state.store.load(snap.projects);
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
  document.getElementById('toggle-hide-checked').addEventListener('change', e => {
    state.hideChecked = e.target.checked;
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

  try {
    const storedHandle = await db.getMeta('backupHandle');
    if (storedHandle && fileBackup.isSupported()) {
      backup.handle = storedHandle;
      setBackupStatus('reconnect to resume auto-save', 'warn');
    }
  } catch { /* no stored handle */ }
  renderBackupControls();
  if (backup.handle) {
    // Permission must be re-granted with a user gesture; expose a one-click reconnect.
    const controls = document.getElementById('backup-controls');
    controls.insertAdjacentHTML('afterbegin', `<button id="btn-reconnect-backup" class="btn-primary">Reconnect backup</button>`);
    document.getElementById('btn-reconnect-backup').addEventListener('click', async () => {
      if (!(await fileBackup.ensurePermission(backup.handle, 'readwrite'))) { setBackupStatus('permission denied', 'warn'); return; }
      try { await reconcileWithFile(); setBackupStatus('saved ✓', 'ok'); renderBackupControls(); }
      catch (err) { setBackupStatus('could not read file', 'warn'); }
    });
  }

  showScreen(state.model ? 'dashboard' : 'setup');
}

init();

export { state, showScreen };
