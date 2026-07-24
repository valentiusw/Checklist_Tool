// Pure, DOM-free helpers for building and validating a project draft, and for
// formatting input values. Importable from Node tests (no DOM dependency).
import { newId, newUnit, emptyDetails } from './projectStore.js';

export function defaultInputValue(def) {
  if (def.type === 'Boolean') return /^true$/i.test(String(def.default));
  if (def.type === 'Float' || def.type === 'Integer') return def.default === '' ? 0 : Number(def.default);
  if (def.type === 'Choice') return def.choices.includes(def.default) ? def.default : (def.choices[0] ?? '');
  return def.default;
}

export function defaultInputs(model) {
  const inputs = {};
  for (const def of model.inputs) inputs[def.name] = defaultInputValue(def);
  return inputs;
}

// Display string for the checklist's read-only inputs summary.
export function formatInputValue(def, value) {
  if (def.type === 'Boolean') return (value === true || /^true$/i.test(String(value))) ? 'Yes' : 'No';
  if (value === undefined || value === null || value === '') return '—';
  return String(value);
}

export function validateDraft(draft) {
  const errors = [];
  if (!draft.name || !String(draft.name).trim()) {
    errors.push({ field: 'name', message: 'Project name is required' });
  }
  if (!Array.isArray(draft.units) || draft.units.length === 0) {
    errors.push({ field: 'units', message: 'A project needs at least one unit' });
  }
  (draft.units || []).forEach((u, index) => {
    if (!u.name || !String(u.name).trim()) {
      errors.push({ field: 'unit', index, message: 'Unit name is required' });
    }
  });
  return { ok: errors.length === 0, errors };
}

export function newDraftUnit(model, name) {
  const unit = newUnit(name);
  unit.inputs = defaultInputs(model);
  return unit;
}

export function newBlankDraft(model) {
  return { id: newId('p'), name: '', details: emptyDetails(), units: [newDraftUnit(model, 'Unit 1')] };
}
