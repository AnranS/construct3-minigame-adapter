import test from 'node:test';
import assert from 'node:assert/strict';
import {installAdapter, resolveAssetPath} from '../src/runtime/index.js';
import {createPlatformBridge} from '../src/runtime/bridge.js';

function makePlatform() {
  const callbacks = new Map();
  const storage = new Map([['foreign-key', 'do not delete']]);
  const requests = [];
  const files = [];
  const api = {
    createCanvas() { return {getContext(kind) { return kind === '2d' ? {kind} : null; }}; },
    createImage() {
      let src = '', load, error;
      return Object.defineProperties({}, {
        src: {get: () => src, set(value) { src = value; queueMicrotask(() => load?.({})); }, configurable: true},
        onload: {get: () => load, set(value) { load = value; }, configurable: true},
        onerror: {get: () => error, set(value) { error = value; }, configurable: true},
        nativeSrc: {get: () => src}
      });
    },
    getSystemInfoSync() { return {windowWidth: 320, windowHeight: 480, pixelRatio: 2}; },
    getStorageInfoSync() { return {keys: [...storage.keys()]}; },
    getStorageSync(key) { if (!storage.has(key)) throw new Error('No key'); return storage.get(key); },
    setStorageSync(key, value) { storage.set(key, value); },
    removeStorageSync(key) { storage.delete(key); },
    getFileSystemManager() { return {readFile(options) { files.push(options.filePath); queueMicrotask(() => options.filePath.endsWith('missing.json') ? options.fail({errMsg: 'file not found'}) : options.success({data: new TextEncoder().encode('{"name":"你好🎮"}').buffer})); }}; },
    request(options) {
      requests.push(options);
      let aborted = false;
      queueMicrotask(() => { if (!aborted) options.success({statusCode: options.url.includes('/error') ? 503 : 200, header: {'Content-Type': 'application/json'}, data: options.dataType === 'json' ? {accepted: true} : new TextEncoder().encode('{"ok":true}').buffer}); });
      return {abort() { aborted = true; options.fail({errMsg: 'abort'}); }};
    },
    login(options) { options.success({code: 'temporary-code'}); },
    vibrateShort(options) { options.success({}); },
    vibrateLong(options) { options.success({}); },
    getLaunchOptionsSync() { return {scene: 'test'}; }
  };
  for (const name of ['TouchStart', 'TouchMove', 'TouchEnd', 'TouchCancel', 'Show', 'Hide']) {
    callbacks.set(name, new Set());
    api[`on${name}`] = callback => callbacks.get(name).add(callback);
    api[`off${name}`] = callback => callbacks.get(name).delete(callback);
  }
  const emit = (name, event = {}) => { for (const callback of callbacks.get(name)) callback(event); };
  return {api, emit, callbacks, storage, requests, files};
}

