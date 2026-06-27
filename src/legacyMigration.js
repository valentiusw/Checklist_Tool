// Read the pre-IndexedDB localStorage layout for the one-time migration:
//   dpchecklist.model            -> serializable model JSON
//   dpchecklist.projects.index   -> [{ id, name, updatedAt }]
//   dpchecklist.project.<id>     -> project JSON
const MODEL_KEY = 'dpchecklist.model';
const INDEX_KEY = 'dpchecklist.projects.index';
const PROJECT_PREFIX = 'dpchecklist.project.';

function tryParse(raw) {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export function readLegacy(storage) {
  const model = tryParse(storage.getItem(MODEL_KEY));
  const index = tryParse(storage.getItem(INDEX_KEY)) || [];
  const projects = [];
  for (const entry of Array.isArray(index) ? index : []) {
    if (!entry || !entry.id) continue;
    const p = tryParse(storage.getItem(PROJECT_PREFIX + entry.id));
    if (p) projects.push(p);
  }
  return { model: model || null, projects };
}
