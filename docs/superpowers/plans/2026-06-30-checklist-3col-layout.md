# Checklist 3-Column Layout Restructure — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the checklist screen into a clean three-column layout — collapsible sidebar │ project-header + lean item list │ detail panel (Unit Selection / Unit Details / Item editor) — without changing the data model or exporter.

**Architecture:** Pure presentation change. The project title/progress/filter move into the middle column; the detail panel's unit selector moves out into an always-visible "Unit Selection" box above the collapsible "Unit Details"; list rows drop their tag chips / code tag / note; the item editor goes lean (checkbox + name, note, Unit Selection dropdown, Comments). All render functions keep their element ids, so the `checklistView` helpers and per-unit data flow are unchanged.

**Tech Stack:** Vanilla ES modules, no build step. `node --test` for regression. UI verified manually via the headless-Edge/CDP smoke harness.

## Global Constraints

- **No data-model or exporter changes.** `src/exporter.js`, `buildExportPlan`, `downloadProjectZip`, and `unit.inputs`/`checks`/`comments` shapes stay exactly as-is.
- **No new dependencies, no build step.**
- **Element ids are preserved** so existing wiring keeps working: `#viewer-unit-select`, `#inputs-readout`, `#inputs-toggle`, `#inputs-body`, `#project-title`, `#project-progress-bar`, `#project-progress-label`, `#section-select`, `#toggle-hide-checked`, `#items-list`, `#detail-panel`, `#editor-empty`, `#item-editor-body`, `#ed-unit-select`, `#ed-check`, `#ed-comment`.
- **Tri-state check-all semantics unchanged**: a row checkbox checks/unchecks every applicable unit; indeterminate when only some are checked. `itemApplicableUnits`/`itemCheckState`/`unifiedItems` stay in use.
- **No automated test for these UI tasks.** Verify each with `node --check src/app.js` and `npm test` (must stay **64/64** — no logic changed). The controller runs the browser smoke check.

---

## File Structure

- **Modify** `index.html` — project screen markup (move project header into the middle column; restructure the detail panel into three boxes; move the unit `<select>` out of the collapsible body).
- **Modify** `src/app.js` — `renderItems` (lean rows), `renderItemEditor` (lean editor). `renderInputsViewer` needs **no change** (its ids are preserved).
- **Modify** `styles.css` — new column/header-card/Unit-Selection rules; remove the now-dead `.unit-tag*`, `.viewer-unit-row`, `.ed-desc`, `.ed-check-row` rules; tweak `.ed-item-head`.

---

## Task 1: Three-column markup + layout CSS

**Files:**
- Modify: `index.html` (project screen, lines 123-160 — from `<h2 id="project-title">` through the closing `</div>` of `.project-body`)
- Modify: `styles.css` (append layout rules; remove `.viewer-unit-row`)

**Interfaces:**
- Consumes: existing `renderInputsViewer`/`renderItems`/`renderItemEditor`/`renderProgress` (unchanged here — they target preserved ids).
- Produces: new DOM structure with classes `.checklist-main`, `.checklist-head`, `.panel-head-static`, and box id `#unit-selection`. "Inputs" header text becomes "Unit Details".

- [ ] **Step 1: Replace the project-screen body markup**

In `index.html`, replace this block (the `<h2 id="project-title">` line through the `</div>` that closes `.project-body`):

