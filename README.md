# Smart Checklist

A self-contained, offline tool that turns a compliance checklist (maintained in Excel)
into a **smart, dynamic checklist**. For each project you enter a few inputs; only the
checklist items whose conditions are met are shown. Track multiple project drafts with
progress bars and export the outstanding items to Excel.

Everything runs in your browser. **Your checklist data is never uploaded** — the Excel
file is parsed locally.

## Using it

**Just open <https://valentiusw.github.io/Checklist_Tool/>.** Nothing to install, and
everyone is always on the current version. Your projects are saved in your own browser
and are never uploaded.

You can install it as a desktop app if you like: in Edge or Chrome, open the ⋯ menu →
**Apps** → **Install this site as an app**. It then opens in its own window with its own
icon.

On first use you'll be asked to load the checklist workbook (`.xlsx`) — ask the tool's
maintainer for the current one. It's remembered in your browser afterwards, so it's a
one-time step.

## Running it locally (development)

**Double-click `start.cmd`.** It launches a local web server for this folder and opens
the tool in your browser. To stop it, close the "Smart Checklist server" window.

> Note: you can't just open `index.html` directly (`file://`) — browsers block the
> tool's ES-module imports over `file://`, so a local server is required.

**Manual alternative** — run a static server yourself:

```bash
# from this folder
python -m http.server 8000
```

Then open <http://localhost:8000/> in your browser. (Any static server works; the Python
one ships with Windows' Python install.)

## First use

1. Go to **Setup** and load your checklist workbook — a single `.xlsx`.
   `SampleChecklist.xlsx` is included here to try it out.
2. Go to **Dashboard**, click **New project**, give it a name. You can also record an
   optional **project number** — it appears under the name on the project card and the
   dashboard search box matches it as well as the name, so typing part of a number finds
   the project. The number never appears in export file names.
3. Fill in the project **inputs** on the left — the checklist items filter live.
4. Tick items off and add per-item comments. The progress bar updates as you go.
5. **Download Workbook** produces a `.xlsx` of everything still outstanding — one
   worksheet per unit, columns Item ID, Description, Code, Comments, Example. Where an
   item has an example link, the Example cell is a **hyperlink** that opens the file in
   your browser. The workbook is named `<Project Name>_DPVT_Out`, or
   `<Project Name>_DPVT_All` when you pick **All Items** from the dropdown.
6. **Save project file** downloads the project as `.json` (back it up or move it to
   another machine); **Import project** loads it back.

Projects also autosave in the browser, so they're waiting for you on the Dashboard next
time.

### Units

A project can hold several **units** (e.g. individual lifts or apartments) that share the
same checklist but track their own inputs, ticks, and comments. Use the **Unit** dropdown
on the project screen to switch units, and **Add unit** / **Rename** / **Delete unit** to
manage them (a project always keeps at least one). The progress label shows both the
current unit and the project-wide total, and the Dashboard card shows the unit count plus
aggregate progress. **Download Workbook** then produces one worksheet per unit.

### Sections & About

If your workbook includes a `Sections` sheet, the checklist is grouped under section
headings and the **Section** dropdown filters to a single section. The **About** page (top
bar) lists the workbook's sections and glossary for quick reference.

### Backups & durability

Your projects are stored in your browser. To make them durable, open **Settings**
and use **Auto-save to a file** (Edge/Chrome): pick a backup file — ideally inside
a synced folder like OneDrive — and the app writes your work to it automatically.
After a browser-data wipe or on a new machine, **Settings → Open existing backup…**
restores everything (re-import your checklist workbook to bring back the example links).
In browsers without this feature, use the manual **Save project library** /
**Restore library** buttons.

## Workbook format

Your `.xlsx` must contain two sheets, named exactly **`Checklist`** and **`Inputs`**.

### Sheet `Checklist`

| Item ID | Conditions | Description | Code | Note | Example | Link | HyperLink |
|---------|------------|-------------|------|------|---------|------|-----------|

- **Conditions** — leave blank for items that always apply. Otherwise reference your
  inputs (see grammar below).
- **Example** — the label shown for the item's supporting file, usually its file name
  (e.g. `ShaftVentilation.png`), or a paragraph of explanatory text.
- **Link** — the example's URL (Dropbox, SharePoint, anywhere reachable). Optional: an
  Example with no Link shows as plain text. Only absolute `http://` / `https://` values
  are used; anything else is ignored.
- **HyperLink** — optional, and never read by the tool. Keep a
  `=HYPERLINK(Link, Example)` formula here if you like a clickable cell while editing the
  spreadsheet; the tool takes its URL from **Link**.

In the export, an Example with a Link becomes a **clickable hyperlink** in the Example
cell, so any format (PNG, JPG, SVG, PDF, …) works.

### Sheet `Inputs`

| Name | Type | Label | Unit | Choices | Default |
|------|------|-------|------|---------|---------|

- **Type** — one of `Choice`, `Float`, `Integer`, `Boolean`.
- **Choices** — for `Choice` only: options separated by semicolons, e.g.
  `Class 2;Class 3;Class 9b`. (Because `;` is the separator, a choice label itself
  cannot contain a semicolon.)
- **Unit** — optional, shown beside numeric fields (e.g. `m`).
- **Default** — optional starting value. For `Choice`, if the default isn't one of the
  listed choices, the first choice is used.

### Sheet `Sections` (optional)

| Prefix | Name |
|--------|------|

Maps the **leading letters of each Item ID** to a section name (`A` → `Architectural`).
Items are grouped and filterable by section. If this sheet is absent, the bare prefix
letter is used as the section name.

### Sheet `Glossary` (optional)

| Term | Meaning |
|------|---------|

Powers the **About** page — a reference list of the codes/acronyms used in your checklist.

## Condition grammar

Conditions reference input names and support `AND`, `OR`, and parentheses
(`AND` binds tighter than `OR`):

```
PitToEarth: FALSE
MaxFFLInt: >11m
PitToEarth: FALSE AND MaxFFLInt: >11
BuildingClass: "Class 9b" OR MaxFFLInt: >=20
(PitToEarth: FALSE AND MaxFFLInt: >11) OR BuildingClass: "Class 2"
```

- Operators: `:` / `=` (equality), `!=`, `>`, `<`, `>=`, `<=`. After a `:` an operator
  may lead the value (`MaxFFLInt: >11`).
- Booleans are `TRUE` / `FALSE`. Quote Choice values that contain spaces
  (`"Class 9b"`).
- A trailing unit on a number is ignored — `>11m` compares against `11`.
- An item whose condition references an unknown input, or that fails to parse, produces a
  clear error when the workbook is loaded.

## Development

Pure logic (condition engine, workbook model, project store, export helpers) lives in
`src/*.js` as dependency-free ES modules and is unit-tested with Node's built-in runner:

```bash
npm test        # runs node --test
```

The browser glue is `src/app.js`; `index.html` loads the vendored spreadsheet
engine (`vendor/xlsx.bundle.js` — xlsx-js-style, a SheetJS fork that can write
cell styles such as the bold header and blue hyperlinked Example cells), then
`app.js`.

Design and implementation notes are under `docs/superpowers/`.