for (const platform of ['douyin', 'wechat']) {
  test(`${platform}: install, native canvas, touch/pointer/lifecycle and complete disposal`, () => {
    const fixture = makePlatform();
    const previousFetch = () => 'original';
    const host = {fetch: previousFetch};
    const adapter = installAdapter({platform, host, api: fixture.api});
    assert.equal(host.window, host); assert.equal(host.self, host);
    assert.equal(host.window.top, host.window); assert.equal(host.window.parent, host.window);
    assert.equal(host.document.location, host.location); assert.equal(host.document.defaultView, host);
    assert.equal(host.document.location.origin + host.document.location.pathname, 'https://c3-minigame.invalid/game/index.html');
    assert.equal(adapter.canvas.width, 640); assert.equal(adapter.canvas.height, 960);
    assert.equal(host.document.createElement('canvas'), adapter.canvas);
    assert.equal(adapter.canvas.getContext('webgl'), null, 'do not fake WebGL support');
    assert.equal(installAdapter({platform, host, api: fixture.api}), adapter);
    assert.throws(() => installAdapter({platform: platform === 'douyin' ? 'wechat' : 'douyin', host, api: fixture.api}), /different adapter/);
    const events = [];
    adapter.canvas.addEventListener('pointerdown', event => events.push(['pointer', event.clientX, event.pointerId]));
    host.document.addEventListener('touchstart', event => events.push(['touch', event.touches.length]));
    fixture.emit('TouchStart', {touches: [{identifier: 0, x: 12, y: 34}], changedTouches: [{identifier: 0, x: 12, y: 34}]});
    assert.deepEqual(events, [['touch', 1], ['pointer', 12, 1]]);
    fixture.emit('Hide'); assert.equal(host.document.hidden, true);
    fixture.emit('Show'); assert.equal(host.document.hidden, false);
    const disposePause = adapter.bridge.onPause(() => {});
    assert.equal(fixture.callbacks.get('Hide').size, 2);
    disposePause(); adapter.dispose(); adapter.dispose();
    assert.equal(host.fetch, previousFetch); assert.equal(host.document, undefined);
    for (const listeners of fixture.callbacks.values()) assert.equal(listeners.size, 0);
  });
  test(`${platform}: fetch local UTF-8/binary, native remote errors, and abort`, async () => {
    const fixture = makePlatform(); const host = {};
    const adapter = installAdapter({platform, host, api: fixture.api});
    try {
      const response = await host.fetch('data.json?version=1');
      const clone = response.clone();
      assert.deepEqual(await response.json(), {name: '你好🎮'});
      assert.equal(new TextDecoder().decode(await clone.arrayBuffer()), '{"name":"你好🎮"}');
      await assert.rejects(response.text(), /already been consumed/);
      assert.deepEqual(fixture.files, ['game/data.json']);
      await host.fetch('https://c3-minigame.invalid/game/data.json');
      assert.equal(fixture.files[1], 'game/data.json');
      await assert.rejects(host.fetch('../outside.json'), /escapes assetRoot/);
      await assert.rejects(host.fetch('missing.json'), /file not found/);
      const failure = await host.fetch('https://api.example.test/error');
      assert.equal(failure.status, 503); assert.equal(failure.ok, false);
      const controller = new AbortController();
      const pending = host.fetch('https://api.example.test/slow', {signal: controller.signal});
      controller.abort(); await assert.rejects(pending, {name: 'AbortError'});
    } finally { adapter.dispose(); }
  });
  test(`${platform}: localStorage isolates adapter keys and converts values`, () => {
    const fixture = makePlatform(); const host = {};
    const adapter = installAdapter({platform, host, api: fixture.api});
    try {
      assert.equal(host.localStorage.getItem('missing'), null);
      host.localStorage.setItem('', 0); host.localStorage.setItem('score', 12);
      assert.equal(host.localStorage.getItem('score'), '12');
      assert.equal(host.localStorage.getItem(''), '0');
      assert.equal(host.localStorage.length, 2);
      host.localStorage.clear(); assert.equal(host.localStorage.length, 0);
      assert.equal(fixture.storage.get('foreign-key'), 'do not delete');
    } finally { adapter.dispose(); }
  });
  test(`${platform}: native image mapping, dynamic script onload and explicit failures`, async () => {
    const fixture = makePlatform(); const host = {}; const loaded = [];
    const adapter = installAdapter({platform, host, api: fixture.api, loadScript: async src => { if (src === 'missing.js') throw new Error('Not bundled'); loaded.push(src); }});
    try {
      const image = new host.Image();
      const imageLoaded = new Promise(resolve => image.addEventListener('load', resolve));
      image.src = 'images/icon.png'; await imageLoaded;
      assert.equal(image.nativeSrc, 'game/images/icon.png');
      const script = host.document.createElement('script'); script.src = 'scripts/main.js';
      const loadedScript = new Promise(resolve => { script.onload = resolve; });
      host.document.head.appendChild(script); await loadedScript;
      assert.deepEqual(loaded, ['scripts/main.js']);
      const bad = host.document.createElement('script'); bad.src = 'missing.js';
      const failedScript = new Promise(resolve => { bad.onerror = resolve; });
      host.document.head.appendChild(bad); await failedScript;
      assert.match(bad.lastError.message, /Not bundled/);
      assert.throws(() => host.document.createElement('video'), /Unsupported DOM/);
      const container = host.document.createElement('div'); container.classList.add('container');
      container.id = 'holder'; host.document.body.appendChild(container);
      assert.equal(host.document.querySelector('#holder'), container);
      container.remove(); assert.equal(host.document.querySelector('#holder'), null);
    } finally { adapter.dispose(); }
  });
  test(`${platform}: XMLHttpRequest completes response and abort exactly once`, async () => {
    const fixture = makePlatform(); const host = {};
    const adapter = installAdapter({platform, host, api: fixture.api});
    try {
      const xhr = new host.XMLHttpRequest(); const states = [];
      xhr.onreadystatechange = () => states.push(xhr.readyState);
      xhr.open('GET', 'data.json'); xhr.responseType = 'json';
      const loaded = new Promise(resolve => { xhr.onload = resolve; }); xhr.send(); await loaded;
      assert.deepEqual(xhr.response, {name: '你好🎮'}); assert.deepEqual(states, [1, 2, 3, 4]); assert.equal(xhr.status, 200);
      const aborted = new host.XMLHttpRequest(); const events = [];
      aborted.onabort = () => events.push('abort'); aborted.onloadend = () => events.push('loadend');
      aborted.open('GET', 'https://api.example.test/slow'); aborted.send(); aborted.abort();
      await new Promise(resolve => setImmediate(resolve));
      assert.deepEqual(events, ['abort', 'loadend']); assert.equal(aborted.readyState, 0);
      assert.throws(() => xhr.open('GET', 'data.json', false), /Synchronous/);
    } finally { adapter.dispose(); }
  });
  test(`${platform}: platform bridge requires a score endpoint and returns no fake success`, async () => {
    const fixture = makePlatform();
    const bridge = createPlatformBridge({platform, api: fixture.api});
    assert.equal(bridge.getPlatform(), platform);
    assert.deepEqual(bridge.getLaunchOptions(), {scene: 'test'});
    assert.deepEqual(await bridge.login(), {platform, code: 'temporary-code'});
    assert.equal(fixture.requests.length, 0, 'code must not be automatically reported without config');
    await assert.rejects(bridge.reportScore(42), /explicit HTTPS backend endpoint/);
    await bridge.init({platform: 'auto', scoreEndpoint: 'https://api.example.test/score'});
    await bridge.reportScore({score: 42, leaderboardId: 'main'});
    assert.deepEqual(fixture.requests[0].data, {platform, score: 42, leaderboardId: 'main'});
    await assert.rejects(bridge.reportScore({score: NaN}), /finite number/);
    await assert.rejects(bridge.reportScore(42, {endpoint: 'https://api.example.test/error'}), /503/);
    await bridge.vibrate({type: 'long'});
    await bridge.init({loginEndpoint: 'https://api.example.test/login'});
    assert.deepEqual(await bridge.login(), {platform, session: {accepted: true}});
    bridge.dispose(); assert.throws(() => bridge.init(), /disposed/);
  });
  test(`${platform}: rewarded video completion, cancellation and errors are distinct`, async () => {
    const fixture = makePlatform(); let close, error, destroyed = 0;
    fixture.api.createRewardedVideoAd = () => ({onClose(cb) { close = cb; }, offClose() {}, onError(cb) { error = cb; }, offError() {}, async show() {}, destroy() { destroyed++; }});
    const bridge = createPlatformBridge({platform, api: fixture.api});
    const first = bridge.showRewardedVideo({adUnitId: 'test-ad'}); close({isEnded: true});
    assert.equal((await first).completed, true);
    const second = bridge.showRewardedVideo({adUnitId: 'test-ad'}); close({isEnded: false});
    assert.equal((await second).completed, false);
    const third = bridge.showRewardedVideo({adUnitId: 'test-ad'}); error({errMsg: 'No inventory'});
    await assert.rejects(third, /No inventory/); assert.equal(destroyed, 3);
    const pending = bridge.showRewardedVideo({adUnitId: 'test-ad'}); bridge.dispose();
    await assert.rejects(pending, /disposed/);
  });
}

