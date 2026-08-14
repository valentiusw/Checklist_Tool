# Hosted Installable App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Smart Checklist installable and ready to publish at `https://valentiusw.github.io/Checklist_Tool/`, so colleagues open a link instead of unzipping a folder and installing Python.

**Architecture:** Add a web manifest and PNG icons; add one `<link>` to `index.html`. The application code is untouched. There is deliberately **no service worker**. Icons are rasterized from the existing `logo.svg` using headless Edge — the same browser-automation approach the repo already uses for smoke tests — because no SVG rasterizer (`cairosvg`, `rsvg`) is installed and adding one would violate the no-new-dependencies rule.

**Tech Stack:** Static HTML/CSS/vanilla ES modules, no build step. Python 3.13 + Pillow (dev-only, for verifying generated icons). Headless Edge at `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`.

**Spec:** `docs/superpowers/specs/2026-08-15-hosted-pwa-design.md`

## Global Constraints

- **No framework, no bundler, no new runtime deps.** Pure browser, static app.
- **No service worker.** `serve.py` exists precisely to send no-cache headers so users never see a stale version; a service worker is a cache that reintroduces that problem in a form a colleague cannot clear with a refresh. Do not add one, even as an "improvement". The one exception is spelled out in Task 2, Step 6, and it is gated on an explicit decision.
- **Every asset path stays relative.** The site is served from the `/Checklist_Tool/` subpath. An absolute path (`/styles.css`, `/icons/...`) breaks it. This includes `start_url` and `scope` in the manifest.
- **The real checklist workbook is never committed.** `Checklist_14.08.26.xlsx` is gitignored. Never `git add -A`; stage explicitly-named paths.
- **Theme values come from the existing CSS tokens**, copied verbatim: `--bg: #f7f8fa`, `--accent: #5f7d35`.
- **Button labels are Title Case.** (No buttons change here, but README/doc copy naming them must match.)
- **Commit after every task. Never push. Never merge to `main`.**

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `icons/icon-192.png` | Create | 192px app icon, transparent background |
| `icons/icon-512.png` | Create | 512px app icon, transparent background |
| `icons/icon-maskable-512.png` | Create | 512px maskable icon — solid background, logo inside the safe zone |
| `manifest.json` | Create | Web app manifest: name, relative scope, display mode, theme, icons |
| `index.html` | Modify | One `<link rel="manifest">` and one `<meta name="theme-color">` |
| `README.md` | Modify | Lead with the hosted URL; keep local dev below it |
| `CLAUDE.md` | Modify | Record the deployment target and the no-service-worker decision |
| `SmartChecklist_12-08-2026.zip` | **Delete** | Stale distributable; undermines single-version hosting |
| `docs/DEPLOYING.md` | Create | The GitHub Pages runbook (settings the user performs) |

---

### Task 1: Generate the app icons

**Files:**
- Create: `icons/icon-192.png`, `icons/icon-512.png`, `icons/icon-maskable-512.png`

**Interfaces:**
- Consumes: the existing `logo.svg` at the repo root.
- Produces: three PNG files at those exact paths. Task 2's `manifest.json` references them by those names — do not rename them.

**Why this way:** `python -c "import cairosvg"` fails (not installed) and Pillow cannot rasterize SVG. Installing a rasterizer would breach the no-new-deps constraint. Headless Edge renders the SVG and screenshots it, using the browser already required for this repo's smoke tests.

- [ ] **Step 1: Create the render wrappers in a scratch directory**

These are throwaway files — put them in your session scratchpad, **not** in the repo. Replace `<SCRATCH>` with your scratch directory path and `<REPO>` with `C:/Users/valen/Desktop/CLAUDE_PROJECTS/DP_ChecklistTool`.

`<SCRATCH>/icon-plain.html` — transparent, logo fills the canvas:

```html
<!doctype html>
<meta charset="utf-8">
<style>
  html, body { margin: 0; padding: 0; background: transparent; }
  img { width: 100vw; height: 100vh; display: block; }
</style>
<img src="<REPO>/logo.svg" alt="">
```

`<SCRATCH>/icon-maskable.html` — solid background, logo at 60% so Android's mask cannot clip it:

```html
<!doctype html>
<meta charset="utf-8">
<style>
  html, body { margin: 0; padding: 0; height: 100%; background: #f7f8fa; }
  body { display: flex; align-items: center; justify-content: center; }
  img { width: 60vw; height: 60vw; display: block; }
</style>
<img src="<REPO>/logo.svg" alt="">
```

The maskable background is `#f7f8fa`, the `--bg` token from `styles.css` — copied verbatim, not invented.

- [ ] **Step 2: Render the three PNGs**

