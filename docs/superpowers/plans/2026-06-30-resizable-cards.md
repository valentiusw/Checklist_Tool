# Resizable Cards (Draggable Splitter) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a draggable vertical splitter between the Checklist and Detail-panel cards that trades width between them (persisted), and hide the Checklist card's scrollbar while keeping it scrollable.

**Architecture:** The detail card's width becomes a CSS custom property `--detail-w` set on `.project-body`; the checklist card flexes to fill the rest. A slim splitter flex-item sits between them; a Pointer-Events drag handler in `src/app.js` updates `--detail-w` (clamped to min widths) and persists it to `localStorage`. All desktop-only (≥901px); the ≤900px stacked layout hides the splitter. No data-model/exporter/render-logic changes.

**Tech Stack:** Vanilla ES modules, Pointer Events, `localStorage`. No build step. `node --test` regression; UI verified via headless-Edge/CDP.

## Global Constraints

- **No data-model or exporter changes.** No render-logic changes to `renderItems`/`renderItemEditor`/`renderInputsViewer`.
- **No new dependencies, no build step.**
- **Desktop-only resize:** the splitter and variable widths apply at ≥901px; ≤900px keeps today's stacked, full-width fallback (splitter hidden).
- **Constants:** `MIN_CARD_WIDTH = 280` (px, both cards); default detail width `350`px; `localStorage` key `'dpchecklist.detailWidth'`.
- **Checklist scrollbar hidden but scrollable:** `scrollbar-width: none` + `::-webkit-scrollbar { display: none }` on `#items-list`, keeping `overflow-y: auto`. The Detail card scrollbar is unchanged.
- **No automated test for these UI tasks.** Verify with `node --check src/app.js` and `npm test` (must stay **64/64**). The controller runs the browser smoke check.

---

## File Structure

- **Modify** `index.html` — insert a splitter element between `.checklist-main` and `#detail-panel`.
- **Modify** `styles.css` — splitter styling, `--detail-w`-driven detail width, `gap:0` on the desktop project-body, hidden checklist scrollbar, hide splitter ≤900px.
- **Modify** `src/app.js` — drag/persist/restore logic (`wireCardSplitter`, `applyDetailWidth`, `storedDetailWidth`, constants), wired in `init()` and `renderProject()`.

---

## Task 1: Splitter element, variable widths, hidden scrollbar (static)

**Files:**
- Modify: `index.html` (insert splitter between line 144 `</div>` closing `.checklist-main` and line 145 `<aside id="detail-panel">`)
- Modify: `styles.css` (append a block; change the desktop `.detail-panel` rule to use the variable)

**Interfaces:**
- Produces: `#card-splitter.card-splitter` element in the project DOM; `--detail-w` consumed by `.detail-panel` (default `350px`). Later JS (Task 2) sets `--detail-w` on `.project-body` and toggles `#card-splitter.dragging`.

- [ ] **Step 1: Insert the splitter element**

In `index.html`, between the `</div>` that closes `.checklist-main` (line 144) and `<aside id="detail-panel" class="detail-panel">` (line 145), insert:

```html
        <div id="card-splitter" class="card-splitter" role="separator" aria-orientation="vertical" aria-label="Resize panels"></div>
```

So that region reads:

```html
          <div id="items-list" class="items-list"></div>
        </div>
        <div id="card-splitter" class="card-splitter" role="separator" aria-orientation="vertical" aria-label="Resize panels"></div>
        <aside id="detail-panel" class="detail-panel">
```

- [ ] **Step 2: Make the desktop detail width variable-driven**

In `styles.css`, inside the existing `@media (min-width: 901px)` block, replace the rule:

```css
  [data-screen="project"] .detail-panel {
    position: static; top: auto; flex: 0 0 350px; width: 350px;
    min-height: 0; overflow-y: auto;
  }
```

with:

