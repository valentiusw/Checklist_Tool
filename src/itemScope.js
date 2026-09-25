// Which checklist items belong to the project as a whole rather than to each
// unit, and the project-level tick/comment for one. Pure: no DOM, no storage.
//
// Scope is declared per section in the workbook (see workbookModel.js). The
// any-unit applicability rule already exists in checklistView.js, so it is
// imported rather than restated — one-way, no cycle (checklistView never imports
// this module).
import { itemApplicableUnits } from './checklistView.js';

export function isProjectScoped(item) {
  return !!item && item.scope === 'project';
}

// A project-level item applies when its condition holds for at least one unit: a
// statement one lift in the building needs is one the building needs.
export function projectItemApplicable(model, project, item) {
  return itemApplicableUnits(model, project, item).length > 0;
}

export function projectItemChecked(project, item) {
  return ((project && project.checks) || {})[item.id] === true;
}

export function projectItemComment(project, item) {
  return ((project && project.comments) || {})[item.id] || '';
}

// What to call the project-level items collectively: the project-scoped section
// names in model order, e.g. "Reports & Statements". Used for the export sheet's
// name, the export Overview's meter, and the in-app progress row, so the three
// always agree. Empty when the workbook declares no project-scoped section.
export function projectScopeLabel(model) {
  return ((model && model.sections) || [])
    .filter(s => s.scope === 'project')
    .map(s => s.name)
    .join(' & ');
}

// One-time fold of pre-scope data. A project-level item's tick and comment used
// to be stored on every unit. Ticks are dropped so a half-ticked report is
// re-confirmed rather than assumed done; the first non-empty comment moves up to
// the project so no typing is lost. The per-unit entries are deleted as we go,
// which is what makes a second pass a no-op.
//
// Mutates `project` (callers pass a store clone) and returns whether anything
// moved, so a caller can skip saving — and so loading the app does not bump
// every project's updatedAt.
export function migrateItemScope(model, project) {
  if (!model || !project) return false;
  let changed = false;
  if (!project.checks) { project.checks = {}; changed = true; }
  if (!project.comments) { project.comments = {}; changed = true; }
  for (const item of model.items) {
    if (!isProjectScoped(item)) continue;
    for (const unit of project.units || []) {
      if (unit.checks && item.id in unit.checks) {
        delete unit.checks[item.id];
        changed = true;
      }
      if (unit.comments && item.id in unit.comments) {
        const text = unit.comments[item.id];
        if (text && !project.comments[item.id]) project.comments[item.id] = text;
        delete unit.comments[item.id];
        changed = true;
      }
    }
  }
  return changed;
}
