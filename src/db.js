// The one place that defines the IndexedDB schema for the whole app.
// Stores: projects (id -> project), kv (key -> value).
const DB_NAME = 'dpchecklist';
const VERSION = 3;
const STORES = ['projects', 'kv'];

let dbPromise = null;

export function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of STORES) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
      }
      // v3 dropped the example-file blob store — examples are URLs now.
      if (db.objectStoreNames.contains('examples')) db.deleteObjectStore('examples');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(db, store, mode) {
  return db.transaction(store, mode).objectStore(store);
}

function reqDone(request, t) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    if (t) t.onerror = () => reject(t.error);
  });
}

export async function putProject(project) {
  const db = await open();
  const t = db.transaction('projects', 'readwrite');
  t.objectStore('projects').put(project, project.id);
  return new Promise((res, rej) => { t.oncomplete = () => res(); t.onerror = () => rej(t.error); });
}

export async function deleteProject(id) {
  const db = await open();
  const t = db.transaction('projects', 'readwrite');
  t.objectStore('projects').delete(id);
  return new Promise((res, rej) => { t.oncomplete = () => res(); t.onerror = () => rej(t.error); });
}

export async function clearProjects() {
  const db = await open();
  const t = db.transaction('projects', 'readwrite');
  t.objectStore('projects').clear();
  return new Promise((res, rej) => { t.oncomplete = () => res(); t.onerror = () => rej(t.error); });
}

export async function setMeta(key, value) {
  const db = await open();
  const t = db.transaction('kv', 'readwrite');
  t.objectStore('kv').put(value, key);
  return new Promise((res, rej) => { t.oncomplete = () => res(); t.onerror = () => rej(t.error); });
}

export async function getMeta(key) {
  const db = await open();
  return reqDone(tx(db, 'kv', 'readonly').get(key));
}

export async function loadSnapshot() {
  const db = await open();
  const projects = await reqDone(tx(db, 'projects', 'readonly').getAll());
  const model = await getMeta('model');
  const savedAt = await getMeta('savedAt');
  return { model: model || null, projects: projects || [], savedAt: savedAt || null };
}
