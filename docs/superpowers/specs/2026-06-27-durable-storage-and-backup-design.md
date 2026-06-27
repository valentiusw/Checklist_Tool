# Durable Storage & Connected Backup — Design

Date: 2026-06-27

## Summary

Make the user's data durable and remove the `localStorage` size ceiling, in two
phases:

- **Phase 1 — Unified IndexedDB store.** Move the live checklist **model** and
  all **projects** out of `localStorage` into IndexedDB (which already holds the
  example files), using an in-memory working set with debounced async flush so
  the UI stays synchronous. This removes the ~5 MB `localStorage` cap and the
  model/projects ↔ examples desync risk.
- **Phase 2 — Connected backup file.** Auto-save a full JSON snapshot
  (`model` + `projects`) to a real on-disk file via the File System Access API,
  so the user's work survives a browser-data wipe. Reconnecting each session
  reconciles by timestamp. Degrades gracefully to the existing manual
  Save/Restore when the API is unavailable or blocked.

## Goals

- Removing the ~5 MB `localStorage` limit on model + projects.
- Surviving a browser-data wipe without the user remembering to back up.
- No admin rights, no install, no network — works on a locked-down work laptop
  served at `http://localhost`.
- Keep the UI synchronous and the existing render code largely unchanged.

## Non-goals

- Including example images/PDFs in the backup file (the user chose project work
  only; examples reload from the setup ZIP).
- Multi-device real-time sync or any server component.
- Backup support in browsers without the File System Access API (Firefox/Safari)
  beyond the existing manual Save/Restore fallback.

## Context (current state)

- Checklist **model** persists to `localStorage` key `dpchecklist.model`
  (`persistModel`/`restoreModel` in `app.js`).
- **Projects** persist to `localStorage` via `projectStore.js`
  (`dpchecklist.projects.index` + `dpchecklist.project.<id>`), read
  synchronously on every render.
- **Example files** persist in IndexedDB (`dpchecklist` db, `examples` store) via
  `exampleStore.js`.
- Manual backup exists: "Save project library" / "Restore library" buttons
  (`serializeLibrary`/`importLibrary`) export projects-only JSON.

## Phase 1 — Unified IndexedDB store

### IndexedDB schema (db `dpchecklist`, version 2)

Object stores:

- `examples` — key = filename, value = `Blob` (unchanged).
- `projects` — key = project `id`, value = the project object.
- `kv` — small key/value store. Keys:
  - `model` — the serializable model (same shape `persistModel` writes today).
  - `savedAt` — ISO timestamp of the last persisted change.
  - `backupHandle` — the `FileSystemFileHandle` (Phase 2; structured-cloneable,
    so it persists in IndexedDB).

The `onupgradeneeded` handler creates any missing store, so it upgrades cleanly
from the existing v1 (which had only `examples`).

### In-memory working set + async flush

- At startup the app performs one async `db.loadSnapshot()` →
  `{ model, projects, savedAt }`, seeding `state.model` and the in-memory
  `projectStore`.
- All reads and mutations during the session operate on the in-memory state
  **synchronously** — the existing render/update functions keep working as-is.
- After any mutation, a debounced (~300 ms) flush writes the changed record(s)
  to IndexedDB (`putProject` / `deleteProject` / `putModel`) and updates
  `savedAt`. A flush also schedules the Phase 2 file write.

### One-time migration

On startup, if the `projects` store and `kv.model` are both empty but the legacy
`localStorage` keys exist, copy them into IndexedDB once:

- `dpchecklist.model` → `kv.model`.
- `dpchecklist.projects.index` + each `dpchecklist.project.<id>` → `projects`.

Migration runs only when IndexedDB is empty, so it never clobbers newer data.
After a successful migration the legacy `localStorage` keys are left in place
(harmless) and the app no longer reads them; this keeps a fallback copy in case
the migration is ever re-examined.

## Phase 2 — Connected backup file

### Snapshot format

A JSON document written to the user's chosen file:

```
{ "type": "dpchecklist.library", "version": 1, "savedAt": "<ISO>",
  "model": <serializable model>, "projects": [ <project>, ... ] }
```

This is the existing library shape plus the `model`, so a manual
Save/Restore and the auto-save use the same format and a backup can restore the
model too.

### Connect / auto-save / reconnect

- **Connect** (Settings → "Back up to a file…"): `showSaveFilePicker` →
  `FileSystemFileHandle`; store it in `kv.backupHandle`; write the current
  snapshot. Status shows the connected filename.
- **Open existing** ("Open existing backup…"): `showOpenFilePicker` → read its
  snapshot, reconcile, store the handle. Used to bind to a file you already have
  and as the recovery path after a wipe (when the stored handle is gone).
- **Auto-save:** after any change, a debounced (~1 s) write of the full snapshot
  to the connected handle.
