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
