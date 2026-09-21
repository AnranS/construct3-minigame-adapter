import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {convertProject} from '../src/build/convert.mjs';
import {inspectProject} from '../src/build/inspect.mjs';

const fixture = fileURLToPath(new URL('./fixtures/construct-export', import.meta.url));

// This is a mock platform for a HANDWRITTEN contract fixture, not a game engine/device test.
function mockPlatform(output) {
  const callbacks = {};
  const canvases = [];
  const api = {
    getWindowInfo: () => ({windowWidth: 320, windowHeight: 480, pixelRatio: 2}),
    __canvases: canvases,
    createCanvas: () => {
      const canvas = {width: 640, height: 960, requestedContexts: [], getContext(type) { this.requestedContexts.push(type); return {}; }};
      canvases.push(canvas);
      return canvas;
    },
    getFileSystemManager: () => ({readFile: ({filePath, success, fail}) => {
      fs.readFile(path.join(output, filePath), 'utf8').then(data => success({data}), fail);
    }})
  };
  for (const type of ['TouchStart', 'TouchMove', 'TouchEnd', 'TouchCancel', 'Show', 'Hide']) {
    api[`on${type}`] = callback => { callbacks[type] = callback; };
    api[`off${type}`] = callback => { if (callbacks[type] === callback) delete callbacks[type]; };
  }
  return api;
}

test('handwritten modern export is identified and requires explicit experimental conversion', async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'c3-contract-'));
  t.after(() => fs.rm(temp, {recursive: true, force: true}));
  const inspection = await inspectProject(fixture);
  assert.equal(inspection.format, 'construct-modern');
  assert.equal(inspection.canBuild, true);
  assert.equal(inspection.deviceVerified, false);
  assert.deepEqual(inspection.ignoredScripts, ['scripts/register-sw.js']);
  await assert.rejects(convertProject({input: fixture, output: path.join(temp, 'blocked'), platform: 'wechat'}), /experimental/);
  await assert.rejects(fs.access(path.join(temp, 'blocked')));
});

for (const platform of ['wechat', 'douyin']) {
  test(`${platform}: handwritten export executes bundled module startup and package JSON loading`, {timeout: 10000}, async t => {
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'c3-contract-'));
    t.after(() => fs.rm(temp, {recursive: true, force: true}));
    const output = path.join(temp, platform);
    const report = await convertProject({input: fixture, output, platform, experimental: true});
    assert.equal(report.deviceVerified, false);
    assert.equal(report.workerExecution, 'same-thread-asynchronous');
    assert.equal(report.sourceFormat, 'construct-modern');
    const project = JSON.parse(await fs.readFile(path.join(output, 'project.config.json')));
    assert.equal(project.compileType, 'game');
    assert.equal(project.appid, '');
    const game = JSON.parse(await fs.readFile(path.join(output, 'game.json')));
    assert.equal(game.deviceOrientation, 'portrait');
    const source = await fs.readFile(path.join(output, 'game.js'), 'utf8');
    const errors = [];
    const context = vm.createContext({
      console: {...console, error: (...args) => errors.push(args.map(String).join(' '))},
      setTimeout, clearTimeout, queueMicrotask, URL, URLSearchParams,
      [platform === 'wechat' ? 'wx' : 'tt']: mockPlatform(output)
    });
    vm.runInContext(source, context, {filename: `${platform}/game.js`, timeout: 3000});
    await context.__C3MiniGameLoaded;
    const scope = context.__C3MiniGameScope;
    assert.ok(scope && scope !== context);
    let runtimeReady = false;
    scope.__C3MiniGameReady.then(() => { runtimeReady = true; });
    await scope.__fixtureDone;
    assert.equal(scope.__fixtureRuntime.initialized, true);
    assert.equal(runtimeReady, false, 'loading scripts and initializing this handwritten fixture must not fabricate the real engine runtime-ready message');
    const platformAPI = context[platform === 'wechat' ? 'wx' : 'tt'];
    assert.equal(scope.__fixtureRuntime.canvas, platformAPI.__canvases[0], 'runtime must use the native first/on-screen canvas');
    assert.equal(scope.__fixtureRuntime.canvas, context.__C3MiniGameAdapter.canvas);
    assert.notEqual(scope.__fixtureProbeCanvas, scope.__fixtureRuntime.canvas, 'capability probes must use offscreen canvases');
    assert.deepEqual(scope.__fixtureProbeCanvas.requestedContexts, ['webgl']);
    assert.deepEqual(scope.__fixtureRuntime.canvas.requestedContexts, [], 'probe must not lock the screen canvas to WebGL1');
    assert.equal(scope.__fixtureRuntime.workerValue, 42);
    assert.equal(report.inlineWorkers, 2);
    assert.equal(scope.__fixtureSharedLoads, 1, 'ESM cache must be shared across independently loaded script entries');
    assert.equal(scope.__fixtureRuntime.globalVars.sharedValue, 42);
    assert.equal(scope.__fixtureRuntime.globalVars.contractValue, 42);
    assert.deepEqual(Array.from(scope.__fixtureTrace), ['bootstrap', 'engine-module', 'object-references', 'project-script', 'create', 'startup-callback', 'initialized']);
    assert.deepEqual(errors, []);
    assert.equal(context.__fixtureRuntime, undefined, 'engine-created globals must stay off the native host');
    await context.__C3MiniGameAdapter.dispose();
  });
}

