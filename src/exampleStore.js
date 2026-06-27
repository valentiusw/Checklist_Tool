// Persistence for the binary Examples files (PDFs/images), keyed by bare
// filename, in the shared `examples` object store. Schema is owned by db.js.
import { open } from './db.js';

const STORE = 'examples';

export async function clear() {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, 'readwrite');
    t.objectStore(STORE).clear();
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

export async function putAll(fileMap) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, 'readwrite');
    const store = t.objectStore(STORE);
    for (const [name, blob] of fileMap) store.put(blob, name);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

export async function get(name) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const r = db.transaction(STORE, 'readonly').objectStore(STORE).get(name);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export async function keys() {
  const db = await open();
  return new Promise((resolve, reject) => {
    const r = db.transaction(STORE, 'readonly').objectStore(STORE).getAllKeys();
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
