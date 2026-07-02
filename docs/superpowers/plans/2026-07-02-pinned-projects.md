# Pinned Projects Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user pin up to 5 projects and reach them from an expandable "Pinned" section in the sidebar, with a pin toggle on each dashboard project card.

**Architecture:** Add a `pinned` flag to the project object with a `setPinned` store method (no `updatedAt` bump). The dashboard card gains a pin toggle; the sidebar gains an expandable "Pinned" nav item rebuilt by `renderPinnedNav()`. The 5-pin cap is enforced in `app.js` with an `alert`, keeping the store logic-free.

**Tech Stack:** Vanilla ES modules, no build step. Node's built-in test runner (`node --test`) for pure logic. Static offline web app.

## Global Constraints

- **Static-app discipline:** no framework, no bundler, no new runtime deps.
- **CSS is token-driven and theme-aware:** use existing CSS custom properties; never hardcode colors (breaks dark mode). Scope new sidebar CSS under `.side-nav` / the pinned sub-list.
- **localStorage calls go in `try/catch`** (private mode / unsupported browsers).
- **db.js owns the IndexedDB schema** — do not touch it; the `pinned` flag rides existing project persistence, no schema change.
- **Button labels are Title Case.**
- **Max 5 pinned projects.** The 6th pin attempt shows: `alert('You can pin up to 5 projects. Unpin one first.')` and changes nothing. Unpinning is always allowed.
- Pinned sidebar list order = `listProjects()` order (`updatedAt` desc). No manual reordering.
- Verify after UI changes with `npm test` + a headless-Edge smoke run (browser-smoke-test-harness memory).

---

### Task 1: `setPinned` store method + `pinned` in summaries

**Files:**
- Modify: `src/projectStore.js` (add `setPinned`; include `pinned` in `listProjects` map; export `setPinned`)
- Test: `tests/projectStore.test.js`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `setPinned(id, pinned)` → `void`. Sets `project.pinned = true` when `pinned` is truthy, else deletes the `pinned` key. Does **not** modify `updatedAt`. No-op when `id` is unknown. Calls `notify('upsert', id)` only when a project with that id exists.
  - `listProjects()` summary objects gain a `pinned` boolean: `{ id, name, updatedAt, pinned }` (always a boolean, `false` when absent).

- [ ] **Step 1: Write the failing tests**

Add to `tests/projectStore.test.js`:

```js
test('setPinned sets and clears the flag without bumping updatedAt', () => {
  const store = createProjectStore();
  store.load([{ id: 'p1', name: 'A', updatedAt: '2026-01-01T00:00:00Z',
    units: [{ id: 'u', name: 'U', inputs: {}, checks: {}, comments: {} }] }]);
  store.setPinned('p1', true);
  let p = store.getProject('p1');
  assert.equal(p.pinned, true);
  assert.equal(p.updatedAt, '2026-01-01T00:00:00Z'); // unchanged
  store.setPinned('p1', false);
  p = store.getProject('p1');
  assert.ok(!p.pinned);
  assert.equal(p.updatedAt, '2026-01-01T00:00:00Z');
});

test('setPinned is a no-op for unknown ids and fires no event', () => {
  const events = [];
  const store = createProjectStore({ onChange: e => events.push(e) });
  store.setPinned('nope', true);
  assert.deepEqual(events, []);
});

test('listProjects surfaces pinned as a boolean', () => {
  const store = createProjectStore();
  store.load([
    { id: 'a', name: 'A', updatedAt: '2026-02-01T00:00:00Z', pinned: true, units: [] },
    { id: 'b', name: 'B', updatedAt: '2026-01-01T00:00:00Z', units: [] },
  ]);
  const byId = Object.fromEntries(store.listProjects().map(p => [p.id, p.pinned]));
  assert.equal(byId.a, true);
  assert.equal(byId.b, false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `store.setPinned is not a function` and `pinned` undefined in summaries.

- [ ] **Step 3: Implement**

In `src/projectStore.js`, update `listProjects` to include `pinned`:

```js
  function listProjects() {
    return [...projects.values()]
      .map(p => ({ id: p.id, name: p.name, updatedAt: p.updatedAt, pinned: !!p.pinned }))
      .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  }