```bash
EDGE="/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
cd <REPO>
mkdir -p icons

"$EDGE" --headless=new --disable-gpu --default-background-color=00000000 \
  --window-size=512,512 --screenshot="icons/icon-512.png" "file:///<SCRATCH>/icon-plain.html"

"$EDGE" --headless=new --disable-gpu --default-background-color=00000000 \
  --window-size=192,192 --screenshot="icons/icon-192.png" "file:///<SCRATCH>/icon-plain.html"

"$EDGE" --headless=new --disable-gpu \
  --window-size=512,512 --screenshot="icons/icon-maskable-512.png" "file:///<SCRATCH>/icon-maskable.html"
```

`--default-background-color=00000000` is ARGB hex for fully transparent. If your Edge build rejects it, use `--default-background-color=0`. The maskable render deliberately omits the flag so it keeps its solid background.

- [ ] **Step 3: Verify the icons are real, correctly sized, and not blank**

A screenshot that silently rendered nothing is still a valid PNG file, so check the pixels, not just the dimensions:

```bash
cd <REPO>
python -c "
from PIL import Image
for path, size, alpha in [('icons/icon-192.png',192,True),
                          ('icons/icon-512.png',512,True),
                          ('icons/icon-maskable-512.png',512,False)]:
    im = Image.open(path).convert('RGBA')
    assert im.size == (size, size), f'{path}: got {im.size}, want {(size,size)}'
    colors = im.getcolors(maxcolors=1_000_000)
    assert colors and len(colors) > 1, f'{path}: image is a single flat colour — the SVG did not render'
    if alpha:
        assert min(px[3] for px in im.getdata()) == 0, f'{path}: expected some transparent pixels'
    print(f'{path}: {im.size}, {len(colors)} distinct colours — OK')
"
```

Expected: three `OK` lines. If a file is a single flat colour, the SVG failed to load — check that the `src` in the wrapper is an absolute `file:///` path to `logo.svg`.

- [ ] **Step 4: Commit**

```bash
git add icons/icon-192.png icons/icon-512.png icons/icon-maskable-512.png
git commit -m "feat: add app icons rendered from the logo"
```

---

### Task 2: Add the web manifest

**Files:**
- Create: `manifest.json`
- Modify: `index.html` (the `<head>` block, currently lines 4-15)

**Interfaces:**
- Consumes: the three icon paths produced by Task 1.
- Produces: a manifest served at `<site root>/manifest.json`. Task 4's verification reads it.

- [ ] **Step 1: Create `manifest.json`**

At the repo root:

```json
{
  "name": "Smart Checklist",
  "short_name": "Checklist",
  "description": "Turns a compliance checklist maintained in Excel into a dynamic per-project checklist.",
  "start_url": "./",
  "scope": "./",
  "display": "standalone",
  "background_color": "#f7f8fa",
  "theme_color": "#5f7d35",
  "icons": [
    { "src": "icons/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },
    { "src": "icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any" },
    { "src": "icons/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

`start_url` and `scope` are `"./"` — relative on purpose. Absolute values like `"/"` would point at `valentiusw.github.io` root and break the installed app.

- [ ] **Step 2: Link it from `index.html`**

In the `<head>`, immediately after the existing favicon line:

```html
  <link rel="icon" href="logo.svg" type="image/svg+xml" />
```

add:

```html
  <link rel="manifest" href="manifest.json" />
  <meta name="theme-color" content="#5f7d35" />
```

Leave everything else in the `<head>` alone — in particular the three inline `try/catch` blocks that apply the saved theme before first paint.

- [ ] **Step 3: Verify the manifest is valid JSON**

```bash
cd <REPO>
python -c "import json; m=json.load(open('manifest.json')); print('valid JSON,', len(m['icons']), 'icons'); assert m['start_url']=='./' and m['scope']=='./', 'start_url/scope must be relative'"
```

Expected: `valid JSON, 3 icons`.

- [ ] **Step 4: Verify it works under the deployment subpath**

This is the step that proves the GitHub Pages base path assumption. Serve the **parent** directory, so the repo folder name becomes a subpath — no copying required:

```bash
cd "C:/Users/valen/Desktop/CLAUDE_PROJECTS"
python -m http.server 8123
```

Then, in another shell:

```bash
curl -s -o /dev/null -w "index      %{http_code}\n" http://localhost:8123/DP_ChecklistTool/
curl -s -o /dev/null -w "manifest   %{http_code}\n" http://localhost:8123/DP_ChecklistTool/manifest.json
curl -s -o /dev/null -w "icon-192   %{http_code}\n" http://localhost:8123/DP_ChecklistTool/icons/icon-192.png
curl -s -o /dev/null -w "icon-512   %{http_code}\n" http://localhost:8123/DP_ChecklistTool/icons/icon-512.png
curl -s -o /dev/null -w "maskable   %{http_code}\n" http://localhost:8123/DP_ChecklistTool/icons/icon-maskable-512.png
curl -s -o /dev/null -w "app.js     %{http_code}\n" http://localhost:8123/DP_ChecklistTool/src/app.js
```

Expected: `200` on every line. Stop the server when done.

- [ ] **Step 5: Confirm the app itself still loads from the subpath**

Open `http://localhost:8123/DP_ChecklistTool/` in Edge. Expected: the Setup screen renders with styling, and the browser console shows no 404s or module errors. This confirms the relative-path assumption holds for the real app, not just for `curl`.

