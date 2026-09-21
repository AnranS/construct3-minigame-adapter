import test from 'node:test';
import assert from 'node:assert/strict';
import {createStartupDiagnostics} from '../src/runtime/startup.js';
import {createRuntimeReadiness} from '../src/runtime/readiness.js';

const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
};

function fixture(extra = {}) {
  const logs = [], timers = new Map(), readiness = createRuntimeReadiness();
  let nextTimer = 0, settled = false;
  readiness.promise.then(() => { settled = true; }, () => { settled = true; });
  const host = {
    console: Object.fromEntries(['info', 'warn', 'error'].map(level => [level, message => logs.push({level, message})])),
    setTimeout(callback, delay) { const id = ++nextTimer; timers.set(id, {callback, delay}); return id; },
    clearTimeout(id) { timers.delete(id); },
    ...extra
  };
  const diagnostics = createStartupDiagnostics({host, readiness, platform: 'tiktok', waitMs: 75});
  return {host, logs, timers, readiness, diagnostics, isSettled: () => settled,
    fireWatchdog() { for (const [id, timer] of [...timers]) { timers.delete(id); timer.callback(); } },
    dispose() { diagnostics.dispose(); readiness.dispose(); }
  };
}

test('startup run preserves exact Promise, return values, and the caller-provided receiver', async t => {
  const f = fixture(); t.after(() => f.dispose());
  const pending = deferred(), receiver = {marker: 7};
  function action(argument) { assert.equal(this, receiver); assert.equal(argument, 9); return pending.promise; }
  assert.equal(f.diagnostics.run('native-init', () => action.call(receiver, 9)), pending.promise);
  assert.deepEqual(f.diagnostics.getSnapshot().pending, ['native-init']);
  const value = {};
  assert.equal(f.diagnostics.run('sync-step', () => value), value);
  pending.resolve(value); await flush();
  assert.deepEqual(f.diagnostics.getSnapshot().pending, []);
  assert.equal(f.isSettled(), false, 'observed progress must not resolve readiness');
});

test('startup synchronous failures rethrow the same error and reject readiness once', async t => {
  const f = fixture(); t.after(() => f.dispose());
  const error = new TypeError('canvas cannot initialize');
  assert.throws(() => f.diagnostics.run('canvas-init', () => { throw error; }), value => value === error);
  await assert.rejects(f.readiness.promise, value => value === error);
  assert.equal(f.diagnostics.getSnapshot().state, 'failed');
  assert.equal(f.diagnostics.getSnapshot().failure.stage, 'canvas-init');
  f.diagnostics.fail(new Error('later failure'));
  assert.equal(f.logs.filter(row => row.message.includes('STARTUP_FAILED')).length, 1);
  assert.equal(f.timers.size, 0);
});

test('startup asynchronous rejection retains its original Promise and reports STARTUP_FAILED', async t => {
  const f = fixture(); t.after(() => f.dispose());
  const pending = deferred(), error = new Error('private engine initialization failed');
  assert.equal(f.diagnostics.run('runtime-init', () => pending.promise), pending.promise);
  pending.reject(error);
  await assert.rejects(f.readiness.promise, value => value === error);
  assert.equal(f.logs.some(row => row.level === 'error' && row.message.includes('STARTUP_FAILED') && row.message.includes('runtime-init')), true);
  assert.deepEqual(f.diagnostics.getSnapshot().pending, []);
});

test('published Construct initialization functions retain receiver and instrument the real runtime', async t => {
  const f = fixture(); t.after(() => f.dispose());
  const createReceiver = {}, initReceiver = {}, publishReceiver = {};
  const data = deferred(), canvas = deferred(), init = deferred(), webgl = deferred();
  const runtime = {
    _LoadDataJson(argument) { assert.equal(this, runtime); assert.equal(argument, 'data'); return data.promise; },
    _InitialiseCanvas(argument) { assert.equal(this, runtime); assert.equal(argument, 'canvas'); return canvas.promise; }
  };
  class Renderer { InitState(argument) { assert.equal(argument, 'gl'); return webgl.promise; } }
  f.host.C3 = {Gfx: {WebGLRenderer: Renderer}};
  let observedCreate, observedInit;
  f.host.C3_SetInitFunctions = function (create, initialize) {
    assert.equal(this, publishReceiver); observedCreate = create; observedInit = initialize; return 'published';
  };
  const create = function (argument) { assert.equal(this, createReceiver); assert.equal(argument, 'create'); return runtime; };
  const initialize = function (argument) { assert.equal(this, initReceiver); assert.equal(argument, runtime); return init.promise; };
  assert.equal(f.host.C3_SetInitFunctions.call(publishReceiver, create, initialize), 'published');
  assert.equal(observedCreate.call(createReceiver, 'create'), runtime);
  assert.equal(runtime._LoadDataJson('data'), data.promise);
  assert.equal(runtime._InitialiseCanvas('canvas'), canvas.promise);
  assert.equal(new Renderer().InitState('gl'), webgl.promise);
  assert.equal(observedInit.call(initReceiver, runtime), init.promise);
  assert.deepEqual(f.diagnostics.getSnapshot().pending, ['project-data-init', 'canvas-init', 'webgl-init', 'runtime-init']);
  for (const task of [data, canvas, webgl, init]) task.resolve();
  await flush();
  assert.equal(f.isSettled(), false);
  assert.deepEqual(f.diagnostics.getSnapshot().pending, []);
});

