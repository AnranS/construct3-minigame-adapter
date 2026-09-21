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

// Construct starts its async RuntimeInterface initializer from the constructor
// without returning/awaiting it. Observe that exact call boundary; module-load
// success cannot tell us whether this later initialization succeeds.
export function observeConstructStartup(code) {
  const ast = parse(code, {ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true});
  const calls = [];
  const propertyName = node => {
    if (!node.computed && node.property?.type === 'PrivateIdentifier') return `private:${node.property.name}`;
    if (!node.computed && node.property?.type === 'Identifier') return `public:${node.property.name}`;
    if (node.computed && node.property?.type === 'Literal' && typeof node.property.value === 'string') return `public:${node.property.value}`;
    return null;
  };
  const children = (node, visit) => {
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(item => { if (item?.type) visit(item); });
      else if (value?.type) visit(value);
    }
  };
  const isObserverCall = node => node.type === 'CallExpression' &&
    node.callee.type === 'MemberExpression' && propertyName(node.callee) === 'public:run' &&
    node.callee.object.type === 'MemberExpression' && propertyName(node.callee.object) === 'public:__C3MiniGameStartup' &&
    node.callee.object.object.type === 'Identifier' && node.callee.object.object.name === 'self';

  function inspectClass(node) {
    const methods = new Map();
    for (const method of node.body.body) {
      if (method.static || method.type !== 'MethodDefinition' || method.kind === 'constructor') continue;
      const name = propertyName({computed: method.computed, property: method.key});
      if (name) methods.set(name, method.kind === 'method' && method.value.async && !method.value.generator);
    }
    const constructor = node.body.body.find(method => method.type === 'MethodDefinition' && method.kind === 'constructor');
    if (!constructor) return;
    function visitConstructor(node) {
      // Arrows keep the constructor's this (including deviceready callbacks).
      // Ordinary functions and nested classes own a different this binding.
      if (['FunctionExpression', 'FunctionDeclaration', 'ClassExpression', 'ClassDeclaration'].includes(node.type) || isObserverCall(node)) return;
      if (node.type === 'CallExpression' && !node.optional && node.callee.type === 'MemberExpression' &&
        !node.callee.optional && node.callee.object.type === 'ThisExpression' && methods.get(propertyName(node.callee))) calls.push(node);
      children(node, visitConstructor);
    }
    visitConstructor(constructor.value.body);
  }

  function visit(node) {
    if (node.type === 'AssignmentExpression' && node.operator === '=' && node.right.type === 'ClassExpression' &&
      node.left.type === 'MemberExpression' && node.left.object.type === 'Identifier' &&
      ['window', 'self', 'globalThis'].includes(node.left.object.name) && propertyName(node.left) === 'public:RuntimeInterface') inspectClass(node.right);
    children(node, visit);
  }
  visit(ast);
  // Insert around each call rather than replacing its source: nested arguments
  // can themselves be initializer calls and must retain their evaluation order.
  const changes = calls.flatMap(node => [
    {at: node.start, text: 'self.__C3MiniGameStartup.run("runtime-interface-init", () => '},
    {at: node.end, text: ')'}
  ]);
  for (const change of changes.sort((a, b) => b.at - a.at)) code = code.slice(0, change.at) + change.text + code.slice(change.at);
  return {code, count: calls.length};
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
