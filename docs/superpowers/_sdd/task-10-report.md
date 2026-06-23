# Task 10 Report: Excel export of unchecked items and project file save

## node --check result

```
node --check src/app.js
Exit code: 0
```

## Full test suite output

```
✔ boolean equality (1.3413ms)
✔ numeric comparison ignores trailing unit (0.3712ms)
✔ choice equality and inequality (0.1611ms)
✔ AND / OR composition (0.9845ms)
✔ unknown input throws ConditionError (0.3792ms)
✔ isApplicable returns true for null ast (0.1284ms)
✔ tokenizes a simple boolean equality (1.8732ms)
✔ tokenizes colon separator with leading operator and unit (0.2424ms)
✔ tokenizes >= and quoted choice value (0.7387ms)
✔ tokenizes AND, OR and parens (0.1837ms)
✔ parseCondition builds AND tighter than OR (0.2369ms)
✔ parseCondition respects parentheses (0.1055ms)
✔ unparseable input throws ConditionError (0.3176ms)
✔ applicableItems filters by condition (1.189ms)
✔ computeProgress = checked / applicable (1.1313ms)
✔ computeProgress ratio is 0 when none applicable (0.3712ms)
✔ buildExportRows lists applicable unchecked items with header (0.3447ms)
✔ create, list, get a project (4.4113ms)
✔ save updates fields and updatedAt (0.2392ms)
✔ delete removes the project (0.1408ms)
✔ serialize then import yields an equal project with a new id (7.7334ms)
✔ importProject rejects malformed JSON (0.2743ms)
✔ test runner works (0.5547ms)
✔ builds inputs with parsed choices and defaults (1.5328ms)
✔ builds items; empty condition -> null (0.2375ms)
✔ missing column throws ModelError naming it (0.3499ms)
✔ invalid input type throws ModelError (0.1104ms)
✔ condition referencing unknown input throws ModelError (0.1517ms)
ℹ tests 28
ℹ suites 0
ℹ pass 28
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 126.4967
```

## Confirmation of changes

### Import extension
Line 3 of `src/app.js` updated from:
```javascript
import { computeProgress, applicableItems } from './exporter.js';
```
to:
```javascript
import { computeProgress, applicableItems, buildExportRows } from './exporter.js';
```

### New functions defined (above `init`)
- `downloadBlob(blob, filename)` — creates a temporary anchor, triggers download, cleans up
- `exportUnchecked()` — calls `buildExportRows`, builds XLSX via global `XLSX`, triggers download as `<safeName>_unchecked_<date>.xlsx`
- `saveProjectFile()` — serializes current project via `state.store.serializeProject`, triggers download as `<safeName>.json`

### Buttons wired in `init()`
- `document.getElementById('btn-export').addEventListener('click', exportUnchecked);`
- `document.getElementById('btn-save-project').addEventListener('click', saveProjectFile);`

## Commit hash

`9546c94` — feat: Excel export of unchecked items and project file save

## Concerns

None. All 28 tests pass, syntax check clean, changes are exactly per spec.
