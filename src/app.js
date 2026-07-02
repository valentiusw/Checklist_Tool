import { buildModel } from './workbookModel.js';
import { createProjectStore } from './projectStore.js';
import { computeProgress, computeProjectProgress, applicableItems, buildExportPlan } from './exporter.js';
import * as exampleStore from './exampleStore.js';
import { readSetupZip, buildExportZip } from './zipBundle.js';
import * as db from './db.js';
import { readLegacy } from './legacyMigration.js';
import * as fileBackup from './fileBackup.js';
import { buildSnapshot, parseSnapshot, chooseNewer } from './librarySnapshot.js';
import { defaultInputValue, validateDraft, newBlankDraft, newDraftUnit } from './projectDraft.js';
import { itemApplicableUnits, itemCheckState, unifiedItems } from './checklistView.js';

const state = {
  model: null,
  store: createProjectStore({ onChange: onStoreChange }),
  currentProjectId: null,
  currentUnitId: null,
  sectionFilter: '',
  hideChecked: false,
  editor: null, // { draft, isNew, dirty }
  viewerUnitId: null,
  editorItemId: null,
  editorUnitId: null,
  detailMode: 'editor', // 'editor' (item detail+comment) | 'project' (read-only unit details)
  selectedProjectId: null, // highlighted project on the dashboard
};

