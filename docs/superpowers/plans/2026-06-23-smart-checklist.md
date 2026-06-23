# Smart Checklist Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a single static HTML tool that renders a dynamic compliance checklist driven by per-project inputs, tracks multiple project drafts with progress bars, and exports outstanding items to Excel.

**Architecture:** All logic lives in pure ES modules (`conditionEngine`, `workbookModel`, `projectStore`, `exporter`) that take and return plain data structures, so they are unit-tested in Node with the built-in test runner and need no npm dependencies. A single `app.js` is the only DOM/browser-glue module; it parses Excel and writes Excel using a vendored SheetJS global, and is verified manually. `index.html` loads SheetJS as a classic script, then `app.js` as an ES module.

**Tech Stack:** Vanilla JavaScript (ES modules), SheetJS (vendored browser build) for Excel read/write, Node.js built-in test runner (`node --test`), browser `localStorage` for persistence.

## Global Constraints

- Static, offline, single-folder tool: no server, no build step, no runtime npm dependencies. Open `index.html` directly in a browser.
- Sensitive data never leaves the machine: Excel parsing happens entirely in-browser via SheetJS; nothing is uploaded.
- The workbook MUST contain a sheet named exactly `Checklist` and a sheet named exactly `Inputs`. Missing sheet/column → a clear load-time error naming what is missing.
- `Checklist` columns (header row, exact names): `Item ID`, `Conditions`, `Description`, `Code`, `Note`, `Example`.
- `Inputs` columns (header row, exact names): `Name`, `Type`, `Label`, `Unit`, `Choices`, `Default`.
- Input `Type` is one of exactly: `Choice`, `Float`, `Integer`, `Boolean`.
- An item with an empty `Conditions` cell ALWAYS applies.
- Conditions support `AND`, `OR`, and parenthesised grouping; `AND` binds tighter than `OR`.
- Comparison operators: `:`/`=` (equality), `!=`, `>`, `<`, `>=`, `<=`. After a `:` separator an operator may lead the value (e.g. `MaxFFLInt: >11m`). A trailing unit on a numeric literal (the `m` in `11m`) is ignored.
- Progress = checked ÷ applicable items. No "N/A" state.
- Export lists applicable-but-unchecked items only, columns: `Item ID`, `Description`, `Code`, `Note`, `Example (how to complete)`, `Your comment`.
- All test code uses ES module `import` syntax; production modules use `export`.

---

### Task 1: Project scaffold, test runner, vendored SheetJS

**Files:**
- Create: `package.json`
- Create: `vendor/xlsx.full.min.js` (downloaded)
- Create: `tests/smoke.test.js`
- Create: `src/.gitkeep`

**Interfaces:**
- Consumes: nothing
- Produces: a working `npm test` (`node --test`) command and ESM-enabled package (`"type": "module"`).

- [ ] **Step 1: Initialise git and create package.json**

Run:
```bash
cd "c:/Users/valen/Desktop/CLAUDE_PROJECTS/DP_ChecklistTool" && git init
```

Create `package.json`:
```json
{
  "name": "dp-checklist-tool",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test"
  }
}
```

- [ ] **Step 2: Write a smoke test**

Create `tests/smoke.test.js`:
```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('test runner works', () => {
  assert.equal(1 + 1, 2);
});
```

- [ ] **Step 3: Run the smoke test to confirm the runner works**

Run: `npm test`
Expected: PASS — 1 test passing.

- [ ] **Step 4: Vendor the SheetJS browser build**

Run:
```bash
mkdir -p vendor src && \
curl -L -o vendor/xlsx.full.min.js https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js
```
Expected: `vendor/xlsx.full.min.js` exists and is non-empty (hundreds of KB). Verify:
```bash
test -s vendor/xlsx.full.min.js && echo OK
```
Expected output: `OK`

- [ ] **Step 5: Create .gitignore and commit**

Create `.gitignore`:
```
node_modules/
*.log
```

Run:
```bash
git add package.json vendor/xlsx.full.min.js tests/smoke.test.js .gitignore
git commit -m "chore: scaffold project, test runner, vendored SheetJS"
```

---

### Task 2: Condition tokenizer + parser

**Files:**
- Create: `src/conditionEngine.js`
- Test: `tests/conditionEngine.parse.test.js`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `class ConditionError extends Error`
  - `tokenize(input: string): Token[]` where a Token is `{type:'LPAREN'|'RPAREN'|'AND'|'OR'}` or `{type:'CMP', name:string, op:'eq'|'ne'|'gt'|'lt'|'ge'|'le', value:string|boolean}`
  - `parseCondition(input: string): Node` where Node is a `CMP` token, or `{type:'and'|'or', left:Node, right:Node}`

- [ ] **Step 1: Write failing tests for tokenize + parseCondition**

Create `tests/conditionEngine.parse.test.js`:
```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenize, parseCondition, ConditionError } from '../src/conditionEngine.js';

test('tokenizes a simple boolean equality', () => {
  assert.deepEqual(tokenize('PitToEarth: FALSE'), [
    { type: 'CMP', name: 'PitToEarth', op: 'eq', value: false },
  ]);
});

test('tokenizes colon separator with leading operator and unit', () => {
  assert.deepEqual(tokenize('MaxFFLInt: >11m'), [
    { type: 'CMP', name: 'MaxFFLInt', op: 'gt', value: '11m' },
  ]);
});

test('tokenizes >= and quoted choice value', () => {
  assert.deepEqual(tokenize('BuildingClass: "Class 9b"'), [
    { type: 'CMP', name: 'BuildingClass', op: 'eq', value: 'Class 9b' },
  ]);
  assert.deepEqual(tokenize('MaxFFLInt >= 11'), [
    { type: 'CMP', name: 'MaxFFLInt', op: 'ge', value: '11' },
  ]);
});

test('tokenizes AND, OR and parens', () => {
  const toks = tokenize('(PitToEarth: FALSE AND MaxFFLInt: >11) OR BuildingClass: "Class 2"');
  assert.deepEqual(toks.map(t => t.type), ['LPAREN','CMP','AND','CMP','RPAREN','OR','CMP']);
});

test('parseCondition builds AND tighter than OR', () => {
  const ast = parseCondition('A: 1 OR B: 2 AND C: 3');
  // Expect: A OR (B AND C)
  assert.equal(ast.type, 'or');
  assert.equal(ast.left.name, 'A');
  assert.equal(ast.right.type, 'and');
});

test('parseCondition respects parentheses', () => {
  const ast = parseCondition('(A: 1 OR B: 2) AND C: 3');
  assert.equal(ast.type, 'and');
  assert.equal(ast.left.type, 'or');
  assert.equal(ast.right.name, 'C');
});

test('unparseable input throws ConditionError', () => {
  assert.throws(() => parseCondition('A: 1 AND AND'), ConditionError);
  assert.throws(() => tokenize('%%%'), ConditionError);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/conditionEngine.parse.test.js`
