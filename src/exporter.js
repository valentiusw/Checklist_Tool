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

export function buildExportPlan(model, project, { mode = 'outstanding' } = {}) {
  const full = mode === 'full';
  const units = (project.units || []).map(unit => {
    const values = unit.inputs || {};
    const comments = unit.comments || {};
    const checks = unit.checks || {};
    const base = (item) => ({
      id: item.id,
      description: item.description,
      code: item.code,
      comment: comments[item.id] || '',
      example: item.example,
      exampleLink: item.exampleLink || '',
      section: item.section,
      sectionPrefix: item.sectionPrefix,
    });
    let rows;
    if (full) {
      // Every item, including S-prefixed, tagged with its per-unit status.
      rows = model.items.map(item => {
        const applicable = isApplicable(item.condition, values, model.inputDefs);
        const status = !applicable ? 'na' : (checks[item.id] === true ? 'done' : 'outstanding');
        return { ...base(item), status };
      });
    } else {
      // Applicable, unchecked, client-facing (non-S) items only.
      rows = applicableItems(model, values)
        .filter(item => checks[item.id] !== true)
        .filter(item => !/^s/i.test(item.id))
        .map(base);
    }
    return { name: unit.name, rows };
  });
  return { units };
}