```

Add the method (place it after `saveProject`):

```js
  function setPinned(id, pinned) {
    const p = projects.get(id);
    if (!p) return;
    if (pinned) p.pinned = true;
    else delete p.pinned;
    notify('upsert', id);
  }
```

Add `setPinned` to the returned object:

```js
  return {
    load, listProjects, getProject, saveProject, deleteProject, createProject,
    newUnit, serializeProject, importProject, serializeLibrary, importLibrary,
    setPinned,
  };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS (all existing + 3 new tests).

- [ ] **Step 5: Syntax check + commit**

```bash
node --check src/projectStore.js
git add src/projectStore.js tests/projectStore.test.js
git commit -m "feat: setPinned store method + pinned in project summaries"
```

---

### Task 2: Pin toggle button on the dashboard card

**Files:**
- Modify: `src/app.js` — `renderDashboard` (~lines 264-299), add a `PIN_SVG` helper + a `togglePin` handler
- Modify: `styles.css` — pin button state styling

**Interfaces:**
- Consumes: `state.store.listProjects()` (now with `pinned`), `state.store.setPinned(id, pinned)`.
- Produces: `renderPinnedNav()` is called here but defined in Task 3 — until Task 3 lands, add a temporary no-op guard `if (typeof renderPinnedNav === 'function') renderPinnedNav();` **No** — functions are hoisted in the module; define `renderPinnedNav` in Task 3 in the same file, so a direct call is safe as long as both tasks are committed. For Task 2 in isolation, call `renderDashboard()` only (drop the `renderPinnedNav()` line) and add it in Task 3.

- [ ] **Step 1: Add the pin SVG constants near the top of the render helpers**

In `src/app.js`, just above `renderDashboard` (near line 264), add:

```js
// Pin glyph — outline when not pinned, filled (via fill=currentColor) when pinned.
const pinSvg = (filled) =>
  `<svg viewBox="0 0 24 24" width="16" height="16" fill="${filled ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 17v5"/><path d="M9 10.76V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v6.76a2 2 0 0 0 .59 1.42l1.7 1.7A1 1 0 0 1 18.59 15H5.41a1 1 0 0 1-.7-1.71l1.7-1.7A2 2 0 0 0 7 10.76z"/></svg>`;
```

- [ ] **Step 2: Add the pin button to each card's `.btn-row`**

In `renderDashboard`, change the `<span class="btn-row">` block so the pin button precedes the eye button:

```js
        <span class="btn-row">
          <button class="pin-btn${summary.pinned ? ' pinned' : ''}" data-pin="${project.id}" type="button"
            title="${summary.pinned ? 'Unpin' : 'Pin'}" aria-label="${summary.pinned ? 'Unpin project' : 'Pin project'}"
            aria-pressed="${summary.pinned ? 'true' : 'false'}">${pinSvg(summary.pinned)}</button>
          <button class="eye-btn" data-quicklook="${project.id}" type="button" title="Quick Look" aria-label="Quick Look">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
          </button>
        </span>
```

Note: `summary` is available — change the loop head from `for (const summary of projects)` (already the case) and it already fetches `const project = state.store.getProject(summary.id);`. Use `summary.pinned` for state.

- [ ] **Step 3: Wire the pin button click (with the 5-cap)**

After the existing `list.querySelectorAll('[data-quicklook]')` wiring in `renderDashboard`, add:

```js
  list.querySelectorAll('[data-pin]').forEach(btn =>
    btn.addEventListener('click', e => { e.stopPropagation(); togglePin(btn.getAttribute('data-pin')); }));
```

Add the handler function directly after `renderDashboard`:

```js
function togglePin(id) {
  const summaries = state.store.listProjects();
  const current = summaries.find(p => p.id === id);
  if (!current) return;
  const next = !current.pinned;
  if (next && summaries.filter(p => p.pinned).length >= 5) {
    alert('You can pin up to 5 projects. Unpin one first.');
    return;
  }
  state.store.setPinned(id, next);
  renderDashboard();
}
```

(`renderPinnedNav()` is added to this handler and to `renderDashboard` in Task 3.)

- [ ] **Step 4: Add CSS for the pin button**

