import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {convertProject} from '../src/build/convert.mjs';
import {createEngineScope} from '../src/runtime/scope.js';
import {installAdapter} from '../src/runtime/index.js';

const fixture = fileURLToPath(new URL('./fixtures/construct-export/', import.meta.url));

// Handwritten implementations of the documented TikTok Native minimum contract.
// This fixture does not simulate login, payment, advertisements or a TikTok device.
function nativeFixture(output) {
  const canvases = [], store = new Map(), listeners = new Map();
  const api = {
    createCanvas() {
      assert.equal(this, api, 'native calls retain TTMinis.game as their receiver');
      const canvas = {width: 390, height: 844, getContext: () => ({})};
      canvases.push(canvas); return canvas;
    },
    getWindowInfo() { return {windowWidth: 390, windowHeight: 844, pixelRatio: 1, screenTop: 24}; },
    getStorageInfoSync() { return {keys: [...store.keys()]}; },
    getStorageSync(key) { return store.get(key); },
    setStorageSync(key, value) { store.set(key, value); },
    removeStorageSync(key) { store.delete(key); },
    getFileSystemManager() {
      return {readFile({filePath, encoding, success, fail}) {
        fs.readFile(path.join(output, filePath)).then(buffer => success({data: encoding ? buffer.toString(encoding) : buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)}), fail);
      }};
    }
  };
  for (const suffix of ['TouchStart', 'TouchMove', 'TouchEnd', 'TouchCancel', 'Show', 'Hide']) {
    api[`on${suffix}`] = callback => listeners.set(suffix, callback);
    api[`off${suffix}`] = callback => { if (listeners.get(suffix) === callback) listeners.delete(suffix); };
  }
  return {api, canvases, store, listeners};
}

test('TikTok scope resolves only TTMinis.game and remains standalone when embedded', () => {
  const {api} = nativeFixture('unused');
  const otherPlatform = {createCanvas() { assert.fail('Do not borrow the wx/tt namespace'); }};
  assert.throws(() => createEngineScope({tt: otherPlatform, wx: otherPlatform}, {platform: 'tiktok'}), /TTMinis\.game/);
  const scope = createEngineScope({tt: otherPlatform, wx: otherPlatform, WXWebAssembly: {}, TTWebAssembly: {}}, {
    platform: 'tiktok', nativeBindings: {TTMinis: {game: api, init() { assert.fail('TikTok Native needs no SDK init'); }}}
  });
  assert.equal(scope.TTMinis.game, api);
  assert.equal(scope.tt, undefined); assert.equal(scope.wx, undefined);
  assert.equal(scope.WXWebAssembly, undefined); assert.equal(scope.TTWebAssembly, undefined);
  assert.equal(scope.WebAssembly, undefined);
  const context = vm.createContext({nativeGame: api});
  vm.runInContext(`globalThis.result = (${createEngineScope.toString()})(globalThis, {platform: 'tiktok', nativeBindings: {TTMinis: {game: nativeGame}}});`, context);
  assert.equal(context.result.TTMinis.game, api);
  assert.equal(context.result.globalThis, context.result);
});

test('TikTok installation keeps its identity, forwards documented storage and releases native events', async () => {
  const f = nativeFixture('unused');
  const host = {TTMinis: {game: f.api, init() { assert.fail('Native SDK init must not run'); }}};
  const adapter = installAdapter({platform: 'tiktok', host});
  assert.equal(adapter.platform, 'tiktok'); assert.equal(adapter.api, f.api);
  assert.equal(adapter.bridge.getPlatform(), 'tiktok');
  assert.equal(installAdapter({platform: 'tiktok', host}), adapter);
  assert.throws(() => installAdapter({platform: 'douyin', host, api: f.api}), /different adapter/);
  host.localStorage.setItem('saved', 'native value');
  assert.equal(host.localStorage.getItem('saved'), 'native value');
  assert.ok([...f.store.values()].includes('native value'));
  const touches = [];
  adapter.canvas.addEventListener('pointerdown', event => touches.push(event));
  adapter.canvas.addEventListener('pointermove', event => touches.push(event));
  // Public TikTok Touch documentation guarantees screenX/screenY, not clientX/Y.
  const start = {identifier: 1, screenX: 20, screenY: 54};
  f.listeners.get('TouchStart')({touches: [start], changedTouches: [start]});
  assert.equal(touches.length, 1);
  assert.deepEqual([touches[0].clientX, touches[0].clientY, touches[0].pageY, touches[0].screenY], [20, 30, 30, 54]);
  const move = {...start, clientX: 7, clientY: 8};
  f.listeners.get('TouchMove')({touches: [move], changedTouches: [move]});
  assert.deepEqual([touches[1].clientX, touches[1].clientY], [7, 8], 'supplied client coordinates take precedence');
  await adapter.dispose();
  assert.equal(f.listeners.size, 0); assert.equal(host.document, undefined);
  assert.equal(host.TTMinis.game, f.api);
});

