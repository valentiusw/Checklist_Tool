# Example Hyperlinks — Design

**Date:** 2026-08-14
**Status:** Approved (awaiting implementation plan)

## Problem

Setup is currently a ZIP bundle: a `.xlsx` checklist plus an `Examples/` folder of PNGs
and PDFs. The bytes are unzipped into IndexedDB, shown in an in-app lightbox, and
re-emitted on export as an `Examples/` folder inside a ZIP, with relative
`Examples/<file>` hyperlinks from the workbook.

The user maintains the master checklist in Excel and now hosts the example files online
(Dropbox). Keeping a parallel folder of binaries in sync with the spreadsheet is manual
work that the hosted links make redundant.

**Goal:** setup input is a single `.xlsx`; examples are URLs; export is a single `.xlsx`.

## The new workbook

`Checklist_14.08.26.xlsx`, Checklist sheet header:

```
Item ID | Conditions | Description | Code | Note | Example | Link | HyperLink
```

- **Example** (F) — the display label. In practice always a file name
  (`ShaftVentilation.png`, `LuxStatement.pdf`).
- **Link** (G) — the target URL as plain text
  (`https://www.dropbox.com/scl/fi/…/ShaftVentilation.PNG?rlkey=…&dl=0`).
- **HyperLink** (H) — `=HYPERLINK(G6,F6)`. A human convenience for reading the
  spreadsheet. Its cached value is the label again, so it carries no target.

`Link` is the only column that holds the URL as data. 16 of the 45 items carry a `Link`
URL, but only 3 of those cells also carry a real Excel hyperlink object, so **the app
reads the `Link` cell's value**, not hyperlink metadata and not the formula.

That choice keeps `workbookModel.js` a pure rows-of-values function — `sheet_to_json(…,
{header: 1})` already yields column G as a string, so no XLSX-specific structure has to
be threaded through `sheetToRows` into the pure model.

### Rejected alternatives

- **Read `cell.l.Target`.** Present on only 3 of the 16 linked rows, and would force
  hyperlink metadata through the pure-model boundary.
- **Parse the `=HYPERLINK(G6,F6)` formula.** Needs formula resolution just to discover
  it points at column G — the chosen approach with extra steps.

## Data model (`workbookModel.js`)

`CHECKLIST_COLS` keeps `Example` **required** and adds `Link` as **optional**;
`HyperLink` is never read. An optional column is looked up by header name and yields
`''` when the column is absent — an old workbook without `Link` still loads.

`isExampleFile()` and the filename-sniffing split of the Example cell are deleted. Each
item carries two fields in place of today's `example` / `exampleFile` pair:

| field | value |
|---|---|
| `example` | the `Example` cell verbatim — the label (or prose, if prose is ever written there) |
| `exampleLink` | the `Link` cell, kept only if it starts with `http://` or `https://`; otherwise `''` |

Resulting behaviour:

- label **+** link → clickable example
- label, no link → plain text, no error
- neither → nothing

`exampleFile` disappears from the model, from `buildExportPlan`'s rows, and
`plan.referencedFiles` is deleted with it.

## Setup import (`app.js`, `db.js`)

`handleSetupFile` loses its `.zip` branch and reads the `.xlsx` `ArrayBuffer` directly.
The file input accepts `.xlsx` only. The status line drops the file count:

```
Loaded 45 items, 9 inputs.
```

Deleted: `src/zipBundle.js`, `src/exampleStore.js`, `tests/exampleStore.test.js`.

`db.js` bumps to **v3**: `examples` comes out of the `STORES` list, and
`onupgradeneeded` gains a `db.deleteObjectStore('examples')` guarded by
`objectStoreNames.contains`, so an existing v2 database sheds the blob store on first
open. The schema stays owned by `db.js` alone, per the existing convention.

The setup screen's copy (`index.html:112-115`) currently explains the ZIP layout. It
becomes a single line — upload your checklist workbook (`.xlsx`); nothing is uploaded,
everything stays in your browser — and the file input's
`accept=".zip,.xlsx,.xls"` narrows to `accept=".xlsx"`.

**Accepted consequence:** examples now require internet. The checklist data itself is
still parsed client-side and never leaves the machine; only clicking an example reaches
Dropbox. The user accepted this trade explicitly.

