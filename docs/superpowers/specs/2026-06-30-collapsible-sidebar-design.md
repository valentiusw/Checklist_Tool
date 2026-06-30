# Collapsible sidebar

## Goal

Make the left sidebar collapsible to an icon-only rail, with a smooth
open/close animation, a custom centered chevron handle on the sidebar's right
edge, and a dark-theme switch at the bottom of the sidebar (kept in sync with
the existing Setup-screen toggle).

## Behavior

### Collapse / expand
- A `sidebar-collapsed` class on `<html>` drives all collapsed styling via CSS.
  - **Expanded:** sidebar width `232px` (current).
  - **Collapsed:** width ≈ `64px`, icons only.
- When collapsed: the brand name, nav link text labels, and the "Dark theme"
  label are hidden; icons, the Settings icon, and the theme toggle remain,
  centered in the rail.
- **Animation:** `width` transitions (~0.22s ease) on `.sidebar`; `main`
  reflows automatically as a flex sibling. Text labels fade via `opacity`.
- **No-flash on load:** the saved collapsed state is applied in the existing
  pre-paint `<head>` script (same pattern already used for the theme), so the
  initial render matches the saved state without animating.
- **Persistence:** stored in `localStorage` under `dpchecklist.sidebar`
  (`'collapsed'` / `'expanded'`), remembered across reloads.

### Toggle handle
- A rounded-rectangle button, vertically centered on the sidebar's right edge,
  flush with the divider (half-overlapping the border so it reads as part of
  the rail).
- Contains a chevron that points left (`‹`, "close") when expanded and right
  (`›`, "open") when collapsed — implemented as a CSS `rotate` transition on a
  single chevron icon.
- Styled to match the carousel nav buttons: surface background, subtle border
  and shadow, accent-tinted hover.
- `aria-label` reflects the action ("Collapse sidebar" / "Expand sidebar");
  `aria-expanded` reflects state.

### Dark-theme switch (bottom of sidebar)
- New row in `.side-foot`, above Settings: a moon icon, a "Dark theme" label,
  and the existing `.switch` toggle component (checkbox id `toggle-dark-side`).
- Kept in sync with the existing Setup-screen toggle (`toggle-dark`):
  `wireThemeToggle` initialises both checkboxes from `data-theme`, and a change
  to either updates `data-theme`, persists, and updates the other checkbox.
- Collapsed: the label hides; the toggle (and/or moon icon) stays centered.

## Scope (out)

- No user profile block, project color-dot list, message badges, or sign-out
  row — the app has no backing data for them.

## Files

- **`index.html`** — head bootstrap for saved collapse state; the handle
  button inside `.sidebar`; the dark-theme row in `.side-foot`.
- **`src/app.js`** — `wireSidebarToggle()` (toggle class, persist, update
  aria); extend `wireThemeToggle()` to keep both checkboxes in sync.
- **`styles.css`** — collapsed-state rules, the handle, and transitions.