test('TikTok builds require explicit experimental acknowledgement even for plain JavaScript', async t => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'c3-tiktok-gate-'));
  t.after(() => fs.rm(temporary, {recursive: true, force: true}));
  await fs.writeFile(path.join(temporary, 'main.js'), 'globalThis.loaded = true;');
  const output = path.join(temporary, 'output');
  await assert.rejects(convertProject({input: temporary, output, platform: 'tiktok', entry: 'main.js'}), /--experimental/);
  await assert.rejects(fs.access(output), {code: 'ENOENT'});
});

test('TikTok Native package executes lexical TTMinis.game bindings without wx/tt aliases or init', {timeout: 15000}, async t => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'c3-tiktok-build-'));
  t.after(() => fs.rm(temporary, {recursive: true, force: true}));
  const output = path.join(temporary, 'native-package');
  const report = await convertProject({input: fixture, output, platform: 'tiktok', appId: 'test-game-id', experimental: true, orientation: 'landscape'});
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(output, 'project.config.json'), 'utf8')), {appid: 'test-game-id'});
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(output, 'game.json'), 'utf8')), {});
  assert.equal(report.platform, 'tiktok'); assert.equal(report.nativeNamespace, 'TTMinis.game');
  assert.equal(report.nativeInitialization, 'not-required'); assert.equal(report.deviceVerified, false);
  assert.equal(report.configuration.requestedOrientation, 'landscape'); assert.equal(report.configuration.orientationApplied, false);
  assert.ok(report.findings.some(item => item.code === 'TIKTOK_CONFIGURATION_REVIEW'));
  assert.ok(report.limitations.some(item => item.includes('WebGL 1.0')));
  await assert.rejects(fs.access(path.join(output, 'index.html')), {code: 'ENOENT'});

  const f = nativeFixture(output), errors = [];
  const foreignAPI = {createCanvas() { assert.fail('TikTok must not use WeChat or Douyin APIs'); }};
  const context = vm.createContext({
    nativeSDK: {game: f.api, init() { assert.fail('TikTok Native does not initialize a web SDK'); }},
    tt: foreignAPI, wx: foreignAPI, WebAssembly: undefined,
    WXWebAssembly: {instantiate() { assert.fail('Do not borrow WXWebAssembly'); }},
    TTWebAssembly: {instantiate() { assert.fail('Do not borrow TTWebAssembly'); }},
    console: {...console, error: (...args) => errors.push(args.map(String).join(' '))},
    setTimeout, clearTimeout, queueMicrotask, URL, URLSearchParams
  });
  // Native globals can be lexical bindings rather than own globalThis properties.
  vm.runInContext('const TTMinis = nativeSDK; delete globalThis.nativeSDK;', context);
  vm.runInContext(await fs.readFile(path.join(output, 'game.js'), 'utf8'), context, {filename: 'tiktok/game.js', timeout: 3000});
  await context.__C3MiniGameLoaded;
  const scope = context.__C3MiniGameScope;
  await scope.__fixtureDone;
  assert.equal(scope.__C3MiniGameAdapter.platform, 'tiktok');
  assert.equal(scope.TTMinis.game, f.api);
  assert.equal(scope.tt, undefined); assert.equal(scope.wx, undefined); assert.equal(scope.WebAssembly, undefined);
  assert.equal(scope.__fixtureRuntime.initialized, true);
  assert.equal(scope.__fixtureRuntime.canvas, f.canvases[0]);
  assert.notEqual(scope.__fixtureProbeCanvas, f.canvases[0]);
  assert.equal(scope.__fixtureRuntime.workerValue, 42);
  assert.deepEqual(errors, []);
  await context.__C3MiniGameAdapter.dispose();
});
