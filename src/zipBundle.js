/* global JSZip */
// Read/write the setup and export ZIP bundles. The setup ZIP holds the
// workbook (.xlsx) at its root and an Examples/ subfolder of PDFs/images; the
// export ZIP mirrors that shape.

function isJunk(path) {
  return /(^|\/)__MACOSX\//.test(path) || /(^|\/)\.DS_Store$/.test(path);
}

export async function readSetupZip(arrayBuffer) {
  const zip = await JSZip.loadAsync(arrayBuffer);
  const entries = [];
  zip.forEach((path, entry) => { if (!entry.dir && !isJunk(path)) entries.push({ path, entry }); });

  let workbookArrayBuffer = null;
  const files = new Map();
  for (const { path, entry } of entries) {
    const parts = path.split('/');
    const name = parts[parts.length - 1];
    if (parts.length === 1 && /\.xlsx$/i.test(name)) {
      if (workbookArrayBuffer) throw new Error('ZIP has more than one .xlsx at its root');
      workbookArrayBuffer = await entry.async('arraybuffer');
    } else if (/^examples\//i.test(path) && name) {
      files.set(name, await entry.async('blob'));
    }
  }
  if (!workbookArrayBuffer) throw new Error('ZIP has no .xlsx workbook at its root');
  return { workbookArrayBuffer, files };
}

export async function buildExportZip({ workbookName, workbookArrayBuffer, files }) {
  const zip = new JSZip();
  zip.file(workbookName, workbookArrayBuffer);
  const examples = zip.folder('Examples');
  for (const [name, blob] of files) examples.file(name, blob);
  return zip.generateAsync({ type: 'blob', mimeType: 'application/zip' });
}
