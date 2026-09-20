import test from 'node:test';
import assert from 'node:assert/strict';
import {createRuntimeReadiness} from '../src/runtime/readiness.js';

const flushMicrotasks = async () => { await Promise.resolve(); await Promise.resolve(); };

test('readiness follows actual runtime-ready processing and preserves receiver, arguments and return value', async () => {
  const returnValue = {};
  const calls = [];
  class RuntimeInterface {
    _OnMessageFromRuntime(...args) {
      calls.push({receiver: this, args});
      if (args[0].type === 'runtime-ready') this.attached = true;
      return returnValue;
    }
  }
  const readiness = createRuntimeReadiness();
  assert.equal(readiness.attach(RuntimeInterface), true);
  const wrapper = RuntimeInterface.prototype._OnMessageFromRuntime;
  assert.equal(readiness.attach(RuntimeInterface), true);
  assert.equal(RuntimeInterface.prototype._OnMessageFromRuntime, wrapper);
  let ready = false;
  readiness.promise.then(() => { ready = true; });
  const instance = new RuntimeInterface();
  const irrelevant = {type: 'creating-runtime'};
  assert.equal(instance._OnMessageFromRuntime(irrelevant), returnValue);
  await flushMicrotasks();
  assert.equal(ready, false);
  const message = {type: 'runtime-ready'};
  const extra = {};
  assert.equal(instance._OnMessageFromRuntime(message, extra), returnValue);
  const result = await readiness.promise;
  assert.equal(instance.attached, true);
  assert.equal(result.runtimeInterface, instance);
  assert.equal(result.message, message);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].receiver, instance);
  assert.deepEqual(calls[1].args, [message, extra]);
  readiness.dispose();
});

test('unavailable, accessor and immutable methods cannot produce false readiness', async () => {
  const readiness = createRuntimeReadiness();
  let getterCalls = 0;
  class NoMethod {}
  class Accessor { get _OnMessageFromRuntime() { getterCalls++; return () => {}; } }
  class Immutable { _OnMessageFromRuntime() {} }
  Object.freeze(Immutable.prototype);
  assert.equal(readiness.attach(undefined), false);
  assert.equal(readiness.attach(NoMethod), false);
  assert.equal(readiness.attach(Accessor), false);
  assert.equal(readiness.attach(Immutable), false);
  assert.equal(getterCalls, 0);
  let settled = false;
  readiness.promise.then(() => { settled = true; });
  await flushMicrotasks();
  assert.equal(settled, false);
  readiness.dispose();
});

test('original errors propagate identically and startup failures can reject readiness explicitly', async () => {
  const failure = new Error('DOM attachment failed');
  class RuntimeInterface { _OnMessageFromRuntime() { throw failure; } }
  const readiness = createRuntimeReadiness();
  readiness.attach(RuntimeInterface);
  let resolved = false;
  readiness.promise.then(() => { resolved = true; }, () => {});
  assert.throws(() => new RuntimeInterface()._OnMessageFromRuntime({type: 'runtime-ready'}), error => error === failure);
  await flushMicrotasks();
  assert.equal(resolved, false);
  const rejected = assert.rejects(readiness.promise, error => error === failure);
  readiness.reject(failure);
  await rejected;
  readiness.dispose();
});

test('asynchronous processing must complete successfully without replacing its returned promise', async () => {
  let complete;
  const processing = new Promise(resolve => { complete = resolve; });
  class RuntimeInterface { _OnMessageFromRuntime() { return processing; } }
  const readiness = createRuntimeReadiness();
  readiness.attach(RuntimeInterface);
  const instance = new RuntimeInterface();
  assert.equal(instance._OnMessageFromRuntime({type: 'runtime-ready'}), processing);
  let ready = false;
  readiness.promise.then(() => { ready = true; });
  await flushMicrotasks();
  assert.equal(ready, false);
  complete();
  assert.equal((await readiness.promise).runtimeInterface, instance);
  readiness.dispose();

  const failure = new Error('async attachment failed');
  const failedProcessing = Promise.reject(failure);
  class FailingInterface { _OnMessageFromRuntime() { return failedProcessing; } }
  const failingReadiness = createRuntimeReadiness();
  failingReadiness.attach(FailingInterface);
  const rejected = assert.rejects(failingReadiness.promise, error => error === failure);
  assert.equal(new FailingInterface()._OnMessageFromRuntime({type: 'runtime-ready'}), failedProcessing);
  await rejected;
  failingReadiness.dispose();
});

test('disposal restores inherited methods and does not overwrite later method replacements', async () => {
  class Base { _OnMessageFromRuntime() {} }
  class RuntimeInterface extends Base {}
  const readiness = createRuntimeReadiness();
  assert.equal(readiness.attach(RuntimeInterface), true);
  assert.equal(Object.hasOwn(RuntimeInterface.prototype, '_OnMessageFromRuntime'), true);
  readiness.dispose();
  assert.equal(Object.hasOwn(RuntimeInterface.prototype, '_OnMessageFromRuntime'), false);
  assert.equal(RuntimeInterface.prototype._OnMessageFromRuntime, Base.prototype._OnMessageFromRuntime);
  assert.equal(readiness.attach(RuntimeInterface), false);

  const other = createRuntimeReadiness();
  other.attach(Base);
  const replacement = () => {};
  Base.prototype._OnMessageFromRuntime = replacement;
  other.dispose();
  assert.equal(Base.prototype._OnMessageFromRuntime, replacement);
});
