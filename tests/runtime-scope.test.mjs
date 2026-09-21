import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createEngineScope} from '../src/runtime/scope.js';
import {installAdapter} from '../src/runtime/index.js';

function platformAPI() {
  return {
    createCanvas() { return {getContext() { return null; }}; },
    getSystemInfoSync() { return {platform: 'devtools', windowWidth: 320, windowHeight: 480}; }
  };
}
for (const platform of ['douyin', 'wechat']) {
  test(`${platform}: engine scope isolates nonconfigurable browser DOM and preserves native primitives`, async () => {
    const api = platformAPI();
    const nativeDocument = {createElement() { throw new Error('Native DOM must not be used'); }};
    const host = {Math, Object, Uint8Array, Intl, URL, URLSearchParams, Blob, console, performance, setTimeout, clearTimeout, fetch};
    Object.defineProperty(host, 'document', {value: nativeDocument, configurable: false});
    Object.defineProperty(host, 'window', {value: host, configurable: false});
    host[platform === 'wechat' ? 'wx' : 'tt'] = api;
    const originalFetch = host.fetch;
    const scope = createEngineScope(host, {platform});
    assert.equal(Object.getPrototypeOf(scope), null);
    assert.equal(scope.document, undefined); assert.equal(scope.fetch, undefined); assert.equal(scope.Worker, undefined);
    assert.equal(scope.Math, Math); assert.equal(scope.Uint8Array, Uint8Array); assert.equal(scope.Intl, Intl);
    assert.equal(scope.globalThis, scope); assert.equal(scope.GameGlobal, scope); assert.equal(scope.top, scope);
    const adapter = installAdapter({platform, host: scope});
    assert.equal(scope.document.__c3MiniGameAdapter, true);
    assert.equal(host.document, nativeDocument); assert.equal(host.window, host); assert.equal(host.fetch, originalFetch);
    assert.equal(Object.getOwnPropertyDescriptor(host, 'document').configurable, false);
    assert.equal(scope.document.createElement('canvas'), adapter.canvas);
    await adapter.dispose();
    assert.equal(host.document, nativeDocument);
  });
}

test('scope binds native timer receivers and does not pretend alternate wasm is standard WebAssembly', () => {
  const host = {wx: platformAPI(), WXWebAssembly: {nativeOnly: true}, setTimeout(callback) { assert.equal(this, host); callback(); return 8; }};
  const scope = createEngineScope(host, {platform: 'wechat'});
  let called = false;
  assert.equal(scope.setTimeout(() => { called = true; }), 8);
  assert.equal(called, true); assert.equal(scope.WebAssembly, undefined); assert.equal(scope.WXWebAssembly, host.WXWebAssembly);
});

test('scope factory can be embedded as ordinary build-time source before polyfill execution', () => {
  const api = platformAPI(); const context = vm.createContext({wx: api});
  vm.runInContext(`const __native = globalThis;
    const __scope = (${createEngineScope.toString()})(__native, {platform:'wechat'});
    globalThis.result = (() => { const globalThis = __scope, window = __scope, self = __scope;
      return { standardIntrinsics: globalThis.Math === Math && globalThis.Object === Object,
        noDocument: typeof document === 'undefined' && globalThis.document === undefined,
        sameGlobals: window === self && self === globalThis,
        api: globalThis.wx };
    })();`, context);
  assert.equal(context.result.standardIntrinsics, true);
  assert.equal(context.result.noDocument, true);
  assert.equal(context.result.sameGlobals, true);
  assert.equal(context.result.api, api);
});


test('scope accepts explicit lexical platform bindings without importing native DOM', () => {
  const api = platformAPI(); const wasm = {instantiate() {}};
  const scope = createEngineScope({}, {platform: 'wechat', nativeBindings: {wx: api, WXWebAssembly: wasm, document: {native: true}}});
  assert.equal(scope.wx, api); assert.equal(scope.WXWebAssembly, wasm); assert.equal(scope.WebAssembly, undefined);
  assert.equal(scope.document, undefined);
});

test('copied realm methods keep the real receiver even after an engine rebind', () => {
  const realm = {};
  const calls = [];
  const methods = ['queueMicrotask', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
    'requestAnimationFrame', 'cancelAnimationFrame', 'atob', 'btoa', 'structuredClone'];
  for (const name of methods) realm[name] = function (...args) {
    assert.equal(this, realm, `${name} requires its real realm receiver`);
    calls.push([name, ...args]); return args[0];
  };
  const gameGlobal = {wx: platformAPI(), ...realm};
  const scope = createEngineScope(gameGlobal, {platform: 'wechat', nativeGlobal: realm});
  for (const name of methods) {
    assert.equal(scope[name].bind(scope)('value'), 'value');
    assert.equal(gameGlobal[name], realm[name], 'the original function is not replaced');
  }
  assert.equal(calls.length, methods.length);
  assert.equal(realm.window, undefined, 'no browser window property is required');
  assert.equal(scope.window, scope);
});

test('distinct game methods retain the game host while missing primitives fall back to the realm', () => {
  const realm = {Math, console, document: {}, fetch() { assert.fail('native DOM networking is isolated'); }};
  realm.queueMicrotask = function (callback) { assert.equal(this, realm); callback(); };
  realm.setTimeout = () => assert.fail('must keep the distinct game timer');
  const gameGlobal = {wx: platformAPI(), setTimeout(callback, delay) { assert.equal(this, gameGlobal); assert.equal(delay, 5); callback(); return 42; }};
  const scope = createEngineScope(gameGlobal, {platform: 'wechat', nativeGlobal: realm});
  let calls = 0;
  scope.queueMicrotask(() => calls++);
  assert.equal(scope.setTimeout(() => calls++, 5), 42);
  assert.equal(calls, 2); assert.equal(scope.Math, Math); assert.equal(scope.console, console);
  assert.equal(scope.document, undefined); assert.equal(scope.fetch, undefined);
});
