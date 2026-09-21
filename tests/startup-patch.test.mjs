import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {parse} from 'acorn';
import {observeConstructStartup} from '../src/build/patch.mjs';

function execute(source, bindings = {}) {
  const runs = [], failures = [];
  const scope = {__C3MiniGameStartup: {
    run(stage, invoke) {
      const record = {stage};
      runs.push(record);
      try {
        record.result = invoke();
        Promise.resolve(record.result).catch(error => failures.push(error));
        return record.result;
      } catch (error) { failures.push(error); throw error; }
    }
  }};
  const context = vm.createContext({self: scope, window: scope, globalThis: scope, ...bindings});
  vm.runInContext(source, context);
  return {scope, context, runs, failures};
}

test('minified private constructor initializer retains receiver, arguments and its original promise', async () => {
  const source = `window.RuntimeInterface=class s{constructor(e){this.calls=0;this.result=this.#a(e,++this.calls)}async #a(e,n){this.value=e;this.order=n;return 42}};self.instance=new window.RuntimeInterface("project");`;
  const result = observeConstructStartup(source);
  assert.equal(result.count, 1);
  const {scope, runs} = execute(result.code);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].stage, 'runtime-interface-init');
  assert.equal(scope.instance.result, runs[0].result);
  assert.equal(await scope.instance.result, 42);
  assert.equal(scope.instance.value, 'project');
  assert.equal(scope.instance.order, 1);
  assert.equal(scope.instance.calls, 1, 'arguments are evaluated once');
});

test('recognized global assignments and static string method names are supported without guessing names', async () => {
  for (const owner of ['window', 'self', 'globalThis']) {
    for (const property of ['.RuntimeInterface', '["RuntimeInterface"]']) {
      const source = `${owner}${property}=class{constructor(){this.result=this["start-export"](7)}async ["start-export"](x){return x}};self.instance=new ${owner}${property};`;
      const result = observeConstructStartup(source);
      assert.equal(result.count, 1);
      const {scope} = execute(result.code);
      assert.equal(await scope.instance.result, 7);
    }
  }
});

test('constructor arrows keep lexical this while ordinary functions and other methods are not patched', async () => {
  const source = `self.RuntimeInterface=class {
    constructor() {
      self.invokeLater = () => this.initialize(1);
      self.otherReceiver = function () { return this.initialize(2); };
      self.Nested = class { constructor() { this.initialize(3); } async initialize() {} };
    }
    async initialize(value) { this.value = value; return value; }
    restart() { return this.initialize(4); }
  }; self.instance = new self.RuntimeInterface;`;
  const result = observeConstructStartup(source);
  assert.equal(result.count, 1);
  const {scope, runs} = execute(result.code);
  assert.equal(runs.length, 0, 'registration does not eagerly call the initializer');
  assert.equal(await scope.invokeLater(), 1);
  assert.equal(scope.instance.value, 1);
  assert.equal(runs.length, 1);
  assert.equal(await scope.otherReceiver.call({initialize: value => value}), 2);
  assert.equal(runs.length, 1);
  assert.equal(await scope.instance.restart(), 4);
  assert.equal(runs.length, 1);
});

test('nonmatching classes, worker code, strings, sync calls and dynamic property lookups remain unchanged', () => {
  const sources = [
    `const text = 'self.RuntimeInterface = class { constructor() { this.start(); } async start() {} }';`,
    `class RuntimeInterface { constructor() { this.start(); } async start() {} }`,
    `app.RuntimeInterface = class { constructor() { this.start(); } async start() {} };`,
    `self.Worker = class { constructor() { this.start(); } async start() {} };`,
    `self.RuntimeInterface = class { constructor() { this.start(); } start() {} };`,
    `self.RuntimeInterface = class { constructor() { this.start(); } async *start() {} };`,
    `self.RuntimeInterface = class { constructor() { this.start(); } static async start() {} };`,
    `self.RuntimeInterface = class { constructor() { this.start(); } async start() {} start() {} };`,
    `self.RuntimeInterface = class { constructor(key) { this[key](); } async start() {} };`,
    `self.RuntimeInterface = class { constructor() { other.start(); } async start() {} };`,
    `self.RuntimeInterface = class { async start() {} };`
  ];
  for (const source of sources) assert.deepEqual(observeConstructStartup(source), {code: source, count: 0});
});

test('nested initializer arguments preserve evaluation order and applying the patch again is inert', async () => {
  const source = `self.RuntimeInterface=class{constructor(){this.trace=[];this.result=this.start(this.start(1))}async start(x){this.trace.push(x);return x}};self.instance=new self.RuntimeInterface;`;
  const result = observeConstructStartup(source);
  assert.equal(result.count, 2);
  parse(result.code, {ecmaVersion: 'latest'});
  const {scope, runs} = execute(result.code);
  assert.equal(runs.length, 2);
  assert.equal(scope.instance.trace[0], 1);
  assert.equal(scope.instance.trace[1], runs[1].result);
  assert.equal(scope.instance.result, runs[0].result);
  assert.equal(await scope.instance.result, 1);
  assert.deepEqual(observeConstructStartup(result.code), {code: result.code, count: 0});
});

test('synchronous argument failures and asynchronous private initializer rejection reach the observer unchanged', async () => {
  const synchronousFailure = new Error('argument evaluation failed');
  const sync = observeConstructStartup(`self.RuntimeInterface=class{constructor(){this.start(failArgument())}async start(x){return x}};`);
  const syncRun = execute(sync.code, {failArgument() { throw synchronousFailure; }});
  assert.throws(() => new syncRun.scope.RuntimeInterface(), error => error === synchronousFailure);
  assert.deepEqual(syncRun.failures, [synchronousFailure]);
  assert.equal(syncRun.runs.length, 1);

  const asynchronousFailure = new Error('native file read failed');
  const async = observeConstructStartup(`self.RuntimeInterface=class{constructor(){this.promise=this.#init()}async #init(){await Promise.resolve();throw failure}};self.instance=new self.RuntimeInterface;`);
  const asyncRun = execute(async.code, {failure: asynchronousFailure});
  const originalPromise = asyncRun.scope.instance.promise;
  assert.equal(originalPromise, asyncRun.runs[0].result);
  await assert.rejects(originalPromise, error => error === asynchronousFailure);
  assert.deepEqual(asyncRun.failures, [asynchronousFailure]);
});

test('optional real Construct bootstrap observes direct initialization and constructor-bound async callbacks', async t => {
  let source;
  try { source = await fs.readFile(new URL('../examples/construct/api-demo-html5/scripts/main.js', import.meta.url), 'utf8'); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    t.skip('Real Construct exports are not redistributed; local HTML5 export enables this check.');
    return;
  }
  const result = observeConstructStartup(source);
  assert.equal(result.count, 3, 'direct init, deviceready init and the constructor-bound create-job-worker callback');
  parse(result.code, {ecmaVersion: 'latest', sourceType: 'module'});
  assert.deepEqual(observeConstructStartup(result.code), {code: result.code, count: 0});
});
