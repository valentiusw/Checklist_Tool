# Smart Checklist

A self-contained, offline tool that turns a compliance checklist (maintained in Excel)
into a **smart, dynamic checklist**. For each project you enter a few inputs; only the
checklist items whose conditions are met are shown. Track multiple project drafts with
progress bars and export the outstanding items to Excel.

Everything runs in your browser. **Your checklist data is never uploaded** — the Excel
file is parsed locally.

## Running it

**Easiest — double-click `start.cmd`.** It launches a local web server for this folder
and opens the tool in your browser. To stop it, close the "Smart Checklist server"
window.

> Note: you can't just open `index.html` directly (`file://`) — browsers block the
> tool's ES-module imports over `file://`, so a local server is required. No internet
> is needed; everything is served from this folder.

**Manual alternative** — run a static server yourself:

```bash
# from this folder
python -m http.server 8000
```

Then open <http://localhost:8000/> in your browser. (Any static server works; the Python
one ships with Windows' Python install.)

## First use

1. Go to **Setup** and load your checklist workbook (or `SampleChecklist.xlsx` included
   here to try it out).
2. Go to **Dashboard**, click **New project**, give it a name.
3. Fill in the project **inputs** on the left — the checklist items filter live.
4. Tick items off and add per-item comments. The progress bar updates as you go.
5. **Export unchecked to Excel** produces a spreadsheet of everything still outstanding.
6. **Save project file** downloads the project as `.json` (back it up or move it to
   another machine); **Import project** loads it back.

Projects also autosave in the browser, so they're waiting for you on the Dashboard next
time.

## Workbook format

Your `.xlsx` must contain two sheets, named exactly **`Checklist`** and **`Inputs`**.

### Sheet `Checklist`

| Item ID | Conditions | Description | Code | Note | Example |
|---------|------------|-------------|------|------|---------|

- **Conditions** — leave blank for items that always apply. Otherwise reference your
  inputs (see grammar below).
- **Example** — optional "how to complete this item" guidance, included in the export.

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

The browser glue is `src/app.js`; `index.html` loads the vendored SheetJS build
(`vendor/`) and then `app.js`.

Design and implementation notes are under `docs/superpowers/`.
