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
      .map(p => ({ id: p.id, name: p.name, updatedAt: p.updatedAt, pinned: !!p.pinned, pinnedOrder: p.pinnedOrder, archived: !!p.archived }))
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
    // Archived projects can't be pinned — they've left the active workspace.
    if (pinned && p.archived) return;
    if (pinned) {
      p.pinned = true;
      // Append to the bottom of the custom pinned order.
      const orders = [...projects.values()]
        .filter(o => o.pinned && o.id !== id && Number.isFinite(o.pinnedOrder))
        .map(o => o.pinnedOrder);
      p.pinnedOrder = orders.length ? Math.max(...orders) + 1 : 0;
    } else {
      delete p.pinned;
      delete p.pinnedOrder;
    }
    notify('upsert', id);
  }

  // Archive / unarchive a completed project. Archiving also unpins it (and drops
  // its custom order) so it leaves the active list and the pinned sidebar.
  // updatedAt is left untouched — archiving isn't an edit. No-op for unknown ids.
  function setArchived(id, archived) {
    const p = projects.get(id);
    if (!p) return;
    if (archived) {
      p.archived = true;
      delete p.pinned;
      delete p.pinnedOrder;
    } else {
      delete p.archived;
    }
    notify('upsert', id);
  }

  // Reassign the custom pinned order from an explicit id sequence (top→bottom).
  // Unknown or unpinned ids are skipped; updatedAt is left untouched.
  function reorderPinned(orderedIds) {
    let i = 0;
    for (const id of orderedIds || []) {
      const p = projects.get(id);
      if (!p || !p.pinned) continue;
      p.pinnedOrder = i++;
      notify('upsert', id);
    }
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
    setPinned, reorderPinned, setArchived,
  };
}
