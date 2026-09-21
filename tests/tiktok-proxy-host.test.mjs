import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {convertProject} from '../src/build/convert.mjs';

const fixture = fileURLToPath(new URL('./fixtures/construct-export/', import.meta.url));

// Handwritten contract for a proxy host with no accessible valid Window receiver.
// This deliberately does not claim to emulate a TikTok device or its native renderer.
function proxyHost(output) {
  const timers = new Set(), logs = [];
  const api = {
    createCanvas() { assert.equal(this, api); return {width: 390, height: 844, getContext() { return {}; }}; },
    getWindowInfo() { return {windowWidth: 390, windowHeight: 844, pixelRatio: 1}; },
    getFileSystemManager() {
      assert.equal(this, api);
      return {readFile({filePath, success, fail}) {
        fs.readFile(path.join(output, filePath), 'utf8').then(data => success({data}), fail);
      }};
    }
  };
  const context = vm.createContext({
    nativeGame: api, URL, URLSearchParams,
    setTimeout(callback, delay, ...args) {
      const timer = setTimeout(() => { timers.delete(timer); callback(...args); }, delay);
      timers.add(timer); return timer;
    },
    clearTimeout(timer) { timers.delete(timer); clearTimeout(timer); },
    console: Object.fromEntries(['info', 'warn', 'error', 'log'].map(level => [level, (...args) => logs.push({level, text: args.map(String).join(' ')})]))
  });
  vm.runInContext(`'use strict';
    const TTMinis = {game: nativeGame};
    globalThis.nativeQueueCalls = 0;
    globalThis.forbiddenReads = [];
    const unusableNativeQueue = function () {
      ++nativeQueueCalls;
      throw new TypeError('Can only call Window.queueMicrotask on instances of Window');
    };
    Object.defineProperty(globalThis, 'queueMicrotask', {value: unusableNativeQueue, configurable: false, writable: false});
    const gameGlobal = Object.create(null);
    for (const name of ['setTimeout', 'clearTimeout', 'queueMicrotask']) gameGlobal[name] = globalThis[name];
    for (const [label, owner] of [['global', globalThis], ['game', gameGlobal]]) {
      for (const name of ['window', 'document']) {
        Object.defineProperty(owner, name, {configurable: false, get() {
          forbiddenReads.push(label + '.' + name);
          throw new Error('Host DOM must not be read: ' + label + '.' + name);
        }});
      }
    }
    Object.defineProperty(globalThis, 'GameGlobal', {value: gameGlobal, configurable: false, writable: false});
    globalThis.nativeBefore = {
      globalQueue: Object.getOwnPropertyDescriptor(globalThis, 'queueMicrotask'),
      gameQueue: Object.getOwnPropertyDescriptor(GameGlobal, 'queueMicrotask'),
      globalWindow: Object.getOwnPropertyDescriptor(globalThis, 'window'),
      globalDocument: Object.getOwnPropertyDescriptor(globalThis, 'document'),
      gameWindow: Object.getOwnPropertyDescriptor(GameGlobal, 'window'),
      gameDocument: Object.getOwnPropertyDescriptor(GameGlobal, 'document'),
      setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout
    };
  `, context);
  return {context, logs, dispose() { for (const timer of timers) clearTimeout(timer); }};
}

const channelProbe = `
// The first native failure previously occurred while onmessage starts a port.
const proxyChannel = new MessageChannel();
self.__proxyChannelDone = new Promise(resolve => {
  proxyChannel.port1.onmessage = event => {
    proxyChannel.port1.close(); proxyChannel.port2.close(); resolve(event.data);
  };
});
proxyChannel.port2.postMessage('proxy-channel-delivered');
`;