In `styles.css`, near the `.eye-btn` rules (search `eye-btn`), add matching rules. If `.btn-row .eye-btn` already defines the shared button look, reuse it by adding `.pin-btn` to the same selector; otherwise add:

```css
.pin-btn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; padding: 0;
  border: 1px solid transparent; border-radius: 8px;
  background: transparent; color: var(--muted); cursor: pointer;
}
.pin-btn:hover { background: var(--surface-muted); color: var(--text); }
.pin-btn.pinned { color: var(--accent); }
```

- [ ] **Step 5: Verify (smoke) + commit**

Run: `node --check src/app.js` then `npm test` (should still pass — no logic changed in tested modules).
Smoke (headless Edge): load app, create 2 projects, click a card's pin button → icon fills and turns accent-colored; click again → outline. Pin 5 projects, attempt a 6th → `alert` appears, count stays 5.

```bash
git add src/app.js styles.css
git commit -m "feat: pin toggle button on dashboard project cards"
```

---

### Task 3: Sidebar "Pinned" nav item + `renderPinnedNav()`

**Files:**
- Modify: `index.html` — insert the Pinned nav item into `.side-nav` (between `#nav-dashboard` and `#nav-about`, ~line 50)
- Modify: `src/app.js` — add `renderPinnedNav()`, wire the header toggle, call `renderPinnedNav()` from `renderDashboard`, `togglePin`, `init`, and library-import success
- Modify: `styles.css` — pinned nav item + sub-list styling

**Interfaces:**
- Consumes: `state.store.listProjects()` (with `pinned`), `openProject(id)`, `escapeHtml(s)`, `SIDEBAR_KEY` pattern.
- Produces: `renderPinnedNav()` → `void`. Rebuilds `#pinned-sublist`; hides `#nav-pinned-wrap` when no projects are pinned; caps rows at 5.

- [ ] **Step 1: Add the markup**

In `index.html`, insert between the `#nav-dashboard` button (ends line 50) and the `#nav-about` button (line 51):

```html
        <div id="nav-pinned-wrap" class="nav-pinned" hidden>
          <button id="nav-pinned" class="side-link" type="button" aria-expanded="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 17v5"/><path d="M9 10.76V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v6.76a2 2 0 0 0 .59 1.42l1.7 1.7A1 1 0 0 1 18.59 15H5.41a1 1 0 0 1-.7-1.71l1.7-1.7A2 2 0 0 0 7 10.76z"/>
            </svg>
            <span>Pinned</span>
            <svg class="nav-pinned-chevron" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
          </button>
          <ul id="pinned-sublist" class="pinned-sublist"></ul>
        </div>
```

- [ ] **Step 2: Add `renderPinnedNav()`**

In `src/app.js`, add after `togglePin`:

```js
function renderPinnedNav() {
  const wrap = document.getElementById('nav-pinned-wrap');
  const list = document.getElementById('pinned-sublist');
  if (!wrap || !list) return;
  const pinned = state.store.listProjects().filter(p => p.pinned).slice(0, 5);
  wrap.hidden = pinned.length === 0;
  list.innerHTML = '';
  for (const p of pinned) {
    const li = document.createElement('li');
    li.className = 'pinned-item';
    li.innerHTML = `<button type="button" class="pinned-link" data-open="${p.id}" title="${escapeHtml(p.name)}">${escapeHtml(p.name)}</button>`;
    list.appendChild(li);
  }
  list.querySelectorAll('[data-open]').forEach(btn =>
    btn.addEventListener('click', () => openProject(btn.getAttribute('data-open'))));
}
```

- [ ] **Step 3: Call `renderPinnedNav()` from the render/mutation points**

- In `renderDashboard`, add `renderPinnedNav();` as the final line of the function.
- In `togglePin`, after `renderDashboard();` add `renderPinnedNav();` (safe even though renderDashboard already calls it — idempotent; keep just the one in `renderDashboard` and drop the extra to stay DRY. Net: `togglePin` ends with `renderDashboard();` only.)
- In `importLibrary` success handlers (search `Restored ${n}` around line 1296), add `renderPinnedNav();` after the alert so a restored backup's pins show immediately without needing a dashboard re-render.

