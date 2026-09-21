import test from 'node:test';
import assert from 'node:assert/strict';
import {createEngineScope} from '../src/runtime/scope.js';

function fixture() {
  const errors = [];
  const host = {TTMinis: {game: {createCanvas() {}}}, console: {error: (...args) => errors.push(args)}};
  Object.defineProperty(host, 'queueMicrotask', {get() { throw new Error('Native queueMicrotask must not even be read'); }});
  return {errors, scope: createEngineScope(host, {platform: 'tiktok'})};
}
const flush = () => new Promise(resolve => setImmediate(resolve));

test('TikTok microtasks use Promise FIFO order, run asynchronously and return undefined', async () => {
  const {scope, errors} = fixture(), order = [];
  assert.equal(scope.queueMicrotask(() => {
    order.push('A'); scope.queueMicrotask(() => order.push('C'));
  }), undefined);
  Promise.resolve().then(() => order.push('P'));
  const detached = scope.queueMicrotask;
  assert.equal(detached(() => order.push('B')), undefined);
  order.push('sync');
  assert.deepEqual(order, ['sync']);
  await flush();
  assert.deepEqual(order, ['sync', 'A', 'P', 'B', 'C']);
  assert.deepEqual(errors, []);
});

test('TikTok microtask rejects invalid callbacks synchronously and ignores callback return values', async () => {
  const {scope, errors} = fixture();
  for (const callback of [undefined, null, 123, {}, 'callback']) assert.throws(() => scope.queueMicrotask(callback), TypeError);
  let touched = false;
  const returned = {get then() { touched = true; throw new Error('must not adopt callback return value'); }};
  scope.queueMicrotask(() => returned);
  await flush();
  assert.equal(touched, false); assert.deepEqual(errors, []);
});

test('TikTok microtask errors reach startup diagnostics without stopping later tasks', async () => {
  const {scope, errors} = fixture(), observed = [], failure = new Error('startup callback failed');
  scope.__C3MiniGameStartup = {fail(error, stage) { observed.push([error, stage]); return true; }};
  let nextRan = false;
  scope.queueMicrotask(() => { throw failure; });
  scope.queueMicrotask(() => { nextRan = true; });
  await flush();
  assert.deepEqual(observed, [[failure, 'microtask']]);
  assert.equal(nextRan, true); assert.deepEqual(errors, []);
});

test('TikTok microtask errors remain visible after startup and do not become silent rejections', async () => {
  const {scope, errors} = fixture(), failure = new Error('post-startup callback failed');
  scope.__C3MiniGameStartup = {fail() { return false; }};
  scope.queueMicrotask(() => { throw failure; });
  await flush();
  assert.equal(errors.length, 1); assert.equal(errors[0][1], failure);
  assert.match(errors[0][0], /microtask/i);
  let reported;
  scope.reportError = error => { reported = error; };
  scope.queueMicrotask(() => { throw failure; });
  await flush();
  assert.equal(reported, failure); assert.equal(errors.length, 1);
});
