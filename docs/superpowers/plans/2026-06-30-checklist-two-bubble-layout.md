# Two-Bubble App-Like Checklist Screen — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the project screen into two side-by-side rounded "bubbles" — a wider checklist bubble and a narrower detail-panel bubble — that scroll independently in a viewport-height, app-like layout, with flat interiors (dividers, not nested cards).

**Architecture:** Presentation-only. A `data-screen` marker on `<html>` (set in `showScreen()`) scopes all new CSS to the project screen. Bubble visuals apply at all widths; the app-like fixed-height + independent-scroll behavior is gated behind `@media (min-width: 901px)`, so narrow screens keep today's stacked, page-scrolling fallback. No rendering-logic, data-model, or exporter changes.

**Tech Stack:** Vanilla ES modules, no build step. `node --test` regression. UI verified via the headless-Edge/CDP smoke harness.

## Global Constraints

- **No data-model or exporter changes.** `src/exporter.js`, the on-disk shapes, and all render functions stay as-is.
- **No new dependencies, no build step.**
- **All new CSS is scoped to `[data-screen="project"]`** so Dashboard/Setup/Editor/About are unaffected.
- **Theme-aware:** use existing tokens (`--surface`, `--surface-muted`, `--border`, `--shadow`, `--radius`) — all defined for light and dark themes (styles.css:6-42). No hard-coded colors.
- **Element ids preserved.** No HTML structure changes are required.
- **No automated test for these UI tasks.** Verify with `node --check src/app.js` and `npm test` (must stay **64/64** — no logic changed). The controller runs the browser smoke check.

---

## File Structure

- **Modify** `src/app.js` — one line in `showScreen()` to set `document.documentElement.dataset.screen`.
- **Modify** `styles.css` — append two blocks: (1) bubble visuals (all widths), (2) app-like fixed-height/independent-scroll (desktop only).

---

## Task 1: `data-screen` hook + two-bubble visuals

**Files:**
- Modify: `src/app.js` (`showScreen`, lines 29-35)
- Modify: `styles.css` (append a block)

**Interfaces:**
- Consumes: existing `.checklist-main`, `.checklist-head`, `.items-list`, `.item`, `.detail-panel`, `.panel-section` markup (ids preserved).
- Produces: `<html data-screen="<name>">` set on every `showScreen` call; bubble visuals scoped to `[data-screen="project"]`.

- [ ] **Step 1: Set the `data-screen` marker in `showScreen`**

In `src/app.js`, change the start of `showScreen` (line 29-32) from:

```js
function showScreen(name) {
  for (const s of screens) {
    document.getElementById('screen-' + s).hidden = s !== name;
  }
```

to:

```js
function showScreen(name) {
  document.documentElement.dataset.screen = name;
  for (const s of screens) {
    document.getElementById('screen-' + s).hidden = s !== name;
  }
```

- [ ] **Step 2: Append the bubble-visual CSS**

Append to `styles.css`:

```css
/* ===== Two-bubble project screen — bubble visuals (all widths) ===== */
/* Each pane becomes a rounded, theme-aware bubble card. */
[data-screen="project"] .checklist-main,
[data-screen="project"] .detail-panel {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  box-shadow: var(--shadow);
}
/* Left bubble: flat pinned header over flat rows (no nested cards) */
[data-screen="project"] .checklist-main { gap: 0; overflow: hidden; }
[data-screen="project"] .checklist-head {
  border: none; border-radius: 0; background: none;
  border-bottom: 1px solid var(--border);
}
[data-screen="project"] .items-list { padding: 4px 18px 8px; }
[data-screen="project"] .items-list .item {
  border: none; border-radius: 0; background: none;
  margin: 0; padding: 14px 2px;
  border-bottom: 1px solid var(--border);
}
[data-screen="project"] .items-list .item:last-child { border-bottom: none; }
[data-screen="project"] .items-list .item:hover { background: var(--surface-muted); }
[data-screen="project"] .items-list .item.checked { background: none; }
/* Right bubble: flatten the three sections into one card with dividers */
[data-screen="project"] .detail-panel { gap: 0; }
[data-screen="project"] .detail-panel .panel-section {
  border: none; border-radius: 0; background: none; overflow: visible;
  border-bottom: 1px solid var(--border);
}
[data-screen="project"] .detail-panel .panel-section:last-child { border-bottom: none; }
```

