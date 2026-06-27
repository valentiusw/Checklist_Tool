// File System Access wrapper for the connected backup file. No reconcile logic
// (that lives in librarySnapshot.js) and no IndexedDB (the caller persists the
// handle via db.setMeta). Returns null when the user cancels a picker.

export function isSupported() {
  return typeof window !== 'undefined' && 'showSaveFilePicker' in window;
}

export async function connect() {
  try {
    return await window.showSaveFilePicker({
      suggestedName: 'checklist-backup.json',
      types: [{ description: 'Smart Checklist backup', accept: { 'application/json': ['.json'] } }],
    });
  } catch (err) {
    if (err && err.name === 'AbortError') return null;
    throw err;
  }
}

export async function connectExisting() {
  try {
    const [handle] = await window.showOpenFilePicker({
      types: [{ description: 'Smart Checklist backup', accept: { 'application/json': ['.json'] } }],
      multiple: false,
    });
    return handle || null;
  } catch (err) {
    if (err && err.name === 'AbortError') return null;
    throw err;
  }
}

export async function ensurePermission(handle, mode = 'readwrite') {
  const opts = { mode };
  if ((await handle.queryPermission(opts)) === 'granted') return true;
  return (await handle.requestPermission(opts)) === 'granted';
}

export async function writeSnapshot(handle, text) {
  const writable = await handle.createWritable();
  await writable.write(text);
  await writable.close();
}

export async function readSnapshot(handle) {
  const file = await handle.getFile();
  return file.text();
}
