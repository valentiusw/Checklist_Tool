import { isApplicable } from './conditionEngine.js';
import {
  isProjectScoped, projectItemApplicable, projectItemChecked, projectItemComment,
} from './itemScope.js';

export function applicableItems(model, values) {
  return model.items.filter(item => isApplicable(item.condition, values, model.inputDefs));
}

// A unit's progress covers only the unit's own items. Project-level items
// (Reports/Statements) belong to the project, so they are counted once by
// computeScopeProgress instead of once per lift.
export function computeProgress(model, unit) {
  const items = applicableItems(model, unit.inputs || {}).filter(item => !isProjectScoped(item));
  const applicable = items.length;
  const checked = items.filter(i => (unit.checks || {})[i.id] === true).length;
  const ratio = applicable === 0 ? 0 : checked / applicable;
  return { checked, applicable, ratio };
}

// Progress over the project-level items: each counted once, applicable when any
// unit matches its condition, ticked from the project's own map.
export function computeScopeProgress(model, project) {
  const items = model.items.filter(item =>
    isProjectScoped(item) && projectItemApplicable(model, project, item));
  const applicable = items.length;
  const checked = items.filter(item => projectItemChecked(project, item)).length;
  const ratio = applicable === 0 ? 0 : checked / applicable;
  return { checked, applicable, ratio };
}

// Everything outstanding anywhere: the units plus the project-level items, so
// this does not read 100% while a report is unticked.
export function computeProjectProgress(model, project) {
  let checked = 0;
  let applicable = 0;
  for (const unit of project.units || []) {
    const p = computeProgress(model, unit);
    checked += p.checked;
    applicable += p.applicable;
  }
  const scope = computeScopeProgress(model, project);
  checked += scope.checked;
  applicable += scope.applicable;
  const ratio = applicable === 0 ? 0 : checked / applicable;
  return { checked, applicable, ratio };
}

export function buildExportPlan(model, project, { mode = 'outstanding' } = {}) {
  const full = mode === 'full';
  const rowOf = (item, comment) => ({
    id: item.id,
    description: item.description,
    code: item.code,
    comment,
    example: item.example,
    exampleLink: item.exampleLink || '',
    section: item.section,
    sectionPrefix: item.sectionPrefix,
  });

  const units = (project.units || []).map(unit => {
    const values = unit.inputs || {};
    const comments = unit.comments || {};
    const checks = unit.checks || {};
    const own = (item) => !isProjectScoped(item);
    let rows;
    if (full) {
      // Every per-unit item, tagged with its status for this unit.
      rows = model.items.filter(own).map(item => {
        const applicable = isApplicable(item.condition, values, model.inputDefs);
        const status = !applicable ? 'na' : (checks[item.id] === true ? 'done' : 'outstanding');
        return { ...rowOf(item, comments[item.id] || ''), status };
      });
    } else {
      // Applicable, unchecked, client-facing (non-S) items only.
      rows = applicableItems(model, values)
        .filter(own)
        .filter(item => checks[item.id] !== true)
        .filter(item => !/^s/i.test(item.id))
        .map(item => rowOf(item, comments[item.id] || ''));
    }
    return { name: unit.name, rows };
  });

  // Project-level items: one row each for the whole project. The full export
  // lists them all (status na when no unit matches); the outstanding export
  // lists only the applicable, unticked, client-facing ones.
  const scoped = model.items.filter(isProjectScoped);
  const projectItems = full
    ? scoped.map(item => {
      const applicable = projectItemApplicable(model, project, item);
      const status = !applicable ? 'na' : (projectItemChecked(project, item) ? 'done' : 'outstanding');
      return { ...rowOf(item, projectItemComment(project, item)), status };
    })
    : scoped
      .filter(item => projectItemApplicable(model, project, item))
      .filter(item => !projectItemChecked(project, item))
      .filter(item => !/^s/i.test(item.id))
      .map(item => rowOf(item, projectItemComment(project, item)));

  return { units, projectItems };
}
