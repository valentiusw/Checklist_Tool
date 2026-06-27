/* global JSZip */
// Read/write the setup and export ZIP bundles. The setup ZIP holds the
// workbook (.xlsx) plus an Examples/ subfolder of PDFs/images. We tolerate the
// common case where the whole thing was zipped one level deep (e.g. Windows/
// macOS "compress this folder" yields MyFolder/Checklist.xlsx + MyFolder/
// Examples/...): the workbook may live anywhere outside an Examples/ folder,
// and Examples/ is matched at any depth.

function isJunk(path) {
  return /(^|\/)__MACOSX\//.test(path) || /(^|\/)\.DS_Store$/.test(path);
}

function isUnderExamples(path) {
  return /(^|\/)examples\//i.test(path);
}

export async function readSetupZip(arrayBuffer) {
  const zip = await JSZip.loadAsync(arrayBuffer);
  const entries = [];
  zip.forEach((path, entry) => { if (!entry.dir && !isJunk(path)) entries.push({ path, entry }); });

  const workbookEntries = [];
  const files = new Map();
  for (const { path, entry } of entries) {
    const name = path.split('/').pop();
    if (isUnderExamples(path)) {
      if (name) files.set(name, await entry.async('blob')); // key by bare filename
    } else if (/\.xlsx$/i.test(name)) {
      workbookEntries.push(entry);
    }
  }
  if (workbookEntries.length === 0) {
    throw new Error('ZIP has no .xlsx workbook (include your checklist workbook in the ZIP)');
  }
  if (workbookEntries.length > 1) {
    throw new Error('ZIP has more than one .xlsx workbook; it should contain exactly one');
  }
  const workbookArrayBuffer = await workbookEntries[0].async('arraybuffer');
  return { workbookArrayBuffer, files };
}

export async function buildExportZip({ workbookName, workbookArrayBuffer, files }) {
  const zip = new JSZip();
  zip.file(workbookName, workbookArrayBuffer);
  const examples = zip.folder('Examples');
  for (const [name, blob] of files) examples.file(name, blob);
  return zip.generateAsync({ type: 'blob', mimeType: 'application/zip' });
}
