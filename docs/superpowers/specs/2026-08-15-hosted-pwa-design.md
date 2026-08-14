# Hosted Installable App — Design

**Date:** 2026-08-15
**Status:** Design approved; implementation plan not yet written

## Problem

Smart Checklist reaches colleagues as a ZIP. They unzip it, double-click `start.cmd`,
and it launches `serve.py` — **which requires Python installed**. Every copy is also a
fork: the committed `SmartChecklist_12-08-2026.zip` still contains `src/exampleStore.js`,
a module deleted on 2026-08-14, so anyone running it is a whole feature behind with no
way to know.

**Goal:** colleagues open a link and use the current version, with no runtime to install.

## The reframe that shaped this design

A PWA does not solve sharing — **hosting does**. A service worker only registers over
HTTPS (or localhost), so a PWA must be served from a URL in the first place. Once that
URL exists, sharing already works; the PWA layer adds installability and offline caching
on top of it.

So the decision that unlocks this is *where it is hosted*. The PWA parts are optional
polish, and this design deliberately takes only the cheap half of them.

## Decisions

| Question | Decision |
|---|---|
| Host | GitHub Pages, "deploy from branch" (no Actions — there is no build step) |
| URL | `https://valentiusw.github.io/Checklist_Tool/` |
| Repo visibility | **Public.** Free Pages requires it; the user accepted this explicitly |
| The real checklist | **Never published.** `Checklist_14.08.26.xlsx` stays gitignored; colleagues receive it internally |
| Scope | Web manifest + icons. **No service worker** |
| Project data | Unchanged — per-browser IndexedDB, private to each colleague |

### Why no service worker

`serve.py` exists in this repo specifically to send no-cache headers so users never see a
stale version. A service worker is a cache; done carelessly it re-introduces exactly that
problem, and a service-worker cache is far harder for a non-technical colleague to clear
than a browser refresh. The offline benefit is also smaller than it first appears: the
parsed checklist model already persists in IndexedDB (`src/app.js:144`), and example
links now point at Dropbox, so they need a connection regardless. Offline would buy the
app shell only — not the examples.

If offline genuinely matters later (site work with no signal), it is an additive change,
and it should come with a deliberate update strategy rather than being bolted on.

## Non-goals

Stated explicitly so they do not creep in:

- No offline app shell, and no service worker of any kind unless the installability
  caveat below forces a minimal one.
- No shared project data between colleagues. That needs a backend and is a different,
  much larger project.
- No bundling the real checklist workbook into the site.
- No change to application logic. The app itself is untouched.

## Architecture

**Deployment.** GitHub Pages serving a branch at the repository root. No build step, no
Actions workflow, no bundler — consistent with the repo's static-app discipline.

**Base path.** The site is served from the `/Checklist_Tool/` subpath. This works with no
changes: every asset reference in `index.html` is already relative. Verified — `grep` for
`src="/…"` / `href="/…"` returns nothing. The manifest must follow the same rule, using
relative `start_url` and `scope`.

**`manifest.json`** (new, repo root):

- `name` / `short_name` — the app's display name
- `start_url: "./"` and `scope: "./"` — relative, so the subpath resolves correctly
- `display: "standalone"` — opens without browser chrome
- `theme_color` / `background_color` — taken from the existing CSS custom properties, not
  hardcoded, so they stay consistent with the app's tokens
- `icons` — 192px and 512px PNGs, plus a `maskable` variant so Android does not letterbox

**`index.html`** — one added line: `<link rel="manifest" href="manifest.json">`.

**Icons** — generated from the existing `logo.svg`.

That is the entire code change.

## Installability caveat

This is a known unknown, recorded rather than guessed at.

A manifest alone is enough for **menu-based installation** (⋯ → Apps → Install this site
as an app) in Edge and Chrome on desktop, which yields the correct name, icon, and a
standalone window.

The **automatic install prompt** in the address bar (`beforeinstallprompt`) has
historically also required a service worker with a fetch handler, and Chrome has moved
that requirement across versions. So colleagues may need to install from the menu rather
than a one-click button.

