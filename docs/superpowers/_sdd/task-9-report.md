# Task 9 Report: Project View

## node --check src/app.js
Exit 0. No syntax errors.

## node --test (full suite)
28 pass / 0 fail / 0 skip

```
✔ boolean equality
✔ numeric comparison ignores trailing unit
✔ choice equality and inequality
✔ AND / OR composition
✔ unknown input throws ConditionError
✔ isApplicable returns true for null ast
✔ tokenizes a simple boolean equality
✔ tokenizes colon separator with leading operator and unit
✔ tokenizes >= and quoted choice value
✔ tokenizes AND, OR and parens
✔ parseCondition builds AND tighter than OR
✔ parseCondition respects parentheses
✔ unparseable input throws ConditionError
✔ applicableItems filters by condition
✔ computeProgress = checked / applicable
✔ computeProgress ratio is 0 when none applicable
✔ buildExportRows lists applicable unchecked items with header
✔ create, list, get a project
✔ save updates fields and updatedAt
✔ delete removes the project
✔ serialize then import yields an equal project with a new id
✔ importProject rejects malformed JSON
✔ test runner works
✔ builds inputs with parsed choices and defaults
✔ builds items; empty condition -> null
✔ missing column throws ModelError naming it
✔ invalid input type throws ModelError
✔ condition referencing unknown input throws ModelError
tests 28 | pass 28 | fail 0 | cancelled 0 | skipped 0 | todo 0
```

## Confirmation of Requirements

### Import extension
`import { computeProgress, applicableItems } from './exporter.js';`
`applicableItems` is now imported alongside `computeProgress`. Confirmed in line 3 of src/app.js.

### renderProject is now a real function
`renderProject()` is defined as a concrete function (no longer only the guard target in Task 8's `typeof renderProject === 'function'` check). It calls `getCurrentProject()`, sets the project title, renders inputs, saves defaults, renders items and progress.

### Back button wired in init()
`document.getElementById('btn-back').addEventListener('click', () => showScreen('dashboard'));`
Added inside `init()` after the nav-setup listener.

## Functions Added (all above init)
- `getCurrentProject()` — returns `state.store.getProject(state.currentProjectId)`
- `saveCurrent(project)` — calls `state.store.saveProject(project)`
- `defaultInputValue(def)` — returns type-appropriate default for an input definition
- `renderInputs(project)` — builds the inputs panel DOM (checkbox/select/number per type), wires change/input events to `updateInput`
- `updateInput(name, value)` — updates project.inputs, saves, re-renders items and progress
- `renderItems(project)` — renders applicable items with done checkboxes and comment textareas; wires change events for auto-save
- `renderProgress(project)` — updates the progress bar and label
- `renderProject()` — top-level render entry point called by Task 8's `openProject`

## Commit
Hash: `93dfdd3`
Message: `feat: project view with live filtering, checks, comments, autosave`
Files changed: `src/app.js` (+119 insertions, -1 deletion)

## Concerns
None. All static checks pass, full test suite 28/28. Browser verification (dynamic filtering, persistence) deferred to orchestrator per spec.

## Fix applied: Escape item.id in checkbox data attribute

**Before (line 207):**
```
<input type="checkbox" data-check="${item.id}" ${checked ? 'checked' : ''} />
```

**After (line 207):**
```
<input type="checkbox" data-check="${escapeHtml(item.id)}" ${checked ? 'checked' : ''} />
```

**Verification:**
- `node --check src/app.js` — exit 0
- `node --test` — 28 pass / 0 fail
- Commit hash: `c3fe6ac`