test('asset resolver rejects traversal and unsupported protocols', () => {
  assert.equal(resolveAssetPath('./images/a.png'), 'game/images/a.png');
  assert.equal(resolveAssetPath('/game/images/../a.png?v=1'), 'game/a.png');
  assert.equal(resolveAssetPath('wxfile://saved/a.png'), 'wxfile://saved/a.png');
  assert.equal(resolveAssetPath('ttfile://saved/a.png'), 'ttfile://saved/a.png');
  assert.throws(() => resolveAssetPath('%2e%2e/secret'), /escapes assetRoot/);
  assert.throws(() => resolveAssetPath('blob:abc'), /Unsupported asset/);
  assert.throws(() => resolveAssetPath('a', '../game'), /assetRoot/);
});

test('installation rollback restores globals when a platform listener is not disposable', () => {
  const fixture = makePlatform(); delete fixture.api.offTouchMove;
  const host = {};
  assert.throws(() => installAdapter({host, api: fixture.api}), /offTouchMove/);
  assert.equal(host.document, undefined); assert.equal(host.C3MiniGameBridge, undefined);
  assert.equal(fixture.callbacks.get('TouchStart').size, 0);
});

for (const platform of ['douyin', 'wechat']) {
  test(`${platform}: explicit canvas claim keeps capability probes off screen`, () => {
    const fixture = makePlatform(); const host = {};
    const adapter = installAdapter({platform, host, api: fixture.api, autoClaimMainCanvas: false});
    const probe = host.document.createElement('canvas');
    assert.notEqual(probe, adapter.canvas);
    adapter.claimMainCanvas();
    assert.equal(host.document.createElement('canvas'), adapter.canvas);
    assert.notEqual(host.document.createElement('canvas'), adapter.canvas);
    assert.throws(() => adapter.claimMainCanvas(), /already been claimed/);
    adapter.dispose();
  });
  test(`${platform}: Audio uses native events and WebAudio only exposes a real native context`, async () => {
    const fixture = makePlatform(); const host = {}; const nativeEvents = new Map();
    let destroyed = 0; let webDestroyed = 0;
    const inner = {src: '', volume: 1, currentTime: 0, duration: 2,
      play() { queueMicrotask(() => nativeEvents.get('Play')?.()); },
      pause() { nativeEvents.get('Pause')?.(); },
      seek(value) { this.currentTime = value; },
      destroy() { destroyed++; }
    };
    for (const suffix of ['Canplay', 'Play', 'Pause', 'Ended', 'TimeUpdate', 'Error']) {
      inner[`on${suffix}`] = callback => nativeEvents.set(suffix, callback);
      inner[`off${suffix}`] = () => nativeEvents.delete(suffix);
    }
    fixture.api.createInnerAudioContext = () => inner;
    const realWebAudio = {createGain() { return {native: true}; }, destroy() { webDestroyed++; }};
    fixture.api.createWebAudioContext = () => realWebAudio;
    const adapter = installAdapter({platform, host, api: fixture.api});
    const audio = new host.Audio('media/beep.mp3');
    assert.equal(inner.src, 'game/media/beep.mp3');
    assert.equal(audio.paused, true); await audio.play(); assert.equal(audio.paused, false);
    audio.pause(); assert.equal(audio.paused, true); audio.currentTime = 1; assert.equal(inner.currentTime, 1);
    assert.equal(new host.AudioContext(), realWebAudio);
    assert.throws(() => new host.AudioContext({sampleRate: 22050}), /sampleRate/);
    adapter.dispose(); assert.equal(destroyed, 1); assert.equal(webDestroyed, 1); assert.equal(nativeEvents.size, 0);
  });
}

