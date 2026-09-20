import { parse } from 'acorn';

// Only replace a syntactic object property; never perform textual code replacement.
export function disableMainWorker(code) {
  const ast = parse(code, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true });
  const replacements = [];
  function visit(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'Property' && !node.method && !node.computed &&
        (node.key.name === 'useWorker' || node.key.value === 'useWorker')) {
      if (node.shorthand) replacements.push({ start: node.start, end: node.end, text: 'useWorker: false' });
      else replacements.push({ start: node.value.start, end: node.value.end, text: 'false' });
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === 'start' || key === 'end') continue;
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object') visit(value);
    }
  }
  visit(ast);
  for (const change of replacements.sort((a, b) => b.start - a.start)) code = code.slice(0, change.start) + change.text + code.slice(change.end);
  return { code, count: replacements.length };
}

// Bind the known Construct storage adaptor to actual platform persistence.
// Only the explicit generated-library assignment is replaced, not user scripts.
export function adaptConstructStorage(code) {
  const marker = '../lib/storage/localForageAdaptor.js';
  if (!code.includes(marker)) return {code, count: 0};
  const comments = [];
  const ast = parse(code, {ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true, onComment: comments});
  // A matching string literal is not a generated module boundary.
  const markers = comments.filter(comment => comment.type === 'Line' && comment.value.trim() === marker);
  if (!markers.length) return {code, count: 0};
  if (markers.length !== 1) throw new Error('Unsupported Construct localForageAdaptor layout; native storage patch needs review');
  const start = markers[0].end;
  const next = comments.find(comment => comment.start > start && comment.type === 'Line' && comment.value.trim().startsWith('../'));
  const end = next?.start ?? code.length;
  const candidates = [];
  function visit(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'AssignmentExpression' && node.start >= start && node.end <= end && node.operator === '=' &&
      node.left.type === 'MemberExpression' && node.left.object.type === 'Identifier' && node.left.object.name === 'self' &&
      (node.left.computed ? node.left.property.value : node.left.property.name) === 'localforage') candidates.push(node);
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object') visit(value);
    }
  }
  visit(ast);
  const rhs = candidates[0]?.right;
  const inner = rhs?.arguments?.[0];
  if (candidates.length !== 1 || rhs?.type !== 'NewExpression' || rhs.callee.type !== 'Identifier' || rhs.arguments.length !== 1 ||
    inner?.type !== 'NewExpression' || inner.callee.type !== 'Identifier' || inner.arguments.length !== 1 || inner.arguments[0].value !== 'localforage') {
    throw new Error('Unsupported Construct localForageAdaptor layout; native storage patch needs review');
  }
  return {code: code.slice(0, rhs.start) + 'self.__C3MiniGameStorage' + code.slice(rhs.end), count: 1};
}
