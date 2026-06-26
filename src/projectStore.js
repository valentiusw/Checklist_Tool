const INDEX_KEY = 'dpchecklist.projects.index';
const PROJECT_PREFIX = 'dpchecklist.project.';

function newId(prefix = 'p') {
  return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

function newUnit(name) {
  return { id: newId('u'), name: name || 'Unit 1', inputs: {}, checks: {}, comments: {} };
}

function migrateProject(p) {
  if (!p) return p;
  if (Array.isArray(p.units)) return p;
  // Legacy flat project -> wrap into a single unit.
  return {
    id: p.id,
    name: p.name,
    updatedAt: p.updatedAt,
    units: [{
      id: newId('u'),
      name: 'Unit 1',
      inputs: p.inputs || {},
      checks: p.checks || {},
      comments: p.comments || {},
    }],
  };
}

function normalizeUnit(u) {
  return {
    id: u && u.id ? u.id : newId('u'),
    name: (u && u.name) || 'Unit 1',
    inputs: (u && u.inputs) || {},
    checks: (u && u.checks) || {},
    comments: (u && u.comments) || {},
  };
}

export function createProjectStore(storage) {
  function readIndex() {
    const raw = storage.getItem(INDEX_KEY);
    if (!raw) return [];
    try { return JSON.parse(raw); } catch { return []; }
  }
  function writeIndex(index) {
    storage.setItem(INDEX_KEY, JSON.stringify(index));
  }
  function upsertIndex(project) {
    const index = readIndex().filter(s => s.id !== project.id);
    index.push({ id: project.id, name: project.name, updatedAt: project.updatedAt });
    writeIndex(index);
  }

  function listProjects() {
    return readIndex().slice().sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  }

  function getProject(id) {
    const raw = storage.getItem(PROJECT_PREFIX + id);
    if (!raw) return null;
    try { return migrateProject(JSON.parse(raw)); } catch { return null; }
  }

  function saveProject(project) {
    project.updatedAt = new Date().toISOString();
    storage.setItem(PROJECT_PREFIX + project.id, JSON.stringify(project));
    upsertIndex(project);
  }

  function createProject(name) {
    const project = {
      id: newId('p'),
      name: name || 'Untitled project',
      units: [newUnit('Unit 1')],
      updatedAt: new Date().toISOString(),
    };
    saveProject(project);
    return project;
  }

  function deleteProject(id) {
    storage.removeItem(PROJECT_PREFIX + id);
    writeIndex(readIndex().filter(s => s.id !== id));
  }

  function serializeProject(project) {
    return JSON.stringify({
      name: project.name,
      units: (project.units || []).map(u => ({
        name: u.name, inputs: u.inputs || {}, checks: u.checks || {}, comments: u.comments || {},
      })),
    }, null, 2);
  }

  function importProject(jsonString) {
    const data = JSON.parse(jsonString);
    let units;
    if (Array.isArray(data.units)) {
      units = data.units.map(normalizeUnit);
    } else {
      // Legacy flat shape.
      units = [{
        id: newId('u'), name: 'Unit 1',
        inputs: data.inputs || {}, checks: data.checks || {}, comments: data.comments || {},
      }];
    }
    if (units.length === 0) units = [newUnit('Unit 1')];
    const project = {
      id: newId('p'),
      name: data.name || 'Imported project',
      units,
      updatedAt: new Date().toISOString(),
    };
    saveProject(project);
    return project;
  }

  // Full backup of every project (with ids, units, and timestamps) for data-loss recovery.
  function serializeLibrary() {
    const projects = readIndex()
      .map(s => getProject(s.id))
      .filter(Boolean);
    return JSON.stringify({
      type: 'dpchecklist.library',
      version: 1,
      exportedAt: new Date().toISOString(),
      projects,
    }, null, 2);
  }

  // Restore a backup. Projects are merged by id (same id overwrites, new id is added),
  // preserving ids and updatedAt so the library is reproduced as-is. Returns the count.
  function importLibrary(jsonString) {
    const data = JSON.parse(jsonString);
    const list = Array.isArray(data) ? data : (data && data.projects) || [];
    if (!Array.isArray(list)) throw new Error('Not a valid project library file');
    const index = readIndex();
    for (const raw of list) {
      const project = migrateProject(raw);
      if (!project.id) project.id = newId('p');
      project.name = project.name || 'Imported project';
      const units = (project.units && project.units.length ? project.units : [newUnit('Unit 1')]).map(normalizeUnit);
      project.units = units;
      project.updatedAt = project.updatedAt || new Date().toISOString();
      storage.setItem(PROJECT_PREFIX + project.id, JSON.stringify(project));
      const entry = { id: project.id, name: project.name, updatedAt: project.updatedAt };
      const i = index.findIndex(s => s.id === project.id);
      if (i === -1) index.push(entry); else index[i] = entry;
    }
    writeIndex(index);
    return list.length;
  }

  return {
    listProjects, getProject, createProject, saveProject,
    deleteProject, serializeProject, importProject, newUnit,
    serializeLibrary, importLibrary,
  };
}