## In-app UI (`app.js`, `styles.css`)

- The circular ⓘ button on a checklist item renders when `item.exampleLink` is set;
  its `data-example` attribute carries the URL.
- `openExample(url)` becomes `window.open(url, '_blank', 'noopener')`.
- The RHS item editor's **See Example** button gates on `exampleLink` and opens the same
  tab.
- Items with a label but no link show no button. The label still appears in the exported
  sheet; dead in-app UI for it is not worth adding.

Deleted with the blob path: `showLightbox`, `IMAGE_EXT`, `CONTENT_TYPE_BY_EXT`,
`contentTypeFor`, and the `.lightbox` CSS block.

## Export (`app.js`, `exportWorkbook.js`, `index.html`)

`downloadProjectZip` becomes `downloadProjectWorkbook`: build the plan and workbook,
`XLSX.write(…, { bookType: 'xlsx', type: 'array', cellStyles: true })`, then
download the blob as `<base>.xlsx`. The blob-fetching loop over
`plan.referencedFiles` and the "these referenced files weren't in your library" alert
are removed.

The base name is unchanged: `<Project Title>_DPVT_Out` (outstanding) /
`<Project Title>_DPVT_All` (full), project title only — never the project number —
spaces kept, only filename-illegal characters stripped. It now names one `.xlsx`
instead of a ZIP, its folder, and a workbook.

Example cell, in both the outstanding writer and the full writer:

- **`exampleLink` set** → cell text is `item.example`, styled blue + underlined, with
  `{ link: { Target: exampleLink, Tooltip: 'Open ' + label } }`. If the label is empty,
  the URL itself is the cell text.
- **no link** → plain wrapped text (`item.example`), as today.

The `NOTES` and `NOTES_FULL` arrays each lose their two ZIP/`Examples/` folder lines,
replaced by one:

> Items with an entry in the Example column link to a supporting file online — click to
> open it in your browser.

With `zipBundle.js` gone, JSZip has no remaining caller: the
`<script src="vendor/jszip.min.js">` tag and `vendor/jszip.min.js` are removed.

The export controls stop saying ZIP. `#btn-download-zip` (id kept, label changed) reads
**Download Workbook**; the dashboard's `#dash-export` icon button's `title` and
`aria-label` become **Export Workbook**. Both stay Title Case, per the button-label
convention. The dropdown items (**All Items** / **Outstanding**) are unchanged.

## Migration & repo housekeeping

Saved projects store checks and comments keyed by item ID, so they are unaffected.
`rebuildModel` (which reconstructs a model from the serialized copy in IndexedDB or a
backup file) writes `Example` **and** `Link` columns; a model restored from an old
backup has labels but no links until the new workbook is re-imported. That is the
tolerant path by design, not a failure.

- `tools/build-sample-workbook.py` gains a `Link` column; `SampleChecklist.xlsx` is
  regenerated.
- Deleted: `tools/build-sample-setup-zip.mjs`, `SampleSetup.zip`, `examples/`.
- `README.md` — setup instructions and workbook reference updated for the single-file
  input, the `Link` column, and the single-file export.
- `CLAUDE.md` — the Export-rules convention and the architecture list rewritten to drop
  ZIP/Examples/IndexedDB-blobs and describe the URL contract.

## Testing

**`node --test` (pure logic):**

- `workbookModel` — a `Link` value becomes `exampleLink`; a workbook with no `Link`
  column loads with `exampleLink: ''`; a non-URL `Link` value is ignored; a label with
  no link stays plain; `Example` remains required.
- `exporter` — plan rows carry `example` and `exampleLink`; `referencedFiles` is gone;
  existing mode/status/S-item filtering is unchanged.
- `tests/exampleStore.test.js` deleted.

**Browser smoke test** (headless Edge over CDP, per the `browser-smoke-test-harness`
memory):

1. Import `Checklist_14.08.26.xlsx` — 45 items, 9 inputs, no file count in the status.
2. A ⓘ button appears on the 16 linked items and nowhere else; clicking one opens the
   Dropbox URL in a new tab.
3. Export both modes — a single `.xlsx` downloads with the expected base name.
4. Re-read the exported workbook and assert the Example cell's `.l.Target` is the real
   Dropbox URL and its text is the label.