If the prompt is wanted, the escape hatch is a **pass-through service worker** — a fetch
handler that does nothing but `fetch(event.request)`, caching nothing. That satisfies the
letter of the requirement without introducing any staleness risk.

**Do not assume either way.** Verify actual behaviour in Edge during implementation and
decide then; the design is correct under both outcomes.

## Prerequisite (blocking)

**The work must be merged to `main` and pushed before anything can be published.**

GitHub Pages serves a branch, and the gap is larger than it first appears:

| From | To | Commits |
|---|---|---|
| `origin/main` (`bfea1b5`) | local `main` (`daed6fb`) | **38** never pushed |
| local `main` | `feat/example-hyperlinks` | **17** (this plan's 13 + 4 from the stacked project-number branch) |
| `origin/main` | `feat/example-hyperlinks` | **55 total** |

So publishing is not "push the new feature" — it is pushing 55 commits of history, 38 of
which have never left this machine, to a repository that is about to be public.

**History review before the first push.** What was verified: no real checklist workbook
appears anywhere in history. The only data files ever committed are `SampleChecklist.xlsx`,
`ExampleChecklist.xlsx`, two sample PNGs under `examples/`, and the `SmartChecklist*.zip`
distributables — and the current committed ZIP was opened and confirmed to hold code only,
no workbooks or media. What was **not** exhaustively checked: the contents of the two
older ZIPs (`SmartChecklist.zip`, `SmartChecklist_13-07-2026.zip`) still reachable in
history. They are almost certainly code-only builds of the same app, but "almost certainly"
is worth converting to "checked" before a one-way publish.

Publishing therefore requires a merge-and-push decision the user has so far deferred. It
is a prerequisite of this design, not part of it.

## Colleague flow

1. Open the link.
2. On first use, pick the checklist `.xlsx` sent to them internally.
3. That model persists in IndexedDB, so it is a one-time step, not per session.
4. Optionally install the app for a desktop icon.

Each colleague's projects are private to their own browser. Nothing is shared, and
nothing is uploaded.

## Housekeeping in scope

- **Delete `SmartChecklist_12-08-2026.zip` from the repo.** It is stale, it contains a
  module that no longer exists, and once there is a URL a downloadable ZIP is a
  liability — it is precisely how colleagues end up on old versions.
- **`README.md`** — lead with the hosted URL as the primary way to use the tool; keep
  `start.cmd` documented below it for local development.
- **`CLAUDE.md`** — record the deployment target and the no-service-worker decision with
  its reasoning, so a future agent does not "helpfully" add one.

## Risks

- **Dropbox example links may be unreachable by colleagues.** If they are personal share
  links, every example fails for everyone except the owner — which would make the feature
  built on 2026-08-14 inert for exactly the audience this hosting effort is aimed at.
  **Test one link from another account before rollout.** This is the highest-value check
  in the whole effort and it costs a minute.
- **Public repo exposes the Schindler branding and sample glossary text.** Accepted by the
  user; the real compliance content stays out via `.gitignore`.
- **Publishing history is one-way.** Making the repo public exposes all 55 commits, not
  just the current tree — a file deleted in a later commit is still readable in history.
  The verification above found nothing sensitive, but the two older distributable ZIPs
  should be opened before the push to close that gap.
- **No access control.** Anyone with the URL can load the tool — though it is useless to
  them without a checklist workbook, and it carries no data.
- **Unchanged:** the connected-backup feature remains Edge/Chrome only (File System
  Access API).

## Testing

- Serve the site from a subdirectory locally to prove the relative paths survive the
  `/Checklist_Tool/` base path before deploying.
- Edge DevTools → Application → Manifest: confirm name, icons, and read the installability
  report — this is what settles the caveat above.
- Install in Edge; confirm the desktop icon and a standalone window.
- On the hosted URL: load the real workbook, create a project, tick items, export both
  modes, and confirm behaviour matches local exactly.
- Confirm `Checklist_14.08.26.xlsx` is absent from the published site.

## Deferred

Shared project data between colleagues — genuinely useful, but it needs a backend and a
data-policy conversation. Out of scope here; the file-based backup and JSON project
export already cover hand-off between machines.