const screens = ['setup', 'dashboard', 'project', 'about', 'editor'];
// Which sidebar link is highlighted for each screen (project lives under Projects).
const NAV_FOR_SCREEN = { setup: 'nav-setup', dashboard: 'nav-dashboard', project: 'nav-dashboard', about: 'nav-about', editor: 'nav-dashboard' };
function showScreen(name) {
  document.documentElement.dataset.screen = name;
  closeQuickLook(); // the quick-look card only belongs on the dashboard
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

let flushing = false;
async function flushToDb() {
  if (flushing) { scheduleFlush(); return; } // a flush is mid-await; retry after it finishes
  flushing = true;
  const modelDirty = dirty.model;
  const upserts = [...dirty.upserts];
  const deletes = [...dirty.deletes];
  dirty.model = false;
  dirty.upserts.clear();
  dirty.deletes.clear();
  try {
    if (modelDirty && state.model) await db.setMeta('model', serializeModel(state.model));
    for (const id of deletes) await db.deleteProject(id);
    for (const id of upserts) {
      const p = state.store.getProject(id);
      if (p) await db.putProject(p);
    }
    await db.setMeta('savedAt', new Date().toISOString());
  } catch (err) {
    console.error('Persist failed:', err);
    // Re-queue the unpersisted work so a later flush retries it.
    if (modelDirty) dirty.model = true;
    for (const id of upserts) dirty.upserts.add(id);
    for (const id of deletes) dirty.deletes.add(id);
    scheduleFlush();
  } finally {
    flushing = false;
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
  for (const s of state.store.listProjects()) {
    const p = state.store.getProject(s.id);
    if (p) await db.putProject(p);
  }
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
  if (winner === 'file') { await applySnapshot(fileSnap); renderDashboard(); showScreen(state.model ? 'dashboard' : 'setup'); }
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
    : `<button id="btn-open-backup" class="btn-sm">Open Existing Backup…</button>` +
      `<button id="btn-connect-backup" class="btn-primary">Back Up To A File…</button>`;
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

// Pin glyph — outline when not pinned, filled (via fill=currentColor) when pinned.
const pinSvg = (filled) =>
  `<svg viewBox="0 0 24 24" width="16" height="16" fill="${filled ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 17v5"/><path d="M9 10.76V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v6.76a2 2 0 0 0 .59 1.42l1.7 1.7A1 1 0 0 1 18.59 15H5.41a1 1 0 0 1-.7-1.71l1.7-1.7A2 2 0 0 0 7 10.76z"/></svg>`;

function renderDashboard() {
  const list = document.getElementById('project-list');
  const empty = document.getElementById('dashboard-empty');
  list.innerHTML = '';
  empty.hidden = !!state.model;
  deselectProject(); // fresh list starts unselected
  closeQuickLook();
  renderPinnedNav(); // always refresh the sidebar, even with no model loaded
  if (!state.model) return;

  const projects = state.store.listProjects();
  for (const summary of projects) {
    const project = state.store.getProject(summary.id);
    const { checked, applicable, ratio } = computeProjectProgress(state.model, project);
    const li = document.createElement('li');
    li.className = 'project-card';
    li.dataset.projectId = project.id;
    li.innerHTML = `
      <div class="row-between">
        <strong>${escapeHtml(project.name)}</strong>
        <span class="btn-row">
          <button class="pin-btn${summary.pinned ? ' pinned' : ''}" data-pin="${project.id}" type="button"
            title="${summary.pinned ? 'Unpin' : 'Pin'}" aria-label="${summary.pinned ? 'Unpin project' : 'Pin project'}"
            aria-pressed="${summary.pinned ? 'true' : 'false'}">${pinSvg(summary.pinned)}</button>
          <button class="eye-btn" data-quicklook="${project.id}" type="button" title="Quick Look" aria-label="Quick Look">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
          </button>
        </span>
      </div>
      <div class="progress"><div class="progress-bar" style="width:${Math.round(ratio * 100)}%"></div></div>
      <p class="muted">${project.units.length} unit${project.units.length === 1 ? '' : 's'} · ${checked} / ${applicable} checked</p>`;
    // Single click selects (reveals the header actions); double click opens.
    li.addEventListener('click', e => { if (!e.target.closest('button')) selectProject(project.id); });
    li.addEventListener('dblclick', e => { if (!e.target.closest('button')) openProject(project.id); });
    list.appendChild(li);
  }

  list.querySelectorAll('[data-quicklook]').forEach(btn =>
    btn.addEventListener('click', e => { e.stopPropagation(); openQuickLook(btn.getAttribute('data-quicklook')); }));

  list.querySelectorAll('[data-pin]').forEach(btn =>
    btn.addEventListener('click', e => { e.stopPropagation(); togglePin(btn.getAttribute('data-pin')); }));
}

function togglePin(id) {
  const summaries = state.store.listProjects();
  const current = summaries.find(p => p.id === id);
  if (!current) return;
  const next = !current.pinned;
  if (next && summaries.filter(p => p.pinned).length >= 5) {
    alert('You can pin up to 5 projects. Unpin one first.');
    return;
  }
  state.store.setPinned(id, next);
  renderDashboard();
}

function renderPinnedNav() {
  const wrap = document.getElementById('nav-pinned-wrap');
  const list = document.getElementById('pinned-sublist');
  if (!wrap || !list) return;
  const pinned = state.store.listProjects().filter(p => p.pinned).slice(0, 5);
  wrap.hidden = pinned.length === 0;
  list.innerHTML = '';
  for (const p of pinned) {
    const li = document.createElement('li');
    li.innerHTML = `<button type="button" class="pinned-link" data-open="${p.id}" title="${escapeHtml(p.name)}">${escapeHtml(p.name)}</button>`;
    list.appendChild(li);
  }
  list.querySelectorAll('[data-open]').forEach(btn =>
    btn.addEventListener('click', () => openProject(btn.getAttribute('data-open'))));
}

function selectProject(id) {
  state.selectedProjectId = id;
  document.querySelectorAll('#project-list .project-card').forEach(li =>
    li.classList.toggle('selected', li.dataset.projectId === id));
  document.getElementById('dash-actions').hidden = false;
}

function deselectProject() {
  state.selectedProjectId = null;
  document.querySelectorAll('#project-list .project-card.selected').forEach(li => li.classList.remove('selected'));
  const actions = document.getElementById('dash-actions');
  if (actions) actions.hidden = true;
}

function wireDashboardActions() {
  document.getElementById('dash-download').addEventListener('click', () => {
    const p = state.store.getProject(state.selectedProjectId);
    if (p) saveProjectFile(p);
  });
  document.getElementById('dash-export').addEventListener('click', () => {
    const p = state.store.getProject(state.selectedProjectId);
    if (p) downloadProjectZip(p);
  });
  document.getElementById('dash-delete').addEventListener('click', () => {
    const id = state.selectedProjectId;
    if (id && confirm('Delete this project?')) {
      state.store.deleteProject(id);
      renderDashboard();
    }
  });
  // Click anywhere outside a card / the action bar clears the selection.
  document.addEventListener('click', e => {
    if (state.selectedProjectId && !e.target.closest('.project-card, #dash-actions')) deselectProject();
  });
}

const QL_CHEVRON = `<svg class="ql-chevron" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>`;

// Quick Look: an in-flow card beside the project list showing a project's
// overall + per-unit progression; each unit row expands to reveal that unit's
// read-only input specs. Opening it narrows the list card to make room.
function openQuickLook(projectId) {
  const project = state.store.getProject(projectId);
  if (!project) return;
  const { checked, applicable, ratio } = computeProjectProgress(state.model, project);
  document.getElementById('ql-title').textContent = project.name;
  const units = project.units.map(u => {
    const p = computeProgress(state.model, u);
    const specs = state.model.inputs.map(def =>
      `<dt>${escapeHtml(def.label + (def.unit ? ` (${def.unit})` : ''))}</dt>` +
      `<dd>${escapeHtml(formatInputValue(def, u.inputs[def.name]))}</dd>`
    ).join('');
    return `
      <div class="ql-unit">
        <button class="ql-unit-head" type="button" data-unit-toggle aria-expanded="false">
          <span class="unit-name">${escapeHtml(u.name)}</span>
          <div class="progress progress-sm"><div class="progress-bar" style="width:${Math.round(p.ratio * 100)}%"></div></div>
          <span class="unit-count muted">${p.checked} / ${p.applicable}</span>
          ${QL_CHEVRON}
        </button>
        <div class="ql-unit-specs" hidden><dl class="inputs-readout">${specs}</dl></div>
      </div>`;
  }).join('');
  document.getElementById('ql-body').innerHTML = `
    <div class="ql-overall">
      <div class="row-between"><span class="ql-overall-label">Overall</span><span class="muted">${checked} / ${applicable} checked</span></div>
      <div class="progress"><div class="progress-bar" style="width:${Math.round(ratio * 100)}%"></div></div>
    </div>
    <h3 class="ql-section">Units</h3>
    <div class="ql-units">${units}</div>`;
  document.querySelectorAll('#ql-body [data-unit-toggle]').forEach(btn =>
    btn.addEventListener('click', () => {
      const specs = btn.nextElementSibling;
      const show = specs.hidden;
      specs.hidden = !show;
      btn.setAttribute('aria-expanded', String(show));
      btn.classList.toggle('open', show);
    }));
  document.getElementById('quicklook').classList.add('open');
}

function closeQuickLook() {
  const q = document.getElementById('quicklook');
  if (q) q.classList.remove('open');
}

function wireQuickLook() {
  document.querySelectorAll('[data-quicklook-close]').forEach(el => el.addEventListener('click', closeQuickLook));
  // Close only on the × button or a click in genuine free space — never when a
  // control (button, link, input, or a project card) is clicked, so e.g.
  // collapsing the sidebar leaves the card open.
  document.addEventListener('click', e => {
    const q = document.getElementById('quicklook');
    if (!q || !q.classList.contains('open')) return;
    if (e.target.closest('#quicklook, [data-quicklook], button, a, input, select, label, .project-card')) return;
    closeQuickLook();
  });
}

// Sidebar "+ New" menu: choose to create a new project or upload/import one.
function closeNewMenu() {
  const menu = document.getElementById('new-menu');
  if (!menu || menu.hidden) return;
  menu.hidden = true;
  document.getElementById('btn-new-menu').setAttribute('aria-expanded', 'false');
}
function wireNewMenu() {
  const btn = document.getElementById('btn-new-menu');
  const menu = document.getElementById('new-menu');
  btn.addEventListener('click', e => {
    e.stopPropagation();
    const open = menu.hidden;
    menu.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
  });
  document.addEventListener('click', e => {
    if (!menu.hidden && !e.target.closest('#new-menu, #btn-new-menu')) closeNewMenu();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeNewMenu(); });
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Build an editable control for one input definition. `onChange(value)` is
// called with the typed value (boolean / number / string) on every change.
function buildInputControl(def, value, onChange) {
  if (def.type === 'Boolean') {
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = value === true;
    input.addEventListener('change', () => onChange(input.checked));
    return input;
  }
  if (def.type === 'Choice') {
    const select = document.createElement('select');
    for (const c of def.choices) {
      const opt = document.createElement('option');
      opt.value = c; opt.textContent = c;
      if (c === value) opt.selected = true;
      select.appendChild(opt);
    }
    select.addEventListener('change', () => onChange(select.value));
    return select;
  }
  const input = document.createElement('input');
  input.type = 'number';
  if (def.type === 'Integer') input.step = '1';
  input.value = value;
  input.addEventListener('input', () => onChange(input.value === '' ? '' : Number(input.value)));
  return input;
}

function markEditorDirty() { if (state.editor) state.editor.dirty = true; }

// Thin line icons for the unit carousel controls. currentColor lets the button
// state (hover / disabled / add) drive the colour; flex centring keeps them
// perfectly centred in the button.
const ICON_PREV = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 5 5 12 12 19"/></svg>';
const ICON_NEXT = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>';
const ICON_ADD = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';

function renderEditor() {
  const { draft, isNew } = state.editor;
  document.getElementById('editor-heading').textContent = isNew ? 'New Project' : 'Edit Project';
  document.getElementById('editor-name-error').hidden = true;

  const nameInput = document.getElementById('editor-project-name');
  nameInput.value = draft.name;
  nameInput.oninput = () => { draft.name = nameInput.value; markEditorDirty(); };

  // Carousel: render one unit at a time. Clamp the index into range first.
  if (state.editor.unitIndex == null) state.editor.unitIndex = 0;
  const index = Math.max(0, Math.min(state.editor.unitIndex, draft.units.length - 1));
  state.editor.unitIndex = index;
  const unit = draft.units[index];

  document.getElementById('editor-unit-counter').textContent =
    `Unit ${index + 1} of ${draft.units.length}`;

  // Previous arrow is disabled on the first unit.
  const prevBtn = document.getElementById('editor-prev-unit');
  prevBtn.disabled = index === 0;
  prevBtn.innerHTML = ICON_PREV;

  // The next arrow becomes an "add" (+) action when on the last unit.
  const nextBtn = document.getElementById('editor-next-unit');
  const onLast = index === draft.units.length - 1;
  nextBtn.classList.toggle('carousel-add', onLast);
  nextBtn.innerHTML = onLast ? ICON_ADD : ICON_NEXT;
  nextBtn.setAttribute('aria-label', onLast ? 'Add unit' : 'Next unit');

  const container = document.getElementById('editor-units');
  container.innerHTML = '';
  const card = document.createElement('div');
  card.className = 'unit-edit-card';

  const head = document.createElement('div');
  head.className = 'unit-edit-head';
  const nameField = document.createElement('input');
  nameField.type = 'text';
  nameField.className = 'unit-edit-name';
  nameField.value = unit.name;
  nameField.placeholder = 'Unit name';
  nameField.oninput = () => { unit.name = nameField.value; markEditorDirty(); };
  head.appendChild(nameField);

  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'unit-delete-x';
  del.innerHTML = '&times;';
  del.setAttribute('aria-label', 'Delete unit');
  del.disabled = draft.units.length <= 1;
  del.addEventListener('click', () => {
    if (!confirm('Delete this unit?')) return;
    draft.units.splice(index, 1);
    markEditorDirty();
    renderEditor();
  });
  head.appendChild(del);
  card.appendChild(head);

  for (const def of state.model.inputs) {
    if (!(def.name in unit.inputs)) unit.inputs[def.name] = defaultInputValue(def);
    const label = document.createElement('label');
    label.className = 'editor-input-label';
    const labelText = document.createElement('span');
    labelText.className = 'editor-input-label-text';
    labelText.textContent = def.label + (def.unit ? ` (${def.unit})` : '');
    label.appendChild(labelText);
    const control = buildInputControl(def, unit.inputs[def.name], (v) => {
      unit.inputs[def.name] = v;
      markEditorDirty();
    });
    label.appendChild(control);
    card.appendChild(label);
  }
  container.appendChild(card);
}

function prevEditorUnit() {
  if (state.editor.unitIndex > 0) { state.editor.unitIndex--; renderEditor(); }
}

function nextEditorUnit() {
  const draft = state.editor.draft;
  if (state.editor.unitIndex < draft.units.length - 1) {
    state.editor.unitIndex++;
    renderEditor();
  } else {
    addEditorUnit();
  }
}

function addEditorUnit() {
  const draft = state.editor.draft;
  draft.units.push(newDraftUnit(state.model, 'Unit ' + (draft.units.length + 1)));
  state.editor.unitIndex = draft.units.length - 1;
  markEditorDirty();
  renderEditor();
  const nameField = document.querySelector('#editor-units .unit-edit-name');
  if (nameField) nameField.focus();
}

function openEditor(projectId) {
  if (!state.model) { alert('Load a checklist workbook in Setup first.'); return; }
  if (projectId) {
    state.editor = { draft: state.store.getProject(projectId), isNew: false, dirty: false, unitIndex: 0 };
  } else {
    state.editor = { draft: newBlankDraft(state.model), isNew: true, dirty: false, unitIndex: 0 };
  }
  showScreen('editor');
  renderEditor();
  if (state.editor.isNew) document.getElementById('editor-project-name').focus();
}

function saveEditor() {
  const { draft, isNew } = state.editor;
  const result = validateDraft(draft);
  if (!result.ok) {
    const nameErr = result.errors.find(e => e.field === 'name');
    document.getElementById('editor-name-error').hidden = !nameErr;
    const unitErr = result.errors.find(e => e.field === 'unit' || e.field === 'units');
    if (unitErr) alert(unitErr.message);
    return;
  }
  state.store.saveProject(draft);
  const id = draft.id;
  // Preserve the unit the user was working on across an edit; fall back to the
  // first unit only when it was deleted (or for a brand-new project).
  const keepUnitId = (!isNew && draft.units.some(u => u.id === state.currentUnitId))
    ? state.currentUnitId : null;
  state.editor = null;
  if (keepUnitId) {
    state.currentProjectId = id;
    state.currentUnitId = keepUnitId;
    showScreen('project');
    renderProject();
  } else {
    openProject(id);
  }
}

function cancelEditor() {
  const wasNew = state.editor.isNew;
  if (state.editor.dirty && !confirm('Discard changes to this project?')) return;
  const id = state.editor.draft.id;
  state.editor = null;
  if (wasNew) showScreen('dashboard');
  else openProject(id);
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
  // Items are model-level (shared across projects), so a stale editor selection
  // would otherwise re-populate the RHS panel when switching projects. Reset it
  // so the editor starts on its "Select an item" placeholder.
  state.editorItemId = null;
  state.editorUnitId = null;
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

function saveCurrent(project) {
  state.store.saveProject(project);
}


// Ensure any input added to the workbook since the unit was created has a
// value, so item conditions evaluate correctly. (Inputs are edited from the
// project editor; the checklist no longer shows a read-only summary panel.)
function ensureUnitInputs(unit) {
  for (const def of state.model.inputs) {
    if (!(def.name in unit.inputs)) unit.inputs[def.name] = defaultInputValue(def);
  }
}

// Circular info button shown on items that carry an example file (image/PDF).
const INFO_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><line x1="12" y1="11" x2="12" y2="16"/><line x1="12" y1="8" x2="12" y2="8"/></svg>`;

function renderItems() {
  const container = document.getElementById('items-list');
  container.innerHTML = '';
  const project = getCurrentProject();
  let items = unifiedItems(state.model, project);
  if (state.sectionFilter) items = items.filter(i => i.sectionPrefix === state.sectionFilter);

  // Tri-state per item (drives the checkbox and the section counts).
  const stateById = new Map();
  const unitsById = new Map();
  for (const i of items) {
    const units = itemApplicableUnits(state.model, project, i);
    unitsById.set(i.id, units);
    stateById.set(i.id, itemCheckState(i, units));
  }
  const showUnitTags = project.units.length > 1;

  // Section totals from the full (pre hide-checked) list. Done = fully checked.
  const total = new Map();
  const done = new Map();
  for (const i of items) {
    total.set(i.section, (total.get(i.section) || 0) + 1);
    if (stateById.get(i.id) === 'all') done.set(i.section, (done.get(i.section) || 0) + 1);
  }

  const visible = state.hideChecked ? items.filter(i => stateById.get(i.id) !== 'all') : items;
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
    const cs = stateById.get(item.id);
    const tags = showUnitTags ? unitsById.get(item.id).map(u =>
      `<button type="button" class="unit-tag${(u.checks || {})[item.id] === true ? ' done' : ''}" data-tag-item="${escapeHtml(item.id)}" data-tag-unit="${escapeHtml(u.id)}">${escapeHtml(u.name)}</button>`
    ).join('') : '';
    const div = document.createElement('div');
    div.className = 'item' + (cs === 'all' ? ' checked' : cs === 'some' ? ' partial' : '');
    div.innerHTML = `
      <div class="item-head">
        <input type="checkbox" data-check="${escapeHtml(item.id)}" />
        <div>
          <span class="id">${escapeHtml(item.id)}</span> — ${escapeHtml(item.description)}${item.code ? `<span class="code-tag">${escapeHtml(item.code)}</span>` : ''}
          ${tags ? `<div class="unit-tags">${tags}</div>` : ''}
        </div>
        ${item.exampleFile ? `<button type="button" class="item-info" data-example="${escapeHtml(item.exampleFile)}" title="View example" aria-label="View example for ${escapeHtml(item.id)}">${INFO_ICON}</button>` : ''}
      </div>`;
    const cb = div.querySelector('[data-check]');
    cb.checked = cs === 'all';
    cb.indeterminate = cs === 'some';
    container.appendChild(div);
    div.addEventListener('click', e => {
      if (e.target.closest('input, textarea, button')) return;
      openItemEditor(item.id, state.viewerUnitId);
    });
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
      const itemId = cb.getAttribute('data-check');
      const item = state.model.items.find(i => i.id === itemId);
      const p = getCurrentProject();
      const applicable = itemApplicableUnits(state.model, p, item);
      const target = itemCheckState(item, applicable) !== 'all';
      for (const u of applicable) {
        const live = p.units.find(x => x.id === u.id);
        live.checks[itemId] = target;
      }
      saveCurrent(p);
      renderItems();
      renderProgress();
      renderItemEditor();
    }));
  container.querySelectorAll('[data-example]').forEach(btn =>
    btn.addEventListener('click', e => { e.stopPropagation(); openExample(btn.getAttribute('data-example')); }));
  container.querySelectorAll('[data-tag-unit]').forEach(btn =>
    btn.addEventListener('click', e => {
      e.stopPropagation();
      openItemEditor(btn.getAttribute('data-tag-item'), btn.getAttribute('data-tag-unit'));
    }));
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

function formatInputValue(def, value) {
  if (def.type === 'Boolean') return value === true ? 'Yes' : 'No';
  if (value === '' || value == null) return '—';
  return String(value);
}

function renderInputsViewer() {
  const project = getCurrentProject();
  if (!project) return;
  const sel = document.getElementById('viewer-unit-select');
  // Default the viewer to the project's first unit (or keep a valid prior pick).
  if (!project.units.some(u => u.id === state.viewerUnitId)) {
    state.viewerUnitId = project.units[0] ? project.units[0].id : null;
  }
  sel.innerHTML = '';
  for (const u of project.units) {
    const opt = document.createElement('option');
    opt.value = u.id; opt.textContent = u.name;
    if (u.id === state.viewerUnitId) opt.selected = true;
    sel.appendChild(opt);
  }
  const unit = project.units.find(u => u.id === state.viewerUnitId);
  const dl = document.getElementById('inputs-readout');
  dl.innerHTML = '';
  if (!unit) return;
  for (const def of state.model.inputs) {
    const dt = document.createElement('dt');
    dt.textContent = def.label + (def.unit ? ` (${def.unit})` : '');
    const dd = document.createElement('dd');
    dd.textContent = formatInputValue(def, unit.inputs[def.name]);
    dl.append(dt, dd);
  }
}

// Toggle the shared RHS workspace between the item editor and the read-only
// project/unit details view, updating section visibility and the button label.
function applyDetailMode() {
  const proj = state.detailMode === 'project';
  document.getElementById('unit-selection').hidden = !proj;
  document.getElementById('inputs-viewer').hidden = !proj;
  document.getElementById('item-editor').hidden = proj;
  const btn = document.getElementById('btn-project-details');
  if (btn) {
    btn.textContent = proj ? 'Back To Checklist' : 'See Project Details';
    btn.setAttribute('aria-pressed', String(proj));
  }
}

function openItemEditor(itemId, unitId) {
  const item = state.model.items.find(i => i.id === itemId);
  if (!item) return;
  state.detailMode = 'editor';
  applyDetailMode();
  const applicable = itemApplicableUnits(state.model, getCurrentProject(), item);
  state.editorItemId = itemId;
  if (unitId && applicable.some(u => u.id === unitId)) state.editorUnitId = unitId;
  else if (!applicable.some(u => u.id === state.editorUnitId)) {
    state.editorUnitId = applicable[0] ? applicable[0].id : null;
  }
  renderItemEditor();
}

const ALL_UNITS = '__all__'; // sentinel for the "All Lifts" unit-editor selection

function renderItemEditor() {
  const empty = document.getElementById('editor-empty');
  const body = document.getElementById('item-editor-body');
  const item = state.editorItemId
    ? state.model.items.find(i => i.id === state.editorItemId) : null;
  const project = getCurrentProject();
  const applicable = item ? itemApplicableUnits(state.model, project, item) : [];
  if (!item || applicable.length === 0) {
    empty.hidden = false; body.hidden = true; body.innerHTML = '';
    return;
  }
  empty.hidden = true; body.hidden = false;
  const showUnitSelect = project.units.length > 1; // single-unit projects need no unit picker
  const showAll = showUnitSelect && applicable.length > 1; // "All Lifts" only when >1 to act on
  const isAll = showAll && state.editorUnitId === ALL_UNITS;
  const unit = isAll ? null : (applicable.find(u => u.id === state.editorUnitId) || applicable[0]);
  if (!isAll) state.editorUnitId = unit.id;

  // Aggregate view when "All Lifts" is selected: tri-state check + shared comment.
  const allChecked = applicable.every(u => (u.checks || {})[item.id] === true);
  const noneChecked = applicable.every(u => (u.checks || {})[item.id] !== true);
  const comments = applicable.map(u => (u.comments || {})[item.id] || '');
  const sharedComment = comments.every(c => c === comments[0]) ? comments[0] : '';

  const isChecked = isAll ? allChecked : unit.checks[item.id] === true;
  const commentValue = isAll ? sharedComment : (unit.comments[item.id] || '');

  body.innerHTML = `
    <div class="ed-item-head">
      <input type="checkbox" id="ed-check" ${isChecked ? 'checked' : ''}/>
      <span class="ed-item-name"><span class="id">${escapeHtml(item.id)}</span> — ${escapeHtml(item.description)}</span>
    </div>
    ${item.note ? `<div class="item-note">${escapeHtml(item.note)}</div>` : ''}
    ${showUnitSelect ? `<label class="ed-unit-row"><span>Unit Selection</span><select id="ed-unit-select"></select></label>` : ''}
    <div class="ed-comment-label">Comments</div>
    <textarea id="ed-comment" class="ed-comment" rows="6" placeholder="${isAll ? 'Comment applied to all lifts…' : 'Comment for this unit…'}"></textarea>`;

  const sel = body.querySelector('#ed-unit-select');
  if (sel) {
    if (showAll) {
      const allOpt = document.createElement('option');
      allOpt.value = ALL_UNITS; allOpt.textContent = 'All Lifts';
      if (isAll) allOpt.selected = true;
      sel.appendChild(allOpt);
    }
    for (const u of applicable) {
      const opt = document.createElement('option');
      opt.value = u.id; opt.textContent = u.name;
      if (!isAll && u.id === unit.id) opt.selected = true;
      sel.appendChild(opt);
    }
    sel.addEventListener('change', () => { state.editorUnitId = sel.value; renderItemEditor(); });
  }

  const check = body.querySelector('#ed-check');
  if (isAll) check.indeterminate = !allChecked && !noneChecked;

  // Units the edit applies to: all applicable units in "All Lifts" mode, else the one unit.
  const targetUnits = () => {
    const p = getCurrentProject();
    const ids = isAll ? applicable.map(u => u.id) : [state.editorUnitId];
    return { p, units: ids.map(id => p.units.find(x => x.id === id)).filter(Boolean) };
  };

  const commentBox = body.querySelector('#ed-comment');
  commentBox.value = commentValue;
  commentBox.addEventListener('input', e => {
    const { p, units } = targetUnits();
    for (const u of units) u.comments[item.id] = e.target.value;
    saveCurrent(p);
  });
  check.addEventListener('change', e => {
    const { p, units } = targetUnits();
    for (const u of units) u.checks[item.id] = e.target.checked;
    saveCurrent(p);
    renderItems();
    renderProgress();
  });
}

function renderProgress() {
  const project = getCurrentProject();
  const all = computeProjectProgress(state.model, project);
  document.getElementById('project-progress-bar').style.width = Math.round(all.ratio * 100) + '%';
  document.getElementById('project-progress-label').textContent =
    `${all.checked} / ${all.applicable} checked across project`;
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
  applyDetailWidth(storedDetailWidth());
  if (!getCurrentUnit()) state.currentUnitId = project.units[0].id;
  document.getElementById('project-title').textContent = project.name;
  renderSectionFilter();
  for (const u of project.units) ensureUnitInputs(u);
  saveCurrent(project); // persist any defaults just applied
  state.detailMode = 'editor';
  applyDetailMode();
  renderInputsViewer();
  renderItemEditor();
  renderItems();
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

async function downloadProjectZip(project = getCurrentProject()) {
  if (!project) return;
  try {
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

function saveProjectFile(project = getCurrentProject()) {
  if (!project) return;
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
  // Two synced checkboxes: one in Setup, one at the bottom of the sidebar.
  const toggles = ['toggle-dark', 'toggle-dark-side']
    .map(id => document.getElementById(id))
    .filter(Boolean);
  const isDark = () => document.documentElement.getAttribute('data-theme') === 'dark';
  toggles.forEach(t => { t.checked = isDark(); });
  toggles.forEach(toggle => {
    toggle.addEventListener('change', () => {
      const dark = toggle.checked;
      document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
      try { window.localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light'); } catch { /* ignore */ }
      toggles.forEach(t => { t.checked = dark; });
    });
  });
}

// --- Resizable cards: drag the splitter to trade width between the two cards.
const SPLIT_KEY = 'dpchecklist.detailWidth';
const MIN_CARD_WIDTH = 280;

function projectBodyEl() {
  return document.querySelector('#screen-project .project-body');
}

// Clamp a desired detail-card width so neither card drops below MIN_CARD_WIDTH.
function clampDetailWidth(px, body) {
  const splitter = document.getElementById('card-splitter');
  const sw = splitter ? splitter.offsetWidth : 16;
  const max = body.clientWidth - MIN_CARD_WIDTH - sw;
  if (max < MIN_CARD_WIDTH) return Math.max(0, max); // window too narrow to honor both mins
  return Math.max(MIN_CARD_WIDTH, Math.min(px, max));
}

// Apply (clamped) detail width to the project body's --detail-w variable.
function applyDetailWidth(px) {
  const body = projectBodyEl();
  if (!body || body.clientWidth <= 0) return;
  body.style.setProperty('--detail-w', clampDetailWidth(px, body) + 'px');
}

function storedDetailWidth() {
  let v = NaN;
  try { v = Number(window.localStorage.getItem(SPLIT_KEY)); } catch { /* ignore */ }
  return Number.isFinite(v) && v > 0 ? v : 350;
}

function currentDetailWidth(body) {
  return parseFloat(getComputedStyle(body).getPropertyValue('--detail-w')) || storedDetailWidth();
}

function wireCardSplitter() {
  const splitter = document.getElementById('card-splitter');
  if (!splitter) return;
  let dragging = false;
  splitter.addEventListener('pointerdown', (e) => {
    if (!projectBodyEl()) return;
    dragging = true;
    splitter.classList.add('dragging');
    try { splitter.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    e.preventDefault();
  });
  splitter.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const body = projectBodyEl();
    if (!body) return;
    applyDetailWidth(body.getBoundingClientRect().right - e.clientX);
  });
  const end = (e) => {
    if (!dragging) return;
    dragging = false;
    splitter.classList.remove('dragging');
    try { splitter.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    const body = projectBodyEl();
    if (body) {
      try { window.localStorage.setItem(SPLIT_KEY, String(Math.round(currentDetailWidth(body)))); } catch { /* ignore */ }
    }
  };
  splitter.addEventListener('pointerup', end);
  splitter.addEventListener('pointercancel', end);
  // Keep the stored width valid when the window resizes.
  window.addEventListener('resize', () => {
    const screen = document.getElementById('screen-project');
    const body = projectBodyEl();
    if (body && screen && !screen.hidden) applyDetailWidth(currentDetailWidth(body));
  });
}

const ITEM_TINT_KEY = 'dpchecklist.itemTint';
function wireItemTintToggle() {
  // When off, item bubbles lose their green/amber tint; the checkbox and unit
  // pills keep their colour (only .item.checked/.item.partial backgrounds go).
  const toggle = document.getElementById('toggle-item-tint');
  if (!toggle) return;
  toggle.checked = !document.documentElement.classList.contains('no-item-tint');
  toggle.addEventListener('change', () => {
    const on = toggle.checked;
    document.documentElement.classList.toggle('no-item-tint', !on);
    try { window.localStorage.setItem(ITEM_TINT_KEY, on ? 'on' : 'off'); } catch { /* ignore */ }
  });
}

const SIDEBAR_KEY = 'dpchecklist.sidebar';
function wireSidebarToggle() {
  const btn = document.getElementById('sidebar-toggle');
  if (!btn) return;
  const apply = (collapsed) => {
    document.documentElement.classList.toggle('sidebar-collapsed', collapsed);
    btn.setAttribute('aria-expanded', String(!collapsed));
    btn.setAttribute('aria-label', collapsed ? 'Expand sidebar' : 'Collapse sidebar');
  };
  // Reflect the state already applied pre-paint by the <head> bootstrap.
  apply(document.documentElement.classList.contains('sidebar-collapsed'));
  btn.addEventListener('click', () => {
    const collapsed = !document.documentElement.classList.contains('sidebar-collapsed');
    apply(collapsed);
    try { window.localStorage.setItem(SIDEBAR_KEY, collapsed ? 'collapsed' : 'expanded'); } catch { /* ignore */ }
  });
}

const PINNED_NAV_KEY = 'dpchecklist.pinnedNav';
function wirePinnedNav() {
  const btn = document.getElementById('nav-pinned');
  const wrap = document.getElementById('nav-pinned-wrap');
  if (!btn || !wrap) return;
  const apply = (open) => {
    wrap.classList.toggle('open', open);
    btn.setAttribute('aria-expanded', String(open));
  };
  let open = true;
  try { open = window.localStorage.getItem(PINNED_NAV_KEY) !== 'collapsed'; } catch { /* ignore */ }
  apply(open);
  btn.addEventListener('click', () => {
    open = !wrap.classList.contains('open');
    apply(open);
    try { window.localStorage.setItem(PINNED_NAV_KEY, open ? 'expanded' : 'collapsed'); } catch { /* ignore */ }
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
  renderPinnedNav();
  wireSetup();
  wireThemeToggle();
  wireItemTintToggle();
  wireSidebarToggle();
  wirePinnedNav();
  wireQuickLook();
  wireNewMenu();
  wireDashboardActions();
  wireCardSplitter();
  document.getElementById('nav-dashboard').addEventListener('click', () => showScreen('dashboard'));
  document.getElementById('nav-about').addEventListener('click', () => showScreen('about'));
  document.getElementById('nav-setup').addEventListener('click', () => showScreen('setup'));
  document.getElementById('btn-back').addEventListener('click', () => showScreen('dashboard'));

  document.getElementById('section-select').addEventListener('change', e => {
    state.sectionFilter = e.target.value;
    renderItems();
  });
  document.getElementById('btn-project-details').addEventListener('click', () => {
    state.detailMode = state.detailMode === 'project' ? 'editor' : 'project';
    if (state.detailMode === 'project') renderInputsViewer();
    applyDetailMode();
  });
  document.getElementById('viewer-unit-select').addEventListener('change', e => {
    state.viewerUnitId = e.target.value;
    renderInputsViewer();
  });
  document.getElementById('toggle-hide-checked').addEventListener('change', e => {
    state.hideChecked = e.target.checked;
    renderItems();
  });
  document.getElementById('menu-new-project').addEventListener('click', () => { closeNewMenu(); openEditor(null); });
  document.getElementById('btn-edit-project').addEventListener('click', () => openEditor(state.currentProjectId));
  document.getElementById('editor-save').addEventListener('click', saveEditor);
  document.getElementById('editor-cancel').addEventListener('click', cancelEditor);
  document.getElementById('editor-prev-unit').addEventListener('click', prevEditorUnit);
  document.getElementById('editor-next-unit').addEventListener('click', nextEditorUnit);

  const importFile = document.getElementById('import-project-file');
  importFile.addEventListener('click', closeNewMenu); // menu closes as the picker opens
  importFile.addEventListener('change', async e => {
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

  document.getElementById('btn-save-project').addEventListener('click', () => saveProjectFile());
  document.getElementById('btn-download-zip').addEventListener('click', () => downloadProjectZip());
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
    controls.insertAdjacentHTML('afterbegin', `<button id="btn-reconnect-backup" class="btn-primary">Reconnect Backup</button>`);
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