- [ ] **Step 6: Check installability, and STOP if it needs a service worker**

In Edge on that subpath URL: **F12 → Application → Manifest**. Confirm the name, the three icons, and read the installability report at the top of that panel.

- If it reports the app is installable, or the ⋯ → Apps → "Install this site as an app" entry produces a standalone window with the right icon: **done, proceed to Step 7.**
- If it reports a service worker is required for installability: **stop and report this to the controller.** Do not add a service worker on your own initiative — the global constraint forbids it, and the spec records a specific escape hatch (a pass-through worker that caches nothing) that is a human decision, not yours.

Record what the panel actually said in your report either way. This is the known unknown the spec flagged; the point of this step is to settle it with evidence.

- [ ] **Step 7: Commit**

```bash
git add manifest.json index.html
git commit -m "feat: add a web manifest so the tool can be installed"
```

---

### Task 3: Repo housekeeping for a hosted world

**Files:**
- Delete: `SmartChecklist_12-08-2026.zip`
- Modify: `README.md` (the "Running it" section, currently lines 10-30)
- Modify: `CLAUDE.md`

**Interfaces:** none — documentation and file removal only.

- [ ] **Step 1: Delete the stale distributable**

```bash
cd <REPO>
git rm SmartChecklist_12-08-2026.zip
```

It is three weeks stale and still contains `src/exampleStore.js`, a module deleted on 2026-08-14. Once a URL exists, a downloadable ZIP is how colleagues end up on old versions.

- [ ] **Step 2: Lead the README with the hosted URL**

Replace the `## Running it` section (from the `## Running it` heading down to, but not including, the `## First use` heading) with the following. Note this block is fenced with **four** backticks because the content itself contains a fenced block — write only the inner content to the file:

````markdown
## Using it

**Just open <https://valentiusw.github.io/Checklist_Tool/>.** Nothing to install. Your
projects are saved in your own browser and are never uploaded.

You can install it as a desktop app if you like: in Edge or Chrome, open the ⋯ menu →
**Apps** → **Install this site as an app**. It then opens in its own window with its own
icon.

On first use you'll be asked to load the checklist workbook (`.xlsx`) — ask the tool's
maintainer for the current one. It's remembered in your browser afterwards, so it's a
one-time step.

## Running it locally (development)

**Double-click `start.cmd`.** It launches a local web server for this folder and opens the
tool in your browser. To stop it, close the "Smart Checklist server" window.

> Note: you can't just open `index.html` directly (`file://`) — browsers block the tool's
> ES-module imports over `file://`, so a local server is required.

**Manual alternative** — run a static server yourself:

```bash
# from this folder
python -m http.server 8000
```

Then open <http://localhost:8000/> in your browser.
````

- [ ] **Step 3: Record the deployment decision in `CLAUDE.md`**

Add a new section immediately before `## Development workflow (this repo uses Superpowers SDD)`:

```markdown
## Deployment

Published via **GitHub Pages** ("deploy from branch", `main` at repo root) at
<https://valentiusw.github.io/Checklist_Tool/>. There is no build step, so no Actions
workflow is involved — Pages serves the repo as-is.

- **Every asset path must stay relative.** The site lives on the `/Checklist_Tool/`
  subpath; an absolute `/…` path breaks it. This includes `start_url` and `scope` in
  `manifest.json`, both of which are `"./"`.
- **There is deliberately no service worker.** `serve.py` exists to send no-cache headers
  so users never see a stale version; a service-worker cache reintroduces exactly that
  problem, and is far harder for a non-technical user to clear than a refresh. The offline
  win would be small anyway — the parsed model already persists in IndexedDB, and example
  links are remote URLs that need a connection regardless. Don't add one without a
  deliberate update strategy.
- The repo is public so Pages can serve it for free. The real checklist workbook is
  gitignored and must never be committed; colleagues receive it internally.
```

- [ ] **Step 4: Verify no stale instructions remain**

```bash
cd <REPO>
grep -n "unzip\|SmartChecklist_.*\.zip\|Easiest" README.md || echo "clean — no stale distribution instructions"
```