```css
  [data-screen="project"] .detail-panel {
    position: static; top: auto;
    flex: 0 0 var(--detail-w, 350px); width: var(--detail-w, 350px);
    min-height: 0; overflow-y: auto;
  }
  [data-screen="project"] .project-body { gap: 0; }
```

(On the desktop side-by-side layout the inter-card spacing now comes from the splitter, not the flex gap.)

- [ ] **Step 3: Append the splitter + scrollbar CSS**

Append to `styles.css`:

```css
/* ===== Resizable cards: draggable splitter + hidden checklist scrollbar ===== */
/* Slim vertical splitter that trades width between the two cards (desktop only). */
.card-splitter {
  flex: 0 0 16px; align-self: stretch; position: relative;
  cursor: col-resize; touch-action: none; background: transparent;
}
.card-splitter::before {
  content: ''; position: absolute; top: 0; bottom: 0; left: 50%;
  width: 2px; transform: translateX(-50%);
  background: var(--border); border-radius: 2px;
  transition: background .12s ease;
}
.card-splitter:hover::before,
.card-splitter.dragging::before { background: var(--accent); }
@media (max-width: 900px) { .card-splitter { display: none; } }

/* Hide the Checklist card's scrollbar but keep it scrollable. */
[data-screen="project"] #items-list { scrollbar-width: none; }
[data-screen="project"] #items-list::-webkit-scrollbar { display: none; }
```

- [ ] **Step 4: Verify**

Run: `node --check src/app.js && npm test`
Expected: `node --check` clean; tests **64/64**.

Manual (browser harness): open a project on a wide window. A slim vertical bar sits between the two cards and highlights on hover; the detail card is ~350px (unchanged default); the checklist list scrolls (when items overflow) but shows **no scrollbar**. Below 900px the bar is hidden and cards stack full-width. (No drag yet — Task 2.)

- [ ] **Step 5: Commit**

```bash
git add index.html styles.css
git commit -m "feat: splitter element + variable card widths + hidden checklist scrollbar"
```

---

## Task 2: Drag-to-resize + persistence

**Files:**
- Modify: `src/app.js` (add constants + `applyDetailWidth`/`storedDetailWidth`/`wireCardSplitter`; call `wireCardSplitter()` in `init()`; call `applyDetailWidth(storedDetailWidth())` in `renderProject()`)

**Interfaces:**
- Consumes: `#card-splitter` and `.project-body` from Task 1; `--detail-w` CSS variable on `.project-body`.
- Produces: `MIN_CARD_WIDTH`, `SPLIT_KEY`, `applyDetailWidth(px)`, `storedDetailWidth()`, `wireCardSplitter()`.

- [ ] **Step 1: Add the constants and helpers**

In `src/app.js`, add these just before the `wireSidebarToggle` function (search for `const SIDEBAR_KEY`):