test('touch capture follows window/document/target/bubble order and honors stopPropagation', () => {
  const fixture = makePlatform(); const host = {};
  const adapter = installAdapter({host, api: fixture.api}); const order = [];
  host.addEventListener('pointerdown', () => order.push('window-capture'), true);
  host.document.addEventListener('pointerdown', () => order.push('document-capture'), {capture: true});
  adapter.canvas.addEventListener('pointerdown', () => order.push('target'));
  host.document.addEventListener('pointerdown', () => order.push('document-bubble'));
  host.addEventListener('pointerdown', () => order.push('window-bubble'));
  fixture.emit('TouchStart', {touches: [{identifier: 0, x: 1, y: 2}]});
  assert.deepEqual(order, ['window-capture', 'document-capture', 'target', 'document-bubble', 'window-bubble']);
  host.document.addEventListener('pointerdown', event => { order.push('stop'); event.stopPropagation(); }, {capture: true, once: true});
  order.length = 0; fixture.emit('TouchStart', {touches: [{identifier: 0, x: 1, y: 2}]});
  assert.deepEqual(order, ['window-capture', 'document-capture', 'stop']);
  adapter.dispose();
});

test('disposal aborts in-flight network requests and releases AbortSignal handlers', async () => {
  const fixture = makePlatform(); const host = {}; let nativeAborts = 0;
  fixture.api.request = () => ({abort() { nativeAborts++; }});
  const adapter = installAdapter({host, api: fixture.api});
  const controller = new AbortController();
  const pending = host.fetch('https://api.example.test/pending', {signal: controller.signal});
  adapter.dispose();
  await assert.rejects(pending, {name: 'AbortError'});
  assert.equal(nativeAborts, 1);
});

