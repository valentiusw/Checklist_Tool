import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildModel } from '../src/workbookModel.js';
import { createProjectStore } from '../src/projectStore.js';
import {
  defaultInputValue, defaultInputs, formatInputValue,
  validateDraft, newBlankDraft, newDraftUnit,
} from '../src/projectDraft.js';

const inputRows = [
  ['Name', 'Type', 'Label', 'Unit', 'Choices', 'Default'],
  ['Pit', 'Boolean', 'Has pit', '', '', 'FALSE'],
  ['Load', 'Float', 'Load', 'kg', '', '1000'],
  ['Stops', 'Integer', 'Stops', '', '', '2'],
  ['Door', 'Choice', 'Door type', '', 'Centre;Side', 'Side'],
  ['Bad', 'Choice', 'Bad default', '', 'A;B', 'Z'],
];
const checklistRows = [
  ['Item ID', 'Conditions', 'Description', 'Code', 'Note', 'Example'],
  ['A01', '', 'Always', '', '', ''],
];
const model = buildModel({ checklistRows, inputRows });
const def = (name) => model.inputs.find(i => i.name === name);

test('defaultInputValue resolves per type', () => {
  assert.equal(defaultInputValue(def('Pit')), false);
  assert.equal(defaultInputValue(def('Load')), 1000);
  assert.equal(defaultInputValue(def('Stops')), 2);
  assert.equal(defaultInputValue(def('Door')), 'Side');
  assert.equal(defaultInputValue(def('Bad')), 'A'); // default not in choices -> first choice
});

test('defaultInputs builds a value for every model input', () => {
  const inputs = defaultInputs(model);
  assert.deepEqual(Object.keys(inputs).sort(), ['Bad', 'Door', 'Load', 'Pit', 'Stops']);
  assert.equal(inputs.Door, 'Side');
});

test('formatInputValue: Yes/No, dash for empty, passthrough otherwise', () => {
  assert.equal(formatInputValue(def('Pit'), true), 'Yes');
  assert.equal(formatInputValue(def('Pit'), false), 'No');
  assert.equal(formatInputValue(def('Load'), 0), '0');       // 0 is a real value, not empty
  assert.equal(formatInputValue(def('Load'), 1000), '1000');
  assert.equal(formatInputValue(def('Door'), 'Centre'), 'Centre');
  assert.equal(formatInputValue(def('Door'), ''), '—');
  assert.equal(formatInputValue(def('Door'), undefined), '—');
});

test('validateDraft flags missing project name and unit names', () => {
  assert.equal(validateDraft({ name: 'Tower', units: [{ name: 'U1' }] }).ok, true);
  assert.equal(validateDraft({ name: '  ', units: [{ name: 'U1' }] }).ok, false);
  assert.equal(validateDraft({ name: 'Tower', units: [] }).ok, false);
  const r = validateDraft({ name: 'Tower', units: [{ name: '' }] });
  assert.equal(r.ok, false);
  assert.equal(r.errors[0].field, 'unit');
  assert.equal(r.errors[0].index, 0);
});

test('newBlankDraft: empty name, one unit with default inputs', () => {
  const draft = newBlankDraft(model);
  assert.equal(draft.name, '');
  assert.equal(draft.units.length, 1);
  assert.ok(draft.id);
  assert.equal(draft.units[0].inputs.Door, 'Side');
  assert.deepEqual(draft.units[0].checks, {});
});

test('newDraftUnit: named unit with default inputs and empty checks/comments', () => {
  const u = newDraftUnit(model, 'Unit 2');
  assert.equal(u.name, 'Unit 2');
  assert.equal(u.inputs.Pit, false);
  assert.deepEqual(u.comments, {});
});

test('draft round-trips through projectStore: new creates, edit updates', () => {
  const store = createProjectStore();
  // New: save a blank draft -> creates a project at draft.id
  const draft = newBlankDraft(model);
  draft.name = 'Created via editor';
  store.saveProject(draft);
  assert.equal(store.getProject(draft.id).name, 'Created via editor');
  // Edit: fetch clone, mutate, save -> updates same id
  const edit = store.getProject(draft.id);
  edit.name = 'Renamed';
  edit.units.push(newDraftUnit(model, 'Unit 2'));
  store.saveProject(edit);
  const after = store.getProject(draft.id);
  assert.equal(after.name, 'Renamed');
  assert.equal(after.units.length, 2);
});

test('mutating a draft from getProject does not affect the store (cancel safety)', () => {
  const store = createProjectStore();
  const draft = newBlankDraft(model);
  draft.name = 'Saved';
  store.saveProject(draft);
  const editDraft = store.getProject(draft.id);
  editDraft.name = 'Discarded';            // simulate edits then Cancel (never saved)
  editDraft.units[0].inputs.Load = 9999;
  assert.equal(store.getProject(draft.id).name, 'Saved');
  assert.notEqual(store.getProject(draft.id).units[0].inputs.Load, 9999);
});
