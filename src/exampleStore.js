// Persistence for the binary Examples files (PDFs/images), keyed by bare
// filename, in the shared `examples` object store. Schema is owned by db.js.
import { open } from './db.js';

const STORE = 'examples';

// The ZIP's actual filenames and the workbook's Example-column spelling are
// maintained independently — and on Windows the filesystem is case-insensitive,
// so a file saved as "Photo.PNG" is happily referenced as "Photo.png". Keys are
// normalized (bare filename, trimmed, lowercased) on both write and read so a
// lookup survives case, path-prefix, and whitespace differences. Pure.
export function normalizeExampleKey(name) {
  if (name === undefined || name === null) return '';
  return String(name).trim().split(/[\\/]/).pop().toLowerCase();
}

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
    for (const [name, blob] of fileMap) store.put(blob, normalizeExampleKey(name));
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

export async function get(name) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const r = db.transaction(STORE, 'readonly').objectStore(STORE).get(normalizeExampleKey(name));
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
