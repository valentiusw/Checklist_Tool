import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenize, parseCondition, ConditionError } from '../src/conditionEngine.js';

test('tokenizes a simple boolean equality', () => {
  assert.deepEqual(tokenize('PitToEarth: FALSE'), [
    { type: 'CMP', name: 'PitToEarth', op: 'eq', value: false },
  ]);
});

test('tokenizes colon separator with leading operator and unit', () => {
  assert.deepEqual(tokenize('MaxFFLInt: >11m'), [
    { type: 'CMP', name: 'MaxFFLInt', op: 'gt', value: '11m' },
  ]);
});

test('tokenizes >= and quoted choice value', () => {
  assert.deepEqual(tokenize('BuildingClass: "Class 9b"'), [
    { type: 'CMP', name: 'BuildingClass', op: 'eq', value: 'Class 9b' },
  ]);
  assert.deepEqual(tokenize('MaxFFLInt >= 11'), [
    { type: 'CMP', name: 'MaxFFLInt', op: 'ge', value: '11' },
  ]);
});

test('tokenizes AND, OR and parens', () => {
  const toks = tokenize('(PitToEarth: FALSE AND MaxFFLInt: >11) OR BuildingClass: "Class 2"');
  assert.deepEqual(toks.map(t => t.type), ['LPAREN','CMP','AND','CMP','RPAREN','OR','CMP']);
});

test('parseCondition builds AND tighter than OR', () => {
  const ast = parseCondition('A: 1 OR B: 2 AND C: 3');
  // Expect: A OR (B AND C)
  assert.equal(ast.type, 'or');
  assert.equal(ast.left.name, 'A');
  assert.equal(ast.right.type, 'and');
});

test('parseCondition respects parentheses', () => {
  const ast = parseCondition('(A: 1 OR B: 2) AND C: 3');
  assert.equal(ast.type, 'and');
  assert.equal(ast.left.type, 'or');
  assert.equal(ast.right.name, 'C');
});

test('unparseable input throws ConditionError', () => {
  assert.throws(() => parseCondition('A: 1 AND AND'), ConditionError);
  assert.throws(() => tokenize('%%%'), ConditionError);
});
