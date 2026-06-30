import { isApplicable } from './conditionEngine.js';

// Units of `project` whose inputs satisfy `item`'s condition (project order).
export function itemApplicableUnits(model, project, item) {
  return (project.units || []).filter(u =>
    isApplicable(item.condition, u.inputs || {}, model.inputDefs));
}