for (const platform of ['douyin', 'wechat']) {
  test(`${platform}: matchMedia evaluates truthful viewport queries and only notifies match changes`, () => {
    const fixture = makePlatform(); const host = {}; let resizeCallback;
    fixture.api.onWindowResize = callback => { resizeCallback = callback; };
    fixture.api.offWindowResize = callback => { assert.equal(callback, resizeCallback); resizeCallback = null; };
    const adapter = installAdapter({platform, host, api: fixture.api});
    assert.equal(host.matchMedia('(display-mode: standalone)').matches, true);
    assert.equal(host.matchMedia('(display-mode: browser)').matches, false);
    assert.equal(host.matchMedia('(display-mode: fullscreen)').matches, false);
    assert.equal(host.matchMedia('screen and (min-width: 320px) and (max-height: 480px)').matches, true);
    assert.equal(host.matchMedia('(width: 320px), (height: 1px)').matches, true);
    assert.equal(host.matchMedia('(width: 2em)').matches, false);
    assert.equal(host.matchMedia('(prefers-color-scheme: dark)').matches, false);
    assert.equal(host.matchMedia('(min-width: 1px) and (unknown: 1)').matches, false);
    const landscape = host.matchMedia('(orientation: landscape)'); const changes = [];
    const legacyListener = event => changes.push(['legacy', event.matches]);
    landscape.addListener(legacyListener);
    landscape.addEventListener('change', event => changes.push(['modern', event.matches, event.media]), {once: true});
    landscape.onchange = event => changes.push(['property', event.matches]);
    assert.equal(landscape.matches, false);
    resizeCallback({windowWidth: 640, windowHeight: 320});
    assert.equal(host.innerWidth, 640); assert.equal(landscape.matches, true);
    resizeCallback({windowWidth: 800, windowHeight: 320});
    assert.deepEqual(changes, [['legacy', true], ['modern', true, '(orientation: landscape)'], ['property', true]]);
    landscape.removeListener(legacyListener);
    resizeCallback({windowWidth: 300, windowHeight: 600});
    assert.deepEqual(changes.at(-1), ['property', false]); assert.equal(changes.length, 4);
    adapter.dispose(); assert.equal(resizeCallback, null); assert.equal(host.matchMedia, undefined);
  });
  test(`${platform}: native canvas/image retain identity with constructor brand checks and ImageData has validated pixels`, () => {
    const fixture = makePlatform(); const host = {};
    const adapter = installAdapter({platform, host, api: fixture.api});
    const canvas = host.document.createElement('canvas');
    assert.equal(canvas, adapter.canvas); assert.ok(canvas instanceof host.HTMLCanvasElement);
    assert.equal({getContext() {}} instanceof host.HTMLCanvasElement, false);
    const image = new host.Image();
    assert.ok(image instanceof host.Image); assert.ok(image instanceof host.HTMLImageElement);
    assert.equal({src: 'fake'} instanceof host.HTMLImageElement, false);
    assert.equal(image instanceof host.HTMLCanvasElement, false);
    assert.throws(() => new host.HTMLCanvasElement(), /Illegal constructor/);
    const empty = new host.ImageData(2, 3);
    assert.equal(empty.data.length, 24); assert.equal(empty.width, 2); assert.equal(empty.height, 3);
    assert.ok(empty instanceof host.ImageData); assert.equal(Object.prototype.toString.call(empty), '[object ImageData]');
    const pixels = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255]);
    const data = new host.ImageData(pixels, 2);
    assert.equal(data.data, pixels); assert.equal(data.height, 1);
    assert.throws(() => new host.ImageData(pixels, 2, 2), /pixel length/);
    assert.throws(() => new host.ImageData(0, 2), /positive integers/);
    adapter.dispose();
  });
}

