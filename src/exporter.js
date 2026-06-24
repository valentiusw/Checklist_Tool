import { isApplicable } from './conditionEngine.js';

export function applicableItems(model, values) {
  return model.items.filter(item => isApplicable(item.condition, values, model.inputDefs));
}

export function computeProgress(model, unit) {
  const items = applicableItems(model, unit.inputs || {});
  const applicable = items.length;
  const checked = items.filter(i => (unit.checks || {})[i.id] === true).length;
  const ratio = applicable === 0 ? 0 : checked / applicable;
  return { checked, applicable, ratio };
}

export function computeProjectProgress(model, project) {
  let checked = 0;
  let applicable = 0;
  for (const unit of project.units || []) {
    const p = computeProgress(model, unit);
    checked += p.checked;
    applicable += p.applicable;
  }
  const ratio = applicable === 0 ? 0 : checked / applicable;
  return { checked, applicable, ratio };
}

export function buildExportRows(model, unit) {
  const header = ['Item ID', 'Description', 'Code', 'Comments', 'Example'];
  const checks = unit.checks || {};
  const comments = unit.comments || {};
  const rows = [header];
  for (const item of applicableItems(model, unit.inputs || {})) {
    if (checks[item.id] === true) continue;
    rows.push([item.id, item.description, item.code, comments[item.id] || '', item.example]);
  }
  return rows;
}