- [ ] **Step 3: Verify**

Run: `node --check src/app.js && npm test`
Expected: `node --check` clean; tests **64/64**.

Manual (browser harness): open a project. The checklist (header + list) is now one rounded bubble with flat rows separated by thin dividers; the right panel is one rounded bubble whose Unit Selection / Unit Details / Item editor are flat sections separated by dividers (no nested white cards). Collapse on Unit Details still works. Dashboard/Setup/Editor/About look unchanged. (At this stage the page still scrolls normally and the right bubble may still be sticky — the app-like scrolling lands in Task 2.)

- [ ] **Step 4: Commit**

```bash
git add src/app.js styles.css
git commit -m "feat: two-bubble visuals for the project screen"
```

---

## Task 2: App-like independent scrolling (desktop)

**Files:**
- Modify: `styles.css` (append a desktop media block)

**Interfaces:**
- Consumes: the `[data-screen="project"]` marker and bubble classes from Task 1.
- Produces: viewport-height project screen with two independently-scrolling bubbles on screens wider than 900px; unchanged stacked/page-scroll behavior at ≤900px.

- [ ] **Step 1: Append the app-like layout CSS**

Append to `styles.css`:

```css
/* ===== Two-bubble project screen — app-like independent scroll (desktop) ===== */
@media (min-width: 901px) {
  /* The project screen fills the viewport; the page itself doesn't scroll here. */
  [data-screen="project"] main { height: 100vh; overflow: hidden; }
  [data-screen="project"] #screen-project {
    max-width: none; padding: 0; height: 100%;
    background: none; border: none; box-shadow: none;
    display: flex; flex-direction: column;
  }
  [data-screen="project"] .project-body {
    flex: 1 1 auto; min-height: 0; align-items: stretch; margin: 0;
  }
  /* Left bubble: header pinned, only the list scrolls */
  [data-screen="project"] .checklist-main { min-height: 0; }
  [data-screen="project"] .checklist-head { flex: none; }
  [data-screen="project"] #items-list { flex: 1 1 auto; min-height: 0; overflow-y: auto; }
  /* Right bubble: static (not sticky); scrolls its own content */
  [data-screen="project"] .detail-panel {
    position: static; top: auto; flex: 0 0 350px; width: 350px;
    min-height: 0; overflow-y: auto;
  }
}
```

- [ ] **Step 2: Verify**

Run: `node --check src/app.js && npm test`
Expected: clean; **64/64**.

Manual (browser harness, wide window): on the project screen the page/window no longer scrolls; the toolbar stays at the top; the checklist header stays pinned while the item list scrolls inside the left bubble; the right bubble scrolls its own content independently; the two bubbles sit side by side (checklist wider, detail ~350px) with a gap. Resize below 900px (or check the harness at a narrow width): the layout stacks (detail bubble below the checklist) and the page scrolls normally. Other screens are unaffected.

- [ ] **Step 3: Commit**

```bash
git add styles.css
git commit -m "feat: app-like independent scrolling for the two bubbles"
```

---

## Self-Review Notes

- **Spec coverage:** two side-by-side bubbles, asymmetric widths (Task 1 visuals + Task 2 widths) ✓; left = pinned header + scrolling list (Task 2) ✓; right = one flattened bubble with dividers (Task 1) ✓; flat rows with dividers (Task 1) ✓; theme-aware bubble cards via tokens (Task 1) ✓; app-like viewport height + independent scroll, page doesn't scroll (Task 2) ✓; scoped to `[data-screen="project"]` via `showScreen` hook (Task 1) ✓; `.screen` neutralized on project screen (Task 2) ✓; ≤900px stacked/page-scroll fallback (Task 2 gates app-like behind `min-width:901px`; existing `@media (max-width:900px)` keeps stacking) ✓; no data/exporter/render-logic change (Global Constraints) ✓.
- **Placeholder scan:** none — every code step is complete.
- **Specificity check:** `[data-screen="project"] #screen-project` (attribute + id) overrides `.screen` (class); `[data-screen="project"] .items-list .item` overrides `.item`; `[data-screen="project"] .detail-panel` overrides the base `.detail-panel` sticky rule. All scoped selectors carry higher specificity than the base rules they adjust.
- **Token check:** `--surface`, `--surface-muted`, `--border`, `--shadow`, `--radius` all defined in `:root` and the dark theme (styles.css:6-42).
