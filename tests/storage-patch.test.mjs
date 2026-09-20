import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {adaptConstructStorage} from '../src/build/patch.mjs';
import {createPlatformStorage} from '../src/runtime/storage.js';

const marker = '// ../lib/storage/localForageAdaptor.js';
const validSection = `${marker}\n{
  class NativeContainer { constructor(name) { throw new Error('Old IDB constructor must never run: ' + name); } }
  class LegacyAdaptor { constructor() { console.warn('Legacy in-memory fallback'); } }
  self['localforage'] = new LegacyAdaptor(new NativeContainer('localforage'));
}\n`;
function sectionOf(source) {
  const start = source.indexOf(marker);
  assert.notEqual(start, -1);
  const end = source.indexOf('\n// ../', start + marker.length);
  return source.slice(start, end < 0 ? source.length : end);
}

test('handwritten storage contract binds project consumers to isolated persistent native stores', async () => {
  const source = await fs.readFile(new URL('./fixtures/storage-binding-contract.js', import.meta.url), 'utf8');
  const result = adaptConstructStorage(source);
  assert.equal(result.count, 1);
  const originalSection = sectionOf(source); const patchedSection = sectionOf(result.code);
  const start = source.indexOf(originalSection);
  assert.equal(result.code.slice(0, start), source.slice(0, start));
  assert.equal(result.code.slice(start + patchedSection.length), source.slice(start + originalSection.length));

  const values = new Map();
  const api = {
    getStorageInfoSync: () => ({keys: [...values.keys()]}), getStorageSync: key => values.get(key),
    setStorageSync: (key, value) => values.set(key, value), removeStorageSync: key => values.delete(key)
  };
  const nativeStore = createPlatformStorage({api});
  const scope = {__C3MiniGameStorage: nativeStore};
  vm.runInNewContext(result.code, {self: scope});
  assert.deepEqual(Array.from(scope.contractTrace), ['backend:prelude', 'adaptor:prelude'],
    'the preceding assignment still executes, while the legacy storage constructors do not');
  assert.equal(scope.contractPrelude.name, 'prelude');
  assert.equal(scope.contractUnrelated.localforage, 'unrelated object member');
  assert.equal(scope.contractDescription, "self.localforage = new ContractAdaptor(new ContractBackend('localforage'))");
  assert.equal(scope.contractStore, nativeStore);
  await scope.contractProject.setItem('score', {level: 3, points: 77});
  await scope.contractOtherProject.setItem('score', 11);

  // Recreating the adapter proves the project reads host persistence rather
  // than a map retained by the first localforage-compatible instance.
  const reloadedStore = createPlatformStorage({api});
  assert.deepEqual(await reloadedStore.createInstance({name: 'contract-project'}).getItem('score'), {level: 3, points: 77});
  assert.equal(await reloadedStore.createInstance({name: 'other-project'}).getItem('score'), 11);
});

test('optional local Construct export patches exactly one native storage binding and preserves surrounding source', async t => {
  let source;
  try {
    source = await fs.readFile(new URL('../examples/construct/html5/scripts/c3runtime.js', import.meta.url), 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    t.skip('Real Construct runtime is not redistributed; supply the local HTML5 export for this additional integration check.');
    return;
  }
  const result = adaptConstructStorage(source);
  assert.equal(result.count, 1);
  const originalSection = sectionOf(source); const patchedSection = sectionOf(result.code);
  assert.equal((patchedSection.match(/self\.__C3MiniGameStorage/g) || []).length, 1);
  const originalStart = source.indexOf(originalSection);
  assert.equal(result.code.slice(0, originalStart), source.slice(0, originalStart));
  assert.equal(result.code.slice(originalStart + patchedSection.length), source.slice(originalStart + originalSection.length));
  const values = new Map();
  const api = {
    getStorageInfoSync: () => ({keys: [...values.keys()]}), getStorageSync: key => values.get(key),
    setStorageSync: (key, value) => values.set(key, value), removeStorageSync: key => values.delete(key)
  };
  const nativeStore = createPlatformStorage({api}); const warnings = [];
  const scope = {
    __C3MiniGameStorage: nativeStore,
    KVStorageContainer: class {constructor() { assert.fail('The old IndexedDB storage constructor must not execute'); }}
  };
  vm.runInNewContext(patchedSection, {self: scope, console: {warn: (...args) => warnings.push(args)}});
  assert.equal(scope.localforage, nativeStore);
  const project = scope.localforage.createInstance({name: 'c3-localstorage-test'});
  await project.setItem('score', 77);
  assert.equal(await scope.localforage.createInstance({name: 'c3-localstorage-test'}).getItem('score'), 77);
  assert.deepEqual(warnings, []);
});

test('generated patch reads the supplied scope store and never evaluates the old RHS', () => {
  const nativeStore = {sentinel: true}; const warnings = [];
  const result = adaptConstructStorage(validSection);
  const scope = {__C3MiniGameStorage: nativeStore};
  vm.runInNewContext(result.code, {self: scope, console: {warn: (...args) => warnings.push(args)}});
  assert.equal(scope.localforage, nativeStore); assert.deepEqual(warnings, []);
});

test('user scripts without the exact generated marker remain byte-for-byte unchanged', () => {
  for (const source of [
    `self.localforage = new UserStore(new Backend('localforage'));`,
    `// User's localForageAdaptor\nself.localforage = createCustomStore();`,
    `const documentation = ${JSON.stringify(marker)};\nself.localforage = new UserStore(new Backend('localforage'));`,
    `/* ../lib/storage/localForageAdaptor.js */\nself.localforage = createCustomStore();`
  ]) assert.deepEqual(adaptConstructStorage(source), {code: source, count: 0});
});

test('unexpected RHS shapes and duplicate bindings require explicit version review', () => {
  const rightSides = [
    'createCustomStore()', 'null', 'new Adaptor()', "new Adaptor(new Container('other-name'))",
    "new Adaptor(new Container('localforage'), true)", "new (chooseAdaptor())(new Container('localforage'))",
    "new Adaptor(new stores.Container('localforage'))"
  ];
  for (const rhs of rightSides) assert.throws(() => adaptConstructStorage(`${marker}\nself.localforage=${rhs};`), /layout.*review/);
  assert.throws(() => adaptConstructStorage(`${validSection}\nself.localforage = new A(new B('localforage'));`), /layout.*review/);
  assert.throws(() => adaptConstructStorage(`${validSection}\n${validSection}`), /layout.*review/);
});

test('another generated module boundary keeps its own localforage assignment untouched', () => {
  const later = "// ../project/user.js\nself.localforage = new UserStore(new Backend('localforage'));\n";
  const result = adaptConstructStorage(validSection + later);
  assert.equal(result.count, 1); assert.ok(result.code.endsWith(later));
});
