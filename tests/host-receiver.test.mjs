import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {convertProject} from '../src/build/convert.mjs';

const fixture = fileURLToPath(new URL('./fixtures/construct-export/', import.meta.url));
const hostMethods = ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame'];

// This is a handwritten owner/receiver contract, not a simulated TikTok device.
function nativePlatform(output) {
  const api = {
    createCanvas() {
      assert.equal(this, api);
      return {width: 390, height: 844, getContext() { return {}; }};
    },
    getWindowInfo() { return {windowWidth: 390, windowHeight: 844, pixelRatio: 1}; },
    getFileSystemManager() {
      assert.equal(this, api);
      return {readFile({filePath, success, fail}) {
        fs.readFile(path.join(output, filePath), 'utf8').then(data => success({data}), fail);
      }};
    }
  };
  return api;
}

function createNativeRealm(api, strictMethods) {
  const timers = new Set(), intervals = new Set(), logs = [];
  const scheduler = {
    setTimeout(callback, delay, ...args) {
      const timer = setTimeout(() => { timers.delete(timer); callback(...args); }, delay);
      timers.add(timer); return timer;
    },
    clearTimeout(timer) { timers.delete(timer); clearTimeout(timer); },
    setInterval(callback, delay, ...args) { const timer = setInterval(callback, delay, ...args); intervals.add(timer); return timer; },
    clearInterval(timer) { intervals.delete(timer); clearInterval(timer); },
    queueMicrotask,
    requestAnimationFrame(callback) { return this.setTimeout(() => callback(123.5), 0); },
    cancelAnimationFrame(timer) { this.clearTimeout(timer); }
  };
  const context = vm.createContext({
    nativeGame: api, scheduler, strictMethods, URL, URLSearchParams,
    console: Object.fromEntries(['info', 'warn', 'error', 'log'].map(level => [level, (...args) => logs.push({level, text: args.map(String).join(' ')})]))
  });
  vm.runInContext(`'use strict';
    const nativeWindowOwner = globalThis;
    const TTMinis = {game: nativeGame};
    const strictOwnerMethods = new Set(strictMethods);
    globalThis.nativeOwnerCalls = [];
    for (const name of ${JSON.stringify(hostMethods)}) {
      globalThis[name] = function (...args) {
        const correctOwner = this === nativeWindowOwner;
        nativeOwnerCalls.push({name, correctOwner});
        if (strictOwnerMethods.has(name) && !correctOwner)
          throw new TypeError('Can only call Window.' + name + ' on instances of Window');
        return scheduler[name](...args);
      };
    }
    const nativeDocument = Object.freeze({identity: 'native-window-document'});
    const nativeFetch = function () { throw new Error('Native browser fetch must not be borrowed'); };
    Object.defineProperty(globalThis, 'window', {value: nativeWindowOwner, configurable: false, writable: false});
    Object.defineProperty(globalThis, 'document', {value: nativeDocument, configurable: false, writable: false});
    Object.defineProperty(globalThis, 'fetch', {value: nativeFetch, configurable: false, writable: false});
    // A separate mini-game namespace can expose raw forwarded Window functions.
    // Their receiver remains the real Window even when accessed through GameGlobal.
    const gameGlobal = Object.create(null);
    for (const name of Object.getOwnPropertyNames(globalThis)) {
      gameGlobal[name] = globalThis[name];
    }
    Object.defineProperty(globalThis, 'GameGlobal', {value: gameGlobal, configurable: false, writable: false});
    globalThis.nativeBefore = {
      window, document, fetch, GameGlobal,
      methods: Object.fromEntries(${JSON.stringify(hostMethods)}.map(name => [name, globalThis[name]])),
      gameGlobalMethods: Object.fromEntries(${JSON.stringify(hostMethods)}.map(name => [name, GameGlobal[name]]))
    };
  `, context);
  return {context, logs, dispose() {
    for (const timer of timers) clearTimeout(timer);
    for (const timer of intervals) clearInterval(timer);
  }};
}

const channelProbe = `
// Handwritten startup probe for MessagePort.onmessage -> start -> queueMicrotask.
const receiverChannel = new MessageChannel();
self.__receiverChannelDone = new Promise(resolve => {
  receiverChannel.port1.onmessage = event => {
    receiverChannel.port1.close(); receiverChannel.port2.close(); resolve(event.data);
  };
});
receiverChannel.port2.postMessage('channel-delivered');
`;

