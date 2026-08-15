# Deploying

The tool is a static site with no build step, published with GitHub Pages.

## One-time setup (in GitHub's web UI)

1. Push `main` to `origin`.
2. Repository → **Settings** → **General** → change visibility to **Public**.
   Free GitHub Pages requires it. (See the warning below first.)
3. Repository → **Settings** → **Pages**.
4. **Source:** "Deploy from a branch". **Branch:** `main`, folder `/ (root)`. Save.
5. Wait for the first deploy, then open <https://valentiusw.github.io/Checklist_Tool/>.

> **Making the repo public exposes the full commit history, not just the current files.**
> A file deleted in a later commit is still readable in history. This was audited before
> the first push: the real checklist workbook was never committed at any point, and the
> historical `SmartChecklist*.zip` distributables contain code only — no workbooks, no
> client data. Re-run that audit if anything unusual has been committed since:
>
> ```bash
> git log --all --diff-filter=A --pretty=format: --name-only | grep -i "Checklist_14"
> ```
>
> Expect no output.

## Publishing a change

Merge to `main` and push. Pages redeploys automatically, usually within a minute, and
everyone is on the new version the next time they load the page. There is no service
worker, so there is no cache to invalidate and nothing for users to clear.

## Before telling colleagues about it

- **Confirm a Dropbox example link opens for someone who is not you.** The Example
  hyperlinks point at Dropbox share URLs. If those are personal-account links, every
  example will fail for colleagues while working perfectly for you — and the examples are
  a large part of why the tool is useful to someone unfamiliar with the checklist.
- **Send them the current checklist `.xlsx` separately.** It is deliberately not in the
  repo. They load it once and their browser remembers it.

## What colleagues get, and what they don't

Each person's projects live in their own browser (IndexedDB), private to them. The hosted
site shares the *tool*, not the *data* — there is no server and nothing is uploaded.
Sharing a project between people still goes through **Save Project File** / **Upload
Project**, or the connected backup file.