Expected: FAIL — cannot find module `../src/conditionEngine.js`.

- [ ] **Step 3: Implement tokenizer + parser**

Create `src/conditionEngine.js`:
```javascript
export class ConditionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConditionError';
  }
}

const OP_MAP = { '=': 'eq', ':': 'eq', '!=': 'ne', '>': 'gt', '<': 'lt', '>=': 'ge', '<=': 'le' };

function makeComparison(name, sep, rawValue) {
  let op = OP_MAP[sep];
  let value = rawValue;
  if (sep === ':') {
    const lead = /^(>=|<=|!=|>|<)\s*(.*)$/.exec(rawValue);
    if (lead) {
      op = OP_MAP[lead[1]];
      value = lead[2];
    } else {
      op = 'eq';
    }
  }
  // strip surrounding quotes
  const quoted = /^"([^"]*)"$|^'([^']*)'$/.exec(value);
  if (quoted) {
    value = quoted[1] !== undefined ? quoted[1] : quoted[2];
  } else if (/^(true|false)$/i.test(value)) {
    value = /^true$/i.test(value);
  }
  return { type: 'CMP', name, op, value };
}

export function tokenize(input) {
  const tokens = [];
  let i = 0;
  while (i < input.length) {
    const rest = input.slice(i);
    const ws = /^\s+/.exec(rest);
    if (ws) { i += ws[0].length; continue; }
    if (rest[0] === '(') { tokens.push({ type: 'LPAREN' }); i += 1; continue; }
    if (rest[0] === ')') { tokens.push({ type: 'RPAREN' }); i += 1; continue; }
    const mAnd = /^and\b/i.exec(rest);
    if (mAnd) { tokens.push({ type: 'AND' }); i += mAnd[0].length; continue; }
    const mOr = /^or\b/i.exec(rest);
    if (mOr) { tokens.push({ type: 'OR' }); i += mOr[0].length; continue; }
    const mCmp = /^([A-Za-z_][A-Za-z0-9_]*)\s*(>=|<=|!=|>|<|=|:)\s*("[^"]*"|'[^']*'|[^\s()]+)/.exec(rest);
    if (mCmp) {
      tokens.push(makeComparison(mCmp[1], mCmp[2], mCmp[3]));
      i += mCmp[0].length;
      continue;
    }
    throw new ConditionError(`Cannot parse condition near: "${rest}"`);
  }
  return tokens;
}

export function parseCondition(input) {
  const tokens = tokenize(input);
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];

  function parsePrimary() {
    const t = peek();
    if (!t) throw new ConditionError('Unexpected end of condition');
    if (t.type === 'LPAREN') {
      next();
      const expr = parseOr();
      if (!peek() || peek().type !== 'RPAREN') throw new ConditionError('Expected )');
      next();
      return expr;
    }
    if (t.type === 'CMP') { next(); return t; }
    throw new ConditionError(`Unexpected token: ${t.type}`);
  }

  function parseAnd() {
    let left = parsePrimary();
    while (peek() && peek().type === 'AND') {
      next();
      const right = parsePrimary();
      left = { type: 'and', left, right };
    }
    return left;
  }

  function parseOr() {
    let left = parseAnd();
    while (peek() && peek().type === 'OR') {
      next();
      const right = parseAnd();
      left = { type: 'or', left, right };
    }
    return left;
  }

  const ast = parseOr();
  if (pos !== tokens.length) throw new ConditionError('Unexpected trailing tokens');
  return ast;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/conditionEngine.parse.test.js`
Expected: PASS — all tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/conditionEngine.js tests/conditionEngine.parse.test.js
git commit -m "feat: condition tokenizer and parser with AND/OR precedence"
```

---

### Task 3: Condition evaluator

**Files:**
- Modify: `src/conditionEngine.js` (add `evaluate` and `isApplicable`)
- Test: `tests/conditionEngine.eval.test.js`

**Interfaces:**
- Consumes: `parseCondition`, Node shape from Task 2; input definitions map `defs: { [name]: { type: 'Choice'|'Float'|'Integer'|'Boolean' } }`; values map `values: { [name]: any }`.
- Produces:
  - `evaluate(ast: Node, values: object, defs: object): boolean`
  - `isApplicable(ast: Node|null, values: object, defs: object): boolean` — returns `true` when `ast` is null, else `evaluate(...)`.

- [ ] **Step 1: Write failing tests for evaluate + isApplicable**

Create `tests/conditionEngine.eval.test.js`:
```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCondition, evaluate, isApplicable, ConditionError } from '../src/conditionEngine.js';

const defs = {
  PitToEarth: { type: 'Boolean' },
  MaxFFLInt: { type: 'Float' },
  BuildingClass: { type: 'Choice' },
};

test('boolean equality', () => {
  const ast = parseCondition('PitToEarth: FALSE');
  assert.equal(evaluate(ast, { PitToEarth: false }, defs), true);
  assert.equal(evaluate(ast, { PitToEarth: true }, defs), false);
});

test('numeric comparison ignores trailing unit', () => {
  const ast = parseCondition('MaxFFLInt: >11m');
  assert.equal(evaluate(ast, { MaxFFLInt: 12 }, defs), true);
  assert.equal(evaluate(ast, { MaxFFLInt: 11 }, defs), false);
});

test('choice equality and inequality', () => {
  assert.equal(evaluate(parseCondition('BuildingClass: "Class 9b"'), { BuildingClass: 'Class 9b' }, defs), true);
  assert.equal(evaluate(parseCondition('BuildingClass != "Class 2"'), { BuildingClass: 'Class 9b' }, defs), true);
});

test('AND / OR composition', () => {
  const ast = parseCondition('(PitToEarth: FALSE AND MaxFFLInt: >11) OR BuildingClass: "Class 2"');
  assert.equal(evaluate(ast, { PitToEarth: false, MaxFFLInt: 12, BuildingClass: 'Class 9b' }, defs), true);
  assert.equal(evaluate(ast, { PitToEarth: true, MaxFFLInt: 12, BuildingClass: 'Class 2' }, defs), true);
  assert.equal(evaluate(ast, { PitToEarth: true, MaxFFLInt: 12, BuildingClass: 'Class 9b' }, defs), false);
});

test('unknown input throws ConditionError', () => {
  const ast = parseCondition('Nope: 1');
  assert.throws(() => evaluate(ast, {}, defs), ConditionError);
});