- **Reconnect** (each new session, handle present in `kv`): one click →
  `ensurePermission(handle, 'readwrite')` (the API requires a user gesture to
  re-grant) → read the file's snapshot → `chooseNewer(localSavedAt, fileSavedAt)`:
  - file newer → load file's model+projects into memory and IndexedDB
    (wipe-recovery path);
  - local newer → write local snapshot to the file;
  - equal → nothing.
  Then resume auto-save.

### Wipe-recovery flow

A full browser-data wipe clears IndexedDB, including `kv.backupHandle`. Recovery:
open the app (empty) → Settings → "Open existing backup…" → pick the file →
its snapshot loads (file is newer than the empty local state). Example images
are repopulated by re-importing the setup ZIP.

## Module boundaries

- **`db.js`** *(new)* — owns the IndexedDB schema and versioning (v2:
  `examples`, `projects`, `kv`) and low-level ops: `open()`, `loadSnapshot()`,
  `putProject(p)`, `deleteProject(id)`, `putModel(model)`, `getMeta(key)`,
  `setMeta(key, val)`. Single source of truth for the schema.
- **`exampleStore.js`** *(refactor)* — keeps its `clear/putAll/get/keys` API but
  obtains the connection from `db.open()` instead of opening its own v1 db, so
  only `db.js` defines the schema/version.
- **`librarySnapshot.js`** *(new, pure — no browser APIs)* —
  `buildSnapshot(model, projects, savedAt)`, `parseSnapshot(text)`,
  `chooseNewer(localSavedAt, fileSavedAt)` → `'local' | 'file' | 'equal'`. The
  reconcile logic lives here, isolated and testable.
- **`projectStore.js`** *(refactor)* — becomes an in-memory store over a `Map`:
  synchronous `listProjects/getProject/saveProject/deleteProject/createProject`
  plus the existing `serialize/import` logic. Seeded at startup via a new
  `load(projects)` and emits an `onChange` callback so persistence can flush. No
  longer touches `localStorage`.
- **`fileBackup.js`** *(new)* — File System Access wrapper: `isSupported()`,
  `connect()`, `connectExisting()`, `getStoredHandle()`,
  `ensurePermission(handle, mode)`, `readSnapshot(handle)`,
  `writeSnapshot(handle, text)`. Contains no reconcile logic.
- **`app.js`** *(changes)* — async startup load; debounced flush wiring to
  IndexedDB and the backup file; backup UI (connect / open-existing / reconnect
  / status indicator); reconcile-on-reconnect.

## Error handling & graceful fallback

- **FSA unsupported** (`!fileBackup.isSupported()`) → hide the connect buttons;
  show the existing manual Save/Restore plus a one-line note that auto-save to a
  file isn't available in this browser.
- **Picker cancelled / blocked by policy** (`showSaveFilePicker` throws) → catch;
  status "Couldn't connect a backup file; manual Save/Restore still works."
  Nothing is lost.
- **Permission lost / write fails mid-session** → mark "Auto-save paused —
  reconnect"; in-memory and IndexedDB data stay intact.
- **IndexedDB open/upgrade fails** (rare) → warn; run the session in-memory only
  and keep manual Save available so work can still be exported.
- **Migration** runs only when IndexedDB is empty, so it never overwrites newer
  data.

## Testing

- **Pure unit tests (`node:test`)**:
  - `librarySnapshot`: `buildSnapshot`/`parseSnapshot` round-trip; every
    `chooseNewer` branch (local newer, file newer, equal, missing/invalid
    timestamps).
  - Refactored in-memory `projectStore`: list/get/save/delete/create and
    serialize/import, seeded from an in-memory set.
  - localStorage→IndexedDB migration mapping, extracted as a pure function that
    maps legacy records to `{ model, projects }`.
- **Browser glue**: `db.js` persistence is smoke-tested via the headless-Edge
  CDP harness (create a project, reload, confirm it persists from IndexedDB).
- **Honest limitation**: the File System Access pieces (`showSaveFilePicker`,
  permission prompts) use native dialogs that cannot be driven headlessly, so the
  connect / auto-save / reconnect flow is verified **manually**. The decision
  logic it depends on (`chooseNewer`) is pure and fully unit-tested, leaving only
  thin I/O wiring unautomated.

## Phasing

The implementation plan stages this as two independently-shippable phases:

- **Phase 1 — Storage migration**: `db.js`, `exampleStore.js` refactor,
  `projectStore.js` refactor, in-memory cache + debounced flush, one-time
  localStorage→IndexedDB migration, `app.js` async startup. Delivers
  "no 5 MB cap + unified store" on its own.
- **Phase 2 — Connected backup file**: `librarySnapshot.js`, `fileBackup.js`,
  backup UI, auto-save + reconcile-on-reconnect, manual Save/Restore aligned to
  the snapshot format. Delivers durability on top of Phase 1.

## Backward compatibility

- Existing users' `localStorage` data is migrated into IndexedDB on first
  startup; nothing is lost.
- Example files in IndexedDB are unaffected (same db, additive schema upgrade).
- Manual "Save library"/"Restore library" continue to work and adopt the unified
  snapshot format (now including the model).