Expected: `clean`, or only matches you have deliberately kept.

- [ ] **Step 5: Commit**

```bash
git add README.md CLAUDE.md
git commit -m "docs: point users at the hosted app and drop the stale ZIP"
```

(`SmartChecklist_12-08-2026.zip` is already staged by the `git rm` in Step 1.)

---

### Task 4: Pre-publish audit and the deployment runbook

**Files:**
- Create: `docs/DEPLOYING.md`

**Interfaces:** none — this task produces an audit result and a runbook. It changes no application code.

**Why this task exists:** making the repo public exposes **all 55 commits**, not just the current tree. A file deleted in a later commit is still readable in history. The spec verified that no real checklist workbook was ever committed, but left one gap open: the contents of two older distributable ZIPs still reachable in history. Closing that gap is cheap; discovering it after a public push is not.

- [ ] **Step 1: Audit the historical distributables**

```bash
cd <REPO>
TMP="${TMPDIR:-/tmp}/zipaudit"; mkdir -p "$TMP"
for f in SmartChecklist.zip SmartChecklist_13-07-2026.zip; do
  sha=$(git rev-list --all --objects | awk -v f="$f" '$2==f{print $1; exit}')
  if [ -z "$sha" ]; then echo "$f: not found in history"; continue; fi
  git cat-file -p "$sha" > "$TMP/$f"
  python -c "
import zipfile, sys
z = zipfile.ZipFile(sys.argv[1])
bad = [n for n in z.namelist() if n.lower().endswith(('.xlsx','.xls','.pdf','.csv','.json'))]
print(sys.argv[2] + ':', bad if bad else 'code only — clean')
" "$TMP/$f" "$f"
done
```

Expected: `code only — clean` for both. `package.json` inside a build is fine and not a leak; a `.xlsx` is **not** — if one appears, stop and report it to the controller before anything is pushed, because history rewriting is a human decision.

- [ ] **Step 2: Confirm the real workbook is absent from all history**

```bash
cd <REPO>
git log --all --diff-filter=A --pretty=format: --name-only | grep -i "Checklist_14" && echo "!!! FOUND — STOP" || echo "clean — the real workbook was never committed"
```

Expected: `clean — the real workbook was never committed`.

- [ ] **Step 3: Write the deployment runbook**

Create `docs/DEPLOYING.md`:

```markdown
# Deploying

The tool is a static site with no build step, published with GitHub Pages.

## One-time setup (done in GitHub's web UI)

1. Push `main` to `origin`.
2. Repository → **Settings** → **Pages**.
3. **Source:** "Deploy from a branch". **Branch:** `main`, folder `/ (root)`. Save.
4. Wait for the first deploy, then open <https://valentiusw.github.io/Checklist_Tool/>.

Free GitHub Pages requires the repository to be **public**. Making it public exposes the
full commit history, not just the current files — see the pre-publish audit in
`docs/superpowers/plans/2026-08-15-hosted-pwa.md`.

## Publishing a change

Merge to `main` and push. Pages redeploys automatically, usually within a minute, and
everyone is on the new version the next time they load the page. There is no service
worker, so there is no cache to invalidate and nothing for users to clear.

## Before the first publish

- Confirm a Dropbox example link opens for **someone who is not you**. The Example
  hyperlinks point at Dropbox share URLs; if they are personal-account links, every
  example will fail for colleagues while working fine for you.
- Send colleagues the current checklist `.xlsx` separately. It is deliberately not part
  of the repo.
```

- [ ] **Step 4: Commit**

```bash
git add docs/DEPLOYING.md
git commit -m "docs: add the GitHub Pages deployment runbook"
```

- [ ] **Step 5: Report what only the user can do**

These are not yours to perform — report them as the remaining manual steps:

1. **Merge and push.** `origin/main` is 38 commits behind local `main`, and
   `feat/example-hyperlinks` is 17 beyond that — 55 commits total. Publishing needs the
   merge decision the user has deferred.
2. **Make the repo public** and enable Pages per `docs/DEPLOYING.md`.
3. **Test a Dropbox example link from another account.** Highest-value check in this
   effort: if those are personal share links, the example feature is inert for exactly the
   audience this hosting is meant to serve.

---

## Notes for the implementer

- **`Checklist_14.08.26.xlsx` and the two logo images are gitignored on purpose.** Never
  `git add -A`; stage named paths only.
- **Do not add a service worker** — see the global constraints. Task 2 Step 6 tells you
  what to do if installability appears to require one: stop and report.
- The application code (`src/`, `styles.css`) is not modified by this plan at all. If you
  find yourself editing it, something has gone wrong — stop and report.
- `npm test` should remain at **115 passing** throughout; nothing here touches tested code.
  Run it once before your final commit as a regression check.