```js
// --- Resizable cards: drag the splitter to trade width between the two cards.
const SPLIT_KEY = 'dpchecklist.detailWidth';
const MIN_CARD_WIDTH = 280;

function projectBodyEl() {
  return document.querySelector('#screen-project .project-body');
}

// Clamp a desired detail-card width so neither card drops below MIN_CARD_WIDTH.
function clampDetailWidth(px, body) {
  const splitter = document.getElementById('card-splitter');
  const sw = splitter ? splitter.offsetWidth : 16;
  const max = body.clientWidth - MIN_CARD_WIDTH - sw;
  if (max < MIN_CARD_WIDTH) return Math.max(0, max); // window too narrow to honor both mins
  return Math.max(MIN_CARD_WIDTH, Math.min(px, max));
}

// Apply (clamped) detail width to the project body's --detail-w variable.
function applyDetailWidth(px) {
  const body = projectBodyEl();
  if (!body || body.clientWidth <= 0) return;
  body.style.setProperty('--detail-w', clampDetailWidth(px, body) + 'px');
}

function storedDetailWidth() {
  let v = NaN;
  try { v = Number(window.localStorage.getItem(SPLIT_KEY)); } catch { /* ignore */ }
  return Number.isFinite(v) && v > 0 ? v : 350;
}

function currentDetailWidth(body) {
  return parseFloat(getComputedStyle(body).getPropertyValue('--detail-w')) || storedDetailWidth();
}

function wireCardSplitter() {
  const splitter = document.getElementById('card-splitter');
  if (!splitter) return;
  let dragging = false;
  splitter.addEventListener('pointerdown', (e) => {
    if (!projectBodyEl()) return;
    dragging = true;
    splitter.classList.add('dragging');
    try { splitter.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    e.preventDefault();
  });
  splitter.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const body = projectBodyEl();
    if (!body) return;
    applyDetailWidth(body.getBoundingClientRect().right - e.clientX);
  });
  const end = (e) => {
    if (!dragging) return;
    dragging = false;
    splitter.classList.remove('dragging');
    try { splitter.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    const body = projectBodyEl();
    if (body) {
      try { window.localStorage.setItem(SPLIT_KEY, String(Math.round(currentDetailWidth(body)))); } catch { /* ignore */ }
    }
  };
  splitter.addEventListener('pointerup', end);
  splitter.addEventListener('pointercancel', end);
  // Keep the stored width valid when the window resizes.
  window.addEventListener('resize', () => {
    const screen = document.getElementById('screen-project');
    const body = projectBodyEl();
    if (body && screen && !screen.hidden) applyDetailWidth(currentDetailWidth(body));
  });
}
```

- [ ] **Step 2: Wire it up in `init()`**

In `src/app.js`, find the `wireSidebarToggle();` call inside `init()` and add the splitter wiring right after it:

```js
  wireSidebarToggle();
  wireCardSplitter();
```

- [ ] **Step 3: Restore the stored width when the project screen renders**

In `src/app.js`, in `renderProject()`, just after the early return guard:

```js
function renderProject() {
  const project = getCurrentProject();
  if (!project) { showScreen('dashboard'); return; }
```

add:

```js
  applyDetailWidth(storedDetailWidth());
```

- [ ] **Step 4: Verify**

Run: `node --check src/app.js && npm test`
Expected: clean; **64/64**.

Manual (browser harness, wide window): drag the splitter left → the detail card widens and the checklist narrows; drag right → the reverse. Neither card shrinks below ~280px. Reload the page and reopen the project → the last split width is restored. Resize the window very narrow then back → the split stays valid (re-clamped). The Detail card still shows its scrollbar; the Checklist still has none.

- [ ] **Step 5: Commit**

```bash
git add src/app.js
git commit -m "feat: drag-to-resize cards with persisted split width"
```

---

## Self-Review Notes

- **Spec coverage:** draggable splitter trading width (Task 1 element + Task 2 drag) ✓; slim bar highlighting on hover/drag (Task 1 CSS `:hover`/`.dragging`) ✓; min widths ~280 (Task 2 `clampDetailWidth`) ✓; persistence via `localStorage` key `dpchecklist.detailWidth` (Task 2 `end`/`storedDetailWidth`) ✓; restore on render (Task 2 Step 3) ✓; re-clamp on resize (Task 2 `resize` handler) ✓; desktop-only, hidden ≤900px (Task 1 `@media (max-width:900px)`, var rule inside `min-width:901px`) ✓; hidden checklist scrollbar, scroll kept (Task 1 CSS) ✓; no data/exporter/render-logic change (Global Constraints) ✓.
- **Placeholder scan:** none — every code step is complete.
- **Name consistency:** `--detail-w`, `MIN_CARD_WIDTH`, `SPLIT_KEY` (`'dpchecklist.detailWidth'`), `applyDetailWidth`, `storedDetailWidth`, `currentDetailWidth`, `projectBodyEl`, `clampDetailWidth`, `wireCardSplitter`, `#card-splitter` used consistently across both tasks. The desktop `.detail-panel` rule consumes `var(--detail-w, 350px)` matching the default returned by `storedDetailWidth()`.
