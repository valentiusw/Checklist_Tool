import { isApplicable } from './conditionEngine.js';

export function applicableItems(model, values) {
  return model.items.filter(item => isApplicable(item.condition, values, model.inputDefs));
}

export function computeProgress(model, project) {
  const items = applicableItems(model, project.inputs || {});
  const applicable = items.length;
  const checked = items.filter(i => (project.checks || {})[i.id] === true).length;
  const ratio = applicable === 0 ? 0 : checked / applicable;
  return { checked, applicable, ratio };
}

export function buildExportRows(model, project) {
  const header = ['Item ID', 'Description', 'Code', 'Comments', 'Example'];
  const checks = project.checks || {};
  const comments = project.comments || {};
  const rows = [header];
  for (const item of applicableItems(model, project.inputs || {})) {
    if (checks[item.id] === true) continue;
    rows.push([item.id, item.description, item.code, comments[item.id] || '', item.example]);
  }
  return rows;
}
