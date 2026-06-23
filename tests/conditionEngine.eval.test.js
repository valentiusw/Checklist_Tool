import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCondition, evaluate, isApplicable, ConditionError } from '../src/conditionEngine.js';

const defs = {
  PitToEarth: { type: 'Boolean' },
  MaxFFLInt: { type: 'Float' },
  BuildingClass: { type: 'Choice' },
};

test('boolean equality', () => {
  const ast = parseCondition('PitToEarth: FALSE');
  assert.equal(evaluate(ast, { PitToEarth: false }, defs), true);
  assert.equal(evaluate(ast, { PitToEarth: true }, defs), false);
});

test('numeric comparison ignores trailing unit', () => {
  const ast = parseCondition('MaxFFLInt: >11m');
  assert.equal(evaluate(ast, { MaxFFLInt: 12 }, defs), true);
  assert.equal(evaluate(ast, { MaxFFLInt: 11 }, defs), false);
});

test('choice equality and inequality', () => {
  assert.equal(evaluate(parseCondition('BuildingClass: "Class 9b"'), { BuildingClass: 'Class 9b' }, defs), true);
  assert.equal(evaluate(parseCondition('BuildingClass != "Class 2"'), { BuildingClass: 'Class 9b' }, defs), true);
});

test('AND / OR composition', () => {
  const ast = parseCondition('(PitToEarth: FALSE AND MaxFFLInt: >11) OR BuildingClass: "Class 2"');
  assert.equal(evaluate(ast, { PitToEarth: false, MaxFFLInt: 12, BuildingClass: 'Class 9b' }, defs), true);
  assert.equal(evaluate(ast, { PitToEarth: true, MaxFFLInt: 12, BuildingClass: 'Class 2' }, defs), true);
  assert.equal(evaluate(ast, { PitToEarth: true, MaxFFLInt: 12, BuildingClass: 'Class 9b' }, defs), false);
});

test('unknown input throws ConditionError', () => {
  const ast = parseCondition('Nope: 1');
  assert.throws(() => evaluate(ast, {}, defs), ConditionError);
});

test('isApplicable returns true for null ast', () => {
  assert.equal(isApplicable(null, {}, defs), true);
  assert.equal(isApplicable(parseCondition('PitToEarth: TRUE'), { PitToEarth: false }, defs), false);
});