```html
      <h2 id="project-title"></h2>
      <div class="progress">
        <div id="project-progress-bar" class="progress-bar"></div>
      </div>
      <p id="project-progress-label" class="muted"></p>
      <div class="section-filter">
        <label for="section-select">Section</label>
        <select id="section-select"></select>
        <span class="toggle-inline">
          <span class="toggle-text">Hide checked</span>
          <label class="switch">
            <input type="checkbox" id="toggle-hide-checked" />
            <span class="switch-slider"></span>
          </label>
        </span>
      </div>
      <div class="project-body">
        <div id="items-list" class="items-list"></div>
        <aside id="detail-panel" class="detail-panel">
          <section class="panel-section" id="inputs-viewer">
            <button id="inputs-toggle" class="panel-head" type="button" aria-expanded="true">
              <span>Inputs</span>
              <svg class="panel-chevron" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
            </button>
            <div id="inputs-body" class="panel-body">
              <label class="viewer-unit-row">
                <span>Unit</span>
                <select id="viewer-unit-select"></select>
              </label>
              <dl id="inputs-readout" class="inputs-readout"></dl>
            </div>
          </section>
          <section class="panel-section" id="item-editor">
            <div id="editor-empty" class="editor-empty muted">Select an item to add a comment and check it off per unit.</div>
            <div id="item-editor-body" class="item-editor-body" hidden></div>
          </section>
        </aside>
      </div>
```

with:

```html
      <div class="project-body">
        <div class="checklist-main">
          <div class="checklist-head">
            <h2 id="project-title"></h2>
            <div class="progress">
              <div id="project-progress-bar" class="progress-bar"></div>
            </div>
            <p id="project-progress-label" class="muted"></p>
            <div class="section-filter">
              <label for="section-select">Section</label>
              <select id="section-select"></select>
              <span class="toggle-inline">
                <span class="toggle-text">Hide checked</span>
                <label class="switch">
                  <input type="checkbox" id="toggle-hide-checked" />
                  <span class="switch-slider"></span>
                </label>
              </span>
            </div>
          </div>
          <div id="items-list" class="items-list"></div>
        </div>
        <aside id="detail-panel" class="detail-panel">
          <section class="panel-section" id="unit-selection">
            <div class="panel-head-static"><span>Unit Selection</span></div>
            <div class="panel-body">
              <select id="viewer-unit-select"></select>
            </div>
          </section>
          <section class="panel-section" id="inputs-viewer">
            <button id="inputs-toggle" class="panel-head" type="button" aria-expanded="true">
              <span>Unit Details</span>
              <svg class="panel-chevron" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
            </button>
            <div id="inputs-body" class="panel-body">
              <dl id="inputs-readout" class="inputs-readout"></dl>
            </div>
          </section>
          <section class="panel-section" id="item-editor">
            <div id="editor-empty" class="editor-empty muted">Select an item to add a comment and check it off per unit.</div>
            <div id="item-editor-body" class="item-editor-body" hidden></div>
          </section>
        </aside>
      </div>
```

- [ ] **Step 2: Add the middle-column + Unit-Selection CSS**

Append to `styles.css`:

```css
/* 3-column checklist: middle column stacks a header card over the list */
.checklist-main { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 16px; }
.checklist-head {
  border: 1px solid var(--border); border-radius: var(--radius);
  background: var(--surface); padding: 16px 18px;
}
.checklist-head #project-title { margin: 0 0 8px; }
.checklist-head .section-filter { margin: 12px 0 0; }
/* Static (non-collapsing) panel header, e.g. Unit Selection */
.panel-head-static {
  display: flex; align-items: center; padding: 10px 14px;
  font-weight: 600; font-size: 0.95rem;
}
#unit-selection select { width: 100%; }
```

- [ ] **Step 3: Remove the now-unused `.viewer-unit-row` rules**

In `styles.css`, delete these two lines (the unit selector no longer sits in a `.viewer-unit-row`):

```css
.viewer-unit-row { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.viewer-unit-row select { flex: 1; }
```

- [ ] **Step 4: Verify**

Run: `node --check src/app.js && npm test`
Expected: `node --check` clean; tests **64/64**.

