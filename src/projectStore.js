export function newId(prefix = 'p') {
  return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

export function newUnit(name) {
  return { id: newId('u'), name: name || 'Unit 1', inputs: {}, checks: {}, comments: {} };
}

function migrateProject(p) {
  if (!p) return p;
  if (Array.isArray(p.units)) return p;
  // Legacy flat project -> wrap into a single unit.
  return {
    id: p.id, name: p.name, updatedAt: p.updatedAt,
    units: [{ id: newId('u'), name: 'Unit 1', inputs: p.inputs || {}, checks: p.checks || {}, comments: p.comments || {} }],
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

const clone = (o) => JSON.parse(JSON.stringify(o));

export function createProjectStore({ onChange } = {}) {
  const projects = new Map(); // id -> stored project (owned copy)
  const notify = (type, id) => { if (onChange) onChange({ type, id }); };

  function load(list) {
    projects.clear();
    for (const raw of list || []) {
      const p = migrateProject(raw);
      if (p && p.id) projects.set(p.id, clone(p));
    }
  }

  function listProjects() {
    return [...projects.values()]
      .map(p => ({ id: p.id, name: p.name, updatedAt: p.updatedAt, pinned: !!p.pinned }))
      .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  }

  function getProject(id) {
    const p = projects.get(id);
    return p ? clone(p) : null;
  }

  function saveProject(project) {
    const stored = clone(project);
    stored.updatedAt = new Date().toISOString();
    projects.set(stored.id, stored);
    notify('upsert', stored.id);
  }

  function setPinned(id, pinned) {
    const p = projects.get(id);
    if (!p) return;
    if (pinned) p.pinned = true;
    else delete p.pinned;
    notify('upsert', id);
  }

  function createProject(name) {
    const project = {
      id: newId('p'), name: name || 'Untitled project',
      units: [newUnit('Unit 1')], updatedAt: new Date().toISOString(),
    };
    projects.set(project.id, clone(project));
    notify('upsert', project.id);
    return clone(project);
  }

  function deleteProject(id) {
    if (projects.delete(id)) notify('delete', id);
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
    if (Array.isArray(data.units)) units = data.units.map(normalizeUnit);
    else units = [{ id: newId('u'), name: 'Unit 1', inputs: data.inputs || {}, checks: data.checks || {}, comments: data.comments || {} }];
    if (units.length === 0) units = [newUnit('Unit 1')];
    const project = { id: newId('p'), name: data.name || 'Imported project', units, updatedAt: new Date().toISOString() };
    projects.set(project.id, clone(project));
    notify('upsert', project.id);
    return clone(project);
  }

  function serializeLibrary() {
    return JSON.stringify({
      type: 'dpchecklist.library', version: 1,
      exportedAt: new Date().toISOString(),
      projects: [...projects.values()].map(clone),
    }, null, 2);
  }

  function importLibrary(jsonString) {
    const data = JSON.parse(jsonString);
    const list = Array.isArray(data) ? data : (data && data.projects) || [];
    if (!Array.isArray(list)) throw new Error('Not a valid project library file');
    for (const raw of list) {
      const project = clone(migrateProject(raw));
      if (!project.id) project.id = newId('p');
      project.name = project.name || 'Imported project';
      project.units = (project.units && project.units.length ? project.units : [newUnit('Unit 1')]).map(normalizeUnit);
      project.updatedAt = project.updatedAt || new Date().toISOString();
      projects.set(project.id, clone(project));
      notify('upsert', project.id);
    }
    return list.length;
  }

  return {
    load, listProjects, getProject, saveProject, deleteProject, createProject,
    newUnit, serializeProject, importProject, serializeLibrary, importLibrary,
    setPinned,
  };
}