test('a private initialization rejection is visible even when Construct ignores its Promise', async t => {
  const f = fixture(); t.after(() => f.dispose());
  const error = new Error('native renderer failed'), init = deferred();
  let initialize;
  f.host.C3_SetInitFunctions = (_create, nextInitialize) => { initialize = nextInitialize; };
  f.host.C3_SetInitFunctions(() => ({}), () => init.promise);
  initialize(); // This is the engine's fire-and-forget call: only diagnostics observes it.
  init.reject(error);
  await assert.rejects(f.readiness.promise, value => value === error);
  assert.equal(f.diagnostics.getSnapshot().failure.stage, 'runtime-init');
  assert.equal(f.logs.some(row => row.message.includes('STARTUP_FAILED')), true);
});

test('a renderer rejection can recover through the engine fallback without failing readiness', async t => {
  const f = fixture(); t.after(() => f.dispose());
  let calls = 0, createObserved, initObserved;
  class Renderer {
    async InitState() { if (++calls === 1) throw new Error('first renderer unavailable'); return 'fallback ready'; }
  }
  f.host.C3 = {Gfx: {WebGLRenderer: Renderer}};
  const runtime = {_InitialiseCanvas: async () => {
    try { return await new Renderer().InitState(); }
    catch { return new Renderer().InitState(); }
  }};
  f.host.C3_SetInitFunctions = (create, initialize) => { createObserved = create; initObserved = initialize; };
  f.host.C3_SetInitFunctions(() => runtime, value => value._InitialiseCanvas());
  assert.equal(await initObserved(createObserved()), 'fallback ready');
  assert.equal(f.diagnostics.getSnapshot().state, 'starting');
  assert.equal(f.isSettled(), false);
  assert.equal(f.logs.some(row => row.message.includes('STARTUP_FAILED')), false);
  assert.ok(f.diagnostics.getSnapshot().history.some(row => row.stage === 'webgl-init' && row.status === 'rejected'));
});

test('late worker failures are explicitly unhandled by startup diagnostics so the caller can report them', t => {
  const f = fixture(); t.after(() => f.dispose());
  f.diagnostics.ready();
  assert.equal(f.diagnostics.fail(new Error('worker failed after ready'), 'worker'), false);
  assert.equal(f.diagnostics.getSnapshot().state, 'ready');
});

test('worker and scheduler hooks observe discarded promises without changing receiver or return', async t => {
  const f = fixture(); t.after(() => f.dispose());
  const worker = deferred(), jobs = deferred(), error = new Error('worker unavailable');
  class RuntimeInterface { CreateWorker(argument) { assert.equal(this, instance); assert.equal(argument, 'worker.js'); return worker.promise; } }
  class JobSchedulerDOM { Init() { assert.equal(this, scheduler); return jobs.promise; } }
  f.host.RuntimeInterface = RuntimeInterface;
  f.host.JobSchedulerDOM = JobSchedulerDOM;
  const instance = new RuntimeInterface(), scheduler = new JobSchedulerDOM();
  assert.equal(instance.CreateWorker('worker.js'), worker.promise);
  assert.equal(scheduler.Init(), jobs.promise);
  worker.resolve(); jobs.reject(error);
  await assert.rejects(f.readiness.promise, value => value === error);
  assert.equal(f.diagnostics.getSnapshot().failure.stage, 'job-scheduler-init');
});

test('watchdog warns without resolving, rejecting, or terminating a slow successful startup', async t => {
  const f = fixture(); t.after(() => f.dispose());
  const pending = deferred();
  class RuntimeInterface { _OnMessageFromRuntime(message) { assert.equal(message.type, 'runtime-ready'); } }
  f.host.RuntimeInterface = RuntimeInterface;
  f.readiness.promise.then(() => f.diagnostics.ready());
  f.diagnostics.run('slow-device-init', () => pending.promise);
  assert.equal([...f.timers.values()][0].delay, 75);
  f.fireWatchdog(); await flush();
  assert.equal(f.logs.filter(row => row.level === 'warn' && row.message.includes('STARTUP_WAIT')).length, 1);
  assert.equal(f.diagnostics.getSnapshot().state, 'starting');
  assert.equal(f.isSettled(), false);
  assert.deepEqual(f.diagnostics.getSnapshot().pending, ['slow-device-init']);
  pending.resolve(); await flush();
  new RuntimeInterface()._OnMessageFromRuntime({type: 'runtime-ready'});
  await f.readiness.promise; await flush();
  assert.equal(f.diagnostics.getSnapshot().state, 'ready');
  assert.equal(f.logs.some(row => row.message.includes('STARTUP_FAILED')), false);
});