const schedulingProbe = `
runOnStartup(async () => {
  const order = [], asynchronous = [], returns = [];
  let scheduling = true;
  returns.push(queueMicrotask(() => {
    asynchronous.push(!scheduling); order.push('bare');
    returns.push(self.queueMicrotask(() => { asynchronous.push(!scheduling); order.push('nested'); }));
  }));
  returns.push(self.queueMicrotask(() => { asynchronous.push(!scheduling); order.push('self'); }));
  Promise.resolve().then(() => { asynchronous.push(!scheduling); order.push('promise'); });
  returns.push(queueMicrotask(() => { asynchronous.push(!scheduling); order.push('last'); }));
  order.push('sync'); scheduling = false;
  await Promise.resolve(); await Promise.resolve();
  self.__proxyScheduleResults = {order, asynchronous, returns};
});
`;

test('TikTok bundle starts workers and FIFO microtasks without calling an unusable native Window.queueMicrotask', {timeout: 15000}, async t => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'c3-tiktok-proxy-'));
  t.after(() => fs.rm(temporary, {recursive: true, force: true}));
  const input = path.join(temporary, 'fixture'), output = path.join(temporary, 'tiktok');
  await fs.cp(fixture, input, {recursive: true});
  const runtimeFile = path.join(input, 'scripts/c3runtime.js');
  await fs.writeFile(runtimeFile, channelProbe + await fs.readFile(runtimeFile, 'utf8'));
  await fs.appendFile(path.join(input, 'scripts/project/main.js'), schedulingProbe);
  await convertProject({input, output, platform: 'tiktok', experimental: true});
  const realm = proxyHost(output); t.after(() => realm.dispose());
  const {context} = realm;
  vm.runInContext(await fs.readFile(path.join(output, 'game.js'), 'utf8'), context, {filename: 'tiktok/proxy-host-game.js', timeout: 3000});
  const scope = context.__C3MiniGameScope || context.GameGlobal.__C3MiniGameScope;
  assert.ok(scope);
  t.after(() => scope.__C3MiniGameAdapter?.dispose());
  await scope.__C3MiniGameLoaded;
  await assert.doesNotReject(scope.__fixtureDone, 'MessageChannel and Worker must not depend on native queueMicrotask receiver availability');
  assert.equal(await scope.__proxyChannelDone, 'proxy-channel-delivered');
  assert.equal(scope.__fixtureRuntime.workerValue, 42);
  assert.equal(scope.__fixtureRuntime.initialized, true);
  const results = scope.__proxyScheduleResults;
  assert.deepEqual(Array.from(results.order), ['sync', 'bare', 'self', 'promise', 'last', 'nested']);
  assert.deepEqual(Array.from(results.asynchronous), [true, true, true, true, true]);
  assert.deepEqual(Array.from(results.returns), [undefined, undefined, undefined, undefined]);
  assert.equal(context.nativeQueueCalls, 0, 'no fallback probing or invocation of native Window.queueMicrotask');
  assert.deepEqual(Array.from(context.forbiddenReads), [], 'no access to native window or document');
  const before = context.nativeBefore;
  for (const [name, previous] of [['queueMicrotask', before.globalQueue], ['window', before.globalWindow], ['document', before.globalDocument]]) {
    assert.deepEqual(Object.getOwnPropertyDescriptor(context, name), {...previous});
  }
  for (const [name, previous] of [['queueMicrotask', before.gameQueue], ['window', before.gameWindow], ['document', before.gameDocument]]) {
    assert.deepEqual(Object.getOwnPropertyDescriptor(context.GameGlobal, name), {...previous});
  }
  assert.equal(context.setTimeout, before.setTimeout); assert.equal(context.clearTimeout, before.clearTimeout);
  assert.equal(context.GameGlobal.setTimeout, before.setTimeout); assert.equal(context.GameGlobal.clearTimeout, before.clearTimeout);
  assert.equal(scope.window, scope); assert.equal(scope.self, scope);
  assert.equal(context.RuntimeInterface, undefined); assert.equal(context.GameGlobal.RuntimeInterface, undefined);
  assert.deepEqual(realm.logs.filter(row => row.level === 'error'), []);
});