Manual (browser harness): open a project with ≥2 units. Confirm the three columns render — middle column shows a header card (title + progress + section filter) above the list; the right panel shows **Unit Selection** (always visible) with the unit dropdown, a collapsible **Unit Details** with the spec readout, and the item editor below. Switching the Unit Selection dropdown updates Unit Details; the collapse chevron still works. The list and editor still function (rows still show tags at this stage — that's removed in Task 2).

- [ ] **Step 5: Commit**

```bash
git add index.html styles.css
git commit -m "feat: three-column checklist layout with Unit Selection box"
```

---

## Task 2: Lean item-list rows

**Files:**
- Modify: `src/app.js` (`renderItems`, lines 567-659)
- Modify: `styles.css` (remove `.unit-tag*` rules)

**Interfaces:**
- Consumes: `unifiedItems`, `itemApplicableUnits`, `itemCheckState`, `escapeHtml`, `INFO_ICON`, `openItemEditor`, `openExample`, `renderProgress`, `renderItemEditor`, `saveCurrent`, `getCurrentProject`, `state`.
- Produces: rows containing only a tri-state checkbox, `"ID — description"`, and the example ⓘ button; no tag chips, code tag, or note.

- [ ] **Step 1: Replace `renderItems` with the lean version**

Replace the entire `renderItems` function (lines 567-659) with:

```js
function renderItems() {
  const container = document.getElementById('items-list');
  container.innerHTML = '';
  const project = getCurrentProject();
  let items = unifiedItems(state.model, project);
  if (state.sectionFilter) items = items.filter(i => i.sectionPrefix === state.sectionFilter);

  // Tri-state per item (drives the checkbox and the section counts).
  const stateById = new Map();
  for (const i of items) {
    const units = itemApplicableUnits(state.model, project, i);
    stateById.set(i.id, itemCheckState(i, units));
  }

  // Section totals from the full (pre hide-checked) list. Done = fully checked.
  const total = new Map();
  const done = new Map();
  for (const i of items) {
    total.set(i.section, (total.get(i.section) || 0) + 1);
    if (stateById.get(i.id) === 'all') done.set(i.section, (done.get(i.section) || 0) + 1);
  }

  const visible = state.hideChecked ? items.filter(i => stateById.get(i.id) !== 'all') : items;
  let currentSection = null;
  for (const item of visible) {
    if (item.section !== currentSection) {
      currentSection = item.section;
      const h = document.createElement('h3');
      h.className = 'section-heading';
      h.innerHTML = `<span>${escapeHtml(currentSection)}</span>` +
        `<span class="section-count">${done.get(currentSection) || 0} / ${total.get(currentSection) || 0}</span>`;
      container.appendChild(h);
    }
    const cs = stateById.get(item.id);
    const div = document.createElement('div');
    div.className = 'item' + (cs === 'all' ? ' checked' : '');
    div.innerHTML = `
      <div class="item-head">
        <input type="checkbox" data-check="${escapeHtml(item.id)}" />
        <div>
          <span class="id">${escapeHtml(item.id)}</span> — ${escapeHtml(item.description)}
        </div>
        ${item.exampleFile ? `<button type="button" class="item-info" data-example="${escapeHtml(item.exampleFile)}" title="View example" aria-label="View example for ${escapeHtml(item.id)}">${INFO_ICON}</button>` : ''}
      </div>`;
    const cb = div.querySelector('[data-check]');
    cb.checked = cs === 'all';
    cb.indeterminate = cs === 'some';
    container.appendChild(div);
    div.addEventListener('click', e => {
      if (e.target.closest('input, textarea, button')) return;
      openItemEditor(item.id, state.viewerUnitId);
    });
  }

  if (visible.length === 0) {
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = state.hideChecked
      ? 'All applicable items are checked. ✓'
      : 'No applicable items for the current inputs.';
    container.appendChild(p);
  }

  container.querySelectorAll('[data-check]').forEach(cb =>
    cb.addEventListener('change', () => {
      const itemId = cb.getAttribute('data-check');
      const item = state.model.items.find(i => i.id === itemId);
      const p = getCurrentProject();
      const applicable = itemApplicableUnits(state.model, p, item);
      const target = itemCheckState(item, applicable) !== 'all';
      for (const u of applicable) {
        const live = p.units.find(x => x.id === u.id);
        live.checks[itemId] = target;
      }
      saveCurrent(p);
      renderItems();
      renderProgress();
      renderItemEditor();
    }));
  container.querySelectorAll('[data-example]').forEach(btn =>
    btn.addEventListener('click', e => { e.stopPropagation(); openExample(btn.getAttribute('data-example')); }));
}
```

(Changes from the current version: dropped the `tags` chips, the `.unit-tags` container, the code tag, the note, and the `[data-tag-item]` click handler; the per-item map now stores only the tri-state.)

- [ ] **Step 2: Remove the dead unit-tag CSS**

In `styles.css`, delete these rules:

```css
.unit-tags { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
.unit-tag {
  font-size: 0.78rem; line-height: 1; padding: 4px 8px; border-radius: 999px;
  border: 1px solid var(--accent, #2f6feb); color: var(--accent, #2f6feb);
  background: none; cursor: pointer;
}
.unit-tag.done {
  background: var(--accent, #2f6feb); color: #fff;
}
.unit-tag.done::before { content: '✓ '; }
```

(Leave `.items-list .item input[type=checkbox]:indeterminate { opacity: 0.85; }` — still used.)

- [ ] **Step 3: Verify**

Run: `node --check src/app.js && npm test`
Expected: clean; **64/64**.

Manual (browser harness): rows now show only checkbox + `"ID — description"` (+ ⓘ when present); no tag chips / code tag / note. Section headings and counts remain. Ticking a row still checks all applicable units (tri-state indeterminate when only some); clicking a row body opens the editor; the ⓘ button still opens the example.

- [ ] **Step 4: Commit**

```bash
git add src/app.js styles.css
git commit -m "feat: lean checklist rows (id + description, no tags)"
```

---

## Task 3: Lean item editor

**Files:**
- Modify: `src/app.js` (`renderItemEditor`, lines 750-805)
- Modify: `styles.css` (`.ed-item-head` tweak; remove `.ed-desc`, `.ed-check-row`; add `.ed-item-name`, `.ed-comment-label`)

**Interfaces:**
- Consumes: `itemApplicableUnits`, `escapeHtml`, `getCurrentProject`, `saveCurrent`, `renderItems`, `renderProgress`, `state`.
- Produces: a lean editor — checkbox + `"ID — description"` on top, the note (if any), a "Unit Selection" dropdown over the item's applicable units, and a Comments box. No code tag, no example button, no tag chips.

- [ ] **Step 1: Replace `renderItemEditor` with the lean version**

Replace the entire `renderItemEditor` function (lines 750-805) with:

```js
function renderItemEditor() {
  const empty = document.getElementById('editor-empty');
  const body = document.getElementById('item-editor-body');
  const item = state.editorItemId
    ? state.model.items.find(i => i.id === state.editorItemId) : null;
  const project = getCurrentProject();
  const applicable = item ? itemApplicableUnits(state.model, project, item) : [];
  if (!item || applicable.length === 0) {
    empty.hidden = false; body.hidden = true; body.innerHTML = '';
    return;
  }
  empty.hidden = true; body.hidden = false;
  const unit = applicable.find(u => u.id === state.editorUnitId) || applicable[0];
  state.editorUnitId = unit.id;

  body.innerHTML = `
    <div class="ed-item-head">
      <input type="checkbox" id="ed-check" ${unit.checks[item.id] === true ? 'checked' : ''}/>
      <span class="ed-item-name"><span class="id">${escapeHtml(item.id)}</span> — ${escapeHtml(item.description)}</span>
    </div>
    ${item.note ? `<div class="item-note">${escapeHtml(item.note)}</div>` : ''}
    <label class="ed-unit-row"><span>Unit Selection</span><select id="ed-unit-select"></select></label>
    <div class="ed-comment-label">Comments</div>
    <textarea id="ed-comment" class="ed-comment" rows="6" placeholder="Comment for this unit…"></textarea>`;

  const sel = body.querySelector('#ed-unit-select');
  for (const u of applicable) {
    const opt = document.createElement('option');
    opt.value = u.id; opt.textContent = u.name;
    if (u.id === unit.id) opt.selected = true;
    sel.appendChild(opt);
  }
  sel.addEventListener('change', () => { state.editorUnitId = sel.value; renderItemEditor(); });

  body.querySelector('#ed-comment').value = unit.comments[item.id] || '';
  body.querySelector('#ed-comment').addEventListener('input', e => {
    const p = getCurrentProject();
    const u = p.units.find(x => x.id === state.editorUnitId);
    if (!u) return;
    u.comments[item.id] = e.target.value;
    saveCurrent(p);
  });
  body.querySelector('#ed-check').addEventListener('change', e => {
    const p = getCurrentProject();
    const u = p.units.find(x => x.id === state.editorUnitId);
    if (!u) return;
    u.checks[item.id] = e.target.checked;
    saveCurrent(p);
    renderItems();
    renderProgress();
  });
}
```

(Changes from the current version: header is now a checkbox + `"ID — description"`; removed the code tag, the example ⓘ button and its handler, and the standalone `.ed-desc` paragraph and `.ed-check-row` label; added a "Comments" label and grew the textarea to 6 rows. The "Unit" label is renamed "Unit Selection".)

- [ ] **Step 2: Update the editor CSS**

In `styles.css`, replace this rule:

```css
.ed-item-head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
```

with:

```css
.ed-item-head { display: flex; align-items: flex-start; gap: 10px; margin-bottom: 8px; }
.ed-item-head input[type="checkbox"] { margin-top: 3px; flex: none; }
.ed-item-name { flex: 1; line-height: 1.4; }
.ed-comment-label { font-weight: 600; font-size: 0.9rem; margin: 12px 0 6px; }
```

Then delete these now-unused rules:

```css
.ed-desc { margin: 0 0 10px; font-weight: 600; }
```

```css
.ed-check-row { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
```

- [ ] **Step 3: Verify**

Run: `node --check src/app.js && npm test`
Expected: clean; **64/64**.

Manual (browser harness): click an item → editor shows a checkbox + `"ID — description"` on top, the note beneath (when present), a "Unit Selection" dropdown limited to the item's applicable units, and a large Comments box. No example button in the editor. Toggling the editor checkbox updates the row's tri-state and progress; typing a comment persists; switching the Unit Selection dropdown swaps the shown check + comment for that unit.

- [ ] **Step 4: Commit**

```bash
git add src/app.js styles.css
git commit -m "feat: lean RHS item editor (checkbox, unit selection, comments)"
```

---

## Self-Review Notes

- **Spec coverage:** three-column layout w/ middle header card (Task 1) ✓; Unit Selection always-visible box + Unit Details collapsible + selector moved out (Task 1) ✓; lean rows = checkbox + ID/description + example ⓘ, section headings kept, tags/code/note removed (Task 2) ✓; lean editor = checkbox+name, note, Unit Selection dropdown, Comments, example not duplicated (Task 3) ✓; tri-state + helpers + progress + filter + export unchanged (Global Constraints; preserved ids) ✓; two independent unit selectors retained (`#viewer-unit-select` in Unit Selection, `#ed-unit-select` in editor) ✓.
- **Placeholder scan:** none — every code step is complete.
- **Type/id consistency:** preserved ids verified against the current `renderInputsViewer` (`#viewer-unit-select`, `#inputs-readout`) and init wiring (`#inputs-toggle`, `#section-select`, `#toggle-hide-checked`); `renderInputsViewer` needs no edit because its ids are unchanged.