for (const platform of ['douyin', 'wechat']) {
  test(`${platform}: Blob image sources materialize real bytes and stale asynchronous loads cannot replace newer src`, async () => {
    const fixture = makePlatform(); const host = {}; const writes = []; const removed = [];
    fixture.api.env = {USER_DATA_PATH: `${platform === 'wechat' ? 'wxfile' : 'ttfile'}://usr`};
    const filesystem = fixture.api.getFileSystemManager();
    fixture.api.getFileSystemManager = () => ({...filesystem,
      writeFile(options) { writes.push(options); },
      unlink(options) { removed.push(options.filePath); options.success(); }
    });
    const adapter = installAdapter({platform, host, api: fixture.api});
    const bytes = new Uint8Array([137, 80, 78, 71, 0, 10]);
    const blob = new host.Blob([bytes], {type: 'image/png'});
    const url = host.URL.createObjectURL(blob);
    assert.equal(new host.URL('../image.png', 'https://example.test/game/scripts/').href, 'https://example.test/game/image.png');
    assert.equal(host.atob(host.btoa('\u0000\u00ff')), '\u0000\u00ff');
    const first = new host.Image(); first.src = url;
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(new Uint8Array(writes[0].data), bytes);
    const loaded = new Promise(resolve => { first.onload = resolve; });
    writes[0].success(); await loaded;
    assert.equal(first.nativeSrc, writes[0].filePath);
    const second = new host.Image();
    const secondURL = host.URL.createObjectURL(new host.Blob([bytes], {type: 'image/png'}));
    second.src = secondURL;
    await new Promise(resolve => setImmediate(resolve));
    second.src = 'newer.png'; writes[1].success();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(second.nativeSrc, 'game/newer.png');
    const rejected = new host.Image();
    const failed = new Promise(resolve => { rejected.onerror = resolve; });
    rejected.src = 'blob:c3-minigame/not-in-registry';
    assert.match((await failed).message, /unknown or revoked/);
    await adapter.dispose();
    assert.equal(removed.length, 2);
  });
}

for (const platform of ['douyin', 'wechat']) {
  test(`${platform}: inert anchor and input support Construct capability probes without advertising native features`, async () => {
    const fixture = makePlatform(); const host = {};
    const adapter = installAdapter({platform, host, api: fixture.api});
    const anchor = host.document.createElement('a');
    const input = host.document.createElement('INPUT');
    assert.equal(anchor.tagName, 'A'); assert.equal(input.tagName, 'INPUT');
    assert.equal('download' in anchor, false);
    assert.equal('directory' in input, false);
    assert.equal('webkitdirectory' in input, false);
    assert.equal('showPicker' in input, false);
    host.document.body.appendChild(anchor); host.document.body.appendChild(input);
    assert.equal(host.document.querySelector('a'), anchor);
    assert.equal(host.document.querySelector('input'), input);
    await adapter.dispose();
  });
}

for (const platform of ['douyin', 'wechat']) {
  test(`${platform}: readonly native Canvas and Image remain unproxied in the logical DOM tree`, async () => {
    const fixture = makePlatform(); const host = {}; const nativeDocument = {native: true};
    const nativeParent = {removeChild() { assert.fail('Do not detach the displayed canvas from the native host tree'); }};
    const nativeStyle = {display: '', setProperty(name, value) { this[name] = value; }};
    const canvasPrototype = {};
    for (const [name, value] of Object.entries({tagName: 'CANVAS', nodeName: 'CANVAS', nodeType: 1, parentNode: nativeParent, parentElement: nativeParent, ownerDocument: nativeDocument, style: nativeStyle})) {
      Object.defineProperty(canvasPrototype, name, {get: () => value, configurable: true});
    }
    const nativeCanvas = Object.create(canvasPrototype);
    const context = {canvas: nativeCanvas};
    nativeCanvas.getContext = function () { assert.equal(this, nativeCanvas); return context; };
    fixture.api.createCanvas = () => nativeCanvas;
    const originalCreateImage = fixture.api.createImage;
    let nativeImage;
    fixture.api.createImage = () => {
      nativeImage = originalCreateImage();
      for (const [name, value] of Object.entries({tagName: 'IMG', nodeName: 'IMG', nodeType: 1, parentNode: nativeParent, ownerDocument: nativeDocument, style: nativeStyle})) {
        Object.defineProperty(nativeImage, name, {get: () => value, configurable: false});
      }
      return nativeImage;
    };
    const adapter = installAdapter({platform, host, api: fixture.api});
    assert.equal(adapter.canvas, nativeCanvas); assert.equal(adapter.canvas.getContext('webgl'), context);
    assert.equal(nativeCanvas.style, nativeStyle);
    const holder = host.document.createElement('div'); host.document.body.appendChild(holder);
    holder.appendChild(nativeCanvas);
    assert.equal(nativeCanvas.parentNode, holder); assert.equal(nativeCanvas.parentElement, holder);
    assert.equal(nativeCanvas.ownerDocument, host.document); assert.equal(holder.contains(nativeCanvas), true);
    assert.equal(host.document.body.contains(nativeCanvas), true);
    const events = [];
    holder.addEventListener('pointerdown', () => events.push('holder'));
    host.document.body.addEventListener('pointerdown', () => events.push('body'));
    fixture.emit('TouchStart', {touches: [{identifier: 0, x: 5, y: 6}]});
    assert.deepEqual(events, ['holder', 'body']);
    host.document.body.appendChild(nativeCanvas);
    assert.equal(holder.children.length, 0); assert.equal(nativeCanvas.parentNode, host.document.body);
    assert.throws(() => holder.appendChild(host.document.body), /inside itself/);
    nativeCanvas.remove(); assert.equal(nativeCanvas.parentNode, null);
    const image = new host.Image(); assert.equal(image, nativeImage); assert.equal(image.style, nativeStyle);
    holder.appendChild(image); assert.equal(holder.contains(image), true);
    // An own nonconfigurable parent getter must stay native; internal tree links remain correct.
    assert.equal(image.parentNode, nativeParent); assert.equal(image.ownerDocument, nativeDocument);
    host.document.body.appendChild(image); assert.equal(holder.contains(image), false);
    image.remove(); assert.equal(host.document.body.contains(image), false);
    await adapter.dispose();
  });
}

