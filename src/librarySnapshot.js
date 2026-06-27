// The connected-backup file format and the reconcile rule. Pure: no browser APIs.
const TYPE = 'dpchecklist.library';

export function buildSnapshot(model, projects, savedAt) {
  return JSON.stringify({ type: TYPE, version: 1, savedAt, model, projects }, null, 2);
}

export function parseSnapshot(text) {
  const data = JSON.parse(text);
  if (!data || data.type !== TYPE) throw new Error('Not a Smart Checklist backup file');
  return {
    model: data.model ?? null,
    projects: Array.isArray(data.projects) ? data.projects : [],
    savedAt: data.savedAt ?? null,
  };
}

// Decide which side is newer. Newer savedAt wins; the file wins exact ties and
// whenever a timestamp is missing on the other side, so a backup is never lost.
export function chooseNewer(localSavedAt, fileSavedAt) {
  const l = localSavedAt ? Date.parse(localSavedAt) : NaN;
  const f = fileSavedAt ? Date.parse(fileSavedAt) : NaN;
  const lOk = !Number.isNaN(l), fOk = !Number.isNaN(f);
  if (!lOk && !fOk) return 'equal';
  if (!lOk) return 'file';
  if (!fOk) return 'local';
  return l > f ? 'local' : 'file';   // file wins exact ties
}