const schedulingProbe = `
runOnStartup(async () => {
  self.__receiverScheduleResults = [];
  const results = self.__receiverScheduleResults;
  await new Promise(resolve => self.queueMicrotask(() => { results.push('scope-microtask'); resolve(); }));
  await new Promise(resolve => queueMicrotask(() => { results.push('bare-microtask'); resolve(); }));
  await new Promise(resolve => globalThis.setTimeout(value => { results.push(value); resolve(); }, 0, 'scope-timer'));
  await new Promise(resolve => setTimeout(() => { results.push('bare-timer'); resolve(); }, 0));
  await new Promise(resolve => {
    const handle = self.setInterval(() => { self.clearInterval(handle); results.push('scope-interval'); resolve(); }, 0);
  });
  await new Promise(resolve => {
    const handle = setInterval(() => { clearInterval(handle); results.push('bare-interval'); resolve(); }, 0);
  });
  await new Promise(resolve => self.requestAnimationFrame(time => { results.push('scope-raf:' + time); resolve(); }));
  await new Promise(resolve => requestAnimationFrame(time => { results.push('bare-raf:' + time); resolve(); }));
  const cancelledTimer = self.setTimeout(() => { throw new Error('cancelled scope timer ran'); }, 1000);
  self.clearTimeout(cancelledTimer);
  const cancelledBareTimer = setTimeout(() => { throw new Error('cancelled bare timer ran'); }, 1000);
  clearTimeout(cancelledBareTimer);
  const cancelledFrame = self.requestAnimationFrame(() => { throw new Error('cancelled scope frame ran'); });
  self.cancelAnimationFrame(cancelledFrame);
  const cancelledBareFrame = requestAnimationFrame(() => { throw new Error('cancelled bare frame ran'); });
  cancelAnimationFrame(cancelledBareFrame);
});
`;

for (const strictMethods of [['queueMicrotask'], hostMethods]) {
  const checksAll = strictMethods.length > 1;
  test(`TikTok packaged export preserves host isolation with separate GameGlobal (${checksAll ? 'all schedulers' : 'Promise-backed MessageChannel'})`, {timeout: 15000}, async t => {
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'c3-host-receiver-'));
    t.after(() => fs.rm(temp, {recursive: true, force: true}));
    const input = path.join(temp, 'fixture'), output = path.join(temp, 'tiktok');
    await fs.cp(fixture, input, {recursive: true});
    const runtimeFile = path.join(input, 'scripts/c3runtime.js');
    await fs.writeFile(runtimeFile, channelProbe + await fs.readFile(runtimeFile, 'utf8'));
    if (checksAll) await fs.appendFile(path.join(input, 'scripts/project/main.js'), schedulingProbe);
    await convertProject({input, output, platform: 'tiktok', experimental: true});
    const realm = createNativeRealm(nativePlatform(output), strictMethods);
    t.after(() => realm.dispose());
    const {context} = realm;
    assert.notEqual(context.GameGlobal, context.window);
    vm.runInContext(await fs.readFile(path.join(output, 'game.js'), 'utf8'), context, {filename: 'tiktok/host-receiver-game.js', timeout: 3000});
    const scope = context.__C3MiniGameScope || context.GameGlobal.__C3MiniGameScope;
    assert.ok(scope, 'packaged engine publishes its isolated scope');
    t.after(() => scope.__C3MiniGameAdapter?.dispose());
    await scope.__C3MiniGameLoaded;
    await assert.doesNotReject(scope.__fixtureDone, 'native Window functions must not be rebound to GameGlobal or the engine scope');
    assert.equal(await scope.__receiverChannelDone, 'channel-delivered');
    assert.equal(scope.__fixtureRuntime.workerValue, 42, 'worker and MessageChannel startup finishes');
    assert.equal(scope.__fixtureRuntime.initialized, true);
    if (checksAll) {
      assert.deepEqual(Array.from(scope.__receiverScheduleResults), [
        'scope-microtask', 'bare-microtask', 'scope-timer', 'bare-timer',
        'scope-interval', 'bare-interval', 'scope-raf:123.5', 'bare-raf:123.5'
      ]);
    }
    const called = Array.from(context.nativeOwnerCalls);
    for (const name of strictMethods) {
      if (name === 'queueMicrotask') {
        assert.equal(called.filter(call => call.name === name).length, 0, 'TikTok uses Promise jobs without borrowing Window.queueMicrotask');
        continue;
      }
      assert.ok(called.some(call => call.name === name), `${name} is exercised`);
      assert.ok(called.filter(call => call.name === name).every(call => call.correctOwner), `${name} retains the real VM globalThis owner`);
    }
    const before = context.nativeBefore;
    for (const name of ['window', 'document', 'fetch', 'GameGlobal']) assert.equal(context[name], before[name]);
    for (const name of hostMethods) {
      assert.equal(context[name], before.methods[name], `native Window.${name} is not overwritten`);
      assert.equal(context.GameGlobal[name], before.gameGlobalMethods[name], `GameGlobal.${name} is not overwritten`);
    }
    assert.equal(context.GameGlobal.document, before.document);
    assert.notEqual(scope.document, before.document);
    assert.equal(context.RuntimeInterface, undefined);
    assert.equal(context.GameGlobal.RuntimeInterface, undefined);
    assert.deepEqual(realm.logs.filter(row => row.level === 'error'), []);
  });
}