test('isApplicable returns true for null ast', () => {
  assert.equal(isApplicable(null, {}, defs), true);
  assert.equal(isApplicable(parseCondition('PitToEarth: TRUE'), { PitToEarth: false }, defs), false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/conditionEngine.eval.test.js`
Expected: FAIL — `evaluate` is not exported.

- [ ] **Step 3: Implement evaluate + isApplicable**

Append to `src/conditionEngine.js`:
```javascript
function evalComparison(node, values, defs) {
  const def = defs[node.name];
  if (!def) throw new ConditionError(`Unknown input referenced in condition: ${node.name}`);
  const actual = values[node.name];
  if (def.type === 'Boolean') {
    const expected = typeof node.value === 'boolean' ? node.value : /^true$/i.test(String(node.value));
    const a = actual === true || /^true$/i.test(String(actual));
    return node.op === 'ne' ? a !== expected : a === expected;
  }
  if (def.type === 'Float' || def.type === 'Integer') {
    const expected = parseFloat(String(node.value));
    const a = parseFloat(String(actual));
    if (Number.isNaN(expected)) throw new ConditionError(`Non-numeric value for ${node.name}: ${node.value}`);
    if (Number.isNaN(a)) return false;
    switch (node.op) {
      case 'eq': return a === expected;
      case 'ne': return a !== expected;
      case 'gt': return a > expected;
      case 'lt': return a < expected;
      case 'ge': return a >= expected;
      case 'le': return a <= expected;
      default: throw new ConditionError(`Unsupported operator: ${node.op}`);
    }
  }
  // Choice
  const expected = String(node.value);
  const a = String(actual ?? '');
  if (node.op === 'eq') return a === expected;
  if (node.op === 'ne') return a !== expected;
  throw new ConditionError(`Operator ${node.op} is not valid for Choice input ${node.name}`);
}

export function evaluate(ast, values, defs) {
  if (ast.type === 'CMP') return evalComparison(ast, values, defs);
  if (ast.type === 'and') return evaluate(ast.left, values, defs) && evaluate(ast.right, values, defs);
  if (ast.type === 'or') return evaluate(ast.left, values, defs) || evaluate(ast.right, values, defs);
  throw new ConditionError(`Unknown node type: ${ast.type}`);
}

export function isApplicable(ast, values, defs) {
  if (ast === null || ast === undefined) return true;
  return evaluate(ast, values, defs);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/conditionEngine.eval.test.js`
Expected: PASS — all tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/conditionEngine.js tests/conditionEngine.eval.test.js
git commit -m "feat: condition evaluator and applicability check"
```

---

### Task 4: Workbook model builder + validation

**Files:**
- Create: `src/workbookModel.js`
- Test: `tests/workbookModel.test.js`

**Interfaces:**
- Consumes: `parseCondition`, `ConditionError` from `conditionEngine.js`.
- Produces: `buildModel({ checklistRows, inputRows }): Model` where `checklistRows` and `inputRows` are arrays-of-arrays (first row is the header), and
  - `Model = { items: Item[], inputs: InputDef[], inputDefs: { [name]: InputDef } }`
  - `InputDef = { name, type, label, unit, choices: string[], default }`
  - `Item = { id, conditionsText, condition: Node|null, description, code, note, example }`
  - Throws `ModelError` (exported) when a sheet/column is missing, a type is invalid, or a condition references an unknown input.

- [ ] **Step 1: Write failing tests for buildModel**

Create `tests/workbookModel.test.js`:
```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildModel, ModelError } from '../src/workbookModel.js';

const inputRows = [
  ['Name', 'Type', 'Label', 'Unit', 'Choices', 'Default'],
  ['PitToEarth', 'Boolean', 'Pit is to solid earth', '', '', 'FALSE'],
  ['MaxFFLInt', 'Float', 'Max internal FFL height', 'm', '', '0'],
  ['BuildingClass', 'Choice', 'Building classification', '', 'Class 2;Class 3;Class 9b', ''],
];
const checklistRows = [
  ['Item ID', 'Conditions', 'Description', 'Code', 'Note', 'Example'],
  ['A08', '', 'Lifts not exposed to weather', 'AS3000', 'Protect from moisture', 'Seal the enclosure'],
  ['A10', 'PitToEarth: FALSE', 'CWT safety device', 'EN81-20', '', 'Fit device X'],
];

test('builds inputs with parsed choices and defaults', () => {
  const model = buildModel({ checklistRows, inputRows });
  assert.equal(model.inputs.length, 3);
  const bc = model.inputDefs.BuildingClass;
  assert.deepEqual(bc.choices, ['Class 2', 'Class 3', 'Class 9b']);
  assert.equal(model.inputDefs.MaxFFLInt.unit, 'm');
});

test('builds items; empty condition -> null', () => {
  const model = buildModel({ checklistRows, inputRows });
  assert.equal(model.items[0].id, 'A08');
  assert.equal(model.items[0].condition, null);
  assert.equal(model.items[1].condition.type, 'CMP');
  assert.equal(model.items[1].example, 'Fit device X');
});

test('missing column throws ModelError naming it', () => {
  const bad = [['Item ID', 'Conditions', 'Description', 'Code', 'Note']]; // no Example
  assert.throws(() => buildModel({ checklistRows: bad, inputRows }), /Example/);
});

test('invalid input type throws ModelError', () => {
  const badInputs = [
    ['Name', 'Type', 'Label', 'Unit', 'Choices', 'Default'],
    ['X', 'Text', 'x', '', '', ''],
  ];
  assert.throws(() => buildModel({ checklistRows, inputRows: badInputs }), ModelError);
});

test('condition referencing unknown input throws ModelError', () => {
  const badChecklist = [
    ['Item ID', 'Conditions', 'Description', 'Code', 'Note', 'Example'],
    ['A99', 'Ghost: TRUE', 'x', '', '', ''],
  ];
  assert.throws(() => buildModel({ checklistRows: badChecklist, inputRows }), ModelError);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/workbookModel.test.js`
Expected: FAIL — cannot find module `../src/workbookModel.js`.

- [ ] **Step 3: Implement buildModel**

Create `src/workbookModel.js`:
```javascript
import { parseCondition, evaluate } from './conditionEngine.js';

export class ModelError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ModelError';
  }
}

const CHECKLIST_COLS = ['Item ID', 'Conditions', 'Description', 'Code', 'Note', 'Example'];
const INPUT_COLS = ['Name', 'Type', 'Label', 'Unit', 'Choices', 'Default'];
const VALID_TYPES = ['Choice', 'Float', 'Integer', 'Boolean'];

function headerIndex(rows, requiredCols, sheetName) {
  if (!rows || rows.length === 0) throw new ModelError(`Sheet "${sheetName}" is empty`);
  const header = rows[0].map(c => String(c ?? '').trim());
  const idx = {};
  for (const col of requiredCols) {
    const i = header.indexOf(col);
    if (i === -1) throw new ModelError(`Sheet "${sheetName}" is missing required column: ${col}`);
    idx[col] = i;
  }
  return idx;
}

function cell(row, i) {
  const v = row[i];
  return v === undefined || v === null ? '' : String(v).trim();
}

function buildInputs(inputRows) {
  const idx = headerIndex(inputRows, INPUT_COLS, 'Inputs');
  const inputs = [];
  for (let r = 1; r < inputRows.length; r++) {
    const row = inputRows[r];
    const name = cell(row, idx['Name']);
    if (!name) continue;
    const type = cell(row, idx['Type']);
    if (!VALID_TYPES.includes(type)) {
      throw new ModelError(`Input "${name}" has invalid Type "${type}" (must be one of ${VALID_TYPES.join(', ')})`);
    }
    const choicesRaw = cell(row, idx['Choices']);
    const choices = choicesRaw ? choicesRaw.split(';').map(s => s.trim()).filter(Boolean) : [];
    inputs.push({
      name,
      type,
      label: cell(row, idx['Label']) || name,
      unit: cell(row, idx['Unit']),
      choices,
      default: cell(row, idx['Default']),
    });
  }
  return inputs;
}

function buildItems(checklistRows, inputDefs) {
  const idx = headerIndex(checklistRows, CHECKLIST_COLS, 'Checklist');
  const items = [];
  for (let r = 1; r < checklistRows.length; r++) {
    const row = checklistRows[r];
    const id = cell(row, idx['Item ID']);
    if (!id) continue;
    const conditionsText = cell(row, idx['Conditions']);
    let condition = null;
    if (conditionsText) {
      try {
        condition = parseCondition(conditionsText);
        // validate references by a dry-run evaluate with empty values
        evaluate(condition, {}, inputDefs);
      } catch (err) {
        throw new ModelError(`Item ${id}: ${err.message}`);
      }
    }
    items.push({
      id,
      conditionsText,
      condition,
      description: cell(row, idx['Description']),
      code: cell(row, idx['Code']),
      note: cell(row, idx['Note']),
      example: cell(row, idx['Example']),
    });
  }
  return items;
}

export function buildModel({ checklistRows, inputRows }) {
  const inputs = buildInputs(inputRows);
  const inputDefs = {};
  for (const inp of inputs) inputDefs[inp.name] = inp;
  const items = buildItems(checklistRows, inputDefs);
  return { items, inputs, inputDefs };
}
```

Note: the dry-run `evaluate(condition, {}, inputDefs)` validates that every referenced input name exists (it throws `ConditionError` on unknown names, which is wrapped into `ModelError`). Comparisons against empty values returning `false` is fine — we only care that it does not throw for unknown references.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/workbookModel.test.js`
Expected: PASS — all tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/workbookModel.js tests/workbookModel.test.js
git commit -m "feat: workbook model builder with validation"
```

---

### Task 5: Project store (persistence + JSON import/export)

**Files:**
- Create: `src/projectStore.js`
- Test: `tests/projectStore.test.js`

**Interfaces:**
- Consumes: nothing (storage is injected).
- Produces a `createProjectStore(storage)` factory, where `storage` implements `getItem(key)`, `setItem(key, value)`, `removeItem(key)` (the browser `localStorage` shape). Returns an object with:
  - `listProjects(): ProjectSummary[]` → `{ id, name, updatedAt }[]`
  - `getProject(id): Project|null`
  - `createProject(name): Project`
  - `saveProject(project): void`
  - `deleteProject(id): void`
  - `serializeProject(project): string` (JSON for file download)
  - `importProject(jsonString): Project` (parses, assigns a fresh id, saves, returns it)
  - `Project = { id, name, inputs: object, checks: { [itemId]: boolean }, comments: { [itemId]: string }, updatedAt }`

- [ ] **Step 1: Write failing tests using an in-memory storage mock**

Create `tests/projectStore.test.js`:
```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProjectStore } from '../src/projectStore.js';

function memStorage() {
  const map = new Map();
  return {
    getItem: k => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: k => map.delete(k),
  };
}

test('create, list, get a project', () => {
  const store = createProjectStore(memStorage());
  const p = store.createProject('Tower A');
  assert.ok(p.id);
  assert.equal(p.name, 'Tower A');
  assert.deepEqual(store.listProjects().map(s => s.name), ['Tower A']);
  assert.equal(store.getProject(p.id).name, 'Tower A');
});

test('save updates fields and updatedAt', () => {
  const store = createProjectStore(memStorage());
  const p = store.createProject('Tower A');
  p.inputs = { MaxFFLInt: 12 };
  p.checks = { A10: true };
  p.comments = { A10: 'done on site' };
  store.saveProject(p);
  const reloaded = store.getProject(p.id);
  assert.deepEqual(reloaded.inputs, { MaxFFLInt: 12 });
  assert.equal(reloaded.checks.A10, true);
  assert.equal(reloaded.comments.A10, 'done on site');
});

test('delete removes the project', () => {
  const store = createProjectStore(memStorage());
  const p = store.createProject('Tower A');
  store.deleteProject(p.id);
  assert.equal(store.getProject(p.id), null);
  assert.equal(store.listProjects().length, 0);
});

test('serialize then import yields an equal project with a new id', () => {
  const store = createProjectStore(memStorage());
  const p = store.createProject('Tower A');
  p.checks = { A10: true };
  store.saveProject(p);
  const json = store.serializeProject(p);
  const imported = store.importProject(json);
  assert.notEqual(imported.id, p.id);
  assert.equal(imported.name, 'Tower A');
  assert.deepEqual(imported.checks, { A10: true });
  assert.equal(store.listProjects().length, 2);
});

test('importProject rejects malformed JSON', () => {
  const store = createProjectStore(memStorage());
  assert.throws(() => store.importProject('{not json'));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/projectStore.test.js`
Expected: FAIL — cannot find module `../src/projectStore.js`.

- [ ] **Step 3: Implement the project store**

Create `src/projectStore.js`:
```javascript
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/projectStore.test.js`
Expected: PASS — all tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/projectStore.js tests/projectStore.test.js
git commit -m "feat: project store with persistence and JSON import/export"
```

---

### Task 6: Applicability/progress helpers + exporter rows

**Files:**
- Create: `src/exporter.js`
- Test: `tests/exporter.test.js`

**Interfaces:**
- Consumes: `isApplicable` from `conditionEngine.js`; `Model` from `workbookModel.js`; `Project` from `projectStore.js`.
- Produces:
  - `applicableItems(model, values): Item[]` — items whose condition applies for the given input values.
  - `computeProgress(model, project): { checked, applicable, ratio }` — `ratio` is 0 when `applicable` is 0.
  - `buildExportRows(model, project): any[][]` — header row + one row per applicable-but-unchecked item, columns: `Item ID, Description, Code, Note, Example (how to complete), Your comment`.

- [ ] **Step 1: Write failing tests for the export helpers**

Create `tests/exporter.test.js`:
```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildModel } from '../src/workbookModel.js';
import { applicableItems, computeProgress, buildExportRows } from '../src/exporter.js';

const inputRows = [
  ['Name', 'Type', 'Label', 'Unit', 'Choices', 'Default'],
  ['PitToEarth', 'Boolean', 'Pit', '', '', 'FALSE'],
  ['MaxFFLInt', 'Float', 'FFL', 'm', '', '0'],
];
const checklistRows = [
  ['Item ID', 'Conditions', 'Description', 'Code', 'Note', 'Example'],
  ['A08', '', 'Always applies', 'AS3000', 'note8', 'ex8'],
  ['A10', 'PitToEarth: FALSE', 'CWT device', 'EN81-20', 'note10', 'ex10'],
  ['A11', 'MaxFFLInt: >11', 'Emergency doors', 'RDM', 'note11', 'ex11'],
];
const model = buildModel({ checklistRows, inputRows });

test('applicableItems filters by condition', () => {
  const ids = applicableItems(model, { PitToEarth: false, MaxFFLInt: 5 }).map(i => i.id);
  assert.deepEqual(ids, ['A08', 'A10']);
});

test('computeProgress = checked / applicable', () => {
  const project = { inputs: { PitToEarth: false, MaxFFLInt: 5 }, checks: { A08: true }, comments: {} };
  const p = computeProgress(model, project);
  assert.deepEqual(p, { checked: 1, applicable: 2, ratio: 0.5 });
});

test('computeProgress ratio is 0 when none applicable', () => {
  const project = { inputs: { PitToEarth: true, MaxFFLInt: 0 }, checks: {}, comments: {} };
  // Only A08 always applies, so applicable=1 here; force a no-applicable model instead:
  const emptyModel = buildModel({
    checklistRows: [checklistRows[0], ['Z1', 'MaxFFLInt: >999', 'x', '', '', '']],
    inputRows,
  });
  const p = computeProgress(emptyModel, { inputs: { MaxFFLInt: 0 }, checks: {}, comments: {} });
  assert.equal(p.applicable, 0);
  assert.equal(p.ratio, 0);
});

test('buildExportRows lists applicable unchecked items with header', () => {
  const project = {
    inputs: { PitToEarth: false, MaxFFLInt: 12 },
    checks: { A08: true },
    comments: { A10: 'pending part' },
  };
  const rows = buildExportRows(model, project);
  assert.deepEqual(rows[0], ['Item ID', 'Description', 'Code', 'Note', 'Example (how to complete)', 'Your comment']);
  const ids = rows.slice(1).map(r => r[0]);
  assert.deepEqual(ids, ['A10', 'A11']); // A08 checked -> excluded
  assert.equal(rows[1][5], 'pending part');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/exporter.test.js`
Expected: FAIL — cannot find module `../src/exporter.js`.

- [ ] **Step 3: Implement the export helpers**

Create `src/exporter.js`:
```javascript
import { isApplicable } from './conditionEngine.js';

export function applicableItems(model, values) {
  return model.items.filter(item => isApplicable(item.condition, values, model.inputDefs));
}

export function computeProgress(model, project) {
  const items = applicableItems(model, project.inputs || {});
  const applicable = items.length;
  const checked = items.filter(i => (project.checks || {})[i.id] === true).length;
  const ratio = applicable === 0 ? 0 : checked / applicable;
  return { checked, applicable, ratio };
}

export function buildExportRows(model, project) {
  const header = ['Item ID', 'Description', 'Code', 'Note', 'Example (how to complete)', 'Your comment'];
  const checks = project.checks || {};
  const comments = project.comments || {};
  const rows = [header];
  for (const item of applicableItems(model, project.inputs || {})) {
    if (checks[item.id] === true) continue;
    rows.push([item.id, item.description, item.code, item.note, item.example, comments[item.id] || '']);
  }
  return rows;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/exporter.test.js`
Expected: PASS — all tests passing.

- [ ] **Step 5: Run the full suite and commit**

Run: `npm test`
Expected: PASS — all test files passing.

```bash
git add src/exporter.js tests/exporter.test.js
git commit -m "feat: applicability, progress, and export-row helpers"
```

---

### Task 7: HTML shell, styles, and Setup screen (load workbook)

**Files:**
- Create: `index.html`
- Create: `styles.css`
- Create: `src/app.js`

**Interfaces:**
- Consumes: `buildModel` (`workbookModel.js`), `createProjectStore` (`projectStore.js`); global `XLSX` from the vendored classic script; `localStorage`.
- Produces: a runnable app whose Setup screen loads an `.xlsx`, parses both sheets to arrays via `XLSX.utils.sheet_to_json(ws, { header: 1 })`, calls `buildModel`, caches the parsed model JSON in `localStorage` under `dpchecklist.model`, and shows load errors. Establishes the screen-routing functions `showScreen(name)` and a module-level `state = { model, store, currentProjectId }` consumed by Tasks 8–10.

- [ ] **Step 1: Create index.html shell**

Create `index.html`:
```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Smart Checklist</title>
  <link rel="stylesheet" href="styles.css" />
</head>
<body>
  <header class="topbar">
    <h1>Smart Checklist</h1>
    <nav>
      <button id="nav-dashboard">Dashboard</button>
      <button id="nav-setup">Setup</button>
    </nav>
  </header>

  <main>
    <section id="screen-setup" class="screen">
      <h2>Setup — Load Checklist Workbook</h2>
      <p>Load your Excel workbook. It must contain a sheet named <code>Checklist</code> and a sheet named <code>Inputs</code>. Nothing is uploaded; parsing happens in your browser.</p>
      <input type="file" id="workbook-file" accept=".xlsx,.xls" />
      <p id="setup-status" class="status"></p>
    </section>

    <section id="screen-dashboard" class="screen" hidden>
      <div class="row-between">
        <h2>Projects</h2>
        <div>
          <button id="btn-new-project">New project</button>
          <label class="import-label">Import project
            <input type="file" id="import-project-file" accept=".json" hidden />
          </label>
        </div>
      </div>
      <p id="dashboard-empty" class="muted" hidden>No checklist loaded yet — go to Setup first.</p>
      <ul id="project-list" class="project-list"></ul>
    </section>

    <section id="screen-project" class="screen" hidden>
      <div class="row-between">
        <button id="btn-back">&larr; Back</button>
        <div>
          <button id="btn-save-project">Save project file</button>
          <button id="btn-export">Export unchecked to Excel</button>
        </div>
      </div>
      <h2 id="project-title"></h2>
      <div class="progress"><div id="project-progress-bar" class="progress-bar"></div></div>
      <p id="project-progress-label" class="muted"></p>
      <div class="project-body">
        <aside id="inputs-panel" class="inputs-panel"></aside>
        <div id="items-list" class="items-list"></div>
      </div>
    </section>
  </main>

  <script src="vendor/xlsx.full.min.js"></script>
  <script type="module" src="src/app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create styles.css**

Create `styles.css`:
```css
* { box-sizing: border-box; }
body { font-family: system-ui, Arial, sans-serif; margin: 0; color: #1c2430; background: #f5f7fa; }
.topbar { display: flex; justify-content: space-between; align-items: center; padding: 12px 20px; background: #1c2430; color: #fff; }
.topbar h1 { font-size: 18px; margin: 0; }
.topbar nav button { margin-left: 8px; }
main { padding: 20px; max-width: 1100px; margin: 0 auto; }
.screen { background: #fff; border: 1px solid #dfe4ea; border-radius: 8px; padding: 20px; }
button { cursor: pointer; padding: 8px 12px; border: 1px solid #b9c2cc; border-radius: 6px; background: #fff; }
button:hover { background: #eef2f6; }
.row-between { display: flex; justify-content: space-between; align-items: center; }
.status { margin-top: 12px; }
.status.error { color: #b00020; }
.status.ok { color: #1a7f37; }
.muted { color: #6b7682; }
.project-list { list-style: none; padding: 0; }
.project-card { border: 1px solid #dfe4ea; border-radius: 8px; padding: 14px; margin-bottom: 10px; }
.progress { background: #e6eaef; border-radius: 6px; height: 14px; overflow: hidden; }
.progress-bar { background: #2f80ed; height: 100%; width: 0%; transition: width .2s; }
.project-body { display: grid; grid-template-columns: 280px 1fr; gap: 20px; margin-top: 16px; }
.inputs-panel { border-right: 1px solid #eee; padding-right: 16px; }
.inputs-panel label { display: block; font-weight: 600; margin: 10px 0 4px; }
.inputs-panel input, .inputs-panel select { width: 100%; padding: 6px; }
.item { border: 1px solid #e3e8ee; border-radius: 8px; padding: 12px; margin-bottom: 10px; }
.item.checked { background: #f3faf4; }
.item-head { display: flex; gap: 10px; align-items: flex-start; }
.item-head .id { font-weight: 700; }
.item-note, .item-example { font-size: 13px; color: #4a5560; margin-top: 4px; }
.item textarea { width: 100%; margin-top: 8px; }
.import-label { cursor: pointer; padding: 8px 12px; border: 1px solid #b9c2cc; border-radius: 6px; }
```

- [ ] **Step 3: Create app.js with routing + Setup wiring**

Create `src/app.js`:
```javascript
import { buildModel } from './workbookModel.js';
import { createProjectStore } from './projectStore.js';

const MODEL_KEY = 'dpchecklist.model';

const state = {
  model: null,
  store: createProjectStore(window.localStorage),
  currentProjectId: null,
};

const screens = ['setup', 'dashboard', 'project'];
function showScreen(name) {
  for (const s of screens) {
    document.getElementById('screen-' + s).hidden = s !== name;
  }
  if (name === 'dashboard') renderDashboard();
}

function setStatus(msg, kind) {
  const el = document.getElementById('setup-status');
  el.textContent = msg;
  el.className = 'status' + (kind ? ' ' + kind : '');
}

function sheetToRows(workbook, name) {
  const ws = workbook.Sheets[name];
  if (!ws) throw new Error(`Workbook is missing a sheet named "${name}"`);
  return XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: '' });
}

function loadModelFromWorkbook(workbook) {
  const checklistRows = sheetToRows(workbook, 'Checklist');
  const inputRows = sheetToRows(workbook, 'Inputs');
  return buildModel({ checklistRows, inputRows });
}

function persistModel(model) {
  // Conditions are re-parsed on load, so store raw rows-free model minus AST.
  const serializable = {
    items: model.items.map(({ condition, ...rest }) => rest),
    inputs: model.inputs,
  };
  window.localStorage.setItem(MODEL_KEY, JSON.stringify(serializable));
}

function restoreModel() {
  const raw = window.localStorage.getItem(MODEL_KEY);
  if (!raw) return null;
  try {
    const data = JSON.parse(raw);
    // Rebuild AST + inputDefs from stored text.
    const inputRows = [
      ['Name', 'Type', 'Label', 'Unit', 'Choices', 'Default'],
      ...data.inputs.map(i => [i.name, i.type, i.label, i.unit, i.choices.join(';'), i.default]),
    ];
    const checklistRows = [
      ['Item ID', 'Conditions', 'Description', 'Code', 'Note', 'Example'],
      ...data.items.map(i => [i.id, i.conditionsText, i.description, i.code, i.note, i.example]),
    ];
    return buildModel({ checklistRows, inputRows });
  } catch {
    return null;
  }
}

async function handleWorkbookFile(file) {
  try {
    setStatus('Reading workbook…');
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'array' });
    const model = loadModelFromWorkbook(workbook);
    state.model = model;
    persistModel(model);
    setStatus(`Loaded ${model.items.length} items and ${model.inputs.length} inputs.`, 'ok');
  } catch (err) {
    state.model = null;
    setStatus('Could not load workbook: ' + err.message, 'error');
  }
}

function wireSetup() {
  document.getElementById('workbook-file').addEventListener('change', e => {
    const file = e.target.files[0];
    if (file) handleWorkbookFile(file);
  });
}

// Placeholder renderers implemented in later tasks.
function renderDashboard() { /* Task 8 */ }

function init() {
  state.model = restoreModel();
  wireSetup();
  document.getElementById('nav-dashboard').addEventListener('click', () => showScreen('dashboard'));
  document.getElementById('nav-setup').addEventListener('click', () => showScreen('setup'));
  showScreen(state.model ? 'dashboard' : 'setup');
}

init();

export { state, showScreen };
```

- [ ] **Step 4: Manual verification — load the example workbook**

First prepare a test workbook from the example (rename sheet, add `Inputs` sheet and `Example` column) OR use your real workbook. Minimum manual check:

1. Run a local static server so ES modules load (file:// blocks module imports):
   ```bash
   cd "c:/Users/valen/Desktop/CLAUDE_PROJECTS/DP_ChecklistTool" && python -m http.server 8000
   ```
2. Open `http://localhost:8000/` in a browser.
3. On the Setup screen, choose a workbook that has `Checklist` + `Inputs` sheets.
   - Expected: green status "Loaded N items and M inputs."
4. Choose a workbook missing the `Inputs` sheet.
   - Expected: red status "Could not load workbook: Workbook is missing a sheet named "Inputs"".

Confirm both behaviors before continuing.

- [ ] **Step 5: Commit**

```bash
git add index.html styles.css src/app.js
git commit -m "feat: HTML shell, styles, and workbook setup screen"
```

---

### Task 8: Dashboard (list, create, delete, import projects)

**Files:**
- Modify: `src/app.js` (implement `renderDashboard`, wire create/import buttons, add `openProject`)

**Interfaces:**
- Consumes: `state`, `showScreen` from Task 7; `state.store` methods; `computeProgress` from `exporter.js`.
- Produces: `renderDashboard()` (real implementation) and `openProject(id)` that sets `state.currentProjectId` and calls `renderProject()` (defined in Task 9; safe-guard with a typeof check until then).

- [ ] **Step 1: Add exporter import and implement renderDashboard**

In `src/app.js`, add to the imports at the top:
```javascript
import { computeProgress } from './exporter.js';
```

Replace the placeholder `function renderDashboard() { /* Task 8 */ }` with:
```javascript
function renderDashboard() {
  const list = document.getElementById('project-list');
  const empty = document.getElementById('dashboard-empty');
  list.innerHTML = '';
  empty.hidden = !!state.model;
  if (!state.model) return;

  const projects = state.store.listProjects();
  for (const summary of projects) {
    const project = state.store.getProject(summary.id);
    const { checked, applicable, ratio } = computeProgress(state.model, project);
    const li = document.createElement('li');
    li.className = 'project-card';
    li.innerHTML = `
      <div class="row-between">
        <strong>${escapeHtml(project.name)}</strong>
        <span>
          <button data-open="${project.id}">Open</button>
          <button data-delete="${project.id}">Delete</button>
        </span>
      </div>
      <div class="progress"><div class="progress-bar" style="width:${Math.round(ratio * 100)}%"></div></div>
      <p class="muted">${checked} / ${applicable} checked</p>`;
    list.appendChild(li);
  }

  list.querySelectorAll('[data-open]').forEach(btn =>
    btn.addEventListener('click', () => openProject(btn.getAttribute('data-open'))));
  list.querySelectorAll('[data-delete]').forEach(btn =>
    btn.addEventListener('click', () => {
      if (confirm('Delete this project?')) {
        state.store.deleteProject(btn.getAttribute('data-delete'));
        renderDashboard();
      }
    }));
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function openProject(id) {
  state.currentProjectId = id;
  showScreen('project');
  if (typeof renderProject === 'function') renderProject();
}
```

- [ ] **Step 2: Wire the New project and Import buttons in init()**

In `src/app.js`, inside `init()`, after the nav listeners, add:
```javascript
  document.getElementById('btn-new-project').addEventListener('click', () => {
    if (!state.model) { alert('Load a checklist workbook in Setup first.'); return; }
    const name = prompt('Project name?');
    if (!name) return;
    const project = state.store.createProject(name);
    openProject(project.id);
  });

  document.getElementById('import-project-file').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      state.store.importProject(text);
      renderDashboard();
    } catch (err) {
      alert('Could not import project: ' + err.message);
    }
    e.target.value = '';
  });
```

- [ ] **Step 3: Manual verification — dashboard CRUD**

1. Restart the static server if needed and reload `http://localhost:8000/`.
2. With a workbook loaded, go to Dashboard, click **New project**, enter "Tower A".
   - Expected: routes to the (empty) project screen.
3. Go Back / Dashboard.
   - Expected: a card "Tower A" with a progress bar at some percentage and "X / Y checked".
4. Click **Delete**, confirm.
   - Expected: card disappears.

(Project-screen contents are built in Task 9; an empty project body here is expected.)

- [ ] **Step 4: Commit**

```bash
git add src/app.js
git commit -m "feat: dashboard with project list, create, delete, import"
```

---

### Task 9: Project view (inputs, live filtering, checks, comments, progress, autosave)

**Files:**
- Modify: `src/app.js` (implement `renderProject`, input controls, item rendering, autosave)

**Interfaces:**
- Consumes: `state`, `showScreen`; `applicableItems`, `computeProgress` from `exporter.js`; `state.store.getProject`/`saveProject`.
- Produces: `renderProject()` real implementation; `getCurrentProject()` helper returning the loaded project object; `saveCurrent()` persisting it.

- [ ] **Step 1: Extend the exporter import**

In `src/app.js`, update the exporter import line to:
```javascript
import { computeProgress, applicableItems } from './exporter.js';
```

- [ ] **Step 2: Implement project rendering, inputs, items, autosave**

In `src/app.js`, add these functions (place above `init`):
```javascript
function getCurrentProject() {
  return state.store.getProject(state.currentProjectId);
}

function saveCurrent(project) {
  state.store.saveProject(project);
}

function defaultInputValue(def) {
  if (def.type === 'Boolean') return /^true$/i.test(String(def.default)) ;
  if (def.type === 'Float' || def.type === 'Integer') return def.default === '' ? 0 : Number(def.default);
  if (def.type === 'Choice') return def.default || (def.choices[0] ?? '');
  return def.default;
}

function renderInputs(project) {
  const panel = document.getElementById('inputs-panel');
  panel.innerHTML = '<h3>Project inputs</h3>';
  for (const def of state.model.inputs) {
    if (!(def.name in project.inputs)) project.inputs[def.name] = defaultInputValue(def);
    const value = project.inputs[def.name];
    const label = document.createElement('label');
    label.textContent = def.label + (def.unit ? ` (${def.unit})` : '');
    panel.appendChild(label);

    let control;
    if (def.type === 'Boolean') {
      control = document.createElement('input');
      control.type = 'checkbox';
      control.checked = value === true;
      control.addEventListener('change', () => updateInput(def.name, control.checked));
    } else if (def.type === 'Choice') {
      control = document.createElement('select');
      for (const c of def.choices) {
        const opt = document.createElement('option');
        opt.value = c; opt.textContent = c;
        if (c === value) opt.selected = true;
        control.appendChild(opt);
      }
      control.addEventListener('change', () => updateInput(def.name, control.value));
    } else {
      control = document.createElement('input');
      control.type = 'number';
      if (def.type === 'Integer') control.step = '1';
      control.value = value;
      control.addEventListener('input', () => updateInput(def.name, control.value === '' ? '' : Number(control.value)));
    }
    panel.appendChild(control);
  }
}

function updateInput(name, value) {
  const project = getCurrentProject();
  project.inputs[name] = value;
  saveCurrent(project);
  renderItems(project);
  renderProgress(project);
}

function renderItems(project) {
  const container = document.getElementById('items-list');
  container.innerHTML = '';
  const items = applicableItems(state.model, project.inputs);
  for (const item of items) {
    const checked = project.checks[item.id] === true;
    const div = document.createElement('div');
    div.className = 'item' + (checked ? ' checked' : '');
    div.innerHTML = `
      <div class="item-head">
        <input type="checkbox" data-check="${item.id}" ${checked ? 'checked' : ''} />
        <div>
          <span class="id">${escapeHtml(item.id)}</span> — ${escapeHtml(item.description)}
          ${item.code ? `<span class="muted">[${escapeHtml(item.code)}]</span>` : ''}
          ${item.note ? `<div class="item-note">${escapeHtml(item.note)}</div>` : ''}
          ${item.example ? `<div class="item-example"><em>How to complete:</em> ${escapeHtml(item.example)}</div>` : ''}
        </div>
      </div>`;
    const ta = document.createElement('textarea');
    ta.placeholder = 'Your comment for this item…';
    ta.rows = 2;
    ta.value = project.comments[item.id] || '';
    ta.addEventListener('input', () => {
      const p = getCurrentProject();
      p.comments[item.id] = ta.value;
      saveCurrent(p);
    });
    div.appendChild(ta);
    container.appendChild(div);
  }

  container.querySelectorAll('[data-check]').forEach(cb =>
    cb.addEventListener('change', () => {
      const p = getCurrentProject();
      p.checks[cb.getAttribute('data-check')] = cb.checked;
      saveCurrent(p);
      renderItems(p);
      renderProgress(p);
    }));
}

function renderProgress(project) {
  const { checked, applicable, ratio } = computeProgress(state.model, project);
  document.getElementById('project-progress-bar').style.width = Math.round(ratio * 100) + '%';
  document.getElementById('project-progress-label').textContent = `${checked} / ${applicable} checked`;
}

function renderProject() {
  const project = getCurrentProject();
  if (!project) { showScreen('dashboard'); return; }
  document.getElementById('project-title').textContent = project.name;
  renderInputs(project);
  // persist any defaults just applied
  saveCurrent(project);
  renderItems(project);
  renderProgress(project);
}
```

- [ ] **Step 3: Wire the Back button in init()**

In `src/app.js`, inside `init()`, add:
```javascript
  document.getElementById('btn-back').addEventListener('click', () => showScreen('dashboard'));
```

- [ ] **Step 4: Manual verification — dynamic filtering and progress**

1. Reload the app; open a project.
2. Confirm the inputs panel shows one control per `Inputs` row (dropdown/number/checkbox) with units.
3. Toggle a Boolean / change a number that gates an item.
   - Expected: items appear/disappear live; the progress denominator changes.
4. Check an item, type a comment.
   - Expected: progress bar moves; item gets the checked style.
5. Reload the page and re-open the project.
   - Expected: inputs, checks, and comments persisted.

- [ ] **Step 5: Commit**

```bash
git add src/app.js
git commit -m "feat: project view with live filtering, checks, comments, autosave"
```

---

### Task 10: Export to Excel + Save project file

**Files:**
- Modify: `src/app.js` (wire Export and Save-project buttons)

**Interfaces:**
- Consumes: `buildExportRows` from `exporter.js`; `state.store.serializeProject`; global `XLSX`.
- Produces: Export button writes an `.xlsx` of unchecked items; Save-project button downloads the project `.json`.

- [ ] **Step 1: Add buildExportRows to the exporter import**

In `src/app.js`, update the exporter import to:
```javascript
import { computeProgress, applicableItems, buildExportRows } from './exporter.js';
```

- [ ] **Step 2: Implement download helpers and wire buttons**

In `src/app.js`, add above `init`:
```javascript
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function exportUnchecked() {
  const project = getCurrentProject();
  const rows = buildExportRows(state.model, project);
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Unchecked');
  const safeName = project.name.replace(/[^\w\-]+/g, '_');
  const date = new Date().toISOString().slice(0, 10);
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  downloadBlob(new Blob([out], { type: 'application/octet-stream' }), `${safeName}_unchecked_${date}.xlsx`);
}

function saveProjectFile() {
  const project = getCurrentProject();
  const json = state.store.serializeProject(project);
  const safeName = project.name.replace(/[^\w\-]+/g, '_');
  downloadBlob(new Blob([json], { type: 'application/json' }), `${safeName}.json`);
}
```

In `init()`, add:
```javascript
  document.getElementById('btn-export').addEventListener('click', exportUnchecked);
  document.getElementById('btn-save-project').addEventListener('click', saveProjectFile);
```

- [ ] **Step 3: Manual verification — export and save**

1. Reload; open a project with some applicable, unchecked items and at least one comment.
2. Click **Export unchecked to Excel**.
   - Expected: an `.xlsx` downloads; opening it shows header `Item ID, Description, Code, Note, Example (how to complete), Your comment` and only applicable-unchecked rows, with the comment in the last column. Checked items are absent.
3. Click **Save project file**.
   - Expected: a `.json` downloads. On the Dashboard, use **Import project** to load it back.
   - Expected: a second card with the same name and progress appears.

- [ ] **Step 4: Run full suite and commit**

Run: `npm test`
Expected: PASS — all tests passing.

```bash
git add src/app.js
git commit -m "feat: Excel export of unchecked items and project file save"
```

---

## Notes for the implementer

- **Run modules via a local server**, not `file://`. ES module imports and `fetch`/`arrayBuffer` behave correctly only over `http://`. Use `python -m http.server 8000` from the project root.
- **Preparing a test workbook:** the shipped `ExampleChecklist.xlsx` has its checklist on a sheet named `Sheet2`, no `Inputs` sheet, and no `Example` column. To exercise the tool, make a copy whose checklist sheet is named `Checklist`, add an `Example` column, and add an `Inputs` sheet defining `PitToEarth` (Boolean), `MaxFFLInt` (Float, unit `m`), and any `Choice` inputs your conditions use. This matches the agreed decision that the workbook conforms to the tool, not vice-versa.
- **Pure modules vs. glue:** everything except `app.js` is unit-tested with `node --test`. `app.js` is verified manually per the steps above.
