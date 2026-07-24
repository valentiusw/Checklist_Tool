import { buildModel } from './workbookModel.js';
import { createProjectStore, normalizeDetails } from './projectStore.js';
import { computeProgress, computeProjectProgress, applicableItems, buildExportPlan } from './exporter.js';
import { buildExportWorkbook } from './exportWorkbook.js';
import * as exampleStore from './exampleStore.js';
import { readSetupZip, buildExportZip } from './zipBundle.js';
import * as db from './db.js';
import { readLegacy } from './legacyMigration.js';
import * as fileBackup from './fileBackup.js';
import { buildSnapshot, parseSnapshot, chooseNewer } from './librarySnapshot.js';
import { defaultInputValue, validateDraft, newBlankDraft, newDraftUnit } from './projectDraft.js';
import { itemApplicableUnits, itemCheckState, unifiedItems } from './checklistView.js';
import { parseClipboardMatrix, applyPasteMatrix } from './unitGrid.js';

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
  projectSearch: '', // dashboard keyword filter over project names
  projectView: 'active', // 'active' | 'pinned' | 'archived' — dashboard segmented filter (session-only)
};

const screens = ['setup', 'dashboard', 'project', 'about', 'editor'];
// Which sidebar link is highlighted for each screen (project lives under Projects).
const NAV_FOR_SCREEN = { setup: 'nav-setup', dashboard: 'nav-dashboard', project: 'nav-dashboard', about: 'nav-about', editor: 'nav-dashboard' };
function showScreen(name) {
  document.documentElement.dataset.screen = name;
  for (const s of screens) {
    document.getElementById('screen-' + s).hidden = s !== name;
  }
  for (const id of ['nav-dashboard', 'nav-about', 'nav-setup']) {
    document.getElementById(id).classList.toggle('active', NAV_FOR_SCREEN[name] === id);
  }
  if (name === 'dashboard') { state.projectView = 'active'; renderDashboard(); }
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

// Archive / unarchive glyphs (box with a down / up arrow). Injected into the
// header action button; direction flips with the selected project's state.
const ARCHIVE_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 8v13H3V8"/><rect x="1" y="3" width="22" height="5"/><line x1="12" y1="11" x2="12" y2="17"/><polyline points="9 14 12 17 15 14"/></svg>';
const UNARCHIVE_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 8v13H3V8"/><rect x="1" y="3" width="22" height="5"/><line x1="12" y1="17" x2="12" y2="11"/><polyline points="9 14 12 11 15 14"/></svg>';

// Point the header archive button at the selected project's current state.
function updateArchiveButton(id) {
  const btn = document.getElementById('dash-archive');
  if (!btn) return;
  const summary = state.store.listProjects().find(p => p.id === id);
  const archived = !!(summary && summary.archived);
  btn.innerHTML = archived ? UNARCHIVE_SVG : ARCHIVE_SVG;
  btn.title = archived ? 'Unarchive Project' : 'Archive Project';
  btn.setAttribute('aria-label', archived ? 'Unarchive project' : 'Archive project');
}

function renderDashboard() {
  const list = document.getElementById('project-list');
  const empty = document.getElementById('dashboard-empty');
  list.innerHTML = '';
  empty.hidden = !!state.model;
  deselectProject(); // fresh list starts unselected → RHS shows the empty state
  renderPinnedNav(); // always refresh the sidebar, even with no model loaded
  // The persistent details card (and its resize splitter) only make sense once
  // a checklist is loaded.
  document.getElementById('quicklook').hidden = !state.model;
  document.getElementById('dash-splitter').hidden = !state.model;
  const searchRow = document.getElementById('project-search-row');
  if (!state.model) { searchRow.hidden = true; return; }
  dashSplitter.apply(dashSplitter.stored()); // honor the saved split width (clamped)

  const projects = state.store.listProjects();
  searchRow.hidden = projects.length === 0; // no search box until there's something to search
  syncViewTabs(); // reflect state.projectView on the segmented control
  for (const summary of projects) {
    const project = state.store.getProject(summary.id);
    const { checked, applicable, ratio } = computeProjectProgress(state.model, project);
    const li = document.createElement('li');
    li.className = 'project-card';
    li.dataset.projectId = project.id;
    li.dataset.name = project.name;
    li.dataset.pinned = summary.pinned ? 'true' : 'false';
    li.dataset.archived = summary.archived ? 'true' : 'false';
    // Archived projects can't be pinned, so their card omits the pin button.
    const pinBtn = summary.archived ? '' :
      `<button class="pin-btn${summary.pinned ? ' pinned' : ''}" data-pin="${project.id}" type="button"
            title="${summary.pinned ? 'Unpin' : 'Pin'}" aria-label="${summary.pinned ? 'Unpin project' : 'Pin project'}"
            aria-pressed="${summary.pinned ? 'true' : 'false'}">${pinSvg(summary.pinned)}</button>`;
    li.innerHTML = `
      <div class="row-between">
        <strong>${escapeHtml(project.name)}</strong>
        <span class="btn-row">${pinBtn}</span>
      </div>
      <div class="progress"><div class="progress-bar" style="width:${Math.round(ratio * 100)}%"></div></div>
      <p class="muted">${project.units.length} unit${project.units.length === 1 ? '' : 's'} · ${checked} / ${applicable} checked</p>`;
    // Single click selects (reveals the header actions); double click opens.
    li.addEventListener('click', e => { if (!e.target.closest('button')) selectProject(project.id); });
    li.addEventListener('dblclick', e => { if (!e.target.closest('button')) openProject(project.id); });
    list.appendChild(li);
  }

  list.querySelectorAll('[data-pin]').forEach(btn =>
    btn.addEventListener('click', e => { e.stopPropagation(); togglePin(btn.getAttribute('data-pin')); }));

  applyProjectFilter(); // respect any active search query across re-renders
}

// Does a card belong in the current segmented view?
//   active   → not archived
//   pinned   → pinned and not archived
//   archived → archived
function cardInView(card) {
  const pinned = card.dataset.pinned === 'true';
  const archived = card.dataset.archived === 'true';
  if (state.projectView === 'archived') return archived;
  if (state.projectView === 'pinned') return pinned && !archived;
  return !archived; // 'active'
}

// Filter the project list by the active view AND the search terms (both must
// pass). Windows-Explorer-style search: name contains every space-separated
// keyword (case-insensitive). Shows a context-appropriate empty message.
function applyProjectFilter() {
  const terms = (state.projectSearch || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  const cards = document.querySelectorAll('#project-list .project-card');
  let inView = 0, visible = 0;
  cards.forEach(card => {
    if (!cardInView(card)) { card.hidden = true; return; }
    inView++;
    const name = (card.dataset.name || '').toLowerCase();
    const match = terms.every(t => name.includes(t));
    card.hidden = !match;
    if (match) visible++;
  });
  const msg = document.getElementById('project-search-empty');
  let text = '';
  if (visible === 0 && cards.length > 0) {
    if (terms.length > 0) text = `No projects match "${state.projectSearch.trim()}".`;
    else if (state.projectView === 'pinned') text = 'No pinned projects yet.';
    else if (state.projectView === 'archived') text = 'No archived projects.';
    else if (inView === 0) text = 'No active projects.';
  }
  msg.hidden = !text;
  msg.textContent = text;
}

// Reflect state.projectView on the segmented control (active tab + aria).
function syncViewTabs() {
  document.querySelectorAll('#project-view-filter .view-tab').forEach(tab => {
    const on = tab.dataset.view === state.projectView;
    tab.classList.toggle('is-active', on);
    tab.setAttribute('aria-selected', on ? 'true' : 'false');
  });
}

// Switch the dashboard view. Deselects any project (its header actions may not
// apply to the new view) and re-filters without a full list rebuild.
function setProjectView(view) {
  if (view === state.projectView) return;
  state.projectView = view;
  deselectProject();
  syncViewTabs();
  applyProjectFilter();
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

let pinnedDragEl = null; // the <li> currently being dragged in the pinned sidebar list

function renderPinnedNav() {
  const wrap = document.getElementById('nav-pinned-wrap');
  const list = document.getElementById('pinned-sublist');
  if (!wrap || !list) return;
  const pinned = state.store.listProjects()
    .filter(p => p.pinned)
    .sort((a, b) => {
      const ao = Number.isFinite(a.pinnedOrder) ? a.pinnedOrder : Infinity;
      const bo = Number.isFinite(b.pinnedOrder) ? b.pinnedOrder : Infinity;
      return ao === bo ? 0 : ao - bo; // ties keep listProjects order; guards NaN
    })
    .slice(0, 5);
  wrap.hidden = pinned.length === 0;
  list.innerHTML = '';
  for (const p of pinned) {
    const li = document.createElement('li');
    li.className = 'pinned-item';
    li.draggable = true;
    li.dataset.id = p.id;
    li.innerHTML = `<button type="button" class="pinned-link" data-open="${p.id}" title="${escapeHtml(p.name)}">${escapeHtml(p.name)}</button>`;
    li.addEventListener('dragstart', () => { pinnedDragEl = li; li.classList.add('dragging'); });
    li.addEventListener('dragend', () => {
      li.classList.remove('dragging');
      pinnedDragEl = null;
      const ids = [...list.querySelectorAll('.pinned-item')].map(el => el.dataset.id);
      state.store.reorderPinned(ids);
    });
    list.appendChild(li);
  }
  list.querySelectorAll('[data-open]').forEach(btn =>
    btn.addEventListener('click', () => openProject(btn.getAttribute('data-open'))));
  // Container-level dragover — attach once; live-reorders the DOM as the cursor moves.
  if (!list.dataset.dragWired) {
    list.dataset.dragWired = '1';
    list.addEventListener('dragover', e => {
      if (!pinnedDragEl) return;
      e.preventDefault();
      const after = pinnedDragAfterElement(list, e.clientY);
      if (after == null) list.appendChild(pinnedDragEl);
      else if (after !== pinnedDragEl) list.insertBefore(pinnedDragEl, after);
    });
  }
}

// The pinned <li> that should follow the cursor at vertical position `y` (or null → append to end).
function pinnedDragAfterElement(list, y) {
  const items = [...list.querySelectorAll('.pinned-item:not(.dragging)')];
  let closest = null, closestOffset = -Infinity;
  for (const el of items) {
    const box = el.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > closestOffset) { closestOffset = offset; closest = el; }
  }
  return closest;
}

function selectProject(id) {
  state.selectedProjectId = id;
  document.querySelectorAll('#project-list .project-card').forEach(li =>
    li.classList.toggle('selected', li.dataset.projectId === id));
  document.getElementById('dash-actions').hidden = false;
  updateArchiveButton(id); // set the archive/unarchive glyph + label for this project
  renderProjectDetails(id); // preview the project in the persistent RHS card
}

function deselectProject() {
  state.selectedProjectId = null;
  document.querySelectorAll('#project-list .project-card.selected').forEach(li => li.classList.remove('selected'));
  const actions = document.getElementById('dash-actions');
  if (actions) actions.hidden = true;
  // Reset the RHS card to its dashed empty state.
  const empty = document.getElementById('ql-empty');
  const detail = document.getElementById('ql-detail');
  if (empty) empty.hidden = false;
  if (detail) detail.hidden = true;
}

// Export trigger dropdown: toggles a menu whose two items export in the chosen
// mode. `getProject` resolves the project to export at click time.
function wireExportDropdown({ btnId, menuId, fullId, outId, getProject }) {
  const btn = document.getElementById(btnId);
  const menu = document.getElementById(menuId);
  const close = () => { if (!menu.hidden) { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); } };
  btn.addEventListener('click', e => {
    e.stopPropagation();
    const open = menu.hidden;
    menu.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
  });
  document.addEventListener('click', e => {
    if (!menu.hidden && !e.target.closest('#' + menuId + ', #' + btnId)) close();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  document.getElementById(fullId).addEventListener('click', () => {
    close();
    const p = getProject();
    if (p) downloadProjectZip(p, 'full');
  });
  document.getElementById(outId).addEventListener('click', () => {
    close();
    const p = getProject();
    if (p) downloadProjectZip(p, 'outstanding');
  });
}

function wireDashboardActions() {
  document.getElementById('dash-download').addEventListener('click', () => {
    const p = state.store.getProject(state.selectedProjectId);
    if (p) saveProjectFile(p);
  });
  wireExportDropdown({
    btnId: 'dash-export', menuId: 'export-menu',
    fullId: 'menu-export-full', outId: 'menu-export-outstanding',
    getProject: () => state.store.getProject(state.selectedProjectId),
  });
  document.getElementById('dash-archive').addEventListener('click', () => {
    const id = state.selectedProjectId;
    if (!id) return;
    const summary = state.store.listProjects().find(p => p.id === id);
    // Reversible + non-destructive → no confirm dialog (unlike delete).
    state.store.setArchived(id, !(summary && summary.archived));
    renderDashboard();
  });
  document.getElementById('dash-delete').addEventListener('click', () => {
    const id = state.selectedProjectId;
    if (id && confirm('Delete this project?')) {
      state.store.deleteProject(id);
      renderDashboard();
    }
  });
  // Segmented view filter (Active / Pinned / Archived).
  document.querySelectorAll('#project-view-filter .view-tab').forEach(tab =>
    tab.addEventListener('click', () => setProjectView(tab.dataset.view)));
  const search = document.getElementById('project-search');
  const searchClear = document.getElementById('project-search-clear');
  const syncSearch = () => {
    state.projectSearch = search.value;
    if (searchClear) searchClear.hidden = search.value === '';
    applyProjectFilter();
  };
  if (search) search.addEventListener('input', syncSearch);
  if (searchClear) searchClear.addEventListener('click', () => { search.value = ''; syncSearch(); search.focus(); });
  // Click anywhere outside a card / the action bar / the details panel clears
  // the selection (and resets the RHS card to its empty state).
  document.addEventListener('click', e => {
    if (state.selectedProjectId && !e.target.closest('.project-card, #dash-actions, #quicklook')) deselectProject();
  });
}

const QL_CHEVRON = `<svg class="ql-chevron" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>`;

// Project details: renders the selected project's overall + per-unit
// progression into the persistent RHS card; each unit row expands to reveal
// that unit's read-only input specs.
function renderProjectDetails(projectId) {
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
  // Reveal the details, hide the empty state.
  document.getElementById('ql-empty').hidden = true;
  document.getElementById('ql-detail').hidden = false;
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

function renderEditor() {
  const { draft, isNew } = state.editor;
  document.getElementById('editor-heading').textContent = isNew ? 'New Project' : 'Edit Project';
  document.getElementById('editor-name-error').hidden = true;

  const nameInput = document.getElementById('editor-project-name');
  nameInput.value = draft.name;
  nameInput.oninput = () => { draft.name = nameInput.value; markEditorDirty(); };

  const details = draft.details;
  const wireDetail = (id, key) => {
    const el = document.getElementById(id);
    el.value = details[key] || '';
    el.oninput = () => { details[key] = el.value; markEditorDirty(); };
  };
  wireDetail('editor-reviewer-name', 'reviewerName');
  wireDetail('editor-reviewer-contact', 'reviewerContact');
  wireDetail('editor-builder-name', 'builderName');
  wireDetail('editor-builder-phone', 'builderPhone');
  wireDetail('editor-builder-email', 'builderEmail');
  wireDetail('editor-builder-approval', 'builderApprovalNo');

  renderUnitGrid();
}

// ---- Unit grid (spreadsheet editor) ----------------------------------------

// Rebuild the whole <table>. Cheap for realistic project sizes and keeps
// row/column indices authoritative after every structural change.
function renderUnitGrid() {
  const { draft } = state.editor;
  const model = state.model;
  const table = document.getElementById('editor-grid');
  table.innerHTML = '';

  const thead = document.createElement('thead');
  const hr = document.createElement('tr');
  const corner = document.createElement('th');
  corner.className = 'corner';
  corner.textContent = 'Unit';
  hr.appendChild(corner);
  for (const def of model.inputs) {
    const th = document.createElement('th');
    th.textContent = def.label + (def.unit ? ` (${def.unit})` : '');
    hr.appendChild(th);
  }
  thead.appendChild(hr);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  draft.units.forEach((unit, rowIdx) => {
    tbody.appendChild(buildUnitRow(unit, rowIdx, model, false));
  });
  tbody.appendChild(buildUnitRow(null, draft.units.length, model, true)); // ghost
  table.appendChild(tbody);
}

// Build one <tr>. isGhost renders a faint blank row that materializes into a
// real unit on first edit (name or any input).
function buildUnitRow(unit, rowIdx, model, isGhost) {
  const tr = document.createElement('tr');
  tr.dataset.row = String(rowIdx);
  if (isGhost) tr.className = 'ghost';

  const rowhead = document.createElement('td');
  rowhead.className = 'rowhead';
  const inner = document.createElement('div');
  inner.className = 'rowhead-inner';

  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'unit-delete-x';
  del.innerHTML = '&times;';
  del.tabIndex = -1; // keep Tab moving between data cells, not delete buttons
  del.setAttribute('aria-label', 'Delete unit');
  del.disabled = isGhost || state.editor.draft.units.length <= 1;
  del.addEventListener('click', () => {
    if (!confirm('Delete this unit?')) return;
    state.editor.draft.units.splice(rowIdx, 1);
    markEditorDirty();
    renderUnitGrid();
  });

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'unit-edit-name';
  nameInput.dataset.col = '0';
  nameInput.value = isGhost ? '' : unit.name;
  nameInput.placeholder = isGhost ? 'New unit…' : 'Unit name';
  if (isGhost) {
    nameInput.addEventListener('input', () =>
      materializeGhost(0, (u) => { u.name = nameInput.value; }));
  } else {
    nameInput.addEventListener('input', () => { unit.name = nameInput.value; markEditorDirty(); });
  }

  inner.appendChild(del);
  inner.appendChild(nameInput);
  rowhead.appendChild(inner);
  tr.appendChild(rowhead);

  model.inputs.forEach((def, i) => {
    const col = i + 1;
    const td = document.createElement('td');
    let value;
    if (isGhost) {
      value = defaultInputValue(def);
    } else {
      if (!(def.name in unit.inputs)) unit.inputs[def.name] = defaultInputValue(def);
      value = unit.inputs[def.name];
    }
    const control = buildInputControl(def, value, (v) => {
      if (isGhost) { materializeGhost(col, (u) => { u.inputs[def.name] = v; }); return; }
      unit.inputs[def.name] = v;
      markEditorDirty();
    });
    control.dataset.col = String(col);
    td.appendChild(control);
    tr.appendChild(td);
  });

  return tr;
}

// Promote the ghost row into a real unit, apply the just-entered value, then
// re-render and restore focus/caret to the same cell in the new real row.
function materializeGhost(col, apply) {
  const draft = state.editor.draft;
  const unit = newDraftUnit(state.model, 'Unit ' + (draft.units.length + 1));
  apply(unit);
  draft.units.push(unit);
  markEditorDirty();
  renderUnitGrid();
  focusCell(draft.units.length - 1, col, true);
}

// Append a blank unit via the explicit button and focus its name cell.
function addEditorUnit() {
  const draft = state.editor.draft;
  draft.units.push(newDraftUnit(state.model, 'Unit ' + (draft.units.length + 1)));
  markEditorDirty();
  renderUnitGrid();
  focusCell(draft.units.length - 1, 0, false);
}

// Move focus to the control at (row, col); optionally place the caret at end
// (text inputs only — number inputs reject setSelectionRange, hence the guard).
function focusCell(row, col, caretEnd) {
  const el = document.querySelector(`#editor-grid tbody tr[data-row="${row}"] [data-col="${col}"]`);
  if (!el) return;
  el.focus();
  if (caretEnd && el.tagName === 'INPUT' && el.type === 'text') {
    try { const n = el.value.length; el.setSelectionRange(n, n); } catch (_) { /* unsupported */ }
  }
}

// Enter/Shift+Enter move vertically; Arrow keys move between non-text cells
// (checkbox/select) — inside number/text inputs arrows stay native so the caret
// and number steppers keep working. Tab/Shift+Tab are left to native DOM order
// (delete buttons are tabIndex -1, so Tab walks name → inputs → next row).
function onGridKeydown(e) {
  const cell = e.target.closest('[data-col]');
  if (!cell) return;
  const tr = cell.closest('tr');
  const row = Number(tr.dataset.row);
  const col = Number(cell.dataset.col);
  const isText = cell.tagName === 'INPUT' && (cell.type === 'text' || cell.type === 'number');

  if (e.key === 'Enter') {
    e.preventDefault();
    focusCell(row + (e.shiftKey ? -1 : 1), col, true);
  } else if (!isText && e.key === 'ArrowDown') {
    e.preventDefault(); focusCell(row + 1, col, true);
  } else if (!isText && e.key === 'ArrowUp') {
    e.preventDefault(); focusCell(row - 1, col, true);
  } else if (!isText && e.key === 'ArrowRight') {
    e.preventDefault(); focusCell(row, col + 1, true);
  } else if (!isText && e.key === 'ArrowLeft') {
    e.preventDefault(); focusCell(row, col - 1, true);
  }
}

// Paste a block copied from Excel: fill cells from the focused cell, spilling
// right and down, creating units past the last row. A 1x1 paste is left to the
// native field so ordinary single-value pastes behave normally.
function onGridPaste(e) {
  const cell = e.target.closest('[data-col]');
  if (!cell) return;
  const text = e.clipboardData.getData('text');
  if (!text) return;
  const matrix = parseClipboardMatrix(text);
  if (matrix.length === 1 && matrix[0].length === 1) return; // single value → native
  e.preventDefault();
  const tr = cell.closest('tr');
  const startRow = Number(tr.dataset.row);
  const startCol = Number(cell.dataset.col);
  const draft = state.editor.draft;
  draft.units = applyPasteMatrix({
    units: draft.units,
    model: state.model,
    startRow, startCol, matrix,
    makeUnit: (i) => newDraftUnit(state.model, 'Unit ' + (i + 1)),
  });
  markEditorDirty();
  renderUnitGrid();
  focusCell(startRow, startCol, false);
}

function openEditor(projectId) {
  if (!state.model) { alert('Load a checklist workbook in Setup first.'); return; }
  if (projectId) {
    state.editor = { draft: state.store.getProject(projectId), isNew: false, dirty: false };
  } else {
    state.editor = { draft: newBlankDraft(state.model), isNew: true, dirty: false };
  }
  state.editor.draft.details = normalizeDetails(state.editor.draft.details);
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
    div.dataset.itemId = item.id;
    div.innerHTML = `
      <div class="item-head">
        <input type="checkbox" data-check="${escapeHtml(item.id)}" />
        <div>
          <span class="id">${escapeHtml(item.id)}</span> — ${escapeHtml(item.description)}${displayCode(item.code) ? `<span class="code-tag">${escapeHtml(displayCode(item.code))}</span>` : ''}
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

  highlightSelectedItem(); // keep the open item's highlight across re-renders
}

// Ring the checklist item whose comment is currently open in the RHS editor
// (only in editor mode — the highlight tracks what's shown on the right).
function highlightSelectedItem() {
  const container = document.getElementById('items-list');
  if (!container) return;
  const activeId = state.detailMode === 'editor' ? state.editorItemId : null;
  container.querySelectorAll('.item').forEach(el =>
    el.classList.toggle('selected', !!activeId && el.dataset.itemId === activeId));
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|svg)$/i;

// Blobs come out of the setup ZIP (JSZip) and IndexedDB with an empty MIME
// type. Opening an untyped blob in a new tab makes the browser render the raw
// bytes as text (a PDF shows up as garbage), so we re-stamp the type from the
// filename before building the object URL.
const CONTENT_TYPE_BY_EXT = {
  pdf: 'application/pdf',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml',
};

function contentTypeFor(name) {
  const ext = name.split('.').pop().toLowerCase();
  return CONTENT_TYPE_BY_EXT[ext] || 'application/octet-stream';
}

// The "SL" code (State/local regulatory requirement) is intentionally not shown
// as a boxed code tag in the UI. Every other code renders as-is; a code that is
// exactly "SL" (trimmed, case-insensitive) is suppressed. Mixed codes like
// "EN81-20, SL" are left untouched.
function displayCode(code) {
  if (!code) return '';
  return code.trim().toUpperCase() === 'SL' ? '' : code;
}

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
  const wantType = contentTypeFor(name);
  if (blob.type !== wantType) blob = blob.slice(0, blob.size, wantType);
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
  highlightSelectedItem(); // clears the highlight in project-details mode, restores it in editor mode
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
  highlightSelectedItem();
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

  const edCode = displayCode(item.code);
  body.innerHTML = `
    <div class="ed-item-head">
      <input type="checkbox" id="ed-check" ${isChecked ? 'checked' : ''}/>
      <span class="ed-item-name"><span class="id">${escapeHtml(item.id)}</span> — ${escapeHtml(item.description)}${edCode ? `<span class="code-tag">${escapeHtml(edCode)}</span>` : ''}</span>
    </div>
    ${item.note ? `<div class="item-note">${escapeHtml(item.note)}</div>` : ''}
    ${showUnitSelect ? `<label class="ed-unit-row"><span>Unit Selection</span><select id="ed-unit-select"></select></label>` : ''}
    <div class="ed-comment-label">Comments</div>
    <textarea id="ed-comment" class="ed-comment" rows="6" placeholder="${isAll ? 'Comment applied to all lifts…' : 'Comment for this unit…'}"></textarea>
    ${item.exampleFile ? `<button type="button" id="ed-see-example" class="ed-see-example">See Example</button>` : ''}`;

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
  const partial = isAll && !allChecked && !noneChecked;
  if (isAll) check.indeterminate = partial;
  check.classList.toggle('partial', partial); // amber (not green) indeterminate dash, matching the list

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

  const exampleBtn = body.querySelector('#ed-see-example');
  if (exampleBtn) exampleBtn.addEventListener('click', () => openExample(item.exampleFile));
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
  checklistSplitter.apply(checklistSplitter.stored());
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

async function downloadProjectZip(project = getCurrentProject(), mode = 'outstanding') {
  if (!project) return;
  try {
    const plan = buildExportPlan(state.model, project, { mode });
    const now = new Date();
    const reviewDate = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;
    const wb = buildExportWorkbook({ XLSX, model: state.model, project, plan, reviewDate, mode });
    const workbookArrayBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array', cellStyles: true });

    const files = new Map();
    const missing = [];
    for (const name of plan.referencedFiles) {
      const blob = await exampleStore.get(name);
      if (blob) files.set(name, blob);
      else missing.push(name);
    }

    // One base name shared by the ZIP, the folder inside it, and the workbook.
    // Keep the project title's spaces; strip only characters illegal in file
    // names. e.g. "Smoke Tower_Compliance Review - Outstanding".
    const safeTitle = (project.name || 'Project').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Project';
    const suffix = mode === 'full' ? 'Full' : 'Outstanding';
    const base = `${safeTitle}_Compliance Review - ${suffix}`;
    const zipBlob = await buildExportZip({
      workbookName: `${base}.xlsx`,
      workbookArrayBuffer,
      files,
      folderName: base,
    });
    downloadBlob(zipBlob, `${base}.zip`);
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
const MIN_CARD_WIDTH = 280;

// A draggable vertical splitter that trades width between a flex row's two
// cards. The right-hand card's width lives in `cssVar` on `body` (+ localStorage
// under `storeKey`); the left card takes the rest. Used by both the checklist
// detail panel and the dashboard details card.
function createSplitter({ splitterId, getBody, cssVar, storeKey, defaultWidth }) {
  // Clamp a desired right-card width so neither card drops below MIN_CARD_WIDTH.
  function clamp(px, body) {
    const splitter = document.getElementById(splitterId);
    const sw = splitter ? splitter.offsetWidth : 16;
    const max = body.clientWidth - MIN_CARD_WIDTH - sw;
    if (max < MIN_CARD_WIDTH) return Math.max(0, max); // window too narrow for both mins
    return Math.max(MIN_CARD_WIDTH, Math.min(px, max));
  }
  function stored() {
    let v = NaN;
    try { v = Number(window.localStorage.getItem(storeKey)); } catch { /* ignore */ }
    return Number.isFinite(v) && v > 0 ? v : defaultWidth;
  }
  function current(body) {
    return parseFloat(getComputedStyle(body).getPropertyValue(cssVar)) || stored();
  }
  function apply(px) {
    const body = getBody();
    if (!body || body.clientWidth <= 0) return;
    body.style.setProperty(cssVar, clamp(px, body) + 'px');
  }
  function wire() {
    const splitter = document.getElementById(splitterId);
    if (!splitter) return;
    let dragging = false;
    splitter.addEventListener('pointerdown', (e) => {
      if (!getBody()) return;
      dragging = true;
      splitter.classList.add('dragging');
      try { splitter.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      e.preventDefault();
    });
    splitter.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const body = getBody();
      if (!body) return;
      apply(body.getBoundingClientRect().right - e.clientX);
    });
    const end = (e) => {
      if (!dragging) return;
      dragging = false;
      splitter.classList.remove('dragging');
      try { splitter.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
      const body = getBody();
      if (body) {
        try { window.localStorage.setItem(storeKey, String(Math.round(current(body)))); } catch { /* ignore */ }
      }
    };
    splitter.addEventListener('pointerup', end);
    splitter.addEventListener('pointercancel', end);
    // Keep the stored width valid (clamped) when the window resizes — only while
    // this splitter's row is actually on screen.
    window.addEventListener('resize', () => {
      const body = getBody();
      if (body && body.offsetParent !== null) apply(current(body));
    });
  }
  return { apply, wire, stored };
}

const checklistSplitter = createSplitter({
  splitterId: 'card-splitter',
  getBody: () => document.querySelector('#screen-project .project-body'),
  cssVar: '--detail-w', storeKey: 'dpchecklist.detailWidth', defaultWidth: 350,
});
const dashSplitter = createSplitter({
  splitterId: 'dash-splitter',
  getBody: () => document.querySelector('.dash-wrap'),
  cssVar: '--dash-detail-w', storeKey: 'dpchecklist.dashDetailWidth', defaultWidth: 420,
});

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
// Single source of truth for the collapsed-sidebar state: toggles the class,
// syncs the toggle button's aria, and (by default) persists the choice.
// persist=false is used only to reflect the pre-paint bootstrap state.
function setSidebarCollapsed(collapsed, persist = true) {
  document.documentElement.classList.toggle('sidebar-collapsed', collapsed);
  const btn = document.getElementById('sidebar-toggle');
  if (btn) {
    btn.setAttribute('aria-expanded', String(!collapsed));
    btn.setAttribute('aria-label', collapsed ? 'Expand sidebar' : 'Collapse sidebar');
  }
  if (persist) {
    try { window.localStorage.setItem(SIDEBAR_KEY, collapsed ? 'collapsed' : 'expanded'); } catch { /* ignore */ }
  }
}
function wireSidebarToggle() {
  const btn = document.getElementById('sidebar-toggle');
  if (!btn) return;
  // Reflect the state already applied pre-paint by the <head> bootstrap.
  setSidebarCollapsed(document.documentElement.classList.contains('sidebar-collapsed'), false);
  btn.addEventListener('click', () => {
    setSidebarCollapsed(!document.documentElement.classList.contains('sidebar-collapsed'));
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
  let open = false; // default collapsed; only open if the user previously expanded it
  try { open = window.localStorage.getItem(PINNED_NAV_KEY) === 'expanded'; } catch { /* ignore */ }
  apply(open);
  btn.addEventListener('click', () => {
    // When the sidebar is collapsed the pinned sublist is hidden, so a plain
    // toggle would do nothing visible. Instead, expand the sidebar and open the
    // list in one action; when already expanded, keep toggling as usual.
    if (document.documentElement.classList.contains('sidebar-collapsed')) {
      setSidebarCollapsed(false);
      open = true;
    } else {
      open = !wrap.classList.contains('open');
    }
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
  wireNewMenu();
  wireDashboardActions();
  checklistSplitter.wire();
  dashSplitter.wire();
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
  document.getElementById('editor-add-unit').addEventListener('click', addEditorUnit);
  const grid = document.getElementById('editor-grid');
  grid.addEventListener('keydown', onGridKeydown);
  grid.addEventListener('paste', onGridPaste);

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
  wireExportDropdown({
    btnId: 'btn-download-zip', menuId: 'dl-export-menu',
    fullId: 'dl-export-full', outId: 'dl-export-outstanding',
    getProject: () => getCurrentProject(),
  });
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