test('disposing startup hooks restores methods and preserves engine-published classes and later replacements', t => {
  const originalFetch = () => {};
  const f = fixture({fetch: originalFetch}); t.after(() => f.dispose());
  class RuntimeInterface { CreateWorker() {} _OnMessageFromRuntime() {} }
  class Scheduler { Init() {} }
  const workerMethod = RuntimeInterface.prototype.CreateWorker, initMethod = Scheduler.prototype.Init;
  const publishInit = () => {};
  f.host.C3_SetInitFunctions = publishInit;
  assert.notEqual(f.host.C3_SetInitFunctions, publishInit);
  f.host.RuntimeInterface = RuntimeInterface; f.host.JobSchedulerDOM = Scheduler;
  assert.notEqual(RuntimeInterface.prototype.CreateWorker, workerMethod);
  assert.notEqual(Scheduler.prototype.Init, initMethod);
  f.diagnostics.dispose();
  assert.equal(f.host.RuntimeInterface, RuntimeInterface);
  assert.equal(f.host.JobSchedulerDOM, Scheduler);
  assert.equal(f.host.C3_SetInitFunctions, publishInit);
  assert.equal(RuntimeInterface.prototype.CreateWorker, workerMethod);
  assert.equal(Scheduler.prototype.Init, initMethod);
  assert.equal(f.host.fetch, originalFetch);
  assert.equal(f.timers.size, 0);
  const other = fixture(); t.after(() => other.dispose());
  class Other { CreateWorker() {} }
  other.host.RuntimeInterface = Other;
  const replacement = () => {};
  Other.prototype.CreateWorker = replacement;
  Object.defineProperty(other.host, 'RuntimeInterface', {value: 'later owner', configurable: true});
  other.diagnostics.dispose();
  assert.equal(other.host.RuntimeInterface, 'later owner');
  assert.equal(Other.prototype.CreateWorker, replacement);
});

test('optional package asset failures are recorded but never reject readiness', async t => {
  const pending = deferred(), receiver = {}, input = 'https://c3-minigame.invalid/game/icon.png?private=hidden#fragment';
  const f = fixture({fetch(url, argument) { assert.equal(this, receiver); assert.equal(url, input); assert.equal(argument, 'options'); return pending.promise; }});
  t.after(() => f.dispose());
  assert.equal(f.host.fetch.call(receiver, input, 'options'), pending.promise);
  pending.reject(new Error('optional icon unavailable')); await flush();
  assert.equal(f.isSettled(), false);
  assert.equal(f.diagnostics.getSnapshot().state, 'starting');
  assert.deepEqual(f.diagnostics.getSnapshot().history.map(row => row.stage), ['asset:game/icon.png', 'asset:game/icon.png']);
  assert.equal(JSON.stringify(f.logs).includes('private=hidden'), false);
  assert.equal(f.logs.some(row => row.level === 'error'), false);
});

test('remote business requests remain untraced including credentials in query strings', async t => {
  const input = 'https://payments.example.test/order?token=secret-credential', pending = deferred();
  const f = fixture({fetch(url) { assert.equal(url, input); return pending.promise; }}); t.after(() => f.dispose());
  assert.equal(f.host.fetch(input), pending.promise);
  pending.resolve('ok'); await flush();
  assert.deepEqual(f.diagnostics.getSnapshot().history, []);
  assert.equal(JSON.stringify(f.logs).includes('payments.example.test'), false);
  assert.equal(JSON.stringify(f.diagnostics.getSnapshot()).includes('secret-credential'), false);
});

test('fatal diagnostic logs and snapshots redact remote URLs embedded in native error details', async t => {
  const f = fixture(); t.after(() => f.dispose());
  const error = new Error('request failed at https://payments.example.test/order?token=secret-credential');
  error.stack = 'Error: request failed\n at https://payments.example.test/sdk.js?token=secret-credential:2:3\n at game.js:12:4';
  assert.throws(() => f.diagnostics.run('runtime-init', () => { throw error; }), value => value === error);
  await assert.rejects(f.readiness.promise, value => value === error);
  const captured = JSON.stringify({logs: f.logs, snapshot: f.diagnostics.getSnapshot()});
  assert.equal(captured.includes('payments.example.test'), false);
  assert.equal(captured.includes('secret-credential'), false);
  assert.equal(captured.includes('game.js:12:4'), true);
});
