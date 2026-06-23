export class ConditionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConditionError';
  }
}

const OP_MAP = { '=': 'eq', ':': 'eq', '!=': 'ne', '>': 'gt', '<': 'lt', '>=': 'ge', '<=': 'le' };

function makeComparison(name, sep, rawValue) {
  let op = OP_MAP[sep];
  let value = rawValue;
  if (sep === ':') {
    const lead = /^(>=|<=|!=|>|<)\s*(.*)$/.exec(rawValue);
    if (lead) {
      op = OP_MAP[lead[1]];
      value = lead[2];
    } else {
      op = 'eq';
    }
  }
  // strip surrounding quotes
  const quoted = /^"([^"]*)"$|^'([^']*)'$/.exec(value);
  if (quoted) {
    value = quoted[1] !== undefined ? quoted[1] : quoted[2];
  } else if (/^(true|false)$/i.test(value)) {
    value = /^true$/i.test(value);
  }
  return { type: 'CMP', name, op, value };
}

export function tokenize(input) {
  const tokens = [];
  let i = 0;
  while (i < input.length) {
    const rest = input.slice(i);
    const ws = /^\s+/.exec(rest);
    if (ws) { i += ws[0].length; continue; }
    if (rest[0] === '(') { tokens.push({ type: 'LPAREN' }); i += 1; continue; }
    if (rest[0] === ')') { tokens.push({ type: 'RPAREN' }); i += 1; continue; }
    const mAnd = /^and\b/i.exec(rest);
    if (mAnd) { tokens.push({ type: 'AND' }); i += mAnd[0].length; continue; }
    const mOr = /^or\b/i.exec(rest);
    if (mOr) { tokens.push({ type: 'OR' }); i += mOr[0].length; continue; }
    const mCmp = /^([A-Za-z_][A-Za-z0-9_]*)\s*(>=|<=|!=|>|<|=|:)\s*("[^"]*"|'[^']*'|[^\s()]+)/.exec(rest);
    if (mCmp) {
      tokens.push(makeComparison(mCmp[1], mCmp[2], mCmp[3]));
      i += mCmp[0].length;
      continue;
    }
    throw new ConditionError(`Cannot parse condition near: "${rest}"`);
  }
  return tokens;
}

export function parseCondition(input) {
  const tokens = tokenize(input);
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];

  function parsePrimary() {
    const t = peek();
    if (!t) throw new ConditionError('Unexpected end of condition');
    if (t.type === 'LPAREN') {
      next();
      const expr = parseOr();
      if (!peek() || peek().type !== 'RPAREN') throw new ConditionError('Expected )');
      next();
      return expr;
    }
    if (t.type === 'CMP') { next(); return t; }
    throw new ConditionError(`Unexpected token: ${t.type}`);
  }

  function parseAnd() {
    let left = parsePrimary();
    while (peek() && peek().type === 'AND') {
      next();
      const right = parsePrimary();
      left = { type: 'and', left, right };
    }
    return left;
  }

  function parseOr() {
    let left = parseAnd();
    while (peek() && peek().type === 'OR') {
      next();
      const right = parseAnd();
      left = { type: 'or', left, right };
    }
    return left;
  }

  const ast = parseOr();
  if (pos !== tokens.length) throw new ConditionError('Unexpected trailing tokens');
  return ast;
}

function evalComparison(node, values, defs) {
  const def = defs[node.name];
  if (!def) throw new ConditionError(`Unknown input referenced in condition: ${node.name}`);
  const actual = values[node.name];
  if (def.type === 'Boolean') {
    const expected = typeof node.value === 'boolean' ? node.value : /^true$/i.test(String(node.value));
    const a = actual === true || /^true$/i.test(String(actual));
    return node.op === 'ne' ? a !== expected : a === expected;
  }
  if (def.type === 'Float' || def.type === 'Integer') {
    const expected = parseFloat(String(node.value));
    const a = parseFloat(String(actual));
    if (Number.isNaN(expected)) throw new ConditionError(`Non-numeric value for ${node.name}: ${node.value}`);
    if (Number.isNaN(a)) return false;
    switch (node.op) {
      case 'eq': return a === expected;
      case 'ne': return a !== expected;
      case 'gt': return a > expected;
      case 'lt': return a < expected;
      case 'ge': return a >= expected;
      case 'le': return a <= expected;
      default: throw new ConditionError(`Unsupported operator: ${node.op}`);
    }
  }
  // Choice
  const expected = String(node.value);
  const a = String(actual ?? '');
  if (node.op === 'eq') return a === expected;
  if (node.op === 'ne') return a !== expected;
  throw new ConditionError(`Operator ${node.op} is not valid for Choice input ${node.name}`);
}

export function evaluate(ast, values, defs) {
  if (ast.type === 'CMP') return evalComparison(ast, values, defs);
  if (ast.type === 'and') return evaluate(ast.left, values, defs) && evaluate(ast.right, values, defs);
  if (ast.type === 'or') return evaluate(ast.left, values, defs) || evaluate(ast.right, values, defs);
  throw new ConditionError(`Unknown node type: ${ast.type}`);
}

export function isApplicable(ast, values, defs) {
  if (ast === null || ast === undefined) return true;
  return evaluate(ast, values, defs);
}