- [ ] **Step 4: Wire the expand/collapse toggle in `init`**

Add a `wirePinnedNav()` function and call it from `init` (near the other `wire*()` calls, ~line 1237):

```js
const PINNED_NAV_KEY = 'dpchecklist.pinnedNav';
function wirePinnedNav() {
  const btn = document.getElementById('nav-pinned');
  const wrap = document.getElementById('nav-pinned-wrap');
  if (!btn || !wrap) return;
  const apply = (open) => {
    wrap.classList.toggle('open', open);
    btn.setAttribute('aria-expanded', String(open));
  };
  let open = true;
  try { open = window.localStorage.getItem(PINNED_NAV_KEY) !== 'collapsed'; } catch { /* ignore */ }
  apply(open);
  btn.addEventListener('click', () => {
    open = !wrap.classList.contains('open');
    apply(open);
    try { window.localStorage.setItem(PINNED_NAV_KEY, open ? 'expanded' : 'collapsed'); } catch { /* ignore */ }
  });
}
```

In `init`, add `wirePinnedNav();` next to `wireSidebarToggle();`, and add `renderPinnedNav();` after `state.store.load(snap.projects);` so pins render on first paint.

- [ ] **Step 5: Add CSS**

In `styles.css`, after the `.side-nav` / `.side-link` rules (~line 169), add:

```css
.nav-pinned[hidden] { display: none; }
.nav-pinned-chevron { margin-left: auto; transition: transform .15s ease; }
.nav-pinned.open .nav-pinned-chevron { transform: rotate(180deg); }
.pinned-sublist { list-style: none; margin: 0; padding: 0; max-height: 0; overflow: hidden; }
.nav-pinned.open .pinned-sublist { max-height: none; }
.pinned-link {
  display: block; width: 100%; text-align: left;
  padding: 6px 10px 6px 40px; border: 0; border-radius: 8px;
  background: transparent; color: var(--muted); cursor: pointer;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  font: inherit;
}
.pinned-link:hover { background: var(--surface-muted); color: var(--text); }
/* When the sidebar is collapsed, show only the pin icon — no label, no sublist. */
html.sidebar-collapsed .nav-pinned-chevron,
html.sidebar-collapsed .pinned-sublist { display: none; }
```

- [ ] **Step 6: Verify (smoke) + commit**

Run: `node --check src/app.js` then `npm test`.
Smoke (headless Edge):
- With 0 pins, the "Pinned" sidebar item is absent (`#nav-pinned-wrap` hidden).
- Pin a project from its card → "Pinned" appears with that project; click its row → the project opens.
- Collapse the "Pinned" header → sub-list hides, chevron rotates, state survives reload.
- Unpin all → "Pinned" item disappears again.

```bash
git add index.html src/app.js styles.css
git commit -m "feat: expandable Pinned nav section in the sidebar"
```

---

## Self-Review

**Spec coverage:**
- Pin flag on project object + persistence → Task 1 (`setPinned`, summaries) + rides `saveProject`/`importLibrary`. ✓
- `setPinned` without `updatedAt` bump → Task 1 tests. ✓
- Pin button on card (filled/outline), no select/open on click → Task 2 (`stopPropagation`). ✓
- 5-pin cap with `alert` in app layer → Task 2 `togglePin`. ✓
- Expandable "Pinned" sidebar item between Projects and About; rows open project; hidden when empty; collapse persisted; collapsed-sidebar suppresses dropdown → Task 3. ✓
- Order = `updatedAt` desc, capped 5 → Task 3 `slice(0,5)` over `listProjects()`. ✓
- Unit tests + smoke → Task 1 (unit), Tasks 2 & 3 (smoke). ✓

**Placeholder scan:** No TBDs; all code blocks concrete.

**Type consistency:** `setPinned(id, pinned)`, `listProjects()` summary `{id,name,updatedAt,pinned}`, `renderPinnedNav()`, `togglePin(id)`, `openProject(id)`, `escapeHtml(s)` used consistently across tasks. Task 2 note resolved: the `renderPinnedNav()` call is added in Task 3, not Task 2, so Task 2 commits cleanly on its own.

**Out of scope (unchanged from spec):** manual reordering; pinning from Quick Look or the project screen.