for (const platform of ['douyin', 'wechat']) {
  test(`${platform}: data URL fetch decodes real SVG/base64 and arbitrary percent bytes without native IO`, async () => {
    const fixture = makePlatform(); const host = {};
    const adapter = installAdapter({platform, host, api: fixture.api});
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><text>你好🎮</text></svg>';
    const base64 = Buffer.from(svg).toString('base64');
    const response = await host.fetch(`data:image/svg+xml;base64,${base64}`);
    assert.equal(response.headers.get('content-type'), 'image/svg+xml');
    assert.equal(await response.text(), svg);
    const svgBlob = await (await host.fetch(`data:image/svg+xml;base64,${base64}`)).blob();
    assert.equal(svgBlob.type, 'image/svg+xml'); assert.equal(await svgBlob.text(), svg);
    const binary = await host.fetch('data:application/octet-stream,%00%FF%80+%23#ignored');
    assert.deepEqual([...new Uint8Array(await binary.arrayBuffer())], [0, 255, 128, 43, 35]);
    const text = await host.fetch('data:;charset=UTF-8,%E4%BD%A0%E5%A5%BD+🎮%zz');
    assert.equal(text.headers.get('content-type'), 'text/plain;charset=UTF-8');
    assert.equal(await text.text(), '你好+🎮%zz');
    const escapedBase64 = await host.fetch('DATA:text/plain;BASE64,%61GVsbG8%3D');
    assert.equal(await escapedBase64.text(), 'hello');
    const empty = await host.fetch('data:,');
    assert.equal(empty.headers.get('content-type'), 'text/plain;charset=US-ASCII'); assert.equal(await empty.text(), '');
    assert.equal(await (await host.fetch('data:text/plain,content', {method: 'HEAD'})).text(), '');
    await assert.rejects(host.fetch('data:text/plain,content', {method: 'POST'}), /read-only/);
    await assert.rejects(host.fetch('data:text/plain;base64,not$base64'), /Invalid base64/);
    await assert.rejects(host.fetch('data:text/plain'), /missing comma/);
    assert.deepEqual(fixture.files, []); assert.deepEqual(fixture.requests, []);
    await adapter.dispose();
  });
  test(`${platform}: gamepad polling reports no exposed devices or forwards an actual native device list`, async () => {
    const fixture = makePlatform(); const host = {};
    const adapter = installAdapter({platform, host, api: fixture.api});
    assert.deepEqual(host.navigator.getGamepads(), []);
    const pads = [{index: 0, connected: true, id: 'native-pad'}];
    fixture.api.getGamepads = function () { assert.equal(this, fixture.api); return pads; };
    assert.equal(host.navigator.getGamepads(), pads);
    fixture.api.getGamepads = () => Promise.resolve(pads);
    assert.throws(() => host.navigator.getGamepads(), /synchronous array/);
    await adapter.dispose();
  });
}
