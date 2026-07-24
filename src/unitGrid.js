// Pure, DOM-free helpers for the spreadsheet-style unit editor grid:
// typed-value coercion for typed/pasted cells, clipboard parsing, and paste
// spill. Importable from Node tests (no DOM dependency).

// Sentinel returned by coerceInputValue when a raw cell can't be interpreted —
// callers must leave the existing value untouched rather than clobber it.
export const UNCHANGED = Symbol('unchanged');

const TRUE_WORDS = new Set(['true', 'yes', 'y', '1', '✓', 'x', 'checked']);
const FALSE_WORDS = new Set(['false', 'no', 'n', '0', '']);

export function coerceInputValue(def, raw) {
  const s = String(raw ?? '').trim();
  if (def.type === 'Boolean') {
    const low = s.toLowerCase();
    if (TRUE_WORDS.has(low)) return true;
    if (FALSE_WORDS.has(low)) return false;
    return UNCHANGED;
  }
  if (def.type === 'Choice') {
    const match = def.choices.find((c) => c.toLowerCase() === s.toLowerCase());
    return match !== undefined ? match : UNCHANGED;
  }
  // Integer / Float
  if (s === '') return '';
  const n = Number(s);
  if (Number.isNaN(n)) return UNCHANGED;
  return def.type === 'Integer' ? Math.round(n) : n;
}

export function parseClipboardMatrix(text) {
  const norm = String(text ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = norm.split('\n');
  // Excel appends a trailing newline to a copied block — drop that lone empty
  // final line (but keep genuinely blank interior rows).
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return lines.map((line) => line.split('\t'));
}
