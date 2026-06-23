const INDEX_KEY = 'dpchecklist.projects.index';
const PROJECT_PREFIX = 'dpchecklist.project.';

function newId() {
  return 'p_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
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
    try { return JSON.parse(raw); } catch { return null; }
  }

  function saveProject(project) {
    project.updatedAt = new Date().toISOString();
    storage.setItem(PROJECT_PREFIX + project.id, JSON.stringify(project));
    upsertIndex(project);
  }

  function createProject(name) {
    const project = {
      id: newId(),
      name: name || 'Untitled project',
      inputs: {},
      checks: {},
      comments: {},
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
      inputs: project.inputs || {},
      checks: project.checks || {},
      comments: project.comments || {},
    }, null, 2);
  }

  function importProject(jsonString) {
    const data = JSON.parse(jsonString);
    const project = {
      id: newId(),
      name: data.name || 'Imported project',
      inputs: data.inputs || {},
      checks: data.checks || {},
      comments: data.comments || {},
      updatedAt: new Date().toISOString(),
    };
    saveProject(project);
    return project;
  }

  return {
    listProjects, getProject, createProject, saveProject,
    deleteProject, serializeProject, importProject,
  };
}