for (const platform of ['wechat', 'douyin']) {
  test(`${platform}: compiled export isolates a native realm with nonconfigurable document/window`, {timeout: 10000}, async t => {
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'c3-isolation-'));
    t.after(() => fs.rm(temp, {recursive: true, force: true}));
    const input = path.join(temp, 'fixture');
    await fs.cp(fixture, input, {recursive: true});
    await fs.appendFile(path.join(input, 'scripts/c3runtime.js'), `
// Capability probes mirror the forms used by the real engine, not its implementation.
globalThis.__fixtureHostCapabilityProbe = {
  dialog: typeof HTMLDialogElement,
  idle: typeof requestIdleCallback,
  indexedStore: typeof IDBObjectStore,
  dialogViaSelf: typeof self.HTMLDialogElement
};
(() => {
  class HTMLDialogElement {}
  globalThis.__fixtureLocalIDL = typeof HTMLDialogElement;
})();
// The real export publishes this library through self and reads it as a bare name.
self.localforage = {createInstance: options => ({name: options.name, owner: 'engine'})};
globalThis.__fixtureProjectStorage = localforage.createInstance({name: 'fixture-project'});
`);
    const output = path.join(temp, platform);
    await convertProject({input, output, platform, experimental: true});
    const source = await fs.readFile(path.join(output, 'game.js'), 'utf8');
    const errors = [];
    const nativeDocument = Object.freeze({
      identity: 'native-devtools-document',
      createElement() { throw new Error('Engine must never create elements in the native IDE DOM'); }
    });
    const nativeFetch = () => { throw new Error('Engine must not use native IDE fetch'); };
    const context = vm.createContext({
      console: {...console, error: (...args) => errors.push(args.map(String).join(' '))},
      setTimeout, clearTimeout, queueMicrotask,
      nativeDocument, fetch: nativeFetch,
      [platform === 'wechat' ? 'wx' : 'tt']: mockPlatform(output)
    });
    vm.runInContext(`Object.defineProperty(globalThis,'document',{value:nativeDocument,writable:false,configurable:false});
      Object.defineProperty(globalThis,'window',{value:globalThis,writable:false,configurable:false});
      Object.defineProperty(globalThis,'GameGlobal',{value:globalThis,writable:false,configurable:false});
      Object.defineProperty(globalThis,'HTMLDialogElement',{value:class NativeDialog {},writable:false,configurable:false});
      Object.defineProperty(globalThis,'IDBObjectStore',{value:class NativeObjectStore {},writable:false,configurable:false});
      Object.defineProperty(globalThis,'localforage',{value:{createInstance() { throw new Error('Engine must not read host localforage'); }},writable:false,configurable:false});
      Object.defineProperty(globalThis,'requestIdleCallback',{value:() => { throw new Error('Engine must not schedule native IDE idle callbacks'); },writable:false,configurable:false});`, context);
    const nativeWindow = context.window;
    const nativeDialog = context.HTMLDialogElement;
    const nativeIdleCallback = context.requestIdleCallback;
    const nativeLocalforage = context.localforage;
    const beforeKeys = new Set(Reflect.ownKeys(context));
    const documentDescriptor = Object.getOwnPropertyDescriptor(context, 'document');
    const windowDescriptor = Object.getOwnPropertyDescriptor(context, 'window');
    vm.runInContext(source, context, {filename: `${platform}/isolated-game.js`, timeout: 3000});
    await context.__C3MiniGameLoaded;
    const scope = context.__C3MiniGameScope;
    await scope.__fixtureDone;
    assert.equal(scope.__fixtureRuntime.initialized, true);
    assert.equal(scope.__fixtureRuntime.globalVars.contractValue, 42);
    assert.equal(scope.__fixtureRuntime.workerValue, 42);
    assert.deepEqual({...scope.__fixtureHostCapabilityProbe}, {
      dialog: 'undefined', idle: 'undefined', indexedStore: 'undefined', dialogViaSelf: 'undefined'
    });
    assert.equal(scope.__fixtureLocalIDL, 'function', 'esbuild must preserve local names while redirecting only unresolved globals');
    assert.deepEqual({...scope.__fixtureProjectStorage}, {name: 'fixture-project', owner: 'engine'});
    assert.notEqual(scope.document, nativeDocument);
    assert.equal(scope.document.__c3MiniGameAdapter, true);
    assert.equal(scope.window, scope);
    assert.equal(scope.self, scope);
    assert.equal(scope.globalThis, scope);
    assert.equal(scope.top, scope);
    assert.equal(scope.parent, scope);
    assert.equal(scope.__fixtureRuntime.canvas, scope.__C3MiniGameAdapter.canvas);
    assert.equal(context.document, nativeDocument);
    assert.equal(context.window, nativeWindow);
    assert.equal(context.fetch, nativeFetch);
    assert.equal(context.HTMLDialogElement, nativeDialog);
    assert.equal(context.requestIdleCallback, nativeIdleCallback);
    assert.equal(context.localforage, nativeLocalforage);
    assert.deepEqual(Object.getOwnPropertyDescriptor(context, 'document'), documentDescriptor);
    assert.deepEqual(Object.getOwnPropertyDescriptor(context, 'window'), windowDescriptor);
    assert.equal(context.__fixtureRuntime, undefined);
    assert.equal(context.RuntimeInterface, undefined);
    assert.equal(context.C3_SetInitFunctions, undefined);
    assert.deepEqual(Reflect.ownKeys(context).filter(key => !beforeKeys.has(key)).sort(), ['__C3MiniGameAdapter', '__C3MiniGameLoaded', '__C3MiniGameReady', '__C3MiniGameScope', '__C3MiniGameStartup']);
    assert.deepEqual(errors, []);
    await context.__C3MiniGameAdapter.dispose();
    assert.equal(context.document, nativeDocument);
    assert.equal(context.window, nativeWindow);
    assert.equal(context.fetch, nativeFetch);
  });
}
