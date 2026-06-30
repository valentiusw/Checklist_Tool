import { isApplicable } from './conditionEngine.js';

// Units of `project` whose inputs satisfy `item`'s condition (project order).
export function itemApplicableUnits(model, project, item) {
  return (project.units || []).filter(u =>
    isApplicable(item.condition, u.inputs || {}, model.inputDefs));
}

// Tri-state for the unified checkbox over an item's applicable units.
export function itemCheckState(item, applicableUnits) {
  const checked = applicableUnits.filter(u => (u.checks || {})[item.id] === true).length;
  if (checked === 0) return 'none';
  if (checked === applicableUnits.length) return 'all';
  return 'some';
}

// Model items applicable to at least one unit, in model order.
export function unifiedItems(model, project) {
  return model.items.filter(item => itemApplicableUnits(model, project, item).length > 0);
}
